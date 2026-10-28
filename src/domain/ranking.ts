// Ranking top 3 (FR-017 a FR-019): solo perpetuos en TRADING, ordenados por porcentaje de cambio
// de 24 h. Con más de 120 s de antigüedad la copia no se usa ("ranking no disponible").
import type { Ranking } from '../ports.ts';
import { isTradablePerpetual } from './symbols.ts';
import type { SymbolFilters } from './types.ts';

export const RANKING_MAX_AGE_MS = 120_000;

export interface Ticker24h {
  symbol: string;
  priceChangePercent: number;
}

export function buildRanking(
  tickers: readonly Ticker24h[],
  lookup: (s: string) => SymbolFilters | undefined,
  at: Date,
): Ranking {
  const eligible = tickers.filter((t) => {
    const f = lookup(t.symbol);
    return f !== undefined && isTradablePerpetual(f) && Number.isFinite(t.priceChangePercent);
  });
  const desc = [...eligible].sort((a, b) => b.priceChangePercent - a.priceChangePercent);
  return {
    gainers: desc.slice(0, 3).map((t) => t.symbol),
    losers: [...desc].reverse().slice(0, 3).map((t) => t.symbol),
    refreshedAt: at,
  };
}

export function inTop3(r: Ranking, symbol: string): boolean {
  return r.gainers.includes(symbol) || r.losers.includes(symbol);
}

export function isRankingFresh(r: Ranking | undefined, now: Date): boolean {
  return r !== undefined && now.getTime() - r.refreshedAt.getTime() <= RANKING_MAX_AGE_MS;
}
