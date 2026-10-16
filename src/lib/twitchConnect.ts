export const TWITCH_CONNECT_STATE_KEY = 'keylight-globe-twitch-oauth';
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
export function getBrowserTwitchIdentity(): TwitchIdentity | null { return getTwitchConnectToken() ? connectionIdentity : null; }
export function subscribeBrowserTwitch(listener: () => void): () => void {
  identityListeners.add(listener);
  return () => { identityListeners.delete(listener); };
}
export function clearBrowserTwitch(): void {
  connectionToken = null; connectionIdentity = null; callbackResult = undefined;
  identityListeners.forEach(listener => listener());
}
function rememberIdentity(token: string, identity: { login: string; user_id: string; expires_in: number }): TwitchIdentity {
  connectionToken = { value: token, expiresAt: Date.now() + identity.expires_in * 1000 };
  connectionIdentity = { login: identity.login.toLowerCase(), userId: identity.user_id };
  identityListeners.forEach(listener => listener());
  return connectionIdentity;
}
export async function acceptBrowserTwitchToken(token: string): Promise<TwitchIdentity> {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` }, credentials: 'omit' });
  const identity = await response.json() as { client_id: string; login: string; user_id: string; expires_in: number };
  if (!response.ok || identity.client_id !== CLIENT_ID || typeof identity.user_id !== 'string' || !identity.user_id || typeof identity.login !== 'string' || !/^[a-z0-9_]+$/i.test(identity.login) || !Number.isFinite(identity.expires_in) || identity.expires_in <= 0) throw new Error('Unable to verify your Twitch account. Please connect again.');
  return rememberIdentity(token, identity);
}

export function getTwitchConnectToken(): string | null {
  if (connectionToken && connectionToken.expiresAt > Date.now()) return connectionToken.value;
  connectionToken = null;
  return null;
}

export async function refreshTwitchConnectToken(): Promise<boolean> {
  const token = getTwitchConnectToken();
  if (!token) return false;
  try {
    const response = await fetch('https://id.twitch.tv/oauth2/validate', {
      headers: { Authorization: `OAuth ${token}` }, credentials: 'omit',
    });
    const identity = response.ok ? await response.json() as { client_id: string; expires_in: number } : null;
    if (!identity || identity.client_id !== CLIENT_ID || !Number.isFinite(identity.expires_in) || identity.expires_in <= 0) {
      connectionToken = null;
      return false;
    }
    connectionToken = { value: token, expiresAt: Date.now() + identity.expires_in * 1000 };
    return true;
  } catch {
    connectionToken = null;
    return false;
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
    // Keep the save credential only in memory; never put it in storage or an OBS URL.
    return rememberIdentity(token, identity as { login: string; user_id: string; expires_in: number });
  })();
  return callbackResult;
}
