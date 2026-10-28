// Reinicio automático (FR-056, contracts/cli.md): `pnpm dev` y `pnpm start` corren la app bajo este
// supervisor (scripts/supervise.ts). Acá solo las decisiones; el proceso, las señales y el reloj se
// pasan desde afuera.

export const FIRST_DELAY_MS = 1000;
/** Tope de la espera: con el arranque de WhatsApp, la ingesta vuelve en < 60 s (FR-056). */
export const MAX_DELAY_MS = 15_000;
/** Una ejecución que duró esto o más se considera sana: la espera vuelve a empezar. */
export const HEALTHY_RUN_MS = 10 * 60_000;

/** Cómo terminó la app: código de salida, o la señal que la mató (kill -9 → SIGKILL). */
export interface AppExit {
  code: number | null;
  signal: string | null;
}

export interface SupervisorDeps {
  runApp(): Promise<AppExit>;
  /** Termina antes si el operador pide parar. */
  wait(ms: number): Promise<void>;
  now(): number;
  stopRequested(): boolean;
  log(line: string): void;
  /** Antes de relanzar: p. ej., matar un Chromium que sobrevivió a un kill -9. */
  beforeRestart?(): Promise<void> | void;
}

export function restartDelayMs(_attempt: number): number {
  throw new Error('no implementado');
}

/** Devuelve el código con el que debe salir el supervisor. */
export async function supervise(_deps: SupervisorDeps): Promise<number> {
  throw new Error('no implementado');
}
