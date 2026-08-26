import fs from 'fs-extra';
import path from 'path';
import { spawnSync } from 'child_process';

export interface ContainerResourcesConfig {
  memory_limit: string;
  cpus_limit: string;
  pids_limit: number;
}

export interface ClineApiConfig {
  api_provider: 'openai-compatible' | 'openai' | 'anthropic' | 'openrouter' | 'custom' | string;
  base_url: string;
  api_key: string;
  model_id: string;
}

export interface GlobalPodarcisConfig {
  repositories: {
    wiki: string;
    sources: string;
    workspace: string;
  };
  harness: 'none' | 'opencode' | 'claude' | 'agy' | string;
  sources_backend: 'local' | 'gdrive' | string;
  engines: {
    qmd: boolean;
    [key: string]: any;
  };
  resources?: ContainerResourcesConfig;
  cline?: ClineApiConfig;
}

export interface SharedRepoInfo {
  id: 'wiki' | 'sources';
  name: string;
  dir: string;
  exists: boolean;
  isGitRepo: boolean;
  branch: string | null;
  remoteUrl: string | null;
  commitHash: string | null;
  commitMessage: string | null;
  isDirty: boolean;
  availableBranches: string[];
}

export class RepoManager {
  private rootDir: string;
  private configFile: string;
  public sharedWikiDir: string;
  public sharedSourcesDir: string;

  constructor(rootDir: string) {
    this.rootDir = path.resolve(rootDir);
    this.configFile = path.join(this.rootDir, 'data', 'config.json');
    this.sharedWikiDir = path.join(this.rootDir, 'data', 'shared', 'wiki');
    this.sharedSourcesDir = path.join(this.rootDir, 'data', 'shared', 'sources');

    fs.ensureDirSync(this.sharedWikiDir);
    fs.ensureDirSync(this.sharedSourcesDir);
    this.initConfigFile();
  }

  private initConfigFile(): void {
    if (!fs.existsSync(this.configFile)) {
      const defaultConfig: GlobalPodarcisConfig = {
        repositories: {
          wiki: 'local',
          sources: 'local',
          workspace: 'local',
        },
        harness: 'opencode',
        sources_backend: 'local',
        engines: {
          qmd: true,
        },
        resources: {
          memory_limit: '4g',
          cpus_limit: '2.0',
          pids_limit: 256,
        },
        cline: {
          api_provider: 'openai-compatible',
          base_url: '',
          api_key: '',
          model_id: '',
        },
      };
      fs.writeFileSync(this.configFile, JSON.stringify(defaultConfig, null, 2), 'utf-8');
    }
  }

  public getGlobalConfig(): GlobalPodarcisConfig {
    try {
      if (fs.existsSync(this.configFile)) {
        const raw = fs.readJsonSync(this.configFile);
        return {
          repositories: {
            wiki: raw.repositories?.wiki || 'local',
            sources: raw.repositories?.sources || 'local',
            workspace: raw.repositories?.workspace || 'local',
          },
          harness: raw.harness || raw.backend || 'opencode',
          sources_backend: raw.sources_backend || 'local',
          engines: {
            qmd: raw.engines?.qmd !== false,
          },
          resources: {
            memory_limit: raw.resources?.memory_limit || '4g',
            cpus_limit: raw.resources?.cpus_limit || '2.0',
            pids_limit: raw.resources?.pids_limit || 256,
          },
          cline: {
            api_provider: raw.cline?.api_provider || 'openai-compatible',
            base_url: raw.cline?.base_url || '',
            api_key: raw.cline?.api_key || '',
            model_id: raw.cline?.model_id || '',
          },
        };
      }
    } catch {}
    return {
      repositories: {
        wiki: 'local',
        sources: 'local',
        workspace: 'local',
      },
      harness: 'opencode',
      sources_backend: 'local',
      engines: {
        qmd: true,
      },
      resources: {
        memory_limit: '4g',
        cpus_limit: '2.0',
        pids_limit: 256,
      },
      cline: {
        api_provider: 'openai-compatible',
        base_url: '',
        api_key: '',
        model_id: '',
      },
    };
  }

  public saveGlobalConfig(config: Partial<GlobalPodarcisConfig>): GlobalPodarcisConfig {
    const current = this.getGlobalConfig();
    const merged: GlobalPodarcisConfig = {
      repositories: {
        ...current.repositories,
        ...(config.repositories || {}),
      },
      harness: config.harness || current.harness,
      sources_backend: config.sources_backend || current.sources_backend,
      engines: {
        ...current.engines,
        ...(config.engines || {}),
      },
      resources: {
        ...current.resources,
        ...(config.resources || {}),
      },
      cline: {
        ...current.cline,
        ...(config.cline || {}),
      },
    };

    fs.writeFileSync(this.configFile, JSON.stringify(merged, null, 2), 'utf-8');
    return merged;
  }

  private runGit(args: string[], cwd: string): { success: boolean; output: string } {
    try {
      const res = spawnSync('git', args, {
        cwd,
        encoding: 'utf-8',
        timeout: 30000,
      });
      if (res.status === 0) {
        return { success: true, output: (res.stdout || '').trim() };
      }
      return { success: false, output: (res.stderr || res.stdout || 'Git command failed').trim() };
    } catch (e: any) {
      return { success: false, output: e.message };
    }
  }

  public getRepoInfo(repoId: 'wiki' | 'sources'): SharedRepoInfo {
    const dir = repoId === 'wiki' ? this.sharedWikiDir : this.sharedSourcesDir;
    const exists = fs.existsSync(dir);
    const gitDir = path.join(dir, '.git');
    const isGitRepo = exists && fs.existsSync(gitDir);

    const info: SharedRepoInfo = {
      id: repoId,
      name: repoId === 'wiki' ? 'Shared Wiki (OKF)' : 'Shared Literature Sources',
      dir,
      exists,
      isGitRepo,
      branch: null,
      remoteUrl: null,
      commitHash: null,
      commitMessage: null,
      isDirty: false,
      availableBranches: [],
    };

    if (!isGitRepo) {
      return info;
    }

    // Branch
    const branchRes = this.runGit(['rev-parse', '--abbrev-ref', 'HEAD'], dir);
    if (branchRes.success) {
      info.branch = branchRes.output;
    }

    // Remote URL
    const remoteRes = this.runGit(['config', '--get', 'remote.origin.url'], dir);
    if (remoteRes.success) {
      info.remoteUrl = remoteRes.output;
    }

    // Latest commit
    const logRes = this.runGit(['log', '-1', '--format=%h|%s'], dir);
    if (logRes.success && logRes.output) {
      const [hash, ...msg] = logRes.output.split('|');
      info.commitHash = hash;
      info.commitMessage = msg.join('|');
    }

    // Dirty status
    const statusRes = this.runGit(['status', '--porcelain'], dir);
    if (statusRes.success) {
      info.isDirty = statusRes.output.length > 0;
    }

    // Branches list
    const branchesRes = this.runGit(['branch', '-a', '--format=%(refname:short)'], dir);
    if (branchesRes.success && branchesRes.output) {
      const branches = branchesRes.output
        .split('\n')
        .map((b) => b.trim())
        .filter((b) => b.length > 0 && !b.includes('origin/HEAD'));
      info.availableBranches = Array.from(new Set(branches));
    }

    return info;
  }

  public syncRepo(repoId: 'wiki' | 'sources', remoteUrl?: string): { success: boolean; message: string } {
    const dir = repoId === 'wiki' ? this.sharedWikiDir : this.sharedSourcesDir;
    fs.ensureDirSync(dir);
    const gitDir = path.join(dir, '.git');

    if (fs.existsSync(gitDir)) {
      if (remoteUrl) {
        this.runGit(['remote', 'set-url', 'origin', remoteUrl], dir);
      }
      const pullRes = this.runGit(['pull'], dir);
      return {
        success: pullRes.success,
        message: pullRes.output || 'Pulled repository successfully',
      };
    } else if (remoteUrl && remoteUrl.startsWith('http') || remoteUrl?.startsWith('git@')) {
      fs.emptyDirSync(dir);
      const cloneRes = this.runGit(['clone', remoteUrl, '.'], dir);
      return {
        success: cloneRes.success,
        message: cloneRes.output || 'Cloned repository successfully',
      };
    } else {
      return {
        success: true,
        message: 'Local directory is up to date (no remote git repository configured)',
      };
    }
  }

  public switchBranch(repoId: 'wiki' | 'sources', branchName: string): { success: boolean; message: string } {
    const dir = repoId === 'wiki' ? this.sharedWikiDir : this.sharedSourcesDir;
    const res = this.runGit(['checkout', branchName], dir);
    return {
      success: res.success,
      message: res.output || `Switched to branch '${branchName}'`,
    };
  }
}
