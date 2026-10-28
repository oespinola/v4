// Monitor de conexión (FR-055, R-10): detecta cortes de WhatsApp y de Binance, reintenta con el
// backoff de backoff.ts (1, 2, 4… 60 s) y, al 10.º fallo consecutivo de un servicio, registra un
// evento crítico y termina el proceso con código 1 para que el supervisor lo relance (FR-056).
// Excepción: con un cierre de emergencia en curso no termina (FR-030, AC-74). Cada servicio lleva
// su contador. La señal de Binance son los errores de red de la API de trading; los rechazos de
// órdenes y el refresco de datos públicos no cuentan.
import type { Store } from './adapters/store.ts';
import { RetryCounter } from './domain/backoff.ts';
import type { Clock, EmergencyState, Exchange, TimerHandle } from './ports.ts';

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

interface ServiceState {
  retrying: boolean;
  counter: RetryCounter;
  attempt: number;
  /** "Reconexión agotada" ya registrada en este corte. */
  exhausted: boolean;
}

export class ConnectionMonitor {
  private readonly state: Record<Service, ServiceState> = {
    whatsapp: { retrying: false, counter: new RetryCounter(), attempt: 0, exhausted: false },
    binance: { retrying: false, counter: new RetryCounter(), attempt: 0, exhausted: false },
  };
  private heartbeat: TimerHandle | null = null;
  private stopped = false;

  constructor(private readonly deps: MonitorDeps) {}

  /** Arranca el latido de Binance. */
  start(): void {
    this.heartbeat ??= this.deps.clock.setInterval(() => void this.beat(), BINANCE_HEARTBEAT_MS);
  }

  stop(): void {
    this.stopped = true;
    if (this.heartbeat) this.deps.clock.clearInterval(this.heartbeat);
    this.heartbeat = null;
  }

  /** El servicio respondió: si estaba reintentando, volvió. */
  up(service: Service): void {
    const s = this.state[service];
    if (!s.retrying) return;
    s.retrying = false;
    this.deps.store.logConnection({ service, event: 'reconectado', attempt: s.attempt, waitMs: null });
    this.deps.log(`${service}: reconectado tras ${s.attempt} intento(s).`);
    s.counter.success();
    s.attempt = 0;
    s.exhausted = false;
  }

  /** Corte detectado: registra la interrupción y empieza a reintentar (una vez por corte). */
  down(service: Service, detail?: string): void {
    const s = this.state[service];
    if (s.retrying || this.stopped) return;
    s.retrying = true;
    this.deps.store.logConnection({ service, event: 'interrupción', attempt: 0, waitMs: null });
    this.deps.log(`${service}: conexión interrumpida${detail ? ` (${detail})` : ''}.`);
    void this.retry(service);
  }

  private async beat(): Promise<void> {
    if (this.state.binance.retrying) return;
    try {
      await this.deps.probes.binance();
    } catch (e) {
      this.down('binance', e instanceof Error ? e.message : String(e));
    }
  }

  private async retry(service: Service): Promise<void> {
    const s = this.state[service];
    while (s.retrying && !this.stopped) {
      const step = s.counter.failure();
      s.attempt = step.attempt;
      this.deps.store.logConnection({ service, event: 'reintento', attempt: step.attempt, waitMs: step.waitMs });
      await this.deps.clock.sleep(step.waitMs);
      if (!s.retrying || this.stopped) return; // volvió por otro lado mientras esperaba
      try {
        await this.deps.probes[service]();
        this.up(service);
        return;
      } catch {
        // sigue el backoff
      }
      if (step.exhausted && !s.exhausted) {
        s.exhausted = true;
        const emergency = this.deps.emergency.emergencyInProgress();
        this.deps.store.logCritical({
          kind: 'reconexión agotada',
          detail: `${service}: ${step.attempt} intentos fallidos seguidos${emergency ? '; cierre de emergencia en curso, no se termina' : ''}`,
        });
        if (!emergency) {
          this.deps.log(`${service}: ${step.attempt} intentos fallidos; el proceso termina para que el supervisor lo relance.`);
          this.deps.exit(1);
          return;
        }
      }
    }
  }
}

/** Envuelve el exchange: cada llamada informa al monitor si Binance responde o si hubo un error de
 *  red. Los errores se siguen propagando a quien llamó. */
export function monitorExchange(
  exchange: Exchange,
  monitor: Pick<ConnectionMonitor, 'up' | 'down'>,
  isConnectionError: (e: unknown) => boolean,
): Exchange {
  return new Proxy(exchange, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      return async (...args: unknown[]) => {
        try {
          const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
          monitor.up('binance');
          return result;
        } catch (e) {
          if (isConnectionError(e)) monitor.down('binance', e instanceof Error ? e.message : String(e));
          else monitor.up('binance'); // Binance respondió, aunque haya rechazado el pedido
          throw e;
        }
      };
    },
  });
}
