// Parser regex de alertas (FR-003). Pendiente de implementar (T024).
import type { Field, RawFields } from './types.ts';

export function parseText(_body: string): Partial<RawFields> {
  throw new Error('parser: no implementado');
}

export function missingFields(_fields: Partial<RawFields>): Field[] {
  throw new Error('parser: no implementado');
}
