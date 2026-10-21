-- STAGING ONLY. Execute ONLY in the reviewed isolated target.
-- The LOCAL launcher must first verify container identity / no remote link.
-- This marker is an additional guard, NOT proof of target identity or fidelity.
begin;
create schema test0017_private;
revoke all on schema test0017_private from public,anon,authenticated;
create table test0017_private.environment (
  id text primary key check(id='TEST0017'),
  environment text not null check(environment='STAGING')
);
insert into test0017_private.environment values('TEST0017','STAGING');
commit;
