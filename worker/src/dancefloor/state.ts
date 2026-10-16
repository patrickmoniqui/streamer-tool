import { DEFAULT_DANCEFLOOR_CONFIG, type DancefloorConfig, type DancefloorDancer, type DancefloorSnapshot, type DanceTrigger } from '../../../src/lib/dancefloor';
export interface DanceEvent { id: string; viewerId: string; name: string; avatarUrl: string; chatColor?: string; durationSeconds: number; occurredAt: number }
interface Waiting { viewerId: string; name: string; avatarUrl: string; chatColor?: string; durationSeconds: number; deadline: number }
export interface FloorState {
  config: DancefloorConfig; dancers: DancefloorDancer[]; queue: Waiting[];
  seen: Record<string, number>; revision: number; droppedCount: number;
}
export function initialFloor(): FloorState {
  return { config: structuredClone(DEFAULT_DANCEFLOOR_CONFIG), dancers: [], queue: [], seen: {}, revision: 0, droppedCount: 0 };
}
// Advance in chronological order, including when an object wakes after a long idle period.
export function advanceFloor(s: FloorState, now: number): void {
  let changed = false;
  const admit = (at: number) => {
    const valid = s.queue.filter(q => q.deadline > at);
    if (valid.length !== s.queue.length) { s.droppedCount += s.queue.length - valid.length; changed = true; }
    s.queue = valid;
    while (s.dancers.length < s.config.maxDancers && s.queue.length) {
      const q = s.queue.shift()!;
      s.dancers.push({ id: q.viewerId, name: q.name, avatarUrl: q.avatarUrl, chatColor: q.chatColor, enteredAt: at, expiresAt: at + q.durationSeconds * 1000 });
      changed = true;
    }
  };
  while (s.dancers.some(d => d.expiresAt <= now)) {
    const at = Math.min(...s.dancers.map(d => d.expiresAt));
    s.dancers = s.dancers.filter(d => d.expiresAt > at);
    changed = true; admit(at);
  }
  admit(now);
  for (const [id, expiry] of Object.entries(s.seen)) if (expiry <= now) delete s.seen[id];
  if (changed) s.revision++;
}
export function applyDanceEvent(s: FloorState, e: DanceEvent, now: number): void {
  advanceFloor(s, now);
  if (s.seen[e.id]) return;
  s.seen[e.id] = now + 24 * 60 * 60 * 1000;
  // Delayed notifications must not resurrect expired dancers.
  const duration = Math.min(300, e.durationSeconds);
  const remaining = duration * 1000 - Math.max(0, now - e.occurredAt);
  if (remaining <= 0) return;
  const dancer = s.dancers.find(d => d.id === e.viewerId);
  const queued = s.queue.find(q => q.viewerId === e.viewerId);
  if (e.chatColor) {
    if (dancer) dancer.chatColor = e.chatColor;
    if (queued) queued.chatColor = e.chatColor;
  }
  if (dancer) dancer.expiresAt = Math.min(now + 300000, dancer.expiresAt + remaining);
  else if (queued) queued.durationSeconds = Math.min(300, queued.durationSeconds + remaining / 1000);
  else if (s.dancers.length < s.config.maxDancers) s.dancers.push({ id: e.viewerId, name: e.name, avatarUrl: e.avatarUrl, chatColor: e.chatColor, enteredAt: now, expiresAt: now + remaining });
  else if (s.queue.length < 100) s.queue.push({ viewerId: e.viewerId, name: e.name, avatarUrl: e.avatarUrl, chatColor: e.chatColor, durationSeconds: duration, deadline: now + 120000 });
  else s.droppedCount++;
  s.revision++;
}
export function floorSnapshot(s: FloorState, now: number): DancefloorSnapshot {
  advanceFloor(s, now);
  return { config: s.config, dancers: s.dancers, queueCount: s.queue.length, droppedCount: s.droppedCount, revision: s.revision, serverTime: now };
}
export function qualifyingTrigger(config: DancefloorConfig, type: string, event: Record<string, any>): DanceTrigger | null {
  let trigger: DanceTrigger | null = null;
  if (type === 'channel.channel_points_custom_reward_redemption.add' && event.reward?.id === config.rewardId) trigger = 'reward';
  if (type === 'channel.cheer' && event.bits >= config.minimumBits) trigger = 'bits';
  if (type === 'channel.subscribe' && !event.is_gift) trigger = 'sub';
  if (type === 'channel.subscription.message') trigger = 'resub';
  if (type === 'channel.subscription.gift') trigger = 'gift';
  return trigger && config.triggers[trigger].enabled ? trigger : null;
}
