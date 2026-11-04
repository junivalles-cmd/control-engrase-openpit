-- PLANIFICADOR: una ubicación maestra obligatoria y alcance real por fila.
-- Preparada localmente; no despliega ni modifica datos productivos por sí sola.
begin;

alter table public.app_profiles add column if not exists location_id text;

alter table public.app_profiles drop constraint if exists app_profiles_planner_location_required;
alter table public.app_profiles add constraint app_profiles_planner_location_required
  check (role <> 'PLANIFICADOR' or nullif(btrim(location_id),'') is not null) not valid;

-- NOT VALID permite instalar sin inventar una ubicación para planificadores
-- históricos. La restricción sí se aplica desde ahora a INSERT/UPDATE y el
-- resolver niega acceso a cualquier perfil histórico todavía incompleto.
do $validate_if_clean$
begin
  if not exists (
    select 1 from public.app_profiles
    where role='PLANIFICADOR' and nullif(btrim(location_id),'') is null
  ) then
    alter table public.app_profiles validate constraint app_profiles_planner_location_required;
  end if;
end
$validate_if_clean$;

create index if not exists app_profiles_location_id_idx on public.app_profiles(location_id)
  where location_id is not null;

-- El requerimiento incluye consulta de anomalías. Se concede solo lectura;
-- el clasificador por fila de esta misma migración limita cada anomalía al
-- equipo cuya ubicación maestra coincide con la asignada.
update public.app_store_permissions set can_read=true
where store='anomalies' and role='PLANIFICADOR';

create or replace function public.resolve_authorization_scope(p_auth_user_id uuid)
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
    if nullif(btrim(profile.location_id),'') is null then
      return jsonb_build_object('status','DENIED','code','PLANNER_LOCATION_REQUIRED');
    end if;
    if not exists (select 1 from public.engrase_sync l where l.store='locations'
      and l.id=profile.location_id and not l.deleted and coalesce(l.payload->>'active','true')='true') then
      return jsonb_build_object('status','DENIED','code','PLANNER_LOCATION_INVALID');
    end if;
    scope_kind := 'LOCATION_SCOPED';
    location_ids := array[profile.location_id];
    select coalesce(array_agg(s.id order by s.id),array[]::text[]) into crew_ids
    from public.engrase_sync s where s.store='cuadrillas' and not s.deleted
      and coalesce(s.payload->>'active','true')='true' and s.payload->>'locationId'=profile.location_id;
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
    'role',profile.role,'active',profile.active,'locationId',profile.location_id,'scopeType',scope_kind,
    'authorizedCrewIds',to_jsonb(crew_ids),'authorizedLocationIds',to_jsonb(location_ids))::text);
  return jsonb_build_object('status','AUTHORIZED','context',jsonb_build_object(
    'authUserId',profile.auth_user_id,'appUserId',profile.app_user_id,'displayName',profile.display_name,
    'role',profile.role,'active',profile.active,'locationId',profile.location_id,'scopeType',scope_kind,
    'authorizedCrewIds',to_jsonb(crew_ids),'authorizedLocationIds',to_jsonb(location_ids),
    'authorizationFingerprint',fingerprint,'rowScopeEnforced',false));
end
$scope$;

revoke all on function public.resolve_authorization_scope(uuid) from public,anon,authenticated;

-- Reemplaza únicamente el clasificador base: los dispatchers 0017/0018
-- (broadcast/manual_tasks/support) conservan su nombre y OID.
create or replace function authorization_private.authorization_row_in_scope_baseline_0013(
  p_store text,p_id text,p_payload jsonb,p_action text,p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $row_scope$
declare
  result jsonb; ctx jsonb; app_user text; crews jsonb; locations jsonb;
  crew_id text; location_id text; equipment_id text; record_id text; linked_payload jsonb;
  is_global boolean; is_location_scoped boolean; own_row boolean;
begin
  if auth.uid() is null or p_store is null or p_id is null or p_payload is null then return false; end if;
  if p_store='crew_locations' then return false; end if;
  result:=p_context;
  if result->>'status' is distinct from 'AUTHORIZED' then return false; end if;
  ctx:=result->'context';
  if ctx->>'authUserId' is distinct from auth.uid()::text then return false; end if;
  app_user:=ctx->>'appUserId'; crews:=coalesce(ctx->'authorizedCrewIds','[]'::jsonb);
  locations:=coalesce(ctx->'authorizedLocationIds','[]'::jsonb);
  is_global:=ctx->>'scopeType'='GLOBAL'; is_location_scoped:=ctx->>'scopeType'='LOCATION_SCOPED';

  if p_store='push_tokens' then return p_payload->>'userId'=app_user and p_payload->>'id'=p_id;
  elsif p_store='audit_log' and p_action in ('INSERT','UPDATE') then
    return p_payload->>'authUserId'=auth.uid()::text
      and (p_payload->>'appUserId' is null or p_payload->>'appUserId'=app_user);
  elsif p_store='users' then
    own_row:=p_id=app_user or p_payload->>'appUserId'=app_user or p_payload->>'authUserId'=auth.uid()::text;
    return own_row;
  end if;
  if is_global then return true; end if;
  if p_store in ('shifts','equipment_types','lubricants','settings') then return true; end if;

  if p_store='cuadrillas' then return crews ? p_id;
  elsif p_store='locations' then return locations ? p_id;
  elsif p_store='equipment' then return locations ? (p_payload->>'locationId');
  elsif p_store='lubrication_plans' then
    equipment_id:=p_payload->>'equipmentId';
    select e.payload->>'locationId' into location_id from public.engrase_sync e
      where e.store='equipment' and e.id=equipment_id and not e.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store='lubrication_points' then
    select e.payload->>'locationId' into location_id from public.engrase_sync p
      join public.engrase_sync e on e.store='equipment' and e.id=p.payload->>'equipmentId' and not e.deleted
      where p.store='lubrication_plans' and p.id=p_payload->>'planId' and not p.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store in ('lubrication_records','lubrication_skips','anomalies') then
    equipment_id:=p_payload->>'equipmentId';
    if is_location_scoped then
      if equipment_id is null then return false; end if;
      select e.payload->>'locationId' into location_id from public.engrase_sync e
        where e.store='equipment' and e.id=equipment_id and not e.deleted;
      return location_id is not null and locations ? location_id;
    end if;
    location_id:=coalesce(p_payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
      p_payload->'operationalSnapshot'->>'executionLocationId',p_payload->>'locationId');
    crew_id:=coalesce(p_payload->'operationalSnapshot'->>'crewId',p_payload->>'crewId',p_payload->>'cuadrillaId');
    if location_id is null and equipment_id is not null then select e.payload->>'locationId' into location_id
      from public.engrase_sync e where e.store='equipment' and e.id=equipment_id and not e.deleted; end if;
    if location_id is not null and not (locations ? location_id) then return false; end if;
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    return location_id is not null or crew_id is not null;
  elsif p_store='lubrication_assignments' then
    equipment_id:=p_payload->>'equipmentId'; crew_id:=p_payload->>'assignedCrewId';
    if not is_location_scoped and crew_id is not null and not (crews ? crew_id) then return false; end if;
    select e.payload->>'locationId' into location_id from public.engrase_sync e
      where e.store='equipment' and e.id=equipment_id and not e.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store='grease_validations' then
    record_id:=coalesce(p_payload->>'lubricationRecordId',p_payload->>'recordId');
    select r.payload into linked_payload from public.engrase_sync r
      where r.store='lubrication_records' and r.id=record_id and not r.deleted;
    if linked_payload is null then return false; end if;
    equipment_id:=linked_payload->>'equipmentId';
    if is_location_scoped then
      select e.payload->>'locationId' into location_id from public.engrase_sync e
        where e.store='equipment' and e.id=equipment_id and not e.deleted;
      return location_id is not null and locations ? location_id;
    end if;
    location_id:=coalesce(linked_payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
      linked_payload->'operationalSnapshot'->>'executionLocationId',linked_payload->>'locationId');
    crew_id:=coalesce(linked_payload->'operationalSnapshot'->>'crewId',linked_payload->>'crewId',linked_payload->>'cuadrillaId');
    if location_id is null and equipment_id is not null then select e.payload->>'locationId' into location_id
      from public.engrase_sync e where e.store='equipment' and e.id=equipment_id and not e.deleted; end if;
    if location_id is not null and not (locations ? location_id) then return false; end if;
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    return location_id is not null or crew_id is not null;
  end if;
  return false;
end
$row_scope$;

-- Evita que grants de soporte de cuadrilla amplíen a un PLANIFICADOR más
-- allá de su única ubicación y aplica el mismo límite a manual_tasks.
create or replace function authorization_private.authorization_row_in_scope(
  p_store text,p_id text,p_payload jsonb,p_action text,p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
declare equipment_location text;
begin
  if p_store in ('broadcast_messages','broadcast_message_reads') then
    return authorization_private.broadcast_row_in_scope(p_store,p_id,p_payload,p_action,p_context);
  end if;
  if p_store='manual_tasks' then
    if p_context->'context'->>'scopeType'='LOCATION_SCOPED' then
      select e.payload->>'locationId' into equipment_location from public.engrase_sync e
      where e.store='equipment' and e.id=p_payload->>'equipmentId' and not e.deleted;
      if equipment_location is null or not (coalesce(p_context->'context'->'authorizedLocationIds','[]'::jsonb) ? equipment_location) then
        return false;
      end if;
    end if;
    return authorization_private.manual_task_row_in_scope(p_store,p_id,p_payload,p_action,p_context);
  end if;
  if p_action='SELECT' and p_context->'context'->>'scopeType'='CREW_SCOPED'
    and auth.uid() is not null and p_context->>'status'='AUTHORIZED'
    and p_context->'context'->>'authUserId'=auth.uid()::text
    and authorization_private.support_row_granted(p_store,p_id,p_context) then return true; end if;
  return authorization_private.authorization_row_in_scope_baseline_0013(p_store,p_id,p_payload,p_action,p_context);
end $$;

revoke all on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) from public,anon;
grant execute on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) to authenticated;

-- Defensa de escritura para REST y para RPC SECURITY DEFINER: cualquier
-- mutación operativa de un PLANIFICADOR debe seguir vinculada a un equipo
-- cuya ubicación maestra actual sea la asignada en app_profiles.
create or replace function authorization_private.planner_payload_in_scope(p_store text,p_payload jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $planner_row$
declare assigned_location text; location_id text; equipment_id text; record_id text;
begin
  select p.location_id into assigned_location from public.app_profiles p
    where p.auth_user_id=auth.uid() and p.active=true and p.role='PLANIFICADOR';
  if not found then return true; end if;
  if nullif(btrim(assigned_location),'') is null then return false; end if;
  if p_store in ('shifts','equipment_types','lubricants','settings','broadcast_messages','broadcast_message_reads') then return true; end if;
  if p_store='push_tokens' then return p_payload->>'userId'=(select app_user_id from public.app_profiles where auth_user_id=auth.uid()); end if;
  if p_store='audit_log' then return p_payload->>'actorAuthUserId'=auth.uid()::text or p_payload->>'authUserId'=auth.uid()::text; end if;
  if p_store='locations' then return p_payload->>'id'=assigned_location; end if;
  if p_store='cuadrillas' then return p_payload->>'locationId'=assigned_location; end if;
  if p_store='crew_locations' then
    select c.payload->>'locationId' into location_id from public.engrase_sync c
      where c.store='cuadrillas' and c.id=p_payload->>'crewId' and not c.deleted;
    return location_id=assigned_location and p_payload->>'locationId'=assigned_location;
  end if;
  if p_store='equipment' then return p_payload->>'locationId'=assigned_location; end if;
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
  return location_id=assigned_location;
end
$planner_row$;

revoke all on function authorization_private.planner_payload_in_scope(text,jsonb) from public,anon,authenticated;

create or replace function authorization_private.enforce_planner_location_write()
returns trigger language plpgsql security definer set search_path=pg_catalog as $trigger$
begin
  if auth.uid() is null then
    if tg_op='DELETE' then return old; else return new; end if;
  end if;
  if tg_op in ('UPDATE','DELETE') and not authorization_private.planner_payload_in_scope(old.store,old.payload) then
    raise insufficient_privilege using message='PLANNER_LOCATION_SCOPE_DENIED';
  end if;
  if tg_op in ('INSERT','UPDATE') and not authorization_private.planner_payload_in_scope(new.store,new.payload) then
    raise insufficient_privilege using message='PLANNER_LOCATION_SCOPE_DENIED';
  end if;
  if tg_op='DELETE' then return old; else return new; end if;
end
$trigger$;

drop trigger if exists enforce_planner_location_write on public.engrase_sync;
create trigger enforce_planner_location_write before insert or update or delete on public.engrase_sync
for each row execute function authorization_private.enforce_planner_location_write();

-- Mantiene el readiness bit de 0013 al envolver el resolver nuevo.
create or replace function public.get_authorization_context()
returns jsonb language sql stable security definer set search_path=pg_catalog as $bootstrap$
  select case when c->>'status'='AUTHORIZED'
    then jsonb_set(c,'{context,rowScopeEnforced}','true'::jsonb,false) else c end
  from (select public.resolve_authorization_scope(auth.uid()) as c) s;
$bootstrap$;

revoke all on function public.get_authorization_context() from public,anon;
grant execute on function public.get_authorization_context() to authenticated;

commit;
