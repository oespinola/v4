// Líneas de consola de los cierres y de los eventos críticos (FR-071, AC-90): se muestran en el
// momento en que el store los registra en el log, para no tener que leer el JSONL para enterarse.
import type { AlertLogRecord } from './log-record.ts';

/** Línea de un registro `alert` que cerró la posición; `null` para los demás estados. */
export function closeLine(_record: AlertLogRecord): string | null {
  throw new Error('no implementado');
}

/** Línea de un evento crítico, con el símbolo de su alerta si la hay. */
export function criticalLine(_e: { kind: string; detail: string }, _symbol: string | null): string {
  throw new Error('no implementado');
}
