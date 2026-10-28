# Contrato: comandos y configuración del operador

## Comandos

| Comando | Qué hace | Requisito |
|---|---|---|
| `pnpm dev` | Supervisor + app en modo DRY (Binance Demo Trading) | FR-050, FR-051 |
| `pnpm start` | Supervisor + app en modo LIVE (producción) | FR-050, FR-051 |
| `pnpm dev:once` | La app en DRY sin supervisor (para depurar; no se relanza) | — |
| `pnpm test` | Tests (Vitest), sin red ni credenciales | Principio IV |
| `pnpm typecheck` | `tsc --noEmit` | AGENTS.md |
| `pnpm latency` | p95 de clasificación y de aceptación de la entrada sobre el log | SC-001, SC-002 |

Sin sesión guardada, la app muestra el QR en la terminal (FR-048).

## Códigos de salida de la app

| Código | Significado | ¿El supervisor la relanza? |
|---|---|---|
| 0 | Cierre pedido por el operador (Ctrl+C) | No |
| 1 | Caída o 10.º fallo consecutivo de reconexión (FR-055) | Sí, en < 60 s (FR-056) |
| 78 | Configuración faltante o inválida (FR-058, FR-062) | No: hay que corregir el `.env` |

## Variables de entorno (`.env`, no se commitea)

| Variable | Modo | Regla |
|---|---|---|
| `ANTHROPIC_API_KEY` | ambos | opcional; sin ella no se analiza la imagen y se avisa al arrancar (FR-004) |
| `WHATSAPP_SESSION_KEY` | ambos | requerida; 32 bytes en hex o base64 (FR-049) |
| `WHATSAPP_GROUP_NAME` | ambos | requerida |
| `AUTHORIZED_SENDERS` | ambos | lista separada por comas, al menos uno (FR-002) |
| `BINANCE_DEMO_API_KEY`, `BINANCE_DEMO_API_SECRET` | DRY | requeridas en DRY (FR-052) |
| `BINANCE_LIVE_API_KEY`, `BINANCE_LIVE_API_SECRET` | LIVE | requeridas en LIVE; key solo con trading (FR-054) |
| `RISK_R_USDT` | ambos | > 0 (FR-021) |
| `MAX_POSITIONS` | ambos | entero > 0 (FR-025) |
| `MAX_CAPITAL_USDT` | ambos | > 0 (FR-026) |
| `MAX_POSITION_USDT` | ambos | > 0 (FR-024) |
| `MAX_LEVERAGE` | ambos | > 0 (FR-024) |
| `SYMBOL_LEVERAGE` | ambos | entero > 0 (FR-060) |
| `MAX_SL_DISTANCE_PCT` | ambos | > 0; por defecto 15 (FR-013) |
| `SIGNALBRIDGE_DATA_DIR` | ambos | opcional; por defecto `data` |

El modo lo fija el comando (`SIGNALBRIDGE_MODE=DRY|LIVE`), no el `.env`. Si falta o es inválida
cualquier variable requerida, la app escribe en la consola la lista de lo que falta y sale con 78 sin
conectarse a WhatsApp ni a Binance.
