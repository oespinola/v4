// Validación de la alerta en el orden de FR-020, hasta "top 3". Pendiente de implementar (T038).
import type { FieldExtractor, MarketData } from '../ports.ts';
import type { MappedSymbol } from './symbols.ts';
import type { RawFields, RejectReason, Side, TpSource } from './types.ts';

export interface ValidationInput {
  waMessageId: string;
  sender: string;
  text: string;
  downloadImage(): Promise<Buffer | null>;
}

export interface ValidationDeps {
  authorizedSenders: readonly string[];
  isKnownMessage(waMessageId: string): boolean;
  hasRecentHash(hash: string): boolean;
  extractor: FieldExtractor;
  market: MarketData;
  now(): Date;
  maxSlDistancePct: number;
}

export interface ValidAlert extends MappedSymbol {
  fields: RawFields;
  side: Side;
  entry: number;
  sl: number;
  tp: number;
  tpSource: TpSource;
}

export type ValidationResult =
  | { ok: true; hash: string; alert: ValidAlert }
  | { ok: false; hash: string; reason: RejectReason; partial: Partial<RawFields> };

export async function validateAlert(_m: ValidationInput, _deps: ValidationDeps): Promise<ValidationResult> {
  throw new Error('validate: no implementado');
}
