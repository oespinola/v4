// Backoff de reconexión (FR-055): 1, 2, 4… s hasta 60 s entre intentos, y "agotado" desde el
// 10.º fallo consecutivo. Quien consume la señal decide qué hacer: el monitor de conexión sale,
// el cierre de emergencia la ignora y sigue reintentando (FR-030).

export const BACKOFF_BASE_MS = 1000;
export const BACKOFF_MAX_MS = 60_000;
export const EXHAUSTED_AFTER = 10;

export interface RetryStep {
  attempt: number;
  waitMs: number;
  exhausted: boolean;
}

/** Espera antes del intento `attempt` (1 = primer reintento). */
export function backoffDelayMs(attempt: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempt - 1), BACKOFF_MAX_MS);
}

export class RetryCounter {
  private failures = 0;

  failure(): RetryStep {
    this.failures++;
    return {
      attempt: this.failures,
      waitMs: backoffDelayMs(this.failures),
      exhausted: this.failures >= EXHAUSTED_AFTER,
    };
  }

  success(): void {
    this.failures = 0;
  }
}
