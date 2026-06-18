import { isFinalGame, isLiveGame } from './gameSelection';
import type { NhlGame } from './types';

const UPCOMING_COUNTDOWN_WINDOW_MS = 24 * 60 * 60 * 1_000;

type UpcomingDetailMode = 'default' | 'schedule' | 'countdown';

function formatClockSeconds(totalSeconds: number): string {
  const minutes = Math.max(0, Math.floor(totalSeconds / 60));
  const seconds = Math.max(0, Math.floor(totalSeconds % 60));
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function formatSoccerClockLabel(clockText: string, offsetSeconds = 0): string {
  const normalized = clockText
    .trim()
    .replace(/[’′`]/g, "'")
    .replace(/\s+/g, '')
    .replace(/min(?:ute)?s?$/i, '');

  if (!normalized) {
    return '';
  }

  const timeMatch = normalized.match(/^(\d+):(\d{1,2})$/);

  if (timeMatch) {
    const totalSeconds =
      Number(timeMatch[1]) * 60 + Number(timeMatch[2]) + offsetSeconds;
    return formatClockSeconds(totalSeconds);
  }

  const stoppageMatch = normalized.match(/^(\d+)'?\+(\d+)'?$/);

  if (stoppageMatch) {
    const stoppageSeconds = Number(stoppageMatch[2]) * 60 + offsetSeconds;
    const stoppageMinutes = Math.floor(stoppageSeconds / 60);
    const seconds = Math.floor(stoppageSeconds % 60);
    return `${stoppageMatch[1]}+${stoppageMinutes}:${String(seconds).padStart(2, '0')}`;
  }

  const minuteMatch = normalized.match(/^(\d+)'?$/);

  if (minuteMatch) {
    return formatClockSeconds(Number(minuteMatch[1]) * 60 + offsetSeconds);
  }

  return clockText.toUpperCase();
}

function ordinal(value: number): string {
  if (value === 1) {
    return '1st';
  }

  if (value === 2) {
    return '2nd';
  }

  if (value === 3) {
    return '3rd';
  }

  return `${value}th`;
}

export function formatPeriodLabel(game: NhlGame): string {
  const descriptor = game.periodDescriptor;

  if (!descriptor) {
    return '';
  }

  if (game.sport === 'soccer') {
    if (descriptor.periodType === 'HALFTIME') {
      return 'HT';
    }

    if (descriptor.periodType === 'EXTRA_TIME') {
      return 'ET';
    }

    if (descriptor.periodType === 'PENALTY_SHOOTOUT') {
      return 'PK';
    }

    return descriptor.number === 1 ? '1H' : descriptor.number === 2 ? '2H' : '';
  }

  if (descriptor.periodType === 'SO') {
    return 'SO';
  }

  if (descriptor.periodType === 'OT') {
    return descriptor.number > 4 ? `${descriptor.number - 3}OT` : 'OT';
  }

  return ordinal(descriptor.number);
}

export function formatStartTime(isoTime: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(isoTime));
}

export function formatGameDate(isoTime: string): string {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
  }).format(new Date(isoTime));
}

export function formatGameLabel(game: NhlGame): string {
  const away = game.awayTeam.abbrev;
  const home = game.homeTeam.abbrev;
  const startTime = formatStartTime(game.startTimeUTC);

  return `${away} @ ${home} · ${startTime}`;
}

function formatPreviousResult(previousGame: NhlGame): string | null {
  const awayScore = previousGame.awayTeam.score;
  const homeScore = previousGame.homeTeam.score;

  if (awayScore === undefined || homeScore === undefined) {
    return null;
  }

  const gameDate = formatGameDate(previousGame.startTimeUTC);

  return `${gameDate} • ${previousGame.awayTeam.abbrev} ${awayScore}-${homeScore} ${previousGame.homeTeam.abbrev}`;
}

export function getUpcomingCountdownDetail(
  game: NhlGame,
  now = Date.now(),
): string | null {
  const startTimeMs = new Date(game.startTimeUTC).getTime();
  const diffMs = startTimeMs - now;

  if (diffMs <= 0 || diffMs >= UPCOMING_COUNTDOWN_WINDOW_MS) {
    return null;
  }

  const totalSeconds = Math.max(0, Math.floor(diffMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  return `In ${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function getStatusBadge(game: NhlGame): string {
  if (isLiveGame(game)) {
    const clock = game.clock;

    if (clock?.inIntermission) {
      return 'INT';
    }

    return 'LIVE';
  }

  if (isFinalGame(game)) {
    return 'FINAL';
  }

  return 'UP NEXT';
}

export function getStatusDetail(
  game: NhlGame,
  showClock: boolean,
  previousGame?: NhlGame | null,
  options: {
    liveClockOffsetSeconds?: number;
    now?: number;
    upcomingDetailMode?: UpcomingDetailMode;
  } = {},
): string {
  if (isLiveGame(game)) {
    const clock = game.clock;
    const period = formatPeriodLabel(game);
    const liveClockOffsetSeconds = Math.max(0, options.liveClockOffsetSeconds ?? 0);

    if (game.sport === 'soccer') {
      if (showClock && clock?.timeRemaining) {
        return formatSoccerClockLabel(clock.timeRemaining, liveClockOffsetSeconds);
      }

      if (showClock && typeof clock?.secondsRemaining === 'number') {
        return formatClockSeconds(clock.secondsRemaining + liveClockOffsetSeconds);
      }

      if (game.statusDetail) {
        return game.statusDetail.toUpperCase();
      }

      return period || 'IN PROGRESS';
    }

    if (clock?.inIntermission) {
      return period ? `${period} INTERMISSION` : 'INTERMISSION';
    }

    if (showClock && clock?.timeRemaining) {
      return period ? `${period} • ${clock.timeRemaining}` : clock.timeRemaining;
    }

    return period ? `${period} PERIOD` : 'IN PROGRESS';
  }

  if (isFinalGame(game)) {
    if (game.sport === 'soccer') {
      return game.statusDetail?.toUpperCase() ?? 'FULL TIME';
    }

    if (game.periodDescriptor?.periodType === 'OT') {
      return 'OVERTIME';
    }

    if (game.periodDescriptor?.periodType === 'SO') {
      return 'SHOOTOUT';
    }

    return 'REGULATION';
  }

  const upcomingDetailMode = options.upcomingDetailMode ?? 'default';
  const now = options.now ?? Date.now();

  if (upcomingDetailMode === 'countdown') {
    const countdownDetail = getUpcomingCountdownDetail(game, now);

    if (countdownDetail) {
      return countdownDetail;
    }
  }

  if (upcomingDetailMode === 'schedule') {
    return game.statusDetail ?? formatStartTime(game.startTimeUTC);
  }

  const previousResult = previousGame ? formatPreviousResult(previousGame) : null;

  if (previousResult) {
    return previousResult;
  }

  return game.statusDetail ?? formatStartTime(game.startTimeUTC);
}

export function getSeriesLine(game: NhlGame): string | null {
  const series = game.seriesStatus;

  if (!series) {
    return null;
  }

  const parts: string[] = [];

  if (series.seriesAbbrev) {
    parts.push(series.seriesAbbrev);
  }

  if (series.gameNumberOfSeries) {
    parts.push(`Game ${series.gameNumberOfSeries}`);
  }

  parts.push(
    `${series.topSeedTeamAbbrev} ${series.topSeedWins}-${series.bottomSeedWins} ${series.bottomSeedTeamAbbrev}`,
  );

  return parts.join(' • ');
}

export function getCompactSeriesState(game: NhlGame): string | null {
  const series = game.seriesStatus;

  if (!series) {
    return null;
  }

  if (series.topSeedWins === series.bottomSeedWins) {
    return `Series tied ${series.topSeedWins}-${series.bottomSeedWins}`;
  }

  if (series.topSeedWins > series.bottomSeedWins) {
    return `${series.topSeedTeamAbbrev} leads ${series.topSeedWins}-${series.bottomSeedWins}`;
  }

  return `${series.bottomSeedTeamAbbrev} leads ${series.bottomSeedWins}-${series.topSeedWins}`;
}
