// Adaptador de WhatsApp (FR-048, FR-057, FR-047), sobre whatsapp-web.js. La lógica que decide qué
// mensajes pasan (grupo, en vivo, remitente) es pura y se prueba con un EventEmitter (wireClient);
// WhatsAppSource solo arma el cliente real.
//
// Sesión: por ahora LocalAuth en un directorio 0700; la sesión cifrada (FR-049) la reemplaza en
// T075 y es requisito antes de habilitar LIVE.
import { chmod, mkdir } from 'node:fs/promises';
import qrcode from 'qrcode-terminal';
import wwebjs from 'whatsapp-web.js';
import { normalizeSender } from '../domain/filter.ts';
import type { IncomingEdit, IncomingMessage, MessageSource } from '../ports.ts';

const { Client, LocalAuth } = wwebjs;

/** Lo que usamos de un mensaje de whatsapp-web.js. */
export interface RawWaMessage {
  id: { id?: string; _serialized: string };
  from: string;
  to: string;
  author?: string;
  fromMe: boolean;
  body: string;
  /** Segundos Unix, según el teléfono que lo envió. */
  timestamp: number;
  hasMedia: boolean;
  downloadMedia(): Promise<{ data: string; mimetype: string } | null | undefined>;
}

/** Lo que wireClient usa del cliente (en los tests alcanza un EventEmitter). */
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

/** Remitente sin sufijo de dispositivo; los mensajes propios usan la cuenta vinculada. */
export function senderOf(m: RawWaMessage, ownId: string): string {
  return normalizeSender(m.fromMe ? (m.author ?? ownId) : (m.author ?? m.from));
}

/** Parte única del ID: es la misma venga el mensaje de cualquier dispositivo. */
const idOf = (m: RawWaMessage) => m.id.id ?? m.id._serialized;

function toIncoming(m: RawWaMessage, ownId: string): IncomingMessage {
  return {
    waMessageId: idOf(m),
    sender: senderOf(m, ownId),
    text: m.body, // en mensajes con imagen, wwebjs ya trae acá el caption
    timestamp: new Date(m.timestamp * 1000),
    downloadImage: async () => {
      if (!m.hasMedia) return null;
      const media = await m.downloadMedia();
      return media ? Buffer.from(media.data, 'base64') : null;
    },
  };
}

/** Engancha los eventos del cliente. WhatsApp vuelve a emitir "ready" cuando recarga la página
 *  (por ejemplo, tras reconectar): cada "ready" busca el grupo y fija un nuevo momento de
 *  conexión; los mensajes enviados antes de ese momento no se procesan (FR-057). */
export function wireClient(client: GroupEvents, h: WireHandlers): void {
  let groupId: string | null = null;
  let connectedAt = Number.POSITIVE_INFINITY;
  const inGroup = (m: RawWaMessage) => groupId !== null && (m.fromMe ? m.to : m.from) === groupId;
  const isLive = (m: RawWaMessage) => m.timestamp * 1000 >= connectedAt;

  client.on('qr', (qr: string) => h.onQr(qr));
  client.on('ready', async () => {
    groupId = await h.findGroup();
    connectedAt = h.now().getTime();
    if (groupId === null) {
      h.onGroupMissing();
      return;
    }
    h.onConnectionChange(true);
  });
  client.on('disconnected', () => {
    connectedAt = Number.POSITIVE_INFINITY;
    h.onConnectionChange(false);
  });
  // message_create incluye los mensajes de la propia cuenta vinculada (el evento "message" los
  // omite); así el operador puede probar mandando alertas él mismo.
  client.on('message_create', (m: RawWaMessage) => {
    if (inGroup(m) && isLive(m)) h.onMessage(toIncoming(m, h.ownId()));
  });
  client.on('message_edit', (m: RawWaMessage, newBody: unknown, prevBody: unknown) => {
    if (!inGroup(m)) return;
    h.onEdit({ waMessageId: idOf(m), newText: String(newBody), previousText: String(prevBody), editedAt: h.now() });
  });
}

// ── Cliente real ──────────────────────────────────────────────────────────────

export interface WhatsAppOptions {
  authDir: string;
  groupName: string;
  now(): Date;
  log(line: string): void;
}

/** Busca el grupo en la página sin serializar todos los chats: getChats() y getChatById() fallan
 *  con "r: r" en este grupo (visto en v1). Lo de evaluate() corre en el navegador: no definir
 *  funciones con nombre adentro (tsx las envuelve con __name, que allá no existe). */
async function findGroupId(client: wwebjs.Client, name: string): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const id = await client.pupPage!.evaluate((groupName) => {
      const chats = (globalThis as any).require('WAWebCollections').Chat.getModelsArray();
      const group = chats.find((c: any) => c.groupMetadata && c.formattedTitle === groupName);
      return group ? (group.id._serialized as string) : null;
    }, name);
    if (id) return id;
    await new Promise((r) => setTimeout(r, 5000));
  }
  return null;
}

export class WhatsAppSource implements MessageSource {
  private readonly messageCbs: ((m: IncomingMessage) => void)[] = [];
  private readonly editCbs: ((e: IncomingEdit) => void)[] = [];
  private readonly connCbs: ((up: boolean) => void)[] = [];
  private client: wwebjs.Client | null = null;

  constructor(private readonly opts: WhatsAppOptions) {}

  onMessage(cb: (m: IncomingMessage) => void): void {
    this.messageCbs.push(cb);
  }
  onEdit(cb: (e: IncomingEdit) => void): void {
    this.editCbs.push(cb);
  }
  onConnectionChange(cb: (up: boolean) => void): void {
    this.connCbs.push(cb);
  }

  async start(): Promise<void> {
    await mkdir(this.opts.authDir, { recursive: true, mode: 0o700 });
    await chmod(this.opts.authDir, 0o700);
    const client = new Client({
      authStrategy: new LocalAuth({ dataPath: this.opts.authDir }),
      // El cierre lo hace la app (stop): si Puppeteer mata Chromium ante Ctrl+C a mitad del
      // arranque, la sesión queda a medio guardar.
      puppeteer: { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false },
    });
    this.client = client;
    wireClient(client, {
      ownId: () => client.info?.wid?._serialized ?? '',
      findGroup: () => findGroupId(client, this.opts.groupName),
      now: this.opts.now,
      onQr: (qr) => {
        this.opts.log('Escaneá este QR con WhatsApp (Dispositivos vinculados):');
        qrcode.generate(qr, { small: true });
      },
      onMessage: (m) => this.messageCbs.forEach((cb) => cb(m)),
      onEdit: (e) => this.editCbs.forEach((cb) => cb(e)),
      onConnectionChange: (up) => {
        this.opts.log(up ? `WhatsApp listo. Escuchando "${this.opts.groupName}".` : 'WhatsApp desconectado.');
        this.connCbs.forEach((cb) => cb(up));
      },
      onGroupMissing: () => this.opts.log(`No encontré el grupo "${this.opts.groupName}".`),
    });
    client.on('auth_failure', (msg: string) => this.opts.log(`Falló la autenticación de WhatsApp: ${msg}`));
    await client.initialize();
  }

  /** Cierra Chromium con calma para que guarde la sesión. */
  async stop(): Promise<void> {
    if (this.client?.pupBrowser) await this.client.destroy();
    this.client = null;
  }
}
