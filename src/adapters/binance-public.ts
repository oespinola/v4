// Datos públicos de Binance Futuros USDS-M (R-05). Pendiente de implementar (T040).
import type { Clock, MarketData, Ranking } from '../ports.ts';
import type { SymbolFilters } from '../domain/types.ts';

export const PRODUCTION_URL = 'https://fapi.binance.com';

export interface BinancePublicOptions {
  clock: Clock;
  fetch?: typeof fetch;
  onRefreshError?: (error: unknown) => void;
}

export class BinancePublicMarketData implements MarketData {
  constructor(_opts: BinancePublicOptions) {}
  private ni(): never {
    throw new Error('binance-public: no implementado');
  }
  async refresh(): Promise<void> {
    this.ni();
  }
  async start(): Promise<void> {
    this.ni();
  }
  stop(): void {}
  symbol(_name: string): SymbolFilters | undefined {
    return this.ni();
  }
  ranking(): Ranking | undefined {
    return this.ni();
  }
  async closes45m(_symbol: string): Promise<number[]> {
    return this.ni();
  }
}
