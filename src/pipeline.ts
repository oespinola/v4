// Pipeline: mensaje → alerta → validación (US1) → carga (US2). Arma el registro de la alerta, lo
// guarda y, si es un rechazo, lo loguea. Las válidas se dimensionan, pasan los límites de exposición
// en el orden de FR-020 y van al ejecutor. Las ediciones de alertas ya
// procesadas se registran para revisión manual, sin operarse (FR-047).
import type { Store } from './adapters/store.ts';
import type { Clock, Exchange, FieldExtractor, IncomingEdit, IncomingMessage, MarketData } from './ports.ts';
import type { Executor } from './domain/executor.ts';
import { checkExposure } from './domain/exposure.ts';
import { sizePosition } from './domain/sizing.ts';
import { isAlertText } from './domain/filter.ts';
import { alertIdOf } from './domain/identity.ts';
import { parseText } from './domain/parser.ts';
import { FIELDS, type Alert, type Field, type Mode, type RawFields, type RejectReason, type SymbolFilters } from './domain/types.ts';
import { validateAlert } from './domain/validate.ts';

const DAY_MS = 24 * 60 * 60_000;

export interface PipelineDeps {
  store: Store;
  clock: Clock;
  mode: Mode;
  authorizedSenders: readonly string[];
  extractor: FieldExtractor | null;
  market: MarketData;
  maxSlDistancePct: number;
  /** Carga de la operación (US2). Sin esto la alerta termina en válida o rechazada (US1). */
  trading?: TradingDeps | null;
}

export interface TradingDeps {
  exchange: Pick<Exchange, 'walletBalanceUsdt'>;
  executor: Pick<Executor, 'open'>;
  riskR: number;
  maxPositions: number;
  maxCapitalUsdt: number;
  maxPositionUsdt: number;
  maxLeverage: number;
}

export type ProcessOutcome = { kind: 'ignored' } | { kind: 'alert'; alert: Alert };

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export class Pipeline {
  constructor(private readonly deps: PipelineDeps) {}

  async processMessage(m: IncomingMessage): Promise<ProcessOutcome> {
    // FR-001: la charla del grupo no se procesa ni se loguea.
    if (!isAlertText(m.text)) return { kind: 'ignored' };
    const { store, clock } = this.deps;
    const receivedAt = clock.now();

    const result = await validateAlert(m, {
      authorizedSenders: this.deps.authorizedSenders,
      isKnownMessage: (id) => store.findByWaMessageId(id) !== undefined,
      hasRecentHash: (hash) => store.hasContentHashSince(hash, new Date(clock.now().getTime() - DAY_MS)),
      extractor: this.deps.extractor,
      market: this.deps.market,
      now: () => clock.now(),
      maxSlDistancePct: this.deps.maxSlDistancePct,
    });

    const raw: Partial<RawFields> = result.ok ? result.alert.fields : result.partial;
    const alert: Alert = {
      alertId: alertIdOf(m.waMessageId, result.hash),
      waMessageId: m.waMessageId,
      contentHash: result.hash,
      receivedAt,
      classifiedAt: clock.now(),
      mode: this.deps.mode,
      sender: m.sender,
      text: m.text,
      ticker: raw.ticker ?? null,
      riskLevel: raw.riskLevel ?? null,
      entryRaw: raw.entry ?? null,
      slRaw: raw.sl ?? null,
      target: raw.target ?? null,
      symbol: result.ok ? result.alert.symbol : null,
      priceFactor: result.ok ? result.alert.factor : 1,
      side: result.ok ? result.alert.side : null,
      entry: result.ok ? result.alert.entry : null,
      sl: result.ok ? result.alert.sl : null,
      tp: result.ok ? result.alert.tp : null,
      tpSource: result.ok ? result.alert.tpSource : null,
      status: result.ok ? 'válida' : 'rechazada',
      reason: result.ok ? null : result.reason,
    };

    // Un mismo ID de mensaje ya está en la base (FR-007): el duplicado solo se loguea.
    const duplicateById = !result.ok && result.reason === 'duplicado' && store.findByWaMessageId(m.waMessageId);
    if (!duplicateById) store.saveAlert(alert);
    if (alert.status === 'rechazada') store.logAlert(alert);
    if (result.ok && this.deps.trading) {
      return { kind: 'alert', alert: await this.load(alert, result.alert.filters, this.deps.trading) };
    }
    return { kind: 'alert', alert };
  }

  /** FR-020 desde "bajo mínimo": dimensionamiento → exposición → entrada (FR-021 a FR-027, FR-063). */
  private async load(alert: Alert, filters: SymbolFilters, t: TradingDeps): Promise<Alert> {
    const { store } = this.deps;
    const reject = (reason: RejectReason): Alert => {
      const rejected: Alert = { ...alert, status: 'rechazada', reason };
      store.saveAlert(rejected);
      store.logAlert(rejected);
      return rejected;
    };
    const sized = await sizePosition({
      entry: alert.entry!,
      sl: alert.sl!,
      filters,
      riskR: t.riskR,
      maxPositionUsdt: t.maxPositionUsdt,
      maxLeverage: t.maxLeverage,
      walletBalance: () => t.exchange.walletBalanceUsdt(),
    });
    if (!sized.ok) return reject(sized.reason);
    const exposureReason = checkExposure({
      notional: sized.notional,
      symbolActive: store.activeTradeForSymbol(alert.symbol!) !== undefined,
      current: store.exposure(),
      maxPositions: t.maxPositions,
      maxCapitalUsdt: t.maxCapitalUsdt,
    });
    if (exposureReason) return reject(exposureReason);
    await t.executor.open(alert, sized);
    return store.getAlert(alert.alertId) ?? alert;
  }

  async processEdit(e: IncomingEdit): Promise<void> {
    const original = this.deps.store.findByWaMessageId(e.waMessageId);
    if (!original) return;
    const before = parseText(e.previousText);
    const after = parseText(e.newText);
    const changedFields: Field[] = FIELDS.filter((f) => !sameValue(before[f], after[f]));
    const record = {
      alertId: original.alertId,
      editedAt: e.editedAt,
      previousText: e.previousText,
      newText: e.newText,
      changedFields,
    };
    this.deps.store.saveEdit(record);
    this.deps.store.appendLog('edit', { ...record, editedAt: e.editedAt.toISOString() });
  }
}
