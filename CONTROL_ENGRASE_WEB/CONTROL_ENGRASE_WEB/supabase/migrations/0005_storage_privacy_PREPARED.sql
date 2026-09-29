-- DO NOT APPLY WITHOUT EXPLICIT AUTHORIZATION
--
-- P0-3 — preparación de Storage privado/autenticado (bucket
-- `engrase-photos`). Preparado y revisado, NUNCA ejecutado por Claude
-- contra producción. Requiere autorización explícita y específica del
-- usuario, en el momento, y solo DESPUÉS de que el cutover de Auth/RLS
-- (0003_auth_rls_CUTOVER_PREPARED.sql) ya esté aplicado — mientras
-- AUTH_MODE siga en 'legacy' o no exista ninguna cuenta Auth real más allá
-- de la actual, aplicar esto dejaría a TODO el personal sin poder ver ni
-- subir fotos/firmas (ver docs/STORAGE_PRIVACY_DESIGN.md).
--
-- Qué hace este archivo:
--   1) Bucket `engrase-photos` pasa de público a privado (public = false).
--      NO borra ni mueve ningún objeto — los archivos existentes quedan
--      exactamente donde están, con el mismo path.
--   2) Elimina las 3 policies públicas/anon-key originales (ver
--      docs/AUTH_RLS_MIGRATION_DESIGN.md §10 para el SQL original que las
--      creó): lectura pública sin restricción, subida/actualización con
--      anon key (que en la práctica es pública también, la anon key está
--      en el bundle del cliente).
--   3) Crea 2 policies nuevas (SELECT y, por separado, INSERT/UPDATE),
--      basadas en `current_app_active()` (misma función SECURITY DEFINER
--      de 0002_auth_profiles_rls_PREPARED.sql — no se duplica lógica):
--      cualquier persona con una cuenta Auth real Y un `app_profile` activo
--      puede leer y subir evidencia. Esto es intencionalmente SIN
--      granularidad por rol ni por store — ver "Limitaciones" abajo.
--
-- Por qué SIN granularidad por rol (a propósito, no es un descuido):
--   El modelo de permisos por store (`app_store_permissions`, ver 0002)
--   fue diseñado para filas de `engrase_sync`, no para objetos de Storage.
--   El mismo bucket también guarda fotos que NO son evidencia operativa
--   (miniaturas de puntos de checklist en `lubrication_plans/...`,
--   diagramas de ayuda de familia de equipo dentro de `settings/...`) —
--   replicar `app_store_permissions` tal cual por prefijo de path
--   bloquearía esas pantallas para roles que hoy SÍ las ven (ej. VISOR no
--   tiene can_read en `settings`, pero cualquier usuario puede abrir "Ayuda
--   y soporte"). Diseñar esa granularidad bien requeriría auditar TODOS los
--   prefijos de path que usa el bucket primero — fuera de alcance de este
--   lote (ver docs/STORAGE_PRIVACY_DESIGN.md §Limitaciones). Hoy el acceso
--   a Storage no tiene NINGUNA distinción por rol (es público) — pasar a
--   "cualquier usuario autenticado activo" ya es una mejora real de
--   privacidad sin inventar una granularidad que el cliente no aplica en
--   ningún lado todavía.
--
-- Qué NO hace este archivo (a propósito, fuera de alcance):
--   - No borra ni mueve ningún objeto existente.
--   - No migra registros de engrase_sync (siguen con la URL pública
--     completa guardada tal cual — ver resolvePhotoStoragePath() en
--     sync.js, que la sigue entendiendo sin cambios).
--   - No agrega policies DELETE (la app nunca borra fotos/firmas de
--     Storage, solo sube — un borrado lógico del registro no borra el
--     archivo).
--   - No distingue por rol ni por store (ver arriba).
--
-- Rollback preparado en 0005_storage_privacy_ROLLBACK.sql (mismo
-- directorio) — restaura el bucket a público y las 3 policies originales,
-- sin tocar ningún objeto.

begin;

update storage.buckets set public = false where id = 'engrase-photos';

drop policy if exists "engrase-photos lectura publica" on storage.objects;
drop policy if exists "engrase-photos subir con anon key" on storage.objects;
drop policy if exists "engrase-photos actualizar con anon key" on storage.objects;

create policy "engrase-photos: leer autenticado activo"
  on storage.objects for select
  using (bucket_id = 'engrase-photos' and current_app_active());

create policy "engrase-photos: subir/actualizar autenticado activo"
  on storage.objects for insert
  with check (bucket_id = 'engrase-photos' and current_app_active());

create policy "engrase-photos: actualizar autenticado activo"
  on storage.objects for update
  using (bucket_id = 'engrase-photos' and current_app_active())
  with check (bucket_id = 'engrase-photos' and current_app_active());

commit;

-- FIN.
