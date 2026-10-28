# Tasks: Alertas de trading de WhatsApp a Binance Futuros

**Input**: Design documents from `specs/001-alertas-whatsapp-binance/`
**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: obligatorios (Constitución, Principio IV). Cada par de tareas "test → código" se commitea en
dos pasos: primero `test(...)` con los tests nuevos en `it.fails` (`pnpm test` sigue en verde), después
`feat(...)`/`fix(...)` con el código y los `it.fails` cambiados a `it`. Antes de cada commit: `pnpm
typecheck` y `pnpm test` en verde. Al cerrar cada fase: push (AGENTS.md).

**Organization**: por historia de usuario del spec (US1–US8), en orden de prioridad.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: puede hacerse en paralelo (otro archivo, sin depender de tareas incompletas)
- **[Story]**: historia del spec a la que pertenece (US1…US8)

---

## Phase 1: Setup

**Purpose**: proyecto Node/TypeScript que compila y corre tests vacíos.

- [X] T001 Crear `package.json` (`"type": "module"`, `engines.node >= 22.23`) con scripts `dev` (`SIGNALBRIDGE_MODE=DRY tsx src/main.ts`; pasa a `scripts/supervise.ts` en T079), `start` (ídem con `LIVE`), `test` (`vitest run`), `typecheck` (`tsc --noEmit`) y `latency` (`tsx scripts/latency.ts`), y las dependencias y versiones de `../v3/package.json` (whatsapp-web.js, qrcode-terminal, ccxt, @anthropic-ai/sdk, zod; dev: typescript, tsx, vitest, @types/node, @types/qrcode-terminal) en package.json
- [X] T002 [P] Crear `tsconfig.json` con las opciones de `../v3/tsconfig.json` (strict, NodeNext, `noUncheckedIndexedAccess`, `allowImportingTsExtensions`, `noEmit`; include `src`, `test`, `scripts`) en tsconfig.json
- [X] T003 [P] Crear `pnpm-workspace.yaml` con `allowBuilds` (esbuild y puppeteer en true; ccxt, bufferutil en false) como en `../v3/pnpm-workspace.yaml`
- [X] T004 [P] Crear `.gitignore` con `node_modules/`, `.env`, `data/`, `.wwebjs_auth/`, `.wwebjs_cache/` y el directorio de sesión de WhatsApp (FR-049)
- [X] T005 [P] Crear `.env.example` con todas las variables de [contracts/cli.md](contracts/cli.md), sin valores reales, en .env.example
- [X] T006 [P] Crear `vitest.config.ts` que excluya `test/demo/**` salvo que `BINANCE_DEMO_TESTS=1`, en vitest.config.ts
- [X] T007 Correr `pnpm install`, agregar un test trivial en test/unit/smoke.test.ts y confirmar que `pnpm typecheck` y `pnpm test` pasan

**Checkpoint**: el repo compila y `pnpm test` está en verde.

---

## Phase 2: Foundational (bloquea todas las historias)

**Purpose**: tipos, puertos, fakes, configuración, persistencia, cola y backoff que usan todas las historias.

- [X] T008 [P] Definir tipos del dominio (`Side`, `Field`, `RawFields`, `Target`, `Alert`, `Trade`, `AlertStatus`, `RejectReason` con todos los motivos de FR-045, `CloseCause`) según [data-model.md](data-model.md) en src/domain/types.ts
- [X] T009 [P] Definir los puertos `FieldExtractor`, `MarketData`, `Exchange`, `MessageSource` y `Clock` según [contracts/ports.md](contracts/ports.md) en src/ports.ts
- [X] T010 [P] Crear fakes de los puertos (reloj controlable con avance manual de tiempo, extractor programable, market data con tickers/velas/filtros fijos, exchange con ejecuciones y fallas programables, fuente de mensajes con conexión on/off) en test/fakes/index.ts
- [X] T011 [P] Copiar las alertas anonimizadas de `../v3/test/fixtures/alerts.ts` en test/fixtures/alerts.ts y agregar una imagen sintética (`fakeImage`); las capturas reales de `../AlertsSamples` no se suben al repo (datos de terceros, como ya decidía el .gitignore de v3)
- [X] T012 Escribir tests de configuración (FR-058, FR-062, FR-052): falta cada variable requerida, valores ≤ 0, `MAX_SL_DISTANCE_PCT` ausente = 15, credenciales del otro modo no requeridas, lista de todo lo que falta, código de salida 78 — en `it.fails` — en test/unit/config.test.ts
- [X] T013 Implementar la carga de `.env` (`process.loadEnvFile`) y la validación con zod por modo, y pasar T012 a `it`, en src/config.ts
- [X] T014 [P] Escribir tests de backoff (FR-055): secuencia 1, 2, 4, 8, 16, 32, 60, 60… s; señal de "agotado" al 10.º fallo consecutivo (quien la consume decide si sale: el cierre de emergencia la ignora, FR-055); reinicio del contador tras un éxito — en `it.fails` — en test/unit/backoff.test.ts
- [X] T015 Implementar el backoff puro y pasar T014 a `it` en src/domain/backoff.ts
- [X] T016 [P] Escribir tests de la cola (FR-061): concurrencia 1, orden de llegada, un error en un trabajo no frena los siguientes — en `it.fails` — en test/unit/queue.test.ts
- [X] T017 Implementar la cola y pasar T016 a `it` en src/queue.ts
- [X] T018 [P] Escribir tests del almacenamiento (FR-007, FR-046, data-model): `umask 077`, `data/` en 0700 y archivos en 0600, alta de alerta, búsqueda por `waMessageId`, búsqueda de `contentHash` en las últimas 24 h con reloj inyectado, alta/actualización de `trades`, conteo y nocional de operaciones `pendiente`, `con_ejecución` o `abierta`, búsqueda de operación activa por símbolo (FR-063), listado de las `con_ejecución` (FR-065), append al JSONL — en `it.fails` — en test/unit/store.test.ts
- [X] T019 Implementar el store con `node:sqlite` (tablas `alerts`, `edits`, `trades`) y el append JSONL, y pasar T018 a `it`, en src/adapters/store.ts
- [X] T020 [P] Implementar el reloj real (`now`, `setTimeout`, `setInterval`) que cumple `Clock` en src/adapters/clock.ts

**Checkpoint**: base lista; las historias pueden empezar.

---

## Phase 3: User Story 1 - Validar cada alerta antes de operar (Priority: P1) 🎯 MVP

**Goal**: cada mensaje con "alerta de trading" de un remitente autorizado queda válido (símbolo, side, precios ajustados, TP) o rechazado con un único motivo, sin colocar órdenes.

**Independent Test**: `pnpm test` cubre AC-01 a AC-07, AC-14, AC-17, AC-19 a AC-21, AC-25, AC-26, AC-30, AC-33 a AC-35, AC-37, AC-38, AC-40 a AC-42, AC-52 a AC-54, AC-68, AC-69 y AC-71 con fakes; en vivo, `pnpm dev` muestra una línea por alerta del grupo.

### Filtro, extracción e identidad

- [X] T021 [P] [US1] Escribir tests del filtro (AC-05, AC-35, AC-26): disparador sin mayúsculas ni tildes en cualquier posición, remitente autorizado normalizado — en `it.fails` — en test/unit/filter.test.ts
- [X] T022 [US1] Implementar el filtro y pasar T021 a `it` en src/domain/filter.ts
- [X] T023 [P] [US1] Escribir tests del parser regex sobre test/fixtures/alerts.ts (AC-20): ticker, Entrada, objetivo (precio o texto), SL y nivel de riesgo; devuelve solo lo que pudo sacar — en `it.fails` — en test/unit/parser.test.ts
- [X] T024 [US1] Implementar el parser y pasar T023 a `it` en src/domain/parser.ts
- [X] T025 [P] [US1] Escribir tests de la extracción (AC-14, AC-21, FR-059): con texto completo no llama al extractor; con faltantes pide solo esos campos; lo del regex manda; extractor que falla o no completa → "incompleta" — en `it.fails` — en test/unit/extract.test.ts
- [X] T026 [US1] Implementar la orquestación regex → `FieldExtractor` y pasar T025 a `it` en src/domain/extract.ts
- [X] T027 [P] [US1] Escribir tests de identidad (FR-006): `alertId = <waMessageId>:<hash 16 hex>`; hash sobre valores crudos; con objetivo sin precio entra el texto del objetivo — en `it.fails` — en test/unit/identity.test.ts
- [X] T028 [US1] Implementar identidad y hash y pasar T027 a `it` en src/domain/identity.ts

### Símbolo, precios y TP

- [X] T029 [P] [US1] Escribir tests de símbolos y precios (AC-01, AC-03, AC-40, AC-41, AC-42, AC-52): side por SL vs Entrada, `TICKERUSDT` o `1000TICKERUSDT` ×1000, inexistente, redondeo al tickSize (Entrada al más cercano, SL alejándose, TP acercándose) — en `it.fails` — en test/unit/symbols.test.ts
- [X] T030 [US1] Implementar mapeo, side y ajuste al tick y pasar T029 a `it` en src/domain/symbols.ts
- [X] T031 [P] [US1] Escribir tests de velas de 45 min (AC-69): agrupación de a tres velas de 15 min alineadas a 00:00 UTC, descarte del primer tramo incompleto, vela en curso con 1, 2 o 3 velas y cierre igual al último precio — en `it.fails` — en test/unit/candles.test.ts
- [X] T032 [US1] Implementar la agrupación 15 → 45 min y pasar T031 a `it` en src/domain/candles.ts
- [X] T033 [P] [US1] Escribir tests de indicadores (AC-33, AC-34): EMA y WMA contra valores conocidos, ASL21 = (EMA20 + WMA21) / 2, EMA55, TP = el del lado correcto más cercano a la Entrada, ninguno del lado correcto → "TP inválido", objetivo con precio → TP = precio sin calcular — en `it.fails` — en test/unit/indicators.test.ts
- [X] T034 [US1] Implementar indicadores y elección del TP y pasar T033 a `it` en src/domain/indicators.ts
- [X] T035 [P] [US1] Escribir tests del ranking (AC-06, AC-07, AC-25, AC-38): solo perpetuos `TRADING`, orden por priceChangePercent, top 3 ganadores y perdedores, copia de más de 120 s → "ranking no disponible" — en `it.fails` — en test/unit/ranking.test.ts
- [X] T036 [US1] Implementar ranking y antigüedad y pasar T035 a `it` en src/domain/ranking.ts

### Validación en orden

- [X] T037 [US1] Escribir tests de validación (AC-02, AC-04, AC-19, AC-54, AC-68, AC-71, FR-013, FR-020, FR-064): orden remitente → duplicado ID → incompleta → duplicado hash → ticker inexistente → SL = Entrada → SL fuera de rango (máximo configurable) → datos de mercado no disponibles (fake de `MarketData` cuyo `closes45m` rechaza) → TP inválido → ranking no disponible → top 3, y un único motivo (el primero) — en `it.fails` — en test/unit/validate.test.ts
- [X] T038 [US1] Implementar la validación en orden y pasar T037 a `it` en src/domain/validate.ts

### Adaptadores y armado

- [X] T039 [P] [US1] Escribir tests del adaptador público con respuestas grabadas (AC-30, FR-017): `exchangeInfo`, `ticker/24hr` y `klines 15m` de producción, sin headers de credenciales, refresco cada 60 s con reloj fake, conserva la copia anterior si un refresco falla — en `it.fails` — en test/unit/binance-public.test.ts
- [X] T040 [US1] Implementar `MarketData` con `fetch` y pasar T039 a `it` en src/adapters/binance-public.ts
- [X] T041 [P] [US1] Escribir tests del extractor de Claude con el SDK mockeado (FR-004, FR-059, Principio I): pide solo los campos faltantes, valida la respuesta con zod, timeout 8 s, sin reintentos, nunca lanza (error/timeout/respuesta inválida → `{}`) — en `it.fails` — en test/unit/claude-extractor.test.ts
- [X] T042 [US1] Implementar el extractor con `@anthropic-ai/sdk` (`claude-sonnet-5-5`, texto + imagen) y pasar T041 a `it` en src/adapters/claude-extractor.ts
- [X] T043 [US1] Escribir tests de integración del pipeline de validación con fakes (AC-17, AC-37, AC-53, FR-047): mismo mensaje tras reinicio → "duplicado", reenvío < 24 h → "duplicado", > 24 h → no es duplicado, edición de alerta procesada → registro `edit` sin operar, resultado guardado en store — en `it.fails` — en test/integration/pipeline-validation.test.ts
- [X] T044 [US1] Implementar `processMessage` y `processEdit` hasta "válida/rechazada" y pasar T043 a `it` en src/pipeline.ts
- [X] T045 [P] [US1] Escribir tests de la lógica pura del adaptador de WhatsApp (FR-057, FR-048): normaliza el remitente sin sufijo de dispositivo, descarta mensajes con timestamp anterior al momento de conexión, solo mensajes del grupo configurado, y con un cliente fake sin sesión guardada emite el QR (AC-10) — en `it.fails` — en test/unit/whatsapp.test.ts
- [X] T046 [US1] Implementar el adaptador de WhatsApp (QR en terminal si no hay sesión, búsqueda del grupo por nombre con `evaluate`, `message_create`, `message_edit`, descarga de imagen; sesión temporal con `LocalAuth` en un directorio 0700, se reemplaza por la cifrada en T075) y pasar T045 a `it` en src/adapters/whatsapp.ts
- [X] T047 [US1] Armar `main.ts` en DRY: config → store → market data → WhatsApp → cola → pipeline, una línea por alerta en consola, en src/main.ts
- [X] T087 [US1] Escribir tests de la key del proveedor de IA opcional (RF-16 enmendado, AC-75, AC-76): sin `ANTHROPIC_API_KEY` la configuración es válida con la key en `null` y los avisos de arranque incluyen que el análisis de imagen está apagado; `extractFields` sin extractor devuelve incompleta sin descargar la imagen; el pipeline la rechaza como "incompleta" — en `it.fails` — en test/unit/config.test.ts, test/unit/extract.test.ts y test/integration/pipeline-validation.test.ts
- [X] T088 [US1] Hacer opcional la key: `anthropicApiKey: string | null` y `startupWarnings(config)` en src/config.ts, extractor `null` en src/domain/extract.ts y src/pipeline.ts, aviso al arrancar en src/main.ts, y pasar T087 a `it`
- [X] T089 [US1] Escribir tests de deduplicación por hash enmendada (RF-11, RF-29, RF-38 enmendados; AC-37, AC-77, AC-78): el hash usa símbolo mapeado y precios ajustados al tickSize ("PEPE 0.002404" y "1000PEPE 2.404" dan el mismo hash) y los valores crudos si se rechaza antes del mapeo; solo una alerta no rechazada en 24 h bloquea el reenvío; "ticker inexistente" antes que "duplicado (hash)" — en `it.fails` — en test/unit/identity.test.ts, test/unit/store.test.ts, test/unit/validate.test.ts y test/integration/pipeline-validation.test.ts
- [X] T090 [US1] Implementar el hash sobre valores mapeados y ajustados en src/domain/identity.ts, el nuevo orden en src/domain/validate.ts y que `hasContentHashSince` ignore las rechazadas en src/adapters/store.ts, y pasar T089 a `it`

**Checkpoint**: MVP de validación: en DRY, cada alerta queda válida o rechazada con su motivo, sin órdenes.

---

## Phase 4: User Story 4 - Auditar cada alerta y cómo terminó (Priority: P1)

**Goal**: el log tiene, por alerta, todos los campos de FR-043 que aplican y un estado/motivo de la lista cerrada.

**Independent Test**: AC-08, AC-09 y AC-50 con fakes.

- [X] T048 [P] [US4] Escribir tests del registro de log según [contracts/log-record.md](contracts/log-record.md) (AC-08, FR-043 a FR-045): todos los campos, `null` cuando no aplican, `status` y `reason` solo de las listas cerradas, `timings` de clasificación — en `it.fails` — en test/unit/log-record.test.ts
- [X] T049 [US4] Implementar el armado del registro desde `Alert` + `Trade` y usarlo en el store, y pasar T048 a `it`, en src/domain/log-record.ts
- [X] T050 [US4] Escribir tests de integración del log (AC-09, AC-50): cada uno de los motivos de FR-045 producido por el pipeline queda en el JSONL; permisos 0600 del log y de la base; tipos `connection` y `critical` con su esquema — en `it.fails` — en test/integration/log.test.ts
- [X] T051 [US4] Completar el registro de eventos `connection` y `critical` en el store y pasar T050 a `it` en src/adapters/store.ts

**Checkpoint**: todo lo que pasa queda auditado.

---

## Phase 5: User Story 2 - Cargar la operación sin dejarla nunca desprotegida (Priority: P1)

**Goal**: una alerta válida se dimensiona, se controla contra límites y se coloca con SL y TP; ante falla del SL/TP, cierre a mercado con reintento.

**Independent Test**: AC-13, AC-15, AC-16, AC-18, AC-22 a AC-24, AC-36, AC-39, AC-43 a AC-45, AC-51, AC-55, AC-70, AC-72, AC-79 y AC-80 con el exchange fake y el reloj fake.

- [X] T091 [US2] Escribir tests de los filtros de órdenes de Demo (RF-54, RF-55; AC-79, AC-80, AC-81): en DRY cada símbolo toma `tickSize`, `stepSize`, `minQty` y `minNotional` de `exchangeInfo` de Demo (BERAUSDT con tick 0.0001 en producción y 0.001 en Demo → Entrada 0.230, SL 0.234, TP 0.225); un símbolo que no es perpetuo TRADING en Demo → "no disponible en Demo", después de "ticker inexistente" y antes de "duplicado (hash)"; en LIVE no se consulta Demo; si falla el refresco de Demo se conserva la copia anterior — en `it.fails` — en test/unit/binance-public.test.ts, test/unit/validate.test.ts y test/integration/log.test.ts
- [X] T092 [US2] Implementar los filtros de Demo en src/adapters/binance-public.ts (`availableForOrders`), el motivo nuevo en src/domain/types.ts, el chequeo en src/domain/validate.ts y la URL de Demo en DRY en src/main.ts, y pasar T091 a `it`
- [X] T052 [P] [US2] Escribir tests de dimensionamiento (AC-13, AC-36, AC-39, AC-22, FR-024): `R / |E − S|` con piso al stepSize, el nivel de riesgo no cambia la cantidad, bajo mínimo (cantidad o nocional), excede tamaño máximo, apalancamiento efectivo = nocional / balance total de la billetera > máximo, falla al consultar el balance → "datos de mercado no disponibles" (AC-72) — en `it.fails` — en test/unit/sizing.test.ts
- [X] T053 [US2] Implementar el dimensionamiento y pasar T052 a `it` en src/domain/sizing.ts
- [X] T054 [P] [US2] Escribir tests de exposición (AC-18, AC-51, AC-24): posiciones abiertas + entradas pendientes ≥ máximo → "límite de posiciones"; nocional comprometido + nuevo > máximo → "límite de capital"; símbolo con entrada pendiente, operación con ejecución sin confirmar o posición abierta → "símbolo ya en operación" (AC-70) — en `it.fails` — en test/unit/exposure.test.ts
- [X] T055 [US2] Implementar los límites de exposición y pasar T054 a `it` en src/domain/exposure.ts
- [X] T056 [P] [US2] Escribir tests de la máquina de estados del ejecutor (FR-065: al primer fill persiste `con_ejecución` en el store antes de pedir SL/TP, y pasa a `abierta` solo con los dos aceptados; AC-43, AC-44, AC-55, AC-15, AC-23, AC-45, FR-060): prepara margen aislado y apalancamiento del símbolo, entrada LIMIT al precio E, sin SL/TP antes de la primera ejecución, SL y TP al primer fill parcial, "completa" solo con SL y TP aceptados, sin ejecución a los 3 min → cancelar y "entrada no ejecutada", parcial a los 3 min → cancelar el resto y mantener SL/TP — en `it.fails` — en test/unit/executor.test.ts
- [X] T057 [P] [US2] Escribir tests de los caminos de falla del ejecutor (AC-16, FR-030, Principio III): SL o TP rechazado con entrada ejecutada → cierre a mercado en < 5 s y evento crítico; cierre a mercado que falla → reintento con backoff que no se detiene en el 10.º fallo (FR-055, AC-74) hasta cerrar, evento crítico en cada falla; nunca queda estado "abierta" sin SL y TP — en `it.fails` — en test/integration/executor-failure.test.ts
- [X] T058 [US2] Implementar el ejecutor (incluye `EmergencyState.emergencyInProgress()` para el monitor de conexión) y pasar T056 y T057 a `it` en src/domain/executor.ts
- [X] T059 [P] [US2] Escribir tests del adaptador de trading con CCXT mockeado (R-06): `setMarginMode('isolated')`, `setLeverage`, entrada `LIMIT`, SL `STOP_MARKET` y TP `TAKE_PROFIT_MARKET` con `closePosition` y `workingType=MARK_PRICE`, cierre a mercado `reduceOnly`, balance total de la billetera USDT, PnL y comisiones desde los trades — en `it.fails` — en test/unit/binance-trading.test.ts
- [X] T060 [US2] Implementar `Exchange` con CCXT `binanceusdm` y pasar T059 a `it` en src/adapters/binance-trading.ts
- [X] T061 [US2] Escribir tests de integración del pipeline de carga (FR-020 completo, FR-061): válida → bajo mínimo → datos de mercado no disponibles (balance) → excede máximos → símbolo ya en operación → límite de posiciones → límite de capital → ejecutor; dos alertas casi simultáneas se evalúan en orden y la segunda ve la exposición de la primera — en `it.fails` — en test/integration/pipeline-trading.test.ts
- [X] T062 [US2] Conectar dimensionamiento, exposición y ejecutor al pipeline y pasar T061 a `it` en src/pipeline.ts
- [X] T063 [P] [US2] Escribir test contra Binance Demo Trading, obligatorio antes de LIVE y con resultado anotado en checklists/live.md (riesgo de R-06): colocar y cancelar una entrada lejos del precio, y verificar que SL/TP con `closePosition` son aceptados sobre una posición mínima (Binance los rechaza sin posición, -4509) y que el cierre a mercado la cierra, en test/demo/binance-demo.test.ts (corre solo con `BINANCE_DEMO_TESTS=1`)

**Checkpoint**: en DRY, una alerta válida termina "completa", "entrada no ejecutada" o "cerrada por emergencia".

---

## Phase 6: User Story 3 - Elegir modo DRY o LIVE al arrancar (Priority: P1)

**Goal**: DRY opera solo contra Demo Trading y LIVE solo contra producción, cada uno con sus credenciales.

**Independent Test**: AC-11, AC-12 y AC-49 con fábricas de adaptadores espiadas.

- [X] T064 [US3] Escribir tests de selección de modo (AC-11, AC-12, AC-49): `SIGNALBRIDGE_MODE=DRY` arma el exchange con `enableDemoTrading(true)` y `BINANCE_DEMO_*`; `LIVE` con producción y `BINANCE_LIVE_*`; ninguna orden ni consulta de balance al entorno del otro; los datos públicos siempre de producción — en `it.fails` — en test/integration/modes.test.ts
- [X] T065 [US3] Implementar la fábrica de adaptadores por modo y usarla en `main.ts`, y pasar T064 a `it`, en src/adapters/binance-trading.ts y src/main.ts

**Checkpoint**: `pnpm dev` y `pnpm start` apuntan cada uno a su entorno.

---

## Phase 7: User Story 5 - Seguir la posición hasta su cierre (Priority: P2)

**Goal**: cada cierre se detecta con su causa, PnL y comisiones; se cancelan las huérfanas y se libera el cupo.

**Independent Test**: AC-56 a AC-62, AC-64 y AC-67 con exchange y reloj fake (AC-62 y AC-67 se miden además en DRY en T085).

- [X] T066 [P] [US5] Escribir tests del seguimiento (AC-56, AC-57, AC-58, AC-59, AC-60, AC-61, AC-64, SC-004): polling cada 2 s; cierre por TP, SL, liquidación y manual con su causa; estado "cerrada"/"liquidada"; PnL y comisiones no vacíos; cancelación de la orden restante; cupo liberado para la próxima alerta; SL o TP desaparecido sin cierre → evento crítico sin tocar la posición; detección < 10 s — en `it.fails` — en test/unit/tracker.test.ts
- [X] T067 [US5] Implementar el seguimiento y pasar T066 a `it` en src/domain/tracker.ts
- [X] T068 [US5] Arrancar el polling del seguimiento en `main.ts` para las operaciones `abierta`, en src/main.ts

**Checkpoint**: las posiciones cerradas liberan cupo y quedan registradas.

---

## Phase 8: User Story 6 - Reconciliar con Binance al arrancar (Priority: P2)

**Goal**: al arrancar, antes de escuchar mensajes, el estado local se alinea con Binance.

**Independent Test**: AC-63, AC-65, AC-66 y AC-73 con exchange fake prearmado.

- [X] T069 [P] [US6] Escribir tests de la reconciliación (AC-63, AC-65, AC-66, AC-73, FR-040 a FR-042, FR-065): operación local en `con_ejecución` sin SL/TP confirmados → colocar lo que falta o cerrar a mercado con evento crítico; operación `abierta` sin SL o TP → solo evento crítico (FR-038); posición local ausente en Binance → cierre registrado y huérfana cancelada; entrada pendiente ejecutada → SL y TP (o cierre a mercado si fallan); plazo vencido → FR-031/FR-032 — en `it.fails` — en test/unit/reconcile.test.ts
- [X] T070 [US6] Implementar la reconciliación y pasar T069 a `it` en src/domain/reconcile.ts
- [X] T071 [US6] Escribir test de integración del arranque (FR-039): `main` no se suscribe a mensajes hasta que la reconciliación termina; con configuración inválida sale con 78 sin construir ningún adaptador (FR-058, FR-062) — en `it.fails` — en test/integration/startup.test.ts
- [X] T072 [US6] Correr la reconciliación antes de suscribirse a mensajes y pasar T071 a `it` en src/main.ts

**Checkpoint**: una caída no deja estado desalineado.

---

## Phase 9: User Story 7 - Vincular WhatsApp y mantener el sistema en pie (Priority: P2)

**Goal**: sesión cifrada, reconexión con backoff y reinicio automático.

**Independent Test**: AC-10, AC-29, AC-31, AC-47 y AC-74.

- [X] T073 [P] [US7] Escribir tests del store de sesión cifrado (AC-29, FR-049): ida y vuelta AES-256-GCM con `WHATSAPP_SESSION_KEY`, clave errónea falla sin dejar archivos, archivo 0600 en directorio 0700, `wipeWorkingProfile` borra un perfil de trabajo sobrante de una caída, el contenido guardado no contiene el número en texto plano — en `it.fails` — en test/unit/session-store.test.ts
- [X] T074 [US7] Implementar el store de sesión para `RemoteAuth` y pasar T073 a `it` en src/adapters/session-store.ts
- [X] T075 [US7] Reemplazar `LocalAuth` por `RemoteAuth` con el store cifrado, borrar el perfil de trabajo al cerrar y también al arrancar antes de conectarse (por si quedó de un `kill -9`), en src/adapters/whatsapp.ts
- [X] T076 [US7] Escribir tests del monitor de conexión (depende de T058, que expone `EmergencyState`; AC-47, FR-055): corte detectado < 30 s, eventos `connection` con esperas 1, 2, 4… 60 s, al 10.º fallo consecutivo evento crítico y salida con código 1, salvo con un cierre de emergencia en curso (evento crítico sin salida, AC-74); señal de Binance = fallo de la API de trading, contador separado por servicio y sin contar el refresco público (R-10) — en `it.fails` — en test/integration/reconnect.test.ts
- [X] T077 [US7] Implementar el monitor de conexión para WhatsApp y Binance y pasar T076 a `it` en src/connection-monitor.ts
- [X] T078 [P] [US7] Escribir tests del supervisor (AC-31, FR-056, contracts/cli.md): relanza ante salida ≠ 0 y vuelve a ingerir en < 60 s, no relanza ante 0 ni ante 78 — en `it.fails` — en test/unit/supervisor.test.ts
- [X] T079 [US7] Implementar el supervisor (`src/supervisor.ts`) y su script de entrada, cambiar `dev` y `start` de package.json para que corran `scripts/supervise.ts`, y pasar T078 a `it`, en src/supervisor.ts y scripts/supervise.ts

**Checkpoint**: el sistema se recupera solo y la sesión no queda en texto plano con el proceso detenido.

---

## Phase 10: User Story 8 - Credenciales fuera del repo y con mínimo privilegio (Priority: P3)

**Goal**: 0 secretos en el repo y key de producción solo con trading.

**Independent Test**: AC-27 y AC-28.

- [X] T080 [US8] Correr `gitleaks detect --source . --log-opts="--all"` sobre el árbol y todo el historial, corregir cualquier hallazgo y dejar el comando en la sección 7 de specs/001-alertas-whatsapp-binance/quickstart.md (AC-27)
- [ ] T081 [US8] Verificar en Binance que la key de producción tiene solo trading (sin retiro) y registrar fecha y resultado en specs/001-alertas-whatsapp-binance/checklists/live.md (AC-28)

---

## Phase 11: Polish & Cross-Cutting Concerns

- [X] T082 [P] Escribir tests del cálculo de latencia (SC-001, SC-002, AC-46, AC-48): p95 de `classifiedMs` y `entryAcceptedMs` desde el JSONL, separado por "solo texto" y "con imagen" — en `it.fails` — en test/unit/latency.test.ts
- [X] T083 Implementar el script de latencia y pasar T082 a `it` en scripts/latency.ts
- [ ] T084 [P] Actualizar docs/arquitectura.md al estado real: módulos de PRD-002/003, puertos, supervisor y sesión cifrada
- [ ] T085 Correr la validación de [quickstart.md](quickstart.md) en DRY (secciones 2 a 7), incluida la medición real de AC-31 (`kill -9` del proceso de la app, no del supervisor) y AC-29 después de ese `kill -9`, y anotar resultados y pendientes en specs/001-alertas-whatsapp-binance/checklists/live.md
- [ ] T086 Verificación final: `pnpm typecheck`, `pnpm test` en verde y ningún `it.fails` pendiente (`grep -rn "it.fails" test/` vacío)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (1)** → **Foundational (2)** → historias.
- **US1 (3)** primero: es el MVP y deja el pipeline y `main.ts` que usan las demás.
- **US4 (4)** depende de US1 (registra lo que produce el pipeline).
- **US2 (5)** depende de US1 y US4.
- **US3 (6)** depende de US2 (selecciona el adaptador de trading).
- **US5 (7)** depende de US2; **US6 (8)** depende de US2 y US5.
- **US7 (9)** depende de US1 (adaptador de WhatsApp); T072–T075 y T078–T079 pueden ir en paralelo con US2–US6, pero T076–T077 (monitor de conexión) dependen de T058 (señal de cierre de emergencia en curso).
- **US8 (10)** y **Polish (11)** al final.

### Within Each User Story

- El test de cada par va primero, en `it.fails`, y se commitea solo (`test(...)`).
- El código va después y cambia `it.fails` por `it` (`feat(...)`).
- Si un test nuevo ya pasa antes del código, se revisa (no prueba nada nuevo).

### Parallel Opportunities

- Setup: T002 a T006.
- Foundational: T008 a T011, y los tests T014, T016 y T018 entre sí.
- US1: los tests T021, T023, T025, T027, T029, T031, T033, T035, T039, T041 y T045 son de archivos distintos.
- US2: T052, T054, T056, T057, T059 y T063.
- US7 en paralelo con US2–US6, salvo T076–T077, que esperan a T058.

---

## Parallel Example: User Story 1

```bash
# Tests de módulos independientes, en paralelo (cada uno en su commit test(...)):
Task: "T029 Tests de símbolos y precios en test/unit/symbols.test.ts"
Task: "T031 Tests de velas de 45 min en test/unit/candles.test.ts"
Task: "T035 Tests del ranking en test/unit/ranking.test.ts"

# Después, cada implementación con su commit feat(...):
Task: "T030 Implementar src/domain/symbols.ts"
Task: "T032 Implementar src/domain/candles.ts"
Task: "T036 Implementar src/domain/ranking.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Setup + Foundational.
2. US1 completa → `pnpm dev` clasifica alertas reales sin operar.
3. **Parar y validar**: comparar en DRY la clasificación contra lectura manual.

### Incremental Delivery

1. US1 + US4 → validación auditada.
2. US2 + US3 → carga protegida en Demo Trading.
3. US5 + US6 → ciclo de vida completo.
4. US7 → resiliencia y sesión cifrada (requisito antes de LIVE).
5. US8 + Polish → verificación final y política manual de habilitación de LIVE.

---

## Notes

- Cada tarea nombra su archivo y su criterio de terminado (los AC/FR entre paréntesis).
- Commit por cada test y por cada implementación; push al cerrar cada fase.
- Mensajes de commit con el skill `conventional-commit`, mostrados al usuario antes de commitear.
- Ninguna tarea toca la API real de Claude ni de Binance en `pnpm test`.
