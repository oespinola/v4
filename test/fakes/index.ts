// Fakes de los puertos de src/ports.ts. Los tests no tocan red, cuentas ni reloj real.
import type {
  Clock,
  Exchange,
  ExtractInput,
  FieldExtractor,
  IncomingEdit,
  IncomingMessage,
  MarketData,
  MessageSource,
  Ranking,
  TimerHandle,
} from '../../src/ports.ts';
import type { RawFields, SymbolFilters } from '../../src/domain/types.ts';

/** Deja correr las promesas pendientes (microtareas y callbacks ya encolados). */
export async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
}

// ── Reloj ─────────────────────────────────────────────────────────────────────

interface Timer {
  id: number;
  at: number;
  every: number | null;
  fn: () => void;
}

export class FakeClock implements Clock {
  private t: number;
  private nextId = 1;
  private timers: Timer[] = [];

  constructor(start: Date | string = '2026-10-28T12:00:00Z') {
    this.t = new Date(start).getTime();
  }

  now(): Date {
    return new Date(this.t);
  }

  setTimeout(fn: () => void, ms: number): TimerHandle {
    const timer = { id: this.nextId++, at: this.t + Math.max(0, ms), every: null, fn };
    this.timers.push(timer);
    return { id: timer.id };
  }

  clearTimeout(handle: TimerHandle): void {
    this.timers = this.timers.filter((x) => x.id !== handle.id);
  }

  setInterval(fn: () => void, ms: number): TimerHandle {
    const timer = { id: this.nextId++, at: this.t + ms, every: ms, fn };
    this.timers.push(timer);
    return { id: timer.id };
  }

  clearInterval(handle: TimerHandle): void {
    this.clearTimeout(handle);
  }

  sleep(ms: number): Promise<void> {
    return new Promise((resolve) => this.setTimeout(resolve, ms));
  }

  /** Avanza el reloj `ms`, disparando en orden los timers que vencen y dejando correr
   *  las promesas que cada uno libera. */
  async advance(ms: number): Promise<void> {
    const target = this.t + ms;
    await flush();
    for (;;) {
      const due = this.timers.filter((x) => x.at <= target).sort((a, b) => a.at - b.at || a.id - b.id)[0];
      if (!due) break;
      this.t = due.at;
      if (due.every === null) this.timers = this.timers.filter((x) => x.id !== due.id);
      else due.at += due.every;
      due.fn();
      await flush();
    }
    this.t = target;
    await flush();
  }

  /** Mueve el reloj sin disparar timers (para simular "pasó el tiempo con el proceso caído"). */
  set(at: Date | string): void {
    this.t = new Date(at).getTime();
  }

  pendingTimers(): number {
    return this.timers.length;
  }
}

// ── IA ────────────────────────────────────────────────────────────────────────

export class FakeExtractor implements FieldExtractor {
  calls: ExtractInput[] = [];
  constructor(private result: Partial<RawFields> | (() => Promise<Partial<RawFields>>) = {}) {}

  async extract(input: ExtractInput): Promise<Partial<RawFields>> {
    this.calls.push(input);
    return typeof this.result === 'function' ? this.result() : this.result;
  }
}

// ── Datos públicos ────────────────────────────────────────────────────────────

export function filters(symbol: string, overrides: Partial<SymbolFilters> = {}): SymbolFilters {
  return {
    symbol,
    status: 'TRADING',
    contractType: 'PERPETUAL',
    tickSize: 0.0001,
    stepSize: 1,
    minQty: 1,
    minNotional: 5,
    ...overrides,
  };
}

export class FakeMarketData implements MarketData {
  symbols = new Map<string, SymbolFilters>();
  currentRanking: Ranking | undefined;
  closes = new Map<string, number[]>();
  closesError: Error | null = null;
  closesCalls: string[] = [];

  constructor(symbols: SymbolFilters[] = [], ranking?: Ranking) {
    for (const s of symbols) this.symbols.set(s.symbol, s);
    this.currentRanking = ranking;
  }

  symbol(name: string): SymbolFilters | undefined {
    return this.symbols.get(name);
  }

  ranking(): Ranking | undefined {
    return this.currentRanking;
  }

  async closes45m(symbol: string): Promise<number[]> {
    this.closesCalls.push(symbol);
    if (this.closesError) throw this.closesError;
    const c = this.closes.get(symbol);
    if (!c) throw new Error(`sin velas para ${symbol}`);
    return c;
  }
}

// ── Exchange ──────────────────────────────────────────────────────────────────

type ExchangeMethod = keyof Exchange;
export interface ExchangeCall {
  method: ExchangeMethod;
  args: unknown[];
}

/** Exchange programable: cada método usa la implementación de `impl` si existe; si no,
 *  lanza para que el test falle de forma visible. Registra todas las llamadas. */
export class FakeExchange implements Exchange {
  calls: ExchangeCall[] = [];
  constructor(public impl: Partial<Exchange> = {}) {}

  private call<K extends ExchangeMethod>(method: K, args: Parameters<Exchange[K]>): ReturnType<Exchange[K]> {
    this.calls.push({ method, args });
    const fn = this.impl[method] as ((...a: unknown[]) => ReturnType<Exchange[K]>) | undefined;
    if (!fn) throw new Error(`FakeExchange.${method} no está programado`);
    return fn(...args);
  }

  callsTo(method: ExchangeMethod): ExchangeCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  walletBalanceUsdt: Exchange['walletBalanceUsdt'] = (...a) => this.call('walletBalanceUsdt', a);
  prepareSymbol: Exchange['prepareSymbol'] = (...a) => this.call('prepareSymbol', a);
  placeLimitEntry: Exchange['placeLimitEntry'] = (...a) => this.call('placeLimitEntry', a);
  placeStopLoss: Exchange['placeStopLoss'] = (...a) => this.call('placeStopLoss', a);
  placeTakeProfit: Exchange['placeTakeProfit'] = (...a) => this.call('placeTakeProfit', a);
  closeAtMarket: Exchange['closeAtMarket'] = (...a) => this.call('closeAtMarket', a);
  cancel: Exchange['cancel'] = (...a) => this.call('cancel', a);
  order: Exchange['order'] = (...a) => this.call('order', a);
  openOrders: Exchange['openOrders'] = (...a) => this.call('openOrders', a);
  openPositions: Exchange['openPositions'] = (...a) => this.call('openPositions', a);
  closingFills: Exchange['closingFills'] = (...a) => this.call('closingFills', a);
}

// ── WhatsApp ──────────────────────────────────────────────────────────────────

export class FakeMessageSource implements MessageSource {
  private messageCbs: ((m: IncomingMessage) => void)[] = [];
  private editCbs: ((e: IncomingEdit) => void)[] = [];
  private connCbs: ((up: boolean) => void)[] = [];

  onMessage(cb: (m: IncomingMessage) => void): void {
    this.messageCbs.push(cb);
  }
  onEdit(cb: (e: IncomingEdit) => void): void {
    this.editCbs.push(cb);
  }
  onConnectionChange(cb: (up: boolean) => void): void {
    this.connCbs.push(cb);
  }

  emitMessage(m: IncomingMessage): void {
    for (const cb of this.messageCbs) cb(m);
  }
  emitEdit(e: IncomingEdit): void {
    for (const cb of this.editCbs) cb(e);
  }
  setConnected(up: boolean): void {
    for (const cb of this.connCbs) cb(up);
  }
  subscribers(): number {
    return this.messageCbs.length;
  }
}

export function message(text: string, overrides: Partial<IncomingMessage> = {}): IncomingMessage {
  return {
    waMessageId: 'wa-1',
    sender: '5491100000001',
    text,
    timestamp: new Date('2026-10-28T12:00:00Z'),
    downloadImage: async () => null,
    ...overrides,
  };
}
