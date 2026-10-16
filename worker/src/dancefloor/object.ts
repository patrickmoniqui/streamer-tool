import { advanceFloor, applyDanceEvent, floorSnapshot, initialFloor, type FloorState } from './state';
import { validateDancefloorConfig } from '../../../src/lib/dancefloor';
export class DancefloorRoom {
  private floor!: FloorState;
  private persisted = '';
  constructor(private ctx: DurableObjectState, _env: unknown) {
    ctx.blockConcurrencyWhile(async () => {
      this.floor = await ctx.storage.get<FloorState>('floor') ?? initialFloor();
      this.persisted = JSON.stringify(this.floor);
    });
  }
  private async persist() {
    const serialized = JSON.stringify(this.floor);
    if (serialized === this.persisted) return;
    await this.ctx.storage.put('floor', this.floor);
    this.persisted = serialized;
    const times = [...this.floor.dancers.map(d => d.expiresAt), ...this.floor.queue.map(q => q.deadline), ...Object.values(this.floor.seen)];
    if (times.length) await this.ctx.storage.setAlarm(Math.max(Date.now() + 1, Math.min(...times)));
    else await this.ctx.storage.deleteAlarm();
  }
  async alarm() {
    await this.ctx.blockConcurrencyWhile(async () => {
      advanceFloor(this.floor, Date.now());
      // Fired alarms must be rescheduled even if no state changed.
      this.persisted = '';
      await this.persist();
    });
  }
  async fetch(request: Request) {
    // All requests are internal, routed only after Worker authentication/verification.
    return this.ctx.blockConcurrencyWhile(async () => {
      const path = new URL(request.url).pathname;
      advanceFloor(this.floor, Date.now());
      if (request.method === 'POST') {
        const body = await request.json() as any;
        if (path === '/config') {
          const config = validateDancefloorConfig(body);
          if (JSON.stringify(config) !== JSON.stringify(this.floor.config)) {
            this.floor.config = config;
            // Lowering capacity removes the oldest dancers immediately.
            this.floor.dancers = this.floor.dancers.slice(-config.maxDancers);
            this.floor.revision++;
          }
        } else if (path === '/test' || path === '/event') applyDanceEvent(this.floor, body, Date.now());
        else if (path === '/clear') { this.floor.dancers = []; this.floor.queue = []; this.floor.droppedCount = 0; this.floor.revision++; }
      }
      const snapshot = floorSnapshot(this.floor, Date.now());
      await this.persist();
      return Response.json(snapshot);
    });
  }
}
