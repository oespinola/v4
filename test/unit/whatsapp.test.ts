import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import {
  isLogoutUrl,
  missingGroupLines,
  senderOf,
  startOrRelink,
  startupLine,
  wireClient,
  wireStages,
  type RawWaMessage,
  type WireHandlers,
} from '../../src/adapters/whatsapp.ts';
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
  it('sin sesión guardada entrega el QR para vincular la cuenta (AC-10)', () => {
    const { client, got } = setup();
    client.emit('qr', 'QR-DATA');
    expect(got.qr).toEqual(['QR-DATA']);
  });

  it('normaliza el remitente sin sufijo de dispositivo; los propios usan la cuenta vinculada', () => {
    expect(senderOf(raw(), '5491100000009@c.us')).toBe('5491100000001');
    expect(senderOf(raw({ fromMe: true, author: undefined }), '5491100000009:2@c.us')).toBe('5491100000009');
  });

  it('entrega los mensajes del grupo con ID, remitente, texto y hora', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_create', raw());
    await flush();
    expect(got.messages).toEqual([
      expect.objectContaining({ waMessageId: 'ABC123', sender: '5491100000001', text: 'KAIA - ALERTA DE TRADING', timestamp: new Date('2026-10-28T12:00:10Z') }),
    ]);
  });

  it('marca la hora de llegada al sistema con el reloj, no la del teléfono (SC-001)', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_create', raw());
    await flush();
    expect(got.messages[0]?.arrivedAt).toBeInstanceOf(Date);
    expect(got.messages[0]?.arrivedAt?.getTime()).not.toBe(got.messages[0]?.timestamp.getTime());
  });

  it('ignora mensajes de otros grupos y los que llegan antes de encontrar el grupo', async () => {
    const { client, got } = setup();
    client.emit('message_create', raw());
    await ready(client);
    client.emit('message_create', raw({ from: OTHER }));
    await flush();
    expect(got.messages).toEqual([]);
  });

  it('descarta mensajes enviados antes de la conexión (período sin conexión, FR-057)', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_create', raw({ timestamp: sec('2026-10-28T11:30:00Z') }));
    client.emit('message_create', raw({ id: { id: 'NEW', _serialized: 'x' }, timestamp: sec('2026-10-28T12:00:01Z') }));
    await flush();
    expect(got.messages.map((m) => m.waMessageId)).toEqual(['NEW']);
  });

  it('reenvía las ediciones del grupo con texto anterior y nuevo', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_edit', raw(), 'nuevo', 'viejo');
    await flush();
    expect(got.edits).toEqual([expect.objectContaining({ waMessageId: 'ABC123', newText: 'nuevo', previousText: 'viejo' })]);
  });

  it('informa la conexión: ready = arriba, disconnected = abajo', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('disconnected', 'NAVIGATION');
    expect(got.conn).toEqual([true, false]);
  });

  it('si no encuentra el grupo lo informa', async () => {
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

  it('la descarga de imagen devuelve un Buffer desde el base64 de WhatsApp', async () => {
    const { client, got } = setup();
    await ready(client);
    client.emit('message_create', raw({ hasMedia: true, downloadMedia: async () => ({ data: Buffer.from('img').toString('base64'), mimetype: 'image/jpeg' }) }));
    await flush();
    expect(await got.messages[0]?.downloadImage()).toEqual(Buffer.from('img'));
  });
});

describe('adaptador de WhatsApp: sesión cerrada por WhatsApp (FR-048)', () => {
  const logoutError = new Error('Protocol error (Runtime.callFunctionOn): Execution context was destroyed.');

  function steps(opts: { failures: Error[]; loggedOut: boolean }) {
    const seen = { starts: 0, discarded: 0, logs: [] as string[] };
    return {
      seen,
      steps: {
        start: async () => {
          seen.starts += 1;
          const err = opts.failures.shift();
          if (err) throw err;
        },
        loggedOut: async () => opts.loggedOut,
        discardSession: async () => void (seen.discarded += 1),
        log: (line: string) => seen.logs.push(line),
      },
    };
  }

  it('reconoce la página de logout de WhatsApp Web', () => {
    expect(isLogoutUrl('https://web.whatsapp.com/?post_logout=1')).toBe(true);
    expect(isLogoutUrl('https://web.whatsapp.com/')).toBe(false);
    expect(isLogoutUrl(undefined)).toBe(false);
  });

  it('si el arranque cae en el logout, descarta la sesión y arranca de nuevo para pedir el QR', async () => {
    const { steps: s, seen } = steps({ failures: [logoutError], loggedOut: true });
    await startOrRelink(s);
    expect(seen).toMatchObject({ starts: 2, discarded: 1 });
    expect(seen.logs).toEqual(['WhatsApp cerró la sesión vinculada: se descarta y se pide un QR nuevo.']);
  });

  it('si el arranque falla por otra cosa, no toca la sesión y propaga el error', async () => {
    const { steps: s, seen } = steps({ failures: [logoutError], loggedOut: false });
    await expect(startOrRelink(s)).rejects.toThrow('Execution context was destroyed');
    expect(seen).toMatchObject({ starts: 1, discarded: 0 });
  });

  it('vuelve a vincular una sola vez: si el segundo arranque también falla, propaga el error', async () => {
    const { steps: s, seen } = steps({ failures: [logoutError, logoutError], loggedOut: true });
    await expect(startOrRelink(s)).rejects.toThrow('Execution context was destroyed');
    expect(seen).toMatchObject({ starts: 2, discarded: 1 });
  });

  it('si arranca bien, no descarta la sesión', async () => {
    const { steps: s, seen } = steps({ failures: [], loggedOut: true });
    await startOrRelink(s);
    expect(seen).toMatchObject({ starts: 1, discarded: 0 });
  });
});

describe('adaptador de WhatsApp: modo detallado (FR-072)', () => {
  it('cada etapa del arranque lleva el tiempo transcurrido', () => {
    expect(startupLine(1_000, 2_500, 'sesión autenticada')).toBe('WhatsApp +1.5 s: sesión autenticada');
  });

  it('engancha las etapas del arranque, sin repetir el mismo porcentaje de carga', () => {
    const client = new EventEmitter();
    const stages: string[] = [];
    wireStages(client, (s) => void stages.push(s));
    client.emit('authenticated');
    client.emit('loading_screen', 50, 'WhatsApp');
    client.emit('loading_screen', 50, 'WhatsApp');
    client.emit('loading_screen', 100, '');
    client.emit('change_state', 'CONNECTED');
    client.emit('ready');
    expect(stages).toEqual([
      'sesión autenticada',
      'cargando chats 50 % (WhatsApp)',
      'cargando chats 100 %',
      'estado CONNECTED',
      'WhatsApp Web listo; buscando el grupo',
    ]);
  });

  it('si no encuentra el grupo, lista los grupos de la cuenta', () => {
    expect(missingGroupLines('ALERTAS', ['Familia', 'ALERTAS CRYPTO+'])).toEqual([
      'No encontré el grupo "ALERTAS". Tus grupos:',
      '  - Familia',
      '  - ALERTAS CRYPTO+',
    ]);
  });
});
