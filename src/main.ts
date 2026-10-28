// Punto de entrada (pnpm dev = DRY, pnpm start = LIVE). Valida la configuración antes de
// conectarse a nada (FR-058, FR-062) y arma: store → datos públicos → WhatsApp → cola → pipeline.
// Por ahora (US1) clasifica cada alerta, sin colocar órdenes.
import path from 'node:path';
import { BinancePublicMarketData } from './adapters/binance-public.ts';
import { ClaudeExtractor } from './adapters/claude-extractor.ts';
import { SystemClock } from './adapters/clock.ts';
import { Store } from './adapters/store.ts';
import { WhatsAppSource } from './adapters/whatsapp.ts';
import { CONFIG_EXIT_CODE, formatConfigErrors, loadDotEnv, parseConfig, startupWarnings } from './config.ts';
import { Pipeline, type ProcessOutcome } from './pipeline.ts';
import { SerialQueue } from './queue.ts';

function describe(outcome: ProcessOutcome): string | null {
  if (outcome.kind === 'ignored') return null;
  const a = outcome.alert;
  if (a.status === 'rechazada') return `✗ ${a.ticker ?? '?'} rechazada: ${a.reason}`;
  return `✓ ${a.symbol} ${a.side} Entrada ${a.entry} SL ${a.sl} TP ${a.tp} (${a.tpSource})`;
}

async function main(): Promise<void> {
  loadDotEnv();
  const parsed = parseConfig(process.env);
  if (!parsed.ok) {
    console.error(formatConfigErrors(parsed.errors));
    process.exit(CONFIG_EXIT_CODE);
  }
  const config = parsed.config;
  const clock = new SystemClock();
  const log = (line: string) => console.log(`[${clock.now().toISOString()}] ${line}`);
  log(`SignalBridge en modo ${config.mode}`);
  for (const warning of startupWarnings(config)) log(`Aviso: ${warning}`);

  const store = Store.open(config.dataDir, clock);
  const market = new BinancePublicMarketData({
    clock,
    onRefreshError: (e) => log(`No se pudo refrescar símbolos/ranking: ${(e as Error).message}`),
  });
  await market.start();

  const pipeline = new Pipeline({
    store,
    clock,
    mode: config.mode,
    authorizedSenders: config.authorizedSenders,
    extractor: config.anthropicApiKey ? new ClaudeExtractor({ apiKey: config.anthropicApiKey }) : null,
    market,
    maxSlDistancePct: config.maxSlDistancePct,
  });
  const queue = new SerialQueue((e) => log(`Error procesando un mensaje: ${(e as Error).message}`));

  const whatsapp = new WhatsAppSource({
    authDir: path.resolve('.wwebjs_auth'),
    groupName: config.whatsappGroupName,
    now: () => clock.now(),
    log,
  });
  whatsapp.onMessage((m) =>
    void queue.push(async () => {
      const line = describe(await pipeline.processMessage(m));
      if (line) log(line);
    }),
  );
  whatsapp.onEdit((e) => void queue.push(() => pipeline.processEdit(e)));

  let stopping = false;
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    log('Cerrando…');
    market.stop();
    await queue.idle();
    await whatsapp.stop();
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());

  await whatsapp.start();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
