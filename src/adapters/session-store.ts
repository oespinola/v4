// Sesión de WhatsApp cifrada (FR-049, AC-29). Store de `RemoteAuth` de whatsapp-web.js: RemoteAuth
// comprime el perfil de Chromium en `<dataPath>/<session>.zip` y llama a `save`; acá se cifra con
// AES-256-GCM y la clave de WHATSAPP_SESSION_KEY, en un archivo 0600 dentro de un directorio 0700,
// y RemoteAuth borra el zip en claro. `extract` descifra en memoria y solo escribe el zip si la
// clave es la correcta.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { chmod, mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export interface SessionStoreOptions {
  /** Directorio de RemoteAuth (`dataPath`): ahí deja el zip y ahí se guarda el cifrado. */
  dataPath: string;
  /** 32 bytes (FR-049). */
  key: Buffer;
}

// Formato: "SBS1" | IV (12 bytes) | tag de GCM (16 bytes) | zip cifrado.
const MAGIC = Buffer.from('SBS1');
const IV_BYTES = 12;
const TAG_BYTES = 16;

const exists = (p: string) =>
  stat(p).then(
    () => true,
    () => false,
  );

export class EncryptedSessionStore {
  constructor(private readonly opts: SessionStoreOptions) {}

  private file(session: string): string {
    return path.join(this.opts.dataPath, `${session}.session.enc`);
  }

  private async ensureDir(): Promise<void> {
    await mkdir(this.opts.dataPath, { recursive: true, mode: 0o700 });
    await chmod(this.opts.dataPath, 0o700);
  }

  async sessionExists({ session }: { session: string }): Promise<boolean> {
    return exists(this.file(session));
  }

  async save({ session }: { session: string }): Promise<void> {
    await this.ensureDir();
    const zip = await readFile(path.join(this.opts.dataPath, `${session}.zip`));
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv('aes-256-gcm', this.opts.key, iv);
    const body = Buffer.concat([cipher.update(zip), cipher.final()]);
    // Escritura atómica: un corte a mitad no deja una sesión rota en lugar de la anterior.
    const tmp = `${this.file(session)}.tmp`;
    await writeFile(tmp, Buffer.concat([MAGIC, iv, cipher.getAuthTag(), body]), { mode: 0o600 });
    await chmod(tmp, 0o600);
    await rename(tmp, this.file(session));
  }

  async extract({ session, path: out }: { session: string; path: string }): Promise<void> {
    const data = await readFile(this.file(session));
    if (!data.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('sesión de WhatsApp con formato desconocido');
    const iv = data.subarray(MAGIC.length, MAGIC.length + IV_BYTES);
    const tag = data.subarray(MAGIC.length + IV_BYTES, MAGIC.length + IV_BYTES + TAG_BYTES);
    const decipher = createDecipheriv('aes-256-gcm', this.opts.key, iv);
    decipher.setAuthTag(tag);
    let zip: Buffer;
    try {
      zip = Buffer.concat([decipher.update(data.subarray(MAGIC.length + IV_BYTES + TAG_BYTES)), decipher.final()]);
    } catch {
      throw new Error('no se pudo descifrar la sesión de WhatsApp: ¿cambió WHATSAPP_SESSION_KEY?');
    }
    await writeFile(out, zip, { mode: 0o600 });
  }

  async delete({ session }: { session: string }): Promise<void> {
    await rm(this.file(session), { force: true });
  }
}

/** Borra el perfil de trabajo en claro de RemoteAuth y lo que pueda haber dejado una caída. */
export async function wipeWorkingProfile(dataPath: string, session: string, clientId: string): Promise<void> {
  for (const leftover of [session, `wwebjs_temp_session_${clientId}`, `${session}.zip`]) {
    await rm(path.join(dataPath, leftover), { recursive: true, force: true, maxRetries: 4 });
  }
}
