// Latencia sobre el log (SC-001, SC-002, AC-46, AC-48, R-13): p95 de la clasificación y de la
// aceptación de la entrada, separado por alertas resueltas solo con el texto y con la imagen. Cada
// medición se evalúa sobre un lote de al menos 20 alertas de su tipo.

export const MIN_BATCH = 20;

export interface LatencyCheck {
  name: string;
  limitMs: number;
  n: number;
  p95: number | null;
  /** null: menos de MIN_BATCH alertas, no alcanza para medir. */
  ok: boolean | null;
}

/** p95 por rango más cercano. */
export function p95(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(0.95 * sorted.length) - 1]!;
}

interface Timings {
  classifiedMs: number | null;
  entryAcceptedMs: number | null;
  withImage: boolean;
}

const LIMITS: [name: string, key: 'classifiedMs' | 'entryAcceptedMs', withImage: boolean, limitMs: number][] = [
  ['clasificación, solo texto', 'classifiedMs', false, 3000],
  ['clasificación, con imagen', 'classifiedMs', true, 10_000],
  ['entrada aceptada, solo texto', 'entryAcceptedMs', false, 5000],
  ['entrada aceptada, con imagen', 'entryAcceptedMs', true, 12_000],
];

/** Mediciones desde las líneas del JSONL. */
export function latencyReport(lines: string[]): LatencyCheck[] {
  // La última línea de cada alerta manda: una operación se loguea al quedar completa y al cerrarse.
  const byAlert = new Map<string, Timings>();
  let anonymous = 0;
  for (const line of lines) {
    let record: { type?: string; alertId?: string; timings?: Timings };
    try {
      record = JSON.parse(line) as typeof record;
    } catch {
      continue;
    }
    if (record.type !== 'alert' || !record.timings) continue;
    byAlert.set(record.alertId ?? `sin-id-${anonymous++}`, record.timings);
  }
  const timings = [...byAlert.values()];
  return LIMITS.map(([name, key, withImage, limitMs]) => {
    const values = timings
      .filter((t) => (t.withImage ?? false) === withImage)
      .map((t) => t[key])
      .filter((v): v is number => typeof v === 'number');
    const value = p95(values);
    return { name, limitMs, n: values.length, p95: value, ok: values.length < MIN_BATCH ? null : value! < limitMs };
  });
}
