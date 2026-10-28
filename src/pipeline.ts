// Pipeline: mensaje → alerta → validación (US1). Arma el registro de la alerta, lo guarda y, si es
// un rechazo, lo loguea; las válidas siguen a la carga (US2). Las ediciones de alertas ya
// procesadas se registran para revisión manual, sin operarse (FR-047).
import type { Store } from './adapters/store.ts';
import type { Clock, FieldExtractor, IncomingEdit, IncomingMessage, MarketData } from './ports.ts';
import { isAlertText } from './domain/filter.ts';
import { alertIdOf } from './domain/identity.ts';
import { parseText } from './domain/parser.ts';
import { FIELDS, type Alert, type Field, type Mode, type RawFields } from './domain/types.ts';
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
}

export type ProcessOutcome = { kind: 'ignored' } | { kind: 'alert'; alert: Alert };

/** Campos del registro de log de una alerta (contracts/log-record.md). */
export function alertLogPayload(a: Alert): Record<string, unknown> {
  return {
    alertId: a.alertId,
    receivedAt: a.receivedAt.toISOString(),
    sender: a.sender,
    mode: a.mode,
    ticker: a.ticker,
    symbol: a.symbol,
    side: a.side,
    entry: a.entry,
    sl: a.sl,
    tp: a.tp,
    tpSource: a.tpSource,
    riskLevel: a.riskLevel,
    status: a.status,
    reason: a.reason,
  };
}

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
    if (alert.status === 'rechazada') store.appendLog('alert', alertLogPayload(alert));
    return { kind: 'alert', alert };
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
