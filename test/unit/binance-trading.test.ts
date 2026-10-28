import { describe, expect, it } from 'vitest';
import { BinanceTrading, decimal, shortenError, type BinanceClient } from '../../src/adapters/binance-trading.ts';

type Params = Record<string, unknown> | undefined;

/** Cliente de CCXT falso: responde por método y registra cada llamada. */
function fakeClient(responses: Record<string, (p: Params) => unknown>) {
  const calls: { method: string; params: Params }[] = [];
  const client = new Proxy({} as BinanceClient, {
    get: (_t, method: string) => async (params?: Record<string, unknown>) => {
      calls.push({ method, params });
      const r = responses[method];
      if (!r) throw new Error(`fakeClient: ${method} no programado`);
      return r(params);
    },
  });
  return { client, calls, of: (m: string) => calls.filter((c) => c.method === m).map((c) => c.params) };
}

const binanceError = (code: number) => () => {
  throw new Error(`binanceusdm {"code":${code},"msg":"x"}`);
};
const oneWay = { fapiPrivateGetPositionSideDual: () => ({ dualSidePosition: false }) };
const hedge = { fapiPrivateGetPositionSideDual: () => ({ dualSidePosition: true }) };

describe('adaptador de trading de Binance (R-06, FR-024, FR-027 a FR-030, FR-060)', () => {
  it('números siempre en notación decimal', () => {
    expect(decimal(0.0000001)).toBe('0.0000001');
    expect(decimal(4166)).toBe('4166');
    expect(decimal(0.0402)).toBe('0.0402');
  });

  it('los errores no muestran la URL con la firma', () => {
    const e = shortenError(new Error('binanceusdm POST https://demo-fapi.binance.com/fapi/v1/order?symbol=X&timestamp=1&signature=abc fetch failed'));
    expect(e.message).not.toMatch(/signature|demo-fapi/);
    expect(e.message).toContain('POST /fapi/v1/order');
  });

  it('balance total de la billetera USDT, sin PnL no realizado (FR-024)', async () => {
    const f = fakeClient({
      fapiPrivateV2GetAccount: () => ({
        assets: [
          { asset: 'USDC', walletBalance: '50' },
          { asset: 'USDT', walletBalance: '3000.5', unrealizedProfit: '-20', availableBalance: '2800' },
        ],
      }),
    });
    expect(await new BinanceTrading(f.client).walletBalanceUsdt()).toBe(3000.5);
  });

  it('prepara margen aislado y apalancamiento solo si hace falta (FR-060)', async () => {
    const f = fakeClient({
      fapiPrivateV2GetPositionRisk: () => [{ symbol: 'KAIAUSDT', marginType: 'cross', leverage: '5', positionAmt: '0', positionSide: 'BOTH' }],
      fapiPrivatePostMarginType: () => ({}),
      fapiPrivatePostLeverage: () => ({}),
    });
    await new BinanceTrading(f.client).prepareSymbol('KAIAUSDT', 2);
    expect(f.of('fapiPrivatePostMarginType')).toEqual([{ symbol: 'KAIAUSDT', marginType: 'ISOLATED' }]);
    expect(f.of('fapiPrivatePostLeverage')).toEqual([{ symbol: 'KAIAUSDT', leverage: 2 }]);

    const ready = fakeClient({
      fapiPrivateV2GetPositionRisk: () => [{ symbol: 'KAIAUSDT', marginType: 'isolated', leverage: '2', positionAmt: '0', positionSide: 'BOTH' }],
    });
    await new BinanceTrading(ready.client).prepareSymbol('KAIAUSDT', 2);
    expect(ready.calls.map((c) => c.method)).toEqual(['fapiPrivateV2GetPositionRisk']);
  });

  it('"ya es aislado" (-4046) no es un error', async () => {
    const f = fakeClient({
      fapiPrivateV2GetPositionRisk: () => [],
      fapiPrivatePostMarginType: binanceError(-4046),
      fapiPrivatePostLeverage: () => ({}),
    });
    await expect(new BinanceTrading(f.client).prepareSymbol('KAIAUSDT', 2)).resolves.toBeUndefined();
  });

  it('entrada LIMIT GTC al precio, en one-way sin positionSide (FR-027)', async () => {
    const f = fakeClient({ ...oneWay, fapiPrivatePostOrder: () => ({ orderId: 111 }) });
    const ex = new BinanceTrading(f.client);
    const ref = await ex.placeLimitEntry({ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166, price: 0.0402, clientOrderId: 'sb-1' });
    expect(ref).toEqual({ symbol: 'KAIAUSDT', id: '111' });
    expect(f.of('fapiPrivatePostOrder')).toMatchObject([
      { symbol: 'KAIAUSDT', side: 'SELL', type: 'LIMIT', timeInForce: 'GTC', quantity: '4166', price: '0.0402', newOrderRespType: 'RESULT' },
    ]);
    await ex.placeLimitEntry({ symbol: 'KAIAUSDT', side: 'LONG', quantity: 1, price: 1, clientOrderId: 'sb-2' });
    expect(f.of('fapiPrivateGetPositionSideDual')).toHaveLength(1); // el modo se lee una vez
    expect(f.of('fapiPrivatePostOrder')[1]).toMatchObject({ side: 'BUY' });
  });

  it('en una cuenta hedge manda positionSide', async () => {
    const f = fakeClient({ ...hedge, fapiPrivatePostOrder: () => ({ orderId: 111 }) });
    await new BinanceTrading(f.client).placeLimitEntry({ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 1, price: 1, clientOrderId: 'sb-1' });
    expect(f.of('fapiPrivatePostOrder')[0]).toMatchObject({ side: 'SELL', positionSide: 'SHORT' });
  });

  it.fails('la entrada lleva su identificador propio como newClientOrderId (FR-069)', async () => {
    const f = fakeClient({ ...oneWay, fapiPrivatePostOrder: () => ({ orderId: 111 }) });
    await new BinanceTrading(f.client).placeLimitEntry({ symbol: 'KAIAUSDT', side: 'SHORT', quantity: 1, price: 1, clientOrderId: 'sb-abc' });
    expect(f.of('fapiPrivatePostOrder')[0]).toMatchObject({ newClientOrderId: 'sb-abc' });
  });

  it.fails('busca la entrada por su identificador propio: la orden, o null si Binance no la tiene (FR-069)', async () => {
    const found = fakeClient({ fapiPrivateGetOrder: () => ({ orderId: 222 }) });
    expect(await new BinanceTrading(found.client).findEntry('KAIAUSDT', 'sb-abc')).toEqual({ symbol: 'KAIAUSDT', id: '222' });
    expect(found.of('fapiPrivateGetOrder')).toEqual([{ symbol: 'KAIAUSDT', origClientOrderId: 'sb-abc' }]);

    const missing = fakeClient({ fapiPrivateGetOrder: binanceError(-2013) });
    expect(await new BinanceTrading(missing.client).findEntry('KAIAUSDT', 'sb-abc')).toBeNull();

    const down = fakeClient({ fapiPrivateGetOrder: binanceError(-1007) }); // timeout de Binance
    await expect(new BinanceTrading(down.client).findEntry('KAIAUSDT', 'sb-abc')).rejects.toThrow();
  });

  it('SL STOP_MARKET y TP TAKE_PROFIT_MARKET condicionales con closePosition y precio de marca (R-06)', async () => {
    let next = 900;
    const f = fakeClient({ ...oneWay, fapiPrivatePostAlgoOrder: () => ({ algoId: next++ }) });
    const ex = new BinanceTrading(f.client);
    expect(await ex.placeStopLoss('1000PEPEUSDT', 'LONG', 0.0000001)).toEqual({ symbol: '1000PEPEUSDT', id: '900', algo: true });
    expect(await ex.placeTakeProfit('1000PEPEUSDT', 'LONG', 2.6)).toEqual({ symbol: '1000PEPEUSDT', id: '901', algo: true });
    expect(f.of('fapiPrivatePostAlgoOrder')).toEqual([
      { algoType: 'CONDITIONAL', symbol: '1000PEPEUSDT', side: 'SELL', type: 'STOP_MARKET', triggerPrice: '0.0000001', closePosition: 'true', workingType: 'MARK_PRICE' },
      { algoType: 'CONDITIONAL', symbol: '1000PEPEUSDT', side: 'SELL', type: 'TAKE_PROFIT_MARKET', triggerPrice: '2.6', closePosition: 'true', workingType: 'MARK_PRICE' },
    ]);
  });

  it('cierre a mercado de toda la posición: reduceOnly en one-way, positionSide en hedge (FR-030)', async () => {
    const f = fakeClient({
      ...oneWay,
      fapiPrivateV2GetPositionRisk: () => [{ symbol: 'KAIAUSDT', positionAmt: '-4166', positionSide: 'BOTH' }],
      fapiPrivatePostOrder: () => ({ orderId: 222 }),
    });
    expect(await new BinanceTrading(f.client).closeAtMarket('KAIAUSDT', 'SHORT')).toEqual({ symbol: 'KAIAUSDT', id: '222' });
    expect(f.of('fapiPrivatePostOrder')).toEqual([{ symbol: 'KAIAUSDT', side: 'BUY', type: 'MARKET', quantity: '4166', reduceOnly: 'true' }]);

    const h = fakeClient({
      ...hedge,
      fapiPrivateV2GetPositionRisk: () => [
        { symbol: 'KAIAUSDT', positionAmt: '10', positionSide: 'LONG' },
        { symbol: 'KAIAUSDT', positionAmt: '-4166', positionSide: 'SHORT' },
      ],
      fapiPrivatePostOrder: () => ({ orderId: 223 }),
    });
    await new BinanceTrading(h.client).closeAtMarket('KAIAUSDT', 'SHORT');
    expect(h.of('fapiPrivatePostOrder')).toEqual([{ symbol: 'KAIAUSDT', side: 'BUY', positionSide: 'SHORT', type: 'MARKET', quantity: '4166' }]);
  });

  it('sin posición, el cierre a mercado no manda órdenes y devuelve null', async () => {
    const f = fakeClient({ ...oneWay, fapiPrivateV2GetPositionRisk: () => [{ symbol: 'KAIAUSDT', positionAmt: '0', positionSide: 'BOTH' }] });
    expect(await new BinanceTrading(f.client).closeAtMarket('KAIAUSDT', 'SHORT')).toBeNull();
    expect(f.of('fapiPrivatePostOrder')).toHaveLength(0);
  });

  it('cancela por el endpoint que corresponde e ignora lo que ya no está abierto (-2011)', async () => {
    const f = fakeClient({ fapiPrivateDeleteOrder: () => ({}), fapiPrivateDeleteAlgoOrder: binanceError(-2011) });
    const ex = new BinanceTrading(f.client);
    await ex.cancel({ symbol: 'KAIAUSDT', id: '111' });
    await ex.cancel({ symbol: 'KAIAUSDT', id: '900', algo: true });
    expect(f.of('fapiPrivateDeleteOrder')).toEqual([{ symbol: 'KAIAUSDT', orderId: '111' }]);
    expect(f.of('fapiPrivateDeleteAlgoOrder')).toEqual([{ algoId: '900' }]);
    const g = fakeClient({ fapiPrivateDeleteOrder: binanceError(-1021) });
    await expect(new BinanceTrading(g.client).cancel({ symbol: 'KAIAUSDT', id: '111' })).rejects.toThrow(/-1021/);
  });

  it('estado de la entrada con la cantidad ejecutada', async () => {
    const status = { value: 'PARTIALLY_FILLED' };
    const f = fakeClient({ fapiPrivateGetOrder: () => ({ orderId: 111, status: status.value, executedQty: '1000' }) });
    const ex = new BinanceTrading(f.client);
    const ref = { symbol: 'KAIAUSDT', id: '111' };
    expect(await ex.order(ref)).toEqual({ ref, status: 'partially_filled', filledQty: 1000 });
    const expected = { NEW: 'open', FILLED: 'filled', CANCELED: 'canceled', EXPIRED: 'canceled', REJECTED: 'rejected' };
    for (const [raw, mapped] of Object.entries(expected)) {
      status.value = raw;
      expect((await ex.order(ref)).status).toBe(mapped);
    }
    expect(f.of('fapiPrivateGetOrder')[0]).toEqual({ symbol: 'KAIAUSDT', orderId: '111' });
  });

  it('órdenes abiertas del símbolo, normales y condicionales', async () => {
    const f = fakeClient({
      fapiPrivateGetOpenOrders: () => [{ orderId: 111, symbol: 'KAIAUSDT' }],
      fapiPrivateGetOpenAlgoOrders: () => [
        { algoId: 900, symbol: 'KAIAUSDT' },
        { algoId: 950, symbol: 'OTROUSDT' },
      ],
    });
    expect(await new BinanceTrading(f.client).openOrders('KAIAUSDT')).toEqual([
      { symbol: 'KAIAUSDT', id: '111' },
      { symbol: 'KAIAUSDT', id: '900', algo: true },
    ]);
  });

  it('posiciones abiertas con su lado', async () => {
    const f = fakeClient({
      fapiPrivateV2GetPositionRisk: () => [
        { symbol: 'KAIAUSDT', positionAmt: '-4166', positionSide: 'BOTH' },
        { symbol: 'BTCUSDT', positionAmt: '0.01', positionSide: 'BOTH' },
        { symbol: 'ETHUSDT', positionAmt: '0', positionSide: 'BOTH' },
      ],
    });
    expect(await new BinanceTrading(f.client).openPositions()).toEqual([
      { symbol: 'KAIAUSDT', side: 'SHORT', quantity: 4166 },
      { symbol: 'BTCUSDT', side: 'LONG', quantity: 0.01 },
    ]);
  });

  it('el cierre de una operación sale de las ejecuciones, del SL/TP disparado y de la orden de cierre (FR-033, FR-036)', async () => {
    const t0 = Date.parse('2026-10-28T12:00:00Z');
    const trade = (orderId: number, side: string, qty: string, pnl: string, fee: string, dt: number) => ({
      id: orderId * 10 + dt,
      orderId,
      side,
      positionSide: 'BOTH',
      qty,
      realizedPnl: pnl,
      commission: fee,
      commissionAsset: 'USDT',
      time: t0 + dt,
    });
    const f = fakeClient({
      fapiPrivateGetUserTrades: () => [
        trade(111, 'SELL', '4166', '0', '0.03', 1000),
        trade(777, 'BUY', '4166', '9.16', '0.03', 60_000),
      ],
      fapiPrivateGetAlgoOrder: (p) => (p?.algoId === '901' ? { algoStatus: 'FINISHED', actualOrderId: '777' } : { algoStatus: 'CANCELED', actualOrderId: '' }),
      fapiPrivateGetOrder: () => ({ orderId: 777, type: 'MARKET', clientOrderId: 'x' }),
    });
    const since = new Date(t0);
    const close = await new BinanceTrading(f.client).closeOf({
      symbol: 'KAIAUSDT',
      side: 'SHORT',
      entryOrderId: '111',
      sl: { symbol: 'KAIAUSDT', id: '900', algo: true },
      tp: { symbol: 'KAIAUSDT', id: '901', algo: true },
      since,
    });
    expect(close).toEqual({ cause: 'TP', at: new Date(t0 + 60_000), realizedPnl: 9.16, fees: 0.06 });
    expect(f.of('fapiPrivateGetUserTrades')[0]).toEqual({ symbol: 'KAIAUSDT', startTime: since.getTime(), limit: 1000 });
    expect(f.of('fapiPrivateGetOrder')).toEqual([{ symbol: 'KAIAUSDT', orderId: '777' }]);
  });

  it('si las ejecuciones no cierran la posición, closeOf devuelve null sin más consultas', async () => {
    const f = fakeClient({
      fapiPrivateGetUserTrades: () => [
        { id: 1, orderId: 111, side: 'SELL', positionSide: 'BOTH', qty: '4166', realizedPnl: '0', commission: '0', commissionAsset: 'USDT', time: 1 },
      ],
    });
    const r = await new BinanceTrading(f.client).closeOf({ symbol: 'KAIAUSDT', side: 'SHORT', entryOrderId: '111', sl: null, tp: null, since: new Date(0) });
    expect(r).toBeNull();
    expect(f.calls.map((c) => c.method)).toEqual(['fapiPrivateGetUserTrades']);
  });
});
