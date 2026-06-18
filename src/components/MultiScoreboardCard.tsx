import { useEffect, useRef, useState } from 'react';
import { CREDIT_LABEL } from '../lib/credit';
import {
  getStatusBadge,
  getStatusDetail,
  getUpcomingCountdownDetail,
} from '../lib/format';
import { isFinalGame, isLiveGame } from '../lib/gameSelection';
import { useCreditReveal } from '../lib/useCreditReveal';
import type { GoalAnimationStyle, NhlGame, OverlayLayout, OverlayStyle } from '../lib/types';

interface MultiScoreboardCardProps {
  primaryGame: NhlGame | null;
  games: NhlGame[];
  showClock: boolean;
  layout: OverlayLayout;
  style: OverlayStyle;
  goalAnimation?: GoalAnimationStyle;
  showCredit: boolean;
  className?: string;
  emptyLabel?: string;
}

interface MultiGoalReaction {
  key: number;
  alignment: 'away' | 'home';
}

const MULTI_GOAL_REACTION_MS = 1_800;
const UPCOMING_COUNTDOWN_ROTATION_MS = 30_000;

function getStatusTone(game: NhlGame): string {
  if (isLiveGame(game)) {
    return game.clock?.inIntermission ? 'intermission' : 'live';
  }

  if (isFinalGame(game)) {
    return 'final';
  }

  return 'upcoming';
}

function getTeamLogo(gameTeam: NhlGame['awayTeam']): string | undefined {
  return gameTeam.logo ?? gameTeam.darkLogo;
}

function getFooterText(gameCount: number): string {
  return gameCount === 1 ? 'Live look-in' : `${gameCount} live games`;
}

export function MultiScoreboardCard({
  primaryGame,
  games,
  showClock,
  layout,
  style,
  showCredit,
  className,
  emptyLabel = 'No live games available',
}: MultiScoreboardCardProps) {
  const showCreditReveal = useCreditReveal(showCredit);
  const isCompact = layout === 'compact';
  const [showUpcomingCountdown, setShowUpcomingCountdown] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [liveClockBaseMs, setLiveClockBaseMs] = useState(() => Date.now());
  const [goalReactions, setGoalReactions] = useState<
    Record<number, MultiGoalReaction>
  >({});
  const previousScoresRef = useRef<Map<number, { awayScore: number; homeScore: number }>>(
    new Map(),
  );
  const reactionTimeoutsRef = useRef<Map<number, number>>(new Map());
  const hasRotatingUpcomingGame = games.some(
    (game) => !!getUpcomingCountdownDetail(game, now),
  );
  const hasLiveSoccerClock = games.some(
    (game) =>
      game.sport === 'soccer' &&
      isLiveGame(game) &&
      showClock &&
      game.clock?.running &&
      !game.clock.inIntermission,
  );

  useEffect(() => {
    if (!hasRotatingUpcomingGame && !hasLiveSoccerClock) {
      setNow(Date.now());
      return;
    }

    const intervalId = window.setInterval(() => {
      setNow(Date.now());
    }, 1_000);

    return () => window.clearInterval(intervalId);
  }, [hasRotatingUpcomingGame, hasLiveSoccerClock, games]);

  useEffect(() => {
    const nextNow = Date.now();
    setLiveClockBaseMs(nextNow);
    setNow(nextNow);
  }, [games]);

  useEffect(() => {
    if (!hasRotatingUpcomingGame) {
      setShowUpcomingCountdown(true);
      return;
    }

    setShowUpcomingCountdown(true);

    const intervalId = window.setInterval(() => {
      setShowUpcomingCountdown((current) => !current);
    }, UPCOMING_COUNTDOWN_ROTATION_MS);

    return () => window.clearInterval(intervalId);
  }, [games]);

  useEffect(() => {
    const previousScores = previousScoresRef.current;
    const nextScores = new Map<number, { awayScore: number; homeScore: number }>();
    const nextReactions: Array<{ gameId: number; reaction: MultiGoalReaction }> = [];

    for (const game of games) {
      const awayScore = game.awayTeam.score ?? 0;
      const homeScore = game.homeTeam.score ?? 0;

      nextScores.set(game.id, { awayScore, homeScore });

      const previousGameScores = previousScores.get(game.id);

      if (!previousGameScores || !isLiveGame(game)) {
        continue;
      }

      const awayIncrease = awayScore - previousGameScores.awayScore;
      const homeIncrease = homeScore - previousGameScores.homeScore;

      if (awayIncrease > 0 && homeIncrease <= 0) {
        nextReactions.push({
          gameId: game.id,
          reaction: {
            key: Date.now() + game.id,
            alignment: 'away',
          },
        });
      } else if (homeIncrease > 0 && awayIncrease <= 0) {
        nextReactions.push({
          gameId: game.id,
          reaction: {
            key: Date.now() + game.id,
            alignment: 'home',
          },
        });
      }
    }

    previousScoresRef.current = nextScores;

    if (!nextReactions.length) {
      return;
    }

    setGoalReactions((currentReactions) => {
      const updatedReactions = { ...currentReactions };

      for (const { gameId, reaction } of nextReactions) {
        updatedReactions[gameId] = reaction;
      }

      return updatedReactions;
    });

    for (const { gameId, reaction } of nextReactions) {
      const existingTimeoutId = reactionTimeoutsRef.current.get(gameId);

      if (existingTimeoutId) {
        window.clearTimeout(existingTimeoutId);
      }

      const timeoutId = window.setTimeout(() => {
        setGoalReactions((currentReactions) => {
          if (currentReactions[gameId]?.key !== reaction.key) {
            return currentReactions;
          }

          const nextGoalReactions = { ...currentReactions };
          delete nextGoalReactions[gameId];
          return nextGoalReactions;
        });

        reactionTimeoutsRef.current.delete(gameId);
      }, MULTI_GOAL_REACTION_MS);

      reactionTimeoutsRef.current.set(gameId, timeoutId);
    }
  }, [games]);

  useEffect(() => {
    return () => {
      reactionTimeoutsRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      reactionTimeoutsRef.current.clear();
    };
  }, []);

  if (!games.length) {
    return (
      <div
        className={`scoreboard-card multi-scoreboard-card ${className ?? ''}`.trim()}
        data-style={style}
        data-layout={layout}
      >
        <div className="scoreboard-empty">{emptyLabel}</div>
      </div>
    );
  }

  return (
    <div
      className={`scoreboard-card multi-scoreboard-card ${className ?? ''}`.trim()}
      data-style={style}
      data-layout={layout}
      data-sport={primaryGame?.sport ?? games[0]?.sport ?? 'nhl'}
    >
      {!isCompact ? (
        <div className="scorebug-header">
          <div className="status-pill status-pill-live">MULTI</div>
          <div className="status-rail" />
          <div className="status-detail">{getFooterText(games.length)}</div>
        </div>
      ) : null}
      <div className="multi-scoreboard-list">
        {games.map((game) => {
          const awayLogo = getTeamLogo(game.awayTeam);
          const homeLogo = getTeamLogo(game.homeTeam);
          const teamImageLabel = game.sport === 'soccer' ? 'flag' : 'logo';
          const isPrimaryGame = primaryGame?.id === game.id;
          const goalReaction = goalReactions[game.id];
          const awayScoreKey =
            goalReaction?.alignment === 'away'
              ? `${game.id}-away-${goalReaction.key}`
              : `${game.id}-away`;
          const homeScoreKey =
            goalReaction?.alignment === 'home'
              ? `${game.id}-home-${goalReaction.key}`
              : `${game.id}-home`;
          const hasUpcomingCountdown = !!getUpcomingCountdownDetail(game, now);
          const liveClockOffsetSeconds =
            game.sport === 'soccer' &&
            isLiveGame(game) &&
            showClock &&
            game.clock?.running &&
            !game.clock.inIntermission
              ? Math.floor((now - liveClockBaseMs) / 1_000)
              : 0;

          return (
            <div
              key={game.id}
              className={`multi-scoreboard-row${isPrimaryGame ? ' is-primary' : ''}${goalReaction ? ` is-goal-${goalReaction.alignment}` : ''}`}
            >
              {goalReaction ? (
                <span
                  key={`flash-${game.id}-${goalReaction.key}`}
                  className={`multi-scoreboard-row-flash multi-scoreboard-row-flash-${goalReaction.alignment}`}
                />
              ) : null}
              <div className="multi-scoreboard-matchup">
                <div className="multi-scoreboard-team multi-scoreboard-team-away">
                  {awayLogo ? (
                    <img
                      src={awayLogo}
                      alt={`${game.awayTeam.abbrev} ${teamImageLabel}`}
                      className="multi-scoreboard-team-logo"
                    />
                  ) : (
                    <span className="multi-scoreboard-team-logo-fallback">
                      {game.awayTeam.abbrev}
                    </span>
                  )}
                  <span className="multi-scoreboard-team-code">
                    {game.awayTeam.abbrev}
                  </span>
                </div>
                <div className="multi-scoreboard-scoreline">
                  <span
                    key={awayScoreKey}
                    className={`multi-scoreboard-score${goalReaction?.alignment === 'away' ? ' is-scored is-scored-away' : ''}`}
                  >
                    {game.awayTeam.score ?? 0}
                  </span>
                  <span className="multi-scoreboard-score-separator">-</span>
                  <span
                    key={homeScoreKey}
                    className={`multi-scoreboard-score${goalReaction?.alignment === 'home' ? ' is-scored is-scored-home' : ''}`}
                  >
                    {game.homeTeam.score ?? 0}
                  </span>
                </div>
                <div className="multi-scoreboard-team multi-scoreboard-team-home">
                  <span className="multi-scoreboard-team-code">
                    {game.homeTeam.abbrev}
                  </span>
                  {homeLogo ? (
                    <img
                      src={homeLogo}
                      alt={`${game.homeTeam.abbrev} ${teamImageLabel}`}
                      className="multi-scoreboard-team-logo"
                    />
                  ) : (
                    <span className="multi-scoreboard-team-logo-fallback">
                      {game.homeTeam.abbrev}
                    </span>
                  )}
                </div>
              </div>
              <div className="multi-scoreboard-meta">
                <span className={`status-pill status-pill-${getStatusTone(game)}`}>
                  {getStatusBadge(game)}
                </span>
                <span className="multi-scoreboard-detail">
                  {hasUpcomingCountdown
                    ? getStatusDetail(game, showClock, null, {
                        liveClockOffsetSeconds,
                        now,
                        upcomingDetailMode: showUpcomingCountdown
                          ? 'countdown'
                          : 'schedule',
                      })
                    : getStatusDetail(game, showClock, null, {
                        liveClockOffsetSeconds,
                        now,
                      })}
                </span>
              </div>
            </div>
          );
        })}
      </div>
      {!isCompact ? (
        <div className="scorebug-footer">
          <div className="series-line">
            {showCreditReveal ? CREDIT_LABEL : getFooterText(games.length)}
          </div>
        </div>
      ) : null}
    </div>
  );
}
