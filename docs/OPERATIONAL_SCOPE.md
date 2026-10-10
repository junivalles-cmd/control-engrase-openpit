# Rediseño operativo — cuadrillas, ubicaciones y asignación manual de engrases

Fecha: 2026-09-28. Implementa el "LOTE OPERATIVO GLOBAL" pedido para modelar
la operación real de campo: cuadrillas que pertenecen a una ubicación, y la
posibilidad de asignar manualmente UN engrase pendiente a otra cuadrilla sin
mover el equipo.

## ⚠ CORRECCIÓN ARQUITECTÓNICA 2026-10-02 — ya NO hay dispositivos vinculados a cuadrilla

El diseño original de este documento (2026-09-28, ver más abajo) ataba la
cuadrilla a un **dispositivo físico** ("un mismo teléfono lo usan los 4
lubricadores de una cuadrilla"). El usuario pidió explícitamente eliminar
esa dependencia: **el mismo APK y la misma Web deben funcionar en
cualquier teléfono/tablet/PC compatible**, sin APK por ubicación/
cuadrilla/turno/usuario/dispositivo, y sin IMEI/serial/modelo/Android ID
como requisito de acceso.

**Reemplazado por:** la cuadrilla ahora autoriza USUARIOS reales
(`cuadrillas[].memberUserIds`, array de `app_user_id`), nunca un aparato.
Un Lubricador/Supervisor con 1 sola cuadrilla autorizada la usa
automáticamente; con 2+ elige con cuál trabajar en la sesión actual (ver
`getSelectedCrewId()`/`setSelectedCrewId()` en `app.js` — SOLO una
comodidad local, nunca la fuente de autorización). Un usuario autorizado
puede iniciar sesión en cualquier dispositivo nuevo y trabajar normalmente
de inmediato — no hace falta "asignar" nada al aparato. El viejo panel
"Dispositivo operativo" de Configuración desapareció; ahora se autorizan
miembros desde **Configuración → Cuadrillas → Editar → Miembros
autorizados**.

El resto de este documento describe el modelo DE ESE MOMENTO (2026-09-28)
— se deja tal cual por valor histórico, pero cualquier mención a
"dispositivo"/`getDeviceAssignment()`/`saveDeviceAssignment()` como fuente
de scope ya NO aplica: reemplazado por `getAuthorizedCrews()` en
`src/core/operational-scope.js`.

## Modelo de dominio

- **Equipo** (`equipment`): tiene su propia `locationId` (permanente, hasta
  que un ADMIN/PLANIFICADOR lo mueva).
- **Ubicación** (`locations`): catálogo dinámico existente, sin cambios de
  schema.
- **Cuadrilla** (`cuadrillas`): AMPLIADA con tres campos nuevos, opcionales,
  sin migración de datos (quedan `undefined`/`null`/`[]` en filas viejas):
  - `locationId` — a qué ubicación pertenece esta cuadrilla.
  - `isDefault` — si es la cuadrilla que recibe el trabajo NORMAL de esa
    ubicación (máximo una `isDefault:true` activa por `locationId`, ver
    `resolveDefaultCrewForLocation()`).
  - `memberUserIds` (agregado 2026-10-02, ver corrección arriba) — qué
    `app_user_id` (Auth) están autorizados a trabajar como esta cuadrilla,
    desde cualquier dispositivo.
- **Usuario** (Auth): aporta identidad + rol SIEMPRE; para
  SUPERVISOR/LUBRICADOR, también su cuadrilla autorizada (resuelta en vivo
  contra `cuadrillas[].memberUserIds`, nunca guardada en el perfil — ver
  `currentUserFromAuthProfile()`/`getAuthorizedCrews()`).
- **Turno** (Día/Noche): SIEMPRE se resuelve en vivo con `currentShiftId()`.
  Nunca se lee ni se guarda en ningún identificador de dispositivo.

## Autoridad central: `src/core/operational-scope.js`

Módulo puro (sin DOM/DB/red), mismo patrón que `weekly-matrix.js` /
`plan-compliance.js`. Nadie más reimplementa esta lógica:

- `resolveOperationalScope({ currentUser, deviceAssignment, cuadrillas, shiftId })`
  → `{ kind, crewId, crewLocationId, ... }`. `kind` es uno de:
  - `GLOBAL` — jefaturas (ADMIN/PLANIFICADOR/SUPERVISOR/VISOR): ven todo.
  - `DEVICE_UNASSIGNED` — Lubricador en un dispositivo sin cuadrilla (o con
    una cuadrilla borrada/inactiva). Mi Turno muestra un mensaje explícito,
    **nunca** cae a la lista global de equipos.
  - `DEVICE_SCOPED` — Lubricador con cuadrilla activa asignada al
    dispositivo.
- `classifyEquipmentWork({ scope, equipos, cuadrillas, assignments, equipoOccurrenceKeyFn })`
  → `{ normal, assigned }`. Con 2+ cuadrillas en la misma ubicación, solo la
  `isDefault` recibe trabajo "normal" (evita que dos cuadrillas engrasen el
  mismo equipo el mismo día).
- Identidad de ocurrencia (`computeOccurrenceKey`): nunca
  `equipmentId+cuadrillaId` (eso volvería la asignación permanente).
  - Plan "Día y turno de la semana": `${planId}:${YYYY-MM-DD}`.
  - Plan "Horas de operación": `${planId}:h:${lastGreaseHour}` — al
    registrarse un engrase, `lastGreaseHour` avanza y nace una ocurrencia
    nueva automáticamente, sin colisionar con la ya completada.
- Motor de asignaciones: `createAssignment`/`reassignAssignment`/
  `cancelAssignment`/`completeAssignmentIfPending` — funciones de decisión
  puras; quien llama (`app.js`) hace el `DB.put`/`logAudit`/`Sync.fullSync()`
  real.
- `canLubricadorExecuteEquipment()` — permiso de ejecución (QR / Registrar):
  dentro de su ubicación normal siempre puede, fuera de ella solo si hay una
  asignación PENDING hacia su cuadrilla.

## Regla de arquitectura Android/Web — UN SOLO APK, SIN dispositivo registrado (confirmado 2026-10-02, actualizado tras la corrección arquitectónica)

Pedido explícito del usuario: debe existir un único APK/una sola Web de
Control de Engrase Open Pit para todos los teléfonos/tablets/PC
compatibles — nunca uno por ubicación, cuadrilla, turno, usuario ni tipo
de dispositivo, y **sin ninguna dependencia funcional de IMEI/serial/
modelo/Android ID/"dispositivo ya vinculado a una cuadrilla"**:

- **`CONTROL_ENGRASE_APP_ANDROID/android/app/build.gradle`**: un solo
  `applicationId` (`com.conequisa.engraseopenpit`), sin
  `productFlavors`/`flavorDimensions` — Gradle solo distingue
  debug/release, nunca una variante por ubicación/cuadrilla/turno.
- **Usuario**: identidad + rol vienen 100% de Auth (`app_profiles`,
  `currentUserFromAuthProfile()`) — nunca una ubicación/cuadrilla fija por
  persona, nunca hardcodeada en el build.
- **Cuadrilla/ubicación**: YA NO depende de ningún dispositivo (ver
  corrección arquitectónica arriba) — `cuadrillas[].memberUserIds`
  autoriza al USUARIO, resuelto en vivo por
  `getAuthorizedCrews()`/`resolveOperationalScope()`
  (`src/core/operational-scope.js`). Un usuario autorizado entra desde
  CUALQUIER dispositivo nuevo y trabaja de inmediato, sin "vincular" nada
  primero. La única huella local (`getSelectedCrewId()`/
  `setSelectedCrewId()`, `localStorage`) es qué cuadrilla autorizada eligió
  para ESTA sesión si tiene 2+ — una comodidad de UI, nunca una fuente de
  permiso (se ignora si ya no está autorizada).
- **Turno**: siempre `currentShiftId()` en vivo (hora real del
  dispositivo) — nunca guardado, nunca fijo por build.
- **Quick Unlock** (PIN): 100% local al dispositivo (comodidad de
  desbloqueo) — nunca determina permisos/cuadrilla/ubicación; usar otro
  dispositivo exige autenticarse normal y configurar un PIN nuevo ahí.
- **Conclusión**: el mismo APK/la misma Web, en cualquier
  teléfono/tablet/PC compatible, se comporta distinto SOLO según quién
  inicia sesión + qué cuadrilla(s) tiene autorizadas esa persona + el
  turno real — nunca según qué aparato es. Cambiar de dispositivo
  conserva exactamente los mismos permisos remotos de esa persona.

Tests de dominio: `tests/unit/operational-scope.test.js` (29 casos, cubren
CASO 1/3/7/8/11/12/13 del pedido original entre otros).

## Store nuevo: `lubrication_assignments`

`DB_VERSION` 6→7 en `db.js` (no destructivo: `onupgradeneeded` ya crea
genéricamente cualquier store nuevo en `STORES`). Campos:
`{ id, occurrenceKey, equipmentId, planId, assignedCrewId, assignedByUserId,
assignedByUserName, assignedAt, status, completedAt, completedRecordId,
previousCrewId, notes, active }`. `status` ∈ `PENDING|COMPLETED|CANCELLED`
— cancelar/completar es siempre un cambio de `status`, nunca un borrado.

## Dónde se conectó (UI)

- **Mi Turno** (`renderLubricadorHome`): usa `resolveOperationalScope()` +
  `classifyEquipmentWork()` en vez de `equiposDeEstaPersona()`. Muestra
  sección "ASIGNADOS A MI CUADRILLA" aparte del trabajo normal, y el mensaje
  de dispositivo sin cuadrilla.
- **Plan de Engrase**: botón "Asignar a cuadrilla" por fila cuando el equipo
  está vencido/próximo a vencer (ROJO/AMARILLO), visible para
  ADMIN/PLANIFICADOR/SUPERVISOR.
- **Ficha del equipo** (`openEquipmentDetail`, reachable desde Equipos):
  botones "Asignar a cuadrilla" (mismo criterio) y "Mover ubicación"
  (ADMIN/PLANIFICADOR, permanente, con `logAudit('EQUIPMENT_LOCATION_CHANGED', ...)`).
- **Registrar Engrase** (`startGreaseFlow`): calcula la `occurrenceKey` ANTES
  de que el plan se actualice y, si el guardado tiene éxito, llama a
  `completeGreaseAssignmentForOccurrence()` — cierra la asignación PENDING
  correspondiente si existía.
- **QR** (`showEquipmentQrInfo`): un Lubricador fuera de su cuadrilla/
  ubicación y sin asignación activa ve un aviso y no puede registrar desde
  ahí (`canLubricadorExecuteEquipment()`).
- **Configuración**:
  - Panel "Cuadrillas de lubricación" dedicado (reemplaza el genérico
    `simpleListPanelHTML`): ubicación + cuadrilla por defecto por fila,
    `logAudit('CREW_LOCATION_CHANGED', ...)` al cambiar ubicación.
  - ~~Panel "Dispositivo operativo"~~ — ELIMINADO 2026-10-02 (corrección
    arquitectónica, ver arriba). Reemplazado por "Miembros autorizados"
    dentro del propio formulario de cada cuadrilla (`canManageCrewMembership()`,
    mismos roles que antes editaban: ADMIN/PLANIFICADOR).

## Eventos de auditoría nuevos

`CREW_MEMBERSHIP_CHANGED` (reemplaza `DEVICE_CREW_CHANGED`, eliminado
2026-10-02), `CREW_LOCATION_CHANGED`, `EQUIPMENT_LOCATION_CHANGED`,
`GREASE_ASSIGNED`, `GREASE_REASSIGNED`, `GREASE_ASSIGNMENT_CANCELLED`,
`GREASE_ASSIGNMENT_COMPLETED` — todos vía `logAudit()` (db.js), visibles en
Configuración → Registro de auditoría.

## RLS (preparada, NO aplicada)

`supabase/migrations/0004_lubrication_assignments_rls_PREPARED.sql` agrega
`lubrication_assignments` a la matriz `app_store_permissions` — las 3
policies de `engrase_sync` (0002) son genéricas por `store`, así que no hace
falta ninguna policy nueva. Documenta la limitación conocida: RLS filtra por
`store`+rol, no puede restringir por `assignedCrewId` dentro del payload (esa
restricción la impone el cliente vía `operational-scope.js`, igual que ya
pasa con el resto de stores de `engrase_sync`).

## Deliberadamente fuera de alcance de este lote (transparencia)

- Propagación a pantallas secundarias: Dashboard, Matriz Semanal (badge de
  asignación), `renderTurno` (vista de escritorio del turno, filtra por
  `shiftId` legacy), Reportes (el filtro "Ubicación" sigue agrupando por la
  ubicación ACTUAL del equipo, no por la de cada registro histórico — ver
  limitación conocida más abajo), Usuarios, exports. Ninguna de ellas queda
  rota — siguen leyendo `equipment.locationId` real (que
  `moverEquipoDeUbicacion()` sí mantiene correcto).

## Cierre del lote — 3 gaps resueltos (2026-09-28, commit posterior a `44a312b`)

### 1) Snapshot histórico en `lubrication_records`

Todo registro NUEVO guarda `record.operationalSnapshot` (construido por
`buildExecutionSnapshot()` en `operational-scope.js`, con los valores
resueltos ANTES de tocar plan/equipo):
`{ equipmentLocationIdAtExecution, crewId, crewLocationIdAtExecution,
performedByUserId, shiftId, assignmentId, executionType: 'NORMAL'|'MANUAL' }`.
`executionType` es `'MANUAL'` si existía una asignación PENDING activa para
esa ocurrencia al momento de registrar (la cuadrilla responsable es la
asignada, no la del dispositivo que registra), `'NORMAL'` en caso contrario.
`crewId` queda `null` cuando quien registra es una jefatura sin asignación
activa — nunca se inventa una cuadrilla.

Lectura con fallback explícito (`resolveRecordEquipmentLocationId()`/
`resolveRecordCrewId()`/`resolveRecordCrewLocationId()`): con snapshot,
devuelven el dato histórico real (`source:'snapshot'`); sin snapshot
(registros de antes de este cierre), caen a `source:'legacy_fallback'` — la
ubicación del equipo cae a la ACTUAL (marcada con "*" en UI, nunca
presentada como histórica real), la cuadrilla queda `null` siempre (no hay
"actual" razonable al que caer). Wired en Historial → "Por equipo" →
Engrases, nueva columna "Ubicación".

**Nunca se reescribe el pasado**: mover un equipo/cuadrilla después de un
registro no lo modifica — los 15 tests de `tests/unit/operational-scope.test.js`
("Snapshot histórico") cubren exactamente el CASO A/B/C pedido (registrar en
Volcán → mover a Mojón → el histórico sigue Volcán) y su equivalente con
cuadrilla.

**Limitación conocida (no resuelta, fuera de alcance):** Reportes sigue
filtrando/agrupando por la ubicación ACTUAL del equipo (`equipos.filter(e =>
e.locationId === ubic)` antes de contar sus registros), no por el snapshot
de cada registro — un reporte "por ubicación" puede seguir atribuyendo
trabajo histórico a la ubicación nueva del equipo tras un movimiento. El
dato correcto YA existe (`operationalSnapshot`); falta reescribir el
pipeline de agregación de Reportes para usarlo — señalado para un lote
futuro, nunca resuelto a medias aquí.

### 2) Notificaciones de assignments — ciclo completo

Reutiliza 100% la infraestructura existente de `LocalNotifications`
(Capacitor, funciona SIN OneSignal — no depende de ningún servicio push
externo): `refreshLocalNotifications()` gana un bloque nuevo (IDs
`NOTIF_ID_ASSIGNED`/`NOTIF_ID_ASSIGNED_REC`) que reutiliza
`classifyEquipmentWork()` (la MISMA función que ya decide "ASIGNADOS A MI
CUADRILLA" en Mi Turno) para saber qué notificar — nunca un cálculo
paralelo. Como el patrón ya existente para vencidos/porEngrasar cancela
TODAS las notificaciones conocidas y recalcula desde cero cada vez que
corre, el ciclo de vida completo queda cubierto sin rastrear estado propio:
- **PENDING** → aparece en `classifyEquipmentWork().assigned` → se
  (re)programa la notificación inicial (~3s) + un recordatorio a 2h.
- **COMPLETED/CANCELLED** → deja de aparecer → al cancelarse todo al inicio
  de la función y no volver a programarse, desaparece sola.
- **REASSIGNED A→B** → A deja de verla en su `.assigned` (siguiente
  recálculo), B empieza a verla — nunca se duplica (un solo ID agrupado, no
  uno por asignación).
- **Cambio de turno** → `classifyEquipmentWork()` no depende de `shiftId`
  para "assigned", así que el recordatorio sigue activo para la cuadrilla
  sin importar Día/Noche.

Disparo **sin polling nuevo**: `onSyncStateChange()` (ya existente) llama a
`refreshLocalNotifications()` cuando `state.pulled > 0` — reutiliza el ciclo
de sync YA configurado (30s-10min), nunca un timer adicional.

### 3) Aislamiento de la selección de cuadrilla de sesión — garantía verificada (reescrito 2026-10-02)

Reemplaza la vieja garantía de aislamiento por DISPOSITIVO (`getDeviceId()`)
por aislamiento por USUARIO, consistente con la corrección arquitectónica de
arriba. `getSelectedCrewId(userId)`/`setSelectedCrewId(userId, crewId)`
(app.js) guardan `{ userId, crewId }` bajo UNA sola clave de `localStorage`
(`engrase_session_crew`) — `getSelectedCrewId()` solo devuelve un valor si
el `userId` guardado coincide EXACTAMENTE con quien lo pide; si otra persona
inicia sesión en el MISMO teléfono, su `userId` no coincide, así que nunca
hereda por error la cuadrilla que había elegido la persona anterior (cae a
`NEEDS_CREW_SELECTION` si tiene 2+ autorizadas, o se autoselecciona si tiene
solo 1 — nunca una herencia silenciosa). `tests/unit/device-assignment-isolation.test.js`
(renombrado conceptualmente a "aislamiento de sesión de cuadrilla", mismo
archivo) verifica contra el código real: usuario A y B mantienen selecciones
independientes en el mismo `localStorage`; cambiar la de A nunca toca la de
B; la autorización REAL siempre viene de `cuadrillas[].memberUserIds`
(servidor, sincronizado), nunca de este valor local — un `selectedCrewId`
local para una cuadrilla de la que ya se le quitó la autorización se ignora.

**Logout/Quick Unlock/offline**: ninguno de los tres borra
`engrase_session_crew` (es una comodidad de UI, no una credencial) — pero
tampoco hace falta que la borren: al volver a resolver el scope, el check
de `userId` ya garantiza que solo APLICA si sigue siendo la misma persona
Y esa cuadrilla sigue en su lista autorizada real.

**Reinstalación/dispositivo nuevo — comportamiento REAL (ya no es un
problema, por diseño):** reinstalar (`adb install -r`), hacer `adb
uninstall`+instalar de cero, o iniciar sesión en un teléfono/tablet/PC
COMPLETAMENTE NUEVO ya no afecta la autorización de cuadrilla en absoluto
— esta vive en `cuadrillas[].memberUserIds` (servidor, sincronizado), no en
ese dispositivo. Lo único que se pierde al reinstalar/cambiar de aparato es
`engrase_session_crew` (la comodidad de "cuál cuadrilla elegí la última
vez"): con 1 sola cuadrilla autorizada no se nota (se autoselecciona
igual); con 2+, simplemente se vuelve a preguntar una vez. Nunca hace falta
que un Administrador "reconfigure" nada por un cambio de hardware.

## Engrase fuera de plan (lote 2026-09-28c)

Tres tipos de ejecución, ortogonales a `record.retroactivo` (CUÁNDO se
registra) — `executionType` describe POR QUÉ/CONTEXTO: `PLANNED` (trabajo
normal del plan), `ASSIGNED` (asignación manual activa — SIEMPRE gana sobre
OUT_OF_PLAN, nunca se convierte silenciosamente), `OUT_OF_PLAN` (PM,
correctivo, oportunidad, otro — botón "+ Fuera de plan", nunca requiere que
Planificador cree una assignment artificial primero).

- **Central**: `findExistingWorkForEquipment()` (detecta ASSIGNED/PLANNED
  antes de dejar abrir el flujo fuera de plan — nunca duplica),
  `computeExecutionCompleteness()` (desde el checklist, nunca un checkbox
  manual), `findNextApplicableOccurrence()`/`resolveOutOfPlanSatisfaction()`
  (única ocurrencia próxima sin completar en una ventana de **1 día**
  calendario de adelanto — hoy o mañana, nunca más lejos; cambio
  deliberado 2026-10-09, "REALIZADO ADELANTADO" §21-23: antes la ventana
  era de 7 días, se acotó a propósito para que un engrase con 2+ días de
  anticipación NUNCA satisfaga la ocurrencia futura automáticamente —
  ambigua o inexistente → `null`, nunca se inventa un cumplimiento).
- **Plan por horas**: un OUT_OF_PLAN COMPLETO avanza `plan.lastGreaseHour`
  igual que cualquier registro más reciente (lógica YA existente, sin
  cambios) — `satisfiedOccurrenceKey` solo certifica cuál ciclo quedó
  satisfecho, nunca reinicia el ciclo si es PARTIAL.
- **Plan día/turno**: un OUT_OF_PLAN COMPLETO puede satisfacer por
  adelantado la ÚNICA ocurrencia futura sin completar dentro del día
  siguiente (ventana de 1 día, ver arriba) — el plan maestro
  (`assignedDays`/`frequency`/etc.) **nunca se toca**. La Matriz Semanal
  (`estadoCelda()`) muestra esa celda como
  `hecho_adelantado` cuando algún registro trae
  `operationalSnapshot.satisfiedOccurrenceKey` igual a la clave de esa
  celda — el registro real queda en su propia fecha, nunca se reescribe.
- **UI**: botón "+ Fuera de plan" en Mi Turno (junto a "Escanear QR", **sin
  pestaña nueva** en la barra inferior) → `openOutOfPlanEquipmentPicker()`
  (lista scopeada, nunca toda la flota para un Lubricador) →
  `handleOutOfPlanEquipoSelected()` (detección de trabajo existente, §5) →
  `startGreaseFlow(id, target, {outOfPlan:true})` (badge "FUERA DE PLAN" +
  selector de motivo, "Otro" exige observación). Mismo flujo disponible
  desde QR (`showEquipmentQrInfo`, caso C del §21) y desde la ficha de
  equipo para jefaturas (`canRegisterOutOfPlan()`).
- **Historial**: columna "Tipo" (Planificado/Asignado/Fuera de plan, con
  motivo+completitud en tooltip para fuera de plan).
- **Reportes**: el filtro "Ubicación" ahora usa
  `resolveRecordEquipmentLocationId()` sobre cada registro (snapshot real si
  existe, fallback a la ubicación actual del equipo si no) en vez de la
  ubicación ACTUAL del equipo para decidir qué registros entran — el
  universo de "programados" (Tendencia/por turno) sigue usando la ubicación
  actual a propósito, porque "programado" es un concepto del plan vigente
  hoy, no un dato histórico.
- **Auditoría**: `OUT_OF_PLAN_GREASE_RECORDED` (equipo, motivo,
  completitud, ocurrencia satisfecha o "pendiente de conciliación").
- **DB_VERSION**: sigue en 7 — solo campos nuevos en `operationalSnapshot`
  (`executionType`/`outOfPlanReason`/`executionCompleteness`/
  `satisfiedOccurrenceKey`), ningún store nuevo.

**Deliberadamente fuera de alcance de este lote:**
- Reportes: sin filtros/indicadores dedicados de PLANNED/ASSIGNED/OUT_OF_PLAN
  por motivo (el dato ya se captura en `operationalSnapshot`, listo para un
  lote futuro de Reportes).
- Caso ambiguo (§13, 2+ ocurrencias candidatas): ADMIN/PLANIFICADOR NO tienen
  todavía un selector explícito de "qué ocurrencia sustituye" — se registra
  igual que para Lubricador, sin satisfacer ninguna, sin picker dedicado.
- ASSIGNED + PM (§15, "executionContext" adicional sobre una completación de
  assignment): la prioridad ASSIGNED-siempre-gana SÍ está garantizada; la
  nota extra de "esto también fue PM" sobre una assignment no se implementó.
- **Bug pre-existente encontrado (NO introducido en este lote, NO
  corregido)**: en `showEquipmentQrInfo()`, el botón "Registrar engrase
  ahora" para ADMIN/PLANIFICADOR/SUPERVISOR llamaba a
  `startGreaseFlow(equipment.id, App.route)` — `App.route` es un string
  (ej. `'equipos'`), no un elemento DOM, y `startGreaseFlow()` espera un
  elemento o `undefined`. Como una asignación de propiedad sobre un string
  primitivo no lanza error en modo no estricto, el formulario simplemente
  nunca aparecía (bug silencioso, ya existía antes de este lote). Las
  llamadas NUEVAS de este lote (`handleOutOfPlanEquipoSelected()`) usan el
  patrón correcto (`startGreaseFlow(id)` sin `target`, cae a
  `navigate('registrar')`). El bug original en la línea 443 no se tocó —
  fuera del alcance pedido, señalado aquí para una sesión futura.

## Lote occurrences/carryover (2026-09-30) — "No se pudo ejecutar" + mejoras Registrar Engrase + Panel operativo del Dashboard

- **§1 "No se pudo ejecutar"**: nuevo store sincronizado `lubrication_skips`
  (`DB_VERSION` 7→8, no destructivo). `src/core/operational-scope.js` gana
  `NO_EXECUTION_REASONS` (`REPARACION`/`YA_ENGRASADO`/`SIN_TIEMPO`/
  `NO_DISPONIBLE`/`CONDICION_INSEGURA`/`OTRO`), `validateNoExecutionInput()`
  (`OTRO` exige observación, mismo criterio que `outOfPlanReason`),
  `buildNoExecutionRecord()` y `findCarriedOverSkipForToday()`. Botón "No se
  pudo ejecutar" en `startGreaseFlow()` (`openNoExecutionForm()`) abre un
  modal motivo+observación — **NUNCA crea un `lubrication_record`**, solo
  el skip. El carryover al turno siguiente del MISMO día es automático y
  gratis: `estadoCelda()` (weekly-matrix.js) ya decide 'pendiente' por
  FECHA, no por turno, así que un skip de Día no hace nada especial para
  que Noche siga viendo la ocurrencia como pendiente — no se tocó
  weekly-matrix.js/plan-compliance.js en este punto. RLS preparada (NO
  aplicada): `supabase/migrations/0005_lubrication_skips_rls_PREPARED.sql`.
- **§2 Registrar Engrase**: header de `startGreaseFlow()` ahora muestra 3
  avisos informativos (nunca bloquean el registro): turno programado vs.
  turno en el que se está registrando (si no coinciden, adelanta que
  quedará "Realizado atrasado"), equipo VENCIDO (`estadoPrevio==='ROJO'`),
  y carryover de un "no se pudo ejecutar" de un turno anterior del mismo
  día (`findCarriedOverSkipForToday()`). Selector de equipo: el `<select>`
  con todos los equipos activos fue reemplazado por un buscador en vivo
  (`wireRegEquipoSearch()`, mismo patrón que `wireQuickFind()` de la
  topbar pero con contenedor propio, sin listener en `document`).
  Validación nueva: si el checklist quedó 100% marcado y la cantidad de
  grasa es 0, bloquea el submit (contradictorio). "Marcar todos" pide
  `confirm()` antes de aplicar (ya no es un toque accidental). El bloque de
  registro retroactivo (Planificador/Administrador) quedó colapsado dentro
  de `<details class="reg-advanced">` ("Opciones avanzadas"), sin cambiar
  su lógica. "Guardar fácil en móvil" ya estaba resuelto de un lote
  anterior (`.modal-actions` en `column-reverse` @640px pone "Finalizar
  engrase" arriba del todo, ancho completo) — no se tocó.
- **§3 Dashboard — "Panel operativo"** (nueva sección, después de
  "Cumplimiento operativo"): Pendientes turno anterior (carryover de
  skips), Asignaciones activas (`lubrication_assignments` PENDING),
  Fuera de plan hoy (`resolveRecordExecutionType()===OUT_OF_PLAN` sobre
  `recordsHoy`), No se pudo ejecutar hoy + desglose de motivos (chips), y
  Estado por ubicación (tabla, reagrupa el `statuses` YA calculado por
  `locationId` — el semáforo no se recalcula). Cero duplicación de
  conteos: todo reusa `ASSIGNMENT_STATUS`/`EXECUTION_TYPE`/
  `resolveRecordExecutionType()`/`statuses`/`equipoIdsFiltrados` ya
  existentes, independiente de "Cumplimiento operativo" (pregunta
  distinta: "¿se ejecutó lo programado?" vs. "¿qué está pendiente/fuera de
  plan/sin poder ejecutarse AHORA?"). Sin drill-down/modal propio en estas
  4 tarjetas todavía (a diferencia de las demás tarjetas del Dashboard) —
  simple decisión de alcance de este lote, no una limitación técnica.
- **Fuera de alcance de este lote** (auditado, documentado, NO tocado):
  sidebar (auditoría confirmó que no hay duplicado real — ver informe de
  sesión); notificaciones (OneSignal sin `external_id`/identidad por
  usuario, sin roles Supervisor/Planificador Día≠Noche, sin horarios
  programables por Admin, sin dedupe real — cambio de arquitectura mayor,
  requiere decisión explícita del usuario antes de tocar código real).
- `NO_EXECUTION_REASON_LABELS` vive como const global (junto a
  `STATUS_COLOR`/`WEEKDAY_ABBR_DASH`) porque tanto `startGreaseFlow()` como
  `renderDashboard()` la necesitan — una sola copia, no duplicada.
- Validación completa: unit 753/753 (+17 desde HEAD `34c1902`), Playwright
  1666/1666 (repetido 2 veces, 1 corrida con 5 fallos transitorios de
  `page.addStyleTag` bajo carga — confirmado flaky, no regresión real),
  `typecheck` limpio, `lint:css` 0 errores (67 warnings, +2 sobre el
  baseline de 65, misma clase de warning ya tolerada en todo el archivo),
  `build:web`+`verify:dist` OK. SW `v53` → **v54**.
- Nada tocó producción/Supabase: sin SQL ejecutado, sin bucket modificado,
  sin usuarios reales, sin deploy. `supabase/migrations/0005_*` solo
  preparada.
  fuera del alcance pedido, señalado aquí para una sesión futura.
