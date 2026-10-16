import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
const require = createRequire(import.meta.url);
const { Miniflare, Response: WorkerResponse } = require('miniflare');
const load = async path => {
  const result = await build({ entryPoints: [path], bundle: true, write: false, format: 'esm', platform: 'node' });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
};
const { initialFloor, applyDanceEvent, advanceFloor, qualifyingTrigger } = await load('worker/src/dancefloor/state.ts');
const { DEFAULT_DANCEFLOOR_CONFIG: defaults, validateDancefloorConfig } = await load('src/lib/dancefloor.ts');
const config = structuredClone(defaults);
for (const rule of Object.values(config.triggers)) rule.enabled = true;
config.rewardId = 'reward-1';
assert.throws(() => validateDancefloorConfig({ ...config, maxDancers: 51 }));
assert.throws(() => validateDancefloorConfig({ ...config, rewardId: '' }));
assert.deepEqual(validateDancefloorConfig(config), config);
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
assert.ok(rendered.includes('dance-transparent')); assert.ok(rendered.includes('<img'));
const noLabels = renderToStaticMarkup(React.createElement(componentModule.exports.Dancefloor, { dancers: crowd, config: { ...config, showNames: false, showFloor: true } }));
assert.ok(!noLabels.includes('dance-name')); assert.ok(noLabels.includes('dance-with-floor'));
console.log('Passed trigger rules, duration caps, deduplication, queue expiry/overflow, offline advancement, permanent routes, crowded component rendering, and escaped viewer names.');
if (process.argv.includes('--unit')) process.exit(0);
const bundle = await build({ entryPoints: ['worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const persistDir = await fs.mkdtemp(path.join(os.tmpdir(), 'dancefloor-ws-test-'));
let identity = { client_id: 'test-client', user_id: '123', login: 'streamer', expires_in: 3600 };
const options = {
  d1Persist: path.join(persistDir, 'd1'), durableObjectsPersist: path.join(persistDir, 'rooms'),
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-04-19', bindings: { TWITCH_CLIENT_ID: 'test-client' },
  d1Databases: { ANALYTICS_DB: 'dancefloor-test' },
  durableObjects: { DANCEFLOOR_ROOMS: { className: 'DancefloorRoom', useSQLite: true } },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.pathname === '/oauth2/validate') return WorkerResponse.json(identity);
    if (url.pathname === '/helix/channel_points/custom_rewards') return WorkerResponse.json({ data: [{ id: 'reward-1', title: 'Dance!', is_enabled: true }] });
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
  assert.equal((await owner('/me/profile', 'PUT', { ...config, maxDancers: 51 })).status, 400);
  assert.equal((await owner('/me/profile', 'PUT', { ...config, rewardId: 'missing' })).status, 400);
  assert.deepEqual(await (await owner('/me/profile', 'PUT', config)).json(), { saved: true });
  const publicSnapshot = () => mf.dispatchFetch(`${api}/channels/streamer/snapshot`);
  assert.equal((await publicSnapshot()).status, 200);
  assert.equal((await (await publicSnapshot()).json()).config.rewardId, 'reward-1');
  const ignored = await owner('/me/events', 'POST', notification('channel.cheer', { user_id: 'alice', bits: 99 }));
  assert.equal((await ignored.json()).accepted, false);
  const first = notification('channel.cheer', { user_id: 'alice', user_name: 'Alice', bits: 100 });
  assert.equal((await owner('/me/events', 'POST', first)).status, 200);
  const before = (await (await publicSnapshot()).json()).dancers[0];
  await owner('/me/events', 'POST', first);
  assert.equal((await (await publicSnapshot()).json()).dancers[0].expiresAt, before.expiresAt);
  await owner('/me/events', 'POST', notification('channel.subscription.gift', { user_id: 'giver', total: 50 }));
  await owner('/me/events', 'POST', notification('channel.subscribe', { user_id: 'recipient', is_gift: true }));
  await owner('/me/events', 'POST', notification('channel.subscribe', { user_id: 'subscriber', is_gift: false }));
  await owner('/me/events', 'POST', notification('channel.subscription.message', { user_id: 'resubber' }));
  await owner('/me/events', 'POST', notification('channel.channel_points_custom_reward_redemption.add', { user_id: 'reward-viewer', reward: { id: 'reward-1' } }));
  await owner('/me/events', 'POST', notification('channel.cheer', { is_anonymous: true, bits: 100 }));
  const active = await (await publicSnapshot()).json();
  assert.equal(active.dancers.length, 6);
  assert.ok(active.dancers.some(d => d.name === 'Anonymous' && !d.avatarUrl));
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
  assert.equal((await owner('/me/test', 'POST', {})).status, 200);
  assert.ok((await (await publicSnapshot()).json()).dancers.some(d => d.id === '123'));
  await owner('/me/clear', 'POST', {});
  assert.equal((await (await publicSnapshot()).json()).dancers.length, 0);
  assert.equal((await mf.dispatchFetch(`${api}/webhook`, { method: 'POST', body: '{}' })).status, 410);
  console.log('Passed secret-free WebSocket event relay, all triggers, server filtering, ownership, deduplication, anonymous/gift behavior, persistence/restart, and manual OBS tests.');
} finally { await mf.dispose(); await fs.rm(persistDir, { recursive: true, force: true }); }
