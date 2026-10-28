// Armado común de los tests del ejecutor: store real en un directorio temporal, reloj fake y un
// exchange fake cuya orden de entrada se puede ir ejecutando a mano.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Store } from '../../src/adapters/store.ts';
import { Executor } from '../../src/domain/executor.ts';
import type { Alert } from '../../src/domain/types.ts';
import type { Exchange, OrderRef, OrderStatus } from '../../src/ports.ts';
import { FakeClock, FakeExchange } from '../fakes/index.ts';

export const ALERT: Alert = {
  alertId: 'wa-1:0123456789abcdef',
  waMessageId: 'wa-1',
  contentHash: '0123456789abcdef',
  receivedAt: new Date('2026-10-28T12:00:00Z'),
  classifiedAt: new Date('2026-10-28T12:00:00.500Z'),
  mode: 'DRY',
  sender: '5491100000001',
  text: '*KAIA - ALERTA DE TRADING*',
  ticker: 'KAIA',
  riskLevel: 'Alto',
  entryRaw: 0.0402,
  slRaw: 0.0414,
  target: { price: 0.038 },
  symbol: 'KAIAUSDT',
  priceFactor: 1,
  side: 'SHORT',
  entry: 0.0402,
  sl: 0.0414,
  tp: 0.038,
  tpSource: 'alerta',
  status: 'válida',
  reason: null,
};

export const SIZED = { quantity: 4166, notional: 167.4732 };

export function setupExecutor(impl: Partial<Exchange> = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'sb-exec-'));
  const prevUmask = process.umask();
  const clock = new FakeClock('2026-10-28T12:00:01Z');
  const store = Store.open(path.join(root, 'data'), clock);
  const entry = { status: 'open' as OrderStatus, filledQty: 0 };
  const ref = (id: string): OrderRef => ({ symbol: 'KAIAUSDT', id });
  const exchange = new FakeExchange({
    prepareSymbol: async () => {},
    placeLimitEntry: async () => ref('E1'),
    findEntry: async () => null,
    order: async (r) => ({ ref: r, status: entry.status, filledQty: entry.filledQty }),
    placeStopLoss: async () => ref('SL1'),
    placeTakeProfit: async () => ref('TP1'),
    cancel: async () => {
      if (entry.status === 'open' || entry.status === 'partially_filled') entry.status = 'canceled';
    },
    closeAtMarket: async () => ref('MKT1'),
    ...impl,
  });
  store.saveAlert(ALERT);
  const executor = new Executor({ exchange, store, clock, symbolLeverage: 2, riskR: 5 });
  const logLines = () =>
    readFileSync(path.join(root, 'data', 'alerts.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const fill = (qty: number) => {
    entry.filledQty = qty;
    entry.status = qty >= SIZED.quantity ? 'filled' : 'partially_filled';
  };
  const cleanup = () => {
    executor.stop();
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  };
  return { clock, store, exchange, executor, entry, fill, logLines, cleanup };
}
