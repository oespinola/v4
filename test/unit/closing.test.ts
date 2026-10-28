import { describe, expect, it } from 'vitest';
import { closeCause, closeTotals, findClose, type Fill } from '../../src/domain/closing.ts';

const fill = (orderId: string, side: 'BUY' | 'SELL', quantity: number, time: number, over: Partial<Fill> = {}): Fill => ({
  orderId,
  side,
  positionSide: 'BOTH',
  quantity,
  realizedPnl: 0,
  commission: 0.01,
  commissionAsset: 'USDT',
  time,
  ...over,
});

describe('cierre por ejecuciones (FR-033, FR-036, FR-037)', () => {
  it.fails('LONG: la entrada en partes y el cierre que deja la posición en cero', () => {
    const found = findClose(
      'LONG',
      [fill('E1', 'BUY', 600, 1), fill('E1', 'BUY', 400, 2), fill('X', 'SELL', 1000, 9, { realizedPnl: 5 })],
      'E1',
    );
    expect(found).toMatchObject({ closingOrderId: 'X', closedAt: 9 });
    expect(found?.opening).toHaveLength(2);
    expect(found?.closing).toHaveLength(1);
  });

  it.fails('no cuenta ejecuciones de antes de la entrada (otra operación del símbolo)', () => {
    const found = findClose(
      'SHORT',
      [fill('OLD', 'SELL', 50, 1), fill('OLD2', 'BUY', 50, 2), fill('E1', 'SELL', 100, 3), fill('TPX', 'BUY', 100, 4)],
      'E1',
    );
    expect(found).toMatchObject({ closingOrderId: 'TPX', closedAt: 4 });
    expect(found?.opening.map((f) => f.orderId)).toEqual(['E1']);
  });

  it.fails('un cierre parcial no es cierre: null', () => {
    expect(findClose('LONG', [fill('E1', 'BUY', 100, 1), fill('X', 'SELL', 40, 2)], 'E1')).toBeNull();
    expect(findClose('LONG', [], 'E1')).toBeNull();
  });

  it.fails('en hedge ignora las ejecuciones del otro lado', () => {
    const found = findClose(
      'LONG',
      [
        fill('E1', 'BUY', 100, 1, { positionSide: 'LONG' }),
        fill('Z', 'SELL', 100, 2, { positionSide: 'SHORT' }),
        fill('X', 'SELL', 100, 3, { positionSide: 'LONG' }),
      ],
      'E1',
    );
    expect(found?.closingOrderId).toBe('X');
  });

  it.fails('causa: la orden que generó nuestro TP o SL, una liquidación, o cierre manual (AC-56 a AC-59)', () => {
    const p = { slFillOrderId: 'S9', tpFillOrderId: 'T9' };
    const plain = { type: 'MARKET', clientOrderId: 'web_abc' };
    expect(closeCause('T9', p, plain)).toBe('TP');
    expect(closeCause('S9', p, plain)).toBe('SL');
    expect(closeCause('L1', p, { type: 'LIQUIDATION', clientOrderId: 'x' })).toBe('liquidación');
    expect(closeCause('L2', p, { type: 'MARKET', clientOrderId: 'autoclose-123' })).toBe('liquidación');
    expect(closeCause('L3', p, { type: 'MARKET', clientOrderId: 'adl_autoclose' })).toBe('liquidación');
    expect(closeCause('M1', p, plain)).toBe('cierre manual');
    expect(closeCause('M1', { slFillOrderId: null, tpFillOrderId: null }, plain)).toBe('cierre manual');
  });

  it.fails('PnL del cierre y comisiones en USDT de entrada y cierre, sin ruido de coma flotante', () => {
    const found = findClose(
      'LONG',
      [
        fill('E1', 'BUY', 100, 1, { commission: 0.1 }),
        fill('X', 'SELL', 60, 2, { realizedPnl: 0.30000001, commission: 0.2 }),
        fill('X', 'SELL', 40, 3, { realizedPnl: 0.45360383, commission: 0.05, commissionAsset: 'BNB' }),
      ],
      'E1',
    )!;
    expect(closeTotals(found)).toEqual({ realizedPnl: 0.75360384, fees: 0.3 });
  });
});
