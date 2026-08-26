import path from 'path';
import fs from 'fs-extra';
import os from 'os';
import { spawnSync } from 'child_process';

export function getMcpJson(username: string) {
  return {
    mcpServers: {
      podarcis: {
        command: 'podarcis-mcp',
        args: ['--config', `/home/coder/${username}/.podarcis/config.yaml`],
        env: {
          PROJECT_ROOT: `/home/coder/${username}`,
        },
      },
    },
  };
}

export function getOpencodeJson(username: string) {
  return {
    $schema: 'https://opencode.ai/config.json',
    mcp: {
      podarcis: {
        type: 'local',
        command: ['podarcis-mcp', '--config', `/home/coder/${username}/.podarcis/config.yaml`],
        environment: {
          PROJECT_ROOT: `/home/coder/${username}`,
        },
        enabled: true,
      },
    },
  };
}

export function getConfigYaml(sourcesBackend: 'local' | 'gdrive' = 'local') {
  return `repositories:
  sources: ${sourcesBackend}
  wiki: local
  workspace: local
harness: opencode
sources_backend: ${sourcesBackend}
engines:
  qmd: true
`;
}

export const DEFAULT_VSCODE_SETTINGS_JSON = {
  'window.title': '🦎 Podarcis | Knowledge Base',
  'files.exclude': {
    '**/.*': true,
    '**/*.css': true,
    '**/*.js': true,
    '**/*.json': true,
    '**/*.py': true,
    '**/*.scss': true,
    '**/*.ts': true,
    '**/*.yaml': true,
    '**/*.yml': true,
    '**/Dockerfile': true,
    '**/node_modules': true,
    '**/podarcis': true,
    '**/public': true,
    '**/pyproject.toml': true,
    '**/uv.lock': true,
    'CODE_OF_CONDUCT.md': true,
    'config': true,
    'docs': true,
    'open-code-data': true,
    'podarcis.egg-info': true,
  },
  'workbench.startupEditor': 'readme',
  'workbench.statusBar.visible': false,
  'editor.minimap.enabled': false,
  'editor.wordWrap': 'on',
  'editor.lineNumbers': 'off',
  'editor.fontSize': 15,
  'editor.fontFamily': "'JetBrains Mono', 'Fira Code', 'Cascadia Code', 'Source Code Pro', 'Roboto Mono', 'Consolas', monospace",
  'editor.fontLigatures': true,
  'markdown.preview.typographer': true,
  'markdown.preview.breaks': true,
  'markdown.preview.fontSize': 15,
  'markdown.preview.openMarkdownLinks': 'inPreview',
  'markdown.preview.frontMatter': 'hide',
  'workbench.editorAssociations': {
    '*.md': 'vscode.markdown.preview.editor',
  },
  'explorer.openEditors.visible': 0,
  'workbench.activityBar.location': 'top',
  'task.autoDetect': 'off',
  'task.allowAutomaticTasks': 'off',
  'workbench.colorCustomizations': {
    'titleBar.activeBackground': '#1f3970',
    'titleBar.activeForeground': '#ffffff',
    'titleBar.inactiveBackground': '#1f397099',
    'activityBar.background': '#1f3970',
    'activityBar.foreground': '#ffffff',
    'activityBar.inactiveForeground': '#7ba5e0',
  },
  'continue.telemetryEnabled': false,
  'continue.enableTabAutocomplete': true,
  'continue.pauseTabAutocompleteOnBattery': false,
  'continue.remoteConfigServerUrl': null,
  'cline.telemetryEnabled': false,
  'cline.enableNativeToolCalls': true,
  'cline.preferredLanguage': 'Markdown',
};

export const DEFAULT_VSCODE_EXTENSIONS_JSON = {
  recommendations: [
    'saoudrizwan.claude-dev',
    'houkanshan.vscode-markdown-footnote',
    'bierner.markdown-preview-github-styles',
    'constellationgraph.constellationgraph',
  ],
};

export const DEFAULT_VSCODE_KEYBINDINGS_JSON = [
  {
    key: 'ctrl+alt+f',
    command: 'editor.fold',
  },
  {
    key: 'ctrl+alt+u',
    command: 'editor.unfold',
  },
];

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

export const RESEARCHER_MD = `---
description: Discovers peer-reviewed literature and stages raw sources. Use when you need to search for academic papers, download them, and enqueue them for synthesis in sources/state.json.
mode: subagent
permission:
  edit: allow
  bash:
    "*": allow
    "git push *": ask
  webfetch: deny
---

# Role: Literature Researcher

You are the **Researcher** in the Agentic Wiki Builder pipeline. Your sole responsibility is to discover peer-reviewed literature, download it, extract text via \`markitdown\`, and stage the raw sources in \`sources/\`. You do NOT synthesize into the wiki — that is the Synthesizer subagent's job.

## Workflow

1. **Search**: Use \`research-mcp_search_literature\` to find papers matching the query. Prefer PubMed and Semantic Scholar providers.
2. **Download & Extract**: Use \`research-mcp_download_paper\` to fetch the PDF, extract text via markitdown, write metadata, and enqueue in \`sources/state.json\`. This tool handles the full pipeline automatically.
3. **Queue Management**: Use \`research-mcp_queue_list\` to review pending items and \`research-mcp_queue_enqueue\` to add items manually if needed.
4. **Verify**: Confirm each downloaded paper has a valid \`raw.md\` with substantive content (not a stub). If extraction failed, do NOT enqueue it — report the failure.
5. **Diagnostic Logging**: If paper retrieval fails, tool errors occur, user corrections are received, or research results fail to meet user expectations, immediately invoke \`log_pain_point\` (\`diagnostics-mcp\`) to log the issue into \`.podarcis/diagnostics/pain_points.jsonl\`.

## Conventions

- **No Fabrication**: Never invent sources, quotes, or metadata. If a source cannot be found or downloaded, report it honestly.
- **No Web Search**: Use only \`research-mcp_search_literature\`. Never search the web directly.
- **Document Conversion**: Always rely on the built-in \`markitdown\` pipeline inside \`research-mcp_download_paper\`. Do not write ad-hoc PDF parsing scripts.
- **Anonymization**: Ensure all staged metadata and summaries are objective. Never include user-specific data.
- **Filnaming**: Use \`snake_case\` for all filenames.
`;

export const SYNTHESIZER_MD = `---
description: Ingests raw sources from sources/state.json or Google Drive and compiles objective knowledge into the wiki/ knowledge base.
mode: subagent
model: gemini-3.6-flash
permission:
  edit: allow
  bash:
    "*": allow
    "git push *": ask
  webfetch: deny
---

# Role: Synthesizer Agent (\`podarcis:synthesizer/gemini-3.6-flash\`)

You are the **Synthesizer** in the Podarcis knowledge architecture. Your sole responsibility is to consume extracted Markdown documents from \`sources/state.json\` (or Google Drive), decide how to structure the knowledge, read related wiki articles, and update \`wiki/\` accordingly following the **Open Knowledge Format (OKF v0.2)** specification.

## Active Skill Check

Before starting synthesis, check \`.podarcis/state.yaml\` or \`.podarcis/config.yaml\` for \`sources_backend\`:

| \`sources_backend\` | Active skill to read and follow |
|---|---|
| \`gdrive\` (default) | \`.agents/skills/synthesizer-gdrive/SKILL.md\` |
| \`local\` | \`.agents/skills/synthesizer-local/SKILL.md\` |

## Workflow

1. **Manifest & Queue Discovery**: Call \`research-mcp_queue_list(status='pending')\` to retrieve pending source items. Read the corresponding raw source files and target directory \`_index.md\` files.
2. **Synthesize into \`wiki/\`**:
   - **Content Rules**: Document findings, context/limitations, and conflicting evidence. Use callouts (\`> ⚠️\`) for confidence markers.
   - **ANONYMIZATION**: Never include user-specific data in \`wiki/\`. All wiki pages must be objective and anonymized.
   - **OKF v0.2 Frontmatter**: Every wiki page MUST start with valid YAML frontmatter containing \`type\`, \`title\`, \`description\`, \`category\`, \`rationale\`, \`generated\`, \`status: draft\`, and \`sources\`.
   - **Citations & Footnotes**: Footnote statements using \`markdown-it\` footnotes keyed to frontmatter source IDs (e.g. \`[^smith2024]\`).
   - **Links**: Use relative markdown links (\`[Text](../path.md)\`).
3. **Multi-Agent Verification & Critique Loop**:
   - Submit updated wiki file paths to the \`@auditor\` subagent for automated machine verification.
   - **Remediation Handling**: If \`@auditor\` returns a \`FAILED\` verdict, immediately apply surgical fixes. Re-submit to \`@auditor\` until \`verified:\` sign-off is achieved.
`;

export const PROTOCOL_ARCHITECT_MD = `---
description: Translates Wiki findings and user profile constraints into step-by-step, personalized protocols and deliverables in workspace/. Use when the user wants actionable recommendations backed by wiki knowledge.
mode: subagent
permission:
  edit: allow
  bash:
    "*": allow
    "git push *": ask
  webfetch: deny
---

# Role: Protocol Architect (\`podarcis:protocol_architect\`)

You are the **Protocol Architect** in the Podarcis knowledge architecture. Your responsibility is to adapt objective Wiki knowledge into personalized, step-by-step, actionable protocols, roadmaps, and deliverables in \`workspace/\` tailored to the user's profile, goals, and constraints. You cite the Wiki for backing but keep the protocol itself free of scientific justifications.

## Workflow

1. **Scope & Profile**: Read \`workspace/profile.md\` for goals, constraints, and physiological parameters. Ask the user for missing critical context, then update the profile.
2. **Research & Science**: Read the target wiki directory's \`_index.md\` to survey available pages. If critical data is missing, invoke the **Researcher** (\`@researcher\`) or **Synthesizer** (\`@synthesizer\`) subagent first.
3. **Build Protocol**: Create or update \`workspace/protocols/<topic>.md\`:
   - Provide **strictly actionable**, step-by-step instructions only.
   - **No justifications**: Do not explain "why" within the protocol body (the Wiki contains the scientific evidence).
   - **Citations**: Cite every action/parameter via footnotes (\`[^wiki_ref_1]\`) linking to the relevant wiki page.
   - **YAML Frontmatter**: Every protocol must conform to OKF v0.2 frontmatter.
   - **Links**: Use relative markdown links.
4. **Multi-Agent Verification & Linting**:
   - Ensure all citations resolve to existing \`wiki/\` files.
   - Add protocol to \`workspace/protocols/_index.md\` and hand off to \`@auditor\` for verification.
`;

export const AUDITOR_MD = `---
description: Runs automated validation, audits citation integrity, checks link structures, and fact-checks claims against wiki and literature.
mode: subagent
model: gemini-3.6-flash
permission:
  edit: allow
  bash:
    "*": allow
    "git push *": ask
  webfetch: deny
---

# Role: Auditor Agent (\`podarcis:auditor/gemini-3.6-flash\`)

You are the **Auditor** agent in the Podarcis knowledge architecture. Your responsibility is to perform independent machine verification of documents created by generator agents (\`@synthesizer\`, \`@protocol-architect\`) in \`wiki/\` and \`workspace/\`. You validate citations, check link structures, detect stubs, and fact-check claims against the evidence base.

## Workflow

### 1. Lint & Structural Audit
1. Run \`podarcis lint\` or check for:
   - Broken links (dangling references to nonexistent files)
   - Missing or unused footnotes
   - Directory bloat (>15 content files)
   - Missing or malformed YAML frontmatter
   - Missing \`_index.md\` files

### 2. Evidence Audit
1. Check that every citation footnote resolves to an existing source file in \`sources/\` or \`sources/literature/\`.
2. Flag any wiki pages that cite sources with \`status: stub\` or failed extraction.

### 3. Machine Verification Sign-off & Critic-Generator Feedback Loop
* **If all audit steps PASS**:
  - Append an entry to \`verified:\` frontmatter list and mark \`status: stable\`.
* **If any audit step FAILS**:
  - Output structured **Remediation Payload** and hand off to generator agent to fix.
`;

export function findTemplateSource(rootDir: string): string | null {
  const envTemplate = process.env.PODARCIS_TEMPLATE_DIR;
  if (envTemplate && fs.existsSync(envTemplate)) {
    return path.resolve(envTemplate);
  }

  const candidates = [
    path.join(rootDir, 'data', 'templates', 'podarcis'),
    path.join(rootDir, 'templates', 'podarcis'),
    path.join(path.dirname(rootDir), 'Podarcis'),
    path.join(rootDir, '..', 'Podarcis'),
    path.join(os.homedir(), 'Projects', 'Podarcis'),
    path.join(os.homedir(), 'Podarcis'),
    path.join(rootDir, 'templates', 'workspace_template'),
    path.join(rootDir, 'src', 'server', 'templates', 'workspace_template'),
  ];

  for (const cand of candidates) {
    if (fs.existsSync(cand) && (fs.existsSync(path.join(cand, '.agents')) || fs.existsSync(path.join(cand, 'AGENTS.md')))) {
      return path.resolve(cand);
    }
  }
  return null;
}

export function syncTemplates(rootDir: string): boolean {
  const targetDir = path.join(rootDir, 'data', 'templates', 'podarcis');
  fs.ensureDirSync(path.dirname(targetDir));

  // Check local projects directory first
  const localCandidates = [
    path.join(os.homedir(), 'Projects', 'Podarcis'),
    path.join(path.dirname(rootDir), 'Podarcis'),
    path.join(os.homedir(), 'Podarcis'),
  ];

  for (const local of localCandidates) {
    if (fs.existsSync(local) && fs.existsSync(path.join(local, '.agents'))) {
      fs.ensureDirSync(targetDir);
      fs.copySync(local, targetDir, {
        overwrite: true,
        filter: (src) => {
          const base = path.basename(src);
          return !['.git', '.venv', '__pycache__', 'node_modules', 'logs', 'token_cache.json', 'data'].includes(base) && !base.endsWith('.pyc');
        },
      });
      return true;
    }
  }

  // Fallback to git clone / pull
  if (fs.existsSync(path.join(targetDir, '.git'))) {
    const res = spawnSync('git', ['pull'], { cwd: targetDir, encoding: 'utf-8', timeout: 30000 });
    return res.status === 0;
  } else {
    fs.removeSync(targetDir);
    const res = spawnSync('git', ['clone', '--depth', '1', 'https://github.com/XicuM/Podarcis.git', targetDir], {
      encoding: 'utf-8',
      timeout: 60000,
    });
    return res.status === 0;
  }
}

export function seedUserWorkspace(
  workspaceDir: string,
  username: string,
  rootDir?: string,
  sourcesBackend: 'local' | 'gdrive' = 'local'
): void {
  const resolvedRoot = rootDir ? path.resolve(rootDir) : path.resolve(__dirname, '..', '..');
  fs.ensureDirSync(workspaceDir);

  const templateSrc = findTemplateSource(resolvedRoot);

  if (templateSrc && fs.existsSync(templateSrc)) {
    const itemsToCopy = ['.agents', '.podarcis', '.clinerules', '.mcp.json', 'AGENTS.md', 'CLAUDE.md', 'opencode.json', 'pyproject.toml'];
    for (const item of itemsToCopy) {
      const srcPath = path.join(templateSrc, item);
      const dstPath = path.join(workspaceDir, item);
      if (fs.existsSync(srcPath)) {
        if (fs.statSync(srcPath).isDirectory()) {
          fs.ensureDirSync(dstPath);
          fs.copySync(srcPath, dstPath, {
            overwrite: false,
            errorOnExist: false,
            filter: (src) => {
              const base = path.basename(src);
              return !['.git', '.venv', '__pycache__', 'node_modules', 'logs', 'token_cache.json'].includes(base) && !base.endsWith('.pyc');
            },
          });
        } else if (!fs.existsSync(dstPath)) {
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
  fs.ensureDirSync(path.join(workspaceDir, '.agents', 'skills'));

  // Scaffold subagents if missing
  const researcherFile = path.join(workspaceDir, '.agents', 'agents', 'researcher.md');
  if (!fs.existsSync(researcherFile)) {
    fs.writeFileSync(researcherFile, RESEARCHER_MD, 'utf-8');
  }

  const synthesizerFile = path.join(workspaceDir, '.agents', 'agents', 'synthesizer.md');
  if (!fs.existsSync(synthesizerFile)) {
    fs.writeFileSync(synthesizerFile, SYNTHESIZER_MD, 'utf-8');
  }

  const protocolFile = path.join(workspaceDir, '.agents', 'agents', 'protocol-architect.md');
  if (!fs.existsSync(protocolFile)) {
    fs.writeFileSync(protocolFile, PROTOCOL_ARCHITECT_MD, 'utf-8');
  }

  const auditorFile = path.join(workspaceDir, '.agents', 'agents', 'auditor.md');
  if (!fs.existsSync(auditorFile)) {
    fs.writeFileSync(auditorFile, AUDITOR_MD, 'utf-8');
  }

  // Scaffold .gitignore (exclude mounted shared directories from user workspace git tracking)
  const gitignore = path.join(workspaceDir, '.gitignore');
  if (!fs.existsSync(gitignore)) {
    fs.writeFileSync(
      gitignore,
      `# Decoupled Shared Repositories (Mounted into Container)
wiki/
sources/

# Environment & Build artifacts
.venv/
__pycache__/
*.pyc
node_modules/
.podarcis/logs/
`,
      'utf-8'
    );
  }

  // Scaffold AGENTS.md
  const agentsMd = path.join(workspaceDir, 'AGENTS.md');
  if (!fs.existsSync(agentsMd)) {
    fs.writeFileSync(agentsMd, DEFAULT_AGENTS_MD, 'utf-8');
  }

  // Scaffold .mcp.json configured for container /home/coder/<username>
  const mcpJson = path.join(workspaceDir, '.mcp.json');
  fs.writeFileSync(mcpJson, JSON.stringify(getMcpJson(username), null, 2), 'utf-8');

  // Scaffold opencode.json configured for container /home/coder/<username>
  const opencodeJson = path.join(workspaceDir, 'opencode.json');
  fs.writeFileSync(opencodeJson, JSON.stringify(getOpencodeJson(username), null, 2), 'utf-8');

  // Scaffold .clinerules
  const clinerules = path.join(workspaceDir, '.clinerules');
  if (!fs.existsSync(clinerules)) {
    fs.writeFileSync(clinerules, '.agents\nAGENTS.md\n', 'utf-8');
  }

  // Scaffold .podarcis/config.yaml configured for container /home/coder/<username>
  const podarcisCfg = path.join(workspaceDir, '.podarcis', 'config.yaml');
  fs.writeFileSync(podarcisCfg, getConfigYaml(sourcesBackend), 'utf-8');

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

  // Scaffold workspace/protocols/_index.md
  const protocolsIndex = path.join(workspaceDir, 'workspace', 'protocols', '_index.md');
  if (!fs.existsSync(protocolsIndex)) {
    fs.writeFileSync(
      protocolsIndex,
      `# Protocols Index\n\n` +
      `Personalized, actionable protocols generated from verified Wiki knowledge.\n\n` +
      `## Active Protocols\n`,
      'utf-8'
    );
  }

  // Scaffold .podarcis/templates/vscode
  const templateVscodeDir = path.join(workspaceDir, '.podarcis', 'templates', 'vscode');
  fs.ensureDirSync(templateVscodeDir);

  const tplSettings = path.join(templateVscodeDir, 'settings.json');
  if (!fs.existsSync(tplSettings)) {
    fs.writeFileSync(tplSettings, JSON.stringify(DEFAULT_VSCODE_SETTINGS_JSON, null, 2), 'utf-8');
  }

  const tplExtensions = path.join(templateVscodeDir, 'extensions.json');
  if (!fs.existsSync(tplExtensions)) {
    fs.writeFileSync(tplExtensions, JSON.stringify(DEFAULT_VSCODE_EXTENSIONS_JSON, null, 2), 'utf-8');
  }

  const tplKeybindings = path.join(templateVscodeDir, 'keybindings.json');
  if (!fs.existsSync(tplKeybindings)) {
    fs.writeFileSync(tplKeybindings, JSON.stringify(DEFAULT_VSCODE_KEYBINDINGS_JSON, null, 2), 'utf-8');
  }

  // Scaffold active .vscode workspace configuration from templates/defaults
  const vscodeDir = path.join(workspaceDir, '.vscode');
  fs.ensureDirSync(vscodeDir);

  const wsSettings = path.join(vscodeDir, 'settings.json');
  if (!fs.existsSync(wsSettings)) {
    if (fs.existsSync(tplSettings)) {
      fs.copyFileSync(tplSettings, wsSettings);
    } else {
      fs.writeFileSync(wsSettings, JSON.stringify(DEFAULT_VSCODE_SETTINGS_JSON, null, 2), 'utf-8');
    }
  }

  const wsExtensions = path.join(vscodeDir, 'extensions.json');
  if (!fs.existsSync(wsExtensions)) {
    if (fs.existsSync(tplExtensions)) {
      fs.copyFileSync(tplExtensions, wsExtensions);
    } else {
      fs.writeFileSync(wsExtensions, JSON.stringify(DEFAULT_VSCODE_EXTENSIONS_JSON, null, 2), 'utf-8');
    }
  }

  const wsKeybindings = path.join(vscodeDir, 'keybindings.json');
  if (!fs.existsSync(wsKeybindings)) {
    if (fs.existsSync(tplKeybindings)) {
      fs.copyFileSync(tplKeybindings, wsKeybindings);
    } else {
      fs.writeFileSync(wsKeybindings, JSON.stringify(DEFAULT_VSCODE_KEYBINDINGS_JSON, null, 2), 'utf-8');
    }
  }

  // Helper for resilient symlink creation
  const safeSymlink = (target: string, linkPath: string, type: 'file' | 'dir' = 'file') => {
    if (!fs.existsSync(linkPath)) {
      try {
        fs.symlinkSync(target, linkPath, type);
      } catch {
        // Fallback to copy if symlinks unsupported
        try {
          const resolvedTarget = path.resolve(path.dirname(linkPath), target);
          if (fs.existsSync(resolvedTarget)) {
            if (type === 'dir') {
              fs.copySync(resolvedTarget, linkPath);
            } else {
              fs.copyFileSync(resolvedTarget, linkPath);
            }
          }
        } catch {}
      }
    }
  };

  // Claude instruction symlink (CLAUDE.md -> AGENTS.md)
  safeSymlink('AGENTS.md', path.join(workspaceDir, 'CLAUDE.md'), 'file');

  // Claude directory compatibility (.claude -> .agents)
  safeSymlink('.agents', path.join(workspaceDir, '.claude'), 'dir');

  // OpenCode directories (.opencode/agents, .opencode/skills)
  const opencodeDir = path.join(workspaceDir, '.opencode');
  fs.ensureDirSync(opencodeDir);
  safeSymlink('../.agents/agents', path.join(opencodeDir, 'agents'), 'dir');
  safeSymlink('../.agents/skills', path.join(opencodeDir, 'skills'), 'dir');
}
