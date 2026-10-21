-- PRE-APPLY ONLY. All statements are SELECT inside READ ONLY.
-- No migration, DDL, DML, fixtures, role switching or JWT simulation.
-- Single result set preserves every check in the Supabase CLI output.
begin transaction read only;
with
environment as (
-- PRE-APPLY, safe for manual inspection of the existing production catalog.
-- NO installation, fixtures, DML/DDL, role switching or simulated JWT.
-- Requires postgres/catalog access. Does not prove post-0017 RLS behavior.
-- Expected source hashes come from the unchanged local 0016 file.
-- Whitespace-free comparison is specific to this wrapper, whose string
-- literals contain no whitespace. Raw mismatch is retained as evidence.
-- No statement_timeout increase. Any FAIL / unexpected object: STOP.


select current_database() as database_name,current_user as database_role,
  current_timestamp as checked_at,version() as postgres_version,
  current_setting('transaction_read_only') as transaction_read_only
),
precheck_0016 as (
with installed as (
  select p.prosrc,p.prosecdef,p.proconfig,
    md5(btrim(replace(p.prosrc,E'\r\n',E'\n'))) as normalized_source_md5,
    md5(regexp_replace(p.prosrc,'[[:space:]]','','g')) as no_whitespace_md5
  from pg_catalog.pg_proc p
  where p.oid=to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)')
)
select 'PRECHECK_0016' as check_name,
  case when count(*)=1 and bool_and(no_whitespace_md5='8493617b1e85891beb6302495414d3d8'
    and prosecdef and proconfig @> array['search_path=pg_catalog'])
    then 'PASS_EXPECTED_0016_BODY_IGNORING_WHITESPACE' else 'FAIL_OR_DRIFT' end as result,
  min(normalized_source_md5) as installed_source_md5,
  min(no_whitespace_md5) as no_whitespace_md5,
  bool_and(normalized_source_md5='58cb6292bf7ad185be32ead2004dcf90') as exact_format_match
from installed
),
precheck_0017 as (
with objects as (
  select to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is not null as broadcast_helper_exists,
    to_regprocedure('authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb)') is not null as manual_task_helper_exists,
    (select count(*) from public.app_store_permissions
      where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')) as new_store_permission_rows,
    (select count(*) from public.engrase_sync
      where store in ('broadcast_messages','broadcast_message_reads','manual_tasks')) as new_store_data_rows,
    exists(select 1 from pg_catalog.pg_proc
      where oid=to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)')
      and (prosrc ilike '%broadcast_row_in_scope%' or prosrc ilike '%manual_task_row_in_scope%')) as dispatcher_has_0017_branch
)
select 'PRECHECK_0017' as check_name,
  case when not broadcast_helper_exists and not manual_task_helper_exists
    and new_store_permission_rows=0 and new_store_data_rows=0 and not dispatcher_has_0017_branch
    then 'PASS_ABSENT_NO_PARTIAL_OBJECTS' else 'STOP_POSSIBLE_PARTIAL_OR_PRIOR_0017' end as result,
  objects.* from objects
),
policies as (
with expected(policyname,cmd,is_scope) as (values
  ('authorization_store_select','SELECT',false),('authorization_store_insert','INSERT',false),
  ('authorization_store_update','UPDATE',false),('authorization_store_delete','DELETE',false),
  ('authorization_scope_select','SELECT',true),('authorization_scope_insert','INSERT',true),
  ('authorization_scope_update','UPDATE',true),('authorization_scope_delete','DELETE',true)
), inspected as (
  select e.*,p.permissive,p.roles,p.cmd as actual_cmd,p.qual,p.with_check,
    coalesce(p.permissive='RESTRICTIVE' and p.cmd=e.cmd and p.roles=array['authenticated']::name[]
      and (not e.is_scope or case when e.cmd='SELECT'
        then position('authorization_row_in_scope(' in coalesce(p.qual,''))>0
        else position('authorization_row_in_scope_baseline_0013(' in coalesce(p.with_check,p.qual,''))>0 end)
      and (e.cmd<>'UPDATE' or not e.is_scope
        or position('authorization_row_in_scope_baseline_0013(' in coalesce(p.qual,''))>0),false) as matches_expected
  from expected e left join pg_catalog.pg_policies p
    on p.schemaname='public' and p.tablename='engrase_sync' and p.policyname=e.policyname
)
select 'PRECHECK_POLICIES' as check_name,policyname,
  case when matches_expected then 'PASS' else 'FAIL_OR_DRIFT' end as result,
  permissive,roles,actual_cmd,qual,with_check from inspected order by policyname
),
rls_table as (
select 'RLS_TABLE' as check_name,relrowsecurity,relforcerowsecurity,
  pg_catalog.pg_get_userbyid(relowner) as owner
from pg_catalog.pg_class where oid='public.engrase_sync'::regclass
),
existing_store_counts as (
-- No payload contents, names, account IDs, JWTs, tokens or credentials.
select 'EXISTING_STORE_COUNTS' as check_name,store,count(*) as total_rows,
  count(*) filter(where not deleted) as nondeleted_rows
from public.engrase_sync group by store order by store
),
existing_matrix as (
select 'EXISTING_MATRIX' as check_name,store,count(*) as role_rows,
  count(*) filter(where can_read) as readable_role_rows
from public.app_store_permissions group by store order by store
),
profile_roles as (
select 'PROFILE_ROLES' as check_name,role,count(*) as active_profiles
from public.app_profiles where active group by role order by role
),
new_function_scan as (
select 'NEW_FUNCTION_NAME_SCAN' as check_name,n.nspname,p.proname
from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace
where n.nspname in ('authorization_private','public')
  and (p.proname like '%broadcast%' or p.proname like '%manual_task%')
order by n.nspname,p.proname
),
migration_state as (
  select version,applied_at,matrix_digest
  from authorization_private.release_migration_state
  where version like '0016%' or version like '0017%'
  order by version
)
select jsonb_build_object(
  'environment',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from environment r),
  'precheck_0016',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from precheck_0016 r),
  'precheck_0017',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from precheck_0017 r),
  'policies',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from policies r),
  'rls_table',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from rls_table r),
  'existing_store_counts',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from existing_store_counts r),
  'existing_matrix',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from existing_matrix r),
  'profile_roles',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from profile_roles r),
  'new_function_scan',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from new_function_scan r),
  'migration_state',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from migration_state r)
) as preflight;
rollback;
