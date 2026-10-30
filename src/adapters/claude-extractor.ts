// Único módulo que habla con la IA (Principio I). Solo se llama cuando el regex no sacó todos los
// datos (FR-004) y completa únicamente los que faltan. Nunca lanza: error, timeout, negativa o
// respuesta inválida devuelven {} y la alerta queda "incompleta" (FR-059, Principio II).
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';
import type { ExtractInput, FieldExtractor } from '../ports.ts';
import { normalizeRisk } from '../domain/parser.ts';
import type { RawFields } from '../domain/types.ts';

export const MODEL = 'claude-sonnet-5-5';
/** Margen para el p95 < 10 s de SC-001 con imagen; sin reintentos (R-04). */
const TIMEOUT_MS = 8_000;

const ExtractionSchema = z.object({
  ticker: z.string().nullable(),
  entry: z.number().nullable(),
  stop_loss: z.number().nullable(),
  target_price: z.number().nullable(),
  target_is_indicators_only: z.boolean(),
  target_text: z.string().nullable(),
  risk_level: z.string().nullable(),
});
type Extraction = z.infer<typeof ExtractionSchema>;

const SYSTEM = `Extraés datos de alertas de trading de criptomonedas (Binance Futuros) que llegan por WhatsApp, a veces con una captura de TradingView.
Devolvé solo lo que esté escrito en el texto o se lea claramente en la imagen; si un dato no aparece, devolvé null. Nunca estimes ni completes valores.
- ticker: el activo del título "<TICKER> - ALERTA DE TRADING", sin USDT (p. ej. "KAIA").
- entry: precio de "Entrada".
- stop_loss: precio de "SL".
- target_price: el precio numérico de "Obj." si lo trae; null si el objetivo solo menciona indicadores (ASL21, EMA55).
- target_is_indicators_only: true si el objetivo menciona indicadores y no trae precio numérico.
- target_text: el texto del objetivo tal como aparece cuando no trae precio (p. ej. "ASL21, EMA55"); null si trae precio.
- risk_level: el texto que sigue a "Riesgo" en la línea que empieza con esa palabra, tal como aparece (p. ej. "medio-alto", "MUY ALTO").`;

type ParseParams = Parameters<Anthropic['beta']['messages']['parse']>[0];

/** Lo mínimo del cliente que usa el extractor; en los tests se reemplaza por un fake. */
export interface ParseClient {
  parse(params: ParseParams): Promise<unknown>;
}

function toFields(e: Extraction): Partial<RawFields> {
  const fields: Partial<RawFields> = {};
  const ticker = e.ticker?.trim().toUpperCase().replace(/USDT$/, '');
  if (ticker && /^[A-Z0-9]+$/.test(ticker)) fields.ticker = ticker;
  if (e.entry !== null && e.entry > 0) fields.entry = e.entry;
  if (e.stop_loss !== null && e.stop_loss > 0) fields.sl = e.stop_loss;
  if (e.target_price !== null && e.target_price > 0) fields.target = { price: e.target_price };
  else if (e.target_is_indicators_only) fields.target = { text: e.target_text?.trim() || 'ASL21, EMA55' };
  const riskLevel = e.risk_level === null ? undefined : normalizeRisk(e.risk_level);
  if (riskLevel !== undefined) fields.riskLevel = riskLevel;
  return fields;
}

export class ClaudeExtractor implements FieldExtractor {
  private readonly client: ParseClient;

  constructor(opts: { apiKey?: string; client?: ParseClient }) {
    if (opts.client) {
      this.client = opts.client;
    } else {
      const anthropic = new Anthropic({ apiKey: opts.apiKey, timeout: TIMEOUT_MS, maxRetries: 0 });
      this.client = { parse: (params) => anthropic.beta.messages.parse(params) };
    }
  }

  async extract(input: ExtractInput): Promise<Partial<RawFields>> {
    const content: Anthropic.Beta.BetaContentBlockParam[] = [];
    if (input.image) {
      content.push({
        type: 'image',
        source: { type: 'base64', media_type: 'image/jpeg', data: input.image.toString('base64') },
      });
    }
    content.push({ type: 'text', text: `Texto de la alerta:\n<alerta>\n${input.text}\n</alerta>` });

    try {
      const response = (await this.client.parse({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content }],
        output_config: { effort: 'low', format: betaZodOutputFormat(ExtractionSchema) },
        // Si el modelo declina, la API reintenta en el modelo recomendado para esa categoría.
        betas: ['server-side-fallback-2026-07-01'],
        fallbacks: 'default',
      })) as { stop_reason?: string | null; parsed_output?: unknown };
      if (response.stop_reason === 'refusal') return {};
      const parsed = ExtractionSchema.safeParse(response.parsed_output);
      if (!parsed.success) return {};
      const all = toFields(parsed.data);
      const picked: Partial<RawFields> = {};
      for (const field of input.missing) {
        if (all[field] !== undefined) (picked as Record<string, unknown>)[field] = all[field];
      }
      return picked;
    } catch {
      return {};
    }
  }
}
