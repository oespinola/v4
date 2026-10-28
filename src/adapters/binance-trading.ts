// Operación en Binance Futuros USDS-M con CCXT (R-06): endpoints crudos firmados, para controlar cada
// parámetro. SL y TP son órdenes condicionales de la API "algo" con closePosition y precio de marca.
// Demo Trading en DRY y producción en LIVE los elige quien arma el cliente (FR-051).
import type { Exchange, OrderRef } from '../ports.ts';

/** Lo que se usa del cliente de CCXT (`binanceusdm`): sus métodos implícitos. */
export type BinanceClient = Record<string, (params?: Record<string, unknown>) => Promise<unknown>>;

/** Binance no acepta notación exponencial ("1e-7"): números siempre en decimal. */
export function decimal(_n: number): string {
  throw new Error('no implementado');
}

/** Saca del mensaje de error de CCXT la URL completa del pedido, que trae la firma. */
export function shortenError(_err: unknown): Error {
  throw new Error('no implementado');
}

const notImplemented = () => {
  throw new Error('no implementado');
};

export class BinanceTrading implements Exchange {
  constructor(private readonly client: BinanceClient) {}

  walletBalanceUsdt: Exchange['walletBalanceUsdt'] = async () => notImplemented();
  prepareSymbol: Exchange['prepareSymbol'] = async () => notImplemented();
  placeLimitEntry: Exchange['placeLimitEntry'] = async () => notImplemented();
  placeStopLoss: Exchange['placeStopLoss'] = async () => notImplemented();
  placeTakeProfit: Exchange['placeTakeProfit'] = async () => notImplemented();
  closeAtMarket: Exchange['closeAtMarket'] = async () => notImplemented();
  cancel: Exchange['cancel'] = async (_ref: OrderRef) => notImplemented();
  order: Exchange['order'] = async () => notImplemented();
  openOrders: Exchange['openOrders'] = async () => notImplemented();
  openPositions: Exchange['openPositions'] = async () => notImplemented();
  closingFills: Exchange['closingFills'] = async () => notImplemented();
}
