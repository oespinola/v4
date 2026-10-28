// Parser regex de alertas (FR-003): extrae lo que pueda del texto. No decide el rechazo: si falta
// algo, la extracción prueba con la IA (FR-004) y recién después se rechaza (FR-005).
import { FIELDS, type Field, type RawFields, type RiskLevel, type Target } from './types.ts';

const TICKER = /^\s*([A-Za-z0-9]+)\s*[-–]\s*ALERTA DE TRADING/im;
const ENTRY = /Entrada:\s*(\d[\d.,]*)/i;
const STOP_LOSS = /\bSL:\s*(\d[\d.,]*)/i;
const TARGET_LINE = /Obj\.?:[ \t]*([^\n]*)/i;
// Solo cuenta como precio un número seguido de "usd": el 21 de "ASL21" o el 55 de "EMA55" no.
const TARGET_PRICE = /(?<![A-Za-z\d.,])(\d[\d.,]*)\s*usd/i;
const TARGET_INDICATORS = /ASL21|EMA55/i;
const RISK = /Riesgo\s+(medio[\s-]*alto|medio|alto)/i;

/** Coma decimal solo si el número no tiene punto: "0,0402" → 0.0402, "1,234.5" → 1234.5. */
export function parseNumber(raw: string): number | null {
  const s = raw.replace(/[.,]+$/, '');
  const normalized = s.includes('.') ? s.replace(/,/g, '') : s.replace(',', '.');
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function parseTarget(text: string): Target | undefined {
  const line = TARGET_LINE.exec(text)?.[1];
  if (line === undefined) return undefined;
  const price = TARGET_PRICE.exec(line)?.[1];
  if (price !== undefined) {
    const n = parseNumber(price);
    return n === null ? undefined : { price: n };
  }
  return TARGET_INDICATORS.test(line) ? { text: line.trim() } : undefined;
}

function parseRisk(text: string): RiskLevel | undefined {
  const level = RISK.exec(text)?.[1]?.toLowerCase();
  if (level === undefined) return undefined;
  if (level.startsWith('medio') && level.endsWith('alto')) return 'Medio-Alto';
  return level === 'medio' ? 'Medio' : 'Alto';
}

function numberAfter(re: RegExp, text: string): number | undefined {
  const raw = re.exec(text)?.[1];
  return raw === undefined ? undefined : (parseNumber(raw) ?? undefined);
}

export function parseText(body: string): Partial<RawFields> {
  const text = body
    .replace(/\*/g, '') // negrita de WhatsApp
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '');

  const fields: Partial<RawFields> = {};
  const ticker = TICKER.exec(text)?.[1]?.toUpperCase();
  if (ticker !== undefined) fields.ticker = ticker;
  const entry = numberAfter(ENTRY, text);
  if (entry !== undefined) fields.entry = entry;
  const target = parseTarget(text);
  if (target !== undefined) fields.target = target;
  const sl = numberAfter(STOP_LOSS, text);
  if (sl !== undefined) fields.sl = sl;
  const riskLevel = parseRisk(text);
  if (riskLevel !== undefined) fields.riskLevel = riskLevel;
  return fields;
}

export function missingFields(fields: Partial<RawFields>): Field[] {
  return FIELDS.filter((name) => fields[name] === undefined);
}
