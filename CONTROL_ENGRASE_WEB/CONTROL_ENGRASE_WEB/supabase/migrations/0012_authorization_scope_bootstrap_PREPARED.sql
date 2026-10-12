-- PREPARED ONLY. Do not run this file against production.
-- Phase 2D-1 only: pre-0008 scope resolution and minimal Auth bootstrap.
-- This does NOT install row policies, change app_store_permissions, remove
-- the legacy policy, or grant access to crew_locations.
--
-- Real data model used here:
--   app_profiles(auth_user_id, app_user_id, display_name, role, active)
--   engrase_sync(store='cuadrillas', id, payload, deleted)
--   cuadrillas payload.memberUserIds = app_user_id array
--   cuadrillas payload.locationId = legacy location id
--   engrase_sync store='locations' contains active location ids
--
-- SECURITY DEFINER is required because membership rows are in the generic
-- engrase_sync table; this function returns identifiers only, never payloads.
begin;

do $precondition$
begin
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_roles r on r.oid=c.relowner
    where c.oid='public.engrase_sync'::regclass and r.rolname=current_user and not c.relforcerowsecurity
  ) then raise exception 'Installer must own engrase_sync and FORCE ROW LEVEL SECURITY must be disabled'; end if;
  if not exists (
    select 1 from pg_catalog.pg_class c
    join pg_catalog.pg_roles r on r.oid=c.relowner
    where c.oid='public.app_profiles'::regclass and r.rolname=current_user and not c.relforcerowsecurity
  ) then raise exception 'Installer must own app_profiles and FORCE ROW LEVEL SECURITY must be disabled'; end if;
end
$precondition$;

create or replace function public.resolve_authorization_scope(p_auth_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $scope$
declare
  profile public.app_profiles%rowtype;
  crew_ids text[] := array[]::text[];
  location_ids text[] := array[]::text[];
  bad_crew boolean := false;
  scope_kind text := 'DENIED';
  fingerprint text;
begin
  if p_auth_user_id is null then
    return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED');
  end if;

  select * into profile from public.app_profiles where auth_user_id=p_auth_user_id;
  if not found then return jsonb_build_object('status','DENIED','code','PROFILE_NOT_FOUND'); end if;
  if profile.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if profile.role is null or profile.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED');
  end if;

  if profile.role in ('ADMINISTRADOR','PLANIFICADOR') then
    scope_kind := 'GLOBAL';
    select coalesce(array_agg(x.id order by x.id),array[]::text[])
      into crew_ids from (
        select distinct s.id from public.engrase_sync s
        where s.store='cuadrillas' and not s.deleted
          and coalesce(s.payload->>'active','true')='true'
      ) x;
    select coalesce(array_agg(x.id order by x.id),array[]::text[])
      into location_ids from (
        select distinct s.id from public.engrase_sync s
        where s.store='locations' and not s.deleted
          and coalesce(s.payload->>'active','true')='true'
      ) x;
  else
    select coalesce(bool_or(nullif(btrim(s.payload->>'locationId'),'') is null
      or not exists (select 1 from public.engrase_sync l
        where l.store='locations' and l.id=s.payload->>'locationId' and not l.deleted
          and coalesce(l.payload->>'active','true')='true')),false)
      into bad_crew
    from public.engrase_sync s
    where s.store='cuadrillas' and not s.deleted
      and coalesce(s.payload->>'active','true')='true'
      and jsonb_typeof(s.payload->'memberUserIds')='array'
      and s.payload->'memberUserIds' ? profile.app_user_id;

    if bad_crew then return jsonb_build_object('status','DENIED','code','AMBIGUOUS_CREW_SCOPE'); end if;

    select coalesce(array_agg(x.id order by x.id),array[]::text[]),
           coalesce(array_agg(distinct x.location_id order by x.location_id),array[]::text[])
      into crew_ids,location_ids
    from (
      select s.id, s.payload->>'locationId' as location_id
      from public.engrase_sync s
      where s.store='cuadrillas' and not s.deleted
        and coalesce(s.payload->>'active','true')='true'
        and jsonb_typeof(s.payload->'memberUserIds')='array'
        and s.payload->'memberUserIds' ? profile.app_user_id
        and exists (select 1 from public.engrase_sync l
          where l.store='locations' and l.id=s.payload->>'locationId' and not l.deleted
            and coalesce(l.payload->>'active','true')='true')
    ) x;
    if cardinality(crew_ids)=0 or cardinality(location_ids)=0 then
      return jsonb_build_object('status','DENIED','code','NO_VALID_CREW_MEMBERSHIP');
    end if;
    scope_kind := 'CREW_SCOPED';
  end if;

  fingerprint := md5(jsonb_build_object(
    'authUserId',profile.auth_user_id,
    'appUserId',profile.app_user_id,
    'role',profile.role,
    'active',profile.active,
    'scopeType',scope_kind,
    'authorizedCrewIds',to_jsonb(crew_ids),
    'authorizedLocationIds',to_jsonb(location_ids)
  )::text);

  return jsonb_build_object(
    'status','AUTHORIZED',
    'context',jsonb_build_object(
      'authUserId',profile.auth_user_id,
      'appUserId',profile.app_user_id,
      'displayName',profile.display_name,
      'role',profile.role,
      'active',profile.active,
      'scopeType',scope_kind,
      'authorizedCrewIds',to_jsonb(crew_ids),
      'authorizedLocationIds',to_jsonb(location_ids),
      'authorizationFingerprint',fingerprint,
      'rowScopeEnforced',false
    )
  );
end
$scope$;

revoke all on function public.resolve_authorization_scope(uuid) from public,anon,authenticated;

create or replace function public.get_authorization_context()
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog
as $bootstrap$
  select public.resolve_authorization_scope(auth.uid());
$bootstrap$;

revoke all on function public.get_authorization_context() from public,anon;
grant execute on function public.get_authorization_context() to authenticated;

comment on function public.resolve_authorization_scope(uuid) is
  'Internal PRE-0008 scope resolver. Not executable by API roles; membership from cuadrillas.memberUserIds and legacy locationId only.';
comment on function public.get_authorization_context() is
  'Authenticated minimal bootstrap. Returns active profile identity, scope ids, and deterministic fingerprint; no operational rows.';

commit;
