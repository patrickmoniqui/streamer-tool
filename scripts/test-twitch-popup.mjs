import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
let moduleId = 0;
async function load(entry) {
  const result = await build({ entryPoints: [entry], bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env': '{}' }, plugins: [{ name: 'react', setup(b) { b.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: pathToFileURL(require.resolve(path)).href, external: true })); } }] });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + `\n// ${moduleId++}`).toString('base64')}`);
}
let stored; let listeners; let opened; let popup; let channels; let closed;
const origin = 'https://tools.example';
function reset(path = '/dancefloor/') {
  stored = new Map(); listeners = new Map(); channels = []; closed = false;
  popup = {};
  globalThis.window = {
    location: { href: origin + path, origin, search: '' },
    sessionStorage: { getItem: k => stored.get(k) ?? null, setItem: (k, v) => stored.set(k, v), removeItem: k => stored.delete(k) },
    addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name),
    open: url => { opened = new URL(url); return popup; },
    close: () => { closed = true; },
    history: { state: null, replaceState: (_s, _t, url) => { window.location.href = url; } },
  };
  globalThis.BroadcastChannel = class {
    constructor(name) { this.name = name; channels.push(this); }
    close() { this.closed = true; }
    postMessage(message) { this.sent = message; }
  };
}
const realFetch = globalThis.fetch;
const realBroadcastChannel = globalThis.BroadcastChannel;
let validations = 0;
globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://id.twitch.tv/oauth2/validate');
  assert.equal(options.headers.Authorization, 'OAuth popup-token');
  validations++;
  return Response.json({ client_id: '6vii4ube47seid33yqelo7gdh3cxz9', login: 'Streamer', user_id: '123', expires_in: 3600 });
};
try {
  reset();
  const client = await load('src/lib/twitchBrowserConnect.ts');
  const promise = client.connectBrowserTwitch();
  const state = opened.searchParams.get('state');
  assert.equal(opened.origin, 'https://id.twitch.tv');
  assert.equal(opened.searchParams.get('response_type'), 'token');
  assert.equal(opened.searchParams.get('redirect_uri'), origin + '/globe/');
  assert.ok(opened.searchParams.get('scope').includes('bits:read'));
  const data = { type: 'keylight-twitch-popup', state, token: 'popup-token' };
  const receive = listeners.get('message');
  receive({ origin: 'https://evil.example', source: popup, data });
  receive({ origin, source: {}, data });
  receive({ origin, source: popup, data: { ...data, state: 'wrong' } });
  assert.equal(validations, 0, 'Wrong origin, source, or state cannot import a credential');
  receive({ origin, source: popup, data });
  assert.deepEqual(await promise, { login: 'streamer', userId: '123' });
  assert.equal(validations, 1);
  assert.equal(JSON.parse(stored.get('keylight-twitch-session')).token, 'popup-token');
  assert.equal(stored.has('keylight-globe-twitch-oauth'), false); assert.equal(listeners.size, 0);
  assert.equal(channels[0].closed, true);

  reset('/repo/dancefloor/');
  const broadcastClient = await load('src/lib/twitchBrowserConnect.ts');
  const broadcastPromise = broadcastClient.connectBrowserTwitch();
  assert.equal(opened.searchParams.get('redirect_uri'), origin + '/repo/globe/');
  channels[0].onmessage({ data: { type: 'keylight-twitch-popup', state: opened.searchParams.get('state'), token: 'popup-token' } });
  assert.equal((await broadcastPromise).userId, '123', 'BroadcastChannel supports an isolated popup opener');

  reset();
  const blockedClient = await load('src/lib/twitchBrowserConnect.ts');
  window.open = () => null;
  await assert.rejects(blockedClient.connectBrowserTwitch(), /pop-ups/);
  assert.equal(listeners.size, 0);

  reset('/globe/');
  const callbackClient = await load('src/lib/twitchBrowserConnect.ts');
  const authorize = new URL('https://id.twitch.tv/oauth2/authorize?state=callback-state');
  stored.set('keylight-globe-twitch-oauth', JSON.stringify({ state: authorize.searchParams.get('state'), popup: true, clientId: '6vii4ube47seid33yqelo7gdh3cxz9', redirectUri: origin + '/globe/', createdAt: Date.now() }));
  window.location.href = origin + '/globe/#' + new URLSearchParams({ access_token: 'popup-token', state: 'callback-state', token_type: 'bearer' });
  let posted;
  window.opener = { postMessage: (message, targetOrigin) => { posted = { message, targetOrigin }; } };
  assert.equal(await callbackClient.completeTwitchPopupCallback(), true);
  assert.equal(posted.targetOrigin, origin);
  assert.equal(posted.message.state, 'callback-state');
  assert.equal(posted.message.token, 'popup-token');
  assert.ok(!window.location.href.includes('popup-token'));
  assert.equal(closed, true);

  reset();
  const { TwitchConnection } = await load('src/components/TwitchConnection.tsx');
  const html = renderToStaticMarkup(createElement(TwitchConnection));
  const connect = html.match(/<button[^>]*class="shared-twitch-button"[^>]*>Connect with Twitch<\/button>/)?.[0];
  assert.ok(connect); assert.ok(!connect.includes('disabled'), 'Missing server setup must not disable direct Twitch sign-in');
  console.log('Passed direct Twitch popup, canonical Globe callback, origin/source/state checks, isolated opener relay, token cleanup, blocked-popup recovery, and enabled Connect button.');
} finally { globalThis.fetch = realFetch; globalThis.BroadcastChannel = realBroadcastChannel; }
