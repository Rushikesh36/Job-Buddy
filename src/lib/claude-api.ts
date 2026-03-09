import type { ClaudeMessage } from './types';

const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MODEL = 'claude-sonnet-4-20250514';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  onDone: () => void;
  onError: (error: string) => void;
}

export async function streamClaudeResponse(
  messages: ClaudeMessage[],
  systemPrompt: string,
  apiKey: string,
  callbacks: StreamCallbacks
): Promise<void> {
  try {
    const response = await fetch(CLAUDE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        stream: true,
        system: systemPrompt,
        messages,
      }),
    });

    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({}));
      const errMsg = (errorBody as { error?: { message?: string } }).error?.message;

      if (response.status === 401) {
        callbacks.onError('Invalid API key. Please check your Anthropic API key in settings.');
        return;
      }
      if (response.status === 429) {
        callbacks.onError('Rate limit reached. Please wait a moment before sending another message.');
        return;
      }
      if (response.status === 529 || response.status === 503) {
        callbacks.onError('Claude API is temporarily overloaded. Please try again in a moment.');
        return;
      }
      callbacks.onError(errMsg ?? `API error: ${response.status} ${response.statusText}`);
      return;
    }

    if (!response.body) {
      callbacks.onError('No response body received from Claude API.');
      return;
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed === 'event: message_stop') continue;

        if (trimmed.startsWith('data: ')) {
          const jsonStr = trimmed.slice(6);
          if (jsonStr === '[DONE]') continue;

          try {
            const parsed = JSON.parse(jsonStr) as {
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
        }
      }
    }

    callbacks.onDone();
  } catch (err) {
    if (err instanceof TypeError && err.message.includes('fetch')) {
      callbacks.onError('Network error. Please check your internet connection.');
    } else {
      callbacks.onError(err instanceof Error ? err.message : 'Unknown error occurred.');
    }
  }
}
