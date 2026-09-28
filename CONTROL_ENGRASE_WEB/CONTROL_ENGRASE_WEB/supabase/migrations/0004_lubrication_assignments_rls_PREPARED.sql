-- PREPARADA — NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA
--
-- Rediseño operativo (dispositivos + cuadrillas + ubicaciones + asignación
-- manual de engrases, ver docs/OPERATIONAL_SCOPE.md). Agrega el store nuevo
-- `lubrication_assignments` a la matriz de permisos que YA gobierna
-- `engrase_sync` (0002_auth_profiles_rls_PREPARED.sql) — las 3 policies de
-- SELECT/INSERT/UPDATE sobre engrase_sync son genéricas por `store`, así que
-- NO hace falta ninguna policy nueva: agregar estas filas a
-- app_store_permissions basta para que ese store quede cubierto por las
-- mismas reglas que el resto.
--
-- Qué hace este archivo — UNA sola cosa:
--   INSERT en app_store_permissions para store='lubrication_assignments',
--   un rol por fila (mismo patrón que 0002).
--
-- Criterio de la matriz para este store (coherente con
-- canManageAssignments()/canLubricadorExecuteEquipment() de
-- src/core/operational-scope.js):
--   ADMINISTRADOR: control total (igual que el resto de stores operativos).
--   PLANIFICADOR/SUPERVISOR: pueden crear/reasignar/cancelar asignaciones
--     (insert+update), igual que canManageAssignments(). Nunca delete duro
--     — cancelar es un cambio de `status`, nunca un borrado de fila.
--   LUBRICADOR: puede LEER (para ver "asignado a mi cuadrilla" en Mi Turno)
--     y ACTUALIZAR (para que completeGreaseAssignmentForOccurrence() pueda
--     marcar una asignación como COMPLETED al registrar el engrase — esa
--     función corre con la sesión del Lubricador que registra). Nunca
--     insert: un Lubricador nunca crea una asignación manual él mismo.
--   VISOR: solo lectura, igual que el resto de stores operativos que ve.
--
-- LIMITACIÓN CONOCIDA (documentada a propósito, no resuelta aquí):
--   engrase_sync es una tabla GENÉRICA (columnas store/payload jsonb) — RLS
--   filtra por `store` + rol, pero NO puede restringir, a nivel de base de
--   datos, que un Lubricador solo lea/actualice las filas de
--   lubrication_assignments de SU cuadrilla (p.ej. `payload->>'assignedCrewId'`
--   no se valida contra el dispositivo/cuadrilla del JWT: ese dato vive en
--   `push_tokens`, no en el JWT/app_profiles). La restricción real por
--   cuadrilla la impone classifyEquipmentWork()/resolveOperationalScope()
--   en el cliente (src/core/operational-scope.js), no la base de datos. Esto
--   es el MISMO nivel de seguridad que ya tiene cualquier otro store de
--   engrase_sync (p.ej. lubrication_records: un Lubricador puede técnicamente
--   leer/actualizar registros de otro equipo vía API directa) — no una
--   regresión nueva, pero tampoco hay que afirmar una garantía que esta
--   migración no da.
--
-- Rollback en 0004_lubrication_assignments_rls_ROLLBACK.sql (mismo directorio).

insert into app_store_permissions (store, role, can_read, can_insert, can_update, can_delete) values
  ('lubrication_assignments', 'ADMINISTRADOR', true,  true,  true,  true),
  ('lubrication_assignments', 'PLANIFICADOR',  true,  true,  true,  false),
  ('lubrication_assignments', 'SUPERVISOR',    true,  true,  true,  false),
  ('lubrication_assignments', 'LUBRICADOR',    true,  false, true,  false),
  ('lubrication_assignments', 'VISOR',         true,  false, false, false)
on conflict (store, role) do update set
  can_read = excluded.can_read, can_insert = excluded.can_insert,
  can_update = excluded.can_update, can_delete = excluded.can_delete;

-- FIN — un solo INSERT real. Todo lo de arriba es documentación.
