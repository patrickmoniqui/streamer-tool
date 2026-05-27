import { useEffect, useState } from 'react';
import {
  CREDIT_LABEL,
  CREDIT_NAME,
} from '../lib/credit';
import {
  getCompactSeriesState,
  getUpcomingCountdownDetail,
  getSeriesLine,
  getStatusBadge,
  getStatusDetail,
} from '../lib/format';
import { isFinalGame, isLiveGame, isUpcomingGame } from '../lib/gameSelection';
import { useCreditReveal } from '../lib/useCreditReveal';
import { GoalFlash, type GoalFlashState } from './GoalFlash';
import { GOAL_FLASH_DURATION_MS, useGoalFlash, useGoalHorn } from '../lib/useGoalEffects';
import type {
  GoalAnimationStyle,
  NhlGame,
  OverlayLayout,
  OverlayStyle,
  TeamRecord,
} from '../lib/types';

interface ScoreboardCardProps {
  game: NhlGame | null;
  previousGame?: NhlGame | null;
  showClock: boolean;
  muted: boolean;
  style: OverlayStyle;
  layout: OverlayLayout;
  goalAnimation: GoalAnimationStyle;
  showCredit: boolean;
  debugGoalFlash?: {
    key: number;
    alignment: 'away' | 'home';
  } | null;
  className?: string;
  emptyLabel?: string;
}

const UPCOMING_DETAIL_ROTATION_MS = 10_000;
const UPCOMING_COUNTDOWN_ROTATION_MS = 30_000;

function getTeamName(team: TeamRecord): string {
  return (team.commonName?.default ?? team.abbrev).toUpperCase();
}

function getTeamLocation(team: TeamRecord): string {
  return team.placeName?.default.toUpperCase() ?? '';
}

function getTeamLogo(team: TeamRecord): string | undefined {
  return team.logo ?? team.darkLogo;
}

function getStatusTone(game: NhlGame): string {
  if (isLiveGame(game)) {
    return game.clock?.inIntermission ? 'intermission' : 'live';
  }

  if (isFinalGame(game)) {
    return 'final';
  }

  return 'upcoming';
}

function TeamRow({
  team,
  score,
  alignment,
}: {
  team: TeamRecord;
  score: number;
  alignment: 'away' | 'home';
}) {
  const logo = getTeamLogo(team);
  const location = getTeamLocation(team);
  const name = getTeamName(team);

  return (
    <div className={`scorebug-row scorebug-row-${alignment}`}>
      <div className="team-flag" />
      <div className="team-emblem">
        {logo ? (
          <img
            src={logo}
            alt={`${location || team.abbrev} ${name} logo`}
            className="team-logo"
          />
        ) : (
          <span className="team-logo-fallback">{team.abbrev}</span>
        )}
      </div>
      <div className="team-copy">
        {location ? <span className="team-location">{location}</span> : null}
        <div className="team-line">
          <span className="team-code">{team.abbrev}</span>
          <span className="team-name">{name}</span>
        </div>
      </div>
      <div className="team-score-box">
        <span className="team-score">{score}</span>
      </div>
    </div>
  );
}

function CompactTeam({
  team,
  score,
  alignment,
}: {
  team: TeamRecord;
  score: number;
  alignment: 'away' | 'home';
}) {
  const logo = getTeamLogo(team);
  const name = getTeamName(team);
  const logoSlot = logo ? (
    <img
      src={logo}
      alt={`${team.abbrev} logo`}
      className="compact-team-logo"
    />
  ) : (
    <span className="compact-team-logo-fallback">{team.abbrev}</span>
  );
  const scoreSlot = <div className="compact-team-score">{score}</div>;

  return (
    <div className={`compact-team compact-team-${alignment}`} title={name}>
      {alignment === 'away' ? (
        <>
          <div className="compact-team-copy">{logoSlot}</div>
          {scoreSlot}
        </>
      ) : (
        <>
          {scoreSlot}
          <div className="compact-team-copy">{logoSlot}</div>
        </>
      )}
    </div>
  );
}

function TwitchIcon() {
  return (
    <svg
      className="twitch-icon"
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
    >
      <path
        fill="currentColor"
        d="M4 3h16v11l-4 4h-4l-2 3H7v-3H4V3zm2 2v11h3v2l2-2h4l3-3V5H6zm4 3h2v4h-2V8zm5 0h2v4h-2V8z"
      />
    </svg>
  );
}

function getCompactMetaText(game: NhlGame, detail: string): string {
  const badge = getStatusBadge(game);

  if (badge === 'FINAL') {
    return detail === 'REGULATION' ? 'FINAL' : `FINAL ${detail}`;
  }

  if (badge === 'UP NEXT') {
    return detail;
  }

  return detail;
}

function useDisplayedStatusDetail(
  game: NhlGame | null,
  showClock: boolean,
  previousGame: NhlGame | null,
): string {
  const [showPrimaryUpcomingDetail, setShowPrimaryUpcomingDetail] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const gameId = game?.id ?? null;
  const gameState = game?.gameState ?? null;
  const gameStartTime = game?.startTimeUTC ?? null;
  const previousGameId = previousGame?.id ?? null;
  const previousAwayScore = previousGame?.awayTeam.score ?? null;
  const previousHomeScore = previousGame?.homeTeam.score ?? null;
  const previousStartTime = previousGame?.startTimeUTC ?? null;
  const hasCountdownDetail =
    !!game && isUpcomingGame(game) && !!getUpcomingCountdownDetail(game, now);
  const canRotatePreviousResult =
    !!game && !!previousGame && isUpcomingGame(game) && !hasCountdownDetail;

  useEffect(() => {
    if (!hasCountdownDetail) {
      setNow(Date.now());
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [hasCountdownDetail, gameId, gameStartTime]);

  useEffect(() => {
    if (!hasCountdownDetail && !canRotatePreviousResult) {
      setShowPrimaryUpcomingDetail(true);
      return;
    }

    setShowPrimaryUpcomingDetail(true);

    const intervalId = window.setInterval(() => {
      setShowPrimaryUpcomingDetail((current) => !current);
    }, hasCountdownDetail ? UPCOMING_COUNTDOWN_ROTATION_MS : UPCOMING_DETAIL_ROTATION_MS);

    return () => window.clearInterval(intervalId);
  }, [
    canRotatePreviousResult,
    gameId,
    gameState,
    gameStartTime,
    hasCountdownDetail,
    previousGameId,
    previousAwayScore,
    previousHomeScore,
    previousStartTime,
  ]);

  if (!game) {
    return '';
  }

  if (!isUpcomingGame(game)) {
    return getStatusDetail(game, showClock, previousGame);
  }

  if (hasCountdownDetail) {
    return showPrimaryUpcomingDetail
      ? getStatusDetail(game, showClock, previousGame, {
          now,
          upcomingDetailMode: 'countdown',
        })
      : getStatusDetail(game, showClock, previousGame, {
          now,
          upcomingDetailMode: 'schedule',
        });
  }

  if (!previousGame) {
    return getStatusDetail(game, showClock, previousGame, {
      now,
      upcomingDetailMode: 'schedule',
    });
  }

  return showPrimaryUpcomingDetail
    ? getStatusDetail(game, showClock, previousGame)
    : getStatusDetail(game, showClock, previousGame, {
        now,
        upcomingDetailMode: 'schedule',
      });
}

export function ScoreboardCard({
  game,
  previousGame = null,
  showClock,
  muted,
  style,
  layout,
  goalAnimation,
  showCredit,
  debugGoalFlash = null,
  className,
  emptyLabel = 'No game scheduled',
}: ScoreboardCardProps) {
  const showCreditReveal = useCreditReveal(showCredit);
  const goalFlash = useGoalFlash(game);
  const statusDetail = useDisplayedStatusDetail(game, showClock, previousGame);
  const [manualGoalFlash, setManualGoalFlash] = useState<GoalFlashState | null>(null);

  useEffect(() => {
    if (!game || !debugGoalFlash) {
      return;
    }

    setManualGoalFlash({
      key: debugGoalFlash.key,
      team:
        debugGoalFlash.alignment === 'away' ? game.awayTeam : game.homeTeam,
      alignment: debugGoalFlash.alignment,
    });
  }, [debugGoalFlash, game]);

  useEffect(() => {
    if (!manualGoalFlash) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      setManualGoalFlash((currentGoalFlash) =>
        currentGoalFlash?.key === manualGoalFlash.key ? null : currentGoalFlash,
      );
    }, GOAL_FLASH_DURATION_MS);

    return () => window.clearTimeout(timeoutId);
  }, [manualGoalFlash]);

  const activeGoalFlash = manualGoalFlash ?? goalFlash;

  useGoalHorn(activeGoalFlash, muted);

  if (!game) {
    return (
      <div
        className={`scoreboard-card ${className ?? ''}`.trim()}
        data-style={style}
        data-layout={layout}
      >
        <div className="scoreboard-empty">{emptyLabel}</div>
        {showCreditReveal ? (
          <div className="scoreboard-empty-credit">{CREDIT_LABEL}</div>
        ) : null}
        {activeGoalFlash ? (
          <GoalFlash
            key={activeGoalFlash.key}
            goalFlash={activeGoalFlash}
            animationStyle={goalAnimation}
          />
        ) : null}
      </div>
    );
  }

  const statusTone = getStatusTone(game);
  const isCompact = layout === 'compact';
  const footerText = showCreditReveal ? CREDIT_LABEL : getSeriesLine(game);
  const compactSeriesState = getCompactSeriesState(game);

  return (
    <div
      className={`scoreboard-card ${className ?? ''}`.trim()}
      data-style={style}
      data-layout={layout}
    >
      {isCompact ? (
        <>
          <div className="scorebug-compact">
            <CompactTeam
              team={game.awayTeam}
              score={game.awayTeam.score ?? 0}
              alignment="away"
            />
            <div className="compact-meta">
              <div className="compact-meta-detail">
                {getCompactMetaText(game, statusDetail)}
              </div>
              {compactSeriesState ? (
                <div className="compact-meta-series">{compactSeriesState}</div>
              ) : null}
            </div>
            <CompactTeam
              team={game.homeTeam}
              score={game.homeTeam.score ?? 0}
              alignment="home"
            />
          </div>
          {showCreditReveal ? (
            <div className="scorebug-compact-credit-bar compact-credit">
              <span className="compact-credit-by">by</span>
              <span className="compact-credit-brand">
                <TwitchIcon />
                <span>{CREDIT_NAME}</span>
              </span>
            </div>
          ) : null}
        </>
      ) : (
        <>
          <div className="scorebug-header">
            <div className={`status-pill status-pill-${statusTone}`}>
              {getStatusBadge(game)}
            </div>
            <div className="status-rail" />
            <div className="status-detail">{statusDetail}</div>
          </div>
          <div className="scoreboard-main">
            <TeamRow
              team={game.awayTeam}
              score={game.awayTeam.score ?? 0}
              alignment="away"
            />
            <TeamRow
              team={game.homeTeam}
              score={game.homeTeam.score ?? 0}
              alignment="home"
            />
          </div>
          {footerText ? (
            <div className="scorebug-footer">
              <div className={`series-line ${showCreditReveal ? 'credit-line' : ''}`}>
                {footerText}
              </div>
            </div>
          ) : null}
        </>
      )}
      {activeGoalFlash ? (
        <GoalFlash
          key={activeGoalFlash.key}
          goalFlash={activeGoalFlash}
          animationStyle={goalAnimation}
        />
      ) : null}
    </div>
  );
}
