import { DEFAULT_FALLBACK_SETTINGS, type LLMProvider, type ProviderSettings, type FallbackSettings } from '../lib/types';

export function isRateLimitError(status: number, bodyText: string): boolean {
  if (status === 429) return true;
  if (status < 400) return false;
  const lower = bodyText.toLowerCase();
  const phrases = [
    'rate limit',
    'rate_limit',
    'quota exceeded',
    'resource exhausted',
    'too many requests',
    'requests per day',
    'requests per minute',
    'tokens per minute',
    'overloaded',
    'capacity',
  ];
  return phrases.some((p) => lower.includes(p));
}

export function getFallbackChain(
  activeProvider: LLMProvider,
  providerSettings: ProviderSettings,
  fallbackSettings: FallbackSettings,
): LLMProvider[] {
  if (!fallbackSettings.enabled) return [activeProvider];

  const hasKey = (p: LLMProvider) => !!providerSettings.apiKeys[p]?.trim();
  const orderedProviders = activeProvider === 'ollama'
    ? DEFAULT_FALLBACK_SETTINGS.order
    : fallbackSettings.order;

  // Start with active provider, then fallback order (skipping those without keys)
  const rest = orderedProviders.filter(
    (p) => p !== activeProvider && hasKey(p),
  );

  return [activeProvider, ...rest];
}
