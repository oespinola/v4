// Reconciliación al arrancar (FR-039 a FR-042, FR-065): antes de escuchar mensajes, el estado local
// se alinea con Binance. Las operaciones `pendiente` y `con_ejecución` las retoma el ejecutor, y las
// `abierta` las revisa el seguimiento, con la misma lógica que en marcha.
import type { Store } from '../adapters/store.ts';
import type { Executor } from './executor.ts';
import type { Tracker } from './tracker.ts';

export interface ReconcileDeps {
  store: Store;
  executor: Pick<Executor, 'resume'>;
  tracker: Pick<Tracker, 'tick'>;
}

export async function reconcile(_deps: ReconcileDeps): Promise<void> {
  throw new Error('no implementado');
}
