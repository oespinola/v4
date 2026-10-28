import { execFileSync } from 'node:child_process';
import { readlinkSync, unlinkSync } from 'node:fs';
import path from 'node:path';

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
  return processes.filter(
    (p) => ` ${p.args} `.includes(` --user-data-dir=${sessionDir} `) && !/ --type=/.test(` ${p.args}`),
  );
}

export async function cleanupChromium(deps: CleanupDeps): Promise<void> {
  const graceMs = deps.graceMs ?? GRACE_MS;
  for (const orphan of findOrphans(deps.listProcesses(), deps.sessionDir)) {
    // SIGTERM primero: Chromium cierra en orden y guarda la sesión.
    deps.killGroup(orphan.pgid, 'SIGTERM');
    for (let waited = 0; deps.isAlive(orphan.pid) && waited < graceMs; waited += POLL_MS) await deps.wait(POLL_MS);
    let how = 'cerrado';
    if (deps.isAlive(orphan.pid)) {
      deps.killGroup(orphan.pgid, 'SIGKILL');
      how = `cerrado a la fuerza (SIGKILL tras ${graceMs / 1000} s)`;
    }
    deps.log(`Chromium ${orphan.pid} seguía abierto con la sesión de WhatsApp: ${how}.`);
  }
  // El lock apunta a "<host>-<pid>"; si ese proceso ya no existe, sobra.
  const lockPid = deps.lockPid();
  if (lockPid !== undefined && (lockPid === null || !deps.isAlive(lockPid))) deps.removeLock();
}

const POLL_MS = 250;
const LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket'];

const errorCode = (err: unknown) => (err as NodeJS.ErrnoException).code;

/** Adaptadores reales (Linux): ps, señales y el lock de Chromium en la carpeta de perfil. */
export function systemCleanupDeps(sessionDir: string, log: (line: string) => void): CleanupDeps {
  return {
    sessionDir,
    listProcesses: () =>
      execFileSync('ps', ['-eo', 'pid=,pgid=,args='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
        .split('\n')
        .flatMap((line) => {
          const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);
          return m ? [{ pid: Number(m[1]), pgid: Number(m[2]), args: m[3]! }] : [];
        }),
    isAlive: (pid) => {
      try {
        process.kill(pid, 0);
        return true;
      } catch (err) {
        return errorCode(err) === 'EPERM'; // existe, pero es de otro usuario
      }
    },
    killGroup: (pgid, signal) => {
      try {
        process.kill(-pgid, signal);
      } catch (err) {
        if (errorCode(err) !== 'ESRCH') throw err; // ya había terminado
      }
    },
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    lockPid: () => {
      try {
        const target = readlinkSync(path.join(sessionDir, 'SingletonLock'));
        const m = /-(\d+)$/.exec(target);
        return m ? Number(m[1]) : null;
      } catch (err) {
        if (errorCode(err) === 'ENOENT') return undefined;
        throw err;
      }
    },
    // Son enlaces simbólicos: unlink borra el enlace, no lo que apunta.
    removeLock: () => {
      for (const name of LOCK_FILES) {
        try {
          unlinkSync(path.join(sessionDir, name));
        } catch (err) {
          if (errorCode(err) !== 'ENOENT') throw err;
        }
      }
    },
    log,
  };
}
