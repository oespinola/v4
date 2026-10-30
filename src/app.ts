// Arranque de la app, separado de main.ts para probarlo con adaptadores falsos (FR-039, FR-058,
// FR-062): valida la configuración antes de construir ningún adaptador, arma store → datos públicos
// → exchange del modo → ejecutor y seguimiento, reconcilia con Binance y recién entonces se suscribe
// a los mensajes de WhatsApp.
import type { Store } from './adapters/store.ts';
import { CONFIG_EXIT_CODE, formatConfigErrors, parseConfig, startupWarnings, type Config } from './config.ts';
import { ConnectionMonitor, monitorExchange } from './connection-monitor.ts';
import { closeLine, criticalLine } from './domain/console-line.ts';
import { Executor } from './domain/executor.ts';
import type { AlertLogRecord } from './domain/log-record.ts';
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
  /** Qué errores del exchange son cortes de conexión (R-10). */
  isConnectionError(e: unknown): boolean;
  /** Termina el proceso tras el 10.º fallo de reconexión (FR-055); main.ts cierra con calma. */
  exit(code: number): void;
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
  // FR-071: los cierres y los eventos críticos se muestran además de quedar en el log.
  store.onRecord((type, payload) => {
    const line =
      type === 'alert'
        ? closeLine(payload as unknown as AlertLogRecord)
        : type === 'critical'
          ? criticalLine(
              payload as { kind: string; detail: string },
              typeof payload.alertId === 'string' ? (store.getAlert(payload.alertId)?.symbol ?? null) : null,
            )
          : null;
    if (line) log(line);
  });
  const market = factories.market(config, clock, log);
  await market.start();

  // El ejecutor se crea antes que el monitor, que consulta si hay un cierre de emergencia en curso.
  const monitorRef: { current: ConnectionMonitor | null } = { current: null };
  const exchange = monitorExchange(
    factories.exchange(config),
    { up: (s) => monitorRef.current?.up(s), down: (s, d) => monitorRef.current?.down(s, d) },
    (e) => factories.isConnectionError(e),
  );
  const executor = new Executor({ exchange, store, clock, symbolLeverage: config.symbolLeverage, riskR: config.riskR });
  const tracker = new Tracker({ exchange, store, clock });

  // FR-039: lo que pasó mientras el proceso estaba detenido, antes de cualquier alerta nueva.
  log('Reconciliando con Binance…');
  await reconcile({ store, mode: config.mode, executor, tracker });
  tracker.start();

  const pipeline = new Pipeline({
    store,
    clock,
    mode: config.mode,
    authorizedSenders: config.authorizedSenders,
    extractor: factories.extractor(config),
    market,
    maxSlDistancePct: config.maxSlDistancePct,
    maxEntryDistancePct: config.maxEntryDistancePct,
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
  const monitor = new ConnectionMonitor({
    clock,
    store,
    emergency: executor,
    probes: {
      whatsapp: () => whatsapp.reconnect(),
      binance: async () => void (await exchange.openPositions()),
    },
    exit: (code) => factories.exit(code),
    log,
  });
  monitorRef.current = monitor;
  monitor.start();
  whatsapp.onConnectionChange((up) => (up ? monitor.up('whatsapp') : monitor.down('whatsapp', 'desconectado')));
  whatsapp.onMessage((m) =>
    void queue.push(async () => {
      const line = describe(await pipeline.processMessage(m));
      if (line) log(line);
    }),
  );
  whatsapp.onEdit((e) => void queue.push(() => pipeline.processEdit(e)));

  const stop = async () => {
    monitor.stop();
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
