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
export function progressLine(_record: AlertLogRecord): string | null {
  throw new Error('no implementado');
}

/** Línea de una edición registrada (FR-047). */
export function editLine(_e: { changedFields: readonly string[] }, _ticker: string | null): string {
  throw new Error('no implementado');
}

/** Línea de un error del seguimiento (FR-073). */
export function errorLine(_e: { source: string; detail: string }, _symbol: string | null): string {
  throw new Error('no implementado');
}

export function marketLine(_s: MarketSummary): string {
  throw new Error('no implementado');
}

export function limitsLine(_l: TradingLimits): string {
  throw new Error('no implementado');
}

export function reconcileLine(_r: ReconcileSummary, _ms: number): string {
  throw new Error('no implementado');
}
