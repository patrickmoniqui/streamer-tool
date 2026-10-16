import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

const require = createRequire(import.meta.url);
let moduleId = 0;
async function loadModule(entryPoint, env = {}) {
  const bundle = await build({
    entryPoints: [entryPoint], bundle: true, write: false,
    format: 'esm', platform: 'node', define: { 'import.meta.env': JSON.stringify(env) },
    plugins: [{
      name: 'share-react',
      setup(builder) {
        builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({
          path: pathToFileURL(require.resolve(path)).href, external: true,
        }));
      },
    }],
  });
  const source = `${bundle.outputFiles[0].text}\n// unique test module ${moduleId++}`;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
}

const origin = 'https://tools.example.com';
const clientId = '6vii4ube47seid33yqelo7gdh3cxz9';
const stateKey = 'keylight-globe-twitch-oauth';
let storedConfig = null;
let session;
function setLocation(href) {
  window.location = { href, origin: new URL(href).origin };
}
function resetBrowser(href = `${origin}/globe/`) {
  session = new Map();
  globalThis.window = {
    sessionStorage: {
      getItem: (key) => session.get(key) ?? null,
      setItem: (key, value) => session.set(key, value),
      removeItem: (key) => session.delete(key),
    },
    localStorage: { getItem: () => storedConfig },
    history: { state: null, replaceState: (_state, _title, url) => setLocation(url) },
  };
  setLocation(href);
}
function returnFromTwitch(authorize, overrides = {}) {
  const url = new URL(authorize.searchParams.get('redirect_uri'));
  url.hash = new URLSearchParams({
    access_token: 'mock-token', token_type: 'bearer',
    state: authorize.searchParams.get('state'), ...overrides,
  }).toString();
  setLocation(url.toString());
}

const realFetch = globalThis.fetch;
let requests = [];
let validation = { client_id: clientId, login: 'DJMoneyKey', user_id: '12345', expires_in: 3600 };
let validationStatus = 200;
globalThis.fetch = async (url, options) => {
  requests.push({ url, options });
  assert.equal(String(url), 'https://id.twitch.tv/oauth2/validate');
  assert.equal(options.headers.Authorization, 'OAuth mock-token');
  assert.equal(options.credentials, 'omit');
  return Response.json(validation, { status: validationStatus });
};

try {
  const globe = await loadModule('src/lib/globe.ts');
  const chat = await loadModule('src/lib/twitchChat.ts');
  const { GlobeSettingsPage } = await loadModule('src/pages/GlobeSettingsPage.tsx');
  resetBrowser();
  for (const channel of ['', 'invalid channel', 'djmoneykey']) {
    storedConfig = JSON.stringify({ ...globe.DEFAULT_GLOBE_CONFIG, channel, sessionId: 'old-session' });
    const html = renderToStaticMarkup(createElement(GlobeSettingsPage));
    const copyButton = html.match(/<button[^>]*>Copy overlay URL<\/button>/)?.[0];
    assert.ok(copyButton);
    assert.equal(copyButton.includes('disabled'), true, 'Copy requires a saved profile');
    assert.ok(!html.includes('session=old-session'));
    assert.ok(html.includes('Save changes'));
    assert.ok(html.includes('Zoom animation'));
  }

  for (const path of ['/globe', '/globe/', '/globe/index.html', '/repo/globe/']) {
    resetBrowser(`${origin}${path}?backend=cloud#settings`);
    const auth = await loadModule('src/lib/twitchConnect.ts');
    assert.equal(await auth.completeTwitchConnect(), null);
    const authorize = new URL(auth.buildTwitchConnectUrl());
    assert.equal(authorize.origin, 'https://id.twitch.tv');
    assert.equal(authorize.searchParams.get('client_id'), clientId);
    assert.equal(authorize.searchParams.get('response_type'), 'token');
    assert.equal(authorize.searchParams.has('client_secret'), false);
    assert.equal(authorize.searchParams.get('redirect_uri'), `${origin}${path === '/globe' ? '/globe/' : path}`);
    returnFromTwitch(authorize);
    const callback = auth.completeTwitchConnect();
    assert.ok(!window.location.href.includes('mock-token'), 'Remove URL token before awaiting validation');
    assert.equal(auth.completeTwitchConnect(), callback, 'Repeated React effects must share one callback');
    const identity = await callback;
    assert.deepEqual(identity, { login: 'djmoneykey', userId: '12345' });
    assert.equal(auth.getTwitchConnectToken(), 'mock-token');
    assert.equal(session.has(stateKey), false);
    assert.equal(JSON.stringify([...session]).includes('mock-token'), false);
    const overlay = new URL(globe.buildGlobeOverlayUrl({ ...globe.DEFAULT_GLOBE_CONFIG, channel: identity.login }));
    assert.equal(overlay.pathname, `${path.startsWith('/repo') ? '/repo' : ''}/globe/djmoneykey`);
    assert.equal(overlay.search, '');
    assert.equal(overlay.toString().includes('mock-token'), false);

    let socket;
    globalThis.WebSocket = class {
      listeners = new Map(); sent = [];
      constructor() { socket = this; }
      addEventListener(name, handler) { this.listeners.set(name, handler); }
      send(message) { this.sent.push(message); }
      close() {}
    };
    const commands = [];
    const disconnect = chat.connectTwitchCheckInChat({
      channel: globe.getGlobeProfileChannel(overlay.pathname),
      onCheckIn: (command) => commands.push(command),
    });
    socket.listeners.get('open')();
    assert.ok(socket.sent.includes('JOIN #djmoneykey'));
    socket.listeners.get('message')({ data: '@display-name=Viewer :viewer!viewer@viewer PRIVMSG #djmoneykey :!checkin Montreal\r\n' });
    assert.deepEqual(commands, [{ viewerName: 'Viewer', locationQuery: 'Montreal' }]);
    disconnect();
  }
  assert.equal(requests.length, 4, 'Each valid callback validates once, with no Worker requests');

  for (const failure of ['state', 'missing-state', 'expired-state', 'denied', 'wrong-client', 'expired-token', 'bad-token-type', 'network']) {
    resetBrowser();
    validation = { client_id: clientId, login: 'djmoneykey', user_id: '12345', expires_in: 3600 };
    validationStatus = 200;
    const auth = await loadModule('src/lib/twitchConnect.ts');
    const authorize = new URL(auth.buildTwitchConnectUrl());
    returnFromTwitch(authorize);
    if (failure === 'state') returnFromTwitch(authorize, { state: 'wrong-state' });
    if (failure === 'missing-state') session.clear();
    if (failure === 'expired-state') {
      const pending = JSON.parse(session.get(stateKey));
      pending.createdAt -= 11 * 60 * 1000;
      session.set(stateKey, JSON.stringify(pending));
    }
    if (failure === 'denied') {
      setLocation(`${origin}/globe/?error=access_denied&state=${authorize.searchParams.get('state')}`);
    }
    if (failure === 'wrong-client') validation.client_id = 'another-app';
    if (failure === 'expired-token') validation.expires_in = 0;
    if (failure === 'bad-token-type') returnFromTwitch(authorize, { token_type: 'other' });
    if (failure === 'network') validationStatus = 401;
    const before = requests.length;
    await assert.rejects(auth.completeTwitchConnect());
    assert.ok(!window.location.href.includes('mock-token'));
    assert.equal(session.has(stateKey), false);
    if (['state', 'missing-state', 'expired-state', 'denied', 'bad-token-type'].includes(failure)) {
      assert.equal(requests.length, before, 'Invalid OAuth state/response must not use the token');
    }
  }

  resetBrowser();
  const configured = await loadModule('src/lib/twitchConnect.ts', {
    VITE_TWITCH_CLIENT_ID: 'override-client', VITE_TWITCH_REDIRECT_URI: `${origin}/globe/`,
  });
  assert.equal(new URL(configured.buildTwitchConnectUrl()).searchParams.get('client_id'), 'override-client');
  const wrongOrigin = await loadModule('src/lib/twitchConnect.ts', { VITE_TWITCH_REDIRECT_URI: 'https://other.example/globe/' });
  assert.throws(() => wrongOrigin.buildTwitchConnectUrl(), /origin/);
  const { loadConfigFromFile } = await import('vite');
  const previousMode = process.env.USE_LOCAL_WORKER;
  delete process.env.USE_LOCAL_WORKER;
  try {
    const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'vite.config.ts');
    for (const path of ['/api/twitch', '/api/dancefloor']) {
      assert.equal(loaded.config.server.proxy[path].target, 'http://127.0.0.1:8787');
      let handler;
      loaded.config.server.proxy[path].configure({ on: (_event, fn) => handler = fn });
      const response = { headersSent: false, writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } };
      handler(new Error('No Worker'), {}, response);
      assert.equal(response.status, 503); assert.match(response.body.error, /dev:all/);
    }
    assert.equal(loaded.config.server.proxy['/api'].target, 'https://api-web.nhle.com/v1');
  } finally {
    if (previousMode === undefined) delete process.env.USE_LOCAL_WORKER;
    else process.env.USE_LOCAL_WORKER = previousMode;
  }
  console.log('Passed browser OAuth callbacks, state/token rejection, token cleanup, rendered link controls, Twitch chat, direct sign-in, and local Twitch proxy checks.');
} finally {
  globalThis.fetch = realFetch;
}
