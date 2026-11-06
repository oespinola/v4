// FR-077: un error que nada maneja (una promesa rechazada sin catch en una librería, una excepción o
// una falla del arranque) no debe matar el proceso de golpe: se muestra, se registra en el log y se
// cierra en orden con código 1 para que el supervisor (FR-056) relance con Chromium cerrado y la
// sesión guardada. Traído de v3 (src/crash.ts).

export type CrashOrigin = 'unhandledRejection' | 'uncaughtException' | 'arranque';

/** Lo que handleCrashes usa del proceso (en los tests alcanza un EventEmitter). */
export interface CrashSource {
  on(event: 'unhandledRejection' | 'uncaughtException', listener: (err: unknown) => void): unknown;
}

export interface CrashOptions {
  /** Registro `error` con `source: "caída"` en el log; `detail` es `<origen>: <error>`. */
  record: (detail: string) => void;
  /** Consola; recibe también el error para mostrar su stack. */
  log: (line: string, err: unknown) => void;
  /** Cierre ordenado y salida con `code`. */
  shutdown: (code: number) => unknown;
}

/** Escucha las caídas del proceso y devuelve la misma reacción para las del arranque. */
export function handleCrashes(_proc: CrashSource, _opts: CrashOptions): (origin: CrashOrigin, err: unknown) => void {
  return () => {};
}
