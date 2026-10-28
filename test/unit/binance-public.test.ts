import { describe, expect, it } from 'vitest';
import { BinancePublicMarketData, PRODUCTION_URL } from '../../src/adapters/binance-public.ts';
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

function fakeFetch(fail: { value: boolean } = { value: false }) {
  const calls: Call[] = [];
  const fn = async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    calls.push({ url: u, init });
    if (fail.value) return new Response('error', { status: 503 });
    const body = u.includes('exchangeInfo') ? exchangeInfo : u.includes('ticker/24hr') ? tickers : klines;
    return new Response(JSON.stringify(body), { status: 200 });
  };
  return { fn: fn as typeof fetch, calls };
}

describe('datos públicos de Binance (FR-017, AC-30, R-05)', () => {
  it.fails('arma la copia de símbolos con sus filtros como números', async () => {
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

  it.fails('arma el ranking solo con perpetuos en TRADING y lo fecha con el reloj', async () => {
    const clock = new FakeClock('2026-10-28T12:00:00Z');
    const md = new BinancePublicMarketData({ clock, fetch: fakeFetch().fn });
    await md.refresh();
    expect(md.ranking()).toMatchObject({ gainers: ['AUSDT', 'KAIAUSDT', 'BUSDT'], refreshedAt: clock.now() });
    expect(md.ranking()?.gainers).not.toContain('XUSDT');
  });

  it.fails('consulta producción sin credenciales (AC-30)', async () => {
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

  it.fails('pide 1500 velas de 15 min y devuelve los cierres de 45 min', async () => {
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: f.fn });
    expect(await md.closes45m('KAIAUSDT')).toEqual([3, 6]);
    expect(f.calls[0]?.url).toContain('/fapi/v1/klines?symbol=KAIAUSDT&interval=15m&limit=1500');
  });

  it.fails('refresca cada 60 s (AC-30)', async () => {
    const clock = new FakeClock();
    const f = fakeFetch();
    const md = new BinancePublicMarketData({ clock, fetch: f.fn });
    await md.start();
    const first = f.calls.length;
    await clock.advance(60_000);
    expect(f.calls.length).toBe(first * 2);
    md.stop();
  });

  it.fails('si un refresco falla conserva la copia anterior y lo informa', async () => {
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

  it.fails('closes45m rechaza si Binance falla (la validación lo traduce, FR-064)', async () => {
    const md = new BinancePublicMarketData({ clock: new FakeClock(), fetch: fakeFetch({ value: true }).fn });
    await expect(md.closes45m('KAIAUSDT')).rejects.toThrow(/HTTP 503/);
  });
});
