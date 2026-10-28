// Ejecutor de la operación (FR-027 a FR-032, FR-060, FR-065; Principio III). Coloca la entrada límite
// y la sigue por polling (R-07): al primer fill guarda `con_ejecución` antes de pedir SL y TP, y la
// operación queda `abierta` ("completa") solo con los dos aceptados. Si el SL o el TP fallan, cierra
// a mercado y reintenta con backoff hasta lograrlo (FR-030). A los 3 minutos cancela lo no
// ejecutado (FR-031, FR-032). Los eventos de cada operación corren de a uno.
import type { Store } from '../adapters/store.ts';
import type { Clock, EmergencyState, Exchange, OrderRef, OrderState, TimerHandle } from '../ports.ts';
import { RetryCounter } from './backoff.ts';
import type { Alert, AlertStatus, Trade } from './types.ts';

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

/** Seguimiento de una operación mientras su entrada no terminó. */
interface Tracked {
  alert: Alert;
  trade: Trade;
  entryRef: OrderRef;
  poll: TimerHandle | null;
  timeout: TimerHandle | null;
  /** Eventos de esta operación, de a uno. */
  chain: Promise<void>;
  /** SL y TP aceptados. */
  protected: boolean;
  /** Ya no hay entrada que seguir (ejecutada, cancelada o en cierre de emergencia). */
  done: boolean;
}

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export class Executor implements EmergencyState {
  private readonly tracked = new Set<Tracked>();
  private emergencies = 0;

  constructor(private readonly deps: ExecutorDeps) {}

  /** Coloca la entrada de una alerta válida. Devuelve la operación `pendiente`, o null si la
   *  entrada no se pudo colocar ("entrada no ejecutada"). El seguimiento sigue en segundo plano. */
  async open(alert: Alert, sized: Sized): Promise<Trade | null> {
    const { exchange, store, clock } = this.deps;
    const symbol = alert.symbol!;
    const side = alert.side!;
    let entryRef: OrderRef;
    try {
      await exchange.prepareSymbol(symbol, this.deps.symbolLeverage);
      entryRef = await exchange.placeLimitEntry({ symbol, side, quantity: sized.quantity, price: alert.entry! });
    } catch {
      const failed: Alert = { ...alert, status: 'entrada no ejecutada' };
      store.saveAlert(failed);
      store.logAlert(failed);
      return null;
    }

    const trade: Trade = {
      alertId: alert.alertId,
      symbol,
      side,
      quantity: sized.quantity,
      notional: sized.notional,
      riskR: this.deps.riskR,
      symbolLeverage: this.deps.symbolLeverage,
      entryPrice: alert.entry!,
      slPrice: alert.sl!,
      tpPrice: alert.tp!,
      entryOrderId: entryRef.id,
      slOrderId: null,
      tpOrderId: null,
      entryPlacedAt: clock.now(),
      filledQty: 0,
      state: 'pendiente',
      closeCause: null,
      closedAt: null,
      realizedPnl: null,
      fees: null,
    };
    store.saveTrade(trade);
    const t: Tracked = {
      alert,
      trade,
      entryRef,
      poll: null,
      timeout: null,
      chain: Promise.resolve(),
      protected: false,
      done: false,
    };
    this.setStatus(t, 'entrada pendiente');
    this.tracked.add(t);
    t.poll = clock.setInterval(() => this.enqueue(t, () => this.checkEntry(t)), POLL_MS);
    t.timeout = clock.setTimeout(() => this.enqueue(t, () => this.onTimeout(t)), ENTRY_TIMEOUT_MS);
    return { ...trade };
  }

  /** Reconciliación (FR-041, FR-042, FR-065): retoma una operación `pendiente` o `con_ejecución`
   *  que quedó de antes de arrancar y resuelve lo que pasó mientras tanto. */
  async resume(alert: Alert, trade: Trade): Promise<void> {
    const { exchange, clock } = this.deps;
    const t: Tracked = {
      alert,
      trade: { ...trade },
      entryRef: { symbol: trade.symbol, id: trade.entryOrderId! },
      poll: null,
      timeout: null,
      chain: Promise.resolve(),
      protected: false,
      done: false,
    };
    this.tracked.add(t);

    if (trade.state === 'con_ejecución') {
      const positions = await exchange.openPositions();
      if (!positions.some((p) => p.symbol === trade.symbol && p.side === trade.side && p.quantity > 0)) {
        // Se cerró durante la caída: lo registra el seguimiento como cualquier cierre (FR-040).
        t.trade.state = 'abierta';
        this.save(t);
        this.stopTracking(t);
        return;
      }
      // FR-065: solo lo que falta; un segundo SL/TP con closePosition lo rechaza Binance.
      const open = new Set((await exchange.openOrders(trade.symbol)).map((o) => o.id));
      const kept = (id: string | null): OrderRef | null =>
        id && open.has(id) ? { symbol: trade.symbol, id, algo: true } : null;
      await this.protect(t, { sl: kept(trade.slOrderId), tp: kept(trade.tpOrderId) });
      if (t.done) return;
    }

    const remaining = trade.entryPlacedAt.getTime() + ENTRY_TIMEOUT_MS - clock.now().getTime();
    if (remaining <= 0) {
      await this.onTimeout(t); // FR-042: plazo vencido durante la caída
      return;
    }
    await this.checkEntry(t); // FR-041: ¿se ejecutó mientras tanto?
    if (t.done) return;
    t.poll = clock.setInterval(() => this.enqueue(t, () => this.checkEntry(t)), POLL_MS);
    t.timeout = clock.setTimeout(() => this.enqueue(t, () => this.onTimeout(t)), remaining);
  }

  emergencyInProgress(): boolean {
    return this.emergencies > 0;
  }

  /** Corta el polling y los temporizadores (al cerrar la app). */
  stop(): void {
    for (const t of this.tracked) this.stopTracking(t);
  }

  private enqueue(t: Tracked, fn: () => Promise<void>): void {
    t.chain = t.chain.then(() => (t.done ? undefined : fn())).catch(() => {});
  }

  private stopTracking(t: Tracked): void {
    t.done = true;
    if (t.poll) this.deps.clock.clearInterval(t.poll);
    if (t.timeout) this.deps.clock.clearTimeout(t.timeout);
    t.poll = t.timeout = null;
    this.tracked.delete(t);
  }

  private setStatus(t: Tracked, status: AlertStatus): void {
    t.alert = { ...t.alert, status };
    this.deps.store.saveAlert(t.alert);
  }

  private save(t: Tracked): void {
    this.deps.store.saveTrade(t.trade);
  }

  private async checkEntry(t: Tracked): Promise<void> {
    let o: OrderState;
    try {
      o = await this.deps.exchange.order(t.entryRef);
    } catch {
      return; // se reintenta en el próximo ciclo
    }
    await this.applyEntry(t, o);
  }

  private async applyEntry(t: Tracked, o: OrderState): Promise<void> {
    if (o.filledQty > t.trade.filledQty) {
      t.trade.filledQty = o.filledQty;
      if (t.protected) this.save(t);
    }
    if (t.trade.filledQty > 0 && !t.protected) {
      await this.protect(t);
      if (t.done) return;
    }
    if (o.status === 'filled') this.stopTracking(t);
    else if (o.status === 'canceled' || o.status === 'rejected') {
      if (t.trade.filledQty === 0) this.notFilled(t);
      else this.stopTracking(t);
    }
  }

  /** FR-028, FR-029, FR-065: con_ejecución persistido antes de pedir SL y TP. */
  private async protect(
    t: Tracked,
    existing: { sl: OrderRef | null; tp: OrderRef | null } = { sl: null, tp: null },
  ): Promise<void> {
    const { exchange, store } = this.deps;
    t.trade.state = 'con_ejecución';
    this.save(t);
    this.setStatus(t, 'con ejecución');
    const placed: OrderRef[] = [existing.sl, existing.tp].filter((r): r is OrderRef => r !== null);
    let failing = 'SL';
    try {
      const sl = existing.sl ?? (await exchange.placeStopLoss(t.trade.symbol, t.trade.side, t.trade.slPrice));
      if (!existing.sl) placed.push(sl);
      t.trade.slOrderId = sl.id;
      failing = 'TP';
      const tp = existing.tp ?? (await exchange.placeTakeProfit(t.trade.symbol, t.trade.side, t.trade.tpPrice));
      if (!existing.tp) placed.push(tp);
      t.trade.tpOrderId = tp.id;
    } catch (e) {
      await this.emergencyClose(t, placed, `falló la colocación del ${failing}: ${errorText(e)}`);
      return;
    }
    t.protected = true;
    t.trade.state = 'abierta';
    this.save(t);
    this.setStatus(t, 'completa');
    store.logAlert(t.alert, t.trade);
  }

  /** FR-031, FR-032: a los 3 min se cancela lo no ejecutado; si llegó un fill, se protege. */
  private async onTimeout(t: Tracked): Promise<void> {
    const { exchange } = this.deps;
    try {
      await exchange.cancel(t.entryRef);
    } catch {
      // Si ya estaba ejecutada o cancelada, el estado de la orden lo dice.
    }
    let o: OrderState;
    try {
      o = await exchange.order(t.entryRef);
    } catch {
      return; // el polling sigue y resuelve con el estado real de la orden
    }
    await this.applyEntry(t, o);
    if (t.done) return;
    if (t.trade.filledQty === 0) this.notFilled(t);
    else this.stopTracking(t);
  }

  private notFilled(t: Tracked): void {
    this.stopTracking(t);
    t.trade.state = 'cerrada';
    this.save(t);
    this.setStatus(t, 'entrada no ejecutada');
    this.deps.store.logAlert(t.alert, t.trade);
  }

  /** FR-030: cierre a mercado, reintentado con backoff hasta lograrlo (no se rinde en el 10.º). */
  private async emergencyClose(t: Tracked, leftovers: OrderRef[], detail: string): Promise<void> {
    const { exchange, store, clock } = this.deps;
    this.stopTracking(t);
    this.emergencies++;
    try {
      store.logCritical({ kind: 'cierre de emergencia', alertId: t.alert.alertId, detail });
      // Primero el resto de la entrada, para que no vuelva a abrir posición.
      if (t.trade.filledQty < t.trade.quantity) await exchange.cancel(t.entryRef).catch(() => {});
      const retry = new RetryCounter();
      for (;;) {
        try {
          await exchange.closeAtMarket(t.trade.symbol, t.trade.side);
          break;
        } catch (e) {
          const step = retry.failure();
          store.logCritical({
            kind: 'falla del cierre de emergencia',
            alertId: t.alert.alertId,
            detail: `intento ${step.attempt}: ${errorText(e)}; reintento en ${step.waitMs} ms`,
          });
          await clock.sleep(step.waitMs);
        }
      }
      for (const ref of leftovers) await exchange.cancel(ref).catch(() => {});
      t.trade.state = 'cerrada';
      t.trade.closedAt = clock.now();
      this.save(t);
      this.setStatus(t, 'cerrada por emergencia');
      store.logAlert(t.alert, t.trade);
    } finally {
      this.emergencies--;
    }
  }
}
