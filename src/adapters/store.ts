// Persistencia local (data-model.md): SQLite (`node:sqlite`) para alertas, ediciones y operaciones,
// y un log JSONL con una línea por evento. Todo lo que crea el proceso lo lee solo su usuario:
// umask 077, `data/` en 0700 y archivos en 0600 (FR-046).
import { appendFileSync, chmodSync, closeSync, existsSync, mkdirSync, openSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type { Clock } from '../ports.ts';
import { buildAlertLogRecord } from '../domain/log-record.ts';
import type { Alert, Trade, TradeState } from '../domain/types.ts';

export interface EditRecord {
  alertId: string;
  editedAt: Date;
  previousText: string;
  newText: string;
  changedFields: string[];
}

export type LogType = 'alert' | 'edit' | 'connection' | 'critical';

/** Evento `connection` (contracts/log-record.md, FR-055). */
export interface ConnectionEvent {
  service: 'whatsapp' | 'binance';
  event: 'interrupción' | 'reintento' | 'reconectado';
  attempt: number;
  waitMs: number | null;
}

/** Evento `critical` (contracts/log-record.md, FR-030, FR-038, FR-055). */
export interface CriticalEvent {
  kind: 'cierre de emergencia' | 'falla del cierre de emergencia' | 'SL/TP perdido' | 'reconexión agotada' | 'entrada sin confirmar';
  alertId?: string | null;
  detail: string;
}

/** Estados que ocupan cupo y bloquean el símbolo (FR-025, FR-026, FR-063). */
const ACTIVE: TradeState[] = ['pendiente', 'con_ejecución', 'abierta'];

const DATE_KEYS = new Set(['receivedAt', 'classifiedAt', 'entryPlacedAt', 'closedAt', 'editedAt']);

const revive = <T>(json: string): T =>
  JSON.parse(json, (k, v) => (DATE_KEYS.has(k) && typeof v === 'string' ? new Date(v) : v)) as T;

/** Crea el archivo vacío en 0600 si no existe y corrige el modo si ya existía. */
function ensurePrivateFile(file: string): void {
  if (!existsSync(file)) closeSync(openSync(file, 'a', 0o600));
  chmodSync(file, 0o600);
}

export class Store {
  private constructor(
    private readonly db: DatabaseSync,
    private readonly logFile: string,
    private readonly clock: Clock,
  ) {}

  static open(dir: string, clock: Clock): Store {
    process.umask(0o077);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    chmodSync(dir, 0o700);
    const dbFile = path.join(dir, 'signalbridge.db');
    const logFile = path.join(dir, 'alerts.log');
    ensurePrivateFile(dbFile);
    ensurePrivateFile(logFile);

    const db = new DatabaseSync(dbFile);
    db.exec(`
      CREATE TABLE IF NOT EXISTS alerts (
        alert_id      TEXT PRIMARY KEY,
        wa_message_id TEXT NOT NULL UNIQUE,
        content_hash  TEXT NOT NULL,
        received_at   INTEGER NOT NULL,
        status        TEXT NOT NULL,
        reason        TEXT,
        record        TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS alerts_hash ON alerts (content_hash, received_at);
      CREATE TABLE IF NOT EXISTS edits (
        alert_id  TEXT NOT NULL,
        edited_at INTEGER NOT NULL,
        record    TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS trades (
        alert_id TEXT PRIMARY KEY,
        symbol   TEXT NOT NULL,
        state    TEXT NOT NULL,
        notional REAL NOT NULL,
        record   TEXT NOT NULL
      );
    `);
    // SQLite crea archivos auxiliares (-wal, -journal) con el umask ya en 077.
    return new Store(db, logFile, clock);
  }

  saveAlert(a: Alert): void {
    this.db
      .prepare(
        `INSERT INTO alerts (alert_id, wa_message_id, content_hash, received_at, status, reason, record)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (alert_id) DO UPDATE SET status = excluded.status, reason = excluded.reason,
           record = excluded.record`,
      )
      .run(a.alertId, a.waMessageId, a.contentHash, a.receivedAt.getTime(), a.status, a.reason, JSON.stringify(a));
  }

  getAlert(alertId: string): Alert | undefined {
    const row = this.db.prepare('SELECT record FROM alerts WHERE alert_id = ?').get(alertId);
    return row ? revive<Alert>(row.record as string) : undefined;
  }

  findByWaMessageId(id: string): Alert | undefined {
    const row = this.db.prepare('SELECT record FROM alerts WHERE wa_message_id = ?').get(id);
    return row ? revive<Alert>(row.record as string) : undefined;
  }

  /** Bloquean un reenvío las alertas no rechazadas, salvo una "entrada no ejecutada" cuya orden
   *  nunca quedó en Binance: esa no tiene operación registrada (FR-007, FR-069). Una entrada que
   *  venció sin ejecutarse sí la tiene y sigue bloqueando. */
  hasContentHashSince(hash: string, since: Date): boolean {
    const row = this.db
      .prepare(
        `SELECT 1 FROM alerts a WHERE a.content_hash = ? AND a.received_at >= ? AND a.status <> 'rechazada'
           AND NOT (a.status = 'entrada no ejecutada'
                    AND NOT EXISTS (SELECT 1 FROM trades t WHERE t.alert_id = a.alert_id))
         LIMIT 1`,
      )
      .get(hash, since.getTime());
    return row !== undefined;
  }

  saveEdit(e: EditRecord): void {
    this.db
      .prepare('INSERT INTO edits (alert_id, edited_at, record) VALUES (?, ?, ?)')
      .run(e.alertId, e.editedAt.getTime(), JSON.stringify(e));
  }

  editsOf(alertId: string): EditRecord[] {
    return this.db
      .prepare('SELECT record FROM edits WHERE alert_id = ? ORDER BY edited_at')
      .all(alertId)
      .map((r) => revive<EditRecord>(r.record as string));
  }

  saveTrade(t: Trade): void {
    this.db
      .prepare(
        `INSERT INTO trades (alert_id, symbol, state, notional, record) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (alert_id) DO UPDATE SET symbol = excluded.symbol, state = excluded.state,
           notional = excluded.notional, record = excluded.record`,
      )
      .run(t.alertId, t.symbol, t.state, t.notional, JSON.stringify(t));
  }

  getTrade(alertId: string): Trade | undefined {
    const row = this.db.prepare('SELECT record FROM trades WHERE alert_id = ?').get(alertId);
    return row ? revive<Trade>(row.record as string) : undefined;
  }

  exposure(): { positions: number; notional: number } {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS n, COALESCE(SUM(notional), 0) AS total FROM trades
         WHERE state IN (${ACTIVE.map(() => '?').join(',')})`,
      )
      .get(...ACTIVE);
    return { positions: Number(row?.n ?? 0), notional: Number(row?.total ?? 0) };
  }

  activeTradeForSymbol(symbol: string): Trade | undefined {
    const row = this.db
      .prepare(`SELECT record FROM trades WHERE symbol = ? AND state IN (${ACTIVE.map(() => '?').join(',')}) LIMIT 1`)
      .get(symbol, ...ACTIVE);
    return row ? revive<Trade>(row.record as string) : undefined;
  }

  tradesInState(state: TradeState): Trade[] {
    return this.db
      .prepare('SELECT record FROM trades WHERE state = ? ORDER BY rowid')
      .all(state)
      .map((r) => revive<Trade>(r.record as string));
  }

  /** Una línea JSON por evento, con `type` y `at` primero (contracts/log-record.md). */
  appendLog(type: LogType, payload: Record<string, unknown>): void {
    const line = JSON.stringify({ type, at: this.clock.now().toISOString(), ...payload });
    appendFileSync(this.logFile, `${line}\n`, { mode: 0o600 });
  }

  /** Registro `alert` de un estado final (contracts/log-record.md). */
  logAlert(alert: Alert, trade: Trade | null = null): void {
    this.appendLog('alert', { ...buildAlertLogRecord(alert, trade) });
  }

  logConnection(e: ConnectionEvent): void {
    this.appendLog('connection', { service: e.service, event: e.event, attempt: e.attempt, waitMs: e.waitMs });
  }

  logCritical(e: CriticalEvent): void {
    this.appendLog('critical', { kind: e.kind, alertId: e.alertId ?? null, detail: e.detail });
  }

  close(): void {
    this.db.close();
  }
}
