import { describe, expect, it } from 'vitest';
import { CONFIG_EXIT_CODE, parseConfig, startupWarnings } from '../../src/config.ts';

const KEY_HEX = 'a'.repeat(64); // 32 bytes

const common = {
  ANTHROPIC_API_KEY: 'sk-ant-test',
  WHATSAPP_SESSION_KEY: KEY_HEX,
  WHATSAPP_GROUP_NAME: 'ALERTAS CRYPTO+',
  AUTHORIZED_SENDERS: '5491100000001, 5491100000002',
  RISK_R_USDT: '5',
  MAX_POSITIONS: '3',
  MAX_CAPITAL_USDT: '300',
  MAX_POSITION_USDT: '150',
  MAX_LEVERAGE: '5',
  SYMBOL_LEVERAGE: '10',
};
const demo = { BINANCE_DEMO_API_KEY: 'demo-key', BINANCE_DEMO_API_SECRET: 'demo-secret' };
const live = { BINANCE_LIVE_API_KEY: 'live-key', BINANCE_LIVE_API_SECRET: 'live-secret' };

const dryEnv = (over: Record<string, string | undefined> = {}) => ({
  SIGNALBRIDGE_MODE: 'DRY',
  ...common,
  ...demo,
  ...over,
});

function errorsOf(env: Record<string, string | undefined>): string[] {
  const r = parseConfig(env);
  return r.ok ? [] : r.errors.map((e) => e.variable);
}

describe('config (FR-058, FR-062, FR-052, FR-004)', () => {
  it('arma la configuración DRY con las credenciales de Demo Trading', () => {
    const r = parseConfig(dryEnv());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.mode).toBe('DRY');
    expect(r.config.binance).toEqual({ apiKey: 'demo-key', secret: 'demo-secret' });
    expect(r.config.authorizedSenders).toEqual(['5491100000001', '5491100000002']);
    expect(r.config.whatsappSessionKey).toHaveLength(32);
    expect(r.config.riskR).toBe(5);
    expect(r.config.maxPositions).toBe(3);
    expect(r.config.dataDir).toBe('data');
  });

  it('en LIVE usa las credenciales de producción y no pide las de Demo (FR-052)', () => {
    const r = parseConfig({ SIGNALBRIDGE_MODE: 'LIVE', ...common, ...live });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.config.binance).toEqual({ apiKey: 'live-key', secret: 'live-secret' });
  });

  it('en DRY no pide las credenciales de producción', () => {
    expect(errorsOf(dryEnv())).toEqual([]);
  });

  it('en LIVE falta la credencial de producción aunque estén las de Demo', () => {
    const errs = errorsOf({ SIGNALBRIDGE_MODE: 'LIVE', ...common, ...demo });
    expect(errs).toEqual(expect.arrayContaining(['BINANCE_LIVE_API_KEY', 'BINANCE_LIVE_API_SECRET']));
  });

  const required = [
    'WHATSAPP_SESSION_KEY',
    'WHATSAPP_GROUP_NAME',
    'AUTHORIZED_SENDERS',
    'BINANCE_DEMO_API_KEY',
    'BINANCE_DEMO_API_SECRET',
    'RISK_R_USDT',
    'MAX_POSITIONS',
    'MAX_CAPITAL_USDT',
    'MAX_POSITION_USDT',
    'MAX_LEVERAGE',
    'SYMBOL_LEVERAGE',
  ];
  for (const v of required) {
    it(`informa ${v} si falta`, () => {
      expect(errorsOf(dryEnv({ [v]: undefined }))).toContain(v);
      expect(errorsOf(dryEnv({ [v]: '  ' }))).toContain(v);
    });
  }

  it('rechaza valores numéricos que no son > 0 (FR-062)', () => {
    expect(errorsOf(dryEnv({ RISK_R_USDT: '0' }))).toContain('RISK_R_USDT');
    expect(errorsOf(dryEnv({ MAX_CAPITAL_USDT: '-10' }))).toContain('MAX_CAPITAL_USDT');
    expect(errorsOf(dryEnv({ MAX_LEVERAGE: 'abc' }))).toContain('MAX_LEVERAGE');
  });

  it('pide enteros para MAX_POSITIONS y SYMBOL_LEVERAGE', () => {
    expect(errorsOf(dryEnv({ MAX_POSITIONS: '1.5' }))).toContain('MAX_POSITIONS');
    expect(errorsOf(dryEnv({ SYMBOL_LEVERAGE: '2.5' }))).toContain('SYMBOL_LEVERAGE');
  });

  it('MAX_SL_DISTANCE_PCT es 15 si no se configura, y debe ser > 0 si se configura (FR-013)', () => {
    const r = parseConfig(dryEnv({ MAX_SL_DISTANCE_PCT: undefined }));
    expect(r.ok && r.config.maxSlDistancePct).toBe(15);
    expect(errorsOf(dryEnv({ MAX_SL_DISTANCE_PCT: '0' }))).toContain('MAX_SL_DISTANCE_PCT');
  });

  it('pide una clave de sesión de 32 bytes en hex o base64 (FR-049)', () => {
    expect(errorsOf(dryEnv({ WHATSAPP_SESSION_KEY: 'corta' }))).toContain('WHATSAPP_SESSION_KEY');
    const b64 = Buffer.alloc(32, 7).toString('base64');
    expect(errorsOf(dryEnv({ WHATSAPP_SESSION_KEY: b64 }))).toEqual([]);
  });

  it('pide al menos un remitente autorizado', () => {
    expect(errorsOf(dryEnv({ AUTHORIZED_SENDERS: ' , ' }))).toContain('AUTHORIZED_SENDERS');
  });

  it('rechaza un modo que no sea DRY ni LIVE', () => {
    expect(errorsOf(dryEnv({ SIGNALBRIDGE_MODE: 'PAPER' }))).toContain('SIGNALBRIDGE_MODE');
  });

  it('lista todo lo que falta de una vez', () => {
    const errs = errorsOf({ SIGNALBRIDGE_MODE: 'DRY' });
    expect(errs).toEqual(expect.arrayContaining(required));
  });

  it.fails('sin ANTHROPIC_API_KEY la configuración es válida, con la key en null (AC-75)', () => {
    for (const value of [undefined, '  ']) {
      const r = parseConfig(dryEnv({ ANTHROPIC_API_KEY: value }));
      expect(r.ok).toBe(true);
      expect(r.ok && r.config.anthropicApiKey).toBeNull();
    }
  });

  it.fails('sin key de IA avisa al arrancar que el análisis de imagen está apagado (AC-75)', () => {
    const without = parseConfig(dryEnv({ ANTHROPIC_API_KEY: undefined }));
    const withKey = parseConfig(dryEnv());
    if (!without.ok || !withKey.ok) throw new Error('config inválida');
    expect(startupWarnings(without.config)).toEqual([expect.stringMatching(/análisis de imagen.*apagado/)]);
    expect(startupWarnings(withKey.config)).toEqual([]);
  });

  it('sale con el código 78 ante configuración inválida', () => {
    expect(CONFIG_EXIT_CODE).toBe(78);
  });
});
