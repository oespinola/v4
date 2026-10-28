// Configuración del operador (contracts/cli.md). Pendiente de implementar (T013).
import type { Mode } from './domain/types.ts';

export const CONFIG_EXIT_CODE = 0;

export interface Config {
  mode: Mode;
  anthropicApiKey: string;
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
  dataDir: string;
}

export interface ConfigError {
  variable: string;
  message: string;
}

export type ConfigResult = { ok: true; config: Config } | { ok: false; errors: ConfigError[] };

export function parseConfig(_env: Record<string, string | undefined>): ConfigResult {
  throw new Error('parseConfig: no implementado');
}
