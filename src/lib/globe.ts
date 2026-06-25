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
  rotationSpeed: 0.14,
  showLabels: true,
  transparent: true,
};

const MIN_ROTATION_SPEED = 0;
const MAX_ROTATION_SPEED = 0.6;

function clampNumber(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) {
    return minimum;
  }

  return Math.min(maximum, Math.max(minimum, value));
}

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

export function parseGlobeConfig(search: string): GlobeConfig {
  const params = new URLSearchParams(search);
  const rotationSpeed = clampNumber(
    Number(params.get('speed') ?? DEFAULT_GLOBE_CONFIG.rotationSpeed),
    MIN_ROTATION_SPEED,
    MAX_ROTATION_SPEED,
  );

  return {
    animateCheckIns: parseBoolean(
      params.get('animations'),
      DEFAULT_GLOBE_CONFIG.animateCheckIns,
    ),
    channel: normalizeTwitchChannel(params.get('channel') ?? ''),
    sessionId: params.get('session')?.trim() || createGlobeSessionId(),
    rotationSpeed,
    showLabels: parseBoolean(params.get('labels'), DEFAULT_GLOBE_CONFIG.showLabels),
    transparent: parseBoolean(
      params.get('transparent'),
      DEFAULT_GLOBE_CONFIG.transparent,
    ),
  };
}

export function buildGlobeOverlayUrl(config: GlobeConfig): string {
  const overlayUrl = new URL('./overlay.html', window.location.href);

  overlayUrl.searchParams.set('session', config.sessionId);
  overlayUrl.searchParams.set('animations', config.animateCheckIns ? '1' : '0');
  overlayUrl.searchParams.set('speed', config.rotationSpeed.toFixed(2));
  overlayUrl.searchParams.set('labels', config.showLabels ? '1' : '0');
  overlayUrl.searchParams.set('transparent', config.transparent ? '1' : '0');

  if (config.channel) {
    overlayUrl.searchParams.set('channel', normalizeTwitchChannel(config.channel));
  }

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
