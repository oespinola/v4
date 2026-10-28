import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { senderOf, wireClient, type RawWaMessage, type WireHandlers } from '../../src/adapters/whatsapp.ts';
import type { IncomingEdit, IncomingMessage } from '../../src/ports.ts';
import { flush } from '../fakes/index.ts';

const GROUP = '120363000000000001@g.us';
const OTHER = '120363000000000002@g.us';
const CONNECTED_AT = new Date('2026-10-28T12:00:00Z');
const sec = (iso: string) => Date.parse(iso) / 1000;

function raw(over: Partial<RawWaMessage> = {}): RawWaMessage {
  return {
    id: { id: 'ABC123', _serialized: 'false_120363@g.us_ABC123' },
    from: GROUP,
    to: '5491100000009@c.us',
    author: '5491100000001:1@c.us',
    fromMe: false,
    body: 'KAIA - ALERTA DE TRADING',
    timestamp: sec('2026-10-28T12:00:10Z'),
    hasMedia: false,
    downloadMedia: async () => null,
    ...over,
  };
}

function setup() {
  const client = new EventEmitter();
  const got = { qr: [] as string[], messages: [] as IncomingMessage[], edits: [] as IncomingEdit[], conn: [] as boolean[], missing: 0 };
  const handlers: WireHandlers = {
    ownId: () => '5491100000009@c.us',
    findGroup: async () => GROUP,
    now: () => CONNECTED_AT,
    onQr: (qr) => got.qr.push(qr),
    onMessage: (m) => got.messages.push(m),
    onEdit: (e) => got.edits.push(e),
    onConnectionChange: (up) => got.conn.push(up),
    onGroupMissing: () => got.missing++,
  };
  wireClient(client, handlers);
  return { client, got };
}

const ready = async (client: EventEmitter) => {
  client.emit('ready');
  await flush();
};

describe('adaptador de WhatsApp: lógica pura (FR-048, FR-057)', () => {
  it.fails('sin sesión guardada entrega el QR para vincular la cuenta (AC-10)', () => {
    const { client, got } = setup();
    client.emit('qr', 'QR-DATA');
    expect(got.qr).toEqual(['QR-DATA']);
  });

  it.fails('normaliza el remitente sin sufijo de dispositivo; los propios usan la cuenta vinculada', () => {
    expect(senderOf(raw(), '5491100000009@c.us')).toBe('5491100000001');
    expect(senderOf(raw({ fromMe: true, author: undefined }), '5491100000009:2@c.us')).toBe('5491100000009');
  });

  it.fails('entrega los mensajes del grupo con ID, remitente, texto y hora', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_create', raw());
    await flush();
    expect(got.messages).toEqual([
      expect.objectContaining({ waMessageId: 'ABC123', sender: '5491100000001', text: 'KAIA - ALERTA DE TRADING', timestamp: new Date('2026-10-28T12:00:10Z') }),
    ]);
  });

  it.fails('ignora mensajes de otros grupos y los que llegan antes de encontrar el grupo', async () => {
    const { client, got } = setup();
    client.emit('message_create', raw());
    await ready(client);
    client.emit('message_create', raw({ from: OTHER }));
    await flush();
    expect(got.messages).toEqual([]);
  });

  it.fails('descarta mensajes enviados antes de la conexión (período sin conexión, FR-057)', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_create', raw({ timestamp: sec('2026-10-28T11:30:00Z') }));
    client.emit('message_create', raw({ id: { id: 'NEW', _serialized: 'x' }, timestamp: sec('2026-10-28T12:00:01Z') }));
    await flush();
    expect(got.messages.map((m) => m.waMessageId)).toEqual(['NEW']);
  });

  it.fails('reenvía las ediciones del grupo con texto anterior y nuevo', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_edit', raw(), 'nuevo', 'viejo');
    await flush();
    expect(got.edits).toEqual([expect.objectContaining({ waMessageId: 'ABC123', newText: 'nuevo', previousText: 'viejo' })]);
  });

  it.fails('informa la conexión: ready = arriba, disconnected = abajo', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('disconnected', 'NAVIGATION');
    expect(got.conn).toEqual([true, false]);
  });

  it.fails('si no encuentra el grupo lo informa', async () => {
    const client = new EventEmitter();
    let missing = 0;
    wireClient(client, {
      ownId: () => 'x',
      findGroup: async () => null,
      now: () => CONNECTED_AT,
      onQr: () => {},
      onMessage: () => {},
      onEdit: () => {},
      onConnectionChange: () => {},
      onGroupMissing: () => missing++,
    });
    await ready(client);
    expect(missing).toBe(1);
  });

  it.fails('la descarga de imagen devuelve un Buffer desde el base64 de WhatsApp', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_create', raw({ hasMedia: true, downloadMedia: async () => ({ data: Buffer.from('img').toString('base64'), mimetype: 'image/jpeg' }) }));
    await flush();
    expect(await got.messages[0]?.downloadImage()).toEqual(Buffer.from('img'));
  });
});
