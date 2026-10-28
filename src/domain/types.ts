// Tipos del dominio (data-model.md). Sin I/O: los usan las funciones puras y los puertos.

export type Mode = 'DRY' | 'LIVE';
export type Side = 'LONG' | 'SHORT';
export type RiskLevel = 'Medio' | 'Medio-Alto' | 'Alto';

/** Datos que se extraen de cada alerta (FR-003). */
export type Field = 'ticker' | 'entry' | 'target' | 'sl' | 'riskLevel';
export const FIELDS: readonly Field[] = ['ticker', 'entry', 'target', 'sl', 'riskLevel'];

/** Objetivo de la alerta: precio numérico (FR-014) o solo texto de indicadores (FR-015). */
export type Target = { price: number } | { text: string };

export interface RawFields {
  ticker: string;
  entry: number;
  target: Target;
  sl: number;
  riskLevel: RiskLevel;
}

/** Motivos de rechazo de FR-045, en una lista cerrada. */
export const REJECT_REASONS = [
  'remitente no autorizado',
  'duplicado',
  'incompleta',
  'ticker inexistente',
  'no disponible en Demo',
  'SL igual a la Entrada',
  'SL fuera de rango',
  'datos de mercado no disponibles',
  'TP inválido',
  'ranking no disponible',
  'top 3 ganadores/perdedores',
  'bajo mínimo',
  'excede máximos',
  'símbolo ya en operación',
  'límite de posiciones',
  'límite de capital',
] as const;
export type RejectReason = (typeof REJECT_REASONS)[number];

/** Estados finales que se loguean (FR-044). */
export const FINAL_STATUSES = [
  'completa',
  'rechazada',
  'cerrada por emergencia',
  'entrada no ejecutada',
  'cerrada',
  'liquidada',
] as const;
export type FinalStatus = (typeof FINAL_STATUSES)[number];

/** Estados de trabajo: viven solo en la base (contracts/log-record.md). */
export type WorkingStatus = 'válida' | 'entrada pendiente' | 'con ejecución';
export type AlertStatus = FinalStatus | WorkingStatus;

export type CloseCause = 'TP' | 'SL' | 'liquidación' | 'cierre manual';
export type TpSource = 'alerta' | 'calculado';

export interface Alert {
  alertId: string;
  waMessageId: string;
  contentHash: string;
  receivedAt: Date;
  classifiedAt: Date | null;
  mode: Mode;
  sender: string;
  text: string;
  ticker: string | null;
  riskLevel: RiskLevel | null;
  entryRaw: number | null;
  slRaw: number | null;
  target: Target | null;
  symbol: string | null;
  priceFactor: 1 | 1000;
  side: Side | null;
  entry: number | null;
  sl: number | null;
  tp: number | null;
  tpSource: TpSource | null;
  status: AlertStatus;
  reason: RejectReason | null;
}

export type TradeState = 'pendiente' | 'con_ejecución' | 'abierta' | 'cerrada';

export interface Trade {
  alertId: string;
  symbol: string;
  side: Side;
  quantity: number;
  notional: number;
  riskR: number;
  symbolLeverage: number;
  entryPrice: number;
  slPrice: number;
  tpPrice: number;
  entryOrderId: string | null;
  slOrderId: string | null;
  tpOrderId: string | null;
  entryPlacedAt: Date;
  filledQty: number;
  state: TradeState;
  closeCause: CloseCause | null;
  closedAt: Date | null;
  realizedPnl: number | null;
  fees: number | null;
}

/** Filtros de un símbolo de Futuros USDS-M (exchangeInfo). */
export interface SymbolFilters {
  symbol: string;
  status: string;
  contractType: string;
  tickSize: number;
  stepSize: number;
  minQty: number;
  minNotional: number;
}
