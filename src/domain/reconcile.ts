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

export async function reconcile({ store, executor, tracker }: ReconcileDeps): Promise<void> {
  // Primero lo que quedó sin proteger, después las entradas pendientes.
  for (const state of ['con_ejecución', 'pendiente'] as const) {
    for (const trade of store.tradesInState(state)) {
      const alert = store.getAlert(trade.alertId);
      if (alert) await executor.resume(alert, trade);
    }
  }
  // Cierres durante la caída de las operaciones abiertas, incluidas las recién protegidas (FR-040).
  await tracker.tick();
}
