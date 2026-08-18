"""LLM-powered research agent with scoped access to shared Podarcis knowledge."""

import json
import logging
import re
from pathlib import Path
from typing import Any, Dict, List, Optional

from podarcisnest.slack.config import SlackConfig
from podarcisnest.slack.knowledge import ScopedKnowledgeBase

logger = logging.getLogger("podarcisnest.slack.agent")

SYSTEM_PROMPT = """You are @podarcis, the AI Research Assistant for the PodarcisNest research habitat.
Your primary role is to assist researchers and team members via Slack by:
1. Summarizing recent research progress, newly added protocols, and updated wiki notes.
2. Answering research and scientific questions using the shared Open Knowledge Format (OKF v0.2) wiki.
3. Staging and tracking literature or source papers in the shared repository.

CRITICAL PRIVACY & SECURITY BOUNDARIES:
- You ONLY have access to the team's shared knowledge base (`data/shared/wiki/` and `data/shared/sources/`).
- You DO NOT have access to individual researchers' private workspaces or personal scratchpads.
- Always be accurate, concise, and professional.
- Format responses cleanly for Slack: use emojis, bold headings, bullet points, and reference note paths (e.g. `wiki/protocols/dna_extraction.md`).
"""

TOOLS_SPEC = [
    {
        "name": "get_recent_shared_updates",
        "description": "Retrieve wiki notes and research documents updated or created within the last N days (default 7 days).",
        "parameters": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Number of past days to scan for updates (e.g. 7 for last week, 30 for last month).",
                    "default": 7,
                }
            },
        },
    },
    {
        "name": "search_shared_wiki",
        "description": "Search the shared research wiki for notes matching keywords, topics, genes, or protocol names.",
        "parameters": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Search query or keyword phrase.",
                }
            },
            "required": ["query"],
        },
    },
    {
        "name": "read_shared_note",
        "description": "Read the full text or content of a specific shared note from the wiki or sources.",
        "parameters": {
            "type": "object",
            "properties": {
                "path": {
                    "type": "string",
                    "description": "Relative path to note within shared directory (e.g. 'wiki/genomics/sequencing.md' or 'protocols/pcr.md').",
                }
            },
            "required": ["path"],
        },
    },
    {
        "name": "list_shared_sources",
        "description": "List recently added literature papers, datasets, and pending staging queue in data/shared/sources/.",
        "parameters": {
            "type": "object",
            "properties": {},
        },
    },
    {
        "name": "stage_source_url",
        "description": "Stage a scientific paper URL, DOI, or dataset link into the shared queue for team literature ingestion.",
        "parameters": {
            "type": "object",
            "properties": {
                "url": {"type": "string", "description": "URL or DOI of the paper/source."},
                "title": {"type": "string", "description": "Title or short description of the paper."},
                "notes": {"type": "string", "description": "Optional notes or reason for staging."},
            },
            "required": ["url"],
        },
    },
]


class PodarcisResearchAgent:
    """Agent orchestrator that parses user queries, executes scoped tools, and generates responses."""

    def __init__(self, root_dir: Path, config: SlackConfig):
        self.root_dir = root_dir.resolve()
        self.config = config
        self.kb = ScopedKnowledgeBase(self.root_dir)

    def _execute_tool(self, tool_name: str, tool_args: Dict[str, Any], user_name: str = "slack-user") -> Any:
        """Execute scoped knowledge tools."""
        if tool_name == "get_recent_shared_updates":
            days = tool_args.get("days", 7)
            return self.kb.get_recent_wiki_updates(days=days)

        elif tool_name == "search_shared_wiki":
            query = tool_args.get("query", "")
            return self.kb.search_shared_wiki(query=query)

        elif tool_name == "read_shared_note":
            path = tool_args.get("path", "")
            return self.kb.read_shared_note(relative_path=path)

        elif tool_name == "list_shared_sources":
            return self.kb.list_shared_sources()

        elif tool_name == "stage_source_url":
            url = tool_args.get("url", "")
            title = tool_args.get("title")
            notes = tool_args.get("notes", "")
            return self.kb.stage_source_url(url=url, title=title, submitter=user_name, notes=notes)

        return {"error": f"Unknown tool: {tool_name}"}

    def process_message(
        self, user_query: str, user_name: str = "researcher", conversation_history: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Process an incoming user message using direct tool execution, OpenCode CLI, or direct API."""
        query_lower = user_query.lower().strip()

        # 1. Direct Pattern / Tool Matches (Deterministic, zero external server needed)
        # Summarize recent work / last week
        if any(w in query_lower for w in ["summarize", "summary", "last week", "updates", "recent", "what was done", "what changed"]):
            days = 7
            if "month" in query_lower:
                days = 30
            elif "yesterday" in query_lower or "last 24" in query_lower:
                days = 1
            return self._synthesize_recent_updates(days=days)

        # Staging paper URL / DOI
        if query_lower.startswith("stage ") or "arxiv.org" in query_lower or "doi.org" in query_lower:
            words = user_query.split()
            url = ""
            for w in words:
                if w.startswith("http://") or w.startswith("https://") or "10." in w:
                    url = w
                    break
            if url:
                res = self.kb.stage_source_url(url=url, submitter=user_name, notes=user_query)
                return f"📥 *{res['message']}*\nAdded to `data/shared/sources/staging_queue.json` for team ingestion."

        # List sources / literature queue
        if "sources" in query_lower or "papers" in query_lower or "literature" in query_lower or "queue" in query_lower:
            return self._format_sources_summary()

        # Search shared wiki
        if query_lower.startswith("search ") or query_lower.startswith("find "):
            query_term = re.sub(r"^(search|find)\s+", "", user_query, flags=re.IGNORECASE).strip()
            return self._format_search_results(query_term)

        # 2. OpenCode CLI Execution (Direct subprocess, no server daemon required)
        if self.config.llm_provider == "opencode" and self._has_opencode_cli():
            return self._run_opencode_cli(user_query, user_name)

        # 3. Direct API Call (if API key / compatible endpoint is configured)
        if self.config.llm_api_key and self.config.llm_api_key != "opencode-local":
            if self.config.llm_provider == "anthropic":
                return self._run_anthropic_loop(user_query, user_name, conversation_history)
            else:
                return self._run_openai_loop(user_query, user_name, conversation_history)

        # 4. Fallback search / direct answers if general query
        search_res = self.kb.search_shared_wiki(user_query, max_results=3)
        if search_res:
            return self._format_search_results(user_query)

        # Default help / status summary
        return (
            f"👋 Hi *{user_name}*! I am *@podarcis*, your research assistant.\n\n"
            "Here is what you can ask me directly:\n"
            "• `@podarcis summarize last week` — Generates a progress summary of new and modified OKF notes.\n"
            "• `@podarcis search <topic>` — Searches the shared research wiki for protocols or notes.\n"
            "• `@podarcis list sources` — Shows newly ingested papers and pending staging queue.\n"
            "• `@podarcis stage https://arxiv.org/abs/...` — Stages a paper for literature ingestion."
        )

    def _synthesize_recent_updates(self, days: int = 7) -> str:
        """Directly synthesize recent updates from the shared OKF wiki and sources."""
        recent_notes = self.kb.get_recent_wiki_updates(days=days)
        sources_info = self.kb.list_shared_sources(limit=5)
        staged = sources_info.get("staged_queue", [])

        timeframe_label = "Past 7 Days" if days == 7 else f"Past {days} Days"

        if not recent_notes and not staged:
            return (
                f"📊 *PodarcisNest Shared Research Summary ({timeframe_label})*\n\n"
                f"No modified notes or staged papers found in `data/shared/` over the last {days} days."
            )

        output = [f"📊 *PodarcisNest Shared Research Summary ({timeframe_label})*\n"]

        if recent_notes:
            output.append(f"*📝 Updated OKF Wiki Notes ({len(recent_notes)}):*")
            for note in recent_notes[:8]:
                tags_str = f" `[{', '.join(note['tags'])}]`" if note.get("tags") else ""
                summary_str = f"\n  _{note['summary']}_" if note.get("summary") else ""
                output.append(f"• *{note['title']}* (`{note['path']}`){tags_str}{summary_str}")
            if len(recent_notes) > 8:
                output.append(f"_...and {len(recent_notes) - 8} more notes in `data/shared/wiki/`._")
            output.append("")

        if staged:
            output.append(f"*📚 Pending Literature Staging Queue ({len(staged)}):*")
            for item in staged[:5]:
                output.append(f"• *{item.get('title', item.get('url'))}* (submitted by _{item.get('submitted_by', 'team')}_)")
            output.append("")

        return "\n".join(output).strip()

    def _format_search_results(self, query: str) -> str:
        """Format search results directly from the shared wiki."""
        results = self.kb.search_shared_wiki(query, max_results=5)
        if not results:
            return f"🔍 No shared wiki notes found matching: *{query}* in `data/shared/wiki/`."

        output = [f"🔍 *Shared Wiki Search Results for \"{query}\":*\n"]
        for r in results:
            output.append(f"• *{r['title']}* (`{r['path']}`)")
            if r.get("excerpt"):
                output.append(f"  _{r['excerpt']}_")
        return "\n".join(output)

    def _format_sources_summary(self) -> str:
        """Format sources and staging queue summary."""
        info = self.kb.list_shared_sources(limit=10)
        sources = info.get("sources", [])
        staged = info.get("staged_queue", [])

        output = ["📚 *Shared Literature & Sources Library (`data/shared/sources/`):*\n"]
        if staged:
            output.append(f"*Pending Ingestion Queue ({len(staged)}):*")
            for s in staged:
                output.append(f"• `{s.get('url')}` — *{s.get('title')}* (by _{s.get('submitted_by')}_)")
            output.append("")

        if sources:
            output.append(f"*Available Files & Datasets ({len(sources)}):*")
            for s in sources:
                kind = "📁 Directory" if s["is_dir"] else f"📄 File ({round((s['size_bytes'] or 0)/1024, 1)} KB)"
                output.append(f"• `{s['name']}` — {kind}")
        else:
            output.append("No literature files in `data/shared/sources/` yet.")

        return "\n".join(output)

    def _has_opencode_cli(self) -> bool:
        """Check if opencode CLI is available in PATH."""
        import shutil
        return shutil.which("opencode") is not None

    def _run_opencode_cli(self, user_query: str, user_name: str) -> str:
        """Run OpenCode CLI directly against the shared workspace."""
        import subprocess

        cmd = [
            "opencode",
            "run",
            f"You are @podarcis in Slack responding to {user_name}. Query: {user_query}. You only have access to shared/wiki and shared/sources.",
        ]

        try:
            res = subprocess.run(
                cmd,
                cwd=str(self.kb.shared_dir),
                capture_output=True,
                text=True,
                timeout=60,
            )
            if res.returncode == 0 and res.stdout.strip():
                return res.stdout.strip()
            elif res.stderr:
                return f"⚠️ OpenCode execution returned: {res.stderr.strip()}"
        except Exception as e:
            logger.warning(f"Failed to run opencode CLI: {e}")

        # Fallback to direct synthesis if CLI times out or fails
        return self._synthesize_recent_updates(days=7)

    def _run_anthropic_loop(
        self, user_query: str, user_name: str, history: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Execute Anthropic Claude agent loop with tool calling."""
        try:
            import anthropic
        except ImportError:
            return "❌ `anthropic` Python package is not installed. Run `pip install anthropic`."

        client = anthropic.Anthropic(api_key=self.config.llm_api_key)
        model_name = self.config.llm_model or "claude-3-5-sonnet-20241022"

        anthropic_tools = []
        for t in TOOLS_SPEC:
            anthropic_tools.append(
                {
                    "name": t["name"],
                    "description": t["description"],
                    "input_schema": t["parameters"],
                }
            )

        messages = []
        if history:
            for h in history:
                messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": f"User ({user_name}): {user_query}"})

        # Run up to 5 tool-calling turns
        for _ in range(5):
            response = client.messages.create(
                model=model_name,
                max_tokens=2048,
                system=SYSTEM_PROMPT,
                tools=anthropic_tools,
                messages=messages,
            )

            # Check if tools were requested
            tool_calls = [c for c in response.content if c.type == "tool_use"]
            if not tool_calls:
                text_blocks = [c.text for c in response.content if c.type == "text"]
                return "\n".join(text_blocks).strip()

            # Append assistant message with tool calls
            messages.append({"role": "assistant", "content": response.content})

            # Execute tool calls
            tool_results = []
            for tool_call in tool_calls:
                result = self._execute_tool(tool_call.name, tool_call.input, user_name=user_name)
                tool_results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": tool_call.id,
                        "content": json.dumps(result),
                    }
                )

            messages.append({"role": "user", "content": tool_results})

        return "I completed the queries but reached the maximum reasoning iterations."

    def _run_openai_loop(
        self, user_query: str, user_name: str, history: Optional[List[Dict[str, str]]] = None
    ) -> str:
        """Execute OpenCode / OpenAI-compatible agent loop with tool calling."""
        try:
            import openai
        except ImportError:
            return "❌ `openai` Python package is not installed. Run `pip install openai`."

        client_kwargs = {"api_key": self.config.llm_api_key or "opencode-local"}
        if self.config.llm_base_url:
            client_kwargs["base_url"] = self.config.llm_base_url

        client = openai.OpenAI(**client_kwargs)
        model_name = self.config.llm_model or "opencode"

        openai_tools = [{"type": "function", "function": t} for t in TOOLS_SPEC]

        messages = [{"role": "system", "content": SYSTEM_PROMPT}]
        if history:
            for h in history:
                messages.append({"role": h["role"], "content": h["content"]})
        messages.append({"role": "user", "content": f"User ({user_name}): {user_query}"})

        for _ in range(5):
            response = client.chat.completions.create(
                model=model_name,
                messages=messages,
                tools=openai_tools,
            )
            msg = response.choices[0].message

            if not msg.tool_calls:
                return msg.content or ""

            messages.append(msg)

            for tc in msg.tool_calls:
                fn_name = tc.function.name
                try:
                    fn_args = json.loads(tc.function.arguments)
                except Exception:
                    fn_args = {}
                result = self._execute_tool(fn_name, fn_args, user_name=user_name)
                messages.append(
                    {
                        "role": "tool",
                        "tool_call_id": tc.id,
                        "content": json.dumps(result),
                    }
                )

        return "I completed the queries but reached the maximum reasoning iterations."
