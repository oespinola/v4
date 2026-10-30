import { describe, expect, it } from 'vitest';
import {
  closeLine,
  criticalLine,
  editLine,
  errorLine,
  limitsLine,
  marketLine,
  progressLine,
  reconcileLine,
} from '../../src/domain/console-line.ts';
import { buildAlertLogRecord } from '../../src/domain/log-record.ts';
import type { Alert, Trade } from '../../src/domain/types.ts';
import { ALERT } from '../helpers/executor.ts';

const TRADE: Trade = {
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
  slOrderId: 'S1',
  tpOrderId: 'T1',
  entryPlacedAt: new Date('2026-10-28T12:00:01Z'),
  filledQty: 4166,
  state: 'cerrada',
  closeCause: 'TP',
  closedAt: new Date('2026-10-28T13:00:00Z'),
  realizedPnl: 9.1652,
  fees: 0.1592,
};

const record = (status: Alert['status'], trade: Partial<Trade> | null = {}, reason: Alert['reason'] = null) =>
  buildAlertLogRecord({ ...ALERT, status, reason }, trade ? { ...TRADE, ...trade } : null);

describe('líneas de consola (FR-071, AC-90)', () => {
  it('un cierre por TP muestra símbolo, side, causa, PnL y comisiones', () => {
    expect(closeLine(record('cerrada'))).toBe('● KAIAUSDT SHORT cerrada por TP: PnL 9.1652 USDT, comisiones 0.1592 USDT');
  });

  it('un cierre por SL muestra el PnL negativo', () => {
    expect(closeLine(record('cerrada', { closeCause: 'SL', realizedPnl: -5.0124, fees: 0.1655 }))).toBe(
      '● KAIAUSDT SHORT cerrada por SL: PnL -5.0124 USDT, comisiones 0.1655 USDT',
    );
  });

  it('también se muestran la liquidación y el cierre de emergencia, sin los datos que falten', () => {
    expect(closeLine(record('liquidada', { closeCause: 'liquidación', realizedPnl: -8.4, fees: 0.2 }))).toBe(
      '● KAIAUSDT SHORT liquidada por liquidación: PnL -8.4 USDT, comisiones 0.2 USDT',
    );
    expect(closeLine(record('cerrada por emergencia', { closeCause: null, realizedPnl: null, fees: null }))).toBe(
      '● KAIAUSDT SHORT cerrada por emergencia',
    );
  });

  it('los estados que no cierran una posición no generan línea', () => {
    expect(closeLine(record('completa', { state: 'abierta', closeCause: null, closedAt: null, realizedPnl: null, fees: null }))).toBeNull();
    expect(closeLine(record('entrada no ejecutada', { filledQty: 0, closeCause: null, realizedPnl: null, fees: null }))).toBeNull();
    expect(closeLine(record('rechazada', null, 'duplicado'))).toBeNull();
  });

  it('un evento crítico lleva la marca, el tipo, el símbolo de la alerta y el detalle', () => {
    expect(
      criticalLine({ kind: 'SL/TP perdido', detail: 'la posición sigue abierta y falta su orden de SL; no se modifica' }, 'KAIAUSDT'),
    ).toBe('⚠ CRÍTICO SL/TP perdido KAIAUSDT: la posición sigue abierta y falta su orden de SL; no se modifica');
  });

  it('un evento crítico sin alerta va sin símbolo', () => {
    expect(criticalLine({ kind: 'reconexión agotada', detail: 'binance: 10 intentos fallidos' }, null)).toBe(
      '⚠ CRÍTICO reconexión agotada: binance: 10 intentos fallidos',
    );
  });
});

describe('líneas del modo detallado (FR-072, AC-91)', () => {
  const open = { state: 'abierta', closeCause: null, closedAt: null, realizedPnl: null, fees: null } as const;

  it.fails('una operación completa muestra la cantidad ejecutada y los IDs de sus órdenes', () => {
    expect(progressLine(record('completa', open))).toBe('· KAIAUSDT SHORT completa: ejecutado 4166/4166 (entrada E1, SL S1, TP T1)');
    expect(progressLine(record('completa', { ...open, filledQty: 2000 }))).toBe(
      '· KAIAUSDT SHORT completa: ejecutado 2000/4166 (entrada E1, SL S1, TP T1)',
    );
  });

  it.fails('una entrada no ejecutada se muestra; los cierres y los rechazos no son de esta línea', () => {
    expect(progressLine(record('entrada no ejecutada', { ...open, filledQty: 0 }))).toBe('· KAIAUSDT SHORT entrada no ejecutada');
    expect(progressLine(record('cerrada'))).toBeNull();
    expect(progressLine(record('rechazada', null, 'duplicado'))).toBeNull();
  });

  it.fails('una edición muestra el ticker y los datos que cambiaron', () => {
    expect(editLine({ changedFields: ['entry', 'sl'] }, 'KAIA')).toBe('· KAIA editada tras procesarse (no se opera): entry, sl');
    expect(editLine({ changedFields: [] }, null)).toBe('· ? editada tras procesarse (no se opera): sin cambios en los datos');
  });

  it.fails('un error del seguimiento muestra el símbolo si lo hay y el detalle', () => {
    expect(errorLine({ source: 'seguimiento', detail: 'timeout' }, 'KAIAUSDT')).toBe('· Error del seguimiento KAIAUSDT: timeout');
    expect(errorLine({ source: 'seguimiento', detail: 'timeout' }, null)).toBe('· Error del seguimiento: timeout');
  });

  it.fails('resumen de arranque: símbolos, límites y reconciliación', () => {
    expect(marketLine({ symbols: 512, missingInDemo: 23 })).toBe('Binance: 512 símbolos, ranking cada 60 s; 23 no están en Demo.');
    expect(marketLine({ symbols: 512, missingInDemo: null })).toBe('Binance: 512 símbolos, ranking cada 60 s.');
    expect(
      limitsLine({ riskR: 5, maxPositions: 3, maxPositionSize: 500, maxCapital: 1000, symbolLeverage: 2, maxLeverage: 5 }),
    ).toBe('Límites: R 5 USDT, máx. 3 posiciones, 500 USDT por posición, 1000 USDT en total, apalancamiento 2x (máx. 5x).');
    expect(reconcileLine({ recovered: 1, resumed: 2, reviewed: 3 }, 850)).toBe(
      'Reconciliación con Binance: alertas sin operación buscadas 1, entradas retomadas 2, operaciones abiertas revisadas 3 (850 ms).',
    );
  });
});
