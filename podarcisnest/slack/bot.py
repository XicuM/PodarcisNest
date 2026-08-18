"""Slack Bolt Socket Mode bot listener for PodarcisNest."""

import logging
import re
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any, Dict, List, Optional

from podarcisnest.slack.agent import PodarcisResearchAgent
from podarcisnest.slack.config import SlackConfig

logger = logging.getLogger("podarcisnest.slack")


def setup_slack_logger(root_dir: Path) -> logging.Logger:
    """Configure rotating file logger for Slack bot in data/logs/slack.log."""
    logs_dir = root_dir / "data" / "logs"
    logs_dir.mkdir(parents=True, exist_ok=True)
    log_file = logs_dir / "slack.log"

    # Avoid adding duplicate handlers
    if not any(isinstance(h, RotatingFileHandler) for h in logger.handlers):
        handler = RotatingFileHandler(
            log_file,
            maxBytes=5 * 1024 * 1024,  # 5 MB per log file
            backupCount=3,              # Keep up to 3 rotating backups
            encoding="utf-8",
        )
        formatter = logging.Formatter(
            "[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s",
            datefmt="%Y-%m-%d %H:%M:%S",
        )
        handler.setFormatter(formatter)
        logger.addHandler(handler)
        logger.setLevel(logging.INFO)

    return logger


def to_slack_mrkdwn(text: str) -> str:
    """Convert standard CommonMark/GitHub Markdown to Slack mrkdwn format."""
    if not text:
        return text

    converted = text

    # 1. Convert markdown links: [text](url) -> <url|text>
    converted = re.sub(r'\[([^\]]+)\]\((https?://[^\)]+)\)', r'<\2|\1>', converted)

    # 2. Convert markdown headers: # Header -> *Header*
    converted = re.sub(r'^#{1,6}\s+(.+)$', r'*\1*', converted, flags=re.MULTILINE)

    # 3. Convert bold syntax: **bold** -> *bold* and __bold__ -> *bold*
    converted = re.sub(r'\*\*(.+?)\*\*', r'*\1*', converted)
    converted = re.sub(r'__(.+?)__', r'*\1*', converted)

    # 4. Convert strikethrough: ~~text~~ -> ~text~
    converted = re.sub(r'~~(.+?)~~', r'~\1~', converted)

    return converted


class PodarcisSlackBot:
    """Manages the Slack connection, event subscriptions, and thread orchestration."""

    def __init__(self, root_dir: Path, config: Optional[SlackConfig] = None):
        self.root_dir = root_dir.resolve()
        setup_slack_logger(self.root_dir)
        self.config = config or SlackConfig.load(self.root_dir)
        self.agent = PodarcisResearchAgent(self.root_dir, self.config)
        self._app = None
        self._handler = None

    def _setup_app(self):
        try:
            from slack_bolt import App
            from slack_bolt.adapter.socket_mode import SocketModeHandler
        except ImportError:
            raise ImportError(
                "slack-bolt is required to run the Podarcis Slack bot. Run: pip install slack-bolt"
            )

        if not self.config.slack_bot_token:
            raise ValueError("SLACK_BOT_TOKEN is required. Set it in environment or data/slack_config.json")
        if not self.config.slack_app_token:
            raise ValueError("SLACK_APP_TOKEN (xapp-...) is required for Socket Mode.")

        app = App(token=self.config.slack_bot_token)

        @app.event("app_mention")
        def handle_app_mention(event: Dict[str, Any], say, client):
            self._handle_incoming_message(event, say, client)

        @app.event("message")
        def handle_direct_message(event: Dict[str, Any], say, client):
            # Only respond to direct 1-on-1 messages, ignoring bot messages
            channel_type = event.get("channel_type")
            if channel_type == "im" and not event.get("bot_id"):
                self._handle_incoming_message(event, say, client)

        self._app = app
        self._handler = SocketModeHandler(app, self.config.slack_app_token)

    def _handle_incoming_message(self, event: Dict[str, Any], say, client):
        """Process mention or DM event, resolve thread history, and reply."""
        channel_id = event.get("channel")
        message_ts = event.get("ts")
        thread_ts = event.get("thread_ts") or message_ts
        user_id = event.get("user", "unknown_user")
        raw_text = event.get("text", "")

        # Clean text (remove bot user mention <@U12345>)
        clean_text = re.sub(r"<@[A-Z0-9]+>", "", raw_text).strip()
        if not clean_text:
            clean_text = "help"

        # React with 👀 while processing
        try:
            client.reactions_add(channel=channel_id, name="eyes", timestamp=message_ts)
        except Exception:
            pass

        try:
            # Fetch user info if possible
            user_name = user_id
            try:
                user_info = client.users_info(user=user_id)
                if user_info.get("ok"):
                    user_name = (
                        user_info["user"].get("profile", {}).get("display_name")
                        or user_info["user"].get("real_name")
                        or user_id
                    )
            except Exception:
                pass

            # Fetch thread context if replying inside an ongoing thread
            history: List[Dict[str, str]] = []
            if event.get("thread_ts"):
                try:
                    thread_resp = client.conversations_replies(
                        channel=channel_id, ts=thread_ts, limit=10
                    )
                    if thread_resp.get("ok"):
                        for msg in thread_resp.get("messages", [])[:-1]:
                            is_bot = bool(msg.get("bot_id"))
                            text = re.sub(r"<@[A-Z0-9]+>", "", msg.get("text", "")).strip()
                            if text:
                                history.append(
                                    {
                                        "role": "assistant" if is_bot else "user",
                                        "content": text,
                                    }
                                )
                except Exception as e:
                    logger.warning(f"Could not load thread history: {e}")

            logger.info(f"Incoming Slack query from {user_name}: {clean_text}")

            # Run agent
            response_text = self.agent.process_message(
                user_query=clean_text,
                user_name=user_name,
                conversation_history=history,
            )

            # Format to native Slack mrkdwn and reply
            formatted_response = to_slack_mrkdwn(response_text)
            say(text=formatted_response, thread_ts=thread_ts)
            logger.info(f"Successfully replied to {user_name}")

        except Exception as e:
            logger.error(f"Error processing Slack message from {user_id}: {e}", exc_info=True)
            say(
                text=f"⚠️ *Sorry, I encountered an error while processing that:* `{str(e)}`",
                thread_ts=thread_ts,
            )
        finally:
            # Remove 👀 reaction
            try:
                client.reactions_remove(channel=channel_id, name="eyes", timestamp=message_ts)
            except Exception:
                pass

    def start(self):
        """Start the Socket Mode listener."""
        self._setup_app()
        logger.info("Starting Podarcis Slack Bot in Socket Mode...")
        self._handler.start()

    def stop(self):
        """Stop the Socket Mode listener."""
        if self._handler:
            self._handler.close()
