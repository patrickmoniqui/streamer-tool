import { useEffect, useMemo, useState } from 'react';
import { SelectedScoreboardCard } from '../components/SelectedScoreboardCard';
import {
  getAnalyticsInstallId,
  getInstallIdFromSearch,
  trackAnalyticsEvent,
} from '../lib/analytics';
import { fetchPublicGameScoreProfile } from '../lib/gameScoreProfile';
import { mergeConfigOverrides, parseConfig, parseConfigOverrides } from '../lib/urlState';
import { useOverlayData } from '../lib/useOverlayData';
import { findPreviousFinalGame } from '../lib/gameSelection';

export function OverlayPage() {
  const [config, setConfig] = useState(() => parseConfig(window.location.search));
  const [profileError, setProfileError] = useState<string | null>(null);
  const profileId = useMemo(
    () => new URLSearchParams(window.location.search).get('profile')?.trim() ?? '',
    [],
  );
  const [profileLoading, setProfileLoading] = useState(() => Boolean(profileId));
  const installId = useMemo(
    () => getInstallIdFromSearch(window.location.search) ?? getAnalyticsInstallId(),
    [],
  );
  const { data, error } = useOverlayData(config);
  const previousGame = findPreviousFinalGame(data.selectedGame, data.games);

  useEffect(() => {
    void trackAnalyticsEvent('overlay_loaded', config, { installId });
  }, [config, installId]);

  useEffect(() => {
    if (!profileId) {
      return;
    }

    const controller = new AbortController();
    const overrides = parseConfigOverrides(window.location.search);

    void fetchPublicGameScoreProfile(profileId, controller.signal)
      .then((profile) => {
        setConfig(mergeConfigOverrides(profile.config, overrides));
        setProfileError(null);
        setProfileLoading(false);
      })
      .catch((profileFetchError) => {
        if (!controller.signal.aborted) {
          setProfileError(
            profileFetchError instanceof Error
              ? profileFetchError.message
              : 'Unable to load this saved overlay profile.',
          );
          setProfileLoading(false);
        }
      });

    return () => controller.abort();
  }, [profileId]);

  return (
    <main className="overlay-page">
      {profileLoading || profileError || error ? (
        <div className="overlay-error">
          {profileLoading ? 'Loading saved overlay profile…' : profileError ?? error}
        </div>
      ) : (
        <SelectedScoreboardCard
          displayMode={data.displayMode}
          selectedGame={data.selectedGame}
          selectedGames={data.selectedGames}
          previousGame={previousGame}
          showClock={config.showClock}
          muted={config.muted}
          style={config.style}
          layout={config.layout}
          goalAnimation={config.goalAnimation}
          showCredit
          className="overlay-card"
        />
      )}
    </main>
  );
}
