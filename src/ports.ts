// Puertos entre el dominio y los adaptadores (contracts/ports.md). El dominio solo conoce estas
// interfaces; cada una tiene un adaptador real en src/adapters y un fake en test/fakes
// (Principio I y IV).
import type { Field, RawFields, Side, SymbolFilters } from './domain/types.ts';

// ── IA ────────────────────────────────────────────────────────────────────────

export interface ExtractInput {
  text: string;
  image: Buffer | null;
  missing: Field[];
}

export interface FieldExtractor {
  /** Completa solo los campos de `missing`. Nunca lanza: ante error, timeout o respuesta
   *  inválida devuelve {} y la alerta queda "incompleta" (FR-059). */
  extract(input: ExtractInput): Promise<Partial<RawFields>>;
}

// ── Datos públicos de Binance ─────────────────────────────────────────────────

export interface Ranking {
  gainers: string[];
  losers: string[];
  refreshedAt: Date;
}

export interface MarketData {
  /** Copia local de filtros; undefined si el símbolo no existe. */
  symbol(name: string): SymbolFilters | undefined;
  /** Copia local del ranking top 3, o undefined si nunca se pudo armar. */
  ranking(): Ranking | undefined;
  /** Cierres de velas de 45 min armadas con velas de 15 min, incluida la vela en curso.
   *  Si rechaza, la alerta queda "datos de mercado no disponibles" (FR-064). */
  closes45m(symbol: string): Promise<number[]>;
}

// ── Operación en Binance (modo activo) ────────────────────────────────────────

export interface OrderRef {
  symbol: string;
  id: string;
}

export interface EntryOrder {
  symbol: string;
  side: Side;
  quantity: number;
  price: number;
}

export type OrderStatus = 'open' | 'filled' | 'partially_filled' | 'canceled' | 'rejected';

export interface OrderState {
  ref: OrderRef;
  status: OrderStatus;
  filledQty: number;
}

export interface PositionState {
  symbol: string;
  side: Side;
  quantity: number;
}

export interface ClosingFill {
  cause: 'TP' | 'SL' | 'liquidación' | 'otro';
  orderId: string | null;
  at: Date;
  realizedPnl: number;
  fees: number;
}

export interface Exchange {
  /** Balance total de la billetera de Futuros USDT, sin PnL no realizado (FR-024). */
  walletBalanceUsdt(): Promise<number>;
  /** Margen aislado y apalancamiento del símbolo (FR-060). */
  prepareSymbol(symbol: string, leverage: number): Promise<void>;
  placeLimitEntry(order: EntryOrder): Promise<OrderRef>;
  /** SL de cierre de posición (STOP_MARKET, closePosition). */
  placeStopLoss(symbol: string, side: Side, price: number): Promise<OrderRef>;
  /** TP de cierre de posición (TAKE_PROFIT_MARKET, closePosition). */
  placeTakeProfit(symbol: string, side: Side, price: number): Promise<OrderRef>;
  closeAtMarket(symbol: string, side: Side): Promise<OrderRef>;
  cancel(ref: OrderRef): Promise<void>;
  order(ref: OrderRef): Promise<OrderState>;
  /** Órdenes abiertas del símbolo (para detectar un SL/TP perdido). */
  openOrders(symbol: string): Promise<OrderRef[]>;
  openPositions(): Promise<PositionState[]>;
  closingFills(symbol: string, since: Date): Promise<ClosingFill[]>;
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────

export interface IncomingMessage {
  waMessageId: string;
  sender: string;
  text: string;
  timestamp: Date;
  /** Descarga la imagen adjunta, si hay (solo se pide cuando el texto no alcanza). */
  downloadImage(): Promise<Buffer | null>;
}

export interface IncomingEdit {
  waMessageId: string;
  newText: string;
  previousText: string;
  editedAt: Date;
}

export interface MessageSource {
  onMessage(cb: (m: IncomingMessage) => void): void;
  onEdit(cb: (e: IncomingEdit) => void): void;
  onConnectionChange(cb: (up: boolean) => void): void;
}

// ── Ejecutor → monitor de conexión ────────────────────────────────────────────

export interface EmergencyState {
  /** true mientras algún cierre de emergencia (FR-030) siga reintentando. */
  emergencyInProgress(): boolean;
}

// ── Reloj ─────────────────────────────────────────────────────────────────────

export type TimerHandle = { readonly id: number };

export interface Clock {
  now(): Date;
  setTimeout(fn: () => void, ms: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(fn: () => void, ms: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
  sleep(ms: number): Promise<void>;
}
