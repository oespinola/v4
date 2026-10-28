import { describe, expect, it } from 'vitest';
import { latencyReport, p95 } from '../../src/latency.ts';

const alert = (classifiedMs: number, withImage: boolean, entryAcceptedMs: number | null = null, status = 'completa') =>
  JSON.stringify({ type: 'alert', status, timings: { classifiedMs, entryAcceptedMs, withImage } });

describe('latencia sobre el log (SC-001, SC-002, AC-46, AC-48)', () => {
  it.fails('p95 por rango más cercano', () => {
    expect(p95(Array.from({ length: 20 }, (_, i) => (i + 1) * 100))).toBe(1900);
    expect(p95([5])).toBe(5);
    expect(p95([])).toBeNull();
  });

  it.fails('separa solo texto y con imagen, con los límites de SC-001 y SC-002', () => {
    const lines = [
      ...Array.from({ length: 20 }, (_, i) => alert(1000 + i * 50, false, 2000 + i * 100)),
      ...Array.from({ length: 20 }, (_, i) => alert(6000 + i * 300, true, 9000 + i * 200)),
    ];
    expect(latencyReport(lines)).toEqual([
      { name: 'clasificación, solo texto', limitMs: 3000, n: 20, p95: 1900, ok: true },
      { name: 'clasificación, con imagen', limitMs: 10000, n: 20, p95: 11400, ok: false },
      { name: 'entrada aceptada, solo texto', limitMs: 5000, n: 20, p95: 3800, ok: true },
      { name: 'entrada aceptada, con imagen', limitMs: 12000, n: 20, p95: 12600, ok: false },
    ]);
  });

  it.fails('con menos de 20 alertas de un tipo no da veredicto', () => {
    const r = latencyReport([alert(500, false, 900)]);
    expect(r[0]).toEqual({ name: 'clasificación, solo texto', limitMs: 3000, n: 1, p95: 500, ok: null });
    expect(r[1]).toMatchObject({ n: 0, p95: null, ok: null });
  });

  it.fails('ignora otros eventos, líneas rotas y alertas sin la medición', () => {
    const lines = [
      JSON.stringify({ type: 'connection', service: 'binance' }),
      'esto no es JSON',
      JSON.stringify({ type: 'alert', status: 'rechazada', timings: { classifiedMs: null, entryAcceptedMs: null, withImage: false } }),
      alert(700, false, null, 'rechazada'),
    ];
    const r = latencyReport(lines);
    expect(r[0]).toMatchObject({ n: 1, p95: 700 });
    expect(r[2]).toMatchObject({ n: 0 });
  });

  it.fails('una alerta cerrada más tarde se cuenta una sola vez (la última línea de cada alertId manda)', () => {
    const first = JSON.stringify({ type: 'alert', alertId: 'a', status: 'completa', timings: { classifiedMs: 800, entryAcceptedMs: 1500, withImage: false } });
    const closed = JSON.stringify({ type: 'alert', alertId: 'a', status: 'cerrada', timings: { classifiedMs: 800, entryAcceptedMs: 1500, withImage: false } });
    expect(latencyReport([first, closed])[0]).toMatchObject({ n: 1 });
  });
});
