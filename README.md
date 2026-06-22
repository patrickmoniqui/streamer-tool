# Sport Live Feed

Static React app for OBS/Twitch-friendly live sports score overlays, with a settings page that generates a shareable browser-source URL.

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

The NHL routes proxy public NHL web endpoints. The soccer routes normalize ESPN soccer scoreboard responses into the app's shared game shape. All routes use short cache windows and permissive CORS for the GitHub Pages frontend.

The globe routes store viewer check-ins in D1 and resolve locations through OpenStreetMap Nominatim with a D1 cache.

Apply the globe schema with:

```bash
npx wrangler d1 execute sport-live-feed-analytics --remote --file worker/sql/globe.sql
```

## Optional Twitch gate

The Twitch follower gate is scaffolded behind feature flags and is off by default.

Frontend env:

```bash
VITE_ENABLE_TWITCH_GATE=false
VITE_TWITCH_AUTH_BASE=https://your-worker-subdomain.workers.dev
```

Worker vars:

```toml
TWITCH_GATE_ENABLED = "false"
TWITCH_ALLOWED_ORIGIN = "https://<your-user>.github.io"
TWITCH_BROADCASTER_ID = "<your-twitch-broadcaster-id>"
TWITCH_CLIENT_ID = "<twitch-client-id>"
TWITCH_CLIENT_SECRET = "<twitch-client-secret>"
TWITCH_REDIRECT_URI = "https://your-worker-subdomain.workers.dev/auth/twitch/callback"
TWITCH_SESSION_SECRET = "<long-random-secret>"
TWITCH_SUCCESS_REDIRECT_URL = "https://<your-user>.github.io/<repo>/"
```

When both flags are turned on, the settings page can unlock supporter-only options in the future. The current overlay always shows creator credit.

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
