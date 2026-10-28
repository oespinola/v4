import { describe, expect, it } from 'vitest';
import { SerialQueue } from '../../src/queue.ts';

const tick = () => new Promise<void>((r) => setImmediate(r));

describe('cola de a una alerta (FR-061)', () => {
  it.fails('procesa de a un trabajo, en orden de llegada', async () => {
    const q = new SerialQueue();
    const log: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const job = (name: string) => async () => {
      running++;
      maxRunning = Math.max(maxRunning, running);
      log.push(`inicio ${name}`);
      await tick();
      await tick();
      log.push(`fin ${name}`);
      running--;
    };
    await Promise.all([q.push(job('a')), q.push(job('b')), q.push(job('c'))]);
    expect(maxRunning).toBe(1);
    expect(log).toEqual(['inicio a', 'fin a', 'inicio b', 'fin b', 'inicio c', 'fin c']);
  });

  it.fails('un error en un trabajo no frena los siguientes y se informa', async () => {
    const errors: unknown[] = [];
    const q = new SerialQueue((e) => errors.push(e));
    const done: string[] = [];
    const p1 = q.push(async () => {
      throw new Error('boom');
    });
    const p2 = q.push(async () => {
      done.push('b');
    });
    await Promise.all([p1, p2]);
    expect(done).toEqual(['b']);
    expect(errors).toHaveLength(1);
  });

  it.fails('idle() espera a que se vacíe la cola', async () => {
    const q = new SerialQueue();
    let finished = false;
    void q.push(async () => {
      await tick();
      finished = true;
    });
    expect(q.pending).toBe(1);
    await q.idle();
    expect(finished).toBe(true);
    expect(q.pending).toBe(0);
  });
});
