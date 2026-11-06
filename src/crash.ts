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

/** "Error: …" para un Error; el texto tal cual para un rechazo con otra cosa ("auth timeout"). */
export function describeCrash(err: unknown): string {
  return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
}

/**
 * Escucha las caídas del proceso y devuelve la misma reacción para las del arranque. La primera
 * cierra; las que llegan durante el cierre solo se muestran y se registran (un segundo cierre
 * cortaría el primero a mitad, con Chromium abierto).
 */
export function handleCrashes(proc: CrashSource, opts: CrashOptions): (origin: CrashOrigin, err: unknown) => void {
  let crashed = false;
  const crash = (origin: CrashOrigin, err: unknown) => {
    const error = describeCrash(err);
    opts.log(`Caída (${origin}): ${error}`, err);
    try {
      opts.record(`${origin}: ${error}`);
    } catch (recordErr) {
      opts.log(`No se pudo registrar la caída en el log: ${describeCrash(recordErr)}`, recordErr);
    }
    if (crashed) return;
    crashed = true;
    void opts.shutdown(1);
  };
  proc.on('unhandledRejection', (err) => crash('unhandledRejection', err));
  proc.on('uncaughtException', (err) => crash('uncaughtException', err));
  return crash;
}
