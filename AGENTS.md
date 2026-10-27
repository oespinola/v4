# AGENTS.md

## Propósito
SignalBridge lee alertas de trading de un grupo de WhatsApp (texto + imagen), las valida
y carga automáticamente como órdenes long/short (entrada, SL, TP) en Binance Futuros.

## Stack
- Node.js 22 LTS
- pnpm (gestor de paquetes)
- Vitest (test runner)
- whatsapp-web.js (ingesta de WhatsApp) + CCXT (Binance Futuros) + API de Anthropic Claude (parseo texto/imagen)

## Cómo correr
```bash
pnpm install       # instalar dependencias
pnpm dev           # levantar en modo DRY (órdenes contra Binance Demo Trading, demo.binance.com)
pnpm start         # levantar en modo LIVE (órdenes reales en Binance Futuros)
pnpm test          # correr tests
```

## Constitución
Las reglas de diseño y de proceso viven en `.specify/memory/constitution.md` y mandan sobre este
archivo. Recordatorio de las que no se negocian:
- Commits chicos y frecuentes; antes de cada uno, compila y `pnpm test` en verde. Cada feature o
  fix: primero `test(...)` con `it.fails`, después `feat(...)`/`fix(...)` pasándolos a `it`.
- Cada etapa de Spec Kit (constitution, specify, clarify, plan, tasks, implement) termina con
  commit y push a `origin`: el historial remoto se evalúa etapa por etapa.
- Ninguna API key ni la sesión de WhatsApp en el repo; la key de Binance solo con permiso de
  trading (Principio V).
- Nunca una entrada sin SL y TP: si falla alguno, se cierra la posición (Principio III).
