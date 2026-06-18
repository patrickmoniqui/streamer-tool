import { getApiBaseUrl } from './config';
import type { OverlayConfig } from './types';
import { buildLiveGoalOverlayUrl, buildOverlayUrl } from './urlState';

const INSTALL_ID_STORAGE_KEY = 'sport-live-feed-install-id';

export type AnalyticsEventType =
  | 'settings_opened'
  | 'overlay_link_copied'
  | 'overlay_loaded'
  | 'live_goal_overlay_loaded';

interface AnalyticsEventPayload {
  appVersion: string;
  buildNumber: string | null;
  eventType: AnalyticsEventType;
  installId: string;
  pathname: string;
  settings: {
    hasUnlock: boolean;
    goalAnimation: OverlayConfig['goalAnimation'];
    layout: OverlayConfig['layout'];
    mode: OverlayConfig['mode'];
    muted: boolean;
    playoffsOnly: boolean;
    refreshSeconds: number;
    showClock: boolean;
    sport: OverlayConfig['sport'];
    style: OverlayConfig['style'];
    teamCount: number;
    teamsKey: string;
  };
}

interface TrackAnalyticsEventOptions {
  installId?: string | null;
  pathname?: string;
  search?: string;
}

function getLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function createInstallId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `install-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function getTeamsKey(config: OverlayConfig): string {
  if (!config.teams.length) {
    return 'AUTO';
  }

  return [...config.teams].sort().join(',');
}

function buildEventPayload(
  eventType: AnalyticsEventType,
  config: OverlayConfig,
  installId: string,
  pathname: string,
): AnalyticsEventPayload {
  return {
    appVersion: __APP_VERSION__,
    buildNumber: __APP_BUILD_NUMBER__ || null,
    eventType,
    installId,
    pathname,
    settings: {
      hasUnlock: Boolean(config.unlockToken),
      goalAnimation: config.goalAnimation,
      layout: config.layout,
      mode: config.mode,
      muted: config.muted,
      playoffsOnly: config.playoffsOnly,
      refreshSeconds: config.refreshSeconds,
      showClock: config.showClock,
      sport: config.sport,
      style: config.style,
      teamCount: config.teams.length,
      teamsKey: getTeamsKey(config),
    },
  };
}

export function getAnalyticsInstallId(): string {
  const storage = getLocalStorage();
  const existing = storage?.getItem(INSTALL_ID_STORAGE_KEY)?.trim();

  if (existing) {
    return existing;
  }

  const nextInstallId = createInstallId();
  storage?.setItem(INSTALL_ID_STORAGE_KEY, nextInstallId);
  return nextInstallId;
}

export function getInstallIdFromSearch(
  search = window.location.search,
): string | null {
  const installId = new URLSearchParams(search).get('install')?.trim();
  return installId || null;
}

export function buildTrackedOverlayUrl(
  config: OverlayConfig,
  installId = getAnalyticsInstallId(),
): string {
  const overlayUrl = new URL(buildOverlayUrl(config));
  overlayUrl.searchParams.set('install', installId);
  return overlayUrl.toString();
}

export function buildTrackedLiveGoalOverlayUrl(
  config: OverlayConfig,
  installId = getAnalyticsInstallId(),
): string {
  const overlayUrl = new URL(buildLiveGoalOverlayUrl(config));
  overlayUrl.searchParams.set('install', installId);
  return overlayUrl.toString();
}

export async function trackAnalyticsEvent(
  eventType: AnalyticsEventType,
  config: OverlayConfig,
  options: TrackAnalyticsEventOptions = {},
): Promise<void> {
  const installId =
    options.installId?.trim() ||
    getInstallIdFromSearch(options.search) ||
    getAnalyticsInstallId();

  const payload = buildEventPayload(
    eventType,
    config,
    installId,
    options.pathname ?? window.location.pathname,
  );

  try {
    await fetch(`${getApiBaseUrl()}/analytics/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Analytics are intentionally best-effort and should never block the app.
  }
}
