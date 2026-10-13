-- PREPARED ONLY. Do not run in any Supabase environment without explicit rollout authorization.
-- PRE-0008: typed, idempotent assignment and immutable skip operations.
-- Requires 0012 authorization bootstrap and 0013 restrictive row scope.
-- Generic writes to these stores must be disabled in the target matrix.
begin;

do $preconditions$
begin
  if to_regprocedure('public.get_authorization_context()') is null
     or to_regprocedure('public.resolve_authorization_scope(uuid)') is null
     or to_regclass('public.engrase_sync') is null
     or to_regclass('public.app_profiles') is null
     or to_regclass('public.app_store_permissions') is null then
    raise exception '0014 requires authorization bootstrap, profiles, matrix and engrase_sync';
  end if;
  if not exists (select 1 from pg_catalog.pg_policies where schemaname='public'
      and tablename='engrase_sync' and policyname='authorization_scope_select' and permissive='RESTRICTIVE') then
    raise exception '0014 requires 0013 restrictive row scope';
  end if;
end
$preconditions$;

-- 0013's row classifier intentionally fails unknown scoped stores closed, but
-- 0011 has a real operational read path for shared settings/general. Keep that
-- shared, non-personal store available only to an authenticated authorized
-- profile; the permissive matrix/catalog policy still controls the store read.
drop policy authorization_scope_select on public.engrase_sync;
create policy authorization_scope_select on public.engrase_sync as restrictive
  for select to authenticated using (
    authorization_private.authorization_row_in_scope(store,id,payload,'SELECT',
      (select public.get_authorization_context()))
    or (store='settings' and (select public.get_authorization_context()->>'status')='AUTHORIZED')
  );

create table public.assignment_skip_operation_receipts (
  auth_user_id uuid not null,
  operation_id text not null,
  request jsonb not null,
  result jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  primary key(auth_user_id, operation_id)
);
alter table public.assignment_skip_operation_receipts enable row level security;
revoke all on public.assignment_skip_operation_receipts from public, anon, authenticated;

create function public.assignment_skip_operation(
  p_operation_id text, p_action text, p_id text, p_expected timestamptz,
  p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text,
  p_notes text, p_date timestamptz, p_shift_id text, p_reason text,
  p_observacion text, p_linked_record_id text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $gateway$
declare
  actor public.app_profiles%rowtype;
  ctx jsonb;
  context jsonb;
  equipment public.engrase_sync%rowtype;
  plan public.engrase_sync%rowtype;
  crew public.engrase_sync%rowtype;
  original public.engrase_sync%rowtype;
  receipt public.assignment_skip_operation_receipts%rowtype;
  request jsonb;
  result jsonb;
  row_payload jsonb;
  destination text;
  at timestamptz := clock_timestamp();
  local_day date;
  expected_occurrence text;
  weekday_name text;
  role_global boolean;
  pending_count integer;
  v_can_read boolean;
  effective_crew_id text := p_crew_id;
  day_start numeric := 6;
  night_start numeric := 18;
begin
  if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into actor from public.app_profiles where auth_user_id=auth.uid() for share;
  if not found or actor.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
  if nullif(p_operation_id,'') is null or p_action not in ('CREATE','REASSIGN','CANCEL','SKIP') then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;

  ctx := public.get_authorization_context();
  if ctx->>'status' is distinct from 'AUTHORIZED' or coalesce((ctx->'context'->>'rowScopeEnforced')::boolean,false) is not true then
    return jsonb_build_object('status','DENIED','code','AUTHORIZATION_SCOPE_UNAVAILABLE'); end if;
  context := ctx->'context'; role_global := context->>'scopeType'='GLOBAL';
  destination := case when p_action='SKIP' then 'lubrication_skips' else 'lubrication_assignments' end;
  select p.can_read into v_can_read from public.app_store_permissions p
    where role=actor.role and store=destination;
  if v_can_read is distinct from true then return jsonb_build_object('status','DENIED','code','PERMISSION_DENIED'); end if;
  if p_action in ('CREATE','REASSIGN','CANCEL') and actor.role='LUBRICADOR' then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;

  request := jsonb_build_array(p_action,p_id,p_expected,p_equipment_id,p_plan_id,p_occurrence_key,p_crew_id,
    p_notes,p_date,p_shift_id,p_reason,p_observacion,p_linked_record_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':'||p_operation_id,0));
  select * into receipt from public.assignment_skip_operation_receipts
    where auth_user_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.request<>request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    return receipt.result;
  end if;

  if p_action in ('CREATE','SKIP') then
    if nullif(p_id,'') is null or nullif(p_equipment_id,'') is null or (p_action='CREATE' and nullif(p_crew_id,'') is null) then
      return jsonb_build_object('status','DENIED','code','INVALID_INPUT'); end if;
    select * into equipment from public.engrase_sync where store='equipment' and id=p_equipment_id
      and not deleted and coalesce(payload->>'active','true')='true' for share;
    if not found then return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND'); end if;
    if effective_crew_id is null and p_action='SKIP' and role_global then
      select count(*),min(id) into pending_count,effective_crew_id from public.engrase_sync
        where store='cuadrillas' and not deleted and coalesce(payload->>'active','true')='true'
          and payload->>'locationId'=equipment.payload->>'locationId' and coalesce((payload->>'isDefault')::boolean,false);
      if pending_count<>1 then return jsonb_build_object('status','DENIED','code','DEFAULT_CREW_REQUIRED'); end if;
    end if;
    if effective_crew_id is null then return jsonb_build_object('status','DENIED','code','CREW_REQUIRED'); end if;
    select * into crew from public.engrase_sync where store='cuadrillas' and id=effective_crew_id
      and not deleted and coalesce(payload->>'active','true')='true' for share;
    if not found or crew.payload->>'locationId' is distinct from equipment.payload->>'locationId' then
      return jsonb_build_object('status','DENIED','code','CREW_EQUIPMENT_LOCATION_MISMATCH'); end if;
    if not role_global and (not (context->'authorizedCrewIds' ? effective_crew_id)
       or not (context->'authorizedLocationIds' ? (equipment.payload->>'locationId'))) then
      return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
    if actor.role='SUPERVISOR' and not (crew.payload->'memberUserIds' ? actor.app_user_id) then
      return jsonb_build_object('status','DENIED','code','CREW_SCOPE_DENIED'); end if;
    select * into plan from public.engrase_sync where store='lubrication_plans'
      and id=p_plan_id and not deleted and coalesce(payload->>'active','true')='true'
      and payload->>'equipmentId'=p_equipment_id for share;
    if not found then return jsonb_build_object('status','DENIED','code','PLAN_MISMATCH'); end if;
    local_day := (at at time zone 'America/Managua')::date;
    if plan.payload->>'controlType'='Día y turno de la semana' then
      expected_occurrence := plan.id||':'||local_day::text;
      weekday_name := (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[extract(dow from local_day)::integer+1];
      if not (coalesce(plan.payload->'assignedDays','[]'::jsonb) ? weekday_name) then
        return jsonb_build_object('status','DENIED','code','OCCURRENCE_NOT_SCHEDULED'); end if;
    else
      expected_occurrence := plan.id||':h:'||coalesce(nullif(plan.payload->>'lastGreaseHour',''),'0');
    end if;
    if p_occurrence_key is distinct from expected_occurrence then
      return jsonb_build_object('status','CONFLICT','code','OCCURRENCE_VERSION_CONFLICT'); end if;
  end if;

  if p_action in ('CREATE','REASSIGN','CANCEL') then
    if actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
    if p_action='CREATE' then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment:'||p_occurrence_key,0));
      if exists(select 1 from public.engrase_sync where store='lubrication_assignments' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=p_occurrence_key and payload->>'status'='PENDING') then
        return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_ALREADY_PENDING'); end if;
      if exists(select 1 from public.engrase_sync where store='lubrication_assignments' and id=p_id) then
        return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
      row_payload := jsonb_build_object('id',p_id,'occurrenceKey',p_occurrence_key,'equipmentId',p_equipment_id,
        'planId',p_plan_id,'assignedCrewId',effective_crew_id,'assignedByUserId',actor.app_user_id,
        'assignedByUserName',actor.display_name,'assignedAt',at,'status','PENDING','completedAt',null,
        'completedRecordId',null,'previousCrewId',null,'notes',coalesce(p_notes,''),'active',true,'updatedAt',at);
    else
      select * into original from public.engrase_sync where store='lubrication_assignments' and id=p_id and not deleted for update;
      if not found then return jsonb_build_object('status','DENIED','code','ASSIGNMENT_NOT_FOUND'); end if;
      if original.updated_at is distinct from p_expected then return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT'); end if;
      if original.payload->>'status' is distinct from 'PENDING' then return jsonb_build_object('status','DENIED','code','INVALID_TRANSITION'); end if;
      if original.payload->>'equipmentId' is distinct from p_equipment_id
        or original.payload->>'planId' is distinct from p_plan_id then
        return jsonb_build_object('status','DENIED','code','ASSIGNMENT_REFERENCE_MISMATCH'); end if;
      select * into equipment from public.engrase_sync where store='equipment' and id=original.payload->>'equipmentId' and not deleted for share;
      if not found then return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND'); end if;
      if not role_global and (not (context->'authorizedCrewIds' ? (original.payload->>'assignedCrewId'))
        or not (context->'authorizedLocationIds' ? (equipment.payload->>'locationId'))) then
        return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
      if original.payload->>'occurrenceKey' is distinct from p_occurrence_key then
        return jsonb_build_object('status','CONFLICT','code','OCCURRENCE_VERSION_CONFLICT'); end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment:'||(original.payload->>'occurrenceKey'),0));
      if p_action='REASSIGN' then
        select * into crew from public.engrase_sync where store='cuadrillas' and id=p_crew_id and not deleted
          and coalesce(payload->>'active','true')='true' for share;
        if not found or crew.payload->>'locationId' is distinct from equipment.payload->>'locationId' then
          return jsonb_build_object('status','DENIED','code','CREW_EQUIPMENT_LOCATION_MISMATCH'); end if;
        if not role_global and not (context->'authorizedCrewIds' ? p_crew_id) then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
        if actor.role='SUPERVISOR' and not (crew.payload->'memberUserIds' ? actor.app_user_id) then return jsonb_build_object('status','DENIED','code','CREW_SCOPE_DENIED'); end if;
        if effective_crew_id is not distinct from original.payload->>'assignedCrewId' then return jsonb_build_object('status','DENIED','code','SAME_CREW'); end if;
        if exists(select 1 from public.engrase_sync where store='lubrication_assignments' and id<>p_id and not deleted
          and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=original.payload->>'occurrenceKey' and payload->>'status'='PENDING') then
          return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_ALREADY_PENDING'); end if;
        row_payload:=original.payload||jsonb_build_object('previousCrewId',original.payload->>'assignedCrewId','assignedCrewId',effective_crew_id,'updatedAt',greatest(at,original.updated_at+interval '1 microsecond'));
      else
        row_payload:=original.payload||jsonb_build_object('status','CANCELLED','completedAt',null,'updatedAt',greatest(at,original.updated_at+interval '1 microsecond'));
      end if;
    end if;
  else
    if p_date is null or p_date > at + interval '5 minutes' or p_shift_id not in ('shift_dia','shift_noche')
      or p_reason not in ('REPARACION','YA_ENGRASADO','SIN_TIEMPO','NO_DISPONIBLE','CONDICION_INSEGURA','OTRO')
      or (p_reason='OTRO' and nullif(btrim(p_observacion),'') is null)
      or (p_observacion is not null and length(p_observacion)>1000)
      or (p_action='CREATE' and length(coalesce(p_notes,''))>1000) then
      return jsonb_build_object('status','DENIED','code','INVALID_SKIP'); end if;
    if (p_date at time zone 'America/Managua')::date <> (at at time zone 'America/Managua')::date then
      return jsonb_build_object('status','DENIED','code','SKIP_DATE_NOT_CURRENT'); end if;
    select coalesce((payload->>'shiftDayStart')::numeric,6),coalesce((payload->>'shiftNightStart')::numeric,18)
      into day_start,night_start from public.engrase_sync where store='settings' and id='general' and not deleted;
    day_start:=coalesce(day_start,6); night_start:=coalesce(night_start,18);
    if p_shift_id is distinct from (case when extract(hour from p_date at time zone 'America/Managua')>=day_start
      and extract(hour from p_date at time zone 'America/Managua')<night_start then 'shift_dia' else 'shift_noche' end) then
      return jsonb_build_object('status','DENIED','code','SHIFT_MISMATCH'); end if;
    if p_linked_record_id is not null and not exists(select 1 from public.engrase_sync r where r.store='lubrication_records'
      and r.id=p_linked_record_id and not r.deleted and r.payload->>'equipmentId'=p_equipment_id
      and coalesce(r.payload->'operationalSnapshot'->>'satisfiedOccurrenceKey',r.payload->'operationalSnapshot'->>'occurrenceKey')=p_occurrence_key) then
      return jsonb_build_object('status','DENIED','code','LINKED_RECORD_MISMATCH'); end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('skip:'||p_equipment_id||':'||p_occurrence_key,0));
    if exists(select 1 from public.engrase_sync where store='lubrication_skips' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=p_occurrence_key
      and payload->>'equipmentId'=p_equipment_id) then
      return jsonb_build_object('status','CONFLICT','code','SKIP_ALREADY_RECORDED'); end if;
    if exists(select 1 from public.engrase_sync where store='lubrication_skips' and id=p_id) then
      return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
    row_payload:=jsonb_build_object('id',p_id,'equipmentId',p_equipment_id,'planId',p_plan_id,
      'occurrenceKey',p_occurrence_key,'date',p_date,'shiftId',p_shift_id,'reason',p_reason,
      'crewId',effective_crew_id,'locationId',equipment.payload->>'locationId',
      'observacion',nullif(btrim(p_observacion),''),'userId',actor.app_user_id,'userName',actor.display_name,
      'createdByAuthUserId',auth.uid(),'createdAt',at,'active',true,'linkedRecordId',p_linked_record_id,'updatedAt',at);
  end if;
  row_payload:=row_payload||jsonb_build_object('updatedAt',coalesce((row_payload->>'updatedAt')::timestamptz,at));
  insert into public.engrase_sync(store,id,payload,updated_at,deleted)
    values(destination,p_id,row_payload,(row_payload->>'updatedAt')::timestamptz,false)
    on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
  insert into public.engrase_sync(store,id,payload,updated_at,deleted)
    values('audit_log','assignment-skip:'||auth.uid()::text||':'||p_operation_id,
      jsonb_build_object('id','assignment-skip:'||auth.uid()::text||':'||p_operation_id,
        'action',case when p_action='SKIP' then 'LUBRICATION_SKIPPED' else 'ASSIGNMENT_'||p_action end,
        'entityId',p_id,'actorAuthUserId',auth.uid(),'appUserId',actor.app_user_id,
        'user',actor.display_name,'createdAt',at,'active',true),at,false);
  result:=jsonb_build_object('status','APPLIED','rows',jsonb_build_array(jsonb_build_object(
    'store',destination,'id',p_id,'payload',row_payload,'updated_at',(row_payload->>'updatedAt')::timestamptz)));
  insert into public.assignment_skip_operation_receipts(auth_user_id,operation_id,request,result)
    values(auth.uid(),p_operation_id,request,result);
  return result;
end
$gateway$;

revoke all on function public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text) from public,anon,authenticated;
create function public.manage_lubrication_assignment(p_operation_id text,p_action text,p_id text,p_expected timestamptz,
  p_equipment_id text,p_plan_id text,p_occurrence_key text,p_crew_id text,p_notes text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
  select public.assignment_skip_operation(p_operation_id,p_action,p_id,p_expected,p_equipment_id,p_plan_id,p_occurrence_key,p_crew_id,p_notes,null,null,null,null,null)
$$;
create function public.record_lubrication_skip(p_operation_id text,p_id text,p_expected timestamptz,
  p_equipment_id text,p_plan_id text,p_occurrence_key text,p_crew_id text,p_date timestamptz,
  p_shift_id text,p_reason text,p_observacion text,p_linked_record_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
  select public.assignment_skip_operation(p_operation_id,'SKIP',p_id,p_expected,p_equipment_id,p_plan_id,p_occurrence_key,p_crew_id,null,p_date,p_shift_id,p_reason,p_observacion,p_linked_record_id)
$$;
revoke all on function public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text),
  public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text) from public,anon;
grant execute on function public.manage_lubrication_assignment(text,text,text,timestamptz,text,text,text,text,text),
  public.record_lubrication_skip(text,text,timestamptz,text,text,text,text,timestamptz,text,text,text,text) to authenticated;

-- Typed gateways are the sole mutation path. Restrictive guards intersect any
-- remaining permissive legacy policy and 0013 row-scope policy.
drop policy if exists assignment_skip_rpc_insert_only on public.engrase_sync;
create policy assignment_skip_rpc_insert_only on public.engrase_sync as restrictive for insert to public
  with check (store not in ('lubrication_assignments','lubrication_skips'));
drop policy if exists assignment_skip_rpc_update_only on public.engrase_sync;
create policy assignment_skip_rpc_update_only on public.engrase_sync as restrictive for update to public
  using (store not in ('lubrication_assignments','lubrication_skips'))
  with check (store not in ('lubrication_assignments','lubrication_skips'));
drop policy if exists assignment_skip_rpc_delete_only on public.engrase_sync;
create policy assignment_skip_rpc_delete_only on public.engrase_sync as restrictive for delete to public
  using (store not in ('lubrication_assignments','lubrication_skips'));
-- New skips are insert-only; even a gateway or future permissive policy cannot
-- mutate or hard-delete historical evidence.
comment on function public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text)
  is 'PRE-0008 typed assignment/skip gateway; server authority, CAS and per-user idempotency; skips are immutable.';
commit;
