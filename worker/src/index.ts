const NHL_API_BASE = 'https://api-web.nhle.com/v1';
const ESPN_SOCCER_SCOREBOARD_URL =
  'https://site.api.espn.com/apis/site/v2/sports/soccer/all/scoreboard';
const TWITCH_AUTHORIZE_URL = 'https://id.twitch.tv/oauth2/authorize';
const TWITCH_TOKEN_URL = 'https://id.twitch.tv/oauth2/token';
const TWITCH_VALIDATE_URL = 'https://id.twitch.tv/oauth2/validate';
const TWITCH_FOLLOWED_CHANNELS_URL =
  'https://api.twitch.tv/helix/channels/followed';
const SESSION_COOKIE_NAME = 'twitch_gate_session';
const OAUTH_STATE_COOKIE_NAME = 'twitch_oauth_state';

interface Env {
  ANALYTICS_DB?: D1Database;
  ANALYTICS_READ_TOKEN?: string;
  SOCCER_SCOREBOARD_URL?: string;
  TWITCH_GATE_ENABLED?: string;
  TWITCH_ALLOWED_ORIGIN?: string;
  TWITCH_BROADCASTER_ID?: string;
  TWITCH_CLIENT_ID?: string;
  TWITCH_CLIENT_SECRET?: string;
  TWITCH_REDIRECT_URI?: string;
  TWITCH_SESSION_SECRET?: string;
  TWITCH_SESSION_TTL_SECONDS?: string;
  TWITCH_SUCCESS_REDIRECT_URL?: string;
}

interface NormalizedNamedValue {
  default: string;
}

interface NormalizedTeamRecord {
  id: number;
  abbrev: string;
  score?: number;
  commonName?: NormalizedNamedValue;
  placeName?: NormalizedNamedValue;
  logo?: string;
  darkLogo?: string;
}

interface NormalizedGame {
  id: number;
  sport: 'soccer';
  leagueName?: string;
  statusDetail?: string;
  season: number;
  gameType: number;
  gameState: string;
  gameDate?: string;
  startTimeUTC: string;
  awayTeam: NormalizedTeamRecord;
  homeTeam: NormalizedTeamRecord;
  clock?: {
    timeRemaining: string;
    secondsRemaining: number;
    running: boolean;
    inIntermission: boolean;
  } | null;
  periodDescriptor?: {
    number: number;
    periodType: string;
    maxRegulationPeriods?: number;
  };
}

interface EspnSoccerScoreboard {
  leagues?: Array<{ name?: string; abbreviation?: string }>;
  events?: EspnSoccerEvent[];
}

interface EspnSoccerEvent {
  id?: string;
  uid?: string;
  date?: string;
  name?: string;
  shortName?: string;
  season?: { year?: number; type?: number };
  status?: {
    clock?: number;
    displayClock?: string;
    period?: number;
    type?: {
      completed?: boolean;
      description?: string;
      detail?: string;
      name?: string;
      shortDetail?: string;
      state?: string;
    };
  };
  competitions?: Array<{
    altGameNote?: string;
    status?: EspnSoccerEvent['status'];
    competitors?: EspnSoccerCompetitor[];
  }>;
}

interface EspnSoccerCompetitor {
  homeAway?: string;
  score?: string;
  team?: {
    id?: string;
    abbreviation?: string;
    displayName?: string;
    location?: string;
    name?: string;
    shortDisplayName?: string;
    logo?: string;
    logos?: Array<{ href?: string }>;
  };
}

interface TwitchTokenResponse {
  access_token: string;
  refresh_token?: string;
  scope?: string[];
  token_type: string;
}

interface TwitchValidationResponse {
  client_id: string;
  expires_in: number;
  login: string;
  scopes: string[];
  user_id: string;
}

interface TwitchFollowedChannelsResponse {
  data?: Array<{ broadcaster_id: string }>;
}

interface TwitchGateSession {
  entitled: boolean;
  exp: number;
  login: string;
  sub: string;
}

interface TwitchGateGrant {
  entitled: boolean;
  exp: number;
  sub: string;
}

interface OAuthStatePayload {
  nonce: string;
  returnTo: string;
}

interface AnalyticsEventPayload {
  appVersion?: unknown;
  buildNumber?: unknown;
  eventType?: unknown;
  installId?: unknown;
  pathname?: unknown;
  settings?: unknown;
}

interface AnalyticsSettingsPayload {
  hasUnlock?: unknown;
  goalAnimation?: unknown;
  layout?: unknown;
  mode?: unknown;
  playoffsOnly?: unknown;
  refreshSeconds?: unknown;
  showClock?: unknown;
  style?: unknown;
  teamCount?: unknown;
  teamsKey?: unknown;
}

interface AnalyticsEventRecord {
  asOrganization: string;
  browserFamily: string;
  appVersion: string | null;
  buildNumber: string | null;
  city: string;
  country: string;
  eventType: string;
  hasUnlock: number;
  installId: string;
  layout: string;
  mode: string;
  pathname: string;
  playoffsOnly: number;
  platform: string;
  recordedAt: number;
  refreshSeconds: number;
  region: string;
  showClock: number;
  style: string;
  teamCount: number;
  teamsKey: string;
  timezone: string;
}

interface AnalyticsTableColumnRow {
  name?: unknown;
}

interface GlobeCheckInPayload {
  sessionId?: unknown;
  viewerName?: unknown;
  locationQuery?: unknown;
}

interface GlobeGeocodeResult {
  displayLocation: string;
  latitude: number;
  longitude: number;
  country: string | null;
  region: string | null;
}

interface GlobeCheckInRecord {
  id: string;
  sessionId: string;
  viewerName: string;
  locationQuery: string;
  displayLocation: string;
  latitude: number;
  longitude: number;
  country?: string;
  region?: string;
  createdAt: number;
  updatedAt: number;
}

interface NominatimAddress {
  country?: string;
  state?: string;
  province?: string;
  region?: string;
  county?: string;
}

interface NominatimSearchResult {
  display_name?: string;
  lat?: string;
  lon?: string;
  address?: NominatimAddress;
}

interface WorkerRequestCfProperties {
  asOrganization?: string | null;
  city?: string | null;
  country?: string | null;
  region?: string | null;
  timezone?: string | null;
}

const ANALYTICS_EVENT_TYPES = new Set([
  'settings_opened',
  'overlay_link_copied',
  'overlay_loaded',
  'live_goal_overlay_loaded',
  'globe_settings_opened',
  'globe_overlay_loaded',
  'globe_link_copied',
  'globe_marker_added',
]);
const ANALYTICS_GOAL_ANIMATIONS = new Set(['logo-storm', 'jumbotron', 'logo-rain']);
const ANALYTICS_LAYOUTS = new Set(['compact', 'stacked']);
const ANALYTICS_MODES = new Set(['auto', 'manual']);
const ANALYTICS_STYLES = new Set(['broadcast', 'classic', 'minimal', 'arena']);

function buildPublicCorsHeaders(): Headers {
  const headers = new Headers();
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', 'GET, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  return headers;
}

function buildAuthCorsHeaders(request: Request, env: Env): Headers {
  const headers = new Headers();
  const origin =
    env.TWITCH_ALLOWED_ORIGIN?.trim() ||
    request.headers.get('Origin') ||
    new URL(request.url).origin;

  headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Credentials', 'true');
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  headers.set('Access-Control-Max-Age', '86400');
  headers.set('Vary', 'Origin');
  return headers;
}

function buildAnalyticsCorsHeaders(): Headers {
  const headers = buildPublicCorsHeaders();
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  return headers;
}

function buildGlobeCorsHeaders(): Headers {
  const headers = buildPublicCorsHeaders();
  headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  headers.set('Access-Control-Allow-Headers', 'Content-Type');
  return headers;
}

function jsonResponse(
  body: unknown,
  headers: Headers,
  status = 200,
): Response {
  const responseHeaders = new Headers(headers);
  responseHeaders.set('Content-Type', 'application/json');
  return new Response(JSON.stringify(body), {
    status,
    headers: responseHeaders,
  });
}

function isTwitchGateEnabled(env: Env): boolean {
  return env.TWITCH_GATE_ENABLED === 'true';
}

function getAnalyticsDb(env: Env): D1Database | null {
  return env.ANALYTICS_DB ?? null;
}

function getSessionTtlSeconds(env: Env): number {
  const rawValue = Number(env.TWITCH_SESSION_TTL_SECONDS ?? '86400');
  return Number.isFinite(rawValue) && rawValue > 0 ? rawValue : 86_400;
}

function getAllowedString(value: unknown, allowedValues: Set<string>): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim();

  if (!normalized || !allowedValues.has(normalized)) {
    return null;
  }

  return normalized;
}

function getOptionalString(
  value: unknown,
  fallback: string | null,
  maxLength: number,
): string | null {
  if (typeof value !== 'string') {
    return fallback;
  }

  const normalized = value.trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function getBooleanFlag(value: unknown): number {
  return value === true || value === 1 || value === '1' ? 1 : 0;
}

function getInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return fallback;
  }

  return Math.max(minimum, Math.min(maximum, Math.round(numericValue)));
}

function getCount(value: unknown): number {
  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function normalizeAnalyticsDimension(
  value: string | null | undefined,
  fallback = 'Unknown',
  maxLength = 80,
): string {
  const normalized = value?.trim();

  if (!normalized) {
    return fallback;
  }

  return normalized.slice(0, maxLength);
}

function getRequestCfProperties(
  request: Request,
): WorkerRequestCfProperties | null {
  const requestWithCf = request as Request & { cf?: WorkerRequestCfProperties };
  return requestWithCf.cf ?? null;
}

function inferBrowserFamily(userAgent: string): string {
  const normalizedUserAgent = userAgent.toLowerCase();

  if (!normalizedUserAgent) {
    return 'Unknown';
  }

  if (normalizedUserAgent.includes('obs')) {
    return 'OBS Studio';
  }

  if (normalizedUserAgent.includes('edg/')) {
    return 'Microsoft Edge';
  }

  if (normalizedUserAgent.includes('opr/') || normalizedUserAgent.includes('opera')) {
    return 'Opera';
  }

  if (
    normalizedUserAgent.includes('chrome/') &&
    !normalizedUserAgent.includes('edg/') &&
    !normalizedUserAgent.includes('opr/')
  ) {
    return 'Chrome';
  }

  if (
    normalizedUserAgent.includes('safari/') &&
    !normalizedUserAgent.includes('chrome/') &&
    !normalizedUserAgent.includes('chromium/')
  ) {
    return 'Safari';
  }

  if (normalizedUserAgent.includes('firefox/')) {
    return 'Firefox';
  }

  return 'Other';
}

function inferPlatform(userAgent: string): string {
  const normalizedUserAgent = userAgent.toLowerCase();

  if (!normalizedUserAgent) {
    return 'Unknown';
  }

  if (normalizedUserAgent.includes('windows')) {
    return 'Windows';
  }

  if (normalizedUserAgent.includes('android')) {
    return 'Android';
  }

  if (
    normalizedUserAgent.includes('iphone') ||
    normalizedUserAgent.includes('ipad') ||
    normalizedUserAgent.includes('ios')
  ) {
    return 'iOS';
  }

  if (
    normalizedUserAgent.includes('mac os x') ||
    normalizedUserAgent.includes('macintosh')
  ) {
    return 'macOS';
  }

  if (normalizedUserAgent.includes('cros')) {
    return 'ChromeOS';
  }

  if (normalizedUserAgent.includes('linux')) {
    return 'Linux';
  }

  return 'Other';
}

function getBearerToken(request: Request): string | null {
  const authorizationHeader = request.headers.get('Authorization');

  if (!authorizationHeader?.startsWith('Bearer ')) {
    return null;
  }

  const token = authorizationHeader.slice('Bearer '.length).trim();
  return token || null;
}

function buildLatestAnalyticsBreakdownQuery(columnName: string): string {
  return `
    WITH latest_configs AS (
      SELECT
        install_id,
        ${columnName} AS value,
        ROW_NUMBER() OVER (
          PARTITION BY install_id
          ORDER BY recorded_at DESC, id DESC
        ) AS row_number
      FROM analytics_events
      WHERE recorded_at >= ?
    )
    SELECT value, COUNT(*) AS count
    FROM latest_configs
    WHERE row_number = 1
    GROUP BY value
    ORDER BY count DESC, value ASC
  `;
}

function parseAnalyticsEventRecord(
  payload: unknown,
  request: Request,
): AnalyticsEventRecord | null {
  if (!payload || typeof payload !== 'object') {
    return null;
  }

  const eventPayload = payload as AnalyticsEventPayload;
  const settings =
    eventPayload.settings && typeof eventPayload.settings === 'object'
      ? (eventPayload.settings as AnalyticsSettingsPayload)
      : {};
  const eventType = getAllowedString(
    eventPayload.eventType,
    ANALYTICS_EVENT_TYPES,
  );
  const installId = getOptionalString(eventPayload.installId, null, 128);

  if (!eventType || !installId) {
    return null;
  }

  const requestCf = getRequestCfProperties(request);
  const userAgent = request.headers.get('User-Agent') ?? '';

  return {
    asOrganization: normalizeAnalyticsDimension(
      requestCf?.asOrganization,
      'Unknown network',
      120,
    ),
    appVersion: getOptionalString(eventPayload.appVersion, null, 32),
    buildNumber: getOptionalString(eventPayload.buildNumber, null, 32),
    browserFamily: inferBrowserFamily(userAgent),
    city: normalizeAnalyticsDimension(requestCf?.city, 'Unknown city', 80),
    country: normalizeAnalyticsDimension(requestCf?.country, 'Unknown country', 32),
    eventType,
    hasUnlock: getBooleanFlag(settings.hasUnlock),
    installId,
    layout:
      getAllowedString(settings.layout, ANALYTICS_LAYOUTS) ?? 'compact',
    mode: getAllowedString(settings.mode, ANALYTICS_MODES) ?? 'auto',
    pathname: getOptionalString(eventPayload.pathname, '/', 120) ?? '/',
    playoffsOnly: getBooleanFlag(settings.playoffsOnly),
    platform: inferPlatform(userAgent),
    recordedAt: Date.now(),
    refreshSeconds: getInteger(settings.refreshSeconds, 10, 1, 60),
    region: normalizeAnalyticsDimension(requestCf?.region, 'Unknown region', 80),
    showClock: getBooleanFlag(settings.showClock),
    style:
      getAllowedString(settings.style, ANALYTICS_STYLES) ?? 'broadcast',
    teamCount: getInteger(settings.teamCount, 0, 0, 32),
    teamsKey: getOptionalString(settings.teamsKey, 'AUTO', 120) ?? 'AUTO',
    timezone: normalizeAnalyticsDimension(requestCf?.timezone, 'Unknown timezone', 80),
  };
}

async function getAnalyticsTableColumns(db: D1Database): Promise<Set<string>> {
  const result = await db
    .prepare('PRAGMA table_info(analytics_events)')
    .all<AnalyticsTableColumnRow>();

  return new Set(
    (result.results ?? [])
      .map((row) => (typeof row.name === 'string' ? row.name : null))
      .filter((columnName): columnName is string => Boolean(columnName)),
  );
}

function hasAnalyticsColumn(
  columnNames: Set<string>,
  columnName: string,
): boolean {
  return columnNames.has(columnName);
}

async function fetchOptionalAnalyticsBreakdown(
  db: D1Database,
  columnNames: Set<string>,
  columnName: string,
  since: number,
): Promise<Array<{ count: number; value: string }>> {
  if (!hasAnalyticsColumn(columnNames, columnName)) {
    return [];
  }

  return fetchAnalyticsBreakdown(db, columnName, since);
}

async function fetchAnalyticsBreakdown(
  db: D1Database,
  columnName: string,
  since: number,
): Promise<Array<{ count: number; value: string }>> {
  const result = await db
    .prepare(buildLatestAnalyticsBreakdownQuery(columnName))
    .bind(since)
    .all<Record<string, unknown>>();

  return (result.results ?? []).map((row) => ({
    count: getCount(row.count),
    value:
      row.value === null || typeof row.value === 'undefined'
        ? 'Unknown'
        : String(row.value),
  }));
}

function buildCacheTtl(pathname: string): number {
  if (pathname.includes('/score/')) {
    return 10;
  }

  return 30;
}

function mergeProxyHeaders(response: Response, pathname: string): Headers {
  const headers = buildPublicCorsHeaders();
  headers.set(
    'Content-Type',
    response.headers.get('Content-Type') ?? 'application/json',
  );
  headers.set('Cache-Control', `public, max-age=${buildCacheTtl(pathname)}`);
  return headers;
}

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDays(date: Date, days: number): Date {
  const nextDate = new Date(date);
  nextDate.setUTCDate(nextDate.getUTCDate() + days);
  return nextDate;
}

function parseScoreDate(pathname: string): Date {
  const rawDate = pathname.split('/').at(-1);

  if (!rawDate || rawDate === 'now') {
    return new Date();
  }

  const parsedDate = new Date(`${rawDate}T12:00:00Z`);
  return Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
}

function formatEspnDate(date: Date): string {
  return formatIsoDate(date).replace(/-/g, '');
}

function hashString(value: string): number {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }

  return hash;
}

function normalizeSoccerTeam(
  competitor: EspnSoccerCompetitor | undefined,
): NormalizedTeamRecord {
  const team = competitor?.team ?? {};
  const displayName =
    team.displayName?.trim() ||
    team.shortDisplayName?.trim() ||
    team.name?.trim() ||
    team.abbreviation?.trim() ||
    'TBD';
  const abbrev =
    team.abbreviation?.trim().toUpperCase() ||
    team.shortDisplayName?.trim().slice(0, 3).toUpperCase() ||
    displayName.slice(0, 3).toUpperCase();
  const rawId = Number(team.id);
  const logo = team.logo || team.logos?.find((candidate) => candidate.href)?.href;

  return {
    id: Number.isFinite(rawId) ? rawId : hashString(displayName),
    abbrev,
    score: Number(competitor?.score ?? 0),
    commonName: { default: displayName },
    placeName: { default: team.location?.trim() || displayName },
    logo,
    darkLogo: logo,
  };
}

function normalizeSoccerGameState(status: EspnSoccerEvent['status']): string {
  const statusType = status?.type;

  if (statusType?.completed) {
    return 'FINAL';
  }

  if (statusType?.state === 'in') {
    return 'LIVE';
  }

  if (statusType?.state === 'post') {
    return 'FINAL';
  }

  return 'PRE';
}

function normalizeSoccerPeriodType(status: EspnSoccerEvent['status']): string {
  const description = status?.type?.description?.toLowerCase() ?? '';
  const name = status?.type?.name?.toLowerCase() ?? '';

  if (description.includes('half') || name.includes('halftime')) {
    return 'HALFTIME';
  }

  if (description.includes('pen') || name.includes('pen')) {
    return 'PENALTY_SHOOTOUT';
  }

  if (description.includes('extra') || name.includes('extra')) {
    return 'EXTRA_TIME';
  }

  return 'REG';
}

function formatSoccerClock(status: EspnSoccerEvent['status']): string {
  const displayClock = status?.displayClock
    ?.trim()
    .replace(/[’′`]/g, "'")
    .replace(/\s+/g, '')
    .replace(/min(?:ute)?s?$/i, '');

  if (displayClock) {
    const timeMatch = displayClock.match(/^(\d+):(\d{1,2})$/);

    if (timeMatch) {
      return `${timeMatch[1]}:${timeMatch[2].padStart(2, '0')}`;
    }

    const stoppageMatch = displayClock.match(/^(\d+)'?\+(\d+)'?$/);

    if (stoppageMatch) {
      return `${stoppageMatch[1]}+${stoppageMatch[2]}:00`;
    }

    const minuteMatch = displayClock.match(/^(\d+)'?$/);

    if (minuteMatch) {
      return `${minuteMatch[1]}:00`;
    }

    return displayClock;
  }

  const clockSeconds = Number(status?.clock ?? 0);

  if (!Number.isFinite(clockSeconds) || clockSeconds <= 0) {
    return '';
  }

  return `${Math.floor(clockSeconds / 60)}:${String(Math.floor(clockSeconds % 60)).padStart(2, '0')}`;
}

function normalizeSoccerEvent(
  event: EspnSoccerEvent,
  fallbackLeagueName: string,
): NormalizedGame | null {
  const competition = event.competitions?.[0];
  const competitors = competition?.competitors ?? [];
  const status = event.status ?? competition?.status;
  const awayCompetitor = competitors.find((competitor) => competitor.homeAway === 'away');
  const homeCompetitor = competitors.find((competitor) => competitor.homeAway === 'home');

  if (!awayCompetitor || !homeCompetitor || !event.date) {
    return null;
  }

  const eventId = Number(event.id);
  const gameState = normalizeSoccerGameState(status);
  const statusType = status?.type;
  const statusDetail =
    statusType?.shortDetail?.trim() ||
    statusType?.detail?.trim() ||
    statusType?.description?.trim();
  const period = status?.period ?? 0;
  const clockSeconds = Number(status?.clock ?? 0);
  const periodType = normalizeSoccerPeriodType(status);
  const displayClock = formatSoccerClock(status);

  return {
    id: Number.isFinite(eventId) ? eventId : hashString(event.uid ?? event.name ?? event.date),
    sport: 'soccer',
    leagueName: competition?.altGameNote ?? fallbackLeagueName,
    statusDetail,
    season: event.season?.year ?? new Date(event.date).getUTCFullYear(),
    gameType: event.season?.type ?? 2,
    gameState,
    gameDate: formatIsoDate(new Date(event.date)),
    startTimeUTC: event.date,
    awayTeam: normalizeSoccerTeam(awayCompetitor),
    homeTeam: normalizeSoccerTeam(homeCompetitor),
    clock:
      gameState === 'LIVE'
        ? {
            timeRemaining: displayClock,
            secondsRemaining: Number.isFinite(clockSeconds) ? clockSeconds : 0,
            running: true,
            inIntermission: periodType === 'HALFTIME',
          }
        : null,
    periodDescriptor: period
      ? {
          number: period,
          periodType,
          maxRegulationPeriods: 2,
        }
      : undefined,
  };
}

async function fetchSoccerGames(date: Date, env: Env): Promise<NormalizedGame[]> {
  const upstreamUrl = new URL(
    env.SOCCER_SCOREBOARD_URL?.trim() || ESPN_SOCCER_SCOREBOARD_URL,
  );
  upstreamUrl.searchParams.set('dates', formatEspnDate(date));

  const response = await fetch(upstreamUrl.toString(), {
    headers: {
      Accept: 'application/json',
    },
    cf: {
      cacheEverything: true,
      cacheTtl: buildCacheTtl('/soccer/score/now'),
    },
  });

  if (!response.ok) {
    throw new Error(`Soccer scoreboard failed with ${response.status}`);
  }

  const payload = (await response.json()) as EspnSoccerScoreboard;
  const fallbackLeagueName =
    payload.leagues?.[0]?.abbreviation || payload.leagues?.[0]?.name || 'Soccer';

  return (payload.events ?? [])
    .map((event) => normalizeSoccerEvent(event, fallbackLeagueName))
    .filter((game): game is NormalizedGame => Boolean(game));
}

async function buildSoccerProxyResponse(
  request: Request,
  env: Env,
  pathname: string,
): Promise<Response> {
  const date = parseScoreDate(pathname);
  const currentDate = formatIsoDate(date);
  const previousDate = formatIsoDate(addDays(date, -1));
  const nextDate = formatIsoDate(addDays(date, 1));
  const cache = caches.default;
  const cacheKey = new Request(request.url, { method: 'GET' });
  const cached = await cache.match(cacheKey);

  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: mergeProxyHeaders(cached, pathname),
    });
  }

  const games = await fetchSoccerGames(date, env);
  const body = pathname.startsWith('/soccer/schedule/')
    ? {
        previousStartDate: previousDate,
        nextStartDate: nextDate,
        gameWeek: [
          {
            date: currentDate,
            dayAbbrev: new Intl.DateTimeFormat('en-US', {
              weekday: 'short',
              timeZone: 'UTC',
            }).format(date),
            numberOfGames: games.length,
            games,
          },
        ],
      }
    : {
        currentDate,
        prevDate: previousDate,
        nextDate,
        games,
      };

  const response = jsonResponse(body, mergeProxyHeaders(new Response(), pathname));
  await cache.put(cacheKey, response.clone());
  return response;
}

function parseCookies(request: Request): Record<string, string> {
  const cookieHeader = request.headers.get('Cookie');

  if (!cookieHeader) {
    return {};
  }

  return Object.fromEntries(
    cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separatorIndex = part.indexOf('=');

        if (separatorIndex === -1) {
          return [part, ''];
        }

        return [
          part.slice(0, separatorIndex),
          decodeURIComponent(part.slice(separatorIndex + 1)),
        ];
      }),
  );
}

function buildCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    `Max-Age=${maxAgeSeconds}`,
  ].join('; ');
}

function clearCookie(name: string): string {
  return [
    `${name}=`,
    'Path=/',
    'HttpOnly',
    'Secure',
    'SameSite=None',
    'Max-Age=0',
  ].join('; ');
}

function encodeBase64Url(value: string): string {
  const encoded = btoa(value);
  return encoded.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const padding = normalized.length % 4;
  const padded =
    padding === 0 ? normalized : normalized.padEnd(normalized.length + (4 - padding), '=');
  return atob(padded);
}

async function signValue(value: string, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    {
      name: 'HMAC',
      hash: 'SHA-256',
    },
    false,
    ['sign'],
  );

  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value));
  const bytes = new Uint8Array(signature);
  const raw = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('');
  return encodeBase64Url(raw);
}

async function createSignedToken(
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> {
  const payloadString = JSON.stringify(payload);
  const encodedPayload = encodeBase64Url(payloadString);
  const signature = await signValue(encodedPayload, secret);
  return `${encodedPayload}.${signature}`;
}

async function verifySignedToken<T>(
  token: string,
  secret: string,
): Promise<T | null> {
  const [encodedPayload, signature] = token.split('.');

  if (!encodedPayload || !signature) {
    return null;
  }

  const expectedSignature = await signValue(encodedPayload, secret);

  if (expectedSignature !== signature) {
    return null;
  }

  try {
    return JSON.parse(decodeBase64Url(encodedPayload)) as T;
  } catch {
    return null;
  }
}

function sanitizeReturnTo(
  request: Request,
  env: Env,
  candidate: string | null | undefined,
): string {
  const fallback =
    env.TWITCH_SUCCESS_REDIRECT_URL?.trim() ||
    env.TWITCH_ALLOWED_ORIGIN?.trim() ||
    new URL(request.url).origin;

  if (!candidate) {
    return fallback;
  }

  try {
    const url = new URL(candidate, fallback);
    const allowedOrigin = env.TWITCH_ALLOWED_ORIGIN?.trim();

    if (allowedOrigin && url.origin !== new URL(allowedOrigin).origin) {
      return fallback;
    }

    if (!['http:', 'https:'].includes(url.protocol)) {
      return fallback;
    }

    return url.toString();
  } catch {
    return fallback;
  }
}

async function createOAuthStatePayload(
  request: Request,
  env: Env,
  returnTo: string | null,
): Promise<OAuthStatePayload> {
  return {
    nonce: crypto.randomUUID(),
    returnTo: sanitizeReturnTo(request, env, returnTo),
  };
}

function getMissingTwitchConfig(env: Env): string[] {
  const missing: string[] = [];

  if (!env.TWITCH_CLIENT_ID) {
    missing.push('TWITCH_CLIENT_ID');
  }

  if (!env.TWITCH_CLIENT_SECRET) {
    missing.push('TWITCH_CLIENT_SECRET');
  }

  if (!env.TWITCH_REDIRECT_URI) {
    missing.push('TWITCH_REDIRECT_URI');
  }

  if (!env.TWITCH_BROADCASTER_ID) {
    missing.push('TWITCH_BROADCASTER_ID');
  }

  if (!env.TWITCH_SESSION_SECRET) {
    missing.push('TWITCH_SESSION_SECRET');
  }

  return missing;
}

async function exchangeCodeForToken(
  code: string,
  env: Env,
): Promise<TwitchTokenResponse> {
  const body = new URLSearchParams({
    client_id: env.TWITCH_CLIENT_ID!,
    client_secret: env.TWITCH_CLIENT_SECRET!,
    code,
    grant_type: 'authorization_code',
    redirect_uri: env.TWITCH_REDIRECT_URI!,
  });

  const response = await fetch(TWITCH_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  if (!response.ok) {
    throw new Error(`Twitch token exchange failed with ${response.status}`);
  }

  return response.json() as Promise<TwitchTokenResponse>;
}

async function validateTwitchToken(
  accessToken: string,
): Promise<TwitchValidationResponse> {
  const response = await fetch(TWITCH_VALIDATE_URL, {
    headers: {
      Authorization: `OAuth ${accessToken}`,
    },
  });

  if (!response.ok) {
    throw new Error(`Twitch token validation failed with ${response.status}`);
  }

  return response.json() as Promise<TwitchValidationResponse>;
}

async function checkTwitchFollow(
  accessToken: string,
  clientId: string,
  userId: string,
  broadcasterId: string,
): Promise<boolean> {
  const url = new URL(TWITCH_FOLLOWED_CHANNELS_URL);
  url.searchParams.set('user_id', userId);
  url.searchParams.set('broadcaster_id', broadcasterId);

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Client-Id': clientId,
    },
  });

  if (!response.ok) {
    throw new Error(`Twitch follower check failed with ${response.status}`);
  }

  const payload =
    (await response.json()) as TwitchFollowedChannelsResponse;

  return Array.isArray(payload.data) && payload.data.length > 0;
}

async function getSessionFromRequest(
  request: Request,
  env: Env,
): Promise<TwitchGateSession | null> {
  const cookies = parseCookies(request);
  const token = cookies[SESSION_COOKIE_NAME];

  if (!token || !env.TWITCH_SESSION_SECRET) {
    return null;
  }

  const session = await verifySignedToken<TwitchGateSession>(
    token,
    env.TWITCH_SESSION_SECRET,
  );

  if (!session) {
    return null;
  }

  if (session.exp <= Date.now()) {
    return null;
  }

  return session;
}

async function createOverlayGrant(
  session: TwitchGateSession,
  secret: string,
): Promise<string> {
  const grant = {
    entitled: session.entitled,
    exp: session.exp,
    sub: session.sub,
  } satisfies TwitchGateGrant;

  return createSignedToken(grant, secret);
}

async function handleAnalyticsEvent(
  request: Request,
  env: Env,
): Promise<Response> {
  const headers = buildAnalyticsCorsHeaders();
  const analyticsDb = getAnalyticsDb(env);

  if (request.method !== 'POST') {
    return new Response('Method not allowed', {
      status: 405,
      headers,
    });
  }

  if (!analyticsDb) {
    return jsonResponse(
      {
        enabled: false,
        stored: false,
      },
      headers,
      202,
    );
  }

  let payload: unknown;

  try {
    payload = await request.json();
  } catch {
    return jsonResponse(
      {
        error: 'Invalid analytics payload.',
      },
      headers,
      400,
    );
  }

  const analyticsEvent = parseAnalyticsEventRecord(payload, request);

  if (!analyticsEvent) {
    return jsonResponse(
      {
        error: 'Invalid analytics event.',
      },
      headers,
      400,
    );
  }

  try {
    const analyticsColumns = await getAnalyticsTableColumns(analyticsDb);
    const insertColumns = [
      'recorded_at',
      'event_type',
      'install_id',
      'pathname',
      'app_version',
      'build_number',
      'mode',
      'style',
      'layout',
      'refresh_seconds',
      'playoffs_only',
      'show_clock',
      'team_count',
      'teams_key',
      'has_unlock',
    ];
    const insertBindings: unknown[] = [
      analyticsEvent.recordedAt,
      analyticsEvent.eventType,
      analyticsEvent.installId,
      analyticsEvent.pathname,
      analyticsEvent.appVersion,
      analyticsEvent.buildNumber,
      analyticsEvent.mode,
      analyticsEvent.style,
      analyticsEvent.layout,
      analyticsEvent.refreshSeconds,
      analyticsEvent.playoffsOnly,
      analyticsEvent.showClock,
      analyticsEvent.teamCount,
      analyticsEvent.teamsKey,
      analyticsEvent.hasUnlock,
    ];

    if (hasAnalyticsColumn(analyticsColumns, 'country')) {
      insertColumns.push('country');
      insertBindings.push(analyticsEvent.country);
    }

    if (hasAnalyticsColumn(analyticsColumns, 'region')) {
      insertColumns.push('region');
      insertBindings.push(analyticsEvent.region);
    }

    if (hasAnalyticsColumn(analyticsColumns, 'city')) {
      insertColumns.push('city');
      insertBindings.push(analyticsEvent.city);
    }

    if (hasAnalyticsColumn(analyticsColumns, 'timezone')) {
      insertColumns.push('timezone');
      insertBindings.push(analyticsEvent.timezone);
    }

    if (hasAnalyticsColumn(analyticsColumns, 'as_organization')) {
      insertColumns.push('as_organization');
      insertBindings.push(analyticsEvent.asOrganization);
    }

    if (hasAnalyticsColumn(analyticsColumns, 'browser_family')) {
      insertColumns.push('browser_family');
      insertBindings.push(analyticsEvent.browserFamily);
    }

    if (hasAnalyticsColumn(analyticsColumns, 'platform')) {
      insertColumns.push('platform');
      insertBindings.push(analyticsEvent.platform);
    }

    const placeholders = insertColumns.map(() => '?').join(', ');

    await analyticsDb
      .prepare(
        `
          INSERT INTO analytics_events (
            ${insertColumns.join(', ')}
          )
          VALUES (${placeholders})
        `,
      )
      .bind(...insertBindings)
      .run();
  } catch {
    return jsonResponse(
      {
        error: 'Analytics storage failed.',
      },
      headers,
      500,
    );
  }

  return jsonResponse(
    {
      enabled: true,
      stored: true,
    },
    headers,
    202,
  );
}

async function handleAnalyticsSummary(
  request: Request,
  env: Env,
): Promise<Response> {
  const headers = buildAnalyticsCorsHeaders();
  const analyticsDb = getAnalyticsDb(env);

  if (request.method !== 'GET') {
    return new Response('Method not allowed', {
      status: 405,
      headers,
    });
  }

  if (!analyticsDb) {
    return jsonResponse(
      {
        enabled: false,
        error: 'Analytics storage is not configured.',
      },
      headers,
      503,
    );
  }

  const configuredReadToken = env.ANALYTICS_READ_TOKEN?.trim();

  if (!configuredReadToken) {
    return jsonResponse(
      {
        enabled: true,
        error: 'ANALYTICS_READ_TOKEN is not configured.',
      },
      headers,
      503,
    );
  }

  if (getBearerToken(request) !== configuredReadToken) {
    return jsonResponse(
      {
        error: 'Unauthorized.',
      },
      headers,
      401,
    );
  }

  const url = new URL(request.url);
  const windowDays = getInteger(url.searchParams.get('days'), 30, 1, 365);
  const since = Date.now() - windowDays * 86_400_000;

  try {
    const analyticsColumns = await getAnalyticsTableColumns(analyticsDb);
    const totals = await analyticsDb
      .prepare(
        `
          SELECT
            COUNT(DISTINCT install_id) AS unique_users,
            COUNT(
              DISTINCT CASE
                WHEN event_type IN ('settings_opened', 'overlay_link_copied')
                THEN install_id
              END
            ) AS settings_users,
            COUNT(
              DISTINCT CASE
                WHEN event_type = 'overlay_loaded'
                THEN install_id
              END
            ) AS overlay_users,
            SUM(CASE WHEN event_type = 'settings_opened' THEN 1 ELSE 0 END) AS settings_views,
            SUM(CASE WHEN event_type = 'overlay_link_copied' THEN 1 ELSE 0 END) AS overlay_link_copies,
            SUM(CASE WHEN event_type = 'overlay_loaded' THEN 1 ELSE 0 END) AS overlay_loads
          FROM analytics_events
          WHERE recorded_at >= ?
        `,
      )
      .bind(since)
      .first<Record<string, unknown>>();
    const dailyResult = await analyticsDb
      .prepare(
        `
          SELECT
            strftime('%Y-%m-%d', recorded_at / 1000, 'unixepoch') AS day,
            COUNT(DISTINCT install_id) AS unique_users,
            SUM(CASE WHEN event_type = 'overlay_loaded' THEN 1 ELSE 0 END) AS overlay_loads,
            SUM(CASE WHEN event_type = 'overlay_link_copied' THEN 1 ELSE 0 END) AS overlay_link_copies
          FROM analytics_events
          WHERE recorded_at >= ?
          GROUP BY day
          ORDER BY day DESC
        `,
      )
      .bind(since)
      .all<Record<string, unknown>>();
    const pathResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'pathname',
      since,
    );
    const modeResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'mode',
      since,
    );
    const styleResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'style',
      since,
    );
    const layoutResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'layout',
      since,
    );
    const refreshResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'refresh_seconds',
      since,
    );
    const playoffsResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'playoffs_only',
      since,
    );
    const clockResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'show_clock',
      since,
    );
    const teamCountResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'team_count',
      since,
    );
    const teamsResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'teams_key',
      since,
    );
    const countryResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'country',
      since,
    );
    const regionResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'region',
      since,
    );
    const cityResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'city',
      since,
    );
    const timezoneResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'timezone',
      since,
    );
    const networkResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'as_organization',
      since,
    );
    const browserResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'browser_family',
      since,
    );
    const platformResult = await fetchOptionalAnalyticsBreakdown(
      analyticsDb,
      analyticsColumns,
      'platform',
      since,
    );

    return jsonResponse(
      {
        enabled: true,
        windowDays,
        totals: {
          overlayLoads: getCount(totals?.overlay_loads),
          overlayUsers: getCount(totals?.overlay_users),
          overlayLinkCopies: getCount(totals?.overlay_link_copies),
          settingsUsers: getCount(totals?.settings_users),
          settingsViews: getCount(totals?.settings_views),
          uniqueUsers: getCount(totals?.unique_users),
        },
        daily: (dailyResult.results ?? []).map((row) => ({
          day: typeof row.day === 'string' ? row.day : 'unknown',
          overlayLinkCopies: getCount(row.overlay_link_copies),
          overlayLoads: getCount(row.overlay_loads),
          uniqueUsers: getCount(row.unique_users),
        })),
        settings: {
          layout: layoutResult,
          mode: modeResult,
          paths: pathResult,
          playoffsOnly: playoffsResult,
          refreshSeconds: refreshResult,
          showClock: clockResult,
          style: styleResult,
          teamCount: teamCountResult,
          teams: teamsResult,
        },
        audience: {
          browsers: browserResult,
          cities: cityResult,
          countries: countryResult,
          networks: networkResult,
          platforms: platformResult,
          regions: regionResult,
          timezones: timezoneResult,
        },
      },
      headers,
    );
  } catch {
    return jsonResponse(
      {
        error: 'Analytics summary failed.',
      },
      headers,
      500,
    );
  }
}

async function ensureGlobeSchema(db: D1Database): Promise<void> {
  await db.batch([
    db.prepare(`
      CREATE TABLE IF NOT EXISTS globe_geocode_cache (
        query_key TEXT PRIMARY KEY,
        query TEXT NOT NULL,
        display_location TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        country TEXT,
        region TEXT,
        created_at INTEGER NOT NULL
      )
    `),
    db.prepare(`
      CREATE TABLE IF NOT EXISTS globe_checkins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL,
        viewer_key TEXT NOT NULL,
        viewer_name TEXT NOT NULL,
        location_query TEXT NOT NULL,
        display_location TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        country TEXT,
        region TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(session_id, viewer_key)
      )
    `),
    db.prepare(`
      CREATE INDEX IF NOT EXISTS idx_globe_checkins_session_updated
      ON globe_checkins(session_id, updated_at DESC)
    `),
  ]);
}

function normalizeGlobeInput(value: unknown, maxLength: number): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const normalized = value.trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeGlobeSessionId(value: unknown): string | null {
  const normalized = normalizeGlobeInput(value, 128);

  if (!normalized || !/^[A-Za-z0-9._:-]+$/.test(normalized)) {
    return null;
  }

  return normalized;
}

function normalizeGlobeCacheKey(query: string): string {
  return query.trim().replace(/\s+/g, ' ').toLowerCase();
}

function mapGlobeCheckInRow(row: Record<string, unknown>): GlobeCheckInRecord {
  return {
    id: String(row.id),
    sessionId: String(row.session_id),
    viewerName: String(row.viewer_name),
    locationQuery: String(row.location_query),
    displayLocation: String(row.display_location),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    country: typeof row.country === 'string' ? row.country : undefined,
    region: typeof row.region === 'string' ? row.region : undefined,
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  };
}

async function readCachedGlobeGeocode(
  db: D1Database,
  queryKey: string,
): Promise<GlobeGeocodeResult | null> {
  const row = await db
    .prepare(
      `
        SELECT display_location, latitude, longitude, country, region
        FROM globe_geocode_cache
        WHERE query_key = ?
      `,
    )
    .bind(queryKey)
    .first<Record<string, unknown>>();

  if (!row) {
    return null;
  }

  return {
    displayLocation: String(row.display_location),
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    country: typeof row.country === 'string' ? row.country : null,
    region: typeof row.region === 'string' ? row.region : null,
  };
}

async function resolveGlobeLocation(
  db: D1Database,
  locationQuery: string,
): Promise<GlobeGeocodeResult | null> {
  const queryKey = normalizeGlobeCacheKey(locationQuery);
  const cachedResult = await readCachedGlobeGeocode(db, queryKey);

  if (cachedResult) {
    return cachedResult;
  }

  const searchUrl = new URL('https://nominatim.openstreetmap.org/search');
  searchUrl.searchParams.set('format', 'jsonv2');
  searchUrl.searchParams.set('addressdetails', '1');
  searchUrl.searchParams.set('limit', '1');
  searchUrl.searchParams.set('q', locationQuery);

  const response = await fetch(searchUrl.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Language': 'en',
      'User-Agent': 'KeylightStreamTools/0.1 globe-checkin',
    },
  });

  if (!response.ok) {
    return null;
  }

  const results = (await response.json()) as NominatimSearchResult[];
  const result = Array.isArray(results) ? results[0] : null;
  const latitude = Number(result?.lat);
  const longitude = Number(result?.lon);

  if (!result?.display_name || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const address = result.address ?? {};
  const geocodeResult: GlobeGeocodeResult = {
    displayLocation: result.display_name.slice(0, 160),
    latitude,
    longitude,
    country: address.country?.slice(0, 80) ?? null,
    region:
      address.state?.slice(0, 80) ??
      address.province?.slice(0, 80) ??
      address.region?.slice(0, 80) ??
      address.county?.slice(0, 80) ??
      null,
  };

  await db
    .prepare(
      `
        INSERT OR REPLACE INTO globe_geocode_cache (
          query_key,
          query,
          display_location,
          latitude,
          longitude,
          country,
          region,
          created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `,
    )
    .bind(
      queryKey,
      locationQuery,
      geocodeResult.displayLocation,
      geocodeResult.latitude,
      geocodeResult.longitude,
      geocodeResult.country,
      geocodeResult.region,
      Date.now(),
    )
    .run();

  return geocodeResult;
}

async function fetchGlobeCheckIns(
  db: D1Database,
  sessionId: string,
): Promise<GlobeCheckInRecord[]> {
  const result = await db
    .prepare(
      `
        SELECT
          id,
          session_id,
          viewer_name,
          location_query,
          display_location,
          latitude,
          longitude,
          country,
          region,
          created_at,
          updated_at
        FROM globe_checkins
        WHERE session_id = ?
        ORDER BY updated_at DESC
        LIMIT 250
      `,
    )
    .bind(sessionId)
    .all<Record<string, unknown>>();

  return (result.results ?? []).map(mapGlobeCheckInRow);
}

async function handleGlobeCheckIns(
  request: Request,
  env: Env,
): Promise<Response> {
  const headers = buildGlobeCorsHeaders();
  const db = getAnalyticsDb(env);

  if (!db) {
    return jsonResponse({ error: 'D1 database is not configured.' }, headers, 503);
  }

  await ensureGlobeSchema(db);

  if (request.method === 'GET') {
    const url = new URL(request.url);
    const sessionId = normalizeGlobeSessionId(url.searchParams.get('session'));

    if (!sessionId) {
      return jsonResponse({ error: 'Missing or invalid session.' }, headers, 400);
    }

    return jsonResponse(
      { checkIns: await fetchGlobeCheckIns(db, sessionId) },
      headers,
    );
  }

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, headers, 405);
  }

  let payload: GlobeCheckInPayload;

  try {
    payload = (await request.json()) as GlobeCheckInPayload;
  } catch {
    return jsonResponse({ error: 'Invalid JSON payload.' }, headers, 400);
  }

  const sessionId = normalizeGlobeSessionId(payload.sessionId);
  const viewerName = normalizeGlobeInput(payload.viewerName, 48);
  const locationQuery = normalizeGlobeInput(payload.locationQuery, 120);

  if (!sessionId || !viewerName || !locationQuery) {
    return jsonResponse({ error: 'Invalid check-in payload.' }, headers, 400);
  }

  const geocodeResult = await resolveGlobeLocation(db, locationQuery);

  if (!geocodeResult) {
    return jsonResponse({ error: 'Location not found.' }, headers, 404);
  }

  const now = Date.now();
  const viewerKey = viewerName.toLowerCase();

  await db
    .prepare(
      `
        INSERT INTO globe_checkins (
          session_id,
          viewer_key,
          viewer_name,
          location_query,
          display_location,
          latitude,
          longitude,
          country,
          region,
          created_at,
          updated_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id, viewer_key) DO UPDATE SET
          viewer_name = excluded.viewer_name,
          location_query = excluded.location_query,
          display_location = excluded.display_location,
          latitude = excluded.latitude,
          longitude = excluded.longitude,
          country = excluded.country,
          region = excluded.region,
          updated_at = excluded.updated_at
      `,
    )
    .bind(
      sessionId,
      viewerKey,
      viewerName,
      locationQuery,
      geocodeResult.displayLocation,
      geocodeResult.latitude,
      geocodeResult.longitude,
      geocodeResult.country,
      geocodeResult.region,
      now,
      now,
    )
    .run();

  const checkIns = await fetchGlobeCheckIns(db, sessionId);
  const checkIn = checkIns.find(
    (record) => record.viewerName.toLowerCase() === viewerKey,
  );

  return jsonResponse({ checkIn: checkIn ?? null }, headers);
}

async function handleClearGlobeSession(
  request: Request,
  env: Env,
): Promise<Response> {
  const headers = buildGlobeCorsHeaders();

  if (request.method !== 'POST') {
    return jsonResponse({ error: 'Method not allowed.' }, headers, 405);
  }

  const db = getAnalyticsDb(env);

  if (!db) {
    return jsonResponse({ error: 'D1 database is not configured.' }, headers, 503);
  }

  const url = new URL(request.url);
  const sessionId = normalizeGlobeSessionId(
    decodeURIComponent(url.pathname.split('/').at(-2) ?? ''),
  );

  if (!sessionId) {
    return jsonResponse({ error: 'Missing or invalid session.' }, headers, 400);
  }

  await ensureGlobeSchema(db);
  await db
    .prepare('DELETE FROM globe_checkins WHERE session_id = ?')
    .bind(sessionId)
    .run();

  return jsonResponse({ ok: true }, headers);
}

async function proxyRequest(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  let pathname = url.pathname.replace(/^\/api/, '');

  if (pathname.startsWith('/soccer/')) {
    if (
      !pathname.startsWith('/soccer/score/') &&
      !pathname.startsWith('/soccer/schedule/')
    ) {
      return new Response(JSON.stringify({ error: 'Not found' }), {
        status: 404,
        headers: buildPublicCorsHeaders(),
      });
    }

    return buildSoccerProxyResponse(request, env, pathname);
  }

  if (pathname.startsWith('/nhl/')) {
    pathname = pathname.replace(/^\/nhl/, '');
  }

  if (!pathname.startsWith('/score/') && !pathname.startsWith('/schedule/')) {
    return new Response(JSON.stringify({ error: 'Not found' }), {
      status: 404,
      headers: buildPublicCorsHeaders(),
    });
  }

  const upstreamUrl = `${NHL_API_BASE}${pathname}${url.search}`;
  const cache = caches.default;
  const cacheKey = new Request(upstreamUrl, { method: 'GET' });
  const cached = await cache.match(cacheKey);

  if (cached) {
    return new Response(cached.body, {
      status: cached.status,
      headers: mergeProxyHeaders(cached, pathname),
    });
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    headers: {
      Accept: 'application/json',
    },
    cf: {
      cacheEverything: true,
      cacheTtl: buildCacheTtl(pathname),
    },
  });

  const proxiedResponse = new Response(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: mergeProxyHeaders(upstreamResponse, pathname),
  });

  if (upstreamResponse.ok) {
    await cache.put(cacheKey, proxiedResponse.clone());
  }

  return proxiedResponse;
}

async function handleTwitchStatus(request: Request, env: Env): Promise<Response> {
  const headers = buildAuthCorsHeaders(request, env);

  if (!isTwitchGateEnabled(env)) {
    return jsonResponse(
      {
        enabled: false,
        authenticated: false,
        entitled: false,
        login: null,
        userId: null,
        overlayToken: null,
      },
      headers,
    );
  }

  const session = await getSessionFromRequest(request, env);

  if (!session) {
    headers.append('Set-Cookie', clearCookie(SESSION_COOKIE_NAME));
  }

  return jsonResponse(
    {
      enabled: true,
      authenticated: !!session,
      entitled: !!session?.entitled,
      login: session?.login ?? null,
      userId: session?.sub ?? null,
      overlayToken:
        session?.entitled && env.TWITCH_SESSION_SECRET
          ? await createOverlayGrant(session, env.TWITCH_SESSION_SECRET)
          : null,
    },
    headers,
  );
}

async function handleTwitchVerify(request: Request, env: Env): Promise<Response> {
  const headers = buildAuthCorsHeaders(request, env);

  if (!isTwitchGateEnabled(env)) {
    return jsonResponse(
      {
        enabled: false,
        entitled: false,
        valid: false,
        userId: null,
      },
      headers,
    );
  }

  const token = new URL(request.url).searchParams.get('token');

  if (!token || !env.TWITCH_SESSION_SECRET) {
    return jsonResponse(
      {
        enabled: true,
        entitled: false,
        valid: false,
        userId: null,
      },
      headers,
    );
  }

  const grant = await verifySignedToken<TwitchGateGrant>(
    token,
    env.TWITCH_SESSION_SECRET,
  );

  if (!grant || grant.exp <= Date.now() || !grant.entitled) {
    return jsonResponse(
      {
        enabled: true,
        entitled: false,
        valid: false,
        userId: grant?.sub ?? null,
      },
      headers,
    );
  }

  return jsonResponse(
    {
      enabled: true,
      entitled: true,
      valid: true,
      userId: grant.sub,
    },
    headers,
  );
}

async function handleTwitchLogin(request: Request, env: Env): Promise<Response> {
  if (!isTwitchGateEnabled(env)) {
    return new Response('Twitch gate disabled', { status: 404 });
  }

  const missing = getMissingTwitchConfig(env);

  if (missing.length) {
    return new Response(
      `Missing Twitch gate config: ${missing.join(', ')}`,
      { status: 500 },
    );
  }

  const url = new URL(request.url);
  const statePayload = await createOAuthStatePayload(
    request,
    env,
    url.searchParams.get('return_to'),
  );

  const authorizeUrl = new URL(TWITCH_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', env.TWITCH_CLIENT_ID!);
  authorizeUrl.searchParams.set('redirect_uri', env.TWITCH_REDIRECT_URI!);
  authorizeUrl.searchParams.set('scope', 'user:read:follows');
  authorizeUrl.searchParams.set('force_verify', 'true');
  authorizeUrl.searchParams.set('state', statePayload.nonce);

  const response = new Response(null, {
    status: 302,
    headers: {
      Location: authorizeUrl.toString(),
    },
  });

  response.headers.append(
    'Set-Cookie',
    buildCookie(
      OAUTH_STATE_COOKIE_NAME,
      encodeBase64Url(JSON.stringify(statePayload)),
      600,
    ),
  );

  return response;
}

function appendAuthResult(target: string, result: string): string {
  const url = new URL(target);
  url.searchParams.set('twitch', result);
  return url.toString();
}

async function handleTwitchCallback(
  request: Request,
  env: Env,
): Promise<Response> {
  const cookies = parseCookies(request);
  const encodedStateCookie = cookies[OAUTH_STATE_COOKIE_NAME];
  const requestUrl = new URL(request.url);

  let statePayload: OAuthStatePayload | null = null;

  if (encodedStateCookie) {
    try {
      statePayload = JSON.parse(
        decodeBase64Url(encodedStateCookie),
      ) as OAuthStatePayload;
    } catch {
      statePayload = null;
    }
  }

  const returnTo = sanitizeReturnTo(
    request,
    env,
    statePayload?.returnTo ?? requestUrl.searchParams.get('return_to'),
  );

  const responseHeaders = new Headers({
    Location: appendAuthResult(returnTo, 'error'),
  });
  responseHeaders.append('Set-Cookie', clearCookie(OAUTH_STATE_COOKIE_NAME));

  if (!isTwitchGateEnabled(env)) {
    return new Response(null, {
      status: 302,
      headers: responseHeaders,
    });
  }

  const missing = getMissingTwitchConfig(env);

  if (missing.length) {
    return new Response(
      `Missing Twitch gate config: ${missing.join(', ')}`,
      { status: 500 },
    );
  }

  const state = requestUrl.searchParams.get('state');
  const code = requestUrl.searchParams.get('code');
  const authorizationError = requestUrl.searchParams.get('error');

  if (
    authorizationError ||
    !code ||
    !statePayload ||
    !state ||
    statePayload.nonce !== state
  ) {
    responseHeaders.set(
      'Location',
      appendAuthResult(returnTo, authorizationError ? 'denied' : 'invalid'),
    );

    return new Response(null, {
      status: 302,
      headers: responseHeaders,
    });
  }

  try {
    const tokenPayload = await exchangeCodeForToken(code, env);
    const validation = await validateTwitchToken(tokenPayload.access_token);
    const entitled = await checkTwitchFollow(
      tokenPayload.access_token,
      env.TWITCH_CLIENT_ID!,
      validation.user_id,
      env.TWITCH_BROADCASTER_ID!,
    );

    const session = {
      entitled,
      exp: Date.now() + getSessionTtlSeconds(env) * 1000,
      login: validation.login,
      sub: validation.user_id,
    } satisfies TwitchGateSession;

    const sessionToken = await createSignedToken(
      session,
      env.TWITCH_SESSION_SECRET!,
    );

    responseHeaders.append(
      'Set-Cookie',
      buildCookie(
        SESSION_COOKIE_NAME,
        sessionToken,
        getSessionTtlSeconds(env),
      ),
    );
    responseHeaders.set(
      'Location',
      appendAuthResult(returnTo, entitled ? 'connected' : 'not_following'),
    );

    return new Response(null, {
      status: 302,
      headers: responseHeaders,
    });
  } catch {
    return new Response(null, {
      status: 302,
      headers: responseHeaders,
    });
  }
}

function handleTwitchLogout(request: Request, env: Env): Response {
  const requestUrl = new URL(request.url);
  const returnTo = sanitizeReturnTo(
    request,
    env,
    requestUrl.searchParams.get('return_to'),
  );

  const headers = new Headers({
    Location: appendAuthResult(returnTo, 'signed_out'),
  });
  headers.append('Set-Cookie', clearCookie(SESSION_COOKIE_NAME));
  headers.append('Set-Cookie', clearCookie(OAUTH_STATE_COOKIE_NAME));

  return new Response(null, {
    status: 302,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      if (url.pathname.startsWith('/auth/twitch/')) {
        return new Response(null, {
          status: 204,
          headers: buildAuthCorsHeaders(request, env),
        });
      }

      if (url.pathname.startsWith('/api/analytics/')) {
        return new Response(null, {
          status: 204,
          headers: buildAnalyticsCorsHeaders(),
        });
      }

      if (url.pathname.startsWith('/api/globe/')) {
        return new Response(null, {
          status: 204,
          headers: buildGlobeCorsHeaders(),
        });
      }

      return new Response(null, {
        status: 204,
        headers: buildPublicCorsHeaders(),
      });
    }

    if (url.pathname === '/auth/twitch/status') {
      return handleTwitchStatus(request, env);
    }

    if (url.pathname === '/auth/twitch/login') {
      return handleTwitchLogin(request, env);
    }

    if (url.pathname === '/auth/twitch/callback') {
      return handleTwitchCallback(request, env);
    }

    if (url.pathname === '/auth/twitch/logout') {
      return handleTwitchLogout(request, env);
    }

    if (url.pathname === '/auth/twitch/verify') {
      return handleTwitchVerify(request, env);
    }

    if (url.pathname === '/api/analytics/events') {
      return handleAnalyticsEvent(request, env);
    }

    if (url.pathname === '/api/analytics/summary') {
      return handleAnalyticsSummary(request, env);
    }

    if (url.pathname === '/api/globe/checkins') {
      return handleGlobeCheckIns(request, env);
    }

    if (
      url.pathname.startsWith('/api/globe/sessions/') &&
      url.pathname.endsWith('/clear')
    ) {
      return handleClearGlobeSession(request, env);
    }

    return proxyRequest(request, env);
  },
};
