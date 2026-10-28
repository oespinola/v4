// Ejecutor de la operación (FR-027 a FR-032, FR-060, FR-065; Principio III). Coloca la entrada límite
// y la sigue por polling (R-07): al primer fill guarda `con_ejecución` antes de pedir SL y TP, y la
// operación queda `abierta` ("completa") solo con los dos aceptados. Si el SL o el TP fallan, cierra
// a mercado y reintenta con backoff hasta lograrlo (FR-030). A los 3 minutos cancela lo no
// ejecutado (FR-031, FR-032). Los eventos de cada operación corren de a uno.
import type { Store } from '../adapters/store.ts';
import type { Clock, EmergencyState, Exchange } from '../ports.ts';
import type { Alert, Trade } from './types.ts';

export const POLL_MS = 2000;
export const ENTRY_TIMEOUT_MS = 3 * 60_000;

export interface ExecutorDeps {
  exchange: Exchange;
  store: Store;
  clock: Clock;
  symbolLeverage: number;
  riskR: number;
}

export interface Sized {
  quantity: number;
  notional: number;
}

export class Executor implements EmergencyState {
  constructor(private readonly deps: ExecutorDeps) {}

  /** Coloca la entrada de una alerta válida. Devuelve la operación `pendiente`, o null si la
   *  entrada no se pudo colocar ("entrada no ejecutada"). El seguimiento sigue en segundo plano. */
  async open(_alert: Alert, _sized: Sized): Promise<Trade | null> {
    throw new Error('no implementado');
  }

  emergencyInProgress(): boolean {
    throw new Error('no implementado');
  }

  /** Corta el polling y los temporizadores (al cerrar la app). */
  stop(): void {}
}
