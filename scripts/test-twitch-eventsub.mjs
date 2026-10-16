import assert from 'node:assert/strict';
import { build } from 'esbuild';
const bundle = await build({ entryPoints: ['src/lib/twitchEventSub.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
const { connectTwitchEventSub, eventSubSubscriptions } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const real = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, now: Date.now };
let time = 1000000; let nextTimer = 0; let timers = new Map(); let sockets = []; let requests = []; let statuses = []; let received = []; let authFailures = 0; let responseStatus = 202; let deliveryFailures = 0;
const flush = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
const advance = ms => {
  const until = time + ms; let count = 0;
  while (true) {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at).find(([, t]) => t.at <= until);
    if (!next) break;
    if (++count > 1000) throw new Error('Timer loop');
    time = next[1].at; timers.delete(next[0]); next[1].fn();
  }
  time = until;
};
class Socket {
  constructor(url) { this.url = url; this.listeners = new Map(); this.closed = false; sockets.push(this); }
  addEventListener(type, fn) { this.listeners.set(type, fn); }
  close() { if (this.closed) return; this.closed = true; this.listeners.get('close')?.({ code: 1000 }); }
  send() { throw new Error('EventSub clients must never send application frames'); }
  message(value) { this.listeners.get('message')?.({ data: JSON.stringify(value) }); }
}
const config = {
  rewardId: 'reward-1', triggers: Object.fromEntries(['reward', 'bits', 'sub', 'resub', 'gift'].map(k => [k, { enabled: true, durationSeconds: 60 }])),
};
const welcome = (socket, id = 'session-1') => socket.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: 10 } } });
const note = id => ({ metadata: { message_type: 'notification', message_id: id, message_timestamp: new Date(time).toISOString(), subscription_type: 'channel.cheer' }, payload: { subscription: { type: 'channel.cheer', condition: { broadcaster_user_id: '123' }, transport: { method: 'websocket', session_id: 'session-1' } }, event: { broadcaster_user_id: '123', user_id: 'viewer', bits: 100 } } });
const start = (overrides = {}) => connectTwitchEventSub({ token: 'user-token', clientId: 'client-id', broadcasterId: '123', config,
  onStatus: status => statuses.push(status), onAuthExpired: () => authFailures++,
  onNotification: async message => { if (deliveryFailures-- > 0) throw new Error('Worker unavailable'); received.push(message); }, ...overrides,
});
const reset = () => { timers.clear(); sockets = []; requests = []; statuses = []; received = []; authFailures = 0; responseStatus = 202; deliveryFailures = 0; };
try {
  Date.now = () => time;
  globalThis.setTimeout = (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, at: time + delay }); return id; };
  globalThis.clearTimeout = id => timers.delete(id);
  globalThis.WebSocket = Socket;
  globalThis.fetch = async (url, options) => { requests.push({ url, options, body: JSON.parse(options.body) }); return { ok: responseStatus === 202, status: responseStatus, json: async () => ({ message: 'Missing required scope' }) }; };
  assert.equal(eventSubSubscriptions(config, '123').length, 5);
  assert.equal(eventSubSubscriptions(config, '123')[0].condition.reward_id, 'reward-1');
  let stop = start();
  assert.equal(sockets[0].url, 'wss://eventsub.wss.twitch.tv/ws');
  welcome(sockets[0]); await flush();
  assert.equal(requests.length, 5);
  for (const r of requests) {
    assert.equal(r.url, 'https://api.twitch.tv/helix/eventsub/subscriptions');
    assert.equal(r.options.headers.Authorization, 'Bearer user-token'); assert.equal(r.options.credentials, 'omit');
    assert.deepEqual(r.body.transport, { method: 'websocket', session_id: 'session-1' });
  }
  assert.equal(statuses.at(-1).state, 'listening');
  sockets[0].message(note('once')); sockets[0].message(note('once')); await flush();
  assert.equal(received.length, 1);
  const wrong = note('wrong'); wrong.payload.event.broadcaster_user_id = 'other'; sockets[0].message(wrong); await flush(); assert.equal(received.length, 1);
  // A server-directed handoff transfers existing subscriptions and closes the
  // old socket only after the replacement welcomes us.
  sockets[0].message({ metadata: { message_type: 'session_reconnect' }, payload: { session: { reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=abc' } } });
  assert.equal(sockets.length, 2); assert.equal(sockets[0].closed, false);
  welcome(sockets[1], 'transferred'); await flush();
  assert.equal(sockets[0].closed, true); assert.equal(requests.length, 5);
  // Keepalive resets the deadline; a genuine timeout opens a fresh session and
  // recreates subscriptions instead of assuming a transfer.
  advance(9000); sockets[1].message({ metadata: { message_type: 'session_keepalive' }, payload: {} });
  advance(9000); assert.equal(sockets[1].closed, false);
  advance(2100); assert.equal(sockets[1].closed, true);
  advance(1000); assert.equal(sockets.length, 3);
  welcome(sockets[2], 'fresh'); await flush(); assert.equal(requests.length, 10);
  sockets[2].message(note('once')); await flush(); assert.equal(received.length, 1, 'Deduplication survives reconnects');
  stop(); advance(60000); assert.equal(sockets.length, 3); assert.equal(timers.size, 0);

  reset(); deliveryFailures = 1; stop = start(); welcome(sockets[0]); await flush();
  sockets[0].message(note('retry')); await flush(); assert.equal(received.length, 0);
  assert.equal(statuses.at(-1).state, 'delayed'); advance(1000); await flush(); assert.equal(received.length, 1);
  stop();

  reset(); stop = start({ onNotification: async () => { throw Object.assign(new Error('Selected reward is unavailable.'), { status: 403 }); } });
  welcome(sockets[0]); await flush();
  const redemption = note('reward-relay');
  redemption.metadata.subscription_type = 'channel.channel_points_custom_reward_redemption.add';
  redemption.payload.subscription.type = redemption.metadata.subscription_type;
  redemption.payload.subscription.condition.reward_id = 'reward-1';
  redemption.payload.event = { broadcaster_user_id: '123', user_id: 'viewer', user_name: 'Viewer', reward: { id: 'reward-1' } };
  sockets[0].message(redemption); await flush();
  assert.equal(statuses.at(-1).state, 'error', 'A permanent relay error must not be overwritten by Listening');
  assert.match(statuses.at(-1).message, /Selected reward is unavailable/);
  stop();
  reset(); stop = start(); welcome(sockets[0]); await flush();
  sockets[0].message(redemption); await flush();
  assert.equal(received[0].payload.event.reward.id, 'reward-1', 'Real redemption shape passes through the socket relay');
  stop();

  reset(); responseStatus = 401; stop = start(); welcome(sockets[0]); await flush();
  assert.equal(authFailures, 1); assert.equal(statuses.at(-1).state, 'auth-required'); assert.equal(timers.size, 0); stop();
  reset(); responseStatus = 403; stop = start(); welcome(sockets[0]); await flush();
  assert.equal(statuses.at(-1).state, 'error'); assert.equal(authFailures, 0); assert.equal(sockets[0].closed, true); assert.match(statuses.at(-1).message, /Missing required scope/); stop();
  reset(); stop = start(); welcome(sockets[0]); await flush();
  sockets[0].message({ metadata: { message_type: 'revocation' }, payload: { subscription: { status: 'authorization_revoked' } } });
  assert.equal(authFailures, 1); assert.equal(timers.size, 0); stop();
  reset(); stop = start({ config: { ...config, triggers: Object.fromEntries(Object.keys(config.triggers).map(k => [k, { enabled: false, durationSeconds: 60 }])) } });
  assert.equal(sockets.length, 0); assert.equal(statuses[0].state, 'idle'); stop();
  reset(); stop = start(); stop(); welcome(sockets[0]); await flush(); assert.equal(requests.length, 0, 'Stopped effects cannot create subscriptions');
  console.log('Passed WebSocket subscriptions, notifications, deduplication, keepalive, seamless handoff, reconnect/resubscribe, relay retries, auth/revocation, disabled triggers, and cleanup.');
} finally {
  globalThis.fetch = real.fetch; globalThis.WebSocket = real.WebSocket;
  globalThis.setTimeout = real.setTimeout; globalThis.clearTimeout = real.clearTimeout; Date.now = real.now;
}
