// Cierre de una operación según sus ejecuciones (FR-033, FR-036, FR-037), como en v3: desde la
// entrada, se suman las ejecuciones que abren y se restan las que cierran hasta volver a cero. La
// causa la da la orden que dejó la posición en cero: la que generó nuestro TP o SL al dispararse,
// una liquidación de Binance, o cualquier otra ("cierre manual").
import type { CloseCause, Side } from './types.ts';

export interface Fill {
  orderId: string;
  side: 'BUY' | 'SELL';
  /** 'BOTH' en una cuenta one-way. */
  positionSide: Side | 'BOTH';
  quantity: number;
  realizedPnl: number;
  commission: number;
  commissionAsset: string;
  time: number;
}

export interface FoundClose {
  opening: Fill[];
  closing: Fill[];
  closingOrderId: string;
  closedAt: number;
}

/** null: según las ejecuciones la posición sigue abierta (o Binance todavía no las informa). */
export function findClose(_side: Side, _fills: readonly Fill[], _entryOrderId: string): FoundClose | null {
  throw new Error('no implementado');
}

export function closeCause(
  _closingOrderId: string,
  _protections: { slFillOrderId: string | null; tpFillOrderId: string | null },
  _closingOrder: { type: string; clientOrderId: string },
): CloseCause {
  throw new Error('no implementado');
}

/** PnL realizado del cierre y comisiones en USDT de la entrada y el cierre. */
export function closeTotals(_found: FoundClose): { realizedPnl: number; fees: number } {
  throw new Error('no implementado');
}
