// Indicadores y elección del TP (FR-014 a FR-016). Pendiente de implementar (T034).
import type { Side, Target, TpSource } from './types.ts';

export interface IndicatorValues {
  asl21: number | null;
  ema55: number | null;
}

const ni = (): never => {
  throw new Error('indicators: no implementado');
};

export function ema(_values: readonly number[], _length: number): number | null {
  return ni();
}
export function wma(_values: readonly number[], _length: number): number | null {
  return ni();
}
export function computeIndicators(_closes: readonly number[]): IndicatorValues {
  return ni();
}
export function pickIndicatorTp(
  _side: Side,
  _entry: number,
  _values: IndicatorValues,
): { tp: number; from: 'ASL21' | 'EMA55' } | null {
  return ni();
}
export async function takeProfitFor(
  _target: Target,
  _side: Side,
  _entry: number,
  _closes: () => Promise<number[]>,
): Promise<{ tp: number; source: TpSource } | null> {
  return ni();
}
