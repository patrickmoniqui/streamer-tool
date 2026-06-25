import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_GLOBE_CONFIG,
  buildGlobeOverlayUrl,
  clearGlobeSession,
  createGlobeSessionId,
  fetchGlobeCheckIns,
  normalizeTwitchChannel,
  removeGlobeCheckIn,
  submitGlobeCheckIn,
  type GlobeCheckIn,
  type GlobeConfig,
} from '../lib/globe';
import { GlobeScene } from './GlobeOverlayPage';

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

    return {
      ...DEFAULT_GLOBE_CONFIG,
      ...parsed,
      channel: normalizeTwitchChannel(parsed.channel ?? ''),
      sessionId: parsed.sessionId || createGlobeSessionId(),
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
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const [clearStatus, setClearStatus] = useState<'idle' | 'clearing' | 'cleared' | 'failed'>(
    'idle',
  );
  const [testStatus, setTestStatus] = useState<
    'idle' | 'adding' | 'removing' | 'added' | 'removed' | 'empty' | 'failed'
  >('idle');
  const [localPreviewCheckIns, setLocalPreviewCheckIns] = useState<GlobeCheckIn[]>([]);
  const [testFocusCheckIn, setTestFocusCheckIn] = useState<{
    checkIn: GlobeCheckIn;
    requestId: number;
  } | null>(null);
  const testFocusRequestIdRef = useRef(0);
  const overlayUrl = useMemo(() => buildGlobeOverlayUrl(config), [config]);
  const previewCheckIns = canUseTestingTools ? localPreviewCheckIns : PREVIEW_CHECK_INS;

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

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
    try {
      await navigator.clipboard.writeText(overlayUrl);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
  }

  function startNewSession() {
    setConfig((current) => ({
      ...current,
      sessionId: createGlobeSessionId(),
    }));
    setClearStatus('idle');
    setTestStatus('idle');
    setLocalPreviewCheckIns([]);
    setTestFocusCheckIn(null);
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
        if (config.animateCheckIns) {
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
          <a className="ghost-link" href="../">
            All tools
          </a>
        </div>
      </header>

      <div className="settings-layout">
        <section className="settings-panel">
          <label className="field">
            <span>Twitch channel</span>
            <input
              className="admin-input"
              value={config.channel}
              placeholder="djmoneykey"
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  channel: normalizeTwitchChannel(event.target.value),
                }))
              }
            />
            <span className="field-hint">
              Use the channel login only. The overlay listens anonymously for
              public chat messages.
            </span>
          </label>

          <label className="field">
            <div className="field-header">
              <span>Rotation speed</span>
              <span className="field-value">{config.rotationSpeed.toFixed(2)}</span>
            </div>
            <input
              className="range-input"
              type="range"
              min="0"
              max="0.6"
              step="0.02"
              value={config.rotationSpeed}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  rotationSpeed: Number(event.target.value),
                }))
              }
            />
          </label>

          <label className="toggle">
            <input
              type="checkbox"
              checked={config.showLabels}
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
              onChange={(event) => {
                const animateCheckIns = event.target.checked;
                setConfig((current) => ({
                  ...current,
                  animateCheckIns,
                }));

                if (!animateCheckIns) {
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
              checked={config.transparent}
              onChange={(event) =>
                setConfig((current) => ({
                  ...current,
                  transparent: event.target.checked,
                }))
              }
            />
            Transparent OBS background
          </label>

          <div className="globe-session-actions">
            <button className="secondary-button" type="button" onClick={startNewSession}>
              New session
            </button>
            <button
              className="secondary-button"
              type="button"
              disabled={clearStatus === 'clearing'}
              onClick={clearCurrentSession}
            >
              {clearStatus === 'clearing' ? 'Clearing' : 'Clear markers'}
            </button>
          </div>

          {clearStatus === 'failed' ? (
            <p className="helper-text helper-error">Unable to clear this session.</p>
          ) : null}
          {clearStatus === 'cleared' ? (
            <p className="helper-text">Current session markers cleared.</p>
          ) : null}

          {canUseTestingTools ? (
            <div className="globe-test-tools">
              <p className="supporter-label">Local testing</p>
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
          <div>
            <p className="eyebrow">OBS Browser Source</p>
            <h2>Overlay URL</h2>
            <p className="header-copy">
              Add this URL as a browser source. Keep the session ID private if you
              want to control when the map resets.
            </p>
          </div>
          <textarea className="globe-overlay-url" readOnly value={overlayUrl} rows={5} />
          <button className="primary-button" type="button" onClick={copyOverlayUrl}>
            {copyStatus === 'copied' ? 'Copied' : 'Copy overlay URL'}
          </button>
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
