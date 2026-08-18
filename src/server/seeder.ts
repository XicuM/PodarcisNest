import path from 'path';
import fs from 'fs-extra';

export const DEFAULT_MCP_JSON = {
  mcpServers: {
    podarcis: {
      command: 'podarcis-mcp',
      args: ['--config', '/home/coder/workspace/.podarcis/config.yaml'],
      env: {
        PROJECT_ROOT: '/home/coder/workspace',
      },
    },
  },
};

export const DEFAULT_OPENCODE_JSON = {
  $schema: 'https://opencode.ai/config.json',
  mcp: {
    podarcis: {
      type: 'local',
      command: ['podarcis-mcp', '--config', '/home/coder/workspace/.podarcis/config.yaml'],
      environment: {
        PROJECT_ROOT: '/home/coder/workspace',
      },
      enabled: true,
    },
  },
};

export const DEFAULT_CONFIG_YAML = `repositories:
  sources: local
  wiki: local
  workspace: local
backend: opencode
sources_backend: local
engines:
  qmd: true
`;

export const DEFAULT_AGENTS_MD = `# Podarcis — The Research Agent with Memory

You are Podarcis, a research agent designed around a **filesystem-driven, evidence-based agent architecture** conforming to the **Open Knowledge Format (OKF v0.2)** specification, **Markdown multi-agent standards**, and a **multi-user containerized server architecture**.

---

## 1. Subagent Workflow & Personas

Subagent personas are defined in \`.agents/agents/*.md\` (with a relative symlink \`.opencode/agents -> ../.agents/agents\`). Each subagent has a dedicated system prompt, tool permissions, and a description that tells the primary agent when to invoke it automatically via the Task tool.

### Invocation

- **Automatic**: The primary agent (Build or Plan) reads each subagent's \`description\` frontmatter and invokes the appropriate subagent via the Task tool when its expertise is needed.
- **Manual**: You can invoke any subagent directly by \`@ mentioning\` it (e.g., \`@researcher find papers on creatine metabolism\`).
- **Pipeline**: Subagents can delegate to each other — e.g., the Protocol Architect can invoke the Researcher when wiki data is missing.

### Core Agent Personas

| Subagent | File Path | Actor String & Description |
|---|---|---|
| **Researcher** | [.agents/agents/researcher.md](.agents/agents/researcher.md) | \`podarcis:researcher\`: Discovers peer-reviewed literature via \`research-mcp\` (Semantic Scholar), scrapes Google Drive documents, downloads PDFs, and stages raw sources in \`sources/\` + \`sources/state.json\`. |
| **Synthesizer** | [.agents/agents/synthesizer.md](.agents/agents/synthesizer.md) | \`podarcis:synthesizer\`: Reads pending items from \`sources/state.json\` (or GDrive/local sources), ingests raw sources, and compiles objective, anonymized OKF concept notes into \`wiki/\`. |
| **Protocol Architect** | [.agents/agents/protocol-architect.md](.agents/agents/protocol-architect.md) | \`podarcis:protocol_architect\`: Reads user profile constraints (\`workspace/profile.md\`), translates Wiki findings into step-by-step personalized protocols, menu plans (via \`menumaker\`), and deliverables. |
| **Auditor** | [.agents/agents/auditor.md](.agents/agents/auditor.md) | \`podarcis:auditor\`: Runs automated link linting (\`podarcis lint\`), audits OKF frontmatter schema, verifies citation integrity, and fact-checks claims against wiki and literature. |

### Domain Knowledge Skills

Skills (\`.agents/skills/\`) inject specialized domain knowledge on-demand:
- **menumaker**: Nutritional reasoning, USDA food data, and menu optimization heuristics.
- **harness**: Runtime state, context compaction, and permission gating utilities.
- **zoom2okf-mcp**: Video processing to markdown OKF notes.
- **self-improvement**: Diagnostic session analysis and platform pain-point resolution.

---

## 2. Filesystem-Driven Handoff Model & Decoupled Repositories

The coordination is asynchronous, mediated by the file structure:

* **Staging (\`sources/\`)**: Decoupled repository for raw evidence and \`sources/state.json\` orchestration queue.
* **Wiki (\`wiki/\` repository)**: Objective, anonymized knowledge base written in OKF v0.2 format.
* **Workspace (\`workspace/\` repository)**: Personal profiles, active protocols, feedback, and deliverables.
* **Podarcis Engine (\`.podarcis/\` & \`podarcis\` CLI)**: Unified CLI and runtime engine for status inspection (\`podarcis status\`), configuration (\`podarcis config\`), testing (\`podarcis test\`), and link linting (\`podarcis lint\`).

---

## 3. Strict Conventions & Rules of Engagement

### Hierarchy of Evidence & Citation
* **Strict Citation Chain**: Workspace files and protocols (\`workspace/\`) MUST cite the Wiki (\`wiki/\`); the Wiki (\`wiki/\`) MUST cite Sources (\`sources/\`). Under no circumstances should \`workspace/\` files bypass \`wiki/\` to cite \`sources/\` directly.
* **OKF Frontmatter**: Every non-index markdown file in \`wiki/\` and \`workspace/\` must begin with standardized YAML frontmatter containing \`type\`, \`title\`, \`category\`, \`rationale\`, \`generated\`, and \`sources\` (or \`related\`).
* **Cross-References**: Use relative markdown links (\`[Text](../path.md)\`). Unlinked mentions or \`[[wikilinks]]\` are forbidden.
`;

export function findTemplateSource(rootDir: string): string | null {
  const envTemplate = process.env.PODARCIS_TEMPLATE_DIR;
  if (envTemplate && fs.existsSync(envTemplate)) {
    return path.resolve(envTemplate);
  }

  const candidates = [
    path.join(rootDir, 'data', 'templates', 'podarcis'),
    path.join(path.dirname(rootDir), 'Podarcis'),
    path.join(rootDir, 'templates', 'workspace_template'),
    path.join(rootDir, 'src', 'server', 'templates', 'workspace_template'),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand) && fs.existsSync(path.join(cand, '.agents'))) {
      return cand;
    }
  }
  return null;
}

export function seedUserWorkspace(workspaceDir: string, username: string, rootDir?: string): void {
  const resolvedRoot = rootDir ? path.resolve(rootDir) : path.resolve(__dirname, '..', '..');
  fs.ensureDirSync(workspaceDir);

  const templateSrc = findTemplateSource(resolvedRoot);

  if (templateSrc && fs.existsSync(templateSrc)) {
    const itemsToCopy = ['.agents', '.podarcis', '.clinerules', '.mcp.json', 'AGENTS.md', 'opencode.json'];
    for (const item of itemsToCopy) {
      const srcPath = path.join(templateSrc, item);
      const dstPath = path.join(workspaceDir, item);
      if (fs.existsSync(srcPath) && !fs.existsSync(dstPath)) {
        if (fs.statSync(srcPath).isDirectory()) {
          fs.copySync(srcPath, dstPath, {
            filter: (src) => {
              const base = path.basename(src);
              return !['.git', '.venv', '__pycache__', 'node_modules', 'logs', 'token_cache.json'].includes(base) && !base.endsWith('.pyc');
            },
          });
        } else {
          fs.copyFileSync(srcPath, dstPath);
        }
      }
    }
  }

  // Ensure base directories exist
  fs.ensureDirSync(path.join(workspaceDir, 'wiki'));
  fs.ensureDirSync(path.join(workspaceDir, 'sources', 'literature'));
  fs.ensureDirSync(path.join(workspaceDir, 'workspace', 'protocols'));
  fs.ensureDirSync(path.join(workspaceDir, 'workspace', 'profile'));
  fs.ensureDirSync(path.join(workspaceDir, '.podarcis', 'logs'));
  fs.ensureDirSync(path.join(workspaceDir, '.agents', 'agents'));

  // Scaffold AGENTS.md
  const agentsMd = path.join(workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMd)) {
    fs.writeFileSync(agentsMd, DEFAULT_AGENTS_MD, 'utf-8');
  }

  // Scaffold .mcp.json
  const mcpJson = path.join(workspaceDir, '.mcp.json');
  if (!fs.existsSync(mcpJson)) {
    fs.writeFileSync(mcpJson, JSON.stringify(DEFAULT_MCP_JSON, null, 2), 'utf-8');
  }

  // Scaffold opencode.json
  const opencodeJson = path.join(workspaceDir, 'opencode.json');
  if (!fs.existsSync(opencodeJson)) {
    fs.writeFileSync(opencodeJson, JSON.stringify(DEFAULT_OPENCODE_JSON, null, 2), 'utf-8');
  }

  // Scaffold .clinerules
  const clinerules = path.join(workspaceDir, '.clinerules');
  if (!fs.existsSync(clinerules)) {
    fs.writeFileSync(clinerules, '.agents\nAGENTS.md\n', 'utf-8');
  }

  // Scaffold .podarcis/config.yaml
  const podarcisCfg = path.join(workspaceDir, '.podarcis', 'config.yaml');
  if (!fs.existsSync(podarcisCfg)) {
    fs.writeFileSync(podarcisCfg, DEFAULT_CONFIG_YAML, 'utf-8');
  }

  // Scaffold wiki/_index.md
  const wikiIndex = path.join(workspaceDir, 'wiki', '_index.md');
  if (!fs.existsSync(wikiIndex)) {
    const capitalized = username.charAt(0).toUpperCase() + username.slice(1);
    fs.writeFileSync(
      wikiIndex,
      `# ${capitalized}'s Podarcis Knowledge Wiki\n\n` +
      `Welcome to your personal Open Knowledge Format (OKF v0.2) research wiki.\n\n` +
      `## Structure\n` +
      `- Concepts: Core scientific & domain notes\n` +
      `- Entities: Anonymized objective entity records\n\n` +
      `This wiki is autonomously indexed and maintained by the \`@synthesizer\` and \`@auditor\` subagents.\n`,
      'utf-8'
    );
  }

  // Scaffold sources/state.json
  const sourcesState = path.join(workspaceDir, 'sources', 'state.json');
  if (!fs.existsSync(sourcesState)) {
    fs.writeFileSync(sourcesState, JSON.stringify({ queue: [], ingested: [] }, null, 2), 'utf-8');
  }

  // Scaffold workspace/profile/profile.md
  const profileMd = path.join(workspaceDir, 'workspace', 'profile', 'profile.md');
  if (!fs.existsSync(profileMd)) {
    fs.writeFileSync(
      profileMd,
      `---\n` +
      `type: profile\n` +
      `title: User Profile - ${username}\n` +
      `category: profile\n` +
      `rationale: Research profile constraints for personalized protocol synthesis\n` +
      `generated: false\n` +
      `---\n\n` +
      `# Researcher Profile: ${username}\n\n` +
      `## Goals\n` +
      `- Primary Focus: Domain research & knowledge synthesis\n\n` +
      `## Constraints\n` +
      `- Evidence Standard: Peer-reviewed literature (OKF v0.2 hierarchy)\n`,
      'utf-8'
    );
  }

  // Symlink .opencode/agents
  const opencodeDir = path.join(workspaceDir, '.opencode');
  fs.ensureDirSync(opencodeDir);
  const opencodeAgentsLink = path.join(opencodeDir, 'agents');
  const targetAgentsDir = path.join(workspaceDir, '.agents', 'agents');
  if (!fs.existsSync(opencodeAgentsLink) && fs.existsSync(targetAgentsDir)) {
    try {
      fs.symlinkSync('../.agents/agents', opencodeAgentsLink, 'dir');
    } catch {
      // Ignore symlink errors
    }
  }
}
