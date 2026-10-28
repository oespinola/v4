# Quickstart: validar la feature de punta a punta

**Feature**: [spec.md](spec.md) · Comandos y variables en [contracts/cli.md](contracts/cli.md) ·
Formato del log en [contracts/log-record.md](contracts/log-record.md)

## Requisitos previos

- Node.js 22 LTS (≥ 22.23) y pnpm.
- Cuenta en Binance Demo Trading con API key; para LIVE, una key de producción **solo con trading**
  (sin retiro, AC-28).
- `ANTHROPIC_API_KEY`, un número de WhatsApp dedicado y acceso al grupo de alertas.
- gitleaks instalado (para AC-27).

## 1. Instalación y verificación sin red

```bash
pnpm install
cp .env.example .env      # completar valores; .env está en .gitignore
pnpm typecheck            # compila
pnpm test                 # todos los criterios de aceptación con fakes, sin red
```

Resultado esperado: `pnpm test` en verde; los `it.fails` pendientes figuran como "expected fail".

## 2. Configuración inválida (FR-058, FR-062)

```bash
RISK_R_USDT=0 pnpm dev
```

Esperado: la app lista `RISK_R_USDT` como inválido, sale con código 78, no muestra QR ni se conecta, y
el supervisor no la relanza.

## 3. Vínculo y validación en DRY (US1, US3, US4, US7)

```bash
pnpm dev
```

1. Sin sesión guardada aparece el QR; escanearlo con el número dedicado (AC-10).
2. Mandar al grupo, desde un remitente autorizado, una alerta completa, una sin "alerta de trading",
   una incompleta y un reenvío de la primera.
3. `tail -f data/alerts.log | jq` muestra: la completa como válida → `completa` o `entrada no ejecutada`,
   la incompleta como `rechazada`/`incompleta`, el reenvío como `duplicado`, y nada para el mensaje sin
   disparador (AC-05, AC-17, AC-21).
4. `stat -c '%a' data data/*` → `700` para el directorio y `600` para los archivos (AC-50).

## 4. Carga protegida en DRY (US2)

Con una alerta válida cuya Entrada esté cerca del precio de mercado:

- En Demo Trading se ve la orden límite; al ejecutarse aparecen SL y TP con cierre de posición (AC-43,
  AC-55) y el log pasa a `completa` (AC-15).
- Sin ejecución en 3 minutos, la orden se cancela y el log dice `entrada no ejecutada` (AC-23).
- El camino de falla (SL rechazado → cierre a mercado < 5 s + evento crítico, AC-16) se valida con los
  tests de integración del paso 1, no a mano.

## 5. Seguimiento y reconciliación en DRY (US5, US6)

- Cerrar a mano una posición completa en Demo Trading → log `cerrada`/`cierre manual` y la orden
  restante cancelada en < 10 s (AC-58, AC-60, SC-004).
- Cancelar a mano el SL de una posición → evento `critical` "SL/TP perdido" en < 10 s (AC-64).
- Detener la app (Ctrl+C), dejar que una posición cierre por SL, volver a arrancar → antes de cualquier
  alerta nueva el log registra el cierre y la orden de TP huérfana queda cancelada (AC-63).

## 6. Resiliencia (US7)

- Cortar la red unos segundos → eventos `connection` con esperas 1 s, 2 s, 4 s… (AC-47).
- `kill -9` del proceso de la app → el supervisor la relanza y vuelve a ingerir en < 60 s (AC-31).

## 7. Latencia y secretos

```bash
pnpm latency                                   # p95 < 3 s / 10 s y < 5 s / 12 s (SC-001, SC-002)
gitleaks detect --source . --log-opts="--all"  # 0 hallazgos (AC-27)
```

## 8. Antes de LIVE (política manual, no la controla el sistema)

- ≥ 7 días corridos y ≥ 20 alertas procesadas en DRY con 0 errores de clasificación contra revisión
  manual.
- Sesión de WhatsApp cifrada verificada (AC-29) y key de producción solo con trading (AC-28).
- Recién entonces `pnpm start`.
