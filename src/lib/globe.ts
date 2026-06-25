import { getApiBaseUrl } from './config';

export interface GlobeConfig {
  animateCheckIns: boolean;
  channel: string;
  sessionId: string;
  rotationSpeed: number;
  showLabels: boolean;
  transparent: boolean;
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
  channel: '',
  sessionId: '',
  rotationSpeed: 1 / 15,
  showLabels: true,
  transparent: true,
};

const ROTATIONS_PER_SECOND_PER_SPEED_UNIT = 0.5;

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
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

export function parseGlobeConfig(search: string): GlobeConfig {
  const params = new URLSearchParams(search);
  const channel = normalizeTwitchChannel(params.get('channel') ?? '');

  return {
    animateCheckIns: parseBoolean(
      params.get('animations'),
      DEFAULT_GLOBE_CONFIG.animateCheckIns,
    ),
    channel,
    sessionId: getGlobeSessionId(channel, params.get('session')?.trim()),
    rotationSpeed: DEFAULT_GLOBE_CONFIG.rotationSpeed,
    showLabels: parseBoolean(params.get('labels'), DEFAULT_GLOBE_CONFIG.showLabels),
    transparent: parseBoolean(
      params.get('transparent'),
      DEFAULT_GLOBE_CONFIG.transparent,
    ),
  };
}

export function buildGlobeOverlayUrl(config: GlobeConfig): string {
  const channel = normalizeTwitchChannel(config.channel);
  const sessionId = getGlobeSessionId(channel, config.sessionId);
  const overlayUrl = channel
    ? new URL(`./${encodeURIComponent(channel)}`, window.location.href)
    : new URL('./overlay.html', window.location.href);

  if (!channel) {
    overlayUrl.searchParams.set('session', sessionId);
  }

  overlayUrl.searchParams.set('animations', config.animateCheckIns ? '1' : '0');
  overlayUrl.searchParams.set('labels', config.showLabels ? '1' : '0');
  overlayUrl.searchParams.set('transparent', config.transparent ? '1' : '0');

  return overlayUrl.toString();
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
