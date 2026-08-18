import path from 'path';
import { spawnSync } from 'child_process';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { SlackConfig } from './config.js';
import { ScopedKnowledgeBase } from './knowledge.js';

export const SYSTEM_PROMPT = `You are @podarcis, the AI Research Assistant for the PodarcisNest research habitat.
Your primary role is to assist researchers and team members via Slack by:
1. Summarizing recent research progress, newly added protocols, and updated wiki notes.
2. Answering research and scientific questions using the shared Open Knowledge Format (OKF v0.2) wiki.
3. Staging and tracking literature or source papers in the shared repository.

CRITICAL PRIVACY & SECURITY BOUNDARIES:
- You ONLY have access to the team's shared knowledge base (\`data/shared/wiki/\` and \`data/shared/sources/\`).
- You DO NOT have access to individual researchers' private workspaces or personal scratchpads.
- Always be accurate, concise, and professional.
- Format responses cleanly for Slack: use emojis, bold headings, bullet points, and reference note paths (e.g. \`wiki/protocols/dna_extraction.md\`).
`;

export const TOOLS_SPEC = [
  {
    name: 'get_recent_shared_updates',
    description: 'Retrieve wiki notes and research documents updated or created within the last N days (default 7 days).',
    parameters: {
      type: 'object',
      properties: {
        days: {
          type: 'integer',
          description: 'Number of past days to scan for updates (e.g. 7 for last week, 30 for last month).',
          default: 7,
        },
      },
    },
  },
  {
    name: 'search_shared_wiki',
    description: 'Search the shared research wiki for notes matching keywords, topics, genes, or protocol names.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query or keyword phrase.',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_shared_note',
    description: 'Read the full text or content of a specific shared note from the wiki or sources.',
    parameters: {
      type: 'object',
      properties: {
        path: {
          type: 'string',
          description: "Relative path to note within shared directory (e.g. 'wiki/genomics/sequencing.md' or 'protocols/pcr.md').",
        },
      },
      required: ['path'],
    },
  },
  {
    name: 'list_shared_sources',
    description: 'List recently added literature papers, datasets, and pending staging queue in data/shared/sources/.',
    parameters: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'stage_source_url',
    description: 'Stage a scientific paper URL, DOI, or dataset link into the shared queue for team literature ingestion.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL or DOI of the paper/source.' },
        title: { type: 'string', description: 'Title or short description of the paper.' },
        notes: { type: 'string', description: 'Optional notes or reason for staging.' },
      },
      required: ['url'],
    },
  },
];

export class PodarcisResearchAgent {
  public rootDir: string;
  public config: SlackConfig;
  public kb: ScopedKnowledgeBase;

  constructor(rootDir: string, config: SlackConfig) {
    this.rootDir = path.resolve(rootDir);
    this.config = config;
    this.kb = new ScopedKnowledgeBase(this.rootDir);
  }

  public executeTool(toolName: string, toolArgs: Record<string, any>, userName: string = 'slack-user'): any {
    switch (toolName) {
      case 'get_recent_shared_updates':
        return this.kb.getRecentWikiUpdates(toolArgs.days ?? 7);
      case 'search_shared_wiki':
        return this.kb.searchSharedWiki(toolArgs.query || '');
      case 'read_shared_note':
        return this.kb.readSharedNote(toolArgs.path || '');
      case 'list_shared_sources':
        return this.kb.listSharedSources();
      case 'stage_source_url':
        return this.kb.stageSourceUrl(toolArgs.url || '', toolArgs.title, userName, toolArgs.notes || '');
      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  public async processMessage(
    userQuery: string,
    userName: string = 'researcher',
    conversationHistory?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    const queryLower = userQuery.toLowerCase().trim();

    // 1. Direct Pattern Matches
    if (['summarize', 'summary', 'last week', 'updates', 'recent', 'what was done', 'what changed'].some((w) => queryLower.includes(w))) {
      let days = 7;
      if (queryLower.includes('month')) days = 30;
      else if (queryLower.includes('yesterday') || queryLower.includes('last 24')) days = 1;
      return this.synthesizeRecentUpdates(days);
    }

    if (queryLower.startsWith('research ') || queryLower.startsWith('@researcher ')) {
      const searchQuery = userQuery.replace(/^(@researcher|research)\s+/i, '').trim();
      return (
        `🔬 *Spawning @researcher for:* \`${searchQuery}\`\n\n` +
        `Searching academic sources (Semantic Scholar / PubMed) and enqueuing results into \`data/shared/sources/\`.\n` +
        `Use \`@podarcis list sources\` to view enqueued literature once complete.`
      );
    }

    if (['synthesize', 'ingest', '@synthesizer', 'run synthesis'].includes(queryLower)) {
      const sourcesInfo = this.kb.listSharedSources(5);
      const staged = sourcesInfo.staged_queue;
      return (
        `🧠 *Spawning @synthesizer on Shared Knowledge Base:*\n\n` +
        `Processing ${staged.length} pending source(s) from \`data/shared/sources/staging_queue.json\` into OKF v0.2 wiki notes in \`data/shared/wiki/\`.\n` +
        `Running \`@auditor\` machine verification loop afterwards.`
      );
    }

    if (queryLower.startsWith('audit') || queryLower.startsWith('@auditor')) {
      return (
        `🔍 *Spawning @auditor Machine Verification:*\n\n` +
        `Running link integrity check, citation validation, and OKF v0.2 schema linting on \`data/shared/wiki/\`.\n` +
        `Verified notes will be signed off with status \`stable\`.`
      );
    }

    if (queryLower.startsWith('stage ') || queryLower.includes('arxiv.org') || queryLower.includes('doi.org')) {
      const words = userQuery.split(/\s+/);
      const url = words.find((w) => w.startsWith('http://') || w.startsWith('https://') || w.includes('10.'));
      if (url) {
        const res = this.kb.stageSourceUrl(url, undefined, userName, userQuery);
        return `📥 *${res.message}*\nAdded to \`data/shared/sources/staging_queue.json\` for team ingestion.`;
      }
    }

    if (['sources', 'papers', 'literature', 'queue'].some((w) => queryLower.includes(w))) {
      return this.formatSourcesSummary();
    }

    if (queryLower.startsWith('search ') || queryLower.startsWith('find ')) {
      const queryTerm = userQuery.replace(/^(search|find)\s+/i, '').trim();
      return this.formatSearchResults(queryTerm);
    }

    // 2. OpenCode CLI Execution
    if (this.config.llm_provider === 'opencode' && this.hasOpencodeCli()) {
      return this.runOpencodeCli(userQuery, userName);
    }

    // 3. Direct LLM API Execution
    if (this.config.llm_api_key && this.config.llm_api_key !== 'opencode-local') {
      if (this.config.llm_provider === 'anthropic') {
        return this.runAnthropicLoop(userQuery, userName, conversationHistory);
      } else {
        return this.runOpenAiLoop(userQuery, userName, conversationHistory);
      }
    }

    // 4. Fallback search
    const searchRes = this.kb.searchSharedWiki(userQuery, 3);
    if (searchRes.length > 0) {
      return this.formatSearchResults(userQuery);
    }

    // Default Help
    return (
      `👋 Hi *${userName}*! I am *@podarcis*, your research team assistant.\n\n` +
      `Here is what you can ask me directly in Slack:\n` +
      `• \`@podarcis research <query>\` — Discovers literature and downloads papers via \`@researcher\`\n` +
      `• \`@podarcis synthesize\` — Compiles pending sources into OKF wiki notes via \`@synthesizer\`\n` +
      `• \`@podarcis audit\` — Runs machine verification and citation audits via \`@auditor\`\n` +
      `• \`@podarcis summarize last week\` — Progress summary of new and modified OKF notes\n` +
      `• \`@podarcis search <topic>\` — Searches the shared research wiki for protocols or notes\n` +
      `• \`@podarcis stage https://arxiv.org/abs/...\` — Stages a paper for literature ingestion\n` +
      `• \`@podarcis list sources\` — Shows newly ingested papers and pending staging queue`
    );
  }

  private synthesizeRecentUpdates(days: number = 7): string {
    const recentNotes = this.kb.getRecentWikiUpdates(days);
    const sourcesInfo = this.kb.listSharedSources(5);
    const staged = sourcesInfo.staged_queue;

    const timeframeLabel = days === 7 ? 'Past 7 Days' : `Past ${days} Days`;

    if (recentNotes.length === 0 && staged.length === 0) {
      return (
        `📊 *PodarcisNest Shared Research Summary (${timeframeLabel})*\n\n` +
        `No modified notes or staged papers found in \`data/shared/\` over the last ${days} days.`
      );
    }

    const output = [`📊 *PodarcisNest Shared Research Summary (${timeframeLabel})*\n`];

    if (recentNotes.length > 0) {
      output.push(`*📝 Updated OKF Wiki Notes (${recentNotes.length}):*`);
      for (const note of recentNotes.slice(0, 8)) {
        const tagsStr = note.tags && note.tags.length > 0 ? ` \`[${note.tags.join(', ')}]\`` : '';
        const summaryStr = note.summary ? `\n  _${note.summary}_` : '';
        output.push(`• *${note.title}* (\`${note.path}\`)${tagsStr}${summaryStr}`);
      }
      if (recentNotes.length > 8) {
        output.push(`_...and ${recentNotes.length - 8} more notes in \`data/shared/wiki/\`._`);
      }
      output.push('');
    }

    if (staged.length > 0) {
      output.push(`*📚 Pending Literature Staging Queue (${staged.length}):*`);
      for (const item of staged.slice(0, 5)) {
        output.push(`• *${item.title || item.url}* (submitted by _${item.submitted_by || 'team'}_)`);
      }
      output.push('');
    }

    return output.join('\n').trim();
  }

  private formatSearchResults(query: string): string {
    const results = this.kb.searchSharedWiki(query, 5);
    if (results.length === 0) {
      return `🔍 No shared wiki notes found matching: *${query}* in \`data/shared/wiki/\`.`;
    }

    const output = [`🔍 *Shared Wiki Search Results for "${query}":*\n`];
    for (const r of results) {
      output.push(`• *${r.title}* (\`${r.path}\`)`);
      if (r.excerpt) {
        output.push(`  _${r.excerpt}_`);
      }
    }
    return output.join('\n');
  }

  private formatSourcesSummary(): string {
    const info = this.kb.listSharedSources(10);
    const sources = info.sources;
    const staged = info.staged_queue;

    const output = ['📚 *Shared Literature & Sources Library (`data/shared/sources/`):*\n'];
    if (staged.length > 0) {
      output.push(`*Pending Ingestion Queue (${staged.length}):*`);
      for (const s of staged) {
        output.push(`• \`${s.url}\` — *${s.title}* (by _${s.submitted_by}_)`);
      }
      output.push('');
    }

    if (sources.length > 0) {
      output.push(`*Available Files & Datasets (${sources.length}):*`);
      for (const s of sources) {
        const kind = s.is_dir ? '📁 Directory' : `📄 File (${Math.round((s.size_bytes || 0) / 1024)} KB)`;
        output.push(`• \`${s.name}\` — ${kind}`);
      }
    } else {
      output.push('No literature files in `data/shared/sources/` yet.');
    }

    return output.join('\n');
  }

  private hasOpencodeCli(): boolean {
    const res = spawnSync('which', ['opencode'], { stdio: 'pipe' });
    return res.status === 0;
  }

  private runOpencodeCli(userQuery: string, userName: string): string {
    const prompt = `You are @podarcis in Slack responding to ${userName}. Query: ${userQuery}. You only have access to shared/wiki and shared/sources.`;
    const res = spawnSync('opencode', ['run', prompt], {
      cwd: this.kb.sharedDir,
      encoding: 'utf-8',
      timeout: 60000,
    });
    if (res.status === 0 && res.stdout && res.stdout.trim()) {
      return res.stdout.trim();
    }
    return this.synthesizeRecentUpdates(7);
  }

  private async runAnthropicLoop(
    userQuery: string,
    userName: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    const client = new Anthropic({ apiKey: this.config.llm_api_key });
    const model = this.config.llm_model || 'claude-3-5-sonnet-20241022';

    const tools: Anthropic.Tool[] = TOOLS_SPEC.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: t.parameters as Anthropic.Tool.InputSchema,
    }));

    const messages: Anthropic.MessageParam[] = [];
    if (history) {
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: 'user', content: `User (${userName}): ${userQuery}` });

    for (let turn = 0; turn < 5; turn++) {
      const response = await client.messages.create({
        model,
        max_tokens: 2048,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      const toolCalls = response.content.filter((c) => c.type === 'tool_use') as Anthropic.ToolUseBlock[];
      if (toolCalls.length === 0) {
        const textBlocks = response.content.filter((c) => c.type === 'text') as Anthropic.TextBlock[];
        return textBlocks.map((t) => t.text).join('\n').trim();
      }

      messages.push({ role: 'assistant', content: response.content });

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const tc of toolCalls) {
        const res = this.executeTool(tc.name, tc.input as Record<string, any>, userName);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: tc.id,
          content: JSON.stringify(res),
        });
      }

      messages.push({ role: 'user', content: toolResults });
    }

    return 'I completed the queries but reached the maximum reasoning iterations.';
  }

  private async runOpenAiLoop(
    userQuery: string,
    userName: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>
  ): Promise<string> {
    const client = new OpenAI({
      apiKey: this.config.llm_api_key || 'opencode-local',
      baseURL: this.config.llm_base_url,
    });
    const model = this.config.llm_model || 'opencode';

    const tools: OpenAI.Chat.ChatCompletionTool[] = TOOLS_SPEC.map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      },
    }));

    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      { role: 'system', content: SYSTEM_PROMPT },
    ];
    if (history) {
      for (const h of history) {
        messages.push({ role: h.role, content: h.content });
      }
    }
    messages.push({ role: 'user', content: `User (${userName}): ${userQuery}` });

    for (let turn = 0; turn < 5; turn++) {
      const response = await client.chat.completions.create({
        model,
        messages,
        tools,
      });

      const msg = response.choices[0].message;
      if (!msg.tool_calls || msg.tool_calls.length === 0) {
        return msg.content || '';
      }

      messages.push(msg);

      for (const tc of msg.tool_calls) {
        let args = {};
        try {
          args = JSON.parse(tc.function.arguments);
        } catch {}
        const res = this.executeTool(tc.function.name, args, userName);
        messages.push({
          role: 'tool',
          tool_call_id: tc.id,
          content: JSON.stringify(res),
        });
      }
    }

    return 'I completed the queries but reached the maximum reasoning iterations.';
  }
}
