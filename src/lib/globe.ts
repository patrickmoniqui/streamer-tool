import { getApiBaseUrl } from './config';

export interface GlobeConfig {
  animateCheckIns: boolean;
  zoomAnimation: boolean;
  channel: string;
  sessionId: string;
  rotationSpeed: number;
  showLabels: boolean;
  transparent: boolean;
  globeColor: string;
}

export interface GlobeCheckIn {
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

export const DEFAULT_GLOBE_CONFIG: GlobeConfig = {
  animateCheckIns: false,
  zoomAnimation: false,
  channel: '',
  sessionId: '',
  rotationSpeed: 1 / 15,
  showLabels: true,
  transparent: true,
  globeColor: '#8fdcff',
};

const ROTATIONS_PER_SECOND_PER_SPEED_UNIT = 0.5;

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function normalizeGlobeColor(value: string | null | undefined, fallback: string): string {
  const normalized = value?.trim() ?? '';

  if (!normalized) {
    return fallback;
  }

  const hexColor = normalized.startsWith('#') ? normalized : '#' + normalized;
  return /^#[0-9a-fA-F]{6}$/.test(hexColor) ? hexColor.toLowerCase() : fallback;
}

export function createGlobeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `globe-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function normalizeTwitchChannel(channel: string): string {
  return channel.trim().replace(/^#/, '').toLowerCase();
}

export function getGlobeRotationsPerSecond(rotationSpeed: number): number {
  return rotationSpeed * ROTATIONS_PER_SECOND_PER_SPEED_UNIT;
}

export function getGlobeSessionId(
  channel: string,
  fallbackSessionId = '',
): string {
  return normalizeTwitchChannel(channel) || fallbackSessionId || createGlobeSessionId();
}

export function parseGlobeConfig(search: string, profileChannel = ''): GlobeConfig {
  const params = new URLSearchParams(search);
  const channel = normalizeTwitchChannel(profileChannel || params.get('channel') || '');

  return {
    animateCheckIns: parseBoolean(
      params.get('animations'),
      DEFAULT_GLOBE_CONFIG.animateCheckIns,
    ),
    channel,
    zoomAnimation: parseBoolean(params.get('zoom'), DEFAULT_GLOBE_CONFIG.zoomAnimation),
    sessionId: getGlobeSessionId(channel, params.get('session')?.trim()),
    rotationSpeed: DEFAULT_GLOBE_CONFIG.rotationSpeed,
    showLabels: parseBoolean(params.get('labels'), DEFAULT_GLOBE_CONFIG.showLabels),
    transparent: parseBoolean(
      params.get('transparent'),
      DEFAULT_GLOBE_CONFIG.transparent,
    ),
    globeColor: normalizeGlobeColor(
      params.get('color'),
      DEFAULT_GLOBE_CONFIG.globeColor,
    ),
  };
}

export function buildGlobeOverlayUrl(config: GlobeConfig): string {
  const channel = normalizeTwitchChannel(config.channel);
  if (!/^[a-z0-9_]+$/.test(channel)) {
    return '';
  }
  const settingsUrl = new URL(window.location.href);

  // Treat the extensionless settings route as a directory, even without a trailing slash.
  if (!settingsUrl.pathname.endsWith('/') && !settingsUrl.pathname.endsWith('.html')) {
    settingsUrl.pathname += '/';
  }

  return new URL(`./${encodeURIComponent(channel)}`, settingsUrl).toString();
}

export function getGlobeProfileChannel(pathname: string, hash = ''): string {
  const pathChannel = pathname.match(/\/globe\/([A-Za-z0-9_]+)\/?$/)?.[1];
  const channel = normalizeTwitchChannel(pathChannel || new URLSearchParams(hash.slice(1)).get('channel') || '');
  return /^[a-z0-9_]+$/.test(channel) ? channel : '';
}

export function applyGlobeProfileConfig(config: GlobeConfig, search = ''): GlobeConfig {
  const params = new URLSearchParams(search);
  const overrides = parseGlobeConfig(search, config.channel);
  return {
    ...config,
    sessionId: config.channel,
    rotationSpeed: DEFAULT_GLOBE_CONFIG.rotationSpeed,
    animateCheckIns: params.has('animations') ? overrides.animateCheckIns : config.animateCheckIns,
    zoomAnimation: params.has('zoom') ? overrides.zoomAnimation : config.zoomAnimation ?? false,
    showLabels: params.has('labels') ? overrides.showLabels : config.showLabels,
    transparent: params.has('transparent') ? overrides.transparent : config.transparent,
    globeColor: params.has('color') ? overrides.globeColor : config.globeColor,
  };
}

export async function fetchGlobeProfile(channel: string, signal?: AbortSignal): Promise<GlobeConfig | null> {
  const response = await fetch(`${getApiBaseUrl()}/globe/profiles/${encodeURIComponent(channel)}`, {
    signal, cache: 'no-store',
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Unable to load saved globe settings.');
  const payload = await response.json() as { config: GlobeConfig };
  return payload.config;
}

export function watchGlobeProfile(channel: string, onConfig: (config: GlobeConfig) => void): () => void {
  const controller = new AbortController();
  let inFlight = false;
  async function refresh() {
    if (inFlight || controller.signal.aborted) return;
    inFlight = true;
    try {
      const saved = await fetchGlobeProfile(channel, controller.signal);
      if (saved && !controller.signal.aborted) onConfig(saved);
    } catch {
      // Keep the last working settings and retry on the next interval.
    } finally {
      inFlight = false;
    }
  }
  void refresh();
  const interval = window.setInterval(refresh, 5_000);
  return () => { controller.abort(); window.clearInterval(interval); };
}

export async function saveGlobeProfile(config: GlobeConfig, accessToken: string): Promise<GlobeConfig> {
  const response = await fetch(`${getApiBaseUrl()}/globe/profiles/${encodeURIComponent(config.channel)}`, {
    method: 'PUT',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    body: JSON.stringify({ config }),
  });
  if (response.status === 401 || response.status === 403) {
    throw new Error('Reconnect with Twitch before saving your globe settings.');
  }
  if (!response.ok) throw new Error('Unable to save globe settings. Please try again.');
  const payload = await response.json() as { config: GlobeConfig };
  return payload.config;
}

export async function fetchGlobeCheckIns(
  sessionId: string,
  signal?: AbortSignal,
): Promise<GlobeCheckIn[]> {
  const params = new URLSearchParams({ session: sessionId });
  const response = await fetch(`${getApiBaseUrl()}/globe/checkins?${params}`, {
    headers: {
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    throw new Error(`Unable to load globe check-ins (${response.status}).`);
  }

  const payload = (await response.json()) as { checkIns?: GlobeCheckIn[] };
  return Array.isArray(payload.checkIns) ? payload.checkIns : [];
}

export async function submitGlobeCheckIn(
  sessionId: string,
  viewerName: string,
  locationQuery: string,
): Promise<GlobeCheckIn | null> {
  const response = await fetch(`${getApiBaseUrl()}/globe/checkins`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      viewerName,
      locationQuery,
    }),
  });

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Unable to save globe check-in (${response.status}).`);
  }

  const payload = (await response.json()) as { checkIn?: GlobeCheckIn };
  return payload.checkIn ?? null;
}

export async function removeGlobeCheckIn(
  sessionId: string,
  viewerName: string,
): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/globe/checkins`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sessionId,
      viewerName,
    }),
  });

  if (!response.ok) {
    throw new Error(`Unable to remove globe check-in (${response.status}).`);
  }
}

export async function clearGlobeSession(sessionId: string): Promise<void> {
  const response = await fetch(
    `${getApiBaseUrl()}/globe/sessions/${encodeURIComponent(sessionId)}/clear`,
    {
      method: 'POST',
    },
  );

  if (!response.ok) {
    throw new Error(`Unable to clear globe session (${response.status}).`);
  }
}
