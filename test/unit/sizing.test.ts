import { describe, expect, it } from 'vitest';
import { sizePosition, type SizingInput } from '../../src/domain/sizing.ts';
import { filters } from '../fakes/index.ts';

function input(over: Partial<SizingInput> = {}): SizingInput & { balanceCalls: () => number } {
  let calls = 0;
  const base: SizingInput = {
    entry: 0.0402,
    sl: 0.0414,
    filters: filters('KAIAUSDT', { stepSize: 1, minQty: 1, minNotional: 5 }),
    riskR: 5,
    maxPositionUsdt: 1000,
    maxLeverage: 2,
    walletBalance: async () => {
      calls++;
      return 3000;
    },
    ...over,
  };
  return { ...base, balanceCalls: () => calls };
}

describe('dimensionamiento (FR-021 a FR-024)', () => {
  it('cantidad = R / |E − S| con piso al stepSize, y su nocional (AC-13)', async () => {
    expect(await sizePosition(input())).toEqual({ ok: true, quantity: 4166, notional: 167.4732 });
    const r = await sizePosition(input({ filters: filters('KAIAUSDT', { stepSize: 10, minQty: 10, minNotional: 5 }) }));
    expect(r).toMatchObject({ ok: true, quantity: 4160 });
  });

  it('funciona igual para LONG (SL debajo de la Entrada)', async () => {
    const r = await sizePosition(input({ entry: 10, sl: 9.5, filters: filters('XUSDT', { stepSize: 0.001 }) }));
    expect(r).toEqual({ ok: true, quantity: 10, notional: 100 });
  });

  it('bajo mínimo por cantidad o por nocional, sin consultar el balance (AC-39)', async () => {
    const byQty = input({ filters: filters('KAIAUSDT', { stepSize: 1, minQty: 5000, minNotional: 5 }) });
    expect(await sizePosition(byQty)).toEqual({ ok: false, reason: 'bajo mínimo' });
    expect(byQty.balanceCalls()).toBe(0);
    const byNotional = input({ filters: filters('KAIAUSDT', { stepSize: 1, minQty: 1, minNotional: 200 }) });
    expect(await sizePosition(byNotional)).toEqual({ ok: false, reason: 'bajo mínimo' });
    const zero = input({ riskR: 0.5, entry: 10, sl: 9, filters: filters('XUSDT', { stepSize: 1, minQty: 0, minNotional: 0 }) });
    expect(await sizePosition(zero)).toEqual({ ok: false, reason: 'bajo mínimo' });
  });

  it('si falla el balance, "datos de mercado no disponibles" (AC-72)', async () => {
    const r = await sizePosition(input({ walletBalance: async () => Promise.reject(new Error('sin red')) }));
    expect(r).toEqual({ ok: false, reason: 'datos de mercado no disponibles' });
  });

  it('excede máximos por tamaño de posición (AC-22)', async () => {
    expect(await sizePosition(input({ maxPositionUsdt: 150 }))).toEqual({ ok: false, reason: 'excede máximos' });
    expect(await sizePosition(input({ maxPositionUsdt: 167.4732 }))).toMatchObject({ ok: true });
  });

  it('excede máximos por apalancamiento efectivo = nocional / balance (AC-22)', async () => {
    const r = await sizePosition(input({ walletBalance: async () => 80 })); // 167.47 / 80 ≈ 2.09 > 2
    expect(r).toEqual({ ok: false, reason: 'excede máximos' });
    expect(await sizePosition(input({ walletBalance: async () => 90 }))).toMatchObject({ ok: true }); // ≈ 1.86
    expect(await sizePosition(input({ walletBalance: async () => 0 }))).toEqual({ ok: false, reason: 'excede máximos' });
  });
});
