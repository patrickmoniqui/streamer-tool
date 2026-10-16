export type DanceTrigger = 'reward' | 'bits' | 'sub' | 'resub' | 'gift';
export interface DancefloorConfig {
  rewardId: string;
  triggers: Record<DanceTrigger, { enabled: boolean; durationSeconds: number }>;
  minimumBits: number;
  maxDancers: number;
  dancerSize: number;
  showNames: boolean;
  showFloor: boolean;
  transparent: boolean;
  accentColor: string;
}
export interface DancefloorDancer {
  id: string;
  name: string;
  avatarUrl: string;
  enteredAt: number;
  expiresAt: number;
}
export interface DancefloorSnapshot {
  config: DancefloorConfig;
  dancers: DancefloorDancer[];
  serverTime: number;
  revision: number;
  queueCount: number;
  droppedCount: number;
}
export const DANCE_TRIGGERS: DanceTrigger[] = ['reward', 'bits', 'sub', 'resub', 'gift'];
export const DEFAULT_DANCEFLOOR_CONFIG: DancefloorConfig = {
  rewardId: '',
  triggers: Object.fromEntries(DANCE_TRIGGERS.map(key => [key, { enabled: false, durationSeconds: 60 }])) as DancefloorConfig['triggers'],
  minimumBits: 100, maxDancers: 20, dancerSize: 96,
  showNames: true, showFloor: false, transparent: true, accentColor: '#b68cff',
};
export function validateDancefloorConfig(value: unknown): DancefloorConfig {
  const v = value as DancefloorConfig;
  const integer = (n: number, min: number, max: number) => Number.isInteger(n) && n >= min && n <= max;
  if (!v || typeof v.rewardId !== 'string' || v.rewardId.length > 100 ||
      !integer(v.minimumBits, 1, 1000000) || !integer(v.maxDancers, 1, 50) ||
      !integer(v.dancerSize, 48, 180) || !/^#[a-f\d]{6}$/i.test(v.accentColor) ||
      ['showNames', 'showFloor', 'transparent'].some(k => typeof v[k as keyof DancefloorConfig] !== 'boolean') ||
      DANCE_TRIGGERS.some(k => typeof v.triggers?.[k]?.enabled !== 'boolean' || !integer(v.triggers[k].durationSeconds, 1, 300)) ||
      (v.triggers.reward.enabled && !v.rewardId)) throw new Error('Invalid Dancefloor settings. Check reward, durations, and appearance values.');
  return {
    rewardId: v.rewardId, minimumBits: v.minimumBits, maxDancers: v.maxDancers,
    dancerSize: v.dancerSize, showNames: v.showNames, showFloor: v.showFloor,
    transparent: v.transparent, accentColor: v.accentColor.toLowerCase(),
    triggers: Object.fromEntries(DANCE_TRIGGERS.map(k => [k, { enabled: v.triggers[k].enabled, durationSeconds: v.triggers[k].durationSeconds }])) as DancefloorConfig['triggers'],
  };
}
export function dancerSeed(id: string): number {
  return Array.from(id).reduce((hash, c) => (Math.imul(hash, 31) + c.charCodeAt(0)) >>> 0, 7);
}
export function dancefloorOverlayUrl(channel: string): string {
  const url = new URL(window.location.href);
  url.pathname = url.pathname.replace(/\/dancefloor(?:\/.*)?$/, `/dancefloor/${encodeURIComponent(channel)}`);
  url.search = ''; url.hash = '';
  return url.toString();
}
