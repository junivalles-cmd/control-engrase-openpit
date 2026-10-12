-- PREPARED ONLY, manual deployment. Requires 0003 schema/functions and 0009;
-- does NOT require 0008 or 0007. No migration runner is configured in Pages.
-- Install RPCs before compatible clients. Restrictive policies at the end enforce
-- RPC-only writes for these two stores; old direct-write clients must be retired.
begin;
do $preconditions$
begin
  if to_regprocedure('public.lubrication_execution(text,text,text,text,text,text,text,timestamptz,timestamptz,text,text,text,text,boolean,numeric,boolean,text,text,numeric,text,text,jsonb,jsonb,timestamptz,timestamptz,timestamptz,timestamptz)') is null then
    raise exception '0010 requires installed 0009 endpoint';
  end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='public.engrase_sync'::regclass
    and relrowsecurity and not relforcerowsecurity and relowner=(select oid from pg_catalog.pg_roles where rolname=current_user)) then
    raise exception '0010 installer must own engrase_sync; RLS enabled, FORCE RLS disabled';
  end if;
  if not exists(select 1 from pg_catalog.pg_class where oid='storage.objects'::regclass and relrowsecurity) then
    raise exception '0010 requires existing Storage objects RLS';
  end if;
end $preconditions$;
create table public.evidence_operation_receipts (
  auth_user_id uuid not null, operation_id text not null, request jsonb not null,
  result jsonb not null, primary key(auth_user_id,operation_id)
);
alter table public.evidence_operation_receipts enable row level security;
revoke all on public.evidence_operation_receipts from public,anon,authenticated;

-- Private typed implementation. No arbitrary store, actor, fields or payload.
create function public.evidence_operation(
  p_operation_id text, p_action text, p_id text, p_equipment_id text,
  p_crew_id text, p_expected timestamptz, p_component text, p_description text,
  p_criticality text, p_status text, p_photos jsonb, p_note text,
  p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text,
  p_expected_signatures jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $evidence$
declare
  actor public.app_profiles%rowtype;
  equipment public.engrase_sync%rowtype;
  original public.engrase_sync%rowtype;
  record public.engrase_sync%rowtype;
  receipt public.evidence_operation_receipts%rowtype;
  request jsonb; result jsonb; row_payload jsonb; rows jsonb := '[]';
  signatures jsonb; ids jsonb; resolution jsonb; detail jsonb; details jsonb;
  point_id text; component text; description text; criticality text;
  row_id text; destination text; crew_id text := p_crew_id;
  n integer; repetitions integer; at timestamptz; revision timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into actor from public.app_profiles where auth_user_id=auth.uid() for share;
  if not found or actor.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','INVALID_ROLE'); end if;
  if nullif(p_operation_id,'') is null or p_action is null or p_action not in ('REPORT','EDIT','CLOSE','RETIRE','AUTOMATIC','CAPTURE','RESOLVE') then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;
  if p_action='AUTOMATIC' and p_operation_id is distinct from 'auto:'||p_record_id then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;
  lock table public.engrase_sync in share row exclusive mode;
  at := clock_timestamp();
  request := jsonb_build_array(p_action,p_id,p_equipment_id,p_crew_id,p_expected,p_component,p_description,
    p_criticality,p_status,p_photos,p_note,p_record_id,p_signer_name,p_signer_role,p_signature_url,p_expected_signatures);
  if p_action in ('AUTOMATIC','CAPTURE','RESOLVE') then
    select * into record from public.engrase_sync where store='lubrication_records' and id=p_record_id and not deleted
      and coalesce(payload->>'active','true')='true';
    if not found then return jsonb_build_object('status','DENIED','code','RECORD_NOT_FOUND'); end if;
    select * into equipment from public.engrase_sync where store='equipment' and id=record.payload->>'equipmentId' and not deleted;
  elsif p_action='REPORT' then
    select * into equipment from public.engrase_sync where store='equipment' and id=p_equipment_id and not deleted;
  else
    select * into original from public.engrase_sync where store='anomalies' and id=p_id;
    if not found then return jsonb_build_object('status','DENIED','code','ANOMALY_NOT_FOUND'); end if;
    select * into equipment from public.engrase_sync where store='equipment' and id=original.payload->>'equipmentId' and not deleted;
  end if;
  if equipment.id is null or coalesce(equipment.payload->>'active','true')<>'true' then
    return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND'); end if;
  if actor.role in ('SUPERVISOR','LUBRICADOR') then
    if crew_id is null then
      select count(*),min(id) into n,crew_id from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
      if n<>1 then return jsonb_build_object('status','DENIED','code','CREW_SELECTION_REQUIRED'); end if;
    end if;
    perform 1 from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id
      and nullif(payload->>'locationId','')=equipment.payload->>'locationId';
    if not found then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
  end if;
  if p_action='AUTOMATIC' then
    -- Delegation is only for this actor's accepted 0009 execution, not a general editor.
    if record.payload->>'capturedByAuthUserId' is distinct from auth.uid()::text then
      return jsonb_build_object('status','DENIED','code','EXECUTION_ACTOR_DENIED'); end if;
    perform 1 from public.app_store_permissions where role=actor.role and store='lubrication_records' and can_insert;
  elsif p_action in ('CAPTURE','RESOLVE') then
    if p_action='RESOLVE' and actor.role<>'ADMINISTRADOR' then
      return jsonb_build_object('status','DENIED','code','ADMIN_REQUIRED'); end if;
    perform 1 from public.app_store_permissions where role=actor.role and store='grease_validations'
      and case when p_action='CAPTURE' then can_insert else can_update end;
  else
    if actor.role='PLANIFICADOR' or (p_action='RETIRE' and actor.role<>'ADMINISTRADOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
    if actor.role='LUBRICADOR' and p_action<>'REPORT'
      and original.payload->>'capturedByAuthUserId' is distinct from auth.uid()::text then
      return jsonb_build_object('status','DENIED','code','ANOMALY_OWNER_DENIED'); end if;
    -- Own correction is delegated by I; it never grants generic U on anomalies.
    perform 1 from public.app_store_permissions where role=actor.role and store='anomalies'
      and case when p_action='RETIRE' then can_delete
        when p_action='REPORT' or actor.role='LUBRICADOR' then can_insert else can_update end;
  end if;
  if not found then return jsonb_build_object('status','DENIED','code','PERMISSION_DENIED'); end if;
  select * into receipt from public.evidence_operation_receipts where auth_user_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.request<>request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    return receipt.result;
  end if;
  if p_action in ('EDIT','CLOSE','RETIRE') and (original.deleted or coalesce(original.payload->>'active','true')<>'true') then
    return jsonb_build_object('status','DENIED','code','ANOMALY_NOT_FOUND'); end if;
  if p_action in ('EDIT','CLOSE','RETIRE') and original.updated_at is distinct from p_expected then
    return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT'); end if;
  if p_action in ('CAPTURE','AUTOMATIC') and record.updated_at is distinct from p_expected then
    return jsonb_build_object('status','CONFLICT','code','RECORD_VERSION_CONFLICT'); end if;
  if p_action='AUTOMATIC' and not exists(
    select 1 from public.lubrication_execution_receipts r,
      jsonb_array_elements(r.result->'rows') accepted
    where r.auth_user_id=auth.uid() and r.request->>0='CREATE' and r.request->>1=record.id
      and accepted->>'store'='lubrication_records' and accepted->>'id'=record.id
      and accepted->'payload'=record.payload
  ) then return jsonb_build_object('status','DENIED','code','EXECUTION_NOT_ACCEPTED'); end if;

  if p_action in ('REPORT','EDIT','CLOSE','RETIRE') then
    if p_action in ('REPORT','EDIT') and (nullif(p_id,'') is null or nullif(btrim(p_component),'') is null or nullif(btrim(p_description),'') is null
      or p_criticality is null or p_criticality not in ('Baja','Media','Alta','Crítica') or jsonb_typeof(p_photos) is distinct from 'array') then
      return jsonb_build_object('status','DENIED','code','INVALID_ANOMALY'); end if;
    if p_action in ('REPORT','EDIT') and (
      exists(select 1 from jsonb_array_elements(p_photos) x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^https://')) then
      return jsonb_build_object('status','DENIED','code','INVALID_ANOMALY'); end if;
    -- Existing editor exposes every transition among these three real states (including reopen).
    if p_action='EDIT' and (p_status is null or p_status not in ('Abierta','En atención','Cerrada') or
      original.payload->>'status' not in ('Abierta','En atención','Cerrada')) then
      return jsonb_build_object('status','DENIED','code','INVALID_TRANSITION'); end if;
    if p_action='CLOSE' and original.payload->>'status' not in ('Abierta','En atención') then
      return jsonb_build_object('status','DENIED','code','INVALID_TRANSITION'); end if;
    destination:='anomalies'; row_id:=p_id;
    row_payload:=case when p_action='REPORT' then jsonb_build_object('id',p_id,'active',true,'createdAt',at,
      'createdBy',actor.display_name,'capturedByAuthUserId',auth.uid(),'capturedByUserId',actor.app_user_id,
      'equipmentId',equipment.id,'locationId',equipment.payload->>'locationId','crewId',crew_id,'status','Abierta') else original.payload end;
    if p_action in ('REPORT','EDIT') then row_payload:=row_payload||jsonb_build_object('component',p_component,'description',p_description,
      'criticality',p_criticality,'photos',p_photos,'photo',p_photos->0); end if;
    if p_action='EDIT' then row_payload:=row_payload||jsonb_build_object('status',p_status); end if;
    if p_action='CLOSE' then row_payload:=row_payload||jsonb_build_object('status','Cerrada','resolutionNote',p_note); end if;
    if p_action='RETIRE' then row_payload:=row_payload||jsonb_build_object('active',false); end if;
    revision:=greatest(at,coalesce(original.updated_at,at)+interval '1 microsecond');
    row_payload:=row_payload||jsonb_build_object('updatedAt',revision,'updatedByAuthUserId',auth.uid());
    if p_action='REPORT' and exists(select 1 from public.engrase_sync where store=destination and id=row_id) then
      return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
    insert into public.engrase_sync(store,id,payload,updated_at,deleted) values(destination,row_id,row_payload,revision,p_action='RETIRE')
      on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at,deleted=excluded.deleted;
    rows:=jsonb_build_array(jsonb_build_object('store',destination,'id',row_id,'payload',row_payload,'updated_at',revision));
  elsif p_action='AUTOMATIC' then
    details:=coalesce(record.payload->'details','[]');
    if record.payload->>'sinHorometro'='true' then details:=details||jsonb_build_array(jsonb_build_object(
      'pointId','__horometro__','pointName','Horómetro','done',false,'reason',coalesce(record.payload->>'noHourmeterReason','Horómetro no legible'))); end if;
    for detail in select value from jsonb_array_elements(details) loop
      if detail->>'done' is distinct from 'false' then continue; end if;
      point_id:=detail->>'pointId';
      select count(*) into n from public.engrase_sync where store='anomalies' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=equipment.id
        and payload->>'autoPointId'=point_id and payload->>'status'<>'Cerrada';
      if n>1 then raise exception using errcode='P2B01',message='AUTOMATIC_ANOMALY_AMBIGUOUS'; end if;
      select * into original from public.engrase_sync where store='anomalies' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=equipment.id
        and payload->>'autoPointId'=point_id and payload->>'status'<>'Cerrada';
      if original.id is null and point_id='__horometro__' and detail->>'reason'='El equipo no tiene horómetro' then continue; end if;
      row_id:=coalesce(original.id,'auto:'||p_record_id||':'||point_id);
      if original.id is null and exists(select 1 from public.engrase_sync where store='anomalies' and id=row_id) then
        raise exception using errcode='P2B02',message='AUTOMATIC_ID_CONFLICT'; end if;
      repetitions:=case when original.id is null then 1 else coalesce(nullif((original.payload->>'repeticiones')::integer,0),1)+1 end;
      component:=case when point_id='__horometro__' then 'Horómetro' else coalesce(nullif(detail->>'reason',''),'Sin motivo indicado') end;
      criticality:=case component when 'Falla mecánica' then 'Crítica' when 'Grasera dañada' then 'Alta'
        when 'Línea de engrase obstruida' then 'Alta' when 'Sello dañado' then 'Alta'
        when 'Equipo trabajando' then 'Baja' when 'Equipo detenido' then 'Baja' else 'Media' end;
      description:=coalesce(detail->>'pointName',point_id)||': '||coalesce(detail->>'reason','Otro')||'. Reportado '||repetitions||' veces.';
      row_payload:=coalesce(original.payload,jsonb_build_object('id',row_id,'equipmentId',equipment.id,'locationId',equipment.payload->>'locationId',
        'crewId',crew_id,'createdAt',at,'createdBy',actor.display_name,'capturedByAuthUserId',auth.uid(),
        'capturedByUserId',actor.app_user_id,'active',true,'status','Abierta','autoGenerada',true,'autoPointId',point_id,
        'component',component,'criticality',criticality,'photos',case when point_id='__horometro__' then '[]'::jsonb else coalesce(record.payload->'photos','[]') end));
      revision:=greatest(at,coalesce(original.updated_at,at)+interval '1 microsecond');
      row_payload:=row_payload||jsonb_build_object('description',description,'repeticiones',repetitions,'updatedAt',revision,'lastExecutionId',p_record_id);
      insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('anomalies',row_id,row_payload,revision,false)
        on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
      rows:=rows||jsonb_build_array(jsonb_build_object('store','anomalies','id',row_id,'payload',row_payload,'updated_at',revision));
    end loop;
  elsif p_action='CAPTURE' then
    if nullif(p_signature_url,'') is null or nullif(p_id,'') is null or nullif(btrim(p_signer_name),'') is null or p_signer_role is null or p_signer_role not in ('OPERADOR','ENCARGADO')
      or (p_signer_role='ENCARGADO' and nullif(btrim(p_note),'') is null)
      or p_signature_url !~ ('^https://[^?#]+/grease_validations/'||p_id||'\.png$')
      or p_id !~ '^[A-Za-z0-9_-]+$' then return jsonb_build_object('status','DENIED','code','INVALID_SIGNATURE'); end if;
    if actor.role='SUPERVISOR' and (p_signer_role<>'ENCARGADO' or btrim(p_signer_name)<>actor.display_name) then
      return jsonb_build_object('status','DENIED','code','INVALID_SIGNER_ROLE'); end if;
    -- Storage owns the object; a caller cannot substitute a different host/object
    -- as evidence. The canonical reference is derived, never accepted as authority.
    perform 1 from storage.objects o where o.bucket_id='engrase-photos' and o.name='grease_validations/'||p_id||'.png'
      and coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=auth.uid()::text;
    if not found then return jsonb_build_object('status','DENIED','code','SIGNATURE_OBJECT_DENIED'); end if;
    if exists(select 1 from public.engrase_sync where store='grease_validations' and
      (id=p_id or payload->>'signatureUrl'=p_signature_url)) then return jsonb_build_object('status','CONFLICT','code','SIGNATURE_EXISTS'); end if;
    row_payload:=jsonb_build_object('id',p_id,'active',true,'lubricationRecordId',record.id,'equipmentId',equipment.id,
      'signerName',btrim(p_signer_name),'signerRole',p_signer_role,'reason',p_note,'signatureUrl','grease_validations/'||p_id||'.png',
      'signedAt',at,'createdAt',at,'updatedAt',at,'createdBy',actor.display_name,'signerUserId',actor.app_user_id,
      'capturedByAuthUserId',auth.uid(),'recordVersion',record.updated_at,'recordSnapshot',record.payload);
    insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('grease_validations',p_id,row_payload,at,false);
    rows:=jsonb_build_array(jsonb_build_object('store','grease_validations','id',p_id,'payload',row_payload,'updated_at',at));
  else
    select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at) order by id),jsonb_agg(to_jsonb(id) order by id),count(*)
      into signatures,ids,n from public.engrase_sync where store='grease_validations' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'lubricationRecordId'=record.id;
    if n<2 or not ids ? p_id or nullif(btrim(p_note),'') is null then
      return jsonb_build_object('status','DENIED','code','INVALID_RESOLUTION'); end if;
    if signatures is distinct from p_expected_signatures then
      select jsonb_agg(jsonb_build_object('store',store,'id',id,'payload',payload,'updated_at',updated_at)) into rows
        from public.engrase_sync where store='grease_validations' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'lubricationRecordId'=record.id;
      return jsonb_build_object('status','CONFLICT','code','SIGNATURES_VERSION_CONFLICT','rows',rows);
    end if;
    select * into original from public.engrase_sync where store='grease_validations' and id=ids->>0;
    resolution:=jsonb_build_object('id',p_operation_id,'officialValidationId',p_id,'signatureIds',ids,'resolvedById',actor.app_user_id,
      'resolvedByAuthUserId',auth.uid(),'resolvedByName',actor.display_name,'resolvedAt',at,'reason',btrim(p_note),
      'selectedRecordVersion',(select payload->'recordVersion' from public.engrase_sync where store='grease_validations' and id=p_id),
      'history',coalesce(original.payload->'conflictResolution'->'history','[]')||case when original.payload ? 'conflictResolution'
        then jsonb_build_array((original.payload->'conflictResolution')-'history') else '[]'::jsonb end);
    revision:=greatest(at,original.updated_at+interval '1 microsecond');
    row_payload:=original.payload||jsonb_build_object('conflictResolution',resolution,'updatedAt',revision);
    update public.engrase_sync set payload=row_payload,updated_at=revision where store='grease_validations' and id=original.id;
    rows:=jsonb_build_array(jsonb_build_object('store','grease_validations','id',original.id,'payload',row_payload,'updated_at',revision));
  end if;
  insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('audit_log','evidence:'||auth.uid()||':'||p_operation_id,
    jsonb_build_object('id','evidence:'||auth.uid()||':'||p_operation_id,'active',true,'action','EVIDENCE_'||p_action,
      'entityId',coalesce(p_record_id,p_id),'user',actor.display_name,'actorAuthUserId',auth.uid(),'createdAt',at,'updatedAt',at),at,false);
  result:=jsonb_build_object('status','APPLIED','rows',rows);
  insert into public.evidence_operation_receipts values(auth.uid(),p_operation_id,request,result);
  return result;
exception when sqlstate 'P2B01' then
  -- Entire function subtransaction rolls back, including earlier points in this loop.
  return jsonb_build_object('status','CONFLICT','code','AUTOMATIC_ANOMALY_AMBIGUOUS');
when sqlstate 'P2B02' then
  return jsonb_build_object('status','CONFLICT','code','AUTOMATIC_ID_CONFLICT');
end $evidence$;
revoke all on function public.evidence_operation(text,text,text,text,text,timestamptz,text,text,text,text,jsonb,text,text,text,text,text,jsonb) from public,anon,authenticated;

create function public.report_anomaly(p_operation_id text,p_id text,p_equipment_id text,p_crew_id text,p_component text,p_description text,p_criticality text,p_photos jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'REPORT',p_id,p_equipment_id,p_crew_id,null,p_component,p_description,p_criticality,null,p_photos,null,null,null,null,null,null); $$;
create function public.edit_anomaly(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_component text,p_description text,p_criticality text,p_status text,p_photos jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'EDIT',p_id,null,p_crew_id,p_expected,p_component,p_description,p_criticality,p_status,p_photos,null,null,null,null,null,null); $$;
create function public.close_anomaly(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_note text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'CLOSE',p_id,null,p_crew_id,p_expected,null,null,null,null,null,p_note,null,null,null,null,null); $$;
create function public.retire_anomaly(p_operation_id text,p_id text,p_expected timestamptz)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'RETIRE',p_id,null,null,p_expected,null,null,null,null,null,null,null,null,null,null,null); $$;
create function public.repeat_anomaly_from_execution(p_operation_id text,p_record_id text,p_crew_id text,p_expected timestamptz)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'AUTOMATIC',null,null,p_crew_id,p_expected,null,null,null,null,null,null,p_record_id,null,null,null,null); $$;
create function public.capture_grease_validation(p_operation_id text,p_id text,p_record_id text,p_crew_id text,p_expected timestamptz,p_signer_name text,p_signer_role text,p_note text,p_signature_url text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'CAPTURE',p_id,null,p_crew_id,p_expected,null,null,null,null,null,p_note,p_record_id,p_signer_name,p_signer_role,p_signature_url,null); $$;
create function public.resolve_grease_validation_conflict(p_operation_id text,p_record_id text,p_id text,p_note text,p_expected_signatures jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'RESOLVE',p_id,null,null,null,null,null,null,null,null,p_note,p_record_id,null,null,null,p_expected_signatures); $$;
revoke all on function public.report_anomaly(text,text,text,text,text,text,text,jsonb),public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb),
 public.close_anomaly(text,text,text,timestamptz,text),public.retire_anomaly(text,text,timestamptz),public.repeat_anomaly_from_execution(text,text,text,timestamptz),
 public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text),public.resolve_grease_validation_conflict(text,text,text,text,jsonb) from public,anon;
grant execute on function public.report_anomaly(text,text,text,text,text,text,text,jsonb),public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb),
 public.close_anomaly(text,text,text,timestamptz,text),public.retire_anomaly(text,text,timestamptz),public.repeat_anomaly_from_execution(text,text,text,timestamptz),
 public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text),public.resolve_grease_validation_conflict(text,text,text,text,jsonb) to authenticated;

-- Restrictive guards intersect even the legacy permissive ALL/true policy.
-- SECURITY DEFINER owner must own engrase_sync and it must NOT be FORCE RLS.
create policy evidence_rpc_insert_only on public.engrase_sync as restrictive for insert to public
 with check(store not in ('anomalies','grease_validations'));
create policy evidence_rpc_update_only on public.engrase_sync as restrictive for update to public
 using(store not in ('anomalies','grease_validations')) with check(store not in ('anomalies','grease_validations'));
create policy evidence_rpc_delete_only on public.engrase_sync as restrictive for delete to public
 using(store not in ('anomalies','grease_validations'));
-- Minimal evidence immutability guards, not a bucket/privacy redesign.
-- INSERT remains governed by existing Storage policies; no overwrite or unlink
-- of ANY signature object (including an upload pending its RPC acknowledgment).
create policy signature_objects_immutable_update on storage.objects as restrictive for update to public
 using(not (bucket_id='engrase-photos' and name like 'grease_validations/%'))
 with check(not (bucket_id='engrase-photos' and name like 'grease_validations/%'));
create policy signature_objects_immutable_delete on storage.objects as restrictive for delete to public
 using(not (bucket_id='engrase-photos' and name like 'grease_validations/%'));
commit;
