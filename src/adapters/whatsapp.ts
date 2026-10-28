// Adaptador de WhatsApp (FR-048, FR-057, FR-047). Pendiente de implementar (T046).
import type { IncomingEdit, IncomingMessage } from '../ports.ts';

export interface RawWaMessage {
  id: { id?: string; _serialized: string };
  from: string;
  to: string;
  author?: string;
  fromMe: boolean;
  body: string;
  timestamp: number;
  hasMedia: boolean;
  downloadMedia(): Promise<{ data: string; mimetype: string } | null | undefined>;
}

export interface GroupEvents {
  on(event: string, listener: (...args: any[]) => void): unknown;
}

export interface WireHandlers {
  ownId(): string;
  findGroup(): Promise<string | null>;
  now(): Date;
  onQr(qr: string): void;
  onMessage(m: IncomingMessage): void;
  onEdit(e: IncomingEdit): void;
  onConnectionChange(up: boolean): void;
  onGroupMissing(): void;
}

export function senderOf(_m: RawWaMessage, _ownId: string): string {
  throw new Error('whatsapp: no implementado');
}

export function wireClient(_client: GroupEvents, _h: WireHandlers): void {
  throw new Error('whatsapp: no implementado');
}
