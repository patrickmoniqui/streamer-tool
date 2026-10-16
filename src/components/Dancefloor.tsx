import { useEffect, useId, useState, type CSSProperties } from 'react';
import { dancerSeed, type DancefloorConfig, type DancefloorDancer } from '../lib/dancefloor';
import { DANCEFLOOR_MOVES, type DancePose } from '../lib/dancefloorMoves';
function jointStyle(poses: readonly DancePose[], joint: number): CSSProperties {
  return Object.fromEntries(poses.map((pose, i) => [`--pose-${i}`, `${pose[joint]}deg`])) as CSSProperties;
}
function Limb({ x, y, joint, poses, length }: { x: number; y: number; joint: number; poses: readonly DancePose[]; length: number }) {
  return <g transform={`translate(${x} ${y})`}><g className="dance-joint" style={jointStyle(poses, joint)}>
    <path d={`M0 0V${length}`}/>
    <g transform={`translate(0 ${length})`}><g className="dance-joint" style={jointStyle(poses, joint + 1)}><path d={`M0 0V${length}`}/></g></g>
  </g></g>;
}
function Dancer({ dancer, config }: { dancer: DancefloorDancer; config: DancefloorConfig }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [dancer.avatarUrl]);
  const clipId = useId().replace(/:/g, '');
  const seed = dancerSeed(`${dancer.id}:${dancer.enteredAt}`);
  const move = DANCEFLOOR_MOVES[seed % DANCEFLOOR_MOVES.length];
  const style = {
    '--phase': `${-(seed % 100) / 100 * move.seconds}s`, '--dance-cycle': `${move.seconds}s`,
    '--stick-color': dancer.chatColor && /^#[a-f\d]{6}$/i.test(dancer.chatColor) ? dancer.chatColor : `hsl(${dancerSeed(dancer.id) % 360} 75% 78%)`,
    ...Object.fromEntries(move.tilt.map((angle, i) => [`--tilt-${i}`, `${angle}deg`])),
    ...Object.fromEntries(move.bounce.map((offset, i) => [`--bounce-${i}`, `${offset}px`])),
  } as CSSProperties;
  return <div className="dance-person dance-stick-figure" style={style} data-dance={move.name}>
    <svg className="dance-figure" viewBox="0 0 120 166" role="img" aria-label={`${dancer.name} dancing ${move.name}`}>
      <defs><clipPath id={clipId}><circle cx="60" cy="25" r="18"/></clipPath></defs>
      <g className="dance-rig">
        <g className="dance-bones" fill="none" strokeLinecap="round" strokeLinejoin="round">
          <path d="M60 44V96"/>
          <Limb x={60} y={55} joint={0} poses={move.poses} length={22}/>
          <Limb x={60} y={55} joint={2} poses={move.poses} length={22}/>
          <Limb x={60} y={96} joint={4} poses={move.poses} length={25}/>
          <Limb x={60} y={96} joint={6} poses={move.poses} length={25}/>
        </g>
        <circle className="dance-head" cx="60" cy="25" r="18"/>
        {dancer.avatarUrl && !failed
          ? <image href={dancer.avatarUrl} x="42" y="7" width="36" height="36" clipPath={`url(#${clipId})`} preserveAspectRatio="xMidYMid slice" onError={() => setFailed(true)}/>
          : <g className="dance-face" fill="currentColor"><circle cx="54" cy="23" r="1.6"/><circle cx="66" cy="23" r="1.6"/><path d="M54 30Q60 35 66 30" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/></g>}
      </g>
    </svg>
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
