// Pipeline: mensaje → alerta → validación. Pendiente de implementar (T044).
import type { Store } from './adapters/store.ts';
import type { Clock, FieldExtractor, IncomingEdit, IncomingMessage, MarketData } from './ports.ts';
import type { Alert, Mode } from './domain/types.ts';

export interface PipelineDeps {
  store: Store;
  clock: Clock;
  mode: Mode;
  authorizedSenders: readonly string[];
  extractor: FieldExtractor;
  market: MarketData;
  maxSlDistancePct: number;
}

export type ProcessOutcome = { kind: 'ignored' } | { kind: 'alert'; alert: Alert };

export class Pipeline {
  constructor(_deps: PipelineDeps) {}
  async processMessage(_m: IncomingMessage): Promise<ProcessOutcome> {
    throw new Error('pipeline: no implementado');
  }
  async processEdit(_e: IncomingEdit): Promise<void> {
    throw new Error('pipeline: no implementado');
  }
}
