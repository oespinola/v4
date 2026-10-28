import { afterEach, describe, expect, it } from 'vitest';
import { POLL_MS } from '../../src/domain/executor.ts';
import { ALERT, SIZED, setupExecutor } from '../helpers/executor.ts';

const reject = (msg: string) => async () => Promise.reject(new Error(msg));

describe('ejecutor: caminos de falla (FR-030, AC-16, AC-74, Principio III)', () => {
  let t: ReturnType<typeof setupExecutor>;
  afterEach(() => t.cleanup());

  it.fails('SL rechazado con la entrada ejecutada: cierre a mercado en < 5 s y evento crítico (AC-16)', async () => {
    let slAt = 0;
    let closeAt = 0;
    t = setupExecutor({
      placeStopLoss: async () => {
        slAt = t.clock.now().getTime();
        throw new Error('-2021 la orden dispararía de inmediato');
      },
      closeAtMarket: async () => {
        closeAt = t.clock.now().getTime();
        return { symbol: 'KAIAUSDT', id: 'MKT1' };
      },
    });
    await t.executor.open(ALERT, SIZED);
    t.fill(1000);
    await t.clock.advance(POLL_MS);
    expect(closeAt - slAt).toBeLessThan(5000);
    expect(t.exchange.callsTo('closeAtMarket')[0]?.args).toEqual(['KAIAUSDT', 'SHORT']);
    expect(t.exchange.callsTo('placeTakeProfit')).toHaveLength(0);
    // El resto de la entrada se cancela antes de cerrar, para que no vuelva a abrir posición.
    const order = t.exchange.calls.map((c) => c.method);
    expect(order.indexOf('cancel')).toBeLessThan(order.indexOf('closeAtMarket'));
    expect(t.store.getTrade(ALERT.alertId)?.state).toBe('cerrada');
    expect(t.logLines()).toEqual([
      expect.objectContaining({ type: 'critical', kind: 'cierre de emergencia', alertId: ALERT.alertId }),
      expect.objectContaining({ type: 'alert', status: 'cerrada por emergencia' }),
    ]);
  });

  it.fails('TP rechazado tras aceptar el SL: cierra a mercado y después cancela el SL que quedó', async () => {
    t = setupExecutor({ placeTakeProfit: reject('-4130 ya hay una orden closePosition') });
    await t.executor.open(ALERT, SIZED);
    t.fill(SIZED.quantity);
    await t.clock.advance(POLL_MS);
    const methods = t.exchange.calls.map((c) => c.method);
    expect(methods.indexOf('closeAtMarket')).toBeGreaterThan(methods.indexOf('placeTakeProfit'));
    const cancels = t.exchange.callsTo('cancel').map((c) => c.args[0]);
    expect(cancels).toContainEqual({ symbol: 'KAIAUSDT', id: 'SL1' });
    expect(t.store.getAlert(ALERT.alertId)?.status).toBe('cerrada por emergencia');
  });

  it.fails('si el cierre a mercado falla, reintenta con backoff sin parar en el 10.º fallo hasta cerrar (FR-030, AC-74)', async () => {
    let failures = 12;
    const attempts: number[] = [];
    t = setupExecutor({
      placeStopLoss: reject('rechazado'),
      closeAtMarket: async () => {
        attempts.push(t.clock.now().getTime());
        if (failures-- > 0) throw new Error('timeout');
        return { symbol: 'KAIAUSDT', id: 'MKT1' };
      },
    });
    await t.executor.open(ALERT, SIZED);
    t.fill(1000);
    await t.clock.advance(POLL_MS);
    expect(t.executor.emergencyInProgress()).toBe(true);
    await t.clock.advance(10 * 60_000);
    expect(attempts).toHaveLength(13);
    const waits = attempts.slice(1).map((at, i) => at - attempts[i]!);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000, 60000, 60000]);
    expect(t.executor.emergencyInProgress()).toBe(false);
    const critical = t.logLines().filter((l) => l.type === 'critical');
    expect(critical.filter((l) => l.kind === 'falla del cierre de emergencia')).toHaveLength(12);
    expect(t.store.getAlert(ALERT.alertId)?.status).toBe('cerrada por emergencia');
  });

  it.fails('nunca deja una operación "abierta" ni "completa" sin SL y TP aceptados', async () => {
    for (const impl of [{ placeStopLoss: reject('x') }, { placeTakeProfit: reject('x') }]) {
      t = setupExecutor(impl);
      const states: string[] = [];
      const save = t.store.saveTrade.bind(t.store);
      t.store.saveTrade = (tr) => {
        states.push(tr.state);
        save(tr);
      };
      await t.executor.open(ALERT, SIZED);
      t.fill(SIZED.quantity);
      await t.clock.advance(POLL_MS);
      expect(states).not.toContain('abierta');
      expect(t.logLines().some((l) => l.status === 'completa')).toBe(false);
      t.cleanup();
    }
    t = setupExecutor(); // para el afterEach
  });
});
