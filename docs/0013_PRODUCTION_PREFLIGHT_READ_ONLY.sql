-- EXACT MANUAL READ-ONLY PREFLIGHT. Run the complete file as postgres.
-- No writes, impersonation, JWT changes, temporary objects or migration DDL.
-- Projections describe REPAIRED 0013: restrictive matrix AND row scope.
-- This script is evidence only; it does not install protection or READ bits.
-- Check actual Supabase Data API exposed schemas separately: absent
-- SQL settings do not prove authorization_private is excluded from PostgREST.
begin transaction read only;

-- Owners / RLS / FORCE / table grants. Baseline owners must stay postgres.
select c.relname, pg_catalog.pg_get_userbyid(c.relowner) as owner,
       c.relrowsecurity, c.relforcerowsecurity, c.relacl
from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace
where n.nspname='public' and c.relname in ('app_profiles','app_store_permissions','engrase_sync')
order by c.relname;

-- PUBLIC ALL/true bypasses the permissive matrix before repaired 0013's gates.
select policyname, permissive, roles, cmd, qual, with_check
from pg_catalog.pg_policies
where schemaname='public' and tablename='engrase_sync'
order by policyname;

-- Check existing helper owners, hardening and ACLs without invoking JWT RPCs.
select n.nspname, p.proname, pg_catalog.pg_get_function_identity_arguments(p.oid) as arguments,
       pg_catalog.pg_get_userbyid(p.proowner) as owner, p.prosecdef, p.proconfig, p.proacl,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where (n.nspname='public' and p.proname in ('resolve_authorization_scope','get_authorization_context'))
   or (n.nspname='authorization_private' and p.proname='authorization_row_in_scope')
order by n.nspname,p.proname;

select nspname, pg_catalog.pg_get_userbyid(nspowner) as owner, nspacl
from pg_catalog.pg_namespace where nspname='authorization_private';
select current_setting('pgrst.db_schemas',true) as session_exposed_schemas,
       'REVIEW actual Supabase Data API exposed schemas even if this is NULL' as required_action;
select r.rolname, d.datname, cfg.value as exposed_schema_setting
from pg_catalog.pg_db_role_setting s
left join pg_catalog.pg_roles r on r.oid=s.setrole
left join pg_catalog.pg_database d on d.oid=s.setdatabase
cross join lateral unnest(s.setconfig) cfg(value)
where cfg.value like 'pgrst.db_schemas=%';

-- 72 combinations alone do not prove readable store contents/values.
select role,count(*) as combinations from public.app_store_permissions
where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
group by role order by role;
select role,store,can_read,can_insert,can_update,can_delete,
 case when store='settings' then 'SHARED settings; non-admin READ becomes true in repaired 0013'
      when store='audit_log' then 'SCOPED SELECT intentionally denied'
      when store='users' then 'OWNER-ONLY SQL; scoped client hides legacy users'
      when store not in ('shifts','locations','equipment_types','equipment','lubricants',
       'lubrication_plans','lubrication_points','lubrication_records','anomalies','cuadrillas',
       'push_tokens','grease_validations','lubrication_assignments','lubrication_skips')
       then 'SCOPED UNKNOWN: denied'
      else 'CLASSIFIED' end as select_review
from public.app_store_permissions
where role in ('SUPERVISOR','LUBRICADOR') and (can_read or store='equipment')
order by role,store;
select store,role,can_read,
       case when can_read=false then 'PASS prior READ=false' else 'STOP baseline drift / already installed' end as install_precondition
from public.app_store_permissions
where (store='equipment' and role='LUBRICADOR')
   or (store='settings' and role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'))
order by store,role;

-- Owner-only read of internal resolver; no set role / fabricated request JWT.
select p.role, c.result->>'status' as status,c.result->>'code' as denial_code,
       c.result->'context'->>'scopeType' as scope_type,
       jsonb_array_length(coalesce(c.result->'context'->'authorizedCrewIds','[]'::jsonb)) as crews,
       jsonb_array_length(coalesce(c.result->'context'->'authorizedLocationIds','[]'::jsonb)) as locations
from public.app_profiles p
cross join lateral (select public.resolve_authorization_scope(p.auth_user_id) as result) c
where p.active=true order by p.role;

-- Projection of repaired 0013 SELECT per active profile, including tombstones.
-- Matrix-denied rows are BLOCKED by the independent restrictive matrix gate.
-- Matrix-readable/classifier-hidden rows need operational-data review.
with profiles as (
 select p.*,public.resolve_authorization_scope(p.auth_user_id) as result
 from public.app_profiles p where p.active=true
), contexts as (
 select p.*,result->'context' as ctx from profiles p where result->>'status'='AUTHORIZED'
), linked as (
 select s.*, r.payload as record_payload,
  case when s.store='grease_validations' then r.payload
       when s.store='lubrication_points' then plan.payload else s.payload end as effective_payload
 from public.engrase_sync s
 left join public.engrase_sync r on s.store='grease_validations'
  and r.store='lubrication_records'
  and r.id=coalesce(s.payload->>'lubricationRecordId',s.payload->>'recordId') and not r.deleted
 left join public.engrase_sync plan on s.store='lubrication_points'
  and plan.store='lubrication_plans' and plan.id=s.payload->>'planId' and not plan.deleted
), links as (
 select s.*, e.payload->>'locationId' as equipment_location,
  coalesce(s.effective_payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
   s.effective_payload->'operationalSnapshot'->>'executionLocationId',
   s.effective_payload->>'locationId',e.payload->>'locationId') as execution_location,
  coalesce(s.effective_payload->'operationalSnapshot'->>'crewId',
   s.effective_payload->>'crewId',s.effective_payload->>'cuadrillaId') as execution_crew
 from linked s left join public.engrase_sync e on e.store='equipment'
  and e.id=s.effective_payload->>'equipmentId' and not e.deleted
), classified as (
 select p.role,s.store,s.id,s.deleted,coalesce(m.can_read,false) as matrix_read_now,
  (coalesce(m.can_read,false) or (p.role='LUBRICADOR' and s.store='equipment')
     or (s.store='settings' and p.role in ('PLANIFICADOR','SUPERVISOR','LUBRICADOR'))) as matrix_read_after_0013,
  (case
   when s.payload is null or s.id is null or s.store is null then false
   when s.store='crew_locations' then false
   when s.store='push_tokens' then s.payload->>'userId'=p.app_user_id and s.payload->>'id'=s.id
   when s.store='users' then s.id=p.app_user_id or s.payload->>'appUserId'=p.app_user_id
                              or s.payload->>'authUserId'=p.auth_user_id::text
   when p.ctx->>'scopeType'='GLOBAL' then true
   when s.store in ('shifts','equipment_types','lubricants','settings') then true
   when s.store='cuadrillas' then (p.ctx->'authorizedCrewIds') ? s.id
   when s.store='locations' then (p.ctx->'authorizedLocationIds') ? s.id
   when s.store='equipment' then (p.ctx->'authorizedLocationIds') ? (s.payload->>'locationId')
   when s.store in ('lubrication_plans','lubrication_points') then
     s.equipment_location is not null and (p.ctx->'authorizedLocationIds') ? s.equipment_location
   when s.store='lubrication_assignments' then
     s.equipment_location is not null and (p.ctx->'authorizedLocationIds') ? s.equipment_location
     and (s.payload->>'assignedCrewId' is null or (p.ctx->'authorizedCrewIds') ? (s.payload->>'assignedCrewId'))
   when s.store in ('lubrication_records','lubrication_skips','anomalies','grease_validations') then
     (s.store<>'grease_validations' or s.record_payload is not null)
     and (s.execution_location is not null or s.execution_crew is not null)
     and (s.execution_location is null or (p.ctx->'authorizedLocationIds') ? s.execution_location)
     and (s.execution_crew is null or (p.ctx->'authorizedCrewIds') ? s.execution_crew)
   else false end) is true as classifier_visible
 from contexts p cross join links s
 left join public.app_store_permissions m on m.role=p.role and m.store=s.store
)
select role,store,deleted as tombstone,count(*) as total,
 count(*) filter(where classifier_visible) as classifier_visible,
 count(*) filter(where classifier_visible and matrix_read_after_0013) as estimated_authenticated_visible_after_0013,
 count(*) filter(where classifier_visible and not matrix_read_after_0013) as matrix_denied_and_BLOCKED_after_0013,
 count(*) filter(where matrix_read_after_0013 and not classifier_visible) as matrix_readable_but_hidden,
 count(*) filter(where not matrix_read_now and matrix_read_after_0013) as read_bit_added
from classified group by role,store,deleted order by role,store,deleted;

-- Missing/deleted links independent of user scope. Nonzero counts require
-- review; do NOT repair/delete or widen scope as part of this preflight.
with links as (
 select s.*, e.id as equipment_found,e.payload->>'locationId' as equipment_location,
        r.id as record_found,l.id as location_found,
        coalesce(s.payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
          s.payload->'operationalSnapshot'->>'executionLocationId',s.payload->>'locationId',
          e.payload->>'locationId') as execution_location,
        coalesce(s.payload->'operationalSnapshot'->>'crewId',s.payload->>'crewId',
          s.payload->>'cuadrillaId') as execution_crew
 from public.engrase_sync s
 left join public.engrase_sync plan on s.store='lubrication_points'
  and plan.store='lubrication_plans' and plan.id=s.payload->>'planId' and not plan.deleted
 left join public.engrase_sync e on e.store='equipment'
  and e.id=case when s.store='lubrication_points' then plan.payload->>'equipmentId' else s.payload->>'equipmentId' end and not e.deleted
 left join public.engrase_sync r on r.store='lubrication_records'
  and r.id=coalesce(s.payload->>'lubricationRecordId',s.payload->>'recordId') and not r.deleted
 left join public.engrase_sync l on l.store='locations' and l.id=s.payload->>'locationId'
  and not l.deleted and coalesce(l.payload->>'active','true')='true'
)
select store,deleted as tombstone,count(*) as total,
 count(*) filter(where store='equipment' and location_found is null) as equipment_invalid_location,
 count(*) filter(where store in ('lubrication_plans','lubrication_points','lubrication_assignments')
  and (equipment_found is null or nullif(btrim(equipment_location),'') is null)) as missing_equipment_or_location,
 count(*) filter(where store in ('lubrication_records','lubrication_skips','anomalies')
  and nullif(btrim(execution_location),'') is null and nullif(btrim(execution_crew),'') is null) as unlinked_execution,
 count(*) filter(where store='lubrication_assignments' and nullif(btrim(payload->>'assignedCrewId'),'') is null) as assignment_missing_crew,
 count(*) filter(where store='grease_validations' and record_found is null) as validation_missing_live_record,
 count(*) filter(where payload->>'id' is distinct from id) as payload_id_mismatch
from links group by store,deleted order by store,deleted;

commit;
