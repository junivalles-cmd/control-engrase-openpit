-- PREPARED ONLY. Never run against production without a separately approved rollout.
-- Adds authenticated row-level scope to the generic engrase_sync transport.
-- Existing permissive app_store_permissions policies remain responsible for
-- store/operation grants; these RESTRICTIVE policies intersect those grants.
-- This does not apply 0003, use crew_locations, or change operational data.
-- It adds only the LUBRICADOR/equipment read bit required for scoped first pull.
-- Keep authorization_private outside the Supabase/PostgREST exposed schemas.
begin;

do $preconditions$
begin
  if to_regprocedure('public.resolve_authorization_scope(uuid)') is null
     or to_regprocedure('public.get_authorization_context()') is null then
    raise exception '0013 requires the 0012 authorization bootstrap';
  end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    where c.oid='public.engrase_sync'::regclass and c.relrowsecurity
      and not c.relforcerowsecurity
      and c.relowner=(select oid from pg_catalog.pg_roles where rolname=current_user)
  ) then raise exception 'Installer must own engrase_sync; RLS enabled and FORCE RLS disabled'; end if;
  if to_regclass('public.app_store_permissions') is null then
    raise exception '0013 requires app_store_permissions';
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname='public'
      and tablename='engrase_sync' and policyname='engrase_sync: leer según matriz') then
    raise exception '0013 requires the existing SELECT matrix policy';
  end if;
  if not exists (select 1 from public.app_store_permissions where store='equipment' and role='LUBRICADOR') then
    raise exception '0013 requires the existing LUBRICADOR/equipment matrix row';
  end if;
end
$preconditions$;

create schema if not exists authorization_private;
revoke all on schema authorization_private from public,anon;
grant usage on schema authorization_private to authenticated;

-- Stable row classifier. Missing/ambiguous relationships fail closed. It
-- evaluates the same PRE-0008 membership/location context as 0012 and never
-- trusts client-supplied scope ids as authority.
create or replace function authorization_private.authorization_row_in_scope(
  p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $row_scope$
declare
  result jsonb;
  ctx jsonb;
  app_user text;
  crews jsonb;
  locations jsonb;
  crew_id text;
  location_id text;
  equipment_id text;
  record_id text;
  linked_payload jsonb;
  is_global boolean;
  own_row boolean;
begin
  if auth.uid() is null or p_store is null or p_id is null or p_payload is null then return false; end if;
  result := p_context;
  if result->>'status' is distinct from 'AUTHORIZED' then return false; end if;
  ctx := result->'context';
  if ctx->>'authUserId' is distinct from auth.uid()::text then return false; end if;
  app_user := ctx->>'appUserId';
  crews := coalesce(ctx->'authorizedCrewIds','[]'::jsonb);
  locations := coalesce(ctx->'authorizedLocationIds','[]'::jsonb);
  is_global := ctx->>'scopeType'='GLOBAL';

  -- Device registrations are strictly account-owned, including for Admin.
  if p_store='push_tokens' then
    return p_payload->>'userId'=app_user and p_payload->>'id'=p_id;
  elsif p_store='audit_log' and p_action in ('INSERT','UPDATE') then
    return p_payload->>'authUserId'=auth.uid()::text
      and (p_payload->>'appUserId' is null or p_payload->>'appUserId'=app_user);
  elsif p_store='users' then
    -- Treat this legacy account store as personal even for global operational
    -- roles. Admin user administration uses app_profiles/Auth, not this cache.
    own_row := p_id=app_user or p_payload->>'appUserId'=app_user
      or p_payload->>'authUserId'=auth.uid()::text;
    return own_row;
  end if;

  -- Global roles receive all rows admitted by the existing store matrix.
  if is_global then return true; end if;

  -- Shared reference data with no per-crew ownership. The ordinary matrix
  -- policy still decides whether this role may read the store at all.
  if p_store in ('shifts','equipment_types','lubricants') then return true; end if;

  if p_store='cuadrillas' then
    return crews ? p_id;
  elsif p_store='locations' then
    return locations ? p_id;
  elsif p_store='equipment' then
    return locations ? (p_payload->>'locationId');
  elsif p_store in ('lubrication_plans','lubrication_points') then
    equipment_id := p_payload->>'equipmentId';
    if equipment_id is null then return false; end if;
    select e.payload->>'locationId' into location_id from public.engrase_sync e
      where e.store='equipment' and e.id=equipment_id and not e.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store in ('lubrication_records','lubrication_skips','anomalies') then
    equipment_id := p_payload->>'equipmentId';
    location_id := coalesce(p_payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
      p_payload->'operationalSnapshot'->>'executionLocationId',p_payload->>'locationId');
    crew_id := coalesce(p_payload->'operationalSnapshot'->>'crewId',p_payload->>'crewId',p_payload->>'cuadrillaId');
    if location_id is null and equipment_id is not null then
      select e.payload->>'locationId' into location_id from public.engrase_sync e
        where e.store='equipment' and e.id=equipment_id and not e.deleted;
    end if;
    if location_id is not null and not (locations ? location_id) then return false; end if;
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    -- A row must carry at least one verifiable scope link; unlinked legacy
    -- rows are not leaked into a crew-scoped first pull.
    return location_id is not null or crew_id is not null;
  elsif p_store='lubrication_assignments' then
    equipment_id := p_payload->>'equipmentId';
    crew_id := p_payload->>'assignedCrewId';
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    if equipment_id is null then return false; end if;
    select e.payload->>'locationId' into location_id from public.engrase_sync e
      where e.store='equipment' and e.id=equipment_id and not e.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store='grease_validations' then
    record_id := coalesce(p_payload->>'lubricationRecordId',p_payload->>'recordId');
    if record_id is null then return false; end if;
    select r.payload into linked_payload from public.engrase_sync r
      where r.store='lubrication_records' and r.id=record_id and not r.deleted;
    if linked_payload is null then return false; end if;
    equipment_id := linked_payload->>'equipmentId';
    location_id := coalesce(linked_payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
      linked_payload->'operationalSnapshot'->>'executionLocationId',linked_payload->>'locationId');
    crew_id := coalesce(linked_payload->'operationalSnapshot'->>'crewId',linked_payload->>'crewId',linked_payload->>'cuadrillaId');
    if location_id is null and equipment_id is not null then
      select e.payload->>'locationId' into location_id from public.engrase_sync e
        where e.store='equipment' and e.id=equipment_id and not e.deleted;
    end if;
    if location_id is not null and not (locations ? location_id) then return false; end if;
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    return location_id is not null or crew_id is not null;
  end if;

  -- Unknown stores fail closed for crew-scoped accounts.
  return false;
end
$row_scope$;

revoke all on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) from public,anon;
grant execute on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) to authenticated;

drop policy if exists authorization_scope_select on public.engrase_sync;
create policy authorization_scope_select on public.engrase_sync as restrictive
  for select to authenticated using (
    authorization_private.authorization_row_in_scope(store,id,payload,'SELECT',
      (select public.get_authorization_context()))
  );
drop policy if exists authorization_scope_insert on public.engrase_sync;
create policy authorization_scope_insert on public.engrase_sync as restrictive
  for insert to authenticated with check (
    authorization_private.authorization_row_in_scope(store,id,payload,'INSERT',
      (select public.get_authorization_context()))
  );
drop policy if exists authorization_scope_update on public.engrase_sync;
create policy authorization_scope_update on public.engrase_sync as restrictive
  for update to authenticated
  using (authorization_private.authorization_row_in_scope(store,id,payload,'UPDATE',
    (select public.get_authorization_context())))
  with check (authorization_private.authorization_row_in_scope(store,id,payload,'UPDATE',
    (select public.get_authorization_context())));
drop policy if exists authorization_scope_delete on public.engrase_sync;
create policy authorization_scope_delete on public.engrase_sync as restrictive
  for delete to authenticated using (
    authorization_private.authorization_row_in_scope(store,id,payload,'DELETE',
      (select public.get_authorization_context()))
  );

-- The existing matrix denied LUBRICADOR equipment reads entirely, which
-- makes scoped Mi Turno/QR first-pull impossible. This adds only SELECT;
-- the restrictive row policy above limits it to authorized locations.
update public.app_store_permissions set can_read=true
  where store='equipment' and role='LUBRICADOR';

-- Set the readiness bit only in the same transaction as the restrictive
-- policies. If any statement fails, both the policies and this bit roll back.
create or replace function public.get_authorization_context()
returns jsonb language sql stable security definer set search_path=pg_catalog as $bootstrap$
  select case when c->>'status'='AUTHORIZED'
    then jsonb_set(c,'{context,rowScopeEnforced}','true'::jsonb,false)
    else c end
  from (select public.resolve_authorization_scope(auth.uid()) as c) s;
$bootstrap$;
revoke all on function public.get_authorization_context() from public,anon;
grant execute on function public.get_authorization_context() to authenticated;
comment on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) is
  'Non-API PRE-0008 row classifier used by restrictive engrase_sync policies; global roles remain bounded by app_store_permissions; scoped users are limited to legacy crew/location scope.';
commit;
