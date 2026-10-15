import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_GLOBE_CONFIG,
  buildGlobeOverlayUrl,
  clearGlobeSession,
  createGlobeSessionId,
  fetchGlobeCheckIns,
  fetchGlobeProfile,
  saveGlobeProfile,
  getGlobeSessionId,
  normalizeTwitchChannel,
  removeGlobeCheckIn,
  submitGlobeCheckIn,
  type GlobeCheckIn,
  type GlobeConfig,
} from '../lib/globe';
import { GlobeScene } from './GlobeOverlayPage';
import {
  buildTwitchConnectUrl,
  completeTwitchConnect,
  getTwitchConnectToken,
  refreshTwitchConnectToken,
  isTwitchConnectConfigured,
  type TwitchIdentity,
} from '../lib/twitchConnect';

const STORAGE_KEY = 'keylight-globe-settings';
const LOCAL_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);
const TEST_LOCATIONS = [
  'Montreal, Canada',
  'London, United Kingdom',
  'Tokyo, Japan',
  'Sydney, Australia',
  'Sao Paulo, Brazil',
  'Cape Town, South Africa',
];
const TEST_VIEWER_PREFIX = 'TestViewer';
function normalizeColorInput(value: string, fallback: string): string {
  const normalized = value.trim();

  if (!normalized) {
    return fallback;
  }

  const hexColor = normalized.startsWith('#') ? normalized : '#' + normalized;
  return /^#[0-9a-fA-F]{6}$/.test(hexColor) ? hexColor.toLowerCase() : fallback;
}

const PREVIEW_CHECK_INS: GlobeCheckIn[] = [
  {
    id: 'preview-montreal',
    sessionId: 'preview',
    viewerName: 'ViewerOne',
    locationQuery: 'Montreal',
    displayLocation: 'Montreal',
    latitude: 45.5019,
    longitude: -73.5674,
    country: 'Canada',
    region: 'Quebec',
    createdAt: 0,
    updatedAt: 3,
  },
  {
    id: 'preview-los-angeles',
    sessionId: 'preview',
    viewerName: 'StreamFan',
    locationQuery: 'Los Angeles',
    displayLocation: 'Los Angeles',
    latitude: 34.0549,
    longitude: -118.2426,
    country: 'United States',
    region: 'California',
    createdAt: 0,
    updatedAt: 2,
  },
  {
    id: 'preview-london',
    sessionId: 'preview',
    viewerName: 'ChatCrew',
    locationQuery: 'London',
    displayLocation: 'London',
    latitude: 51.5072,
    longitude: -0.1276,
    country: 'United Kingdom',
    createdAt: 0,
    updatedAt: 1,
  },
];

function loadStoredConfig(): GlobeConfig {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);

    if (!stored) {
      return {
        ...DEFAULT_GLOBE_CONFIG,
        sessionId: createGlobeSessionId(),
      };
    }

    const parsed = JSON.parse(stored) as Partial<GlobeConfig>;
    const channel = normalizeTwitchChannel(parsed.channel ?? '');

    return {
      ...DEFAULT_GLOBE_CONFIG,
      ...parsed,
      channel,
      rotationSpeed: DEFAULT_GLOBE_CONFIG.rotationSpeed,
      sessionId: getGlobeSessionId(channel, parsed.sessionId),
    };
  } catch {
    return {
      ...DEFAULT_GLOBE_CONFIG,
      sessionId: createGlobeSessionId(),
    };
  }
}

export function GlobeSettingsPage() {
  const canUseTestingTools =
    import.meta.env.DEV || LOCAL_HOSTNAMES.has(window.location.hostname);
  const [config, setConfig] = useState<GlobeConfig>(() => loadStoredConfig());
  const [twitchIdentity, setTwitchIdentity] = useState<TwitchIdentity | null>(null);
  const [checkingTwitch, setCheckingTwitch] = useState(true);
  const [twitchError, setTwitchError] = useState<string | null>(null);
  const [savedConfig, setSavedConfig] = useState<GlobeConfig | null>(null);
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  const [saveError, setSaveError] = useState<string | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [clearStatus, setClearStatus] = useState<'idle' | 'clearing' | 'cleared' | 'failed'>(
    'idle',
  );
  const [testStatus, setTestStatus] = useState<
    'idle' | 'adding' | 'removing' | 'added' | 'removed' | 'empty' | 'failed'
  >('idle');
  const [localPreviewCheckIns, setLocalPreviewCheckIns] = useState<GlobeCheckIn[]>([]);
  const [localGlobeRotationX, setLocalGlobeRotationX] = useState(0);
  const [localGlobeRotationZ, setLocalGlobeRotationZ] = useState(0);
  const [testFocusCheckIn, setTestFocusCheckIn] = useState<{
    checkIn: GlobeCheckIn;
    requestId: number;
  } | null>(null);
  const testFocusRequestIdRef = useRef(0);
  const hasChannel = /^[a-z0-9_]+$/.test(config.channel);
  const overlayUrl = useMemo(
    () => savedConfig ? buildGlobeOverlayUrl(savedConfig) : '',
    [savedConfig],
  );
  const hasUnsavedChanges = !savedConfig || (
    config.channel !== savedConfig.channel ||
    config.animateCheckIns !== savedConfig.animateCheckIns ||
    config.zoomAnimation !== savedConfig.zoomAnimation ||
    config.showLabels !== savedConfig.showLabels ||
    config.transparent !== savedConfig.transparent ||
    config.globeColor !== savedConfig.globeColor
  );
  const canSave = hasChannel && twitchIdentity?.login === config.channel && !checkingTwitch;
  const previewCheckIns = canUseTestingTools ? localPreviewCheckIns : PREVIEW_CHECK_INS;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  useEffect(() => {
    let active = true;

    void completeTwitchConnect()
      .then(async (identity) => {
        if (!active) return;
        setTwitchIdentity(identity);

        if (identity) {
          const channel = identity.login;
          setConfig((current) => ({ ...current, channel, sessionId: channel }));
          const saved = await fetchGlobeProfile(channel);
          if (active && saved) {
            setConfig(saved);
            setSavedConfig(saved);
          }
        }
      })
      .catch((error: unknown) => {
        if (active) {
          setTwitchError(error instanceof Error ? error.message : 'Unable to connect to Twitch. Please try again.');
        }
      })
      .finally(() => {
        if (active) setCheckingTwitch(false);
      });

    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (!twitchIdentity) return;
    let active = true;
    const interval = window.setInterval(() => {
      void refreshTwitchConnectToken().then((valid) => {
        if (active && !valid) {
          setTwitchIdentity(null);
          setTwitchError('Your Twitch connection has expired. Connect again to save changes.');
        }
      });
    }, 60 * 60 * 1000);
    return () => { active = false; window.clearInterval(interval); };
  }, [twitchIdentity]);

  useEffect(() => {
    if (!canUseTestingTools) {
      return;
    }

    const controller = new AbortController();

    void fetchGlobeCheckIns(config.sessionId, controller.signal)
      .then(setLocalPreviewCheckIns)
      .catch(() => {
        if (!controller.signal.aborted) {
          setTestStatus('failed');
        }
      });

    return () => controller.abort();
  }, [canUseTestingTools, config.sessionId]);

  useEffect(() => {
    if (copyStatus === 'idle') {
      return;
    }

    const timeoutId = window.setTimeout(() => setCopyStatus('idle'), 1_500);
    return () => window.clearTimeout(timeoutId);
  }, [copyStatus]);

  useEffect(() => {
    if (clearStatus !== 'cleared') {
      return;
    }

    const timeoutId = window.setTimeout(() => setClearStatus('idle'), 1_500);
    return () => window.clearTimeout(timeoutId);
  }, [clearStatus]);

  async function copyOverlayUrl() {
    if (!overlayUrl) {
      return;
    }

    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  function connectTwitch() {
    try {
      setTwitchError(null);
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      window.location.assign(buildTwitchConnectUrl());
    } catch (error) {
      setTwitchError(error instanceof Error ? error.message : 'Unable to start Twitch sign-in. Please try again.');
    }
  }

  async function saveSettings() {
    if (!canSave || saveStatus === 'saving') return;
    const token = getTwitchConnectToken();
    if (!token) {
      setSaveError('Reconnect with Twitch before saving your globe settings.');
      setSaveStatus('failed');
      return;
    }
    setSaveStatus('saving');
    setSaveError(null);
    try {
      const saved = await saveGlobeProfile(config, token);
      setSavedConfig(saved);
      setSaveStatus('saved');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Unable to save globe settings.');
      setSaveStatus('failed');
    }
  }

  async function clearCurrentSession() {
    setClearStatus('clearing');

    try {
      await clearGlobeSession(config.sessionId);
      setClearStatus('cleared');
      setLocalPreviewCheckIns([]);
      setTestFocusCheckIn(null);
    } catch {
      setClearStatus('failed');
    }
  }

  async function addTestUser() {
    setTestStatus('adding');

    try {
      const checkIns = await fetchGlobeCheckIns(config.sessionId);
      const usedNumbers = new Set(
        checkIns
          .map((checkIn) => {
            const match = checkIn.viewerName.match(/^TestViewer(\d+)$/);
            return match ? Number(match[1]) : null;
          })
          .filter((value): value is number => value !== null),
      );
      let testNumber = 1;

      while (usedNumbers.has(testNumber)) {
        testNumber += 1;
      }

      const location = TEST_LOCATIONS[(testNumber - 1) % TEST_LOCATIONS.length];
      const checkIn = await submitGlobeCheckIn(
        config.sessionId,
        `${TEST_VIEWER_PREFIX}${testNumber}`,
        location,
      );

      if (checkIn) {
        if (config.animateCheckIns || config.zoomAnimation) {
          testFocusRequestIdRef.current += 1;
          setTestFocusCheckIn({
            checkIn,
            requestId: testFocusRequestIdRef.current,
          });
        } else {
          setLocalPreviewCheckIns((current) => [
            checkIn,
            ...current.filter(
              (existing) =>
                existing.viewerName.toLowerCase() !== checkIn.viewerName.toLowerCase(),
            ),
          ]);
          setTestStatus('added');
        }
      } else {
        setTestStatus('failed');
      }
    } catch {
      setTestStatus('failed');
    }
  }

  async function removeTestUser() {
    setTestStatus('removing');

    try {
      const checkIns = await fetchGlobeCheckIns(config.sessionId);
      const testCheckIn = checkIns.find((checkIn) =>
        checkIn.viewerName.startsWith(TEST_VIEWER_PREFIX),
      );

      if (!testCheckIn) {
        setTestStatus('empty');
        return;
      }

      await removeGlobeCheckIn(config.sessionId, testCheckIn.viewerName);
      setLocalPreviewCheckIns((current) =>
        current.filter((checkIn) => checkIn.id !== testCheckIn.id),
      );
      setTestStatus('removed');
    } catch {
      setTestStatus('failed');
    }
  }

  return (
    <main className="settings-page globe-settings-page">
      <header className="settings-header">
        <a className="breadcrumb-link" href="../">
          <span aria-hidden="true">←</span>
          All tools
        </a>
        <p className="eyebrow">Keylight Stream Tools</p>
        <h1>Globe Check-In</h1>
        <p className="header-copy">
          Add a rotating viewer map to OBS. Viewers can type{' '}
          <strong>!checkin Montreal</strong> in Twitch chat to place their name on
          the globe.
        </p>
        <div className="header-meta">
          <a className="ghost-link" href="../game-score/">
            Game Score
          </a>
        </div>
      </header>

      <div className="settings-layout">
        <section className="settings-panel">
          <div className="panel-heading">
            <span className="panel-step" aria-hidden="true">01</span>
            <div>
              <p className="panel-kicker">Configure</p>
              <h2>Set up the globe</h2>
              <p>Connect a channel, then choose how its check-ins appear.</p>
            </div>
          </div>
          <div className="globe-session-card">
            <p className="supporter-label">Twitch connection</p>
            <p className="supporter-copy">
              {twitchIdentity
                ? `Channel selected from Twitch: ${twitchIdentity.login}.`
                : 'Connect with Twitch to automatically select your channel.'}
            </p>
            <button
              className="secondary-button full-width-button"
              type="button"
              disabled={checkingTwitch || !isTwitchConnectConfigured()}
              onClick={connectTwitch}
            >
              {checkingTwitch ? 'Checking Twitch connection…'
                : twitchIdentity ? 'Switch Twitch account' : 'Connect with Twitch'}
            </button>
            {!isTwitchConnectConfigured() ? (
              <p className="helper-text">Twitch connection is currently unavailable.</p>
            ) : null}
            {twitchError ? <p className="helper-text helper-error" role="alert">{twitchError}</p> : null}
          </div>
          <label className="field">
            <span>Twitch channel</span>
            <input
              className="admin-input"
              value={config.channel}
              placeholder="Connect with Twitch to select your channel"
              readOnly
            />
            <span className="field-hint">
              Selected from your Twitch account. Connect again to switch channels.
            </span>
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.showLabels}
              disabled={checkingTwitch || saveStatus === 'saving'}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  showLabels: event.target.checked,
                }))
              }
            />
            Show viewer labels
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.animateCheckIns}
              disabled={checkingTwitch || saveStatus === 'saving'}
              onChange={(event) => {
                const animateCheckIns = event.target.checked;
                setConfig((current) => ({
                  ...current,
                  animateCheckIns,
                }));

                if (!animateCheckIns && !config.zoomAnimation) {
                  setTestFocusCheckIn((current) => {
                    if (current) {
                      setLocalPreviewCheckIns((checkIns) => [
                        current.checkIn,
                        ...checkIns.filter(
                          (existing) =>
                            existing.viewerName.toLowerCase() !==
                            current.checkIn.viewerName.toLowerCase(),
                        ),
                      ]);
                      setTestStatus('added');
                    }

                    return null;
                  });
                }
              }}
            />
            Animate new check-ins
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.zoomAnimation}
              disabled={checkingTwitch || saveStatus === 'saving'}
              onChange={(event) => setConfig((current) => ({
                ...current,
                zoomAnimation: event.target.checked,
              }))}
            />
            Zoom animation
          </label>
          <p className="field-hint">Zoom toward new check-ins, then return to the normal view.</p>

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.transparent}
              disabled={checkingTwitch || saveStatus === 'saving'}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  transparent: event.target.checked,
                }))
              }
            />
            Transparent OBS background
          </label>

          <label className="field">
            <span>Globe color</span>
            <input
              className="admin-input"
              type="color"
              disabled={checkingTwitch || saveStatus === 'saving'}
              value={config.globeColor}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  globeColor: normalizeColorInput(
                    event.target.value,
                    current.globeColor || DEFAULT_GLOBE_CONFIG.globeColor,
                  ),
                }))
              }
            />
            <span className="field-hint">
              Pick the default globe accent color for borders, fills, and light spots.
            </span>
          </label>

          <button
            className="secondary-button full-width-button globe-clear-button"
            type="button"
            disabled={clearStatus === 'clearing'}
            onClick={clearCurrentSession}
          >
            {clearStatus === 'clearing' ? 'Clearing' : 'Clear channel markers'}
          </button>

          {clearStatus === 'failed' ? (
            <p className="helper-text helper-error">Unable to clear this session.</p>
          ) : null}
          {clearStatus === 'cleared' ? (
            <p className="helper-text">Current session markers cleared.</p>
          ) : null}

          {canUseTestingTools ? (
            <div className="globe-test-tools">
              <p className="supporter-label">Local testing</p>
              <label className="field">
                <div className="field-header">
                  <span>Globe X rotation</span>
                  <span className="field-value">{localGlobeRotationX}°</span>
                </div>
                <input
                  className="range-input"
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={localGlobeRotationX}
                  onChange={(event) =>
                    setLocalGlobeRotationX(Number(event.target.value))
                  }
                />
              </label>
              <label className="field">
                <div className="field-header">
                  <span>Globe Z rotation</span>
                  <span className="field-value">{localGlobeRotationZ}°</span>
                </div>
                <input
                  className="range-input"
                  type="range"
                  min="-45"
                  max="45"
                  step="1"
                  value={localGlobeRotationZ}
                  onChange={(event) =>
                    setLocalGlobeRotationZ(Number(event.target.value))
                  }
                />
              </label>
              <div className="globe-session-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={testStatus === 'adding' || testStatus === 'removing'}
                  onClick={addTestUser}
                >
                  {testStatus === 'adding' ? 'Adding' : 'Add test user'}
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={testStatus === 'adding' || testStatus === 'removing'}
                  onClick={removeTestUser}
                >
                  {testStatus === 'removing' ? 'Removing' : 'Remove test user'}
                </button>
              </div>
              {testStatus === 'added' ? (
                <p className="helper-text">Test user added to this session.</p>
              ) : null}
              {testStatus === 'removed' ? (
                <p className="helper-text">Newest test user removed.</p>
              ) : null}
              {testStatus === 'empty' ? (
                <p className="helper-text">No test users remain.</p>
              ) : null}
              {testStatus === 'failed' ? (
                <p className="helper-text helper-error">
                  Unable to update test users.
                </p>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="preview-panel globe-link-panel">
          <div className="panel-heading panel-heading-preview">
            <span className="panel-step" aria-hidden="true">02</span>
            <div>
              <p className="panel-kicker">Go live</p>
              <h2>Preview &amp; publish</h2>
              <p>Save your settings, then copy your permanent browser-source URL.</p>
            </div>
          </div>
          <div>
            <p className="eyebrow">OBS Browser Source</p>
            <h3>Overlay URL</h3>
            <p className="header-copy">
              Add this URL to OBS once. Save changes here to update your globe
              without replacing the link.
            </p>
          </div>
          <button
            className="primary-button"
            type="button"
            disabled={!canSave || !hasUnsavedChanges || saveStatus === 'saving'}
            onClick={saveSettings}
          >
            {saveStatus === 'saving' ? 'Saving…' : 'Save changes'}
          </button>
          {saveError ? <p className="helper-text helper-error" role="alert">{saveError}</p> : null}
          {savedConfig ? (
            <p className="helper-text" role="status">
              {hasUnsavedChanges ? 'You have unsaved changes.' : 'Settings saved. OBS updates automatically within a few seconds.'}
            </p>
          ) : null}
          <textarea
            className="globe-overlay-url"
            aria-label="Globe overlay URL"
            readOnly
            value={overlayUrl}
            placeholder="Connect with Twitch and save your settings to get your permanent OBS link."
            rows={2}
          />
          <button className="primary-button" type="button" disabled={!overlayUrl} onClick={copyOverlayUrl}>
            {copyStatus === 'copied' ? 'Copied' : 'Copy overlay URL'}
          </button>
          {!overlayUrl ? (
            <p className="helper-text">Connect with Twitch and save your settings before copying your OBS link.</p>
          ) : null}
          {copyStatus === 'failed' ? (
            <p className="helper-text helper-error">
              Clipboard access failed. Select the URL field manually.
            </p>
          ) : null}
          <div className="globe-preview-frame" aria-label="Globe overlay preview">
            <GlobeScene
              checkIns={previewCheckIns}
              config={{
                ...config,
                showLabels: config.showLabels,
                transparent: false,
              }}
              className="globe-preview-canvas"
              focusCheckIn={testFocusCheckIn}
              globeTiltX={localGlobeRotationX * (Math.PI / 180)}
              globeTiltZ={localGlobeRotationZ * (Math.PI / 180)}
              onFocusMarkerPlace={(checkIn) => {
                setLocalPreviewCheckIns((current) => [
                  checkIn,
                  ...current.filter(
                    (existing) =>
                      existing.viewerName.toLowerCase() !==
                      checkIn.viewerName.toLowerCase(),
                  ),
                ]);
                setTestStatus('added');
              }}
              onFocusComplete={(checkIn) => {
                setTestFocusCheckIn((current) =>
                  current?.checkIn.id === checkIn.id ? null : current,
                );
              }}
            />
          </div>
          <div className="globe-session-card">
            <p className="supporter-label">Current command</p>
            <p className="supporter-copy">
              Viewers type <strong>!checkin city</strong> in #{config.channel || 'channel'}.
              The broadcaster can clear the globe with{' '}
              <strong>!checkin reset</strong>.
            </p>
          </div>
        </section>
      </div>
    </main>
  );
}
