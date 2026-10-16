import { advanceFloor, applyDanceEvent, floorSnapshot, initialFloor, type FloorState } from './state';
import { validateDancefloorConfig, type DancefloorConnection } from '../../../src/lib/dancefloor';
import { connectTwitchEventSub, eventSubSubscriptions } from '../../../src/lib/twitchEventSub';
import { clientId, resolveDanceNotification, type DancefloorEnv } from './api';
import { openCredential, sealCredential, type SealedCredential } from './credentials';
interface SavedConnection { userId: string; expiresAt: number; validatedAt: number; credential: SealedCredential }
export class DancefloorRoom {
  private floor!: FloorState;
  private persisted = '';
  private saved?: SavedConnection;
  private status: DancefloorConnection = { state: 'idle', message: 'Connect Twitch to start the background event receiver.' };
  private stopListener?: () => void;
  private token?: string;
  private generation = 0;
  private alarmAt = 0;
  constructor(private ctx: DurableObjectState, private env: DancefloorEnv) {
    ctx.blockConcurrencyWhile(async () => {
      this.floor = await ctx.storage.get<FloorState>('floor') ?? initialFloor();
      this.persisted = JSON.stringify(this.floor);
      this.saved = await ctx.storage.get<SavedConnection>('twitchConnection');
      this.status = await ctx.storage.get<DancefloorConnection>('connectionStatus') ?? this.status;
      this.alarmAt = await ctx.storage.getAlarm() ?? 0;
      await this.ensureConnection();
      await this.persist();
    });
  }
  private setStatus(next: Partial<DancefloorConnection>) {
    const status = { ...this.status, ...next };
    if (JSON.stringify(status) === JSON.stringify(this.status)) return;
    this.status = status;
    this.ctx.waitUntil(this.ctx.storage.put('connectionStatus', this.status));
  }
  private stop() { this.generation++; this.stopListener?.(); this.stopListener = undefined; }
  private async disconnect(message: string, expired = false) {
    this.stop(); this.token = undefined; this.saved = undefined;
    await this.ctx.storage.delete('twitchConnection');
    this.status = { state: expired ? 'auth-required' : 'idle', message };
    await this.ctx.storage.put('connectionStatus', this.status);
  }
  private async ensureConnection() {
    if (!this.saved) return;
    if (this.saved.expiresAt <= Date.now()) { await this.disconnect('Twitch sign-in expired. Reconnect Twitch to resume background events.', true); return; }
    try {
      this.token ??= await openCredential(this.saved.credential, this.saved.userId, this.env.DANCEFLOOR_ENCRYPTION_KEY);
      if (Date.now() - this.saved.validatedAt >= 3600000) {
        const response = await fetch('https://id.twitch.tv/oauth2/validate', { signal: AbortSignal.timeout(5000), headers: { Authorization: `OAuth ${this.token}` } });
        if (response.status === 401) { await this.disconnect('Twitch authorization expired or was revoked. Reconnect Twitch.', true); return; }
        if (!response.ok) throw new Error('Twitch validation unavailable');
        const identity = await response.json() as { user_id: string; client_id: string; expires_in: number };
        if (identity.user_id !== this.saved.userId || identity.client_id !== clientId(this.env) || !Number.isFinite(identity.expires_in) || identity.expires_in <= 0) {
          await this.disconnect('Twitch authorization is no longer valid. Reconnect Twitch.', true); return;
        }
        this.saved.validatedAt = Date.now(); this.saved.expiresAt = Date.now() + identity.expires_in * 1000;
        await this.ctx.storage.put('twitchConnection', this.saved);
      }
      if (this.stopListener) return;
      if (!eventSubSubscriptions(this.floor.config, this.saved.userId).length) {
        this.setStatus({ state: 'idle', message: 'Background connection ready. Enable a trigger and save changes to start listening.' }); return;
      }
      const token = this.token;
      const ownerId = this.saved.userId;
      const generation = ++this.generation;
      this.setStatus({ state: 'connecting', message: 'Starting the background Twitch WebSocket…' });
      this.stopListener = connectTwitchEventSub({
        token, clientId: clientId(this.env), broadcasterId: ownerId, config: this.floor.config,
        createSocket: async url => {
          const response = await fetch(url.replace(/^wss:/, 'https:'), { headers: { Upgrade: 'websocket' }, signal: AbortSignal.timeout(10000) });
          const socket = (response as Response & { webSocket?: WebSocket & { accept(): void } }).webSocket;
          if (response.status !== 101 || !socket) throw new Error('Twitch WebSocket handshake failed');
          socket.accept(); return socket;
        },
        onStatus: next => {
          if (generation !== this.generation) return;
          this.setStatus({ ...next, message: next.state === 'listening' ? 'Listening for Twitch events in the background. You can close this page.' : next.message.replace('Keep this page open while streaming.', 'The receiver runs on the server.') });
        },
        onAuthExpired: () => {
          this.ctx.waitUntil(this.ctx.blockConcurrencyWhile(async () => {
            if (generation === this.generation) { await this.disconnect('Twitch authorization expired or was revoked. Reconnect Twitch.', true); await this.persist(); }
          }));
        },
        onNotification: message => this.ctx.blockConcurrencyWhile(async () => {
          if (generation !== this.generation) return;
          const request = new Request('https://dancefloor.internal/events', { headers: { Authorization: `Bearer ${token}` } });
          const event = await resolveDanceNotification(request, this.env, ownerId, this.floor.config, message);
          if (event) {
            applyDanceEvent(this.floor, event, Date.now());
            this.setStatus({ lastEvent: `Last event: ${event.name} received by the live floor.`, lastReceivedAt: Date.now() });
            await this.persist();
          }
        }),
      });
    } catch {
      this.setStatus({ state: 'delayed', message: 'Background Twitch connection is temporarily unavailable. Retrying automatically.' });
    }
  }
  private async persist() {
    const serialized = JSON.stringify(this.floor);
    if (serialized !== this.persisted) { await this.ctx.storage.put('floor', this.floor); this.persisted = serialized; }
    const times = [...this.floor.dancers.map(d => d.expiresAt), ...this.floor.queue.map(q => q.deadline), ...Object.values(this.floor.seen)];
    if (this.saved) { times.push(this.saved.expiresAt); if (eventSubSubscriptions(this.floor.config, this.saved.userId).length) times.push(Date.now() + 60000); }
    if (times.length) {
      const target = Math.max(Date.now() + 1, Math.min(...times));
      if (!this.alarmAt || target < this.alarmAt || this.alarmAt <= Date.now()) { await this.ctx.storage.setAlarm(target); this.alarmAt = target; }
    } else if (this.alarmAt) { await this.ctx.storage.deleteAlarm(); this.alarmAt = 0; }
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => { this.alarmAt = 0; advanceFloor(this.floor, Date.now()); await this.ensureConnection(); await this.persist(); });
  }
  async fetch(request: Request) {
    return this.ctx.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname;
      advanceFloor(this.floor, Date.now());
      if (request.method === 'POST') {
        const body = await request.json() as any;
        if (path === '/connect') {
          if (typeof body.token !== 'string' || typeof body.userId !== 'string' || !Number.isFinite(body.expiresAt) || body.expiresAt <= Date.now()) return Response.json({ error: 'Invalid connection' }, { status: 400 });
          let previousToken = this.token;
          if (!previousToken && this.saved) {
            try { previousToken = await openCredential(this.saved.credential, this.saved.userId, this.env.DANCEFLOOR_ENCRYPTION_KEY); } catch { /* A fresh owner sign-in can recover after key rotation. */ }
          }
          if (body.token !== previousToken || body.userId !== this.saved?.userId || this.status.state === 'error') {
            const credential = await sealCredential(body.token, body.userId, this.env.DANCEFLOOR_ENCRYPTION_KEY);
            this.stop(); this.token = body.token;
            this.saved = { userId: body.userId, expiresAt: body.expiresAt, validatedAt: Date.now(), credential };
          } else if (this.saved) { this.saved.expiresAt = body.expiresAt; this.saved.validatedAt = Date.now(); }
          await this.ctx.storage.put('twitchConnection', this.saved!);
        } else if (path === '/disconnect') await this.disconnect('Background Twitch connection stopped. Connect again to resume.');
        else if (path === '/config') {
          const config = validateDancefloorConfig(body);
          if (JSON.stringify(config) !== JSON.stringify(this.floor.config)) {
            if (JSON.stringify(eventSubSubscriptions(config, this.saved?.userId ?? '')) !== JSON.stringify(eventSubSubscriptions(this.floor.config, this.saved?.userId ?? ''))) this.stop();
            this.floor.config = config; this.floor.dancers = this.floor.dancers.slice(-config.maxDancers); this.floor.revision++;
          }
        } else if (path === '/test' || path === '/event') applyDanceEvent(this.floor, body, Date.now());
        else if (path === '/clear') { this.floor.dancers = []; this.floor.queue = []; this.floor.droppedCount = 0; this.floor.revision++; }
      }
      await this.ensureConnection();
      const snapshot = { ...floorSnapshot(this.floor, Date.now()), connection: this.status };
      await this.persist();
      return Response.json(snapshot);
    });
  }
}
