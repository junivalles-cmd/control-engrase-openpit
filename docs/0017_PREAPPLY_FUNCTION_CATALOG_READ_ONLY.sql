-- HASHES AND METADATA ONLY. Never exports production function source.
-- A whitespace-free hash can distinguish layout from source drift for
-- this particular wrapper (its string literals contain no whitespace).
begin transaction read only;
select p.prosecdef,p.proconfig,
  pg_catalog.pg_get_userbyid(p.proowner) as owner,
  md5(btrim(replace(p.prosrc,E'\r\n',E'\n'))) as source_md5,
  md5(regexp_replace(p.prosrc,'[[:space:]]','','g')) as no_whitespace_md5,
  exists(select 1 from pg_catalog.pg_proc q
    where q.oid=to_regprocedure('authorization_private.support_row_granted(text,text,jsonb)')) as support_row_granted_exists,
  to_regclass('authorization_private.release_migration_state') is not null as release_ledger_exists,
  current_setting('transaction_read_only') as transaction_read_only
from pg_catalog.pg_proc p
where p.oid=to_regprocedure('authorization_private.authorization_row_in_scope(text,text,jsonb,text,jsonb)');
rollback;
