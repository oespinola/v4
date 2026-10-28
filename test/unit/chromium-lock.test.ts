import { spawn } from 'node:child_process';
import { existsSync, lstatSync, mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanupChromium, findOrphans, systemCleanupDeps, type ProcessInfo } from '../../src/chromium-lock.ts';

const SESSION = '/home/u/v4/.wwebjs_auth/RemoteAuth-signalbridge';
const chrome = (pid: number, dir: string, extra = ''): ProcessInfo => ({
  pid,
  pgid: pid,
  args: `/home/u/.cache/puppeteer/chrome/linux-1/chrome-linux64/chrome --allow-pre-commit-input --user-data-dir=${dir} ${extra}`.trim(),
});

describe('Chromium huérfano (FR-056, AC-31)', () => {
  it.fails('solo el proceso principal con exactamente la carpeta de sesión de la app', () => {
    const processes = [
      chrome(10, SESSION),
      { pid: 11, pgid: 10, args: `${chrome(10, SESSION).args} --type=renderer` }, // hijo de 10
      chrome(20, `${SESSION}-v2`), // otra carpeta que empieza igual
      chrome(30, '/home/u/v3/.wwebjs_auth/RemoteAuth-signalbridge'),
      { pid: 40, pgid: 40, args: 'node scripts/supervise.ts' },
    ];
    expect(findOrphans(processes, SESSION).map((p) => p.pid)).toEqual([10]);
  });

  const fake = (opts: { diesAfter: 'SIGTERM' | 'SIGKILL' | null; lock?: number | null }) => {
    const alive = new Set([10]);
    const seen = { kills: [] as string[], waits: 0, removed: false, logs: [] as string[] };
    return {
      seen,
      deps: {
        sessionDir: SESSION,
        listProcesses: () => (alive.has(10) ? [chrome(10, SESSION)] : []),
        isAlive: (pid: number) => alive.has(pid),
        killGroup: (pgid: number, signal: 'SIGTERM' | 'SIGKILL') => {
          seen.kills.push(`${signal} -${pgid}`);
          if (signal === opts.diesAfter || signal === 'SIGKILL') alive.delete(10);
        },
        wait: async () => void (seen.waits += 1),
        lockPid: () => (opts.lock === undefined ? 10 : opts.lock),
        removeLock: () => void (seen.removed = true),
        log: (line: string) => seen.logs.push(line),
        graceMs: 1_000,
      },
    };
  };

  it.fails('AC-31: cierra el huérfano con SIGTERM a su grupo y después borra el lock', async () => {
    const { deps, seen } = fake({ diesAfter: 'SIGTERM' });
    await cleanupChromium(deps);
    expect(seen.kills).toEqual(['SIGTERM -10']);
    expect(seen.removed).toBe(true);
    expect(seen.logs).toEqual(['Chromium 10 seguía abierto con la sesión de WhatsApp: cerrado.']);
  });

  it.fails('AC-31: si no se cierra en el plazo, SIGKILL', async () => {
    const { deps, seen } = fake({ diesAfter: null });
    await cleanupChromium(deps);
    expect(seen.kills).toEqual(['SIGTERM -10', 'SIGKILL -10']);
    expect(seen.removed).toBe(true);
  });

  it.fails('AC-31: el lock se borra solo si su proceso ya no existe', async () => {
    const alive = { deps: { ...fake({ diesAfter: 'SIGTERM', lock: 99 }).deps, listProcesses: () => [], isAlive: () => true } };
    let removed = false;
    await cleanupChromium({ ...alive.deps, removeLock: () => void (removed = true) });
    expect(removed).toBe(false); // 99 vive: no se toca

    const gone = fake({ diesAfter: 'SIGTERM', lock: 99 });
    await cleanupChromium({ ...gone.deps, listProcesses: () => [], isAlive: () => false });
    expect(gone.seen.removed).toBe(true);
  });

  it.fails('sin huérfano ni lock no hace nada', async () => {
    const { deps, seen } = fake({ diesAfter: 'SIGTERM', lock: undefined });
    await cleanupChromium({ ...deps, listProcesses: () => [], lockPid: () => undefined });
    expect(seen).toMatchObject({ kills: [], removed: false, logs: [] });
  });
});

describe('Chromium huérfano con procesos reales (FR-056, AC-31)', { timeout: 20_000 }, () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it.fails('cierra un proceso suelto con esa carpeta de sesión, deja otro con otra carpeta y borra el lock', async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'signalbridge-chromium-'));
    const session = path.join(dir, 'session');
    mkdirSync(session);
    // Como Chromium tras un kill -9 de la app: otro grupo de procesos, sin padre que lo cierre.
    const start = (userDataDir: string) =>
      spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)', '--', `--user-data-dir=${userDataDir}`], {
        detached: true,
        stdio: 'ignore',
      });
    const orphan = start(session);
    const other = start(`${session}-otra`);
    symlinkSync(`DESKTOP-TEST-${orphan.pid}`, path.join(session, 'SingletonLock'));
    symlinkSync('123', path.join(session, 'SingletonCookie'));
    await new Promise((r) => setTimeout(r, 300));

    try {
      await cleanupChromium(systemCleanupDeps(session, () => {}));
      const alive = (pid: number) => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      await new Promise((r) => setTimeout(r, 300));
      expect(alive(orphan.pid!)).toBe(false);
      expect(alive(other.pid!)).toBe(true);
      expect(existsSync(path.join(session, 'SingletonLock')) || isLink(path.join(session, 'SingletonLock'))).toBe(false);
      expect(isLink(path.join(session, 'SingletonCookie'))).toBe(false);
    } finally {
      for (const p of [orphan, other]) {
        try {
          process.kill(-p.pid!, 'SIGKILL');
        } catch {
          // ya terminó
        }
      }
    }
  });
});

function isLink(file: string): boolean {
  try {
    return lstatSync(file).isSymbolicLink();
  } catch {
    return false;
  }
}
