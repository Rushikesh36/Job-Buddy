import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import type { ChangeEvent } from 'react';
import type {
  ChatMessage,
  PageContext,
  LLMMessage,
  LLMProvider,
  ProviderSettings,
  GoogleAuthState,
  GoogleSettings,
  ExtractJobDataResult,
  RunLLMUtilityResult,
} from '../lib/types';
import { DEFAULT_PROVIDER_SETTINGS, DEFAULT_GOOGLE_AUTH_STATE, DEFAULT_GOOGLE_SETTINGS } from '../lib/types';
import { PROVIDER_META } from '../lib/llm-api';
import { MY_PROFILE } from '../lib/profile';
import {
  connectGoogleAccount,
  disconnectGoogleAccount,
  getGoogleRedirectUri,
  loadGoogleAuthState,
  loadGoogleSettings,
  saveGoogleSettings,
} from '../services/google-auth';
import {
  appendJobToSheet,
  createNewSpreadsheetWithSecret,
  loadAppliedJobLookup,
  loadSheetsConfig,
  markJobAsEmailed,
  normalizeSpreadsheetId,
  saveSheetsConfig,
  type AppliedJobLookup,
} from '../services/sheets-service';
import { buildJobHuntSummary, loadActivityStore, recordApplication, recordOutreach, saveActivityStore, type ActivityStore } from '../services/activity-service';
import { buildJobExtractionPrompt, toJobDraft } from '../prompts/job-extractor';
import type { JobData, SheetsConfig } from '../types/job';
import { DEFAULT_SHEETS_CONFIG } from '../types/job';
import { detectEmailDraft, extractEmailCandidates, saveGmailDraft, sendEmailViaGmail } from '../services/gmail-service';
import type { EmailDraft, OutreachEmailType } from '../types/email';
import { buildConversationSummaryPrompt } from '../prompts/summarizer';
import { buildPreferenceExtractionPrompt } from '../prompts/preference-extractor';
import { generateSmartEmailDraft } from '../services/email-generator';
import {
  applyMemoryLimits,
  createMemoryBackupPayload,
  buildPromptMemoryContext,
  createMemoryRecord,
  estimateMemoryUsageBytes,
  getLastDailyMemoryBackupDate,
  loadMemorySettings,
  saveDailyMemoryBackup,
  loadMemoryStore,
  mergePreferences,
  parsePreferenceCandidates,
  parseMemoryBackupPayload,
  stringifyMemoryBackup,
  saveMemorySettings,
  saveMemoryStore,
  searchMemories,
} from '../services/memory-service';
import type { MemorySettings, MemoryStore, PromptMemoryContext } from '../types/memory';
import { DEFAULT_MEMORY_SETTINGS, DEFAULT_MEMORY_STORE } from '../types/memory';
import type {
  NUworksDetectionResult,
  NUworksEnrichProgress,
  NUworksPageExtractionResult,
  RawJobListing,
  NUworksScanProgress,
  ScanCache,
  ScoredJob,
  ScoringProgress,
} from '../types/scanner';
import { SCANNER_DEBUG_MODE_STORAGE_KEY } from '../types/scanner';
import { scoreJobsInBatches } from '../services/job-scorer';
import {
  buildScanCache,
  getJobCacheKey,
  loadScanCache,
  markJobsByCache,
  saveScanCache,
} from '../services/scan-cache';
import {
  filterOutFullyProcessedJobs,
  markJobsScanned,
  markJobsShortlisted,
} from '../services/processed-job-registry';
import {
  clearScannerShortlist,
  loadScannerShortlist,
  saveScannerShortlist,
} from '../services/scanner-shortlist';
import {
  loadScannerState,
  saveScannerState,
  clearScannerState,
} from '../services/scanner-state-persistence';
import ChatWindow from './components/ChatWindow';
import InputBar from './components/InputBar';
import PageContextBanner from './components/PageContextBanner';
import GoogleConnectButton from './components/GoogleConnectButton';
import JobSaveModal from './components/JobSaveModal';
import EmailComposeModal from './components/EmailComposeModal';
import MemoryPanel from './components/MemoryPanel';
import ScannerTab from './components/scanner/ScannerTab';

const PROVIDERS: LLMProvider[] = ['claude', 'gemini', 'openai', 'openrouter'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadSettings(): Promise<ProviderSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['providerSettings'], (result) => {
      const raw = (result.providerSettings as Partial<ProviderSettings>) ?? DEFAULT_PROVIDER_SETTINGS;
      const selectedProvider = PROVIDERS.includes(raw.selectedProvider as LLMProvider)
        ? (raw.selectedProvider as LLMProvider)
        : DEFAULT_PROVIDER_SETTINGS.selectedProvider;

      resolve({
        selectedProvider,
        apiKeys: {
          ...DEFAULT_PROVIDER_SETTINGS.apiKeys,
          ...(raw.apiKeys ?? {}),
        },
        selectedModels: {
          ...DEFAULT_PROVIDER_SETTINGS.selectedModels,
          ...(raw.selectedModels ?? {}),
        },
      });
    });
  });
}

function saveSettings(settings: ProviderSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ providerSettings: settings }, resolve);
  });
}

function loadScannerDebugMode(): Promise<boolean> {
  return new Promise((resolve) => {
    chrome.storage.local.get([SCANNER_DEBUG_MODE_STORAGE_KEY], (result) => {
      resolve(Boolean(result[SCANNER_DEBUG_MODE_STORAGE_KEY]));
    });
  });
}

function saveScannerDebugMode(enabled: boolean): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ [SCANNER_DEBUG_MODE_STORAGE_KEY]: enabled }, resolve);
  });
}

function toScannerJobData(job: RawJobListing | ScoredJob, resumeVersion: string): JobData {
  const scored = 'matchScore' in job;
  const baseNotes = scored
    ? [
        `Scanner Match Score: ${job.matchScore}/10`,
        `Match Reason: ${job.matchReason || 'N/A'}`,
        `Matching Skills: ${(job.matchingSkills || []).join(', ') || 'N/A'}`,
        `Missing Skills: ${(job.missingSkills || []).join(', ') || 'N/A'}`,
        `Visa Flag: ${job.visaFlag || 'yellow'}`,
      ].join(' | ')
    : 'Saved from NUworks scanner';

  return {
    dateApplied: new Date().toISOString(),
    company: job.company || 'N/A',
    role: job.title || 'N/A',
    location: job.location || 'N/A',
    jobId: job.jobId || 'N/A',
    jobUrl: job.detailUrl || 'N/A',
    keyRequirements: scored ? (job.matchingSkills || []).slice(0, 5) : [],
    salaryRange: 'N/A',
    visaSponsorship: 'Unknown',
    atsScore: scored ? job.matchScore : 0,
    resumeVersion,
    status: 'Saved',
    notes: baseNotes,
  };
}

function toCsvValue(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}

function exportScannerJobsCsv(jobs: Array<RawJobListing | ScoredJob>): void {
  const headers = [
    'Title',
    'Company',
    'Location',
    'Job ID',
    'Detail URL',
    'Match Score',
    'Match Reason',
    'Matching Skills',
    'Missing Skills',
    'Visa Flag',
    'Is New',
  ];

  const rows = jobs.map((job) => {
    const scored = 'matchScore' in job;
    return [
      job.title || '',
      job.company || '',
      job.location || '',
      job.jobId || '',
      job.detailUrl || '',
      scored ? String(job.matchScore) : '',
      scored ? job.matchReason || '' : '',
      scored ? (job.matchingSkills || []).join('; ') : '',
      scored ? (job.missingSkills || []).join('; ') : '',
      scored ? job.visaFlag || '' : '',
      job.isNew ? 'YES' : 'NO',
    ].map((value) => toCsvValue(value));
  });

  const csv = [headers.map((value) => toCsvValue(value)).join(','), ...rows.map((row) => row.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `nuworks-scan-${new Date().toISOString().slice(0, 10)}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeScannerLookupPart(value: string): string {
  return value.trim().toLowerCase();
}

function normalizeUrlForLookup(value: string): string {
  const raw = value.trim();
  if (!raw) return '';

  try {
    const parsed = new URL(raw);
    const normalizedPath = parsed.pathname.replace(/\/+$/, '');
    return `${parsed.origin.toLowerCase()}${normalizedPath.toLowerCase()}`;
  } catch {
    return raw.toLowerCase().split('#')[0].split('?')[0].replace(/\/+$/, '');
  }
}

function getScannerLookupKeys(job: RawJobListing | ScoredJob): string[] {
  const keys: string[] = [];
  const jobId = normalizeScannerLookupPart(job.jobId ?? '');
  const detailUrl = normalizeScannerLookupPart(job.detailUrl ?? '');
  const title = normalizeScannerLookupPart(job.title ?? '');
  const company = normalizeScannerLookupPart(job.company ?? '');

  if (jobId) keys.push(`id:${jobId}`);
  if (detailUrl && detailUrl !== 'n/a') keys.push(`url:${detailUrl}`);
  if (title && company) keys.push(`tc:${title}::${company}`);

  return keys;
}

function isJobApplied(job: RawJobListing | ScoredJob, lookup: AppliedJobLookup): boolean {
  const keys = getScannerLookupKeys(job);
  return keys.some((key) => Boolean(lookup[key]));
}

function applyAppliedStatus<T extends RawJobListing | ScoredJob>(jobs: T[], lookup: AppliedJobLookup): T[] {
  return jobs.map((job) => ({
    ...job,
    appliedStatus: isJobApplied(job, lookup) ? 'applied' : 'not-applied',
  }));
}

type ScannerDateFilter = 'all' | '24h' | '3d' | '7d';
const PROFILE_FIT_SCORE_THRESHOLD = 7;
const PROFILE_FIT_RELAXED_SCORE_THRESHOLD = 5;
const PROFILE_FIT_RELAXED_LIMIT = 10;
const PROFILE_FIT_NON_RED_FALLBACK_LIMIT = 5;

const SCANNER_HARD_EXCLUDE_PATTERNS: RegExp[] = [
  /\bnot\s+qualified\b/i,
  /\bus\s+citizen(ship)?\s+(required|only)\b/i,
  /\bcitizens?\s+only\b/i,
  /\bmust\s+be\s+(a\s+)?u\.?s\.?\s+citizen\b/i,
  /\bunpaid\b/i,
  /\bno\s+compensation\b/i,
  /\bwithout\s+compensation\b/i,
  /\bvolunteer\b/i,
];

function hasScannerHardExclusion(text: string): boolean {
  if (!text) return false;
  return SCANNER_HARD_EXCLUDE_PATTERNS.some((pattern) => pattern.test(text));
}

function filterJobsByEligibility<T extends RawJobListing | ScoredJob>(jobs: T[]): T[] {
  return jobs.filter((job) => {
    const combinedText = [
      job.title,
      job.company,
      job.location,
      job.postingDate,
      job.deadline,
      job.jobType,
      job.description,
      job.rawText,
    ].filter(Boolean).join(' | ');

    return !hasScannerHardExclusion(combinedText);
  });
}

function isPaidJob(job: RawJobListing | ScoredJob): boolean {
  const combinedText = [
    job.title,
    job.company,
    job.location,
    job.postingDate,
    job.deadline,
    job.jobType,
    job.description,
    job.rawText,
  ].filter(Boolean).join(' | ');

  return !hasScannerHardExclusion(combinedText);
}

function filterScoredByProfileFit(jobs: ScoredJob[]): ScoredJob[] {
  const passed = jobs.filter((job) => job.matchScore >= PROFILE_FIT_SCORE_THRESHOLD && job.visaFlag !== 'red' && isPaidJob(job));
  const filtered = jobs.length - passed.length;
  if (filtered > 0) {
    console.log(`[ProfileFit] Filtered out ${filtered} jobs:`);
    jobs.forEach((job) => {
      const scoreOk = job.matchScore >= PROFILE_FIT_SCORE_THRESHOLD;
      const visaOk = job.visaFlag !== 'red';
      const paidOk = isPaidJob(job);
      if (!scoreOk || !visaOk || !paidOk) {
        console.log(`  - ${job.company} / ${job.title}: score=${job.matchScore}(${scoreOk?'✓':'✗'}) visa=${job.visaFlag}(${visaOk?'✓':'✗'}) paid=${paidOk?'✓':'✗'}`);
      }
    });
  }
  return passed;
}

type ProfileFitSelectionMode = 'strict' | 'relaxed' | 'non-red-fallback';

function selectProfileFitJobs(jobs: ScoredJob[]): { jobs: ScoredJob[]; mode: ProfileFitSelectionMode } {
  const strict = filterScoredByProfileFit(jobs);
  return { jobs: strict, mode: 'strict' };
}

function parseRelativeDate(text: string, nowMs: number): Date | null {
  const value = text.toLowerCase();
  if (/(just posted|today|posted today)/i.test(value)) return new Date(nowMs);
  if (/(yesterday|posted yesterday)/i.test(value)) return new Date(nowMs - 24 * 60 * 60 * 1000);

  // NUworks commonly renders compact ages like "1d", "2d", "12h".
  const compactMatch = value.match(/\b(\d+)\s*(h|hr|hrs|d|w|m)\b/i);
  if (compactMatch) {
    const amount = Number.parseInt(compactMatch[1], 10);
    const unit = compactMatch[2].toLowerCase();
    if (Number.isFinite(amount)) {
      if (unit === 'h' || unit === 'hr' || unit === 'hrs') {
        return new Date(nowMs - amount * 60 * 60 * 1000);
      }
      if (unit === 'd') {
        return new Date(nowMs - amount * 24 * 60 * 60 * 1000);
      }
      if (unit === 'w') {
        return new Date(nowMs - amount * 7 * 24 * 60 * 60 * 1000);
      }
      if (unit === 'm') {
        return new Date(nowMs - amount * 30 * 24 * 60 * 60 * 1000);
      }
    }
  }

  const hoursMatch = value.match(/(\d+)\s*(hour|hours|hr|hrs)\s*ago/i);
  if (hoursMatch) {
    const hours = Number.parseInt(hoursMatch[1], 10);
    if (Number.isFinite(hours)) return new Date(nowMs - hours * 60 * 60 * 1000);
  }

  const daysMatch = value.match(/(\d+)\s*(day|days)\s*ago/i);
  if (daysMatch) {
    const days = Number.parseInt(daysMatch[1], 10);
    if (Number.isFinite(days)) return new Date(nowMs - days * 24 * 60 * 60 * 1000);
  }

  return null;
}

function parseDateCandidate(value: string, nowMs: number): Date | null {
  const raw = value.trim();
  if (!raw) return null;

  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) return direct;

  return parseRelativeDate(raw, nowMs);
}

function extractPostingDate(job: RawJobListing | ScoredJob, nowMs: number): Date | null {
  const posting = parseDateCandidate(job.postingDate, nowMs);
  if (posting) return posting;

  const textCandidates = [job.rawText, job.description].filter(Boolean);
  for (const text of textCandidates) {
    const postedHint = text.match(/(?:posted(?:\s+on)?|posting\s*date|date\s*posted)\s*[:\-]?\s*([^\n|,;]{3,40})/i);
    if (postedHint?.[1]) {
      const hinted = parseDateCandidate(postedHint[1], nowMs);
      if (hinted) return hinted;
    }

    const relative = parseRelativeDate(text, nowMs);
    if (relative) return relative;
  }

  return null;
}

function filterJobsByDate<T extends RawJobListing | ScoredJob>(jobs: T[], filter: ScannerDateFilter, nowMs = Date.now()): T[] {
  const eligibleJobs = filterJobsByEligibility(jobs);
  if (filter === 'all') return eligibleJobs;

  const windowMs = filter === '24h'
    ? 24 * 60 * 60 * 1000
    : filter === '3d'
      ? 3 * 24 * 60 * 60 * 1000
      : 7 * 24 * 60 * 60 * 1000;

  return eligibleJobs.filter((job) => {
    const postedAt = extractPostingDate(job, nowMs);
    if (!postedAt) return false;
    const age = nowMs - postedAt.getTime();
    return age <= windowMs;
  });
}

// ─── App ──────────────────────────────────────────────────────────────────────

type View = 'chat' | 'scanner' | 'memory' | 'settings';
type ToastType = 'success' | 'error';
interface ToastState {
  type: ToastType;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
}

interface EmailGenerationSeed {
  userIntentText: string;
  source: 'scanner' | 'manual' | 'chat';
  pageTitle?: string;
  pageUrl?: string;
  pageText?: string;
  companyName?: string;
  roleTitle?: string;
  recruiterName?: string;
  recipientCandidates?: string[];
  chatContext?: string;
  memoryContext?: string;
  resumeVersion?: string;
}

export default function App() {
  // ── state ──
  const [view, setView] = useState<View>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [nuworksDetection, setNuworksDetection] = useState<NUworksDetectionResult | null>(null);
  const [nuworksCurrentPageJobs, setNuworksCurrentPageJobs] = useState<NUworksPageExtractionResult | null>(null);
  const [nuworksScanProgress, setNuworksScanProgress] = useState<NUworksScanProgress | null>(null);
  const [nuworksEnrichProgress, setNuworksEnrichProgress] = useState<NUworksEnrichProgress | null>(null);
  const [nuworksScoredJobs, setNuworksScoredJobs] = useState<ScoredJob[]>([]);
  const [scannerScoringProgress, setScannerScoringProgress] = useState<ScoringProgress | null>(null);
  const [scanCache, setScanCache] = useState<ScanCache | null>(null);
  const [scanNewOnly, setScanNewOnly] = useState(false);
  const [showProfileFitOnly, setShowProfileFitOnly] = useState(true);
  const [scannerDateFilter, setScannerDateFilter] = useState<ScannerDateFilter>('all');
  const [newJobsCount, setNewJobsCount] = useState(0);
  const [processedSkipCount, setProcessedSkipCount] = useState(0);
  const [appliedJobLookup, setAppliedJobLookup] = useState<AppliedJobLookup>({});
  const [profileFitPageIndex, setProfileFitPageIndex] = useState(0);
  const [allJobsPageIndex, setAllJobsPageIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingPage, setIsReadingPage] = useState(false);
  const [isScanningAllPages, setIsScanningAllPages] = useState(false);
  const [isEnrichingJobs, setIsEnrichingJobs] = useState(false);
  const [isScoringJobs, setIsScoringJobs] = useState(false);
  const [isSavingScannerJobs, setIsSavingScannerJobs] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [scannerDebugMode, setScannerDebugMode] = useState(false);
  const scannerActionBusy = isScanningAllPages || isEnrichingJobs || isScoringJobs || isSavingScannerJobs;

  const getDateFilteredJobs = useCallback(
    <T extends RawJobListing | ScoredJob>(jobs: T[]): T[] => filterJobsByDate(jobs, scannerDateFilter),
    [scannerDateFilter]
  );

  const currentPageJobsWithApplied = useMemo(() => {
    if (!nuworksCurrentPageJobs) return null;
    return {
      ...nuworksCurrentPageJobs,
      jobs: applyAppliedStatus(nuworksCurrentPageJobs.jobs, appliedJobLookup),
    };
  }, [nuworksCurrentPageJobs, appliedJobLookup]);

  const scoredJobsWithApplied = useMemo(
    () => applyAppliedStatus(nuworksScoredJobs, appliedJobLookup),
    [nuworksScoredJobs, appliedJobLookup]
  );

  const filteredCurrentPageJobs = useMemo(() => {
    if (!currentPageJobsWithApplied) return null;
    return {
      ...currentPageJobsWithApplied,
      jobs: getDateFilteredJobs(currentPageJobsWithApplied.jobs),
    };
  }, [currentPageJobsWithApplied, getDateFilteredJobs]);

  const allScoredJobs = useMemo(
    () => getDateFilteredJobs(scoredJobsWithApplied),
    [getDateFilteredJobs, scoredJobsWithApplied]
  );

  const profileFitJobs = useMemo(
    () => selectProfileFitJobs(allScoredJobs).jobs,
    [allScoredJobs]
  );

  // Monitor scored jobs state
  useEffect(() => {
    console.log('[State Monitor] Scored jobs state:', {
      nuworksScoredJobs: nuworksScoredJobs.length,
      allScoredJobs: allScoredJobs.length,
      profileFitJobs: profileFitJobs.length,
      dateFilter: scannerDateFilter,
    });
  }, [nuworksScoredJobs, allScoredJobs, profileFitJobs, scannerDateFilter]);

  // provider settings (persisted)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(DEFAULT_PROVIDER_SETTINGS);

  // settings-view local state
  const [settingsTab, setSettingsTab] = useState<LLMProvider>('claude');
  // per-provider key inputs (draft values, not saved yet)
  const [keyInputs, setKeyInputs] = useState<Record<LLMProvider, string>>({
    claude: '',
    gemini: '',
    openai: '',
    openrouter: '',
  });
  const [keyVisible, setKeyVisible] = useState<LLMProvider | null>(null);
  const [customModelInputs, setCustomModelInputs] = useState<Record<LLMProvider, string>>({
    claude: '',
    gemini: '',
    openai: '',
    openrouter: '',
  });
  const [googleSettings, setGoogleSettingsState] = useState<GoogleSettings>(DEFAULT_GOOGLE_SETTINGS);
  const [googleClientIdInput, setGoogleClientIdInput] = useState('');
  const [googleClientSecretInput, setGoogleClientSecretInput] = useState('');
  const [googleAuthState, setGoogleAuthState] = useState<GoogleAuthState>(DEFAULT_GOOGLE_AUTH_STATE);
  const [isGoogleAuthBusy, setIsGoogleAuthBusy] = useState(false);
  const [sheetsConfig, setSheetsConfigState] = useState<SheetsConfig>(DEFAULT_SHEETS_CONFIG);
  const [spreadsheetIdInput, setSpreadsheetIdInput] = useState('');
  const [resumeVersionInput, setResumeVersionInput] = useState('');
  const [isSheetCreateBusy, setIsSheetCreateBusy] = useState(false);
  const [isExtractingJob, setIsExtractingJob] = useState(false);
  const [isSavingJob, setIsSavingJob] = useState(false);
  const [isJobSaveModalOpen, setIsJobSaveModalOpen] = useState(false);
  const [jobDraft, setJobDraft] = useState<JobData | null>(null);
  const [emailMessageIds, setEmailMessageIds] = useState<Record<string, boolean>>({});
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);
  const [isEmailComposeOpen, setIsEmailComposeOpen] = useState(false);
  const [isEmailBusy, setIsEmailBusy] = useState(false);
  const [emailGenerationSeed, setEmailGenerationSeed] = useState<EmailGenerationSeed | null>(null);
  const [selectedEmailType, setSelectedEmailType] = useState<OutreachEmailType>('cold-recruiter');
  const [emailTypeConfidence, setEmailTypeConfidence] = useState<number | null>(null);
  const recipientSuggestions = useMemo(() => {
    const pageEmails = extractEmailCandidates(pageContext?.textContent);
    const draftEmails = extractEmailCandidates(emailDraft?.body);
    const merged = [...pageEmails, ...draftEmails];
    return Array.from(new Set(merged)).slice(0, 8);
  }, [pageContext?.textContent, emailDraft?.body]);

  const [memoryStore, setMemoryStore] = useState<MemoryStore>(DEFAULT_MEMORY_STORE);
  const [memorySettings, setMemorySettingsState] = useState<MemorySettings>(DEFAULT_MEMORY_SETTINGS);
  const [loadedMemoryCount, setLoadedMemoryCount] = useState(0);
  const [lastPromptMemoryContext, setLastPromptMemoryContext] = useState<PromptMemoryContext | null>(null);
  const [isMemoryBusy, setIsMemoryBusy] = useState(false);
  const [lastDailyBackupDate, setLastDailyBackupDate] = useState<string | null>(null);
  const [activityStore, setActivityStore] = useState<ActivityStore>({ days: [] });
  const memoryBackupInputRef = useRef<HTMLInputElement>(null);
  const hasHydratedMemoryRef = useRef(false);
  const dailyBackupInFlightRef = useRef(false);
  const lastAutoSavedAssistantIdRef = useRef<string | null>(null);

  const streamingMsgIdRef = useRef<string | null>(null);
  // Synchronous guard against double-sends before React re-renders with isLoading:true
  const isSendingRef = useRef(false);

  const refreshAppliedJobLookup = useCallback(async () => {
    const clientId = googleSettings.clientId.trim();
    const spreadsheetId = sheetsConfig.spreadsheetId;
    if (!googleAuthState.isConnected || !clientId || !spreadsheetId) {
      setAppliedJobLookup({});
      return;
    }

    try {
      const lookup = await loadAppliedJobLookup({
        clientId,
        clientSecret: googleSettings.clientSecret,
        spreadsheetId,
      });
      setAppliedJobLookup(lookup);
    } catch {
      setAppliedJobLookup({});
    }
  }, [googleAuthState.isConnected, googleSettings.clientId, googleSettings.clientSecret, sheetsConfig.spreadsheetId]);

  // ── on mount: load settings ──
  useEffect(() => {
    Promise.all([
      loadSettings(),
      loadGoogleSettings(),
      loadGoogleAuthState(),
      loadSheetsConfig(),
      loadMemoryStore(),
      loadMemorySettings(),
      getLastDailyMemoryBackupDate(),
      loadActivityStore(),
      loadScannerDebugMode(),
    ]).then(
      ([
        settings,
        storedGoogleSettings,
        storedGoogleAuthState,
        storedSheetsConfig,
        storedMemoryStore,
        storedMemorySettings,
        storedLastDailyBackupDate,
        storedActivityStore,
        storedScannerDebugMode,
      ]) => {
        setProviderSettings(settings);
        setSettingsTab(settings.selectedProvider);
        setCustomModelInputs(settings.selectedModels);
        setGoogleSettingsState(storedGoogleSettings);
        setGoogleClientIdInput(storedGoogleSettings.clientId);
        setGoogleClientSecretInput(storedGoogleSettings.clientSecret ?? '');
        setGoogleAuthState(storedGoogleAuthState);
        setSheetsConfigState(storedSheetsConfig);
        setSpreadsheetIdInput(storedSheetsConfig.spreadsheetId ?? '');
        setMemoryStore(storedMemoryStore);
        setMemorySettingsState(storedMemorySettings);
        setLastDailyBackupDate(storedLastDailyBackupDate);
        setActivityStore(storedActivityStore);
        setScannerDebugMode(storedScannerDebugMode);
        hasHydratedMemoryRef.current = true;
        const activeKey = settings.apiKeys[settings.selectedProvider];
        if (!activeKey) setView('settings');
      }
    );
  }, []);

  useEffect(() => {
    let cancelled = false;

    const hydrateScannerState = async () => {
      const [cached, shortlistCache, persistedState] = await Promise.all([
        loadScanCache(),
        loadScannerShortlist(),
        loadScannerState(),
      ]);
      
      if (!cancelled) {
        setScanCache(cached);
        
        // Load persisted scanned and scored jobs
        if (persistedState) {
          if (persistedState.scannedJobs?.length) {
            setNuworksCurrentPageJobs(
              persistedState.currentPageExtraction || {
                jobs: persistedState.scannedJobs,
                diagnostics: {
                  strategyUsed: 'structured',
                  attemptedStrategies: ['structured'],
                  structuredCandidates: persistedState.scannedJobs.length,
                  textPatternCandidates: 0,
                  deduplicatedCount: persistedState.scannedJobs.length,
                  skippedEmptyTitleCount: 0,
                },
                llmFallbackInput: {
                  pageUrl: 'restored',
                  pageTitle: 'Restored Scanned Jobs',
                  pageTextSample: '',
                },
                extractedAt: new Date().toISOString(),
              }
            );
          }
          
          if (persistedState.scoredJobs?.length) {
            setNuworksScoredJobs(persistedState.scoredJobs);
          }
        }
        
        // Also check shortlist cache for backwards compatibility
        if (shortlistCache?.jobs?.length) {
          void markJobsShortlisted(shortlistCache.jobs);
          setNuworksScoredJobs(shortlistCache.jobs);
          setNuworksCurrentPageJobs({
            jobs: shortlistCache.jobs,
            diagnostics: {
              strategyUsed: 'structured',
              attemptedStrategies: ['structured'],
              structuredCandidates: shortlistCache.jobs.length,
              textPatternCandidates: 0,
              deduplicatedCount: shortlistCache.jobs.length,
              skippedEmptyTitleCount: 0,
            },
            llmFallbackInput: {
              pageUrl: shortlistCache.sourceUrl,
              pageTitle: 'Saved Apply List',
              pageTextSample: '',
            },
            extractedAt: shortlistCache.createdAt,
          });
        }
      }
    };

    void hydrateScannerState();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void refreshAppliedJobLookup();
  }, [refreshAppliedJobLookup]);

  useEffect(() => {
    if (!hasHydratedMemoryRef.current) return;
    if (dailyBackupInFlightRef.current) return;

    let cancelled = false;

    const runDailyBackup = async () => {
      const today = new Date().toISOString().slice(0, 10);
      const lastBackupDate = await getLastDailyMemoryBackupDate();
      if (cancelled || lastBackupDate === today) return;

      dailyBackupInFlightRef.current = true;
      try {
        const payload = createMemoryBackupPayload(memoryStore, memorySettings);
        await saveDailyMemoryBackup(payload);
        setLastDailyBackupDate(today);
      } finally {
        dailyBackupInFlightRef.current = false;
      }
    };

    void runDailyBackup();

    return () => {
      cancelled = true;
    };
  }, [memoryStore, memorySettings]);

  useEffect(() => {
    if (!toast) return;

    const timeoutId = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timeoutId);
  }, [toast]);

  useEffect(() => {
    const flags: Record<string, boolean> = {};

    messages.forEach((msg, index) => {
      if (msg.role !== 'assistant') return;

      const previousUser = [...messages.slice(0, index)]
        .reverse()
        .find((item) => item.role === 'user')?.content;

      const detected = detectEmailDraft({
        assistantContent: msg.content,
        previousUserMessage: previousUser,
        pageText: pageContext?.textContent,
        resumeVersion: sheetsConfig.resumeVersions[0],
      });

      if (detected.isEmailLike) {
        flags[msg.id] = true;
      }
    });

    setEmailMessageIds(flags);
  }, [messages, pageContext?.textContent, sheetsConfig.resumeVersions]);

  // ── stream listener ──
  useEffect(() => {
    const handler = (message: { type: string; payload?: unknown }) => {
      if (message.type === 'CLAUDE_STREAM_CHUNK') {
        const { chunk, messageId } = message.payload as { chunk: string; messageId: string };
        if (streamingMsgIdRef.current !== messageId) return;

        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last && last.id === messageId) {
            return [...prev.slice(0, -1), { ...last, content: last.content + chunk }];
          }
          return [
            ...prev,
            { id: messageId, role: 'assistant', content: chunk, timestamp: new Date() },
          ];
        });
      }

      if (message.type === 'CLAUDE_STREAM_DONE') {
        setIsLoading(false);
        streamingMsgIdRef.current = null;
        isSendingRef.current = false;
      }

      if (message.type === 'CLAUDE_STREAM_ERROR') {
        const { error } = message.payload as { error: string };
        setIsLoading(false);
        streamingMsgIdRef.current = null;
        isSendingRef.current = false;
        setErrorBanner(error);
        setMessages((prev) => {
          const last = prev[prev.length - 1];
          if (last?.role === 'assistant' && last.content === '') return prev.slice(0, -1);
          return prev;
        });
      }

      if (message.type === 'SCAN_PROGRESS') {
        const payload = message.payload as { data?: NUworksScanProgress };
        if (!payload?.data) return;
        setNuworksScanProgress(payload.data);
      }

      if (message.type === 'ENRICH_PROGRESS') {
        const payload = message.payload as { data?: NUworksEnrichProgress };
        if (!payload?.data) return;
        setNuworksEnrichProgress(payload.data);
      }
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // ── actions ──
  const readActivePageContext = useCallback(() => {
    return new Promise<PageContext>((resolve, reject) => {
      chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' }, (response) => {
        if (chrome.runtime.lastError || !response?.success || !response?.data) {
          reject(new Error(response?.error ?? chrome.runtime.lastError?.message ?? "Couldn't read this page."));
          return;
        }

        resolve(response.data as PageContext);
      });
    });
  }, []);

  const handleReadPage = useCallback(async () => {
    setIsReadingPage(true);
    setErrorBanner(null);
    setNuworksDetection(null);
    setNuworksCurrentPageJobs(null);
    setNuworksScoredJobs([]);
    setScannerScoringProgress(null);
    try {
      const data = await readActivePageContext();
      setPageContext(data);

      chrome.runtime.sendMessage({ type: 'NUWORKS_DETECT_PAGE' }, (detectionResponse) => {
        if (chrome.runtime.lastError || !detectionResponse?.success) {
          return;
        }

        const detection = detectionResponse.data as NUworksDetectionResult;
        setNuworksDetection(detection);

        if (!detection.isNUworksPage || !detection.isJobListingPage) {
          return;
        }

        chrome.runtime.sendMessage({ type: 'NUWORKS_EXTRACT_CURRENT_PAGE' }, (extractResponse) => {
          if (chrome.runtime.lastError || !extractResponse?.success) {
            return;
          }

          const extraction = extractResponse.data as NUworksPageExtractionResult;
          setNuworksCurrentPageJobs(extraction);

          if (extraction.jobs.length > 0) {
            setToast({
              type: 'success',
              message: `NUworks scan: found ${extraction.jobs.length} jobs on this page.`,
            });
          } else if (extraction.diagnostics.strategyUsed === 'llm-fallback-pending') {
            setToast({
              type: 'error',
              message: 'No structured listings found on this page yet. LLM fallback will be used in the next step.',
            });
          }
        });
      });
    } catch (error) {
      setErrorBanner(error instanceof Error ? error.message : "Couldn't read this page.");
    } finally {
      setIsReadingPage(false);
    }
  }, [readActivePageContext]);

  const handleScannerDebugModeToggle = useCallback(async (enabled: boolean) => {
    setScannerDebugMode(enabled);
    await saveScannerDebugMode(enabled);
  }, []);

  const handleScanNUworksAllPages = useCallback(() => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait for current operation to finish.' });
      return;
    }

    setErrorBanner(null);
    setNuworksCurrentPageJobs(null);
    setNuworksScoredJobs([]);
    setScannerScoringProgress(null);
    setNewJobsCount(0);
    setProcessedSkipCount(0);
    setNuworksScanProgress({ page: 0, jobsFound: 0, totalPages: null });
    setIsScanningAllPages(true);
    void clearScannerShortlist();

    chrome.runtime.sendMessage({ type: 'NUWORKS_DETECT_PAGE' }, (detectionResponse) => {
      if (chrome.runtime.lastError || !detectionResponse?.success) {
        setIsScanningAllPages(false);
        setToast({
          type: 'error',
          message: detectionResponse?.error ?? chrome.runtime.lastError?.message ?? 'Failed to detect page.',
        });
        return;
      }

      const detection = detectionResponse.data as NUworksDetectionResult;
      setNuworksDetection(detection);

      if (!detection.isNUworksPage) {
        setIsScanningAllPages(false);
        setToast({ type: 'error', message: 'Open a NUworks page before scanning.' });
        return;
      }

      const nativePostedDateFilter: 'all' | '24h' | '7d' = scannerDateFilter === '24h' || scannerDateFilter === '7d'
        ? scannerDateFilter
        : 'all';

      chrome.runtime.sendMessage({
        type: 'NUWORKS_SCAN_ALL_PAGES',
        payload: { nativePostedDateFilter },
      }, async (scanResponse) => {
        setIsScanningAllPages(false);

        if (chrome.runtime.lastError || !scanResponse?.success) {
          setToast({
            type: 'error',
            message: scanResponse?.error ?? chrome.runtime.lastError?.message ?? 'NUworks scan failed.',
          });
          return;
        }

        const extraction = scanResponse.data as NUworksPageExtractionResult;
        const { allJobs, newCount } = markJobsByCache(extraction.jobs, scanCache);
        void markJobsScanned(allJobs);

        const { jobs: unprocessedJobs, skippedCount } = await filterOutFullyProcessedJobs(allJobs);
        const visibleJobs = scanNewOnly ? unprocessedJobs.filter((job) => job.isNew) : unprocessedJobs;

        setNuworksCurrentPageJobs({
          ...extraction,
          jobs: visibleJobs,
        });
        setNewJobsCount(newCount);
        setProcessedSkipCount(skippedCount);

        const nextCache = buildScanCache(extraction.llmFallbackInput.pageUrl, allJobs);
        setScanCache(nextCache);
        void saveScanCache(nextCache);

        // Persist scanner state
        const extractionForStorage: NUworksPageExtractionResult = {
          ...extraction,
          jobs: visibleJobs,
        };
        void saveScannerState(visibleJobs, [], extractionForStorage);

        const summaryTop = allJobs.slice(0, 3).map((job) => `${job.company || 'Unknown'} - ${job.title || 'Untitled'}`);
        const summaryMemory = createMemoryRecord({
          snapshot: {
            messages: [],
            pageUrl: extraction.llmFallbackInput.pageUrl,
            pageTitle: extraction.llmFallbackInput.pageTitle,
          },
          summary: `Scanned NUworks on ${new Date().toLocaleString()}: ${allJobs.length} jobs found, ${newCount} new jobs. Top: ${summaryTop.join('; ') || 'N/A'}`,
          preferenceCandidates: [],
        });

        const nextMemories = applyMemoryLimits([summaryMemory, ...memoryStore.memories], memorySettings);
        const nextMemoryStore: MemoryStore = {
          ...memoryStore,
          memories: nextMemories,
        };
        void saveMemoryStore(nextMemoryStore);
        setMemoryStore(nextMemoryStore);

        if (visibleJobs.length > 0) {
          const pagesScanned = extraction.diagnostics.pagesScanned ?? nuworksScanProgress?.page ?? 1;
          const skippedText = skippedCount > 0 ? `, ${skippedCount} skipped as already processed` : '';
          setToast({
            type: 'success',
            message: `NUworks scan complete: ${visibleJobs.length} jobs across ${pagesScanned} pages (${newCount} new${skippedText}).`,
          });
        } else {
          if (skippedCount > 0) {
            setToast({
              type: 'success',
              message: `All scanned jobs were already processed. Skipped ${skippedCount} jobs.`,
            });
            return;
          }

          setToast({
            type: 'error',
            message: scanNewOnly
              ? 'No new jobs found since last scan. Disable Scan New Only to view all results.'
              : 'Scan completed but no jobs were extracted. Try enabling Debug mode in Settings.',
          });
        }
      });
    });
  }, [nuworksScanProgress?.page, scanCache, scanNewOnly, memoryStore, memorySettings, scannerActionBusy, scannerDateFilter]);

  const runUtilityPrompt = useCallback(
    async (prompt: string): Promise<string> => {
      const { selectedProvider, apiKeys, selectedModels } = providerSettings;
      const apiKey = apiKeys[selectedProvider];
      if (!apiKey) {
        throw new Error('Add an API key before running memory summarization.');
      }

      const response = await new Promise<{ success: boolean; data?: RunLLMUtilityResult; error?: string }>((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'RUN_LLM_UTILITY',
            payload: {
              prompt,
              llmConfig: {
                provider: selectedProvider,
                apiKey,
                model: selectedModels[selectedProvider],
              },
            },
          },
          (rawResponse) => {
            resolve(rawResponse as { success: boolean; data?: RunLLMUtilityResult; error?: string });
          }
        );
      });

      if (chrome.runtime.lastError || !response.success || !response.data?.content) {
        throw new Error(response.error ?? chrome.runtime.lastError?.message ?? 'LLM utility request failed.');
      }

      return response.data.content;
    },
    [providerSettings]
  );

  const runEmailGenerationFromSeed = useCallback(async (
    seed: EmailGenerationSeed,
    options?: {
      emailType?: OutreachEmailType;
      additionalInstructions?: string;
      fallbackDraft?: EmailDraft;
    }
  ) => {
    setIsEmailBusy(true);
    try {
      const generated = await generateSmartEmailDraft({
        ...seed,
        emailType: options?.emailType,
        additionalInstructions: options?.additionalInstructions,
        runPrompt: runUtilityPrompt,
      });
      setEmailDraft(generated.draft);
      setSelectedEmailType(generated.emailType);
      setEmailTypeConfidence(generated.detectionConfidence);
      setIsEmailComposeOpen(true);
      return generated;
    } catch (error) {
      if (options?.fallbackDraft) {
        setEmailDraft(options.fallbackDraft);
        setIsEmailComposeOpen(true);
      }
      throw error;
    } finally {
      setIsEmailBusy(false);
    }
  }, [runUtilityPrompt]);

  const handleRegenerateEmailDraft = useCallback(async (instruction?: string) => {
    if (!emailGenerationSeed) {
      setToast({ type: 'error', message: 'No email context available to regenerate. Generate a draft first.' });
      return;
    }

    try {
      await runEmailGenerationFromSeed(emailGenerationSeed, {
        emailType: selectedEmailType,
        additionalInstructions: instruction || 'Generate a different angle from the previous draft while preserving factual accuracy.',
      });
      setToast({ type: 'success', message: 'Email regenerated.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to regenerate email.';
      setToast({ type: 'error', message });
    }
  }, [emailGenerationSeed, selectedEmailType, runEmailGenerationFromSeed]);

  const handleEmailTypeChange = useCallback((nextType: OutreachEmailType) => {
    setSelectedEmailType(nextType);
    if (!emailGenerationSeed) return;

    void runEmailGenerationFromSeed(emailGenerationSeed, {
      emailType: nextType,
      additionalInstructions: 'Regenerate strictly using the selected email type structure and constraints.',
    }).catch((error) => {
      const message = error instanceof Error ? error.message : 'Failed to regenerate for selected email type.';
      setToast({ type: 'error', message });
    });
  }, [emailGenerationSeed, runEmailGenerationFromSeed]);

  const handleMakeEmailShorter = useCallback(() => {
    void handleRegenerateEmailDraft('Keep the same message but make it shorter and more skimmable while preserving one clear CTA.');
  }, [handleRegenerateEmailDraft]);

  const handleMakeEmailLonger = useCallback(() => {
    void handleRegenerateEmailDraft('Keep the same intent but make it slightly longer with one extra concrete proof point and one specific personalization signal.');
  }, [handleRegenerateEmailDraft]);

  const handleMakeEmailMoreFormal = useCallback(() => {
    void handleRegenerateEmailDraft('Use a more formal and polished professional tone while staying concise and avoiding generic language.');
  }, [handleRegenerateEmailDraft]);

  const handleMakeEmailMoreCasual = useCallback(() => {
    void handleRegenerateEmailDraft('Use a more casual and conversational tone while keeping it professional and concise.');
  }, [handleRegenerateEmailDraft]);

  const handleScoreCurrentPageJobs = useCallback(async () => {
    console.log('[Scoring] Checking prerequisites...');
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before scoring.' });
      return;
    }

    if (!nuworksCurrentPageJobs) {
      console.warn('[Scoring] nuworksCurrentPageJobs is null!');
      setToast({ type: 'error', message: 'No scanned jobs found. Scan a page first.' });
      return;
    }

    const jobs = getDateFilteredJobs(nuworksCurrentPageJobs?.jobs ?? []);
    console.log(`[Scoring] After date filter: ${jobs.length} jobs (from ${nuworksCurrentPageJobs.jobs.length})`);
    if (jobs.length === 0) {
      setToast({
        type: 'error',
        message: scannerDateFilter === 'all'
          ? 'Scan a NUworks listing page first.'
          : 'No jobs match the selected date filter. Try All Dates or scan fresh results.',
      });
      return;
    }

    const { selectedProvider, apiKeys } = providerSettings;
    if (!apiKeys[selectedProvider]) {
      setView('settings');
      setToast({ type: 'error', message: 'Add an API key before scoring jobs.' });
      return;
    }

    setIsScoringJobs(true);
    setNuworksScoredJobs([]);
    setScannerScoringProgress({
      scored: 0,
      total: jobs.length,
      batchIndex: 0,
      totalBatches: Math.ceil(jobs.length / 10),
    });

    try {
      console.log(`[Scoring] Starting to score ${jobs.length} jobs`);
      const scored = await scoreJobsInBatches({
        jobs,
        candidateProfileText: JSON.stringify(MY_PROFILE, null, 2),
        runPrompt: runUtilityPrompt,
        onPartialResults: (partialScored) => setNuworksScoredJobs(partialScored),
        onProgress: (progress) => setScannerScoringProgress(progress),
      });

      console.log(`[Scoring] Returned ${scored.length} scored jobs`);
      scored.slice(0, 3).forEach((job, i) => {
        console.log(`  Job ${i}: ${job.company} - ${job.title}, score=${job.matchScore}, visa=${job.visaFlag}`);
      });

      const { jobs: applyList, mode: profileFitMode } = selectProfileFitJobs(scored);
      console.log(`[Scoring] Profile-fit filtering returned ${applyList.length} jobs with mode=${profileFitMode}`);
      setNuworksScoredJobs(scored);

      const scanUrl = nuworksCurrentPageJobs?.llmFallbackInput.pageUrl ?? pageContext?.url ?? window.location.href;
      await saveScannerShortlist({
        createdAt: new Date().toISOString(),
        sourceUrl: scanUrl,
        jobs: applyList,
      });
      await markJobsShortlisted(applyList);

      // Persist scored jobs state
      void saveScannerState(
        nuworksCurrentPageJobs?.jobs ?? [],
        scored,
        nuworksCurrentPageJobs ?? null
      );

      const topPreview = applyList.slice(0, 5).map((job) => `${job.company || 'Unknown'} - ${job.title || 'Untitled'}`);
      const shortlistMemory = createMemoryRecord({
        snapshot: {
          messages: [],
          pageUrl: scanUrl,
          pageTitle: nuworksCurrentPageJobs?.llmFallbackInput.pageTitle || 'NUworks Apply List',
        },
        summary: `Created apply-only shortlist: ${applyList.length} jobs kept after ranking. Preview: ${topPreview.join('; ') || 'N/A'}`,
        preferenceCandidates: [],
      });
      const nextMemories = applyMemoryLimits([shortlistMemory, ...memoryStore.memories], memorySettings);
      const nextMemoryStore: MemoryStore = {
        ...memoryStore,
        memories: nextMemories,
      };
      void saveMemoryStore(nextMemoryStore);
      setMemoryStore(nextMemoryStore);

      const modeText = profileFitMode === 'strict'
        ? 'strict profile-fit criteria'
        : profileFitMode === 'relaxed'
          ? 'relaxed fallback criteria (score >= 5, non-red visa)'
          : 'non-red fallback criteria';

      const scoreBreakdown = {
        total: scored.length,
        scoreGte7: scored.filter(j => j.matchScore >= 7).length,
        visaNotRed: scored.filter(j => j.visaFlag !== 'red').length,
        paid: scored.filter(j => isPaidJob(j)).length,
        profileFit: applyList.length,
      };
      
      console.log('[Scoring] Final breakdown:', scoreBreakdown);

      setToast({
        type: 'success',
        message: `Scored ${scored.length} jobs. Kept ${applyList.length} jobs using ${modeText}. (Score≥7: ${scoreBreakdown.scoreGte7}, Visa OK: ${scoreBreakdown.visaNotRed}, Paid: ${scoreBreakdown.paid})`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to score jobs.';
      setToast({ type: 'error', message });
    } finally {
      setIsScoringJobs(false);
    }
  }, [
    nuworksCurrentPageJobs,
    providerSettings,
    runUtilityPrompt,
    scannerActionBusy,
    getDateFilteredJobs,
    scannerDateFilter,
    pageContext?.url,
    memoryStore,
    memorySettings,
  ]);

  const handleEnrichTopJobs = useCallback(() => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before enriching.' });
      return;
    }

    const sourceJobs = nuworksScoredJobs.length > 0
      ? getDateFilteredJobs(nuworksScoredJobs)
      : getDateFilteredJobs(nuworksCurrentPageJobs?.jobs ?? []);

    if (sourceJobs.length === 0) {
      setToast({ type: 'error', message: 'Scan jobs first before enriching details.' });
      return;
    }

    const total = sourceJobs.length;
    setIsEnrichingJobs(true);
    setNuworksEnrichProgress({ current: 0, total });

    chrome.runtime.sendMessage(
      {
        type: 'NUWORKS_ENRICH_TOP_JOBS',
        payload: {
          jobs: sourceJobs,
        },
      },
      (response) => {
        setIsEnrichingJobs(false);

        if (chrome.runtime.lastError || !response?.success || !response?.data?.jobs) {
          setToast({
            type: 'error',
            message: response?.error ?? chrome.runtime.lastError?.message ?? 'Failed to enrich job details.',
          });
          return;
        }

        const enrichedJobs = response.data.jobs as NUworksPageExtractionResult['jobs'];

        setNuworksCurrentPageJobs((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            jobs: enrichedJobs,
            extractedAt: new Date().toISOString(),
          };
        });

        setNuworksScoredJobs((prev) => {
          if (prev.length === 0) return prev;

          const byKey = new Map(enrichedJobs.map((job) => [getJobCacheKey(job), job]));
          return prev.map((job) => {
            const key = getJobCacheKey(job);
            const enriched = byKey.get(key);
            if (!enriched) return job;
            return {
              ...job,
              description: enriched.description,
              postingDate: enriched.postingDate,
              deadline: enriched.deadline,
              jobType: enriched.jobType,
              rawText: enriched.rawText,
            };
          });
        });

        setToast({
          type: 'success',
          message: `Enrichment complete: ${response.data.enriched} of ${response.data.attempted} eligible jobs updated.`,
        });
      }
    );
  }, [nuworksCurrentPageJobs?.jobs, nuworksScoredJobs, scannerActionBusy, getDateFilteredJobs]);

  const handleEnrichTest30Jobs = useCallback(() => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before enriching.' });
      return;
    }

    const sourceJobs = nuworksScoredJobs.length > 0
      ? getDateFilteredJobs(nuworksScoredJobs)
      : getDateFilteredJobs(nuworksCurrentPageJobs?.jobs ?? []);

    if (sourceJobs.length === 0) {
      setToast({ type: 'error', message: 'Scan jobs first before enriching details.' });
      return;
    }

    // TEST: Take only first 30 jobs for comparison
    const testJobs = sourceJobs.slice(0, 30);
    const total = testJobs.length;
    setIsEnrichingJobs(true);
    setNuworksEnrichProgress({ current: 0, total });

    chrome.runtime.sendMessage(
      {
        type: 'NUWORKS_ENRICH_TOP_JOBS',
        payload: {
          jobs: testJobs,
        },
      },
      (response) => {
        setIsEnrichingJobs(false);

        if (chrome.runtime.lastError || !response?.success || !response?.data?.jobs) {
          setToast({
            type: 'error',
            message: response?.error ?? chrome.runtime.lastError?.message ?? 'Failed to enrich job details.',
          });
          return;
        }

        const enrichedJobs = response.data.jobs as NUworksPageExtractionResult['jobs'];

        setNuworksCurrentPageJobs((prev) => {
          if (!prev) return prev;
          return {
            ...prev,
            jobs: enrichedJobs,
            extractedAt: new Date().toISOString(),
          };
        });

        setNuworksScoredJobs((prev) => {
          if (prev.length === 0) return prev;

          const byKey = new Map(enrichedJobs.map((job) => [getJobCacheKey(job), job]));
          return prev.map((job) => {
            const key = getJobCacheKey(job);
            const enriched = byKey.get(key);
            if (!enriched) return job;
            return {
              ...job,
              description: enriched.description,
              postingDate: enriched.postingDate,
              deadline: enriched.deadline,
              jobType: enriched.jobType,
              rawText: enriched.rawText,
            };
          });
        });

        setToast({
          type: 'success',
          message: `[TEST] Enrichment complete: ${response.data.enriched} of ${response.data.attempted} jobs enriched (first 30 only).`,
        });
      }
    );
  }, [nuworksCurrentPageJobs?.jobs, nuworksScoredJobs, scannerActionBusy, getDateFilteredJobs]);

  const saveScannerJobToSheetInternal = useCallback(async (
    job: RawJobListing | ScoredJob,
    options: { showToast: boolean }
  ): Promise<boolean> => {
    if (!sheetsConfig.spreadsheetId) {
      setView('settings');
      if (options.showToast) {
        setToast({ type: 'error', message: 'Set a Spreadsheet ID in Settings before saving scanner jobs.' });
      }
      return false;
    }
    if (!googleSettings.clientId.trim() || !googleAuthState.isConnected) {
      setView('settings');
      if (options.showToast) {
        setToast({ type: 'error', message: 'Connect Google account before saving scanner jobs.' });
      }
      return false;
    }

    try {
      const payload = toScannerJobData(job, sheetsConfig.resumeVersions[0] ?? 'default');
      const result = await appendJobToSheet({
        clientId: googleSettings.clientId,
        clientSecret: googleSettings.clientSecret,
        spreadsheetId: sheetsConfig.spreadsheetId,
        jobData: payload,
      });
      if (options.showToast) {
        setToast({
          type: 'success',
          message: 'Scanner job saved to Google Sheets.',
          linkUrl: result.spreadsheetUrl,
          linkLabel: 'Open Sheet',
        });
      }
      return true;
    } catch (error) {
      if (options.showToast) {
        const message = error instanceof Error ? error.message : 'Failed to save scanner job.';
        setToast({ type: 'error', message });
      }
      return false;
    }
  }, [googleAuthState.isConnected, googleSettings.clientId, googleSettings.clientSecret, sheetsConfig.spreadsheetId, sheetsConfig.resumeVersions]);

  const handleScannerSaveJobToSheet = useCallback(async (job: RawJobListing | ScoredJob) => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before saving jobs.' });
      return;
    }

    setIsSavingScannerJobs(true);
    try {
      await saveScannerJobToSheetInternal(job, { showToast: true });
    } finally {
      setIsSavingScannerJobs(false);
    }
  }, [saveScannerJobToSheetInternal, scannerActionBusy]);

  const handleScannerSaveAllToSheet = useCallback(async () => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before batch save.' });
      return;
    }

    const sourceJobs = nuworksScoredJobs.length > 0
      ? allScoredJobs
      : getDateFilteredJobs(nuworksCurrentPageJobs?.jobs ?? []);
    if (sourceJobs.length === 0) {
      setToast({ type: 'error', message: 'No jobs available to save with current filters.' });
      return;
    }

    setIsSavingScannerJobs(true);
    let successCount = 0;
    let failCount = 0;
    try {
      for (const job of sourceJobs) {
        const ok = await saveScannerJobToSheetInternal(job, { showToast: false });
        if (ok) {
          successCount += 1;
        } else {
          failCount += 1;
        }
      }
    } finally {
      setIsSavingScannerJobs(false);
    }

    setToast({
      type: successCount > 0 ? 'success' : 'error',
      message: successCount > 0
        ? `Saved ${successCount}/${sourceJobs.length} scanner jobs to Sheets${failCount > 0 ? ` (${failCount} failed)` : ''}.`
        : 'Failed to save scanner jobs to Sheets.',
    });
  }, [nuworksScoredJobs, nuworksCurrentPageJobs?.jobs, saveScannerJobToSheetInternal, scannerActionBusy, getDateFilteredJobs, allScoredJobs]);

  const handleScannerGenerateEmail = useCallback(async (job: RawJobListing | ScoredJob) => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before generating email.' });
      return;
    }

    if (!googleAuthState.isConnected || !googleSettings.clientId.trim()) {
      setView('settings');
      setToast({ type: 'error', message: 'Connect Google account first in Settings.' });
      return;
    }

    try {
      const seed: EmailGenerationSeed = {
        userIntentText: `Write a cold email for the ${job.title || 'role'} at ${job.company || 'this company'}`,
        source: 'scanner',
        pageTitle: pageContext?.title,
        pageUrl: job.detailUrl || pageContext?.url,
        pageText: [job.description, job.rawText, pageContext?.textContent].filter(Boolean).join('\n\n'),
        companyName: job.company,
        roleTitle: job.title,
        recipientCandidates: extractEmailCandidates([job.description, job.rawText, pageContext?.textContent].filter(Boolean).join('\n')),
        chatContext: messages.slice(-6).map((m) => `${m.role}: ${m.content}`).join('\n'),
        resumeVersion: sheetsConfig.resumeVersions[0] ?? 'default',
      };
      setEmailGenerationSeed(seed);

      const generated = await runEmailGenerationFromSeed(seed, {
        emailType: 'cold-recruiter',
      });

      setToast({
        type: 'success',
        message: `Generated ${generated.emailType.replace(/-/g, ' ')} email draft. Review and send.`,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to generate smart email draft.';
      setToast({ type: 'error', message });
    }
  }, [googleAuthState.isConnected, googleSettings.clientId, scannerActionBusy, pageContext?.title, pageContext?.url, pageContext?.textContent, messages, sheetsConfig.resumeVersions, runEmailGenerationFromSeed]);

  const handleScannerChatAboutJob = useCallback((job: RawJobListing | ScoredJob) => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before switching context.' });
      return;
    }

    const text = [
      `Job: ${job.title}`,
      `Company: ${job.company}`,
      `Location: ${job.location}`,
      `Job URL: ${job.detailUrl}`,
      `Description: ${job.description || job.rawText}`,
    ].join('\n');

    setPageContext({
      url: job.detailUrl || 'https://nuworks.northeastern.edu',
      title: `${job.title || 'Job'} @ ${job.company || 'Unknown Company'}`,
      metaDescription: `NUworks scanner job context for ${job.title || 'job'}`,
      textContent: text.slice(0, 15000),
      extractedAt: new Date().toISOString(),
    });
    setView('chat');
    setToast({ type: 'success', message: 'Loaded job context in Chat. Ask follow-up questions now.' });
  }, [scannerActionBusy]);

  const handleScannerExportCsv = useCallback(() => {
    if (scannerActionBusy) {
      setToast({ type: 'error', message: 'Scanner is busy. Please wait before exporting.' });
      return;
    }

    const sourceJobs: Array<RawJobListing | ScoredJob> = nuworksScoredJobs.length > 0
      ? allScoredJobs
      : getDateFilteredJobs(nuworksCurrentPageJobs?.jobs ?? []);
    if (sourceJobs.length === 0) {
      setToast({ type: 'error', message: 'No scanner results to export yet.' });
      return;
    }

    exportScannerJobsCsv(sourceJobs);
    setToast({ type: 'success', message: `Exported ${sourceJobs.length} scanner results as CSV.` });
  }, [nuworksCurrentPageJobs?.jobs, nuworksScoredJobs, scannerActionBusy, getDateFilteredJobs, allScoredJobs]);

  const summarizeCurrentConversationToMemory = useCallback(async () => {
    if (!memorySettings.autoSummarize || messages.length < 2) return;

    setIsMemoryBusy(true);
    try {
      const summaryRaw = await runUtilityPrompt(buildConversationSummaryPrompt(messages));
      const preferenceRaw = await runUtilityPrompt(buildPreferenceExtractionPrompt(messages));

      const preferenceCandidates = parsePreferenceCandidates(preferenceRaw);
      const nextMemory = createMemoryRecord({
        snapshot: {
          messages,
          pageUrl: pageContext?.url,
          pageTitle: pageContext?.title,
        },
        summary: summaryRaw,
        preferenceCandidates,
      });

      const nextMemories = applyMemoryLimits([nextMemory, ...memoryStore.memories], memorySettings);
      const nextPreferences = mergePreferences(memoryStore.preferences, preferenceCandidates, nextMemory.id);
      const nextStore: MemoryStore = {
        memories: nextMemories,
        preferences: nextPreferences,
      };

      await saveMemoryStore(nextStore);
      setMemoryStore(nextStore);
      setToast({ type: 'success', message: 'Conversation saved to memory.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to summarize conversation memory.';
      setToast({ type: 'error', message });
    } finally {
      setIsMemoryBusy(false);
    }
  }, [memorySettings.autoSummarize, messages, runUtilityPrompt, pageContext, memoryStore, memorySettings]);

  const handleStartNewChat = useCallback(async () => {
    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    if (messages.length > 1 && (!memorySettings.autoSummarize || lastAutoSavedAssistantIdRef.current !== lastAssistant?.id)) {
      await summarizeCurrentConversationToMemory();
    }
    setMessages([]);
    setLoadedMemoryCount(0);
    setLastPromptMemoryContext(null);
    lastAutoSavedAssistantIdRef.current = null;
  }, [messages, memorySettings.autoSummarize, summarizeCurrentConversationToMemory]);

  useEffect(() => {
    if (!memorySettings.autoSummarize || isLoading || isMemoryBusy || messages.length < 2) return;

    const lastAssistant = [...messages].reverse().find((message) => message.role === 'assistant');
    if (!lastAssistant || !lastAssistant.content.trim()) return;
    if (lastAutoSavedAssistantIdRef.current === lastAssistant.id) return;

    let cancelled = false;

    const saveCurrentChat = async () => {
      await summarizeCurrentConversationToMemory();
      if (!cancelled) {
        lastAutoSavedAssistantIdRef.current = lastAssistant.id;
      }
    };

    void saveCurrentChat();

    return () => {
      cancelled = true;
    };
  }, [isLoading, isMemoryBusy, messages, memorySettings.autoSummarize, summarizeCurrentConversationToMemory]);

  const handleSend = useCallback(
    (overrideText?: string, overridePageContext?: PageContext) => {
      const text = (overrideText ?? inputValue).trim();
      // isSendingRef is synchronous; isLoading is the React-rendered fallback
      if (!text || isSendingRef.current || isLoading) return;
      isSendingRef.current = true;

      const { selectedProvider, apiKeys, selectedModels } = providerSettings;
      const apiKey = apiKeys[selectedProvider];

      if (!apiKey) {
        isSendingRef.current = false;
        setView('settings');
        return;
      }

      setErrorBanner(null);
      setInputValue('');

      const userMsg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content: text,
        timestamp: new Date(),
      };

      setMessages((prev) => [...prev, userMsg]);
      setIsLoading(true);

      const history: LLMMessage[] = [...messages, userMsg].map((m) => ({
        role: m.role,
        content: m.content,
      }));

      const activePageContext = overridePageContext ?? pageContext;
      const queryText = [text, activePageContext?.title ?? '', activePageContext?.url ?? ''].join(' ').trim();
      const relevantMemories = searchMemories(queryText, memoryStore.memories, 3);
      const promptMemoryContext = buildPromptMemoryContext(relevantMemories, memoryStore.preferences);
      setLoadedMemoryCount(relevantMemories.length);
      setLastPromptMemoryContext(promptMemoryContext);

      const messageId = generateId();
      streamingMsgIdRef.current = messageId;

      setMessages((prev) => [
        ...prev,
        { id: messageId, role: 'assistant', content: '', timestamp: new Date() },
      ]);

      chrome.runtime.sendMessage(
        {
          type: 'SEND_TO_LLM',
          payload: {
            messages: history,
            pageContext: activePageContext,
            llmConfig: {
              provider: selectedProvider,
              apiKey,
              model: selectedModels[selectedProvider],
            },
            messageId,
            memoryContext: promptMemoryContext,
          },
        },
        (response) => {
          if (chrome.runtime.lastError) {
            setIsLoading(false);
            isSendingRef.current = false;
            setErrorBanner(chrome.runtime.lastError.message ?? 'Failed to contact background service.');
          }
          void response;
        }
      );
    },
    [inputValue, isLoading, providerSettings, messages, pageContext, memoryStore]
  );

  const handleSuggestedPrompt = useCallback(
    (prompt: string) => handleSend(prompt),
    [handleSend]
  );

  const handleAnalyzeJob = useCallback(async () => {
    const basePrompt = 'Analyze this job description and match it to my profile. Also tell me if I should reach out to a recruiter and whether I must tailor my resume before applying.';

    const buildPromptWithCanonicalScore = (context: PageContext): string => {
      const pageUrl = normalizeUrlForLookup(context.url ?? '');
      const pageTitle = normalizeScannerLookupPart(context.title ?? '');

      const matchedByUrl = pageUrl
        ? nuworksScoredJobs.find((job) => normalizeUrlForLookup(job.detailUrl ?? '') === pageUrl)
        : undefined;

      const matchedByTitleCompany = pageTitle
        ? nuworksScoredJobs.find((job) => {
            const title = normalizeScannerLookupPart(job.title ?? '');
            const company = normalizeScannerLookupPart(job.company ?? '');
            if (!title || !company) return false;
            return pageTitle.includes(title) || pageTitle.includes(company);
          })
        : undefined;

      const matched = matchedByUrl ?? matchedByTitleCompany;
      if (!matched) {
        return `${basePrompt}\n\nIf you provide a numeric ATS/match score, use the SAME scoring standard as JobBuddy Scanner Score and Rank Jobs.`;
      }

      return `${basePrompt}\n\nUse this canonical scanner score (same standard as Score and Rank Jobs) as authoritative for this job:\n- Match Score: ${matched.matchScore}/10\n- Visa Flag: ${matched.visaFlag}\n- Match Reason: ${matched.matchReason || 'N/A'}\n\nIMPORTANT: Keep this exact score in your analysis. Do not output a different ATS/match score for this same job.`;
    };

    if (pageContext) {
      handleSend(buildPromptWithCanonicalScore(pageContext), pageContext);
      return;
    }

    try {
      setIsReadingPage(true);
      setErrorBanner(null);
      const data = await readActivePageContext();
      setPageContext(data);
      handleSend(buildPromptWithCanonicalScore(data), data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Read the page first before analyzing.';
      setErrorBanner(message);
      setToast({ type: 'error', message });
    } finally {
      setIsReadingPage(false);
    }
  }, [handleSend, pageContext, readActivePageContext, nuworksScoredJobs]);

  // ── settings handlers ──

  const handleKeyInput = (provider: LLMProvider, value: string) => {
    setKeyInputs((prev) => ({ ...prev, [provider]: value }));
  };

  const handleModelChange = async (provider: LLMProvider, model: string) => {
    const next: ProviderSettings = {
      ...providerSettings,
      selectedModels: { ...providerSettings.selectedModels, [provider]: model },
    };
    setProviderSettings(next);
    setCustomModelInputs((prev) => ({ ...prev, [provider]: model }));
    await saveSettings(next);
  };

  const handleCustomModelChange = (provider: LLMProvider, value: string) => {
    setCustomModelInputs((prev) => ({ ...prev, [provider]: value }));
  };

  const handleSaveCustomModel = async (provider: LLMProvider) => {
    const model = customModelInputs[provider].trim();
    if (!model) return;
    await handleModelChange(provider, model);
    setToast({ type: 'success', message: `${PROVIDER_META[provider].label} model set to ${model}.` });
  };

  const handleSaveKey = async (provider: LLMProvider) => {
    const trimmed = keyInputs[provider].trim();
    if (!trimmed) return;

    const next: ProviderSettings = {
      ...providerSettings,
      selectedProvider: provider,
      apiKeys: { ...providerSettings.apiKeys, [provider]: trimmed },
    };
    setProviderSettings(next);
    setKeyInputs((prev) => ({ ...prev, [provider]: '' }));
    await saveSettings(next);
    setView('chat');
  };

  const handleActivateProvider = async (provider: LLMProvider) => {
    const next: ProviderSettings = { ...providerSettings, selectedProvider: provider };
    setProviderSettings(next);
    await saveSettings(next);
    setView('chat');
  };

  const handleSaveGoogleClientId = async () => {
    const trimmedClientId = googleClientIdInput.trim();
    const nextSettings: GoogleSettings = {
      clientId: trimmedClientId,
      clientSecret: googleClientSecretInput.trim(),
    };

    await saveGoogleSettings(nextSettings);
    setGoogleSettingsState(nextSettings);
    setToast({ type: 'success', message: 'Google OAuth client ID saved.' });
  };

  const handleConnectGoogle = async () => {
    const clientId = googleClientIdInput.trim();
    if (!clientId) {
      setToast({ type: 'error', message: 'Enter your Google OAuth client ID before connecting.' });
      return;
    }

    setIsGoogleAuthBusy(true);
    try {
      const nextAuthState = await connectGoogleAccount(clientId, googleClientSecretInput.trim());
      setGoogleAuthState(nextAuthState);
      setToast({ type: 'success', message: 'Google account connected successfully.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Google connection failed.';
      setToast({ type: 'error', message });
    } finally {
      setIsGoogleAuthBusy(false);
    }
  };

  const handleDisconnectGoogle = async () => {
    setIsGoogleAuthBusy(true);
    try {
      await disconnectGoogleAccount(googleAuthState);
      setGoogleAuthState(DEFAULT_GOOGLE_AUTH_STATE);
      setToast({ type: 'success', message: 'Google account disconnected.' });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to disconnect Google account.';
      setToast({ type: 'error', message });
    } finally {
      setIsGoogleAuthBusy(false);
    }
  };

  const handleSaveSpreadsheetId = async () => {
    const normalizedId = normalizeSpreadsheetId(spreadsheetIdInput);
    const next: SheetsConfig = {
      ...sheetsConfig,
      spreadsheetId: normalizedId || null,
    };

    await saveSheetsConfig(next);
    setSheetsConfigState(next);
    setSpreadsheetIdInput(normalizedId);
    setToast({ type: 'success', message: 'Spreadsheet ID saved.' });
  };

  const handleCreateSheet = async () => {
    const clientId = googleSettings.clientId.trim();
    if (!clientId) {
      setToast({ type: 'error', message: 'Save your Google OAuth client ID first.' });
      return;
    }
    if (!googleAuthState.isConnected) {
      setToast({ type: 'error', message: 'Connect your Google account before creating a sheet.' });
      return;
    }

    setIsSheetCreateBusy(true);
    try {
      const created = await createNewSpreadsheetWithSecret({
        clientId,
        clientSecret: googleSettings.clientSecret,
      });
      const next: SheetsConfig = {
        ...sheetsConfig,
        spreadsheetId: created.spreadsheetId,
      };
      await saveSheetsConfig(next);
      setSheetsConfigState(next);
      setSpreadsheetIdInput(created.spreadsheetId);
      setToast({
        type: 'success',
        message: 'Created new Google Sheet for job tracking.',
        linkUrl: created.spreadsheetUrl,
        linkLabel: 'Open Sheet',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to create Google Sheet.';
      setToast({ type: 'error', message });
    } finally {
      setIsSheetCreateBusy(false);
    }
  };

  const handleAddResumeVersion = async () => {
    const normalized = resumeVersionInput.trim();
    if (!normalized) return;
    if (sheetsConfig.resumeVersions.includes(normalized)) {
      setToast({ type: 'error', message: 'That resume version already exists.' });
      return;
    }

    const next: SheetsConfig = {
      ...sheetsConfig,
      resumeVersions: [...sheetsConfig.resumeVersions, normalized],
    };
    await saveSheetsConfig(next);
    setSheetsConfigState(next);
    setResumeVersionInput('');
    setToast({ type: 'success', message: 'Resume version added.' });
  };

  const handleRemoveResumeVersion = async (version: string) => {
    if (sheetsConfig.resumeVersions.length === 1) {
      setToast({ type: 'error', message: 'At least one resume version is required.' });
      return;
    }

    const nextVersions = sheetsConfig.resumeVersions.filter((item) => item !== version);
    const next: SheetsConfig = {
      ...sheetsConfig,
      resumeVersions: nextVersions,
    };
    await saveSheetsConfig(next);
    setSheetsConfigState(next);

    if (jobDraft?.resumeVersion === version) {
      setJobDraft({ ...jobDraft, resumeVersion: nextVersions[0] });
    }
  };

  const handleExtractJobForSheet = async () => {
    const { selectedProvider, apiKeys, selectedModels } = providerSettings;
    const apiKey = apiKeys[selectedProvider];
    if (!apiKey) {
      setView('settings');
      setToast({ type: 'error', message: 'Add an LLM API key before extracting job details.' });
      return;
    }
    if (!pageContext) {
      setToast({ type: 'error', message: 'Read the page first to extract job details.' });
      return;
    }
    if (!googleSettings.clientId.trim() || !googleAuthState.isConnected) {
      setView('settings');
      setToast({ type: 'error', message: 'Connect Google account first in Settings.' });
      return;
    }
    if (!sheetsConfig.spreadsheetId) {
      setView('settings');
      setToast({ type: 'error', message: 'Set a Spreadsheet ID in Settings before saving jobs.' });
      return;
    }

    setIsExtractingJob(true);
    try {
      const prompt = buildJobExtractionPrompt(pageContext.textContent);
      const analysisText = [...messages]
        .reverse()
        .find((msg) => msg.role === 'assistant' && /ATS Match Score:/i.test(msg.content))?.content ?? '';

      const response = await new Promise<{ success: boolean; data?: ExtractJobDataResult; error?: string }>((resolve) => {
        chrome.runtime.sendMessage(
          {
            type: 'EXTRACT_JOB_DATA',
            payload: {
              prompt,
              llmConfig: {
                provider: selectedProvider,
                apiKey,
                model: selectedModels[selectedProvider],
              },
            },
          },
          (rawResponse) => {
            resolve(rawResponse as { success: boolean; data?: ExtractJobDataResult; error?: string });
          }
        );
      });

      if (chrome.runtime.lastError || !response.success || !response.data?.content) {
        throw new Error(response.error ?? chrome.runtime.lastError?.message ?? 'Failed to extract job details.');
      }

      const draft = toJobDraft({
        extractedRaw: response.data.content,
        jobUrl: pageContext.url,
        analysisText,
        resumeVersion: sheetsConfig.resumeVersions[0] ?? 'default',
      });

      setJobDraft(draft);
      setIsJobSaveModalOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to extract job details.';
      setToast({ type: 'error', message });
    } finally {
      setIsExtractingJob(false);
    }
  };

  const handleSaveJobToSheet = async () => {
    if (!jobDraft) return;
    if (!sheetsConfig.spreadsheetId) {
      setToast({ type: 'error', message: 'Spreadsheet ID missing. Configure it in Settings.' });
      return;
    }
    if (!googleSettings.clientId.trim()) {
      setToast({ type: 'error', message: 'Google OAuth client ID is missing.' });
      return;
    }

    setIsSavingJob(true);
    try {
      const result = await appendJobToSheet({
        clientId: googleSettings.clientId,
        clientSecret: googleSettings.clientSecret,
        spreadsheetId: sheetsConfig.spreadsheetId,
        jobData: jobDraft,
      });

      try {
        const nextActivityStore = recordApplication(activityStore);
        await saveActivityStore(nextActivityStore);
        setActivityStore(nextActivityStore);
      } catch {
        // Ignore tracking failures so the application save still succeeds.
      }

      setIsJobSaveModalOpen(false);
      setToast({
        type: 'success',
        message: 'Saved to Google Sheets.',
        linkUrl: result.spreadsheetUrl,
        linkLabel: 'Open Sheet',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save job to Google Sheets.';
      setToast({ type: 'error', message });
    } finally {
      setIsSavingJob(false);
    }
  };

  const buildEmailDraftFromMessage = (messageId: string): { draft: EmailDraft; userIntent?: string } | null => {
    const idx = messages.findIndex((msg) => msg.id === messageId);
    if (idx === -1) return null;

    const message = messages[idx];
    if (message.role !== 'assistant') return null;

    const previousUser = [...messages.slice(0, idx)]
      .reverse()
      .find((item) => item.role === 'user')?.content;

    const detected = detectEmailDraft({
      assistantContent: message.content,
      previousUserMessage: previousUser,
      pageText: pageContext?.textContent,
      resumeVersion: sheetsConfig.resumeVersions[0],
    });

    return { draft: detected.draft, userIntent: previousUser };
  };

  const handleOpenEmailCompose = (messageId: string) => {
    if (!googleAuthState.isConnected || !googleSettings.clientId.trim()) {
      setView('settings');
      setToast({ type: 'error', message: 'Connect Google account first in Settings.' });
      return;
    }

    const draftContext = buildEmailDraftFromMessage(messageId);
    if (!draftContext) {
      setToast({ type: 'error', message: 'Unable to parse email draft from this message.' });
      return;
    }

    void (async () => {
      try {
        const seed: EmailGenerationSeed = {
          userIntentText: draftContext.userIntent || 'write a cold email',
          source: 'chat',
          pageTitle: pageContext?.title,
          pageUrl: pageContext?.url,
          pageText: pageContext?.textContent,
          recipientCandidates: [
            draftContext.draft.to,
            ...extractEmailCandidates(pageContext?.textContent),
          ].filter(Boolean),
          chatContext: messages.slice(-10).map((m) => `${m.role}: ${m.content}`).join('\n'),
          resumeVersion: sheetsConfig.resumeVersions[0],
        };
        setEmailGenerationSeed(seed);

        const generated = await runEmailGenerationFromSeed(seed);

        setEmailDraft({
          ...generated.draft,
          to: generated.draft.to || draftContext.draft.to,
        });
      } catch {
        // Fall back to parsed draft from assistant response if regeneration fails.
        setEmailDraft(draftContext.draft);
        setIsEmailComposeOpen(true);
      }
    })();
  };

  const handleComposeEmailManually = () => {
    if (!pageContext?.textContent) {
      setToast({
        type: 'error',
        message: 'What company/role is this for? Read the page first so I can personalize the email.',
      });
      return;
    }

    setErrorBanner(null);

    (async () => {
      try {
        const seed: EmailGenerationSeed = {
          userIntentText: 'write a cold email for this job',
          source: 'manual',
          pageTitle: pageContext.title,
          pageUrl: pageContext.url,
          pageText: pageContext.textContent,
          recipientCandidates: extractEmailCandidates(pageContext.textContent),
          chatContext: messages.slice(-8).map((m) => `${m.role}: ${m.content}`).join('\n'),
          resumeVersion: sheetsConfig.resumeVersions[0],
        };
        setEmailGenerationSeed(seed);

        await runEmailGenerationFromSeed(seed);

        setToast({ type: 'success', message: 'Generated personalized email draft. Review and send.' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to extract recruiter info.';
        setErrorBanner(message);
        const emptyDraft: EmailDraft = {
          to: '',
          subject: '',
          body: '',
          attachResume: false,
          isHtml: false,
        };
        setEmailDraft(emptyDraft);
        setIsEmailComposeOpen(true);
      }
    })();
  };

  const handleCopyEmailMessage = async (messageId: string) => {
    const message = messages.find((item) => item.id === messageId);
    if (!message) return;
    await navigator.clipboard.writeText(message.content);
    setToast({ type: 'success', message: 'Email content copied.' });
  };

  const maybeUpdateSheetAfterEmail = async () => {
    if (!pageContext?.url || !sheetsConfig.spreadsheetId || !googleSettings.clientId.trim()) return;

    try {
      const updated = await markJobAsEmailed({
        clientId: googleSettings.clientId,
        clientSecret: googleSettings.clientSecret,
        spreadsheetId: sheetsConfig.spreadsheetId,
        jobUrl: pageContext.url,
      });

      if (updated) {
        await refreshAppliedJobLookup();
        setToast({ type: 'success', message: 'Email sent and sheet row updated.' });
      }
    } catch {
      // Ignore sheet update failures so email success is not masked.
    }
  };

  const handleSendEmail = async () => {
    if (!emailDraft) return;
    if (!emailDraft.to.trim()) {
      setToast({ type: 'error', message: 'Recipient email is required. Pick one from suggestions or type it in the To field.' });
      return;
    }

    setIsEmailBusy(true);
    try {
      await sendEmailViaGmail({
        clientId: googleSettings.clientId,
        clientSecret: googleSettings.clientSecret,
        draft: emailDraft,
        relatedJobUrl: pageContext?.url,
        relatedCompany: jobDraft?.company,
      });

      try {
        const nextActivityStore = recordOutreach(activityStore);
        await saveActivityStore(nextActivityStore);
        setActivityStore(nextActivityStore);
      } catch {
        // Ignore tracking failures so email composition still succeeds.
      }

      setIsEmailComposeOpen(false);
      setToast({
        type: 'success',
        message: `Email sent via Gmail to ${emailDraft.to}.`,
      });

      // Mark as emailed in sheet and update job tracking
      await maybeUpdateSheetAfterEmail();
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to send email via Gmail.';
      setToast({ type: 'error', message });
    } finally {
      setIsEmailBusy(false);
    }
  };

  const handleSaveEmailDraft = async () => {
    if (!emailDraft) return;

    if (!emailDraft.to.trim()) {
      setToast({ type: 'error', message: 'Recipient email is required to save Gmail draft.' });
      return;
    }

    setIsEmailBusy(true);
    try {
      await saveGmailDraft({
        clientId: googleSettings.clientId,
        clientSecret: googleSettings.clientSecret,
        draft: emailDraft,
      });
      setIsEmailComposeOpen(false);
      setToast({ type: 'success', message: `Draft saved to Gmail for ${emailDraft.to}.` });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to save Gmail draft.';
      setToast({ type: 'error', message });
    } finally {
      setIsEmailBusy(false);
    }
  };

  const handleUpdateMemorySettings = async (nextSettings: MemorySettings) => {
    await saveMemorySettings(nextSettings);
    setMemorySettingsState(nextSettings);

    const nextStore: MemoryStore = {
      ...memoryStore,
      memories: applyMemoryLimits(memoryStore.memories, nextSettings),
    };

    await saveMemoryStore(nextStore);
    setMemoryStore(nextStore);
  };

  const handleDeleteMemory = async (id: string) => {
    const next: MemoryStore = {
      ...memoryStore,
      memories: memoryStore.memories.filter((memory) => memory.id !== id),
      preferences: memoryStore.preferences.filter((item) => item.learnedFrom !== id),
    };
    await saveMemoryStore(next);
    setMemoryStore(next);
  };

  const handleClearAllMemories = async () => {
    const next: MemoryStore = { memories: [], preferences: [] };
    await saveMemoryStore(next);
    setMemoryStore(next);
    setLoadedMemoryCount(0);
    setLastPromptMemoryContext(null);
    setToast({ type: 'success', message: 'Cleared all conversation memories.' });
  };

  const handleDeletePreference = async (key: string, value: string) => {
    const next: MemoryStore = {
      ...memoryStore,
      preferences: memoryStore.preferences.filter(
        (item) => !(item.key === key && item.value === value)
      ),
    };
    await saveMemoryStore(next);
    setMemoryStore(next);
  };

  const handleEditPreference = async (
    oldKey: string,
    oldValue: string,
    nextValue: { key: string; value: string }
  ) => {
    const next: MemoryStore = {
      ...memoryStore,
      preferences: memoryStore.preferences.map((item) => {
        if (item.key === oldKey && item.value === oldValue) {
          return { ...item, key: nextValue.key, value: nextValue.value };
        }
        return item;
      }),
    };

    await saveMemoryStore(next);
    setMemoryStore(next);
  };

  const handleExportMemoryBackup = useCallback(() => {
    const payload = createMemoryBackupPayload(memoryStore, memorySettings);
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `jobbuddy-memory-backup-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    setToast({ type: 'success', message: 'Memory backup exported.' });
  }, [memoryStore, memorySettings]);

  const handleImportMemoryBackup = useCallback(() => {
    memoryBackupInputRef.current?.click();
  }, []);

  const handleCopyMemoryBackup = useCallback(async () => {
    try {
      const payload = createMemoryBackupPayload(memoryStore, memorySettings);
      await navigator.clipboard.writeText(stringifyMemoryBackup(payload));
      setToast({ type: 'success', message: 'Memory backup copied to clipboard.' });
    } catch {
      setToast({ type: 'error', message: 'Could not copy the memory backup.' });
    }
  }, [memoryStore, memorySettings]);

  const jobHuntSummary = buildJobHuntSummary(activityStore);

  const handleMemoryBackupFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      try {
        const raw = await file.text();
        const backup = parseMemoryBackupPayload(raw);

        await saveMemoryStore(backup.store);
        await saveMemorySettings(backup.settings);
        setLastDailyBackupDate(backup.exportedAt.slice(0, 10));

        setMemoryStore(backup.store);
        setMemorySettingsState(backup.settings);
        setToast({ type: 'success', message: 'Memory backup restored.' });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Failed to restore memory backup.';
        setToast({ type: 'error', message });
      }
    },
    []
  );

  // ── derive active provider info ──
  const activeMeta = PROVIDER_META[providerSettings.selectedProvider];
  const activeModel = providerSettings.selectedModels[providerSettings.selectedProvider];
  const activeModelLabel =
    activeMeta.models.find((m) => m.id === activeModel)?.name ?? activeModel;
  const oauthRedirectUri = getGoogleRedirectUri();

  const renderTopTabs = () => (
    <div className="flex gap-1 rounded-xl bg-gray-100 p-1">
      {([
        { id: 'chat', label: 'Chat' },
        { id: 'scanner', label: 'Scanner' },
        { id: 'memory', label: 'Memory' },
        { id: 'settings', label: 'Settings' },
      ] as const).map((tab) => (
        <button
          key={tab.id}
          onClick={() => setView(tab.id)}
          className={`flex-1 rounded-lg px-2 py-1.5 text-xs font-medium transition-colors ${
            view === tab.id ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );

  // ─────────────────────────────────────────────────────────────────────────────
  //  Settings View
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'settings') {
    return (
      <div className="flex flex-col h-full bg-white">
        {/* Header */}
        <header className="px-4 py-3 border-b border-gray-200 shadow-sm flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">J</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">JobBuddy AI</span>
          </div>
          {renderTopTabs()}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Provider tabs */}
          <p className="text-xs text-gray-500 mb-2">Select a provider to configure its API key:</p>
          <div className="flex gap-1.5 mb-4 p-1 bg-gray-100 rounded-xl">
            {PROVIDERS.map((p) => {
              const meta = PROVIDER_META[p];
              const isActive = providerSettings.selectedProvider === p;
              const isTab = settingsTab === p;
              return (
                <button
                  key={p}
                  onClick={() => setSettingsTab(p)}
                  className={`flex-1 flex items-center justify-center gap-1 py-1.5 text-xs font-medium rounded-lg transition-all ${
                    isTab
                      ? 'bg-white shadow-sm text-gray-900'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                >
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-green-500 flex-shrink-0" />
                  )}
                  {meta.label}
                </button>
              );
            })}
          </div>

          {/* Per-provider form */}
          {PROVIDERS.map((p) => {
            if (settingsTab !== p) return null;
            const meta = PROVIDER_META[p];
            const savedKey = providerSettings.apiKeys[p];
            const isCurrentlyActive = providerSettings.selectedProvider === p;
            const draftKey = keyInputs[p];
            const isKeyVisible = keyVisible === p;
            const selectedModel = providerSettings.selectedModels[p];

            return (
              <div key={p} className="space-y-4">
                {/* Active indicator */}
                {isCurrentlyActive ? (
                  <div className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                    <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <span className="font-medium">Currently active provider</span>
                  </div>
                ) : savedKey ? (
                  <button
                    onClick={() => void handleActivateProvider(p)}
                    className="w-full text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg px-3 py-2 transition-colors text-left"
                  >
                    Switch to {meta.label} →
                  </button>
                ) : null}

                {/* Saved key indicator */}
                {savedKey && (
                  <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
                    <svg className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 7a2 2 0 012 2m4 0a6 6 0 01-7.743 5.743L11 17H9v2H7v2H4a1 1 0 01-1-1v-2.586a1 1 0 01.293-.707l5.964-5.964A6 6 0 1121 9z" />
                    </svg>
                    <span className="text-xs text-gray-600">
                      Saved: {'••••••••' + savedKey.slice(-4)}
                    </span>
                  </div>
                )}

                {/* API key input */}
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1.5">
                    API Key
                  </label>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <input
                        type={isKeyVisible ? 'text' : 'password'}
                        value={draftKey}
                        onChange={(e) => handleKeyInput(p, e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && void handleSaveKey(p)}
                        placeholder={savedKey ? 'Enter new key to replace' : meta.keyPlaceholder}
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 pr-8 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
                        autoComplete="off"
                      />
                      <button
                        onClick={() => setKeyVisible((v) => (v === p ? null : p))}
                        tabIndex={-1}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                      >
                        {isKeyVisible ? (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                          </svg>
                        ) : (
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        )}
                      </button>
                    </div>
                    <button
                      onClick={() => void handleSaveKey(p)}
                      disabled={!draftKey.trim()}
                      className={`px-3 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                        draftKey.trim()
                          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      Save & Use
                    </button>
                  </div>
                  <a
                    href={meta.hintUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-flex items-center gap-1 text-xs text-gray-400 hover:text-blue-500 transition-colors"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                    </svg>
                    Get key at {meta.keyGuide}
                  </a>
                </div>

                {/* Model selector */}
                <div>
                  <label className="text-xs font-medium text-gray-700 block mb-1.5">
                    Model
                  </label>
                  <select
                    value={selectedModel}
                    onChange={(e) => void handleModelChange(p, e.target.value)}
                    className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white transition-all"
                  >
                    {meta.models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name}
                      </option>
                    ))}
                  </select>

                  <div className="mt-2 flex gap-2">
                    <input
                      type="text"
                      value={customModelInputs[p]}
                      onChange={(e) => handleCustomModelChange(p, e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && void handleSaveCustomModel(p)}
                      placeholder={p === 'openrouter' ? 'Any OpenRouter model id (e.g. stepfun-ai/step3)' : 'Custom model id'}
                      className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
                      autoComplete="off"
                    />
                    <button
                      onClick={() => void handleSaveCustomModel(p)}
                      disabled={!customModelInputs[p].trim()}
                      className={`px-3 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                        customModelInputs[p].trim()
                          ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                          : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                      }`}
                    >
                      Use Custom
                    </button>
                  </div>
                  {p === 'openrouter' && (
                    <p className="mt-1 text-[11px] text-gray-500">
                      OpenRouter supports many models. Paste any exact model ID from openrouter.ai/models.
                    </p>
                  )}
                </div>
              </div>
            );
          })}

          {/* Google integrations */}
          <section className="mt-6 border-t border-gray-200 pt-5 space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-gray-900">Google Integrations</h3>
              <p className="text-xs text-gray-500 mt-1">
                Connect once to enable Google Sheets job tracking and Gmail sending.
              </p>
            </div>

            <div>
              <label className="text-xs font-medium text-gray-700 block mb-1.5">
                OAuth Client ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={googleClientIdInput}
                  onChange={(e) => setGoogleClientIdInput(e.target.value)}
                  placeholder="YOUR_CLIENT_ID.apps.googleusercontent.com"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
                  autoComplete="off"
                />
                <button
                  onClick={() => void handleSaveGoogleClientId()}
                  disabled={!googleClientIdInput.trim()}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                    googleClientIdInput.trim()
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Save
                </button>
              </div>
              {googleSettings.clientId && (
                <p className="mt-1 text-xs text-gray-500">
                  Saved client ID: {'••••••' + googleSettings.clientId.slice(-14)}
                </p>
              )}

              <label className="text-xs font-medium text-gray-700 block mt-3 mb-1.5">
                OAuth Client Secret (for Web OAuth clients)
              </label>
              <input
                type="password"
                value={googleClientSecretInput}
                onChange={(e) => setGoogleClientSecretInput(e.target.value)}
                placeholder="GOCSPX-..."
                className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
                autoComplete="off"
              />
              {googleSettings.clientSecret && (
                <p className="mt-1 text-xs text-gray-500">
                  Saved client secret: {'••••••••' + googleSettings.clientSecret.slice(-4)}
                </p>
              )}
              <p className="mt-1 text-[11px] text-gray-400">
                If Google returns "client_secret is missing", paste your OAuth client secret and save.
              </p>

              <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
                <p className="text-[11px] font-semibold text-amber-800">Authorized Redirect URI Required</p>
                <p className="mt-0.5 break-all text-[11px] text-amber-700">{oauthRedirectUri}</p>
                <button
                  onClick={() => {
                    void navigator.clipboard.writeText(oauthRedirectUri);
                    setToast({ type: 'success', message: 'Redirect URI copied.' });
                  }}
                  className="mt-1 text-[11px] font-medium text-amber-800 underline"
                >
                  Copy redirect URI
                </button>
              </div>
            </div>

            <GoogleConnectButton
              authState={googleAuthState}
              isBusy={isGoogleAuthBusy}
              onConnect={() => void handleConnectGoogle()}
              onDisconnect={() => void handleDisconnectGoogle()}
            />

            <div className="space-y-2 pt-1">
              <label className="text-xs font-medium text-gray-700 block">
                Spreadsheet ID
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={spreadsheetIdInput}
                  onChange={(e) => setSpreadsheetIdInput(e.target.value)}
                  placeholder="Spreadsheet ID or full Google Sheets URL"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
                  autoComplete="off"
                />
                <button
                  onClick={() => void handleSaveSpreadsheetId()}
                  disabled={!spreadsheetIdInput.trim()}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                    spreadsheetIdInput.trim()
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Save
                </button>
              </div>
              <button
                onClick={() => void handleCreateSheet()}
                disabled={isSheetCreateBusy || !googleAuthState.isConnected || !googleSettings.clientId.trim()}
                className={`w-full rounded-lg border px-3 py-2 text-xs font-medium transition-colors ${
                  isSheetCreateBusy || !googleAuthState.isConnected || !googleSettings.clientId.trim()
                    ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                    : 'border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'
                }`}
              >
                {isSheetCreateBusy ? 'Creating Sheet...' : 'Create New Sheet'}
              </button>
            </div>

            <div className="space-y-2 pt-1">
              <label className="text-xs font-medium text-gray-700 block">
                Resume Versions
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={resumeVersionInput}
                  onChange={(e) => setResumeVersionInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void handleAddResumeVersion()}
                  placeholder="e.g. v1-fullstack"
                  className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
                  autoComplete="off"
                />
                <button
                  onClick={() => void handleAddResumeVersion()}
                  disabled={!resumeVersionInput.trim()}
                  className={`px-3 py-2 text-xs font-medium rounded-lg transition-all whitespace-nowrap ${
                    resumeVersionInput.trim()
                      ? 'bg-blue-600 text-white hover:bg-blue-700 shadow-sm'
                      : 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  }`}
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {sheetsConfig.resumeVersions.map((version) => (
                  <div key={version} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-gray-50 px-2 py-0.5">
                    <span className="text-[11px] text-gray-700">{version}</span>
                    <button
                      onClick={() => void handleRemoveResumeVersion(version)}
                      className="text-gray-400 hover:text-red-600"
                      title={`Remove ${version}`}
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <p className="text-xs text-gray-400">
              Google tokens are encrypted before being persisted in local extension storage.
            </p>
          </section>

          <section className="mt-6 border-t border-gray-200 pt-5 space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-gray-900">Memory Settings</h3>
              <p className="text-xs text-gray-500 mt-1">
                Controls how conversation memory is summarized and retained.
              </p>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={memorySettings.autoSummarize}
                onChange={(e) => void handleUpdateMemorySettings({ ...memorySettings, autoSummarize: e.target.checked })}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Auto-summarize conversations on New Chat
            </label>

            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Max Memories</span>
                <input
                  type="number"
                  min={50}
                  max={1000}
                  value={memorySettings.maxMemories}
                  onChange={(e) => {
                    const maxMemories = Math.max(50, Math.min(1000, Number(e.target.value) || 50));
                    void handleUpdateMemorySettings({ ...memorySettings, maxMemories });
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-xs font-medium text-gray-700">Retention Days</span>
                <input
                  type="number"
                  min={30}
                  max={365}
                  value={memorySettings.retentionDays}
                  onChange={(e) => {
                    const retentionDays = Math.max(30, Math.min(365, Number(e.target.value) || 30));
                    void handleUpdateMemorySettings({ ...memorySettings, retentionDays });
                  }}
                  className="w-full rounded-lg border border-gray-200 px-3 py-2 text-xs outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
                />
              </label>
            </div>
          </section>

          <section className="mt-6 border-t border-gray-200 pt-5 space-y-3">
            <div>
              <h3 className="text-xs font-semibold text-gray-900">Scanner Settings</h3>
              <p className="text-xs text-gray-500 mt-1">
                Enable debug logs while refining NUworks selectors and page detection.
              </p>
            </div>

            <label className="inline-flex items-center gap-2 text-xs text-gray-700">
              <input
                type="checkbox"
                checked={scannerDebugMode}
                onChange={(e) => void handleScannerDebugModeToggle(e.target.checked)}
                className="h-3.5 w-3.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
              />
              Debug mode (log NUworks DOM signals to console)
            </label>
          </section>

          {/* Footer note */}
          <p className="text-xs text-gray-400 mt-6 pb-2">
            Keys are stored in chrome.storage.local on your device only.
            They are sent directly to the respective AI provider and nowhere else.
          </p>
        </div>

        {toast && (
          <div className="fixed top-3 right-3 z-50 max-w-[280px]">
            <div
              className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
                toast.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <p>{toast.message}</p>
              {toast.linkUrl && (
                <a
                  href={toast.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-semibold underline"
                >
                  {toast.linkLabel ?? 'Open'}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === 'memory') {
    return (
      <div className="flex flex-col h-full bg-white">
        <header className="px-4 py-3 border-b border-gray-200 shadow-sm flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">J</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">JobBuddy AI</span>
          </div>
          {renderTopTabs()}
        </header>

        <MemoryPanel
          memories={memoryStore.memories}
          preferences={memoryStore.preferences}
          storageUsageBytes={estimateMemoryUsageBytes(memoryStore)}
          maxMemories={memorySettings.maxMemories}
          onDeleteMemory={(id) => void handleDeleteMemory(id)}
          onClearAll={() => void handleClearAllMemories()}
          onDeletePreference={(key, value) => void handleDeletePreference(key, value)}
          onEditPreference={(oldKey, oldValue, next) => void handleEditPreference(oldKey, oldValue, next)}
          onExportBackup={handleExportMemoryBackup}
          onImportBackup={handleImportMemoryBackup}
          onCopyBackup={() => void handleCopyMemoryBackup()}
          lastBackupDate={lastDailyBackupDate}
          jobHuntSummary={jobHuntSummary}
        />

        <input
          ref={memoryBackupInputRef}
          type="file"
          accept="application/json"
          className="hidden"
          onChange={(event) => void handleMemoryBackupFileChange(event)}
        />

        {toast && (
          <div className="fixed top-3 right-3 z-50 max-w-[280px]">
            <div
              className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
                toast.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <p>{toast.message}</p>
              {toast.linkUrl && (
                <a
                  href={toast.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-semibold underline"
                >
                  {toast.linkLabel ?? 'Open'}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  if (view === 'scanner') {
    return (
      <div className="flex flex-col h-full bg-white">
        <header className="px-4 py-3 border-b border-gray-200 shadow-sm flex-shrink-0 space-y-2">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">J</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">JobBuddy AI</span>
          </div>
          {renderTopTabs()}
        </header>

        <ScannerTab
          detection={nuworksDetection}
          extraction={filteredCurrentPageJobs}
          isScanning={isScanningAllPages}
          scanProgress={nuworksScanProgress}
          isEnriching={isEnrichingJobs}
          enrichProgress={nuworksEnrichProgress}
          isScoring={isScoringJobs}
          scoringProgress={scannerScoringProgress}
          scoredJobs={profileFitJobs}
          allScoredJobs={allScoredJobs}
          isBusy={scannerActionBusy}
          scanNewOnly={scanNewOnly}
          showProfileFitOnly={showProfileFitOnly}
          dateFilter={scannerDateFilter}
          newJobsCount={newJobsCount}
          skippedProcessedCount={processedSkipCount}
          lastScanDate={scanCache?.lastScanDate ?? null}
          onToggleScanNewOnly={setScanNewOnly}
          onToggleProfileFitOnly={setShowProfileFitOnly}
          onDateFilterChange={setScannerDateFilter}
          onScanCurrentPage={handleScanNUworksAllPages}
          onEnrichTopJobs={handleEnrichTopJobs}
          onEnrichTest30Jobs={handleEnrichTest30Jobs}
          onScoreJobs={() => void handleScoreCurrentPageJobs()}
          onSaveJobToSheet={(job) => void handleScannerSaveJobToSheet(job)}
          onGenerateEmail={handleScannerGenerateEmail}
          onChatAboutJob={handleScannerChatAboutJob}
          onSaveAllToSheet={() => void handleScannerSaveAllToSheet()}
          onExportCsv={handleScannerExportCsv}
        />

        {toast && (
          <div className="fixed top-3 right-3 z-50 max-w-[280px]">
            <div
              className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
                toast.type === 'success'
                  ? 'border-green-200 bg-green-50 text-green-800'
                  : 'border-red-200 bg-red-50 text-red-800'
              }`}
            >
              <p>{toast.message}</p>
              {toast.linkUrl && (
                <a
                  href={toast.linkUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-1 inline-block font-semibold underline"
                >
                  {toast.linkLabel ?? 'Open'}
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Chat View
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="px-4 py-3 border-b border-gray-200 shadow-sm flex-shrink-0 space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
              <span className="text-white text-sm font-bold">J</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">JobBuddy AI</span>
            <span
              className="text-xs font-medium px-2 py-0.5 rounded-full"
              style={{ backgroundColor: activeMeta.color + '20', color: activeMeta.color }}
              title={`Model: ${activeModelLabel}`}
            >
              {activeMeta.label}
            </span>
          </div>

          <button
            onClick={() => void handleStartNewChat()}
            disabled={isMemoryBusy || isLoading}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              isMemoryBusy || isLoading
                ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
            title="Summarize this conversation (if enabled) and start a fresh chat"
          >
            {isMemoryBusy ? 'Saving...' : 'New Chat'}
          </button>
        </div>
        {renderTopTabs()}
      </header>

      {loadedMemoryCount > 0 && (
        <div className="mx-3 mt-2 px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50 text-[11px] text-blue-700 flex-shrink-0">
          {loadedMemoryCount} relevant memories loaded for this conversation.
          {lastPromptMemoryContext?.learnedPreferences?.length ? ' Preferences applied.' : ''}
        </div>
      )}

      {/* Error banner */}
      {errorBanner && (
        <div className="flex items-start gap-2 mx-3 mt-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg text-xs text-red-800 flex-shrink-0">
          <svg className="w-3.5 h-3.5 flex-shrink-0 mt-0.5 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span className="flex-1">{errorBanner}</span>
          <button onClick={() => setErrorBanner(null)} className="flex-shrink-0 hover:text-red-600">
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Chat window */}
      <ChatWindow
        messages={messages}
        isLoading={isLoading}
        onSuggestedPrompt={handleSuggestedPrompt}
        onSendViaGmail={handleOpenEmailCompose}
        onEditAndSend={handleOpenEmailCompose}
        onCopyEmail={(messageId) => void handleCopyEmailMessage(messageId)}
        isEmailMessage={(messageId) => Boolean(emailMessageIds[messageId])}
      />

      {/* Page context banner */}
      {pageContext && (
        <PageContextBanner
          pageContext={pageContext}
          nuworksDetection={nuworksDetection}
          onClear={() => {
            setPageContext(null);
            setNuworksDetection(null);
            setNuworksCurrentPageJobs(null);
            setNuworksScanProgress(null);
            setNuworksEnrichProgress(null);
            setNuworksScoredJobs([]);
            setScannerScoringProgress(null);
          }}
        />
      )}

      {/* Input bar */}
      <InputBar
        value={inputValue}
        onChange={setInputValue}
        onSend={handleSend}
        onReadPage={handleReadPage}
        onAnalyzeJob={handleAnalyzeJob}
        onSaveToSheet={() => void handleExtractJobForSheet()}
        onComposeEmail={handleComposeEmailManually}
        isLoading={isLoading}
        isReadingPage={isReadingPage}
        isExtractingJob={isExtractingJob}
        canSaveToSheet={Boolean(pageContext) && googleAuthState.isConnected && Boolean(sheetsConfig.spreadsheetId)}
      />

      <JobSaveModal
        isOpen={isJobSaveModalOpen}
        draft={jobDraft}
        resumeVersions={sheetsConfig.resumeVersions}
        isSaving={isSavingJob}
        onClose={() => setIsJobSaveModalOpen(false)}
        onChange={setJobDraft}
        onSave={() => void handleSaveJobToSheet()}
      />

      <EmailComposeModal
        isOpen={isEmailComposeOpen}
        draft={emailDraft}
        resumeVersions={sheetsConfig.resumeVersions}
        emailType={selectedEmailType}
        emailTypeConfidence={emailTypeConfidence}
        recipientSuggestions={recipientSuggestions}
        isBusy={isEmailBusy}
        onClose={() => setIsEmailComposeOpen(false)}
        onEmailTypeChange={handleEmailTypeChange}
        onRegenerate={() => void handleRegenerateEmailDraft()}
        onMakeShorter={handleMakeEmailShorter}
        onMakeLonger={handleMakeEmailLonger}
        onMoreFormal={handleMakeEmailMoreFormal}
        onMoreCasual={handleMakeEmailMoreCasual}
        onChange={setEmailDraft}
        onSend={() => void handleSendEmail()}
        onSaveDraft={() => void handleSaveEmailDraft()}
      />

      {toast && (
        <div className="fixed top-3 right-3 z-50 max-w-[280px]">
          <div
            className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
              toast.type === 'success'
                ? 'border-green-200 bg-green-50 text-green-800'
                : 'border-red-200 bg-red-50 text-red-800'
            }`}
          >
            <p>{toast.message}</p>
            {toast.linkUrl && (
              <a
                href={toast.linkUrl}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-block font-semibold underline"
              >
                {toast.linkLabel ?? 'Open'}
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
