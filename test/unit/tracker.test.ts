import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/adapters/store.ts';
import { TRACK_POLL_MS, Tracker } from '../../src/domain/tracker.ts';
import type { Trade } from '../../src/domain/types.ts';
import type { CloseInfo, OrderRef, PositionState } from '../../src/ports.ts';
import { ALERT } from '../helpers/executor.ts';
import { FakeClock, FakeExchange } from '../fakes/index.ts';

const SL: OrderRef = { symbol: 'KAIAUSDT', id: 'SL1', algo: true };
const TP: OrderRef = { symbol: 'KAIAUSDT', id: 'TP1', algo: true };
const OPEN_TRADE: Trade = {
  alertId: ALERT.alertId,
  symbol: 'KAIAUSDT',
  side: 'SHORT',
  quantity: 4166,
  notional: 167.4732,
  riskR: 5,
  symbolLeverage: 2,
  entryPrice: 0.0402,
  slPrice: 0.0414,
  tpPrice: 0.038,
  entryOrderId: 'E1',
  slOrderId: 'SL1',
  tpOrderId: 'TP1',
  entryPlacedAt: new Date('2026-10-28T12:00:01Z'),
  filledQty: 4166,
  state: 'abierta',
  closeCause: null,
  closedAt: null,
  realizedPnl: null,
  fees: null,
};

describe('seguimiento hasta el cierre (FR-033 a FR-038, SC-004)', () => {
  let root: string;
  let clock: FakeClock;
  let store: Store;
  let exchange: FakeExchange;
  let tracker: Tracker;
  let positions: PositionState[];
  let openOrders: OrderRef[];
  let close: CloseInfo | null;
  const prevUmask = process.umask();

  const logLines = () =>
    readFileSync(path.join(root, 'data', 'alerts.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-track-'));
    clock = new FakeClock('2026-10-28T13:00:00Z');
    store = Store.open(path.join(root, 'data'), clock);
    store.saveAlert({ ...ALERT, status: 'completa' });
    store.saveTrade(OPEN_TRADE);
    positions = [{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166 }];
    openOrders = [SL, TP];
    close = null;
    exchange = new FakeExchange({
      openPositions: async () => positions,
      openOrders: async () => openOrders,
      closeOf: async () => close,
      cancel: async () => {},
    });
    tracker = new Tracker({ exchange, store, clock });
    tracker.start();
  });

  afterEach(() => {
    tracker.stop();
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  const closeBy = (cause: CloseInfo['cause']) => {
    positions = [];
    close = { cause, at: new Date('2026-10-28T13:00:01Z'), realizedPnl: 9.16, fees: 0.06 };
  };

  it('cierre por TP: "cerrada" con causa, hora, PnL y comisiones (AC-56)', async () => {
    closeBy('TP');
    await clock.advance(TRACK_POLL_MS);
    expect(exchange.callsTo('closeOf')[0]?.args).toEqual([
      { symbol: 'KAIAUSDT', side: 'SHORT', entryOrderId: 'E1', sl: SL, tp: TP, since: OPEN_TRADE.entryPlacedAt },
    ]);
    expect(store.getTrade(ALERT.alertId)).toMatchObject({
      state: 'cerrada',
      closeCause: 'TP',
      closedAt: new Date('2026-10-28T13:00:01Z'),
      realizedPnl: 9.16,
      fees: 0.06,
    });
    expect(store.getAlert(ALERT.alertId)?.status).toBe('cerrada');
    expect(logLines()).toEqual([
      expect.objectContaining({
        type: 'alert',
        status: 'cerrada',
        closeCause: 'TP',
        closedAt: '2026-10-28T13:00:01.000Z',
        realizedPnl: 9.16,
        fees: 0.06,
      }),
    ]);
  });

  for (const [cause, status] of [
    ['SL', 'cerrada'],
    ['cierre manual', 'cerrada'],
    ['liquidación', 'liquidada'],
  ] as const) {
    it(`cierre por ${cause}: estado "${status}" (AC-57, AC-58, AC-59)`, async () => {
      closeBy(cause);
      await clock.advance(TRACK_POLL_MS);
      expect(store.getTrade(ALERT.alertId)?.closeCause).toBe(cause);
      expect(logLines().at(-1)).toMatchObject({ status, closeCause: cause });
    });
  }

  it('al cerrar cancela las órdenes de SL y TP que quedaron (AC-60)', async () => {
    closeBy('TP');
    await clock.advance(TRACK_POLL_MS);
    expect(exchange.callsTo('cancel').map((c) => c.args[0])).toEqual([SL, TP]);
  });

  it('el cierre libera el cupo para la próxima alerta (AC-61, FR-035)', async () => {
    expect(store.exposure()).toEqual({ positions: 1, notional: 167.4732 });
    closeBy('SL');
    await clock.advance(TRACK_POLL_MS);
    expect(store.exposure()).toEqual({ positions: 0, notional: 0 });
    expect(store.activeTradeForSymbol('KAIAUSDT')).toBeUndefined();
  });

  it('detecta el cierre en < 10 s (SC-004)', async () => {
    await clock.advance(TRACK_POLL_MS * 3);
    closeBy('TP');
    const closedAt = clock.now().getTime();
    await clock.advance(10_000);
    const detected = logLines().find((l) => l.type === 'alert');
    expect(detected).toBeDefined();
    expect(Date.parse(String(detected!.at)) - closedAt).toBeLessThan(10_000);
  });

  it('si Binance todavía no informa el cierre, vuelve a mirar en el próximo ciclo', async () => {
    positions = [];
    await clock.advance(TRACK_POLL_MS);
    expect(store.getTrade(ALERT.alertId)?.state).toBe('abierta');
    expect(exchange.callsTo('cancel')).toHaveLength(0);
    close = { cause: 'TP', at: clock.now(), realizedPnl: 1, fees: 0.1 };
    await clock.advance(TRACK_POLL_MS);
    expect(store.getTrade(ALERT.alertId)?.state).toBe('cerrada');
  });

  it('SL desaparecido con la posición abierta: un evento crítico, sin tocar la posición ni el TP (AC-64)', async () => {
    await clock.advance(TRACK_POLL_MS);
    openOrders = [TP];
    await clock.advance(TRACK_POLL_MS * 5);
    const critical = logLines().filter((l) => l.type === 'critical');
    expect(critical).toEqual([expect.objectContaining({ kind: 'SL/TP perdido', alertId: ALERT.alertId })]);
    expect(String(critical[0]!.detail)).toMatch(/SL/);
    expect(exchange.callsTo('cancel')).toHaveLength(0);
    expect(exchange.callsTo('closeAtMarket')).toHaveLength(0);
    expect(store.getTrade(ALERT.alertId)?.state).toBe('abierta');
  });

  it('una falta de un solo ciclo (el SL se está disparando) no es evento crítico', async () => {
    openOrders = [TP];
    await clock.advance(TRACK_POLL_MS);
    openOrders = [SL, TP];
    await clock.advance(TRACK_POLL_MS * 3);
    expect(exchange.callsTo('openOrders').length).toBeGreaterThanOrEqual(4);
    expect(logLines().filter((l) => l.type === 'critical')).toEqual([]);
  });

  it('si falla la consulta de posiciones, no cambia nada y sigue mirando', async () => {
    let fail = true;
    exchange.impl.openPositions = async () => (fail ? Promise.reject(new Error('timeout')) : positions);
    closeBy('TP');
    await clock.advance(TRACK_POLL_MS);
    expect(store.getTrade(ALERT.alertId)?.state).toBe('abierta');
    fail = false;
    await clock.advance(TRACK_POLL_MS);
    expect(store.getTrade(ALERT.alertId)?.state).toBe('cerrada');
  });

  it('sin operaciones abiertas no consulta Binance', async () => {
    closeBy('TP');
    await clock.advance(TRACK_POLL_MS);
    const calls = exchange.calls.length;
    await clock.advance(TRACK_POLL_MS * 5);
    expect(exchange.calls.length).toBe(calls);
  });
});
