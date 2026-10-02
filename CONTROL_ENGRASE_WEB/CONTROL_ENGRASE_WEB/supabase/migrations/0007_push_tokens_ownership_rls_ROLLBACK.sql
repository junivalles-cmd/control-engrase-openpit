-- Rollback de 0007_push_tokens_ownership_rls_PREPARED.sql — restaura las 2
-- policies INSERT/UPDATE de engrase_sync a su forma EXACTA de
-- 0002_auth_profiles_rls_PREPARED.sql (sin la condición de ownership de
-- push_tokens). No toca ninguna otra tabla/policy/función.

drop policy if exists "engrase_sync: crear según matriz" on engrase_sync;
create policy "engrase_sync: crear según matriz"
  on engrase_sync for insert
  with check (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and p.can_insert
    )
  );

drop policy if exists "engrase_sync: actualizar según matriz" on engrase_sync;
create policy "engrase_sync: actualizar según matriz"
  on engrase_sync for update
  using (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and (p.can_update or p.can_delete)
    )
  )
  with check (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and (
          (engrase_sync.deleted and p.can_delete)
          or (not engrase_sync.deleted and p.can_update)
        )
    )
  );

-- FIN — 2 policies restauradas a su forma de 0002.
