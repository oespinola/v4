import { describe, expect, it } from 'vitest';
import { validateAlert, type ValidationDeps } from '../../src/domain/validate.ts';
import { FakeExtractor, FakeMarketData, filters } from '../fakes/index.ts';

const NOW = new Date('2026-10-28T12:00:00Z');
const AUTH = '5491100000001';

const alertText = (ticker: string, entry: string, obj: string, sl: string, risk = 'Riesgo Alto 🔴') =>
  `*${ticker} - ALERTA DE TRADING*\nCoinMarketCap #1\n\nEntrada: ${entry} usd\nObj.: ${obj}\nSL: ${sl} usd\n${risk}`;

function setup(over: Partial<ValidationDeps> = {}) {
  const market = new FakeMarketData(
    [filters('KAIAUSDT', { tickSize: 0.0001 }), filters('1000PEPEUSDT', { tickSize: 0.001 }), filters('AXSUSDT', { tickSize: 0.001 }), filters('TOPUSDT')],
    { gainers: ['TOPUSDT'], losers: [], refreshedAt: NOW },
  );
  const extractor = new FakeExtractor({});
  const deps: ValidationDeps = {
    authorizedSenders: [AUTH],
    isKnownMessage: () => false,
    hasRecentHash: () => false,
    extractor,
    market,
    now: () => NOW,
    maxSlDistancePct: 15,
    ...over,
  };
  return { deps, market, extractor };
}

const input = (text: string, over: Partial<{ waMessageId: string; sender: string }> = {}) => ({
  waMessageId: 'wa-1',
  sender: AUTH,
  text,
  downloadImage: async () => null,
  ...over,
});

const reasonOf = async (text: string, deps: ValidationDeps, over = {}) => {
  const r = await validateAlert(input(text, over), deps);
  return r.ok ? 'válida' : r.reason;
};

const KAIA = alertText('KAIA', '0.0402', 'ASL21, EMA55 y 0.0380 usd', '0.0414');

describe('validación en el orden de FR-020', () => {
  it.fails('una alerta completa y correcta queda válida, SHORT y ajustada al tick', async () => {
    const { deps } = setup();
    const r = await validateAlert(input(KAIA), deps);
    expect(r).toMatchObject({
      ok: true,
      alert: { symbol: 'KAIAUSDT', factor: 1, side: 'SHORT', entry: 0.0402, sl: 0.0414, tp: 0.038, tpSource: 'alerta' },
    });
  });

  it.fails('mapea a 1000TICKERUSDT y escala Entrada, SL y TP ×1000 (AC-41)', async () => {
    const { deps } = setup();
    const r = await validateAlert(input(alertText('PEPE', '0.002404', 'ASL21, EMA55 y 0.002600 usd', '0.002300')), deps);
    expect(r).toMatchObject({ ok: true, alert: { symbol: '1000PEPEUSDT', factor: 1000, entry: 2.404, sl: 2.3, tp: 2.6, side: 'LONG' } });
  });

  it.fails('con objetivo por indicadores calcula el TP sobre las velas de 45 min', async () => {
    const { deps, market } = setup();
    market.closes.set('KAIAUSDT', Array.from({ length: 60 }, () => 0.039));
    const r = await validateAlert(input(alertText('KAIA', '0.0402', 'ASL21, EMA55 ', '0.0414')), deps);
    expect(r).toMatchObject({ ok: true, alert: { tp: 0.039, tpSource: 'calculado' } });
  });

  it.fails('remitente no autorizado va primero y no llama a la IA aunque falten datos (AC-54)', async () => {
    const { deps, extractor } = setup();
    const incomplete = '*KAIA - ALERTA DE TRADING*\nEntrada: 0.0402 usd';
    expect(await reasonOf(incomplete, deps, { sender: '5491199999999' })).toBe('remitente no autorizado');
    expect(extractor.calls).toHaveLength(0);
  });

  it.fails('duplicado por ID de mensaje antes de extraer', async () => {
    const { deps, extractor } = setup({ isKnownMessage: (id) => id === 'wa-1' });
    expect(await reasonOf('*KAIA - ALERTA DE TRADING*', deps)).toBe('duplicado');
    expect(extractor.calls).toHaveLength(0);
  });

  it.fails('incompleta si faltan datos después de texto e imagen (AC-21)', async () => {
    const { deps } = setup();
    expect(await reasonOf('*KAIA - ALERTA DE TRADING*\nEntrada: 0.0402 usd', deps)).toBe('incompleta');
  });

  it.fails('duplicado por hash de contenido', async () => {
    const { deps } = setup({ hasRecentHash: () => true });
    expect(await reasonOf(KAIA, deps)).toBe('duplicado');
  });

  it.fails('ticker inexistente (AC-42)', async () => {
    const { deps } = setup();
    expect(await reasonOf(alertText('NADA', '1', 'ASL21, EMA55 y 2 usd', '0.9'), deps)).toBe('ticker inexistente');
  });

  it.fails('SL igual a la Entrada (AC-19), aunque el TP también sea inválido', async () => {
    const { deps } = setup();
    expect(await reasonOf(alertText('KAIA', '0.0402', 'ASL21, EMA55 y 0.0300 usd', '0.0402'), deps)).toBe(
      'SL igual a la Entrada',
    );
  });

  it.fails('SL fuera de rango con el máximo configurado (AC-68)', async () => {
    const { deps } = setup();
    expect(await reasonOf(alertText('AXS', '1.246', 'ASL21, EMA55 y 1.4 usd', '0.1222'), deps)).toBe('SL fuera de rango');
    const loose = setup({ maxSlDistancePct: 95 });
    expect(await reasonOf(alertText('AXS', '1.246', 'ASL21, EMA55 y 1.4 usd', '0.1222'), loose.deps)).toBe('válida');
  });

  it.fails('datos de mercado no disponibles si fallan las velas para el TP (AC-71)', async () => {
    const { deps, market } = setup();
    market.closesError = new Error('sin red');
    expect(await reasonOf(alertText('KAIA', '0.0402', 'ASL21, EMA55', '0.0414'), deps)).toBe('datos de mercado no disponibles');
  });

  it.fails('TP inválido en LONG con TP ≤ Entrada (AC-02) y en SHORT con TP ≥ Entrada (AC-04)', async () => {
    const { deps } = setup();
    expect(await reasonOf(alertText('KAIA', '0.0402', 'ASL21, EMA55 y 0.0400 usd', '0.0390'), deps)).toBe('TP inválido');
    expect(await reasonOf(alertText('KAIA', '0.0402', 'ASL21, EMA55 y 0.0402 usd', '0.0414'), deps)).toBe('TP inválido');
  });

  it.fails('TP inválido si ni ASL21 ni EMA55 quedan del lado correcto (AC-33)', async () => {
    const { deps, market } = setup();
    market.closes.set('KAIAUSDT', Array.from({ length: 60 }, () => 0.05));
    expect(await reasonOf(alertText('KAIA', '0.0402', 'ASL21, EMA55', '0.0414'), deps)).toBe('TP inválido');
  });

  it.fails('ranking no disponible si la copia tiene más de 120 s (AC-25)', async () => {
    const { deps, market } = setup();
    market.currentRanking = { gainers: [], losers: [], refreshedAt: new Date(NOW.getTime() - 121_000) };
    expect(await reasonOf(KAIA, deps)).toBe('ranking no disponible');
  });

  it.fails('top 3 ganadores/perdedores (AC-06, AC-07)', async () => {
    const { deps, market } = setup();
    market.symbols.set('TOPUSDT', filters('TOPUSDT', { tickSize: 0.0001 }));
    expect(await reasonOf(alertText('TOP', '0.0402', 'ASL21, EMA55 y 0.0380 usd', '0.0414'), deps)).toBe(
      'top 3 ganadores/perdedores',
    );
  });

  it.fails('devuelve el hash crudo también al rechazar, para el identificador', async () => {
    const { deps } = setup();
    const r = await validateAlert(input('*KAIA - ALERTA DE TRADING*\nEntrada: 0.0402 usd'), deps);
    expect(r.hash).toMatch(/^[0-9a-f]{16}$/);
  });
});
