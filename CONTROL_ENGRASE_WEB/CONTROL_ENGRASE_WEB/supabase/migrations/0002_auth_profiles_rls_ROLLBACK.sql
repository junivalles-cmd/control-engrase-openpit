-- ROLLBACK de 0002_auth_profiles_rls_PREPARED.sql
--
-- Revierte SOLO lo que esa migración crea. NO toca:
--   - datos de engrase_sync (ninguna fila, ningún store)
--   - users, lubrication_records, grease_validations (son solo stores
--     dentro de engrase_sync, ni siquiera se mencionan aquí)
--   - Storage (bucket engrase-photos, sus policies)
--   - auth.users
--   - la policy legacy "acceso interno con anon key" (no se toca en
--     absoluto, sigue siendo la única autoridad real)
--
-- Seguro de ejecutar aunque 0002 nunca se haya aplicado (todo IF EXISTS).
-- No contiene secretos.

begin;

drop policy if exists "engrase_sync: actualizar según matriz" on engrase_sync;
drop policy if exists "engrase_sync: crear según matriz" on engrase_sync;
drop policy if exists "engrase_sync: leer según matriz" on engrase_sync;

drop policy if exists "app_store_permissions: lectura autenticada" on app_store_permissions;
drop table if exists app_store_permissions;

drop policy if exists "app_profiles: admin edita otros" on app_profiles;
drop policy if exists "app_profiles: admin crea perfiles" on app_profiles;
drop policy if exists "app_profiles: admin lee todos" on app_profiles;
drop policy if exists "app_profiles: leer el propio perfil" on app_profiles;

drop function if exists current_app_active();
drop function if exists current_app_role();

drop table if exists app_profiles;

commit;
