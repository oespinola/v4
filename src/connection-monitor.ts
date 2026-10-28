// Monitor de conexión (FR-055, R-10): detecta cortes de WhatsApp y de Binance, reintenta con el
// backoff de backoff.ts (1, 2, 4… 60 s) y, al 10.º fallo consecutivo de un servicio, registra un
// evento crítico y termina el proceso con código 1 para que el supervisor lo relance (FR-056).
// Excepción: con un cierre de emergencia en curso no termina (FR-030, AC-74). Cada servicio lleva
// su contador. La señal de Binance son los errores de red de la API de trading; los rechazos de
// órdenes y el refresco de datos públicos no cuentan.
import type { Store } from './adapters/store.ts';
import type { Clock, EmergencyState, Exchange } from './ports.ts';

export type Service = 'whatsapp' | 'binance';

/** Latido de Binance: sin operaciones abiertas no hay polling que delate un corte. */
export const BINANCE_HEARTBEAT_MS = 15_000;

export interface MonitorDeps {
  clock: Clock;
  store: Pick<Store, 'logConnection' | 'logCritical'>;
  emergency: EmergencyState;
  /** Un intento de reconexión por servicio: resuelve si el servicio volvió. */
  probes: Record<Service, () => Promise<void>>;
  exit(code: number): void;
  log(line: string): void;
}

export class ConnectionMonitor {
  constructor(private readonly deps: MonitorDeps) {}

  /** Arranca el latido de Binance. */
  start(): void {
    throw new Error('no implementado');
  }

  stop(): void {}

  up(_service: Service): void {
    throw new Error('no implementado');
  }

  down(_service: Service, _detail?: string): void {
    throw new Error('no implementado');
  }
}

/** Envuelve el exchange: cada llamada informa al monitor si Binance responde o si hubo un error de
 *  red. Los errores se siguen propagando a quien llamó. */
export function monitorExchange(
  _exchange: Exchange,
  _monitor: Pick<ConnectionMonitor, 'up' | 'down'>,
  _isConnectionError: (e: unknown) => boolean,
): Exchange {
  throw new Error('no implementado');
}
