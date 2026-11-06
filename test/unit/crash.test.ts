import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { handleCrashes } from '../../src/crash.ts';

function setup(opts: { recordFails?: boolean } = {}) {
  const proc = new EventEmitter();
  const got = { records: [] as string[], logs: [] as string[], exits: [] as number[] };
  const crash = handleCrashes(proc, {
    record: (detail) => {
      if (opts.recordFails) throw new Error('disco lleno');
      got.records.push(detail);
    },
    log: (line) => got.logs.push(line),
    shutdown: (code) => got.exits.push(code),
  });
  return { proc, crash, got };
}

const ENOENT = Object.assign(new Error('ENOENT: no such file or directory, chmod 013681.ldb'), { code: 'ENOENT' });

describe('caída del proceso (FR-077, AC-97)', () => {
  it.fails('una promesa rechazada sin capturar se muestra, se registra y cierra con código 1', () => {
    const { proc, got } = setup();
    proc.emit('unhandledRejection', ENOENT);
    expect(got.logs).toEqual(['Caída (unhandledRejection): Error: ENOENT: no such file or directory, chmod 013681.ldb']);
    expect(got.records).toEqual(['unhandledRejection: Error: ENOENT: no such file or directory, chmod 013681.ldb']);
    expect(got.exits).toEqual([1]);
  });

  it.fails('una excepción sin capturar también, y un rechazo con texto se registra tal cual', () => {
    const { proc, got } = setup();
    proc.emit('uncaughtException', new TypeError("Cannot read properties of null (reading 'Socket')"));
    expect(got.records).toEqual(["uncaughtException: TypeError: Cannot read properties of null (reading 'Socket')"]);
    const other = setup();
    other.proc.emit('unhandledRejection', 'auth timeout');
    expect(other.got.records).toEqual(['unhandledRejection: auth timeout']);
  });

  it.fails('la caída del arranque usa la misma reacción', () => {
    const { crash, got } = setup();
    crash('arranque', new Error('Execution context was destroyed'));
    expect(got.records).toEqual(['arranque: Error: Execution context was destroyed']);
    expect(got.exits).toEqual([1]);
  });

  it.fails('una segunda caída durante el cierre solo se registra', () => {
    const { proc, got } = setup();
    proc.emit('unhandledRejection', ENOENT);
    proc.emit('uncaughtException', new Error('otra'));
    expect(got.records).toHaveLength(2);
    expect(got.exits).toEqual([1]);
  });

  it.fails('si registrar en el log falla, igual se avisa y se cierra', () => {
    const { proc, got } = setup({ recordFails: true });
    proc.emit('unhandledRejection', ENOENT);
    expect(got.logs).toContain('No se pudo registrar la caída en el log: Error: disco lleno');
    expect(got.exits).toEqual([1]);
  });
});
