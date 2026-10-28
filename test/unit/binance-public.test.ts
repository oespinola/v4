import { describe, expect, it } from 'vitest';
import { BinancePublicMarketData, DEMO_URL, PRODUCTION_URL } from '../../src/adapters/binance-public.ts';
import { validateAlert } from '../../src/domain/validate.ts';
import { FakeClock } from '../fakes/index.ts';

const exchangeInfo = {
  symbols: [
    {
      symbol: 'KAIAUSDT',
      status: 'TRADING',
      contractType: 'PERPETUAL',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.00010' },
        { filterType: 'LOT_SIZE', stepSize: '1', minQty: '1' },
        { filterType: 'MIN_NOTIONAL', notional: '5' },
      ],
    },
    { symbol: 'AUSDT', status: 'TRADING', contractType: 'PERPETUAL', filters: [] },
    { symbol: 'BUSDT', status: 'TRADING', contractType: 'PERPETUAL', filters: [] },
    { symbol: 'XUSDT', status: 'SETTLING', contractType: 'PERPETUAL', filters: [] },
  ],
};
// Demo: KAIA con otros filtros, BERA con tick más grueso, A no operable y B ausente.
const demoInfo = {
  symbols: [
    {
      symbol: 'KAIAUSDT',
      status: 'TRADING',
      contractType: 'PERPETUAL',
      filters: [
        { filterType: 'PRICE_FILTER', tickSize: '0.001' },
        { filterType: 'LOT_SIZE', stepSize: '10', minQty: '10' },
        { filterType: 'MIN_NOTIONAL', notional: '100' },
      ],
    },
    { symbol: 'BERAUSDT', status: 'TRADING', contractType: 'PERPETUAL', filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.001' }] },
    { symbol: 'AUSDT', status: 'SETTLING', contractType: 'PERPETUAL', filters: [] },
  ],
};
exchangeInfo.symbols.push({
  symbol: 'BERAUSDT',
  status: 'TRADING',
  contractType: 'PERPETUAL',
  filters: [{ filterType: 'PRICE_FILTER', tickSize: '0.0001' }],
});
const tickers = [
  { symbol: 'KAIAUSDT', priceChangePercent: '1.5' },
  { symbol: 'AUSDT', priceChangePercent: '10' },
  { symbol: 'BUSDT', priceChangePercent: '-10' },
  { symbol: 'XUSDT', priceChangePercent: '99' },
];
const M15 = 15 * 60_000;
const klines = Array.from({ length: 6 }, (_, i) => [Date.parse('2026-10-28T00:00:00Z') + i * M15, '0', '0', '0', String(i + 1)]);

interface Call {
  url: string;
  init?: RequestInit;
}

function fakeFetch(
  fail: { value: boolean } = { value: false },
  failDemo: { value: boolean } = { value: false },
  klinesBody: unknown[] = klines,
) {
  const calls: Call[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (fail.value) return new Response('error', { status: 503 });
    if (u.startsWith(DEMO_URL)) {
      if (failDemo.value) return new Response('error', { status: 503 });
      if (u.includes('exchangeInfo')) return new Response(JSON.stringify(demoInfo), { status: 200 });
      return new Response('no', { status: 404 });
    }
    const body = u.includes('exchangeInfo') ? exchangeInfo : u.includes('ticker/24hr') ? tickers : klinesBody;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fn: fn as typeof fetch, calls };
}

describe('datos públicos de Binance (FR-017, AC-30, R-05)', () => {
  it('arma la copia de símbolos con sus filtros como números', async () => {
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: f.fn });
    await md.refresh();
    expect(md.symbol('KAIAUSDT')).toEqual({
      symbol: 'KAIAUSDT',
      status: 'TRADING',
      contractType: 'PERPETUAL',
      tickSize: 0.0001,
      stepSize: 1,
      minQty: 1,
      minNotional: 5,
    });
    expect(md.symbol('NADAUSDT')).toBeUndefined();
  });

  it('arma el ranking solo con perpetuos en TRADING y lo fecha con el reloj', async () => {
    const clock = new FakeClock('2026-10-28T12:00:00Z');
    const md = new BinancePublicMarketData({ clock, fetch: fakeFetch().fn });
    await md.refresh();
    expect(md.ranking()).toMatchObject({ gainers: ['AUSDT', 'KAIAUSDT', 'BUSDT'], refreshedAt: clock.now() });
    expect(md.ranking()?.gainers).not.toContain('XUSDT');
  });

  it('consulta producción sin credenciales (AC-30)', async () => {
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: f.fn });
    await md.refresh();
    await md.closes45m('KAIAUSDT');
    expect(f.calls.length).toBeGreaterThan(0);
    for (const c of f.calls) {
      expect(c.url.startsWith(PRODUCTION_URL)).toBe(true);
      const headers = new Headers(c.init?.headers);
      expect(headers.has('X-MBX-APIKEY')).toBe(false);
      expect(c.url).not.toMatch(/signature=|apiKey/i);
    }
  });

  it('pide 1500 velas de 15 min y devuelve los cierres de 45 min', async () => {
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: f.fn });
    expect(await md.closes45m('KAIAUSDT')).toEqual([3, 6]);
    expect(f.calls[0]?.url).toContain('/fapi/v1/klines?symbol=KAIAUSDT&interval=15m&limit=1500');
  });

  it('refresca cada 60 s (AC-30)', async () => {
    const clock = new FakeClock();
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock, fetch: f.fn });
    await md.start();
    const first = f.calls.length;
    await clock.advance(60_000);
    expect(f.calls.length).toBe(first * 2);
    md.stop();
  });

  it('si un refresco falla conserva la copia anterior y lo informa', async () => {
    const clock = new FakeClock('2026-10-28T12:00:00Z');
    const fail = { value: false };
    const errors: unknown[] = [];
    const md = new BinancePublicMarketData({ clock, fetch: fakeFetch(fail).fn, onRefreshError: (e) => errors.push(e) });
    await md.refresh();
    fail.value = true;
    await clock.advance(60_000);
    await md.refresh();
    expect(md.symbol('KAIAUSDT')).toBeDefined();
    expect(md.ranking()?.refreshedAt).toEqual(new Date('2026-10-28T12:00:00Z'));
    expect(errors).toHaveLength(1);
  });

  it('en DRY toma de Demo los filtros de órdenes y marca lo que Demo no opera (FR-066, FR-067)', async () => {
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: f.fn, orderRulesUrl: DEMO_URL });
    await md.refresh();
    expect(md.symbol('KAIAUSDT')).toMatchObject({ tickSize: 0.001, stepSize: 10, minQty: 10, minNotional: 100, status: 'TRADING' });
    expect(md.availableForOrders('KAIAUSDT')).toBe(true);
    expect(md.availableForOrders('AUSDT')).toBe(false); // no TRADING en Demo
    expect(md.availableForOrders('BUSDT')).toBe(false); // no está en Demo
    expect(md.symbol('BUSDT')).toMatchObject({ status: 'TRADING' }); // existe en producción
    // El ranking sigue saliendo de producción.
    expect(md.ranking()?.gainers).toEqual(['AUSDT', 'KAIAUSDT', 'BUSDT']);
    expect(f.calls.filter((c) => c.url.startsWith(DEMO_URL)).map((c) => c.url)).toEqual([`${DEMO_URL}/fapi/v1/exchangeInfo`]);
  });

  it('en DRY la validación ajusta los precios al tick de Demo (AC-79)', async () => {
    const clock = new FakeClock();
    // Velas con el precio de BERA cerca de la Entrada (FR-068).
    const beraKlines = klines.map(([t, o, h, l]) => [t, o, h, l, '0.2299']);
    const md = new BinancePublicMarketData({ clock, fetch: fakeFetch(undefined, undefined, beraKlines).fn, orderRulesUrl: DEMO_URL });
    await md.refresh();
    const text = '*BERA - ALERTA DE TRADING*\nEntrada: 0.2299 usd\nObj.: 0.2246 usd\nSL: 0.2337 usd\nRiesgo Alto 🔴';
    const r = await validateAlert(
      { waMessageId: 'wa-1', sender: 'a', text, downloadImage: async () => null },
      {
        authorizedSenders: ['a'],
        isKnownMessage: () => false,
        hasRecentHash: () => false,
        extractor: null,
        market: md,
        now: () => clock.now(),
        maxSlDistancePct: 15,
        maxEntryDistancePct: 10,
      },
    );
    expect(r).toMatchObject({ ok: true, alert: { symbol: 'BERAUSDT', side: 'SHORT', entry: 0.23, sl: 0.234, tp: 0.225 } });
  });

  it('en LIVE usa los filtros de producción, todo es operable y no consulta Demo (AC-81)', async () => {
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: f.fn });
    await md.refresh();
    expect(md.symbol('KAIAUSDT')?.tickSize).toBe(0.0001);
    expect(md.availableForOrders('BUSDT')).toBe(true);
    expect(f.calls.some((c) => c.url.startsWith(DEMO_URL))).toBe(false);
  });

  it('si falla el refresco de Demo conserva la copia anterior y lo informa', async () => {
    const failDemo = { value: false };
    const errors: unknown[] = [];
    const md = new BinancePublicMarketData({
      clock: new FakeClock(),
      fetch: fakeFetch({ value: false }, failDemo).fn,
      orderRulesUrl: DEMO_URL,
      onRefreshError: (e) => errors.push(e),
    });
    await md.refresh();
    failDemo.value = true;
    await md.refresh();
    expect(md.symbol('KAIAUSDT')?.tickSize).toBe(0.001);
    expect(md.availableForOrders('KAIAUSDT')).toBe(true);
    expect(errors).toHaveLength(1);
  });

  it('en DRY, sin ninguna copia de Demo, nada es operable', async () => {
    const md = new BinancePublicMarketData({
      clock: new FakeClock(),
      fetch: fakeFetch({ value: false }, { value: true }).fn,
      orderRulesUrl: DEMO_URL,
    });
    await md.refresh();
    expect(md.symbol('KAIAUSDT')).toBeDefined();
    expect(md.availableForOrders('KAIAUSDT')).toBe(false);
  });

  it('closes45m rechaza si Binance falla (la validación lo traduce, FR-064)', async () => {
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: fakeFetch({ value: true }).fn });
    await expect(md.closes45m('KAIAUSDT')).rejects.toThrow(/HTTP 503/);
  });
});
