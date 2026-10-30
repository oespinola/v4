// Configuración del operador (contracts/cli.md): se lee del entorno (.env) y se valida al
// arrancar. Si falta o es inválido algo requerido, la app termina con CONFIG_EXIT_CODE y la lista
// completa de problemas, sin conectarse a nada (FR-058, FR-062).
import { existsSync } from 'node:fs';
import { z } from 'zod';
import type { Mode } from './domain/types.ts';

/** EX_CONFIG de sysexits: el supervisor no relanza la app con este código. */
export const CONFIG_EXIT_CODE = 78;

export interface Config {
  mode: Mode;
  /** null: sin key, el análisis de imagen queda apagado (FR-004). */
  anthropicApiKey: string | null;
  whatsappSessionKey: Buffer;
  whatsappGroupName: string;
  authorizedSenders: string[];
  binance: { apiKey: string; secret: string };
  riskR: number;
  maxPositions: number;
  maxCapital: number;
  maxPositionSize: number;
  maxLeverage: number;
  symbolLeverage: number;
  maxSlDistancePct: number;
  maxEntryDistancePct: number;
  dataDir: string;
  /** SIGNALBRIDGE_VERBOSE=1: modo detallado de la consola (FR-072). */
  verbose: boolean;
}

export interface ConfigError {
  variable: string;
  message: string;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: ConfigError[] };

type Env = Record<string, string | undefined>;

const blankToUndefined = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);

const requiredText = z.preprocess(blankToUndefined, z.string({ error: 'falta' }).trim());
const positive = z.preprocess(
  blankToUndefined,
  z.coerce.number({ error: 'falta' }).refine((n) => Number.isFinite(n) && n > 0, 'debe ser un número > 0'),
);
const positiveInt = z.preprocess(
  blankToUndefined,
  z.coerce.number({ error: 'falta' }).refine((n) => Number.isInteger(n) && n > 0, 'debe ser un entero > 0'),
);
const senders = z.preprocess(
  blankToUndefined,
  z
    .string({ error: 'falta' })
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean))
    .refine((list) => list.length > 0, 'debe tener al menos un remitente'),
);
const sessionKey = z.preprocess(
  blankToUndefined,
  z
    .string({ error: 'falta' })
    .trim()
    .transform((s) => decodeKey(s))
    .refine((b): b is Buffer => b !== null, 'debe ser una clave de 32 bytes en hex o base64'),
);

function decodeKey(s: string): Buffer | null {
  if (/^[0-9a-fA-F]{64}$/.test(s)) return Buffer.from(s, 'hex');
  if (/^[A-Za-z0-9+/]+={0,2}$/.test(s)) {
    const b = Buffer.from(s, 'base64');
    if (b.length === 32) return b;
  }
  return null;
}

/** Valida una variable y acumula el error, para listar todos los problemas de una vez. */
function read<T>(env: Env, variable: string, schema: z.ZodType<T>, errors: ConfigError[]): T {
  const r = schema.safeParse(env[variable]);
  if (r.success) return r.data;
  errors.push({ variable, message: r.error.issues[0]?.message ?? 'inválida' });
  return undefined as T;
}

export function parseConfig(env: Env): ConfigResult {
  const errors: ConfigError[] = [];

  const mode = env.SIGNALBRIDGE_MODE?.trim();
  if (mode !== 'DRY' && mode !== 'LIVE') {
    errors.push({ variable: 'SIGNALBRIDGE_MODE', message: 'debe ser DRY o LIVE' });
  }
  // Cada modo lee sus propias credenciales de Binance (FR-052).
  const prefix = mode === 'LIVE' ? 'BINANCE_LIVE' : 'BINANCE_DEMO';

  const anthropicApiKey = env.ANTHROPIC_API_KEY?.trim() || null;
  const whatsappSessionKey = read(env, 'WHATSAPP_SESSION_KEY', sessionKey, errors);
  const whatsappGroupName = read(env, 'WHATSAPP_GROUP_NAME', requiredText, errors);
  const authorizedSenders = read(env, 'AUTHORIZED_SENDERS', senders, errors);
  const apiKey = read(env, `${prefix}_API_KEY`, requiredText, errors);
  const secret = read(env, `${prefix}_API_SECRET`, requiredText, errors);
  const riskR = read(env, 'RISK_R_USDT', positive, errors);
  const maxPositions = read(env, 'MAX_POSITIONS', positiveInt, errors);
  const maxCapital = read(env, 'MAX_CAPITAL_USDT', positive, errors);
  const maxPositionSize = read(env, 'MAX_POSITION_USDT', positive, errors);
  const maxLeverage = read(env, 'MAX_LEVERAGE', positive, errors);
  const symbolLeverage = read(env, 'SYMBOL_LEVERAGE', positiveInt, errors);
  const maxSlDistancePct =
    blankToUndefined(env.MAX_SL_DISTANCE_PCT) === undefined
      ? 15
      : read(env, 'MAX_SL_DISTANCE_PCT', positive, errors);
  const maxEntryDistancePct =
    blankToUndefined(env.MAX_ENTRY_DISTANCE_PCT) === undefined
      ? 10
      : read(env, 'MAX_ENTRY_DISTANCE_PCT', positive, errors);
  const dataDir = env.SIGNALBRIDGE_DATA_DIR?.trim() || 'data';

  if (errors.length > 0) return { ok: false, errors };
  return {
    ok: true,
    config: {
      mode: mode as Mode,
      anthropicApiKey,
      whatsappSessionKey,
      whatsappGroupName,
      authorizedSenders,
      binance: { apiKey, secret },
      riskR,
      maxPositions,
      maxCapital,
      maxPositionSize,
      maxLeverage,
      symbolLeverage,
      maxSlDistancePct,
      maxEntryDistancePct,
      dataDir,
      verbose: false,
    },
  };
}

/** Carga `.env` si existe; las variables ya definidas en el entorno no se pisan. */
export function loadDotEnv(path = '.env'): void {
  if (existsSync(path)) process.loadEnvFile(path);
}

/** Avisos que no impiden arrancar (FR-004). */
export function startupWarnings(config: Config): string[] {
  return config.anthropicApiKey === null
    ? ['Sin ANTHROPIC_API_KEY: el análisis de imagen está apagado; una alerta con el texto incompleto se rechaza como "incompleta".']
    : [];
}

/** Texto para la consola con todo lo que falta o es inválido. */
export function formatConfigErrors(errors: ConfigError[]): string {
  const lines = errors.map((e) => `  - ${e.variable}: ${e.message}`);
  return `Configuración inválida; corregí el .env (ver .env.example):\n${lines.join('\n')}`;
}
