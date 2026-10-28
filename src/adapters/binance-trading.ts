// Operación en Binance Futuros USDS-M con CCXT (R-06): endpoints crudos firmados, para controlar cada
// parámetro. SL y TP son órdenes condicionales de la API "algo" con closePosition y precio de marca,
// así cubren toda la posición, incluidas ejecuciones posteriores (FR-028). Demo Trading en DRY y
// producción en LIVE los elige quien arma el cliente (FR-051).
import ccxt from 'ccxt';
import type { CloseInfo, Exchange, OrderRef, OrderState, OrderStatus, PositionState, TradeOrders } from '../ports.ts';
import type { Mode, Side } from '../domain/types.ts';

/** Lo que se usa del cliente de CCXT (`binanceusdm`): sus métodos implícitos. */
export type BinanceClient = Record<string, (params?: Record<string, unknown>) => Promise<unknown>>;

type Params = Record<string, unknown>;

interface RawPosition {
  symbol: string;
  positionAmt: string;
  positionSide: 'LONG' | 'SHORT' | 'BOTH';
  marginType?: 'isolated' | 'cross';
  leverage?: string;
}

interface RawTrade {
  orderId: number;
  realizedPnl: string;
  commission: string;
  time: number;
}

const NO_NEED_TO_CHANGE_MARGIN_TYPE = -4046;
const UNKNOWN_ORDER = -2011; // al cancelar algo que ya no está abierto

const STATUS: Record<string, OrderStatus> = {
  NEW: 'open',
  PARTIALLY_FILLED: 'partially_filled',
  FILLED: 'filled',
  CANCELED: 'canceled',
  EXPIRED: 'canceled',
  EXPIRED_IN_MATCH: 'canceled',
  REJECTED: 'rejected',
};

/** Lo que la fábrica usa de la clase de CCXT (inyectable en los tests). */
export interface CcxtLike {
  enableDemoTrading(enable: boolean): void;
}
export type CcxtConstructor = new (opts: { apiKey: string; secret: string; enableRateLimit: boolean }) => CcxtLike;

/** Cliente de trading del modo (FR-051, FR-052): DRY contra Demo Trading con las credenciales de
 *  Demo; LIVE contra producción con las de producción. */
export function createExchange(
  mode: Mode,
  credentials: { apiKey: string; secret: string },
  Ctor: CcxtConstructor = ccxt.binanceusdm as unknown as CcxtConstructor,
): { exchange: BinanceTrading; client: CcxtLike } {
  // Sin el limitador de CCXT: espacia según el peso de cada endpoint y demoraba ~2 s cada alerta
  // en v3; el uso real queda muy por debajo del límite de Binance.
  const client = new Ctor({ apiKey: credentials.apiKey, secret: credentials.secret, enableRateLimit: false });
  if (mode === 'DRY') client.enableDemoTrading(true);
  return { exchange: new BinanceTrading(client as unknown as BinanceClient), client };
}

/** Binance no acepta notación exponencial ("1e-7"): números siempre en decimal. */
export function decimal(n: number): string {
  return n.toFixed(12).replace(/\.?0+$/, '');
}

// CCXT arma el mensaje de un error de red con la URL completa del pedido, firma incluida:
// "binanceusdm POST https://…/fapi/v1/order?…&signature=… fetch failed". Queda método y ruta.
const REQUEST_URL = /^\w+ (GET|POST|PUT|DELETE) [a-z]+:\/\/[^/\s]+(\/[^?\s]*)(?:\?\S*)?\s*/;

/** Saca del mensaje de error de CCXT la URL completa del pedido, que trae la firma. */
export function shortenError(err: unknown): Error {
  const error = err instanceof Error ? err : new Error(String(err));
  error.message = error.message.replace(REQUEST_URL, '$1 $2: ');
  return error;
}

/** Código de Binance dentro del mensaje de CCXT, p. ej. {"code":-4046,...}. */
function binanceCode(err: unknown): number | null {
  const match = /"code":\s*(-?\d+)/.exec(err instanceof Error ? err.message : String(err));
  return match ? Number(match[1]) : null;
}

const openSide = (side: Side) => (side === 'LONG' ? 'BUY' : 'SELL');
const closeSide = (side: Side) => (side === 'LONG' ? 'SELL' : 'BUY');
const sideOf = (p: RawPosition): Side =>
  p.positionSide !== 'BOTH' ? p.positionSide : Number(p.positionAmt) >= 0 ? 'LONG' : 'SHORT';

export class BinanceTrading implements Exchange {
  private hedgeMode: Promise<boolean> | null = null;

  constructor(private readonly client: BinanceClient) {}

  private async call<T>(method: string, params: Params = {}): Promise<T> {
    const fn = this.client[method];
    if (!fn) throw new Error(`CCXT no tiene ${method}`);
    try {
      return (await fn.call(this.client, params)) as T;
    } catch (err) {
      throw shortenError(err);
    }
  }

  /** Modo de posición de la cuenta: en hedge hay que mandar positionSide. Se lee una vez. */
  private isHedge(): Promise<boolean> {
    this.hedgeMode ??= this.call<{ dualSidePosition: boolean }>('fapiPrivateGetPositionSideDual').then(
      (r) => r.dualSidePosition,
      (err: unknown) => {
        this.hedgeMode = null;
        throw err;
      },
    );
    return this.hedgeMode;
  }

  private async positions(symbol?: string): Promise<RawPosition[]> {
    return this.call<RawPosition[]>('fapiPrivateV2GetPositionRisk', symbol ? { symbol } : {});
  }

  walletBalanceUsdt = async (): Promise<number> => {
    const account = await this.call<{ assets: { asset: string; walletBalance: string }[] }>('fapiPrivateV2GetAccount');
    return Number(account.assets.find((a) => a.asset === 'USDT')?.walletBalance ?? 0);
  };

  // Solo cambia lo que no está como hace falta: con órdenes abiertas en el símbolo, Binance
  // rechaza pedir el margen aislado aunque ya lo sea (-4067), en vez de responder -4046.
  prepareSymbol = async (symbol: string, leverage: number): Promise<void> => {
    const sides = await this.positions(symbol);
    if (!sides.length || sides.some((p) => p.marginType !== 'isolated')) {
      try {
        await this.call('fapiPrivatePostMarginType', { symbol, marginType: 'ISOLATED' });
      } catch (err) {
        if (binanceCode(err) !== NO_NEED_TO_CHANGE_MARGIN_TYPE) throw err;
      }
    }
    if (!sides.length || sides.some((p) => Number(p.leverage) !== leverage)) {
      await this.call('fapiPrivatePostLeverage', { symbol, leverage });
    }
  };

  placeLimitEntry: Exchange['placeLimitEntry'] = async ({ symbol, side, quantity, price }) => {
    const order = await this.call<{ orderId: number }>('fapiPrivatePostOrder', {
      symbol,
      side: openSide(side),
      ...((await this.isHedge()) ? { positionSide: side } : {}),
      type: 'LIMIT',
      timeInForce: 'GTC',
      quantity: decimal(quantity),
      price: decimal(price),
      newOrderRespType: 'RESULT',
    });
    return { symbol, id: String(order.orderId) };
  };

  private async placeProtection(symbol: string, side: Side, type: string, trigger: number): Promise<OrderRef> {
    const order = await this.call<{ algoId: number }>('fapiPrivatePostAlgoOrder', {
      algoType: 'CONDITIONAL',
      symbol,
      side: closeSide(side),
      ...((await this.isHedge()) ? { positionSide: side } : {}),
      type,
      triggerPrice: decimal(trigger),
      closePosition: 'true',
      workingType: 'MARK_PRICE',
    });
    return { symbol, id: String(order.algoId), algo: true };
  }

  placeStopLoss = (symbol: string, side: Side, price: number) => this.placeProtection(symbol, side, 'STOP_MARKET', price);
  placeTakeProfit = (symbol: string, side: Side, price: number) =>
    this.placeProtection(symbol, side, 'TAKE_PROFIT_MARKET', price);

  closeAtMarket = async (symbol: string, side: Side): Promise<OrderRef | null> => {
    const hedge = await this.isHedge();
    const position = (await this.positions(symbol)).find((p) => Number(p.positionAmt) !== 0 && sideOf(p) === side);
    if (!position) return null;
    const order = await this.call<{ orderId: number }>('fapiPrivatePostOrder', {
      symbol,
      side: closeSide(side),
      ...(hedge ? { positionSide: side } : {}),
      type: 'MARKET',
      quantity: decimal(Math.abs(Number(position.positionAmt))),
      ...(hedge ? {} : { reduceOnly: 'true' }),
    });
    return { symbol, id: String(order.orderId) };
  };

  cancel = async (ref: OrderRef): Promise<void> => {
    try {
      if (ref.algo) await this.call('fapiPrivateDeleteAlgoOrder', { algoId: ref.id });
      else await this.call('fapiPrivateDeleteOrder', { symbol: ref.symbol, orderId: ref.id });
    } catch (err) {
      // Ya ejecutada, disparada o cancelada: no queda nada que cancelar.
      if (binanceCode(err) !== UNKNOWN_ORDER) throw err;
    }
  };

  order = async (ref: OrderRef): Promise<OrderState> => {
    const o = await this.call<{ status: string; executedQty: string }>('fapiPrivateGetOrder', {
      symbol: ref.symbol,
      orderId: ref.id,
    });
    // Un estado que no conocemos se trata como abierto: el polling lo vuelve a mirar.
    return { ref, status: STATUS[o.status] ?? 'open', filledQty: Number(o.executedQty) };
  };

  openOrders = async (symbol: string): Promise<OrderRef[]> => {
    const [orders, algos] = await Promise.all([
      this.call<{ orderId: number; symbol: string }[]>('fapiPrivateGetOpenOrders', { symbol }),
      this.call<{ algoId: number; symbol: string }[]>('fapiPrivateGetOpenAlgoOrders', { symbol }),
    ]);
    return [
      ...orders.filter((o) => o.symbol === symbol).map((o) => ({ symbol, id: String(o.orderId) })),
      ...algos.filter((o) => o.symbol === symbol).map((o) => ({ symbol, id: String(o.algoId), algo: true })),
    ];
  };

  openPositions = async (): Promise<PositionState[]> =>
    (await this.positions())
      .filter((p) => Number(p.positionAmt) !== 0)
      .map((p) => ({ symbol: p.symbol, side: sideOf(p), quantity: Math.abs(Number(p.positionAmt)) }));

  closeOf = async (_t: TradeOrders): Promise<CloseInfo | null> => {
    throw new Error('no implementado');
  };
}
