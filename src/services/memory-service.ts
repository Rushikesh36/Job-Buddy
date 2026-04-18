import type {
  ConversationSnapshot,
  MemoryBackupPayload,
  Memory,
  MemorySettings,
  MemoryStore,
  PreferenceCandidate,
  PromptMemoryContext,
  UserPreference,
} from '../types/memory';
import { DEFAULT_MEMORY_SETTINGS, DEFAULT_MEMORY_STORE } from '../types/memory';

const MEMORY_STORE_KEY = 'memoryStore';
const MEMORY_SETTINGS_KEY = 'memorySettings';
const SYNC_MEMORY_STORE_KEY = 'syncMemoryStore';
const SYNC_MEMORY_SETTINGS_KEY = 'syncMemorySettings';
const DAILY_BACKUP_KEY = 'memoryDailyBackup';
const LAST_DAILY_BACKUP_DATE_KEY = 'memoryDailyBackupDate';

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'for', 'in', 'on', 'with', 'is', 'are', 'be',
  'this', 'that', 'it', 'as', 'at', 'from', 'by', 'was', 'were', 'i', 'you', 'we', 'they',
  'about', 'into', 'your', 'our', 'their', 'but', 'if', 'then', 'than', 'so', 'can', 'will',
]);

function getStorage<T>(keys: string[]): Promise<Record<string, T>> {
  return new Promise((resolve) => {
    chrome.storage.local.get(keys, (result) => resolve(result as Record<string, T>));
  });
}

function setStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set(items, () => resolve());
  });
}

function getSyncStorage<T>(keys: string[]): Promise<Record<string, T>> {
  return new Promise((resolve) => {
    chrome.storage.sync.get(keys, (result) => resolve(result as Record<string, T>));
  });
}

function setSyncStorage(items: Record<string, unknown>): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.sync.set(items, () => resolve());
  });
}

function getLocalString(key: string): Promise<string | null> {
  return new Promise((resolve) => {
    chrome.storage.local.get([key], (result) => {
      resolve((result[key] as string) ?? null);
    });
  });
}

function setLocalString(key: string, value: string): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [key]: value }, () => resolve());
  });
}

export async function loadMemoryStore(): Promise<MemoryStore> {
  const result = await getStorage<MemoryStore>([MEMORY_STORE_KEY]);
  const localStore = result[MEMORY_STORE_KEY];
  if (localStore) return localStore;

  const syncResult = await getSyncStorage<MemoryStore>([SYNC_MEMORY_STORE_KEY]);
  const syncStore = syncResult[SYNC_MEMORY_STORE_KEY];
  if (syncStore) {
    await saveMemoryStore(syncStore);
    return syncStore;
  }

  return { ...DEFAULT_MEMORY_STORE };
}

export async function saveMemoryStore(store: MemoryStore): Promise<void> {
  await setStorage({ [MEMORY_STORE_KEY]: store });
  try {
    await setSyncStorage({ [SYNC_MEMORY_STORE_KEY]: store });
  } catch {
    // Ignore sync quota/account issues and keep local storage as the fallback.
  }
}

export async function loadMemorySettings(): Promise<MemorySettings> {
  const result = await getStorage<MemorySettings>([MEMORY_SETTINGS_KEY]);
  const localSettings = result[MEMORY_SETTINGS_KEY];
  if (localSettings) return localSettings;

  const syncResult = await getSyncStorage<MemorySettings>([SYNC_MEMORY_SETTINGS_KEY]);
  const syncSettings = syncResult[SYNC_MEMORY_SETTINGS_KEY];
  if (syncSettings) {
    await saveMemorySettings(syncSettings);
    return syncSettings;
  }

  return { ...DEFAULT_MEMORY_SETTINGS };
}

export async function saveMemorySettings(settings: MemorySettings): Promise<void> {
  await setStorage({ [MEMORY_SETTINGS_KEY]: settings });
  try {
    await setSyncStorage({ [SYNC_MEMORY_SETTINGS_KEY]: settings });
  } catch {
    // Ignore sync quota/account issues and keep local storage as the fallback.
  }
}

export function createMemoryBackupPayload(store: MemoryStore, settings: MemorySettings): MemoryBackupPayload {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    store,
    settings,
  };
}

export function stringifyMemoryBackup(payload: MemoryBackupPayload): string {
  return JSON.stringify(payload, null, 2);
}

export function parseMemoryBackupPayload(raw: string): MemoryBackupPayload {
  const parsed = JSON.parse(raw) as Partial<MemoryBackupPayload>;

  if (parsed?.version !== 1 || !parsed.store || !parsed.settings) {
    throw new Error('Invalid memory backup file.');
  }

  return {
    version: 1,
    exportedAt: typeof parsed.exportedAt === 'string' ? parsed.exportedAt : new Date().toISOString(),
    store: parsed.store,
    settings: parsed.settings,
  };
}

export async function loadDailyMemoryBackup(): Promise<MemoryBackupPayload | null> {
  const raw = await getLocalString(DAILY_BACKUP_KEY);
  if (!raw) return null;

  try {
    return parseMemoryBackupPayload(raw);
  } catch {
    return null;
  }
}

export async function saveDailyMemoryBackup(payload: MemoryBackupPayload): Promise<void> {
  const serialized = stringifyMemoryBackup(payload);
  await setLocalString(DAILY_BACKUP_KEY, serialized);
  try {
    await setSyncStorage({ [DAILY_BACKUP_KEY]: serialized });
  } catch {
    // Ignore sync quota/account issues and keep local storage as the fallback.
  }
  await setLocalString(LAST_DAILY_BACKUP_DATE_KEY, payload.exportedAt.slice(0, 10));
}

export async function getLastDailyMemoryBackupDate(): Promise<string | null> {
  return getLocalString(LAST_DAILY_BACKUP_DATE_KEY);
}

export function extractKeywords(text: string, topK = 12): string[] {
  const freq = new Map<string, number>();

  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3 && !STOP_WORDS.has(word));

  for (const word of words) {
    freq.set(word, (freq.get(word) ?? 0) + 1);
  }

  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topK)
    .map(([word]) => word);
}

function inferContentType(text: string): string[] {
  const lower = text.toLowerCase();
  const types = new Set<string>();

  if (lower.includes('cold email') || lower.includes('subject:')) types.add('cold_email');
  if (lower.includes('cover letter')) types.add('cover_letter');
  if (lower.includes('ats match score') || lower.includes('analyze this job')) types.add('analysis');
  if (types.size === 0) types.add('general');

  return [...types];
}

function extractCompany(summary: string): string | undefined {
  const match = summary.match(/(?:at|for)\s+([A-Z][A-Za-z0-9&\-\s]{2,40})/);
  return match?.[1]?.trim();
}

function extractRole(summary: string): string | undefined {
  const match = summary.match(/\b(software engineer|data engineer|machine learning engineer|backend engineer|frontend engineer|full[- ]stack engineer|intern|co-op)\b/i);
  return match?.[1];
}

export function parsePreferenceCandidates(raw: string): PreferenceCandidate[] {
  const fenced = raw.match(/```json\s*([\s\S]*?)\s*```/i)?.[1] ?? raw;
  const firstBracket = fenced.indexOf('[');
  const lastBracket = fenced.lastIndexOf(']');

  if (firstBracket === -1 || lastBracket === -1 || firstBracket >= lastBracket) {
    return [];
  }

  try {
    const parsed = JSON.parse(fenced.slice(firstBracket, lastBracket + 1)) as PreferenceCandidate[];
    return parsed
      .filter((item) => typeof item?.key === 'string' && typeof item?.value === 'string')
      .map((item) => ({ key: item.key.trim(), value: item.value.trim() }))
      .filter((item) => item.key && item.value);
  } catch {
    return [];
  }
}

export function mergePreferences(existing: UserPreference[], incoming: PreferenceCandidate[], memoryId: string): UserPreference[] {
  const next = [...existing];

  for (const candidate of incoming) {
    const idx = next.findIndex(
      (item) => item.key.toLowerCase() === candidate.key.toLowerCase() && item.value.toLowerCase() === candidate.value.toLowerCase()
    );

    if (idx >= 0) {
      const current = next[idx];
      next[idx] = {
        ...current,
        learnedFrom: memoryId,
        confidence: Math.min(1, Number((current.confidence + 0.15).toFixed(2))),
      };
    } else {
      next.push({
        key: candidate.key,
        value: candidate.value,
        learnedFrom: memoryId,
        confidence: 0.55,
      });
    }
  }

  return next.sort((a, b) => b.confidence - a.confidence);
}

export function createMemoryRecord(args: {
  snapshot: ConversationSnapshot;
  summary: string;
  preferenceCandidates: PreferenceCandidate[];
}): Memory {
  const combinedText = [
    args.summary,
    ...args.snapshot.messages.map((message) => message.content),
    args.snapshot.pageTitle ?? '',
    args.snapshot.pageUrl ?? '',
  ].join(' ');

  return {
    id: crypto.randomUUID(),
    summary: args.summary.trim(),
    keywords: extractKeywords(combinedText),
    company: extractCompany(args.summary),
    role: extractRole(args.summary),
    contentType: inferContentType(combinedText),
    preferences: args.preferenceCandidates.map((item) => `${item.key}: ${item.value}`),
    timestamp: Date.now(),
    messageCount: args.snapshot.messages.length,
  };
}

export function applyMemoryLimits(memories: Memory[], settings: MemorySettings): Memory[] {
  const now = Date.now();
  const cutoff = now - settings.retentionDays * 24 * 60 * 60 * 1000;

  const retained = memories
    .filter((memory) => memory.timestamp >= cutoff)
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, settings.maxMemories);

  return retained;
}

export function searchMemories(query: string, memories: Memory[], topK = 3): Memory[] {
  const queryWords = query
    .toLowerCase()
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length > 1);

  if (!queryWords.length || !memories.length) return [];

  const now = Date.now();
  const monthMs = 30 * 24 * 60 * 60 * 1000;

  const scored = memories.map((memory) => {
    const memoryText = `${memory.summary} ${memory.keywords.join(' ')} ${memory.company ?? ''} ${memory.role ?? ''}`.toLowerCase();

    const lexicalScore = queryWords.reduce((acc, word) => acc + (memoryText.includes(word) ? 1 : 0), 0);
    const recencyBoost = Math.max(0, 1 - (now - memory.timestamp) / monthMs) * 0.5;

    return {
      memory,
      score: lexicalScore + recencyBoost,
    };
  });

  return scored
    .filter((item) => item.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => item.memory);
}

export function buildPromptMemoryContext(memories: Memory[], preferences: UserPreference[]): PromptMemoryContext {
  return {
    relevantMemories: memories.map((memory) => `- ${memory.summary}`),
    learnedPreferences: preferences
      .filter((item) => item.confidence >= 0.65)
      .slice(0, 8)
      .map((item) => `- ${item.key}: ${item.value}`),
  };
}

export function estimateMemoryUsageBytes(store: MemoryStore): number {
  return new TextEncoder().encode(JSON.stringify(store)).length;
}
