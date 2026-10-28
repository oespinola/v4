# Checklist: antes de habilitar LIVE

**Purpose**: verificaciones contra Binance Demo Trading que tienen que pasar antes de operar en LIVE.
**Created**: 2026-10-28

## Órdenes en Demo Trading (R-06, T063)

- [ ] CHK001 `BINANCE_DEMO_TESTS=1 pnpm vitest run test/demo` en verde: entrada LIMIT lejos del precio, SL
  `STOP_MARKET` y TP `TAKE_PROFIT_MARKET` condicionales con `closePosition` aceptados y cancelados, sin
  órdenes abiertas al terminar. Resultado: _pendiente de correr_.
