-- ROLLBACK de 0005_storage_privacy_PREPARED.sql
--
-- Revierte SOLO lo que esa migración crea/cambia. NO toca:
--   - ningún objeto real de Storage (no borra, no mueve nada)
--   - engrase_sync, app_profiles, app_store_permissions (ajenos a este
--     archivo)
--   - current_app_active()/current_app_role() (viven en
--     0002_auth_profiles_rls_PREPARED.sql, no se tocan aquí)
--
-- Restaura el bucket `engrase-photos` a público y las 3 policies
-- originales exactas (ver docs/AUTH_RLS_MIGRATION_DESIGN.md §10) —
-- vuelve al estado de producción anterior a 0005, sin pérdida de datos.
--
-- Seguro de ejecutar aunque 0005 nunca se haya aplicado (todo IF EXISTS).
-- No contiene secretos.

begin;

drop policy if exists "engrase-photos: actualizar autenticado activo" on storage.objects;
drop policy if exists "engrase-photos: subir/actualizar autenticado activo" on storage.objects;
drop policy if exists "engrase-photos: leer autenticado activo" on storage.objects;

create policy "engrase-photos lectura publica" on storage.objects
  for select using (bucket_id = 'engrase-photos');

create policy "engrase-photos subir con anon key" on storage.objects
  for insert with check (bucket_id = 'engrase-photos');

create policy "engrase-photos actualizar con anon key" on storage.objects
  for update using (bucket_id = 'engrase-photos');

update storage.buckets set public = true where id = 'engrase-photos';

commit;
