// Registro `alert` del log (contracts/log-record.md, FR-043 a FR-045): se arma desde la alerta y,
// si la hubo, su operación. Solo se loguean estados finales; los campos que no aplican van en null.
import { FINAL_STATUSES, REJECT_REASONS } from './types.ts';
import type { Alert, CloseCause, FinalStatus, Mode, RejectReason, Side, TpSource, Trade } from './types.ts';

export interface AlertLogRecord {
  alertId: string;
  receivedAt: string;
  sender: string;
  mode: Mode;
  ticker: string | null;
  symbol: string | null;
  side: Side | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  tpSource: TpSource | null;
  quantity: number | null;
  riskR: number | null;
  riskLevel: string | null;
  orderIds: { entry: string | null; sl: string | null; tp: string | null };
  closeCause: CloseCause | null;
  closedAt: string | null;
  realizedPnl: number | null;
  fees: number | null;
  status: FinalStatus;
  reason: RejectReason | null;
  timings: { classifiedMs: number | null; entryAcceptedMs: number | null; withImage: boolean };
}

const isFinal = (s: string): s is FinalStatus => (FINAL_STATUSES as readonly string[]).includes(s);
const isReason = (r: string): r is RejectReason => (REJECT_REASONS as readonly string[]).includes(r);
const msSince = (from: Date, to: Date | null | undefined) => (to ? to.getTime() - from.getTime() : null);

export function buildAlertLogRecord(alert: Alert, trade: Trade | null = null): AlertLogRecord {
  const { status, reason } = alert;
  if (!isFinal(status)) throw new Error(`"${status}" no es un estado final: no se loguea`);
  if (status === 'rechazada' ? reason === null || !isReason(reason) : reason !== null) {
    throw new Error(`motivo inválido para "${status}": ${reason}`);
  }
  return {
    alertId: alert.alertId,
    receivedAt: alert.receivedAt.toISOString(),
    sender: alert.sender,
    mode: alert.mode,
    ticker: alert.ticker,
    symbol: alert.symbol,
    side: alert.side,
    entry: alert.entry,
    sl: alert.sl,
    tp: alert.tp,
    tpSource: alert.tpSource,
    quantity: trade?.quantity ?? null,
    riskR: trade?.riskR ?? null,
    riskLevel: alert.riskLevel,
    orderIds: { entry: trade?.entryOrderId ?? null, sl: trade?.slOrderId ?? null, tp: trade?.tpOrderId ?? null },
    closeCause: trade?.closeCause ?? null,
    closedAt: trade?.closedAt?.toISOString() ?? null,
    realizedPnl: trade?.realizedPnl ?? null,
    fees: trade?.fees ?? null,
    status,
    reason,
    timings: {
      classifiedMs: msSince(alert.receivedAt, alert.classifiedAt),
      entryAcceptedMs: msSince(alert.receivedAt, trade?.entryPlacedAt),
      withImage: alert.usedImage ?? false,
    },
  };
}
