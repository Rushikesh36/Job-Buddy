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
  RunLLMUtilityResult,
  FallbackSettings,
} from '../lib/types';
import { DEFAULT_PROVIDER_SETTINGS, DEFAULT_GOOGLE_AUTH_STATE, DEFAULT_GOOGLE_SETTINGS, DEFAULT_FALLBACK_SETTINGS } from '../lib/types';
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
  loadSheetsConfig,
  markJobAsEmailed,
  normalizeSpreadsheetId,
  saveSheetsConfig,
} from '../services/sheets-service';
import { buildJobHuntSummary, loadActivityStore, recordApplication, recordOutreach, saveActivityStore, type ActivityStore } from '../services/activity-service';
import { parseJobFromPage } from '../prompts/job-extractor';
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
import { checkOllamaConnection, getOllamaModels, type OllamaStatus } from '../services/ollama-connection';
import ChatWindow from './components/ChatWindow';
import InputBar from './components/InputBar';
import PageContextBanner from './components/PageContextBanner';
import GoogleConnectButton from './components/GoogleConnectButton';
import JobSaveModal from './components/JobSaveModal';
import EmailComposeModal from './components/EmailComposeModal';
import MemoryPanel from './components/MemoryPanel';

const PROVIDERS: LLMProvider[] = ['claude', 'gemini', 'openai', 'ollama', 'openrouter'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadSettings(): Promise<ProviderSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['providerSettings'], (result) => {
      const raw = (result.providerSettings as Partial<ProviderSettings>) ?? DEFAULT_PROVIDER_SETTINGS;
      const normalizedOllamaBaseUrl =
        raw.ollamaBaseUrl === 'http://localhost:11434'
          ? 'http://127.0.0.1:11434'
          : raw.ollamaBaseUrl;
      const selectedProvider = PROVIDERS.includes(raw.selectedProvider as LLMProvider)
        ? (raw.selectedProvider as LLMProvider)
        : DEFAULT_PROVIDER_SETTINGS.selectedProvider;

      const nextSettings = {
        ...DEFAULT_PROVIDER_SETTINGS,
        selectedProvider,
        apiKeys: {
          ...DEFAULT_PROVIDER_SETTINGS.apiKeys,
          ...(raw.apiKeys ?? {}),
        },
        selectedModels: {
          ...DEFAULT_PROVIDER_SETTINGS.selectedModels,
          ...(raw.selectedModels ?? {}),
        },
        ollamaBaseUrl: normalizedOllamaBaseUrl ?? DEFAULT_PROVIDER_SETTINGS.ollamaBaseUrl,
      };

      if (raw.ollamaBaseUrl === 'http://localhost:11434') {
        chrome.storage.local.set({ providerSettings: nextSettings });
      }

      resolve(nextSettings);
    });
  });
}

function saveSettings(settings: ProviderSettings): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.set({ providerSettings: settings }, resolve);
  });
}

// ─── App ──────────────────────────────────────────────────────────────────────

type View = 'chat' | 'memory' | 'settings';
type ToastType = 'success' | 'error' | 'warning';
interface ToastState {
  type: ToastType;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
}

interface EmailGenerationSeed {
  userIntentText: string;
  source: 'manual' | 'chat';
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
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingPage, setIsReadingPage] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

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
    ollama: '',
  });
  const [keyVisible, setKeyVisible] = useState<LLMProvider | null>(null);
  const [customModelInputs, setCustomModelInputs] = useState<Record<LLMProvider, string>>({
    claude: '',
    gemini: '',
    openai: '',
    openrouter: '',
    ollama: '',
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
  const [fallbackSettings, setFallbackSettings] = useState<FallbackSettings>(DEFAULT_FALLBACK_SETTINGS);
  const memoryBackupInputRef = useRef<HTMLInputElement>(null);

  const [ollamaStatus, setOllamaStatus] = useState<OllamaStatus | null>(null);
  const [ollamaBaseUrlInput, setOllamaBaseUrlInput] = useState('http://127.0.0.1:11434');

  const showToast = useCallback((type: ToastType, message: string, linkUrl?: string, linkLabel?: string) => {
    setToast({ type, message, linkUrl, linkLabel });
  }, []);

  const checkOllama = useCallback(async () => {
    setOllamaStatus(null); // trigger checking state
    const url = providerSettings.ollamaBaseUrl || 'http://127.0.0.1:11434';
    const status = await checkOllamaConnection(url);
    setOllamaStatus(status);
  }, [providerSettings.ollamaBaseUrl]);

  const handleOllamaUrlSave = async () => {
    const trimmed = ollamaBaseUrlInput.trim() || 'http://127.0.0.1:11434';
    const newSettings = { ...providerSettings, ollamaBaseUrl: trimmed };
    await saveSettings(newSettings);
    setProviderSettings(newSettings);
    showToast('success', 'Ollama Base URL saved');
    checkOllama();
  };

  useEffect(() => {
    if (settingsTab === 'ollama') {
      checkOllama();
    }
  }, [settingsTab, checkOllama]);

  useEffect(() => {
    setOllamaBaseUrlInput(providerSettings.ollamaBaseUrl || 'http://127.0.0.1:11434');
  }, [providerSettings.ollamaBaseUrl]);
  const hasHydratedMemoryRef = useRef(false);
  const dailyBackupInFlightRef = useRef(false);
  const lastAutoSavedAssistantIdRef = useRef<string | null>(null);

  const streamingMsgIdRef = useRef<string | null>(null);
  // Synchronous guard against double-sends before React re-renders with isLoading:true
  const isSendingRef = useRef(false);

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
      ]) => {
        setProviderSettings(settings);
        setSettingsTab(settings.selectedProvider);
        setCustomModelInputs(settings.selectedModels);
        setOllamaBaseUrlInput(settings.ollamaBaseUrl ?? DEFAULT_PROVIDER_SETTINGS.ollamaBaseUrl ?? 'http://127.0.0.1:11434');
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
        hasHydratedMemoryRef.current = true;
        const activeKey = settings.apiKeys[settings.selectedProvider];
        if (settings.selectedProvider !== 'ollama' && !activeKey) setView('settings');
      }
    );
    chrome.storage.local.get(['fallbackSettings'], (res) => {
      if (res.fallbackSettings) setFallbackSettings(res.fallbackSettings as FallbackSettings);
    });
  }, []);

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

      if (message.type === 'FALLBACK_SWITCH') {
        const { from, to } = message.payload as { from: string; to: string };
        setToast({
          type: 'warning',
          message:
            from === 'ollama'
              ? `Ollama is not running. Falling back to ${to}...`
              : `Rate limit on ${from}. Switching to ${to}...`,
        });
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
    try {
      const data = await readActivePageContext();
      setPageContext(data);
    } catch (error) {
      setErrorBanner(error instanceof Error ? error.message : "Couldn't read this page.");
    } finally {
      setIsReadingPage(false);
    }
  }, [readActivePageContext]);

  const runUtilityPrompt = useCallback(
    async (prompt: string): Promise<string> => {
      const { selectedProvider, apiKeys, selectedModels } = providerSettings;
      const apiKey = apiKeys[selectedProvider];
      if (selectedProvider !== 'ollama' && !apiKey) {
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
                  baseUrl: selectedProvider === 'ollama' ? providerSettings.ollamaBaseUrl : undefined,
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

  const summarizeCurrentConversationToMemory = useCallback(async () => {}, []);

  const handleStartNewChat = useCallback(async () => {
    setMessages([]);
    setLoadedMemoryCount(0);
    setLastPromptMemoryContext(null);
    lastAutoSavedAssistantIdRef.current = null;
  }, []);

  const handleSend = useCallback(
    (overrideText?: string, overridePageContext?: PageContext) => {
      const text = (overrideText ?? inputValue).trim();
      // isSendingRef is synchronous; isLoading is the React-rendered fallback
      if (!text || isSendingRef.current || isLoading) return;
      isSendingRef.current = true;

      const { selectedProvider, apiKeys, selectedModels } = providerSettings;
      const apiKey = apiKeys[selectedProvider];

      if (selectedProvider !== 'ollama' && !apiKey) {
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
      setLoadedMemoryCount(0);
      setLastPromptMemoryContext(null);

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
              baseUrl: selectedProvider === 'ollama' ? providerSettings.ollamaBaseUrl : undefined,
            },
            messageId,
            memoryContext: null,
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
    const prompt = 'Analyze this job description and match it to my profile. Also tell me if I should reach out to a recruiter and whether I must tailor my resume before applying.';

    if (pageContext) {
      handleSend(prompt, pageContext);
      return;
    }

    try {
      setIsReadingPage(true);
      setErrorBanner(null);
      const data = await readActivePageContext();
      setPageContext(data);
      handleSend(prompt, data);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Read the page first before analyzing.';
      setErrorBanner(message);
      setToast({ type: 'error', message });
    } finally {
      setIsReadingPage(false);
    }
  }, [handleSend, pageContext, readActivePageContext]);

  // ── settings handlers ──

  const handleCustomModelAdd = async (provider: LLMProvider) => {
    const customModel = customModelInputs[provider].trim();
    if (!customModel) return;

    const newSettings = {
      ...providerSettings,
      selectedModels: { ...providerSettings.selectedModels, [provider]: customModel },
    };
    await saveSettings(newSettings);
    setProviderSettings(newSettings);
    setCustomModelInputs({ ...customModelInputs, [provider]: '' });
    showToast('success', `${PROVIDER_META[provider].label} model set to ${customModel}.`);
  };

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
    const { selectedProvider, apiKeys } = providerSettings;
    const apiKey = apiKeys[selectedProvider];
    if (selectedProvider !== 'ollama' && !apiKey) {
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
      const analysisText = [...messages]
        .reverse()
        .find((msg) => msg.role === 'assistant' && /ATS Match Score:/i.test(msg.content))?.content ?? '';

      const draft = parseJobFromPage({
        text: pageContext.textContent,
        url: pageContext.url,
        pageTitle: pageContext.title,
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

  const renderToast = () =>
    toast ? (
      <div className="fixed top-3 right-3 z-50 max-w-[280px]">
        <div
          className={`rounded-lg border px-3 py-2 text-xs shadow-lg ${
            toast.type === 'success'
              ? 'border-green-200 bg-green-50 text-green-800'
              : toast.type === 'warning'
              ? 'border-amber-200 bg-amber-50 text-amber-800'
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
    ) : null;

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
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700" title="Total applications recorded">
              Applications {jobHuntSummary.applications.total}
            </span>
          </div>
          {renderTopTabs()}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {/* Provider Status */}
          <div className="mb-4 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
            <p className="text-[11px] font-medium text-gray-700">
              Providers ready:{' '}
              {PROVIDERS.filter(p => providerSettings.apiKeys[p]?.trim()).map(p => (
                <span key={p} className="ml-1 inline-flex items-center gap-0.5 text-emerald-600">
                  <span className="text-[10px]">✓</span> {p}
                </span>
              ))}
              {PROVIDERS.filter(p => !providerSettings.apiKeys[p]?.trim()).length > 0 && (
                <span className="ml-2 text-gray-400">
                  ({PROVIDERS.filter(p => !providerSettings.apiKeys[p]?.trim()).length} not configured)
                </span>
              )}
            </p>
          </div>

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

            if (p === 'ollama') {
              return (
                <div key={p} className="space-y-4">
                  {/* Active indicator */}
                  {isCurrentlyActive ? (
                    <div className="flex items-center justify-between text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        <span className="font-medium">Currently active provider</span>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => void handleActivateProvider(p)}
                      className="w-full text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 hover:bg-blue-100 rounded-lg px-3 py-2 transition-colors text-left"
                    >
                      Switch to Ollama →
                    </button>
                  )}

                  {/* Settings section */}
                  <div className="bg-white border rounded-lg p-3 space-y-4">
                    {/* Status indicator */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className={`w-2.5 h-2.5 rounded-full ${ollamaStatus?.connected ? 'bg-green-500' : 'bg-red-500'}`}></div>
                        <span className="text-xs font-medium text-gray-700">
                          {ollamaStatus ? ollamaStatus.message : 'Checking connection...'}
                        </span>
                      </div>
                      <button
                        onClick={() => void checkOllama()}
                        className="text-xs text-blue-600 hover:text-blue-800 transition-colors"
                      >
                        Test Connection
                      </button>
                    </div>

                    {/* Optional URL */}
                    <div>
                      <label className="text-xs font-medium text-gray-700 block mb-1.5">Base URL</label>
                      <div className="flex gap-2">
                        <input
                          type="text"
                          value={ollamaBaseUrlInput}
                          onChange={(e) => setOllamaBaseUrlInput(e.target.value)}
                          onKeyDown={(e) => e.key === 'Enter' && void handleOllamaUrlSave()}
                          placeholder="http://localhost:11434"
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all"
                        />
                        <button
                          onClick={() => void handleOllamaUrlSave()}
                          className="px-3 py-2 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-all"
                        >
                          Save
                        </button>
                      </div>
                      <p className="mt-1 text-[11px] text-gray-500">Change only if running Ollama on a different port.</p>
                    </div>

                    {/* Model */}
                    <div>
                      <label className="text-xs font-medium text-gray-700 block mb-1.5">Model</label>
                      <select
                        value={selectedModel}
                        onChange={(e) => void handleModelChange(p, e.target.value)}
                        disabled={!ollamaStatus?.connected}
                        className="w-full text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 bg-white transition-all disabled:bg-gray-50 disabled:text-gray-400"
                      >
                         <optgroup label="-- Recommended --">
                           {meta.models.map((m) => (
                             <option key={m.id} value={m.id}>{m.name}</option>
                           ))}
                         </optgroup>
                         {ollamaStatus?.connected && ollamaStatus.models.length > 0 && (
                           <optgroup label="-- Other Installed Models --">
                             {ollamaStatus.models
                               .filter(m => !meta.models.some(dm => dm.id === m))
                               .map((m) => (
                               <option key={m} value={m}>{m}</option>
                             ))}
                           </optgroup>
                         )}
                      </select>
                      
                      <div className="mt-2 flex gap-2">
                        <input
                          type="text"
                          value={customModelInputs[p]}
                          onChange={(e) =>
                            setCustomModelInputs({ ...customModelInputs, [p]: e.target.value })
                          }
                          onKeyDown={(e) =>
                            e.key === 'Enter' &&
                            customModelInputs[p].trim() &&
                            void handleCustomModelAdd(p)
                          }
                          placeholder="Type custom model name..."
                          disabled={!ollamaStatus?.connected}
                          className="flex-1 text-xs border border-gray-200 rounded-lg px-3 py-2 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400 transition-all disabled:bg-gray-50"
                        />
                        <button
                          onClick={() => void handleCustomModelAdd(p)}
                          disabled={!ollamaStatus?.connected || !customModelInputs[p].trim()}
                          className={`px-3 py-1 text-xs rounded-md transition-all ${
                            !ollamaStatus?.connected || !customModelInputs[p].trim()
                              ? 'bg-gray-100 text-gray-400'
                              : 'bg-white border text-gray-700 hover:bg-gray-50'
                          }`}
                        >
                          Use
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="text-xs text-gray-500 bg-gray-50 rounded-lg p-3 space-y-1">
                    <p className="font-medium text-gray-700">Free, unlimited, offline. No API key needed.</p>
                    <p>Install from <a href="https://ollama.com" target="_blank" className="text-blue-600 hover:underline">ollama.com</a>. Pull models with:</p>
                    <code className="block bg-gray-200 px-2 py-1 rounded mt-1">ollama pull qwen2.5:14b</code>
                  </div>
                </div>
              );
            }

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

          {/* Auto-Fallback */}
          <section className="mt-6 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
            <h3 className="text-sm font-semibold text-gray-900">Auto-Fallback</h3>
            <p className="mt-0.5 text-xs text-gray-500">
              Automatically switch providers when rate limits are hit.
            </p>
            <label className="mt-3 flex items-center justify-between">
              <span className="text-xs text-gray-700">Enable auto-fallback</span>
              <input
                type="checkbox"
                checked={fallbackSettings.enabled}
                onChange={(e) => {
                  const next = { ...fallbackSettings, enabled: e.target.checked };
                  setFallbackSettings(next);
                  chrome.storage.local.set({ fallbackSettings: next });
                }}
                className="h-4 w-4 rounded border-gray-300 text-blue-600"
              />
            </label>
            {fallbackSettings.enabled && (
              <div className="mt-3">
                <p className="text-[11px] font-medium text-gray-600">Fallback order (configured providers):</p>
                <ol className="mt-1 space-y-1">
                  {fallbackSettings.order
                    .filter(p => providerSettings.apiKeys[p]?.trim())
                    .map((p, i) => (
                      <li key={p} className="text-[11px] text-gray-700">
                        {i + 1}. {p.charAt(0).toUpperCase() + p.slice(1)}
                      </li>
                    ))}
                </ol>
                <label className="mt-2 flex items-center justify-between">
                  <span className="text-xs text-gray-700">Show "via Provider" on fallback messages</span>
                  <input
                    type="checkbox"
                    checked={fallbackSettings.showProviderLabel}
                    onChange={(e) => {
                      const next = { ...fallbackSettings, showProviderLabel: e.target.checked };
                      setFallbackSettings(next);
                      chrome.storage.local.set({ fallbackSettings: next });
                    }}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600"
                  />
                </label>
              </div>
            )}
          </section>

          {/* Footer note */}
          <p className="text-xs text-gray-400 mt-6 pb-2">
            Keys are stored in chrome.storage.local on your device only.
            They are sent directly to the respective AI provider and nowhere else.
          </p>
        </div>

        {renderToast()}
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
            <span className="text-xs font-medium px-2 py-0.5 rounded-full bg-gray-100 text-gray-700" title="Total applications recorded">
              Applications {jobHuntSummary.applications.total}
            </span>
          </div>

          <button
            onClick={() => void handleStartNewChat()}
            disabled={isLoading}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-medium ${
              isLoading
                ? 'border-gray-200 bg-gray-100 text-gray-400 cursor-not-allowed'
                : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50'
            }`}
            title="Start a fresh chat"
          >
            New Chat
          </button>
        </div>
        {renderTopTabs()}
      </header>

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
          onClear={() => {
            setPageContext(null);
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
        canSaveToSheet={Boolean(pageContext)}
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

      {renderToast()}
    </div>
  );
}
