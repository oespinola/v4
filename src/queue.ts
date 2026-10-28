// Cola de concurrencia 1 (FR-061). Pendiente de implementar (T017).

export class SerialQueue {
  constructor(_onError?: (error: unknown) => void) {}

  get pending(): number {
    throw new Error('SerialQueue: no implementado');
  }

  push(_job: () => Promise<void>): Promise<void> {
    throw new Error('SerialQueue: no implementado');
  }

  idle(): Promise<void> {
    throw new Error('SerialQueue: no implementado');
  }
}
