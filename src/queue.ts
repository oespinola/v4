// Cola de concurrencia 1 (FR-061): cada alerta se evalúa por completo (y su entrada se coloca o se
// rechaza) antes de empezar la siguiente, así los límites de exposición ven siempre el estado real.

export class SerialQueue {
  private tail: Promise<void> = Promise.resolve();
  private count = 0;

  constructor(private readonly onError: (error: unknown) => void = () => {}) {}

  get pending(): number {
    return this.count;
  }

  /** Encola un trabajo; la promesa se resuelve cuando ese trabajo termina (nunca rechaza). */
  push(job: () => Promise<void>): Promise<void> {
    this.count++;
    const run = this.tail.then(async () => {
      try {
        await job();
      } catch (error) {
        this.onError(error);
      } finally {
        this.count--;
      }
    });
    this.tail = run;
    return run;
  }

  idle(): Promise<void> {
    return this.tail;
  }
}
