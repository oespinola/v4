import { describe, expect, it } from 'vitest';
import { ClaudeExtractor, type ParseClient } from '../../src/adapters/claude-extractor.ts';
import { fakeImage } from '../fixtures/alerts.ts';

type Params = Parameters<ParseClient['parse']>[0];

function fakeClient(response: unknown | (() => Promise<unknown>)) {
  const calls: Params[] = [];
  const client: ParseClient = {
    parse: async (params: Params) => {
      calls.push(params);
      return typeof response === 'function' ? (response as () => Promise<unknown>)() : response;
    },
  };
  return { client, calls };
}

const parsed = (output: Record<string, unknown> | null, stop_reason = 'end_turn') => ({ stop_reason, parsed_output: output });
const full = {
  ticker: 'kaiausdt',
  entry: 0.0402,
  stop_loss: 0.0414,
  target_price: 0.038,
  target_is_indicators_only: false,
  target_text: null,
  risk_level: 'Alto',
};

describe('extractor de Claude (FR-004, FR-059, Principio I)', () => {
  it('devuelve solo los campos pedidos como faltantes', async () => {
    const { client } = fakeClient(parsed(full));
    const ia = new ClaudeExtractor({ client });
    expect(await ia.extract({ text: 't', image: null, missing: ['sl', 'ticker'] })).toEqual({ sl: 0.0414, ticker: 'KAIA' });
  });

  it('convierte el objetivo por indicadores en texto', async () => {
    const { client } = fakeClient(parsed({ ...full, target_price: null, target_is_indicators_only: true, target_text: 'ASL21, EMA55' }));
    const ia = new ClaudeExtractor({ client });
    expect(await ia.extract({ text: 't', image: null, missing: ['target'] })).toEqual({ target: { text: 'ASL21, EMA55' } });
  });

  it('manda la imagen en base64 antes del texto, con el modelo, timeout corto y fallback', async () => {
    const { client, calls } = fakeClient(parsed(full));
    await new ClaudeExtractor({ client }).extract({ text: 'texto', image: fakeImage, missing: ['sl'] });
    const p = calls[0]! as unknown as Record<string, unknown>;
    expect(p.model).toBe('claude-sonnet-5-5');
    expect(p.fallbacks).toBe('default');
    expect(p.betas).toEqual(['server-side-fallback-2026-07-01']);
    const content = (p.messages as { content: { type: string; source?: { data: string } }[] }[])[0]!.content;
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', data: fakeImage.toString('base64') } });
    expect(content[1]?.type).toBe('text');
  });

  it.fails('acepta un nivel de riesgo libre y normaliza los conocidos (FR-003)', async () => {
    const extractRisk = async (risk_level: string) => {
      const { client } = fakeClient(parsed({ ...full, risk_level }));
      return new ClaudeExtractor({ client }).extract({ text: 't', image: null, missing: ['riskLevel'] });
    };
    expect(await extractRisk('MUY ALTO 🟣')).toEqual({ riskLevel: 'MUY ALTO' });
    expect(await extractRisk('medio-alto')).toEqual({ riskLevel: 'Medio-Alto' });
    expect(await extractRisk('🟣')).toEqual({});
  });

  it('descarta valores inválidos (negativos, ticker raro)', async () => {
    const { client } = fakeClient(parsed({ ...full, ticker: 'KA IA!', entry: -1 }));
    expect(await new ClaudeExtractor({ client }).extract({ text: 't', image: null, missing: ['ticker', 'entry'] })).toEqual({});
  });

  it('ante una negativa devuelve {}', async () => {
    const { client } = fakeClient(parsed(full, 'refusal'));
    expect(await new ClaudeExtractor({ client }).extract({ text: 't', image: null, missing: ['sl'] })).toEqual({});
  });

  it('ante una respuesta sin parsear devuelve {}', async () => {
    const { client } = fakeClient(parsed(null));
    expect(await new ClaudeExtractor({ client }).extract({ text: 't', image: null, missing: ['sl'] })).toEqual({});
  });

  it('nunca lanza: error o timeout devuelven {}', async () => {
    const { client } = fakeClient(async () => {
      throw new Error('Request timed out');
    });
    expect(await new ClaudeExtractor({ client }).extract({ text: 't', image: null, missing: ['sl'] })).toEqual({});
  });
});
