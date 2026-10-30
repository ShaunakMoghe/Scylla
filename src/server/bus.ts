import { EventEmitter } from 'node:events';
import type { ScyllaEvent } from '../shared/types.js';

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly history: ScyllaEvent[] = [];

  publish(event: ScyllaEvent): void {
    this.history.push(event);
    if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: ScyllaEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  replay(): ScyllaEvent[] {
    return [...this.history];
  }
}
