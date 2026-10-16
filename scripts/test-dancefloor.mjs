import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { Miniflare, Response: WorkerResponse, WebSocketPair } = require('miniflare');
const load = async path => {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const { sealCredential, openCredential } = await load('worker/src/dancefloor/credentials.ts');
const encrypted = await sealCredential('private-test-token', 'owner', 'test-only-background-encryption-secret-12345');
assert.ok(!JSON.stringify(encrypted).includes('private-test-token'));
assert.equal(await openCredential(encrypted, 'owner', 'test-only-background-encryption-secret-12345'), 'private-test-token');
await assert.rejects(openCredential(encrypted, 'other-owner', 'test-only-background-encryption-secret-12345'));
await assert.rejects(openCredential(encrypted, 'owner', 'a-different-encryption-secret-at-least-32-chars'));
await assert.rejects(sealCredential('private-test-token', 'owner'));
const { initialFloor, applyDanceEvent, advanceFloor, qualifyingTrigger } = await load('worker/src/dancefloor/state.ts');
const { DEFAULT_DANCEFLOOR_CONFIG: defaults, validateDancefloorConfig } = await load('src/lib/dancefloor.ts');
const config = structuredClone(defaults);
for (const rule of Object.values(config.triggers)) rule.enabled = true;
config.rewardId = 'reward-1';
assert.throws(() => validateDancefloorConfig({ ...config, maxDancers: 51 }));
assert.throws(() => validateDancefloorConfig({ ...config, rewardId: '' }));
assert.deepEqual(validateDancefloorConfig(config), config);
assert.throws(() => validateDancefloorConfig({ ...config, rewardId: '' }), /Select an existing channel point reward/);
assert.throws(() => validateDancefloorConfig({ ...config, maxDancers: 0 }), /Maximum dancers/);
assert.throws(() => validateDancefloorConfig({ ...config, triggers: { ...config.triggers, bits: { enabled: true, durationSeconds: 0 } } }), /Bits duration/);
const { DANCEFLOOR_MOVES } = await load('src/lib/dancefloorMoves.ts');
assert.equal(DANCEFLOOR_MOVES.length, 10);
assert.equal(new Set(DANCEFLOOR_MOVES.map(m => JSON.stringify(m.poses))).size, 10, 'Every dance has distinct choreography');
for (const move of DANCEFLOOR_MOVES) {
  assert.equal(move.poses.length, 4);
  for (const pose of move.poses) assert.ok(pose.length === 8 && pose.every(Number.isFinite));
}

assert.equal(qualifyingTrigger(config, 'channel.cheer', { bits: 99 }), null);
assert.equal(qualifyingTrigger(config, 'channel.cheer', { bits: 100 }), 'bits');
assert.equal(qualifyingTrigger(config, 'channel.subscribe', { is_gift: true }), null);
assert.equal(qualifyingTrigger(config, 'channel.subscribe', { is_gift: false }), 'sub');
assert.equal(qualifyingTrigger(config, 'channel.subscription.message', {}), 'resub');
assert.equal(qualifyingTrigger(config, 'channel.subscription.gift', { total: 50 }), 'gift');
assert.equal(qualifyingTrigger(config, 'channel.channel_points_custom_reward_redemption.add', { reward: { id: 'other' } }), null);
assert.equal(qualifyingTrigger(config, 'channel.channel_points_custom_reward_redemption.add', { reward: { id: 'reward-1' } }), 'reward');
assert.equal(qualifyingTrigger(defaults, 'channel.cheer', { bits: 1000 }), null);
const start = 1000000;
let sequence = 0;
const event = (viewerId, durationSeconds = 60, occurredAt = start) => ({ id: `event-${sequence++}`, viewerId, name: viewerId, avatarUrl: '', durationSeconds, occurredAt });
const s = initialFloor(); s.config.maxDancers = 1;
const first = event('alice');
applyDanceEvent(s, first, start); applyDanceEvent(s, first, start);
assert.equal(s.dancers[0].expiresAt, start + 60000, 'Redelivery adds no time');
applyDanceEvent(s, event('alice', 300), start);
assert.equal(s.dancers[0].expiresAt, start + 300000, 'Five minute cap');
applyDanceEvent(s, event('bob'), start);
const deadline = s.queue[0].deadline;
applyDanceEvent(s, event('bob'), start + 1000);
assert.equal(s.queue.length, 1); assert.equal(s.queue[0].deadline, deadline);
advanceFloor(s, start + 121000);
assert.equal(s.queue.length, 0); assert.equal(s.droppedCount, 1);
const coloredQueue = initialFloor(); coloredQueue.config.maxDancers = 1;
applyDanceEvent(coloredQueue, event('first'), start);
applyDanceEvent(coloredQueue, { ...event('colored-viewer'), chatColor: '#FF4500' }, start);
advanceFloor(coloredQueue, start + 61000);
assert.equal(coloredQueue.dancers[0].chatColor, '#FF4500', 'Queue admission preserves Twitch color');
const historical = initialFloor(); historical.config.maxDancers = 1;
applyDanceEvent(historical, event('alice'), start); applyDanceEvent(historical, event('bob'), start);
advanceFloor(historical, start + 90000);
assert.equal(historical.dancers[0].id, 'bob'); assert.equal(historical.dancers[0].expiresAt, start + 120000);
advanceFloor(historical, start + 600000);
assert.equal(historical.dancers.length, 0, 'Offline time does not replay the queue');
const overflow = initialFloor(); overflow.config.maxDancers = 1;
for (let i = 0; i < 102; i++) applyDanceEvent(overflow, event(`viewer-${i}`), start);
assert.equal(overflow.queue.length, 100); assert.equal(overflow.droppedCount, 1);
const stale = initialFloor(); applyDanceEvent(stale, event('late'), start + 61000); assert.equal(stale.dancers.length, 0);
const html = await fs.readFile('404.html', 'utf8');
for (const prefix of ['', '/repo']) for (const tool of ['globe', 'dancefloor']) {
  let redirected;
  vm.runInNewContext(html.match(/<script>([\s\S]*?)<\/script>/)[1], { URL, URLSearchParams, window: { location: { pathname: `${prefix}/${tool}/example`, origin: 'https://tools.example', search: '', replace: value => redirected = value } } });
  assert.equal(new URL(redirected).pathname, `${prefix}/${tool}/overlay.html`);
}
// Render the real component to verify crowded output, anonymous fallback, and safe labels.
const componentBundle = await build({ entryPoints: ['src/components/Dancefloor.tsx'], bundle: true, write: false, format: 'cjs', platform: 'node', external: ['react', 'react/jsx-runtime'] });
const componentModule = { exports: {} };
vm.runInNewContext(componentBundle.outputFiles[0].text, { module: componentModule, exports: componentModule.exports, require, Date, setTimeout, clearTimeout });
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const crowd = Array.from({ length: 50 }, (_, i) => ({ id: `render-${i}`, name: i === 0 ? '<script>bad</script>' : `Viewer ${i}`, avatarUrl: i === 1 ? 'https://static-cdn.jtvnw.net/test.png' : '', enteredAt: start, expiresAt: start + 60000 }));
const rendered = renderToStaticMarkup(React.createElement(componentModule.exports.Dancefloor, { dancers: crowd, config }));
assert.equal((rendered.match(/class="dance-person /g) ?? []).length, 50);
assert.ok(rendered.includes('&lt;script&gt;bad&lt;/script&gt;')); assert.ok(!rendered.includes('<script>'));
const colorMarkup = color => renderToStaticMarkup(React.createElement(componentModule.exports.Dancefloor, { dancers: [{ ...crowd[0], chatColor: color }], config }));
assert.ok(colorMarkup('#FF4500').includes('--stick-color:#FF4500'));
assert.ok(colorMarkup('').includes('--stick-color:hsl('));
assert.ok(colorMarkup('url(https://invalid.example)').includes('--stick-color:hsl('));
assert.ok(rendered.includes('dance-transparent')); assert.ok(rendered.includes('<image'));
assert.equal((rendered.match(/class="dance-bones"/g) ?? []).length, 50);
const extended = renderToStaticMarkup(React.createElement(componentModule.exports.Dancefloor, { dancers: crowd.map(d => ({ ...d, expiresAt: d.expiresAt + 60000 })), config }));
assert.deepEqual([...extended.matchAll(/data-dance="([^"]+)"/g)].map(m => m[1]), [...rendered.matchAll(/data-dance="([^"]+)"/g)].map(m => m[1]), 'Repeated triggers preserve the assigned dance');
assert.ok(new Set([...rendered.matchAll(/data-dance="([^"]+)"/g)].map(m => m[1])).size > 1, 'Viewers receive different dances');

const noLabels = renderToStaticMarkup(React.createElement(componentModule.exports.Dancefloor, { dancers: crowd, config: { ...config, showNames: false, showFloor: true } }));
assert.ok(!noLabels.includes('dance-name')); assert.ok(noLabels.includes('dance-with-floor'));
console.log('Passed trigger rules, duration caps, deduplication, queue expiry/overflow, offline advancement, permanent routes, crowded component rendering, and escaped viewer names.');
if (process.argv.includes('--unit')) process.exit(0);
const bundle = await build({ entryPoints: ['worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dancefloor-ws-test-'));
let colorRequests = new Map();
const serverSockets = [];
const subscriptions = [];
let identity = { client_id: 'test-client', user_id: '123', login: 'streamer', expires_in: 3600 };
const options = {
  d1Persist: path.join(persistDir, 'd1'), durableObjectsPersist: path.join(persistDir, 'rooms'),
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-04-19', bindings: { TWITCH_CLIENT_ID: 'test-client', DANCEFLOOR_ENCRYPTION_KEY: 'test-only-background-encryption-secret-12345' },
  d1Databases: { ANALYTICS_DB: 'dancefloor-test' },
  durableObjects: { DANCEFLOOR_ROOMS: { className: 'DancefloorRoom', useSQLite: true } },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname === 'eventsub.wss.twitch.tv') {
      const pair = new WebSocketPair();
      pair[1].accept(); serverSockets.push(pair[1]);
      const id = `backend-session-${serverSockets.length}`;
      setTimeout(() => { try { pair[1].send(JSON.stringify({ metadata: { message_type: 'session_welcome' }, payload: { session: { id, keepalive_timeout_seconds: 60 } } })); } catch {} }, 20);
      return new WorkerResponse(null, { status: 101, webSocket: pair[0] });
    }
    if (url.pathname === '/helix/eventsub/subscriptions') {
      const subscription = await request.json(); subscriptions.push(subscription);
      return WorkerResponse.json({ data: [{ ...subscription, status: 'enabled' }] }, { status: 202 });
    }
    if (url.pathname === '/oauth2/validate') return WorkerResponse.json(identity);
    if (url.pathname === '/helix/channel_points/custom_rewards') return WorkerResponse.json({ data: [{ id: 'reward-1', title: 'Dance!', is_enabled: true }] });
    if (url.pathname === '/helix/chat/color') {
      const id = url.searchParams.get('user_id');
      colorRequests.set(id, (colorRequests.get(id) ?? 0) + 1);
      if (id === 'color-outage') return WorkerResponse.json({ error: 'Unavailable' }, { status: 503 });
      return WorkerResponse.json({ data: [{ user_id: id, color: id === 'no-color' ? '' : '#1E90FF' }] });
    }
    if (url.pathname === '/helix/users') return WorkerResponse.json({ data: [{ profile_image_url: 'https://static-cdn.jtvnw.net/avatar.png' }] });
    throw new Error(`Unexpected outbound request: ${request.url}`);
  },
};
let mf = new Miniflare(options);
const api = 'https://api.example/api/dancefloor';
const owner = (path, method = 'GET', body, token = true) => mf.dispatchFetch(api + path, {
  method, headers: { ...(token ? { Authorization: 'Bearer browser-token' } : {}), Origin: 'https://tools.example', 'Content-Type': 'application/json' },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
let seq = 0;
const notification = (type, event, extra = {}) => ({
  metadata: { message_type: 'notification', message_id: extra.id ?? `message-${seq++}`, message_timestamp: extra.timestamp ?? new Date().toISOString(), subscription_type: type },
  payload: { subscription: { type, condition: { broadcaster_user_id: '123' }, transport: { method: 'websocket', session_id: 'socket-1' } }, event: { broadcaster_user_id: '123', ...event } },
});
try {
  const database = await mf.getD1Database('ANALYTICS_DB');
  for (const sql of (await fs.readFile('worker/sql/dancefloor.sql', 'utf8')).split(';').filter(s => s.trim())) await database.prepare(sql).run();
  assert.equal((await owner('/me', 'GET', undefined, false)).status, 401);
  assert.equal((await owner('/me')).status, 200);
  assert.equal((await owner('/me/rewards')).status, 200);
  const invalidCapacity = await owner('/me/profile', 'PUT', { ...config, maxDancers: 51 });
  assert.equal(invalidCapacity.status, 400);
  assert.match((await invalidCapacity.json()).error, /Maximum dancers/);
  const missingReward = await owner('/me/profile', 'PUT', { ...config, rewardId: '' });
  assert.equal(missingReward.status, 400);
  assert.match((await missingReward.json()).error, /Select an existing channel point reward/);
  assert.equal((await owner('/me/profile', 'PUT', { ...config, rewardId: 'missing' })).status, 400);
  assert.deepEqual(await (await owner('/me/profile', 'PUT', config)).json(), { saved: true });
  const publicSnapshot = () => mf.dispatchFetch(`${api}/channels/streamer/snapshot`);
  assert.equal((await publicSnapshot()).status, 200);
  assert.equal((await (await publicSnapshot()).json()).config.rewardId, 'reward-1');
  // Exercise the real browser EventSub client through the Worker and public OBS
  // snapshot, rather than testing the socket and channel-point API separately.
  const { connectTwitchEventSub } = await load('src/lib/twitchEventSub.ts');
  const browserGlobals = { fetch: globalThis.fetch, WebSocket: globalThis.WebSocket };
  let socket; let stopEvents; let deliveryTimeout; let emittedRedemption = false;
  try {
    globalThis.WebSocket = class {
      listeners = new Map();
      constructor() { socket = this; }
      addEventListener(type, fn) { this.listeners.set(type, fn); }
      close() {}
      message(value) { this.listeners.get('message')({ data: JSON.stringify(value) }); }
    };
    globalThis.fetch = async (url, init) => {
      assert.equal(url, 'https://api.twitch.tv/helix/eventsub/subscriptions');
      const subscription = JSON.parse(init.body);
      assert.equal(subscription.transport.session_id, 'channel-points-session');
      return Response.json({ data: [{ ...subscription, status: 'enabled' }] }, { status: 202 });
    };
    const delivered = new Promise((resolve, reject) => {
      deliveryTimeout = setTimeout(() => reject(new Error('Channel-point WebSocket relay timed out')), 3000);
      stopEvents = connectTwitchEventSub({
        token: 'browser-token', clientId: 'test-client', broadcasterId: '123', config,
        onStatus: status => {
          if (status.state !== 'listening' || emittedRedemption) return;
          emittedRedemption = true;
          const redemption = notification('channel.channel_points_custom_reward_redemption.add', {
            id: 'realistic-redemption', user_id: 'socket-viewer', user_name: 'SocketViewer', status: 'unfulfilled',
            reward: { id: 'reward-1', title: 'Dance!', cost: 100, prompt: '' },
          });
          // Notification IDs are opaque and can be padded Base64 rather than UUIDs.
          redemption.metadata.message_id = 'fwrJ2-1sfKq7nKQZG36-ZdCkRvmmfso3AwFGzQBG31E=';
          // Twitch sends RFC3339 timestamps with nanosecond precision.
          redemption.metadata.message_timestamp = redemption.metadata.message_timestamp.replace('Z', '123456Z');
          redemption.payload.subscription.condition.reward_id = 'reward-1';
          socket.message(redemption);
        },
        onNotification: async message => {
          const response = await owner('/me/events', 'POST', message);
          const result = await response.json();
          resolve({ status: response.status, result });
        },
      });
    });
    socket.message({ metadata: { message_type: 'session_welcome' }, payload: { session: { id: 'channel-points-session', keepalive_timeout_seconds: 10 } } });
    const delivery = await delivered;
    assert.equal(delivery.status, 200, JSON.stringify(delivery.result));
    assert.equal(delivery.result.accepted, true);
    const live = await (await publicSnapshot()).json();
    assert.ok(live.dancers.some(d => d.id === 'socket-viewer' && d.name === 'SocketViewer'));
    await owner('/me/clear', 'POST', {});
  } finally {
    stopEvents?.(); clearTimeout(deliveryTimeout);
    globalThis.fetch = browserGlobals.fetch; globalThis.WebSocket = browserGlobals.WebSocket;
  }
  const ignored = await owner('/me/events', 'POST', notification('channel.cheer', { user_id: 'alice', bits: 99 }));
  assert.equal((await ignored.json()).accepted, false);
  const first = notification('channel.cheer', { user_id: 'alice', user_name: 'Alice', bits: 100 });
  assert.equal((await owner('/me/events', 'POST', first)).status, 200);
  const before = (await (await publicSnapshot()).json()).dancers[0];
  assert.equal(before.chatColor, '#1E90FF');
  await owner('/me/events', 'POST', first);
  assert.equal((await (await publicSnapshot()).json()).dancers[0].expiresAt, before.expiresAt);
  assert.equal(colorRequests.get('alice'), 1, 'Chat color lookups are cached across repeated events');
  await owner('/me/events', 'POST', notification('channel.subscription.gift', { user_id: 'giver', total: 50 }));
  await owner('/me/events', 'POST', notification('channel.subscribe', { user_id: 'recipient', is_gift: true }));
  await owner('/me/events', 'POST', notification('channel.subscribe', { user_id: 'subscriber', is_gift: false }));
  await owner('/me/events', 'POST', notification('channel.subscription.message', { user_id: 'resubber' }));
  await owner('/me/events', 'POST', notification('channel.channel_points_custom_reward_redemption.add', { user_id: 'reward-viewer', reward: { id: 'reward-1' } }));
  await owner('/me/events', 'POST', notification('channel.cheer', { is_anonymous: true, bits: 100 }));
  const active = await (await publicSnapshot()).json();
  assert.equal(active.dancers.length, 6);
  assert.ok(active.dancers.some(d => d.name === 'Anonymous' && !d.avatarUrl && !d.chatColor));
  for (const user_id of ['no-color', 'color-outage']) {
    assert.equal((await owner('/me/events', 'POST', notification('channel.cheer', { user_id, bits: 100 }))).status, 200);
    assert.equal((await (await publicSnapshot()).json()).dancers.find(d => d.id === user_id).chatColor, '');
  }
  for (const id of ['', 'x'.repeat(513), 'bad\nmessage']) {
    const invalidId = notification('channel.cheer', { user_id: 'bad-id', bits: 100 }, { id });
    const response = await owner('/me/events', 'POST', invalidId);
    assert.equal(response.status, 403);
    assert.match((await response.json()).error, /metadata/);
  }
  const opaque = notification('channel.cheer', { user_id: 'opaque-id', bits: 100 }, { id: 'opaque/notification+id==' });
  assert.equal((await owner('/me/events', 'POST', opaque)).status, 200);
  const opaqueBefore = (await (await publicSnapshot()).json()).dancers.find(d => d.id === 'opaque-id');
  await owner('/me/events', 'POST', opaque);
  assert.equal((await (await publicSnapshot()).json()).dancers.find(d => d.id === 'opaque-id').expiresAt, opaqueBefore.expiresAt, 'Opaque IDs still deduplicate deliveries');
  const malformed = notification('channel.cheer', { user_id: 'bad', bits: 100 });
  malformed.payload.event.broadcaster_user_id = 'other';
  assert.equal((await owner('/me/events', 'POST', malformed)).status, 403);
  assert.equal((await owner('/me/events', 'POST', notification('channel.cheer', { bits: 100 }), false)).status, 401);
  assert.equal((await owner('/me/events', 'POST', notification('channel.cheer', { bits: 100 }, { timestamp: new Date(Date.now() - 700000).toISOString() }))).status, 400);
  const malicious = notification('channel.cheer', { user_id: 'bounded', bits: 100 });
  malicious.durationSeconds = 1000000; malicious.payload.event.durationSeconds = 1000000;
  await owner('/me/events', 'POST', malicious);
  const bounded = (await (await publicSnapshot()).json()).dancers.find(d => d.id === 'bounded');
  assert.ok(bounded.expiresAt - bounded.enteredAt <= 60000, 'The server uses saved durations');
  // Bearer identity selects the owner; another channel cannot alter streamer state.
  identity = { ...identity, user_id: '456', login: 'other' };
  await owner('/me/profile', 'PUT', { ...config, accentColor: '#ffffff' });
  assert.equal((await (await publicSnapshot()).json()).config.accentColor, config.accentColor);
  identity = { ...identity, client_id: 'wrong-app' };
  assert.equal((await owner('/me')).status, 403);
  identity = { ...identity, client_id: 'test-client', user_id: '123', login: 'streamer', expires_in: 0 };
  assert.equal((await owner('/me')).status, 401);
  identity.expires_in = 3600;
  const stored = await database.prepare('SELECT * FROM dancefloor_profiles WHERE user_id = ?').bind('123').first();
  assert.equal(stored.credentials, null); assert.ok(!JSON.stringify(stored).includes('browser-token'));
  const original = await (await publicSnapshot()).json();
  await mf.dispose(); mf = new Miniflare(options);
  const restarted = await (await publicSnapshot()).json();
  assert.equal(restarted.dancers[0].expiresAt, original.dancers[0].expiresAt);
  assert.equal(restarted.dancers[0].chatColor, '#1E90FF', 'User color survives a room restart');
  assert.equal((await owner('/me/test', 'POST', {})).status, 200);
  assert.ok((await (await publicSnapshot()).json()).dancers.some(d => d.id === '123'));
  await owner('/me/clear', 'POST', {});
  assert.equal((await (await publicSnapshot()).json()).dancers.length, 0);
  // From here on, no settings page or browser relay exists: only the backend
  // socket and public OBS polling remain active.
  const waitFor = async check => {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) { if (await check()) return; await new Promise(r => setTimeout(r, 25)); }
    throw new Error('Background event receiver did not reach the expected state');
  };
  const connected = await owner('/me/connect', 'POST', {});
  assert.equal(connected.status, 200, await connected.text());
  await waitFor(async () => (await (await publicSnapshot()).json()).connection?.state === 'listening');
  assert.equal(subscriptions.length, 5);
  const backgroundEvent = notification('channel.channel_points_custom_reward_redemption.add', { user_id: 'background-viewer', user_name: 'BackgroundViewer', reward: { id: 'reward-1' } }, { id: 'backend/opaque+id==' });
  assert.equal((await owner('/me/events', 'POST', backgroundEvent)).status, 409, 'Old browser tabs cannot double-relay events while the backend owns the connection');
  serverSockets.at(-1).send(JSON.stringify(backgroundEvent));
  await waitFor(async () => (await (await publicSnapshot()).json()).dancers.some(d => d.id === 'background-viewer'));
  const backgroundFloor = await (await publicSnapshot()).json();
  assert.ok(!JSON.stringify(backgroundFloor).includes('browser-token'));
  assert.match(backgroundFloor.connection.message, /background/);
  assert.match(backgroundFloor.connection.lastEvent, /BackgroundViewer/);
  // A repeated settings visit must reuse the existing listener.
  await owner('/me/connect', 'POST', {});
  assert.equal(serverSockets.length, 1);
  // Deployment/object restart restores encrypted credentials without an owner request.
  await mf.dispose(); mf = new Miniflare(options);
  await publicSnapshot();
  await waitFor(async () => (await (await publicSnapshot()).json()).connection?.state === 'listening');
  assert.equal(serverSockets.length, 2);
  assert.equal(subscriptions.length, 10);
  const resumedEvent = notification('channel.cheer', { user_id: 'after-restart', user_name: 'AfterRestart', bits: 100 });
  serverSockets.at(-1).send(JSON.stringify(resumedEvent));
  await waitFor(async () => (await (await publicSnapshot()).json()).dancers.some(d => d.id === 'after-restart'));
  serverSockets.at(-1).send(JSON.stringify({ metadata: { message_type: 'revocation' }, payload: { subscription: { status: 'authorization_revoked' } } }));
  await waitFor(async () => (await (await publicSnapshot()).json()).connection?.state === 'auth-required');
  const socketCount = serverSockets.length;
  await publicSnapshot();
  assert.equal(serverSockets.length, socketCount, 'Public polling cannot restart revoked authorization');
  await owner('/me/connect', 'POST', {});
  await waitFor(async () => (await (await publicSnapshot()).json()).connection?.state === 'listening');
  await owner('/me/disconnect', 'POST', {});
  assert.equal((await (await publicSnapshot()).json()).connection.state, 'idle');
  const stoppedCount = serverSockets.length;
  await mf.dispose(); mf = new Miniflare(options);
  await publicSnapshot();
  assert.equal(serverSockets.length, stoppedCount, 'Explicit disconnect survives object restarts');
  identity.expires_in = 1;
  await owner('/me/connect', 'POST', {});
  await waitFor(async () => (await (await publicSnapshot()).json()).connection?.state === 'auth-required');
  identity.expires_in = 3600;
  console.log('Passed server-only Twitch events with settings closed, backend restart recovery, idempotent connection, revocation, explicit disconnect, and credential-free public snapshots.');
  assert.equal((await mf.dispatchFetch(`${api}/webhook`, { method: 'POST', body: '{}' })).status, 410);
  console.log('Passed authenticated WebSocket event relay, all triggers, server filtering, ownership, deduplication, anonymous/gift behavior, persistence/restart, and manual OBS tests.');
} finally { await mf.dispose(); await fs.rm(persistDir, { recursive: true, force: true }); }
