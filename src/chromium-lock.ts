// FR-056, AC-31: antes de cada arranque, que la sesión de WhatsApp quede libre. Si la app murió
// sin cerrar Chromium (kill -9, o el sistema la mató por memoria), Chromium sigue vivo en su
// propio grupo de procesos (Puppeteer lo lanza con detached), conectado con la misma sesión y con
// el lock tomado: el arranque siguiente choca con él ("Execution context was destroyed"). Como en
// ese momento la app no corre, todo Chromium con el perfil de trabajo de la app es un resto de ella.
// Portado de v3 (src/chromium-lock.ts).

/** Un proceso según `ps`. */
export interface ProcessInfo {
  pid: number;
  pgid: number;
  args: string;
}

export interface CleanupDeps {
  /** Ruta absoluta, la de --user-data-dir. */
  sessionDir: string;
  listProcesses: () => ProcessInfo[];
  isAlive: (pid: number) => boolean;
  killGroup: (pgid: number, signal: 'SIGTERM' | 'SIGKILL') => void;
  wait: (ms: number) => Promise<void>;
  /** undefined: no hay lock; null: no se entiende. */
  lockPid: () => number | null | undefined;
  removeLock: () => void;
  log: (line: string) => void;
  /** Espera tras SIGTERM antes de SIGKILL (10 s). */
  graceMs?: number;
}

export const GRACE_MS = 10_000;

/** El proceso principal de Chromium (no sus renderers ni helpers, que llevan --type=) que usa
 *  exactamente esa carpeta de perfil. */
export function findOrphans(processes: readonly ProcessInfo[], sessionDir: string): ProcessInfo[] {
  throw new Error('sin implementar');
}

export async function cleanupChromium(deps: CleanupDeps): Promise<void> {
  throw new Error('sin implementar');
}

/** Adaptadores reales (Linux): ps, señales y el lock de Chromium en la carpeta de perfil. */
export function systemCleanupDeps(sessionDir: string, log: (line: string) => void): CleanupDeps {
  throw new Error('sin implementar');
}
