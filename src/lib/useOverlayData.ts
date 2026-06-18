import { useEffect, useState } from 'react';
import { fetchScheduleNow, fetchScoreByDate, fetchScoreNow } from './api';
import {
  buildGameSelection,
  buildMergedGames,
  getRefreshInterval,
  isFinalGame,
} from './gameSelection';
import type { DataSnapshot, OverlayConfig } from './types';

interface OverlayDataState {
  data: DataSnapshot;
  loading: boolean;
  error: string | null;
}

const FINAL_SELECTION_HOLD_MS = 5 * 60_000;

function createEmptySnapshot(): DataSnapshot {
  return {
    games: [],
    displayMode: 'single',
    selectedGame: null,
    selectedGames: [],
    schedule: null,
    score: null,
  };
}

function mergeHistoricalGames(
  currentGames: DataSnapshot['games'],
  historicalGames: DataSnapshot['games'],
): DataSnapshot['games'] {
  const mergedById = new Map(currentGames.map((game) => [game.id, game]));

  for (const game of historicalGames) {
    if (!mergedById.has(game.id)) {
      mergedById.set(game.id, game);
    }
  }

  return Array.from(mergedById.values());
}

export function useOverlayData(config: OverlayConfig): OverlayDataState {
  const [state, setState] = useState<OverlayDataState>({
    data: createEmptySnapshot(),
    loading: true,
    error: null,
  });

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | undefined;
    let activeController: AbortController | null = null;
    let heldSelection: { gameId: number; expiresAt: number } | null = null;
    let previousSelection: Pick<DataSnapshot, 'displayMode' | 'selectedGame'> | null =
      null;

    async function loadData() {
      activeController?.abort();
      activeController = new AbortController();

      try {
        const [schedule, score] = await Promise.all([
          fetchScheduleNow(config.sport, activeController.signal),
          fetchScoreNow(config.sport, activeController.signal),
        ]);

        const previousScore =
          score.prevDate
            ? await fetchScoreByDate(config.sport, score.prevDate, activeController.signal).catch(
                () => null,
              )
            : null;

        if (cancelled) {
          return;
        }

        const mergedGames = mergeHistoricalGames(
          buildMergedGames(schedule, score),
          previousScore?.games ?? [],
        );
        const now = Date.now();
        const previousSelectedGame = previousSelection?.selectedGame ?? null;
        const previousGame =
          previousSelectedGame
            ? mergedGames.find((game) => game.id === previousSelectedGame.id) ?? null
            : null;

        if (
          previousSelection?.displayMode === 'single' &&
          previousSelectedGame &&
          !isFinalGame(previousSelectedGame) &&
          previousGame &&
          isFinalGame(previousGame)
        ) {
          heldSelection = {
            gameId: previousGame.id,
            expiresAt: now + FINAL_SELECTION_HOLD_MS,
          };
        }

        let selection = buildGameSelection(config, mergedGames, now);

        if (heldSelection && heldSelection.expiresAt > now) {
          const heldGameId = heldSelection.gameId;
          const heldGame =
            mergedGames.find((game) => game.id === heldGameId) ?? null;

          if (heldGame && isFinalGame(heldGame)) {
            selection = {
              displayMode: 'single',
              selectedGame: heldGame,
              selectedGames: [heldGame],
            };
          } else {
            heldSelection = null;
          }
        } else {
          heldSelection = null;
        }

        previousSelection = {
          displayMode: selection.displayMode,
          selectedGame: selection.selectedGame,
        };

        setState({
          data: {
            games: mergedGames,
            displayMode: selection.displayMode,
            selectedGame: selection.selectedGame,
            selectedGames: selection.selectedGames,
            schedule,
            score,
          },
          loading: false,
          error: null,
        });

        timeoutId = window.setTimeout(
          loadData,
          getRefreshInterval(config.refreshSeconds),
        );
      } catch {
        if (cancelled) {
          return;
        }

        setState((currentState) => ({
          data: currentState.data,
          loading: false,
          error: null,
        }));

        timeoutId = window.setTimeout(
          loadData,
          getRefreshInterval(config.refreshSeconds),
        );
      }
    }

    setState((currentState) => ({
      data: currentState.data,
      loading: true,
      error: null,
    }));

    void loadData();

    return () => {
      cancelled = true;
      activeController?.abort();

      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [
    config.gameId,
    config.mode,
    config.playoffsOnly,
    config.refreshSeconds,
    config.showClock,
    config.sport,
    config.teams.join(','),
  ]);

  return state;
}
