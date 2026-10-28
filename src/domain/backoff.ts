// Backoff de reconexión (FR-055). Pendiente de implementar (T015).

export interface RetryStep {
  attempt: number;
  waitMs: number;
  exhausted: boolean;
}

export function backoffDelayMs(_attempt: number): number {
  throw new Error('backoffDelayMs: no implementado');
}

export class RetryCounter {
  failure(): RetryStep {
    throw new Error('RetryCounter: no implementado');
  }
  success(): void {
    throw new Error('RetryCounter: no implementado');
  }
}
