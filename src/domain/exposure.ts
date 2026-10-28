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

export function checkExposure(_input: ExposureInput): ExposureReason | null {
  throw new Error('no implementado');
}
