import { describe, expect, it } from 'vitest';
import { RetryCounter, backoffDelayMs } from '../../src/domain/backoff.ts';

describe('backoff (FR-055)', () => {
  it.fails('espera 1, 2, 4, 8, 16, 32 s y después 60 s como máximo', () => {
    const seq = [1, 2, 3, 4, 5, 6, 7, 8, 20].map(backoffDelayMs);
    expect(seq).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000]);
  });

  it.fails('marca "agotado" al 10.º fallo consecutivo, no antes', () => {
    const c = new RetryCounter();
    const results = Array.from({ length: 10 }, () => c.failure());
    expect(results.slice(0, 9).every((r) => !r.exhausted)).toBe(true);
    expect(results[9]).toMatchObject({ attempt: 10, exhausted: true, waitMs: 60000 });
    expect(results.map((r) => r.waitMs).slice(0, 3)).toEqual([1000, 2000, 4000]);
  });

  it.fails('sigue dando esperas después de agotado (el cierre de emergencia ignora la señal)', () => {
    const c = new RetryCounter();
    for (let i = 0; i < 12; i++) c.failure();
    expect(c.failure()).toMatchObject({ attempt: 13, exhausted: true, waitMs: 60000 });
  });

  it.fails('un éxito reinicia el contador', () => {
    const c = new RetryCounter();
    c.failure();
    c.failure();
    c.success();
    expect(c.failure()).toMatchObject({ attempt: 1, waitMs: 1000, exhausted: false });
  });
});
