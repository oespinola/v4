// Dirección, mapeo de símbolo y ajuste al tick (FR-008 a FR-011). Pendiente de implementar (T030).
import type { Side, SymbolFilters } from './types.ts';

export interface MappedSymbol {
  symbol: string;
  factor: 1 | 1000;
  filters: SymbolFilters;
}

const ni = (): never => {
  throw new Error('symbols: no implementado');
};

export function sideOf(_entry: number, _sl: number): Side | null {
  return ni();
}
export function mapTicker(_ticker: string, _lookup: (s: string) => SymbolFilters | undefined): MappedSymbol | null {
  return ni();
}
export function scale(_value: number, _factor: number): number {
  return ni();
}
export function adjustEntry(_v: number, _tick: number): number {
  return ni();
}
export function adjustSl(_side: Side, _v: number, _tick: number): number {
  return ni();
}
export function adjustTp(_side: Side, _v: number, _tick: number): number {
  return ni();
}
