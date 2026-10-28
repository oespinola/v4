import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Store } from '../../src/adapters/store.ts';
import { Pipeline } from '../../src/pipeline.ts';
import { FakeClock, FakeExtractor, FakeMarketData, filters, message } from '../fakes/index.ts';

const AUTH = '5491100000001';
const KAIA =
  '*KAIA - ALERTA DE TRADING*\nCoinMarketCap #1\n\nEntrada: 0.0402 usd\nObj.: ASL21, EMA55 y 0.0380 usd\nSL: 0.0414 usd\nRiesgo Alto 🔴';

describe('pipeline de validación (US1)', () => {
  let root: string;
  let clock: FakeClock;
  let store: Store;
  let market: FakeMarketData;
  let pipeline: Pipeline;
  const prevUmask = process.umask();

  const logLines = () =>
    readFileSync(path.join(root, 'data', 'alerts.log'), 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, unknown>);

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-pipe-'));
    clock = new FakeClock('2026-10-28T12:00:00Z');
    store = Store.open(path.join(root, 'data'), clock);
    market = new FakeMarketData([filters('KAIAUSDT', { tickSize: 0.0001 })], {
      gainers: [],
      losers: [],
      refreshedAt: clock.now(),
    });
    pipeline = new Pipeline({
      store,
      clock,
      mode: 'DRY',
      authorizedSenders: [AUTH],
      extractor: new FakeExtractor({}),
      market,
      maxSlDistancePct: 15,
    });
  });

  afterEach(() => {
    store.close();
    process.umask(prevUmask);
    rmSync(root, { recursive: true, force: true });
  });

  it('un mensaje sin disparador no deja rastro (AC-05)', async () => {
    const r = await pipeline.processMessage(message('hola a todos', { sender: AUTH }));
    expect(r.kind).toBe('ignored');
    expect(store.findByWaMessageId('wa-1')).toBeUndefined();
    expect(logLines()).toEqual([]);
  });

  it('una alerta válida queda guardada como "válida" con side, símbolo y precios', async () => {
    const r = await pipeline.processMessage(message(KAIA, { sender: AUTH }));
    expect(r).toMatchObject({ kind: 'alert', alert: { status: 'válida', symbol: 'KAIAUSDT', side: 'SHORT', tp: 0.038 } });
    const saved = store.findByWaMessageId('wa-1');
    expect(saved?.alertId).toMatch(/^wa-1:[0-9a-f]{16}$/);
    expect(saved?.classifiedAt).toEqual(clock.now());
  });

  it('una rechazada queda guardada y logueada con su motivo', async () => {
    const r = await pipeline.processMessage(message(KAIA, { sender: '5491199999999' }));
    expect(r).toMatchObject({ kind: 'alert', alert: { status: 'rechazada', reason: 'remitente no autorizado' } });
    expect(logLines()).toEqual([expect.objectContaining({ type: 'alert', status: 'rechazada', reason: 'remitente no autorizado' })]);
  });

  it('sin key de IA, una alerta con el texto incompleto se rechaza como "incompleta" (AC-76)', async () => {
    const withoutIa = new Pipeline({
      store,
      clock,
      mode: 'DRY',
      authorizedSenders: [AUTH],
      extractor: null,
      market,
      maxSlDistancePct: 15,
    });
    const noSl = KAIA.replace(/\nSL: .*/, '');
    const r = await withoutIa.processMessage(message(noSl, { sender: AUTH }));
    expect(r).toMatchObject({ kind: 'alert', alert: { status: 'rechazada', reason: 'incompleta' } });
    expect(logLines()).toEqual([expect.objectContaining({ status: 'rechazada', reason: 'incompleta' })]);
  });

  it('el mismo mensaje tras un reinicio se rechaza como duplicado sin operarse (AC-17)', async () => {
    await pipeline.processMessage(message(KAIA, { sender: AUTH }));
    const again = await pipeline.processMessage(message(KAIA, { sender: AUTH }));
    expect(again).toMatchObject({ kind: 'alert', alert: { status: 'rechazada', reason: 'duplicado' } });
    expect(store.findByWaMessageId('wa-1')?.status).toBe('válida');
    expect(logLines().at(-1)).toMatchObject({ status: 'rechazada', reason: 'duplicado' });
  });

  it('un reenvío con otro ID dentro de las 24 h es duplicado (AC-37)', async () => {
    await pipeline.processMessage(message(KAIA, { sender: AUTH }));
    await clock.advance(23 * 60 * 60_000);
    market.currentRanking = { gainers: [], losers: [], refreshedAt: clock.now() };
    const r = await pipeline.processMessage(message(KAIA, { sender: AUTH, waMessageId: 'wa-2' }));
    expect(r).toMatchObject({ alert: { reason: 'duplicado' } });
  });

  it('pasadas las 24 h el mismo contenido ya no es duplicado (AC-53)', async () => {
    await pipeline.processMessage(message(KAIA, { sender: AUTH }));
    await clock.advance(25 * 60 * 60_000);
    market.currentRanking = { gainers: [], losers: [], refreshedAt: clock.now() };
    const r = await pipeline.processMessage(message(KAIA, { sender: AUTH, waMessageId: 'wa-2' }));
    expect(r).toMatchObject({ alert: { status: 'válida' } });
  });

  it('la edición de una alerta procesada se registra sin operarse (FR-047)', async () => {
    await pipeline.processMessage(message(KAIA, { sender: AUTH }));
    const edited = KAIA.replace('SL: 0.0414', 'SL: 0.0420');
    await pipeline.processEdit({ waMessageId: 'wa-1', previousText: KAIA, newText: edited, editedAt: clock.now() });
    const alertId = store.findByWaMessageId('wa-1')!.alertId;
    expect(store.editsOf(alertId)).toEqual([expect.objectContaining({ changedFields: ['sl'] })]);
    expect(logLines().at(-1)).toMatchObject({ type: 'edit', alertId, changedFields: ['sl'] });
    expect(store.findByWaMessageId('wa-1')?.sl).toBe(0.0414);
  });

  it('la edición de un mensaje no procesado se ignora', async () => {
    await pipeline.processEdit({ waMessageId: 'wa-9', previousText: 'a', newText: 'b', editedAt: clock.now() });
    expect(logLines()).toEqual([]);
  });
});
