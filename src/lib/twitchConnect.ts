export const TWITCH_CONNECT_STATE_KEY = 'keylight-globe-twitch-oauth';
export const TWITCH_SESSION_KEY = 'keylight-twitch-session';
const STATE_MAX_AGE_MS = 10 * 60 * 1000;
// Twitch Client IDs are public. Deployments can override this application ID.
const CLIENT_ID = import.meta.env.VITE_TWITCH_CLIENT_ID?.trim() || '6vii4ube47seid33yqelo7gdh3cxz9';

export interface TwitchIdentity {
  login: string;
  userId: string;
}

interface PendingLogin {
  state: string;
  clientId: string;
  redirectUri: string;
  createdAt: number;
  popup?: boolean;
}

export function getTwitchClientId(): string { return CLIENT_ID; }

export function isTwitchConnectConfigured(): boolean {
  return Boolean(CLIENT_ID);
}

export function getTwitchConnectRedirectUrl(): string {
  const configured = import.meta.env.VITE_TWITCH_REDIRECT_URI?.trim();
  const url = new URL(configured || window.location.href);
  url.search = '';
  url.hash = '';

  if (!configured && !url.pathname.endsWith('/') && !url.pathname.endsWith('.html')) {
    url.pathname += '/';
  }

  if (url.origin !== window.location.origin) {
    throw new Error('The Twitch redirect must use this app’s origin.');
  }

  return url.toString();
}

export function buildTwitchConnectUrl(options: { redirectUri?: string; popup?: boolean; scopes?: string[] } = {}): string {
  const clientId = CLIENT_ID;
  if (!clientId) {
    throw new Error('Twitch connection is currently unavailable. Enter your channel manually.');
  }

  const redirectUri = options.redirectUri ?? getTwitchConnectRedirectUrl();
  if (new URL(redirectUri).origin !== new URL(window.location.href).origin) throw new Error('The Twitch redirect must use this app’s origin.');
  const pending: PendingLogin = {
    state: crypto.randomUUID(),
    clientId,
    redirectUri,
    popup: options.popup,
    createdAt: Date.now(),
  };
  window.sessionStorage.setItem(TWITCH_CONNECT_STATE_KEY, JSON.stringify(pending));

  const url = new URL('https://id.twitch.tv/oauth2/authorize');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', pending.redirectUri);
  url.searchParams.set('response_type', 'token');
  url.searchParams.set('scope', (options.scopes ?? []).join(' '));
  url.searchParams.set('force_verify', 'true');
  url.searchParams.set('state', pending.state);
  return url.toString();
}

// Share the one-time callback across React Strict Mode's repeated effects.
let callbackResult: Promise<TwitchIdentity | null> | undefined;
let connectionToken: { value: string; expiresAt: number } | null = null;
let connectionIdentity: TwitchIdentity | null = null;
const identityListeners = new Set<() => void>();
let restoration: Promise<void> | undefined;
let sessionVersion = 0;
let validationTimer: ReturnType<typeof setInterval> | undefined;
function persistSession(): void {
  try {
    if (connectionToken && connectionIdentity) {
      window.sessionStorage.setItem(TWITCH_SESSION_KEY, JSON.stringify({ clientId: CLIENT_ID, token: connectionToken.value, expiresAt: connectionToken.expiresAt }));
    } else window.sessionStorage.removeItem(TWITCH_SESSION_KEY);
  } catch { /* Browsers blocking storage can still sign in for this page. */ }
}
export function restoreBrowserTwitch(): Promise<void> {
  if (restoration) return restoration;
  if (getTwitchConnectToken()) return Promise.resolve();
  const version = sessionVersion;
  restoration = (async () => {
    let saved: { clientId?: string; token?: string; expiresAt?: number } | null = null;
    try { saved = JSON.parse(window.sessionStorage.getItem(TWITCH_SESSION_KEY) ?? 'null'); } catch { persistSession(); }
    if (!saved) return;
    if (saved.clientId !== CLIENT_ID || typeof saved.token !== 'string' || !saved.token || !Number.isFinite(saved.expiresAt) || saved.expiresAt! <= Date.now()) {
      persistSession(); return;
    }
    try {
      const identity = await validateToken(saved.token);
      if (version === sessionVersion) rememberIdentity(saved.token, identity);
    } catch (error) {
      // Keep the saved session on network failures so a reload can retry.
      if (version === sessionVersion && (error as { invalidToken?: boolean }).invalidToken) clearBrowserTwitch();
    }
  })();
  return restoration;
}
export function getBrowserTwitchIdentity(): TwitchIdentity | null { return getTwitchConnectToken() ? connectionIdentity : null; }
export function subscribeBrowserTwitch(listener: () => void): () => void {
  identityListeners.add(listener);
  void restoreBrowserTwitch();
  if (!validationTimer) validationTimer = setInterval(() => {
    if (connectionToken && connectionToken.expiresAt <= Date.now()) clearBrowserTwitch();
    else if (connectionToken) void refreshTwitchConnectToken();
  }, 3600000);
  return () => {
    identityListeners.delete(listener);
    if (!identityListeners.size) { clearInterval(validationTimer); validationTimer = undefined; }
  };
}
export function clearBrowserTwitch(): void {
  sessionVersion++;
  connectionToken = null; connectionIdentity = null; callbackResult = undefined; restoration = undefined;
  persistSession();
  identityListeners.forEach(listener => listener());
}
function rememberIdentity(token: string, identity: { login: string; user_id: string; expires_in: number }): TwitchIdentity {
  sessionVersion++;
  connectionToken = { value: token, expiresAt: Date.now() + identity.expires_in * 1000 };
  connectionIdentity = { login: identity.login.toLowerCase(), userId: identity.user_id };
  persistSession();
  identityListeners.forEach(listener => listener());
  return connectionIdentity;
}
async function validateToken(token: string) {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', { signal: AbortSignal.timeout(10000), headers: { Authorization: `OAuth ${token}` }, credentials: 'omit' });
  const identity = await response.json() as { client_id: string; login: string; user_id: string; expires_in: number };
  if (!response.ok || identity.client_id !== CLIENT_ID || typeof identity.user_id !== 'string' || !identity.user_id || typeof identity.login !== 'string' || !/^[a-z0-9_]+$/i.test(identity.login) || !Number.isFinite(identity.expires_in) || identity.expires_in <= 0) throw Object.assign(new Error('Unable to verify your Twitch account. Please connect again.'), { invalidToken: response.status === 401 || response.ok });
  return identity;
}
export async function acceptBrowserTwitchToken(token: string): Promise<TwitchIdentity> {
  const identity = await validateToken(token);
  return rememberIdentity(token, identity);
}

export function getTwitchConnectToken(): string | null {
  if (connectionToken && connectionToken.expiresAt > Date.now()) return connectionToken.value;
  if (connectionToken) {
    connectionToken = null; connectionIdentity = null; persistSession();
  }
  return null;
}

export async function refreshTwitchConnectToken(): Promise<boolean> {
  const token = getTwitchConnectToken();
  if (!token) return false;
  const version = sessionVersion;
  try {
    const identity = await validateToken(token);
    if (version !== sessionVersion || connectionToken?.value !== token) return false;
    // Keep the identity object stable so revalidation doesn't restart sockets.
    connectionToken = { value: token, expiresAt: Date.now() + identity.expires_in * 1000 };
    persistSession();
    return true;
  } catch (error) {
    if (version !== sessionVersion) return false;
    if ((error as { invalidToken?: boolean }).invalidToken) { clearBrowserTwitch(); return false; }
    return Boolean(getTwitchConnectToken());
  }
}

export function completeTwitchConnect(): Promise<TwitchIdentity | null> {
  if (callbackResult) return callbackResult;

  const url = new URL(window.location.href);
  const fragment = new URLSearchParams(url.hash.slice(1));
  const response = fragment.has('access_token') || fragment.has('error')
    ? fragment
    : url.searchParams;
  if (!response.has('access_token') && !response.has('error')) {
    return Promise.resolve(null);
  }

  const token = response.get('access_token');
  const state = response.get('state');
  const error = response.get('error');
  const tokenType = response.get('token_type');
  let stored: string | null = null;
  try {
    stored = window.sessionStorage.getItem(TWITCH_CONNECT_STATE_KEY);
    window.sessionStorage.removeItem(TWITCH_CONNECT_STATE_KEY);
  } catch {
    // Reject below when state cannot be recovered; still remove the URL token.
  }

  for (const key of ['access_token', 'token_type', 'scope', 'state', 'error', 'error_description']) {
    fragment.delete(key);
    url.searchParams.delete(key);
  }
  url.hash = fragment.toString();
  window.history.replaceState(window.history.state, '', url.toString());

  callbackResult = (async () => {
    let pending: PendingLogin | null = null;
    try {
      pending = stored ? JSON.parse(stored) as PendingLogin : null;
    } catch {
      // Invalid saved state is treated the same as a missing login attempt.
    }
    if (
      !pending || !state || pending.state !== state ||
      pending.clientId !== CLIENT_ID ||
      !Number.isFinite(pending.createdAt) ||
      Date.now() - pending.createdAt < 0 ||
      Date.now() - pending.createdAt > STATE_MAX_AGE_MS ||
      `${url.origin}${url.pathname}` !== pending.redirectUri
    ) {
      throw new Error('Twitch sign-in expired or could not be verified. Please connect again.');
    }
    if (error) {
      throw new Error(error === 'access_denied'
        ? 'Twitch connection was cancelled. You can connect again.'
        : 'Unable to connect to Twitch. Please try again.');
    }
    if (!token || tokenType?.toLowerCase() !== 'bearer') {
      throw new Error('Twitch returned an invalid sign-in response. Please connect again.');
    }

    const validation = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token}` },
      credentials: 'omit',
    });
    if (!validation.ok) {
      throw new Error('Unable to verify your Twitch account. Please connect again.');
    }
    const identity = await validation.json() as {
      client_id?: string; login?: string; user_id?: string; expires_in?: number;
    };
    if (
      identity.client_id !== pending.clientId ||
      !identity.login || !/^[a-zA-Z0-9_]+$/.test(identity.login) ||
      !identity.user_id || !Number.isFinite(identity.expires_in) || !identity.expires_in || identity.expires_in <= 0
    ) {
      throw new Error('Twitch returned an invalid account. Please connect again.');
    }
    // Share this validated session across tool navigation in this browser tab.
    return rememberIdentity(token, identity as { login: string; user_id: string; expires_in: number });
  })();
  return callbackResult;
}
