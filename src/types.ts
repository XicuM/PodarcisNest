export interface UserRecord {
  username: string;
  role: 'user' | 'admin';
  created_at: string;
  workspace_path: string;
  password_hash: string;
  password_salt: string;
}

export interface AdminRecord {
  role: 'admin';
  password_hash: string;
  password_salt: string;
  created_at: string;
  updated_at?: string;
}

export interface ContainerInfo {
  name: string;
  status: string;
  ports?: string;
  username: string;
  port?: string;
  error?: string;
}

export interface SessionData {
  authenticated_user?: string;
  is_admin?: boolean;
}

declare module '@fastify/secure-session' {
  interface SessionData {
    authenticated_user?: string;
    is_admin?: boolean;
  }
}

export interface SlackConfigData {
  slack_bot_token?: string;
  slack_app_token?: string;
  llm_provider: 'opencode' | 'openai' | 'anthropic';
  llm_api_key?: string;
  llm_base_url?: string;
  llm_model?: string;
  system_prompt_extra?: string;
}

export interface SharedSourceItem {
  name: string;
  is_dir: boolean;
  size_bytes: number | null;
  modified_at: string;
}

export interface StagedQueueItem {
  url: string;
  title: string;
  submitted_by: string;
  notes: string;
  status: string;
  staged_at: string;
}

export interface WikiUpdateItem {
  path: string;
  title: string;
  modified_at: string;
  summary: string;
  tags: string[];
}

export interface WikiSearchResult {
  path: string;
  title: string;
  score: number;
  excerpt: string;
}
