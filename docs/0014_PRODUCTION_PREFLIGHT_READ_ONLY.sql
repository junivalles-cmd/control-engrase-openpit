-- EXACT MANUAL READ-ONLY PREFLIGHT for additive 0014, as postgres.
-- No impersonation, writes, repairs, grants or mutating RPCs.
-- Actual Data API must exclude authorization_private and internal dispatchers.
begin transaction read only;
select current_user as installer;
select c.relname,pg_get_userbyid(c.relowner) as owner,c.relrowsecurity,c.relforcerowsecurity,c.relacl
from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public'
 and c.relname in ('engrase_sync','app_profiles','app_store_permissions','operational_catalog_receipts');

-- All eight 0013 gates must be RESTRICTIVE / authenticated-only / correct cmd.
with expected(name,cmd) as (values
 ('authorization_store_select','SELECT'),('authorization_store_insert','INSERT'),
 ('authorization_store_update','UPDATE'),('authorization_store_delete','DELETE'),
 ('authorization_scope_select','SELECT'),('authorization_scope_insert','INSERT'),
 ('authorization_scope_update','UPDATE'),('authorization_scope_delete','DELETE'))
select e.name,e.cmd as expected_cmd,p.cmd,p.permissive,p.roles,p.qual,p.with_check,
 case when p.cmd=e.cmd and p.permissive='RESTRICTIVE' and p.roles=array['authenticated']::name[]
 then 'CHECK EXPRESSIONS against installed repaired 0013' else 'STOP missing/drifted gate' end as review
from expected e left join pg_policies p on p.schemaname='public' and p.tablename='engrase_sync' and p.policyname=e.name
order by e.name;
select policyname,cmd,permissive,roles,qual,with_check from pg_policies
where schemaname='public' and tablename='engrase_sync'
 and (policyname like 'catalog_%' or policyname='acceso interno con anon key') order by policyname;
select pg_get_functiondef('public.get_authorization_context()'::regprocedure) as readiness_definition;
select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as arguments,
 pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname='authorization_private' and p.proname in ('authorization_store_action_allowed','authorization_row_in_scope'))
 or (n.nspname='public' and p.proname in ('get_authorization_context','resolve_authorization_scope',
  'catalog_writer_role','operational_catalog_operation')) order by n.nspname,p.proname;

-- 0014 objects must be ABSENT before CREATE; do not rerun over partial objects.
select to_regclass('public.assignment_skip_operation_receipts') as receipts_must_be_null;
select p.proname,pg_get_function_identity_arguments(p.oid) as arguments from pg_proc p
where p.pronamespace='public'::regnamespace and p.proname in (
 'assignment_skip_operation','manage_lubrication_assignment','record_lubrication_skip');
select policyname from pg_policies where schemaname='public' and tablename='engrase_sync'
 and policyname in ('assignment_skip_rpc_insert_only','assignment_skip_rpc_update_only','assignment_skip_rpc_delete_only');

-- READ enables typed capability subject to role/scope. Generic write bits are
-- independently closed by 0014 PUBLIC restrictive guards; 0015 is not needed.
select role,store,can_read,can_insert,can_update,can_delete from public.app_store_permissions
where role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
 and store in ('lubrication_assignments','lubrication_skips','settings') order by role,store;
select p.role,c.result->>'status' as status,c.result->>'code' as denial_code,
 c.result->'context'->>'scopeType' as scope_type,
 c.result->'context'->>'rowScopeEnforced' as row_scope_enforced,
 jsonb_array_length(coalesce(c.result->'context'->'authorizedCrewIds','[]'::jsonb)) as crews,
 jsonb_array_length(coalesce(c.result->'context'->'authorizedLocationIds','[]'::jsonb)) as locations
from public.app_profiles p cross join lateral (
 select public.resolve_authorization_scope(p.auth_user_id) as result) c where p.active=true order by p.role;
-- Internal resolver deliberately returns readiness=false; inspect the PUBLIC
-- bootstrap definition above for true. This query does not fabricate JWTs.

-- Aggregate legacy review, no data changes or full payload disclosure.
select count(*) as pending_assignments,
 count(*) filter(where e.id is null) as missing_live_equipment,
 count(*) filter(where p.id is null or p.payload->>'equipmentId' is distinct from s.payload->>'equipmentId') as invalid_plan_link,
 count(*) filter(where c.id is null) as missing_crew,
 count(*) filter(where c.id is not null and c.payload->>'locationId' is distinct from e.payload->>'locationId') as cross_location_review_not_data_repair,
 count(*) filter(where nullif(s.payload->>'occurrenceKey','') is null) as missing_occurrence_key
from public.engrase_sync s
left join public.engrase_sync e on e.store='equipment' and e.id=s.payload->>'equipmentId' and not e.deleted
left join public.engrase_sync p on p.store='lubrication_plans' and p.id=s.payload->>'planId' and not p.deleted
left join public.engrase_sync c on c.store='cuadrillas' and c.id=s.payload->>'assignedCrewId' and not c.deleted
where s.store='lubrication_assignments' and not s.deleted and s.payload->>'status'='PENDING';
select payload->>'occurrenceKey' as occurrence_key,count(*) as duplicate_pending
from public.engrase_sync where store='lubrication_assignments' and not deleted
 and coalesce(payload->>'active','true')='true' and payload->>'status'='PENDING'
group by payload->>'occurrenceKey' having count(*)>1;
select count(*) as active_skips,
 count(*) filter(where payload->>'reason' is null or payload->>'reason' not in (
 'REPARACION','YA_ENGRASADO','SIN_TIEMPO','NO_DISPONIBLE','CONDICION_INSEGURA','OTRO')) as invalid_reason
from public.engrase_sync where store='lubrication_skips' and not deleted and coalesce(payload->>'active','true')='true';
select count(*) as active_crews,
 count(*) filter(where jsonb_typeof(s.payload->'memberUserIds') is distinct from 'array') as malformed_membership,
 count(*) filter(where not exists(select 1 from public.engrase_sync l where l.store='locations'
  and l.id=s.payload->>'locationId' and not l.deleted and coalesce(l.payload->>'active','true')='true')) as invalid_location
from public.engrase_sync s where s.store='cuadrillas' and not s.deleted and coalesce(s.payload->>'active','true')='true';
-- Review real settings/general and plan scheduling using existing DAY/NIGHT
-- preflight/runbook. Do not normalize settings, dates, shifts or plan payloads.
-- SUPPORT-V2 installed baseline fingerprints (prosrc; normalize CRLF only).
-- These six must PASS before applying the revised, complete 0014 transaction.
with expected(schema_name,function_name,body_md5) as (values
 ('public','lubrication_execution','5ed654859d0a92b618e8e20c8e31c2ad'),
 ('public','evidence_operation','778da7b8505bd8225bb160ab50dcc8fb'),
 ('public','operational_catalog_operation','d7b2e1459602852a551eee7ba9b6857f'),
 ('public','resolve_authorization_scope','29d1220cc0bd9ec3f03d50cffd82ec8f'),
 ('authorization_private','authorization_row_in_scope','c741089d1a767afd7eef83b245ffea43'),
 ('public','get_authorization_context','aac0a7bc32da3064da2da7e79be91d02'))
select e.*,p.oid::regprocedure as signature,pg_get_userbyid(p.proowner) as owner,p.prosecdef,p.proconfig,
 case when md5(replace(p.prosrc,E'\r\n',E'\n'))=e.body_md5 then 'PASS' else 'STOP baseline drift' end as review,
 pg_get_functiondef(p.oid) as installed_definition
from expected e left join pg_namespace n on n.nspname=e.schema_name
left join pg_proc p on p.pronamespace=n.oid and p.proname=e.function_name;

select to_regclass('authorization_private.support_links') as support_links_must_be_null,
 to_regclass('authorization_private.support_control') as support_control_must_be_null,
 to_regprocedure('public.get_assignment_support_context()') as support_manifest_must_be_null,
 to_regprocedure('public.authorize_assignment_evidence_upload(text,text,text)') as upload_gate_must_be_null;

-- All pending cross-location assignments, including metadata-NULL legacy.
-- Relation differences are valid support, never a request to change masters.
select a.id as assignment_id,a.payload->>'equipmentId' as equipment_id,
 e.payload->>'code' as equipment_code,e.payload->>'locationId' as equipment_location,
 c.id as assigned_crew,c.payload->>'locationId' as crew_master_location,
 a.payload->>'planId' as plan_id,a.payload->>'occurrenceKey' as occurrence_key,
 a.payload->>'assignmentType' as assignment_type,a.updated_at as assignment_version,
 case when p.id is null or p.payload->>'equipmentId' is distinct from e.id then 'STOP invalid plan relation'
 when left(coalesce(a.payload->>'occurrenceKey',''),length(p.id)+1)<>p.id||':' then 'STOP invalid occurrence prefix'
 when substring(a.payload->>'occurrenceKey' from length(p.id)+2) !~ '^(h:[0-9]+(\.[0-9]+)?|[0-9]{4}-[0-9]{2}-[0-9]{2}(:shift_(dia|noche))?)$' then 'STOP invalid occurrence shape'
 else 'REVIEW valid relation; date semantics and duplicates below' end as review
from public.engrase_sync a
left join public.engrase_sync e on e.store='equipment' and e.id=a.payload->>'equipmentId' and not e.deleted
left join public.engrase_sync p on p.store='lubrication_plans' and p.id=a.payload->>'planId' and not p.deleted
left join public.engrase_sync c on c.store='cuadrillas' and c.id=a.payload->>'assignedCrewId' and not c.deleted
where a.store='lubrication_assignments' and not a.deleted and a.payload->>'status'='PENDING'
 and (c.payload->>'locationId' is distinct from e.payload->>'locationId'
 or a.id in ('asg_muoqddz6p24k34','asg_mv2rgm9nomrcsa')) order by a.id;

-- ACL inventory: public wrappers must not imply executable internal dispatchers.
with calendar_keys as (
 select id,payload->>'occurrenceKey' as occurrence_key,
 substring(payload->>'occurrenceKey' from length(payload->>'planId')+2 for 10) as date_part
 from public.engrase_sync where store='lubrication_assignments' and not deleted
 and payload->>'status'='PENDING' and substring(payload->>'occurrenceKey' from length(payload->>'planId')+2) !~ '^h:'
), parsed as (
 select *,case when date_part ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then left(date_part,4)::integer end y,
 case when date_part ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then substring(date_part from 6 for 2)::integer end m,
 case when date_part ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then right(date_part,2)::integer end d from calendar_keys
)
select id,occurrence_key,case when y between 1 and 9999 and m between 1 and 12 and d between 1 and
 case m when 2 then case when y%400=0 or (y%4=0 and y%100<>0) then 29 else 28 end
 when 4 then 30 when 6 then 30 when 9 then 30 when 11 then 30 else 31 end
 then 'PASS calendar date' else 'STOP invalid calendar date' end as review from parsed;

select n.nspname,p.proname,pg_get_function_identity_arguments(p.oid) as args,p.proacl,
 has_function_privilege('anon',p.oid,'EXECUTE') as anon_execute,
 has_function_privilege('authenticated',p.oid,'EXECUTE') as authenticated_execute
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('authorization_private','public') and p.proname in
 ('lubrication_execution','evidence_operation','assignment_skip_operation','resolve_authorization_scope',
 'manage_lubrication_assignment','record_lubrication_skip','get_assignment_support_context',
 'report_assignment_anomaly','authorize_assignment_evidence_upload') order by n.nspname,p.proname;

-- Server receipt counts are NOT device queue inventories. Review old clients'
-- pending generic writes/DTOs separately; SQL cannot inspect their IndexedDB.
select 'execution' as receipt_kind,count(*) as receipts from public.lubrication_execution_receipts
union all select 'evidence',count(*) from public.evidence_operation_receipts;
select store,count(*) as rows_with_client_operation_markers from public.engrase_sync
where payload ?| array['_executionOperationId','_evidenceOperationId','_supportOperational','supportGrants'] group by store;
-- Residual public-bucket risk is separate; 0014 must NOT change this setting.
select id,public from storage.buckets where id='engrase-photos';
select policyname,cmd,permissive,roles,qual,with_check from pg_policies where schemaname='storage' and tablename='objects';
commit;
