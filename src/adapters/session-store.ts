// Sesión de WhatsApp cifrada (FR-049, AC-29). Store de `RemoteAuth` de whatsapp-web.js: RemoteAuth
// comprime el perfil de Chromium en `<dataPath>/<session>.zip` y llama a `save`; acá se cifra con
// AES-256-GCM y la clave de WHATSAPP_SESSION_KEY, en un archivo 0600 dentro de un directorio 0700,
// y RemoteAuth borra el zip en claro. `extract` descifra en memoria y solo escribe el zip si la
// clave es la correcta.

export interface SessionStoreOptions {
  /** Directorio de RemoteAuth (`dataPath`): ahí deja el zip y ahí se guarda el cifrado. */
  dataPath: string;
  /** 32 bytes (FR-049). */
  key: Buffer;
}

export class EncryptedSessionStore {
  constructor(private readonly opts: SessionStoreOptions) {}

  async sessionExists(_o: { session: string }): Promise<boolean> {
    throw new Error('no implementado');
  }

  async save(_o: { session: string }): Promise<void> {
    throw new Error('no implementado');
  }

  async extract(_o: { session: string; path: string }): Promise<void> {
    throw new Error('no implementado');
  }

  async delete(_o: { session: string }): Promise<void> {
    throw new Error('no implementado');
  }
}

/** Borra el perfil de trabajo en claro de RemoteAuth y lo que pueda haber dejado una caída. */
export async function wipeWorkingProfile(_dataPath: string, _session: string, _clientId: string): Promise<void> {
  throw new Error('no implementado');
}
