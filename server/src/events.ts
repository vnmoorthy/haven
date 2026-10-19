import { EventEmitter } from 'node:events';
import type { WebSocket } from 'ws';
import type { HavenEvent } from './types.js';

// Central in-process event hub. Every state change is emitted here and fanned out to WebSocket clients.
class Hub extends EventEmitter {
  clients = new Set<WebSocket>();
  history: HavenEvent[] = [];
  emitEvent<T>(type: string, data: T) {
    const evt: HavenEvent<T> = { type, ts: Date.now(), data };
    this.history.push(evt);
    if (this.history.length > 2000) this.history.splice(0, this.history.length - 2000);
    const payload = JSON.stringify(evt);
    for (const c of this.clients) if (c.readyState === 1) c.send(payload);
    this.emit(type, data);
    this.emit('*', evt);
    return evt;
  }
}
export const hub = new Hub();
hub.setMaxListeners(100);
export const emit = <T>(type: string, data: T) => hub.emitEvent(type, data);

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
