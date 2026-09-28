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
  asignación), Horómetros, Reportes, Historial, `renderTurno` (vista de
  escritorio del turno, filtra por `shiftId` legacy), Usuarios, exports.
  Ninguna de ellas queda rota — siguen leyendo `equipment.locationId` real
  (que `moverEquipoDeUbicacion()` sí mantiene correcto) — pero no muestran
  todavía el badge de "asignado" ni el link a la asignación activa.
- Notificaciones push/OS reales para crear/reasignar/cancelar una
  asignación: el aviso "persistente" implementado es el badge en Mi Turno
  mientras la asignación siga `PENDING` (desaparece sola al completarse/
  cancelarse), no un push al estilo OneSignal.
- Historial (`lubrication_records`) no guarda todavía un snapshot explícito
  de `{locationId, crewId, assignmentId}` al momento del registro — el campo
  `planId` que ya guarda permite reconstruir la mayoría de los casos, pero
  no es un snapshot completo. Señalado para un lote futuro, nunca
  reconstruido retroactivamente.
