import { getApiBaseUrl } from './config';
import type { ScheduleResponse, ScoreResponse, Sport } from './types';

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Request failed with status ${status}`);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function fetchJson<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${getApiBaseUrl()}${path}`, {
    signal,
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    throw new ApiError(response.status);
  }

  return response.json() as Promise<T>;
}

function buildSportPath(sport: Sport, path: string): string {
  return sport === 'nhl' ? path : `/${sport}${path}`;
}

export function fetchScheduleNow(
  sport: Sport,
  signal?: AbortSignal,
): Promise<ScheduleResponse> {
  return fetchJson<ScheduleResponse>(buildSportPath(sport, '/schedule/now'), signal);
}

export function fetchScoreNow(
  sport: Sport,
  signal?: AbortSignal,
): Promise<ScoreResponse> {
  return fetchJson<ScoreResponse>(buildSportPath(sport, '/score/now'), signal);
}

export function fetchScoreByDate(
  sport: Sport,
  date: string,
  signal?: AbortSignal,
): Promise<ScoreResponse> {
  return fetchJson<ScoreResponse>(buildSportPath(sport, `/score/${date}`), signal);
}
