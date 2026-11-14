-- PLANIFICADOR multiubicación + nombre de acceso editable sin cambiar
-- app_user_id (identidad estable usada por históricos, cuadrillas y auditoría).
begin;

alter table public.app_profiles add column if not exists username text;
alter table public.app_profiles add column if not exists location_ids text[];

update public.app_profiles
set username=lower(regexp_replace(app_user_id,'^u_',''))
where nullif(btrim(username),'') is null;

update public.app_profiles
set location_ids=case
  when role='PLANIFICADOR' and nullif(btrim(location_id),'') is not null then array[location_id]
  else array[]::text[]
end
where location_ids is null;

alter table public.app_profiles alter column username set not null;
alter table public.app_profiles alter column location_ids set default array[]::text[];
alter table public.app_profiles alter column location_ids set not null;

create unique index if not exists app_profiles_username_lower_uidx
  on public.app_profiles(lower(username));
create index if not exists app_profiles_location_ids_gin_idx
  on public.app_profiles using gin(location_ids);

alter table public.app_profiles drop constraint if exists app_profiles_planner_locations_required;
alter table public.app_profiles add constraint app_profiles_planner_locations_required
  check (
    role <> 'PLANIFICADOR' or (
      cardinality(location_ids) > 0
      and array_position(location_ids,null) is null
      and location_id = location_ids[1]
    )
  ) not valid;

do $validate_if_clean$
begin
  if not exists (
    select 1 from public.app_profiles
    where role='PLANIFICADOR' and (
      cardinality(location_ids)=0 or location_id is distinct from location_ids[1]
    )
  ) then
    alter table public.app_profiles validate constraint app_profiles_planner_locations_required;
  end if;
end
$validate_if_clean$;

create or replace function public.resolve_authorization_scope_location_required_20261104(p_auth_user_id uuid)
returns jsonb
language plpgsql stable security definer set search_path=pg_catalog
as $scope$
declare
  profile public.app_profiles%rowtype;
  crew_ids text[] := array[]::text[];
  location_ids text[] := array[]::text[];
  bad_crew boolean := false;
  scope_kind text := 'DENIED';
  fingerprint text;
begin
  if p_auth_user_id is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into profile from public.app_profiles where auth_user_id=p_auth_user_id;
  if not found then return jsonb_build_object('status','DENIED','code','PROFILE_NOT_FOUND'); end if;
  if profile.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if profile.role is null or profile.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED');
  end if;

  if profile.role='ADMINISTRADOR' then
    scope_kind := 'GLOBAL';
    select coalesce(array_agg(x.id order by x.id),array[]::text[]) into crew_ids
    from (select distinct s.id from public.engrase_sync s where s.store='cuadrillas' and not s.deleted
      and coalesce(s.payload->>'active','true')='true') x;
    select coalesce(array_agg(x.id order by x.id),array[]::text[]) into location_ids
    from (select distinct s.id from public.engrase_sync s where s.store='locations' and not s.deleted
      and coalesce(s.payload->>'active','true')='true') x;
  elsif profile.role='PLANIFICADOR' then
    location_ids := coalesce(profile.location_ids,array[]::text[]);
    if cardinality(location_ids)=0 then
      return jsonb_build_object('status','DENIED','code','PLANNER_LOCATION_REQUIRED');
    end if;
    if exists (
      select 1 from unnest(location_ids) assigned(id)
      where not exists (select 1 from public.engrase_sync l where l.store='locations'
        and l.id=assigned.id and not l.deleted and coalesce(l.payload->>'active','true')='true')
    ) then
      return jsonb_build_object('status','DENIED','code','PLANNER_LOCATION_INVALID');
    end if;
    scope_kind := 'LOCATION_SCOPED';
    select coalesce(array_agg(s.id order by s.id),array[]::text[]) into crew_ids
    from public.engrase_sync s where s.store='cuadrillas' and not s.deleted
      and coalesce(s.payload->>'active','true')='true' and (s.payload->>'locationId')=any(location_ids);
  else
    select coalesce(bool_or(nullif(btrim(s.payload->>'locationId'),'') is null
      or not exists (select 1 from public.engrase_sync l where l.store='locations'
        and l.id=s.payload->>'locationId' and not l.deleted and coalesce(l.payload->>'active','true')='true')),false)
    into bad_crew from public.engrase_sync s where s.store='cuadrillas' and not s.deleted
      and coalesce(s.payload->>'active','true')='true'
      and jsonb_typeof(s.payload->'memberUserIds')='array' and s.payload->'memberUserIds' ? profile.app_user_id;
    if bad_crew then return jsonb_build_object('status','DENIED','code','AMBIGUOUS_CREW_SCOPE'); end if;
    select coalesce(array_agg(x.id order by x.id),array[]::text[]),
           coalesce(array_agg(distinct x.location_id order by x.location_id),array[]::text[])
    into crew_ids,location_ids from (
      select s.id,s.payload->>'locationId' location_id from public.engrase_sync s
      where s.store='cuadrillas' and not s.deleted and coalesce(s.payload->>'active','true')='true'
        and jsonb_typeof(s.payload->'memberUserIds')='array' and s.payload->'memberUserIds' ? profile.app_user_id
        and exists (select 1 from public.engrase_sync l where l.store='locations'
          and l.id=s.payload->>'locationId' and not l.deleted and coalesce(l.payload->>'active','true')='true')
    ) x;
    if cardinality(crew_ids)=0 or cardinality(location_ids)=0 then
      return jsonb_build_object('status','DENIED','code','NO_VALID_CREW_MEMBERSHIP');
    end if;
    scope_kind := 'CREW_SCOPED';
  end if;

  fingerprint := md5(jsonb_build_object('authUserId',profile.auth_user_id,'appUserId',profile.app_user_id,
    'role',profile.role,'active',profile.active,'locationId',location_ids[1],'locationIds',to_jsonb(location_ids),
    'scopeType',scope_kind,'authorizedCrewIds',to_jsonb(crew_ids),'authorizedLocationIds',to_jsonb(location_ids))::text);
  return jsonb_build_object('status','AUTHORIZED','context',jsonb_build_object(
    'authUserId',profile.auth_user_id,'appUserId',profile.app_user_id,'displayName',profile.display_name,
    'username',profile.username,'role',profile.role,'active',profile.active,
    'locationId',location_ids[1],'locationIds',to_jsonb(location_ids),'scopeType',scope_kind,
    'authorizedCrewIds',to_jsonb(crew_ids),'authorizedLocationIds',to_jsonb(location_ids),
    'authorizationFingerprint',fingerprint,'rowScopeEnforced',false));
end
$scope$;

revoke all on function public.resolve_authorization_scope_location_required_20261104(uuid)
  from public,anon,authenticated;

create or replace function authorization_private.planner_payload_in_scope(p_store text,p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $planner_row$
declare assigned_locations text[]; location_id text; equipment_id text; record_id text;
begin
  select p.location_ids into assigned_locations from public.app_profiles p
    where p.auth_user_id=auth.uid() and p.active=true and p.role='PLANIFICADOR';
  if not found then return true; end if;
  if cardinality(coalesce(assigned_locations,array[]::text[]))=0 then return false; end if;
  if p_store in ('shifts','equipment_types','lubricants','settings','broadcast_messages','broadcast_message_reads') then return true; end if;
  if p_store='push_tokens' then return p_payload->>'userId'=(select app_user_id from public.app_profiles where auth_user_id=auth.uid()); end if;
  if p_store='audit_log' then return p_payload->>'actorAuthUserId'=auth.uid()::text or p_payload->>'authUserId'=auth.uid()::text; end if;
  if p_store='locations' then return (p_payload->>'id')=any(assigned_locations); end if;
  if p_store='cuadrillas' then return (p_payload->>'locationId')=any(assigned_locations); end if;
  if p_store='crew_locations' then
    select c.payload->>'locationId' into location_id from public.engrase_sync c
      where c.store='cuadrillas' and c.id=p_payload->>'crewId' and not c.deleted;
    return location_id=any(assigned_locations) and (p_payload->>'locationId')=any(assigned_locations);
  end if;
  if p_store='equipment' then return (p_payload->>'locationId')=any(assigned_locations); end if;
  if p_store='lubrication_plans' then equipment_id:=p_payload->>'equipmentId';
  elsif p_store='lubrication_points' then
    select p.payload->>'equipmentId' into equipment_id from public.engrase_sync p
      where p.store='lubrication_plans' and p.id=p_payload->>'planId' and not p.deleted;
  elsif p_store in ('lubrication_records','lubrication_skips','anomalies','lubrication_assignments','manual_tasks') then
    equipment_id:=p_payload->>'equipmentId';
  elsif p_store='grease_validations' then
    record_id:=coalesce(p_payload->>'lubricationRecordId',p_payload->>'recordId');
    select r.payload->>'equipmentId' into equipment_id from public.engrase_sync r
      where r.store='lubrication_records' and r.id=record_id and not r.deleted;
  else return false;
  end if;
  select e.payload->>'locationId' into location_id from public.engrase_sync e
    where e.store='equipment' and e.id=equipment_id and not e.deleted;
  return location_id=any(assigned_locations);
end
$planner_row$;

revoke all on function authorization_private.planner_payload_in_scope(text,jsonb)
  from public,anon,authenticated;

commit;
