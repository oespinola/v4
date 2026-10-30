# PRD-002: SignalBridge — Carga de la operación y reversión ante fallas

## Contexto y Problema

Ver [PRD-000](PRD-000-marco.md) (problema, personas, glosario y ciclo de vida). Este
documento cubre el tramo desde una alerta que superó PRD-001 hasta que la operación
queda completa (entrada, SL y TP en Binance) o revertida: dimensionamiento, límites de
exposición, colocación de órdenes, timeout de la entrada y cierre de emergencia.

## Objetivos

Que una alerta validada se convierta, en segundos (RNF-09), en una orden cargada en
Binance Futuros con SL y TP correctos, sin dejar nunca una posición desprotegida.

## Requerimientos Funcionales
- RF-08: El sistema debe calcular la cantidad a operar dividiendo un riesgo fijo R en
  USDT, configurado por el operador, por la distancia |Entrada − SL|, redondeando hacia
  abajo al stepSize del símbolo y usando los precios ya ajustados al tickSize (RF-37).
- RF-10: El sistema debe considerar una operación completa solo cuando la entrada tenga
  ejecución y el SL y el TP estén colocados y aceptados por Binance cubriendo la
  posición abierta.
- RF-12: El sistema debe rechazar una alerta válida si abrirla haría que la suma de
  posiciones abiertas y órdenes de entrada pendientes supere el máximo configurable de
  posiciones simultáneas.
- RF-15: El sistema debe rechazar una alerta cuyo nocional exceda el tamaño de posición
  máximo configurado (USDT), o cuyo apalancamiento efectivo (nocional / balance de la
  cuenta del modo activo) exceda el apalancamiento máximo configurado.
- RF-18: Si la orden de entrada tuvo ejecución y la colocación del SL o del TP falla, el
  sistema debe cerrar la posición con una orden a mercado.
- RF-19: Si la orden de entrada falla o no tiene ninguna ejecución a los 3 minutos de
  colocada, el sistema debe cancelarla y no colocar SL ni TP.
- RF-57: El sistema debe colocar cada orden de entrada con un identificador propio
  derivado del ID de la alerta (RF-11). Si la colocación falla (error o timeout), antes
  de darla por no ejecutada debe consultar a Binance por ese identificador: si la orden
  existe, la sigue como cualquier entrada colocada (RF-34, RF-19); si Binance confirma que
  no existe, la alerta queda "entrada no ejecutada" sin operación; si la consulta también
  falla, la reintenta con espera exponencial (1 s, 2 s, 4 s… hasta 60 s), registrando un
  evento crítico en cada falla, hasta obtener una respuesta. Así una orden que Binance
  aceptó aunque la respuesta no llegó nunca queda sin seguir ni sin SL y TP.
- RF-20: El sistema debe rechazar una alerta válida si abrirla haría que el nocional
  total de las posiciones abiertas y de las órdenes de entrada pendientes supere el
  máximo configurable de capital comprometido (USDT).
- RF-27: El nivel de riesgo de la alerta (Medio, Medio-Alto, Alto o el texto que traiga,
  RF-09) no debe modificar la cantidad calculada en RF-08.
- RF-30: El sistema debe rechazar una alerta cuya cantidad redondeada (RF-08) quede por
  debajo de la cantidad mínima o del nocional mínimo del símbolo.
- RF-33: El sistema debe colocar la entrada como una orden límite al precio de Entrada
  de la alerta.
- RF-34: El sistema debe colocar el SL y el TP apenas la orden de entrada registre
  cualquier ejecución (total o parcial), cubriendo el total de la posición abierta,
  incluidas las ejecuciones posteriores.
- RF-35: Si a los 3 minutos de colocada la orden de entrada tiene ejecución parcial, el
  sistema debe cancelar la parte no ejecutada y mantener el SL y el TP sobre la
  posición abierta.
- RF-39: El sistema debe registrar como evento crítico en el log cada cierre de
  emergencia de RF-18.
- RF-51: El sistema debe rechazar con el motivo "símbolo ya en operación" una alerta
  válida cuyo símbolo ya tenga una entrada pendiente o una posición abierta.
- RF-54: En DRY, el sistema debe tomar el tickSize, el stepSize, la cantidad mínima y
  el nocional mínimo de cada símbolo desde la información pública de símbolos de
  Binance Demo (sin credenciales), refrescada cada 60 s, en lugar de la de producción;
  el ranking (RF-23) y las velas (RF-24) se siguen leyendo de producción. En LIVE
  todo sale de producción.
- RF-55: En DRY, el sistema debe rechazar una alerta cuyo símbolo (RF-31) no sea un
  perpetuo en estado TRADING en Binance Demo, con el motivo "no disponible en Demo".

## Requerimientos No Funcionales
- RNF-09: El tiempo desde que el mensaje llega al sistema hasta que la orden límite de
  entrada queda aceptada por Binance debe ser < 5 s (p95) si alcanza con el texto, y
  < 12 s (p95) si requiere analizar la imagen.

## Criterios de Aceptación
- AC-13 (RF-08): Dado un riesgo configurado R (USDT) y una alerta con Entrada E y
  Stop Loss S, cuando el sistema calcula la cantidad a operar, entonces la cantidad es
  R / |E − S| redondeada hacia abajo al stepSize del símbolo.
- AC-15 (RF-10): Dada una alerta válida y ya dimensionada (RF-08), cuando el sistema
  coloca la operación, entonces el log la marca como "completa" solo después de que
  Binance confirma la ejecución de la entrada y la aceptación del SL y del TP.
- AC-16 (RF-18, RF-39): Dado que la orden de entrada ya tuvo ejecución, cuando la colocación
  del SL o del TP falla, entonces el sistema cierra la posición con una orden a mercado
  en < 5 s desde la falla y registra el evento como crítico en el log.
- AC-18 (RF-12): Dado que la cantidad de posiciones abiertas es igual al máximo
  configurado y no hay entradas pendientes, cuando llega una nueva alerta válida, entonces el sistema la rechaza y
  loguea el motivo "límite de posiciones".
- AC-22 (RF-15): Dada una alerta cuyo nocional excede el tamaño de posición máximo, o
  cuyo nocional / balance excede el apalancamiento máximo, cuando el sistema la
  dimensiona, entonces la rechaza y loguea el motivo "excede máximos".
- AC-23 (RF-19): Dada una orden de entrada sin ninguna ejecución, cuando falla o pasan
  3 minutos desde que se colocó, entonces el sistema la cancela, no coloca SL ni TP y
  registra el estado "entrada no ejecutada".
- AC-84 (RF-57): Dada una alerta válida cuya colocación de la entrada falla por timeout
  pero Binance la aceptó, cuando el sistema consulta por el identificador de la entrada,
  entonces la encuentra, la sigue como entrada pendiente y, al ejecutarse, coloca SL y
  TP; no queda como "entrada no ejecutada".
- AC-24 (RF-20): Dado un nocional total de posiciones abiertas y entradas pendientes C
  y un máximo M, cuando
  llega una alerta válida con nocional X y C + X > M, entonces el sistema la rechaza y
  loguea el motivo "límite de capital".
- AC-36 (RF-27): Dadas dos alertas idénticas salvo el nivel de riesgo (Medio y Alto),
  cuando el sistema calcula la cantidad, entonces ambas dan la misma cantidad.
- AC-39 (RF-30): Dada una alerta cuya cantidad redondeada queda por debajo de la
  cantidad mínima o del nocional mínimo del símbolo, cuando el sistema la dimensiona,
  entonces la rechaza y loguea el motivo "bajo mínimo".
- AC-43 (RF-33): Dada una alerta válida con Entrada E, cuando el sistema coloca la
  entrada, entonces la orden enviada a Binance es de tipo límite con precio E.
- AC-44 (RF-34): Dada una orden de entrada colocada, cuando todavía no tuvo ninguna
  ejecución, entonces el sistema no envió ninguna orden de SL ni de TP.
- AC-45 (RF-35): Dada una orden de entrada con ejecución parcial, cuando pasan 3
  minutos desde que se colocó, entonces el sistema cancela la parte no ejecutada y el
  SL y el TP siguen cubriendo la posición abierta.
- AC-48 (RNF-09): Dado un lote de 20 alertas válidas de prueba solo-texto y otro de 20
  que requieren imagen, cuando se mide el tiempo desde la llegada hasta que Binance acepta
  la orden de entrada, entonces el p95 es < 5 s para el primero y < 12 s para el
  segundo.
- AC-51 (RF-12): Dado un máximo de 1 posición, sin posiciones abiertas y con una orden
  de entrada pendiente, cuando llega una nueva alerta válida, entonces el sistema la
  rechaza y loguea el motivo "límite de posiciones".
- AC-55 (RF-34): Dada una orden de entrada sin ejecución, cuando registra una ejecución
  parcial, entonces el sistema coloca el SL y el TP cubriendo la posición abierta.
- AC-70 (RF-51): Dada una posición abierta en un símbolo, cuando llega una alerta
  válida del mismo símbolo, entonces el sistema la rechaza y loguea el motivo "símbolo
  ya en operación".
- AC-72 (RF-52): Dada una alerta válida, cuando falla la consulta del balance de la
  cuenta para el control de apalancamiento, entonces el sistema la rechaza y loguea el
  motivo "datos de mercado no disponibles".
- AC-79 (RF-54, RF-37): Dado el sistema en DRY y BERAUSDT con tickSize 0.0001 en
  producción y 0.001 en Demo, cuando llega una alerta SHORT con Entrada 0.2299, SL
  0.2337 y TP 0.2246, entonces las órdenes se cargan con Entrada 0.230, SL 0.234 y TP
  0.225.
- AC-80 (RF-55): Dado el sistema en DRY y un símbolo que existe en producción pero no
  en Binance Demo, cuando llega una alerta de ese símbolo, entonces la rechaza y loguea
  el motivo "no disponible en Demo".
- AC-81 (RF-54): Dado el sistema en LIVE, cuando valida una alerta, entonces usa el
  tickSize y el stepSize de producción y no consulta Binance Demo.

## Fuera de Alcance
- Recolocar una entrada que venció sin ejecutarse (RF-19).
- Lo que ocurre con la posición después de quedar completa (ver
  [PRD-003](PRD-003-seguimiento-cierre.md)).
- Ver también el Fuera de Alcance global en [PRD-000](PRD-000-marco.md).

## Riesgos y Dependencias
- Riesgo: Binance/CCXT no ofrece una orden combinada nativa que garantice entrada, SL
  y TP como una sola transacción; son tres llamadas independientes a la API →
  mitigación: SL y TP se colocan apenas hay ejecución de la entrada (RF-34),
  verificación de las tres órdenes y cierre de emergencia de la posición si el SL o
  el TP no llegan a confirmarse (RF-10, RF-18, AC-16).
- Riesgo: con alertas llegando durante todo el día, la exposición total puede crecer
  sin control aunque cada operación individual esté acotada (RF-15) → mitigación:
  límite configurable de posiciones simultáneas (RF-12) y de capital total
  comprometido (RF-20), contando también las entradas pendientes.
- Riesgo: Binance Demo no tiene todos los símbolos de producción y algunos tienen otro
  tickSize, así que una orden armada con los filtros de producción puede ser rechazada
  en Demo → mitigación: reglas de órdenes de Demo (RF-54) y motivo propio para los
  símbolos que no están (RF-55), para que el período DRY no cuente esas fallas como
  fallas del sistema. En DRY los precios pueden quedar más redondeados que en LIVE.
- Dependencias:
  - [PRD-001](PRD-001-ingesta-validacion.md): alerta válida con símbolo y precios
    ajustados.
  - [PRD-000](PRD-000-marco.md): log (RF-05) y modos DRY/LIVE.
  - [PRD-003](PRD-003-seguimiento-cierre.md): detección del cierre de posiciones, necesaria para el conteo de
    posiciones abiertas y capital comprometido (RF-12, RF-20).
  - API de Binance Futuros vía CCXT (órdenes, balance, filtros de símbolo).
  - Almacenamiento local persistente de posiciones abiertas y entradas pendientes
    (RF-12/RF-20).
