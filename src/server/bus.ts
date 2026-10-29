import { EventEmitter } from 'node:events';
import type { WardenEvent } from '../shared/types.js';

export class EventBus {
  private readonly emitter = new EventEmitter();
  private readonly history: WardenEvent[] = [];

  publish(event: WardenEvent): void {
    this.history.push(event);
    if (this.history.length > 500) this.history.splice(0, this.history.length - 500);
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: WardenEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  replay(): WardenEvent[] {
    return [...this.history];
  }
}
