# Streamer Tool

Multi-tool React app for streamers, with OBS/Twitch-friendly browser sources and configurable overlays.

## Scope

- `index.html`: stream tools launcher
- `game-score/`: game score settings and overlay pages
- `globe/`: Twitch viewer check-in globe settings and overlay pages
- `overlay.html`: legacy game score transparent overlay page
- default mode is schedule-driven auto selection
- optional team targeting in auto mode
- manual game override
- sport selection for NHL and soccer/football
- NHL playoffs-only toggle
- show clock toggle
- Twitch `!checkin <location>` globe markers
- Cloudflare Worker proxy for live sports schedule and score feeds

## Local development

1. Install dependencies:

```bash
npm install
```

2. Run the frontend:

```bash
npm run dev
```

The Vite dev server proxies legacy NHL `/api/*` requests to the live NHL API, so the default NHL settings page and overlay work locally without the Worker.

## Local frontend + Worker

To run the frontend against the local Cloudflare Worker instead of the direct NHL proxy:

```bash
npm run dev:all
```

This starts:

- Vite on `http://localhost:5173`
- Wrangler on `http://127.0.0.1:8787`

In this mode, Vite forwards `/api/*` to the local Worker so the app behaves much closer to production.
Use this mode if you want to test analytics or soccer/football locally, since plain `npm run dev` proxies legacy `/api/*` requests straight to the NHL API.

## Local frontend + Deployed Worker

You have two ways to run the local frontend against a deployed Cloudflare Worker.

Always use the deployed Worker:

```powershell
$env:VITE_API_BASE_URL = "https://your-worker-subdomain.workers.dev/api"
npm run dev
```

Toggle to the deployed Worker with a query param only when you want it:

1. Set a local override target in `.env.local`:

```env
VITE_CLOUD_API_BASE_URL=https://your-worker-subdomain.workers.dev/api
```

2. Start the frontend normally:

```powershell
npm run dev
```

3. Add `?backend=cloud` to the local page URL, for example:

```
http://localhost:5173/globe/overlay.html?backend=cloud
```

When that query param is present on localhost, the frontend uses `VITE_CLOUD_API_BASE_URL` instead of the local proxy. This is useful when you want to test the local UI against real Worker features like analytics, soccer routes, or deployed auth/config behavior without running Wrangler locally.

## Production setup

GitHub Pages can host the frontend build, but it cannot host the proxy. For production:

1. Deploy the Worker from `worker/`
2. Set `VITE_API_BASE_URL` to your Worker URL with the `/api` suffix
3. Build and deploy the frontend to GitHub Pages

Example:

```bash
VITE_API_BASE_URL=https://your-worker-subdomain.workers.dev/api npm run build
```

## Versioning

The settings page shows two version values when available:

- `vX.Y.Z` comes from `package.json` and is your release version
- `build N` comes from the GitHub Actions run number and increments automatically on each Pages deploy

Recommended workflow:

- use `npm run version:patch` for fixes and small polish
- use `npm run version:minor` for new user-facing features
- use `npm run version:major` only for breaking URL or config changes

Example:

```bash
npm run version:patch
git add package.json package-lock.json
git commit -m "Bump version to v0.1.1"
git push
```

## Worker routes

- `/api/nhl/schedule/now`
- `/api/nhl/score/now`
- `/api/schedule/now`
- `/api/score/now`
- `/api/soccer/schedule/now`
- `/api/soccer/score/now`
- `/api/soccer/score/:date`
- `/api/globe/checkins`
- `/api/globe/sessions/:session/clear`
- `/api/me/game-score-profile` (authenticated `GET` / `PUT`)
- `/api/game-score-profiles/:profile` (public `GET`)

The NHL routes proxy public NHL web endpoints. The soccer routes normalize ESPN soccer scoreboard responses into the app's shared game shape. All routes use short cache windows and permissive CORS for the GitHub Pages frontend.

The globe routes store viewer check-ins in D1 and resolve locations through OpenStreetMap Nominatim with a D1 cache.

Apply the globe schema with:

```bash
npx wrangler d1 execute sport-live-feed-analytics --remote --file worker/sql/globe.sql
```

## Globe Twitch connection

The Globe settings page has a **Connect with Twitch** button. Sign-in selects
the verified Twitch channel and loads its saved settings. Choose the appearance,
click **Save changes**, then copy the permanent OBS URL:

```text
https://your-domain/globe/yourusername
```

The URL stays the same when settings change. The overlay loads its channel's
saved settings and checks for updates every five seconds. Labels, animations,
background transparency, and globe color update without replacing the OBS link.
The **Zoom animation** toggle is off by default. When enabled, new check-ins
rotate into view, zoom in briefly, then return to the normal view. It also works
when **Animate new check-ins** is off. `!checkin me` does not trigger zoom.
The zoom toggle is saved with the other settings and uses the same permanent URL.
The link becomes available after settings have been saved. Changes in the preview
remain drafts until **Save changes** succeeds. Legacy query-string overlay links
continue to work, with explicit query settings retained as overrides.

Globe sign-in runs entirely in the browser using Twitch's implicit OAuth flow.
The public Client ID supplied for this app is included by default; no client
secret or Worker OAuth callback configuration is required for globe sign-in.
The app validates the returned token with Twitch and keeps it only in memory for
saving settings during that visit. It revalidates the connection hourly. The token
is never put in local/session storage or an OBS URL and is removed from the
address bar immediately. After reloading settings, connect again to save changes.
Only the channel and draft globe settings are saved locally; published settings
are stored in the Worker's D1 database.

The Worker exposes public `GET /api/globe/profiles/:channel` and authenticated
`PUT /api/globe/profiles/:channel`. Every save validates the Bearer token directly
with Twitch and checks that the account owns the channel. Settings are keyed by
Twitch user ID, and the public username selects the overlay profile. The Worker
uses the supplied public Client ID by default; if you override the frontend's
`VITE_TWITCH_CLIENT_ID`, set the same `TWITCH_CLIENT_ID` on the Worker. No client
secret is required for this API. Configure `VITE_API_BASE_URL` and the Worker's
`ANALYTICS_DB` binding as for globe markers.

The `globe_profiles` table is included in `worker/sql/globe.sql` and is also created
on demand. To initialize it explicitly:

```bash
npx wrangler d1 execute nhl-live-feed-analytics --remote --file worker/sql/globe.sql
```

In the Twitch developer console, register the exact globe settings URL under
**OAuth Redirect URLs**, for example:

```text
https://stream.keylight.ca/globe/
http://localhost:5173/globe/
```

Use the actual deployed URL, including any repository prefix and trailing slash.
By default the app uses the current settings page's URL without its query or
fragment. An extensionless `/globe` path is normalized to `/globe/`. If you use
`/globe/index.html`, register that exact URL too or configure a canonical redirect.

Optional frontend overrides:

```bash
VITE_TWITCH_CLIENT_ID=6vii4ube47seid33yqelo7gdh3cxz9
VITE_TWITCH_REDIRECT_URI=https://stream.keylight.ca/globe/
```

A configured redirect must be a globe settings page on the same app origin with
no query or fragment. GitHub Pages builds read these overrides from repository
variables. Changing them requires rebuilding the frontend. Existing Worker-backed
Game Score sign-in and saved profiles remain separate.

Run the mocked OAuth, rendered link controls, and chat connection regression
checks with `node scripts/test-twitch-connect.mjs`. Run the local Worker/D1 profile
checks with `node scripts/test-globe-profiles.mjs`; all Twitch responses are mocked.

## Optional Twitch saved profiles

Twitch sign-in can save one Game Score configuration per Twitch account. It is
disabled by default and does not replace existing query-string overlay URLs.

Frontend env:

```bash
VITE_ENABLE_TWITCH_GATE=false
VITE_TWITCH_AUTH_BASE=https://your-worker-subdomain.workers.dev
```

Worker vars:

```toml
TWITCH_GATE_ENABLED = "false"
TWITCH_ALLOWED_ORIGIN = "https://<your-user>.github.io"
TWITCH_CLIENT_ID = "<twitch-client-id>"
TWITCH_CLIENT_SECRET = "<twitch-client-secret>"
TWITCH_REDIRECT_URI = "https://your-worker-subdomain.workers.dev/auth/twitch/callback"
TWITCH_SESSION_SECRET = "<long-random-secret>"
TWITCH_SUCCESS_REDIRECT_URL = "https://<your-user>.github.io/<repo>/"
```

Set `VITE_ENABLE_TWITCH_GATE=true` in the frontend build and
`TWITCH_GATE_ENABLED = "true"` in the Worker. Register the exact Worker callback
URL with Twitch, configure the client secret with `wrangler secret put`, and use a
long random `TWITCH_SESSION_SECRET`.

Apply the profile schema to the same D1 database bound as `ANALYTICS_DB`:

```bash
npx wrangler d1 execute sport-live-feed-analytics --remote --file worker/sql/game_score_profiles.sql
```

After signing in and saving settings, the Game Score page shows a permanent OBS
link such as `.../game-score/overlay.html?profile=<opaque-id>`. That link loads
the saved baseline whenever OBS reloads. Existing full query-string links remain
portable and unchanged. A mixed link is supported: explicit valid settings in the
URL override only those saved profile values, for example
`?profile=<opaque-id>&style=minimal`.

For reliable credentialed sign-in, serve the settings app from
`https://stream.keylight.ca` and the Worker from that domain or a same-site API
subdomain such as `https://api.stream.keylight.ca`.

## Basic analytics

The app can collect a small set of anonymous usage events:

- `settings_opened`
- `overlay_link_copied`
- `overlay_loaded`

These events are tied to a random install ID stored in local browser storage, not a user account. The copied overlay URL also carries that install ID so overlay loads in OBS can be attributed back to the same install.

Analytics writes are best-effort and no-op automatically when the Worker has no `ANALYTICS_DB` binding.

### Setup

1. Create a D1 database:

```bash
npx wrangler d1 create sport-live-feed-analytics
```

2. Add the returned binding details to `worker/wrangler.toml`:

```toml
[[d1_databases]]
binding = "ANALYTICS_DB"
database_name = "sport-live-feed-analytics"
database_id = "<your-d1-database-id>"
```

Existing deployments can keep an older D1 `database_name` as long as the
`database_id` is correct.

3. Apply the schema:

```bash
npx wrangler d1 execute sport-live-feed-analytics --remote --file worker/sql/analytics.sql
```

4. Set a read token for the summary endpoint:

```bash
npx wrangler secret put ANALYTICS_READ_TOKEN
```

### Reading the stats

Fetch a JSON summary from the Worker:

```bash
curl \
  -H "Authorization: Bearer <your-token>" \
  "https://your-worker-subdomain.workers.dev/api/analytics/summary?days=30"
```

The summary includes:

- unique installs in the selected window
- settings-page users vs overlay users
- link copies and overlay loads
- latest-setting breakdowns for style, layout, refresh interval, playoffs toggle, clock toggle, team count, and team selection

### Private admin page

There is also a static admin page at `/admin/`.

- Example local URL: `http://localhost:5173/admin/`
- Example production URL: `https://<your-user>.github.io/<repo>/admin/`

The page is not linked from the public settings UI. It asks for your `ANALYTICS_READ_TOKEN`, stores it in your browser, and uses it to call the protected summary endpoint.

### Location and client stats

Analytics events can also include request-derived metadata from Cloudflare:

- country
- region
- city
- timezone
- network organization
- browser family
- platform

The implementation intentionally does not store raw IP addresses.

If you already created the `analytics_events` table before these fields existed, run this one-time migration:

```bash
npx wrangler d1 execute sport-live-feed-analytics --remote --file worker/sql/analytics_location_client_migration.sql
```
