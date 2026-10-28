# Contrato: registro del log (`data/alerts.log`, JSONL)

Una línea JSON por evento, con `type` y `at` (ISO 8601 UTC) siempre presentes. Archivo `0600`.

## `type: "alert"`

Se escribe cuando la alerta llega a un estado final de FR-044: al rechazarla, o cuando la operación
termina "completa", "entrada no ejecutada" o "cerrada por emergencia", y otra vez al cerrarse
("cerrada"/"liquidada"). La última línea de un `alertId` es su estado vigente. Los estados de trabajo
(válida, entrada pendiente, con ejecución) viven solo en la base y no se loguean. Los campos que no
aplican van en `null` (FR-043).

| Campo | Tipo |
|---|---|
| alertId | string |
| receivedAt | string ISO |
| sender | string |
| mode | `"DRY"` \| `"LIVE"` |
| ticker, symbol | string \| null |
| side | `"LONG"` \| `"SHORT"` \| null |
| entry, sl, tp | number \| null |
| tpSource | `"alerta"` \| `"calculado"` \| null |
| quantity, riskR | number \| null |
| riskLevel | string \| null |
| orderIds | `{ entry, sl, tp }` (string \| null cada uno) |
| closeCause | `"TP"` \| `"SL"` \| `"liquidación"` \| `"cierre manual"` \| null |
| closedAt | string ISO \| null |
| realizedPnl, fees | number \| null |
| status | `"completa"` \| `"rechazada"` \| `"cerrada por emergencia"` \| `"entrada no ejecutada"` \| `"cerrada"` \| `"liquidada"` |
| reason | uno de FR-045 si `status = "rechazada"`, si no `null` |
| timings | `{ classifiedMs, entryAcceptedMs, withImage }` para SC-001/SC-002: ms desde que el mensaje llegó al sistema, y si hubo que analizar la imagen |

## `type: "edit"`

`alertId`, `previousText`, `newText`, `changedFields` (FR-047).

## `type: "connection"`

`service` (`"whatsapp"` \| `"binance"`), `event` (`"interrupción"` \| `"reintento"` \| `"reconectado"`),
`attempt`, `waitMs` (FR-055).

## `type: "critical"`

`kind` (`"cierre de emergencia"` \| `"falla del cierre de emergencia"` \| `"SL/TP perdido"` \|
`"reconexión agotada"` \| `"entrada sin confirmar"`), `alertId` si aplica y `detail` (FR-030,
FR-038, FR-055, FR-069).
