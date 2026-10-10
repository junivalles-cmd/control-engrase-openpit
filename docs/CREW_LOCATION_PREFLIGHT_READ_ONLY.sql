-- PREPARED ONLY. Not executed against production.
-- Run before 0008 with an authorized read-only account. No changes or secrets.
begin transaction read only;
with
crews as (
  select id, payload->>'locationId' location_id, payload->>'name' name,
    coalesce((payload->>'active')::boolean, true) active, deleted
  from public.engrase_sync where store = 'cuadrillas'
),
locations as (
  select id, deleted, coalesce((payload->>'active')::boolean, true) active
  from public.engrase_sync where store = 'locations'
),
relations as (
  select id, payload->>'crew_id' crew_id, payload->>'location_id' location_id,
    payload->>'role' role, not deleted and coalesce((payload->>'active')::boolean, true) active
  from public.engrase_sync where store = 'crew_locations'
),
seed_candidates as (
  select c.* from crews c where c.active and not c.deleted
    and nullif(c.location_id, '') is not null
    and not exists (select 1 from relations r where r.crew_id = c.id)
),
proposed_principals as (
  select id crew_id, location_id, 'legacy_backfill' source from seed_candidates
  union all
  select crew_id, location_id, 'existing_relation' from relations where active and role = 'PRINCIPAL'
)
select jsonb_build_object(
  'active_crews', (select coalesce(jsonb_agg(to_jsonb(c) order by c.id), '[]') from crews c where active and not deleted),
  'duplicate_legacy_locations', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from (
    select location_id, array_agg(id order by id) crew_ids, count(*) crew_count
    from crews where active and not deleted and nullif(location_id, '') is not null
    group by location_id having count(*) > 1
  ) d),
  'multiple_principals_after_backfill', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from (
    select location_id, array_agg(crew_id order by crew_id) crew_ids, count(*) principal_count
    from proposed_principals group by location_id having count(*) > 1
  ) d),
  'active_crews_without_location', (select coalesce(jsonb_agg(id order by id), '[]') from crews where active and not deleted and nullif(location_id, '') is null),
  'orphan_legacy_locations', (select coalesce(jsonb_agg(to_jsonb(c)), '[]') from crews c
    where c.active and not c.deleted and nullif(c.location_id, '') is not null
      and not exists (select 1 from locations l where l.id = c.location_id and not l.deleted)),
  'orphan_relation_references', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from relations r
    where not exists (select 1 from crews c where c.id = r.crew_id)
      or not exists (select 1 from locations l where l.id = r.location_id)),
  'active_relations_with_inactive_master', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from relations r
    where r.active and (
      not exists (select 1 from crews c where c.id = r.crew_id and c.active and not c.deleted)
      or not exists (select 1 from locations l where l.id = r.location_id and l.active and not l.deleted))),
  'invalid_relation_roles', (select coalesce(jsonb_agg(to_jsonb(r)), '[]') from relations r where role is null or role not in ('PRINCIPAL', 'APOYO')),
  'duplicate_relation_pairs', (select coalesce(jsonb_agg(to_jsonb(d)), '[]') from (
    select crew_id, location_id, count(*) row_count from relations
    group by crew_id, location_id having count(*) > 1
  ) d)
) as crew_location_preflight;

-- Inspect all transport policies: a permissive policy combines by OR.
-- The known open legacy policy is a blocking prerequisite for 0008.
select policyname, permissive, roles, cmd, qual, with_check
from pg_policies where schemaname = 'public' and tablename = 'engrase_sync'
order by policyname;
commit;
