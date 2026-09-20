import { useEffect, useState } from 'react';
import { MultiScoreboardCard } from './MultiScoreboardCard';
import { ScoreboardCard } from './ScoreboardCard';
import type { DataSnapshot, OverlayConfig, NhlGame } from '../lib/types';

const COMPACT_GAME_ROTATION_MS = 60_000;

interface SelectedScoreboardCardProps {
  displayMode: DataSnapshot['displayMode'];
  selectedGame: NhlGame | null;
  selectedGames: NhlGame[];
  previousGame?: NhlGame | null;
  showClock: boolean;
  muted: boolean;
  style: OverlayConfig['style'];
  layout: OverlayConfig['layout'];
  goalAnimation: OverlayConfig['goalAnimation'];
  showCredit: boolean;
  debugGoalFlash?: {
    key: number;
    alignment: 'away' | 'home';
  } | null;
  className?: string;
  emptyLabel?: string;
}

export function SelectedScoreboardCard({
  displayMode,
  selectedGame,
  selectedGames,
  previousGame = null,
  showClock,
  muted,
  style,
  layout,
  goalAnimation,
  showCredit,
  debugGoalFlash = null,
  className,
  emptyLabel,
}: SelectedScoreboardCardProps) {
  const [compactGameIndex, setCompactGameIndex] = useState(0);
  const selectedGameIds = selectedGames.map((game) => game.id).join(',');
  const shouldRotateCompactGames =
    layout === 'compact' && displayMode === 'multi' && selectedGames.length > 1;

  useEffect(() => {
    if (!shouldRotateCompactGames) {
      setCompactGameIndex(0);
      return;
    }

    setCompactGameIndex((currentIndex) => currentIndex % selectedGames.length);

    const intervalId = window.setInterval(() => {
      setCompactGameIndex((currentIndex) => (currentIndex + 1) % selectedGames.length);
    }, COMPACT_GAME_ROTATION_MS);

    return () => window.clearInterval(intervalId);
  }, [selectedGameIds, selectedGames.length, shouldRotateCompactGames]);

  const compactGame = shouldRotateCompactGames
    ? selectedGames[compactGameIndex % selectedGames.length] ?? selectedGame
    : selectedGame;

  if (displayMode === 'multi' && selectedGames.length > 1 && !shouldRotateCompactGames) {
    return (
      <MultiScoreboardCard
        primaryGame={selectedGame}
        games={selectedGames}
        showClock={showClock}
        layout={layout}
        style={style}
        goalAnimation={goalAnimation}
        showCredit={showCredit}
        debugGoalFlash={debugGoalFlash}
        className={className}
        emptyLabel={emptyLabel}
      />
    );
  }

  return (
    <ScoreboardCard
      game={compactGame}
      previousGame={previousGame}
      showClock={showClock}
      muted={muted}
      style={style}
      layout={layout}
      goalAnimation={goalAnimation}
      showCredit={showCredit}
      debugGoalFlash={debugGoalFlash}
      className={className}
      emptyLabel={emptyLabel}
    />
  );
}
