// Extracción regex → IA (FR-003 a FR-005, FR-059). El regex manda; la IA solo completa lo que
// falta, y solo entonces se descarga la imagen. Si la IA falla o no completa, la alerta queda
// incompleta (Principio II: ante la duda, no se inventa).
import type { FieldExtractor } from '../ports.ts';
import { missingFields, parseText } from './parser.ts';
import type { Field, RawFields } from './types.ts';

export interface ExtractSource {
  text: string;
  downloadImage(): Promise<Buffer | null>;
}

export type ExtractResult =
  | { complete: true; fields: RawFields }
  | { complete: false; partial: Partial<RawFields>; missing: Field[] };

export async function extractFields(m: ExtractSource, extractor: FieldExtractor): Promise<ExtractResult> {
  const fromText = parseText(m.text);
  let missing = missingFields(fromText);
  if (missing.length === 0) return { complete: true, fields: fromText as RawFields };

  const image = await m.downloadImage().catch(() => null);
  const fromIa = await extractor.extract({ text: m.text, image, missing }).catch(() => ({}));
  const merged: Partial<RawFields> = { ...fromText };
  for (const field of missing) {
    const value = (fromIa as Partial<RawFields>)[field];
    if (value !== undefined) (merged as Record<Field, unknown>)[field] = value;
  }
  missing = missingFields(merged);
  return missing.length === 0
    ? { complete: true, fields: merged as RawFields }
    : { complete: false, partial: merged, missing };
}
