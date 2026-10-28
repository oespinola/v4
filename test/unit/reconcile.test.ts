import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/adapters/store.ts';
import { ENTRY_TIMEOUT_MS, Executor, POLL_MS } from '../../src/domain/executor.ts';
import { reconcile } from '../../src/domain/reconcile.ts';
import { TRACK_POLL_MS, Tracker } from '../../src/domain/tracker.ts';
import type { Trade } from '../../src/domain/types.ts';
import type { CloseInfo, FoundEntry, OrderRef, OrderStatus, PositionState } from '../../src/ports.ts';
import { ALERT } from '../helpers/executor.ts';
import { FakeClock, FakeExchange } from '../fakes/index.ts';

const PLACED_AT = new Date('2026-10-28T12:00:01Z');
const ENTRY: OrderRef = { symbol: 'KAIAUSDT', id: 'E1' };
const SL: OrderRef = { symbol: 'KAIAUSDT', id: 'SL1', algo: true };
const TP: OrderRef = { symbol: 'KAIAUSDT', id: 'TP1', algo: true };

const trade = (over: Partial<Trade>): Trade => ({
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
  slOrderId: null,
  tpOrderId: null,
  entryPlacedAt: PLACED_AT,
  filledQty: 0,
  state: 'pendiente',
  closeCause: null,
  closedAt: null,
  realizedPnl: null,
  fees: null,
  ...over,
});

describe('reconciliación al arrancar (FR-039 a FR-042, FR-065)', () => {
  let root: string;
  let clock: FakeClock;
  let store: Store;
  let exchange: FakeExchange;
  let executor: Executor;
  let tracker: Tracker;
  let entry: { status: OrderStatus; filledQty: number };
  let positions: PositionState[];
  let openOrders: OrderRef[];
  let close: CloseInfo | null;
  let found: FoundEntry | null;
  const prevUmask = process.umask();

  const logLines = () =>
    readFileSync(path.join(root, 'data', 'alerts.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const run = () => reconcile({ store, mode: 'DRY', executor, tracker });
  const saved = () => store.getTrade(ALERT.alertId);

  /** El proceso vuelve a arrancar `minutes` después de colocar la entrada. */
  function boot(t: Trade | null, alertStatus: 'válida' | 'entrada pendiente' | 'con ejecución' | 'completa', minutes: number) {
    clock = new FakeClock(new Date(PLACED_AT.getTime() + minutes * 60_000));
    store = Store.open(path.join(root, 'data'), clock);
    store.saveAlert({ ...ALERT, status: alertStatus });
    if (t) store.saveTrade(t);
    exchange = new FakeExchange({
      findEntry: async () => found,
      order: async (r) => ({ ref: r, status: entry.status, filledQty: entry.filledQty }),
      cancel: async (r) => {
        if (r.id === 'E1' && (entry.status === 'open' || entry.status === 'partially_filled')) entry.status = 'canceled';
      },
      placeStopLoss: async () => SL,
      placeTakeProfit: async () => TP,
      closeAtMarket: async () => ({ symbol: 'KAIAUSDT', id: 'MKT1' }),
      openPositions: async () => positions,
      openOrders: async () => openOrders,
      closeOf: async () => close,
    });
    executor = new Executor({ exchange, store, clock, symbolLeverage: 2, riskR: 5 });
    tracker = new Tracker({ exchange, store, clock });
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-reconcile-'));
    entry = { status: 'open', filledQty: 0 };
    positions = [];
    openOrders = [];
    close = null;
    found = null;
  });

  afterEach(() => {
    executor.stop();
    tracker.stop();
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  describe('alerta válida sin operación: la entrada pudo quedar en Binance sin registrar (FR-070)', () => {
    it('entrada aceptada y ejecutada: registra la operación con la cantidad de Binance y la protege (AC-86)', async () => {
      boot(null, 'válida', 5);
      found = { ref: ENTRY, quantity: 4166, placedAt: PLACED_AT };
      entry = { status: 'filled', filledQty: 4166 };
      positions = [{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166 }];
      await run();
      expect(exchange.calls[0]?.method).toBe('findEntry'); // antes que todo lo demás
      expect(saved()).toMatchObject({ state: 'abierta', entryOrderId: 'E1', quantity: 4166, filledQty: 4166, entryPlacedAt: PLACED_AT });
      expect(exchange.callsTo('placeStopLoss')).toHaveLength(1);
      expect(exchange.callsTo('placeTakeProfit')).toHaveLength(1);
      expect(logLines()).toEqual([expect.objectContaining({ status: 'completa' })]);
    });

    it('entrada aceptada sin ejecución: la cancela y queda "entrada no ejecutada", que bloquea el reenvío', async () => {
      boot(null, 'válida', 5);
      found = { ref: ENTRY, quantity: 4166, placedAt: PLACED_AT };
      await run();
      expect(exchange.callsTo('cancel').map((c) => c.args[0])).toEqual([ENTRY]);
      expect(saved()?.state).toBe('cerrada');
      expect(store.getAlert(ALERT.alertId)?.status).toBe('entrada no ejecutada');
      expect(store.hasContentHashSince(ALERT.contentHash, ALERT.receivedAt)).toBe(true);
    });

    it('entrada inexistente: "entrada no ejecutada" sin operación, y el reenvío se evalúa de nuevo (AC-87)', async () => {
      boot(null, 'válida', 5);
      await run();
      expect(saved()).toBeUndefined();
      expect(store.getAlert(ALERT.alertId)?.status).toBe('entrada no ejecutada');
      expect(logLines()).toEqual([expect.objectContaining({ status: 'entrada no ejecutada' })]);
      expect(store.hasContentHashSince(ALERT.contentHash, ALERT.receivedAt)).toBe(false);
    });

    it('no busca las alertas del otro modo: están en otra cuenta', async () => {
      boot(null, 'válida', 5);
      await reconcile({ store, mode: 'LIVE', executor, tracker });
      expect(exchange.callsTo('findEntry')).toHaveLength(0);
      expect(store.getAlert(ALERT.alertId)?.status).toBe('válida');
    });
  });

  it('posición cerrada por SL durante la caída: registra el cierre y cancela el TP huérfano (AC-63, FR-040)', async () => {
    boot(trade({ state: 'abierta', filledQty: 4166, slOrderId: 'SL1', tpOrderId: 'TP1' }), 'completa', 30);
    close = { cause: 'SL', at: new Date('2026-10-28T12:20:00Z'), realizedPnl: -5, fees: 0.06 };
    await run();
    expect(saved()).toMatchObject({ state: 'cerrada', closeCause: 'SL' });
    expect(exchange.callsTo('cancel').map((c) => c.args[0])).toContainEqual(TP);
    expect(logLines()).toEqual([expect.objectContaining({ status: 'cerrada', closeCause: 'SL' })]);
  });

  it('entrada pendiente ejecutada durante la caída: coloca SL y TP antes de seguir (AC-65, FR-041)', async () => {
    boot(trade({}), 'entrada pendiente', 1);
    entry = { status: 'filled', filledQty: 4166 };
    positions = [{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166 }];
    await run();
    expect(exchange.callsTo('placeStopLoss')).toHaveLength(1);
    expect(exchange.callsTo('placeTakeProfit')).toHaveLength(1);
    expect(saved()).toMatchObject({ state: 'abierta', slOrderId: 'SL1', tpOrderId: 'TP1', filledQty: 4166 });
    expect(logLines()).toEqual([expect.objectContaining({ status: 'completa' })]);
  });

  it('entrada ejecutada pero SL rechazado: cierra a mercado con evento crítico (FR-041)', async () => {
    boot(trade({}), 'entrada pendiente', 1);
    entry = { status: 'filled', filledQty: 4166 };
    exchange.impl.placeStopLoss = async () => Promise.reject(new Error('-2021'));
    await run();
    expect(exchange.callsTo('closeAtMarket')).toHaveLength(1);
    expect(store.getAlert(ALERT.alertId)?.status).toBe('cerrada por emergencia');
    expect(logLines().map((l) => l.type)).toEqual(['critical', 'alert']);
  });

  it('entrada sin ejecución con el plazo vencido: la cancela y queda "entrada no ejecutada" (AC-66, FR-042)', async () => {
    boot(trade({}), 'entrada pendiente', 10);
    await run();
    expect(exchange.callsTo('cancel').map((c) => c.args[0])).toEqual([ENTRY]);
    expect(saved()?.state).toBe('cerrada');
    expect(logLines()).toEqual([expect.objectContaining({ status: 'entrada no ejecutada' })]);
  });

  it('entrada parcial con el plazo vencido: SL y TP sobre lo ejecutado y cancela el resto (FR-042, FR-032)', async () => {
    boot(trade({}), 'entrada pendiente', 10);
    entry = { status: 'partially_filled', filledQty: 1000 };
    await run();
    expect(exchange.callsTo('placeStopLoss')).toHaveLength(1);
    expect(exchange.callsTo('cancel').map((c) => c.args[0])).toEqual([ENTRY]);
    expect(saved()).toMatchObject({ state: 'abierta', filledQty: 1000 });
  });

  it('entrada sin ejecución dentro del plazo: sigue el seguimiento y la cancela al vencer', async () => {
    boot(trade({}), 'entrada pendiente', 1);
    await run();
    expect(saved()?.state).toBe('pendiente');
    expect(exchange.callsTo('cancel')).toHaveLength(0);
    await clock.advance(2 * 60_000);
    expect(exchange.callsTo('cancel').map((c) => c.args[0])).toEqual([ENTRY]);
    expect(saved()?.state).toBe('cerrada');
  });

  it('con ejecución y sin SL/TP confirmados: coloca solo lo que falta (AC-73, FR-065)', async () => {
    boot(trade({ state: 'con_ejecución', filledQty: 4166, slOrderId: 'SL1' }), 'con ejecución', 5);
    entry = { status: 'filled', filledQty: 4166 };
    positions = [{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166 }];
    openOrders = [SL]; // el SL llegó a colocarse antes de la caída; el TP no
    await run();
    expect(exchange.callsTo('placeStopLoss')).toHaveLength(0);
    expect(exchange.callsTo('placeTakeProfit')).toHaveLength(1);
    expect(saved()).toMatchObject({ state: 'abierta', slOrderId: 'SL1', tpOrderId: 'TP1' });
    expect(logLines()).toEqual([expect.objectContaining({ status: 'completa' })]);
  });

  it('con ejecución y el TP que falta falla: cierra a mercado, evento crítico y cancela el SL (AC-73)', async () => {
    boot(trade({ state: 'con_ejecución', filledQty: 4166, slOrderId: 'SL1' }), 'con ejecución', 5);
    entry = { status: 'filled', filledQty: 4166 };
    positions = [{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166 }];
    openOrders = [SL];
    exchange.impl.placeTakeProfit = async () => Promise.reject(new Error('-4130'));
    await run();
    expect(exchange.callsTo('closeAtMarket')).toHaveLength(1);
    expect(exchange.callsTo('cancel').map((c) => c.args[0])).toContainEqual(SL);
    expect(store.getAlert(ALERT.alertId)?.status).toBe('cerrada por emergencia');
    expect(logLines().filter((l) => l.type === 'critical')).toEqual([expect.objectContaining({ kind: 'cierre de emergencia' })]);
  });

  it('con ejecución y la posición ya no está en Binance: se registra el cierre (FR-040)', async () => {
    boot(trade({ state: 'con_ejecución', filledQty: 4166 }), 'con ejecución', 5);
    entry = { status: 'filled', filledQty: 4166 };
    close = { cause: 'cierre manual', at: new Date('2026-10-28T12:03:00Z'), realizedPnl: 1, fees: 0.06 };
    await run();
    expect(exchange.callsTo('placeStopLoss')).toHaveLength(0);
    expect(saved()).toMatchObject({ state: 'cerrada', closeCause: 'cierre manual' });
    expect(logLines()).toEqual([expect.objectContaining({ status: 'cerrada', closeCause: 'cierre manual' })]);
  });

  it('una operación abierta que perdió el SL: solo evento crítico, sin recolocarlo (FR-038)', async () => {
    boot(trade({ state: 'abierta', filledQty: 4166, slOrderId: 'SL1', tpOrderId: 'TP1' }), 'completa', 30);
    positions = [{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166 }];
    openOrders = [TP];
    await run();
    tracker.start();
    await clock.advance(TRACK_POLL_MS * 2);
    expect(exchange.callsTo('placeStopLoss')).toHaveLength(0);
    expect(logLines()).toEqual([expect.objectContaining({ type: 'critical', kind: 'SL/TP perdido' })]);
  });

  it('sin operaciones locales activas no consulta Binance', async () => {
    boot(trade({ state: 'cerrada' }), 'completa', 30);
    await run();
    await clock.advance(POLL_MS + ENTRY_TIMEOUT_MS);
    expect(exchange.calls).toEqual([]);
  });
});
