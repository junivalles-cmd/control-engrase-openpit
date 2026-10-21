-- MANUAL-PRODUCTION-PREPARED: additive PRE-CUTOVER with repaired 0013 PASS.
-- Apply manually as postgres after preflight / legacy queue review; this
-- preparation does not authorize execution. Run the COMPLETE transaction.
-- The old post-0003-only warning is superseded ONLY when all eight repaired
-- 0013 authenticated restrictive matrix/scope policies are installed intact
-- and rowScopeEnforced=true. Validate this manually; the DO block below does
-- not inspect 0013. Without independent matrix gates, legacy ALL/true can
-- bypass permissive store permissions. Do not remove legacy or anon grants.
-- Requires app_profiles/app_store_permissions and ownership of engrase_sync.
-- This SQL does not call 0009/0010, but the compatible client requires both RPCs.
-- Scope checks use the legacy crew.locationId model: keep 0008 unapplied until
-- this gateway is revised for crew_locations. No app_store_permissions edits.
-- Existing profiles/matrix and 0012 helpers must retain postgres ownership
-- and FORCE RLS=false. authorization_private must remain outside Data API.
-- Generic authenticated catalog writes require matrix AND row scope AND these
-- additional role guards. catalog_settings_read is now redundant but cannot
-- bypass 0013's independent restrictive SELECT matrix or scope policies.
-- Typed wrappers run as owner and enforce operation roles, destination READ,
-- Supervisor legacy crew/location scope and CAS themselves. Generic write
-- bits do not define typed RPC capability (consistent with target 0015).
-- Supervisor with multiple crews must supply an authorized p_crew_id for
-- PAUSE/REPROGRAM. Membership arrays/legacy locations must be well formed.
-- Hourmeter: equality allowed; regression denied; >500 hours needs explicit
-- true confirmation. No reset/replacement semantics are introduced.
-- Anon cannot execute new helpers/wrappers or access receipts. Legacy table
-- exposure remains unchanged, including generic anon reads/writes allowed by
-- its existing grants. This is not cutover or full client release certification.
-- See docs/0011_PRODUCTION_PREFLIGHT_READ_ONLY.sql. New receipts/functions
-- must be absent before installation; CREATE is intentionally not a rerun.
begin;
do $$ begin
 if not exists(select 1 from pg_catalog.pg_class where oid='public.engrase_sync'::regclass and relrowsecurity
   and not relforcerowsecurity and relowner=(select oid from pg_catalog.pg_roles where rolname=current_user)) then
   raise exception 'Installer must own engrase_sync with RLS enabled, FORCE RLS disabled'; end if;
end $$;
create table public.operational_catalog_receipts(auth_user_id uuid,operation_id text,request jsonb not null,result jsonb not null,
 primary key(auth_user_id,operation_id));
alter table public.operational_catalog_receipts enable row level security;
revoke all on public.operational_catalog_receipts from public,anon,authenticated;
create function public.catalog_writer_role() returns text language sql stable security definer set search_path=pg_catalog as $$
 select role from public.app_profiles where auth_user_id=auth.uid() and active=true;
$$;
revoke all on function public.catalog_writer_role() from public,anon;
grant execute on function public.catalog_writer_role() to authenticated;
create function public.operational_catalog_operation(p_operation_id text,p_action text,p_id text,p_crew_id text,p_expected timestamptz,
 p_location_id text,p_shift_id text,p_until date,p_reason text,p_hourmeter numeric,p_confirm_large_jump boolean)
returns jsonb language plpgsql security definer set search_path=pg_catalog as $catalog$
declare
 actor public.app_profiles%rowtype; original public.engrase_sync%rowtype; equipment public.engrase_sync%rowtype;
 receipt public.operational_catalog_receipts%rowtype; request jsonb; result jsonb; row_payload jsonb;
 destination text; crew_id text:=p_crew_id; n integer; at timestamptz; today date;
begin
 if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
 select * into actor from public.app_profiles where auth_user_id=auth.uid() for share;
 if not found or actor.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
 if actor.role is null or actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR') then return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
 if p_action is null or p_action not in ('MOVE','SHIFT','PAUSE','HOURMETER','REPROGRAM') or nullif(p_operation_id,'') is null then
   return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;
 -- Supervisor has pause/reprogram UI, no independent Horometros screen or master editor.
 if actor.role='SUPERVISOR' and p_action not in ('PAUSE','REPROGRAM') then return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
 destination:=case when p_action='REPROGRAM' then 'lubrication_plans' else 'equipment' end;
 perform 1 from public.app_store_permissions where role=actor.role and store=destination and can_read for share;
 if not found then return jsonb_build_object('status','DENIED','code','PERMISSION_DENIED'); end if;
 request:=jsonb_build_array(p_action,p_id,p_crew_id,p_expected,p_location_id,p_shift_id,p_until,p_reason,p_hourmeter,p_confirm_large_jump);
 -- Serialize retries of one intent and lock only its target row; unrelated sync writes keep flowing.
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':'||p_operation_id,0));
 select * into receipt from public.operational_catalog_receipts where auth_user_id=auth.uid() and operation_id=p_operation_id;
 if found then
   if receipt.request<>request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
   return receipt.result;
 end if;
 select * into original from public.engrase_sync where store=destination and id=p_id and not deleted and coalesce(payload->>'active','true')='true' for update;
 if not found then return jsonb_build_object('status','DENIED','code','TARGET_NOT_FOUND'); end if;
 if destination='equipment' then equipment:=original;
 else select * into equipment from public.engrase_sync where store='equipment' and id=original.payload->>'equipmentId'
   and not deleted and coalesce(payload->>'active','true')='true' for share; end if;
 if equipment.id is null then return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND'); end if;
 if actor.role='SUPERVISOR' then
   if crew_id is null then
     select count(*),min(id) into n,crew_id from public.engrase_sync where store='cuadrillas' and not deleted
       and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
     if n<>1 then return jsonb_build_object('status','DENIED','code','CREW_SELECTION_REQUIRED'); end if;
   end if;
   perform 1 from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
     and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id
     and nullif(payload->>'locationId','')=equipment.payload->>'locationId' for share;
   if not found then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
 end if;
 if original.updated_at is distinct from p_expected then return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT'); end if;
 at:=greatest(clock_timestamp(),original.updated_at+interval '1 microsecond'); today:=(at at time zone 'America/Managua')::date;
 row_payload:=original.payload;
 if p_action='MOVE' then
   perform 1 from public.engrase_sync where store='locations' and id=p_location_id and not deleted and coalesce(payload->>'active','true')='true' for share;
   if not found then return jsonb_build_object('status','DENIED','code','LOCATION_NOT_FOUND'); end if;
   row_payload:=row_payload||jsonb_build_object('locationId',p_location_id);
 elsif p_action='SHIFT' then
   if p_shift_id is null or p_shift_id not in ('shift_dia','shift_noche') then return jsonb_build_object('status','DENIED','code','INVALID_SHIFT'); end if;
   row_payload:=row_payload||jsonb_build_object('shiftId',p_shift_id);
 elsif p_action='HOURMETER' then
   if p_hourmeter is null or p_hourmeter::text in ('NaN','Infinity','-Infinity') or p_hourmeter<0
     or p_hourmeter<coalesce((original.payload->>'hourmeter')::numeric,0) then return jsonb_build_object('status','DENIED','code','INVALID_HOURMETER'); end if;
   if p_hourmeter-coalesce((original.payload->>'hourmeter')::numeric,0)>500 and p_confirm_large_jump is distinct from true then
     return jsonb_build_object('status','DENIED','code','HOURMETER_CONFIRMATION_REQUIRED'); end if;
   row_payload:=row_payload||jsonb_build_object('hourmeter',p_hourmeter);
 elsif p_action='PAUSE' then
   if p_until is not null and (p_until<today or nullif(btrim(p_reason),'') is null or length(p_reason)>240) then return jsonb_build_object('status','DENIED','code','INVALID_PAUSE'); end if;
   row_payload:=row_payload||jsonb_build_object('avisosPausadosHasta',case when p_until is null then null else
     (p_until+time '23:59:59') at time zone 'America/Managua' end);
   if p_until is not null then row_payload:=row_payload||jsonb_build_object('avisosPausaMotivo',p_reason); end if;
 else
   if original.payload->>'controlType' is distinct from 'Día y turno de la semana' then return jsonb_build_object('status','DENIED','code','INVALID_PLAN_TYPE'); end if;
   if p_until is not null and (p_until<today or p_until>today+7 or nullif(btrim(p_reason),'') is null or length(p_reason)>240) then
     return jsonb_build_object('status','DENIED','code','INVALID_REPROGRAM'); end if;
   row_payload:=row_payload||jsonb_build_object('reprogramadoHasta',case when p_until is null then null else
     (p_until+time '12:00:00') at time zone 'America/Managua' end,'reprogramadoMotivo',case when p_until is null then null else p_reason end);
 end if;
 row_payload:=row_payload||jsonb_build_object('updatedAt',at);
 update public.engrase_sync set payload=row_payload,updated_at=at where store=destination and id=p_id;
 insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('audit_log','catalog:'||auth.uid()||':'||p_operation_id,
   jsonb_build_object('id','catalog:'||auth.uid()||':'||p_operation_id,'active',true,'action','CATALOG_'||p_action,
     'entityId',p_id,'before',original.payload,'after',row_payload,'user',actor.display_name,'actorAuthUserId',auth.uid(),'createdAt',at,'updatedAt',at),at,false);
 result:=jsonb_build_object('status','APPLIED','rows',jsonb_build_array(jsonb_build_object('store',destination,'id',p_id,'payload',row_payload,'updated_at',at)));
 insert into public.operational_catalog_receipts values(auth.uid(),p_operation_id,request,result);
 return result;
end $catalog$;
revoke all on function public.operational_catalog_operation(text,text,text,text,timestamptz,text,text,date,text,numeric,boolean) from public,anon,authenticated;
create function public.move_equipment_master_location(p_operation_id text,p_id text,p_expected timestamptz,p_location_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'MOVE',p_id,null,p_expected,p_location_id,null,null,null,null,null)$$;
create function public.set_equipment_shift(p_operation_id text,p_id text,p_expected timestamptz,p_shift_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'SHIFT',p_id,null,p_expected,null,p_shift_id,null,null,null,null)$$;
create function public.set_equipment_alert_pause(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_until date,p_reason text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'PAUSE',p_id,p_crew_id,p_expected,null,null,p_until,p_reason,null,null)$$;
create function public.update_equipment_hourmeter(p_operation_id text,p_id text,p_expected timestamptz,p_hourmeter numeric,p_confirm_large_jump boolean)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'HOURMETER',p_id,null,p_expected,null,null,null,null,p_hourmeter,p_confirm_large_jump)$$;
create function public.reprogram_lubrication_plan(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_until date,p_reason text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'REPROGRAM',p_id,p_crew_id,p_expected,null,null,p_until,p_reason,null,null)$$;
revoke all on function public.move_equipment_master_location(text,text,timestamptz,text),public.set_equipment_shift(text,text,timestamptz,text),
 public.set_equipment_alert_pause(text,text,text,timestamptz,date,text),public.update_equipment_hourmeter(text,text,timestamptz,numeric,boolean),
 public.reprogram_lubrication_plan(text,text,text,timestamptz,date,text) from public,anon;
grant execute on function public.move_equipment_master_location(text,text,timestamptz,text),public.set_equipment_shift(text,text,timestamptz,text),
 public.set_equipment_alert_pause(text,text,text,timestamptz,date,text),public.update_equipment_hourmeter(text,text,timestamptz,numeric,boolean),
 public.reprogram_lubrication_plan(text,text,text,timestamptz,date,text) to authenticated;
-- Intersects existing permissive policies, including legacy ALL/true.
-- Does not grant new store permissions. Future matrix still must grant legitimate CRUD/READ.
create policy catalog_insert_roles on public.engrase_sync as restrictive for insert to authenticated with check(
 case when store in ('equipment','settings') then public.catalog_writer_role()='ADMINISTRADOR'
 when store in ('lubrication_plans','lubrication_points') then public.catalog_writer_role() in ('ADMINISTRADOR','PLANIFICADOR') else true end);
create policy catalog_update_roles on public.engrase_sync as restrictive for update to authenticated using(
 case when store in ('equipment','settings') then public.catalog_writer_role()='ADMINISTRADOR'
 when store in ('lubrication_plans','lubrication_points') then public.catalog_writer_role() in ('ADMINISTRADOR','PLANIFICADOR') else true end) with check(
 case when store in ('equipment','settings') then public.catalog_writer_role()='ADMINISTRADOR'
 when store in ('lubrication_plans','lubrication_points') then public.catalog_writer_role() in ('ADMINISTRADOR','PLANIFICADOR') else true end);
-- settings has operational read consumers; this does not grant INSERT/UPDATE.
create policy catalog_settings_read on public.engrase_sync for select to authenticated using(
 store='settings' and public.catalog_writer_role() in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR'));
create policy catalog_delete_roles on public.engrase_sync as restrictive for delete to authenticated using(store not in ('equipment','lubrication_plans','lubrication_points','settings'));
-- Logical deletion uses authorized UPDATE with CAS, never hard DELETE.
commit;
