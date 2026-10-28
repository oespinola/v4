import { describe, expect, it } from 'vitest';
import { computeIndicators, ema, pickIndicatorTp, takeProfitFor, wma } from '../../src/domain/indicators.ts';

describe('indicadores (FR-015)', () => {
  it.fails('EMA arranca con la SMA de las primeras velas, como TradingView', () => {
    const v = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(ema(v, 20)).toBe(10.5);
    expect(ema([1, 2], 3)).toBeNull();
  });

  it.fails('WMA pesa más la vela más reciente', () => {
    expect(wma([1, 2, 3], 3)).toBeCloseTo(14 / 6);
    expect(wma([1, 2], 3)).toBeNull();
  });

  it.fails('ASL21 = (EMA20 + WMA21) / 2 y EMA55 sobre una serie conocida', () => {
    const flat = Array.from({ length: 60 }, () => 100);
    expect(computeIndicators(flat)).toEqual({ asl21: 100, ema55: 100 });
    const rising = Array.from({ length: 60 }, (_, i) => i);
    const v = computeIndicators(rising);
    expect(v.asl21).toBeCloseTo(((ema(rising, 20) ?? 0) + (wma(rising, 21) ?? 0)) / 2);
    expect(v.ema55).toBeCloseTo(ema(rising, 55) ?? 0);
  });

  it.fails('sin velas suficientes no hay indicadores', () => {
    expect(computeIndicators([1, 2, 3])).toEqual({ asl21: null, ema55: null });
  });
});

describe('elección del TP (FR-014 a FR-016, AC-33, AC-34)', () => {
  it.fails('LONG: el del lado correcto más cercano a la Entrada (AC-33)', () => {
    expect(pickIndicatorTp('LONG', 10, { asl21: 12, ema55: 11 })).toEqual({ tp: 11, from: 'EMA55' });
    expect(pickIndicatorTp('LONG', 10, { asl21: 10.5, ema55: 9 })).toEqual({ tp: 10.5, from: 'ASL21' });
  });

  it.fails('SHORT: el de abajo más cercano', () => {
    expect(pickIndicatorTp('SHORT', 10, { asl21: 8, ema55: 9 })).toEqual({ tp: 9, from: 'EMA55' });
  });

  it.fails('ninguno del lado correcto → null ("TP inválido", AC-33)', () => {
    expect(pickIndicatorTp('LONG', 10, { asl21: 9, ema55: 8 })).toBeNull();
    expect(pickIndicatorTp('LONG', 10, { asl21: null, ema55: null })).toBeNull();
  });

  it.fails('objetivo con precio: TP = precio y no pide velas (AC-34)', async () => {
    let calls = 0;
    const r = await takeProfitFor({ price: 0.002404 }, 'LONG', 0.002, async () => {
      calls++;
      return [];
    });
    expect(r).toEqual({ tp: 0.002404, source: 'alerta' });
    expect(calls).toBe(0);
  });

  it.fails('objetivo por indicadores: calcula sobre las velas de 45 min', async () => {
    const closes = Array.from({ length: 60 }, () => 12);
    const r = await takeProfitFor({ text: 'ASL21, EMA55' }, 'LONG', 10, async () => closes);
    expect(r).toEqual({ tp: 12, source: 'calculado' });
  });

  it.fails('si fallan las velas, propaga el error (lo traduce la validación, FR-064)', async () => {
    await expect(
      takeProfitFor({ text: 'ASL21, EMA55' }, 'LONG', 10, async () => {
        throw new Error('sin red');
      }),
    ).rejects.toThrow('sin red');
  });
});
