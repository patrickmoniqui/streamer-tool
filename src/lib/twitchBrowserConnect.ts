import {
  acceptBrowserTwitchToken, buildTwitchConnectUrl, completeTwitchConnect,
  getTwitchConnectRedirectUrl, getTwitchConnectToken, TWITCH_CONNECT_STATE_KEY,
  type TwitchIdentity,
} from './twitchConnect';
const MESSAGE = 'keylight-twitch-popup';
const EVENT_SCOPES = ['channel:read:redemptions', 'bits:read', 'channel:read:subscriptions'];
function popupRedirect(): string {
  if (import.meta.env.VITE_TWITCH_REDIRECT_URI?.trim()) return getTwitchConnectRedirectUrl();
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/(?:globe|dancefloor)(?:\/.*)?$/, '/').replace(/index\.html$/, '').replace(/\/?$/, '/globe/');
  url.search = ''; url.hash = '';
  return url.toString();
}
export function connectBrowserTwitch(): Promise<TwitchIdentity> {
  // Reuse the already registered Globe callback. Only the random OAuth state is
  // used for callback verification; the token is relayed through an origin-checked message.
  const authorize = new URL(buildTwitchConnectUrl({ redirectUri: popupRedirect(), popup: true, scopes: EVENT_SCOPES }));
  const state = authorize.searchParams.get('state')!;
  const origin = new URL(window.location.href).origin;
  return new Promise((resolve, reject) => {
    let popup: Window | null = null;
    let finished = false;
    const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${MESSAGE}:${state}`);
    const cleanup = () => {
      clearTimeout(timeout); channel?.close(); window.removeEventListener('message', onMessage);
      window.sessionStorage.removeItem(TWITCH_CONNECT_STATE_KEY);
    };
    const receive = async (data: unknown) => {
      const payload = data as { type?: string; state?: string; token?: string; error?: string } | null;
      if (finished || payload?.type !== MESSAGE || payload.state !== state) return;
      finished = true; cleanup();
      if (payload.error || typeof payload.token !== 'string') { reject(new Error(payload.error || 'Twitch did not return an account.')); return; }
      try { resolve(await acceptBrowserTwitchToken(payload.token)); }
      catch (error) { reject(error); }
    };
    const onMessage = (event: MessageEvent) => {
      if (event.origin === origin && event.source === popup) void receive(event.data);
    };
    const timeout = setTimeout(() => {
      if (finished) return;
      finished = true; cleanup(); reject(new Error('Twitch sign-in timed out. Please connect again.'));
    }, 10 * 60 * 1000);
    window.addEventListener('message', onMessage);
    if (channel) channel.onmessage = event => { void receive(event.data); };
    popup = window.open(authorize.toString(), '_blank', 'popup,width=520,height=760');
    if (!popup) { finished = true; cleanup(); reject(new Error('Allow pop-ups for this site, then connect with Twitch again.')); }
  });
}
export async function completeTwitchPopupCallback(): Promise<boolean> {
  let pending: { popup?: boolean; state?: string } | null = null;
  try { pending = JSON.parse(window.sessionStorage.getItem(TWITCH_CONNECT_STATE_KEY) ?? 'null'); } catch { return false; }
  const url = new URL(window.location.href);
  if (!pending?.popup || (!url.hash.includes('access_token=') && !url.hash.includes('error=') && !url.searchParams.has('error'))) return false;
  let result: { type: string; state?: string; token?: string; error?: string };
  try {
    await completeTwitchConnect();
    const token = getTwitchConnectToken();
    if (!token) throw new Error('Twitch did not return an account.');
    result = { type: MESSAGE, state: pending.state, token };
  } catch (error) { result = { type: MESSAGE, state: pending.state, error: (error as Error).message }; }
  // A state-specific channel also handles browsers that isolate the OAuth popup's
  // opener. The channel exists only for this attempt and is closed immediately.
  const channel = typeof BroadcastChannel === 'undefined' ? null : new BroadcastChannel(`${MESSAGE}:${pending.state}`);
  channel?.postMessage(result); channel?.close();
  window.opener?.postMessage(result, url.origin);
  window.close();
  return true;
}
