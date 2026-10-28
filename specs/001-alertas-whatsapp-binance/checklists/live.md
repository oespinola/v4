# Checklist: antes de habilitar LIVE

**Purpose**: verificaciones contra Binance Demo Trading que tienen que pasar antes de operar en LIVE.
**Created**: 2026-10-28

## Secretos y permisos (US8, T080, T081)

- [x] CHK002 `gitleaks git --log-opts="--all" --redact .` sobre el árbol versionado y todo el historial:
  0 hallazgos en 97 commits (2026-10-28, gitleaks 8.30.1) (AC-27). Un `gitleaks dir .` encuentra
  credenciales solo en archivos ignorados por git (`.env`, `.wwebjs_auth/`, `.wwebjs_cache/`).
- [ ] CHK003 Key de Binance de producción con solo trading de Futuros y el retiro deshabilitado,
  revisada en Binance → API Management (AC-28). Resultado: _pendiente de revisar por el operador_.

## Órdenes en Demo Trading (R-06, T063)

- [x] CHK001 `BINANCE_DEMO_TESTS=1 pnpm vitest run test/demo` en verde: entrada LIMIT lejos del precio
  colocada, consultada y cancelada; sobre una posición mínima a mercado, SL `STOP_MARKET` y TP
  `TAKE_PROFIT_MARKET` condicionales con `closePosition` aceptados y cancelados, y cierre a mercado
  que deja la posición en cero, sin órdenes ni posición abiertas al terminar. Resultado: 3/3 en verde
  el 2026-10-28 con CCXT 4.5.90 en DOGEUSDT. Primer intento: Binance rechazó el SL con
  `closePosition` sin posición abierta (-4509); en el flujo real el SL y el TP se piden después del
  primer fill (FR-028), así que el test pasó a abrir una posición mínima.

## Validación del quickstart en DRY (T085)

Corrida del 2026-10-28 en Demo Trading, grupo de prueba "Memes y links", con un único remitente
autorizado (el operador) y sin `ANTHROPIC_API_KEY` (alertas con todo el texto, sin imagen).

- [x] CHK004 Sección 2: `RISK_R_USDT=0 pnpm dev` lista `RISK_R_USDT` como inválido, sale con código 78
  en 7 s, sin QR, y el supervisor no la relanza (FR-058, FR-062).
- [x] CHK005 Sección 3: con la sesión guardada no pide QR y queda escuchando el grupo (AC-10). Alerta
  completa → válida con entrada pendiente; mensaje sin disparador → nada en el log; alerta sin SL →
  `rechazada`/`incompleta`; reenvío de la completa → `rechazada`/`duplicado`, sin orden (AC-05,
  AC-17, AC-21). `data` en `700` y sus archivos en `600` (AC-50).
- [x] CHK006 Sección 4: entrada LONG DOGEUSDT en 0.0796 sin ejecución → cancelada a los 3 min y log
  `entrada no ejecutada` (AC-23). Entrada en 0.0798 → ejecutada (6250), SL y TP condicionales con
  cierre de posición y log `completa` en ~3 s (AC-43, AC-55, AC-15).
- [ ] CHK007 Sección 5, SL cancelado a mano → `critical` "SL/TP perdido" a las 12:31:18 UTC, sin tocar
  la posición ni el TP (AC-64). Resultado: _falta la hora de la cancelación en Demo para confirmar < 10 s_.
- [x] CHK008 Sección 5, cierre manual a mercado → `cerrada`/`cierre manual` 1.6 s después del cierre
  en Binance y TP restante cancelado: la pestaña TP/SL de Demo queda vacía (AC-58, AC-60, SC-004).
- [ ] CHK009 Sección 5, cierre por SL con la app detenida y reconciliación al arrancar (AC-63).
  Resultado: _pendiente_. Con `RISK_R_USDT=10` y `MAX_POSITION_USDT=1000` el SL tiene que quedar a
  ≥ 1 % de la entrada; para la prueba se baja `RISK_R_USDT` a 2 (SL a ~0.2 %) y se restituye después.
- [ ] CHK010 Sección 6, cortes de red con esperas 1 s, 2 s, 4 s… (AC-47). Resultado: _pendiente_.
- [x] CHK012 Sección 6, `kill -9` del proceso de la app (no del supervisor) a las 12:54:57.6 UTC: el
  supervisor la relanza en 1 s y vuelve a escuchar el grupo a los 54.3 s; un mensaje enviado después
  se clasifica (`rechazada`/`incompleta`) (AC-31). De esos 54.3 s, 40 s son de la reconciliación.
- [ ] CHK013 Sección 6, sesión después del `kill -9` (AC-29): la sesión cifrada sigue en `0600` y el
  perfil de trabajo en claro se rearma al arrancar. Resultado: _pendiente_: en `.wwebjs_auth/` queda
  una carpeta `session` en claro de una corrida anterior (LocalAuth), que la app actual no usa.
- [ ] CHK011 Sección 7: gitleaks sobre todo el historial, 0 hallazgos en 103 commits (AC-27).
  `pnpm latency` dentro de los límites pero con lotes incompletos: clasificación solo texto p95 0.02 s
  (n=7/20), entrada aceptada solo texto p95 2.68 s (n=3/20), con imagen sin muestras (falta
  `ANTHROPIC_API_KEY`) (SC-001, SC-002). Resultado: _pendiente de completar los lotes en el período DRY_.

Observaciones:
- La cancelación por entrada no ejecutada y el evento `critical` "SL/TP perdido" quedan en
  `data/alerts.log` pero no se muestran en la consola; un aviso crítico debería verse sin abrir el log.
- Si falla la cancelación de la orden restante al cerrar una posición, el error se descarta sin
  registrarse (src/domain/tracker.ts:101); AC-60 se confirmó mirando Demo, no el log.
- En la base queda una alerta de una corrida anterior (~9 h antes) en `válida` sin trade asociado:
  revisar por qué no avanzó.
- La reconciliación al arrancar tarda ~40 s y deja poco margen para AC-31 (< 60 s).
