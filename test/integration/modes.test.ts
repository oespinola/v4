import ccxt from 'ccxt';
import { describe, expect, it } from 'vitest';
import { DEMO_URL, PRODUCTION_URL, publicDataUrls } from '../../src/adapters/binance-public.ts';
import { createExchange, type CcxtConstructor } from '../../src/adapters/binance-trading.ts';
import { parseConfig } from '../../src/config.ts';

const common = {
  WHATSAPP_SESSION_KEY: 'a'.repeat(64),
  WHATSAPP_GROUP_NAME: 'Grupo',
  AUTHORIZED_SENDERS: '5491100000001',
  RISK_R_USDT: '5',
  MAX_POSITIONS: '3',
  MAX_CAPITAL_USDT: '1000',
  MAX_POSITION_USDT: '500',
  MAX_LEVERAGE: '2',
  SYMBOL_LEVERAGE: '2',
  BINANCE_DEMO_API_KEY: 'demo-key',
  BINANCE_DEMO_API_SECRET: 'demo-secret',
  BINANCE_LIVE_API_KEY: 'live-key',
  BINANCE_LIVE_API_SECRET: 'live-secret',
};

function configFor(mode: 'DRY' | 'LIVE') {
  const r = parseConfig({ ...common, SIGNALBRIDGE_MODE: mode });
  if (!r.ok) throw new Error('config inválida');
  return r.config;
}

/** Clase de CCXT espiada: registra con qué se construyó y si se pasó a Demo Trading. */
function spyCcxt() {
  const built: { opts: unknown; demo: boolean[] }[] = [];
  class Spy {
    constructor(opts: unknown) {
      built.push({ opts, demo: [] });
    }
    enableDemoTrading(enable: boolean) {
      built.at(-1)!.demo.push(enable);
    }
  }
  return { Ctor: Spy as unknown as CcxtConstructor, built };
}

/** Hosts a los que apunta el cliente real de CCXT para la API de Futuros USDS-M. */
const futuresHosts = (client: unknown) => {
  const api = (client as { urls: { api: Record<string, string> } }).urls.api;
  return [...new Set(Object.entries(api).filter(([k]) => k.startsWith('fapi')).map(([, v]) => new URL(v).host))];
};

describe('selección de modo (FR-050 a FR-052, AC-11, AC-12, AC-49)', () => {
  it('DRY arma el exchange con Demo Trading y las credenciales BINANCE_DEMO_* (AC-11, AC-49)', () => {
    const config = configFor('DRY');
    const { Ctor, built } = spyCcxt();
    createExchange(config.mode, config.binance, Ctor);
    expect(built).toEqual([{ opts: { apiKey: 'demo-key', secret: 'demo-secret', enableRateLimit: false }, demo: [true] }]);
  });

  it('LIVE arma el exchange contra producción con BINANCE_LIVE_* y sin Demo (AC-12, AC-49)', () => {
    const config = configFor('LIVE');
    const { Ctor, built } = spyCcxt();
    createExchange(config.mode, config.binance, Ctor);
    expect(built).toEqual([{ opts: { apiKey: 'live-key', secret: 'live-secret', enableRateLimit: false }, demo: [] }]);
  });

  it('con CCXT real, órdenes y balance de DRY van solo a Demo y los de LIVE solo a producción (SC-006)', () => {
    const dry = createExchange('DRY', { apiKey: 'k', secret: 's' }, ccxt.binanceusdm as unknown as CcxtConstructor);
    const live = createExchange('LIVE', { apiKey: 'k', secret: 's' }, ccxt.binanceusdm as unknown as CcxtConstructor);
    expect(futuresHosts(dry.client)).toEqual(['demo-fapi.binance.com']);
    expect(futuresHosts(live.client)).toEqual(['fapi.binance.com']);
  });

  it('los datos públicos salen siempre de producción; en DRY, los filtros de órdenes de Demo (FR-017, FR-066)', () => {
    expect(publicDataUrls('DRY')).toEqual({ baseUrl: PRODUCTION_URL, orderRulesUrl: DEMO_URL });
    expect(publicDataUrls('LIVE')).toEqual({ baseUrl: PRODUCTION_URL, orderRulesUrl: undefined });
  });
});
