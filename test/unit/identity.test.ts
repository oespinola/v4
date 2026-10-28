import { describe, expect, it } from 'vitest';
import { alertIdOf, contentHash } from '../../src/domain/identity.ts';

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

  it('el identificador es <ID de WhatsApp>:<hash>', () => {
    expect(alertIdOf('wa-1', 'abcdef0123456789')).toBe('wa-1:abcdef0123456789');
  });
});
