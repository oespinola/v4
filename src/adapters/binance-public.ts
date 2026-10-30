// Datos públicos de Binance Futuros USDS-M (R-05): ranking, velas y símbolos siempre de producción y
// sin credenciales, en DRY y en LIVE (FR-017, AC-30). En DRY, además, los filtros de órdenes (tick,
// step y mínimos) salen de Binance Demo, que rechaza órdenes armadas con los de producción, y lo que
// Demo no opera queda marcado (FR-066, FR-067). Copia local refrescada cada 60 s; si un refresco
// falla se conserva la anterior y FR-018 controla la antigüedad. Las velas se piden solo cuando el
// TP es por indicadores.
import type { Clock, MarketData, Ranking, TimerHandle } from '../ports.ts';
import { group45m } from '../domain/candles.ts';
import { buildRanking, type Ticker24h } from '../domain/ranking.ts';
import { isTradablePerpetual } from '../domain/symbols.ts';
import type { MarketSummary } from '../domain/console-line.ts';
import type { SymbolFilters } from '../domain/types.ts';

export const PRODUCTION_URL = 'https://fapi.binance.com';
export const DEMO_URL = 'https://demo-fapi.binance.com';
export const REFRESH_EVERY_MS = 60_000;
// El refresco de fondo baja más de 1 MB y no apura a nadie; las velas están en el camino de la
// alerta (SC-001) y no se alargan.
const REFRESH_TIMEOUT_MS = 15_000;
const KLINES_TIMEOUT_MS = 5_000;
/** 1500 velas de 15 min ≈ 500 de 45 min, de sobra para estabilizar EMA55 (FR-015). */
const KLINES_LIMIT = 1500;

/** Datos públicos del modo: ranking, velas y símbolos siempre de producción; en DRY, además, los
 *  filtros de órdenes de Demo (FR-017, FR-066). */
export function publicDataUrls(mode: 'DRY' | 'LIVE'): { baseUrl: string; orderRulesUrl: string | undefined } {
  return { baseUrl: PRODUCTION_URL, orderRulesUrl: mode === 'DRY' ? DEMO_URL : undefined };
}

export interface BinancePublicOptions {
  clock: Clock;
  fetch?: typeof fetch;
  baseUrl?: string;
  onRefreshError?: (error: unknown) => void;
  /** Solo en DRY: de dónde salen los filtros de órdenes (FR-066). */
  orderRulesUrl?: string;
}

interface RawSymbol {
  symbol: string;
  status: string;
  contractType: string;
  filters: { filterType: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string }[];
}

function parseSymbols(raw: RawSymbol[]): Map<string, SymbolFilters> {
  const symbols = new Map<string, SymbolFilters>();
  for (const s of raw) {
    const filter = (type: string) => s.filters.find((f) => f.filterType === type);
    symbols.set(s.symbol, {
      symbol: s.symbol,
      status: s.status,
      contractType: s.contractType,
      tickSize: Number(filter('PRICE_FILTER')?.tickSize ?? 0),
      stepSize: Number(filter('LOT_SIZE')?.stepSize ?? 0),
      minQty: Number(filter('LOT_SIZE')?.minQty ?? 0),
      minNotional: Number(filter('MIN_NOTIONAL')?.notional ?? 0),
    });
  }
  return symbols;
}

/** Símbolos de producción con los filtros de órdenes de Demo cuando Demo los opera (FR-066). */
function withOrderRules(
  production: Map<string, SymbolFilters>,
  demo: Map<string, SymbolFilters> | null,
): Map<string, SymbolFilters> {
  const merged = new Map<string, SymbolFilters>();
  for (const [name, s] of production) {
    const r = demo?.get(name);
    merged.set(
      name,
      r && isTradablePerpetual(r)
        ? { ...s, tickSize: r.tickSize, stepSize: r.stepSize, minQty: r.minQty, minNotional: r.minNotional }
        : s,
    );
  }
  return merged;
}

export class BinancePublicMarketData implements MarketData {
  private readonly clock: Clock;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly onRefreshError: (error: unknown) => void;
  private readonly orderRulesUrl: string | null;
  private production = new Map<string, SymbolFilters>();
  /** Copia de Demo (solo DRY); null mientras nunca se pudo leer. */
  private demo: Map<string, SymbolFilters> | null = null;
  private symbols = new Map<string, SymbolFilters>();
  private currentRanking: Ranking | undefined;
  private timer: TimerHandle | null = null;

  constructor(opts: BinancePublicOptions) {
    this.clock = opts.clock;
    this.fetchFn = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? PRODUCTION_URL;
    this.onRefreshError = opts.onRefreshError ?? (() => {});
    this.orderRulesUrl = opts.orderRulesUrl ?? null;
  }

  private async getJson(path: string, timeoutMs: number, baseUrl = this.baseUrl): Promise<unknown> {
    // Sin headers ni firma: son endpoints públicos (AC-30).
    const res = await this.fetchFn(`${baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`Binance ${path}: HTTP ${res.status}`);
    return res.json();
  }

  /** Refresca símbolos y ranking. Nunca lanza: ante un error conserva la copia anterior. */
  async refresh(): Promise<void> {
    try {
      const [info, tickers] = await Promise.all([
        this.getJson('/fapi/v1/exchangeInfo', REFRESH_TIMEOUT_MS) as Promise<{ symbols: RawSymbol[] }>,
        this.getJson('/fapi/v1/ticker/24hr', REFRESH_TIMEOUT_MS) as Promise<{ symbol: string; priceChangePercent: string }[]>,
      ]);
      const production = parseSymbols(info.symbols);
      const parsed: Ticker24h[] = tickers.map((t) => ({ symbol: t.symbol, priceChangePercent: Number(t.priceChangePercent) }));
      this.production = production;
      this.currentRanking = buildRanking(parsed, (s) => production.get(s), this.clock.now());
    } catch (error) {
      this.onRefreshError(error);
    }
    if (this.orderRulesUrl) {
      try {
        const info = (await this.getJson('/fapi/v1/exchangeInfo', REFRESH_TIMEOUT_MS, this.orderRulesUrl)) as {
          symbols: RawSymbol[];
        };
        this.demo = parseSymbols(info.symbols);
      } catch (error) {
        this.onRefreshError(error);
      }
    }
    this.symbols = this.orderRulesUrl ? withOrderRules(this.production, this.demo) : this.production;
  }

  async start(): Promise<void> {
    await this.refresh();
    this.timer = this.clock.setInterval(() => void this.refresh(), REFRESH_EVERY_MS);
  }

  stop(): void {
    if (this.timer) this.clock.clearInterval(this.timer);
    this.timer = null;
  }

  symbol(name: string): SymbolFilters | undefined {
    return this.symbols.get(name);
  }

  ranking(): Ranking | undefined {
    return this.currentRanking;
  }

  /** Símbolos cargados y, en DRY, cuántos no se operan en Demo (FR-072). */
  summary(): MarketSummary {
    const names = [...this.production.keys()];
    return {
      symbols: names.length,
      missingInDemo: this.orderRulesUrl ? names.filter((n) => !this.availableForOrders(n)).length : null,
    };
  }

  availableForOrders(name: string): boolean {
    if (!this.orderRulesUrl) return true;
    const rules = this.demo?.get(name);
    return rules !== undefined && isTradablePerpetual(rules);
  }

  async closes45m(symbol: string): Promise<number[]> {
    const path = `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=15m&limit=${KLINES_LIMIT}`;
    const data = (await this.getJson(path, KLINES_TIMEOUT_MS)) as [number, string, string, string, string][];
    return group45m(data.map((k) => ({ openTime: k[0], close: Number(k[4]) })));
  }
}
