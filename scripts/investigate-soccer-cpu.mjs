// Local workerd replay only. No production requests, deploys, or configuration writes.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Miniflare, Response } = require('miniflare');
const WebSocket = require('ws');
const [bundlePath, fixturePath, outputPath = '/private/tmp/nhl-soccer-profile'] = process.argv.slice(2);
if (!bundlePath || !fixturePath) {
  throw new Error('Usage: node scripts/investigate-soccer-cpu.mjs DEPLOYED_BUNDLE ESPN_JSON [OUTPUT_DIRECTORY]');
}
const bundle = await fs.readFile(bundlePath, 'utf8');
const moduleMatch = bundle.match(/Content-Type: application\/javascript\+module\r?\n\r?\n([\s\S]*?)\r?\n--[^\r\n]+/);
const source = moduleMatch ? moduleMatch[1] : bundle;
assert(source.includes('function fetchSoccerGames('), 'Expected deployed soccer Worker');
const fixture = await fs.readFile(fixturePath, 'utf8');
const payload = JSON.parse(fixture);
assert(Array.isArray(payload.events), 'Fixture must be an ESPN scoreboard');
await fs.mkdir(outputPath, { recursive: true });

const summary = {
  generatedAt: new Date().toISOString(),
  runtime: { node: process.version, workerd: require('workerd/package.json').version },
  fixture: { path: path.resolve(fixturePath), bytes: Buffer.byteLength(fixture), events: payload.events.length, sha256: createHash('sha256').update(fixture).digest('hex') },
  bundleSha256: createHash('sha256').update(source).digest('hex'),
  caveat: 'Local workerd timings and sampled profiles are not Cloudflare billed CPU. Network is mocked; cf fetch caching is not reproduced. Cache API hit/miss behavior is verified by upstream call counts.',
  behavior: [], profiles: {}, stages: {},
};
let upstreamCalls = 0;
const options = {
  modules: true, script: source, compatibilityDate: '2026-04-19',
  cf: false, inspectorPort: 0,
  outboundService: () => {
    upstreamCalls++;
    return new Response(fixture, { headers: { 'Content-Type': 'application/json' } });
  },
};
const mf = new Miniflare(options);
let socket;
let nextId = 0;
const pending = new Map();
async function cdp(method, params = {}) {
  const id = ++nextId;
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`CDP timeout: ${method}`)); }, 15000);
    pending.set(id, { resolve, reject, timer });
  });
  socket.send(JSON.stringify({ id, method, params }));
  return result;
}
async function connectProfiler() {
  const base = String(await mf.getInspectorURL()).replace('ws:', 'http:');
  const targets = await (await fetch(new URL('/json/list', base))).json();
  const target = targets.find((item) => item.id === 'core:user:');
  assert(target, 'User Worker inspector target missing');
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
  socket.on('message', (message) => {
    const response = JSON.parse(String(message));
    const handler = pending.get(response.id);
    if (!handler) return;
    clearTimeout(handler.timer);
    pending.delete(response.id);
    if (response.error) handler.reject(new Error(JSON.stringify(response.error)));
    else handler.resolve(response.result);
  });
  await cdp('Profiler.enable');
  await cdp('Profiler.setSamplingInterval', { interval: 100 });
}
function profileSummary(profile) {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const self = new Map();
  for (let i = 0; i < (profile.samples?.length ?? 0); i++) {
    const node = nodes.get(profile.samples[i]);
    const name = node.callFrame.functionName || '(anonymous)';
    self.set(name, (self.get(name) ?? 0) + (profile.timeDeltas?.[i] ?? 0));
  }
  return { samples: profile.samples?.length ?? 0, selfSampledMs: Object.fromEntries([...self].sort((a, b) => b[1] - a[1]).map(([name, us]) => [name, Number((us / 1000).toFixed(3))])) };
}
async function record(name, run) {
  const before = upstreamCalls;
  await cdp('Profiler.start');
  const wallStart = performance.now();
  await run();
  const wallMs = performance.now() - wallStart;
  const { profile } = await cdp('Profiler.stop');
  await fs.writeFile(path.join(outputPath, `${name}.cpuprofile`), JSON.stringify(profile));
  summary.profiles[name] = { wallMs, upstreamCalls: upstreamCalls - before, ...profileSummary(profile) };
  console.log(name, JSON.stringify(summary.profiles[name]));
}
const origin = 'https://worker.example';
async function request(route) {
  const response = await mf.dispatchFetch(`${origin}/api/soccer/${route}`);
  assert.equal(response.status, 200);
  const text = await response.text();
  return { body: JSON.parse(text), bytes: Buffer.byteLength(text), cacheControl: response.headers.get('cache-control') };
}
async function behavior(label, route, expectedCalls) {
  const before = upstreamCalls;
  const result = await request(route);
  assert.equal(upstreamCalls - before, expectedCalls, label);
  summary.behavior.push({ label, route, upstreamCalls: upstreamCalls - before, bytes: result.bytes, cacheControl: result.cacheControl });
  return result;
}
function stats(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (fraction) => sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
  return { n: sorted.length, firstMs: values[0], p50Ms: percentile(.5), p95Ms: percentile(.95), maxMs: sorted.at(-1) };
}
try {
  await mf.ready;
  await connectProfiler();
  await record('first-score-miss', () => behavior('score first miss', 'score/2026-10-03', 1));
  await record('first-schedule-miss', () => behavior('schedule independently misses same date', 'schedule/2026-10-03', 1));
  const hit = await behavior('score response hit', 'score/2026-10-03', 0);
  const schedule = await behavior('schedule response hit', 'schedule/2026-10-03', 0);
  assert.deepEqual(hit.body.games, schedule.body.gameWeek[0].games);
  const fragmented = await behavior('unused query fragments cache', 'score/2026-10-03?unused=1', 1);
  assert.deepEqual(hit.body, fragmented.body);
  await record('score-hits-100', async () => {
    for (let i = 0; i < 100; i++) await request('score/2026-10-03');
  });
  assert.equal(summary.profiles['score-hits-100'].upstreamCalls, 0);
  await mf.purgeCache();
  const before = upstreamCalls;
  const [parallelScore, parallelSchedule] = await Promise.all([request('score/2026-10-03'), request('schedule/2026-10-03')]);
  assert.equal(upstreamCalls - before, 2, 'Concurrent endpoints each process upstream');
  assert.deepEqual(parallelScore.body.games, parallelSchedule.body.gameWeek[0].games);
  summary.behavior.push({ label: 'concurrent score + schedule misses', upstreamCalls: 2 });
  for (const type of ['score', 'schedule']) {
    await record(`${type}-misses-100`, async () => {
      for (let i = 0; i < 100; i++) await request(`${type}/2026-10-03?local_profile=${i}`);
    });
    // Use the 30-second schedule entry to keep the entire hit batch within TTL.
    if (type === 'schedule') {
      await request('schedule/2026-10-03');
      await record('schedule-hits-100', async () => {
        for (let i = 0; i < 100; i++) await request('schedule/2026-10-03');
      });
      assert.equal(summary.profiles['schedule-hits-100'].upstreamCalls, 0);
    }
  }
  // Separate local-only stage benchmark. The replay above uses the unchanged module.
  // Timers advance during CPU work locally, unlike timers in deployed Workers.
  socket.close();
  socket = undefined;
  const stageSource = source + `
const __realFetch = index_default.fetch;
index_default.fetch = async function(request, env, ctx) {
  if (new URL(request.url).pathname !== '/__local__/stages') return __realFetch(request, env, ctx);
  const timings = [];
  for (let i = 0; i < 120; i++) {
    const t0 = performance.now();
    const payload = JSON.parse(env.LOCAL_FIXTURE);
    const t1 = performance.now();
    const fallback = payload.leagues?.[0]?.abbreviation || payload.leagues?.[0]?.name || 'Soccer';
    const games = (payload.events ?? []).map(event => normalizeSoccerEvent(event, fallback)).filter(Boolean);
    const t2 = performance.now();
    const date = new Date('2026-10-03T12:00:00Z');
    const currentDate = formatIsoDate(date), previousDate = formatIsoDate(addDays(date, -1)), nextDate = formatIsoDate(addDays(date, 1));
    const t3 = performance.now();
    const dayAbbrev = new Intl.DateTimeFormat('en-US', {weekday: 'short', timeZone: 'UTC'}).format(date);
    const t4 = performance.now();
    const score = JSON.stringify({currentDate, prevDate:previousDate, nextDate, games});
    const t5 = performance.now();
    const schedule = JSON.stringify({previousStartDate:previousDate, nextStartDate:nextDate, gameWeek:[{date:currentDate,dayAbbrev,numberOfGames:games.length,games}]});
    const t6 = performance.now();
    timings.push({parse:t1-t0,normalize:t2-t1,dateEnvelope:t3-t2,intl:t4-t3,serializeScore:t5-t4,serializeSchedule:t6-t5,scoreBytes:score.length,scheduleBytes:schedule.length});
  }
  const normalizedPayload = JSON.parse(env.LOCAL_FIXTURE);
  const normalizedFallback = normalizedPayload.leagues?.[0]?.abbreviation || normalizedPayload.leagues?.[0]?.name || 'Soccer';
  const normalizedGames = (normalizedPayload.events ?? []).map(event => normalizeSoccerEvent(event, normalizedFallback)).filter(Boolean);
  const normalizedText = JSON.stringify(normalizedGames);
  const normalizedParseTimings = [];
  for (let i = 0; i < 120; i++) {
    const start = performance.now();
    const decoded = JSON.parse(normalizedText);
    normalizedParseTimings.push(performance.now() - start);
    if (decoded.length !== normalizedGames.length) throw new Error('Normalized cache parse changed count');
  }
  const weekdays = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  for (const iso of ['2024-02-29T00:00:00Z','2026-01-01T00:00:00Z','2026-10-03T23:59:59Z','2026-12-31T23:59:59Z', ...Array.from({length:7}, (_, i) => '2026-10-' + String(4+i).padStart(2,'0') + 'T12:00:00Z')]) {
    const date = new Date(iso);
    const expected = new Intl.DateTimeFormat('en-US', {weekday:'short',timeZone:'UTC'}).format(date);
    if (weekdays[date.getUTCDay()] !== expected) throw new Error('Weekday lookup changed response');
  }
  return Response.json({timings, normalizedParseTimings, normalizedCharacters:normalizedText.length, weekdayLookupChecks:11});
};`;
  await mf.setOptions({ ...options, script: stageSource, bindings: { LOCAL_FIXTURE: fixture } });
  const stageResult = await (await mf.dispatchFetch(`${origin}/__local__/stages`)).json();
  const stages = stageResult.timings;
  for (const field of ['parse','normalize','dateEnvelope','intl','serializeScore','serializeSchedule']) {
    summary.stages[field] = { all: stats(stages.map((item) => item[field])), after20Warmups: stats(stages.slice(20).map((item) => item[field])) };
  }
  summary.normalizedDataExperiment = { characters: stageResult.normalizedCharacters, parseMs: stats(stageResult.normalizedParseTimings), weekdayLookupChecks: stageResult.weekdayLookupChecks };
  await fs.writeFile(path.join(outputPath, 'stage-samples.json'), JSON.stringify(stages, null, 2));
  console.log('stages', JSON.stringify(summary.stages));
  console.log('normalized-data', JSON.stringify(summary.normalizedDataExperiment));
  await fs.writeFile(path.join(outputPath, 'summary.json'), JSON.stringify(summary, null, 2));
  console.log(`Saved profiles and summary to ${outputPath}`);
} finally {
  socket?.close();
  await mf.dispose();
}
