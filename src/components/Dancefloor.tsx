import { useEffect, useState, type CSSProperties } from 'react';
import { dancerSeed, type DancefloorConfig, type DancefloorDancer } from '../lib/dancefloor';
function Dancer({ dancer, config }: { dancer: DancefloorDancer; config: DancefloorConfig }) {
  const [failed, setFailed] = useState(false);
  const seed = dancerSeed(dancer.id);
  return <div className="dance-person dance-avatar-only" style={{ '--phase': `${-(seed % 40) / 10}s`, '--dance-cycle': `${4.8 + (seed % 4) * .4}s` } as CSSProperties}>
    <div className="dance-avatar">{dancer.avatarUrl && !failed ? <img src={dancer.avatarUrl} alt="" onError={() => setFailed(true)} referrerPolicy="no-referrer"/> : <svg viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="18" r="9" fill="currentColor"/><path d="M8 44v-6c0-16 32-16 32 0v6" fill="currentColor"/></svg>}</div>
    {config.showNames && <span className="dance-name">{dancer.name}</span>}
  </div>;
}
export function Dancefloor({ dancers, config }: { dancers: DancefloorDancer[]; config: DancefloorConfig }) {
  const [visible, setVisible] = useState<Array<{ dancer: DancefloorDancer; leavingAt?: number }>>(() => dancers.map(dancer => ({ dancer })));
  useEffect(() => {
    const incoming = new Set(dancers.map(d => `${d.id}:${d.enteredAt}`));
    setVisible(previous => [
      ...dancers.map(dancer => ({ dancer })),
      ...previous.filter(v => !incoming.has(`${v.dancer.id}:${v.dancer.enteredAt}`)).map(v => ({ ...v, leavingAt: v.leavingAt ?? Date.now() })),
    ]);
  }, [dancers]);
  useEffect(() => {
    const deadlines = visible.flatMap(v => v.leavingAt === undefined ? [] : [v.leavingAt + 450]);
    if (!deadlines.length) return;
    const timer = setTimeout(() => setVisible(previous => previous.filter(v => v.leavingAt === undefined || v.leavingAt + 450 > Date.now())), Math.max(0, Math.min(...deadlines) - Date.now()));
    return () => clearTimeout(timer);
  }, [visible]);
  return <div className={`dance-scene ${config.transparent ? 'dance-transparent' : 'dance-background'} ${config.showFloor ? 'dance-with-floor' : ''}`} style={{ '--dancer-size': `${config.dancerSize}px`, '--dance-accent': config.accentColor } as CSSProperties}>
    <div className="dance-crowd">{visible.map(({ dancer: d, leavingAt }) => <div className={`dance-slot${leavingAt === undefined ? '' : ' dance-leaving'}`} key={`${d.id}:${d.enteredAt}`}><Dancer dancer={d} config={config}/></div>)}</div>
  </div>;
}
