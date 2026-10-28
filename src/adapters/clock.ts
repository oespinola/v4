// Reloj real (puerto Clock). Los tests usan FakeClock para los plazos de 3 min, 24 h y 120 s.
import type { Clock, TimerHandle } from '../ports.ts';

export class SystemClock implements Clock {
  private nextId = 1;
  private readonly timers = new Map<number, NodeJS.Timeout>();

  now(): Date {
    return new Date();
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(
      id,
      setTimeout(() => {
        this.timers.delete(id);
        fn();
      }, ms),
    );
    return { id };
  }

  clearTimeout(handle: TimerHandle): void {
    const t = this.timers.get(handle.id);
    if (t) clearTimeout(t);
    this.timers.delete(handle.id);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const id = this.nextId++;
    this.timers.set(id, setInterval(fn, ms));
    return { id };
  }

  clearInterval(handle: TimerHandle): void {
    const t = this.timers.get(handle.id);
    if (t) clearInterval(t);
    this.timers.delete(handle.id);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }
}
