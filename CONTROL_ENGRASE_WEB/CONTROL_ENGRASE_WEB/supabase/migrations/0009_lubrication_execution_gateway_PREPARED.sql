-- PREPARED ONLY. Never automatically apply to production.
-- Phase 2A, pre-0008: existing app_profiles/app_store_permissions/engrase_sync.
-- Deploy endpoint FIRST, then compatible Web/APK. Missing RPC keeps local intent.
-- No changes to the permission matrix or 0003/0007/0008. This is NOT a cutover:
-- legacy/direct REST policies still require the separately authorized hardening.
-- Derived equipment/plan fields are delegated by the record I/U permission,
-- NOT by granting generic U on those stores. Assignment completion also requires U.
-- America/Managua is the operating calendar; settings/general supplies shift hours.
-- Records keep declared execution time; capturedAt/auth identity use server authority.
begin;

create table public.lubrication_execution_receipts (
  auth_user_id uuid not null,
  operation_id text not null,
  request jsonb not null,
  result jsonb not null,
  applied_at timestamptz not null default clock_timestamp(),
  primary key (auth_user_id, operation_id)
);
alter table public.lubrication_execution_receipts enable row level security;
revoke all on public.lubrication_execution_receipts from public, anon, authenticated;

create function public.lubrication_execution(
  p_operation_id text, p_action text, p_record_id text,
  p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text,
  p_execution_date timestamptz, p_client_captured_at timestamptz, p_shift_id text, p_execution_type text,
  p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean,
  p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text,
  p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text,
  p_details jsonb, p_photos jsonb,
  p_expected_record timestamptz, p_expected_equipment timestamptz,
  p_expected_plan timestamptz, p_expected_assignment timestamptz
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $gateway$
declare
  actor public.app_profiles%rowtype;
  equipment public.engrase_sync%rowtype;
  plan public.engrase_sync%rowtype;
  original public.engrase_sync%rowtype;
  assignment public.engrase_sync%rowtype;
  crew public.engrase_sync%rowtype;
  receipt public.lubrication_execution_receipts%rowtype;
  request jsonb;
  result jsonb;
  row_payload jsonb;
  snapshot jsonb;
  canonical jsonb;
  normalized_details jsonb := '[]'::jsonb;
  detail jsonb;
  point public.engrase_sync%rowtype;
  point_name text;
  role_global boolean;
  complete boolean := true;
  is_latest boolean;
  n integer;
  occurrence text;
  satisfied text;
  candidate date;
  candidates date[] := '{}';
  weekdays text[] := array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  execution_day date;
  crew_id text := p_crew_id;
  performer_name text;
  stamp_at timestamptz := clock_timestamp();
  version_at timestamptz;
  day_start numeric := 6;
  night_start numeric := 18;
begin
  if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into actor from public.app_profiles where auth_user_id = auth.uid() for share;
  if not found or not actor.active then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','INVALID_ROLE');
  end if;
  if p_action is null or p_action not in ('CREATE','EDIT') or nullif(p_operation_id,'') is null or nullif(p_record_id,'') is null then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION');
  end if;
  perform 1 from public.app_store_permissions
    where store = 'lubrication_records' and role = actor.role
      and case when p_action = 'CREATE' then can_insert else can_update end for share;
  if not found then return jsonb_build_object('status','DENIED','code','RECORD_PERMISSION_DENIED'); end if;

  -- Conservative serialization includes concurrent legacy REST signatures and catalog writes.
  -- No row lock protocol can protect signed edits while signatures still use generic REST.
  -- Keep transaction short; replace with per-equipment protocol only after all writers participate.
  lock table public.engrase_sync in share row exclusive mode;
  stamp_at := clock_timestamp();
  request := jsonb_build_array(p_action,p_record_id,p_equipment_id,p_plan_id,p_crew_id,p_assignment_id,
    p_execution_date,p_client_captured_at,p_shift_id,p_execution_type,p_out_of_plan_reason,p_performed_by,p_retroactive,
    p_hourmeter,p_no_hourmeter,p_no_hourmeter_reason,p_lubricant_id,p_quantity,p_condition,p_notes,
    p_details,p_photos,p_expected_record,p_expected_equipment,p_expected_plan,p_expected_assignment);
  select * into receipt from public.lubrication_execution_receipts
    where auth_user_id = actor.auth_user_id and operation_id = p_operation_id;
  if found then
    if receipt.request <> request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    -- Recheck current scope before returning this caller's receipt.
  end if;
  select * into equipment from public.engrase_sync where store='equipment' and id=p_equipment_id and not deleted;
  if not found or coalesce(equipment.payload->>'active','true') <> 'true' then
    return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND');
  end if;
  role_global := actor.role in ('ADMINISTRADOR','PLANIFICADOR');
  if not role_global then
    if crew_id is null then
      select count(*), min(id) into n,crew_id from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
      if n <> 1 then return jsonb_build_object('status','DENIED','code','CREW_SELECTION_REQUIRED'); end if;
    end if;
    select * into crew from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
    if not found or nullif(crew.payload->>'locationId','') is null
      or crew.payload->>'locationId' is distinct from equipment.payload->>'locationId' then
      return jsonb_build_object('status','DENIED','code','SCOPE_DENIED');
    end if;
  elsif crew_id is not null then
    select * into crew from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true';
    if not found then return jsonb_build_object('status','DENIED','code','CREW_NOT_FOUND'); end if;
  end if;
  if not exists (select 1 from public.engrase_sync where store='locations' and id=equipment.payload->>'locationId' and not deleted
    and coalesce(payload->>'active','true')='true') then return jsonb_build_object('status','DENIED','code','LOCATION_NOT_FOUND'); end if;
  if receipt.operation_id is not null then return receipt.result; end if;
  select * into original from public.engrase_sync where store='lubrication_records' and id=p_record_id;
  if p_action='CREATE' and found then return jsonb_build_object('status','CONFLICT','code','RECORD_EXISTS'); end if;
  if p_action='EDIT' then
    if original.id is null or original.deleted then return jsonb_build_object('status','DENIED','code','RECORD_NOT_FOUND'); end if;
    if original.payload->>'equipmentId' is distinct from p_equipment_id
      or (original.payload->>'date')::timestamptz is distinct from p_execution_date
      or coalesce((original.payload->>'createdAt')::timestamptz,(original.payload->>'date')::timestamptz) is distinct from p_client_captured_at
      or original.payload->>'userId' is distinct from p_performed_by
      or original.payload->>'shiftId' is distinct from p_shift_id
      or (original.payload->>'planId' is not null and original.payload->>'planId' is distinct from p_plan_id)
      or original.payload->'operationalSnapshot'->>'outOfPlanReason' is distinct from p_out_of_plan_reason
      or coalesce(original.payload->'operationalSnapshot'->>'executionType','PLANNED') is distinct from p_execution_type
      or original.payload->'operationalSnapshot'->>'assignmentId' is distinct from p_assignment_id
      or coalesce((original.payload->>'retroactivo')::boolean,false) is distinct from p_retroactive
      or coalesce((original.payload->>'sinHorometro')::boolean,false) is distinct from p_no_hourmeter
      or original.payload->>'noHourmeterReason' is distinct from p_no_hourmeter_reason then
      return jsonb_build_object('status','DENIED','code','IMMUTABLE_RECORD_FIELDS');
    end if;
    if actor.role='LUBRICADOR' and original.payload->>'userId' is distinct from actor.app_user_id then
      return jsonb_build_object('status','DENIED','code','EDIT_WINDOW_OR_OWNER');
    end if;
    if exists (select 1 from public.engrase_sync where store='grease_validations' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'lubricationRecordId'=p_record_id) then
      select jsonb_agg(jsonb_build_object('store',store,'id',id,'payload',payload,'updated_at',updated_at)) into canonical
        from public.engrase_sync where (store='lubrication_records' and id=p_record_id) or (store='equipment' and id=p_equipment_id)
          or (store='lubrication_plans' and id=p_plan_id and payload->>'equipmentId'=p_equipment_id);
      return jsonb_build_object('status','DENIED','code','SIGNED_RECORD_LOCKED','rows',canonical);
    end if;
    -- Existing field editor: own same operating day. Admin has no signed-record exception.
    if actor.role='LUBRICADOR' and (original.payload->>'userId' <> actor.app_user_id
      or (original.payload->>'date')::timestamptz at time zone 'America/Managua' < date_trunc('day',stamp_at at time zone 'America/Managua')
      or (original.payload->>'date')::timestamptz at time zone 'America/Managua' >= date_trunc('day',stamp_at at time zone 'America/Managua') + interval '1 day') then
      return jsonb_build_object('status','DENIED','code','EDIT_WINDOW_OR_OWNER');
    end if;
  end if;
  if p_plan_id is not null then
    select * into plan from public.engrase_sync where store='lubrication_plans' and id=p_plan_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id;
    if not found then return jsonb_build_object('status','DENIED','code','PLAN_MISMATCH'); end if;
  elsif exists(select 1 from public.engrase_sync where store='lubrication_plans' and not deleted
    and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id) then
    return jsonb_build_object('status','DENIED','code','PLAN_REQUIRED');
  end if;
  if (equipment.updated_at is distinct from p_expected_equipment)
    or (plan.id is not null and plan.updated_at is distinct from p_expected_plan)
    or (p_action='EDIT' and original.updated_at is distinct from p_expected_record)
    or (p_action='CREATE' and p_expected_record is not null) then
    return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT');
  end if;
  if p_execution_date is null or p_execution_date > stamp_at + interval '5 minutes'
    or p_client_captured_at is null or p_client_captured_at > stamp_at + interval '5 minutes'
    or p_retroactive is null or p_no_hourmeter is null or p_execution_type is null
    or p_execution_type not in ('PLANNED','ASSIGNED','OUT_OF_PLAN')
    or p_shift_id is null or p_shift_id not in ('shift_dia','shift_noche')
    or p_hourmeter is null or p_hourmeter < 0 or p_hourmeter::text in ('NaN','Infinity','-Infinity')
    or p_quantity is null or p_quantity < 0 or p_quantity::text in ('NaN','Infinity','-Infinity')
    or p_condition is null or p_condition not in ('Normal','Con desgaste','Requiere atención')
    or p_details is null or jsonb_typeof(p_details)<>'array'
    or p_photos is null or jsonb_typeof(p_photos)<>'array'
    or jsonb_array_length(p_photos)>5 then return jsonb_build_object('status','DENIED','code','INVALID_INPUT'); end if;
  if p_action='CREATE' and not role_global and (p_retroactive or p_performed_by is distinct from actor.app_user_id) then
    return jsonb_build_object('status','DENIED','code','PERFORMER_DENIED');
  end if;
  if p_action='CREATE' and not p_retroactive and p_performed_by is distinct from actor.app_user_id then
    return jsonb_build_object('status','DENIED','code','PERFORMER_DENIED');
  end if;
  if p_action='CREATE' and p_no_hourmeter and (p_no_hourmeter_reason is null
    or p_no_hourmeter_reason not in ('El equipo no tiene horómetro','Horómetro dañado','Pantalla ilegible / rota','Equipo apagado, no se pudo leer','Otro')
    or p_hourmeter is distinct from coalesce((equipment.payload->>'hourmeter')::numeric,0)) then
    return jsonb_build_object('status','DENIED','code','NO_HOURMETER_INPUT');
  end if;
  performer_name := actor.display_name;
  if p_performed_by is distinct from actor.app_user_id then
    select payload->>'name' into performer_name from public.engrase_sync where store='users' and id=p_performed_by and not deleted;
    if performer_name is null then return jsonb_build_object('status','DENIED','code','PERFORMER_NOT_FOUND'); end if;
  end if;
  if p_lubricant_id is not null and not exists(select 1 from public.engrase_sync where store='lubricants' and id=p_lubricant_id
    and not deleted and coalesce(payload->>'active','true')='true') then return jsonb_build_object('status','DENIED','code','LUBRICANT_NOT_FOUND'); end if;
  for detail in select value from jsonb_array_elements(p_photos) loop
    if jsonb_typeof(detail)<>'string' or (detail#>>'{}') !~ '^https://' or length(detail#>>'{}')>2048 then
      return jsonb_build_object('status','DENIED','code','INVALID_PHOTO_REFERENCE');
    end if;
  end loop;
  if p_action='CREATE' then
    select count(*) into n from public.engrase_sync where store='lubrication_points' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'planId'=p_plan_id;
  else n := jsonb_array_length(coalesce(original.payload->'details','[]'::jsonb)); end if;
  if n <> jsonb_array_length(p_details) or (select count(distinct value->>'pointId') from jsonb_array_elements(p_details)) <> n then
    return jsonb_build_object('status','DENIED','code','CHECKLIST_MISMATCH');
  end if;
  for detail in select value from jsonb_array_elements(p_details) loop
    if jsonb_typeof(detail)<>'object' or jsonb_typeof(detail->'done') is distinct from 'boolean'
      or jsonb_typeof(detail->'pointId') is distinct from 'string'
      or (detail->'reason' is not null and jsonb_typeof(detail->'reason') not in ('string','null'))
      or exists(select 1 from jsonb_object_keys(detail) as k where k not in ('pointId','pointName','done','reason')) then
      return jsonb_build_object('status','DENIED','code','INVALID_CHECKLIST');
    end if;
    if p_action='CREATE' then
      select * into point from public.engrase_sync where store='lubrication_points' and id=detail->>'pointId'
        and not deleted and coalesce(payload->>'active','true')='true' and payload->>'planId'=p_plan_id;
      point_name := point.payload->>'point';
    else select value->>'pointName' into point_name from jsonb_array_elements(original.payload->'details') where value->>'pointId'=detail->>'pointId'; end if;
    if point_name is null or (not (detail->>'done')::boolean and nullif(btrim(detail->>'reason'),'') is null) then
      return jsonb_build_object('status','DENIED','code','INVALID_POINT');
    end if;
    complete := complete and (detail->>'done')::boolean;
    normalized_details := normalized_details || jsonb_build_array(jsonb_build_object('pointId',detail->>'pointId',
      'pointName',point_name,'done',detail->'done','reason',detail->'reason'));
  end loop;
  if complete and p_quantity<=0 then return jsonb_build_object('status','DENIED','code','COMPLETE_REQUIRES_GREASE'); end if;
  if p_action='CREATE' and p_execution_type='OUT_OF_PLAN' and (p_out_of_plan_reason is null
    or p_out_of_plan_reason not in ('PM','CORRECTIVO','OPORTUNIDAD','SUPPORT_OTHER_LOCATION','OTRO')
    or (p_out_of_plan_reason='OTRO' and nullif(btrim(p_notes),'') is null)) then
    return jsonb_build_object('status','DENIED','code','OUT_OF_PLAN_REASON_REQUIRED');
  end if;
  execution_day := (p_execution_date at time zone 'America/Managua')::date;
  select coalesce((payload->>'shiftDayStart')::numeric,6),coalesce((payload->>'shiftNightStart')::numeric,18)
    into day_start,night_start from public.engrase_sync where store='settings' and id='general' and not deleted;
  day_start := coalesce(day_start,6); night_start := coalesce(night_start,18);
  if p_action='CREATE' and not p_retroactive and p_shift_id <> (case when extract(hour from p_execution_date at time zone 'America/Managua') >= day_start
    and extract(hour from p_execution_date at time zone 'America/Managua') < night_start then 'shift_dia' else 'shift_noche' end) then
    return jsonb_build_object('status','DENIED','code','SHIFT_MISMATCH');
  end if;
  if p_action='CREATE' then
    if plan.id is not null then
      occurrence := case when plan.payload->>'controlType'='Día y turno de la semana' then plan.id||':'||execution_day::text
        else plan.id||':h:'||(case when jsonb_typeof(plan.payload->'lastGreaseHour')='number'
          then trim_scale((plan.payload->>'lastGreaseHour')::numeric)::text else coalesce(plan.payload->>'lastGreaseHour','0') end) end;
    end if;
    select count(*) into n from public.engrase_sync where store='lubrication_assignments' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=occurrence and payload->>'status'='PENDING';
    if n>1 then return jsonb_build_object('status','DENIED','code','AMBIGUOUS_ASSIGNMENT'); end if;
    if n=1 then
      select * into assignment from public.engrase_sync where store='lubrication_assignments' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=occurrence and payload->>'status'='PENDING';
      if p_assignment_id is distinct from assignment.id or p_execution_type<>'ASSIGNED'
        or assignment.payload->>'equipmentId' is distinct from p_equipment_id
        or (assignment.payload->>'planId' is not null and assignment.payload->>'planId' is distinct from p_plan_id)
        or assignment.payload->>'assignedCrewId' is distinct from crew_id then
        return jsonb_build_object('status','DENIED','code','ASSIGNMENT_MISMATCH');
      end if;
      if assignment.updated_at is distinct from p_expected_assignment then return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_VERSION_CONFLICT'); end if;
      if not exists(select 1 from public.app_store_permissions where store='lubrication_assignments' and role=actor.role and can_update) then
        return jsonb_build_object('status','DENIED','code','ASSIGNMENT_PERMISSION_DENIED');
      end if;
    elsif p_assignment_id is not null or p_execution_type='ASSIGNED' then return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_NOT_PENDING'); end if;
    if not role_global and p_execution_type='PLANNED' then
      select count(*) into n from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'locationId'=equipment.payload->>'locationId'
        and (payload->>'isDefault')::boolean;
      if n<>1 or coalesce((crew.payload->>'isDefault')::boolean,false) is not true then
        return jsonb_build_object('status','DENIED','code','DEFAULT_CREW_REQUIRED');
      end if;
      -- Execution shift was checked against capture time. The existing QR/early
      -- execution flow permits recording before the equipment's scheduled shift.
    end if;
    if complete and plan.id is not null then
      if plan.payload->>'controlType'='Día y turno de la semana' then
        for i in 0..1 loop
          candidate := execution_day+i;
          if plan.payload->'assignedDays' ? weekdays[extract(dow from candidate)::integer+1]
            and not exists(select 1 from public.engrase_sync where store='lubrication_records' and not deleted
              and coalesce(payload->>'active','true')='true' and (payload->>'date')::timestamptz at time zone 'America/Managua' >= candidate
              and (payload->>'date')::timestamptz at time zone 'America/Managua' < candidate+interval '1 day') then candidates := array_append(candidates,candidate); end if;
        end loop;
        if cardinality(candidates)=1 then satisfied := plan.id||':'||candidates[1]::text; end if;
      else satisfied := occurrence; end if;
    end if;
    snapshot := jsonb_build_object('equipmentLocationIdAtExecution',equipment.payload->>'locationId','executionLocationId',equipment.payload->>'locationId',
      'crewId',crew_id,'crewLocationIdAtExecution',crew.payload->>'locationId','performedByUserId',p_performed_by,
      'shiftId',p_shift_id,'assignmentId',p_assignment_id,'executionType',p_execution_type,'outOfPlanReason',p_out_of_plan_reason,
      'executionCompleteness',case when complete then 'COMPLETE' else 'PARTIAL' end,'satisfiedOccurrenceKey',satisfied);
    row_payload := jsonb_build_object('id',p_record_id,'equipmentId',p_equipment_id,'planId',p_plan_id,'date',p_execution_date,
      'shiftId',p_shift_id,'userId',p_performed_by,'userName',performer_name,'retroactivo',p_retroactive,
      'sinHorometro',p_no_hourmeter,'noHourmeterReason',p_no_hourmeter_reason,'operationalSnapshot',snapshot,
      'createdAt',p_client_captured_at,'createdBy',actor.display_name,'capturadoPor',case when p_retroactive then actor.display_name else null end,
      'capturedByAuthUserId',actor.auth_user_id,'capturedByAppUserId',actor.app_user_id,'capturedAt',stamp_at,'active',true);
  else row_payload := original.payload; end if;
  row_payload := row_payload || jsonb_build_object('hourmeter',p_hourmeter,'greaseType',p_lubricant_id,'qty',p_quantity,
    'condition',p_condition,'notes',p_notes,'details',normalized_details,'photos',p_photos,'photo',p_photos->0,'updatedAt',stamp_at);
  is_latest := not exists(select 1 from public.engrase_sync where store='lubrication_records' and id<>p_record_id and not deleted
    and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id
    and ((payload->>'date')::timestamptz > p_execution_date or (p_action='EDIT' and (payload->>'date')::timestamptz=p_execution_date and id collate "C" < p_record_id collate "C")));
  if p_action='CREATE' and not p_no_hourmeter and not p_retroactive
    and p_hourmeter < coalesce((equipment.payload->>'hourmeter')::numeric,0) then
    return jsonb_build_object('status','DENIED','code','HOURMETER_REGRESSION');
  end if;
  if p_action='EDIT' and is_latest and p_hourmeter < coalesce((equipment.payload->>'hourmeter')::numeric,0) then
    return jsonb_build_object('status','DENIED','code','HOURMETER_REGRESSION');
  end if;
  -- All validation finishes before the first write. Exceptions still roll back the whole RPC.
  -- Keep versions monotonic even if an older client supplied a future device timestamp.
  -- This version clock is distinct from the trusted capturedAt/completedAt clock.
  version_at := greatest(clock_timestamp(),equipment.updated_at + interval '1 microsecond',
    plan.updated_at + interval '1 microsecond',original.updated_at + interval '1 microsecond',assignment.updated_at + interval '1 microsecond');
  row_payload := row_payload || jsonb_build_object('updatedAt',version_at);
  insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('lubrication_records',p_record_id,row_payload,version_at,false)
    on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
  if is_latest and (p_action='EDIT' or not p_no_hourmeter) then
    if p_action='EDIT' or not p_retroactive or p_hourmeter > coalesce((equipment.payload->>'hourmeter')::numeric,0) then
      update public.engrase_sync set payload=payload||jsonb_build_object('hourmeter',p_hourmeter,'updatedAt',version_at),updated_at=version_at
        where store='equipment' and id=p_equipment_id;
    end if;
    if plan.id is not null and (plan.payload->>'controlType'<>'Horas de operación' or complete) then
      update public.engrase_sync set payload=payload||jsonb_build_object('lastGreaseHour',p_hourmeter,'updatedAt',version_at),updated_at=version_at
        where store='lubrication_plans' and id=p_plan_id;
    end if;
  elsif p_action='CREATE' and p_no_hourmeter and plan.payload->>'controlType'='Horas de operación' then
    update public.engrase_sync set payload=payload||jsonb_build_object('lastGreaseDateNoHm',p_execution_date,'updatedAt',version_at),updated_at=version_at
      where store='lubrication_plans' and id=p_plan_id;
  end if;
  if p_action='CREATE' and assignment.id is not null then
    update public.engrase_sync set payload=payload||jsonb_build_object('status','COMPLETED','completedAt',stamp_at,'completedRecordId',p_record_id,'updatedAt',version_at),updated_at=version_at
      where store='lubrication_assignments' and id=assignment.id;
  end if;
  insert into public.engrase_sync(store,id,payload,updated_at,deleted)
    values('audit_log','execution:'||actor.auth_user_id::text||':'||p_operation_id,
      jsonb_build_object('id','execution:'||actor.auth_user_id::text||':'||p_operation_id,'action',case when p_action='EDIT' then 'ENGRASE_EDITADO'
        when p_retroactive then 'ENGRASE_RETROACTIVO_REGISTRADO' else 'ENGRASE_REGISTRADO' end,
        'detail',coalesce(equipment.payload->>'code',p_equipment_id)||' · registro '||p_execution_date::text||' · '||p_hourmeter::text||' h',
        'user',actor.display_name,'authUserId',actor.auth_user_id,'appUserId',actor.app_user_id,'createdAt',stamp_at,'updatedAt',version_at,'active',true),version_at,false);
  if p_action='CREATE' and (p_execution_type='OUT_OF_PLAN' or assignment.id is not null) then
    insert into public.engrase_sync(store,id,payload,updated_at,deleted)
      values('audit_log','execution-effect:'||actor.auth_user_id::text||':'||p_operation_id,
        jsonb_build_object('id','execution-effect:'||actor.auth_user_id::text||':'||p_operation_id,
          'action',case when assignment.id is not null then 'GREASE_ASSIGNMENT_COMPLETED' else 'OUT_OF_PLAN_GREASE_RECORDED' end,
          'detail',jsonb_build_object('recordId',p_record_id,'equipmentId',p_equipment_id,'assignmentId',assignment.id,
            'reason',p_out_of_plan_reason,'completeness',case when complete then 'COMPLETE' else 'PARTIAL' end,'satisfiedOccurrenceKey',satisfied)::text,
          'user',actor.display_name,'authUserId',actor.auth_user_id,'appUserId',actor.app_user_id,'createdAt',stamp_at,'updatedAt',version_at,'active',true),version_at,false);
  end if;
  select jsonb_agg(jsonb_build_object('store',store,'id',id,'payload',payload,'updated_at',updated_at)) into canonical
    from public.engrase_sync where (store='lubrication_records' and id=p_record_id) or (store='equipment' and id=p_equipment_id)
      or (store='lubrication_plans' and id=p_plan_id) or (p_action='CREATE' and store='lubrication_assignments' and id=assignment.id);
  result := jsonb_build_object('status','APPLIED','rows',canonical);
  insert into public.lubrication_execution_receipts(auth_user_id,operation_id,request,result) values(actor.auth_user_id,p_operation_id,request,result);
  return result;
end;
$gateway$;

revoke all on function public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz) from public, anon;
grant execute on function public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz) to authenticated;
commit;
