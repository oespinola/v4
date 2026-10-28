// Registro `alert` del log (contracts/log-record.md, FR-043 a FR-045): se arma desde la alerta y,
// si la hubo, su operación. Solo se loguean estados finales; los campos que no aplican van en null.
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
  timings: { classifiedMs: number | null; entryAcceptedMs: number | null };
}

export function buildAlertLogRecord(_alert: Alert, _trade: Trade | null = null): AlertLogRecord {
  throw new Error('no implementado');
}
