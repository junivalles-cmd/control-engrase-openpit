-- PREPARADA — NO EJECUTAR SIN AUTORIZACIÓN EXPLÍCITA
--
-- Lote occurrences/carryover, §1 ("No se pudo ejecutar" con motivo +
-- observación, ver src/core/operational-scope.js). Agrega el store nuevo
-- `lubrication_skips` a la matriz de permisos que YA gobierna `engrase_sync`
-- (0002_auth_profiles_rls_PREPARED.sql) — las 3 policies de SELECT/INSERT/
-- UPDATE sobre engrase_sync son genéricas por `store`, así que NO hace
-- falta ninguna policy nueva: agregar estas filas a app_store_permissions
-- basta para que ese store quede cubierto por las mismas reglas que el resto.
--
-- Qué hace este archivo — UNA sola cosa:
--   INSERT en app_store_permissions para store='lubrication_skips',
--   un rol por fila (mismo patrón que 0004).
--
-- Criterio de la matriz para este store (MISMO que lubrication_records,
-- ver 0002): un "no se pudo ejecutar" es un registro de auditoría de
-- turno, no una asignación que se reasigna — nunca delete duro para nadie,
-- ni siquiera ADMINISTRADOR (a diferencia de lubrication_assignments, que
-- sí permite delete a ADMINISTRADOR).
--   ADMINISTRADOR: read+insert+update, sin delete (igual que
--     lubrication_records: corregir un dato mal tecleado se hace con otra
--     fila, no borrando la evidencia de que un turno reportó un motivo).
--   PLANIFICADOR/SUPERVISOR: read+insert+update — pueden registrar un "no
--     se pudo ejecutar" en nombre de una cuadrilla (igual que ya pueden
--     hacer con engrases retroactivos) y revisar/corregir observaciones.
--   LUBRICADOR: read+insert+update — mismo criterio que
--     lubrication_records (puede crear el suyo y corregirlo si se
--     equivocó de motivo antes de que termine el turno).
--   VISOR: solo lectura.
--
-- Rollback en 0005_lubrication_skips_rls_ROLLBACK.sql (mismo directorio).

insert into app_store_permissions (store, role, can_read, can_insert, can_update, can_delete) values
  ('lubrication_skips', 'ADMINISTRADOR', true,  true,  true,  false),
  ('lubrication_skips', 'PLANIFICADOR',  true,  true,  true,  false),
  ('lubrication_skips', 'SUPERVISOR',    true,  true,  true,  false),
  ('lubrication_skips', 'LUBRICADOR',    true,  true,  true,  false),
  ('lubrication_skips', 'VISOR',         true,  false, false, false)
on conflict (store, role) do update set
  can_read = excluded.can_read, can_insert = excluded.can_insert,
  can_update = excluded.can_update, can_delete = excluded.can_delete;

-- FIN — un solo INSERT real. Todo lo de arriba es documentación.
