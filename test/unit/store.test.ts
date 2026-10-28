import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/adapters/store.ts';
import type { Alert, Trade } from '../../src/domain/types.ts';
import { FakeClock } from '../fakes/index.ts';

const perms = (p: string) => statSync(p).mode & 0o777;

function alert(over: Partial<Alert> = {}): Alert {
  return {
    alertId: 'wa-1:0123456789abcdef',
    waMessageId: 'wa-1',
    contentHash: '0123456789abcdef',
    receivedAt: new Date('2026-10-28T12:00:00Z'),
    classifiedAt: null,
    mode: 'DRY',
    sender: '5491100000001',
    text: 'ALERTA DE TRADING',
    ticker: 'KAIA',
    riskLevel: 'Alto',
    entryRaw: 0.0402,
    slRaw: 0.0414,
    target: { price: 0.038 },
    symbol: null,
    priceFactor: 1,
    side: null,
    entry: null,
    sl: null,
    tp: null,
    tpSource: null,
    status: 'válida',
    reason: null,
    ...over,
  };
}

function trade(over: Partial<Trade> = {}): Trade {
  return {
    alertId: 'wa-1:0123456789abcdef',
    symbol: 'KAIAUSDT',
    side: 'SHORT',
    quantity: 4166,
    notional: 167.47,
    riskR: 5,
    symbolLeverage: 10,
    entryPrice: 0.0402,
    slPrice: 0.0414,
    tpPrice: 0.038,
    entryOrderId: '111',
    slOrderId: null,
    tpOrderId: null,
    entryPlacedAt: new Date('2026-10-28T12:00:01Z'),
    filledQty: 0,
    state: 'pendiente',
    closeCause: null,
    closedAt: null,
    realizedPnl: null,
    fees: null,
    ...over,
  };
}

describe('store (FR-007, FR-046, data-model)', () => {
  let root: string;
  let dir: string;
  let clock: FakeClock;
  let store: Store;
  const prevUmask = process.umask();

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-store-'));
    dir = path.join(root, 'data');
    clock = new FakeClock('2026-10-28T12:00:00Z');
    store = Store.open(dir, clock);
  });

  afterEach(() => {
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  it.fails('fija umask 077, crea data/ en 0700 y los archivos en 0600', () => {
    store.appendLog('alert', { alertId: 'x' });
    expect(process.umask()).toBe(0o077);
    expect(perms(dir)).toBe(0o700);
    expect(perms(path.join(dir, 'signalbridge.db'))).toBe(0o600);
    expect(perms(path.join(dir, 'alerts.log'))).toBe(0o600);
  });

  it.fails('guarda una alerta y la encuentra por ID de mensaje, con las fechas intactas', () => {
    store.saveAlert(alert());
    const found = store.findByWaMessageId('wa-1');
    expect(found?.alertId).toBe('wa-1:0123456789abcdef');
    expect(found?.receivedAt).toEqual(new Date('2026-10-28T12:00:00Z'));
    expect(found?.target).toEqual({ price: 0.038 });
    expect(store.findByWaMessageId('wa-2')).toBeUndefined();
  });

  it.fails('actualiza una alerta ya guardada sin duplicarla', () => {
    store.saveAlert(alert());
    store.saveAlert(alert({ status: 'rechazada', reason: 'TP inválido' }));
    expect(store.getAlert('wa-1:0123456789abcdef')?.reason).toBe('TP inválido');
  });

  it.fails('busca el hash de contenido solo dentro de la ventana pedida (FR-007)', () => {
    store.saveAlert(alert({ receivedAt: new Date('2026-10-27T13:00:00Z') }));
    expect(store.hasContentHashSince('0123456789abcdef', new Date('2026-10-27T12:00:00Z'))).toBe(true);
    expect(store.hasContentHashSince('0123456789abcdef', new Date('2026-10-27T14:00:00Z'))).toBe(false);
    expect(store.hasContentHashSince('ffffffffffffffff', new Date('2026-10-01T00:00:00Z'))).toBe(false);
  });

  it.fails('guarda ediciones de alertas (FR-047)', () => {
    store.saveAlert(alert());
    store.saveEdit({
      alertId: 'wa-1:0123456789abcdef',
      editedAt: new Date('2026-10-28T12:05:00Z'),
      previousText: 'a',
      newText: 'b',
      changedFields: ['sl'],
    });
    expect(store.editsOf('wa-1:0123456789abcdef')).toHaveLength(1);
  });

  it.fails('cuenta posiciones y nocional de operaciones pendiente, con_ejecución o abierta (FR-025, FR-026)', () => {
    store.saveTrade(trade({ alertId: 'a', symbol: 'AUSDT', notional: 100, state: 'pendiente' }));
    store.saveTrade(trade({ alertId: 'b', symbol: 'BUSDT', notional: 50, state: 'con_ejecución' }));
    store.saveTrade(trade({ alertId: 'c', symbol: 'CUSDT', notional: 25, state: 'abierta' }));
    store.saveTrade(trade({ alertId: 'd', symbol: 'DUSDT', notional: 999, state: 'cerrada' }));
    expect(store.exposure()).toEqual({ positions: 3, notional: 175 });
  });

  it.fails('encuentra la operación activa de un símbolo (FR-063) y lista por estado (FR-065)', () => {
    store.saveTrade(trade({ alertId: 'a', symbol: 'AUSDT', state: 'con_ejecución' }));
    store.saveTrade(trade({ alertId: 'b', symbol: 'BUSDT', state: 'cerrada' }));
    expect(store.activeTradeForSymbol('AUSDT')?.alertId).toBe('a');
    expect(store.activeTradeForSymbol('BUSDT')).toBeUndefined();
    expect(store.tradesInState('con_ejecución').map((t) => t.alertId)).toEqual(['a']);
  });

  it.fails('actualiza una operación al cambiar de estado', () => {
    store.saveTrade(trade({ state: 'pendiente' }));
    store.saveTrade(trade({ state: 'abierta', filledQty: 4166, slOrderId: '222', tpOrderId: '333' }));
    const t = store.getTrade('wa-1:0123456789abcdef');
    expect(t?.state).toBe('abierta');
    expect(t?.entryPlacedAt).toEqual(new Date('2026-10-28T12:00:01Z'));
    expect(store.exposure().positions).toBe(1);
  });

  it.fails('agrega una línea JSON por evento con type y at', () => {
    store.appendLog('alert', { alertId: 'x', status: 'rechazada' });
    clock.set('2026-10-28T12:00:05Z');
    store.appendLog('critical', { kind: 'reconexión agotada' });
    const lines = readFileSync(path.join(dir, 'alerts.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { type: 'alert', at: '2026-10-28T12:00:00.000Z', alertId: 'x', status: 'rechazada' },
      { type: 'critical', at: '2026-10-28T12:00:05.000Z', kind: 'reconexión agotada' },
    ]);
  });

  it.fails('persiste entre aperturas (reinicio)', () => {
    store.saveAlert(alert());
    store.close();
    store = Store.open(dir, clock);
    expect(store.findByWaMessageId('wa-1')).toBeDefined();
  });
});
