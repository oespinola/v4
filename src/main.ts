// Punto de entrada (pnpm dev = DRY, pnpm start = LIVE): arma los adaptadores reales y arranca la app
// (src/app.ts). DRY opera contra Binance Demo y LIVE contra producción (FR-051).
import path from 'node:path';
import { BinancePublicMarketData, publicDataUrls } from './adapters/binance-public.ts';
import { createExchange, isConnectionError } from './adapters/binance-trading.ts';
import { ClaudeExtractor } from './adapters/claude-extractor.ts';
import { SystemClock } from './adapters/clock.ts';
import { Store } from './adapters/store.ts';
import { WhatsAppSource } from './adapters/whatsapp.ts';
import { startApp, type AppFactories } from './app.ts';
import { loadDotEnv } from './config.ts';

const factories: AppFactories = {
  clock: () => new SystemClock(),
  store: (config, clock) => Store.open(config.dataDir, clock),
  market: (config, clock, log) =>
    new BinancePublicMarketData({
      clock,
      // Ranking y velas de producción; en DRY, filtros de órdenes de Demo (FR-017, FR-066).
      ...publicDataUrls(config.mode),
      onRefreshError: (e) => log(`No se pudo refrescar símbolos/ranking: ${(e as Error).message}`),
    }),
  exchange: (config) => createExchange(config.mode, config.binance).exchange,
  isConnectionError,
  exit: (code) => void fatal(code),
  extractor: (config) => (config.anthropicApiKey ? new ClaudeExtractor({ apiKey: config.anthropicApiKey }) : null),
  whatsapp: (config, clock, log) =>
    new WhatsAppSource({
      authDir: path.resolve('.wwebjs_auth'),
      sessionKey: config.whatsappSessionKey,
      groupName: config.whatsappGroupName,
      now: () => clock.now(),
      log,
      verbose: config.verbose,
    }),
};

const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);
let stopApp: (() => Promise<void>) | null = null;
let stopping = false;

/** Cierra con calma (guarda la sesión de WhatsApp) y sale con `code`: 0 para el operador, 1 para
 *  que el supervisor relance la app (FR-055, FR-056). */
async function fatal(code: number): Promise<void> {
  if (stopping) return;
  stopping = true;
  log('Cerrando…');
  await stopApp?.().catch((e: unknown) => log(`Error al cerrar: ${String(e)}`));
  process.exit(code);
}

async function main(): Promise<void> {
  loadDotEnv();
  process.on('SIGINT', () => void fatal(0));
  process.on('SIGTERM', () => void fatal(0));

  const started = await startApp(process.env, factories, log, (stop) => (stopApp = stop));
  if (!started.ok) process.exit(started.exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
