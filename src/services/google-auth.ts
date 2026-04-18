import {
  DEFAULT_GOOGLE_AUTH_STATE,
  DEFAULT_GOOGLE_SETTINGS,
  GOOGLE_SCOPES,
  type GoogleAuthState,
  type GoogleSettings,
  type GoogleTokens,
} from '../lib/types';

const GOOGLE_AUTH_STATE_KEY = 'googleAuthState';
const GOOGLE_AUTH_CIPHER_KEY = 'googleAuthCipher';
const GOOGLE_SETTINGS_KEY = 'googleSettings';

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';
const GOOGLE_OPENID_USERINFO_URL = 'https://openidconnect.googleapis.com/v1/userinfo';
const TOKEN_REFRESH_MARGIN_MS = 60_000;

interface OAuthTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  token_type: string;
}

interface GoogleTokenErrorResponse {
  error?: string;
  error_description?: string;
}

function shorten(text: string, maxLength = 280): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength)}...`;
}

interface EncryptedPayload {
  iv: string;
  cipherText: string;
}

interface PersistedAuthMeta {
  isConnected: boolean;
  email: string | null;
  expiresAt: number | null;
}

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

function removeStorage(keys: string[]): Promise<void> {
  return new Promise((resolve) => {
    chrome.storage.local.remove(keys, () => resolve());
  });
}

function randomString(length: number): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~';
  const values = new Uint8Array(length);
  crypto.getRandomValues(values);

  return Array.from(values)
    .map((value) => charset[value % charset.length])
    .join('');
}

async function sha256Base64Url(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toBase64Url(new Uint8Array(digest));
}

function toBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return bytes;
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function deriveEncryptionKey(): Promise<CryptoKey> {
  const salt = new TextEncoder().encode('jobbuddy-google-auth-v1');
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(chrome.runtime.id),
    { name: 'PBKDF2' },
    false,
    ['deriveKey']
  );

  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: 100_000,
      salt,
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt']
  );
}

async function encryptTokens(tokens: GoogleTokens): Promise<EncryptedPayload> {
  const key = await deriveEncryptionKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const plainBytes = new TextEncoder().encode(JSON.stringify(tokens));

  const cipherBuffer = await crypto.subtle.encrypt(
    {
      name: 'AES-GCM',
      iv,
    },
    key,
    plainBytes
  );

  return {
    iv: toBase64(iv),
    cipherText: toBase64(new Uint8Array(cipherBuffer)),
  };
}

async function decryptTokens(payload: EncryptedPayload): Promise<GoogleTokens | null> {
  try {
    const key = await deriveEncryptionKey();
    const decrypted = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: fromBase64(payload.iv),
      },
      key,
      fromBase64(payload.cipherText)
    );

    const text = new TextDecoder().decode(decrypted);
    return JSON.parse(text) as GoogleTokens;
  } catch {
    return null;
  }
}

function buildAuthorizeUrl(clientId: string, redirectUri: string, codeChallenge: string): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    access_type: 'offline',
    include_granted_scopes: 'true',
    prompt: 'consent',
    scope: GOOGLE_SCOPES.join(' '),
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  });

  return `${GOOGLE_AUTH_URL}?${params.toString()}`;
}

async function fetchUserEmail(accessToken: string): Promise<string | null> {
  const urls = [GOOGLE_USERINFO_URL, GOOGLE_OPENID_USERINFO_URL];

  for (const url of urls) {
    try {
      const response = await fetch(url, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (!response.ok) {
        continue;
      }

      const payload = (await response.json()) as { email?: string };
      if (payload.email?.trim()) {
        return payload.email;
      }
    } catch {
      // Try the next endpoint.
    }
  }

  return null;
}

async function maybeBackfillEmail(state: GoogleAuthState): Promise<GoogleAuthState> {
  if (!state.isConnected || !state.accessToken || state.email) {
    return state;
  }

  const fetchedEmail = await fetchUserEmail(state.accessToken);
  if (!fetchedEmail) {
    return state;
  }

  return persistAuthState({
    tokens: {
      accessToken: state.accessToken,
      refreshToken: state.refreshToken,
      expiresAt: state.expiresAt ?? Date.now() + TOKEN_REFRESH_MARGIN_MS,
    },
    email: fetchedEmail,
  });
}

async function exchangeCodeForTokens(args: {
  code: string;
  clientId: string;
  clientSecret?: string;
  redirectUri: string;
  codeVerifier: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    code: args.code,
    client_id: args.clientId,
    redirect_uri: args.redirectUri,
    grant_type: 'authorization_code',
    code_verifier: args.codeVerifier,
  });

  if (args.clientSecret?.trim()) {
    body.set('client_secret', args.clientSecret.trim());
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    const rawBody = await response.text().catch(() => '');
    let payload: GoogleTokenErrorResponse = {};
    try {
      payload = JSON.parse(rawBody) as GoogleTokenErrorResponse;
    } catch {
      payload = {};
    }

    const err = payload.error ?? 'unknown_error';
    const description = payload.error_description ?? '';

    if (err === 'redirect_uri_mismatch' || description.toLowerCase().includes('redirect_uri_mismatch')) {
      throw new Error(
        `Google OAuth redirect mismatch. Add this exact redirect URI in Google Cloud (Authorized redirect URIs): ${args.redirectUri}`
      );
    }

    if (err === 'invalid_client') {
      throw new Error(
        `Google OAuth invalid_client (${response.status}). Verify you pasted the correct OAuth client ID from the same Google project. Token response: ${shorten(rawBody || description || err)}`
      );
    }

    if (err === 'unauthorized_client') {
      throw new Error(
        `Google OAuth unauthorized_client (${response.status}). Ensure OAuth consent screen and APIs are configured in the same project. Token response: ${shorten(rawBody || description || err)}`
      );
    }

    throw new Error(
      `Google token exchange failed (${err}, HTTP ${response.status}). ${description || 'Check OAuth client ID, redirect URI, and consent screen.'} Token response: ${shorten(rawBody || err)}`.trim()
    );
  }

  return (await response.json()) as OAuthTokenResponse;
}

async function refreshAccessToken(args: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
}): Promise<OAuthTokenResponse> {
  const body = new URLSearchParams({
    client_id: args.clientId,
    refresh_token: args.refreshToken,
    grant_type: 'refresh_token',
  });

  if (args.clientSecret?.trim()) {
    body.set('client_secret', args.clientSecret.trim());
  }

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error('Google token refresh failed. Please reconnect your Google account.');
  }

  return (await response.json()) as OAuthTokenResponse;
}

async function persistAuthState(args: {
  tokens: GoogleTokens;
  email: string | null;
}): Promise<GoogleAuthState> {
  const encrypted = await encryptTokens(args.tokens);
  const meta: PersistedAuthMeta = {
    isConnected: true,
    email: args.email,
    expiresAt: args.tokens.expiresAt,
  };

  await setStorage({
    [GOOGLE_AUTH_STATE_KEY]: meta,
    [GOOGLE_AUTH_CIPHER_KEY]: encrypted,
  });

  return {
    isConnected: true,
    accessToken: args.tokens.accessToken,
    refreshToken: args.tokens.refreshToken,
    email: args.email,
    expiresAt: args.tokens.expiresAt,
  };
}

export async function loadGoogleSettings(): Promise<GoogleSettings> {
  const result = await getStorage<GoogleSettings>([GOOGLE_SETTINGS_KEY]);
  const stored = result[GOOGLE_SETTINGS_KEY];
  return {
    ...DEFAULT_GOOGLE_SETTINGS,
    ...(stored ?? {}),
  };
}

export async function saveGoogleSettings(settings: GoogleSettings): Promise<void> {
  await setStorage({ [GOOGLE_SETTINGS_KEY]: settings });
}

export async function clearGoogleAuthState(): Promise<void> {
  await removeStorage([GOOGLE_AUTH_STATE_KEY, GOOGLE_AUTH_CIPHER_KEY]);
}

export async function loadGoogleAuthState(): Promise<GoogleAuthState> {
  const result = await getStorage<PersistedAuthMeta | EncryptedPayload>([
    GOOGLE_AUTH_STATE_KEY,
    GOOGLE_AUTH_CIPHER_KEY,
  ]);

  const meta = result[GOOGLE_AUTH_STATE_KEY] as PersistedAuthMeta | undefined;
  const encrypted = result[GOOGLE_AUTH_CIPHER_KEY] as EncryptedPayload | undefined;

  if (!meta?.isConnected || !encrypted) {
    return { ...DEFAULT_GOOGLE_AUTH_STATE };
  }

  const tokens = await decryptTokens(encrypted);
  if (!tokens) {
    await clearGoogleAuthState();
    return { ...DEFAULT_GOOGLE_AUTH_STATE };
  }

  const state: GoogleAuthState = {
    isConnected: true,
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken,
    email: meta.email,
    expiresAt: tokens.expiresAt,
  };

  return maybeBackfillEmail(state);
}

export async function connectGoogleAccount(clientId: string, clientSecret?: string): Promise<GoogleAuthState> {
  const trimmedClientId = clientId.trim();
  if (!trimmedClientId) {
    throw new Error('Enter your Google OAuth client ID first.');
  }

  const redirectUri = chrome.identity.getRedirectURL('oauth2');
  const codeVerifier = randomString(96);
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const authUrl = buildAuthorizeUrl(trimmedClientId, redirectUri, codeChallenge);

  let redirectResponseUrl: string | undefined;
  try {
    redirectResponseUrl = await chrome.identity.launchWebAuthFlow({
      url: authUrl,
      interactive: true,
    });
  } catch {
    throw new Error(
      `Google OAuth could not complete. Ensure this redirect URI is registered for your OAuth client: ${redirectUri}`
    );
  }

  if (!redirectResponseUrl) {
    throw new Error('Google OAuth was cancelled before completion.');
  }

  const parsedUrl = new URL(redirectResponseUrl);
  const authCode = parsedUrl.searchParams.get('code');

  if (!authCode) {
    const error = parsedUrl.searchParams.get('error') ?? 'unknown_error';
    if (error === 'redirect_uri_mismatch') {
      throw new Error(
        `Google OAuth redirect mismatch. Add this exact redirect URI in Google Cloud: ${redirectUri}`
      );
    }
    throw new Error(`Google OAuth failed: ${error}`);
  }

  const tokenPayload = await exchangeCodeForTokens({
    code: authCode,
    clientId: trimmedClientId,
    clientSecret,
    redirectUri,
    codeVerifier,
  });

  const expiresAt = Date.now() + tokenPayload.expires_in * 1000;
  const email = await fetchUserEmail(tokenPayload.access_token);

  return persistAuthState({
    tokens: {
      accessToken: tokenPayload.access_token,
      refreshToken: tokenPayload.refresh_token ?? null,
      expiresAt,
    },
    email,
  });
}

export async function disconnectGoogleAccount(state: GoogleAuthState): Promise<void> {
  if (state.accessToken) {
    try {
      await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(state.accessToken)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      });
    } catch {
      // Ignore revoke network errors; local cleanup still proceeds.
    }
  }

  await clearGoogleAuthState();
}

export async function getValidGoogleAccessToken(clientId: string, clientSecret?: string): Promise<string> {
  const trimmedClientId = clientId.trim();
  if (!trimmedClientId) {
    throw new Error('Google OAuth client ID is missing.');
  }

  const currentState = await loadGoogleAuthState();
  if (!currentState.isConnected || !currentState.accessToken || !currentState.expiresAt) {
    throw new Error('Google account is not connected.');
  }

  const stillValid = currentState.expiresAt - Date.now() > TOKEN_REFRESH_MARGIN_MS;
  if (stillValid) {
    if (!currentState.email) {
      void maybeBackfillEmail(currentState);
    }
    return currentState.accessToken;
  }

  if (!currentState.refreshToken) {
    throw new Error('Google session expired. Please reconnect your account.');
  }

  const refreshed = await refreshAccessToken({
    clientId: trimmedClientId,
    clientSecret,
    refreshToken: currentState.refreshToken,
  });

  const nextTokens: GoogleTokens = {
    accessToken: refreshed.access_token,
    refreshToken: refreshed.refresh_token ?? currentState.refreshToken,
    expiresAt: Date.now() + refreshed.expires_in * 1000,
  };

  const nextState = await persistAuthState({
    tokens: nextTokens,
    email: currentState.email,
  });

  if (!nextState.email) {
    void maybeBackfillEmail(nextState);
  }

  return nextState.accessToken ?? refreshed.access_token;
}

export function getGoogleRedirectUri(): string {
  return chrome.identity.getRedirectURL('oauth2');
}
