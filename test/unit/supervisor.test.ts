import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { CONFIG_EXIT_CODE } from '../../src/config.ts';
import {
  appendCriticalLog,
  CRITICAL_RESTARTS,
  HEALTHY_RUN_MS,
  MAX_DELAY_MS,
  restartDelayMs,
  supervise,
  type AppExit,
} from '../../src/supervisor.ts';

/** Supervisor con una secuencia de salidas de la app y un reloj que avanza con cada espera. */
function run(exits: AppExit[], opts: { runMs?: number[]; stopAfter?: number } = {}) {
  let now = 0;
  let runs = 0;
  const waits: number[] = [];
  const events: string[] = [];
  const logs: string[] = [];
  const criticals: Array<{ kind: string; detail: string }> = [];
  const done = supervise({
    runApp: async () => {
      const exit = exits[runs];
      if (!exit) throw new Error('la app se arrancó más veces de las previstas');
      now += opts.runMs?.[runs] ?? 1000;
      runs++;
      events.push(`run${runs}`);
      return exit;
    },
    wait: async (ms) => {
      waits.push(ms);
      now += ms;
    },
    now: () => now,
    stopRequested: () => opts.stopAfter !== undefined && runs >= opts.stopAfter,
    log: (line) => void logs.push(line),
    beforeRestart: () => void events.push('limpieza'),
    onCritical: (e) => void criticals.push(e),
  });
  return { done, waits, events, logs, criticals, runs: () => runs };
}

const crash: AppExit = { code: 1, signal: null };
const killed: AppExit = { code: null, signal: 'SIGKILL' };

describe('supervisor (FR-056, AC-31, contracts/cli.md)', () => {
  it('relanza ante una salida ≠ 0 y ante un kill -9, limpiando antes de cada relanzamiento (AC-31)', async () => {
    const s = run([crash, killed, { code: 0, signal: null }]);
    expect(await s.done).toBe(0);
    expect(s.events).toEqual(['run1', 'limpieza', 'run2', 'limpieza', 'run3']);
  });

  it('no relanza ante 0 ni ante 78 (configuración inválida)', async () => {
    expect(await run([{ code: 0, signal: null }]).done).toBe(0);
    const config = run([{ code: CONFIG_EXIT_CODE, signal: null }]);
    expect(await config.done).toBe(78);
    expect(config.runs()).toBe(1);
  });

  it('no relanza si el operador pidió parar (Ctrl+C)', async () => {
    const s = run([crash], { stopAfter: 1 });
    expect(await s.done).toBe(1);
    expect(s.runs()).toBe(1);
  });

  it('esperas de 1, 2, 4… s con tope de 15 s: la ingesta vuelve en < 60 s (FR-056)', async () => {
    expect([1, 2, 3, 4, 5, 6, 10].map(restartDelayMs)).toEqual([1000, 2000, 4000, 8000, 15000, 15000, 15000]);
    expect(MAX_DELAY_MS).toBeLessThan(60_000);
    const s = run([crash, crash, crash, { code: 0, signal: null }]);
    await s.done;
    expect(s.waits).toEqual([1000, 2000, 4000]);
  });

  it('tras una ejecución sana (≥ 10 min) la espera vuelve a 1 s', async () => {
    const s = run([crash, crash, crash, { code: 0, signal: null }], { runMs: [1000, 1000, HEALTHY_RUN_MS, 1000] });
    await s.done;
    expect(s.waits).toEqual([1000, 2000, 1000]);
  });

  it('al 10.º reinicio seguido registra un evento crítico, lo muestra y sigue relanzando (FR-074, AC-93)', async () => {
    const s = run([...Array<AppExit>(CRITICAL_RESTARTS + 2).fill(crash), { code: 0, signal: null }]);
    expect(await s.done).toBe(0);
    expect(s.runs()).toBe(CRITICAL_RESTARTS + 3);
    const detail = '10 reinicios seguidos sin quedar en marcha 10 min; se sigue relanzando';
    expect(s.criticals).toEqual([{ kind: 'reinicios seguidos', detail }]);
    expect(s.logs).toContain(`⚠ CRÍTICO reinicios seguidos: ${detail}`);
  });

  it('una ejecución sana reinicia la cuenta de reinicios seguidos (FR-074)', async () => {
    const exits = [...Array<AppExit>(18).fill(crash), { code: 0, signal: null }];
    const runMs = exits.map((_, i) => (i === 9 ? HEALTHY_RUN_MS : 1000));
    const s = run(exits, { runMs });
    await s.done;
    expect(s.criticals).toEqual([]);
  });

  it('el evento crítico se agrega al log JSONL de la app con permisos 0600 (FR-074)', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'sb-sup-'));
    try {
      const file = path.join(root, 'alerts.log');
      appendCriticalLog(file, { kind: 'reinicios seguidos', detail: 'x' }, new Date('2026-10-30T12:00:00Z'));
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual({
        type: 'critical',
        at: '2026-10-30T12:00:00.000Z',
        kind: 'reinicios seguidos',
        alertId: null,
        detail: 'x',
      });
      expect(statSync(file).mode & 0o777).toBe(0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
