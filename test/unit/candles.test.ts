import { describe, expect, it } from 'vitest';
import { group45m } from '../../src/domain/candles.ts';

const M15 = 15 * 60_000;
const day = Date.parse('2026-10-28T00:00:00Z');
/** Velas de 15 min con cierre = índice, desde `start` (n.º de vela de 15 min del día). */
const candles = (start: number, count: number, base = day) =>
  Array.from({ length: count }, (_, i) => ({ openTime: base + (start + i) * M15, close: start + i }));

describe('velas de 45 min desde velas de 15 min (FR-015, AC-69)', () => {
  it('agrupa de a tres alineadas a las 00:00 UTC, con el cierre de la tercera', () => {
    expect(group45m(candles(0, 9))).toEqual([2, 5, 8]); // 00:00, 00:45, 01:30
  });

  it('descarta el primer tramo si quedó incompleto por el corte de la consulta', () => {
    expect(group45m(candles(1, 8))).toEqual([5, 8]); // 00:15 y 00:30 no completan el tramo de 00:00
  });

  it('incluye la vela en curso aunque tenga una o dos velas de 15 min', () => {
    expect(group45m(candles(0, 7))).toEqual([2, 5, 6]);
    expect(group45m(candles(0, 8))).toEqual([2, 5, 7]);
  });

  it('el día tiene 32 tramos exactos: el de 23:15 cierra a las 00:00', () => {
    const prev = day - 24 * 60 * 60_000;
    const lateNight = candles(93, 3, prev); // 23:15, 23:30, 23:45 del día anterior
    const midnight = candles(0, 2); // 00:00, 00:15
    expect(group45m([...lateNight, ...midnight])).toEqual([95, 1]);
  });

  it('ordena por hora de apertura aunque lleguen desordenadas', () => {
    expect(group45m(candles(0, 6).reverse())).toEqual([2, 5]);
  });
});
