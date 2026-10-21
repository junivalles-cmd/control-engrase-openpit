-- MANUAL-PRODUCTION-PREPARED: additive PRE-CUTOVER after 0009/0010/0012,
-- repaired 0013 (all eight gates/readiness=true) and 0011 PASS. Apply manually
-- as postgres after docs/0014_PRODUCTION_PREFLIGHT_READ_ONLY.sql and queue
-- review; preparation does not authorize execution. Complete transaction only.
-- PRE-0008: typed, idempotent assignment and immutable skip operations.
-- Requires 0012 authorization bootstrap and 0013 restrictive row scope.
-- Generic writes to these stores must be disabled in the target matrix.
-- This migration does not edit that matrix: the three new PUBLIC restrictive
-- guards deny generic assignment/skip/record mutations even with legacy.
-- They also narrow anon writes to these two stores; other legacy anon access
-- and SELECT remain exposed. New wrappers/receipts grant nothing to anon.
-- Keep authorization_private outside Data API. Public typed wrappers and their
-- exact ACLs are listed in docs/SUPPORT_OTHER_LOCATION_0014.md. Dispatchers
-- assignment_skip_operation/evidence_operation remain non-executable by API.
-- All affected tables/0012/0013 helpers must retain postgres ownership and
-- FORCE RLS=false; engrase_sync RLS=true. New 0014 objects must be absent.
-- No 0007/0008/0015/cutover, master-location change or local-cache change.
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


-- Exact installed-body baseline, not merely object names. Stop on drift/partial installs.
do $baseline$
begin
 if exists(select 1 from (values ('public','lubrication_execution','5ed654859d0a92b618e8e20c8e31c2ad'),
('public','evidence_operation','778da7b8505bd8225bb160ab50dcc8fb'),
('public','operational_catalog_operation','d7b2e1459602852a551eee7ba9b6857f'),
('public','resolve_authorization_scope','29d1220cc0bd9ec3f03d50cffd82ec8f'),
('authorization_private','authorization_row_in_scope','c741089d1a767afd7eef83b245ffea43'),
('public','get_authorization_context','aac0a7bc32da3064da2da7e79be91d02')) expected(schema_name,function_name,body_md5)
 left join pg_catalog.pg_namespace n on n.nspname=expected.schema_name
 left join pg_catalog.pg_proc p on p.pronamespace=n.oid and p.proname=expected.function_name
 where p.oid is null or md5(replace(p.prosrc,E'\r\n',E'\n'))<>expected.body_md5
 or p.proowner<>(select oid from pg_roles where rolname=current_user) or not p.prosecdef)
 then raise exception '0014 baseline/ownership drift: run read-only preflight and review function definitions'; end if;
 if (select count(*) from pg_policies where schemaname='public' and tablename='engrase_sync'
   and policyname in ('authorization_store_select','authorization_store_insert','authorization_store_update','authorization_store_delete',
     'authorization_scope_select','authorization_scope_insert','authorization_scope_update','authorization_scope_delete')
   and permissive='RESTRICTIVE' and roles=array['authenticated']::name[])<>8
 then raise exception '0014 requires all eight repaired 0013 gates'; end if;
 if exists(select 1 from pg_class where oid in ('public.engrase_sync'::regclass,'public.app_profiles'::regclass,'public.app_store_permissions'::regclass)
   and (relowner<>(select oid from pg_roles where rolname=current_user) or relforcerowsecurity))
 then raise exception '0014 requires owner installation and FORCE RLS disabled'; end if;
end $baseline$;

-- SUPPORT-V2: materialized provenance is written ONLY by owner gateways.
-- No legacy rows are rewritten/backfilled. NULL metadata is supported by relations.
create table authorization_private.support_control (
  singleton boolean primary key default true check(singleton), enabled boolean not null
);
insert into authorization_private.support_control values(true,true);
create table authorization_private.support_links (
  store text not null, entity_id text not null, assignment_id text not null,
  crew_id text not null, equipment_id text not null, plan_id text not null,
  occurrence_key text not null, accepted_at timestamptz not null default clock_timestamp(),
  primary key(store,entity_id,crew_id)
);
revoke all on authorization_private.support_control,authorization_private.support_links from public,anon,authenticated;
alter table authorization_private.support_control enable row level security;
alter table authorization_private.support_links enable row level security;

create function authorization_private.support_occurrence_valid(p_plan text,p_key text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare tail text; d text;
begin
  if p_plan is null or p_key is null or left(p_key,length(p_plan)+1)<>p_plan||':' then return false; end if;
  tail:=substr(p_key,length(p_plan)+2);
  if tail ~ '^h:[0-9]+(\.[0-9]+)?$' then return true; end if;
  if tail !~ '^\d{4}-\d{2}-\d{2}(:shift_(dia|noche))?$' then return false; end if;
  d:=left(tail,10); return (d::date)::text=d;
exception when others then return false;
end $$;

create function authorization_private.support_assignment_valid(p_id text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.engrase_sync a
 join public.engrase_sync e on e.store='equipment' and e.id=a.payload->>'equipmentId' and not e.deleted and coalesce(e.payload->>'active','true')='true'
 join public.engrase_sync p on p.store='lubrication_plans' and p.id=a.payload->>'planId' and p.payload->>'equipmentId'=e.id and not p.deleted and coalesce(p.payload->>'active','true')='true'
 join public.engrase_sync c on c.store='cuadrillas' and c.id=a.payload->>'assignedCrewId' and not c.deleted and coalesce(c.payload->>'active','true')='true'
 join public.engrase_sync el on el.store='locations' and el.id=e.payload->>'locationId' and not el.deleted and coalesce(el.payload->>'active','true')='true'
 join public.engrase_sync cl on cl.store='locations' and cl.id=c.payload->>'locationId' and not cl.deleted and coalesce(cl.payload->>'active','true')='true'
 where a.store='lubrication_assignments' and a.id=p_id and not a.deleted
 and coalesce(a.payload->>'active','true')='true' and a.payload->>'status'='PENDING'
 and authorization_private.support_occurrence_valid(p.id,a.payload->>'occurrenceKey')
 and (select enabled from authorization_private.support_control where singleton)
 and (select count(*) from public.engrase_sync other where other.store='lubrication_assignments' and not other.deleted
   and coalesce(other.payload->>'active','true')='true' and other.payload->>'status'='PENDING'
   and other.payload->>'occurrenceKey'=a.payload->>'occurrenceKey')=1);
$$;

create function authorization_private.support_history_allowed(p_store text,p_id text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from authorization_private.support_links l,
 lateral (select public.resolve_authorization_scope(auth.uid()) as c) ctx
 where l.store=p_store and l.entity_id=p_id and ctx.c->>'status'='AUTHORIZED'
 and (ctx.c->'context'->'authorizedCrewIds' ? l.crew_id));
$$;

create function authorization_private.link_support_entity(p_store text,p_id text,p_assignment text,p_crew text default null)
returns void language sql volatile security definer set search_path=pg_catalog as $$
 insert into authorization_private.support_links(store,entity_id,assignment_id,crew_id,equipment_id,plan_id,occurrence_key)
 select p_store,p_id,a.id,coalesce(p_crew,a.payload->>'assignedCrewId'),a.payload->>'equipmentId',a.payload->>'planId',a.payload->>'occurrenceKey'
 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=p_assignment
 on conflict do nothing;
$$;

create function authorization_private.support_grant_rows()
returns table(store text,id text) language sql stable security definer set search_path=pg_catalog as $$
 with ctx as (select public.resolve_authorization_scope(auth.uid()) as c),
 operational as (
   select a.id,a.payload from public.engrase_sync a,ctx where a.store='lubrication_assignments'
   and ctx.c->>'status'='AUTHORIZED' and ctx.c->'context'->'authorizedCrewIds' ? (a.payload->>'assignedCrewId')
   and authorization_private.support_assignment_valid(a.id)
 ), historical as (
   select l.* from authorization_private.support_links l,ctx where ctx.c->>'status'='AUTHORIZED'
   and ctx.c->'context'->'authorizedCrewIds' ? l.crew_id
 ), refs as (
   select o.id assignment_id,o.payload->>'equipmentId' equipment_id,o.payload->>'planId' plan_id from operational o
   union select h.assignment_id,h.equipment_id,h.plan_id from historical h
 )
 select 'lubrication_assignments',r.assignment_id from refs r
 union select 'equipment',r.equipment_id from refs r
 union select 'lubrication_plans',r.plan_id from refs r
 union select 'lubrication_points',p.id from public.engrase_sync p join operational a on p.store='lubrication_points' and p.payload->>'planId'=a.payload->>'planId'
 union select 'locations',e.payload->>'locationId' from public.engrase_sync e join refs r on e.store='equipment' and e.id=r.equipment_id
 union select h.store,h.entity_id from historical h;
$$;

-- SELECT exception only. Preserve the baseline classifier verbatim for all writes.
alter function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)
 rename to authorization_row_in_scope_baseline_0013;
create function authorization_private.authorization_row_in_scope(p_store text,p_id text,p_payload jsonb,p_action text,p_context jsonb)
returns boolean language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_action='SELECT' and auth.uid() is not null and p_context->>'status'='AUTHORIZED'
   and p_context->'context'->>'authUserId'=auth.uid()::text
   and exists(select 1 from authorization_private.support_grant_rows() g where g.store=p_store and g.id=p_id) then return true; end if;
 return authorization_private.authorization_row_in_scope_baseline_0013(p_store,p_id,p_payload,p_action,p_context);
end $$;
-- Policies depend on function OIDs: retarget SELECT; I/U/D keep the unchanged baseline.

create function public.get_assignment_support_context()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 with ctx as (select public.get_authorization_context() as c),
 ops as (select coalesce(jsonb_agg(jsonb_build_object('assignmentId',a.id,'assignedCrewId',a.payload->>'assignedCrewId',
   'equipmentId',a.payload->>'equipmentId','planId',a.payload->>'planId','occurrenceKey',a.payload->>'occurrenceKey','version',a.updated_at) order by a.id),'[]'::jsonb) as v
   from public.engrase_sync a,ctx where a.store='lubrication_assignments' and ctx.c->>'status'='AUTHORIZED'
   and ctx.c->'context'->'authorizedCrewIds' ? (a.payload->>'assignedCrewId') and authorization_private.support_assignment_valid(a.id)
   and authorization_private.authorization_store_action_allowed('lubrication_assignments','SELECT',false)),
 refs as (select coalesce(jsonb_agg(jsonb_build_object('store',g.store,'id',g.id) order by g.store,g.id),'[]'::jsonb) as v
   from authorization_private.support_grant_rows() g join public.engrase_sync s on s.store=g.store and s.id=g.id
   where authorization_private.authorization_store_action_allowed(s.store,'SELECT',s.deleted))
 select case when ctx.c->>'status'='AUTHORIZED' then jsonb_build_object('status','AUTHORIZED',
   'authUserId',auth.uid(),'appUserId',ctx.c->'context'->>'appUserId','operational',ops.v,'rows',refs.v,
   'revision',md5(ops.v::text||refs.v::text)) else jsonb_build_object('status','DENIED') end from ctx,ops,refs;
$$;

revoke all on function authorization_private.support_occurrence_valid(text,text),
 authorization_private.support_assignment_valid(text),authorization_private.support_history_allowed(text,text),
 authorization_private.link_support_entity(text,text,text,text),authorization_private.support_grant_rows(),
 authorization_private.authorization_row_in_scope_baseline_0013(text,text,jsonb,text,jsonb),
 authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb) from public,anon,authenticated;
-- Only the policy classifier is executable by the authenticated policy evaluator.
grant execute on function authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb),
 authorization_private.authorization_row_in_scope_baseline_0013(text,text,jsonb,text,jsonb) to authenticated;
revoke all on function public.get_assignment_support_context() from public,anon;
grant execute on function public.get_assignment_support_context() to authenticated;

create function authorization_private.support_photos_owned(p_photos jsonb,p_existing jsonb default '[]'::jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select not exists(select 1 from jsonb_array_elements(coalesce(p_photos,'[]'::jsonb)) photo
 where not coalesce(p_existing,'[]'::jsonb) @> jsonb_build_array(photo)
 and not exists(select 1 from storage.objects o where o.bucket_id='engrase-photos'
   and o.name=substring(photo#>>'{}' from '/engrase-photos/([^?#]+)$')
   and coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=auth.uid()::text));
$$;
revoke all on function authorization_private.support_photos_owned(jsonb,jsonb) from public,anon,authenticated;

-- Pre-upload check; actual mutation gateways revalidate scope and object ownership.
create function public.authorize_assignment_evidence_upload(p_assignment_id text,p_record_id text,p_crew_id text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 with ctx as (select public.get_authorization_context() as c)
 select ctx.c->>'status'='AUTHORIZED' and (select enabled from authorization_private.support_control where singleton)
 and (ctx.c->'context'->>'scopeType'='GLOBAL' or ctx.c->'context'->'authorizedCrewIds' ? p_crew_id)
 and (exists(select 1 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=p_assignment_id
     and a.payload->>'assignedCrewId'=p_crew_id and authorization_private.support_assignment_valid(a.id))
   or exists(select 1 from authorization_private.support_links l where l.store in ('lubrication_records','anomalies') and l.entity_id=p_record_id
     and l.crew_id=p_crew_id and (ctx.c->'context'->>'scopeType'='GLOBAL' or authorization_private.support_history_allowed(l.store,l.entity_id)))) from ctx;
$$;
revoke all on function public.authorize_assignment_evidence_upload(text,text,text) from public,anon;
grant execute on function public.authorize_assignment_evidence_upload(text,text,text) to authenticated;

-- Settings is already shared in repaired 0013. This retained OR is redundant
-- there, and cannot bypass the INDEPENDENT authorization_store_select gate.
-- All eight 0013 gates and catalog_* protections remain in force; only the
-- named SELECT scope policy is replaced. No other permissive/matrix edits.
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
  dual_shift_active boolean := false;
  occurrence_shift text;
  written_count integer;
  support_assignment text;
begin
  if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into actor from public.app_profiles where auth_user_id=auth.uid() for share;
  if not found or actor.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if actor.role is null or actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
  if nullif(p_operation_id,'') is null or p_action is null or p_action not in ('CREATE','REASSIGN','CANCEL','SKIP') then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;

  lock table public.engrase_sync in share row exclusive mode;
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
    if nullif(p_id,'') is null or nullif(p_equipment_id,'') is null or (p_action='CREATE' and nullif(p_crew_id,'') is null)
       or (p_action='CREATE' and length(coalesce(p_notes,''))>1000) then
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
    if not found then return jsonb_build_object('status','DENIED','code','CREW_NOT_FOUND'); end if;
    select a.id into support_assignment from public.engrase_sync a
      where a.store='lubrication_assignments' and a.payload->>'equipmentId'=p_equipment_id
      and a.payload->>'planId'=p_plan_id and a.payload->>'assignedCrewId'=effective_crew_id
      and a.payload->>'occurrenceKey'=p_occurrence_key and authorization_private.support_assignment_valid(a.id);
    if crew.payload->>'locationId' is distinct from equipment.payload->>'locationId'
       and not (p_action='CREATE' and role_global) and not (p_action='SKIP' and support_assignment is not null) then
      return jsonb_build_object('status','DENIED','code','CREW_EQUIPMENT_LOCATION_MISMATCH'); end if;
    if not role_global and (not (context->'authorizedCrewIds' ? effective_crew_id)
       or (not (context->'authorizedLocationIds' ? (equipment.payload->>'locationId')) and support_assignment is null)) then
      return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
    if actor.role='SUPERVISOR' and not (crew.payload->'memberUserIds' ? actor.app_user_id) then
      return jsonb_build_object('status','DENIED','code','CREW_SCOPE_DENIED'); end if;
    select * into plan from public.engrase_sync where store='lubrication_plans'
      and id=p_plan_id and not deleted and coalesce(payload->>'active','true')='true'
      and payload->>'equipmentId'=p_equipment_id for share;
    if not found then return jsonb_build_object('status','DENIED','code','PLAN_MISMATCH'); end if;
    local_day := (at at time zone 'America/Managua')::date;
    select coalesce((payload->>'shiftDayStart')::numeric,6),coalesce((payload->>'shiftNightStart')::numeric,18)
      into day_start,night_start from public.engrase_sync where store='settings' and id='general' and not deleted;
    day_start:=coalesce(day_start,6); night_start:=coalesce(night_start,18);
    if p_action='SKIP' then occurrence_shift:=p_shift_id;
    else occurrence_shift:=regexp_replace(p_occurrence_key,'^.*:(shift_dia|shift_noche)$','\1'); end if;
    if plan.payload->'requiredShifts' @> '["shift_dia","shift_noche"]'::jsonb
       and nullif(plan.payload->>'effectiveDate','') is not null then
      if occurrence_shift='shift_noche' and extract(hour from at at time zone 'America/Managua')<day_start
         and local_day-1 >= (plan.payload->>'effectiveDate')::date then local_day:=local_day-1; end if;
      dual_shift_active:=local_day >= (plan.payload->>'effectiveDate')::date;
    end if;
    if plan.payload->>'controlType'='Día y turno de la semana' then
      expected_occurrence := case when dual_shift_active then plan.id||':'||local_day::text||':'||occurrence_shift else plan.id||':'||local_day::text end;
      weekday_name := (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[extract(dow from local_day)::integer+1];
      if not dual_shift_active and support_assignment is null and not (coalesce(plan.payload->'assignedDays','[]'::jsonb) ? weekday_name) then
        return jsonb_build_object('status','DENIED','code','OCCURRENCE_NOT_SCHEDULED'); end if;
    elsif dual_shift_active then
      expected_occurrence:=plan.id||':'||local_day::text||':'||occurrence_shift;
    else
      expected_occurrence := plan.id||':h:'||coalesce(nullif(plan.payload->>'lastGreaseHour',''),'0');
    end if;
    if dual_shift_active and occurrence_shift not in ('shift_dia','shift_noche') and support_assignment is null then
      return jsonb_build_object('status','DENIED','code','SHIFT_REQUIRED'); end if;
    if p_occurrence_key is distinct from expected_occurrence and not (p_action='SKIP' and support_assignment is not null) then
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
        'planId',p_plan_id,'assignmentType',case when crew.payload->>'locationId' is distinct from equipment.payload->>'locationId' then 'SUPPORT_OTHER_LOCATION' else 'MANUAL' end,'assignedCrewId',effective_crew_id,'assignedByUserId',actor.app_user_id,
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
        or (not (context->'authorizedLocationIds' ? (equipment.payload->>'locationId')) and not authorization_private.support_assignment_valid(original.id))) then
        return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
      if original.payload->>'occurrenceKey' is distinct from p_occurrence_key then
        return jsonb_build_object('status','CONFLICT','code','OCCURRENCE_VERSION_CONFLICT'); end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment:'||(original.payload->>'occurrenceKey'),0));
      if p_action='REASSIGN' then
        select * into crew from public.engrase_sync where store='cuadrillas' and id=p_crew_id and not deleted
          and coalesce(payload->>'active','true')='true' for share;
        if not found then
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
    if p_date is null or p_date > at + interval '5 minutes' or p_shift_id is null or p_shift_id not in ('shift_dia','shift_noche')
      or p_reason is null or p_reason not in ('REPARACION','YA_ENGRASADO','SIN_TIEMPO','NO_DISPONIBLE','CONDICION_INSEGURA','OTRO')
      or (p_reason='OTRO' and nullif(btrim(p_observacion),'') is null)
      or (p_observacion is not null and length(p_observacion)>1000) then
      return jsonb_build_object('status','DENIED','code','INVALID_SKIP'); end if;
    if (p_date at time zone 'America/Managua')::date <> (at at time zone 'America/Managua')::date then
      return jsonb_build_object('status','DENIED','code','SKIP_DATE_NOT_CURRENT'); end if;
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
  -- CREATE/SKIP must never overwrite an ID inserted concurrently for a
  -- different occurrence (the occurrence advisory locks would differ).
  if p_action in ('CREATE','SKIP') then
    insert into public.engrase_sync(store,id,payload,updated_at,deleted)
      values(destination,p_id,row_payload,(row_payload->>'updatedAt')::timestamptz,false)
      on conflict(store,id) do nothing;
    get diagnostics written_count = row_count;
    if written_count=0 then return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
  else
    -- REASSIGN/CANCEL operate only on the existing row already locked and
    -- CAS-validated above; they do not create or revive a missing assignment.
    update public.engrase_sync set payload=row_payload,updated_at=(row_payload->>'updatedAt')::timestamptz
      where store=destination and id=p_id and not deleted and updated_at=p_expected;
    get diagnostics written_count = row_count;
    if written_count<>1 then return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT'); end if;
  end if;
  insert into public.engrase_sync(store,id,payload,updated_at,deleted)
    values('audit_log','assignment-skip:'||auth.uid()::text||':'||p_operation_id,
      jsonb_build_object('id','assignment-skip:'||auth.uid()::text||':'||p_operation_id,
        'action',case when p_action='SKIP' then 'LUBRICATION_SKIPPED' else 'ASSIGNMENT_'||p_action end,
        'entityId',p_id,'actorAuthUserId',auth.uid(),'appUserId',actor.app_user_id,
        'user',actor.display_name,'createdAt',at,'active',true),at,false);
  result:=jsonb_build_object('status','APPLIED','rows',jsonb_build_array(jsonb_build_object(
    'store',destination,'id',p_id,'payload',row_payload,'updated_at',(row_payload->>'updatedAt')::timestamptz)));
  if p_action='SKIP' and support_assignment is not null then perform authorization_private.link_support_entity(destination,p_id,support_assignment); end if;
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
  with check (store not in ('lubrication_assignments','lubrication_skips','lubrication_records'));
drop policy if exists assignment_skip_rpc_update_only on public.engrase_sync;
create policy assignment_skip_rpc_update_only on public.engrase_sync as restrictive for update to public
  using (store not in ('lubrication_assignments','lubrication_skips','lubrication_records'))
  with check (store not in ('lubrication_assignments','lubrication_skips','lubrication_records'));
drop policy if exists assignment_skip_rpc_delete_only on public.engrase_sync;
create policy assignment_skip_rpc_delete_only on public.engrase_sync as restrictive for delete to public
  using (store not in ('lubrication_assignments','lubrication_skips','lubrication_records'));
-- API skips are insert-only: wrappers + PUBLIC restrictive mutation guards.
-- Table-owner/service-role SQL bypasses RLS and remains trusted administration.
comment on function public.assignment_skip_operation(text,text,text,timestamptz,text,text,text,text,text,timestamptz,text,text,text,text)
  is 'PRE-0008 typed assignment/skip gateway; server authority, CAS and per-user idempotency; skips are immutable.';
create or replace function public.lubrication_execution(
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
#variable_conflict use_variable
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
  dual_shift_active boolean := false;
  operational_day date;
  support_id text;
  assigned_occurrence text;
  current_occurrence text;
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
  -- The typed execution gateway is the authorization boundary. Generic
  -- app_store_permissions mutation flags are intentionally false in the
  -- final matrix for this RPC-only store; role, ownership and scope checks
  -- below govern execution and edit operations.

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
    if actor.role in ('SUPERVISOR','LUBRICADOR') and not exists(select 1 from public.engrase_sync c
      where c.store='cuadrillas' and c.id=coalesce(p_crew_id,(select row->'payload'->'operationalSnapshot'->>'crewId' from jsonb_array_elements(receipt.result->'rows') row where row->>'store'='lubrication_records' limit 1)) and not c.deleted and coalesce(c.payload->>'active','true')='true'
      and c.payload->'memberUserIds' ? actor.app_user_id) then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
    return receipt.result;
  end if;
  select * into equipment from public.engrase_sync where store='equipment' and id=p_equipment_id and not deleted;
  if not found or coalesce(equipment.payload->>'active','true') <> 'true' then
    return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND');
  end if;
  role_global := actor.role in ('ADMINISTRADOR','PLANIFICADOR');
  if p_action='CREATE' and p_execution_type='ASSIGNED' then
    select * into assignment from public.engrase_sync where store='lubrication_assignments' and id=p_assignment_id and not deleted;
    if not found or not authorization_private.support_assignment_valid(assignment.id)
      or assignment.payload->>'equipmentId' is distinct from p_equipment_id
      or assignment.payload->>'planId' is distinct from p_plan_id
      or assignment.payload->>'assignedCrewId' is distinct from crew_id then
      return jsonb_build_object('status','DENIED','code','ASSIGNMENT_MISMATCH'); end if;
    support_id:=assignment.id; assigned_occurrence:=assignment.payload->>'occurrenceKey';
  elsif p_action='EDIT' then
    select l.assignment_id into support_id from authorization_private.support_links l
      where l.store='lubrication_records' and l.entity_id=p_record_id
      and (role_global or authorization_private.support_history_allowed(l.store,l.entity_id));
  end if;
  if not role_global then
    if crew_id is null then
      select count(*), min(id) into n,crew_id from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
      if n <> 1 then return jsonb_build_object('status','DENIED','code','CREW_SELECTION_REQUIRED'); end if;
    end if;
    select * into crew from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
    if not found or nullif(crew.payload->>'locationId','') is null
      or (crew.payload->>'locationId' is distinct from equipment.payload->>'locationId' and support_id is null) then
      return jsonb_build_object('status','DENIED','code','SCOPE_DENIED');
    end if;
  elsif crew_id is not null then
    select * into crew from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true';
    if not found then return jsonb_build_object('status','DENIED','code','CREW_NOT_FOUND'); end if;
  end if;
  if not exists (select 1 from public.engrase_sync where store='locations' and id=equipment.payload->>'locationId' and not deleted
    and coalesce(payload->>'active','true')='true') then return jsonb_build_object('status','DENIED','code','LOCATION_NOT_FOUND'); end if;
  if support_id is not null and not role_global and not exists (
    select 1 from authorization_private.support_links l where l.store='lubrication_records' and l.entity_id=p_record_id and l.crew_id=crew_id
    union all select 1 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=support_id and p_action='CREATE' and a.payload->>'assignedCrewId'=crew_id
  ) then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
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
  if p_action='EDIT' and support_id is not null and complete is distinct from (original.payload->'operationalSnapshot'->>'executionCompleteness'='COMPLETE') then return jsonb_build_object('status','DENIED','code','ASSIGNED_COMPLETENESS_IMMUTABLE'); end if;
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
  operational_day := execution_day;
  if plan.id is not null and plan.payload->'requiredShifts' @> '["shift_dia","shift_noche"]'::jsonb
     and nullif(plan.payload->>'effectiveDate','') is not null
     and p_shift_id='shift_noche'
     and extract(hour from p_execution_date at time zone 'America/Managua') < day_start
     and execution_day - 1 >= (plan.payload->>'effectiveDate')::date then
    operational_day := execution_day - 1;
  end if;
  dual_shift_active := plan.id is not null
    and plan.payload->'requiredShifts' @> '["shift_dia","shift_noche"]'::jsonb
    and nullif(plan.payload->>'effectiveDate','') is not null
    and operational_day >= (plan.payload->>'effectiveDate')::date;
  if dual_shift_active then execution_day := operational_day; end if;
  if p_action='CREATE' and not p_retroactive and p_shift_id <> (case when extract(hour from p_execution_date at time zone 'America/Managua') >= day_start
    and extract(hour from p_execution_date at time zone 'America/Managua') < night_start then 'shift_dia' else 'shift_noche' end) then
    return jsonb_build_object('status','DENIED','code','SHIFT_MISMATCH');
  end if;
  if p_action='CREATE' then
    if plan.id is not null then
      occurrence := case when dual_shift_active then plan.id||':'||execution_day::text||':'||p_shift_id
        when plan.payload->>'controlType'='Día y turno de la semana' then plan.id||':'||execution_day::text
        else plan.id||':h:'||(case when jsonb_typeof(plan.payload->'lastGreaseHour')='number'
          then trim_scale((plan.payload->>'lastGreaseHour')::numeric)::text else coalesce(plan.payload->>'lastGreaseHour','0') end) end;
    end if;
    current_occurrence:=occurrence;
    if assigned_occurrence is not null then occurrence:=assigned_occurrence; end if;
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
      -- Completion is an atomic side effect of this typed execution RPC.
      -- It does not require generic UPDATE on lubrication_assignments.
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
      if dual_shift_active then
        for i in 0..1 loop
          candidate := execution_day+i;
          if not exists(select 1 from public.engrase_sync where store='lubrication_records' and not deleted
            and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id
            and (payload->'operationalSnapshot'->>'assignedOccurrenceKey' is null or payload->'operationalSnapshot'->>'assignedOccurrenceKey'=plan.id||':'||candidate::text||':'||p_shift_id)
            and payload->>'shiftId'=p_shift_id
            and (payload->'operationalSnapshot'->>'operationalDate'=candidate::text
              or ((payload->>'date')::timestamptz at time zone 'America/Managua')::date=candidate)) then
            candidates := array_append(candidates,candidate);
          end if;
        end loop;
        if cardinality(candidates)=1 then satisfied := plan.id||':'||candidates[1]::text||':'||p_shift_id; end if;
      elsif plan.payload->>'controlType'='Día y turno de la semana' then
        for i in 0..1 loop
          candidate := execution_day+i;
          if plan.payload->'assignedDays' ? weekdays[extract(dow from candidate)::integer+1]
            and not exists(select 1 from public.engrase_sync where store='lubrication_records' and not deleted
              and coalesce(payload->>'active','true')='true' and (payload->'operationalSnapshot'->>'assignedOccurrenceKey' is null or payload->'operationalSnapshot'->>'assignedOccurrenceKey'=plan.id||':'||candidate::text) and payload->>'equipmentId'=p_equipment_id and (payload->>'date')::timestamptz at time zone 'America/Managua' >= candidate
              and (payload->>'date')::timestamptz at time zone 'America/Managua' < candidate+interval '1 day') then candidates := array_append(candidates,candidate); end if;
        end loop;
        if cardinality(candidates)=1 then satisfied := plan.id||':'||candidates[1]::text; end if;
      else satisfied := occurrence; end if;
    end if;
    if assigned_occurrence is not null then satisfied:=case when complete then assigned_occurrence else null end; end if;
    snapshot := jsonb_build_object('equipmentLocationIdAtExecution',equipment.payload->>'locationId','executionLocationId',equipment.payload->>'locationId',
      'crewId',crew_id,'crewLocationIdAtExecution',crew.payload->>'locationId','performedByUserId',p_performed_by,
      'shiftId',p_shift_id,'operationalDate',execution_day::text,'executedAt',p_execution_date,'assignedOccurrenceKey',assigned_occurrence,'occurrenceKey',occurrence,
      'assignmentId',p_assignment_id,'executionType',p_execution_type,'outOfPlanReason',p_out_of_plan_reason,
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
  if support_id is not null and not authorization_private.support_photos_owned(p_photos,case when p_action='EDIT' then original.payload->'photos' else '[]'::jsonb end) then return jsonb_build_object('status','DENIED','code','PHOTO_OBJECT_DENIED'); end if;
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
    if (support_id is null or (p_action='CREATE' and assigned_occurrence=current_occurrence)) and plan.id is not null and not dual_shift_active and (plan.payload->>'controlType'<>'Horas de operación' or complete) then
      update public.engrase_sync set payload=payload||jsonb_build_object('lastGreaseHour',p_hourmeter,'updatedAt',version_at),updated_at=version_at
        where store='lubrication_plans' and id=p_plan_id;
    end if;
  elsif p_action='CREATE' and (assigned_occurrence is null or assigned_occurrence=current_occurrence) and p_no_hourmeter and not dual_shift_active and plan.payload->>'controlType'='Horas de operación' then
    update public.engrase_sync set payload=payload||jsonb_build_object('lastGreaseDateNoHm',p_execution_date,'updatedAt',version_at),updated_at=version_at
      where store='lubrication_plans' and id=p_plan_id;
  end if;
  if p_action='CREATE' and assignment.id is not null then perform authorization_private.link_support_entity('lubrication_records',p_record_id,assignment.id); end if;
  if p_action='CREATE' and assignment.id is not null and complete then
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
          'action',case when assignment.id is not null then (case when complete then 'GREASE_ASSIGNMENT_COMPLETED' else 'GREASE_ASSIGNMENT_PARTIAL' end) else 'OUT_OF_PLAN_GREASE_RECORDED' end,
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
create or replace function public.evidence_operation(
  p_operation_id text, p_action text, p_id text, p_equipment_id text,
  p_crew_id text, p_expected timestamptz, p_component text, p_description text,
  p_criticality text, p_status text, p_photos jsonb, p_note text,
  p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text,
  p_expected_signatures jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $evidence$
#variable_conflict use_variable
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
  support_id text;
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
  select * into receipt from public.evidence_operation_receipts where auth_user_id=auth.uid() and operation_id=p_operation_id;
  if found and authorization_private.support_history_allowed(receipt.result->'rows'->0->>'store',receipt.result->'rows'->0->>'id') then
    if receipt.request<>request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    return receipt.result;
  end if;
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
  if p_action in ('AUTOMATIC','CAPTURE','RESOLVE') then
    select l.assignment_id into support_id from authorization_private.support_links l where l.store='lubrication_records' and l.entity_id=record.id
      and (actor.role in ('ADMINISTRADOR','PLANIFICADOR') or authorization_private.support_history_allowed(l.store,l.entity_id));
  elsif p_action='REPORT' and p_record_id is not null then
    select a.id into support_id from public.engrase_sync a where a.store='lubrication_assignments' and a.id=p_record_id
      and a.payload->>'equipmentId'=equipment.id and a.payload->>'assignedCrewId'=crew_id
      and authorization_private.support_assignment_valid(a.id);
    if support_id is null then return jsonb_build_object('status','DENIED','code','ASSIGNMENT_MISMATCH'); end if;
  elsif p_action in ('EDIT','CLOSE','RETIRE') then
    select l.assignment_id into support_id from authorization_private.support_links l where l.store='anomalies' and l.entity_id=original.id
      and (actor.role in ('ADMINISTRADOR','PLANIFICADOR') or authorization_private.support_history_allowed(l.store,l.entity_id));
  end if;
  if actor.role in ('SUPERVISOR','LUBRICADOR') then
    if crew_id is null then
      select count(*),min(id) into n,crew_id from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
      if n<>1 then return jsonb_build_object('status','DENIED','code','CREW_SELECTION_REQUIRED'); end if;
    end if;
    perform 1 from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id
       and (nullif(payload->>'locationId','')=equipment.payload->>'locationId' or (support_id is not null and (
         exists(select 1 from authorization_private.support_links l where l.assignment_id=support_id and l.crew_id=crew_id and ((l.store='lubrication_records' and l.entity_id=record.id) or (l.store='anomalies' and l.entity_id=original.id)))
         or (p_action='REPORT' and exists(select 1 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=support_id and a.payload->>'assignedCrewId'=crew_id)))));
    if not found then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
  end if;
  if p_action='AUTOMATIC' then
    -- Delegation is only for this actor's accepted 0009 execution, not a general editor.
    if record.payload->>'capturedByAuthUserId' is distinct from auth.uid()::text then
      return jsonb_build_object('status','DENIED','code','EXECUTION_ACTOR_DENIED'); end if;
    -- This derived evidence is part of an accepted 0009 execution. Generic
    -- record INSERT is disabled in the target matrix; accepted execution,
    -- actor and version checks below are authoritative.
    null;
  elsif p_action in ('CAPTURE','RESOLVE') then
    if p_action='RESOLVE' and actor.role<>'ADMINISTRADOR' then
      return jsonb_build_object('status','DENIED','code','ADMIN_REQUIRED'); end if;
    if p_action='CAPTURE' and actor.role not in ('ADMINISTRADOR','SUPERVISOR','LUBRICADOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
  else
    if actor.role='PLANIFICADOR' or (p_action='RETIRE' and actor.role<>'ADMINISTRADOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
    if actor.role='LUBRICADOR' and p_action<>'REPORT'
      and original.payload->>'capturedByAuthUserId' is distinct from auth.uid()::text then
      return jsonb_build_object('status','DENIED','code','ANOMALY_OWNER_DENIED'); end if;
    -- Anomaly mutations are available only through this typed, scoped RPC.
    -- Planner remains denied above; retirement is Admin-only; Lubricador
    -- edits stay owner-bound below. The target matrix has no generic writes.
    if actor.role not in ('ADMINISTRADOR','SUPERVISOR','LUBRICADOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
  end if;
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

  if support_id is not null and p_action in ('REPORT','EDIT') and not authorization_private.support_photos_owned(p_photos,case when p_action='EDIT' then original.payload->'photos' else '[]'::jsonb end) then return jsonb_build_object('status','DENIED','code','PHOTO_OBJECT_DENIED'); end if;
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
      'equipmentId',equipment.id,'locationId',equipment.payload->>'locationId','crewId',crew_id,'supportAssignmentId',support_id,'status','Abierta') else original.payload end;
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
        and payload->>'autoPointId'=point_id and payload->>'status'<>'Cerrada'
        and (case when support_id is not null then payload->>'supportAssignmentId'=support_id else payload->>'supportAssignmentId' is null and payload->>'crewId'=crew_id end);
      if n>1 then raise exception using errcode='P2B01',message='AUTOMATIC_ANOMALY_AMBIGUOUS'; end if;
      select * into original from public.engrase_sync where store='anomalies' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=equipment.id
        and payload->>'autoPointId'=point_id and payload->>'status'<>'Cerrada'
        and (case when support_id is not null then payload->>'supportAssignmentId'=support_id else payload->>'supportAssignmentId' is null and payload->>'crewId'=crew_id end);
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
        'supportAssignmentId',support_id,'crewId',crew_id,'createdAt',at,'createdBy',actor.display_name,'capturedByAuthUserId',auth.uid(),
        'capturedByUserId',actor.app_user_id,'active',true,'status','Abierta','autoGenerada',true,'autoPointId',point_id,
        'component',component,'criticality',criticality,'photos',case when point_id='__horometro__' then '[]'::jsonb else coalesce(record.payload->'photos','[]') end));
      revision:=greatest(at,coalesce(original.updated_at,at)+interval '1 microsecond');
      row_payload:=row_payload||jsonb_build_object('description',description,'repeticiones',repetitions,'updatedAt',revision,'lastExecutionId',p_record_id);
      insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('anomalies',row_id,row_payload,revision,false)
        on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
      if support_id is not null then perform authorization_private.link_support_entity('anomalies',row_id,support_id,crew_id); end if;
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
  if support_id is not null and p_action in ('REPORT','CAPTURE') then
    perform authorization_private.link_support_entity(case when p_action='REPORT' then 'anomalies' else 'grease_validations' end,p_id,support_id,crew_id);
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

create or replace function public.report_anomaly(p_operation_id text,p_id text,p_equipment_id text,p_crew_id text,p_component text,p_description text,p_criticality text,p_photos jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'REPORT',p_id,p_equipment_id,p_crew_id,null,p_component,p_description,p_criticality,null,p_photos,null,null,null,null,null,null); $$;
create or replace function public.edit_anomaly(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_component text,p_description text,p_criticality text,p_status text,p_photos jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'EDIT',p_id,null,p_crew_id,p_expected,p_component,p_description,p_criticality,p_status,p_photos,null,null,null,null,null,null); $$;
create or replace function public.close_anomaly(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_note text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'CLOSE',p_id,null,p_crew_id,p_expected,null,null,null,null,null,p_note,null,null,null,null,null); $$;
create or replace function public.retire_anomaly(p_operation_id text,p_id text,p_expected timestamptz)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'RETIRE',p_id,null,null,p_expected,null,null,null,null,null,null,null,null,null,null,null); $$;
create or replace function public.repeat_anomaly_from_execution(p_operation_id text,p_record_id text,p_crew_id text,p_expected timestamptz)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'AUTOMATIC',null,null,p_crew_id,p_expected,null,null,null,null,null,null,p_record_id,null,null,null,null); $$;
create or replace function public.capture_grease_validation(p_operation_id text,p_id text,p_record_id text,p_crew_id text,p_expected timestamptz,p_signer_name text,p_signer_role text,p_note text,p_signature_url text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'CAPTURE',p_id,null,p_crew_id,p_expected,null,null,null,null,null,p_note,p_record_id,p_signer_name,p_signer_role,p_signature_url,null); $$;
create or replace function public.resolve_grease_validation_conflict(p_operation_id text,p_record_id text,p_id text,p_note text,p_expected_signatures jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'RESOLVE',p_id,null,null,null,null,null,null,null,null,p_note,p_record_id,null,null,null,p_expected_signatures); $$;
revoke all on function public.report_anomaly(text,text,text,text,text,text,text,jsonb),public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb),
 public.close_anomaly(text,text,text,timestamptz,text),public.retire_anomaly(text,text,timestamptz),public.repeat_anomaly_from_execution(text,text,text,timestamptz),
 public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text),public.resolve_grease_validation_conflict(text,text,text,text,jsonb) from public,anon;
grant execute on function public.report_anomaly(text,text,text,text,text,text,text,jsonb),public.edit_anomaly(text,text,text,timestamptz,text,text,text,text,jsonb),
 public.close_anomaly(text,text,text,timestamptz,text),public.retire_anomaly(text,text,timestamptz),public.repeat_anomaly_from_execution(text,text,text,timestamptz),
 public.capture_grease_validation(text,text,text,text,timestamptz,text,text,text,text),public.resolve_grease_validation_conflict(text,text,text,text,jsonb) to authenticated;


create function public.report_assignment_anomaly(p_operation_id text,p_id text,p_equipment_id text,p_crew_id text,p_component text,p_description text,p_criticality text,p_photos jsonb,p_assignment_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'REPORT',p_id,p_equipment_id,p_crew_id,null,p_component,p_description,p_criticality,null,p_photos,null,p_assignment_id,null,null,null,null); $$;
revoke all on function public.report_assignment_anomaly(text,text,text,text,text,text,text,jsonb,text) from public,anon;
grant execute on function public.report_assignment_anomaly(text,text,text,text,text,text,text,jsonb,text) to authenticated;

commit;
