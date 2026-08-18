import path from 'path';
import pkg from '@slack/bolt';
const { App } = pkg;
import { SlackConfig } from './config.js';
import { PodarcisResearchAgent } from './agent.js';

export function toSlackMrkdwn(text: string): string {
  if (!text) return text;
  let converted = text;
  // [text](url) -> <url|text>
  converted = converted.replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '<$2|$1>');
  // Headers: # Header -> *Header*
  converted = converted.replace(/^#{1,6}\s+(.+)$/gm, '*$1*');
  // Bold: **bold** -> *bold*, __bold__ -> *bold*
  converted = converted.replace(/\*\*(.+?)\*\*/g, '*$1*');
  converted = converted.replace(/__(.+?)__/g, '*$1*');
  // Strikethrough: ~~text~~ -> ~text~
  converted = converted.replace(/~~(.+?)~~/g, '~$1~');
  return converted;
}

export class PodarcisSlackBot {
  public rootDir: string;
  public config: SlackConfig;
  public agent: PodarcisResearchAgent;
  private app?: any;

  constructor(rootDir: string, config?: SlackConfig) {
    this.rootDir = path.resolve(rootDir);
    this.config = config || SlackConfig.load(this.rootDir);
    this.agent = new PodarcisResearchAgent(this.rootDir, this.config);
  }

  public async setupApp(): Promise<void> {
    if (!this.config.slack_bot_token) {
      throw new Error('SLACK_BOT_TOKEN is required. Set it in environment or data/slack_config.json');
    }
    if (!this.config.slack_app_token) {
      throw new Error('SLACK_APP_TOKEN (xapp-...) is required for Socket Mode.');
    }

    const app = new App({
      token: this.config.slack_bot_token,
      appToken: this.config.slack_app_token,
      socketMode: true,
    });

    app.event('app_mention', async ({ event, say, client }: any) => {
      await this.handleIncomingMessage(event, say, client);
    });

    app.event('message', async ({ event, say, client }: any) => {
      if (event.channel_type === 'im' && !event.bot_id) {
        await this.handleIncomingMessage(event, say, client);
      }
    });

    this.app = app;
  }

  private async handleIncomingMessage(event: any, say: any, client: any): Promise<void> {
    const channelId = event.channel;
    const messageTs = event.ts;
    const threadTs = event.thread_ts || messageTs;
    const userId = event.user || 'unknown_user';
    const rawText = event.text || '';

    const cleanText = rawText.replace(/<@[A-Z0-9]+>/g, '').trim() || 'help';

    // React with eyes
    try {
      await client.reactions.add({ channel: channelId, name: 'eyes', timestamp: messageTs });
    } catch {}

    try {
      let userName = userId;
      try {
        const userInfo = await client.users.info({ user: userId });
        if (userInfo.ok && userInfo.user) {
          userName = userInfo.user.profile?.display_name || userInfo.user.real_name || userId;
        }
      } catch {}

      const history: Array<{ role: 'user' | 'assistant'; content: string }> = [];
      if (event.thread_ts) {
        try {
          const threadResp = await client.conversations.replies({
            channel: channelId,
            ts: threadTs,
            limit: 10,
          });
          if (threadResp.ok && threadResp.messages) {
            for (const msg of threadResp.messages.slice(0, -1)) {
              const isBot = Boolean(msg.bot_id);
              const text = (msg.text || '').replace(/<@[A-Z0-9]+>/g, '').trim();
              if (text) {
                history.push({
                  role: isBot ? 'assistant' : 'user',
                  content: text,
                });
              }
            }
          }
        } catch {}
      }

      const responseText = await this.agent.processMessage(cleanText, userName, history);
      const formatted = toSlackMrkdwn(responseText);
      await say({ text: formatted, thread_ts: threadTs });
    } catch (err: any) {
      await say({
        text: `⚠️ *Sorry, I encountered an error while processing that:* \`${err.message}\``,
        thread_ts: threadTs,
      });
    } finally {
      try {
        await client.reactions.remove({ channel: channelId, name: 'eyes', timestamp: messageTs });
      } catch {}
    }
  }

  public async start(): Promise<void> {
    await this.setupApp();
    await this.app.start();
  }

  public async stop(): Promise<void> {
    if (this.app) {
      await this.app.stop();
    }
  }
}
