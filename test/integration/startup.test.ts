import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type AppFactories, type AppWhatsApp } from '../../src/app.ts';
import { Store } from '../../src/adapters/store.ts';
import type { Trade } from '../../src/domain/types.ts';
import type { IncomingMessage, OrderState } from '../../src/ports.ts';
import { ALERT } from '../helpers/executor.ts';
import { FakeClock, FakeExchange, FakeMarketData, filters } from '../fakes/index.ts';

const env = (dataDir: string) => ({
  SIGNALBRIDGE_MODE: 'DRY',
  WHATSAPP_SESSION_KEY: 'a'.repeat(64),
  WHATSAPP_GROUP_NAME: 'Grupo',
  AUTHORIZED_SENDERS: '5491100000001',
  BINANCE_DEMO_API_KEY: 'k',
  BINANCE_DEMO_API_SECRET: 's',
  RISK_R_USDT: '5',
  MAX_POSITIONS: '3',
  MAX_CAPITAL_USDT: '1000',
  MAX_POSITION_USDT: '500',
  MAX_LEVERAGE: '2',
  SYMBOL_LEVERAGE: '2',
  SIGNALBRIDGE_DATA_DIR: dataDir,
});

const PENDING: Trade = {
  alertId: ALERT.alertId,
  symbol: 'KAIAUSDT',
  side: 'SHORT',
  quantity: 4166,
  notional: 167.4732,
  riskR: 5,
  symbolLeverage: 2,
  entryPrice: 0.0402,
  slPrice: 0.0414,
  tpPrice: 0.038,
  entryOrderId: 'E1',
  slOrderId: null,
  tpOrderId: null,
  entryPlacedAt: new Date('2026-10-28T12:00:01Z'),
  filledQty: 0,
  state: 'pendiente',
  closeCause: null,
  closedAt: null,
  realizedPnl: null,
  fees: null,
};

describe('arranque (FR-039, FR-058, FR-062)', () => {
  let root: string;
  let events: string[];
  let built: string[];
  let releaseOrder: (() => void) | null;
  let stop: (() => Promise<void>) | null;
  let opened: Store | null;
  const prevUmask = process.umask();

  function factories(): AppFactories {
    const clock = new FakeClock('2026-10-28T12:01:00Z');
    const exchange = new FakeExchange({
      order: (r) =>
        new Promise<OrderState>((resolve) => {
          events.push('reconciliación: consulta la entrada');
          releaseOrder = () => resolve({ ref: r, status: 'open', filledQty: 0 });
        }),
      openPositions: async () => [],
    });
    const whatsapp: AppWhatsApp = {
      onMessage: (_cb: (m: IncomingMessage) => void) => void events.push('suscripción a mensajes'),
      onEdit: () => {},
      onConnectionChange: () => {},
      start: async () => void events.push('WhatsApp arrancado'),
      reconnect: async () => {},
      stop: async () => {},
    };
    const market = Object.assign(new FakeMarketData([filters('KAIAUSDT')]), { start: async () => {}, stop: () => {} });
    return {
      clock: () => (built.push('clock'), clock),
      store: (config, c) => {
        built.push('store');
        const store = Store.open(config.dataDir, c);
        opened = store;
        store.saveAlert({ ...ALERT, status: 'entrada pendiente' });
        store.saveTrade(PENDING);
        return store;
      },
      market: () => (built.push('market'), market),
      exchange: () => (built.push('exchange'), exchange),
      isConnectionError: () => false,
      exit: () => {},
      extractor: () => (built.push('extractor'), null),
      whatsapp: () => (built.push('whatsapp'), whatsapp),
    };
  }

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-start-'));
    events = [];
    built = [];
    releaseOrder = null;
    stop = null;
    opened = null;
  });

  afterEach(async () => {
    await stop?.();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  it('no se suscribe a mensajes hasta que termina la reconciliación (FR-039)', async () => {
    const starting = startApp(env(path.join(root, 'data')), factories(), () => {});
    for (let i = 0; i < 20 && !releaseOrder; i++) await new Promise((r) => setTimeout(r, 5));
    expect(events).toEqual(['reconciliación: consulta la entrada']);
    releaseOrder!();
    const started = await starting;
    if (started.ok) stop = started.stop;
    expect(started.ok).toBe(true);
    expect(events).toEqual(['reconciliación: consulta la entrada', 'suscripción a mensajes', 'WhatsApp arrancado']);
  });

  it.fails('muestra en consola los cierres y los eventos críticos que registra (FR-071, AC-90)', async () => {
    const lines: string[] = [];
    const starting = startApp(env(path.join(root, 'data')), factories(), (l) => lines.push(l));
    for (let i = 0; i < 20 && !releaseOrder; i++) await new Promise((r) => setTimeout(r, 5));
    releaseOrder!();
    const started = await starting;
    if (started.ok) stop = started.stop;
    opened!.logAlert(
      { ...ALERT, status: 'cerrada' },
      { ...PENDING, state: 'cerrada', filledQty: 4166, closeCause: 'SL', closedAt: new Date('2026-10-28T12:30:00Z'), realizedPnl: -5.0124, fees: 0.1655 },
    );
    opened!.logCritical({ kind: 'SL/TP perdido', alertId: ALERT.alertId, detail: 'falta su orden de TP' });
    expect(lines).toContain('● KAIAUSDT SHORT cerrada por SL: PnL -5.0124 USDT, comisiones 0.1655 USDT');
    expect(lines).toContain('⚠ CRÍTICO SL/TP perdido KAIAUSDT: falta su orden de TP');
  });

  it('con configuración inválida sale con 78 sin construir ningún adaptador (FR-058, FR-062)', async () => {
    const lines: string[] = [];
    const r = await startApp({ SIGNALBRIDGE_MODE: 'DRY' }, factories(), (l) => lines.push(l));
    expect(r).toEqual({ ok: false, exitCode: 78 });
    expect(built).toEqual([]);
    expect(lines.join('\n')).toMatch(/RISK_R_USDT/);
  });
});
