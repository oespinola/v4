import { describe, expect, it } from 'vitest';
import { checkExposure, type ExposureInput } from '../../src/domain/exposure.ts';

const input = (over: Partial<ExposureInput> = {}): ExposureInput => ({
  notional: 100,
  symbolActive: false,
  current: { positions: 0, notional: 0 },
  maxPositions: 3,
  maxCapitalUsdt: 1000,
  ...over,
});

describe('límites de exposición (FR-025, FR-026, FR-063)', () => {
  it.fails('sin exposición, la operación entra', () => {
    expect(checkExposure(input())).toBeNull();
  });

  it.fails('posiciones abiertas iguales al máximo → "límite de posiciones" (AC-18)', () => {
    expect(checkExposure(input({ current: { positions: 3, notional: 300 } }))).toBe('límite de posiciones');
    expect(checkExposure(input({ current: { positions: 2, notional: 200 } }))).toBeNull();
  });

  it.fails('una entrada pendiente ocupa cupo: máximo 1 con una pendiente → "límite de posiciones" (AC-51)', () => {
    // `current` viene del store, que cuenta pendiente, con_ejecución y abierta.
    expect(checkExposure(input({ maxPositions: 1, current: { positions: 1, notional: 50 } }))).toBe('límite de posiciones');
  });

  it.fails('nocional comprometido + nuevo > máximo → "límite de capital" (AC-24)', () => {
    expect(checkExposure(input({ current: { positions: 1, notional: 950 } }))).toBe('límite de capital');
    expect(checkExposure(input({ current: { positions: 1, notional: 900 } }))).toBeNull(); // = máximo, entra
  });

  it.fails('símbolo con operación activa → "símbolo ya en operación", antes que los límites (AC-70, FR-020)', () => {
    const r = checkExposure(input({ symbolActive: true, current: { positions: 3, notional: 1000 } }));
    expect(r).toBe('símbolo ya en operación');
  });

  it.fails('límite de posiciones antes que límite de capital (FR-020)', () => {
    expect(checkExposure(input({ current: { positions: 3, notional: 1000 } }))).toBe('límite de posiciones');
  });
});
