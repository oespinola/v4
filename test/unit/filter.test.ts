import { describe, expect, it } from 'vitest';
import { isAlertText, isAuthorized, normalizeSender } from '../../src/domain/filter.ts';

describe('filtro de mensajes (FR-001, FR-002)', () => {
  it('reconoce el disparador en cualquier posición, sin mayúsculas ni tildes (AC-35)', () => {
    expect(isAlertText('*KAIA - ALERTA DE TRADING*\nEntrada: 1')).toBe(true);
    expect(isAlertText('algo antes ALERTA DE TRADÍNG y después')).toBe(true);
    expect(isAlertText('alerta de trading')).toBe(true);
  });

  it('ignora mensajes sin el disparador (AC-05)', () => {
    expect(isAlertText('hola a todos')).toBe(false);
    expect(isAlertText('alerta trading')).toBe(false);
    expect(isAlertText('')).toBe(false);
  });

  it('normaliza el remitente sin sufijo de dispositivo ni dominio', () => {
    expect(normalizeSender('5491100000001:1@c.us')).toBe('5491100000001');
    expect(normalizeSender('5491100000001@c.us')).toBe('5491100000001');
    expect(normalizeSender(' 5491100000001 ')).toBe('5491100000001');
  });

  it('autoriza solo remitentes de la lista, comparando normalizado (AC-26)', () => {
    const list = ['5491100000001', '5491100000002@c.us'];
    expect(isAuthorized('5491100000001:3@c.us', list)).toBe(true);
    expect(isAuthorized('5491100000002', list)).toBe(true);
    expect(isAuthorized('5491199999999@c.us', list)).toBe(false);
  });
});
