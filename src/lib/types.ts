// Shared types for JobBuddy AI Chrome Extension
import type {
  NUworksDetectionResult,
  NUworksEnrichJobsResult,
  NUworksEnrichProgress,
  NUworksPageExtractionResult,
  NUworksScanProgress,
} from '../types/scanner';

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

export type LLMProvider = 'claude' | 'gemini' | 'openai' | 'openrouter';

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

export interface GoogleAuthState {
  isConnected: boolean;
  accessToken: string | null;
  refreshToken: string | null;
  email: string | null;
  expiresAt: number | null;
}

export interface GoogleSettings {
  clientId: string;
  clientSecret: string;
}

export interface GoogleSettingsStorage {
  googleAuthState: GoogleAuthState;
  googleSettings: GoogleSettings;
}

export interface GoogleTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
}

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email',
] as const;

export const DEFAULT_GOOGLE_AUTH_STATE: GoogleAuthState = {
  isConnected: false,
  accessToken: null,
  refreshToken: null,
  email: null,
  expiresAt: null,
};

export const DEFAULT_GOOGLE_SETTINGS: GoogleSettings = {
  clientId: '',
  clientSecret: '',
};

export const DEFAULT_MODELS: Record<LLMProvider, string> = {
  claude: 'claude-sonnet-4-20250514',
  gemini: 'gemini-2.5-flash',
  openai: 'gpt-4o',
  openrouter: 'meta-llama/llama-3.1-8b-instruct:free',
};

export const DEFAULT_PROVIDER_SETTINGS: ProviderSettings = {
  selectedProvider: 'claude',
  apiKeys: { claude: '', gemini: '', openai: '', openrouter: '' },
  selectedModels: { ...DEFAULT_MODELS },
};

// ---- Chrome message types ----

export type MessageType =
  | 'GET_PAGE_CONTENT'
  | 'NUWORKS_DETECT_PAGE'
  | 'NUWORKS_EXTRACT_CURRENT_PAGE'
  | 'NUWORKS_SCAN_ALL_PAGES'
  | 'NUWORKS_ENRICH_TOP_JOBS'
  | 'SCAN_PROGRESS'
  | 'ENRICH_PROGRESS'
  | 'PAGE_CONTENT_RESULT'
  | 'PAGE_CONTENT_ERROR'
  | 'SEND_TO_LLM'
  | 'EXTRACT_JOB_DATA'
  | 'RUN_LLM_UTILITY'
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

export interface NUworksDetectPageResult {
  success: boolean;
  data?: NUworksDetectionResult;
  error?: string;
}

export interface NUworksExtractCurrentPageResult {
  success: boolean;
  data?: NUworksPageExtractionResult;
  error?: string;
}

export interface NUworksScanAllPagesResult {
  success: boolean;
  data?: NUworksPageExtractionResult;
  error?: string;
}

export interface NUworksScanAllPagesPayload {
  nativePostedDateFilter?: 'all' | '24h' | '7d';
}

export interface NUworksEnrichTopJobsPayload {
  jobs: Array<{
    title: string;
    company: string;
    location: string;
    jobId: string;
    postingDate: string;
    deadline: string;
    jobType: string;
    description: string;
    detailUrl: string;
    rawText: string;
  }>;
  topN?: number;
}

export interface NUworksEnrichTopJobsResult {
  success: boolean;
  data?: NUworksEnrichJobsResult;
  error?: string;
}

export interface ScanProgressPayload {
  data: NUworksScanProgress;
}

export interface EnrichProgressPayload {
  data: NUworksEnrichProgress;
}

export interface SendToLLMPayload {
  messages: LLMMessage[];
  pageContext: PageContext | null;
  llmConfig: LLMConfig;
  messageId: string;
  memoryContext?: {
    relevantMemories: string[];
    learnedPreferences: string[];
  };
}

export interface ExtractJobDataPayload {
  prompt: string;
  llmConfig: LLMConfig;
}

export interface ExtractJobDataResult {
  content: string;
}

export interface RunLLMUtilityPayload {
  prompt: string;
  llmConfig: LLMConfig;
}

export interface RunLLMUtilityResult {
  content: string;
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
