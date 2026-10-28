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

// Tolerancia para comparar cantidades que vienen como texto decimal desde Binance.
const QTY_EPSILON = 1e-9;
// Binance informa PnL y comisiones con 8 decimales: la suma no debe agregar ruido.
const round8 = (n: number) => Number(n.toFixed(8));

/** null: según las ejecuciones la posición sigue abierta (o Binance todavía no las informa). */
export function findClose(side: Side, fills: readonly Fill[], entryOrderId: string): FoundClose | null {
  const closeSide = side === 'LONG' ? 'SELL' : 'BUY';
  const opening: Fill[] = [];
  const closing: Fill[] = [];
  let open = 0;
  let started = false;
  for (const fill of [...fills].sort((a, b) => a.time - b.time)) {
    if (fill.positionSide !== side && fill.positionSide !== 'BOTH') continue;
    // Lo anterior a la entrada es de otra operación del símbolo.
    started ||= fill.orderId === entryOrderId;
    if (!started) continue;
    if (fill.side === closeSide) {
      if (opening.length === 0) continue;
      closing.push(fill);
      open -= fill.quantity;
      if (open <= QTY_EPSILON) return { opening, closing, closingOrderId: fill.orderId, closedAt: fill.time };
    } else {
      opening.push(fill);
      open += fill.quantity;
    }
  }
  return null;
}

/** Liquidación y desapalancamiento automático (ADL): Binance los marca por tipo e ID de cliente. */
function isForcedClose(order: { type: string; clientOrderId: string }): boolean {
  return (
    order.type === 'LIQUIDATION' ||
    order.clientOrderId.startsWith('autoclose-') ||
    order.clientOrderId.startsWith('adl_autoclose')
  );
}

export function closeCause(
  closingOrderId: string,
  protections: { slFillOrderId: string | null; tpFillOrderId: string | null },
  closingOrder: { type: string; clientOrderId: string },
): CloseCause {
  if (protections.tpFillOrderId === closingOrderId) return 'TP';
  if (protections.slFillOrderId === closingOrderId) return 'SL';
  if (isForcedClose(closingOrder)) return 'liquidación';
  return 'cierre manual';
}

/** PnL realizado del cierre y comisiones en USDT de la entrada y el cierre. Las cobradas en otro
 *  activo (BNB con el descuento) no se convierten. */
export function closeTotals(found: FoundClose): { realizedPnl: number; fees: number } {
  const usdt = [...found.opening, ...found.closing].filter((f) => f.commissionAsset === 'USDT');
  return {
    realizedPnl: round8(found.closing.reduce((sum, f) => sum + f.realizedPnl, 0)),
    fees: round8(usdt.reduce((sum, f) => sum + f.commission, 0)),
  };
}
