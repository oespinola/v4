// `pnpm dev` y `pnpm start` corren la app bajo este supervisor (FR-056): si sale con un código
// distinto de 0 y de 78, o la mata una señal, la vuelve a arrancar; Ctrl+C la detiene del todo.
//
// La app corre como proceso hijo en la misma terminal (mismo QR) y con el mismo Node y el mismo
// cargador de tsx. Ctrl+C le llega a los dos: la app cierra con calma y el supervisor solo anota
// que el operador pidió parar.
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { supervise, type AppExit } from '../src/supervisor.ts';

const mode = process.env.SIGNALBRIDGE_MODE;
if (mode !== 'DRY' && mode !== 'LIVE') {
  console.error('SIGNALBRIDGE_MODE debe ser DRY o LIVE.');
  process.exit(1);
}
// Perfil de trabajo de RemoteAuth (src/adapters/whatsapp.ts).
const profileDir = path.resolve('.wwebjs_auth', 'RemoteAuth-signalbridge');

let stop = false;
let child: ChildProcess | null = null;
let wakeUp: (() => void) | null = null;
const requestStop = () => {
  stop = true;
  wakeUp?.();
};
// Ctrl+C también le llega a la app (mismo grupo de procesos): no se reenvía.
process.on('SIGINT', requestStop);
for (const signal of ['SIGTERM', 'SIGHUP'] as const) {
  process.on(signal, () => {
    requestStop();
    child?.kill(signal);
  });
}

console.log(`Reinicio automático activo (modo ${mode}).`);
const code = await supervise({
  runApp: () =>
    new Promise<AppExit>((resolve) => {
      child = spawn(process.execPath, [...process.execArgv, 'src/main.ts'], { stdio: 'inherit' });
      child.on('exit', (exitCode, signal) => {
        child = null;
        resolve({ code: exitCode, signal });
      });
    }),
  wait: (ms) =>
    new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, ms);
      wakeUp = () => {
        clearTimeout(timer);
        resolve();
      };
    }).finally(() => {
      wakeUp = null;
    }),
  now: () => Date.now(),
  stopRequested: () => stop,
  log: (line) => console.error(line),
  // Un Chromium que sobrevivió a un kill -9 seguiría conectado con la misma sesión.
  beforeRestart: () => {
    spawnSync('pkill', ['-f', `--user-data-dir=${profileDir}`]);
  },
});
process.exit(code);
