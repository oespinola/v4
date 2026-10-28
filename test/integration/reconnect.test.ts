import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/adapters/store.ts';
import { BINANCE_HEARTBEAT_MS, ConnectionMonitor, monitorExchange, type Service } from '../../src/connection-monitor.ts';
import { FakeClock, FakeExchange } from '../fakes/index.ts';

class NetworkError extends Error {}
const isConnectionError = (e: unknown) => e instanceof NetworkError;

describe('monitor de conexión (FR-055, AC-47, AC-74, R-10)', () => {
  let root: string;
  let clock: FakeClock;
  let store: Store;
  let monitor: ConnectionMonitor;
  let exits: number[];
  let emergency: boolean;
  let probeFails: Record<Service, number>;
  let probes: Record<Service, number[]>;
  const prevUmask = process.umask();

  const logLines = () =>
    readFileSync(path.join(root, 'data', 'alerts.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);
  const of = (service: Service) => logLines().filter((l) => l.service === service);

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-conn-'));
    clock = new FakeClock('2026-10-28T12:00:00Z');
    store = Store.open(path.join(root, 'data'), clock);
    exits = [];
    emergency = false;
    probeFails = { whatsapp: 0, binance: 0 };
    probes = { whatsapp: [], binance: [] };
    const probe = (s: Service) => async () => {
      probes[s].push(clock.now().getTime());
      if (probeFails[s]-- > 0) throw new NetworkError('sin conexión');
      monitor.up(s);
    };
    monitor = new ConnectionMonitor({
      clock,
      store,
      emergency: { emergencyInProgress: () => emergency },
      probes: { whatsapp: probe('whatsapp'), binance: probe('binance') },
      exit: (code) => exits.push(code),
      log: () => {},
    });
  });

  afterEach(() => {
    monitor.stop();
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  it.fails('registra el corte al instante y reintenta con 1, 2, 4… s hasta reconectar (AC-47)', async () => {
    monitor.up('whatsapp');
    probeFails.whatsapp = 3;
    const cutAt = clock.now().getTime();
    monitor.down('whatsapp', 'disconnected');
    expect(of('whatsapp')[0]).toMatchObject({ type: 'connection', event: 'interrupción', attempt: 0, waitMs: null });
    expect(Date.parse(String(of('whatsapp')[0]!.at)) - cutAt).toBeLessThan(30_000);
    await clock.advance(60_000);
    expect(probes.whatsapp.map((t) => t - cutAt)).toEqual([1000, 3000, 7000, 15000]);
    expect(of('whatsapp').map((l) => [l.event, l.attempt, l.waitMs])).toEqual([
      ['interrupción', 0, null],
      ['reintento', 1, 1000],
      ['reintento', 2, 2000],
      ['reintento', 3, 4000],
      ['reintento', 4, 8000],
      ['reconectado', 4, null],
    ]);
    expect(exits).toEqual([]);
  });

  it.fails('al 10.º fallo consecutivo: evento crítico y salida con código 1 (FR-055)', async () => {
    monitor.up('binance');
    probeFails.binance = 99;
    monitor.down('binance');
    await clock.advance(20 * 60_000);
    expect(probes.binance).toHaveLength(10);
    const waits = of('binance').filter((l) => l.event === 'reintento').map((l) => l.waitMs);
    expect(waits).toEqual([1000, 2000, 4000, 8000, 16000, 32000, 60000, 60000, 60000, 60000]);
    expect(logLines().filter((l) => l.type === 'critical')).toEqual([expect.objectContaining({ kind: 'reconexión agotada' })]);
    expect(exits).toEqual([1]);
  });

  it.fails('con un cierre de emergencia en curso no sale: evento crítico y sigue reintentando (AC-74)', async () => {
    emergency = true;
    monitor.up('binance');
    probeFails.binance = 12;
    monitor.down('binance');
    await clock.advance(20 * 60_000);
    expect(exits).toEqual([]);
    expect(probes.binance).toHaveLength(13);
    expect(logLines().filter((l) => l.type === 'critical')).toEqual([expect.objectContaining({ kind: 'reconexión agotada' })]);
    expect(of('binance').at(-1)).toMatchObject({ event: 'reconectado' });
  });

  it.fails('cada servicio lleva su contador', async () => {
    monitor.up('whatsapp');
    monitor.up('binance');
    probeFails.whatsapp = 99;
    monitor.down('whatsapp');
    await clock.advance(3000);
    expect(probes.binance).toEqual([]);
    expect(of('binance')).toEqual([]);
  });

  it.fails('un nuevo corte mientras ya reintenta no duplica el ciclo', async () => {
    monitor.up('whatsapp');
    probeFails.whatsapp = 2;
    monitor.down('whatsapp');
    monitor.down('whatsapp');
    await clock.advance(60_000);
    expect(of('whatsapp').filter((l) => l.event === 'interrupción')).toHaveLength(1);
    expect(probes.whatsapp).toHaveLength(3);
  });

  it.fails('latido de Binance: detecta un corte en < 30 s aunque no haya operaciones (AC-47)', async () => {
    monitor.up('binance');
    monitor.start();
    probeFails.binance = 99;
    await clock.advance(BINANCE_HEARTBEAT_MS);
    expect(BINANCE_HEARTBEAT_MS).toBeLessThan(30_000);
    expect(of('binance')[0]).toMatchObject({ event: 'interrupción' });
  });

  it.fails('el exchange monitoreado: los errores de red cortan, los rechazos de órdenes no, y propaga el error (R-10)', async () => {
    const reported: string[] = [];
    const ex = monitorExchange(
      new FakeExchange({
        order: async () => Promise.reject(new NetworkError('timeout')),
        placeStopLoss: async () => Promise.reject(new Error('-2021 la orden dispararía de inmediato')),
        openPositions: async () => [],
      }),
      { up: (s) => void reported.push(`up:${s}`), down: (s) => void reported.push(`down:${s}`) },
      isConnectionError,
    );
    await expect(ex.order({ symbol: 'X', id: '1' })).rejects.toThrow('timeout');
    await expect(ex.placeStopLoss('X', 'LONG', 1)).rejects.toThrow('-2021');
    await ex.openPositions();
    expect(reported).toEqual(['down:binance', 'up:binance', 'up:binance']);
  });
});
