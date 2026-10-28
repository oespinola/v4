// Identidad de la alerta (FR-006): `<ID de WhatsApp>:<hash>`. El hash usa los valores crudos de la
// alerta, antes del mapeo de símbolo y del ajuste de precios; con objetivo por indicadores entra el
// texto del objetivo (no el TP calculado, que cambia con cada vela) para detectar reenvíos (FR-007).
import { createHash } from 'node:crypto';
import type { MappedSymbol } from './symbols.ts';
import type { RawFields, Target } from './types.ts';

export type HashInput = Partial<Pick<RawFields, 'ticker' | 'entry' | 'sl' | 'target'>>;

function targetKey(t: Target | undefined): string {
  if (t === undefined) return '';
  return 'price' in t ? String(t.price) : t.text.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function contentHash(raw: HashInput): string {
  const key = [raw.ticker ?? '', raw.entry ?? '', raw.sl ?? '', targetKey(raw.target)].join('|');
  return createHash('sha256').update(key).digest('hex').slice(0, 16);
}

/** Hash de la operación (FR-006): símbolo mapeado y precios escalados y ajustados al tick. */
export function mappedHash(_fields: HashInput, _mapped: MappedSymbol): string {
  throw new Error('no implementado');
}

export function alertIdOf(waMessageId: string, hash: string): string {
  return `${waMessageId}:${hash}`;
}
