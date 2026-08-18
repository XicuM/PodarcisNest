import fs from 'fs-extra';
import path from 'path';
import { SlackConfigData } from '../types.js';

export class SlackConfig {
  public slack_bot_token?: string;
  public slack_app_token?: string;
  public llm_provider: 'opencode' | 'openai' | 'anthropic';
  public llm_api_key?: string;
  public llm_base_url?: string;
  public llm_model?: string;
  public system_prompt_extra?: string;

  constructor(data: Partial<SlackConfigData> = {}) {
    this.slack_bot_token = data.slack_bot_token;
    this.slack_app_token = data.slack_app_token;
    this.llm_provider = data.llm_provider || 'opencode';
    this.llm_api_key = data.llm_api_key;
    this.llm_base_url = data.llm_base_url;
    this.llm_model = data.llm_model;
    this.system_prompt_extra = data.system_prompt_extra;
  }

  public static load(rootDir: string): SlackConfig {
    const configFile = path.join(rootDir, 'data', 'slack_config.json');
    let data: Partial<SlackConfigData> = {};

    if (fs.existsSync(configFile)) {
      try {
        data = fs.readJsonSync(configFile);
      } catch {
        data = {};
      }
    }

    const botToken = process.env.SLACK_BOT_TOKEN || data.slack_bot_token;
    const appToken = process.env.SLACK_APP_TOKEN || data.slack_app_token;

    let llmProvider: 'opencode' | 'openai' | 'anthropic' =
      (process.env.PODARCIS_LLM_PROVIDER as any) ||
      data.llm_provider ||
      (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'opencode');

    const baseUrl =
      process.env.OPENCODE_BASE_URL ||
      process.env.OPENAI_BASE_URL ||
      process.env.PODARCIS_LLM_BASE_URL ||
      data.llm_base_url;

    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    const openaiKey = process.env.OPENAI_API_KEY || process.env.OPENCODE_API_KEY;

    let llmApiKey: string | undefined;
    let defaultModel: string;

    if (llmProvider === 'anthropic') {
      llmApiKey = anthropicKey || data.llm_api_key;
      defaultModel = 'claude-3-5-sonnet-20241022';
    } else {
      llmApiKey = openaiKey || data.llm_api_key || 'opencode-local';
      defaultModel = llmProvider === 'opencode' ? 'opencode' : 'gpt-4o';
    }

    const llmModel = process.env.PODARCIS_LLM_MODEL || data.llm_model || defaultModel;

    return new SlackConfig({
      slack_bot_token: botToken,
      slack_app_token: appToken,
      llm_provider: llmProvider,
      llm_api_key: llmApiKey,
      llm_base_url: baseUrl,
      llm_model: llmModel,
      system_prompt_extra: data.system_prompt_extra,
    });
  }

  public save(rootDir: string): void {
    const configFile = path.join(rootDir, 'data', 'slack_config.json');
    fs.ensureDirSync(path.dirname(configFile));
    const payload: SlackConfigData = {
      slack_bot_token: this.slack_bot_token,
      slack_app_token: this.slack_app_token,
      llm_provider: this.llm_provider,
      llm_api_key: this.llm_api_key,
      llm_base_url: this.llm_base_url,
      llm_model: this.llm_model,
      system_prompt_extra: this.system_prompt_extra,
    };
    fs.writeJsonSync(configFile, payload, { spaces: 2 });
  }

  public isConfigured(): boolean {
    return Boolean(this.slack_bot_token && this.slack_app_token);
  }
}
