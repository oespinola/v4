import { describe, expect, it } from 'vitest';
import { adjustEntry, adjustSl, adjustTp, mapTicker, scale, sideOf } from '../../src/domain/symbols.ts';
import type { SymbolFilters } from '../../src/domain/types.ts';
import { filters } from '../fakes/index.ts';

const lookup = (list: SymbolFilters[]) => (s: string) => list.find((x) => x.symbol === s);

describe('dirección (FR-008)', () => {
  it.fails('SL debajo de la Entrada es LONG (AC-01)', () => {
    expect(sideOf(1, 0.9)).toBe('LONG');
  });
  it.fails('SL arriba de la Entrada es SHORT (AC-03)', () => {
    expect(sideOf(1, 1.1)).toBe('SHORT');
  });
  it.fails('SL igual a la Entrada no tiene dirección', () => {
    expect(sideOf(1, 1)).toBeNull();
  });
});

describe('mapeo del ticker (FR-009, FR-010)', () => {
  it.fails('usa TICKERUSDT si existe, sin tocar precios (AC-40)', () => {
    expect(mapTicker('X', lookup([filters('XUSDT'), filters('1000XUSDT')]))).toMatchObject({ symbol: 'XUSDT', factor: 1 });
  });
  it.fails('si no, 1000TICKERUSDT con precios ×1000 (AC-41)', () => {
    expect(mapTicker('PEPE', lookup([filters('1000PEPEUSDT')]))).toMatchObject({ symbol: '1000PEPEUSDT', factor: 1000 });
    expect(scale(0.002404, 1000)).toBe(2.404);
  });
  it.fails('si no existe ninguno, null → "ticker inexistente" (AC-42)', () => {
    expect(mapTicker('NADA', lookup([filters('XUSDT')]))).toBeNull();
  });
  it.fails('ignora contratos que no son perpetuos en TRADING', () => {
    const list = [filters('YUSDT', { status: 'SETTLING' }), filters('1000YUSDT', { contractType: 'CURRENT_QUARTER' })];
    expect(mapTicker('Y', lookup(list))).toBeNull();
  });
});

describe('ajuste al tickSize (FR-011)', () => {
  it.fails('LONG: Entrada al más cercano, SL alejándose y TP acercándose (AC-52)', () => {
    expect(adjustEntry(10.004, 0.01)).toBe(10);
    expect(adjustSl('LONG', 9.507, 0.01)).toBe(9.5);
    expect(adjustTp('LONG', 11.003, 0.01)).toBe(11);
  });
  it.fails('SHORT: SL hacia arriba y TP hacia arriba (hacia la Entrada)', () => {
    expect(adjustSl('SHORT', 10.503, 0.01)).toBe(10.51);
    expect(adjustTp('SHORT', 9.007, 0.01)).toBe(9.01);
  });
  it.fails('no baja de tick por ruido de coma flotante', () => {
    expect(adjustSl('LONG', 9.5, 0.01)).toBe(9.5);
    expect(adjustEntry(0.0402, 0.00001)).toBe(0.0402);
  });
});
