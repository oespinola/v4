// Dirección, mapeo de símbolo y ajuste al tick (FR-008 a FR-011).
import type { Side, SymbolFilters } from './types.ts';

export interface MappedSymbol {
  symbol: string;
  factor: 1 | 1000;
  filters: SymbolFilters;
}

/** SL debajo de la Entrada → LONG; arriba → SHORT; igual → sin dirección (FR-012). */
export function sideOf(entry: number, sl: number): Side | null {
  if (sl < entry) return 'LONG';
  if (sl > entry) return 'SHORT';
  return null;
}

export function isTradablePerpetual(f: SymbolFilters): boolean {
  return f.contractType === 'PERPETUAL' && f.status === 'TRADING';
}

/** TICKERUSDT; si no existe, 1000TICKERUSDT con precios ×1000; si ninguno, null (FR-009, FR-010). */
export function mapTicker(ticker: string, lookup: (s: string) => SymbolFilters | undefined): MappedSymbol | null {
  for (const [symbol, factor] of [
    [`${ticker}USDT`, 1],
    [`1000${ticker}USDT`, 1000],
  ] as const) {
    const f = lookup(symbol);
    if (f && isTradablePerpetual(f)) return { symbol, factor, filters: f };
  }
  return null;
}

/** Evita el ruido de coma flotante: 0.002404 × 1000 → 2.404, no 2.4040000000000004. */
export function scale(value: number, factor: number): number {
  return Number((value * factor).toPrecision(12));
}

function decimalsOf(step: number): number {
  const s = step.toFixed(12).replace(/0+$/, '');
  const dot = s.indexOf('.');
  return dot === -1 ? 0 : s.length - dot - 1;
}

export type Rounding = 'nearest' | 'down' | 'up';

export function roundToStep(value: number, step: number, mode: Rounding): number {
  if (!(step > 0)) return value;
  const n = value / step;
  const eps = 1e-9; // 9.50 / 0.01 da 949.9999999: no tiene que bajar a 949
  const k = mode === 'nearest' ? Math.round(n) : mode === 'down' ? Math.floor(n + eps) : Math.ceil(n - eps);
  return Number((k * step).toFixed(decimalsOf(step)));
}

/** Entrada al tick más cercano (FR-011). */
export function adjustEntry(v: number, tick: number): number {
  return roundToStep(v, tick, 'nearest');
}

/** SL alejándose de la Entrada: hacia abajo en LONG, hacia arriba en SHORT (FR-011). */
export function adjustSl(side: Side, v: number, tick: number): number {
  return roundToStep(v, tick, side === 'LONG' ? 'down' : 'up');
}

/** TP acercándose a la Entrada: hacia abajo en LONG, hacia arriba en SHORT (FR-011). */
export function adjustTp(side: Side, v: number, tick: number): number {
  return roundToStep(v, tick, side === 'LONG' ? 'down' : 'up');
}
