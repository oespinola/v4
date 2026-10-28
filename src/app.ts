// Arranque de la app, separado de main.ts para probarlo con adaptadores falsos (FR-039, FR-058,
// FR-062): valida la configuración antes de construir ningún adaptador y reconcilia con Binance
// antes de suscribirse a los mensajes de WhatsApp.
import type { Store } from './adapters/store.ts';
import type { Config } from './config.ts';
import type { Clock, Exchange, FieldExtractor, MarketData, MessageSource } from './ports.ts';

export interface AppMarket extends MarketData {
  start(): Promise<void>;
  stop(): void;
}

export interface AppWhatsApp extends MessageSource {
  start(): Promise<void>;
  stop(): Promise<void>;
}

/** Cómo se construye cada adaptador; main.ts pasa los reales. */
export interface AppFactories {
  clock(): Clock;
  store(config: Config, clock: Clock): Store;
  market(config: Config, clock: Clock, log: (line: string) => void): AppMarket;
  exchange(config: Config): Exchange;
  extractor(config: Config): FieldExtractor | null;
  whatsapp(config: Config, clock: Clock, log: (line: string) => void): AppWhatsApp;
}

export type AppStart = { ok: false; exitCode: number } | { ok: true; stop(): Promise<void> };

export async function startApp(
  _env: Record<string, string | undefined>,
  _factories: AppFactories,
  _log: (line: string) => void,
): Promise<AppStart> {
  throw new Error('no implementado');
}
