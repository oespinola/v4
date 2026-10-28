// Velas de 45 min desde velas de 15 min (FR-015). Binance no ofrece 45 min: se agrupan de a tres,
// alineadas a las 00:00 UTC (1440 / 45 = 32 tramos exactos por día, así que alinear a la época Unix
// equivale a alinear a cada medianoche). El primer tramo se descarta si quedó incompleto por el
// corte de la consulta; el último es la vela en curso y puede tener una, dos o tres velas.

export interface Candle15 {
  openTime: number;
  close: number;
}

const M45 = 45 * 60_000;

export function group45m(candles: readonly Candle15[]): number[] {
  const sorted = [...candles].sort((a, b) => a.openTime - b.openTime);
  const groups: { start: number; count: number; close: number }[] = [];
  for (const c of sorted) {
    const start = Math.floor(c.openTime / M45) * M45;
    const last = groups[groups.length - 1];
    if (last && last.start === start) {
      last.count++;
      last.close = c.close;
    } else {
      groups.push({ start, count: 1, close: c.close });
    }
  }
  if (groups.length > 1 && groups[0]!.count < 3) groups.shift();
  return groups.map((g) => g.close);
}
