-- PREPARED ONLY — never execute without explicit authorization.
-- Apply only after the compatible client is deployed and the 0003 legacy
-- anon policy has been removed. This migration does not change data,
-- app_store_permissions, or any other store's authorization.
--
-- Push tokens are self-service rows. Every authenticated role may manage
-- only rows whose app_user_id matches its active Auth profile. There is no
-- Admin override and no hard-delete policy. Logout is an owner UPDATE to
-- active=false, which remains queueable offline without can_delete.
-- Historical rows without userId are intentionally inaccessible until
-- manually reconciled; no owner is inferred or assigned.

drop policy if exists "engrase_sync: crear según matriz" on engrase_sync;
create policy "engrase_sync: crear según matriz"
  on engrase_sync for insert
  with check (
    current_app_active()
    and exists (select 1 from app_store_permissions p
      where p.store=engrase_sync.store and p.role=current_app_role() and p.can_insert)
    and (engrase_sync.store <> 'push_tokens' or (
      not engrase_sync.deleted
      and engrase_sync.payload->>'id'=engrase_sync.id
      and engrase_sync.payload->>'userId'=(select app_user_id from app_profiles
        where auth_user_id=auth.uid() and active=true)
    ))
  );

drop policy if exists "engrase_sync: actualizar según matriz" on engrase_sync;
create policy "engrase_sync: actualizar según matriz"
  on engrase_sync for update
  using (
    current_app_active()
    and exists (select 1 from app_store_permissions p
      where p.store=engrase_sync.store and p.role=current_app_role()
        and (p.can_update or p.can_delete))
    and (engrase_sync.store <> 'push_tokens' or engrase_sync.payload->>'userId'=(
      select app_user_id from app_profiles where auth_user_id=auth.uid() and active=true))
  )
  with check (
    current_app_active()
    and exists (select 1 from app_store_permissions p
      where p.store=engrase_sync.store and p.role=current_app_role()
        and ((engrase_sync.deleted and p.can_delete) or (not engrase_sync.deleted and p.can_update)))
    and (engrase_sync.store <> 'push_tokens' or (
      not engrase_sync.deleted
      and engrase_sync.payload->>'id'=engrase_sync.id
      and engrase_sync.payload->>'userId'=(select app_user_id from app_profiles
        where auth_user_id=auth.uid() and active=true)
    ))
  );

-- Intersects the ordinary permissive SELECT matrix policy. It restricts
-- token rows to their owner while leaving other stores unchanged.
drop policy if exists push_tokens_select_owner_only on engrase_sync;
create policy push_tokens_select_owner_only
  on engrase_sync as restrictive for select to authenticated
  using (store <> 'push_tokens' or (current_app_active() and payload->>'userId'=(
    select app_user_id from app_profiles where auth_user_id=auth.uid() and active=true)));

-- Restrictive guards prevent a parallel permissive policy from reopening
-- ownership or hard-delete access (PERMISSIVE policies combine with OR).
drop policy if exists push_tokens_insert_owner_only on engrase_sync;
create policy push_tokens_insert_owner_only
  on engrase_sync as restrictive for insert to authenticated
  with check (store <> 'push_tokens' or (current_app_active() and not deleted
    and payload->>'id'=id and payload->>'userId'=(select app_user_id from app_profiles
      where auth_user_id=auth.uid() and active=true)));
drop policy if exists push_tokens_update_owner_only on engrase_sync;
create policy push_tokens_update_owner_only
  on engrase_sync as restrictive for update to authenticated
  using (store <> 'push_tokens' or (current_app_active() and not deleted and payload->>'userId'=(
    select app_user_id from app_profiles where auth_user_id=auth.uid() and active=true)))
  with check (store <> 'push_tokens' or (current_app_active() and not deleted
    and payload->>'id'=id and payload->>'userId'=(select app_user_id from app_profiles
      where auth_user_id=auth.uid() and active=true)));
drop policy if exists push_tokens_no_hard_delete on engrase_sync;
create policy push_tokens_no_hard_delete
  on engrase_sync as restrictive for delete to authenticated
  using (store <> 'push_tokens');

-- The only DELETE policy is restrictive and always denies push_tokens.
-- Deactivation remains a soft owner UPDATE.
