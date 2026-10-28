# Implementation Plan: Alertas de trading de WhatsApp a Binance Futuros

**Branch**: `001-alertas-whatsapp-binance` | **Date**: 2026-10-27 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-alertas-whatsapp-binance/spec.md`

**Dirección técnica recibida**: "Usá el mismo stack de nuestro AGENTS.md: Node.js 22 LTS, pnpm, Vitest,
whatsapp-web.js (ingesta de WhatsApp) + CCXT (Binance Futuros) + API de Anthropic Claude (parseo
texto/imagen). Todo en español."

## Summary

Un único proceso Node lee el grupo de WhatsApp, convierte cada mensaje con "alerta de trading" en una
alerta validada contra las reglas del PRD (en el orden de FR-020) y, si es válida, la dimensiona, la
controla contra los límites de exposición y la coloca en Binance Futuros como orden límite con SL y TP
de cierre de posición, cerrando a mercado si la protección falla. Después sigue la posición hasta su
cierre y se reconcilia con Binance al arrancar. Las reglas viven en funciones puras; WhatsApp, Claude,
Binance, disco y reloj son adaptadores detrás de puertos ([contracts/ports.md](contracts/ports.md)), así
cada criterio de aceptación se prueba sin red. Decisiones y alternativas en [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript estricto sobre Node.js 22 LTS (≥ 22.23), ejecutado con `tsx` (R-01)

**Primary Dependencies**: whatsapp-web.js ^1.34 (+ qrcode-terminal), ccxt ^4.5 (`binanceusdm`),
@anthropic-ai/sdk (modelo `claude-sonnet-5-5`), zod ^4 — mismas versiones que la vuelta M2-M3 (`../v3`)

**Storage**: SQLite nativo (`node:sqlite`) + log JSONL en `data/` (R-08)

**Testing**: Vitest ^5, con *fakes* de los puertos; `it.fails` para el commit de test (R-12)

**Target Platform**: proceso de larga duración en Linux (máquina del operador), con Chromium headless
para WhatsApp

**Project Type**: aplicación de consola / servicio de un solo proceso

**Performance Goals**: clasificación p95 < 3 s (texto) / < 10 s (imagen); entrada aceptada p95 < 5 s /
< 12 s; cierre de emergencia < 5 s; cierre detectado y SL/TP perdido < 10 s (SC-001 a SC-004)

**Constraints**: alertas de a una (FR-061); detección de desconexión < 30 s; reinicio < 60 s; permisos
0700/0600; sin secretos en el repo; DRY nunca toca producción ni LIVE toca Demo (SC-006)

**Scale/Scope**: un operador, un grupo, decenas de alertas por día, pocas posiciones simultáneas
(acotadas por `MAX_POSITIONS`)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

### Antes de Phase 0

| Principio | Cumple | Cómo |
|---|---|---|
| I. Aislamiento de la IA | ✓ | Claude solo en `adapters/claude-extractor.ts`, detrás de `FieldExtractor`; el dominio no importa el SDK; los tests usan un fake. |
| II. Grounding obligatorio | ✓ | Datos solo del texto/imagen; derivados solo por reglas del PRD (side, mapeo ×1000, ajuste al tick, TP por ASL21/EMA55, cantidad). Lo que saca el regex manda; Claude solo completa faltantes; falla de IA = "incompleta". |
| III. Posición siempre protegida | ✓ | El ejecutor coloca SL y TP con la primera ejecución; si alguno falla, cierre a mercado con reintento con backoff hasta cerrar y evento crítico (FR-030). La reconciliación al arrancar aplica lo mismo a entradas ejecutadas durante una caída (FR-041). |
| IV. Test-first | ✓ | Vitest para toda la lógica de extracción, validación, dimensionamiento, colocación y reversión; cada feature con commit `test(...)` en `it.fails` antes del código. |
| V. Cero secretos y mínimo privilegio | ✓ | Credenciales solo por `.env` (ignorado), variables distintas por modo, sesión de WhatsApp cifrada, key de producción solo trading (verificación manual AC-28). |
| VI. El PRD manda | ✓ | Ninguna pieza sin requisito: no hay backtest, replay ni dashboard (fuera de alcance). El script de latencia existe solo para medir SC-001/SC-002. |

Sin violaciones. Gate superado.

### Después de Phase 1 (diseño)

| Principio | Cumple | Revisión del diseño |
|---|---|---|
| I | ✓ | `contracts/ports.md` fija `FieldExtractor` como única entrada a la IA; timeout y "nunca lanza" están en el contrato. |
| II | ✓ | `data-model.md`: el hash usa valores crudos; `tpSource` registra si el TP vino de la alerta o se calculó. |
| III | ✓ | SL/TP con `closePosition` cubren ejecuciones posteriores sin recalcular (R-06). Camino de falla con test de integración obligatorio (Revisión y cumplimiento de la constitución). Riesgo abierto: soporte de órdenes condicionales en la versión de CCXT, cubierto por un test contra Demo antes de LIVE. |
| IV | ✓ | Puerto `Clock` inyectable para testear plazos (3 min, 24 h, 120 s) sin esperar. |
| V | ✓ | `contracts/cli.md` lista todas las variables; salida 78 sin conectar si falta alguna. Riesgo abierto: perfil de Chromium descomprimido mientras corre (R-03); AC-29 se valida con el proceso detenido y es requisito antes de LIVE. |
| VI | ✓ | El modo de margen aislado y el procesamiento de a una salieron del spec (FR-060, FR-061), no del plan. |

Sin violaciones. Los dos riesgos abiertos no violan principios: tienen verificación definida y bloquean
LIVE, no DRY.

## Project Structure

### Documentation (this feature)

```text
specs/001-alertas-whatsapp-binance/
├── plan.md              # Este archivo
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1: cli.md, log-record.md, ports.md
├── checklists/          # requirements.md, operacion.md
└── tasks.md             # Phase 2 (/speckit-tasks, no lo crea este comando)
```

### Source Code (repository root)

```text
src/
├── domain/                 # funciones puras, sin I/O
│   ├── filter.ts           # FR-001, FR-002
│   ├── parser.ts           # FR-003 (regex)
│   ├── extract.ts          # regex → FieldExtractor, "incompleta" (FR-004, FR-005, FR-059)
│   ├── identity.ts         # alertId y hash crudo (FR-006, FR-007)
│   ├── symbols.ts          # mapeo ×1000, tickSize (FR-009 a FR-011)
│   ├── candles.ts          # velas de 15 min → 45 min alineadas a 00:00 UTC (FR-015)
│   ├── indicators.ts       # EMA, WMA, ASL21/EMA55 (FR-015, FR-016)
│   ├── ranking.ts          # top 3 y antigüedad (FR-017 a FR-019)
│   ├── validate.ts         # orden de FR-020, un único motivo
│   ├── sizing.ts           # cantidad, mínimos, máximos (FR-021 a FR-024)
│   ├── exposure.ts         # límites de posiciones y capital (FR-025, FR-026)
│   ├── executor.ts         # máquina de estados de la operación (FR-027 a FR-032, FR-060)
│   ├── tracker.ts          # cierre, causa, huérfanas, SL/TP perdido (FR-033 a FR-038)
│   ├── reconcile.ts        # comparación al arrancar (FR-039 a FR-042)
│   ├── backoff.ts          # 1, 2, 4… 60 s; 10 fallos (FR-055, FR-030)
│   └── types.ts
├── ports.ts                # FieldExtractor, MarketData, Exchange, MessageSource, Clock
├── adapters/
│   ├── whatsapp.ts         # whatsapp-web.js + RemoteAuth (FR-048, FR-057, FR-047)
│   ├── session-store.ts    # store cifrado AES-256-GCM (FR-049)
│   ├── claude-extractor.ts # único módulo que habla con la IA (Principio I)
│   ├── binance-public.ts   # endpoints públicos con fetch (R-05)
│   ├── binance-trading.ts  # CCXT, Demo/producción (FR-051, FR-052)
│   ├── store.ts            # SQLite + JSONL, umask y permisos (FR-043 a FR-047)
│   └── clock.ts
├── config.ts               # .env + zod, salida 78 (FR-058, FR-062)
├── queue.ts                # concurrencia 1 (FR-061)
├── pipeline.ts             # mensaje → alerta → validación → executor
└── main.ts                 # arma adaptadores, reconcilia y recién después escucha mensajes

scripts/
├── supervise.ts            # relanza ante salida ≠ 0 y ≠ 78 (FR-056)
└── latency.ts              # p95 desde el log (SC-001, SC-002)

test/
├── unit/                   # un archivo por módulo de domain/ + config, queue, backoff
├── integration/            # pipeline y executor completos con fakes (incluye caminos de falla)
├── demo/                   # opcional, contra Binance Demo Trading (BINANCE_DEMO_TESTS=1)
└── fixtures/               # alertas reales anonimizadas, velas y tickers conocidos
```

**Structure Decision**: proyecto único, separado en `domain/` (reglas del PRD, puras) y `adapters/`
(I/O), unidos por `ports.ts`. Es la estructura de `docs/arquitectura.md` y de v3, para comparar el
mismo resultado técnico con otro proceso. `main.ts` corre la reconciliación antes de suscribirse a
mensajes (FR-039).

## Complexity Tracking

Sin violaciones de la constitución que justificar.
