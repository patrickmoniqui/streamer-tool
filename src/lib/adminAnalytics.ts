import { getApiBaseUrl } from './config';

const ADMIN_TOKEN_STORAGE_KEY = 'sport-live-feed-admin-token';

export interface AnalyticsBreakdownEntry {
  count: number;
  value: string;
}

export interface AnalyticsTotals {
  overlayLinkCopies: number;
  overlayLoads: number;
  overlayUsers: number;
  settingsUsers: number;
  settingsViews: number;
  uniqueUsers: number;
}

export interface AnalyticsDailyEntry {
  day: string;
  overlayLinkCopies: number;
  overlayLoads: number;
  uniqueUsers: number;
}

export interface AnalyticsSettingsSummary {
  layout: AnalyticsBreakdownEntry[];
  mode: AnalyticsBreakdownEntry[];
  paths: AnalyticsBreakdownEntry[];
  playoffsOnly: AnalyticsBreakdownEntry[];
  refreshSeconds: AnalyticsBreakdownEntry[];
  showClock: AnalyticsBreakdownEntry[];
  style: AnalyticsBreakdownEntry[];
  teamCount: AnalyticsBreakdownEntry[];
  teams: AnalyticsBreakdownEntry[];
}

export interface AnalyticsAudienceSummary {
  browsers: AnalyticsBreakdownEntry[];
  cities: AnalyticsBreakdownEntry[];
  countries: AnalyticsBreakdownEntry[];
  networks: AnalyticsBreakdownEntry[];
  platforms: AnalyticsBreakdownEntry[];
  regions: AnalyticsBreakdownEntry[];
  timezones: AnalyticsBreakdownEntry[];
}

export interface AnalyticsSummary {
  audience: AnalyticsAudienceSummary;
  enabled: boolean;
  windowDays: number;
  totals: AnalyticsTotals;
  daily: AnalyticsDailyEntry[];
  settings: AnalyticsSettingsSummary;
}

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getStoredAdminToken(): string {
  return getStorage()?.getItem(ADMIN_TOKEN_STORAGE_KEY)?.trim() ?? '';
}

export function storeAdminToken(token: string): void {
  const storage = getStorage();

  if (!storage) {
    return;
  }

  const normalizedToken = token.trim();

  if (!normalizedToken) {
    storage.removeItem(ADMIN_TOKEN_STORAGE_KEY);
    return;
  }

  storage.setItem(ADMIN_TOKEN_STORAGE_KEY, normalizedToken);
}

export function getAnalyticsSummaryUrl(days: number): string {
  const url = new URL(`${getApiBaseUrl()}/analytics/summary`, window.location.origin);
  url.searchParams.set('days', String(days));
  return url.toString();
}

export async function fetchAnalyticsSummary(
  token: string,
  days: number,
  signal?: AbortSignal,
): Promise<AnalyticsSummary> {
  const url = new URL(getAnalyticsSummaryUrl(days));

  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.trim()}`,
      Accept: 'application/json',
    },
    signal,
  });

  if (!response.ok) {
    if (response.status === 401) {
      throw new Error('Unauthorized. Check the analytics read token.');
    }

    if (response.status === 503) {
      throw new Error('Analytics are not configured on the Worker yet.');
    }

    throw new Error(`Analytics request failed with ${response.status}.`);
  }

  return response.json() as Promise<AnalyticsSummary>;
}
