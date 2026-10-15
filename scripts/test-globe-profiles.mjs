import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const { Miniflare, Response: WorkerResponse } = require('miniflare');
const bundle = await build({ entryPoints: ['worker/src/index.ts'], bundle: true, write: false, format: 'esm', platform: 'browser' });
const clientId = '6vii4ube47seid33yqelo7gdh3cxz9';
const identities = {
  owner: { client_id: clientId, login: 'djmoneykey', user_id: '123', expires_in: 3600 },
  other: { client_id: clientId, login: 'anotherchannel', user_id: '456', expires_in: 3600 },
  wrongapp: { client_id: 'wrong-client', login: 'djmoneykey', user_id: '123', expires_in: 3600 },
};
const mf = new Miniflare({
  modules: true, script: bundle.outputFiles[0].text, compatibilityDate: '2026-04-19',
  d1Databases: { ANALYTICS_DB: 'globe-profile-test' },
  outboundService: (request) => {
    assert.equal(request.url, 'https://id.twitch.tv/oauth2/validate');
    const token = request.headers.get('Authorization')?.replace('OAuth ', '');
    return identities[token]
      ? WorkerResponse.json(identities[token])
      : WorkerResponse.json({ error: 'invalid token' }, { status: 401 });
  },
});
const endpoint = 'https://local.example/api/globe/profiles/djmoneykey';
const settings = {
  channel: 'untrusted-input', sessionId: 'untrusted-session', rotationSpeed: 999,
  animateCheckIns: false, showLabels: true, transparent: true, globeColor: '#8FDCFF',
};
const put = (token, config = settings) => mf.dispatchFetch(endpoint, {
  method: 'PUT', headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ config }),
});

try {
  const preflight = await mf.dispatchFetch(endpoint, { method: 'OPTIONS', headers: { Origin: 'https://frontend.example' } });
  assert.equal(preflight.status, 204);
  assert.ok(preflight.headers.get('Access-Control-Allow-Methods').includes('PUT'));
  assert.ok(preflight.headers.get('Access-Control-Allow-Headers').includes('Authorization'));
  assert.equal((await mf.dispatchFetch(endpoint)).status, 404);
  assert.equal((await put(null)).status, 401);
  assert.equal((await put('expired')).status, 401);
  assert.equal((await put('other')).status, 403);
  assert.equal((await put('wrongapp')).status, 403);
  assert.equal((await put('owner', { ...settings, globeColor: 'invalid' })).status, 400);
  assert.equal((await put('owner', { ...settings, zoomAnimation: 'yes' })).status, 400);
  assert.equal((await mf.dispatchFetch(endpoint)).status, 404, 'Rejected writes create no profile');

  const savedResponse = await put('owner');
  assert.equal(savedResponse.status, 200);
  const saved = await savedResponse.json();
  assert.equal(saved.config.channel, 'djmoneykey');
  assert.equal(saved.config.sessionId, 'djmoneykey');
  assert.equal(saved.config.rotationSpeed, 1 / 15);
  assert.equal(saved.config.globeColor, '#8fdcff');
  assert.equal(saved.config.zoomAnimation, false, 'Existing profiles default to no zoom');

  const publicResponse = await mf.dispatchFetch(endpoint);
  assert.equal(publicResponse.status, 200);
  assert.equal(publicResponse.headers.get('Cache-Control'), 'no-store');
  assert.deepEqual((await publicResponse.json()).config, saved.config);
  const changed = { ...settings, animateCheckIns: true, zoomAnimation: true, showLabels: false, transparent: false, globeColor: '#ff0000' };
  assert.equal((await put('owner', changed)).status, 200);
  const reloaded = (await (await mf.dispatchFetch(endpoint)).json()).config;
  assert.equal(reloaded.globeColor, '#ff0000');
  assert.equal(reloaded.showLabels, false);
  assert.equal(reloaded.animateCheckIns, true);
  assert.equal(reloaded.transparent, false);
  assert.equal(reloaded.zoomAnimation, true);
  assert.equal((await put('other')).status, 403);
  assert.deepEqual((await (await mf.dispatchFetch(endpoint)).json()).config, reloaded, 'Other accounts cannot change saved settings');

  const db = await mf.getD1Database('ANALYTICS_DB');
  const rows = await db.prepare('SELECT * FROM globe_profiles').all();
  assert.equal(rows.results.length, 1, 'Saving changes updates the existing account profile');
  assert.ok(!JSON.stringify(rows.results).includes('Bearer'));
  assert.ok(!JSON.stringify(rows.results).includes('access_token'));

  const frontend = await build({ entryPoints: ['src/lib/globe.ts'], bundle: true, write: false, format: 'esm', platform: 'node', define: { 'import.meta.env': '{}' } });
  const globe = await import(`data:text/javascript;base64,${Buffer.from(frontend.outputFiles[0].text).toString('base64')}`);
  const html = await fs.readFile('404.html', 'utf8');
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  for (const prefix of ['', '/repo']) {
    globalThis.window = { location: { href: `https://tools.example${prefix}/globe/` } };
    const before = globe.buildGlobeOverlayUrl(saved.config);
    const after = globe.buildGlobeOverlayUrl(reloaded);
    assert.equal(before, after, 'Changing settings must keep the permanent URL');
    assert.equal(before, `https://tools.example${prefix}/globe/djmoneykey`);
    let redirected;
    const url = new URL(before);
    vm.runInNewContext(script, {
      URL, URLSearchParams,
      window: { location: { pathname: url.pathname, origin: url.origin, search: '', replace: (target) => { redirected = target; } } },
    });
    const target = new URL(redirected);
    assert.equal(target.pathname, `${prefix}/globe/overlay.html`);
    assert.equal(target.search, '');
    const profileChannel = globe.getGlobeProfileChannel(target.pathname, target.hash);
    assert.equal(profileChannel, 'djmoneykey');
    assert.equal(globe.parseGlobeConfig('', profileChannel).sessionId, 'djmoneykey');
    assert.deepEqual(globe.applyGlobeProfileConfig(reloaded), reloaded);
    const legacy = globe.applyGlobeProfileConfig(reloaded, '?labels=1&color=abcdef');
    assert.equal(legacy.showLabels, true);
    assert.equal(legacy.globeColor, '#abcdef');
    assert.equal(legacy.transparent, false);
    assert.equal(legacy.zoomAnimation, true);
    assert.equal(globe.applyGlobeProfileConfig(reloaded, '?zoom=0').zoomAnimation, false);
  }

  const animationBundle = await build({ entryPoints: ['src/lib/globeAnimation.ts'], bundle: true, write: false, format: 'esm', platform: 'node' });
  const { getGlobeFocusCameraDistance: distance, FOCUS_ROTATION_MS: rotate, FOCUS_HOLD_MS: hold, FOCUS_RESUME_MS: resume } = await import(
    `data:text/javascript;base64,${Buffer.from(animationBundle.outputFiles[0].text).toString('base64')}`,
  );
  const base = 4.65;
  assert.equal(distance(base, 0, true), base);
  assert.ok(distance(base, rotate / 2, true) < base);
  assert.equal(distance(base, rotate, true), distance(base, rotate + hold, true));
  assert.ok(distance(base, rotate + hold + resume / 2, true) > distance(base, rotate, true));
  assert.equal(distance(base, rotate + hold + resume, true), base);
  assert.equal(distance(base, rotate + hold + resume + 100, true), base);
  for (let elapsed = 0; elapsed <= rotate + hold + resume; elapsed += 100) {
    assert.equal(distance(base, elapsed, false), base, 'Flag off and non-zoom focus keep the normal camera');
    assert.ok(distance(base, elapsed, true) >= 1.5);
    assert.ok(distance(base, elapsed, true) <= base);
  }
  const realFetch = globalThis.fetch;
  try {
    let tick;
    let stopped = false;
    window.setInterval = (fn, delay) => { tick = fn; assert.equal(delay, 5_000); return 1; };
    window.clearInterval = (id) => { assert.equal(id, 1); stopped = true; };
    let nextConfig = saved.config;
    let unavailable = false;
    globalThis.fetch = async (_url, options) => {
      assert.ok(options.signal);
      if (unavailable) throw new Error('Simulated backend outage');
      return Response.json({ config: nextConfig });
    };
    const seen = [];
    const stop = globe.watchGlobeProfile('djmoneykey', (config) => seen.push(config));
    await new Promise(setImmediate);
    assert.deepEqual(seen, [saved.config]);
    nextConfig = reloaded;
    await tick();
    assert.deepEqual(seen.at(-1), reloaded, 'Overlay receives later saved changes');
    unavailable = true;
    await tick();
    assert.equal(seen.length, 2, 'Backend outages keep the last working settings');
    unavailable = false;
    await tick();
    assert.equal(seen.length, 3, 'Polling recovers after an outage');
    stop();
    assert.equal(stopped, true);
    await tick();
    assert.equal(seen.length, 3, 'Unmounting stops profile updates');
  } finally {
    globalThis.fetch = realFetch;
  }
  console.log('Passed real D1 persistence, ownership, CORS, stable URLs, Pages routing, legacy URLs, and automatic update/recovery checks.');
} finally {
  await mf.dispose();
}
