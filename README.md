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

2. Start the frontend and local Worker:

```bash
npm run dev
```

`npm run dev` starts both the Cloudflare Worker on `http://127.0.0.1:8787`
and Vite on `http://localhost:5173`. It initializes the local Dancefloor D1 tables
and waits for the Worker before opening the frontend server. All `/api/*`
requests are forwarded to the local Worker. Use the Connect with Twitch button to authorize your channel. Dancefloor uses
EventSub WebSockets and does not need a client secret or webhook configuration.

`npm run dev:all` is an equivalent explicit command. For frontend-only work,
use `npm run dev:frontend`; its legacy sports routes use the direct NHL proxy,
while Twitch and Dancefloor routes require a separately running local Worker.

## Local frontend + Deployed Worker

You have two ways to run the local frontend against a deployed Cloudflare Worker.

Always use the deployed Worker:

```powershell
$env:VITE_API_BASE_URL = "https://your-worker-subdomain.workers.dev/api"
npm run dev:frontend
```

Toggle to the deployed Worker with a query param only when you want it:

1. Set a local override target in `.env.local`:

```env
VITE_CLOUD_API_BASE_URL=https://your-worker-subdomain.workers.dev/api
```

2. Start the frontend normally:

```powershell
npm run dev:frontend
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
Countries with check-ins use the configured globe color at 30% opacity inside
their highlighted borders, including the current animated
check-in before its marker is placed. Highlights follow the marker list and clear
when the corresponding check-ins are removed.
The link becomes available after settings have been saved. Changes in the preview
remain drafts until **Save changes** succeeds. Legacy query-string overlay links
continue to work, with explicit query settings retained as overrides.

Globe's direct sign-in runs entirely in the browser using Twitch's implicit OAuth flow.
The public Client ID supplied for this app is included by default; no client
secret or Worker OAuth callback configuration is required for globe sign-in.
The app validates the returned token with Twitch and keeps it only in memory for
saving settings during that visit. It revalidates the connection hourly. The token
is never put in local/session storage or an OBS URL and is removed from the
address bar immediately. After reloading settings, connect again to save changes.
Only the channel and draft globe settings are saved locally; published settings
are stored in the Worker's D1 database.

The launcher, Globe, and Dancefloor share a direct Twitch account control. Sign-in uses the browser's in-memory credential for the current visit; no token is placed in storage or OBS links. Reconnect after a page reload or navigation when prompted.

The Worker exposes public `GET /api/globe/profiles/:channel` and authenticated
`PUT /api/globe/profiles/:channel`. Every save validates the Bearer token directly with Twitch and checks that the account owns the channel. Settings are keyed by
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

## Dancefloor

Dancefloor displays circular Twitch profile pictures on a transparent OBS
browser source. Settings are at `/dancefloor/`; each channel has a permanent
`/dancefloor/<channel>` OBS URL. Dancers stay on a single row and shrink to fit.

### Connect and receive events

1. Run `npm run dev`, which initializes local storage and starts the Worker and Vite.
2. Open `http://localhost:5173/dancefloor/` and click **Connect with Twitch**.
3. Allow the Twitch sign-in popup, select your triggers, and **Save changes**.
4. Confirm the status says **Listening for Twitch events**.
5. Copy the OBS URL into a 1920 × 1080 Browser Source.
6. **Keep the signed-in Dancefloor settings page open while streaming.**

The settings page connects directly to `wss://eventsub.wss.twitch.tv/ws` using the
streamer's user access token. It subscribes through Twitch's Helix API after the
WebSocket welcome message. No Twitch client secret, public webhook, HTTPS tunnel,
server-side OAuth callback, encryption key, or repair cron is needed for Dancefloor.
The Worker remains necessary for saved profiles, avatar caching, and sharing the
floor with OBS. OBS polls its public snapshot every two seconds.

The same Twitch application/public Client ID is used as Globe. The popup reuses
Globe's registered settings callback, so register the exact Globe settings URL in
the Twitch developer console (including `http://localhost:5173/globe/` for local
work). Optional `VITE_TWITCH_CLIENT_ID` / `VITE_TWITCH_REDIRECT_URI` overrides follow
Globe's existing rules. If overriding the frontend Client ID, set the Worker's
`TWITCH_CLIENT_ID` to match. Tokens stay in memory, are removed from the callback
URL immediately, and never enter browser storage, D1, or the OBS URL. Reloading or
navigating away requires signing in again. Use one settings page per channel.

Closing the settings page stops new events even if OBS stays open. Events missed
while the socket is disconnected are not replayed by Twitch. Existing dancers and
queue timers continue on the Worker. If OBS alone is closed, leaving settings open
still receives events; reopening OBS shows only the current dancers.

The client handles keepalives, reconnects, and recreates subscriptions after a lost
connection. Twitch-directed handoffs keep the old socket until the replacement
welcomes it, preserving existing subscriptions. Notifications are deduplicated;
temporary Worker outages retry the owner relay for up to two minutes. Expired
sign-in or revoked permissions prompt reconnection. There is no polling of Twitch
for rewards/subscription events.

### Triggers, appearance, and queue

Independent triggers: one existing custom reward, a minimum Bits amount per cheer,
new non-gift subscriptions, resub chat announcements, and gift givers once per
gift event/batch. All start off. Each defaults to 60 seconds; Bits default to a
100-Bit minimum. Requested scopes are `channel:read:redemptions`, `bits:read`, and
`channel:read:subscriptions`. Redemptions are observed without fulfilling or
refunding them. Anonymous events use a generic avatar and “Anonymous” label.

Each viewer has one dancer. Repeat events extend their remaining stay to at most
five minutes. The floor defaults to 20 dancers (configurable 1–50). Up to 100
viewers can wait in FIFO order for at most two minutes. Queued repeat events add
time without changing their position or wait deadline; admission grants their
full pending dance time. New admissions are dropped when the queue is full.
Reducing capacity removes the oldest active dancers. **Clear live floor** removes
active/queued dancers and resets counts.

Configure size, names, accent color, transparent background, and an optional floor
image. The Avatar Only design shows circular Twitch profile pictures with
optional usernames, slow gentle floating, and soft entrances/exits. There are no
character bodies. The overlay is silent.
The preview is local; **Save changes** publishes appearance and triggers, and
**Test in OBS** sends a manual dancer using saved settings. Only changes to saved
subscription rules restart the socket; appearance and duration changes apply
without interrupting the listener.

### Deployment and API

Deploy the Worker and static frontend as usual. Initialize these additive tables
before the first Worker deployment (the Worker workflow does this automatically):

```bash
npx wrangler d1 execute ANALYTICS_DB --remote --config worker/wrangler.toml --file worker/sql/dancefloor.sql
npm run deploy:worker
npm run build
```

Keep the `DANCEFLOOR_ROOMS` Durable Object binding and its existing SQLite migration.
D1 stores profiles/avatar cache; one persistent room per Twitch user stores the
floor and advances its timers with alarms. No new schema migration is required
when switching from the previous webhook implementation. Existing saved profiles
and OBS URLs remain valid. Obsolete stored OAuth credentials are cleared upon the
next authenticated request. The old webhook endpoint returns 410, and the repair
cron is removed; no new webhook subscriptions are created.

`GET /api/dancefloor/channels/:channel/snapshot` is public and returns appearance,
active dancers, absolute expiries, server time, revision, and queue/drop counts.
Other endpoints validate the broadcaster's Bearer token and select the channel
from its verified Twitch identity:

- `GET /api/dancefloor/me`: saved configuration and floor snapshot
- `GET /api/dancefloor/me/rewards`: existing channel rewards
- `PUT /api/dancefloor/me/profile`: validate/save configuration
- `POST /api/dancefloor/me/events`: relay a WebSocket notification
- `POST /api/dancefloor/me/test`: add a 60-second broadcaster dancer
- `POST /api/dancefloor/me/clear`: clear floor and queue

The relay accepts only authenticated owner requests. It checks channel/event
metadata, applies the saved trigger rules and duration, resolves avatars itself,
and deduplicates message IDs in the room. This is an owner-controlled relay;
relayed browser notifications are not server-signed Twitch webhooks.

### Verification and troubleshooting

```bash
node scripts/test-twitch-eventsub.mjs
node scripts/test-dancefloor.mjs
node scripts/test-twitch-popup.mjs
node scripts/test-twitch-connect.mjs
node scripts/test-globe-profiles.mjs
npm run build
```

Tests mock Twitch and WebSocket traffic and use temporary local D1/room storage.
They cover all triggers, caps, queue expiry, duplicate delivery, server filtering,
ownership, restart recovery, handoffs, reconnects, failed relay delivery, token
expiry/revocation, and popup validation/cleanup.

- If port 8787 refuses connections, stop the old Vite process and run `npm run dev`
  again so both services start. Frontend-only mode is `npm run dev:frontend`.
- If sign-in cannot open, allow popups for the site. An invalid redirect error
  requires registering the exact Globe callback URL in Twitch.
- If subscriptions fail, reconnect to grant the requested scopes, check the
  selected reward is enabled, and keep only one listener page open for the channel.
- If settings fail to save, verify the Worker is running, D1 is initialized, and
  its public Client ID matches the frontend's override.

Before wider release, validate real rewards, cheers, sub variants, and gifts on
one connected channel. Verify transparent rendering and crowded layouts in OBS,
then close settings to confirm events stop and reopen/sign in to resume. Browser
visual inspection and live Twitch validation require an available browser and
channel; automated tests do not substitute for those checks.
