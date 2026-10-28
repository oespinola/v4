// Indicadores y elección del TP (FR-014 a FR-016). Si el objetivo trae precio, ese es el TP y no se
// calcula nada (AC-34); si no, el más cercano a la Entrada entre ASL21 y EMA55 del lado correcto.
import type { Side, Target, TpSource } from './types.ts';

export interface IndicatorValues {
  asl21: number | null;
  ema55: number | null;
}

/** Como ta.ema de TradingView: arranca con la SMA de las primeras `length` velas. */
export function ema(values: readonly number[], length: number): number | null {
  if (values.length < length) return null;
  const alpha = 2 / (length + 1);
  let acc = values.slice(0, length).reduce((a, b) => a + b, 0) / length;
  for (let i = length; i < values.length; i++) acc = alpha * values[i]! + (1 - alpha) * acc;
  return acc;
}

/** Como ta.wma: la vela más reciente pesa `length`, la más vieja pesa 1. */
export function wma(values: readonly number[], length: number): number | null {
  if (values.length < length) return null;
  const window = values.slice(-length);
  let num = 0;
  for (let i = 0; i < length; i++) num += window[i]! * (i + 1);
  return num / ((length * (length + 1)) / 2);
}

/** ASL21 = (EMA(cierre, 20) + WMA(cierre, 21)) / 2; EMA55 = EMA(cierre, 55). */
export function computeIndicators(closes: readonly number[]): IndicatorValues {
  const e20 = ema(closes, 20);
  const w21 = wma(closes, 21);
  return { asl21: e20 !== null && w21 !== null ? (e20 + w21) / 2 : null, ema55: ema(closes, 55) };
}

export function isCorrectSide(side: Side, entry: number, tp: number): boolean {
  return side === 'LONG' ? tp > entry : tp < entry;
}

export function pickIndicatorTp(
  side: Side,
  entry: number,
  values: IndicatorValues,
): { tp: number; from: 'ASL21' | 'EMA55' } | null {
  const candidates = (
    [
      ['ASL21', values.asl21],
      ['EMA55', values.ema55],
    ] as const
  ).filter((c): c is readonly ['ASL21' | 'EMA55', number] => c[1] !== null && isCorrectSide(side, entry, c[1]));
  if (candidates.length === 0) return null;
  const [from, tp] = candidates.reduce((best, c) => (Math.abs(c[1] - entry) < Math.abs(best[1] - entry) ? c : best));
  return { tp, from };
}

/** TP según el objetivo. Si las velas fallan, el error sube y la validación lo traduce a
 *  "datos de mercado no disponibles" (FR-064). null = ninguno del lado correcto ("TP inválido"). */
export async function takeProfitFor(
  target: Target,
  side: Side,
  entry: number,
  closes: () => Promise<number[]>,
): Promise<{ tp: number; source: TpSource } | null> {
  if ('price' in target) return { tp: target.price, source: 'alerta' };
  const picked = pickIndicatorTp(side, entry, computeIndicators(await closes()));
  return picked ? { tp: picked.tp, source: 'calculado' } : null;
}
