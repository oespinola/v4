// Seguimiento de las operaciones abiertas hasta su cierre (FR-033 a FR-038, SC-004): polling cada
// 2 s de las posiciones (R-07). Una posición que ya no está se cierra con la causa, la hora, el PnL
// y las comisiones que informa Binance, se cancelan sus órdenes restantes y deja de ocupar cupo. Un
// SL o TP que desaparece con la posición abierta es un evento crítico y no se toca nada (FR-038).
import type { Store } from '../adapters/store.ts';
import type { Clock, Exchange } from '../ports.ts';

export const TRACK_POLL_MS = 2000;

export interface TrackerDeps {
  exchange: Exchange;
  store: Store;
  clock: Clock;
}

export class Tracker {
  constructor(private readonly deps: TrackerDeps) {}

  start(): void {
    throw new Error('no implementado');
  }

  stop(): void {}
}
