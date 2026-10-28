// Datos públicos de Binance Futuros USDS-M (R-05): siempre producción y sin credenciales, en DRY y
// en LIVE (FR-017, AC-30). Copia local de símbolos y ranking refrescada cada 60 s; si un refresco
// falla se conserva la anterior y FR-018 controla la antigüedad. Las velas se piden solo cuando el
// TP es por indicadores.
import type { Clock, MarketData, Ranking, TimerHandle } from '../ports.ts';
import { group45m } from '../domain/candles.ts';
import { buildRanking, type Ticker24h } from '../domain/ranking.ts';
import type { SymbolFilters } from '../domain/types.ts';

export const PRODUCTION_URL = 'https://fapi.binance.com';
export const REFRESH_EVERY_MS = 60_000;
// El refresco de fondo baja más de 1 MB y no apura a nadie; las velas están en el camino de la
// alerta (SC-001) y no se alargan.
const REFRESH_TIMEOUT_MS = 15_000;
const KLINES_TIMEOUT_MS = 5_000;
/** 1500 velas de 15 min ≈ 500 de 45 min, de sobra para estabilizar EMA55 (FR-015). */
const KLINES_LIMIT = 1500;

export interface BinancePublicOptions {
  clock: Clock;
  fetch?: typeof fetch;
  baseUrl?: string;
  onRefreshError?: (error: unknown) => void;
}

interface RawSymbol {
  symbol: string;
  status: string;
  contractType: string;
  filters: { filterType: string; tickSize?: string; stepSize?: string; minQty?: string; notional?: string }[];
}

export class BinancePublicMarketData implements MarketData {
  private readonly clock: Clock;
  private readonly fetchFn: typeof fetch;
  private readonly baseUrl: string;
  private readonly onRefreshError: (error: unknown) => void;
  private symbols = new Map<string, SymbolFilters>();
  private currentRanking: Ranking | undefined;
  private timer: TimerHandle | null = null;

  constructor(opts: BinancePublicOptions) {
    this.clock = opts.clock;
    this.fetchFn = opts.fetch ?? fetch;
    this.baseUrl = opts.baseUrl ?? PRODUCTION_URL;
    this.onRefreshError = opts.onRefreshError ?? (() => {});
  }

  private async getJson(path: string, timeoutMs: number): Promise<unknown> {
    // Sin headers ni firma: son endpoints públicos (AC-30).
    const res = await this.fetchFn(`${this.baseUrl}${path}`, { signal: AbortSignal.timeout(timeoutMs) });
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
      const symbols = new Map<string, SymbolFilters>();
      for (const s of info.symbols) {
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
      const parsed: Ticker24h[] = tickers.map((t) => ({ symbol: t.symbol, priceChangePercent: Number(t.priceChangePercent) }));
      this.symbols = symbols;
      this.currentRanking = buildRanking(parsed, (s) => symbols.get(s), this.clock.now());
    } catch (error) {
      this.onRefreshError(error);
    }
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

  async closes45m(symbol: string): Promise<number[]> {
    const path = `/fapi/v1/klines?symbol=${encodeURIComponent(symbol)}&interval=15m&limit=${KLINES_LIMIT}`;
    const data = (await this.getJson(path, KLINES_TIMEOUT_MS)) as [number, string, string, string, string][];
    return group45m(data.map((k) => ({ openTime: k[0], close: Number(k[4]) })));
  }
}
