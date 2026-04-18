import { useState, useEffect, useCallback, useRef } from 'react';
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
import { buildJobExtractionPrompt, toJobDraft } from '../prompts/job-extractor';
import type { JobData, SheetsConfig } from '../types/job';
import { DEFAULT_SHEETS_CONFIG } from '../types/job';
import { detectEmailDraft, saveGmailDraft, sendEmailViaGmail } from '../services/gmail-service';
import type { EmailDraft } from '../types/email';
import { buildConversationSummaryPrompt } from '../prompts/summarizer';
import { buildPreferenceExtractionPrompt } from '../prompts/preference-extractor';
import {
  applyMemoryLimits,
  buildPromptMemoryContext,
  createMemoryRecord,
  estimateMemoryUsageBytes,
  loadMemorySettings,
  loadMemoryStore,
  mergePreferences,
  parsePreferenceCandidates,
  saveMemorySettings,
  saveMemoryStore,
  searchMemories,
} from '../services/memory-service';
import type { MemorySettings, MemoryStore, PromptMemoryContext } from '../types/memory';
import { DEFAULT_MEMORY_SETTINGS, DEFAULT_MEMORY_STORE } from '../types/memory';
import ChatWindow from './components/ChatWindow';
import InputBar from './components/InputBar';
import PageContextBanner from './components/PageContextBanner';
import GoogleConnectButton from './components/GoogleConnectButton';
import JobSaveModal from './components/JobSaveModal';
import EmailComposeModal from './components/EmailComposeModal';
import MemoryPanel from './components/MemoryPanel';

const PROVIDERS: LLMProvider[] = ['claude', 'gemini', 'openai'];

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateId() {
  return `${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function loadSettings(): Promise<ProviderSettings> {
  return new Promise((resolve) => {
    chrome.storage.local.get(['providerSettings'], (result) => {
      resolve((result.providerSettings as ProviderSettings) ?? DEFAULT_PROVIDER_SETTINGS);
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
type ToastType = 'success' | 'error';
interface ToastState {
  type: ToastType;
  message: string;
  linkUrl?: string;
  linkLabel?: string;
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
  const [keyInputs, setKeyInputs] = useState<Record<LLMProvider, string>>({ claude: '', gemini: '', openai: '' });
  const [keyVisible, setKeyVisible] = useState<LLMProvider | null>(null);
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
  const [memoryStore, setMemoryStore] = useState<MemoryStore>(DEFAULT_MEMORY_STORE);
  const [memorySettings, setMemorySettingsState] = useState<MemorySettings>(DEFAULT_MEMORY_SETTINGS);
  const [loadedMemoryCount, setLoadedMemoryCount] = useState(0);
  const [lastPromptMemoryContext, setLastPromptMemoryContext] = useState<PromptMemoryContext | null>(null);
  const [isMemoryBusy, setIsMemoryBusy] = useState(false);

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
    ]).then(
      ([
        settings,
        storedGoogleSettings,
        storedGoogleAuthState,
        storedSheetsConfig,
        storedMemoryStore,
        storedMemorySettings,
      ]) => {
        setProviderSettings(settings);
        setSettingsTab(settings.selectedProvider);
        setGoogleSettingsState(storedGoogleSettings);
        setGoogleClientIdInput(storedGoogleSettings.clientId);
        setGoogleClientSecretInput(storedGoogleSettings.clientSecret ?? '');
        setGoogleAuthState(storedGoogleAuthState);
        setSheetsConfigState(storedSheetsConfig);
        setSpreadsheetIdInput(storedSheetsConfig.spreadsheetId ?? '');
        setMemoryStore(storedMemoryStore);
        setMemorySettingsState(storedMemorySettings);
        const activeKey = settings.apiKeys[settings.selectedProvider];
        if (!activeKey) setView('settings');
      }
    );
  }, []);

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
    };

    chrome.runtime.onMessage.addListener(handler);
    return () => chrome.runtime.onMessage.removeListener(handler);
  }, []);

  // ── actions ──
  const handleReadPage = useCallback(() => {
    setIsReadingPage(true);
    setErrorBanner(null);
    chrome.runtime.sendMessage({ type: 'GET_PAGE_CONTENT' }, (response) => {
      setIsReadingPage(false);
      if (chrome.runtime.lastError || !response?.success) {
        setErrorBanner(
          response?.error ?? chrome.runtime.lastError?.message ?? "Couldn't read this page."
        );
        return;
      }
      const data = response.data as PageContext;
      setPageContext(data);
    });
  }, []);

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
    if (messages.length > 1) {
      await summarizeCurrentConversationToMemory();
    }
    setMessages([]);
    setLoadedMemoryCount(0);
    setLastPromptMemoryContext(null);
  }, [messages.length, summarizeCurrentConversationToMemory]);

  const handleSend = useCallback(
    (overrideText?: string) => {
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

      const queryText = [text, pageContext?.title ?? '', pageContext?.url ?? ''].join(' ').trim();
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
            pageContext,
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

  const handleAnalyzeJob = useCallback(() => {
    if (!pageContext) return;
    handleSend('Analyze this job description and match it to my profile. Also tell me if I should reach out to a recruiter and whether I must tailor my resume before applying.');
  }, [handleSend, pageContext]);

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
    await saveSettings(next);
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

  const buildEmailDraftFromMessage = (messageId: string): EmailDraft | null => {
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

    return detected.draft;
  };

  const handleOpenEmailCompose = (messageId: string) => {
    if (!googleAuthState.isConnected || !googleSettings.clientId.trim()) {
      setView('settings');
      setToast({ type: 'error', message: 'Connect Google account first in Settings.' });
      return;
    }

    const draft = buildEmailDraftFromMessage(messageId);
    if (!draft) {
      setToast({ type: 'error', message: 'Unable to parse email draft from this message.' });
      return;
    }

    setEmailDraft(draft);
    setIsEmailComposeOpen(true);
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

    setIsEmailBusy(true);
    try {
      const sent = await sendEmailViaGmail({
        clientId: googleSettings.clientId,
        clientSecret: googleSettings.clientSecret,
        draft: emailDraft,
        relatedJobUrl: pageContext?.url,
        relatedCompany: jobDraft?.company,
      });

      setIsEmailComposeOpen(false);
      setToast({
        type: 'success',
        message: `Email sent successfully (${sent.id.slice(0, 8)}).`,
      });

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

    setIsEmailBusy(true);
    try {
      await saveGmailDraft({
        clientId: googleSettings.clientId,
        clientSecret: googleSettings.clientSecret,
        draft: emailDraft,
      });
      setIsEmailComposeOpen(false);
      setToast({ type: 'success', message: 'Saved as Gmail draft.' });
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
          onClear={() => setPageContext(null)}
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
        isLoading={isLoading}
        isReadingPage={isReadingPage}
        isExtractingJob={isExtractingJob}
        hasPageContext={Boolean(pageContext)}
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
        isBusy={isEmailBusy}
        onClose={() => setIsEmailComposeOpen(false)}
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
