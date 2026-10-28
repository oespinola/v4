// Arranque de la app, separado de main.ts para probarlo con adaptadores falsos (FR-039, FR-058,
// FR-062): valida la configuración antes de construir ningún adaptador, arma store → datos públicos
// → exchange del modo → ejecutor y seguimiento, reconcilia con Binance y recién entonces se suscribe
// a los mensajes de WhatsApp.
import type { Store } from './adapters/store.ts';
import { CONFIG_EXIT_CODE, formatConfigErrors, parseConfig, startupWarnings, type Config } from './config.ts';
import { Executor } from './domain/executor.ts';
import { reconcile } from './domain/reconcile.ts';
import { Tracker } from './domain/tracker.ts';
import { Pipeline, type ProcessOutcome } from './pipeline.ts';
import type { Clock, Exchange, FieldExtractor, MarketData, MessageSource } from './ports.ts';
import { SerialQueue } from './queue.ts';

export interface AppMarket extends MarketData {
  start(): Promise<void>;
  stop(): void;
}

export interface AppWhatsApp extends MessageSource {
  start(): Promise<void>;
  /** Vuelve a conectar tras un corte (FR-055). */
  reconnect(): Promise<void>;
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

function describe(outcome: ProcessOutcome): string | null {
  if (outcome.kind === 'ignored') return null;
  const a = outcome.alert;
  if (a.status === 'rechazada') return `✗ ${a.ticker ?? '?'} rechazada: ${a.reason}`;
  return `✓ ${a.symbol} ${a.side} Entrada ${a.entry} SL ${a.sl} TP ${a.tp} (${a.tpSource}): ${a.status}`;
}

export async function startApp(
  env: Record<string, string | undefined>,
  factories: AppFactories,
  log: (line: string) => void,
  /** Recibe el cierre antes de arrancar WhatsApp: el arranque puede quedar esperando el QR, y un
   *  Ctrl+C en ese momento tiene que cerrar con calma para que la sesión se guarde. */
  onStoppable: (stop: () => Promise<void>) => void = () => {},
): Promise<AppStart> {
  const parsed = parseConfig(env);
  if (!parsed.ok) {
    log(formatConfigErrors(parsed.errors));
    return { ok: false, exitCode: CONFIG_EXIT_CODE };
  }
  const config = parsed.config;
  log(`SignalBridge en modo ${config.mode}`);
  for (const warning of startupWarnings(config)) log(`Aviso: ${warning}`);

  const clock = factories.clock();
  const store = factories.store(config, clock);
  const market = factories.market(config, clock, log);
  await market.start();

  const exchange = factories.exchange(config);
  const executor = new Executor({ exchange, store, clock, symbolLeverage: config.symbolLeverage, riskR: config.riskR });
  const tracker = new Tracker({ exchange, store, clock });

  // FR-039: lo que pasó mientras el proceso estaba detenido, antes de cualquier alerta nueva.
  log('Reconciliando con Binance…');
  await reconcile({ store, executor, tracker });
  tracker.start();

  const pipeline = new Pipeline({
    store,
    clock,
    mode: config.mode,
    authorizedSenders: config.authorizedSenders,
    extractor: factories.extractor(config),
    market,
    maxSlDistancePct: config.maxSlDistancePct,
    trading: {
      exchange,
      executor,
      riskR: config.riskR,
      maxPositions: config.maxPositions,
      maxCapitalUsdt: config.maxCapital,
      maxPositionUsdt: config.maxPositionSize,
      maxLeverage: config.maxLeverage,
    },
  });
  const queue = new SerialQueue((e) => log(`Error procesando un mensaje: ${(e as Error).message}`));

  const whatsapp = factories.whatsapp(config, clock, log);
  whatsapp.onMessage((m) =>
    void queue.push(async () => {
      const line = describe(await pipeline.processMessage(m));
      if (line) log(line);
    }),
  );
  whatsapp.onEdit((e) => void queue.push(() => pipeline.processEdit(e)));

  const stop = async () => {
    market.stop();
    await queue.idle();
    executor.stop();
    tracker.stop();
    await whatsapp.stop();
    store.close();
  };
  onStoppable(stop);
  await whatsapp.start();
  return { ok: true, stop };
}
