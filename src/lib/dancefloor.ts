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
  const invalid = (message: string): never => { throw new Error(message); };
  if (!v || typeof v !== 'object') invalid('Dancefloor settings must be an object.');
  if (typeof v.rewardId !== 'string' || v.rewardId.length > 100) invalid('Choose a valid channel point reward.');
  if (!integer(v.minimumBits, 1, 1000000)) invalid('Minimum Bits must be a whole number between 1 and 1,000,000.');
  if (!integer(v.maxDancers, 1, 50)) invalid('Maximum dancers must be a whole number between 1 and 50.');
  if (!integer(v.dancerSize, 48, 180)) invalid('Dancer size must be a whole number between 48 and 180 pixels.');
  if (typeof v.accentColor !== 'string' || !/^#[a-f\d]{6}$/i.test(v.accentColor)) invalid('Choose a valid accent color.');
  for (const key of ['showNames', 'showFloor', 'transparent'] as const) {
    if (typeof v[key] !== 'boolean') invalid(`The ${key} setting must be on or off.`);
  }
  const labels: Record<DanceTrigger, string> = { reward: 'Channel point', bits: 'Bits', sub: 'New subscription', resub: 'Resub announcement', gift: 'Gift subscription' };
  for (const key of DANCE_TRIGGERS) {
    if (typeof v.triggers?.[key]?.enabled !== 'boolean') invalid(`${labels[key]} trigger must be on or off.`);
    if (!integer(v.triggers[key].durationSeconds, 1, 300)) invalid(`${labels[key]} duration must be a whole number between 1 and 300 seconds.`);
  }
  if (v.triggers.reward.enabled && !v.rewardId.trim()) invalid('Select an existing channel point reward, or turn off the channel point trigger.');
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
