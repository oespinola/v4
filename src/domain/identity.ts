// Identidad de la alerta (FR-006): `<ID de WhatsApp>:<hash>`. Con el ticker mapeado, el hash usa el
// símbolo y los precios escalados y ajustados al tick, así "PEPE 0.002404" y "1000PEPE 2.404" son la
// misma operación; si se rechaza antes del mapeo, usa los valores crudos. Con objetivo por
// indicadores entra el texto del objetivo (no el TP calculado, que cambia con cada vela) para
// detectar reenvíos (FR-007).
import { createHash } from 'node:crypto';
import { roundToStep, scale, type MappedSymbol } from './symbols.ts';
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
export function mappedHash(fields: HashInput, mapped: MappedSymbol): string {
  // Al tick más cercano en los tres precios: el ajuste por lado (FR-011) necesita la dirección, y
  // el hash se calcula antes de validar el SL. Para comparar alcanza con normalizar igual.
  const tick = mapped.filters.tickSize;
  const price = (v: number | undefined) =>
    v === undefined ? undefined : roundToStep(scale(v, mapped.factor), tick, 'nearest');
  const t = fields.target;
  return contentHash({
    ticker: mapped.symbol,
    entry: price(fields.entry),
    sl: price(fields.sl),
    target: t && 'price' in t ? { price: price(t.price)! } : t,
  });
}

export function alertIdOf(waMessageId: string, hash: string): string {
  return `${waMessageId}:${hash}`;
}
