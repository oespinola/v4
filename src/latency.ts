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
export function p95(_values: number[]): number | null {
  throw new Error('no implementado');
}

/** Mediciones desde las líneas del JSONL. */
export function latencyReport(_lines: string[]): LatencyCheck[] {
  throw new Error('no implementado');
}
