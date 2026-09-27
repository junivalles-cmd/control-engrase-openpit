-- ROLLBACK de 0003_auth_rls_CUTOVER_PREPARED.sql — DO NOT APPLY UNLESS
-- EL CUTOVER YA SE EJECUTÓ Y HAY QUE REVERTIRLO.
--
-- Restaura ÚNICAMENTE la policy legacy "acceso interno con anon key" de
-- engrase_sync, EXACTAMENTE como está definida en schema.sql. No toca:
--   - datos de engrase_sync, app_profiles ni ninguna otra tabla;
--   - Auth users (auth.users);
--   - app_profiles ni app_store_permissions (siguen intactas, con las 3
--     policies de 0002 sin cambios — este rollback no las retira, solo
--     vuelve a permitir el acceso anon EN PARALELO, mismo estado que
--     pre-cutover);
--   - Storage (bucket engrase-photos, fuera de alcance).
--
-- Efecto: vuelve exactamente al estado "PRE-CUTOVER" descrito en
-- 0002_auth_profiles_rls_PREPARED.sql — anon key vuelve a alcanzar para
-- leer/escribir engrase_sync, coexistiendo con las policies authenticated
-- (que siguen existiendo pero vuelven a ser inertes en términos de
-- seguridad efectiva, por el mismo motivo de OR entre policies permisivas
-- documentado en 0003_..._PREPARED.sql).

drop policy if exists "acceso interno con anon key" on engrase_sync;
create policy "acceso interno con anon key"
  on engrase_sync
  for all
  using (true)
  with check (true);

-- FIN.
