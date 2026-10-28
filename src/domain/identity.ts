// Identidad de la alerta (FR-006). Pendiente de implementar (T028).
import type { RawFields } from './types.ts';

export type HashInput = Partial<Pick<RawFields, 'ticker' | 'entry' | 'sl' | 'target'>>;

export function contentHash(_raw: HashInput): string {
  throw new Error('identity: no implementado');
}

export function alertIdOf(_waMessageId: string, _hash: string): string {
  throw new Error('identity: no implementado');
}
