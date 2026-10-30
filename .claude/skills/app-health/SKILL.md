---
name: app-health
description: >-
  Revisa, sin tocar nada, si SignalBridge v4 está corriendo y qué pasó: supervisor,
  proceso y Chromium, código cargado, log de alertas, base SQLite y posiciones en
  Binance Demo. Se usa cuando el usuario pregunta si la app está corriendo o lista,
  por qué se rechazó o no apareció una alerta, con qué precios se calculó, qué
  significa un mensaje de la consola, o pega un error o un corte.
---

# App health

Todo es **solo lectura**. El usuario corre la app en su terminal (`pnpm dev`); no la
reinicies, no la cortes y no arranques otra sesión de WhatsApp vos (una segunda sesión
ya desvinculó el dispositivo una vez).

## 1. ¿Está corriendo?

```bash
date -u
ps -eo pid,etime,args | grep -E "scripts/supervise\.ts|src/main\.ts|chrome-linux64/chrome --allow" \
  | grep -v grep | sed -E 's#/home/\S*/node_modules/\S*##g' | cut -c1-140
readlink .wwebjs_auth/RemoteAuth-signalbridge/SingletonLock
```

- Sin `src/main.ts`: la app no corre. Si el usuario pegó un error, explicalo (§4).
- Con `scripts/supervise.ts` (`pnpm dev`, `pnpm start`, `:verbose`): hay reinicio
  automático (FR-056). Si está el supervisor pero no `src/main.ts`, está esperando para
  relanzar (1, 2, 4… hasta 15 s): ver la última línea `Reinicio automático` en la consola.
  Con `pnpm dev:once` no hay supervisor: una caída la deja abajo.
- El supervisor **no** relanza si la app salió con código 0 (Ctrl+C) o 78 (configuración
  inválida, FR-058): en ese caso el error está en la consola, arriba.
- `SingletonLock -> <host>-<pid>`: el pid tiene que ser el Chromium de la lista. Si ese
  proceso ya no existe, es un lock viejo; el supervisor cierra un Chromium huérfano antes
  de cada arranque (`Chromium N seguía abierto…`).
- WhatsApp listo: en la consola, `WhatsApp listo. Escuchando "<grupo>".`

## 2. ¿Tiene el código actual?

```bash
ps -o lstart= -p "$(pgrep -f 'src/main\.ts' | tail -1)"
git log -1 --format='%h %ad' --date=iso
stat -c '%y %n' src/*.ts src/*/*.ts | sort | tail -3
```

Si algún archivo de `src/` cambió después del arranque de `src/main.ts`, la app corre
código viejo: avisá que hay que reiniciarla (una sola vez Ctrl+C y `pnpm dev`). Un
reinicio del supervisor sí carga el código nuevo (relanza `src/main.ts`).

## 3. ¿Qué pasó?

### El log: `data/alerts.log` (JSONL, `contracts/log-record.md`)

```bash
tail -5 data/alerts.log | cut -c1-300
grep -n '"ticker":"<TICKER>"' data/alerts.log | cut -c1-600
grep -n '"type":"critical"\|"type":"error"' data/alerts.log | tail -10 | cut -c1-400
```

- `type: "alert"`: solo estados finales (`rechazada`, `completa`, `entrada no ejecutada`,
  `cerrada por emergencia`, `cerrada`, `liquidada`). La última línea de un `alertId` es
  su estado vigente. `reason` es uno de `REJECT_REASONS` (`src/domain/types.ts`).
- En una **rechazada**, `entry`/`sl`/`tp`/`symbol`/`side` van en `null`: el log no dice
  con qué precios se evaluó. Para eso, la base (abajo).
- `type: "critical"` (`kind`: cierre de emergencia, falla del cierre de emergencia, SL/TP
  perdido, reconexión agotada, entrada sin confirmar, reinicios seguidos): mirarlo primero.
- `type: "error"` (seguimiento, FR-073), `type: "edit"` (FR-047), `type: "connection"`
  (whatsapp/binance: interrupción → reintento → reconectado).
- Los mensajes comunes del grupo **no se loguean**: que no haya nada no prueba que
  WhatsApp esté caído.

### La base: `data/signalbridge.db` (no hay `sqlite3`: usar `node:sqlite`, solo lectura)

Tablas `alerts`, `trades` y `edits`; cada fila tiene una columna `record` con el JSON
completo. En `alerts.record` está lo que el log no tiene: el `text` original y los campos
leídos (`entryRaw`, `slRaw`, `target`, `riskLevel`), también en las rechazadas.

```bash
node -e "
const {DatabaseSync}=require('node:sqlite');
const db=new DatabaseSync('data/signalbridge.db',{readOnly:true});
for (const r of db.prepare(\"select record from alerts where record like ? order by received_at desc limit 3\").all('%\"ticker\":\"<TICKER>\"%'))
  console.log(JSON.parse(r.record));
" 2>&1 | grep -v -i warning
```

- Los precios **ajustados** (factor ×1000, tickSize) y el TP calculado solo se guardan si
  la alerta pasó la validación. Para ver en qué paso cortó, seguir el orden de
  `src/domain/validate.ts` (FR-020) con `entryRaw`/`slRaw`; el TP con indicadores
  ("ASL21, EMA55") se calcula en el último paso, así que un rechazo anterior no lo tiene.
- Errores de escala (separador de miles, un cero o un punto decimal de más o de menos):
  se rechazan por "SL fuera de rango" o "entrada lejos del mercado" (FR-013, FR-068). Es
  lo decidido: no se adivina la otra lectura.
- Si en la consola no aparece una línea que sí está en el log: la terminal de Windows
  puede estar pausada por una selección (Esc), o el usuario está scrolleado arriba.

## 4. Mensajes de consola conocidos

| Mensaje | Qué es |
|---|---|
| `SignalBridge en modo DRY` / `Aviso: …` | arranque; los avisos son de configuración (`startupWarnings`) |
| `WhatsApp listo. Escuchando "<grupo>".` / `WhatsApp desconectado.` | estado de la ingesta |
| `No encontré el grupo "<grupo>".` | `WHATSAPP_GROUP_NAME` no coincide con ningún chat |
| `Falló la autenticación de WhatsApp: …` | sesión inválida; puede pedir QR otra vez: preguntá antes de que el usuario re-vincule |
| `<servicio>: conexión interrumpida (…)` → `reconectado tras N intento(s).` | corte y reconexión normales (FR-055) |
| `<servicio>: N intentos fallidos; el proceso termina para que el supervisor lo relance.` | reconexión agotada: evento crítico y salida; el supervisor relanza |
| `Reinicio automático n.º N en X s (la app salió con código C)` | supervisor (FR-056): esperas 1 → 15 s; el contador vuelve a 0 tras 10 min sanos. Buscá el error repetido antes de cada reinicio |
| `⚠ CRÍTICO reinicios seguidos: …` | 10.º reinicio seguido (FR-074); sigue relanzando, también queda en el log |
| `⚠ CRÍTICO <kind> <SYMBOL>: …` | evento crítico de una operación; ver el `type: "critical"` en el log y Binance (§5) |
| `● <SYMBOL> <SIDE> cerrada por TP: PnL …` | cierre de una posición (FR-071) |
| `Chromium N seguía abierto con la sesión de WhatsApp: …` | el supervisor cerró un Chromium que sobrevivió a la app |
| `No se pudo refrescar símbolos/ranking: …` | falla del refresco de 60 s de Binance público; las alertas pueden rechazarse por "ranking no disponible" |
| `Error procesando un mensaje: …` | excepción en la cola de un mensaje; el resto sigue |

Solo con `pnpm dev:verbose` (FR-072): `Binance: N símbolos…`, `Límites: …`,
`Reconciliación con Binance: …` al arrancar; `· <SYMBOL> <SIDE> completa: ejecutado q/q
(entrada …, SL …, TP …)`, `· … entrada no ejecutada`, `· <TICKER> editada tras procesarse
(no se opera)`, `· Error del seguimiento <SYMBOL>: …`.

## 5. Binance Demo (solo lectura)

Script en el scratchpad con extensión `.mts` (top-level await), corrido desde `v4/` con
`pnpm exec tsx <ruta>`:

```ts
import { loadDotEnv, parseConfig } from '<v4>/src/config.ts';
import { createExchange } from '<v4>/src/adapters/binance-trading.ts';
loadDotEnv();
const parsed = parseConfig({ ...process.env, SIGNALBRIDGE_MODE: 'DRY' });
if (!parsed.ok) throw new Error('config inválida');
const { exchange } = createExchange('DRY', parsed.config.binance);
console.log(await exchange.openPositions(), await exchange.walletBalanceUsdt());
```

Lectura permitida: `openPositions()`, `openOrders(symbol)`, `order(ref)` (estado de un
SL/TP: `{ symbol, id, algo: true }`, ids de `orderIds` en el log), `findEntry`,
`walletBalanceUsdt()`. **Nunca** `placeLimitEntry`, `closeAtMarket`, `cancel` ni
`prepareSymbol`. Nunca `SIGNALBRIDGE_MODE: 'LIVE'` sin que el usuario lo pida.

Precios públicos de producción y Demo: `https://fapi.binance.com` y
`https://demo-fapi.binance.com`, `/fapi/v1/ticker/price?symbol=X`.

## Reglas duras

- No modifiques `data/signalbridge.db` ni `data/alerts.log`: para probar algo, copiá
  `signalbridge.db`, `-wal` y `-shm` al scratchpad y borrá la copia al terminar.
- No arranques la app ni otra sesión de WhatsApp sin preguntar; v3 y v4 nunca corren a
  la vez con la misma cuenta.
- Un lock de Chromium se borra solo si su proceso ya no existe (`ps -p <pid>`).
- No imprimas `.env` ni claves; la `signature=` de una URL de Binance no es secreta,
  pero tampoco hace falta mostrarla.
- Ante un bug de runtime, buscá primero en el historial de v3 si ya se resolvió.
