/**
 * Unified LLM streaming client.
 * Supports Claude (Anthropic), Gemini (Google), and OpenAI (GPT / o-series).
 * Each provider gets its own private stream function; the exported
 * `streamLLMResponse` dispatches to the right one based on LLMConfig.provider.
 */

import type { LLMMessage, LLMConfig, LLMProvider } from './types';

// ---------------------------------------------------------------------------
// Provider catalog — consumed by the settings UI
// ---------------------------------------------------------------------------

export interface ModelOption {
  id: string;
  name: string;
}

export interface ProviderMeta {
  label: string;
  color: string;
  models: ModelOption[];
  defaultModel: string;
  keyPlaceholder: string;
  keyGuide: string;
  hintUrl: string;
}

export const PROVIDER_META: Record<LLMProvider, ProviderMeta> = {
  claude: {
    label: 'Claude',
    color: '#D97757',
    models: [
      { id: 'claude-opus-4-5',           name: 'Claude Opus 4.5' },
      { id: 'claude-sonnet-4-20250514',  name: 'Claude Sonnet 4 (Recommended)' },
      { id: 'claude-haiku-3-5-20241022', name: 'Claude Haiku 3.5 (Fast)' },
    ],
    defaultModel: 'claude-sonnet-4-20250514',
    keyPlaceholder: 'sk-ant-api03-…',
    keyGuide: 'console.anthropic.com',
    hintUrl: 'https://console.anthropic.com/settings/keys',
  },
  gemini: {
    label: 'Gemini',
    color: '#4285F4',
    models: [
      { id: 'gemini-2.5-flash',      name: 'Gemini 2.5 Flash (5 RPM free) ✓' },
      { id: 'gemini-2.5-pro',        name: 'Gemini 2.5 Pro (paid tier only)' },
      { id: 'gemini-2.0-flash',      name: 'Gemini 2.0 Flash (15 RPM free)' },
      { id: 'gemini-2.0-flash-lite', name: 'Gemini 2.0 Flash-Lite (30 RPM free)' },
      { id: 'gemini-1.5-flash',      name: 'Gemini 1.5 Flash (15 RPM free)' },
    ],
    defaultModel: 'gemini-2.5-flash',
    keyPlaceholder: 'AIzaSy…',
    keyGuide: 'aistudio.google.com',
    hintUrl: 'https://aistudio.google.com/app/apikey',
  },
  openai: {
    label: 'OpenAI',
    color: '#10A37F',
    models: [
      { id: 'gpt-4o',      name: 'GPT-4o (Recommended)' },
      { id: 'gpt-4o-mini', name: 'GPT-4o mini (Fast)' },
      { id: 'o4-mini',     name: 'o4-mini (Reasoning)' },
      { id: 'o3',          name: 'o3' },
    ],
    defaultModel: 'gpt-4o',
    keyPlaceholder: 'sk-proj-…',
    keyGuide: 'platform.openai.com/api-keys',
    hintUrl: 'https://platform.openai.com/api-keys',
  },
  openrouter: {
    label: 'OpenRouter',
    color: '#6C47FF',
    models: [
      { id: 'meta-llama/llama-3.1-8b-instruct:free', name: 'Llama 3.1 8B Instruct (Free)' },
      { id: 'google/gemma-2-9b-it:free', name: 'Gemma 2 9B Instruct (Free)' },
      { id: 'qwen/qwen-2.5-7b-instruct:free', name: 'Qwen 2.5 7B Instruct (Free)' },
      { id: 'mistralai/mistral-7b-instruct:free', name: 'Mistral 7B Instruct (Free)' },
      { id: 'openrouter/auto', name: 'OpenRouter Auto (May Require Credits)' },
      { id: 'deepseek/deepseek-chat-v3-0324', name: 'DeepSeek Chat v3 (May Require Credits)' },
      { id: 'google/gemini-2.5-flash', name: 'Gemini 2.5 Flash via OpenRouter (May Require Credits)' },
      { id: 'openai/gpt-4o-mini', name: 'GPT-4o mini via OpenRouter (May Require Credits)' },
      { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku via OpenRouter (May Require Credits)' },
    ],
    defaultModel: 'meta-llama/llama-3.1-8b-instruct:free',
    keyPlaceholder: 'sk-or-v1-…',
    keyGuide: 'openrouter.ai/keys',
    hintUrl: 'https://openrouter.ai/keys',
  },
};

// ---------------------------------------------------------------------------

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

// ─── Helper ──────────────────────────────────────────────────────────────────

/** Read a fetch Response body as SSE, calling `onLine` for every non-empty data line. */
async function readSSE(
  response: Response,
  onLine: (data: string) => void,
  callbacks: StreamCallbacks
): Promise<void> {
  if (!response.body) {
    callbacks.onError('No response body received from API.');
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || !trimmed.startsWith('data: ')) continue;

        const data = trimmed.slice(6);
        if (data === '[DONE]') continue;
        onLine(data);
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function handleHttpError(status: number, body: unknown, providerName: string): string {
  const msg =
    (body as { error?: { message?: string }; message?: string })?.error?.message ??
    (body as { message?: string })?.message;

  if (status === 401 || status === 403)
    return `Invalid ${providerName} API key. Please check your key in Settings.`;
  if (status === 404)
    return `${providerName} model not found (404). The selected model may have been retired — go to Settings and pick a different model.`;
  if (status === 429)
    return `Rate limit reached (${providerName}). Wait a moment, or switch to a model with higher free-tier limits in Settings (e.g. Gemini 2.0 Flash-Lite).`;
  if (status === 503 || status === 529)
    return `${providerName} API is temporarily overloaded. Please try again.`;

  const lowerMsg = (msg ?? '').toLowerCase();
  if (
    providerName === 'OpenRouter' &&
    (status === 402 || lowerMsg.includes('insufficient credits') || lowerMsg.includes('never purchased credits'))
  ) {
    return 'OpenRouter rejected this request for billing/credit reasons. Use an explicit :free model (for example meta-llama/llama-3.1-8b-instruct:free) in Settings. If it still fails, this OpenRouter account/org requires a credit purchase before API access.';
  }

  return msg ?? `${providerName} API error: ${status}`;
}

// ─── Claude ──────────────────────────────────────────────────────────────────

async function streamClaude(
  messages: LLMMessage[],
  systemPrompt: string,
  config: LLMConfig,
  callbacks: StreamCallbacks
): Promise<void> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': config.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      stream: true,
      system: systemPrompt,
      messages,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    callbacks.onError(handleHttpError(response.status, body, 'Claude'));
    return;
  }

  await readSSE(
    response,
    (data) => {
      try {
        const parsed = JSON.parse(data) as {
          type: string;
          delta?: { type: string; text?: string };
        };
        if (
          parsed.type === 'content_block_delta' &&
          parsed.delta?.type === 'text_delta' &&
          parsed.delta.text
        ) {
          callbacks.onChunk(parsed.delta.text);
        }
      } catch {
        // skip unparseable lines
      }
    },
    callbacks
  );

  callbacks.onDone();
}

// ─── Gemini ──────────────────────────────────────────────────────────────────

async function streamGemini(
  messages: LLMMessage[],
  systemPrompt: string,
  config: LLMConfig,
  callbacks: StreamCallbacks
): Promise<void> {
  // Gemini uses "model" instead of "assistant" for the AI role
  const contents = messages.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.model}:streamGenerateContent?alt=sse&key=${config.apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: systemPrompt }] },
      contents,
      generationConfig: { maxOutputTokens: 4096 },
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    callbacks.onError(handleHttpError(response.status, body, 'Gemini'));
    return;
  }

  await readSSE(
    response,
    (data) => {
      try {
        const parsed = JSON.parse(data) as {
          candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) callbacks.onChunk(text);
      } catch {
        // skip
      }
    },
    callbacks
  );

  callbacks.onDone();
}

// ─── OpenAI ──────────────────────────────────────────────────────────────────

async function streamOpenAI(
  messages: LLMMessage[],
  systemPrompt: string,
  config: LLMConfig,
  callbacks: StreamCallbacks
): Promise<void> {
  const openAIMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      stream: true,
      messages: openAIMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    callbacks.onError(handleHttpError(response.status, body, 'OpenAI'));
    return;
  }

  await readSSE(
    response,
    (data) => {
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) callbacks.onChunk(content);
      } catch {
        // skip
      }
    },
    callbacks
  );

  callbacks.onDone();
}

// ─── OpenRouter ──────────────────────────────────────────────────────────────

async function streamOpenRouter(
  messages: LLMMessage[],
  systemPrompt: string,
  config: LLMConfig,
  callbacks: StreamCallbacks
): Promise<void> {
  const openRouterMessages = [
    { role: 'system', content: systemPrompt },
    ...messages.map((m) => ({ role: m.role, content: m.content })),
  ];

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${config.apiKey}`,
      'HTTP-Referer': 'https://jobbuddy-ai.local',
      'X-Title': 'JobBuddy AI',
    },
    body: JSON.stringify({
      model: config.model,
      max_tokens: 4096,
      stream: true,
      messages: openRouterMessages,
    }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    callbacks.onError(handleHttpError(response.status, body, 'OpenRouter'));
    return;
  }

  await readSSE(
    response,
    (data) => {
      try {
        const parsed = JSON.parse(data) as {
          choices?: { delta?: { content?: string }; finish_reason?: string | null }[];
        };
        const content = parsed.choices?.[0]?.delta?.content;
        if (content) callbacks.onChunk(content);
      } catch {
        // skip
      }
    },
    callbacks
  );

  callbacks.onDone();
}

// ─── Unified entry point ──────────────────────────────────────────────────────

export async function streamLLMResponse(
  messages: LLMMessage[],
  systemPrompt: string,
  config: LLMConfig,
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    switch (config.provider) {
      case 'claude':
        await streamClaude(messages, systemPrompt, config, callbacks);
        break;
      case 'gemini':
        await streamGemini(messages, systemPrompt, config, callbacks);
        break;
      case 'openai':
        await streamOpenAI(messages, systemPrompt, config, callbacks);
        break;
      case 'openrouter':
        await streamOpenRouter(messages, systemPrompt, config, callbacks);
        break;
      default:
        callbacks.onError(`Unknown provider: ${(config as LLMConfig).provider}`);
    }
  } catch (err) {
    if (err instanceof TypeError && err.message.toLowerCase().includes('fetch')) {
      callbacks.onError('Network error. Please check your internet connection.');
    } else {
      callbacks.onError(err instanceof Error ? err.message : 'Unknown error occurred.');
    }
  }
}
