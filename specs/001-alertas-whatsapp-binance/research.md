# Research: Alertas de trading de WhatsApp a Binance Futuros

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md) · **Fecha**: 2026-10-27

Fuentes: el stack de `AGENTS.md`, las decisiones ya probadas en [docs/arquitectura.md](../../docs/arquitectura.md)
(implementación anterior de PRD-001) y las versiones de dependencias de la vuelta M2-M3 (`../v3`), para
que la comparación entre métodos use el mismo resultado técnico.

## R-01. Lenguaje y ejecución

- **Decision**: TypeScript en modo estricto sobre Node.js 22 LTS (≥ 22.23), ejecutado con `tsx`
  (sin paso de build) y verificado con `tsc --noEmit` (`pnpm typecheck`).
- **Rationale**: es lo que usan `docs/arquitectura.md` y v3; los tipos atrapan errores de
  precios/cantidades antes de correr, y AGENTS.md exige que el software compile antes de cada commit.
- **Alternatives considered**: JavaScript plano (sin chequeo de tipos en lógica de dinero);
  `node --experimental-strip-types` (no soporta todo TS y sigue siendo experimental en 22).

## R-02. Ingesta de WhatsApp

- **Decision**: whatsapp-web.js con evento `message_create` (incluye mensajes propios, útil para probar)
  y `message_edit`; el remitente se normaliza sin el sufijo de dispositivo (`:1`). El grupo se busca por
  nombre configurado. Solo se procesan mensajes recibidos con la conexión activa; no se relee el
  historial (FR-057).
- **Rationale**: decisión ya probada en `docs/arquitectura.md`; `getChats()`/`getChatById()` fallaban
  en este grupo y se reemplazó por una búsqueda con `evaluate`.
- **Alternatives considered**: API oficial de WhatsApp Business (no permite leer grupos de terceros).

## R-03. Cifrado de la sesión de WhatsApp (FR-049)

- **Decision**: estrategia `RemoteAuth` de whatsapp-web.js con un *store* propio que guarda el zip de la
  sesión cifrado con AES-256-GCM (`node:crypto`), clave de 32 bytes en `WHATSAPP_SESSION_KEY`
  (hex/base64), archivo `0600` dentro de un directorio `0700` excluido por `.gitignore`.
- **Rationale**: `LocalAuth` deja el perfil de Chromium en texto plano; `RemoteAuth` delega el guardado
  en un store intercambiable, que es el punto natural para cifrar sin forkear la librería.
- **Riesgo a verificar en implementación**: mientras el proceso corre, Chromium necesita el perfil
  descomprimido; ese directorio de trabajo va en `0700`, se borra al cerrar y, como una caída
  abrupta (`kill -9`, o la salida por 10 fallos) no llega a borrarlo, también se borra al arrancar
  antes de conectarse. AC-29 se verifica con el proceso detenido, incluido después de un `kill -9`. Si no se logra, queda como bloqueo para habilitar LIVE (Riesgos del PRD-000).
- **Alternatives considered**: cifrar el disco completo (fuera del control del sistema); `LocalAuth` +
  cifrado manual del directorio al cerrar (no cubre caídas abruptas).

## R-04. Extracción con IA (FR-003, FR-004, FR-059)

- **Decision**: regex primero; solo si faltan datos se llama a Claude (`@anthropic-ai/sdk`, modelo
  `claude-sonnet-5-5`, el mismo de v3) con texto + imagen y salida estructurada validada con `zod`.
  Lo que sacó el regex siempre manda; Claude solo completa faltantes. Timeout de 8 s y sin reintentos:
  error, timeout o respuesta inválida = datos faltantes → "incompleta" (FR-059).
- **Rationale**: las 33 alertas reales capturadas parsean con regex en ~1 ms, gratis y deterministas
  (Principio II). El timeout de 8 s deja margen para el p95 < 10 s de SC-001 con imagen.
- **Riesgo conocido**: en la versión anterior `downloadMedia` fallaba en este grupo, así que la imagen no
  llegaba a Claude. Se ataca en implementación con un test de integración del adaptador; si persiste,
  AC-14 queda sin cumplir y se informa.
- **Alternatives considered**: Claude siempre (más lento, cuesta y varía); OCR local (peor con capturas
  de gráficos).

## R-05. Datos públicos de Binance (FR-009, FR-010, FR-015, FR-017)

- **Decision**: `fetch` contra los endpoints públicos de producción de Futuros USDS-M
  (`exchangeInfo`, `ticker/24hr`, `klines 15m`), sin credenciales, en ambos modos. Copia local de
  símbolos y ranking refrescada cada 60 s; si un refresco falla se conserva la anterior y FR-018
  controla la antigüedad. Velas solo cuando el TP es por indicadores.
- **Filtros de órdenes en DRY (FR-066, FR-067)**: en DRY también se lee `exchangeInfo` público de
  Binance Demo (`https://demo-fapi.binance.com`), con el mismo refresco. Cada símbolo de producción
  toma de Demo `tickSize`, `stepSize`, `minQty` y `minNotional`; los que no son perpetuos TRADING en
  Demo quedan marcados como no operables y se rechazan con "no disponible en Demo". Como en v3, que
  vio a Demo rechazar (-4014) órdenes con el tick de producción. En LIVE no se consulta Demo.
- **Velas de 45 min (FR-015)**: Binance no ofrece ese intervalo, así que se piden 1500 velas de 15 min
  (el máximo por llamada) y una función pura las agrupa en tramos de 45 min alineados a las 00:00 UTC
  (`floor(openTime / 45 min)`; 1440 min / 45 = 32 tramos exactos por día). Se descarta el primer tramo
  si quedó incompleto por el corte de la consulta; el último es la vela en curso, con una, dos o tres
  velas de 15 min y cierre igual al último precio. Quedan ~500 velas de 45 min, de sobra para
  estabilizar EMA55. Para ASL21/EMA55 solo se usan los cierres.
- **Rationale**: FR-017 exige la fuente pública de producción también en DRY; validar no espera a la red
  (SC-001).
- **Alternatives considered**: velas de 1 h (no es la temporalidad de las alertas); agrupar velas de
  5 min (3 veces más datos para el mismo resultado); CCXT para datos públicos (agrega una capa sin necesidad); Demo Trading
  como fuente (no es la que pide el PRD).

## R-06. Operación en Binance (FR-021 a FR-032, FR-051, FR-060)

- **Decision**: CCXT (`binanceusdm`), con `enableDemoTrading(true)` en DRY y producción en LIVE, cada
  uno con su par de credenciales. Antes de colocar: `setMarginMode('isolated')` y `setLeverage` con el
  apalancamiento del símbolo configurado. Entrada `LIMIT` al precio ajustado. SL como `STOP_MARKET` y
  TP como `TAKE_PROFIT_MARKET`, ambos con `closePosition=true` y `workingType=MARK_PRICE`, para que
  cubran toda la posición incluidas ejecuciones posteriores (FR-028).
- **Rationale**: `closePosition` evita recalcular cantidades en cada ejecución parcial; CCXT unifica Demo
  y producción con la misma API.
- **A verificar en implementación**: Binance migró las órdenes condicionales a su API de órdenes
  "algo"; la versión de CCXT fijada debe soportarlo en Demo y producción. Se cubre con un test de
  integración contra Demo Trading.
- **Alternatives considered**: SL/TP con cantidad explícita (hay que reajustarlos en cada ejecución
  parcial); órdenes OCO (no existen en Futuros USDS-M).

## R-07. Detección de ejecuciones y cierres (FR-028, FR-031 a FR-038, SC-004)

- **Decision**: *polling* cada 2 s de órdenes y posiciones abiertas del modo activo (CCXT
  `fetchOrder`, `fetchPositions`, `fetchMyTrades` para PnL realizado y comisiones). Causa del cierre por
  la orden que se ejecutó (TP, SL), liquidación por el tipo de trade de Binance, y "cierre manual" para
  todo otro cierre total.
- **Rationale**: con pocas posiciones simultáneas el costo en rate limit es mínimo, 2 s deja margen para
  < 10 s (SC-004), y es más simple de testear que un WebSocket.
- **Alternatives considered**: user data stream por WebSocket (menor latencia, pero manejo de
  reconexión y listen key extra).

## R-08. Persistencia y log (FR-043 a FR-047)

- **Decision**: SQLite nativo (`node:sqlite`) para alertas, duplicados, operaciones y entradas
  pendientes; log JSONL (`data/alerts.log`) con una línea por alerta, edición, evento de conexión y
  evento crítico. `umask 077` al arrancar; directorio `data/` en `0700`, archivos en `0600`.
- **Rationale**: SQLite permite consultar duplicados de 24 h y el estado para la reconciliación sin
  dependencias extra; JSONL se audita con `tail -f`/`jq`.
- **Alternatives considered**: solo JSONL (consultas de duplicados lentas); base externa (excede un
  proceso único).

## R-09. Procesamiento de a una alerta (FR-061)

- **Decision**: cola en memoria de concurrencia 1: cada alerta se evalúa y su entrada se coloca o se
  rechaza antes de tomar la siguiente. El seguimiento de órdenes y los temporizadores de 3 minutos corren
  aparte y no bloquean la cola.
- **Rationale**: los límites de posiciones y capital se evalúan siempre contra la exposición actual, y
  dos reenvíos simultáneos no pasan juntos el control de duplicados.
- **Un símbolo, una operación (FR-063)**: con una sola operación por símbolo, los SL/TP con
  `closePosition` de R-06 no pueden cerrar la posición de otra operación, y la causa, el PnL y las
  comisiones de cada cierre se atribuyen sin ambigüedad (R-07).

## R-10. Reconexión, salida y reinicio (FR-055, FR-056, FR-030)

- **Decision**: una función pura de backoff (1, 2, 4… máx. 60 s) compartida por WhatsApp, Binance y el
  reintento del cierre de emergencia. Tras 10 fallos consecutivos de reconexión: evento crítico y
  `exit(1)`, salvo que haya un cierre de emergencia en curso: en ese caso se registra el evento
  crítico y no se sale, y el bucle del cierre ignora la señal de "agotado" del backoff hasta cerrar
  la posición. Si el proceso cae igual, la reconciliación de FR-065 retoma la protección.
- **Señal de desconexión**: WhatsApp, por el estado del cliente (`disconnected`/`change_state`).
  Binance, por el fallo de las llamadas a la API de trading (el polling de órdenes cada 2 s funciona
  como latido, R-07); los fallos del refresco de datos públicos no cuentan para los 10 intentos,
  porque su efecto ya lo cubre FR-018 ("ranking no disponible"). Cada servicio lleva su contador. `pnpm dev`/`pnpm start` corren un supervisor que relanza la app si sale con código ≠ 0
  (reinicio < 60 s) y no la relanza si sale por configuración inválida (código propio, para no entrar
  en un bucle con FR-058/FR-062).
- **Rationale**: mismo patrón que v3 (`scripts/supervise.ts`); no depende de systemd para cumplir
  RNF-05 en la máquina del operador.
- **Alternatives considered**: systemd o pm2 (agregan instalación en el host).

## R-11. Configuración (FR-050, FR-052, FR-053, FR-058, FR-062)

- **Decision**: `.env` cargado con `process.loadEnvFile` y validado con `zod` al arrancar; si falta o es
  inválido cualquier valor requerido, el proceso termina listando qué falta, antes de conectarse a nada.
  Variables de Binance distintas por modo. Nombres exactos en [contracts/cli.md](contracts/cli.md).
- **Rationale**: un único punto de validación, testeable sin red.

## R-12. Tests (Principio IV)

- **Decision**: Vitest. Unitarios para la lógica pura (filtro, parser, símbolos, indicadores, ranking,
  validaciones en orden, dimensionamiento, límites, máquina de estados del ejecutor, reconciliación,
  backoff, config). Integración con *fakes* de los puertos (WhatsApp, IA, exchange, reloj) para los
  flujos completos y los caminos de falla. Tests contra Binance Demo Trading opcionales, detrás de una
  variable, nunca en `pnpm test` por defecto. Cada feature/fix: commit `test(...)` con `it.fails` y
  después el `feat(...)`/`fix(...)`.
- **Rationale**: los criterios de aceptación del spec se convierten en tests sin red, cuentas ni costo;
  los adaptadores reales se prueban aparte.

## R-13. Medición de latencia y escaneo de secretos (SC-001, SC-002, SC-008)

- **Decision**: cada alerta registra marcas de tiempo de llegada, clasificación y aceptación de la
  entrada; un script de medición calcula el p95 sobre los lotes de 20 alertas en DRY. El escaneo de
  secretos se hace con gitleaks sobre el árbol y el historial (AC-27).
