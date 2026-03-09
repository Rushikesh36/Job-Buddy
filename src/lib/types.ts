// Shared types for JobBuddy AI Chrome Extension

export interface PageContext {
  url: string;
  title: string;
  metaDescription: string;
  textContent: string; // full page text, trimmed to max 15000 characters
  extractedAt: string; // ISO timestamp
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// Generic message shape sent to any LLM (Claude, Gemini, OpenAI all accept role+content)
export interface LLMMessage {
  role: 'user' | 'assistant';
  content: string;
}

// Keep ClaudeMessage as alias for backward compat
export type ClaudeMessage = LLMMessage;

// ---- Multi-LLM types ----

export type LLMProvider = 'claude' | 'gemini' | 'openai';

export interface LLMConfig {
  provider: LLMProvider;
  apiKey: string;
  model: string;
}

// Stored in chrome.storage.local
export interface ProviderSettings {
  selectedProvider: LLMProvider;
  apiKeys: Record<LLMProvider, string>;
  selectedModels: Record<LLMProvider, string>;
}

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
};

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  selectedProvider: 'claude',
  apiKeys: { claude: '', gemini: '', openai: '' },
  selectedModels: { ...DEFAULT_MODELS },
};

// ---- Chrome message types ----

export type MessageType =
  | 'GET_PAGE_CONTENT'
  | 'PAGE_CONTENT_RESULT'
  | 'PAGE_CONTENT_ERROR'
  | 'SEND_TO_LLM'
  // keep backward-compat alias
  | 'SEND_TO_CLAUDE'
  | 'CLAUDE_STREAM_CHUNK'
  | 'CLAUDE_STREAM_DONE'
  | 'CLAUDE_STREAM_ERROR'
  | 'OPEN_SIDE_PANEL';

export interface ChromeMessage {
  type: MessageType;
  payload?: unknown;
}

export interface SendToLLMPayload {
  messages: LLMMessage[];
  pageContext: PageContext | null;
  llmConfig: LLMConfig;
  messageId: string;
}

// backward compat alias
export type SendToClaudePayload = SendToLLMPayload;

export interface StreamChunkPayload {
  chunk: string;
  messageId: string;
}

export interface StreamDonePayload {
  messageId: string;
}

export interface StreamErrorPayload {
  error: string;
  messageId: string;
}
