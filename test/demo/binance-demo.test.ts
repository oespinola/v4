// Test contra Binance Demo Trading (riesgo de R-06), obligatorio antes de LIVE: comprueba que la
// versión fijada de CCXT coloca en Demo una entrada LIMIT y un SL y un TP condicionales con
// closePosition, y que se cancelan. Corre solo con BINANCE_DEMO_TESTS=1 y las credenciales
// BINANCE_DEMO_* del .env; no deja órdenes abiertas. Resultado anotado en checklists/live.md.
import ccxt from 'ccxt';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { BinancePublicMarketData, DEMO_URL } from '../../src/adapters/binance-public.ts';
import { BinanceTrading, type BinanceClient } from '../../src/adapters/binance-trading.ts';
import { SystemClock } from '../../src/adapters/clock.ts';
import { loadDotEnv } from '../../src/config.ts';
import { roundToStep } from '../../src/domain/symbols.ts';
import type { OrderRef } from '../../src/ports.ts';

const SYMBOL = 'DOGEUSDT';

describe('Binance Demo Trading (R-06)', () => {
  let ex: BinanceTrading;
  let market: BinancePublicMarketData;
  let price: number;
  const placed: OrderRef[] = [];

  beforeAll(async () => {
    loadDotEnv();
    const apiKey = process.env.BINANCE_DEMO_API_KEY;
    const secret = process.env.BINANCE_DEMO_API_SECRET;
    if (!apiKey || !secret) throw new Error('faltan BINANCE_DEMO_API_KEY y BINANCE_DEMO_API_SECRET');
    const client = new ccxt.binanceusdm({ apiKey, secret, enableRateLimit: false });
    client.enableDemoTrading(true);
    ex = new BinanceTrading(client as unknown as BinanceClient);
    market = new BinancePublicMarketData({ clock: new SystemClock(), orderRulesUrl: DEMO_URL });
    await market.refresh();
    const res = await fetch(`${DEMO_URL}/fapi/v1/ticker/price?symbol=${SYMBOL}`);
    price = Number(((await res.json()) as { price: string }).price);
  }, 30_000);

  afterAll(async () => {
    for (const ref of placed) await ex.cancel(ref).catch(() => {});
  });

  it('lee el balance de la billetera USDT', async () => {
    expect(await ex.walletBalanceUsdt()).toBeGreaterThanOrEqual(0);
  });

  it('coloca y cancela una entrada lejos del precio y un SL/TP con closePosition', async () => {
    const f = market.symbol(SYMBOL)!;
    expect(market.availableForOrders(SYMBOL)).toBe(true);
    await ex.prepareSymbol(SYMBOL, 2);

    // LONG a la mitad del precio: no se ejecuta. Cantidad para cubrir el nocional mínimo.
    const entry = roundToStep(price * 0.5, f.tickSize, 'nearest');
    const quantity = roundToStep(Math.max(f.minQty, (f.minNotional * 1.5) / entry), f.stepSize, 'up');
    const entryRef = await ex.placeLimitEntry({ symbol: SYMBOL, side: 'LONG', quantity, price: entry });
    placed.push(entryRef);
    expect(await ex.order(entryRef)).toMatchObject({ status: 'open', filledQty: 0 });

    const sl = await ex.placeStopLoss(SYMBOL, 'LONG', roundToStep(price * 0.3, f.tickSize, 'nearest'));
    placed.push(sl);
    const tp = await ex.placeTakeProfit(SYMBOL, 'LONG', roundToStep(price * 2, f.tickSize, 'nearest'));
    placed.push(tp);
    expect(sl.algo && tp.algo).toBe(true);

    const open = (await ex.openOrders(SYMBOL)).map((r) => r.id);
    expect(open).toEqual(expect.arrayContaining([entryRef.id, sl.id, tp.id]));

    for (const ref of [tp, sl, entryRef]) await ex.cancel(ref);
    const after = (await ex.openOrders(SYMBOL)).map((r) => r.id);
    expect(after).not.toContain(entryRef.id);
    expect(after).not.toContain(sl.id);
    expect(after).not.toContain(tp.id);
    expect((await ex.order(entryRef)).status).toBe('canceled');
  }, 60_000);
});
