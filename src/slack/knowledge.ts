import fs from 'fs-extra';
import path from 'path';
import { WikiUpdateItem, WikiSearchResult, SharedSourceItem, StagedQueueItem } from '../types.js';

export class ScopedKnowledgeBase {
  public rootDir: string;
  public sharedDir: string;
  public wikiDir: string;
  public sourcesDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.sharedDir = path.join(this.rootDir, 'data', 'shared');
    this.wikiDir = path.join(this.sharedDir, 'wiki');
    this.sourcesDir = path.join(this.sharedDir, 'sources');

    fs.ensureDirSync(this.wikiDir);
    fs.ensureDirSync(this.sourcesDir);
  }

  private assertSafePath(targetPath: string): string {
    const resolved = path.resolve(targetPath);
    const rel = path.relative(this.sharedDir, resolved);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Access denied: Path '${targetPath}' is outside the shared knowledge boundary.`);
    }
    return resolved;
  }

  private getAllMarkdownFiles(dir: string): string[] {
    const files: string[] = [];
    if (!fs.existsSync(dir)) return files;
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        files.push(...this.getAllMarkdownFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }
    return files;
  }

  public getRecentWikiUpdates(days: number = 7): WikiUpdateItem[] {
    const cutoffTime = Date.now() - days * 24 * 60 * 60 * 1000;
    const recentNotes: WikiUpdateItem[] = [];

    const mdFiles = this.getAllMarkdownFiles(this.wikiDir);
    for (const mdFile of mdFiles) {
      try {
        const stat = fs.statSync(mdFile);
        if (stat.mtimeMs >= cutoffTime) {
          const relPath = path.relative(this.wikiDir, mdFile).replace(/\\/g, '/');
          const content = fs.readFileSync(mdFile, 'utf-8');

          let title = path.basename(mdFile, '.md');
          let summary = '';
          const tags: string[] = [];

          const lines = content.split('\n');
          for (const line of lines) {
            if (line.startsWith('# ') && title === path.basename(mdFile, '.md')) {
              title = line.replace(/^#\s+/, '').trim();
            } else if (line.toLowerCase().startsWith('tags:')) {
              const tagsPart = line.split(':', 2)[1] || '';
              const parts = tagsPart.split(/[,[\]]/).map((t) => t.trim()).filter(Boolean);
              tags.push(...parts);
            }
          }

          const nonHeaderLines = lines
            .map((l) => l.trim())
            .filter((l) => l && !l.startsWith('#') && !l.startsWith('---'));

          if (nonHeaderLines.length > 0) {
            summary = nonHeaderLines[0].slice(0, 200);
          }

          recentNotes.push({
            path: `wiki/${relPath}`,
            title,
            modified_at: new Date(stat.mtimeMs).toISOString(),
            summary,
            tags,
          });
        }
      } catch {}
    }

    recentNotes.sort((a, b) => new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime());
    return recentNotes;
  }

  public searchSharedWiki(query: string, maxResults: number = 10): WikiSearchResult[] {
    const results: WikiSearchResult[] = [];
    if (!query.trim() || !fs.existsSync(this.wikiDir)) return results;

    const rawTokens = query.split(/\s+/).filter((t) => t.length > 1);
    const tokens = rawTokens.length > 0 ? rawTokens : [query.trim()];
    const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
    const regex = new RegExp(escaped, 'gi');

    const mdFiles = this.getAllMarkdownFiles(this.wikiDir);
    for (const mdFile of mdFiles) {
      try {
        const content = fs.readFileSync(mdFile, 'utf-8');
        const matches = content.match(regex);
        if (matches && matches.length > 0) {
          const relPath = path.relative(this.wikiDir, mdFile).replace(/\\/g, '/');
          const score = matches.length;

          let title = path.basename(mdFile, '.md');
          for (const line of content.split('\n')) {
            if (line.startsWith('# ')) {
              title = line.replace(/^#\s+/, '').trim();
              break;
            }
          }

          let excerpt = '';
          const matchIndex = content.toLowerCase().indexOf(tokens[0].toLowerCase());
          if (matchIndex >= 0) {
            const start = Math.max(0, matchIndex - 100);
            const end = Math.min(content.length, matchIndex + 150);
            excerpt = `...${content.slice(start, end).replace(/\n/g, ' ')}...`;
          }

          results.push({
            path: `wiki/${relPath}`,
            title,
            score,
            excerpt,
          });
        }
      } catch {}
    }

    results.sort((a, b) => b.score - a.score);
    return results.slice(0, maxResults);
  }

  public readSharedNote(relativePath: string, maxChars: number = 6000): Record<string, any> {
    const cleanRel = relativePath.replace(/^\/+/, '').trim();
    const targetPath = path.join(this.sharedDir, cleanRel);

    let safePath: string;
    try {
      safePath = this.assertSafePath(targetPath);
    } catch (err: any) {
      return { error: err.message };
    }

    if (!fs.existsSync(safePath) || !fs.statSync(safePath).isFile()) {
      return { error: `File '${cleanRel}' not found in shared knowledge base.` };
    }

    try {
      const content = fs.readFileSync(safePath, 'utf-8');
      const isTruncated = content.length > maxChars;
      return {
        path: cleanRel,
        content: content.slice(0, maxChars),
        truncated: isTruncated,
        total_chars: content.length,
      };
    } catch (err: any) {
      return { error: `Failed to read file: ${err.message}` };
    }
  }

  public listSharedSources(limit: number = 20): { sources: SharedSourceItem[]; staged_queue: StagedQueueItem[] } {
    const sources: SharedSourceItem[] = [];
    const stagingFile = path.join(this.sourcesDir, 'staging_queue.json');
    let stagedItems: StagedQueueItem[] = [];

    if (fs.existsSync(stagingFile)) {
      try {
        stagedItems = fs.readJsonSync(stagingFile);
      } catch {
        stagedItems = [];
      }
    }

    if (fs.existsSync(this.sourcesDir)) {
      const entries = fs.readdirSync(this.sourcesDir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name === 'staging_queue.json' || entry.name.startsWith('.')) continue;
        const fullPath = path.join(this.sourcesDir, entry.name);
        const stat = fs.statSync(fullPath);
        sources.push({
          name: entry.name,
          is_dir: entry.isDirectory(),
          size_bytes: entry.isFile() ? stat.size : null,
          modified_at: new Date(stat.mtimeMs).toISOString(),
        });
      }
    }

    sources.sort((a, b) => new Date(b.modified_at).getTime() - new Date(a.modified_at).getTime());
    return {
      sources: sources.slice(0, limit),
      staged_queue: stagedItems.slice(0, limit),
    };
  }

  public stageSourceUrl(
    url: string,
    title?: string,
    submitter: string = 'slack-user',
    notes: string = ''
  ): { status: string; message: string; entry: StagedQueueItem } {
    const stagingFile = path.join(this.sourcesDir, 'staging_queue.json');
    let queue: StagedQueueItem[] = [];
    if (fs.existsSync(stagingFile)) {
      try {
        queue = fs.readJsonSync(stagingFile);
      } catch {
        queue = [];
      }
    }

    const entry: StagedQueueItem = {
      url,
      title: title || url,
      submitted_by: submitter,
      notes,
      status: 'pending',
      staged_at: new Date().toISOString(),
    };

    queue.push(entry);
    fs.writeJsonSync(stagingFile, queue, { spaces: 2 });
    return {
      status: 'success',
      message: `Staged paper '${entry.title}' for ingestion.`,
      entry,
    };
  }
}
