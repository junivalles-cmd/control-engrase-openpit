-- STAGING ONLY. After 0017 rollback and object cleanup via Storage API.
-- This script does NOT delete files from storage.objects or Auth users.
begin;
do $guard$ begin
 if to_regclass('test0017_private.environment') is null then raise exception 'No staging marker'; end if;
 if not exists(select 1 from test0017_private.environment where id='TEST0017' and environment='STAGING') then raise exception 'Wrong environment'; end if;
 if exists(select 1 from authorization_private.release_migration_state where version='0017_broadcast_messages_scope') then raise exception 'Rollback 0017 before cleanup'; end if;
 if exists(select 1 from public.app_profiles where app_user_id not like 'TEST0017_%')
   or exists(select 1 from public.engrase_sync where id not like 'TEST0017_%') then raise exception 'Non-synthetic app data detected'; end if;
end $guard$;
delete from public.engrase_sync where id like 'TEST0017_%';
delete from public.app_profiles where app_user_id like 'TEST0017_%';
commit;
select (select count(*) from public.engrase_sync where id like 'TEST0017_%') as app_rows_left,
  (select count(*) from public.app_profiles where app_user_id like 'TEST0017_%') as profiles_left;
-- Must be 0/0. Delete the six synthetic Auth accounts with Auth Admin API
-- or Dashboard, then verify none of their @example.invalid accounts remain.
-- Remove dummy image objects with Storage API first, not SQL DELETE.
