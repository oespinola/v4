import { afterEach, describe, expect, it } from 'vitest';
import { ENTRY_TIMEOUT_MS, POLL_MS, entryClientOrderId } from '../../src/domain/executor.ts';
import { ALERT, SIZED, setupExecutor } from '../helpers/executor.ts';

describe('ejecutor: colocación y estados (FR-027 a FR-032, FR-060, FR-065)', () => {
  let t: ReturnType<typeof setupExecutor>;
  afterEach(() => t.cleanup());

  it('prepara margen aislado y apalancamiento y coloca la entrada LIMIT al precio E (AC-43, FR-060)', async () => {
    t = setupExecutor();
    const trade = await t.executor.open(ALERT, SIZED);
    expect(t.exchange.calls.map((c) => c.method)).toEqual(['prepareSymbol', 'placeLimitEntry']);
    expect(t.exchange.callsTo('prepareSymbol')[0]?.args).toEqual(['KAIAUSDT', 2]);
    expect(t.exchange.callsTo('placeLimitEntry')[0]?.args).toMatchObject([{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166, price: 0.0402 }]);
    expect(trade).toMatchObject({ state: 'pendiente', entryOrderId: 'E1', quantity: 4166, notional: 167.4732, riskR: 5, symbolLeverage: 2 });
    expect(t.store.getTrade(ALERT.alertId)?.state).toBe('pendiente');
    expect(t.store.getAlert(ALERT.alertId)?.status).toBe('entrada pendiente');
  });

  it('sin ejecución no envía SL ni TP (AC-44)', async () => {
    t = setupExecutor();
    await t.executor.open(ALERT, SIZED);
    await t.clock.advance(POLL_MS * 10);
    expect(t.exchange.callsTo('order').length).toBeGreaterThanOrEqual(10);
    expect(t.exchange.callsTo('placeStopLoss')).toHaveLength(0);
    expect(t.exchange.callsTo('placeTakeProfit')).toHaveLength(0);
  });

  it('al primer fill guarda con_ejecución antes de pedir el SL (FR-065)', async () => {
    const seen: (string | undefined)[] = [];
    t = setupExecutor({
      placeStopLoss: async () => {
        seen.push(t.store.getTrade(ALERT.alertId)?.state);
        return { symbol: 'KAIAUSDT', id: 'SL1' };
      },
    });
    await t.executor.open(ALERT, SIZED);
    t.fill(1000);
    await t.clock.advance(POLL_MS);
    expect(seen).toEqual(['con_ejecución']);
  });

  it('con un fill parcial coloca SL y TP del lado de la posición (AC-55)', async () => {
    t = setupExecutor();
    await t.executor.open(ALERT, SIZED);
    t.fill(1000);
    await t.clock.advance(POLL_MS);
    expect(t.exchange.callsTo('placeStopLoss')[0]?.args).toEqual(['KAIAUSDT', 'SHORT', 0.0414]);
    expect(t.exchange.callsTo('placeTakeProfit')[0]?.args).toEqual(['KAIAUSDT', 'SHORT', 0.038]);
  });

  it('queda "completa" solo con SL y TP aceptados (AC-15)', async () => {
    let acceptTp: (() => void) | null = null;
    t = setupExecutor({
      placeTakeProfit: () =>
        new Promise((resolve) => {
          acceptTp = () => resolve({ symbol: 'KAIAUSDT', id: 'TP1' });
        }),
    });
    await t.executor.open(ALERT, SIZED);
    t.fill(SIZED.quantity);
    await t.clock.advance(POLL_MS);
    expect(t.store.getTrade(ALERT.alertId)?.state).toBe('con_ejecución');
    expect(t.logLines()).toEqual([]);
    acceptTp!();
    await t.clock.advance(0);
    expect(t.store.getTrade(ALERT.alertId)).toMatchObject({ state: 'abierta', slOrderId: 'SL1', tpOrderId: 'TP1', filledQty: 4166 });
    expect(t.store.getAlert(ALERT.alertId)?.status).toBe('completa');
    expect(t.logLines()).toEqual([
      expect.objectContaining({ type: 'alert', status: 'completa', orderIds: { entry: 'E1', sl: 'SL1', tp: 'TP1' }, quantity: 4166 }),
    ]);
  });

  it('sin ejecución a los 3 min cancela, no coloca SL/TP y queda "entrada no ejecutada" (AC-23)', async () => {
    t = setupExecutor();
    await t.executor.open(ALERT, SIZED);
    await t.clock.advance(ENTRY_TIMEOUT_MS);
    expect(t.exchange.callsTo('cancel')[0]?.args).toEqual([{ symbol: 'KAIAUSDT', id: 'E1' }]);
    expect(t.exchange.callsTo('placeStopLoss')).toHaveLength(0);
    expect(t.store.getTrade(ALERT.alertId)?.state).toBe('cerrada');
    expect(t.logLines()).toEqual([expect.objectContaining({ status: 'entrada no ejecutada', orderIds: { entry: 'E1', sl: null, tp: null } })]);
    const timers = t.clock.pendingTimers();
    await t.clock.advance(POLL_MS * 5);
    expect(t.clock.pendingTimers()).toBe(timers);
    expect(t.exchange.callsTo('cancel')).toHaveLength(1);
  });

  it('si la entrada no se puede colocar, queda "entrada no ejecutada" sin operación (AC-23)', async () => {
    t = setupExecutor({ placeLimitEntry: async () => Promise.reject(new Error('-2019 margen insuficiente')) });
    expect(await t.executor.open(ALERT, SIZED)).toBeNull();
    expect(t.store.getTrade(ALERT.alertId)).toBeUndefined();
    expect(t.exchange.callsTo('placeStopLoss')).toHaveLength(0);
    expect(t.logLines()).toEqual([expect.objectContaining({ status: 'entrada no ejecutada', quantity: null })]);
  });

  describe('entrada confirmada por su identificador propio (FR-069)', () => {
    const timeout = () => Promise.reject(new Error('RequestTimeout: binanceusdm POST /fapi/v1/order'));

    it('la entrada lleva un identificador propio, el mismo para la misma alerta y válido para Binance', async () => {
      t = setupExecutor();
      await t.executor.open(ALERT, SIZED);
      const id = entryClientOrderId(ALERT.alertId);
      expect(t.exchange.callsTo('placeLimitEntry')[0]?.args).toMatchObject([{ clientOrderId: id }]);
      expect(id).toMatch(/^[.A-Z:/a-z0-9_-]{1,36}$/);
      expect(entryClientOrderId(ALERT.alertId)).toBe(id);
      expect(entryClientOrderId('wa-2:0123456789abcdef')).not.toBe(id);
    });

    it('timeout al colocarla pero Binance la aceptó: la sigue y al ejecutarse la protege (AC-84)', async () => {
      t = setupExecutor({ placeLimitEntry: timeout, findEntry: async (symbol) => ({ symbol, id: 'E7' }) });
      const trade = await t.executor.open(ALERT, SIZED);
      expect(t.exchange.callsTo('findEntry')[0]?.args).toEqual(['KAIAUSDT', entryClientOrderId(ALERT.alertId)]);
      expect(trade).toMatchObject({ state: 'pendiente', entryOrderId: 'E7' });
      expect(t.store.getAlert(ALERT.alertId)?.status).toBe('entrada pendiente');
      t.fill(SIZED.quantity);
      await t.clock.advance(POLL_MS);
      expect(t.exchange.callsTo('placeStopLoss')).toHaveLength(1);
      expect(t.exchange.callsTo('placeTakeProfit')).toHaveLength(1);
    });

    it('si Binance confirma que no existe, queda "entrada no ejecutada" sin operación', async () => {
      t = setupExecutor({ placeLimitEntry: timeout, findEntry: async () => null });
      expect(await t.executor.open(ALERT, SIZED)).toBeNull();
      expect(t.exchange.callsTo('findEntry')).toHaveLength(1);
      expect(t.store.getTrade(ALERT.alertId)).toBeUndefined();
      expect(t.store.getAlert(ALERT.alertId)?.status).toBe('entrada no ejecutada');
    });

    it('si la consulta también falla, la reintenta con backoff y un evento crítico por falla', async () => {
      let answers = 0;
      t = setupExecutor({
        placeLimitEntry: timeout,
        findEntry: async () => {
          if (++answers <= 2) throw new Error('RequestTimeout: binanceusdm GET /fapi/v1/order');
          return null;
        },
      });
      const opened = t.executor.open(ALERT, SIZED);
      await t.clock.advance(1000);
      await t.clock.advance(2000);
      expect(await opened).toBeNull();
      expect(t.exchange.callsTo('findEntry')).toHaveLength(3);
      const critical = t.logLines().filter((l) => l.type === 'critical');
      expect(critical).toEqual([
        expect.objectContaining({ kind: 'entrada sin confirmar', alertId: ALERT.alertId }),
        expect.objectContaining({ kind: 'entrada sin confirmar', alertId: ALERT.alertId }),
      ]);
    });
  });

  it('si la entrada se ejecuta justo al cancelarla, igual la protege (Principio III)', async () => {
    t = setupExecutor();
    t.exchange.impl.cancel = async () => {
      t.fill(500); // el fill llegó antes que la cancelación
      t.entry.status = 'canceled';
    };
    await t.executor.open(ALERT, SIZED);
    await t.clock.advance(ENTRY_TIMEOUT_MS);
    expect(t.exchange.callsTo('placeStopLoss')).toHaveLength(1);
    expect(t.exchange.callsTo('placeTakeProfit')).toHaveLength(1);
    expect(t.store.getTrade(ALERT.alertId)).toMatchObject({ state: 'abierta', filledQty: 500 });
    expect(t.logLines()).toEqual([expect.objectContaining({ status: 'completa' })]);
  });

  it('con ejecución parcial a los 3 min cancela el resto y mantiene SL y TP (AC-45)', async () => {
    t = setupExecutor();
    await t.executor.open(ALERT, SIZED);
    t.fill(1000);
    await t.clock.advance(POLL_MS);
    await t.clock.advance(ENTRY_TIMEOUT_MS);
    expect(t.exchange.callsTo('cancel').map((c) => c.args)).toEqual([[{ symbol: 'KAIAUSDT', id: 'E1' }]]);
    expect(t.store.getTrade(ALERT.alertId)).toMatchObject({ state: 'abierta', slOrderId: 'SL1', tpOrderId: 'TP1', filledQty: 1000 });
    expect(t.exchange.callsTo('closeAtMarket')).toHaveLength(0);
  });

  it('ejecuciones posteriores al SL/TP solo actualizan la cantidad: no recoloca SL ni TP', async () => {
    t = setupExecutor();
    await t.executor.open(ALERT, SIZED);
    t.fill(1000);
    await t.clock.advance(POLL_MS);
    t.fill(SIZED.quantity);
    await t.clock.advance(POLL_MS);
    expect(t.exchange.callsTo('placeStopLoss')).toHaveLength(1);
    expect(t.store.getTrade(ALERT.alertId)?.filledQty).toBe(4166);
    expect(t.logLines().filter((l) => l.status === 'completa')).toHaveLength(1);
  });

  it('una entrada cancelada o rechazada por Binance sin ejecución queda "entrada no ejecutada"', async () => {
    t = setupExecutor();
    await t.executor.open(ALERT, SIZED);
    t.entry.status = 'rejected';
    await t.clock.advance(POLL_MS);
    expect(t.store.getTrade(ALERT.alertId)?.state).toBe('cerrada');
    expect(t.logLines()).toEqual([expect.objectContaining({ status: 'entrada no ejecutada' })]);
  });

  it('si consultar la orden falla, sigue intentando en el próximo ciclo', async () => {
    t = setupExecutor();
    const realOrder = t.exchange.impl.order!;
    let fails = 2;
    t.exchange.impl.order = async (r) => (fails-- > 0 ? Promise.reject(new Error('timeout')) : realOrder(r));
    await t.executor.open(ALERT, SIZED);
    t.fill(SIZED.quantity);
    await t.clock.advance(POLL_MS * 3);
    expect(t.store.getTrade(ALERT.alertId)?.state).toBe('abierta');
  });
});
