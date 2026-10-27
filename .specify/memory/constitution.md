<!--
Sync Impact Report
- Versión: (plantilla sin completar) → 1.0.0
- Principios: todos nuevos (adopción inicial)
  - I. Aislamiento de la IA
  - II. Grounding obligatorio
  - III. Posición siempre protegida (NO NEGOCIABLE) — movido desde AGENTS.md
  - IV. Test-first en lo que importa
  - V. Cero secretos y mínimo privilegio — ampliado con reglas de AGENTS.md
  - VI. El PRD manda
- Secciones agregadas: Flujo de desarrollo (movido desde AGENTS.md), Revisión y cumplimiento
- Secciones eliminadas: ninguna
- Plantillas:
  - ✅ .specify/templates/tasks-template.md (tests obligatorios para la lógica crítica, Principio IV)
  - ✅ .specify/templates/plan-template.md (sin cambios: los gates se derivan de esta constitución)
  - ✅ .specify/templates/spec-template.md (sin cambios)
  - ✅ AGENTS.md (reglas de proceso y de seguridad reemplazadas por referencia a la constitución)
- TODOs diferidos: ninguno
-->
# Constitución de SignalBridge

## Core Principles

### I. Aislamiento de la IA

Toda llamada a modelos de IA DEBE vivir en un módulo dedicado, nunca mezclada con la lógica de
negocio, y DEBE ser reemplazable por un mock en los tests.

Razón: la lógica de validación y de órdenes tiene que poder probarse sin red, sin costo y de forma
determinista, y el proveedor o el modelo de IA tiene que poder cambiarse sin tocar las reglas.

### II. Grounding obligatorio

Ninguna orden DEBE usar datos que no salgan de la alerta (texto o imagen) o de una regla del PRD.
Ante la duda (dato faltante, ambiguo o inconsistente), la alerta se rechaza con su motivo en el
log, sin inventar ni completar valores.

Razón: una orden con un dato inventado opera dinero real; rechazar y dejar el motivo auditado
siempre es más barato que una entrada equivocada.

### III. Posición siempre protegida (NO NEGOCIABLE)

Ninguna entrada DEBE quedar ejecutada sin su SL y su TP colocados. Si la entrada se ejecuta
(total o parcialmente) y falla la colocación del SL o del TP, el sistema DEBE cerrar la posición
de inmediato en vez de dejarla desprotegida (RF-10, RF-18, RF-34, RF-39).

Razón: una posición sin stop expone la cuenta a pérdidas sin límite, sin que el operador esté
mirando el chat.

### IV. Test-first en lo que importa

La extracción y validación de alertas, el dimensionamiento, la colocación de entrada/SL/TP y la
reversión ante fallas DEBEN desarrollarse con el ciclo rojo-verde-refactor: primero el test
(commit con `it.fails`), después el código (commit que lo pasa a `it`). Cada feature o fix lleva
sus tests.

Razón: es la lógica donde un error se traduce directamente en pérdidas, y el historial de commits
tiene que mostrar que cada regla tuvo un test que falló antes de existir el código.

### V. Cero secretos y mínimo privilegio

- Las credenciales (`ANTHROPIC_API_KEY` y las de Binance) DEBEN leerse solo de variables de
  entorno (`.env`, que no se commitea). Ninguna key DEBE aparecer en el repo (RNF-02, RNF-03).
- La sesión de WhatsApp (auth local) NO DEBE commitearse.
- La API key de Binance DEBE tener únicamente permiso de trading, nunca de retiro de fondos
  (RNF-08).

Razón: el repo y sus copias no son un lugar seguro para secretos, y una key filtrada sin permiso
de retiro limita el daño posible.

### VI. El PRD manda

No se agregan features fuera de los PRD vigentes en `docs/prd/`. Si algo falta, primero se cambia
el PRD y el spec, después el código.

Razón: el PRD es la única fuente de verdad sobre qué hace el sistema; código sin requisito no
tiene criterio de aceptación contra el cual probarse.

## Flujo de desarrollo

- Se commitea a medida que se modifica el proyecto, en commits chicos.
- Antes de cada commit DEBE validarse que el software compila y que `pnpm test` está en verde.
- Cada feature o fix sigue dos commits, en este orden:
  1. `test(...)`: los tests nuevos, que hoy fallan, marcados con `it.fails` de Vitest. Así
     `pnpm test` sigue en verde (`it.fails` pasa mientras el test falla).
  2. `feat(...)` o `fix(...)`: el código, cambiando esos `it.fails` por `it`. Si el código ya
     existe y alguien olvida el cambio, `it.fails` falla y lo avisa.
- Si un test nuevo ya pasa antes de escribir el código, no prueba nada nuevo: se revisa antes de
  commitearlo.

## Revisión y cumplimiento

- Todo plan (`/speckit-plan`) DEBE pasar el "Constitution Check" contra los seis principios antes
  de investigar y de nuevo después del diseño. Una violación solo se acepta justificada en la
  tabla de complejidad del plan.
- Todo cambio que toque la colocación de órdenes DEBE mostrar cómo cumple el Principio III, con
  un test del camino de falla (SL o TP rechazado → cierre de la posición).
- `AGENTS.md` contiene la guía operativa (stack, comandos); ante un conflicto, manda esta
  constitución.

## Governance

- Los cambios a esta constitución los aprueba el instructor del proyecto y se registran con un
  commit (`docs: amend constitution to vX.Y.Z ...`).
- Versionado semántico: MAJOR al quitar o redefinir un principio; MINOR al agregar un principio o
  sección, o ampliar materialmente una guía; PATCH en aclaraciones y redacción.
- Cada enmienda actualiza el Sync Impact Report del encabezado y propaga los cambios a las
  plantillas de `.specify/templates/` y a `AGENTS.md`.
- La constitución se escribe en español.

**Version**: 1.0.0 | **Ratified**: 2026-10-27 | **Last Amended**: 2026-10-27
