-- STAGING ONLY. READ ONLY. Requires a reviewed 0016 schema, not a mock.
-- This catalog gate is necessary but cannot certify Auth/HTTP sync or
-- full production equivalence; missing grant/matrix/Storage reference
-- information must remain BLOCKED rather than being guessed.
begin transaction read only;
select current_setting('transaction_read_only') as read_only;
select '0016_WRAPPER' as check_name,
  md5(regexp_replace(p.prosrc,'[[:space:]]','','g'))='8493617b1e85891beb6302495414d3d8' as matches_cached_wrapper,
  p.prosecdef,p.proconfig
from pg_proc p where oid=to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)');
select 'POLICIES' as check_name,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='public' and tablename='engrase_sync' order by policyname;
select 'MATRIX' as check_name,store,role,can_read,can_insert,can_update,can_delete
from public.app_store_permissions order by store,role;
select 'INDEXES' as check_name,schemaname,tablename,indexname,indexdef
from pg_indexes where (schemaname='public' and tablename in ('engrase_sync','app_profiles','app_store_permissions','crew_locations'))
  or schemaname='authorization_private' order by schemaname,tablename,indexname;
select 'TABLE_GRANTS' as check_name,grantee,table_schema,table_name,privilege_type
from information_schema.role_table_grants
where table_schema in ('public','authorization_private','storage')
  and grantee in ('anon','authenticated','service_role') order by table_schema,table_name,grantee,privilege_type;
select 'STORAGE_BUCKET' as check_name,id,public from storage.buckets where id='engrase-photos';
select 'STORAGE_POLICIES' as check_name,policyname,permissive,roles,cmd,qual,with_check
from pg_policies where schemaname='storage' and tablename='objects' order by policyname;
select 'NO_0017' as check_name,
  to_regprocedure('authorization_private.broadcast_row_in_scope(text,text,jsonb,text,jsonb)') is null as no_broadcast,
  to_regprocedure('authorization_private.manual_task_row_in_scope(text,text,jsonb,text,jsonb)') is null as no_manual_task,
  (select count(*) from app_store_permissions where store in ('broadcast_messages','broadcast_message_reads','manual_tasks'))=0 as no_new_grants;
rollback;
