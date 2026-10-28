// Dimensionamiento (FR-021 a FR-024): cantidad = R / |Entrada − SL| con piso al stepSize, sobre los
// precios ya ajustados. El nivel de riesgo de la alerta no entra (FR-022). Los motivos salen en el
// orden de FR-020: bajo mínimo → datos de mercado no disponibles (balance) → excede máximos.
import type { RejectReason, SymbolFilters } from './types.ts';

export interface SizingInput {
  entry: number;
  sl: number;
  filters: SymbolFilters;
  riskR: number;
  maxPositionUsdt: number;
  maxLeverage: number;
  /** Balance total de la billetera de Futuros USDT del modo activo (FR-024). */
  walletBalance(): Promise<number>;
}

export type SizingResult =
  | { ok: true; quantity: number; notional: number }
  | { ok: false; reason: Extract<RejectReason, 'bajo mínimo' | 'datos de mercado no disponibles' | 'excede máximos'> };

export async function sizePosition(_input: SizingInput): Promise<SizingResult> {
  throw new Error('no implementado');
}
