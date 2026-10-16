import type { DancefloorConfig } from './dancefloor';
export interface TwitchNotification {
  metadata: { message_id: string; message_type: 'notification'; message_timestamp: string; subscription_type: string };
  payload: { subscription: { type: string; condition: { broadcaster_user_id: string }; transport: { method: 'websocket'; session_id: string } }; event: Record<string, unknown> };
}
export interface TwitchEventStatus {
  state: 'idle' | 'connecting' | 'listening' | 'reconnecting' | 'delayed' | 'error' | 'auth-required';
  message: string;
}
const ENDPOINT = 'wss://eventsub.wss.twitch.tv/ws';
const TYPES = {
  reward: 'channel.channel_points_custom_reward_redemption.add', bits: 'channel.cheer',
  sub: 'channel.subscribe', resub: 'channel.subscription.message', gift: 'channel.subscription.gift',
} as const;
export function eventSubSubscriptions(config: DancefloorConfig, broadcasterId: string) {
  return (Object.keys(TYPES) as Array<keyof typeof TYPES>).filter(key => config.triggers[key].enabled).map(key => ({
    type: TYPES[key], version: '1',
    condition: { broadcaster_user_id: broadcasterId, ...(key === 'reward' ? { reward_id: config.rewardId } : {}) },
  }));
}
export function connectTwitchEventSub(options: {
  token: string; clientId: string; broadcasterId: string; config: DancefloorConfig;
  onNotification: (message: TwitchNotification) => Promise<void>;
  onStatus: (status: TwitchEventStatus) => void; onAuthExpired?: () => void;
}): () => void {
  const desired = eventSubSubscriptions(options.config, options.broadcasterId);
  if (!desired.length) { options.onStatus({ state: 'idle', message: 'Enable a trigger and save changes to start listening.' }); return () => {}; }
  let stopped = false;
  let live: WebSocket | null = null;
  let replacement: WebSocket | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
  let deliveryTimer: ReturnType<typeof setTimeout> | undefined;
  let attempts = 0;
  let delivering = false;
  let deliveryAttempts = 0;
  const sockets = new Set<WebSocket>();
  const watchdogs = new Map<WebSocket, ReturnType<typeof setTimeout>>();
  const keepalives = new Map<WebSocket, number>();
  const controllers = new Set<AbortController>();
  const seen = new Map<string, number>();
  const queue: Array<{ message: TwitchNotification; deadline: number }> = [];
  const report = (state: TwitchEventStatus['state'], message: string) => { if (!stopped) options.onStatus({ state, message }); };
  const forget = (socket: WebSocket) => {
    sockets.delete(socket); clearTimeout(watchdogs.get(socket)); watchdogs.delete(socket); keepalives.delete(socket);
  };
  const stop = () => {
    if (stopped) return;
    stopped = true; clearTimeout(reconnectTimer); clearTimeout(deliveryTimer);
    controllers.forEach(c => c.abort()); controllers.clear();
    sockets.forEach(socket => { clearTimeout(watchdogs.get(socket)); socket.close(); });
    sockets.clear(); watchdogs.clear(); queue.length = 0;
  };
  const authExpired = () => {
    report('auth-required', 'Twitch sign-in expired. Connect with Twitch again.');
    stop(); options.onAuthExpired?.();
  };
  const deliver = async () => {
    if (stopped || delivering || deliveryTimer || !queue.length) return;
    delivering = true;
    let relayFailed = false;
    try {
      while (!stopped && queue.length) {
        const item = queue[0];
        if (item.deadline <= Date.now()) { queue.shift(); continue; }
        try {
          await options.onNotification(item.message);
          if (stopped) return;
          queue.shift(); deliveryAttempts = 0;
        } catch (error) {
          if (stopped) return;
          const status = (error as { status?: number }).status;
          if (status === 401) { authExpired(); return; }
          if (status && status >= 400 && status < 500 && status !== 429) {
            queue.shift(); relayFailed = true;
            const detail = error instanceof Error ? error.message : 'Check your saved settings.';
            report('error', `Twitch event relay failed (${status}): ${detail}`); continue;
          }
          report('delayed', 'Receiving Twitch events; waiting for the overlay service to reconnect.');
          deliveryTimer = setTimeout(() => { deliveryTimer = undefined; void deliver(); }, Math.min(15000, 1000 * 2 ** Math.min(deliveryAttempts++, 4)));
          return;
        }
      }
      if (live && !stopped && !relayFailed) report('listening', 'Listening for Twitch events. Keep this page open while streaming.');
    } finally { delivering = false; }
  };
  const enqueue = (message: TwitchNotification) => {
    if (!message.metadata?.message_id || message.payload?.event?.broadcaster_user_id !== options.broadcasterId) return;
    const now = Date.now();
    for (const [id, expires] of seen) if (expires <= now) seen.delete(id);
    if (seen.has(message.metadata.message_id)) return;
    if (queue.length >= 200) { report('error', 'The event relay queue is full. Check the overlay service.'); return; }
    if (seen.size >= 2000) seen.delete(seen.keys().next().value!);
    seen.set(message.metadata.message_id, now + 600000);
    queue.push({ message, deadline: now + 120000 });
    void deliver();
  };
  const scheduleReconnect = () => {
    if (stopped || reconnectTimer) return;
    report('reconnecting', 'Twitch disconnected. Reconnecting… Events missed while disconnected cannot be replayed.');
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; open(ENDPOINT, false); }, Math.min(30000, 1000 * 2 ** Math.min(attempts++, 5)));
  };
  const lost = (socket: WebSocket) => {
    if (!sockets.has(socket)) return;
    forget(socket); socket.close();
    if (replacement === socket) replacement = null;
    if (live === socket) live = null;
    if (!live && !replacement) scheduleReconnect();
  };
  const arm = (socket: WebSocket, milliseconds: number) => {
    clearTimeout(watchdogs.get(socket));
    watchdogs.set(socket, setTimeout(() => lost(socket), milliseconds));
  };
  const subscribe = async (sessionId: string, socket: WebSocket) => {
    const controller = new AbortController(); controllers.add(controller);
    const timeout = setTimeout(() => controller.abort(), 8000);
    try {
      await Promise.all(desired.map(async subscription => {
        const response = await fetch('https://api.twitch.tv/helix/eventsub/subscriptions', {
          method: 'POST', credentials: 'omit', signal: controller.signal,
          headers: { Authorization: `Bearer ${options.token}`, 'Client-Id': options.clientId, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...subscription, transport: { method: 'websocket', session_id: sessionId } }),
        });
        if (!response.ok) {
          let detail = 'Unable to subscribe.';
          try { const body = await response.json(); if (typeof body.message === 'string') detail = body.message.slice(0, 240); } catch { /* No JSON response. */ }
          throw Object.assign(new Error(`${subscription.type} (${response.status}): ${detail}`), { status: response.status });
        }
      }));
      if (!stopped && live === socket && sockets.has(socket)) {
        attempts = 0; report('listening', 'Listening for Twitch events. Keep this page open while streaming.');
      }
    } catch (error) {
      if (stopped || !sockets.has(socket)) return;
      const status = (error as { status?: number }).status;
      if (status === 401) authExpired();
      else if (status && status >= 400 && status < 500 && status !== 429) {
        report('error', `Twitch could not enable a trigger: ${(error as Error).message} Reconnect Twitch to grant permissions, or check the selected reward.`); stop();
      } else lost(socket);
    } finally { clearTimeout(timeout); controllers.delete(controller); }
  };
  const open = (url: string, transferring: boolean) => {
    if (stopped) return;
    let socket: WebSocket;
    try { socket = new WebSocket(url); } catch { scheduleReconnect(); return; }
    sockets.add(socket);
    if (transferring) replacement = socket;
    else report('connecting', 'Connecting to Twitch EventSub…');
    arm(socket, 10000);
    socket.addEventListener('message', event => {
      if (stopped || !sockets.has(socket)) return;
      let message: any;
      try { message = JSON.parse(String(event.data)); } catch { return; }
      const kind = message.metadata?.message_type;
      if (kind === 'session_welcome') {
        const session = message.payload?.session;
        if (typeof session?.id !== 'string' || !session.id) { lost(socket); return; }
        const old = live;
        live = socket; if (replacement === socket) replacement = null;
        const seconds = Number(session.keepalive_timeout_seconds);
        keepalives.set(socket, Number.isFinite(seconds) && seconds >= 10 ? seconds * 1000 + 1000 : 31000);
        arm(socket, keepalives.get(socket)!);
        if (old && old !== socket) { forget(old); old.close(); }
        if (transferring) { attempts = 0; report('listening', 'Listening for Twitch events. Keep this page open while streaming.'); }
        else void subscribe(session.id, socket);
      } else if (kind === 'session_keepalive' || kind === 'notification') {
        arm(socket, keepalives.get(socket) ?? 31000);
        if (kind === 'notification') enqueue(message as TwitchNotification);
      } else if (kind === 'session_reconnect' && !replacement) {
        try {
          const reconnectUrl = message.payload.session.reconnect_url;
          if (typeof reconnectUrl !== 'string') throw new Error('Invalid reconnect URL');
          const target = new URL(reconnectUrl);
          if (target.protocol !== 'wss:' || target.hostname !== 'eventsub.wss.twitch.tv' || target.username || target.password) throw new Error('Invalid reconnect URL');
          report('reconnecting', 'Twitch is moving the connection. Reconnecting…');
          open(reconnectUrl, true);
        } catch { lost(socket); }
      } else if (kind === 'revocation') {
        const reason = message.payload?.subscription?.status;
        if (reason === 'authorization_revoked' || reason === 'user_removed') authExpired();
        else { report('error', 'Twitch revoked an event subscription. Check your triggers and reconnect Twitch.'); stop(); }
      }
    });
    socket.addEventListener('close', () => lost(socket));
    socket.addEventListener('error', () => lost(socket));
  };
  open(ENDPOINT, false);
  return stop;
}
