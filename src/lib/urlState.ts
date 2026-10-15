import { isOverlayStyle } from './overlayStyles';
import type { GoalAnimationStyle, OverlayConfig, Sport } from './types';

export const MIN_REFRESH_SECONDS = 10;
export const MAX_REFRESH_SECONDS = 60;

export const DEFAULT_CONFIG: OverlayConfig = {
  sport: 'nhl',
  mode: 'auto',
  style: 'broadcast',
  layout: 'compact',
  goalAnimation: 'logo-storm',
  teams: [],
  refreshSeconds: MIN_REFRESH_SECONDS,
  playoffsOnly: false,
  showClock: true,
  muted: false,
  showCredit: true,
};

export const SPORT_OPTIONS: Array<{ value: Sport; label: string }> = [
  { value: 'nhl', label: 'NHL' },
  { value: 'soccer', label: 'Soccer / Football' },
];

function parseBoolean(value: string | null, fallback: boolean): boolean {
  if (value === null) {
    return fallback;
  }

  return ['1', 'true', 'yes', 'on'].includes(value.toLowerCase());
}

function parseOptionalBoolean(value: string | null): boolean | undefined {
  if (value === null) {
    return undefined;
  }

  const normalized = value.toLowerCase();

  if (['1', 'true', 'yes', 'on'].includes(normalized)) {
    return true;
  }

  if (['0', 'false', 'no', 'off'].includes(normalized)) {
    return false;
  }

  return undefined;
}

function normalizeTeams(values: string[]): string[] {
  return Array.from(
    new Set(
      values
        .map((value) => value.trim().toUpperCase())
        .filter((value) => value && value !== 'AUTO'),
    ),
  );
}

function isGoalAnimationStyle(value: string): value is GoalAnimationStyle {
  return ['logo-storm', 'jumbotron', 'logo-rain'].includes(value);
}

function isSport(value: string | null): value is Sport {
  return value === 'nhl' || value === 'soccer';
}

function normalizeRefreshSeconds(value: string | null): number {
  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    return DEFAULT_CONFIG.refreshSeconds;
  }

  const rounded = Math.round(parsed);

  return Math.min(MAX_REFRESH_SECONDS, Math.max(MIN_REFRESH_SECONDS, rounded));
}

export function parseConfig(search: string): OverlayConfig {
  const params = new URLSearchParams(search);
  const sportParam = params.get('sport');
  const sport = isSport(sportParam) ? sportParam : DEFAULT_CONFIG.sport;
  const styleParam = params.get('style');
  const style =
    styleParam && isOverlayStyle(styleParam) ? styleParam : DEFAULT_CONFIG.style;
  const layout = params.get('layout') === 'stacked' ? 'stacked' : DEFAULT_CONFIG.layout;
  const goalAnimationParam = params.get('goalAnimation') ?? params.get('goal');
  const goalAnimation =
    goalAnimationParam && isGoalAnimationStyle(goalAnimationParam)
      ? goalAnimationParam
      : DEFAULT_CONFIG.goalAnimation;
  const teamsParam = params.get('teams');
  const legacyTeam = params.get('team');
  const gameIdRaw = params.get('gameId');
  const gameId = gameIdRaw ? Number(gameIdRaw) : undefined;
  const teams = teamsParam
    ? normalizeTeams(teamsParam.split(','))
    : legacyTeam
      ? normalizeTeams([legacyTeam])
      : DEFAULT_CONFIG.teams;
  const refreshSeconds = normalizeRefreshSeconds(params.get('refresh'));
  const mode = gameId ? 'manual' : 'auto';

  return {
    mode,
    sport,
    style,
    layout,
    goalAnimation,
    teams,
    gameId: Number.isFinite(gameId) ? gameId : undefined,
    refreshSeconds,
    playoffsOnly: parseBoolean(params.get('playoffs'), DEFAULT_CONFIG.playoffsOnly),
    showClock: parseBoolean(params.get('clock'), DEFAULT_CONFIG.showClock),
    muted: parseBoolean(params.get('mute'), DEFAULT_CONFIG.muted),
    showCredit: true,
    unlockToken: params.get('unlock') || undefined,
  };
}

/**
 * Parses only settings explicitly and validly supplied in a URL. This lets a
 * public saved profile provide defaults without changing legacy URL behavior.
 */
export function parseConfigOverrides(search: string): Partial<OverlayConfig> {
  const params = new URLSearchParams(search);
  const overrides: Partial<OverlayConfig> = {};
  const sport = params.get('sport');
  const style = params.get('style');
  const goalAnimation = params.get('goalAnimation') ?? params.get('goal');
  const teams = params.get('teams');
  const legacyTeam = params.get('team');
  const gameIdRaw = params.get('gameId');
  const refreshRaw = params.get('refresh');

  if (isSport(sport)) overrides.sport = sport;
  if (style && isOverlayStyle(style)) overrides.style = style;
  if (params.get('layout') === 'stacked' || params.get('layout') === 'compact') {
    overrides.layout = params.get('layout') as OverlayConfig['layout'];
  }
  if (goalAnimation && isGoalAnimationStyle(goalAnimation)) {
    overrides.goalAnimation = goalAnimation;
  }
  if (refreshRaw !== null && Number.isFinite(Number(refreshRaw))) {
    overrides.refreshSeconds = normalizeRefreshSeconds(refreshRaw);
  }

  const playoffsOnly = parseOptionalBoolean(params.get('playoffs'));
  const showClock = parseOptionalBoolean(params.get('clock'));
  const muted = parseOptionalBoolean(params.get('mute'));
  if (playoffsOnly !== undefined) overrides.playoffsOnly = playoffsOnly;
  if (showClock !== undefined) overrides.showClock = showClock;
  if (muted !== undefined) overrides.muted = muted;

  if (teams !== null || legacyTeam !== null) {
    overrides.teams = teams
      ? normalizeTeams(teams.split(','))
      : normalizeTeams([legacyTeam ?? '']);
    overrides.mode = 'auto';
    overrides.gameId = undefined;
  }

  if (gameIdRaw !== null) {
    const gameId = Number(gameIdRaw);
    if (Number.isFinite(gameId) && gameId > 0) {
      overrides.gameId = gameId;
      overrides.mode = 'manual';
    }
  }

  return overrides;
}

export function mergeConfigOverrides(
  base: OverlayConfig,
  overrides: Partial<OverlayConfig>,
): OverlayConfig {
  return {
    ...base,
    ...overrides,
    showCredit: true,
    unlockToken: undefined,
  };
}

export function buildOverlayUrl(config: OverlayConfig): string {
  const overlayUrl = new URL('./overlay.html', window.location.href);
  const refreshSeconds = normalizeRefreshSeconds(String(config.refreshSeconds));

  overlayUrl.searchParams.set('style', config.style);
  overlayUrl.searchParams.set('sport', config.sport);
  overlayUrl.searchParams.set('layout', config.layout);
  overlayUrl.searchParams.set('goalAnimation', config.goalAnimation);
  overlayUrl.searchParams.set('refresh', String(refreshSeconds));
  overlayUrl.searchParams.set('playoffs', config.playoffsOnly ? '1' : '0');
  overlayUrl.searchParams.set('clock', config.showClock ? '1' : '0');
  overlayUrl.searchParams.set('mute', config.muted ? '1' : '0');

  if (config.teams.length) {
    overlayUrl.searchParams.set('teams', config.teams.join(','));
  }

  if (config.gameId) {
    overlayUrl.searchParams.set('gameId', String(config.gameId));
  }

  return overlayUrl.toString();
}

export function buildLiveGoalOverlayUrl(config: OverlayConfig): string {
  const overlayUrl = new URL('./live-goal/overlay.html', window.location.href);
  const refreshSeconds = normalizeRefreshSeconds(String(config.refreshSeconds));

  overlayUrl.searchParams.set('style', config.style);
  overlayUrl.searchParams.set('sport', config.sport);
  overlayUrl.searchParams.set('layout', config.layout);
  overlayUrl.searchParams.set('goalAnimation', config.goalAnimation);
  overlayUrl.searchParams.set('refresh', String(refreshSeconds));
  overlayUrl.searchParams.set('playoffs', config.playoffsOnly ? '1' : '0');
  overlayUrl.searchParams.set('clock', config.showClock ? '1' : '0');
  overlayUrl.searchParams.set('mute', config.muted ? '1' : '0');

  if (config.teams.length) {
    overlayUrl.searchParams.set('teams', config.teams.join(','));
  }

  if (config.gameId) {
    overlayUrl.searchParams.set('gameId', String(config.gameId));
  }

  return overlayUrl.toString();
}
