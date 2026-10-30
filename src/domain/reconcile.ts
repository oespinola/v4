// Reconciliación al arrancar (FR-039 a FR-042, FR-065): antes de escuchar mensajes, el estado local
// se alinea con Binance. Las alertas válidas sin operación se buscan en Binance por su entrada
// (FR-070), las operaciones `pendiente` y `con_ejecución` las retoma el ejecutor, y las `abierta`
// las revisa el seguimiento, con la misma lógica que en marcha.
import type { Store } from '../adapters/store.ts';
import type { ReconcileSummary } from './console-line.ts';
import type { Executor } from './executor.ts';
import type { Tracker } from './tracker.ts';
import type { Mode } from './types.ts';

export interface ReconcileDeps {
  store: Store;
  mode: Mode;
  executor: Pick<Executor, 'resume' | 'recoverUnconfirmed'>;
  tracker: Pick<Tracker, 'tick'>;
}

/** Cuánto se revisó, para el resumen del modo detallado (FR-072). */
export async function reconcile({ store, mode, executor, tracker }: ReconcileDeps): Promise<ReconcileSummary> {
  // Primero las entradas que pudieron quedar en Binance sin registrar: si se ejecutaron, no tienen
  // SL ni TP (FR-070). Las de otro modo están en otra cuenta.
  for (const alert of store.validAlertsWithoutTrade(mode)) await executor.recoverUnconfirmed(alert);
  // Después lo que quedó sin proteger, y por último las entradas pendientes.
  for (const state of ['con_ejecución', 'pendiente'] as const) {
    for (const trade of store.tradesInState(state)) {
      const alert = store.getAlert(trade.alertId);
      if (alert) await executor.resume(alert, trade);
    }
  }
  // Cierres durante la caída de las operaciones abiertas, incluidas las recién protegidas (FR-040).
  await tracker.tick();
  return { recovered: 0, resumed: 0, reviewed: 0 };
}
