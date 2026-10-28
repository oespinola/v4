import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/adapters/store.ts';
import { Pipeline } from '../../src/pipeline.ts';
import type { RejectReason } from '../../src/domain/types.ts';
import { FakeClock, FakeExtractor, FakeMarketData, filters, message } from '../fakes/index.ts';

const AUTH = '5491100000001';
const alertText = (ticker: string, entry: string, obj: string, sl: string) =>
  `*${ticker} - ALERTA DE TRADING*\nEntrada: ${entry} usd\nObj.: ${obj}\nSL: ${sl} usd\nRiesgo Alto 🔴`;
const KAIA = alertText('KAIA', '0.0402', '0.0380 usd', '0.0414');

const RECORD_KEYS = [
  'type', 'at', 'alertId', 'receivedAt', 'sender', 'mode', 'ticker', 'symbol', 'side', 'entry', 'sl', 'tp',
  'tpSource', 'quantity', 'riskR', 'riskLevel', 'orderIds', 'closeCause', 'closedAt', 'realizedPnl', 'fees',
  'status', 'reason', 'timings',
];

describe('log JSONL (US4: AC-09, AC-50, FR-043 a FR-046)', () => {
  let root: string;
  let dataDir: string;
  let clock: FakeClock;
  let store: Store;
  let market: FakeMarketData;
  let pipeline: Pipeline;
  const prevUmask = process.umask();

  const logLines = () =>
    readFileSync(path.join(dataDir, 'alerts.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-log-'));
    dataDir = path.join(root, 'data');
    clock = new FakeClock('2026-10-28T12:00:00Z');
    store = Store.open(dataDir, clock);
    market = new FakeMarketData([filters('KAIAUSDT'), filters('TOPUSDT')], {
      gainers: ['TOPUSDT'],
      losers: [],
      refreshedAt: clock.now(),
    });
    pipeline = new Pipeline({
      store,
      clock,
      mode: 'DRY',
      authorizedSenders: [AUTH],
      extractor: new FakeExtractor({}),
      market,
      maxSlDistancePct: 15,
    });
  });

  afterEach(() => {
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  // Los motivos de la carga (bajo mínimo, excede máximos, símbolo ya en operación, límites de
  // posiciones y de capital) los produce el pipeline de carga de US2 y se prueban con él.
  const cases: [RejectReason, () => Promise<unknown>][] = [
    ['remitente no autorizado', () => pipeline.processMessage(message(KAIA, { sender: '5491199999999' }))],
    [
      'duplicado',
      async () => {
        await pipeline.processMessage(message(KAIA, { sender: AUTH }));
        await pipeline.processMessage(message(KAIA, { sender: AUTH }));
      },
    ],
    ['incompleta', () => pipeline.processMessage(message(KAIA.replace(/\nSL: .*/, ''), { sender: AUTH }))],
    ['ticker inexistente', () => pipeline.processMessage(message(alertText('NADA', '1', '0.9 usd', '1.1'), { sender: AUTH }))],
    [
      'no disponible en Demo',
      () => {
        market.unavailableForOrders.add('KAIAUSDT');
        return pipeline.processMessage(message(KAIA, { sender: AUTH }));
      },
    ],
    ['SL igual a la Entrada', () => pipeline.processMessage(message(alertText('KAIA', '0.0402', '0.0380 usd', '0.0402'), { sender: AUTH }))],
    ['SL fuera de rango', () => pipeline.processMessage(message(alertText('KAIA', '0.0402', '0.0380 usd', '0.0600'), { sender: AUTH }))],
    [
      'datos de mercado no disponibles',
      () => {
        market.closesError = new Error('sin red');
        return pipeline.processMessage(message(alertText('KAIA', '0.0402', 'ASL21, EMA55', '0.0414'), { sender: AUTH }));
      },
    ],
    ['TP inválido', () => pipeline.processMessage(message(alertText('KAIA', '0.0402', '0.0450 usd', '0.0414'), { sender: AUTH }))],
    [
      'ranking no disponible',
      () => {
        market.currentRanking = undefined;
        return pipeline.processMessage(message(KAIA, { sender: AUTH }));
      },
    ],
    ['top 3 ganadores/perdedores', () => pipeline.processMessage(message(alertText('TOP', '1.0', '0.9 usd', '1.05'), { sender: AUTH }))],
  ];

  for (const [reason, run] of cases) {
    it(`"${reason}" queda en el JSONL con el registro completo (AC-09)`, async () => {
      await run();
      const last = logLines().at(-1)!;
      expect(Object.keys(last)).toEqual(RECORD_KEYS);
      expect(last).toMatchObject({ type: 'alert', status: 'rechazada', reason, mode: 'DRY' });
    });
  }

  it('el log y la base quedan en 0600 y data/ en 0700 (FR-046, AC-50)', async () => {
    await pipeline.processMessage(message(KAIA, { sender: '5491199999999' }));
    expect(statSync(dataDir).mode & 0o777).toBe(0o700);
    expect(statSync(path.join(dataDir, 'alerts.log')).mode & 0o777).toBe(0o600);
    expect(statSync(path.join(dataDir, 'signalbridge.db')).mode & 0o777).toBe(0o600);
  });

  it('una alerta válida no se loguea: es un estado de trabajo', async () => {
    const r = await pipeline.processMessage(message(KAIA, { sender: AUTH }));
    expect(r).toMatchObject({ alert: { status: 'válida' } });
    expect(logLines()).toEqual([]);
  });

  it('registra eventos de conexión con su esquema (FR-055)', () => {
    store.logConnection({ service: 'whatsapp', event: 'interrupción', attempt: 0, waitMs: null });
    store.logConnection({ service: 'binance', event: 'reintento', attempt: 3, waitMs: 4000 });
    expect(logLines()).toEqual([
      { type: 'connection', at: '2026-10-28T12:00:00.000Z', service: 'whatsapp', event: 'interrupción', attempt: 0, waitMs: null },
      { type: 'connection', at: '2026-10-28T12:00:00.000Z', service: 'binance', event: 'reintento', attempt: 3, waitMs: 4000 },
    ]);
  });

  it('registra eventos críticos con su esquema, con alertId en null si no aplica (FR-030, FR-038, FR-055)', () => {
    store.logCritical({ kind: 'reconexión agotada', detail: '10 intentos fallidos con Binance' });
    store.logCritical({ kind: 'SL/TP perdido', alertId: 'wa-1:0123456789abcdef', detail: 'falta el SL' });
    expect(logLines()).toEqual([
      { type: 'critical', at: '2026-10-28T12:00:00.000Z', kind: 'reconexión agotada', alertId: null, detail: '10 intentos fallidos con Binance' },
      { type: 'critical', at: '2026-10-28T12:00:00.000Z', kind: 'SL/TP perdido', alertId: 'wa-1:0123456789abcdef', detail: 'falta el SL' },
    ]);
  });
});
