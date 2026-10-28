import { describe, expect, it } from 'vitest';
import { missingFields, parseText } from '../../src/domain/parser.ts';
import { alerts } from '../fixtures/alerts.ts';

describe('parser regex (FR-003, AC-20)', () => {
  it.fails('extrae los cinco datos de una alerta de Tomy con objetivo numérico', () => {
    expect(parseText(alerts.kaia)).toEqual({
      ticker: 'KAIA',
      entry: 0.0402,
      target: { price: 0.038 },
      sl: 0.0414,
      riskLevel: 'Alto',
    });
  });

  it.fails('toma el objetivo por indicadores como texto, sin espacios sobrantes', () => {
    expect(parseText(alerts.flux)).toMatchObject({ ticker: 'FLUX', target: { text: 'ASL21, EMA55' }, riskLevel: 'Medio' });
  });

  it.fails('distingue el riesgo Medio-Alto', () => {
    expect(parseText(alerts.coti).riskLevel).toBe('Medio-Alto');
  });

  it.fails('toma solo un número seguido de "usd" como precio del objetivo (AC-34)', () => {
    const text = '*PEPE - ALERTA DE TRADING*\nEntrada: 0.002 usd\nObj.: ASL21, EMA55 y 0.002404 usd\nSL: 0.0019 usd\nRiesgo Alto';
    expect(parseText(text).target).toEqual({ price: 0.002404 });
  });

  it.fails('acepta coma decimal', () => {
    const text = '*KAIA - ALERTA DE TRADING*\nEntrada: 0,0402 usd';
    expect(parseText(text).entry).toBe(0.0402);
  });

  it.fails('devuelve solo lo que pudo sacar y lista lo que falta', () => {
    const p = parseText('*X - ALERTA DE TRADING*\nEntrada: 1 usd');
    expect(p).toEqual({ ticker: 'X', entry: 1 });
    expect(missingFields(p)).toEqual(['target', 'sl', 'riskLevel']);
  });

  it.fails('parsea todas las alertas reales del fixture', () => {
    for (const [name, text] of Object.entries(alerts)) {
      expect(missingFields(parseText(text)), name).toEqual([]);
    }
  });
});
