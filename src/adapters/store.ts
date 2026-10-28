// Persistencia local: SQLite + log JSONL (data-model.md). Pendiente de implementar (T019).
import type { Clock } from '../ports.ts';
import type { Alert, Trade, TradeState } from '../domain/types.ts';

export interface EditRecord {
  alertId: string;
  editedAt: Date;
  previousText: string;
  newText: string;
  changedFields: string[];
}

export type LogType = 'alert' | 'edit' | 'connection' | 'critical';

export class Store {
  static open(_dir: string, _clock: Clock): Store {
    return new Store();
  }

  private ni(): never {
    throw new Error('Store: no implementado');
  }

  saveAlert(_a: Alert): void {
    this.ni();
  }
  getAlert(_alertId: string): Alert | undefined {
    return this.ni();
  }
  findByWaMessageId(_id: string): Alert | undefined {
    return this.ni();
  }
  hasContentHashSince(_hash: string, _since: Date): boolean {
    return this.ni();
  }
  saveEdit(_e: EditRecord): void {
    this.ni();
  }
  editsOf(_alertId: string): EditRecord[] {
    return this.ni();
  }
  saveTrade(_t: Trade): void {
    this.ni();
  }
  getTrade(_alertId: string): Trade | undefined {
    return this.ni();
  }
  exposure(): { positions: number; notional: number } {
    return this.ni();
  }
  activeTradeForSymbol(_symbol: string): Trade | undefined {
    return this.ni();
  }
  tradesInState(_state: TradeState): Trade[] {
    return this.ni();
  }
  appendLog(_type: LogType, _payload: Record<string, unknown>): void {
    this.ni();
  }
  close(): void {}
}
