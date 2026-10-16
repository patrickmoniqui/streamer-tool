import { useEffect, useRef, useState } from 'react';
import { connectBrowserTwitch } from '../lib/twitchBrowserConnect';
import { getBrowserTwitchIdentity, subscribeBrowserTwitch } from '../lib/twitchConnect';
import { TwitchConnection } from '../components/TwitchConnection';
import { useDancefloorEvents } from '../lib/useDancefloorEvents';
import { Dancefloor } from '../components/Dancefloor';
import { dancefloorRequest } from '../lib/dancefloorClient';
import { DEFAULT_DANCEFLOOR_CONFIG, validateDancefloorConfig, DANCE_TRIGGERS, dancefloorOverlayUrl, type DancefloorConfig, type DancefloorDancer, type DancefloorSnapshot, type DanceTrigger } from '../lib/dancefloor';
interface Account { login: string; transport: 'websocket'; config: DancefloorConfig; snapshot: DancefloorSnapshot }
interface Reward { id: string; title: string; is_enabled: boolean }
const LABELS: Record<DanceTrigger, string> = { reward: 'Channel point reward', bits: 'Bits cheer', sub: 'New subscription', resub: 'Resub announcement', gift: 'Gift giver (once per batch)' };
function demoDancers(): DancefloorDancer[] { return ['Moonwalker', 'DiscoDuck', 'GrooveGoblin', 'NeonNinja', 'BoogieBot', 'TinyDancer'].map((name, i) => ({ id: `preview:${i}`, name, avatarUrl: '', enteredAt: Date.now(), expiresAt: Date.now() + 60000 })); }
export function DancefloorSettingsPage() {
  const [browserIdentity, setBrowserIdentity] = useState(getBrowserTwitchIdentity);
  useEffect(() => subscribeBrowserTwitch(() => setBrowserIdentity(getBrowserTwitchIdentity())), []);
  const [config, setConfig] = useState<DancefloorConfig>(structuredClone(DEFAULT_DANCEFLOOR_CONFIG));
  const [account, setAccount] = useState<Account>();
  const [rewards, setRewards] = useState<Reward[]>([]);
  const [rewardError, setRewardError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [simulation, setSimulation] = useState(false);
  const [dancers, setDancers] = useState<DancefloorDancer[]>(demoDancers);
  const [saved, setSaved] = useState(false);
  const eventStatus = useDancefloorEvents(browserIdentity, account?.login === browserIdentity?.login ? account?.config : undefined);
  const accountRef = useRef(account); accountRef.current = account;
  const loadAccount = async (loadConfig = false) => {
    const next = await dancefloorRequest<Account>('/me');
    setAccount(next); setSaved(true);
    if (loadConfig) setConfig(next.config);
    return next;
  };
  useEffect(() => {
    let stopped = false;
    void dancefloorRequest<Account>('/me').then(next => {
      if (stopped) return;
      setAccount(next); setConfig(next.config); setSaved(true);
      void dancefloorRequest<Reward[]>('/me/rewards').then(r => { if (!stopped) setRewards(r); }).catch(e => { if (!stopped) setRewardError(e.message); });
    }).catch(error => { if (!stopped) { setAccount(undefined); if (error.status !== 401) setNotice(error.message); } });
    const interval = setInterval(() => {
      if (accountRef.current) void dancefloorRequest<Account>('/me').then(next => { if (!stopped) setAccount(next); }).catch(() => {});
    }, 5000);
    return () => { stopped = true; clearInterval(interval); };
  }, [browserIdentity]);
  const update = <K extends keyof DancefloorConfig>(key: K, value: DancefloorConfig[K]) => setConfig(c => ({ ...c, [key]: value }));
  const trigger = (key: DanceTrigger, field: 'enabled' | 'durationSeconds', value: boolean | number) => setConfig(c => ({ ...c, triggers: { ...c.triggers, [key]: { ...c.triggers[key], [field]: value } } }));
  const action = async (fn: () => Promise<void>) => {
    setBusy(true); setNotice('');
    try { await fn(); } catch (e) { setNotice((e as Error).message); } finally { setBusy(false); }
  };
  const dirty = account && JSON.stringify(config) !== JSON.stringify(account.config);
  return <main className="dance-settings">
    <header className="dance-header"><a href="../">← All stream tools</a><span>KEYLIGHT STREAM TOOLS</span></header>
    <TwitchConnection/>
    <div className="dance-title"><div><p className="dance-eyebrow">TURN SUPPORT INTO A PARTY</p><h1>Dancefloor</h1><p>Your community, stick figures, and 10 Fortnite-inspired moves.</p></div><span className="dance-beta">Experimental</span></div>
    <div className="dance-layout"><section className="dance-controls" aria-label="Dancefloor settings">
      <div className="dance-panel"><h2>1. Connect your channel</h2><p>Connect Twitch, choose your triggers, and keep this page open while streaming. Events arrive through a direct WebSocket connection.</p>
        <button className="dance-button" disabled={busy} onClick={() => void action(async () => { await connectBrowserTwitch(); })}>{account ? `Switch ${account.login}` : 'Connect with Twitch'}</button>
        <p className="dance-status" role="status" data-event-state={eventStatus.state}>{eventStatus.message}</p>
        {eventStatus.lastEvent && <p role="status">{eventStatus.lastEvent}</p>}
        <p>Closing this page stops new Twitch events. Events missed while disconnected cannot be recovered.</p>
      </div>
      <div className="dance-panel"><h2>2. Choose what starts a dance</h2><p>Each event adds dance time, up to five minutes per viewer. Gift recipients do not join automatically.</p>
        {dirty && <p role="status">Trigger changes are not active yet. Click Save changes before redeeming a reward.</p>}
        {!browserIdentity && <p role="status">Connect with Twitch in section 1 to choose your dance triggers.</p>}
        <fieldset className="dance-trigger-controls" disabled={!browserIdentity} aria-label="Dance triggers">
        {DANCE_TRIGGERS.map(key => <div className="dance-trigger" key={key}>
          <label><input type="checkbox" checked={config.triggers[key].enabled} onChange={e => trigger(key, 'enabled', e.target.checked)}/>{LABELS[key]}</label>
          <label className="dance-seconds"><input aria-label={`${LABELS[key]} duration in seconds`} type="number" min="1" max="300" value={config.triggers[key].durationSeconds} onChange={e => trigger(key, 'durationSeconds', Number(e.target.value))}/> sec</label>
          {key === 'reward' && config.triggers.reward.enabled && <div className="dance-trigger-detail"><label>Existing reward<select value={config.rewardId} onChange={e => update('rewardId', e.target.value)}><option value="">Select a reward</option>{config.rewardId && !rewards.some(r => r.id === config.rewardId) && <option value={config.rewardId}>Saved reward (unavailable)</option>}{rewards.map(r => <option key={r.id} value={r.id} disabled={!r.is_enabled}>{r.title}{!r.is_enabled ? ' (disabled)' : ''}</option>)}</select></label>{rewardError && <p role="status">{rewardError}</p>}</div>}
          {key === 'bits' && config.triggers.bits.enabled && <label className="dance-trigger-detail">Minimum Bits per cheer<input type="number" min="1" max="1000000" value={config.minimumBits} onChange={e => update('minimumBits', Number(e.target.value))}/></label>}
        </div>)}
        </fieldset>
      </div>
      <div className="dance-panel"><h2>3. Make it yours</h2>
        <div className="dance-fields"><label>Dancer size <input type="range" min="48" max="180" value={config.dancerSize} onChange={e => update('dancerSize', Number(e.target.value))}/><small>{config.dancerSize}px</small></label>
          <label>Maximum dancers<input type="number" min="1" max="50" value={config.maxDancers} onChange={e => update('maxDancers', Number(e.target.value))}/></label>
          <label>Accent color<input type="color" value={config.accentColor} onChange={e => update('accentColor', e.target.value)}/></label>
        </div>
        {([['showNames', 'Show usernames'], ['showFloor', 'Show floor graphic'], ['transparent', 'Transparent background']] as const).map(([key, title]) => <label className="dance-check" key={key}><input type="checkbox" checked={config[key]} onChange={e => update(key, e.target.checked)}/>{title}</label>)}
        <button className="dance-button" disabled={busy || !account} onClick={() => void action(async () => { const result = await dancefloorRequest<{ warning?: string }>('/me/profile', 'PUT', validateDancefloorConfig(config)); await loadAccount(); setNotice(result.warning ? `Settings saved. ${result.warning}` : 'Changes saved. OBS will update automatically.'); })}>Save changes{dirty ? ' *' : ''}</button>
        {!account && <p>Connect Twitch to save your settings and get an OBS link.</p>}
      </div>
    </section>
    <aside className="dance-preview-column"><div className="dance-panel dance-preview-panel"><div className="dance-preview-heading"><h2>{account && !simulation ? 'Live floor' : 'Preview'}</h2><span>{account && !simulation ? 'LIVE · SAME DANCERS AS OBS' : 'LOCAL SIMULATION'}</span></div><div className="dance-preview"><Dancefloor config={config} dancers={account && !simulation ? account.snapshot.dancers : dancers.slice(0, config.maxDancers)}/></div>
      <div className="dance-actions"><button onClick={() => { setSimulation(true); setDancers(demoDancers()); }}>Simulate dancers</button><button onClick={() => { setSimulation(true); setDancers(Array.from({ length: config.maxDancers }, (_, i) => ({ id: `crowd:${i}`, name: `Viewer${i + 1}`, avatarUrl: '', enteredAt: Date.now(), expiresAt: Date.now() + 60000 }))); }}>Fill floor</button><button onClick={() => { setSimulation(true); setDancers([]); }}>Clear preview</button>{account && <button onClick={() => setSimulation(false)}>Show live floor</button>}</div><p>{account && !simulation ? 'Real redemptions and Test in OBS appear here. Appearance changes stay here until saved.' : 'Simulated dancers stay here and are never sent to OBS.'} The overlay is silent.</p>
    </div>
    <div className="dance-panel"><h2>4. Add to OBS</h2><p className="dance-status"><strong>Keep this settings tab open while streaming.</strong> The OBS source alone does not receive Twitch events.</p><p>Add a Browser Source at 1920 × 1080. Position or crop the bottom strip to fit your scene.</p>
      {account && saved ? <><label>Permanent browser source URL<input className="dance-url" readOnly value={dancefloorOverlayUrl(account.login)}/></label><div className="dance-actions"><button onClick={() => void action(async () => { await navigator.clipboard.writeText(dancefloorOverlayUrl(account.login)); setNotice('OBS URL copied.'); })}>Copy OBS URL</button><a href={dancefloorOverlayUrl(account.login)} target="_blank" rel="noreferrer">Open overlay ↗</a></div>
        <p className="dance-status">{account.snapshot.dancers.length} dancing · {account.snapshot.queueCount} waiting · {account.snapshot.droppedCount} dropped / expired in queue</p>
        <div className="dance-actions"><button disabled={busy} onClick={() => void action(async () => { await dancefloorRequest('/me/test', 'POST', {}); await loadAccount(); setNotice('Test dancer sent to OBS using saved settings.'); })}>Test in OBS</button><button disabled={busy} onClick={() => void action(async () => { await dancefloorRequest('/me/clear', 'POST', {}); await loadAccount(); setNotice('Live floor and queue cleared.'); })}>Clear live floor</button></div></> : <p className="dance-muted">Your permanent link appears after connecting Twitch.</p>}
      <p className="dance-muted">Up to 100 viewers can wait for a space for two minutes. Dance time continues while OBS is closed.</p>
    </div>
    {notice && <div className="dance-notice" role="status">{notice}</div>}
    </aside></div>
  </main>;
}
