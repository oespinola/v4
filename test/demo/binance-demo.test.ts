// Test contra Binance Demo Trading (riesgo de R-06), obligatorio antes de LIVE: comprueba que la
// versión fijada de CCXT coloca en Demo una entrada LIMIT, y un SL y un TP condicionales con
// closePosition sobre una posición mínima, que se cancelan, y que el cierre a mercado la cierra.
// Binance rechaza un SL/TP con closePosition sin posición abierta (-4509), por eso se abre una a
// mercado. Corre solo con BINANCE_DEMO_TESTS=1 y las credenciales BINANCE_DEMO_* del .env; no deja
// órdenes ni posición abiertas. Resultado anotado en checklists/live.md.
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
  let client: BinanceClient;
  let price: number;
  const placed: OrderRef[] = [];

  beforeAll(async () => {
    loadDotEnv();
    const apiKey = process.env.BINANCE_DEMO_API_KEY;
    const secret = process.env.BINANCE_DEMO_API_SECRET;
    if (!apiKey || !secret) throw new Error('faltan BINANCE_DEMO_API_KEY y BINANCE_DEMO_API_SECRET');
    const ccxtClient = new ccxt.binanceusdm({ apiKey, secret, enableRateLimit: false });
    ccxtClient.enableDemoTrading(true);
    client = ccxtClient as unknown as BinanceClient;
    ex = new BinanceTrading(client);
    market = new BinancePublicMarketData({ clock: new SystemClock(), orderRulesUrl: DEMO_URL });
    await market.refresh();
    const res = await fetch(`${DEMO_URL}/fapi/v1/ticker/price?symbol=${SYMBOL}`);
    price = Number(((await res.json()) as { price: string }).price);
  }, 30_000);

  afterAll(async () => {
    for (const ref of placed) await ex.cancel(ref).catch(() => {});
    await ex.closeAtMarket(SYMBOL, 'LONG').catch(() => {});
  });

  it('lee el balance de la billetera USDT', async () => {
    expect(await ex.walletBalanceUsdt()).toBeGreaterThanOrEqual(0);
  });

  it('coloca, consulta y cancela una entrada LIMIT lejos del precio (FR-027, FR-060)', async () => {
    const f = market.symbol(SYMBOL)!;
    expect(market.availableForOrders(SYMBOL)).toBe(true);
    await ex.prepareSymbol(SYMBOL, 2);

    // LONG a la mitad del precio: no se ejecuta. Cantidad para cubrir el nocional mínimo.
    const entry = roundToStep(price * 0.5, f.tickSize, 'nearest');
    const quantity = roundToStep(Math.max(f.minQty, (f.minNotional * 1.5) / entry), f.stepSize, 'up');
    const entryRef = await ex.placeLimitEntry({ symbol: SYMBOL, side: 'LONG', quantity, price: entry });
    placed.push(entryRef);
    expect(await ex.order(entryRef)).toMatchObject({ status: 'open', filledQty: 0 });
    expect((await ex.openOrders(SYMBOL)).map((r) => r.id)).toContain(entryRef.id);

    await ex.cancel(entryRef);
    expect((await ex.order(entryRef)).status).toBe('canceled');
    expect((await ex.openOrders(SYMBOL)).map((r) => r.id)).not.toContain(entryRef.id);
  }, 60_000);

  it('sobre una posición mínima acepta SL y TP con closePosition, los cancela y cierra a mercado (FR-028, FR-030)', async () => {
    const f = market.symbol(SYMBOL)!;
    const quantity = roundToStep(Math.max(f.minQty, (f.minNotional * 1.2) / price), f.stepSize, 'up');
    const { dualSidePosition } = (await client.fapiPrivateGetPositionSideDual!()) as { dualSidePosition: boolean };
    await client.fapiPrivatePostOrder!({
      symbol: SYMBOL,
      side: 'BUY',
      ...(dualSidePosition ? { positionSide: 'LONG' } : {}),
      type: 'MARKET',
      quantity: String(quantity),
    });
    const position = (await ex.openPositions()).find((p) => p.symbol === SYMBOL);
    expect(position).toMatchObject({ side: 'LONG', quantity });

    const sl = await ex.placeStopLoss(SYMBOL, 'LONG', roundToStep(price * 0.5, f.tickSize, 'nearest'));
    placed.push(sl);
    const tp = await ex.placeTakeProfit(SYMBOL, 'LONG', roundToStep(price * 2, f.tickSize, 'nearest'));
    placed.push(tp);
    expect(sl.algo && tp.algo).toBe(true);
    expect((await ex.openOrders(SYMBOL)).map((r) => r.id)).toEqual(expect.arrayContaining([sl.id, tp.id]));

    await ex.cancel(sl);
    await ex.cancel(tp);
    const after = (await ex.openOrders(SYMBOL)).map((r) => r.id);
    expect(after).not.toContain(sl.id);
    expect(after).not.toContain(tp.id);

    expect(await ex.closeAtMarket(SYMBOL, 'LONG')).toMatchObject({ symbol: SYMBOL });
    expect((await ex.openPositions()).find((p) => p.symbol === SYMBOL)).toBeUndefined();
    expect(await ex.closeAtMarket(SYMBOL, 'LONG')).toBeNull();
  }, 60_000);
});
