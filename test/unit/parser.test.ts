import { describe, expect, it } from 'vitest';
import { missingFields, parseText } from '../../src/domain/parser.ts';
import { alerts } from '../fixtures/alerts.ts';

describe('parser regex (FR-003, AC-20)', () => {
  it('extrae los cinco datos de una alerta de Tomy con objetivo numérico', () => {
    expect(parseText(alerts.kaia)).toEqual({
      ticker: 'KAIA',
      entry: 0.0402,
      target: { price: 0.038 },
      sl: 0.0414,
      riskLevel: 'Alto',
    });
  });

  it('toma el objetivo por indicadores como texto, sin espacios sobrantes', () => {
    expect(parseText(alerts.flux)).toMatchObject({ ticker: 'FLUX', target: { text: 'ASL21, EMA55' }, riskLevel: 'Medio' });
  });

  it('distingue el riesgo Medio-Alto', () => {
    expect(parseText(alerts.coti).riskLevel).toBe('Medio-Alto');
  });

  it('toma solo un número seguido de "usd" como precio del objetivo (AC-34)', () => {
    const text = '*PEPE - ALERTA DE TRADING*\nEntrada: 0.002 usd\nObj.: ASL21, EMA55 y 0.002404 usd\nSL: 0.0019 usd\nRiesgo Alto';
    expect(parseText(text).target).toEqual({ price: 0.002404 });
  });

  it('acepta coma decimal', () => {
    const text = '*KAIA - ALERTA DE TRADING*\nEntrada: 0,0402 usd';
    expect(parseText(text).entry).toBe(0.0402);
  });

  it('devuelve solo lo que pudo sacar y lista lo que falta', () => {
    const p = parseText('*X - ALERTA DE TRADING*\nEntrada: 1 usd');
    expect(p).toEqual({ ticker: 'X', entry: 1 });
    expect(missingFields(p)).toEqual(['target', 'sl', 'riskLevel']);
  });

  describe('nivel de riesgo libre (FR-003, AC-89)', () => {
    const withRisk = (risk: string, description = 'Descripción.') =>
      `*CELO - ALERTA DE TRADING*\n\n${description}\n\nEntrada: 0.07236 usd\nObj.: ASL21, EMA55\nSL: 0.06947 usd\n${risk}`;

    it('toma el texto que sigue a "Riesgo" tal como viene, sin los emojis', () => {
      expect(parseText(withRisk('Riesgo MUY ALTO 🟣')).riskLevel).toBe('MUY ALTO');
      expect(parseText(withRisk('Riesgo NIVEL DIOS  🟣🟣🟣')).riskLevel).toBe('NIVEL DIOS');
    });

    it('sigue normalizando los niveles conocidos, aunque traigan un comentario', () => {
      expect(parseText(withRisk('Riesgo alto 🔴 (es un claro spike, pero puede seguir)')).riskLevel).toBe('Alto');
      expect(parseText(withRisk('Riesgo MEDIO-ALTO 🟠')).riskLevel).toBe('Medio-Alto');
    });

    it('corta el texto libre en el primer paréntesis', () => {
      expect(parseText(withRisk('Riesgo extremo (no entrar con mucho)')).riskLevel).toBe('extremo');
    });

    it('solo cuenta la línea que empieza con "Riesgo", no un riesgo de la descripción', () => {
      const text = withRisk('Riesgo MUY ALTO 🟣', 'Proyecto nuevo, con riesgo regulatorio en EE. UU.');
      expect(parseText(text).riskLevel).toBe('MUY ALTO');
    });

    it('sin texto después de "Riesgo" el nivel falta', () => {
      expect(missingFields(parseText(withRisk('Riesgo 🟣🟣🟣')))).toEqual(['riskLevel']);
    });
  });

  it('parsea todas las alertas reales del fixture', () => {
    for (const [name, text] of Object.entries(alerts)) {
      expect(missingFields(parseText(text)), name).toEqual([]);
    }
  });
});
