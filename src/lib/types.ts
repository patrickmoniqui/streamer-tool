export type AppMode = 'auto' | 'manual';
export type Sport = 'nhl' | 'soccer';
export type OverlayStyle = 'broadcast' | 'classic' | 'minimal' | 'arena';
export type OverlayLayout = 'stacked' | 'compact';
export type GoalAnimationStyle = 'logo-storm' | 'jumbotron' | 'logo-rain';
export type SelectionDisplayMode = 'single' | 'multi';

export type TeamChoice = string;

export interface OverlayConfig {
  sport: Sport;
  mode: AppMode;
  style: OverlayStyle;
  layout: OverlayLayout;
  goalAnimation: GoalAnimationStyle;
  teams: TeamChoice[];
  gameId?: number;
  refreshSeconds: number;
  playoffsOnly: boolean;
  showClock: boolean;
  muted: boolean;
  showCredit: boolean;
  unlockToken?: string;
}

export interface NamedValue {
  default: string;
}

export interface ClockState {
  timeRemaining: string;
  secondsRemaining: number;
  running: boolean;
  inIntermission: boolean;
}

export interface PeriodDescriptor {
  number: number;
  periodType: string;
  maxRegulationPeriods?: number;
}

export interface SeriesStatus {
  round?: number;
  seriesAbbrev?: string;
  seriesTitle?: string;
  topSeedTeamAbbrev: string;
  topSeedWins: number;
  bottomSeedTeamAbbrev: string;
  bottomSeedWins: number;
  gameNumberOfSeries?: number;
}

export interface TeamRecord {
  id: number;
  abbrev: string;
  score?: number;
  commonName?: NamedValue;
  placeName?: NamedValue;
  logo?: string;
  darkLogo?: string;
}

export interface NhlGame {
  id: number;
  sport?: Sport;
  leagueName?: string;
  statusDetail?: string;
  season: number;
  gameType: number;
  gameState: string;
  gameScheduleState?: string;
  gameDate?: string;
  startTimeUTC: string;
  venueTimezone?: string;
  awayTeam: TeamRecord;
  homeTeam: TeamRecord;
  clock?: ClockState | null;
  periodDescriptor?: PeriodDescriptor;
  seriesStatus?: SeriesStatus;
}

export interface ScheduleDay {
  date: string;
  dayAbbrev: string;
  numberOfGames: number;
  games: NhlGame[];
}

export interface ScheduleResponse {
  previousStartDate?: string;
  nextStartDate?: string;
  gameWeek: ScheduleDay[];
}

export interface ScoreResponse {
  currentDate: string;
  prevDate?: string;
  nextDate?: string;
  games: NhlGame[];
}

export interface DataSnapshot {
  games: NhlGame[];
  displayMode: SelectionDisplayMode;
  selectedGame: NhlGame | null;
  selectedGames: NhlGame[];
  schedule: ScheduleResponse | null;
  score: ScoreResponse | null;
}
