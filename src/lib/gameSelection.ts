import type {
  DataSnapshot,
  NhlGame,
  OverlayConfig,
  ScheduleResponse,
  ScoreResponse,
} from './types';
import { MIN_REFRESH_SECONDS } from './urlState';

const LIVE_STATES = new Set(['LIVE', 'CRIT']);
const UPCOMING_STATES = new Set(['PRE', 'FUT']);
const FINAL_STATES = new Set(['FINAL', 'OFF']);
const MAX_MULTI_GAMES = 4;
const LIVE_STATE_PRIORITY: Record<string, number> = {
  CRIT: 2,
  LIVE: 1,
};

function mergeGame(baseGame: NhlGame, scoreGame?: NhlGame): NhlGame {
  if (!scoreGame) {
    return baseGame;
  }

  return {
    ...baseGame,
    ...scoreGame,
    awayTeam: {
      ...baseGame.awayTeam,
      ...scoreGame.awayTeam,
    },
    homeTeam: {
      ...baseGame.homeTeam,
      ...scoreGame.homeTeam,
    },
    periodDescriptor: scoreGame.periodDescriptor ?? baseGame.periodDescriptor,
    seriesStatus: scoreGame.seriesStatus ?? baseGame.seriesStatus,
    clock: scoreGame.clock ?? baseGame.clock,
  };
}

export function buildMergedGames(
  schedule: ScheduleResponse | null,
  score: ScoreResponse | null,
): NhlGame[] {
  if (!schedule) {
    return score?.games ?? [];
  }

  const scoreById = new Map((score?.games ?? []).map((game) => [game.id, game]));

  return schedule.gameWeek.flatMap((day) =>
    day.games.map((game) => mergeGame(game, scoreById.get(game.id))),
  );
}

export function getTeamMatch(game: NhlGame, team: string): boolean {
  return game.awayTeam.abbrev === team || game.homeTeam.abbrev === team;
}

export function isPlayoffGame(game: NhlGame): boolean {
  if (game.sport === 'soccer') {
    return false;
  }

  return game.gameType === 3;
}

export function isLiveGame(game: NhlGame): boolean {
  return LIVE_STATES.has(game.gameState);
}

export function isUpcomingGame(game: NhlGame): boolean {
  return UPCOMING_STATES.has(game.gameState);
}

export function isFinalGame(game: NhlGame): boolean {
  return FINAL_STATES.has(game.gameState);
}

function isSameMatchup(a: NhlGame, b: NhlGame): boolean {
  const aTeamIds = [a.awayTeam.id, a.homeTeam.id].sort((left, right) => left - right);
  const bTeamIds = [b.awayTeam.id, b.homeTeam.id].sort((left, right) => left - right);

  return aTeamIds[0] === bTeamIds[0] && aTeamIds[1] === bTeamIds[1];
}

function getStartMs(game: NhlGame): number {
  return new Date(game.startTimeUTC).getTime();
}

function compareAscending(a: NhlGame, b: NhlGame): number {
  return getStartMs(a) - getStartMs(b);
}

function compareDescending(a: NhlGame, b: NhlGame): number {
  return getStartMs(b) - getStartMs(a);
}

function getPeriodPriority(game: NhlGame): number {
  const descriptor = game.periodDescriptor;

  if (!descriptor) {
    return 0;
  }

  if (descriptor.periodType === 'SO') {
    return 100 + descriptor.number;
  }

  if (descriptor.periodType === 'OT') {
    return 80 + descriptor.number;
  }

  return descriptor.number;
}

function getGoalDiff(game: NhlGame): number {
  const awayScore = game.awayTeam.score;
  const homeScore = game.homeTeam.score;

  if (awayScore === undefined || homeScore === undefined) {
    return Number.MAX_SAFE_INTEGER;
  }

  return Math.abs(awayScore - homeScore);
}

function compareLivePriority(a: NhlGame, b: NhlGame): number {
  const statePriority =
    (LIVE_STATE_PRIORITY[b.gameState] ?? 0) - (LIVE_STATE_PRIORITY[a.gameState] ?? 0);

  if (statePriority !== 0) {
    return statePriority;
  }

  const periodPriority = getPeriodPriority(b) - getPeriodPriority(a);

  if (periodPriority !== 0) {
    return periodPriority;
  }

  const goalDiff = getGoalDiff(a) - getGoalDiff(b);

  if (goalDiff !== 0) {
    return goalDiff;
  }

  return compareAscending(a, b);
}

function getSelectedTeamPriority(game: NhlGame, teamPriority: Map<string, number>): number {
  const awayPriority = teamPriority.get(game.awayTeam.abbrev) ?? Number.MAX_SAFE_INTEGER;
  const homePriority = teamPriority.get(game.homeTeam.abbrev) ?? Number.MAX_SAFE_INTEGER;

  return Math.min(awayPriority, homePriority);
}

function compareSelectedTeamPriority(
  a: NhlGame,
  b: NhlGame,
  teamPriority: Map<string, number>,
): number {
  return getSelectedTeamPriority(a, teamPriority) - getSelectedTeamPriority(b, teamPriority);
}

function buildSelection(
  displayMode: DataSnapshot['displayMode'],
  selectedGames: NhlGame[],
): Pick<DataSnapshot, 'displayMode' | 'selectedGame' | 'selectedGames'> {
  return {
    displayMode,
    selectedGame: selectedGames[0] ?? null,
    selectedGames,
  };
}

export function buildGameSelection(
  config: OverlayConfig,
  games: NhlGame[],
  now = Date.now(),
): Pick<DataSnapshot, 'displayMode' | 'selectedGame' | 'selectedGames'> {
  const eligibleGames = games.filter((game) => {
    if (config.sport === 'nhl' && config.playoffsOnly && !isPlayoffGame(game)) {
      return false;
    }

    return true;
  });

  if (!eligibleGames.length) {
    return buildSelection('single', []);
  }

  if (config.gameId) {
    const selectedGame =
      eligibleGames.find((game) => game.id === config.gameId) ?? null;

    return buildSelection('single', selectedGame ? [selectedGame] : []);
  }

  const teamPriority = new Map(config.teams.map((team, index) => [team, index]));
  const selectedTeams = new Set(config.teams);
  const filteredGames =
    selectedTeams.size
      ? eligibleGames.filter(
          (game) =>
            selectedTeams.has(game.awayTeam.abbrev) ||
            selectedTeams.has(game.homeTeam.abbrev),
        )
      : eligibleGames;

  if (!filteredGames.length) {
    return buildSelection('single', []);
  }

  const comparePriority = (a: NhlGame, b: NhlGame) =>
    selectedTeams.size ? compareSelectedTeamPriority(a, b, teamPriority) : 0;

  const liveGames = filteredGames
    .filter(isLiveGame)
    .sort((a, b) => comparePriority(a, b) || compareLivePriority(a, b));

  if (liveGames.length > 1) {
    return buildSelection('multi', liveGames.slice(0, MAX_MULTI_GAMES));
  }

  if (liveGames.length) {
    return buildSelection('single', [liveGames[0]]);
  }

  const upcomingGames = filteredGames
    .filter((game) => isUpcomingGame(game) || getStartMs(game) >= now)
    .sort((a, b) => comparePriority(a, b) || compareAscending(a, b));

  if (upcomingGames.length) {
    return buildSelection('single', [upcomingGames[0]]);
  }

  const finalGames = filteredGames
    .filter(isFinalGame)
    .sort((a, b) => comparePriority(a, b) || compareDescending(a, b));

  if (finalGames.length) {
    return buildSelection('single', [finalGames[0]]);
  }

  return buildSelection(
    'single',
    filteredGames.sort((a, b) => comparePriority(a, b) || compareAscending(a, b)).slice(0, 1),
  );
}

export function selectGame(
  config: OverlayConfig,
  games: NhlGame[],
  now = Date.now(),
): NhlGame | null {
  return buildGameSelection(config, games, now).selectedGame;
}

export function getRefreshInterval(refreshSeconds: number): number {
  return Math.max(MIN_REFRESH_SECONDS, refreshSeconds) * 1_000;
}

export function findPreviousFinalGame(
  game: NhlGame | null,
  games: NhlGame[],
): NhlGame | null {
  if (!game) {
    return null;
  }

  return (
    games
      .filter(
        (candidate) =>
          candidate.id !== game.id &&
          isFinalGame(candidate) &&
          isSameMatchup(candidate, game) &&
          getStartMs(candidate) < getStartMs(game),
      )
      .sort(compareDescending)[0] ?? null
  );
}
