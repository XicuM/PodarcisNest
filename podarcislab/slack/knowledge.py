"""Scoped shared research knowledge base reader and staging tools for Slack agent.

STRICT PRIVACY ENCLOSURE:
This module only ever interacts with data/shared/ (wiki and sources).
It explicitly blocks access to data/users/ to protect individual researcher workspaces.
"""

import datetime
import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional


class ScopedKnowledgeBase:
    """Provides safe, scoped access to shared research wiki and sources."""

    def __init__(self, root_dir: Path):
        self.root_dir = root_dir.resolve()
        self.shared_dir = (self.root_dir / "data" / "shared").resolve()
        self.wiki_dir = (self.shared_dir / "wiki").resolve()
        self.sources_dir = (self.shared_dir / "sources").resolve()

        # Ensure directories exist
        self.wiki_dir.mkdir(parents=True, exist_ok=True)
        self.sources_dir.mkdir(parents=True, exist_ok=True)

    def _assert_safe_path(self, target_path: Path) -> Path:
        """Validate that target_path is strictly within data/shared/."""
        resolved = target_path.resolve()
        try:
            resolved.relative_to(self.shared_dir)
        except ValueError:
            raise PermissionError(
                f"Access denied: Path '{target_path}' is outside the shared knowledge boundary."
            )
        return resolved

    def get_recent_wiki_updates(self, days: int = 7) -> List[Dict[str, Any]]:
        """Find wiki notes created or modified within the last N days."""
        cutoff_time = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(days=days)
        recent_notes: List[Dict[str, Any]] = []

        if not self.wiki_dir.exists():
            return recent_notes

        # Scan all markdown files in shared wiki
        for md_file in self.wiki_dir.rglob("*.md"):
            try:
                stat = md_file.stat()
                mtime = datetime.datetime.fromtimestamp(stat.st_mtime, tz=datetime.timezone.utc)
                if mtime >= cutoff_time:
                    rel_path = md_file.relative_to(self.wiki_dir).as_posix()
                    content = md_file.read_text(encoding="utf-8", errors="replace")
                    
                    title = md_file.stem
                    summary = ""
                    tags = []

                    # Extract title and frontmatter if present
                    lines = content.splitlines()
                    for line in lines:
                        if line.startswith("# ") and title == md_file.stem:
                            title = line.lstrip("# ").strip()
                        elif line.startswith("tags:") or line.startswith("Tags:"):
                            tags_part = line.split(":", 1)[1]
                            tags = [t.strip() for t in re.split(r"[,\[\]]", tags_part) if t.strip()]

                    # Get brief excerpt
                    non_header_lines = [
                        l.strip()
                        for l in lines
                        if l.strip() and not l.startswith("#") and not l.startswith("---")
                    ]
                    if non_header_lines:
                        summary = non_header_lines[0][:200]

                    recent_notes.append(
                        {
                            "path": f"wiki/{rel_path}",
                            "title": title,
                            "modified_at": mtime.isoformat(),
                            "summary": summary,
                            "tags": tags,
                        }
                    )
            except Exception:
                continue

        recent_notes.sort(key=lambda x: x["modified_at"], reverse=True)
        return recent_notes

    def search_shared_wiki(self, query: str, max_results: int = 10) -> List[Dict[str, Any]]:
        """Search shared wiki notes for matching keywords or phrases."""
        results: List[Dict[str, Any]] = []
        if not self.wiki_dir.exists() or not query.strip():
            return results

        tokens = [re.escape(t.lower()) for t in query.split() if len(t) > 1]
        if not tokens:
            tokens = [re.escape(query.lower())]
        pattern = re.compile(r"|".join(tokens), re.IGNORECASE)

        for md_file in self.wiki_dir.rglob("*.md"):
            try:
                content = md_file.read_text(encoding="utf-8", errors="replace")
                matches = pattern.findall(content)
                if matches:
                    rel_path = md_file.relative_to(self.wiki_dir).as_posix()
                    score = len(matches)
                    
                    # Extract title
                    title = md_file.stem
                    for line in content.splitlines():
                        if line.startswith("# "):
                            title = line.lstrip("# ").strip()
                            break

                    # Excerpt surrounding first match
                    first_match = pattern.search(content)
                    excerpt = ""
                    if first_match:
                        start = max(0, first_match.start() - 100)
                        end = min(len(content), first_match.end() + 150)
                        excerpt = "..." + content[start:end].replace("\n", " ") + "..."

                    results.append(
                        {
                            "path": f"wiki/{rel_path}",
                            "title": title,
                            "score": score,
                            "excerpt": excerpt,
                        }
                    )
            except Exception:
                continue

        results.sort(key=lambda x: x["score"], reverse=True)
        return results[:max_results]

    def read_shared_note(self, relative_path: str, max_chars: int = 6000) -> Dict[str, Any]:
        """Read content of a note inside shared/wiki/ or shared/sources/."""
        # Strip leading slashes
        clean_rel = relative_path.lstrip("/").strip()
        target_path = self.shared_dir / clean_rel
        safe_path = self._assert_safe_path(target_path)

        if not safe_path.exists() or not safe_path.is_file():
            return {"error": f"File '{clean_rel}' not found in shared knowledge base."}

        try:
            content = safe_path.read_text(encoding="utf-8", errors="replace")
            is_truncated = len(content) > max_chars
            return {
                "path": clean_rel,
                "content": content[:max_chars],
                "truncated": is_truncated,
                "total_chars": len(content),
            }
        except Exception as e:
            return {"error": f"Failed to read file: {str(e)}"}

    def list_shared_sources(self, limit: int = 20) -> Dict[str, Any]:
        """List literature files and staged papers in data/shared/sources/."""
        sources = []
        staging_file = self.sources_dir / "staging_queue.json"
        staged_items = []

        if staging_file.exists():
            try:
                staged_items = json.loads(staging_file.read_text(encoding="utf-8"))
            except Exception:
                staged_items = []

        for item in self.sources_dir.iterdir():
            if item.name == "staging_queue.json" or item.name.startswith("."):
                continue
            stat = item.stat()
            sources.append(
                {
                    "name": item.name,
                    "is_dir": item.is_dir(),
                    "size_bytes": stat.st_size if item.is_file() else None,
                    "modified_at": datetime.datetime.fromtimestamp(
                        stat.st_mtime, tz=datetime.timezone.utc
                    ).isoformat(),
                }
            )

        sources.sort(key=lambda x: x["modified_at"], reverse=True)
        return {
            "sources": sources[:limit],
            "staged_queue": staged_items[:limit],
        }

    def stage_source_url(
        self, url: str, title: Optional[str] = None, submitter: str = "slack-user", notes: str = ""
    ) -> Dict[str, Any]:
        """Stage a paper or URL into data/shared/sources/staging_queue.json for team ingestion."""
        staging_file = self.sources_dir / "staging_queue.json"
        queue = []
        if staging_file.exists():
            try:
                queue = json.loads(staging_file.read_text(encoding="utf-8"))
            except Exception:
                queue = []

        entry = {
            "url": url,
            "title": title or url,
            "submitted_by": submitter,
            "notes": notes,
            "status": "pending",
            "staged_at": datetime.datetime.now(datetime.timezone.utc).isoformat(),
        }
        queue.append(entry)
        staging_file.write_text(json.dumps(queue, indent=2), encoding="utf-8")
        return {"status": "success", "message": f"Staged paper '{entry['title']}' for ingestion.", "entry": entry}
