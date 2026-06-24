import { useEffect, useRef, useState, type RefObject } from 'react';
import { SelectedScoreboardCard } from '../components/SelectedScoreboardCard';
import { isTwitchGateEnabled } from '../lib/features';
import { OVERLAY_STYLE_OPTIONS } from '../lib/overlayStyles';
import { NHL_TEAMS } from '../lib/teams';
import {
  buildTwitchLoginUrl,
  buildTwitchLogoutUrl,
  fetchTwitchGateStatus,
  type TwitchGateStatus,
} from '../lib/twitchGate';
import {
  buildTrackedLiveGoalOverlayUrl,
  buildTrackedOverlayUrl,
  getAnalyticsInstallId,
  trackAnalyticsEvent,
} from '../lib/analytics';
import { findPreviousFinalGame } from '../lib/gameSelection';
import { useOverlayData } from '../lib/useOverlayData';
import {
  MAX_REFRESH_SECONDS,
  MIN_REFRESH_SECONDS,
  SPORT_OPTIONS,
  buildOverlayUrl,
  parseConfig,
} from '../lib/urlState';
import type { NhlGame, OverlayConfig } from '../lib/types';

const SELECTABLE_NHL_TEAMS = NHL_TEAMS.filter((team) => team.abbrev !== 'AUTO');
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const GOAL_ANIMATION_OPTIONS = [
  {
    value: 'logo-storm',
    label: 'Logo Storm',
    description: 'Team logos burst across the screen like goal confetti.',
  },
  {
    value: 'jumbotron',
    label: 'Arena Jumbotron',
    description: 'A giant team-logo slam with broadcast-style light beams.',
  },
  {
    value: 'logo-rain',
    label: 'Logo Rain',
    description: 'A calmer celebration wall with floating team logos.',
  },
] as const;

interface SelectableTeam {
  abbrev: string;
  name: string;
  logo?: string;
}

function getGameTeamName(team: NhlGame['awayTeam']): string {
  return team.commonName?.default ?? team.placeName?.default ?? team.abbrev;
}

function getGameTeamLogo(team: NhlGame['awayTeam']): string | undefined {
  return team.logo ?? team.darkLogo;
}

function buildSoccerTeams(games: NhlGame[]): SelectableTeam[] {
  const teamsByAbbrev = new Map<string, SelectableTeam>();

  for (const game of games) {
    for (const team of [game.awayTeam, game.homeTeam]) {
      if (!teamsByAbbrev.has(team.abbrev)) {
        teamsByAbbrev.set(team.abbrev, {
          abbrev: team.abbrev,
          name: getGameTeamName(team),
          logo: getGameTeamLogo(team),
        });
      }
    }
  }

  return Array.from(teamsByAbbrev.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
}

function TwitchSocialIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M4 3h16v11l-4 4h-4l-2 3H7v-3H4V3zm2 2v11h3v2l2-2h4l3-3V5H6zm4 3h2v4h-2V8zm5 0h2v4h-2V8z"
      />
    </svg>
  );
}

function InstagramSocialIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M7.75 2h8.5A5.75 5.75 0 0 1 22 7.75v8.5A5.75 5.75 0 0 1 16.25 22h-8.5A5.75 5.75 0 0 1 2 16.25v-8.5A5.75 5.75 0 0 1 7.75 2zm0 1.8A3.95 3.95 0 0 0 3.8 7.75v8.5A3.95 3.95 0 0 0 7.75 20.2h8.5a3.95 3.95 0 0 0 3.95-3.95v-8.5a3.95 3.95 0 0 0-3.95-3.95h-8.5zm8.95 1.35a1.1 1.1 0 1 1 0 2.2 1.1 1.1 0 0 1 0-2.2zM12 6.8A5.2 5.2 0 1 1 6.8 12 5.2 5.2 0 0 1 12 6.8zm0 1.8A3.4 3.4 0 1 0 15.4 12 3.4 3.4 0 0 0 12 8.6z"
      />
    </svg>
  );
}

export function SettingsPage() {
  const twitchGateEnabled = isTwitchGateEnabled();
  const canUseTestingTools =
    import.meta.env.DEV || LOCAL_HOSTNAMES.has(window.location.hostname);
  const versionLabel = __APP_BUILD_NUMBER__
    ? `v${__APP_VERSION__} · build ${__APP_BUILD_NUMBER__}`
    : `v${__APP_VERSION__}`;
  const [config, setConfig] = useState<OverlayConfig>(() =>
    parseConfig(window.location.search),
  );
  const [installId] = useState(() => getAnalyticsInstallId());
  const [developerMode, setDeveloperMode] = useState(false);
  const [previewGoalFlash, setPreviewGoalFlash] = useState<{
    key: number;
    alignment: 'away' | 'home';
  } | null>(null);
  const [overlayCopied, setOverlayCopied] = useState(false);
  const [liveGoalCopied, setLiveGoalCopied] = useState(false);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [twitchGateStatus, setTwitchGateStatus] = useState<TwitchGateStatus | null>(
    null,
  );
  const [twitchGateError, setTwitchGateError] = useState<string | null>(null);
  const [draggedTeamIndex, setDraggedTeamIndex] = useState<number | null>(null);
  const [dragOverTeamIndex, setDragOverTeamIndex] = useState<number | null>(null);
  const overlayLinkRef = useRef<HTMLTextAreaElement | null>(null);
  const liveGoalLinkRef = useRef<HTMLTextAreaElement | null>(null);
  const lastOverlayLinkCopyTrackedAtRef = useRef(0);
  const lastLiveGoalLinkCopyTrackedAtRef = useRef(0);
  const { data, error, loading } = useOverlayData(config);
  const previousGame = findPreviousFinalGame(data.selectedGame, data.games);
  const selectableTeams =
    config.sport === 'nhl'
      ? SELECTABLE_NHL_TEAMS
      : buildSoccerTeams(data.games);
  const selectableTeamByAbbrev: Map<string, SelectableTeam> = new Map(
    selectableTeams.map((team) => [team.abbrev, team]),
  );
  const selectedStyle =
    OVERLAY_STYLE_OPTIONS.find((option) => option.value === config.style) ??
    OVERLAY_STYLE_OPTIONS[0];
  const selectedGoalAnimation =
    GOAL_ANIMATION_OPTIONS.find((option) => option.value === config.goalAnimation) ??
    GOAL_ANIMATION_OPTIONS[0];
  const selectedTeams = config.teams
    .map((teamAbbrev) => selectableTeamByAbbrev.get(teamAbbrev))
    .filter((team) => team !== undefined);
  const selectedTeamNames = selectedTeams.map((team) => team.name);
  const teamPickerLabel =
    config.teams.length === 0
      ? 'Auto (follow schedule)'
      : config.teams.length <= 2
        ? selectedTeamNames.join(', ')
        : `${config.teams.length} teams selected`;
  const trackedOverlayUrl = buildTrackedOverlayUrl(config, installId);
  const trackedLiveGoalOverlayUrl = buildTrackedLiveGoalOverlayUrl(config, installId);

  useEffect(() => {
    const nextSearch = new URL(buildOverlayUrl(config)).search;
    window.history.replaceState({}, '', `${window.location.pathname}${nextSearch}`);
  }, [config]);

  useEffect(() => {
    void trackAnalyticsEvent('settings_opened', config, { installId });
  }, [installId]);

  useEffect(() => {
    if (!overlayCopied) {
      return;
    }

    const timeoutId = window.setTimeout(() => setOverlayCopied(false), 1_500);

    return () => window.clearTimeout(timeoutId);
  }, [overlayCopied]);

  useEffect(() => {
    if (!liveGoalCopied) {
      return;
    }

    const timeoutId = window.setTimeout(() => setLiveGoalCopied(false), 1_500);

    return () => window.clearTimeout(timeoutId);
  }, [liveGoalCopied]);

  useEffect(() => {
    if (!twitchGateEnabled) {
      return;
    }

    const controller = new AbortController();

    void fetchTwitchGateStatus(controller.signal)
      .then((status) => {
        setTwitchGateStatus(status);
        setTwitchGateError(null);
        setConfig((current) => ({
          ...current,
          unlockToken: status.entitled ? status.overlayToken ?? undefined : undefined,
        }));
      })
      .catch((fetchError) => {
        if (controller.signal.aborted) {
          return;
        }

        const message =
          fetchError instanceof Error
            ? fetchError.message
            : 'Unable to load Twitch gate status.';

        setTwitchGateError(message);
      });

    return () => controller.abort();
  }, [twitchGateEnabled]);

  useEffect(() => {
    if (twitchGateEnabled && !twitchGateStatus?.entitled) {
      setConfig((current) => ({
        ...current,
        unlockToken: undefined,
      }));
    }
  }, [twitchGateEnabled, twitchGateStatus]);

  async function copyUrl(
    url: string,
    linkRef: RefObject<HTMLTextAreaElement | null>,
    onCopied: () => void,
    label: string,
  ) {
    setCopyError(null);

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        throw new Error('Clipboard API unavailable');
      }
    } catch {
      const overlayLinkField = linkRef.current;

      if (overlayLinkField) {
        overlayLinkField.focus();
        overlayLinkField.select();
        overlayLinkField.setSelectionRange(0, overlayLinkField.value.length);

        if (document.execCommand('copy')) {
          onCopied();
          return;
        }
      }

      setCopyError(
        `Clipboard access was blocked. The ${label} is highlighted so you can copy it manually.`,
      );
      return;
    }

    onCopied();
  }

  function handleOverlayLinkCopied() {
    const now = Date.now();

    if (now - lastOverlayLinkCopyTrackedAtRef.current < 1_000) {
      setOverlayCopied(true);
      return;
    }

    lastOverlayLinkCopyTrackedAtRef.current = now;
    void trackAnalyticsEvent('overlay_link_copied', config, { installId });
    setOverlayCopied(true);
  }

  function handleLiveGoalLinkCopied() {
    const now = Date.now();

    if (now - lastLiveGoalLinkCopyTrackedAtRef.current < 1_000) {
      setLiveGoalCopied(true);
      return;
    }

    lastLiveGoalLinkCopyTrackedAtRef.current = now;
    void trackAnalyticsEvent('overlay_link_copied', config, {
      installId,
      pathname: '/live-goal/overlay.html',
    });
    setLiveGoalCopied(true);
  }

  function triggerPreviewGoal(alignment: 'away' | 'home') {
    setPreviewGoalFlash({
      key: Date.now(),
      alignment,
    });
  }

  function toggleTeam(teamAbbrev: string) {
    setConfig((current) => {
      const selectedTeams = current.teams.filter((team) => team !== teamAbbrev);

      if (!current.teams.includes(teamAbbrev)) {
        selectedTeams.push(teamAbbrev);
      }

      return {
        ...current,
        mode: 'auto',
        teams: selectedTeams,
        gameId: undefined,
      };
    });
  }

  function reorderTeam(fromIndex: number, toIndex: number) {
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= config.teams.length ||
      toIndex >= config.teams.length
    ) {
      return;
    }

    setConfig((current) => {
      const teams = [...current.teams];
      const [movedTeam] = teams.splice(fromIndex, 1);
      teams.splice(toIndex, 0, movedTeam);

      return {
        ...current,
        mode: 'auto',
        teams,
        gameId: undefined,
      };
    });
  }

  function resetTeamDragState() {
    setDraggedTeamIndex(null);
    setDragOverTeamIndex(null);
  }

  return (
    <main className="settings-page">
      <section className="settings-header">
        <p className="eyebrow">Live Score Overlay</p>
        <h1>Set up your score overlay</h1>
        <p className="header-copy">
          Choose the teams, look, and layout you want, then copy the link into
          OBS or any browser source.
        </p>
        <div className="header-meta">
          <p className="version-chip" aria-label={`App version ${versionLabel}`}>
            Version {versionLabel}
          </p>
          <div className="social-follow-links" aria-label="Follow DJ MoneyKey">
          <a
            className="social-follow-link"
            href="https://www.twitch.tv/djmoneykey"
            target="_blank"
            rel="noreferrer"
          >
            <span className="social-follow-icon">
              <TwitchSocialIcon />
            </span>
            <span>Twitch</span>
          </a>
          <a
            className="social-follow-link"
            href="http://instagram.com/dj_moneykey"
            target="_blank"
            rel="noreferrer"
          >
            <span className="social-follow-icon">
              <InstagramSocialIcon />
            </span>
            <span>Instagram</span>
          </a>
          </div>
        </div>
      </section>

      <section className="settings-layout">
        <div className="settings-panel">
          <label className="field">
            <span>Sport</span>
            <select
              value={config.sport}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  sport: event.target.value as OverlayConfig['sport'],
                  mode: 'auto',
                  teams: [],
                  gameId: undefined,
                  playoffsOnly:
                    event.target.value === 'nhl' ? current.playoffsOnly : false,
                }))
              }
            >
              {SPORT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          <div className="field">
            <span>Teams</span>
            <details className="team-picker">
              <summary className="team-picker-trigger">
                <span
                  className={`team-picker-trigger-text${config.teams.length ? '' : ' is-placeholder'}`}
                >
                  {teamPickerLabel}
                </span>
                <span className="team-picker-trigger-count">
                  {config.teams.length ? `${config.teams.length} selected` : 'Auto'}
                </span>
              </summary>
              <div className="team-picker-popover">
                <div className="team-picker-actions">
                  <p className="team-picker-copy">
                    Check teams to follow. Drag selected teams to set priority.
                  </p>
                  <button
                    type="button"
                    className="team-picker-clear"
                    onClick={() =>
                      setConfig((current) => ({
                        ...current,
                        mode: 'auto',
                        teams: [],
                        gameId: undefined,
                      }))
                    }
                    disabled={!config.teams.length}
                  >
                    Clear all
                  </button>
                </div>
                {selectedTeams.length > 1 ? (
                  <div
                    className={`team-priority-list${draggedTeamIndex === null ? '' : ' is-drag-active'}`}
                    aria-label="Team priority order"
                  >
                    {selectedTeams.map((team, index) => {
                      const isDragging = draggedTeamIndex === index;
                      const isDragOver =
                        dragOverTeamIndex === index && draggedTeamIndex !== index;
                      const dropDirection =
                        draggedTeamIndex !== null && draggedTeamIndex < index
                          ? ' after'
                          : ' before';

                      return (
                        <div
                          key={team.abbrev}
                          className={`team-priority-item${isDragging ? ' is-dragging' : ''}${isDragOver ? ` is-drag-over is-drop-${dropDirection.trim()}` : ''}`}
                          draggable
                          onDragStart={(event) => {
                            setDraggedTeamIndex(index);
                            setDragOverTeamIndex(index);
                            event.dataTransfer.effectAllowed = 'move';
                            event.dataTransfer.setData('text/plain', String(index));
                          }}
                          onDragEnter={() => setDragOverTeamIndex(index)}
                          onDragOver={(event) => {
                            event.preventDefault();
                            event.dataTransfer.dropEffect = 'move';
                            setDragOverTeamIndex(index);
                          }}
                          onDragLeave={(event) => {
                            if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
                              setDragOverTeamIndex(null);
                            }
                          }}
                          onDragEnd={resetTeamDragState}
                          onDrop={(event) => {
                            event.preventDefault();
                            reorderTeam(
                              Number(event.dataTransfer.getData('text/plain')),
                              index,
                            );
                            resetTeamDragState();
                          }}
                        >
                          <span className="team-priority-handle" aria-hidden="true" />
                          <span className="team-priority-rank">{index + 1}</span>
                          {team.logo ? (
                            <img
                              src={team.logo}
                              alt=""
                              className="team-priority-logo"
                              loading="lazy"
                              aria-hidden="true"
                            />
                          ) : null}
                          <span className="team-priority-name">{team.name}</span>
                          <span className="team-priority-code">{team.abbrev}</span>
                          <div className="team-priority-controls" aria-label="Move team">
                            <button
                              type="button"
                              onClick={() => reorderTeam(index, index - 1)}
                              disabled={index === 0}
                              aria-label={`Move ${team.name} up`}
                            >
                              Up
                            </button>
                            <button
                              type="button"
                              onClick={() => reorderTeam(index, index + 1)}
                              disabled={index === selectedTeams.length - 1}
                              aria-label={`Move ${team.name} down`}
                            >
                              Down
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}
                {config.sport === 'soccer' && !selectableTeams.length ? (
                  <p className="team-picker-copy">
                    Soccer teams appear here when the current feed has games.
                  </p>
                ) : null}
                <div className="team-picker-grid">
                  {selectableTeams.map((team) => {
                    const checked = config.teams.includes(team.abbrev);

                    return (
                      <label
                        key={team.abbrev}
                        className={`team-option${checked ? ' is-selected' : ''}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleTeam(team.abbrev)}
                        />
                        {team.logo ? (
                          <img
                            src={team.logo}
                            alt=""
                            className="team-option-logo"
                            loading="lazy"
                            aria-hidden="true"
                          />
                        ) : null}
                        <div className="team-option-copy">
                          <span className="team-option-name">{team.name}</span>
                          <span className="team-option-code">{team.abbrev}</span>
                        </div>
                      </label>
                    );
                  })}
                </div>
              </div>
            </details>
            <small className="field-hint">
              {config.teams.length
                ? `Following ${config.teams.length} team${config.teams.length === 1 ? '' : 's'}. The overlay stays in auto mode and switches to multi-game when more than one matching live game is active.`
                : 'Leave every box unchecked to follow the best live or upcoming game automatically, with a multi-game view when more than one live matchup is active.'}
            </small>
          </div>

          <label className="field">
            <span>Style</span>
            <select
              value={config.style}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  style: event.target.value as OverlayConfig['style'],
                }))
              }
            >
              {OVERLAY_STYLE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="field-hint">{selectedStyle.description}</small>
          </label>

          <label className="field">
            <span>Layout</span>
            <select
              value={config.layout}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  layout: event.target.value as OverlayConfig['layout'],
                }))
              }
            >
              <option value="stacked">Stacked</option>
              <option value="compact">Compact</option>
            </select>
            <small className="field-hint">
              Compact keeps everything on a single line.
            </small>
          </label>

          <label className="field">
            <span>Goal animation</span>
            <select
              value={config.goalAnimation}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  goalAnimation: event.target.value as OverlayConfig['goalAnimation'],
                }))
              }
            >
              {GOAL_ANIMATION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            <small className="field-hint">{selectedGoalAnimation.description}</small>
          </label>

          <div className="field">
            <div className="field-header">
              <span>Refresh</span>
              <span className="field-value">{config.refreshSeconds}s</span>
            </div>
            <input
              className="range-input"
              type="range"
              min={String(MIN_REFRESH_SECONDS)}
              max={String(MAX_REFRESH_SECONDS)}
              step="1"
              value={config.refreshSeconds}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  refreshSeconds: Number(event.target.value),
                }))
              }
            />
            <small className="field-hint">
              Controls how often the overlay checks for score updates. The minimum
              is {MIN_REFRESH_SECONDS}s to protect the Worker request budget. Live
              games temporarily check faster so goal animations appear sooner.
            </small>
          </div>

          {config.sport === 'nhl' ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={config.playoffsOnly}
                onChange={(event) =>
                  setConfig((current) => ({
                    ...current,
                    playoffsOnly: event.target.checked,
                  }))
                }
              />
              <span>Playoffs only</span>
            </label>
          ) : null}

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.showClock}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  showClock: event.target.checked,
                }))
              }
            />
            <span>Show live clock</span>
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.muted}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  muted: event.target.checked,
                }))
              }
            />
            <span>Mute</span>
          </label>

          {canUseTestingTools ? (
            <label className="toggle">
              <input
                type="checkbox"
                checked={developerMode}
                onChange={(event) => setDeveloperMode(event.target.checked)}
              />
              <span>Show testing tools</span>
            </label>
          ) : null}

          <div className="field">
            <span>Live goal animation URL</span>
            <textarea
              ref={liveGoalLinkRef}
              readOnly
              value={trackedLiveGoalOverlayUrl}
              rows={4}
              onCopy={handleLiveGoalLinkCopied}
            />
            <small className="field-hint">
              Use this as a separate browser source for full-screen goal
              animations.
            </small>
          </div>

          <button
            className="secondary-button full-width-button"
            type="button"
            onClick={() =>
              void copyUrl(
                trackedLiveGoalOverlayUrl,
                liveGoalLinkRef,
                handleLiveGoalLinkCopied,
                'live goal animation URL',
              )
            }
          >
            {liveGoalCopied ? 'Copied' : 'Copy live goal URL'}
          </button>

          {loading ? <p className="helper-text">Loading current games…</p> : null}
          {error ? <p className="helper-text helper-error">{error}</p> : null}

          {twitchGateEnabled ? (
            <div className="supporter-card">
              <p className="supporter-label">Twitch Supporter Unlock</p>
              <p className="supporter-copy">
                Follow <strong>DJMoneyKey</strong> on Twitch to unlock supporter-only
                options in the future. The flag is off by default, so this stays
                dormant until you opt in.
              </p>
              {twitchGateStatus ? (
                <p className="supporter-status">
                  {twitchGateStatus.entitled
                    ? `Connected as ${twitchGateStatus.login}. Follower check passed.`
                    : twitchGateStatus.authenticated
                      ? `Connected as ${twitchGateStatus.login}, but follower check has not passed yet.`
                      : 'Not connected to Twitch.'}
                </p>
              ) : null}
              {twitchGateError ? (
                <p className="helper-text helper-error">{twitchGateError}</p>
              ) : null}
              <div className="supporter-actions">
                <a className="secondary-button" href={buildTwitchLoginUrl()}>
                  Connect Twitch
                </a>
                {twitchGateStatus?.authenticated ? (
                  <a className="ghost-link" href={buildTwitchLogoutUrl()}>
                    Sign out
                  </a>
                ) : null}
              </div>
            </div>
          ) : null}
        </div>

        <div className="preview-panel">
          <div className="preview-frame">
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
              debugGoalFlash={
                canUseTestingTools && data.displayMode === 'single'
                  ? previewGoalFlash
                  : null
              }
              emptyLabel="No game found for this setup"
            />
          </div>
          <div className="preview-link-panel">
            <div className="field">
              <span>Overlay link</span>
              <textarea
                ref={overlayLinkRef}
                readOnly
                value={trackedOverlayUrl}
                rows={4}
                onCopy={handleOverlayLinkCopied}
              />
            </div>

            <button
              className="primary-button"
              type="button"
              onClick={() =>
                void copyUrl(
                  trackedOverlayUrl,
                  overlayLinkRef,
                  handleOverlayLinkCopied,
                  'overlay link',
                )
              }
            >
              {overlayCopied ? 'Copied' : 'Copy overlay link'}
            </button>
            {copyError ? <p className="helper-text helper-error">{copyError}</p> : null}
          </div>
          {canUseTestingTools && developerMode ? (
            <div className="developer-card">
              <p className="developer-label">Testing Tools</p>
              <p className="developer-copy">
                Use these preview controls to test the goal animation and horn
                without waiting for a real score change. They only affect the
                preview on this page and stay available in single-game mode.
              </p>
              <div className="developer-actions">
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => triggerPreviewGoal('away')}
                  disabled={!data.selectedGame || data.displayMode !== 'single'}
                >
                  Test {data.selectedGame?.awayTeam.abbrev ?? 'Away'} Goal
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => triggerPreviewGoal('home')}
                  disabled={!data.selectedGame || data.displayMode !== 'single'}
                >
                  Test {data.selectedGame?.homeTeam.abbrev ?? 'Home'} Goal
                </button>
              </div>
            </div>
          ) : null}
          <p className="helper-text">
            Leave every team unchecked to follow the best live or upcoming game
            automatically. If more than one live game matches, the overlay
            switches to a multi-game view.
          </p>
        </div>
      </section>

      <footer className="settings-footer">
        <p>Made with ❤️ in Montreal by DJMoneykey</p>
      </footer>
    </main>
  );
}
