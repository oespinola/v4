// Seguimiento de las operaciones abiertas hasta su cierre (FR-033 a FR-038, SC-004): polling cada
// 2 s de las posiciones (R-07). Una posición que ya no está se cierra con la causa, la hora, el PnL
// y las comisiones que informa Binance, se cancelan sus órdenes restantes y deja de ocupar cupo. Un
// SL o TP que desaparece con la posición abierta es un evento crítico y no se toca nada (FR-038).
import type { Store } from '../adapters/store.ts';
import type { Clock, Exchange, OrderRef, PositionState, TimerHandle } from '../ports.ts';
import type { Trade } from './types.ts';

export const TRACK_POLL_MS = 2000;
/** Un SL/TP que falta un solo ciclo puede estar disparándose: cuenta desde el segundo seguido. */
const MISSING_CYCLES = 2;

export interface TrackerDeps {
  exchange: Exchange;
  store: Store;
  clock: Clock;
}

const algoRef = (symbol: string, id: string | null): OrderRef | null => (id ? { symbol, id, algo: true } : null);

export class Tracker {
  private timer: TimerHandle | null = null;
  private running = false;
  /** Ciclos seguidos sin el SL / TP, por operación. */
  private readonly missing = new Map<string, { sl: number; tp: number }>();
  /** Eventos críticos ya registrados, para no repetirlos en cada ciclo. */
  private readonly reported = new Set<string>();
  /** Último error registrado por operación ('' = consulta de posiciones), mientras se repita (FR-073). */
  private readonly lastError = new Map<string, string>();

  constructor(private readonly deps: TrackerDeps) {}

  start(): void {
    this.timer ??= this.deps.clock.setInterval(() => void this.tick(), TRACK_POLL_MS);
  }

  stop(): void {
    if (this.timer) this.deps.clock.clearInterval(this.timer);
    this.timer = null;
  }

  /** Un ciclo de seguimiento; si el anterior sigue corriendo, se saltea. */
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const trades = this.deps.store.tradesInState('abierta');
      if (trades.length === 0) return;
      let positions: PositionState[];
      try {
        positions = await this.deps.exchange.openPositions();
        this.lastError.delete('');
      } catch (e) {
        this.reportError(null, e);
        return; // se vuelve a mirar en el próximo ciclo
      }
      for (const trade of trades) {
        const open = positions.some((p) => p.symbol === trade.symbol && p.side === trade.side && p.quantity > 0);
        try {
          if (open) await this.checkProtection(trade);
          else await this.checkClose(trade);
          this.lastError.delete(trade.alertId);
        } catch (e) {
          // Falla de la API: la operación queda como estaba y se reintenta.
          this.reportError(trade.alertId, e);
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** FR-073: registra la falla, salvo que sea la misma que la anterior de esa operación. */
  private reportError(alertId: string | null, e: unknown): void {
    const detail = e instanceof Error ? e.message : String(e);
    const key = alertId ?? '';
    if (this.lastError.get(key) === detail) return;
    this.lastError.set(key, detail);
    this.deps.store.logError({ source: 'seguimiento', alertId, detail });
  }

  /** FR-038: SL o TP que desaparece con la posición abierta → evento crítico, sin tocar nada. */
  private async checkProtection(trade: Trade): Promise<void> {
    const ids = new Set((await this.deps.exchange.openOrders(trade.symbol)).map((o) => o.id));
    const count = this.missing.get(trade.alertId) ?? { sl: 0, tp: 0 };
    count.sl = trade.slOrderId && !ids.has(trade.slOrderId) ? count.sl + 1 : 0;
    count.tp = trade.tpOrderId && !ids.has(trade.tpOrderId) ? count.tp + 1 : 0;
    this.missing.set(trade.alertId, count);
    for (const kind of ['sl', 'tp'] as const) {
      const key = `${trade.alertId}:${kind}`;
      if (count[kind] < MISSING_CYCLES || this.reported.has(key)) continue;
      this.reported.add(key);
      this.deps.store.logCritical({
        kind: 'SL/TP perdido',
        alertId: trade.alertId,
        detail: `la posición sigue abierta y falta su orden de ${kind.toUpperCase()}; no se modifica`,
      });
    }
  }

  /** FR-033 a FR-037: la posición ya no está. */
  private async checkClose(trade: Trade): Promise<void> {
    const { exchange, store } = this.deps;
    const sl = algoRef(trade.symbol, trade.slOrderId);
    const tp = algoRef(trade.symbol, trade.tpOrderId);
    const close = await exchange.closeOf({
      symbol: trade.symbol,
      side: trade.side,
      entryOrderId: trade.entryOrderId!,
      sl,
      tp,
      since: trade.entryPlacedAt,
    });
    if (!close) return; // Binance todavía no informa las ejecuciones del cierre
    // FR-034: la que no se disparó queda huérfana; cancel ignora lo que ya no está abierto.
    for (const ref of [sl, tp]) if (ref) await exchange.cancel(ref).catch(() => {});
    const closed: Trade = {
      ...trade,
      state: 'cerrada',
      closeCause: close.cause,
      closedAt: close.at,
      realizedPnl: close.realizedPnl,
      fees: close.fees,
    };
    store.saveTrade(closed);
    const alert = store.getAlert(trade.alertId);
    if (alert) {
      const final = { ...alert, status: close.cause === 'liquidación' ? ('liquidada' as const) : ('cerrada' as const) };
      store.saveAlert(final);
      store.logAlert(final, closed);
    }
    this.missing.delete(trade.alertId);
  }
}
