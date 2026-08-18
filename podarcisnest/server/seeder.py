"""Podarcis workspace seeder and template manager for PodarcisNest."""

import json
import os
import shutil
from pathlib import Path
from typing import Optional


DEFAULT_MCP_JSON = {
    "mcpServers": {
        "podarcis": {
            "command": "podarcis-mcp",
            "args": [
                "--config",
                "/home/coder/workspace/.podarcis/config.yaml"
            ],
            "env": {
                "PROJECT_ROOT": "/home/coder/workspace"
            }
        }
    }
}

DEFAULT_OPENCODE_JSON = {
    "$schema": "https://opencode.ai/config.json",
    "mcp": {
        "podarcis": {
            "type": "local",
            "command": [
                "podarcis-mcp",
                "--config",
                "/home/coder/workspace/.podarcis/config.yaml"
            ],
            "environment": {
                "PROJECT_ROOT": "/home/coder/workspace"
            },
            "enabled": True
        }
    }
}

DEFAULT_CONFIG_YAML = """repositories:
  sources: local
  wiki: local
  workspace: local
backend: opencode
sources_backend: local
engines:
  qmd: true
"""

DEFAULT_AGENTS_MD = """# Podarcis — The Research Agent with Memory

You are Podarcis, a research agent designed around a **filesystem-driven, evidence-based agent architecture** conforming to the **Open Knowledge Format (OKF v0.2)** specification, **Markdown multi-agent standards**, and a **multi-user containerized server architecture**.

---

## 1. Subagent Workflow & Personas

Subagent personas are defined in `.agents/agents/*.md` (with a relative symlink `.opencode/agents -> ../.agents/agents`). Each subagent has a dedicated system prompt, tool permissions, and a description that tells the primary agent when to invoke it automatically via the Task tool.

### Invocation

- **Automatic**: The primary agent (Build or Plan) reads each subagent's `description` frontmatter and invokes the appropriate subagent via the Task tool when its expertise is needed.
- **Manual**: You can invoke any subagent directly by `@ mentioning` it (e.g., `@researcher find papers on creatine metabolism`).
- **Pipeline**: Subagents can delegate to each other — e.g., the Protocol Architect can invoke the Researcher when wiki data is missing.

### Core Agent Personas

| Subagent | File Path | Actor String & Description |
|---|---|---|
| **Researcher** | [.agents/agents/researcher.md](.agents/agents/researcher.md) | `podarcis:researcher`: Discovers peer-reviewed literature via `research-mcp` (Semantic Scholar), scrapes Google Drive documents, downloads PDFs, and stages raw sources in `sources/` + `sources/state.json`. |
| **Synthesizer** | [.agents/agents/synthesizer.md](.agents/agents/synthesizer.md) | `podarcis:synthesizer`: Reads pending items from `sources/state.json` (or GDrive/local sources), ingests raw sources, and compiles objective, anonymized OKF concept notes into `wiki/`. |
| **Protocol Architect** | [.agents/agents/protocol-architect.md](.agents/agents/protocol-architect.md) | `podarcis:protocol_architect`: Reads user profile constraints (`workspace/profile.md`), translates Wiki findings into step-by-step personalized protocols, menu plans (via `menumaker`), and deliverables. |
| **Auditor** | [.agents/agents/auditor.md](.agents/agents/auditor.md) | `podarcis:auditor`: Runs automated link linting (`podarcis lint`), audits OKF frontmatter schema, verifies citation integrity, and fact-checks claims against wiki and literature. |

### Domain Knowledge Skills

Skills (`.agents/skills/`) inject specialized domain knowledge on-demand:
- **menumaker**: Nutritional reasoning, USDA food data, and menu optimization heuristics.
- **harness**: Runtime state, context compaction, and permission gating utilities.
- **zoom2okf-mcp**: Video processing to markdown OKF notes.
- **self-improvement**: Diagnostic session analysis and platform pain-point resolution.

---

## 2. Filesystem-Driven Handoff Model & Decoupled Repositories

The coordination is asynchronous, mediated by the file structure:

* **Staging (`sources/`)**: Decoupled repository for raw evidence and `sources/state.json` orchestration queue.
* **Wiki (`wiki/` repository)**: Objective, anonymized knowledge base written in OKF v0.2 format.
* **Workspace (`workspace/` repository)**: Personal profiles, active protocols, feedback, and deliverables.
* **Podarcis Engine (`.podarcis/` & `podarcis` CLI)**: Unified Python CLI and runtime engine for status inspection (`podarcis status`), configuration (`podarcis config`), testing (`podarcis test`), and link linting (`podarcis lint`).

---

## 3. Strict Conventions & Rules of Engagement

### Hierarchy of Evidence & Citation
* **Strict Citation Chain**: Workspace files and protocols (`workspace/`) MUST cite the Wiki (`wiki/`); the Wiki (`wiki/`) MUST cite Sources (`sources/`). Under no circumstances should `workspace/` files bypass `wiki/` to cite `sources/` directly.
* **OKF Frontmatter**: Every non-index markdown file in `wiki/` and `workspace/` must begin with standardized YAML frontmatter containing `type`, `title`, `category`, `rationale`, `generated`, and `sources` (or `related`).
* **Cross-References**: Use relative markdown links (`[Text](../path.md)`). Unlinked mentions or `[[wikilinks]]` are forbidden.
"""


def find_template_source(root_dir: Path) -> Optional[Path]:
    """Find source directory to copy Podarcis assets from."""
    # 1. Explicit environment variable
    env_template = os.environ.get("PODARCIS_TEMPLATE_DIR")
    if env_template and Path(env_template).exists():
        return Path(env_template)

    # 2. Check dedicated server template cache, sibling repo, or workspace fallback
    candidates = [
        root_dir / "data" / "templates" / "podarcis",
        root_dir.parent / "Podarcis",
        root_dir / "templates" / "workspace_template",
        Path(__file__).parent / "templates" / "workspace_template",
    ]
    for cand in candidates:
        if cand.exists() and (cand / ".agents").exists():
            return cand
    return None


def seed_user_workspace(workspace_dir: Path, username: str, root_dir: Optional[Path] = None) -> None:
    """Scaffold a full Podarcis research workspace for a user."""
    workspace_dir.mkdir(parents=True, exist_ok=True)
    
    if root_dir is None:
        root_dir = Path(__file__).resolve().parent.parent.parent

    template_src = find_template_source(root_dir)

    # Copy template assets if found
    if template_src and template_src.exists():
        for item in [".agents", ".podarcis", ".clinerules", ".mcp.json", "AGENTS.md", "opencode.json"]:
            src_path = template_src / item
            dst_path = workspace_dir / item
            if src_path.exists() and not dst_path.exists():
                if src_path.is_dir():
                    shutil.copytree(
                        src_path,
                        dst_path,
                        ignore=shutil.ignore_patterns(
                            ".git", ".venv", "__pycache__", "*.pyc", "logs", "token_cache.json"
                        ),
                    )
                else:
                    shutil.copy2(src_path, dst_path)

    # Ensure required base directories exist
    (workspace_dir / "wiki").mkdir(exist_ok=True)
    (workspace_dir / "sources" / "literature").mkdir(parents=True, exist_ok=True)
    (workspace_dir / "workspace" / "protocols").mkdir(parents=True, exist_ok=True)
    (workspace_dir / "workspace" / "profile").mkdir(parents=True, exist_ok=True)
    (workspace_dir / ".podarcis" / "logs").mkdir(parents=True, exist_ok=True)
    (workspace_dir / ".agents" / "agents").mkdir(parents=True, exist_ok=True)

    # Scaffold AGENTS.md if missing
    agents_md = workspace_dir / "AGENTS.md"
    if not agents_md.exists():
        agents_md.write_text(DEFAULT_AGENTS_MD, encoding="utf-8")

    # Scaffold .mcp.json (container-compatible paths)
    mcp_json = workspace_dir / ".mcp.json"
    if not mcp_json.exists():
        mcp_json.write_text(json.dumps(DEFAULT_MCP_JSON, indent=2), encoding="utf-8")

    # Scaffold opencode.json (container-compatible paths)
    opencode_json = workspace_dir / "opencode.json"
    if not opencode_json.exists():
        opencode_json.write_text(json.dumps(DEFAULT_OPENCODE_JSON, indent=2), encoding="utf-8")

    # Scaffold .clinerules
    clinerules = workspace_dir / ".clinerules"
    if not clinerules.exists():
        clinerules.write_text(".agents\nAGENTS.md\n", encoding="utf-8")

    # Scaffold .podarcis/config.yaml
    podarcis_cfg = workspace_dir / ".podarcis" / "config.yaml"
    if not podarcis_cfg.exists():
        podarcis_cfg.write_text(DEFAULT_CONFIG_YAML, encoding="utf-8")

    # Scaffold wiki/_index.md
    wiki_index = workspace_dir / "wiki" / "_index.md"
    if not wiki_index.exists():
        wiki_index.write_text(
            f"# {username.capitalize()}'s Podarcis Knowledge Wiki\n\n"
            "Welcome to your personal Open Knowledge Format (OKF v0.2) research wiki.\n\n"
            "## Structure\n"
            "- Concepts: Core scientific & domain notes\n"
            "- Entities: Anonymized objective entity records\n\n"
            "This wiki is autonomously indexed and maintained by the `@synthesizer` and `@auditor` subagents.\n",
            encoding="utf-8",
        )

    # Scaffold sources/state.json
    sources_state = workspace_dir / "sources" / "state.json"
    if not sources_state.exists():
        sources_state.write_text(json.dumps({"queue": [], "ingested": []}, indent=2), encoding="utf-8")

    # Scaffold workspace/profile/profile.md
    profile_md = workspace_dir / "workspace" / "profile" / "profile.md"
    if not profile_md.exists():
        profile_md.write_text(
            f"---\n"
            f"type: profile\n"
            f"title: User Profile - {username}\n"
            f"category: profile\n"
            f"rationale: Research profile constraints for personalized protocol synthesis\n"
            f"generated: false\n"
            f"---\n\n"
            f"# Researcher Profile: {username}\n\n"
            f"## Goals\n"
            f"- Primary Focus: Domain research & knowledge synthesis\n\n"
            f"## Constraints\n"
            f"- Evidence Standard: Peer-reviewed literature (OKF v0.2 hierarchy)\n",
            encoding="utf-8",
        )

    # Setup .opencode relative symlink if needed
    opencode_dir = workspace_dir / ".opencode"
    opencode_dir.mkdir(exist_ok=True)
    opencode_agents_link = opencode_dir / "agents"
    if not opencode_agents_link.exists() and (workspace_dir / ".agents" / "agents").exists():
        try:
            opencode_agents_link.symlink_to("../.agents/agents", target_is_directory=True)
        except Exception:
            pass
