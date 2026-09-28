# Rediseño operativo — dispositivos, cuadrillas, ubicaciones y asignación manual de engrases

Fecha: 2026-09-28. Implementa el "LOTE OPERATIVO GLOBAL" pedido para modelar
la operación real de campo: teléfonos/tablets COMPARTIDOS entre lubricadores
de una misma cuadrilla, cuadrillas que pertenecen a una ubicación, y la
posibilidad de asignar manualmente UN engrase pendiente a otra cuadrilla sin
mover el equipo.

## Modelo de dominio

- **Equipo** (`equipment`): tiene su propia `locationId` (permanente, hasta
  que un ADMIN/PLANIFICADOR lo mueva).
- **Ubicación** (`locations`): catálogo dinámico existente, sin cambios de
  schema.
- **Cuadrilla** (`cuadrillas`): AMPLIADA con dos campos nuevos, opcionales,
  sin migración de datos (quedan `undefined`/`null` en filas viejas):
  - `locationId` — a qué ubicación pertenece esta cuadrilla.
  - `isDefault` — si es la cuadrilla que recibe el trabajo NORMAL de esa
    ubicación (máximo una `isDefault:true` activa por `locationId`, ver
    `resolveDefaultCrewForLocation()`).
- **Dispositivo**: identidad local (`getDeviceId()`, `localStorage`,
  sobrevive logout/Quick Unlock/`adb install -r`), asignado a UNA cuadrilla
  vía `getDeviceAssignment()`/`saveDeviceAssignment()` — infraestructura que
  YA EXISTÍA (guardada en el store sincronizado `push_tokens`, pensado
  originalmente para push) pero nunca se usaba para decidir scope operativo.
  Se reutiliza tal cual: cada dispositivo sincroniza SU PROPIA fila, nunca es
  una config global compartida.
- **Usuario** (Auth): solo aporta identidad + rol. Nunca
  `location`/`cuadrilla` fijos (ver `currentUserFromAuthProfile()`) — eso
  ahora es 100% responsabilidad del dispositivo para LUBRICADOR.
- **Turno** (Día/Noche): SIEMPRE se resuelve en vivo con `currentShiftId()`.
  Nunca se lee ni se guarda en el dispositivo para decidir scope.

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
  - Panel nuevo "Dispositivo operativo": muestra/edita la cuadrilla de ESTE
    dispositivo. ADMIN/PLANIFICADOR editan, SUPERVISOR/LUBRICADOR solo
    lectura, VISOR no lo ve (`canConfigureDevice()`).

## Eventos de auditoría nuevos

`DEVICE_CREW_CHANGED`, `CREW_LOCATION_CHANGED`, `EQUIPMENT_LOCATION_CHANGED`,
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

### 3) Aislamiento del device assignment — garantía verificada

`getDeviceAssignment()`/`saveDeviceAssignment()` (app.js) SOLO leen/escriben
la fila `push_tokens` cuyo `id === getDeviceId()` — nunca iteran ni tocan
otras filas, aunque `push_tokens` sea una tabla COMPARTIDA que sincroniza
las filas de TODOS los dispositivos. `tests/unit/device-assignment-isolation.test.js`
(8 tests) verifica contra el código real: dispositivo A y B mantienen
cuadrillas independientes incluso con ambas filas ya sincronizadas
localmente; cambiar A nunca toca ningún campo de B; `saveDeviceAssignment()`
escribe ÚNICAMENTE en `push_tokens` (nunca en `settings/general` ni ninguna
tabla global); `getDeviceId()` no depende de `App.currentUser` (logout no lo
afecta); un dispositivo nuevo (localStorage vacío) nunca hereda la cuadrilla
de otro.

**Logout/Quick Unlock/offline**: ninguno de los tres toca las claves
`engrase_device_id`/`engrase_device_name` de `localStorage` (auditado: cero
referencias fuera del bloque de identidad de dispositivo) — la cuadrilla del
dispositivo sobrevive los tres casos por construcción, no por un mecanismo
especial.

**Reinstalación — comportamiento REAL, sin sobreprometer:**
- `adb install -r` (reinstalar SOBRE la instalación existente, mismo
  paquete) preserva `localStorage`/IndexedDB en Android — confirmado
  empíricamente en una sesión previa (ver `docs/SESSION_HANDOFF.md`,
  verificación con CDP). La cuadrilla del dispositivo sobrevive.
- `adb uninstall` (o `pm clear`) seguido de una instalación nueva **borra**
  `localStorage` — `getDeviceId()` genera un id nuevo (`Math.random()` +
  `Date.now()`, sin ningún componente de hardware) y el dispositivo aparece
  como "sin cuadrilla" (`DEVICE_UNASSIGNED`) hasta que alguien lo reconfigure
  a mano en Configuración → Dispositivo operativo. **No existe ningún
  mecanismo de recuperación** (no hay lookup por IMEI/Android ID/serial ni
  backend que asocie un teléfono físico a su fila anterior) — no afirmar lo
  contrario ante el usuario.

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
  (única ocurrencia próxima sin completar en una ventana de 7 días; ambigua
  o inexistente → `null`, nunca se inventa un cumplimiento).
- **Plan por horas**: un OUT_OF_PLAN COMPLETO avanza `plan.lastGreaseHour`
  igual que cualquier registro más reciente (lógica YA existente, sin
  cambios) — `satisfiedOccurrenceKey` solo certifica cuál ciclo quedó
  satisfecho, nunca reinicia el ciclo si es PARTIAL.
- **Plan día/turno**: un OUT_OF_PLAN COMPLETO puede satisfacer por
  adelantado la ÚNICA ocurrencia futura sin completar en los próximos 7
  días — el plan maestro (`assignedDays`/`frequency`/etc.) **nunca se
  toca**. La Matriz Semanal (`estadoCelda()`) muestra esa celda como
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
