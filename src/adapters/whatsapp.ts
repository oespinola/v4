// Adaptador de WhatsApp (FR-048, FR-057, FR-047), sobre whatsapp-web.js. La lógica que decide qué
// mensajes pasan (grupo, en vivo, remitente) es pura y se prueba con un EventEmitter (wireClient);
// WhatsAppSource solo arma el cliente real.
//
// Sesión (FR-049): RemoteAuth con el store cifrado de session-store.ts. Con el proceso detenido solo
// queda la sesión cifrada: el perfil de trabajo de Chromium (en claro) se borra al cerrar y también
// al arrancar, por si quedó de un `kill -9`.
import { chmod, mkdir } from 'node:fs/promises';
import qrcode from 'qrcode-terminal';
import wwebjs from 'whatsapp-web.js';
import { normalizeSender } from '../domain/filter.ts';
import { EncryptedSessionStore, wipeWorkingProfile } from './session-store.ts';
import type { IncomingEdit, IncomingMessage, MessageSource } from '../ports.ts';

const { Client, RemoteAuth } = wwebjs;

const CLIENT_ID = 'signalbridge';
const SESSION_NAME = `RemoteAuth-${CLIENT_ID}`;
/** Respaldo periódico de la sesión cifrada mientras corre (RemoteAuth pide ≥ 60 s). */
const BACKUP_EVERY_MS = 5 * 60_000;

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

function toIncoming(m: RawWaMessage, ownId: string, arrivedAt: Date): IncomingMessage {
  return {
    waMessageId: idOf(m),
    sender: senderOf(m, ownId),
    text: m.body, // en mensajes con imagen, wwebjs ya trae acá el caption
    timestamp: new Date(m.timestamp * 1000),
    arrivedAt,
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
    if (inGroup(m) && isLive(m)) h.onMessage(toIncoming(m, h.ownId(), h.now()));
  });
  client.on('message_edit', (m: RawWaMessage, newBody: unknown, prevBody: unknown) => {
    if (!inGroup(m)) return;
    h.onEdit({ waMessageId: idOf(m), newText: String(newBody), previousText: String(prevBody), editedAt: h.now() });
  });
}

/** Etapa del arranque con el tiempo transcurrido (FR-072). */
export function startupLine(startedAt: number, now: number, stage: string): string {
  return `WhatsApp +${((now - startedAt) / 1000).toFixed(1)} s: ${stage}`;
}

/** Engancha las etapas del arranque de WhatsApp Web, para el modo detallado (FR-072). */
export function wireStages(client: GroupEvents, stage: (text: string) => void): void {
  let lastPercent = -1;
  client.on('authenticated', () => stage('sesión autenticada'));
  client.on('loading_screen', (percent: unknown, message: unknown) => {
    if (Number(percent) === lastPercent) return;
    lastPercent = Number(percent);
    stage(`cargando chats ${percent} %${message ? ` (${message})` : ''}`);
  });
  client.on('change_state', (state: unknown) => stage(`estado ${state}`));
  client.on('ready', () => stage('WhatsApp Web listo; buscando el grupo'));
}

/** Aviso del grupo que no está, con la lista de grupos de la cuenta (FR-072). */
export function missingGroupLines(groupName: string, groups: readonly string[]): string[] {
  return [`No encontré el grupo "${groupName}". Tus grupos:`, ...groups.map((g) => `  - ${g}`)];
}

/** WhatsApp Web salta a esta dirección cuando la sesión vinculada ya no vale (el dispositivo se
 *  desvinculó desde el teléfono, o WhatsApp la cerró). */
export function isLogoutUrl(url: string | undefined): boolean {
  return url?.includes('post_logout=1') ?? false;
}

/** Arranca el cliente; si falla porque WhatsApp cerró la sesión, la descarta y arranca una vez más,
 *  ahora sin sesión, para que aparezca el QR (FR-048). Sin esto, la redirección a la página de
 *  logout corta el arranque con "Execution context was destroyed" y la app reinicia en loop. */
export async function startOrRelink(steps: {
  start(): Promise<void>;
  loggedOut(): Promise<boolean>;
  discardSession(): Promise<void>;
  log(line: string): void;
}): Promise<void> {
  try {
    await steps.start();
  } catch (err) {
    if (!(await steps.loggedOut())) throw err;
    steps.log('WhatsApp cerró la sesión vinculada: se descarta y se pide un QR nuevo.');
    await steps.discardSession();
    await steps.start();
  }
}

/** La redirección al logout llega casi junto con el error del arranque: se la espera un poco. */
async function landedOnLogout(client: wwebjs.Client | null): Promise<boolean> {
  for (let i = 0; i < 15; i++) {
    let url: string | undefined;
    try {
      url = client?.pupPage?.url();
    } catch {
      return false; // la página ya se cerró
    }
    if (isLogoutUrl(url)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// ── Cliente real ──────────────────────────────────────────────────────────────

export interface WhatsAppOptions {
  authDir: string;
  /** WHATSAPP_SESSION_KEY, 32 bytes (FR-049). */
  sessionKey: Buffer;
  groupName: string;
  now(): Date;
  log(line: string): void;
  /** FR-072: etapas del arranque y lista de grupos si falta el configurado. */
  verbose?: boolean;
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

/** Nombres de los grupos de la cuenta, por la misma vía que findGroupId. */
async function listGroupNames(client: wwebjs.Client): Promise<string[]> {
  return client.pupPage!.evaluate(() =>
    (globalThis as any)
      .require('WAWebCollections')
      .Chat.getModelsArray()
      .filter((c: any) => c.groupMetadata)
      .map((c: any) => c.formattedTitle as string),
  );
}

export class WhatsAppSource implements MessageSource {
  private readonly messageCbs: ((m: IncomingMessage) => void)[] = [];
  private readonly editCbs: ((e: IncomingEdit) => void)[] = [];
  private readonly connCbs: ((up: boolean) => void)[] = [];
  private client: wwebjs.Client | null = null;
  private auth: InstanceType<typeof RemoteAuth> | null = null;
  private store: EncryptedSessionStore | null = null;
  private ready = false;

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
    await startOrRelink({
      start: () => this.launch(),
      loggedOut: () => landedOnLogout(this.client),
      discardSession: async () => {
        if (this.client?.pupBrowser) await this.client.destroy().catch(() => {});
        await this.store?.delete({ session: SESSION_NAME });
        await wipeWorkingProfile(this.opts.authDir, SESSION_NAME, CLIENT_ID);
      },
      log: this.opts.log,
    });
  }

  private async launch(): Promise<void> {
    await mkdir(this.opts.authDir, { recursive: true, mode: 0o700 });
    await chmod(this.opts.authDir, 0o700);
    await wipeWorkingProfile(this.opts.authDir, SESSION_NAME, CLIENT_ID);
    const store = new EncryptedSessionStore({ dataPath: this.opts.authDir, key: this.opts.sessionKey });
    this.store = store;
    const auth = new RemoteAuth({
      clientId: CLIENT_ID,
      dataPath: this.opts.authDir,
      store,
      backupSyncIntervalMs: BACKUP_EVERY_MS,
    });
    this.auth = auth;
    const client = new Client({
      authStrategy: auth,
      // El cierre lo hace la app (stop): si Puppeteer mata Chromium ante Ctrl+C a mitad del
      // arranque, la sesión queda a medio guardar.
      puppeteer: { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false },
    });
    this.client = client;
    const startedAt = Date.now();
    const stage = (text: string) => this.opts.log(startupLine(startedAt, Date.now(), text));
    if (this.opts.verbose) {
      stage('abriendo Chromium y WhatsApp Web');
      wireStages(client, stage);
    }
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
        this.ready = up;
        this.opts.log(up ? `WhatsApp listo. Escuchando "${this.opts.groupName}".` : 'WhatsApp desconectado.');
        this.connCbs.forEach((cb) => cb(up));
      },
      onGroupMissing: async () => {
        if (!this.opts.verbose) return this.opts.log(`No encontré el grupo "${this.opts.groupName}".`);
        const groups = await listGroupNames(client).catch(() => []);
        for (const line of missingGroupLines(this.opts.groupName, groups)) this.opts.log(line);
      },
    });
    client.on('auth_failure', (msg: string) => this.opts.log(`Falló la autenticación de WhatsApp: ${msg}`));
    client.on('remote_session_saved', () => this.opts.log('Sesión de WhatsApp guardada (cifrada).'));
    await client.initialize();
    if (this.opts.verbose) stage('Chromium y la página cargados');
  }

  /** Vuelve a conectar tras un corte (FR-055). */
  async reconnect(): Promise<void> {
    await this.stop();
    await this.start();
  }

  /** Guarda la sesión cifrada, cierra Chromium y borra el perfil de trabajo en claro. */
  async stop(): Promise<void> {
    // RemoteAuth recién guarda 60 s después de vincular: si se cierra antes, se guarda acá.
    const auth = this.auth as unknown as { storeRemoteSession?: () => Promise<void> } | null;
    if (this.ready && auth?.storeRemoteSession) {
      await auth.storeRemoteSession().catch((e: unknown) => this.opts.log(`No se pudo guardar la sesión: ${String(e)}`));
    }
    if (this.client?.pupBrowser) await this.client.destroy();
    this.client = null;
    this.auth = null;
    this.store = null;
    this.ready = false;
    await wipeWorkingProfile(this.opts.authDir, SESSION_NAME, CLIENT_ID);
  }
}
