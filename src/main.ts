// Punto de entrada (pnpm dev = DRY, pnpm start = LIVE): arma los adaptadores reales y arranca la app
// (src/app.ts). DRY opera contra Binance Demo y LIVE contra producción (FR-051).
import path from 'node:path';
import { BinancePublicMarketData, publicDataUrls } from './adapters/binance-public.ts';
import { createExchange } from './adapters/binance-trading.ts';
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
  extractor: (config) => (config.anthropicApiKey ? new ClaudeExtractor({ apiKey: config.anthropicApiKey }) : null),
  whatsapp: (config, clock, log) =>
    new WhatsAppSource({
      authDir: path.resolve('.wwebjs_auth'),
      sessionKey: config.whatsappSessionKey,
      groupName: config.whatsappGroupName,
      now: () => clock.now(),
      log,
    }),
};

async function main(): Promise<void> {
  loadDotEnv();
  const log = (line: string) => console.log(`[${new Date().toISOString()}] ${line}`);
  let stopApp: (() => Promise<void>) | null = null;
  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log('Cerrando…');
    await stopApp?.();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  const started = await startApp(process.env, factories, log, (stop) => (stopApp = stop));
  if (!started.ok) process.exit(started.exitCode);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
