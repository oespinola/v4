// Velas de 45 min desde velas de 15 min (FR-015). Pendiente de implementar (T032).

export interface Candle15 {
  openTime: number;
  close: number;
}

export function group45m(_candles: readonly Candle15[]): number[] {
  throw new Error('candles: no implementado');
}
