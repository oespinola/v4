import { describe, expect, it } from 'vitest';
import { alertIdOf, contentHash, mappedHash } from '../../src/domain/identity.ts';
import { filters } from '../fakes/index.ts';

const base = { ticker: 'KAIA', entry: 0.0402, sl: 0.0414, target: { price: 0.038 } };

describe('identidad de la alerta (FR-006)', () => {
  it('el hash es de 16 hex y estable para los mismos valores crudos', () => {
    const h = contentHash(base);
    expect(h).toMatch(/^[0-9a-f]{16}$/);
    expect(contentHash({ ...base })).toBe(h);
  });

  it('cambia si cambia cualquiera de ticker, Entrada, SL o TP', () => {
    const h = contentHash(base);
    expect(contentHash({ ...base, ticker: 'KITE' })).not.toBe(h);
    expect(contentHash({ ...base, entry: 0.0403 })).not.toBe(h);
    expect(contentHash({ ...base, sl: 0.0415 })).not.toBe(h);
    expect(contentHash({ ...base, target: { price: 0.039 } })).not.toBe(h);
  });

  it('con objetivo por indicadores usa el texto del objetivo, sin espacios sobrantes ni mayúsculas', () => {
    const a = contentHash({ ...base, target: { text: 'ASL21, EMA55' } });
    expect(contentHash({ ...base, target: { text: ' asl21, ema55 ' } })).toBe(a);
    expect(a).not.toBe(contentHash(base));
  });

  it('acepta datos parciales (alertas incompletas también tienen identificador)', () => {
    expect(contentHash({ ticker: 'KAIA' })).toMatch(/^[0-9a-f]{16}$/);
  });

  const pepe = { symbol: '1000PEPEUSDT', factor: 1000 as const, filters: filters('1000PEPEUSDT', { tickSize: 0.0000001 }) };
  const pepe1000 = { ...pepe, factor: 1 as const };

  it.fails('con el símbolo mapeado, "PEPE 0.002404" y "1000PEPE 2.404" dan el mismo hash (AC-78)', () => {
    const a = mappedHash({ ticker: 'PEPE', entry: 0.002404, sl: 0.0023, target: { price: 0.0026 } }, pepe);
    const b = mappedHash({ ticker: '1000PEPE', entry: 2.404, sl: 2.3, target: { price: 2.6 } }, pepe1000);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(b).toBe(a);
  });

  it.fails('el hash mapeado redondea al tick y cambia si cambia el precio en ticks', () => {
    const kaia = { symbol: 'KAIAUSDT', factor: 1 as const, filters: filters('KAIAUSDT', { tickSize: 0.0001 }) };
    const h = mappedHash(base, kaia);
    expect(mappedHash({ ...base, entry: 0.04021 }, kaia)).toBe(h);
    expect(mappedHash({ ...base, entry: 0.0403 }, kaia)).not.toBe(h);
    expect(mappedHash({ ...base, target: { text: 'ASL21, EMA55' } }, kaia)).not.toBe(h);
  });

  it('el identificador es <ID de WhatsApp>:<hash>', () => {
    expect(alertIdOf('wa-1', 'abcdef0123456789')).toBe('wa-1:abcdef0123456789');
  });
});
