import { getApiBaseUrl } from './config';
import type { OverlayConfig } from './types';

export interface GameScoreProfile {
  profileId: string;
  config: OverlayConfig;
  updatedAt: number;
}

async function profileResponse(response: Response): Promise<GameScoreProfile | null> {
  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    throw new Error(`Profile request failed with ${response.status}`);
  }

  return response.json() as Promise<GameScoreProfile>;
}

export async function fetchMyGameScoreProfile(
  signal?: AbortSignal,
): Promise<GameScoreProfile | null> {
  return profileResponse(
    await fetch(`${getApiBaseUrl()}/me/game-score-profile`, {
      credentials: 'include',
      signal,
    }),
  );
}

export async function saveMyGameScoreProfile(
  config: OverlayConfig,
): Promise<GameScoreProfile> {
  const response = await fetch(`${getApiBaseUrl()}/me/game-score-profile`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ config }),
  });
  const profile = await profileResponse(response);

  if (!profile) {
    throw new Error('Unable to save profile.');
  }

  return profile;
}

export async function fetchPublicGameScoreProfile(
  profileId: string,
  signal?: AbortSignal,
): Promise<GameScoreProfile> {
  const response = await fetch(
    `${getApiBaseUrl()}/game-score-profiles/${encodeURIComponent(profileId)}`,
    { signal },
  );

  if (response.status === 404) {
    throw new Error('This saved overlay profile was not found.');
  }

  if (!response.ok) {
    throw new Error('Unable to load this saved overlay profile.');
  }

  return response.json() as Promise<GameScoreProfile>;
}

export function buildPersistentOverlayUrl(profileId: string): string {
  const overlayUrl = new URL('./overlay.html', window.location.href);
  overlayUrl.searchParams.set('profile', profileId);
  return overlayUrl.toString();
}
