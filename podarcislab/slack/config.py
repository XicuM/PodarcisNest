"""Configuration management for PodarcisLab Slack bot."""

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Optional


@dataclass
class SlackConfig:
    slack_bot_token: Optional[str] = None
    slack_app_token: Optional[str] = None
    llm_provider: str = "opencode"  # 'opencode', 'openai', or 'anthropic'
    llm_api_key: Optional[str] = None
    llm_base_url: Optional[str] = None  # e.g. http://localhost:8000/v1 or custom OpenCode server
    llm_model: Optional[str] = None
    system_prompt_extra: Optional[str] = None

    @classmethod
    def load(cls, root_dir: Path) -> "SlackConfig":
        """Load configuration from environment variables or data/slack_config.json."""
        config_file = root_dir / "data" / "slack_config.json"
        data = {}

        if config_file.exists():
            try:
                data = json.loads(config_file.read_text(encoding="utf-8"))
            except Exception:
                data = {}

        bot_token = os.environ.get("SLACK_BOT_TOKEN") or data.get("slack_bot_token")
        app_token = os.environ.get("SLACK_APP_TOKEN") or data.get("slack_app_token")

        llm_provider = (
            os.environ.get("PODARCIS_LLM_PROVIDER")
            or data.get("llm_provider")
            or ("anthropic" if os.environ.get("ANTHROPIC_API_KEY") else "opencode")
        )

        base_url = (
            os.environ.get("OPENCODE_BASE_URL")
            or os.environ.get("OPENAI_BASE_URL")
            or os.environ.get("PODARCIS_LLM_BASE_URL")
            or data.get("llm_base_url")
        )

        anthropic_key = os.environ.get("ANTHROPIC_API_KEY")
        openai_key = os.environ.get("OPENAI_API_KEY") or os.environ.get("OPENCODE_API_KEY")

        if llm_provider == "anthropic":
            llm_api_key = anthropic_key or data.get("llm_api_key")
            default_model = "claude-3-5-sonnet-20241022"
        else:  # opencode / openai / compatible
            llm_api_key = openai_key or data.get("llm_api_key") or "opencode-local"
            default_model = "opencode" if llm_provider == "opencode" else "gpt-4o"

        llm_model = os.environ.get("PODARCIS_LLM_MODEL") or data.get("llm_model") or default_model

        return cls(
            slack_bot_token=bot_token,
            slack_app_token=app_token,
            llm_provider=llm_provider,
            llm_api_key=llm_api_key,
            llm_base_url=base_url,
            llm_model=llm_model,
            system_prompt_extra=data.get("system_prompt_extra"),
        )

    def save(self, root_dir: Path) -> None:
        """Save non-null configuration to data/slack_config.json."""
        config_file = root_dir / "data" / "slack_config.json"
        config_file.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "slack_bot_token": self.slack_bot_token,
            "slack_app_token": self.slack_app_token,
            "llm_provider": self.llm_provider,
            "llm_api_key": self.llm_api_key,
            "llm_base_url": self.llm_base_url,
            "llm_model": self.llm_model,
            "system_prompt_extra": self.system_prompt_extra,
        }
        config_file.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    def is_configured(self) -> bool:
        """Check whether minimum required tokens and keys are present."""
        return bool(self.slack_bot_token and self.slack_app_token)

