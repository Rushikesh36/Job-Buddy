import type { ChatMessage } from '../lib/types';

export interface Memory {
  id: string;
  summary: string;
  keywords: string[];
  company?: string;
  role?: string;
  contentType: string[];
  preferences: string[];
  timestamp: number;
  messageCount: number;
}

export interface UserPreference {
  key: string;
  value: string;
  learnedFrom: string;
  confidence: number;
}

export interface MemoryStore {
  memories: Memory[];
  preferences: UserPreference[];
}

export interface MemoryBackupPayload {
  version: 1;
  exportedAt: string;
  store: MemoryStore;
  settings: MemorySettings;
}

export interface MemorySettings {
  autoSummarize: boolean;
  maxMemories: number;
  retentionDays: number;
}

export interface PromptMemoryContext {
  relevantMemories: string[];
  learnedPreferences: string[];
}

export interface PreferenceCandidate {
  key: string;
  value: string;
}

export interface ConversationSnapshot {
  messages: ChatMessage[];
  pageUrl?: string;
  pageTitle?: string;
}

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  autoSummarize: true,
  maxMemories: 500,
  retentionDays: 180,
};

export const DEFAULT_MEMORY_STORE: MemoryStore = {
  memories: [],
  preferences: [],
};
