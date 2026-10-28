// Ranking top 3 (FR-017 a FR-019). Pendiente de implementar (T036).
import type { Ranking } from '../ports.ts';
import type { SymbolFilters } from './types.ts';

export interface Ticker24h {
  symbol: string;
  priceChangePercent: number;
}

const ni = (): never => {
  throw new Error('ranking: no implementado');
};

export function buildRanking(
  _tickers: readonly Ticker24h[],
  _lookup: (s: string) => SymbolFilters | undefined,
  _at: Date,
): Ranking {
  return ni();
}
export function inTop3(_r: Ranking, _symbol: string): boolean {
  return ni();
}
export function isRankingFresh(_r: Ranking | undefined, _now: Date): boolean {
  return ni();
}
