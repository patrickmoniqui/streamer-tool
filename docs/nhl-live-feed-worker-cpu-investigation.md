# Soccer Worker CPU investigation — 2026-10-03

The investigation supports excessive work on soccer cache misses, with an additional cold `Intl.DateTimeFormat` cost in the schedule handler. It does **not** establish traffic overload or identify the precise production instruction at which Cloudflare terminates a request. No Worker implementation, deployment, billing, or observability configuration was changed.

## Evidence and scope

The supplied historical analytics recorded 23,243 successes and 3,680 resource-limit failures: 13.67% of those outcomes. Sampled failing soccer requests reported `exceededCpu`, 10 ms CPU, and HTTP 503. Those historical observations are user-provided evidence, not a newly queried window. Observability remains sampled at 1%; unique clients and failure counts from logs cannot describe the full population.

This investigation inspected the downloaded multipart deployment at `/private/tmp/nhl-live-feed-worker-deployed.txt`, extracted its JavaScript module, and replayed that module unchanged in local workerd. The local repository is `streamer-tool`; its `worker/wrangler.toml` names `nhl-live-feed-worker`. The existing unrelated source edits were preserved. `keylight-network-relay` was not involved.

The publicly deployed overlay loads `https://stream.keylight.ca/assets/styles-BEqELpRR.js`, which specifies `https://nhl-live-feed-worker.keylight.workers.dev/api`. A request to `stream.keylight.ca/api/soccer/score/now` reaches GitHub Pages and returns 404, so it is not a suitable Worker probe.

At approximately 17:55–17:56 EDT on October 3, a read-only request to the actual Worker soccer score endpoint returned HTTP 503, body `error code: 1102`, CF-Ray `a44f319ebd183189-YUL`. The next five probes—two soccer scores, two soccer schedules, and one NHL score—returned 200 from YUL. This reproduces intermittent resource-limit failure, but those requests have no application cache-status marker and do not establish which were hits or misses. Error 1102 alone does not distinguish CPU from memory; the supplied `exceededCpu` logs establish the CPU diagnosis for the historical failures.

## Cache and client findings

| Layer | Key | TTL | Work avoided on a hit |
| --- | --- | --- | --- |
| ESPN subrequest `fetch` cache | ESPN URL with `dates=YYYYMMDD` | Requested 3 seconds | Upstream retrieval; JSON parsing and normalization still run |
| Soccer score Cache API response | Full incoming URL | 3 seconds | ESPN fetch, parsing, normalization, serialization |
| Soccer schedule Cache API response | Full incoming URL | 30 seconds | ESPN fetch, parsing, normalization, Intl formatting, serialization |

The Worker explicitly sets `public, max-age=3` or `public, max-age=30`, plus public CORS headers, and stores a cloned response with an awaited `cache.put`. Its constructed soccer response has no `Set-Cookie`, `private`, or `no-store` directive that would obviously prevent Cache API storage. Live successful probes returned the expected TTL headers.

Cloudflare's Cache API is local to each data center and does not replicate entries globally. The `cf` fetch cache and the generated response cache are separate mechanisms. An upstream cache hit does not make the rebuilt soccer response cheap. [Cache API documentation](https://developers.cloudflare.com/workers/runtime-apis/cache/), [cache interactions](https://developers.cloudflare.com/workers/reference/how-the-cache-works/).

The inspected local client and deployed client request schedule and score concurrently. After a successful pair, they also request the previous day's score. Live selections poll every 3 seconds; other selections use a minimum of 10 seconds. With a 3-second score TTL and network/processing delay added to each cycle, a single live overlay can frequently encounter score cache misses. A 30-second schedule entry can reuse several polls. This is an inference from timing and code, not a measured production hit ratio.

Queries are ignored when building soccer data but retained in response keys. Local replay proved that adding `?unused=1` creates a miss and returns an identical body. The inspected clients do not add such parameters to API requests, so fragmentation is a verified weakness, not an established cause of these failures. `/now` and an explicit date also use separate response keys for the same day's upstream input. Arbitrary invalid date suffixes fall back to today's data while retaining distinct keys.

Concurrent score/schedule misses each fetched and processed the same scoreboard in local replay. A normalized-data cache alone will not prevent two simultaneous initial misses; both can see an empty entry. If a request is terminated before its cache write completes, the next poll can encounter the expensive path again. The termination point was not established here.

## Payload and profiling results

Public ESPN fixtures were downloaded without compression. October 3 returned 849,223 bytes and 100 events; October 2 returned 663,563 bytes and 100 events. ESPN's observed Cache-Control was respectively 6 and 5 seconds, while this Worker requests a 3-second subrequest TTL. In the October 3 fixture, the serialized `events` array accounts for 847,912 bytes, so most input is inside events rather than top-level metadata.

The October 3 fixture produced a 67,996-byte score response and a 68,056-byte schedule response. A serialized normalized games array was about 68 KB: roughly 92% smaller than the upstream JSON. Caching that representation could avoid reparsing hundreds of KB of unused ESPN fields and repeating team/event normalization.

The profiling harness records V8 `.cpuprofile` files for first misses, 100 misses per endpoint, and 100 hits per endpoint. Hit batches caused **zero** upstream calls; miss batches caused **100**. Separate requests for score and schedule, including concurrent initial misses, caused two upstream calls. Identical normalized games were asserted across both API response envelopes.

For the October 3 replay, 100 score misses took 1,675 ms wall time versus 313 ms for 100 score hits; schedule misses took 1,944 ms versus 336 ms for hits. These are **local end-to-end wall durations**, including Miniflare proxy, cache service, mocked body transport, and body consumption. They must not be reported as billed Worker CPU. Profiler `(program)` and native samples are not sufficiently attributable to assign an exact production CPU total.

A separate instrumented, local-only module benchmark measured synchronous stages for 120 iterations, reporting 100 after 20 warmups:

| Synchronous stage | October 3 warm median / p95 | October 2 warm median / p95 |
| --- | --- | --- |
| Parse ESPN JSON | 3 / 3 ms | 2 / 3 ms |
| Normalize events and teams | <1 / 1 ms | <1 / 1 ms |
| Serialize score envelope | <1 / 1 ms | <1 / 1 ms |
| Serialize schedule envelope | <1 / 1 ms | <1 / 1 ms |
| Construct and use Intl formatter | <1 / <1 ms | <1 / 1 ms |

Observed timer resolution was about 1 ms: a zero reading means below that resolution, not free computation. Cold JSON parsing took 5 ms for October 3 and 4 ms for October 2. The **first Intl construction/format operation took 12 ms in each stage benchmark**. That synchronous elapsed duration is a substantial concern for a 10 ms budget, but is not a measurement of Cloudflare billed CPU. First unmodified schedule-miss profiles also spent substantial sampled time in `buildSoccerProxyResponse`; these broad samples alone do not isolate Intl from other work in that function.

Warm parsing is the largest measured synchronous stage. Cold schedule Intl initialization is a second significant hotspot. Normalization and serialization are contributors, but were not the dominant warm stages in these fixtures. Scores also fail without Intl, so removing the formatter alone is not a complete remedy.

Parsing the smaller normalized games JSON had a median below 1 ms and p95 of 1 ms across 120 local iterations. A UTC weekday lookup was compared against the existing fixed `en-US`/UTC formatter for all seven weekdays, leap day, and year/day boundaries: all 11 checks passed. These experiments assess representations and output equivalence; they are not a deployed cache implementation.

Local runtime: workerd `1.20260415.1`, Node `v22.22.0`, compatibility date `2026-04-19`. Captured fixtures reflect the current day and previous day, not necessarily the payloads at historical failure times. The harness mocks upstream network access and does not reproduce Cloudflare's `cf` fetch cache. Local hardware, runtime version, sampling, cold starts, and garbage collection differ from production.

Production `performance.now()`/`Date.now()` only advance after I/O, so adding timers around synchronous parse/map/stringify code would yield misleading production measurements. Use local profiles for stage attribution and Cloudflare invocation CPU metadata for production validation. [Performance/timer documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/), [CPU profiling documentation](https://developers.cloudflare.com/workers/observability/dev-tools/cpu-usage/).

## Recommended implementation direction

1. Replace per-miss fixed-locale Intl construction with the tested UTC weekday lookup. This preserves the schedule's day abbreviation and removes its cold formatter cost.
2. Canonicalize soccer response keys around the resolved UTC date and response kind, discarding currently unused query parameters. Include the effective upstream source/version in any shared internal data key. Resolve `/now` before keying so midnight cannot reuse the prior day's entry.
3. Evaluate a shared 3-second normalized snapshot by date/source, or generating and caching both serialized API envelopes from one normalization pass. Keep score and schedule body schemas intact and retain the current freshness policy. Cached final envelopes keep the hottest hit path free of JSON processing.
4. Handle simultaneous initial misses deliberately. A shared cache is not an atomic lock; a module-level memo is isolate-local and may disappear. Any in-flight coalescing must be tested under workerd request-context rules rather than relying on a global promise holding request-owned Responses or streams. Cross-isolate coordination is a separate architecture choice.
5. Carry the snapshot's expiry into derived score responses. Giving an almost-expired shared snapshot another full 3-second response TTL would add staleness beyond the current layering. Avoid persisting a repeatedly reused snapshot or browser/cache header past its freshness deadline. Keep the schedule's existing 30-second policy unless separately requested.
6. Add lightweight cache hit/miss and processing-stage diagnostics for a controlled validation deployment, correlated with invocation CPU and outcomes. Test fresh isolates, both endpoints concurrently, expiry, previous-day requests, source changes, ignored queries, UTC midnight, and large match days. Preserve final API responses and check cache-miss CPU against the 10 ms Free budget. A successful local replay does not prove that production cold misses fit.

Sharing cached work reduces how often expensive processing occurs; it cannot rescue the request that must initially populate the cache if that request exceeds its CPU budget. If cold raw-payload processing still cannot fit reliably, use more CPU headroom or move normalization to a service/process with sufficient CPU. Cloudflare currently documents Free at 10 ms per HTTP invocation and Paid at 30 seconds by default, configurable up to 300,000 ms. No billing change was made. [Worker limits](https://developers.cloudflare.com/workers/platform/limits/).

## Reproduce and inspect artifacts

Run from the repository with its existing dependencies installed:

```sh
node scripts/investigate-soccer-cpu.mjs \
  /private/tmp/nhl-live-feed-worker-deployed.txt \
  /private/tmp/nhl-soccer-upstream-20261003.json \
  /private/tmp/nhl-soccer-profile-20261003
```

The harness accepts a raw deployed module or the supplied multipart bundle. It makes no production requests and writes only local output artifacts. It performs actual Cache API replay before creating a separate instrumented module for stage measurements. Open the `.cpuprofile` files in DevTools to inspect stacks. `summary.json` records fixture/module hashes, runtime versions, upstream call counts, profiles, and stage statistics; `stage-samples.json` records individual raw-stage observations.

Artifacts remain in `/private/tmp/nhl-soccer-profile-20261003` and `/private/tmp/nhl-soccer-profile-20261002`. The latter is an earlier harness run without the normalized representation experiment; both include baseline replay profiles. Downloaded fixture JSON and headers remain under `/private/tmp/nhl-soccer-upstream-2026100{2,3}.*`. Temporary paths are reproducible investigation inputs, not durable production storage.
