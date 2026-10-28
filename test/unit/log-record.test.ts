import { describe, expect, it } from 'vitest';
import { buildAlertLogRecord } from '../../src/domain/log-record.ts';
import { FINAL_STATUSES, REJECT_REASONS, type Alert, type Trade } from '../../src/domain/types.ts';

const RECEIVED = new Date('2026-10-28T12:00:00.000Z');

function alert(over: Partial<Alert> = {}): Alert {
  return {
    alertId: 'wa-1:0123456789abcdef',
    waMessageId: 'wa-1',
    contentHash: '0123456789abcdef',
    receivedAt: RECEIVED,
    classifiedAt: new Date('2026-10-28T12:00:01.250Z'),
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
    status: 'completa',
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
    slOrderId: '222',
    tpOrderId: '333',
    entryPlacedAt: new Date('2026-10-28T12:00:02.000Z'),
    filledQty: 4166,
    state: 'cerrada',
    closeCause: 'TP',
    closedAt: new Date('2026-10-28T15:30:00.000Z'),
    realizedPnl: 9.16,
    fees: 0.17,
    ...over,
  };
}

const KEYS = [
  'alertId', 'receivedAt', 'sender', 'mode', 'ticker', 'symbol', 'side', 'entry', 'sl', 'tp', 'tpSource',
  'quantity', 'riskR', 'riskLevel', 'orderIds', 'closeCause', 'closedAt', 'realizedPnl', 'fees', 'status',
  'reason', 'timings',
];

describe('registro del log de una alerta (contracts/log-record.md, FR-043 a FR-045)', () => {
  it('una operación cerrada lleva todos los campos de FR-043 (AC-08)', () => {
    const r = buildAlertLogRecord(alert({ status: 'cerrada' }), trade());
    expect(Object.keys(r)).toEqual(KEYS);
    expect(r).toEqual({
      alertId: 'wa-1:0123456789abcdef',
      receivedAt: '2026-10-28T12:00:00.000Z',
      sender: '5491100000001',
      mode: 'DRY',
      ticker: 'KAIA',
      symbol: 'KAIAUSDT',
      side: 'SHORT',
      entry: 0.0402,
      sl: 0.0414,
      tp: 0.038,
      tpSource: 'alerta',
      quantity: 4166,
      riskR: 5,
      riskLevel: 'Alto',
      orderIds: { entry: '111', sl: '222', tp: '333' },
      closeCause: 'TP',
      closedAt: '2026-10-28T15:30:00.000Z',
      realizedPnl: 9.16,
      fees: 0.17,
      status: 'cerrada',
      reason: null,
      timings: { classifiedMs: 1250, entryAcceptedMs: 2000 },
    });
  });

  it('una rechazada sin operación deja en null lo que no aplica, con todas las claves', () => {
    const r = buildAlertLogRecord(
      alert({ status: 'rechazada', reason: 'TP inválido', symbol: null, side: null, entry: null, sl: null, tp: null, tpSource: null }),
    );
    expect(Object.keys(r)).toEqual(KEYS);
    expect(r).toMatchObject({
      status: 'rechazada',
      reason: 'TP inválido',
      symbol: null,
      quantity: null,
      riskR: null,
      orderIds: { entry: null, sl: null, tp: null },
      closeCause: null,
      closedAt: null,
      realizedPnl: null,
      fees: null,
      timings: { classifiedMs: 1250, entryAcceptedMs: null },
    });
  });

  it('una operación completa todavía abierta no tiene cierre', () => {
    const r = buildAlertLogRecord(alert(), trade({ state: 'abierta', closeCause: null, closedAt: null, realizedPnl: null, fees: null }));
    expect(r).toMatchObject({ status: 'completa', closeCause: null, closedAt: null, realizedPnl: null, quantity: 4166 });
  });

  it('acepta cada estado final y cada motivo de las listas cerradas (FR-044, FR-045)', () => {
    for (const status of FINAL_STATUSES.filter((s) => s !== 'rechazada')) {
      expect(buildAlertLogRecord(alert({ status }), trade()).status).toBe(status);
    }
    for (const reason of REJECT_REASONS) {
      expect(buildAlertLogRecord(alert({ status: 'rechazada', reason })).reason).toBe(reason);
    }
  });

  it('un estado de trabajo no se loguea: lanza error', () => {
    for (const status of ['válida', 'entrada pendiente', 'con ejecución'] as const) {
      expect(() => buildAlertLogRecord(alert({ status }))).toThrow(/estado final/);
    }
  });

  it('el motivo va solo con "rechazada": sin motivo o con motivo en otro estado lanza error', () => {
    expect(() => buildAlertLogRecord(alert({ status: 'rechazada', reason: null }))).toThrow(/motivo/);
    expect(() => buildAlertLogRecord(alert({ status: 'completa', reason: 'TP inválido' }), trade())).toThrow(/motivo/);
  });

  it('sin hora de clasificación, classifiedMs es null', () => {
    const r = buildAlertLogRecord(alert({ status: 'rechazada', reason: 'duplicado', classifiedAt: null }));
    expect(r.timings).toEqual({ classifiedMs: null, entryAcceptedMs: null });
  });
});
