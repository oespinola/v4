import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EncryptedSessionStore, wipeWorkingProfile } from '../../src/adapters/session-store.ts';

const KEY = Buffer.alloc(32, 7);
const SESSION = 'RemoteAuth-signalbridge';
const PHONE = '5491123456789';
const perms = (p: string) => statSync(p).mode & 0o777;

describe('sesión de WhatsApp cifrada (FR-049, AC-29)', () => {
  let root: string;
  let dataPath: string;
  let store: EncryptedSessionStore;
  const zipPath = () => path.join(dataPath, `${SESSION}.zip`);
  const zipContent = Buffer.from(`PK\x03\x04 perfil de Chromium con la cuenta ${PHONE}@c.us`);

  beforeEach(() => {
    root = mkdtempSync(path.join(tmpdir(), 'sb-session-'));
    dataPath = path.join(root, '.wwebjs_auth');
    store = new EncryptedSessionStore({ dataPath, key: KEY });
  });

  afterEach(() => rmSync(root, { recursive: true, force: true }));

  /** Lo que hace RemoteAuth antes de llamar a save: deja el zip en claro en dataPath. */
  const leaveZip = () => {
    mkdirSync(dataPath, { recursive: true });
    writeFileSync(zipPath(), zipContent);
  };

  it.fails('ida y vuelta: guarda cifrado y lo devuelve igual', async () => {
    expect(await store.sessionExists({ session: SESSION })).toBe(false);
    leaveZip();
    await store.save({ session: SESSION });
    expect(await store.sessionExists({ session: SESSION })).toBe(true);
    const out = path.join(dataPath, 'restaurado.zip');
    await store.extract({ session: SESSION, path: out });
    expect(readFileSync(out)).toEqual(zipContent);
  });

  it.fails('lo guardado no contiene el número en texto plano y queda 0600 en un directorio 0700', async () => {
    leaveZip();
    await store.save({ session: SESSION });
    const saved = readdirSync(dataPath).filter((f) => f !== `${SESSION}.zip`);
    expect(saved).toHaveLength(1);
    const file = path.join(dataPath, saved[0]!);
    expect(readFileSync(file).includes(Buffer.from(PHONE))).toBe(false);
    expect(readFileSync(file).includes(zipContent)).toBe(false);
    expect(perms(file)).toBe(0o600);
    expect(perms(dataPath)).toBe(0o700);
  });

  it.fails('con otra clave falla y no deja el zip en claro', async () => {
    leaveZip();
    await store.save({ session: SESSION });
    const other = new EncryptedSessionStore({ dataPath, key: Buffer.alloc(32, 9) });
    const out = path.join(dataPath, 'restaurado.zip');
    await expect(other.extract({ session: SESSION, path: out })).rejects.toThrow();
    expect(existsSync(out)).toBe(false);
  });

  it.fails('un archivo alterado no se descifra (GCM autentica)', async () => {
    leaveZip();
    await store.save({ session: SESSION });
    const file = readdirSync(dataPath).find((f) => f !== `${SESSION}.zip`)!;
    const bytes = readFileSync(path.join(dataPath, file));
    bytes[bytes.length - 1]! ^= 0xff;
    writeFileSync(path.join(dataPath, file), bytes);
    await expect(store.extract({ session: SESSION, path: path.join(dataPath, 'x.zip') })).rejects.toThrow();
  });

  it.fails('delete borra la sesión guardada', async () => {
    leaveZip();
    await store.save({ session: SESSION });
    await store.delete({ session: SESSION });
    expect(await store.sessionExists({ session: SESSION })).toBe(false);
  });

  it.fails('wipeWorkingProfile borra el perfil en claro, la carpeta temporal y un zip suelto, y conserva el cifrado', async () => {
    leaveZip();
    await store.save({ session: SESSION });
    const profile = path.join(dataPath, SESSION, 'Default');
    const temp = path.join(dataPath, 'wwebjs_temp_session_signalbridge', 'Default');
    mkdirSync(profile, { recursive: true });
    mkdirSync(temp, { recursive: true });
    writeFileSync(path.join(profile, 'Cookies'), PHONE);
    writeFileSync(zipPath(), zipContent); // zip en claro que dejó una caída
    await wipeWorkingProfile(dataPath, SESSION, 'signalbridge');
    expect(existsSync(path.join(dataPath, SESSION))).toBe(false);
    expect(existsSync(path.join(dataPath, 'wwebjs_temp_session_signalbridge'))).toBe(false);
    expect(existsSync(zipPath())).toBe(false);
    expect(await store.sessionExists({ session: SESSION })).toBe(true);
  });
});
