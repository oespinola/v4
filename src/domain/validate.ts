// Validación de la alerta en el orden de FR-020, hasta "top 3 ganadores/perdedores". Lo que sigue
// (bajo mínimo, excede máximos, símbolo ya en operación y límites) lo evalúa el pipeline de carga
// (US2). Se registra solo el primer motivo que falla; ante la duda se rechaza (Principio II).
import type { FieldExtractor, MarketData } from '../ports.ts';
import { extractFields } from './extract.ts';
import { isAuthorized } from './filter.ts';
import { contentHash } from './identity.ts';
import { isCorrectSide, takeProfitFor } from './indicators.ts';
import { parseText } from './parser.ts';
import { inTop3, isRankingFresh } from './ranking.ts';
import { adjustEntry, adjustSl, adjustTp, mapTicker, scale, sideOf, type MappedSymbol } from './symbols.ts';
import type { RawFields, RejectReason, Side, Target, TpSource } from './types.ts';

export interface ValidationInput {
  waMessageId: string;
  sender: string;
  text: string;
  downloadImage(): Promise<Buffer | null>;
}

export interface ValidationDeps {
  authorizedSenders: readonly string[];
  isKnownMessage(waMessageId: string): boolean;
  /** ¿Hay una alerta con este hash en las últimas 24 h? (FR-007) */
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

const scaleTarget = (t: Target, factor: number): Target => ('price' in t ? { price: scale(t.price, factor) } : t);

export async function validateAlert(m: ValidationInput, deps: ValidationDeps): Promise<ValidationResult> {
  let partial: Partial<RawFields> = parseText(m.text);
  let hash = contentHash(partial);
  const reject = (reason: RejectReason): ValidationResult => ({ ok: false, hash, reason, partial });

  // 1. Remitente y 2. duplicado por ID: antes de gastar en la IA.
  if (!isAuthorized(m.sender, deps.authorizedSenders)) return reject('remitente no autorizado');
  if (deps.isKnownMessage(m.waMessageId)) return reject('duplicado');

  // 3. Incompleta (regex, y la IA solo si falta algo).
  const extraction = await extractFields(m, deps.extractor);
  if (!extraction.complete) {
    partial = extraction.partial;
    hash = contentHash(partial);
    return reject('incompleta');
  }
  const fields = extraction.fields;
  partial = fields;
  hash = contentHash(fields);

  // 4. Duplicado por hash de valores crudos en 24 h.
  if (deps.hasRecentHash(hash)) return reject('duplicado');

  // 5. Ticker inexistente.
  const mapped = mapTicker(fields.ticker, (s) => deps.market.symbol(s));
  if (!mapped) return reject('ticker inexistente');
  const { tickSize } = mapped.filters;

  // 6. SL igual a la Entrada, con los precios ya ajustados al tick (FR-012).
  const side = sideOf(fields.entry, fields.sl);
  if (side === null) return reject('SL igual a la Entrada');
  const entry = adjustEntry(scale(fields.entry, mapped.factor), tickSize);
  const sl = adjustSl(side, scale(fields.sl, mapped.factor), tickSize);
  if (sl === entry) return reject('SL igual a la Entrada');

  // 7. SL fuera de rango (FR-013).
  if ((Math.abs(entry - sl) / entry) * 100 > deps.maxSlDistancePct) return reject('SL fuera de rango');

  // 8. Datos de mercado (velas para el TP) y 9. TP inválido (FR-014 a FR-016, FR-064).
  let picked: { tp: number; source: TpSource } | null;
  try {
    picked = await takeProfitFor(scaleTarget(fields.target, mapped.factor), side, entry, () =>
      deps.market.closes45m(mapped.symbol),
    );
  } catch {
    return reject('datos de mercado no disponibles');
  }
  if (!picked) return reject('TP inválido');
  const tp = adjustTp(side, picked.tp, tickSize);
  if (!isCorrectSide(side, entry, tp)) return reject('TP inválido');

  // 10. Ranking no disponible y 11. top 3 (FR-018, FR-019).
  const ranking = deps.market.ranking();
  if (!ranking || !isRankingFresh(ranking, deps.now())) return reject('ranking no disponible');
  if (inTop3(ranking, mapped.symbol)) return reject('top 3 ganadores/perdedores');

  return { ok: true, hash, alert: { ...mapped, fields, side, entry, sl, tp, tpSource: picked.source } };
}
