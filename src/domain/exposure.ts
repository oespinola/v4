// Límites de exposición (FR-025, FR-026, FR-063): cuentan las operaciones pendientes, con ejecución
// y abiertas. Motivos en el orden de FR-020: símbolo ya en operación → límite de posiciones →
// límite de capital.
import type { RejectReason } from './types.ts';

export interface ExposureInput {
  /** Nocional de la operación nueva (USDT). */
  notional: number;
  /** ¿El símbolo ya tiene una operación pendiente, con ejecución o abierta? (FR-063) */
  symbolActive: boolean;
  /** Operaciones que ocupan cupo y su nocional comprometido. */
  current: { positions: number; notional: number };
  maxPositions: number;
  maxCapitalUsdt: number;
}

export type ExposureReason = Extract<RejectReason, 'símbolo ya en operación' | 'límite de posiciones' | 'límite de capital'>;

export function checkExposure(input: ExposureInput): ExposureReason | null {
  if (input.symbolActive) return 'símbolo ya en operación';
  if (input.current.positions + 1 > input.maxPositions) return 'límite de posiciones';
  if (input.current.notional + input.notional > input.maxCapitalUsdt) return 'límite de capital';
  return null;
}
