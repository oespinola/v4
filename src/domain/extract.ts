// Extracción regex → IA (FR-003 a FR-005, FR-059). Pendiente de implementar (T026).
import type { FieldExtractor } from '../ports.ts';
import type { Field, RawFields } from './types.ts';

export interface ExtractSource {
  text: string;
  downloadImage(): Promise<Buffer | null>;
}

export type ExtractResult =
  | { complete: true; fields: RawFields }
  | { complete: false; partial: Partial<RawFields>; missing: Field[] };

export async function extractFields(_m: ExtractSource, _extractor: FieldExtractor): Promise<ExtractResult> {
  throw new Error('extract: no implementado');
}
