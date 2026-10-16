import { DEFAULT_DANCEFLOOR_CONFIG, validateDancefloorConfig, type DancefloorConfig } from '../../../src/lib/dancefloor';
import { qualifyingTrigger } from './state';
export interface DancefloorEnv {
  ANALYTICS_DB?: D1Database;
  DANCEFLOOR_ROOMS?: DurableObjectNamespace;
  TWITCH_CLIENT_ID?: string;
}
interface Profile { user_id: string; login: string; config: string }
function fail(message: string, status = 400): never { throw Object.assign(new Error(message), { status }); }
function db(env: DancefloorEnv) { return env.ANALYTICS_DB ?? fail('Dancefloor storage is unavailable. Start the Worker to save settings.', 503); }
function clientId(env: DancefloorEnv) { return env.TWITCH_CLIENT_ID?.trim() || '6vii4ube47seid33yqelo7gdh3cxz9'; }
function bearer(request: Request) { return request.headers.get('Authorization')?.match(/^Bearer (.+)$/)?.[1] ?? fail('Connect with Twitch to manage Dancefloor.', 401); }
export async function sharedTwitchIdentity(request: Request, env: DancefloorEnv) {
  const response = await fetch('https://id.twitch.tv/oauth2/validate', { signal: AbortSignal.timeout(5000), headers: { Authorization: `OAuth ${bearer(request)}` } });
  if (response.status >= 500) fail('Twitch is temporarily unavailable.', 502);
  const identity = await response.json() as { client_id: string; user_id: string; login: string; expires_in: number };
  if (!response.ok || typeof identity.user_id !== 'string' || !identity.user_id || typeof identity.login !== 'string' || !/^[a-z0-9_]+$/i.test(identity.login) || !Number.isFinite(identity.expires_in) || identity.expires_in <= 0) fail('Twitch sign-in expired. Please connect again.', 401);
  if (identity.client_id !== clientId(env)) fail('This Twitch account was connected with a different application.', 403);
  return { userId: identity.user_id, login: identity.login.toLowerCase() };
}
export function sharedTwitchCors(_request: Request, _env: DancefloorEnv, headers = new Headers()) {
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, PUT, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  headers.set('Cache-Control', 'no-store');
  return headers;
}
async function helix(request: Request, env: DancefloorEnv, path: string) {
  const response = await fetch(`https://api.twitch.tv/helix/${path}`, { signal: AbortSignal.timeout(5000), headers: { Authorization: `Bearer ${bearer(request)}`, 'Client-Id': clientId(env) } });
  if (!response.ok) fail(response.status === 401 || response.status === 403 ? 'Reconnect Twitch and allow the requested permissions.' : 'Twitch is temporarily unavailable.', response.status === 401 || response.status === 403 ? response.status : 502);
  return await response.json() as { data: Array<Record<string, any>> };
}
async function room(env: DancefloorEnv, userId: string, path = '/snapshot', body?: unknown) {
  if (!env.DANCEFLOOR_ROOMS) fail('Dancefloor room storage is unavailable.', 503);
  const stub = env.DANCEFLOOR_ROOMS.get(env.DANCEFLOOR_ROOMS.idFromName(userId));
  const response = await stub.fetch(`https://dancefloor.internal${path}`, body === undefined ? {} : { method: 'POST', body: JSON.stringify(body) });
  if (!response.ok) fail('Dancefloor room unavailable.', 503);
  return await response.json() as any;
}
async function avatar(request: Request, env: DancefloorEnv, userId: string) {
  const cached = await db(env).prepare('SELECT url, expires_at FROM dancefloor_avatars WHERE user_id = ?').bind(userId).first<{ url: string; expires_at: number }>();
  if (cached && cached.expires_at > Date.now()) return cached.url;
  try {
    const result = await helix(request, env, `users?id=${encodeURIComponent(userId)}`);
    const url = result.data[0]?.profile_image_url ?? '';
    await db(env).prepare('INSERT OR REPLACE INTO dancefloor_avatars (user_id, url, expires_at) VALUES (?, ?, ?)').bind(userId, url, Date.now() + 86400000).run();
    return url;
  } catch { return ''; }
}
async function chatColor(request: Request, env: DancefloorEnv, userId: string): Promise<string> {
  try {
    const cached = await db(env).prepare('SELECT color, expires_at FROM dancefloor_chat_colors WHERE user_id = ?').bind(userId).first<{ color: string; expires_at: number }>();
    if (cached && cached.expires_at > Date.now()) return cached.color;
    const result = await helix(request, env, `chat/color?user_id=${encodeURIComponent(userId)}`);
    const value = result.data.find(user => user.user_id === userId)?.color;
    const color = typeof value === 'string' && /^#[a-f\d]{6}$/i.test(value) ? value : '';
    await db(env).prepare('INSERT OR REPLACE INTO dancefloor_chat_colors (user_id, color, expires_at) VALUES (?, ?, ?)').bind(userId, color, Date.now() + 3600000).run();
    return color;
  } catch { return ''; } // A color lookup must never prevent the viewer from dancing.
}
async function appearance(request: Request, env: DancefloorEnv, userId: string) {
  const [avatarUrl, color] = await Promise.all([avatar(request, env, userId), chatColor(request, env, userId)]);
  return { avatarUrl, chatColor: color };
}
async function route(request: Request, env: DancefloorEnv): Promise<Response> {
  const path = new URL(request.url).pathname.replace('/api/dancefloor', '');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  // Old deployed subscriptions must not trigger dancers alongside WebSockets.
  if (path === '/webhook') return new Response(null, { status: 410 });
  const snapshot = path.match(/^\/channels\/([A-Za-z0-9_]+)\/snapshot$/);
  if (snapshot && request.method === 'GET') {
    const p = await db(env).prepare('SELECT * FROM dancefloor_profiles WHERE login = ?').bind(snapshot[1].toLowerCase()).first<Profile>();
    if (!p) fail('Dancefloor is not set up for this channel.', 404);
    return Response.json(await room(env, p.user_id));
  }
  const owner = await sharedTwitchIdentity(request, env);
  // Retain existing saved profiles, but remove obsolete server OAuth credentials.
  await db(env).prepare("INSERT INTO dancefloor_profiles (user_id, login, config, connected, status, updated_at) VALUES (?, ?, ?, 0, 'WebSocket', ?) ON CONFLICT(user_id) DO UPDATE SET login = excluded.login, credentials = NULL, connected = 0, status = 'WebSocket' WHERE login <> excluded.login OR credentials IS NOT NULL OR connected <> 0 OR status <> 'WebSocket'")
    .bind(owner.userId, owner.login, JSON.stringify(DEFAULT_DANCEFLOOR_CONFIG), Date.now()).run();
  const p = (await db(env).prepare('SELECT * FROM dancefloor_profiles WHERE user_id = ?').bind(owner.userId).first<Profile>())!;
  const config = JSON.parse(p.config) as DancefloorConfig;
  if (path === '/me' && request.method === 'GET') return Response.json({ login: p.login, transport: 'websocket', config, snapshot: await room(env, p.user_id) });
  if (path === '/me/rewards' && request.method === 'GET') return Response.json((await helix(request, env, `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(p.user_id)}`)).data);
  if (path === '/me/profile' && request.method === 'PUT') {
    let next: DancefloorConfig;
    try { next = validateDancefloorConfig(await request.json()); }
    catch (error) { fail(error instanceof SyntaxError ? 'Dancefloor settings must be valid JSON.' : (error as Error).message); }
    if (next.triggers.reward.enabled) {
      const rewards = await helix(request, env, `channel_points/custom_rewards?broadcaster_id=${encodeURIComponent(p.user_id)}`);
      if (!rewards.data.some(r => r.id === next.rewardId && r.is_enabled)) fail('Selected reward is unavailable or disabled.');
    }
    await db(env).prepare('UPDATE dancefloor_profiles SET config = ?, updated_at = ? WHERE user_id = ?').bind(JSON.stringify(next), Date.now(), p.user_id).run();
    await room(env, p.user_id, '/config', next);
    return Response.json({ saved: true });
  }
  if (path === '/me/events' && request.method === 'POST') {
    // This is an authenticated owner relay, not a public Twitch webhook. Never
    // trust the supplied duration, avatar, channel, or trigger qualification.
    const payload = await request.json() as any;
    const metadata = payload?.metadata;
    const subscription = payload?.payload?.subscription;
    const event = payload?.payload?.event;
    // Twitch message IDs are opaque strings, including padded Base64. Do not
    // restrict them to UUID/URL-safe characters; they are used only for deduplication.
    if (metadata?.message_type !== 'notification' || typeof metadata.message_id !== 'string' ||
        metadata.message_id.length < 1 || metadata.message_id.length > 512 || /[\u0000-\u001f\u007f]/.test(metadata.message_id)) fail('Invalid Twitch notification metadata.', 403);
    if (subscription?.transport?.method !== 'websocket') fail('Invalid Twitch event transport.', 403);
    if (event?.broadcaster_user_id !== p.user_id || subscription?.condition?.broadcaster_user_id !== p.user_id) fail('Twitch event channel does not match the connected account.', 403);
    if (typeof subscription.type !== 'string' || subscription.type !== metadata.subscription_type) fail('Twitch event type does not match its subscription.', 403);
    const occurredAt = Date.parse(metadata.message_timestamp);
    if (!Number.isFinite(occurredAt) || Math.abs(Date.now() - occurredAt) > 600000) fail('This event is too old.');
    const trigger = qualifyingTrigger(config, subscription.type, event);
    if (!trigger) return Response.json({ accepted: false });
    const anonymous = event.is_anonymous === true || !event.user_id;
    if (!anonymous && (typeof event.user_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(event.user_id))) fail('Invalid viewer.');
    const viewerId = anonymous ? `anonymous:${metadata.message_id}` : event.user_id;
    const name = anonymous ? 'Anonymous' : String(event.user_name || event.user_login || 'Viewer').slice(0, 100);
    await room(env, p.user_id, '/config', config);
    const result = await room(env, p.user_id, '/event', {
      id: metadata.message_id, viewerId, name, ...(anonymous ? { avatarUrl: '', chatColor: '' } : await appearance(request, env, viewerId)),
      durationSeconds: config.triggers[trigger].durationSeconds, occurredAt,
    });
    return Response.json({ accepted: true, snapshot: result });
  }
  if (path === '/me/test' && request.method === 'POST') {
    await room(env, p.user_id, '/config', config);
    return Response.json(await room(env, p.user_id, '/test', { id: `test:${crypto.randomUUID()}`, viewerId: p.user_id, name: p.login, ...await appearance(request, env, p.user_id), durationSeconds: 60, occurredAt: Date.now() }));
  }
  if (path === '/me/clear' && request.method === 'POST') return Response.json(await room(env, p.user_id, '/clear', {}));
  if (path === '/me/disconnect' && request.method === 'POST') {
    await room(env, p.user_id, '/clear', {});
    return Response.json({ disconnected: true });
  }
  fail('Not found.', 404);
}
export async function handleDancefloor(request: Request, env: DancefloorEnv): Promise<Response> {
  let response: Response;
  try { response = await route(request, env); }
  catch (error) {
    const status = (error as { status?: number }).status ?? (error instanceof SyntaxError ? 400 : 500);
    response = Response.json({ error: status === 500 ? 'Dancefloor service unavailable. Please try again.' : (error as Error).message }, { status });
  }
  return new Response(response.body, { status: response.status, headers: sharedTwitchCors(request, env, new Headers(response.headers)) });
}
export async function handleSharedTwitch(request: Request, env: DancefloorEnv): Promise<Response> {
  const headers = sharedTwitchCors(request, env);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  if (new URL(request.url).pathname !== '/api/twitch/connection' || request.method !== 'GET') return Response.json({ error: 'Use Connect with Twitch in the app.' }, { status: 404, headers });
  try {
    const identity = await sharedTwitchIdentity(request, env);
    return Response.json({ ready: true, connected: true, identity, transport: 'websocket' }, { headers });
  } catch (error) {
    if ((error as { status?: number }).status === 401) return Response.json({ ready: true, connected: false, identity: null, transport: 'websocket' }, { headers });
    return Response.json({ error: 'Unable to verify Twitch connection.' }, { status: 502, headers });
  }
}
