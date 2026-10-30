// Reinicio automático (FR-056, contracts/cli.md): `pnpm dev` y `pnpm start` corren la app bajo este
// supervisor (scripts/supervise.ts). Acá solo las decisiones; el proceso, las señales y el reloj se
// pasan desde afuera.
import { CONFIG_EXIT_CODE } from './config.ts';

export const FIRST_DELAY_MS = 1000;
/** Tope de la espera: con el arranque de WhatsApp, la ingesta vuelve en < 60 s (FR-056). */
export const MAX_DELAY_MS = 15_000;
/** Una ejecución que duró esto o más se considera sana: la espera vuelve a empezar. */
export const HEALTHY_RUN_MS = 10 * 60_000;
/** Reinicios seguidos sin una ejecución sana que se registran como evento crítico (FR-074). */
export const CRITICAL_RESTARTS = 10;

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
  /** FR-074: el evento crítico de los reinicios seguidos, para el log JSONL. */
  onCritical?(e: { kind: 'reinicios seguidos'; detail: string }): void;
}

/** 1, 2, 4… s hasta 15 s. */
export function restartDelayMs(attempt: number): number {
  return Math.min(FIRST_DELAY_MS * 2 ** (attempt - 1), MAX_DELAY_MS);
}

const describeExit = ({ code, signal }: AppExit) =>
  code !== null ? `la app salió con código ${code}` : `la app terminó por la señal ${signal}`;

/** Devuelve el código con el que debe salir el supervisor. */
export async function supervise(deps: SupervisorDeps): Promise<number> {
  let attempt = 0;
  for (;;) {
    const startedAt = deps.now();
    const exit = await deps.runApp();
    const code = exit.code ?? 1;
    // 0: cierre pedido; 78: configuración inválida, relanzar solo repetiría el error (FR-058).
    if (exit.code === 0 || exit.code === CONFIG_EXIT_CODE || deps.stopRequested()) return code;

    if (deps.now() - startedAt >= HEALTHY_RUN_MS) attempt = 0;
    attempt += 1;
    const delay = restartDelayMs(attempt);
    deps.log(`Reinicio automático n.º ${attempt} en ${delay / 1000} s (${describeExit(exit)}).`);
    await deps.wait(delay);
    if (deps.stopRequested()) return code;
    await deps.beforeRestart?.();
  }
}

/** Agrega un evento crítico al log JSONL de la app (contracts/log-record.md) desde el supervisor. */
export function appendCriticalLog(_logFile: string, _e: { kind: string; detail: string }, _at: Date): void {
  throw new Error('no implementado');
}
