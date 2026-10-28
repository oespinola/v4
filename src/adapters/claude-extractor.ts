// Único módulo que habla con la IA (Principio I). Pendiente de implementar (T042).
import type { ExtractInput, FieldExtractor } from '../ports.ts';
import type { RawFields } from '../domain/types.ts';

export interface ParseClient {
  parse(params: Record<string, unknown>): Promise<unknown>;
}

export class ClaudeExtractor implements FieldExtractor {
  constructor(_opts: { apiKey?: string; client?: ParseClient }) {}
  async extract(_input: ExtractInput): Promise<Partial<RawFields>> {
    throw new Error('claude-extractor: no implementado');
  }
}
