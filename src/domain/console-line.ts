// Líneas de consola de los cierres y de los eventos críticos (FR-071, AC-90): se muestran en el
// momento en que el store los registra en el log, para no tener que leer el JSONL para enterarse.
import type { AlertLogRecord } from './log-record.ts';
import type { FinalStatus } from './types.ts';

const CLOSED: readonly FinalStatus[] = ['cerrada', 'liquidada', 'cerrada por emergencia'];

/** Línea de un registro `alert` que cerró la posición; `null` para los demás estados. */
export function closeLine(record: AlertLogRecord): string | null {
  if (!CLOSED.includes(record.status)) return null;
  const amounts = [
    record.realizedPnl !== null && `PnL ${record.realizedPnl} USDT`,
    record.fees !== null && `comisiones ${record.fees} USDT`,
  ].filter(Boolean);
  const cause = record.closeCause ? ` por ${record.closeCause}` : '';
  return `● ${record.symbol} ${record.side} ${record.status}${cause}${amounts.length ? `: ${amounts.join(', ')}` : ''}`;
}

/** Línea de un evento crítico, con el símbolo de su alerta si la hay. */
export function criticalLine(e: { kind: string; detail: string }, symbol: string | null): string {
  return `⚠ CRÍTICO ${e.kind}${symbol ? ` ${symbol}` : ''}: ${e.detail}`;
}

// ── Modo detallado (FR-072) ───────────────────────────────────────────────────

/** Símbolos cargados; `missingInDemo` es null en LIVE. */
export interface MarketSummary {
  symbols: number;
  missingInDemo: number | null;
}

export interface TradingLimits {
  riskR: number;
  maxPositions: number;
  maxPositionSize: number;
  maxCapital: number;
  symbolLeverage: number;
  maxLeverage: number;
}

export interface ReconcileSummary {
  recovered: number;
  resumed: number;
  reviewed: number;
}

/** Línea de "completa" o "entrada no ejecutada"; `null` para los demás estados. */
export function progressLine(record: AlertLogRecord): string | null {
  const head = `· ${record.symbol} ${record.side} ${record.status}`;
  if (record.status === 'entrada no ejecutada') return head;
  if (record.status !== 'completa') return null;
  const { entry, sl, tp } = record.orderIds;
  return `${head}: ejecutado ${record.filledQty}/${record.quantity} (entrada ${entry}, SL ${sl}, TP ${tp})`;
}

/** Línea de una edición registrada (FR-047). */
export function editLine(e: { changedFields: readonly string[] }, ticker: string | null): string {
  const changes = e.changedFields.length > 0 ? e.changedFields.join(', ') : 'sin cambios en los datos';
  return `· ${ticker ?? '?'} editada tras procesarse (no se opera): ${changes}`;
}

/** Línea de un error del seguimiento (FR-073). */
export function errorLine(e: { source: string; detail: string }, symbol: string | null): string {
  return `· Error del ${e.source}${symbol ? ` ${symbol}` : ''}: ${e.detail}`;
}

export function marketLine(s: MarketSummary): string {
  const demo = s.missingInDemo === null ? '' : `; ${s.missingInDemo} no están en Demo`;
  return `Binance: ${s.symbols} símbolos, ranking cada 60 s${demo}.`;
}

export function limitsLine(l: TradingLimits): string {
  return (
    `Límites: R ${l.riskR} USDT, máx. ${l.maxPositions} posiciones, ${l.maxPositionSize} USDT por posición, ` +
    `${l.maxCapital} USDT en total, apalancamiento ${l.symbolLeverage}x (máx. ${l.maxLeverage}x).`
  );
}

export function reconcileLine(r: ReconcileSummary, ms: number): string {
  return (
    `Reconciliación con Binance: alertas sin operación buscadas ${r.recovered}, entradas retomadas ${r.resumed}, ` +
    `operaciones abiertas revisadas ${r.reviewed} (${ms} ms).`
  );
}
