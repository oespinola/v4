import { describe, expect, it } from 'vitest';
import { buildRanking, inTop3, isRankingFresh } from '../../src/domain/ranking.ts';
import type { SymbolFilters } from '../../src/domain/types.ts';
import { filters } from '../fakes/index.ts';

const at = new Date('2026-10-28T12:00:00Z');
const t = (symbol: string, priceChangePercent: number) => ({ symbol, priceChangePercent });
const symbols: SymbolFilters[] = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'].map((s) => filters(`${s}USDT`));
const lookup = (s: string) => symbols.find((x) => x.symbol === s);

describe('ranking top 3 (FR-017 a FR-019)', () => {
  it('arma ganadores (mayor %) y perdedores (menor %)', () => {
    const r = buildRanking(
      [t('AUSDT', 10), t('BUSDT', 30), t('CUSDT', 20), t('DUSDT', -5), t('EUSDT', -25), t('FUSDT', -15), t('GUSDT', 0), t('HUSDT', 1)],
      lookup,
      at,
    );
    expect(r).toEqual({ gainers: ['BUSDT', 'CUSDT', 'AUSDT'], losers: ['EUSDT', 'FUSDT', 'DUSDT'], refreshedAt: at });
  });

  it('excluye contratos que no están en TRADING aunque tengan el mayor cambio (AC-38)', () => {
    const list = [...symbols, filters('XUSDT', { status: 'SETTLING' })];
    const r = buildRanking([t('XUSDT', 99), t('AUSDT', 3), t('BUSDT', 2), t('CUSDT', 1)], (s) => list.find((x) => x.symbol === s), at);
    expect(r.gainers).toEqual(['AUSDT', 'BUSDT', 'CUSDT']);
  });

  it('excluye símbolos desconocidos o no perpetuos', () => {
    const r = buildRanking([t('ZZZUSDT', 50), t('AUSDT', 1)], lookup, at);
    expect(r.gainers).toEqual(['AUSDT']);
  });

  it('detecta un símbolo entre los ganadores (AC-07) o los perdedores (AC-06)', () => {
    const r = { gainers: ['BUSDT'], losers: ['EUSDT'], refreshedAt: at };
    expect(inTop3(r, 'BUSDT')).toBe(true);
    expect(inTop3(r, 'EUSDT')).toBe(true);
    expect(inTop3(r, 'AUSDT')).toBe(false);
  });

  it('la copia vale hasta 120 s; después no está disponible (AC-25)', () => {
    const r = { gainers: [], losers: [], refreshedAt: at };
    expect(isRankingFresh(r, new Date(at.getTime() + 120_000))).toBe(true);
    expect(isRankingFresh(r, new Date(at.getTime() + 120_001))).toBe(false);
    expect(isRankingFresh(undefined, at)).toBe(false);
  });
});
