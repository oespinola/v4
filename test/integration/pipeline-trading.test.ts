import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/adapters/store.ts';
import { ENTRY_TIMEOUT_MS, Executor, POLL_MS } from '../../src/domain/executor.ts';
import { Pipeline, type TradingDeps } from '../../src/pipeline.ts';
import { SerialQueue } from '../../src/queue.ts';
import { FakeClock, FakeExchange, FakeExtractor, FakeMarketData, filters, message } from '../fakes/index.ts';

const AUTH = '5491100000001';
const alertText = (ticker: string, entry: string, obj: string, sl: string, risk = 'Riesgo Alto 🔴') =>
  `*${ticker} - ALERTA DE TRADING*\nEntrada: ${entry} usd\nObj.: ${obj}\nSL: ${sl} usd\n${risk}`;
const KAIA = alertText('KAIA', '0.0402', '0.0380 usd', '0.0414'); // SHORT, 4166 × 0.0402 = 167.47 USDT
const KITE = alertText('KITE', '0.0402', '0.0380 usd', '0.0414');

describe('pipeline de carga (FR-020 completo, FR-021 a FR-027, FR-061, FR-063)', () => {
  let root: string;
  let clock: FakeClock;
  let store: Store;
  let market: FakeMarketData;
  let exchange: FakeExchange;
  let nextOrder: number;
  const prevUmask = process.umask();

  const logLines = () =>
    readFileSync(path.join(root, 'data', 'alerts.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  function pipeline(limits: Partial<TradingDeps> = {}) {
    const executor = new Executor({ exchange, store, clock, symbolLeverage: 2, riskR: 5 });
    return new Pipeline({
      store,
      clock,
      mode: 'DRY',
      authorizedSenders: [AUTH],
      extractor: new FakeExtractor({}),
      market,
      maxSlDistancePct: 15,
      maxEntryDistancePct: 10,
      trading: {
        exchange,
        executor,
        riskR: 5,
        maxPositions: 3,
        maxCapitalUsdt: 3000,
        maxPositionUsdt: 1000,
        maxLeverage: 2,
        ...limits,
      },
    });
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-trading-'));
    clock = new FakeClock('2026-10-28T12:00:00Z');
    store = Store.open(path.join(root, 'data'), clock);
    market = new FakeMarketData([filters('KAIAUSDT'), filters('KITEUSDT')], { gainers: [], losers: [], refreshedAt: clock.now() });
    market.closes.set('KAIAUSDT', [0.0402]); // precio de mercado, para FR-068
    market.closes.set('KITEUSDT', [0.0402]);
    nextOrder = 1;
    exchange = new FakeExchange({
      walletBalanceUsdt: async () => 3000,
      prepareSymbol: async () => {},
      placeLimitEntry: async (o) => ({ symbol: o.symbol, id: `E${nextOrder++}` }),
      findEntry: async () => null,
      order: async (r) => ({ ref: r, status: 'open', filledQty: 0 }),
      cancel: async () => {},
    });
  });

  afterEach(() => {
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  it('una alerta válida se dimensiona y su entrada queda pendiente', async () => {
    const r = await pipeline().processMessage(message(KAIA, { sender: AUTH }));
    expect(r).toMatchObject({ kind: 'alert', alert: { status: 'entrada pendiente', symbol: 'KAIAUSDT' } });
    expect(exchange.callsTo('placeLimitEntry')[0]?.args).toMatchObject([{ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166, price: 0.0402 }]);
    expect(store.activeTradeForSymbol('KAIAUSDT')).toMatchObject({ state: 'pendiente', quantity: 4166, notional: 167.4732 });
    expect(logLines()).toEqual([]); // pendiente es un estado de trabajo
  });

  it('el nivel de riesgo no cambia la cantidad (AC-36)', async () => {
    await pipeline().processMessage(message(KAIA, { sender: AUTH }));
    await pipeline().processMessage(message(alertText('KITE', '0.0402', '0.0380 usd', '0.0414', 'Riesgo Medio 🟡'), { sender: AUTH, waMessageId: 'wa-2' }));
    const [a, b] = exchange.callsTo('placeLimitEntry').map((c) => (c.args[0] as { quantity: number }).quantity);
    expect(a).toBe(4166);
    expect(b).toBe(a);
  });

  const rejections: [string, () => Partial<TradingDeps> | void, string][] = [
    ['bajo mínimo', () => void market.symbols.set('KAIAUSDT', filters('KAIAUSDT', { minQty: 5000 })), 'bajo mínimo'],
    [
      'balance no disponible (AC-72)',
      () => {
        exchange.impl.walletBalanceUsdt = async () => Promise.reject(new Error('timeout'));
      },
      'datos de mercado no disponibles',
    ],
    ['tamaño máximo', () => ({ maxPositionUsdt: 100 }), 'excede máximos'],
    ['apalancamiento máximo', () => ({ maxLeverage: 0.01 }), 'excede máximos'],
  ];
  for (const [name, arrange, reason] of rejections) {
    it(`${name} → "${reason}", sin colocar órdenes`, async () => {
      const limits = arrange() ?? {};
      const r = await pipeline(limits).processMessage(message(KAIA, { sender: AUTH }));
      expect(r).toMatchObject({ alert: { status: 'rechazada', reason } });
      expect(exchange.callsTo('placeLimitEntry')).toHaveLength(0);
      expect(store.findByWaMessageId('wa-1')).toMatchObject({ status: 'rechazada', reason });
      expect(logLines()).toEqual([expect.objectContaining({ type: 'alert', status: 'rechazada', reason })]);
    });
  }

  it('bajo mínimo no consulta el balance (orden de FR-020)', async () => {
    market.symbols.set('KAIAUSDT', filters('KAIAUSDT', { minQty: 5000 }));
    const r = await pipeline().processMessage(message(KAIA, { sender: AUTH }));
    expect(r).toMatchObject({ alert: { reason: 'bajo mínimo' } });
    expect(exchange.callsTo('walletBalanceUsdt')).toHaveLength(0);
  });

  it('un símbolo con entrada pendiente rechaza otra alerta del mismo símbolo (AC-70)', async () => {
    const p = pipeline();
    await p.processMessage(message(KAIA, { sender: AUTH }));
    const other = alertText('KAIA', '0.0410', '0.0390 usd', '0.0420');
    const r = await p.processMessage(message(other, { sender: AUTH, waMessageId: 'wa-2' }));
    expect(r).toMatchObject({ alert: { status: 'rechazada', reason: 'símbolo ya en operación' } });
    expect(exchange.callsTo('placeLimitEntry')).toHaveLength(1);
  });

  it('con una entrada pendiente y máximo 1 → "límite de posiciones" (AC-51)', async () => {
    const p = pipeline({ maxPositions: 1 });
    await p.processMessage(message(KAIA, { sender: AUTH }));
    const r = await p.processMessage(message(KITE, { sender: AUTH, waMessageId: 'wa-2' }));
    expect(r).toMatchObject({ alert: { status: 'rechazada', reason: 'límite de posiciones' } });
  });

  it('nocional comprometido + nuevo > máximo → "límite de capital" (AC-24)', async () => {
    const p = pipeline({ maxCapitalUsdt: 300 });
    await p.processMessage(message(KAIA, { sender: AUTH }));
    const r = await p.processMessage(message(KITE, { sender: AUTH, waMessageId: 'wa-2' }));
    expect(r).toMatchObject({ alert: { status: 'rechazada', reason: 'límite de capital' } });
  });

  it('si la entrada no se puede colocar, la alerta queda "entrada no ejecutada"', async () => {
    exchange.impl.placeLimitEntry = async () => Promise.reject(new Error('-2019'));
    const r = await pipeline().processMessage(message(KAIA, { sender: AUTH }));
    expect(r).toMatchObject({ alert: { status: 'entrada no ejecutada' } });
    expect(logLines()).toEqual([expect.objectContaining({ status: 'entrada no ejecutada' })]);
    expect(store.exposure()).toEqual({ positions: 0, notional: 0 });
  });

  it('si la entrada no quedó en Binance, el reenvío un minuto después se evalúa de nuevo (AC-83)', async () => {
    const place = exchange.impl.placeLimitEntry!;
    exchange.impl.placeLimitEntry = async () => Promise.reject(new Error('RequestTimeout: binanceusdm POST /fapi/v1/order'));
    const first = await pipeline().processMessage(message(KAIA, { sender: AUTH }));
    expect(first).toMatchObject({ alert: { status: 'entrada no ejecutada' } });
    exchange.impl.placeLimitEntry = place;
    await clock.advance(60_000);
    market.currentRanking = { gainers: [], losers: [], refreshedAt: clock.now() };
    const resent = await pipeline().processMessage(message(KAIA, { sender: AUTH, waMessageId: 'wa-2' }));
    expect(resent).toMatchObject({ alert: { status: 'entrada pendiente' } });
  });

  it('si la entrada se colocó y venció sin ejecutarse, el reenvío sigue siendo duplicado (AC-85)', async () => {
    const p = pipeline();
    await p.processMessage(message(KAIA, { sender: AUTH }));
    await clock.advance(ENTRY_TIMEOUT_MS + POLL_MS);
    expect(store.getAlert(logLines()[0]!.alertId as string)?.status).toBe('entrada no ejecutada');
    const resent = await p.processMessage(message(KAIA, { sender: AUTH, waMessageId: 'wa-2' }));
    expect(resent).toMatchObject({ alert: { status: 'rechazada', reason: 'duplicado' } });
  });

  it('dos alertas casi simultáneas se evalúan en orden y la segunda ve la exposición de la primera (FR-061)', async () => {
    const p = pipeline({ maxPositions: 1 });
    const queue = new SerialQueue(() => {});
    const outcomes: unknown[] = [];
    void queue.push(async () => void outcomes.push(await p.processMessage(message(KAIA, { sender: AUTH }))));
    void queue.push(async () => void outcomes.push(await p.processMessage(message(KITE, { sender: AUTH, waMessageId: 'wa-2' }))));
    await queue.idle();
    expect(outcomes).toEqual([
      expect.objectContaining({ alert: expect.objectContaining({ symbol: 'KAIAUSDT', status: 'entrada pendiente' }) }),
      expect.objectContaining({ alert: expect.objectContaining({ symbol: 'KITEUSDT', reason: 'límite de posiciones' }) }),
    ]);
  });

  it('sin carga configurada, una válida queda "válida" como en US1', async () => {
    const p = new Pipeline({
      store,
      clock,
      mode: 'DRY',
      authorizedSenders: [AUTH],
      extractor: null,
      market,
      maxSlDistancePct: 15,
      maxEntryDistancePct: 10,
    });
    const r = await p.processMessage(message(KAIA, { sender: AUTH }));
    expect(r).toMatchObject({ alert: { status: 'válida' } });
  });
});
