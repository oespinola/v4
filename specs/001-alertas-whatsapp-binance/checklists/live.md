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
