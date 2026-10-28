# Feature Specification: Alertas de trading de WhatsApp a Binance Futuros

**Feature Branch**: `001-alertas-whatsapp-binance`

**Created**: 2026-10-27

**Status**: Draft

**Input**: Generar el spec a partir del PRD en `docs/prd/` (PRD-000 marco, PRD-001 ingesta y
validación, PRD-002 carga y reversión, PRD-003 seguimiento y cierre), tal cual está en el PRD.

**Fuente**: los identificadores RF/RNF/AC entre paréntesis son los del PRD y se mantienen para
trazabilidad.

## Clarifications

### Session 2026-10-27

- Q: ¿Qué pasa con los mensajes que llegan al grupo mientras WhatsApp está desconectado o el
  proceso está caído? → A: Se ignoran: solo se procesan los mensajes que llegan con la conexión
  activa; los del período sin conexión no se procesan ni se loguean.
- Q: ¿Qué hace el sistema si al arrancar falta la clave de cifrado de la sesión, las credenciales
  de Binance del modo elegido o la key del proveedor de IA? → A: No arranca: termina indicando qué
  variable falta, sin conectarse a WhatsApp ni a Binance (salvo la key del proveedor de IA, que
  pasó a ser opcional; ver Session 2026-10-28).
- Q: ¿Qué balance se usa para el apalancamiento efectivo (nocional / balance) de RF-15? → A: El
  balance total de la billetera de Futuros USDT del modo activo, sin PnL no realizado.
- Q: ¿Qué hace el sistema después del 10.º intento fallido consecutivo de reconexión? → A: Deja de
  reintentar y el proceso termina; el reinicio automático (RNF-05) vuelve a arrancar el ciclo de
  reconexión desde cero (salvo con un cierre de emergencia en curso; ver Session 2026-10-28).
- Q: ¿Qué pasa con una alerta si el proveedor de IA falla o no responde al extraer datos? → A: Los
  datos que dependían de la IA se tratan como faltantes y la alerta se rechaza como "incompleta".
- Q: ¿Qué pasa si falla el propio cierre a mercado de emergencia? → A: Se reintenta con el mismo
  backoff de reconexión (1 s, 2 s, 4 s… hasta 60 s) hasta que la posición quede cerrada,
  registrando un evento crítico en cada falla.
- Q: ¿Con qué modo de margen y apalancamiento del símbolo se coloca la operación? → A: Margen
  aislado, con el apalancamiento del símbolo tomado de la configuración del operador.
- Q: ¿Sobre qué valores se calcula el hash de deduplicación? → A: Sobre los valores crudos de la
  alerta: ticker, Entrada y SL tal como vienen, y como TP el precio numérico del objetivo o, si no
  trae precio, el texto del objetivo (reemplazada: el hash pasó a usar los valores mapeados; ver
  Session 2026-10-28).
- Q: ¿Cómo se procesan alertas que llegan casi a la vez? → A: De a una, en orden de llegada: cada
  alerta se evalúa por completo (y su entrada se coloca o se rechaza) antes de empezar la
  siguiente.
- Q: ¿Qué pasa si falta o es inválida la configuración del operador? → A: Igual que con las
  credenciales: el sistema no arranca y dice qué parámetro falta o es inválido; los valores
  numéricos deben ser mayores que 0.

### Session 2026-10-28

- Q: Al arrancar, una posición ejecutada en Binance no tiene su SL o su TP: ¿qué hace la
  reconciliación? → A: Según el estado local: si la operación nunca llegó a "completa", coloca lo
  que falta o cierra a mercado; si ya estaba "completa", es una cancelación del operador y solo se
  registra el evento crítico.
- Q: Hay un cierre de emergencia reintentando y Binance acumula 10 fallos consecutivos: ¿qué regla
  gana? → A: Gana el cierre: el proceso no termina mientras haya un cierre de emergencia en curso.
- Q: Llega una alerta válida de un símbolo que ya tiene entrada pendiente o posición abierta →
  A: Se rechaza con el motivo nuevo "símbolo ya en operación".
- Q: Fallan las velas para el TP o el balance para el apalancamiento → A: Se rechaza con el motivo
  nuevo "datos de mercado no disponibles".
- Q: ¿La key del proveedor de IA es obligatoria para arrancar? → A: No: es opcional (RF-16
  enmendado). Sin ella el sistema arranca con un aviso de que el análisis de imagen está apagado,
  y una alerta cuyo texto no trae todos los datos se rechaza como "incompleta" sin analizar la
  imagen.
- Q: ¿Qué alertas bloquean un reenvío por hash y sobre qué valores se calcula? → A: Solo las no
  rechazadas (RF-29 enmendado): una rechazada no bloquea su reenvío, que se evalúa de nuevo. El
  hash usa el símbolo mapeado y los precios ajustados al tickSize (RF-11 enmendado), así "PEPE
  0.002404" y "1000PEPE 2.404" son la misma alerta; por eso "ticker inexistente" pasa antes que
  "duplicado (hash)" en el orden de FR-020.

## User Scenarios & Testing *(mandatory)*

Personas (PRD-000):
- **Martín**: operador del sistema y único usuario por instancia. Está suscripto al servicio de
  alertas y quiere que se carguen solas en Binance como long o short.
- **Tomy** y **Cris**: fuentes de alertas del grupo de WhatsApp. Tomy suele mandar todos los datos
  en el texto; Cris a veces los deja solo en la imagen.

Ciclo de vida de una alerta (PRD-000): un mensaje se ignora o pasa a ser alerta; la alerta queda
rechazada (con motivo) o válida; la válida queda con entrada pendiente, que termina en "entrada no
ejecutada" o con ejecución; con ejecución termina en "cerrada por emergencia" o "completa"; la
completa termina en "cerrada" (TP, SL, manual) o "liquidada".

### User Story 1 - Validar cada alerta antes de operar (Priority: P1)

Llega un mensaje al grupo. Si es una alerta de trading de un remitente autorizado, el sistema
extrae sus datos del texto (y de la imagen si el texto no alcanza), determina si es LONG o SHORT,
la mapea al contrato correcto, ajusta los precios y la valida contra reglas objetivas. La alerta
queda válida o rechazada con un único motivo en el log, sin intervención de Martín.

**Why this priority**: es la puerta de entrada y la principal barrera de riesgo: ninguna alerta
llega a Binance sin pasar estas reglas. Por sí sola ya aporta valor en DRY: Martín puede comparar
la clasificación del sistema contra su propia lectura de cada alerta.

**Independent Test**: enviar alertas de prueba (completas, incompletas, con datos solo en la
imagen, duplicadas, de remitentes no autorizados, con tickers inexistentes o del top 3) y
verificar la clasificación y el motivo registrado de cada una, sin colocar ninguna orden.

**Acceptance Scenarios**:

1. **Given** un mensaje cuyo texto no contiene "alerta de trading" (sin distinguir mayúsculas ni
   tildes), **When** llega al sistema, **Then** no se procesa ni se registra en el log (AC-05).
2. **Given** un mensaje que contiene "ALERTA DE TRADÍNG" en medio del texto, **When** llega al
   sistema, **Then** se procesa como alerta (AC-35).
3. **Given** una alerta completa de un remitente que no está en la lista de autorizados, **When**
   llega al sistema, **Then** la rechaza con el motivo "remitente no autorizado" (AC-26).
4. **Given** una alerta de un remitente no autorizado a la que además le faltan datos, **When** el
   sistema la valida, **Then** loguea un único motivo: "remitente no autorizado" (AC-54).
5. **Given** un mensaje cuyo texto trae todos los datos, **When** el sistema lo procesa, **Then**
   extrae los valores del texto sin analizar la imagen (AC-20).
6. **Given** un mensaje cuyo texto no trae todos los datos y la imagen sí, **When** el sistema lo
   procesa, **Then** extrae los valores faltantes desde la imagen (AC-14).
7. **Given** una alerta a la que le falta algún dato tanto en el texto como en la imagen, **When**
   el sistema la procesa, **Then** la rechaza con el motivo "incompleta" (AC-21).
8. **Given** que no está configurada la key del proveedor de IA, **When** el sistema arranca,
   **Then** arranca igual y avisa que el análisis de imagen está apagado (AC-75).
9. **Given** que no está configurada la key del proveedor de IA, **When** llega una alerta cuyo
   texto no trae todos los datos, **Then** no analiza la imagen y la rechaza con el motivo
   "incompleta" (AC-76).
10. **Given** una señal con SL menor que la Entrada, **When** el sistema calcula su dirección,
    **Then** la clasifica como LONG (AC-01).
11. **Given** una señal con SL mayor que la Entrada, **When** el sistema calcula su dirección,
    **Then** la clasifica como SHORT (AC-03).
12. **Given** una señal LONG con TP menor o igual a la Entrada, **When** el sistema la valida,
    **Then** la rechaza con el motivo "TP inválido" (AC-02).
13. **Given** una señal SHORT con TP mayor o igual a la Entrada, **When** el sistema la valida,
    **Then** la rechaza con el motivo "TP inválido" (AC-04).
14. **Given** una señal con SL igual a la Entrada, **When** el sistema la valida, **Then** la
    rechaza con el motivo "SL igual a la Entrada" (AC-19).
15. **Given** una alerta LONG con Entrada 1.246, SL 0.1222 y el máximo configurado en 15 %, **When**
    el sistema la valida, **Then** la rechaza con el motivo "SL fuera de rango" (AC-68).
16. **Given** una alerta con ticker "X" para el que existe XUSDT, **When** el sistema la procesa,
    **Then** opera XUSDT con los precios de la alerta sin modificar (AC-40).
17. **Given** una alerta con ticker "PEPE" y Entrada 0.002404, donde no existe PEPEUSDT y sí
    1000PEPEUSDT, **When** el sistema la procesa, **Then** opera 1000PEPEUSDT con Entrada 2.404 y
    SL y TP multiplicados por 1000 (AC-41).
18. **Given** una alerta cuyo ticker no existe ni como TICKERUSDT ni como 1000TICKERUSDT, **When**
    el sistema la procesa, **Then** la rechaza con el motivo "ticker inexistente" (AC-42).
19. **Given** un símbolo con tickSize 0.01 y una alerta LONG con Entrada 10.004, SL 9.507 y TP
    11.003, **When** el sistema ajusta los precios, **Then** quedan Entrada 10.00, SL 9.50 y TP
    11.00 (AC-52).
20. **Given** una alerta cuyo objetivo es "ASL21, EMA55 y 0.002404 usd", **When** el sistema la
    procesa, **Then** el TP es 0.002404 y no calcula indicadores (AC-34).
21. **Given** una alerta cuyo objetivo es "ASL21, EMA55" sin precio y un conjunto conocido de velas
    de 45 min, **When** el sistema calcula el TP, **Then** es el valor de ASL21 o EMA55 del lado
    correcto que esté más cerca de la Entrada; si ninguno está del lado correcto, la rechaza con
    el motivo "TP inválido" (AC-33).
22. **Given** un conjunto conocido de velas de 15 min, **When** el sistema arma las velas de 45 min,
    **Then** cada una agrupa tres velas de 15 min consecutivas alineadas a las 00:00 UTC (00:00,
    00:45, 01:30…), con cierre igual al de la tercera, y la vela en curso agrupa las de 15 min ya
    abiertas de su tramo (una, dos o tres), con cierre igual al último precio de la más reciente
    (AC-69).
23. **Given** una alerta cuyo objetivo es por indicadores, **When** falla la obtención de las
    velas, **Then** la rechaza con el motivo "datos de mercado no disponibles" (AC-71).
24. **Given** una alerta ya registrada, **When** el sistema vuelve a recibir el mismo mensaje de
    WhatsApp (por ejemplo, tras un reinicio), **Then** no la opera y la loguea como "duplicado"
    (AC-17).
25. **Given** una alerta no rechazada registrada hace menos de 24 h, **When** llega un reenvío con
    otro ID de mensaje pero el mismo ticker, Entrada, SL y TP, **Then** no la opera y la loguea
    como "duplicado" (AC-37).
26. **Given** una alerta registrada hace más de 24 h, **When** llega otra con otro ID de mensaje y
    el mismo ticker, Entrada, SL y TP, **Then** no la rechaza como duplicado (AC-53).
27. **Given** una alerta rechazada hace menos de 24 h (por ejemplo, por "ranking no disponible"),
    **When** llega un reenvío con otro ID de mensaje y los mismos valores, **Then** no lo rechaza
    como duplicado y lo evalúa de nuevo (AC-77).
28. **Given** una alerta no rechazada con ticker "PEPE" y Entrada 0.002404 registrada hace menos de
    24 h, **When** llega otra con ticker "1000PEPE", Entrada 2.404 y SL y TP equivalentes,
    **Then** la rechaza como "duplicado" (AC-78).
29. **Given** una alerta cuyo símbolo está entre los 3 mayores ganadores o los 3 mayores perdedores
    de la copia local vigente del ranking, **When** el sistema la valida, **Then** la rechaza con
    el motivo "top 3 ganadores/perdedores" (AC-06, AC-07).
30. **Given** una copia local del ranking con más de 120 s de antigüedad, **When** llega una
    alerta, **Then** el sistema la rechaza con el motivo "ranking no disponible" (AC-25).
31. **Given** el sistema en DRY o LIVE, **When** pasan 60 s desde el último refresco, **Then**
    actualiza la copia local del ranking desde la fuente pública de producción sin enviar
    credenciales (AC-30).
32. **Given** un conjunto conocido de tickers de 24 h que incluye un contrato en estado distinto
    de TRADING con el mayor porcentaje de cambio, **When** el sistema arma el ranking, **Then** ese
    contrato queda excluido y el top 3 sale de ordenar el resto por porcentaje de cambio (AC-38).

---

### User Story 2 - Cargar la operación sin dejarla nunca desprotegida (Priority: P1)

Una alerta válida se dimensiona según el riesgo fijo configurado, se controla contra los límites
de exposición y se coloca en Binance como orden límite. Apenas la entrada tiene alguna ejecución
se colocan el SL y el TP; si alguno falla, la posición se cierra a mercado de inmediato. Si la
entrada no se ejecuta en 3 minutos, se cancela.

**Why this priority**: es el objetivo central del producto (convertir la alerta en una orden en
segundos) y donde un error cuesta dinero. Junto con US1 forma el MVP operable.

**Independent Test**: en modo DRY, procesar alertas válidas y simular ejecución total, parcial,
nula y fallas en la colocación del SL/TP, verificando cantidades, rechazos por límites, órdenes
enviadas y estados finales.

**Acceptance Scenarios**:

1. **Given** un riesgo configurado R y una alerta con Entrada E y SL S, **When** el sistema
   calcula la cantidad, **Then** es R / |E − S| redondeada hacia abajo al stepSize del símbolo
   (AC-13).
2. **Given** dos alertas idénticas salvo el nivel de riesgo (Medio y Alto), **When** el sistema
   calcula la cantidad, **Then** ambas dan la misma cantidad (AC-36).
3. **Given** una alerta cuya cantidad redondeada queda por debajo de la cantidad mínima o del
   nocional mínimo del símbolo, **When** el sistema la dimensiona, **Then** la rechaza con el
   motivo "bajo mínimo" (AC-39).
4. **Given** una alerta cuyo nocional excede el tamaño de posición máximo, o cuyo nocional /
   balance excede el apalancamiento máximo, **When** el sistema la dimensiona, **Then** la rechaza
   con el motivo "excede máximos" (AC-22).
5. **Given** que las posiciones abiertas igualan el máximo configurado y no hay entradas
   pendientes, **When** llega una alerta válida, **Then** la rechaza con el motivo "límite de
   posiciones" (AC-18).
6. **Given** un máximo de 1 posición, sin posiciones abiertas y con una entrada pendiente, **When**
   llega una alerta válida, **Then** la rechaza con el motivo "límite de posiciones" (AC-51).
7. **Given** un nocional comprometido C (posiciones abiertas + entradas pendientes) y un máximo M,
   **When** llega una alerta válida con nocional X y C + X > M, **Then** la rechaza con el motivo
   "límite de capital" (AC-24).
8. **Given** una alerta válida con Entrada E, **When** el sistema coloca la entrada, **Then** la
   orden es de tipo límite con precio E (AC-43).
9. **Given** una orden de entrada colocada, **When** todavía no tuvo ninguna ejecución, **Then** el
   sistema no envió ninguna orden de SL ni de TP (AC-44).
10. **Given** una orden de entrada sin ejecución, **When** registra una ejecución parcial, **Then**
    el sistema coloca el SL y el TP cubriendo la posición abierta (AC-55).
11. **Given** una alerta válida y dimensionada, **When** el sistema coloca la operación, **Then** el
    log la marca como "completa" solo después de que Binance confirma la ejecución de la entrada y
    la aceptación del SL y del TP (AC-15).
12. **Given** que la entrada ya tuvo ejecución, **When** falla la colocación del SL o del TP,
    **Then** el sistema cierra la posición a mercado en < 5 s desde la falla y registra un evento
    crítico (AC-16).
13. **Given** una orden de entrada sin ninguna ejecución, **When** falla o pasan 3 minutos desde
    que se colocó, **Then** el sistema la cancela, no coloca SL ni TP y registra el estado "entrada
    no ejecutada" (AC-23).
14. **Given** una orden de entrada con ejecución parcial, **When** pasan 3 minutos desde que se
    colocó, **Then** el sistema cancela la parte no ejecutada y el SL y el TP siguen cubriendo la
    posición abierta (AC-45).
15. **Given** una posición abierta en un símbolo, **When** llega una alerta válida del mismo
    símbolo, **Then** la rechaza con el motivo "símbolo ya en operación" (AC-70).
16. **Given** una alerta válida, **When** falla la consulta del balance para el control de
    apalancamiento, **Then** la rechaza con el motivo "datos de mercado no disponibles" (AC-72).

---

### User Story 3 - Elegir modo DRY o LIVE al arrancar (Priority: P1)

Martín arranca el sistema en modo DRY para operar contra Binance Demo Trading sin dinero real, o
en modo LIVE para operar contra Binance Futuros USDS-M de producción. Cada modo usa credenciales
propias y nunca toca el entorno del otro.

**Why this priority**: separa probar sin riesgo de operar con dinero real; todas las demás
historias dependen de que el destino de las órdenes sea el correcto.

**Independent Test**: arrancar en cada modo y verificar a qué entorno se envían las órdenes y la
consulta de balance, y qué credenciales lee cada uno.

**Acceptance Scenarios**:

1. **Given** el sistema arrancado en modo DRY, **When** llega una alerta válida, **Then** las
   órdenes y la consulta de balance se envían a Binance Demo Trading y ninguna a producción
   (AC-11).
2. **Given** el sistema arrancado en modo LIVE, **When** llega una alerta válida, **Then** las
   órdenes y la consulta de balance se envían a producción y ninguna a Demo Trading (AC-12).
3. **Given** la configuración del sistema, **When** se revisan las credenciales que lee cada modo,
   **Then** DRY y LIVE leen credenciales de Binance con nombres distintos (AC-49).

---

### User Story 4 - Auditar cada alerta y cómo terminó (Priority: P1)

Martín revisa el log para saber qué alertas se procesaron, cuáles se operaron, cuáles se
rechazaron y por qué, y cómo terminó cada operación.

**Why this priority**: el objetivo del PRD incluye "dejar todo registrado para poder auditar qué
se ejecutó, qué se descartó, y por qué"; sin log no se puede verificar el sistema en DRY antes de
habilitar LIVE.

**Independent Test**: procesar una alerta válida y una rechazada y verificar sus entradas en el
log y los permisos de los archivos.

**Acceptance Scenarios**:

1. **Given** una alerta válida que se transforma en una orden long o short, **When** la operación
   termina, **Then** el log tiene una entrada con todos los campos de FR-043 que aplican, no vacíos
   (AC-08).
2. **Given** una alerta rechazada, **When** el sistema la descarta, **Then** el log guarda el
   motivo, que es uno de los de FR-045 (AC-09).
3. **Given** el sistema corriendo, **When** se revisan los permisos del log y del almacenamiento
   local, **Then** son 0600 y el dueño es el usuario del proceso (AC-50).

---

### User Story 5 - Seguir la posición hasta su cierre (Priority: P2)

Cuando una posición completa se cierra (por TP, SL, liquidación o a mano), el sistema lo detecta,
cancela las órdenes que quedaron huérfanas, libera el cupo de exposición y registra cómo terminó.

**Why this priority**: sin este seguimiento los límites de posiciones y capital quedan ocupados
para siempre, una orden huérfana puede abrir una posición no deseada y el log no muestra el
resultado. Depende de US2.

**Independent Test**: en DRY, cerrar posiciones por cada causa y verificar el log, la cancelación
de órdenes restantes y la liberación del cupo.

**Acceptance Scenarios**:

1. **Given** una posición completa, **When** se ejecuta su orden de TP, **Then** el log tiene
   estado "cerrada", causa "TP", fecha/hora de cierre, PnL realizado y comisiones, no vacíos
   (AC-56).
2. **Given** una posición completa, **When** se ejecuta su orden de SL, **Then** el log tiene
   estado "cerrada" y causa "SL" (AC-57).
3. **Given** una posición completa, **When** el operador la cierra a mano desde Binance, **Then**
   el log tiene estado "cerrada" y causa "cierre manual" (AC-58).
4. **Given** una posición completa, **When** Binance la liquida, **Then** el log tiene estado
   "liquidada" y causa "liquidación" (AC-59).
5. **Given** una posición cerrada por TP, **When** el sistema detecta el cierre, **Then** cancela
   la orden de SL y no queda en Binance ninguna orden abierta de esa operación (AC-60).
6. **Given** un máximo de 1 posición y una posición abierta que se cierra, **When** llega una
   alerta válida después de detectado el cierre, **Then** no la rechaza por "límite de posiciones"
   (AC-61).
7. **Given** una posición completa, **When** el operador cancela a mano su orden de SL, **Then** el
   sistema registra un evento crítico y la posición y su TP quedan sin cambios (AC-64).

---

### User Story 6 - Reconciliar con Binance al arrancar (Priority: P2)

Si el proceso estuvo detenido, al volver a arrancar compara sus posiciones y entradas pendientes
con las de Binance antes de procesar alertas nuevas, y resuelve lo que pasó mientras tanto.

**Why this priority**: un cierre o una ejecución durante una caída dejaría el estado local
desalineado y posiciones sin protección. Depende de US2 y US5.

**Independent Test**: detener el proceso, provocar en Binance un cierre, una ejecución de entrada
y un vencimiento de plazo, y verificar al arrancar las acciones y registros antes de la primera
alerta nueva.

**Acceptance Scenarios**:

1. **Given** el proceso detenido y una posición que se cierra por SL mientras tanto, **When** el
   sistema vuelve a arrancar, **Then**, antes de procesar alertas nuevas, registra el cierre con
   causa "SL" y cancela la orden de TP huérfana (AC-63).
2. **Given** el proceso detenido y una entrada pendiente que se ejecuta mientras tanto, **When** el
   sistema vuelve a arrancar, **Then**, antes de procesar alertas nuevas, coloca el SL y el TP
   cubriendo la posición (AC-65).
3. **Given** el proceso detenido y una entrada pendiente sin ejecución cuyo plazo de 3 minutos
   vence mientras tanto, **When** el sistema vuelve a arrancar, **Then** la cancela y registra el
   estado "entrada no ejecutada" (AC-66).
4. **Given** el proceso caído después de que la entrada tuvo ejecución y antes de confirmarse el SL
   y el TP, **When** el sistema vuelve a arrancar, **Then**, antes de procesar alertas nuevas,
   coloca el SL y el TP que faltan o, si fallan, cierra la posición a mercado y registra un evento
   crítico (AC-73).

---

### User Story 7 - Vincular WhatsApp y mantener el sistema en pie (Priority: P2)

Martín vincula una vez la cuenta de WhatsApp escaneando un código QR; la sesión queda cifrada y
fuera del repositorio. Si se corta WhatsApp o Binance, o el proceso se cae, el sistema se recupera
solo y deja registro.

**Why this priority**: las alertas llegan a cualquier hora y Martín no mira el sistema todo el
día; un corte no detectado equivale a perder alertas sin saberlo.

**Independent Test**: arrancar sin sesión guardada y vincular; revisar el directorio de sesión;
cortar conexiones y terminar el proceso abruptamente midiendo detección, reintentos y vuelta a la
ingesta.

**Acceptance Scenarios**:

1. **Given** que no hay una sesión de WhatsApp guardada, **When** se arranca el sistema, **Then**
   muestra un código QR para vincular la cuenta (AC-10).
2. **Given** el directorio de sesión de WhatsApp, **When** se revisan su contenido, sus permisos y
   las exclusiones del repositorio, **Then** ningún archivo contiene en texto plano el número de
   teléfono vinculado, el directorio tiene permisos 0700 y está excluido del repo (AC-29).
3. **Given** una conexión activa a WhatsApp o a Binance, **When** se corta, **Then** el sistema
   registra la interrupción en < 30 s, reintenta con esperas de 1 s, 2 s, 4 s… hasta 60 s, y al
   10.º intento fallido consecutivo registra un evento crítico (AC-47).
4. **Given** el proceso de la app corriendo bajo el reinicio automático, **When** se lo termina
   abruptamente, **Then** vuelve a estar ingiriendo mensajes en < 60 s (AC-31).
5. **Given** un cierre de emergencia en curso y la API de Binance caída, **When** se acumulan 10
   intentos fallidos consecutivos, **Then** el sistema registra el evento crítico pero no termina
   el proceso y sigue reintentando el cierre (AC-74).

---

### User Story 8 - Credenciales fuera del repo y con mínimo privilegio (Priority: P3)

Las credenciales se configuran fuera del código y la key de Binance de producción solo puede
operar, nunca retirar fondos.

**Why this priority**: es verificación de configuración más que funcionalidad, pero limita el
daño de una filtración.

**Independent Test**: escanear el repositorio en busca de secretos y revisar los permisos de la
key de producción en Binance.

**Acceptance Scenarios**:

1. **Given** el repositorio, **When** se escanea en busca de secretos el árbol de trabajo y todo el
   historial, **Then** el escaneo reporta 0 hallazgos (AC-27).
2. **Given** la key de Binance de producción configurada, **When** se revisan sus permisos en
   Binance, **Then** el retiro de fondos está deshabilitado y solo está habilitado el trading
   (AC-28).

### Edge Cases

- **El proveedor de IA falla o no responde**: los datos que dependían de él cuentan como faltantes
  y la alerta se rechaza como "incompleta" (FR-059).
- **Varias validaciones fallan a la vez**: se registra solo la primera según el orden de FR-020.
- **Edición de una alerta ya procesada**: no se opera; se registra en el log el texto anterior y
  el nuevo y los datos que cambiaron, para revisión manual (FR-047).
- **Reinicio que relee el historial del grupo o reenvío del mensaje**: la alerta ya registrada se
  rechaza como "duplicado" y no se opera dos veces (FR-007).
- **Refresco del ranking que falla**: si la copia local supera los 120 s, la alerta se rechaza por
  "ranking no disponible" en vez de operarse a ciegas (FR-018).
- **Ticker que solo existe con prefijo 1000**: se opera el contrato 1000TICKERUSDT con los precios
  × 1000 (FR-009).
- **Ejecución parcial de la entrada**: el SL y el TP cubren lo ejecutado y las ejecuciones
  posteriores; a los 3 minutos se cancela lo no ejecutado (FR-028, FR-032).
- **Falla del SL o del TP con la entrada ejecutada**: cierre a mercado y evento crítico; si el
  cierre a mercado también falla, se reintenta con backoff hasta cerrar (FR-030).
- **Alerta de un símbolo que ya está en operación**: se rechaza como "símbolo ya en operación"
  (FR-063).
- **Fallan las velas o el balance**: se rechaza como "datos de mercado no disponibles" (FR-064).
- **Caída entre la ejecución de la entrada y la confirmación del SL/TP**: al arrancar se coloca lo
  que falta o se cierra a mercado (FR-065).
- **Cierre de emergencia con Binance caída**: el proceso no termina por los 10 fallos; el cierre se
  sigue reintentando (FR-055).
- **Dos alertas casi simultáneas**: se procesan de a una en orden de llegada (FR-061).
- **Reenvío de una alerta con TP calculado por indicadores**: el hash usa el texto del objetivo,
  no el TP calculado, así que se detecta como duplicado (FR-006).
- **Reenvío de una alerta rechazada**: no es duplicado; se evalúa de nuevo, así una señal
  rechazada por un problema del sistema (ranking o velas no disponibles) no se pierde (FR-007).
- **La misma operación escrita con el ticker con y sin el prefijo 1000** ("PEPE 0.002404" y
  "1000PEPE 2.404"): mismo hash, el segundo es duplicado (FR-006).
- **El operador cancela a mano el SL o el TP de una posición abierta**: solo se registra un evento
  crítico; la posición no se toca y el SL/TP no se recoloca (FR-038).
- **Mensajes que llegan mientras WhatsApp está desconectado o el proceso está caído**: se ignoran
  sin procesarse ni loguearse; al reconectar o reiniciar, la ingesta sigue solo con los mensajes
  nuevos (FR-057).
- **Arranque sin key del proveedor de IA**: el sistema arranca igual y avisa que el análisis de
  imagen está apagado; una alerta cuyo texto no trae todos los datos se rechaza como "incompleta"
  sin analizar la imagen (FR-004).
- **Arranque con configuración incompleta** (falta la clave de cifrado de la sesión o las
  credenciales de Binance del modo elegido): el sistema no arranca y
  termina indicando qué variable falta, sin conectarse a WhatsApp ni a Binance (FR-058). Lo
  mismo si falta o es inválido un parámetro de la configuración del operador (FR-062).
- **10 intentos fallidos consecutivos de reconexión**: evento crítico, el proceso termina y el
  reinicio automático arranca de nuevo el ciclo de reconexión (FR-055, FR-056); al volver aplica
  la reconciliación (FR-039) y solo se procesan los mensajes nuevos (FR-057).
- **Sesión de WhatsApp expirada o cerrada por WhatsApp**: se detecta como desconexión, se reintenta
  (FR-055) y, si hace falta, el operador se reautentica con un nuevo QR (FR-048).

## Requirements *(mandatory)*

### Functional Requirements

**Ingesta y extracción (PRD-001)**

- **FR-001** (RF-03): El sistema MUST ignorar, sin procesarlos ni loguearlos, los mensajes del grupo
  cuyo texto no contenga "alerta de trading" en cualquier posición, sin distinguir
  mayúsculas/minúsculas ni tildes.
- **FR-002** (RF-22): El sistema MUST rechazar las alertas cuyo remitente no esté en una lista
  configurable de remitentes autorizados.
- **FR-003** (RF-09): El sistema MUST extraer de cada alerta la entrada, el objetivo, el stop loss,
  el nivel de riesgo y el ticker a partir del texto del mensaje.
- **FR-004** (RF-16): El sistema MUST analizar la imagen adjunta cuando el texto no contenga todos
  los datos de FR-003, para completar los que falten. El análisis de imagen es opcional: si no
  está configurada la key del proveedor de IA, el sistema MUST arrancar igual, avisar al arrancar
  que el análisis de imagen está apagado, y rechazar como "incompleta" (FR-005) una alerta cuyo
  texto no trae todos los datos, sin analizar la imagen.
- **FR-005** (RF-17): El sistema MUST rechazar una alerta a la que le falte cualquiera de los datos
  de FR-003 después de analizar texto e imagen.
- **FR-059** (Clarificación 2026-10-27): Si el proveedor de IA falla o no responde al extraer
  datos del texto o de la imagen, el sistema MUST tratar esos datos como faltantes y, si siguen
  faltando, rechazar la alerta con el motivo "incompleta" (FR-005).
- **FR-006** (RF-11): El sistema MUST asignar a cada alerta procesada (cargada o rechazada) un
  identificador único persistente, formado por el ID del mensaje de WhatsApp y un hash de
  (símbolo, Entrada, SL, TP) calculado después del mapeo del ticker (FR-009) y del ajuste al
  tickSize (FR-011): símbolo mapeado, Entrada y SL ajustados, y como TP el precio del objetivo
  ajustado o, si no trae precio, el texto del objetivo. Si la alerta se rechaza antes de poder
  mapearla (incompleta o ticker inexistente), el hash se calcula con los valores tal como vienen
  (ticker, Entrada, SL y precio o texto del objetivo).
- **FR-007** (RF-29): El sistema MUST rechazar como duplicado, sin operarla, una alerta cuyo ID de
  mensaje coincida con el de cualquier alerta ya registrada, o cuyo hash (FR-006) coincida con el de
  una alerta no rechazada registrada en las últimas 24 h. Una alerta rechazada no bloquea su
  reenvío: el reenvío se evalúa de nuevo.
- **FR-057** (Clarificación 2026-10-27): El sistema MUST procesar solo los mensajes que llegan
  mientras la conexión con WhatsApp está activa; los mensajes enviados al grupo durante una
  desconexión o una caída del proceso MUST NOT procesarse ni loguearse al reconectar o reiniciar.

**Dirección, símbolo y precios (PRD-001)**

- **FR-008** (RF-01, RF-02): El sistema MUST clasificar una señal como LONG cuando el SL esté por
  debajo de la Entrada, y como SHORT cuando esté por encima.
- **FR-009** (RF-31): El sistema MUST mapear el ticker al contrato perpetuo TICKERUSDT; si no
  existe, a 1000TICKERUSDT, multiplicando Entrada, SL y TP por 1000.
- **FR-010** (RF-32): El sistema MUST rechazar una alerta cuyo ticker no exista en Futuros USDS-M
  ni como TICKERUSDT ni como 1000TICKERUSDT.
- **FR-011** (RF-37): El sistema MUST ajustar los precios al tickSize del símbolo: la Entrada al
  tick más cercano, el SL alejándolo de la Entrada y el TP acercándolo a la Entrada.
- **FR-012** (RF-14): El sistema MUST rechazar una señal cuyo SL sea igual a la Entrada, comparando
  los precios ya ajustados al tickSize (FR-011).
- **FR-013** (RF-50): El sistema MUST rechazar una alerta cuyo SL esté a una distancia de la
  Entrada mayor que un porcentaje máximo configurable (por defecto 15 %), calculada como
  |Entrada − SL| / Entrada con los precios ya ajustados al tickSize (FR-011).
- **FR-014** (RF-28): Si el objetivo trae un precio numérico, el sistema MUST usarlo como TP.
- **FR-015** (RF-24): Si el objetivo no trae un precio numérico, sin importar qué indicadores
  mencione, el sistema MUST calcular el TP como el más cercano a la Entrada entre ASL21 y EMA55,
  considerando solo los que estén del lado correcto, donde ASL21 = (EMA(cierre, 20) +
  WMA(cierre, 21)) / 2 y EMA55 = EMA(cierre, 55), sobre las velas de 45 min del símbolo en Binance
  Futuros USDS-M (la temporalidad de las alertas), incluyendo la vela en curso, obtenidas de la
  fuente pública sin credenciales. Como Binance no ofrece 45 min, cada vela de 45 min se arma
  agrupando de a tres las velas de 15 min, alineadas a las 00:00 UTC, e incluyendo la vela en curso.
  Se usan las últimas 1500 velas de 15 min y se descarta el primer tramo de 45 min si quedó
  incompleto por el corte de la consulta.
- **FR-016** (RF-13, RF-36): El sistema MUST rechazar una señal cuyo TP no esté del lado correcto
  de la Entrada (por encima para LONG, por debajo para SHORT), y una alerta para la que, al
  calcular el TP, ni ASL21 ni EMA55 queden del lado correcto.

**Ranking de top 3 (PRD-001)**

- **FR-017** (RF-23): En ambos modos, el sistema MUST refrescar cada 60 s una copia local del
  ranking de top 3 ganadores/perdedores desde la fuente pública de producción de Futuros USDS-M
  (ticker 24 h), sin credenciales, considerando solo contratos perpetuos en estado TRADING y
  ordenándolos por porcentaje de cambio de precio en 24 h.
- **FR-018** (RF-21): El sistema MUST rechazar una alerta si la copia local del ranking tiene más
  de 120 s de antigüedad al recibirla.
- **FR-019** (RF-04): El sistema MUST NOT operar una alerta cuyo símbolo esté entre los 3 mayores
  ganadores o los 3 mayores perdedores de la copia local vigente del ranking.

**Orden de validación (PRD-001)**

- **FR-020** (RF-38): El sistema MUST evaluar las validaciones en este orden y registrar como
  motivo solo la primera que falle: remitente no autorizado, duplicado (ID de WhatsApp),
  incompleta, ticker inexistente, duplicado (hash), SL igual a la Entrada, SL fuera de rango,
  datos de mercado no disponibles (velas para el TP), TP inválido, ranking no disponible, top 3
  ganadores/perdedores, bajo mínimo, datos de mercado no disponibles (balance), excede máximos,
  símbolo ya en operación, límite de posiciones, límite de capital.
- **FR-064** (RF-52): El sistema MUST rechazar una alerta con el motivo "datos de mercado no
  disponibles" si no puede obtener de Binance las velas necesarias para calcular el TP (FR-015) o
  el balance necesario para el control de apalancamiento (FR-024).

**Dimensionamiento y límites (PRD-002)**

- **FR-061** (Clarificación 2026-10-27): El sistema MUST procesar las alertas de a una, en orden de
  llegada: cada alerta se evalúa por completo (y su entrada se coloca o se rechaza) antes de
  empezar la siguiente, para que los límites de FR-025 y FR-026 se evalúen siempre contra la
  exposición actualizada.
- **FR-021** (RF-08): El sistema MUST calcular la cantidad dividiendo un riesgo fijo R en USDT,
  configurado por el operador, por |Entrada − SL|, redondeando hacia abajo al stepSize del símbolo
  y usando los precios ya ajustados (FR-011).
- **FR-022** (RF-27): El nivel de riesgo de la alerta (Medio, Medio-Alto, Alto) MUST NOT modificar
  la cantidad calculada.
- **FR-023** (RF-30): El sistema MUST rechazar una alerta cuya cantidad redondeada quede por debajo
  de la cantidad mínima o del nocional mínimo del símbolo.
- **FR-024** (RF-15): El sistema MUST rechazar una alerta cuyo nocional exceda el tamaño de
  posición máximo configurado (USDT), o cuyo apalancamiento efectivo (nocional / balance de la
  cuenta del modo activo) exceda el apalancamiento máximo configurado. El balance es el total de
  la billetera de Futuros USDT del modo activo, sin PnL no realizado.
- **FR-025** (RF-12): El sistema MUST rechazar una alerta válida si abrirla haría que posiciones
  abiertas más entradas pendientes superen el máximo configurable de posiciones simultáneas.
- **FR-026** (RF-20): El sistema MUST rechazar una alerta válida si abrirla haría que el nocional
  total de posiciones abiertas y entradas pendientes supere el máximo configurable de capital
  comprometido (USDT).
- **FR-063** (RF-51): El sistema MUST rechazar con el motivo "símbolo ya en operación" una alerta
  válida cuyo símbolo ya tenga una entrada pendiente o una posición abierta.

**Colocación y reversión (PRD-002)**

- **FR-060** (Clarificación 2026-10-27): El sistema MUST colocar cada operación en modo de margen
  aislado, con el apalancamiento del símbolo tomado de la configuración del operador.
- **FR-027** (RF-33): El sistema MUST colocar la entrada como una orden límite al precio de Entrada.
- **FR-028** (RF-34): El sistema MUST colocar el SL y el TP apenas la entrada registre cualquier
  ejecución (total o parcial), cubriendo el total de la posición abierta, incluidas las
  ejecuciones posteriores.
- **FR-029** (RF-10): El sistema MUST considerar una operación completa solo cuando la entrada
  tenga ejecución y el SL y el TP estén colocados y aceptados por Binance cubriendo la posición.
- **FR-030** (RF-18, RF-39): Si la entrada tuvo ejecución y falla la colocación del SL o del TP, el
  sistema MUST cerrar la posición con una orden a mercado y registrar el cierre de emergencia como
  evento crítico. Si el cierre a mercado falla, el sistema MUST reintentarlo con el backoff de
  FR-055 (1 s, 2 s, 4 s… hasta 60 s) hasta que la posición quede cerrada, registrando un evento
  crítico en cada falla.
- **FR-031** (RF-19): Si la entrada falla o no tiene ninguna ejecución a los 3 minutos de colocada,
  el sistema MUST cancelarla y no colocar SL ni TP.
- **FR-032** (RF-35): Si a los 3 minutos la entrada tiene ejecución parcial, el sistema MUST
  cancelar la parte no ejecutada y mantener el SL y el TP sobre la posición abierta.

**Seguimiento y cierre (PRD-003)**

- **FR-033** (RF-40): El sistema MUST detectar el cierre total de cada posición completa e
  identificar su causa: TP, SL, liquidación o cierre manual (todo cierre total que no se deba al
  TP, al SL ni a una liquidación).
- **FR-034** (RF-41): Al detectar un cierre, el sistema MUST cancelar las órdenes de SL y TP de esa
  operación que sigan abiertas.
- **FR-035** (RF-42): Al detectar un cierre, el sistema MUST dejar de contar la posición para los
  límites de FR-025 y FR-026.
- **FR-036** (RF-43): Al detectar un cierre, el sistema MUST registrar en el log de la alerta la
  causa, la fecha/hora de cierre, el PnL realizado (USDT) y las comisiones, según Binance.
- **FR-037** (RF-44): El sistema MUST registrar como estado final "cerrada" una posición cerrada
  por TP, SL o cierre manual, y "liquidada" una posición liquidada.
- **FR-038** (RF-47): Si una posición abierta pierde su SL o su TP sin haberse cerrado, el sistema
  MUST registrarlo como evento crítico, sin modificar la posición.

**Reconciliación al arrancar (PRD-003)**

- **FR-039** (RF-45): Al arrancar, antes de procesar alertas nuevas, el sistema MUST comparar sus
  posiciones abiertas y entradas pendientes locales con las de Binance en el modo activo.
- **FR-040** (RF-46): En esa comparación, el sistema MUST tratar cada posición local que ya no
  exista en Binance como cerrada, aplicando FR-033 a FR-037.
- **FR-041** (RF-48): En esa comparación, para cada entrada pendiente que en Binance tuvo
  ejecución, el sistema MUST colocar el SL y el TP y, si falla, cerrar la posición a mercado.
- **FR-042** (RF-49): En esa comparación, para cada entrada pendiente cuyo plazo de 3 minutos venció,
  el sistema MUST aplicar FR-031 o FR-032 según haya tenido o no ejecución.
- **FR-065** (RF-53): En esa comparación, para cada posición abierta en Binance cuya operación local
  tuvo ejecución pero nunca llegó a "completa", el sistema MUST colocar el SL y el TP que falten y,
  si falla, cerrar la posición a mercado (FR-030). Si la operación ya estaba "completa" y perdió su
  SL o su TP, se aplica FR-038.

**Log y auditoría (PRD-000)**

- **FR-043** (RF-05): El sistema MUST registrar en un log toda alerta procesada, cargada o
  rechazada, con: identificador, fecha/hora, remitente, modo (DRY/LIVE), ticker, símbolo, side,
  Entrada, SL, TP y origen del TP (alerta o calculado), cantidad, riesgo R configurado, nivel de
  riesgo, IDs de las órdenes de Binance, causa de cierre, fecha/hora de cierre, PnL realizado,
  comisiones y estado. Los campos que no apliquen quedan vacíos.
- **FR-044** (RF-05): El estado MUST ser uno de: completa, rechazada + motivo, cerrada por
  emergencia, entrada no ejecutada, cerrada, liquidada.
- **FR-045** (AC-09): El motivo de rechazo MUST ser uno de: incompleta, TP inválido, SL igual a la
  Entrada, SL fuera de rango, top 3 ganadores/perdedores, ranking no disponible, excede máximos,
  bajo mínimo, ticker inexistente, límite de posiciones, límite de capital, remitente no
  autorizado, duplicado, símbolo ya en operación, datos de mercado no disponibles.
- **FR-046** (RNF-10): El log y el almacenamiento local (alertas procesadas, posiciones abiertas)
  MUST tener permisos 0600, legibles solo por el usuario del proceso.
- **FR-047** (PRD-000, Fuera de Alcance): La edición de una alerta ya procesada MUST registrarse en
  el log (texto anterior y nuevo, y los datos que cambiaron) sin operarse.

**WhatsApp (PRD-000)**

- **FR-048** (RF-06): El sistema MUST requerir autenticación para conectarse a WhatsApp mediante un
  código QR que vincule la cuenta cuyo grupo se monitorea, y mostrarlo cuando no haya sesión
  guardada.
- **FR-049** (RNF-03): Los datos de sesión de WhatsApp MUST guardarse cifrados en disco con una
  clave leída de una variable de entorno, en un directorio con permisos 0700, excluido del
  repositorio.

**Modos DRY y LIVE (PRD-000)**

- **FR-050** (RF-07): El sistema MUST ofrecer un comando de arranque para el modo DRY y otro
  distinto para el modo LIVE.
- **FR-051** (RF-25, RF-26): En DRY, todas las órdenes y consultas de balance MUST ir a Binance
  Demo Trading; en LIVE, a Binance Futuros USDS-M de producción.
- **FR-052** (RNF-07): Las credenciales de Binance de DRY y de LIVE MUST leerse de variables de
  entorno con nombres distintos.

**Seguridad (PRD-000)**

- **FR-053** (RNF-02): Las API keys (del proveedor de IA y de Binance) MUST NOT estar en el código;
  se leen de variables de entorno.
- **FR-058** (Clarificación 2026-10-27, enmendada 2026-10-28): Si al arrancar falta la clave de
  cifrado de la sesión de WhatsApp o las credenciales de Binance del modo elegido, el sistema
  MUST NOT arrancar (la key del proveedor de IA es opcional; FR-004): termina indicando qué variable falta, sin conectarse a WhatsApp ni a Binance.
- **FR-062** (Clarificación 2026-10-27): Si al arrancar falta o es inválido algún parámetro de la
  configuración del operador (riesgo R, máximo de posiciones simultáneas, capital comprometido
  máximo, tamaño de posición máximo, apalancamiento máximo, apalancamiento del símbolo), el sistema
  MUST NOT arrancar: termina indicando qué parámetro falta o es inválido. Todos los valores
  numéricos MUST ser mayores que 0. El porcentaje máximo de distancia del SL usa 15 % si no se
  configura (FR-013), y si se configura MUST ser mayor que 0.
- **FR-054** (RNF-08): La key de Binance de producción MUST tener solo permiso de trading, con el
  retiro de fondos deshabilitado.

**Resiliencia (PRD-000)**

- **FR-055** (RNF-04): El sistema MUST detectar la desconexión de WhatsApp o de Binance en < 30 s y
  reintentar con backoff exponencial (1 s, 2 s, 4 s… hasta un máximo de 60 s entre intentos);
  cada interrupción se registra en el log, y tras 10 intentos fallidos consecutivos se registra un
  evento crítico, el sistema deja de reintentar y el proceso termina, para que el reinicio
  automático (FR-056) vuelva a arrancar el ciclo de reconexión desde cero. Excepción: mientras haya
  un cierre de emergencia en curso (FR-030), el proceso MUST NOT terminar por esos 10 fallos; el
  cierre se sigue reintentando hasta que la posición quede cerrada.
- **FR-056** (RNF-05): Si el proceso se cae, MUST reiniciarse automáticamente y retomar la ingesta
  en < 60 s.

### Key Entities *(include if feature involves data)*

- **Mensaje**: mensaje del grupo de WhatsApp (texto, imagen opcional, remitente, ID). Solo se
  convierte en alerta si pasa el filtro de FR-001.
- **Alerta**: datos extraídos de un mensaje (ticker, Entrada, objetivo, SL, nivel de riesgo),
  identificador único (FR-006), side, símbolo mapeado, precios ajustados, TP y su origen, y estado
  en el ciclo de vida.
- **Remitente autorizado**: entrada de la lista configurable de quienes pueden enviar alertas.
- **Ranking top 3**: copia local de los 3 mayores ganadores y perdedores de 24 h, con su fecha/hora
  de refresco.
- **Operación**: lo que se coloca para una alerta válida: cantidad, orden de entrada, orden de SL,
  orden de TP, con sus IDs en Binance.
- **Posición abierta / entrada pendiente**: estado local persistente que cuenta para los límites
  de posiciones y capital y se reconcilia con Binance al arrancar.
- **Configuración del operador**: riesgo R, máximo de posiciones simultáneas, capital comprometido
  máximo, tamaño de posición máximo, apalancamiento máximo, apalancamiento del símbolo (margen
  aislado), porcentaje máximo de distancia del SL.
- **Entrada de log**: registro por alerta con los campos de FR-043; también eventos de conexión y
  eventos críticos.
- **Sesión de WhatsApp**: datos de autenticación de la cuenta vinculada, cifrados en disco.
- **Modo de ejecución**: DRY o LIVE; determina el entorno de Binance y las credenciales.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Desde que llega el mensaje hasta que la alerta queda clasificada (válida o
  rechazada) pasan < 3 s (p95) si alcanza con el texto y < 10 s (p95) si requiere la imagen,
  medido sobre lotes de 20 alertas de cada tipo (RNF-01, AC-46).
- **SC-002**: Desde que llega el mensaje hasta que Binance acepta la orden de entrada pasan < 5 s
  (p95) solo con texto y < 12 s (p95) con imagen, sobre lotes de 20 alertas válidas de cada tipo
  (RNF-09, AC-48).
- **SC-003**: Ante una falla del SL o del TP con la entrada ejecutada, la posición queda cerrada
  en < 5 s; 0 posiciones quedan abiertas sin SL y TP por decisión del sistema (AC-16).
- **SC-004**: El cierre de una posición en Binance queda registrado y su cupo liberado en < 10 s, y
  la pérdida de un SL o TP queda registrada como evento crítico en < 10 s, en el 100 % de 20 casos
  de prueba en DRY (RNF-11, AC-62, AC-67).
- **SC-005**: El 100 % de las alertas procesadas tiene su entrada en el log con los campos que
  aplican completos, y el 100 % de las rechazadas tiene exactamente un motivo de FR-045.
- **SC-006**: En DRY, 0 órdenes o consultas de balance llegan a producción; en LIVE, 0 llegan a Demo
  Trading.
- **SC-007**: Una desconexión de WhatsApp o Binance queda registrada en < 30 s, y tras una caída
  abrupta la ingesta se retoma en < 60 s.
- **SC-008**: El escaneo de secretos sobre el repositorio y todo su historial reporta 0 hallazgos, y
  ningún archivo de sesión contiene en texto plano el número vinculado.
- **SC-009**: Ninguna alerta se opera dos veces (0 duplicados operados ante reinicios o reenvíos).

## Assumptions

- El alcance de esta especificación es el del PRD completo (PRD-000 a PRD-003): ingesta y
  validación, carga y reversión, seguimiento y cierre, y el marco transversal (log, modos,
  seguridad y resiliencia).
- Un solo operador por instancia y un solo grupo de alertas monitoreado.
- El reinicio automático (FR-056) cubre caídas del proceso de la app; una caída o reinicio de la
  máquina detiene toda la ingesta hasta que el operador vuelva a arrancar el sistema (Riesgos del
  PRD-000: un único proceso sin redundancia).
- El cifrado de la sesión de WhatsApp (FR-049) es requisito antes de habilitar el modo LIVE.
- La política de habilitación de LIVE (al menos 7 días corridos y 20 alertas en DRY con 0 errores
  de clasificación contra revisión manual) es manual y el sistema no la controla.
- Se usa un número de teléfono dedicado, no crítico, para el puente con WhatsApp.
- El PRD no define retención ni rotación del log; esta especificación no las incluye.
- Fuera de alcance: backtesting y análisis de performance; dashboard; más de un exchange; más de
  un grupo; notificaciones externas; mensajes de seguimiento de una alerta ya operada (cerrar,
  mover el SL, tomar parciales); gestión de la posición abierta (trailing stop, múltiples TP);
  multiusuario; recolocar una entrada vencida; operar la edición de una alerta ya procesada;
  recolocar un SL o TP que desapareció; cierres parciales manuales; precio de salida y duración de
  la operación en el log; reportes de PnL.

## Dependencies

- Servicio de WhatsApp y una cuenta vinculable con un número dedicado.
- Proveedor de IA para extraer datos del texto y de la imagen.
- Binance Futuros USDS-M: fuente pública (ticker 24 h, estado y filtros de símbolos, velas de 15 min),
  API de órdenes, balance, posiciones, PnL realizado y comisiones.
- Binance Demo Trading para el modo DRY.
- Cuenta de Binance con API key habilitada solo para trading (sin permiso de retiro).
- Almacenamiento local persistente para alertas procesadas, posiciones abiertas y entradas
  pendientes.
