# Data Model: Alertas de trading de WhatsApp a Binance Futuros

**Feature**: [spec.md](spec.md) · **Plan**: [plan.md](plan.md)

Todo vive en `data/` (`0700`): `signalbridge.db` (SQLite, `0600`) y `alerts.log` (JSONL, `0600`).

## Mensaje (en memoria, no se persiste)

| Campo | Tipo | Regla |
|---|---|---|
| waMessageId | string | ID de WhatsApp; parte del identificador (FR-006) |
| sender | string | normalizado sin sufijo de dispositivo |
| text | string | |
| image | Buffer \| null | se descarga solo si el texto no alcanza (FR-004) |
| receivedAt | instante | marca de inicio para SC-001/SC-002 |

Si `text` no contiene "alerta de trading" (sin mayúsculas ni tildes) se descarta sin rastro (FR-001).

## Alerta (`alerts`)

| Campo | Tipo | Regla |
|---|---|---|
| alertId | string, PK | `<waMessageId>:<hash 16 hex>` (FR-006) |
| waMessageId | string, único | duplicado por ID (FR-007) |
| contentHash | string, indexado | hash de símbolo mapeado, Entrada y SL ajustados y TP ajustado o texto del objetivo; con los valores crudos si se rechaza antes del mapeo (FR-006). Solo las alertas no rechazadas bloquean un reenvío (FR-007) |
| receivedAt, classifiedAt | instantes | |
| mode | `DRY` \| `LIVE` | |
| sender | string | |
| ticker | string | crudo |
| riskLevel | `Medio` \| `Medio-Alto` \| `Alto` \| texto (FR-003) | no afecta la cantidad (FR-022) |
| entryRaw, slRaw | decimal | crudos |
| target | `{ price: decimal }` \| `{ text: string }` | FR-014 / FR-015 |
| symbol | string \| null | `TICKERUSDT` o `1000TICKERUSDT` (FR-009) |
| priceFactor | 1 \| 1000 | |
| side | `LONG` \| `SHORT` \| null | SL < Entrada → LONG (FR-008) |
| entry, sl, tp | decimal \| null | ajustados al tickSize (FR-011) |
| tpSource | `alerta` \| `calculado` \| null | |
| status | ver estados | |
| reason | motivo de FR-045 \| null | solo el primero (FR-020) |

### Estados (FR-044)

```text
(nueva) ─┬─ rechazada (+ motivo)
         └─ válida → entrada_pendiente ─┬─ entrada_no_ejecutada
                                        └─ con_ejecución ─┬─ cerrada_por_emergencia
                                                          └─ completa ─┬─ cerrada (TP | SL | manual)
                                                                       └─ liquidada
```

`válida`, `entrada_pendiente` y `con_ejecución` son estados de trabajo; los finales que se loguean son
los de FR-044: completa, rechazada, cerrada por emergencia, entrada no ejecutada, cerrada, liquidada.

## Edición de alerta (`edits`)

| Campo | Tipo |
|---|---|
| alertId | FK → alerts |
| editedAt | instante |
| previousText, newText | string |
| changedFields | lista de nombres de campo |

No se opera (FR-047).

## Operación (`trades`)

Una por alerta válida que llegó a colocar entrada.

| Campo | Tipo | Regla |
|---|---|---|
| alertId | FK, PK | |
| quantity | decimal | `R / |entry − sl|`, piso al stepSize (FR-021) |
| notional | decimal | quantity × entry, USDT |
| riskR | decimal | valor configurado al momento |
| symbolLeverage | entero | margen aislado (FR-060) |
| entryOrderId, slOrderId, tpOrderId | string \| null | IDs de Binance |
| entryPlacedAt | instante | inicio del plazo de 3 min (FR-031) |
| filledQty | decimal | |
| state | `pendiente` \| `con_ejecución` \| `abierta` \| `cerrada` | `pendiente`: entrada sin ejecución; `con_ejecución`: hubo ejecución pero el SL y el TP todavía no están confirmados; `abierta`: "completa" (FR-029). Los tres primeros cuentan para FR-025/FR-026 y FR-063 |
| closeCause | `TP` \| `SL` \| `liquidación` \| `cierre manual` \| null | FR-033; el cierre de emergencia se registra por el estado "cerrada por emergencia" |
| closedAt | instante \| null | |
| realizedPnl, fees | decimal \| null | según Binance (FR-036) |

Reglas de exposición: posiciones = cantidad de `trades` en `pendiente`, `con_ejecución` o `abierta`
(FR-025); capital comprometido = suma de `notional` de esos mismos (FR-026); un símbolo con alguno de
esos estados rechaza nuevas alertas como "símbolo ya en operación" (FR-063).

Estados terminales: una entrada no ejecutada y un cierre de emergencia también terminan en `cerrada`
(con `closeCause` null); el estado de la alerta (FR-044) dice cuál de los dos fue.

Reconciliación (FR-065): una operación local en `con_ejecución` al arrancar nunca quedó protegida →
se colocan el SL y el TP que falten o se cierra a mercado; una en `abierta` sin SL o TP → solo evento
crítico (FR-038). Una operación pasa a `cerrada` apenas se
detecta el cierre y deja de contar (FR-035).

## Ranking top 3 (en memoria)

| Campo | Tipo |
|---|---|
| gainers, losers | 3 símbolos cada uno, perpetuos `TRADING`, por priceChangePercent (FR-017) |
| refreshedAt | instante; > 120 s → "ranking no disponible" (FR-018) |

## Símbolos (en memoria)

`symbol → { tickSize, stepSize, minQty, minNotional, status }`, refrescado junto con el ranking.

## Configuración (validada al arrancar)

| Campo | Regla |
|---|---|
| mode | `DRY` \| `LIVE` |
| riskR, maxPositions, maxCapital, maxPositionSize, maxLeverage, symbolLeverage | requeridos, > 0 (FR-062) |
| maxSlDistancePct | > 0, por defecto 15 (FR-013) |
| authorizedSenders | lista, al menos uno |
| groupName | requerido |
| credenciales | IA, sesión de WhatsApp y Binance del modo activo, requeridas (FR-058) |

## Entrada de log (`alerts.log`, JSONL)

Una línea por evento: `alert` (registro de FR-043 completo cada vez que cambia el estado), `edit`,
`connection` (interrupción, reintento, reconexión) y `critical` (cierre de emergencia, pérdida de SL/TP,
10.º fallo de reconexión, falla del cierre a mercado). Esquema en
[contracts/log-record.md](contracts/log-record.md).
