import { useEffect, useState } from 'react';
import { Dancefloor } from '../components/Dancefloor';
import { dancefloorRequest } from '../lib/dancefloorClient';
import { type DancefloorSnapshot } from '../lib/dancefloor';
export function DancefloorOverlayPage() {
  const [snapshot, setSnapshot] = useState<DancefloorSnapshot>();
  const [clock, setClock] = useState(Date.now());
  const [offset, setOffset] = useState(0);
  const channel = new URLSearchParams(window.location.hash.slice(1)).get('channel') ?? new URLSearchParams(window.location.search).get('channel') ?? '';
  useEffect(() => {
    let stopped = false; let timer: ReturnType<typeof setTimeout>; let retries = 0;
    const controller = new AbortController();
    const poll = async () => {
      try {
        const next = await dancefloorRequest<DancefloorSnapshot>(`/channels/${encodeURIComponent(channel)}/snapshot`, 'GET', undefined, controller.signal);
        if (!stopped) { setSnapshot(next); setOffset(next.serverTime - Date.now()); retries = 0; }
      } catch { retries++; }
      if (!stopped) timer = setTimeout(poll, Math.min(30000, 2000 * 2 ** Math.min(retries, 4)));
    };
    void poll();
    const clockTimer = setInterval(() => setClock(Date.now()), 250);
    return () => { stopped = true; controller.abort(); clearTimeout(timer); clearInterval(clockTimer); };
  }, [channel]);
  if (!snapshot) return null;
  return <Dancefloor config={snapshot.config} dancers={snapshot.dancers.filter(d => d.expiresAt > clock + offset)}/>;
}
