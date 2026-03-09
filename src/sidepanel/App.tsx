import { useState, useEffect, useCallback, useRef } from 'react';
import type {
  ChatMessage,
  PageContext,
  LLMMessage,
  LLMProvider,
  ProviderSettings,
} from '../lib/types';
import { DEFAULT_PROVIDER_SETTINGS } from '../lib/types';
import { PROVIDER_META } from '../lib/llm-api';
import ChatWindow from './components/ChatWindow';
import InputBar from './components/InputBar';
import PageContextBanner from './components/PageContextBanner';

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

type View = 'chat' | 'settings';

export default function App() {
  // ── state ──
  const [view, setView] = useState<View>('chat');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isReadingPage, setIsReadingPage] = useState(false);
  const [errorBanner, setErrorBanner] = useState<string | null>(null);

  // provider settings (persisted)
  const [providerSettings, setProviderSettings] = useState<ProviderSettings>(DEFAULT_PROVIDER_SETTINGS);

  // settings-view local state
  const [settingsTab, setSettingsTab] = useState<LLMProvider>('claude');
  // per-provider key inputs (draft values, not saved yet)
  const [keyInputs, setKeyInputs] = useState<Record<LLMProvider, string>>({ claude: '', gemini: '', openai: '' });
  const [keyVisible, setKeyVisible] = useState<LLMProvider | null>(null);

  const streamingMsgIdRef = useRef<string | null>(null);
  // Synchronous guard against double-sends before React re-renders with isLoading:true
  const isSendingRef = useRef(false);

  // ── on mount: load settings ──
  useEffect(() => {
    loadSettings().then((settings) => {
      setProviderSettings(settings);
      setSettingsTab(settings.selectedProvider);
      const activeKey = settings.apiKeys[settings.selectedProvider];
      if (!activeKey) setView('settings');
    });
  }, []);

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
    [inputValue, isLoading, providerSettings, messages, pageContext]
  );

  const handleSuggestedPrompt = useCallback(
    (prompt: string) => handleSend(prompt),
    [handleSend]
  );

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

  // ── derive active provider info ──
  const activeMeta = PROVIDER_META[providerSettings.selectedProvider];
  const activeModel = providerSettings.selectedModels[providerSettings.selectedProvider];
  const activeModelLabel =
    activeMeta.models.find((m) => m.id === activeModel)?.name ?? activeModel;

  // ─────────────────────────────────────────────────────────────────────────────
  //  Settings View
  // ─────────────────────────────────────────────────────────────────────────────
  if (view === 'settings') {
    const hasAnyKey = PROVIDERS.some((p) => providerSettings.apiKeys[p]);

    return (
      <div className="flex flex-col h-full bg-white">
        {/* Header */}
        <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shadow-sm flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center">
              <span className="text-white text-sm font-bold">J</span>
            </div>
            <span className="text-sm font-semibold text-gray-900">LLM Settings</span>
          </div>
          {hasAnyKey && (
            <button
              onClick={() => setView('chat')}
              className="text-xs text-gray-500 hover:text-gray-700 transition-colors"
            >
              ← Back
            </button>
          )}
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

          {/* Footer note */}
          <p className="text-xs text-gray-400 mt-6 pb-2">
            Keys are stored in chrome.storage.local on your device only.
            They are sent directly to the respective AI provider and nowhere else.
          </p>
        </div>
      </div>
    );
  }

  // ─────────────────────────────────────────────────────────────────────────────
  //  Chat View
  // ─────────────────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-gray-200 shadow-sm flex-shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-7 h-7 rounded-lg bg-blue-600 flex items-center justify-center shadow-sm">
            <span className="text-white text-sm font-bold">J</span>
          </div>
          <span className="text-sm font-semibold text-gray-900">JobBuddy AI</span>
          {/* Active provider badge */}
          <span
            className="text-xs font-medium px-2 py-0.5 rounded-full"
            style={{ backgroundColor: activeMeta.color + '20', color: activeMeta.color }}
            title={`Model: ${activeModelLabel}`}
          >
            {activeMeta.label}
          </span>
        </div>
        <button
          onClick={() => {
            setSettingsTab(providerSettings.selectedProvider);
            setView('settings');
          }}
          title="LLM Settings"
          className="w-8 h-8 flex items-center justify-center rounded-lg text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
          </svg>
        </button>
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
        isLoading={isLoading}
        isReadingPage={isReadingPage}
      />
    </div>
  );
}
