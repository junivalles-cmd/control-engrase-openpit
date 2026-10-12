-- Integral preflight for 0008; manual SQL Editor execution only.
-- Local checks are not production evidence. No migration is performed.
-- Every numbered section is independent; select an entire section through its semicolon.
-- Readiness is conservative: any unknown or existing projection data needs review.
-- Boolean validation accepts canonical PostgreSQL boolean spellings; unusual spellings need review.

-- 1. crew_location_preflight
with
masters as (
  select store, id, payload, deleted, updated_at,
    coalesce(lower(payload->>'active'), 'true') in ('true','t','yes','y','on','1') as active,
    payload->>'active' is not null and lower(payload->>'active') not in
      ('true','t','yes','y','on','1','false','f','no','n','off','0') as invalid_active
  from public.engrase_sync where store in ('cuadrillas','locations','crew_locations')
),
crews as (
  select *, payload->>'name' as name, payload->>'locationId' as location_id
  from masters where store = 'cuadrillas'
),
locations as (
  select *, payload->>'name' as name from masters where store = 'locations'
),
relations as (
  select *, payload->>'crew_id' as crew_id, payload->>'location_id' as location_id,
    payload->>'role' as role, active and not deleted as effective_active
  from masters where store = 'crew_locations'
),
seed_candidates as (
  select c.*, 'cl:' || c.id || ':' || c.location_id as proposed_id
  from crews c where c.active and not c.deleted and nullif(c.location_id, '') is not null
    and not exists (select 1 from relations r where r.crew_id = c.id)
),
proposed_principals as (
  select id as crew_id, location_id, 'legacy_backfill'::text as source from seed_candidates
  union all
  select crew_id, location_id, 'existing_relation' from relations
  where effective_active and role = 'PRINCIPAL'
),
principal_conflicts as (
  select location_id, array_agg(crew_id order by crew_id) as crew_ids, count(*) as principal_count
  from proposed_principals group by location_id having count(*) > 1
),
legacy_duplicates as (
  select location_id, array_agg(id order by id) as crew_ids, count(*) as crew_count
  from crews where active and not deleted and nullif(location_id, '') is not null
  group by location_id having count(*) > 1
),
orphan_legacy as (
  select c.id, c.name, c.location_id from crews c
  where c.active and not c.deleted and nullif(c.location_id,'') is not null
    and not exists (select 1 from locations l where l.id = c.location_id and not l.deleted)
),
orphan_relations as (
  select r.id, r.crew_id, r.location_id from relations r
  where not exists (select 1 from crews c where c.id = r.crew_id)
     or not exists (select 1 from locations l where l.id = r.location_id)
),
inactive_masters as (
  select r.id, r.crew_id, r.location_id from relations r where effective_active and (
    not exists (select 1 from crews c where c.id = r.crew_id and c.active and not c.deleted)
    or not exists (select 1 from locations l where l.id = r.location_id and l.active and not l.deleted))
),
duplicate_pairs as (
  select crew_id, location_id, count(*) as row_count from relations
  group by crew_id, location_id having count(*) > 1
),
object_ids as (
  select to_regclass('public.crew_locations') as coverage_oid,
    to_regclass('public.engrase_sync') as transport_oid,
    to_regclass('public.app_store_permissions') as permissions_oid
),
attrs as (
  select a.attrelid, a.attnum, a.attname, a.attnotnull, a.attgenerated,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as data_type,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and a.attrelid in
    (select coverage_oid from object_ids union all select transport_oid from object_ids
      union all select permissions_oid from object_ids)
),
constraints_meta as (
  select c.conname, c.contype, c.convalidated, c.confrelid,
    pg_catalog.pg_get_constraintdef(c.oid,true) as definition,
    array(select a.attname::text from unnest(c.conkey) with ordinality k(num,ord)
      join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.ord) as columns,
    array(select a.attname::text from unnest(c.confkey) with ordinality k(num,ord)
      join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.ord) as referenced_columns
  from pg_catalog.pg_constraint c where c.conrelid=(select coverage_oid from object_ids)
),
indexes_meta as (
  select i.indexrelid, ic.relname as index_name, i.indisunique, i.indisvalid, i.indisready,
    pg_catalog.pg_get_indexdef(i.indexrelid) as definition,
    pg_catalog.pg_get_expr(i.indpred,i.indrelid) as predicate,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(num,ord)
      join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
      where k.ord <= i.indnkeyatts order by k.ord) as columns
  from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid
  where i.indrelid=(select coverage_oid from object_ids)
),
policy_state as (
  select exists(select 1 from pg_policies where schemaname='public' and tablename='engrase_sync'
    and policyname='acceso interno con anon key') as legacy_present,
    exists(select 1 from pg_policies where schemaname='public' and tablename='engrase_sync'
      and permissive='PERMISSIVE' and
      (coalesce(qual,'') ~ '^\(*true\)*$' or coalesce(with_check,'') ~ '^\(*true\)*$')) as open_present,
    (select relrowsecurity from pg_catalog.pg_class where oid=(select transport_oid from object_ids)) as transport_rls,
    (select count(*) from pg_policies where schemaname='public' and tablename='engrase_sync'
      and coalesce(qual,'') like '%current_app_%') as auth_policy_count
),
shape_checks as (
  select
    not exists (select 1 from (values ('id','text'),('crew_id','text'),('location_id','text'),
      ('role','text'),('active','boolean'),('created_at','timestamp with time zone'),
      ('updated_at','timestamp with time zone')) expected(name,type)
      where not exists(select 1 from attrs a where a.attrelid=(select coverage_oid from object_ids)
        and a.attname=expected.name and a.data_type=expected.type and a.attnotnull))
      and not exists(select 1 from attrs where attrelid=(select coverage_oid from object_ids)
        and attname not in ('id','crew_id','location_id','role','active','created_at','updated_at','crew_store','location_store')
        and attnotnull and default_expression is null and attgenerated='') as coverage_shape,
    exists(select 1 from pg_catalog.pg_index i where i.indrelid=(select transport_oid from object_ids)
      and i.indisunique and i.indisvalid and i.indpred is null and i.indexprs is null
      and i.indnkeyatts=2 and array(select a.attname::text from unnest(i.indkey) with ordinality k(num,ord)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
        where k.ord<=i.indnkeyatts order by k.ord)=array['store','id']) as transport_key,
    exists(select 1 from pg_catalog.pg_index i where i.indrelid=(select permissions_oid from object_ids)
      and i.indisunique and i.indisvalid and i.indpred is null and i.indexprs is null and i.indnkeyatts=2
      and array(select a.attname::text from unnest(i.indkey) with ordinality k(num,ord)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
        where k.ord<=i.indnkeyatts order by k.ord)=array['store','role']) as permissions_key
),
checks as (
  select 1 as ordinal, 'PK'::text as check_name,
    case when exists(select 1 from relations where id is null) or
      exists(select 1 from relations group by id having count(*)>1) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS'
      when exists(select 1 from constraints_meta where contype='p' and columns=array['id'] and convalidated)
        then 'PASS' else 'REVIEW_REQUIRED' end as status,
    'Transport ids must be unique; existing projection requires a primary key on id.'::text as detail
  union all select 2,'FK crew',
    case when exists(select 1 from relations r where not exists(select 1 from crews c where c.id=r.crew_id))
      or not (select transport_key from shape_checks) then 'FAIL'
      when (select coverage_oid from object_ids) is not null and not exists(select 1 from constraints_meta
        where contype='f' and columns=array['crew_store','crew_id'] and referenced_columns=array['store','id']
          and confrelid=(select transport_oid from object_ids) and convalidated) then 'REVIEW_REQUIRED' else 'PASS' end,
    'All transported relations, including inactive rows, require a crew master and transport key.'
  union all select 3,'FK location',
    case when exists(select 1 from orphan_relations) or exists(select 1 from orphan_legacy o join seed_candidates s on s.id=o.id)
      or not (select transport_key from shape_checks) then 'FAIL'
      when (select coverage_oid from object_ids) is not null and not exists(select 1 from constraints_meta
        where contype='f' and columns=array['location_store','location_id'] and referenced_columns=array['store','id']
          and confrelid=(select transport_oid from object_ids) and convalidated) then 'REVIEW_REQUIRED' else 'PASS' end,
    'Both existing relations and legacy seeds require location masters.'
  union all select 4,'unique crew/location',
    case when exists(select 1 from duplicate_pairs) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS'
      when exists(select 1 from constraints_meta where contype='u' and columns=array['crew_id','location_id'] and convalidated)
        or exists(select 1 from indexes_meta where indisunique and indisvalid and predicate is null
          and columns=array['crew_id','location_id']) then 'PASS' else 'REVIEW_REQUIRED' end,
    'The pair must be unique across active and inactive relations.'
  union all select 5,'role check',
    case when exists(select 1 from relations where role is null or role not in ('PRINCIPAL','APOYO')) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS' else 'REVIEW_REQUIRED' end,
    'Allowed values are PRINCIPAL/APOYO; existing expressions are exposed for manual semantic verification.'
  union all select 6,'active constraint',
    case when exists(select 1 from masters where deleted is null) then 'FAIL'
      when exists(select 1 from masters where invalid_active) then 'REVIEW_REQUIRED'
      when (select coverage_oid from object_ids) is null then 'PASS'
      when exists(select 1 from attrs where attrelid=(select coverage_oid from object_ids)
        and attname='active' and data_type='boolean' and attnotnull and default_expression='true')
        then 'PASS' else 'REVIEW_REQUIRED' end,
    'Transport active values must be boolean-compatible; missing values default to true in 0008.'
  union all select 7,'unique active PRINCIPAL',
    case when exists(select 1 from principal_conflicts) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS' else 'REVIEW_REQUIRED' end,
    'Existing partial predicates and projection rows require review; a matching index name alone proves nothing.'
  union all select 8,'legacy backfill',
    case when exists(select 1 from orphan_legacy o join seed_candidates s on s.id=o.id) or exists(select 1 from principal_conflicts)
      or exists(select 1 from seed_candidates s join relations r on r.id=s.proposed_id)
      or exists(select 1 from seed_candidates c where invalid_active) then 'FAIL' else 'PASS' end,
    'Seeds only active nondeleted crews with nonempty locationId and no relation at all, including inactive relations.'
  union all select 9,'orphan references',
    case when exists(select 1 from orphan_relations) or exists(select 1 from orphan_legacy o join seed_candidates s on s.id=o.id)
      or exists(select 1 from inactive_masters) then 'FAIL'
      when exists(select 1 from orphan_legacy) then 'REVIEW_REQUIRED' else 'PASS' end,
    'Missing masters block foreign keys; inactive/deleted masters also affect operational coverage.'
  union all select 10,'legacy principal conflicts',
    case when exists(select 1 from principal_conflicts) then 'FAIL' else 'PASS' end,
    'Combines simulated legacy seeds with active PRINCIPAL relations; covered crews are not seeded again.'
  union all select 11,'RLS/policy prerequisite',
    case when (select legacy_present from policy_state) then 'FAIL'
      when (select open_present from policy_state) or not coalesce((select transport_rls from policy_state),false)
        or (select auth_policy_count from policy_state)=0 then 'REVIEW_REQUIRED' else 'PASS' end,
    'The exact legacy policy name aborts 0008; other open policies require security review. This does not prove 0003 was applied.'
  union all select 12,'Auth dependencies',
    case when not (select permissions_key from shape_checks)
      or to_regprocedure('public.current_app_role()') is null
      or to_regprocedure('public.current_app_active()') is null
      or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated')
      or not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.current_app_role()') and prorettype='text'::regtype)
      or not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.current_app_active()') and prorettype='boolean'::regtype) then 'FAIL'
      when exists(select 1 from (values ('store','text'),('role','text'),('can_read','boolean'),
        ('can_insert','boolean'),('can_update','boolean'),('can_delete','boolean')) expected(name,type)
        where not exists(select 1 from attrs where attrelid=(select permissions_oid from object_ids)
          and attname=expected.name and data_type=expected.type)) then 'FAIL' else 'PASS' end,
    '0008 needs the permissions key, column types, authenticated role and both Auth helper signatures.'
  union all select 13,'projection structure',
    case when (select coverage_oid from object_ids) is null then 'PASS'
      when not (select coverage_shape from shape_checks) then 'FAIL' else 'REVIEW_REQUIRED' end,
    'An existing projection needs generated discriminators, compatible defaults and direct row inspection; metadata alone is insufficient.'
  union all select 14,'payload identity and timestamps',
    case when exists(select 1 from relations where payload->>'id' is distinct from id) then 'FAIL'
      when exists(select 1 from relations where payload->>'created_at' is not null) then 'REVIEW_REQUIRED' else 'PASS' end,
    'The trigger checks payload id. Nonempty created_at needs timestamp parsing review; no potentially failing cast or version-specific validator is used.'
  union all select 15,'unfiltered data visibility',
    case when exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_roles r on r.rolname=current_user
      where c.oid=(select transport_oid from object_ids) and
        (not c.relrowsecurity or r.rolsuper or r.rolbypassrls or (c.relowner=r.oid and not c.relforcerowsecurity)))
      then 'PASS' else 'REVIEW_REQUIRED' end,
    'RLS-filtered counts cannot certify the complete production dataset.'
  union all select 16,'transport structure',
    case when exists(select 1 from (values ('store','text'),('id','text'),('payload','jsonb'),
      ('deleted','boolean'),('updated_at','timestamp with time zone')) expected(name,type)
      where not exists(select 1 from attrs where attrelid=(select transport_oid from object_ids)
        and attname=expected.name and data_type=expected.type and attnotnull)) then 'FAIL' else 'PASS' end,
    'Transport types must match the real schema used by 0008.'
  union all select 17,'reserved object names',
    case when (select coverage_oid from object_ids) is null and
      (to_regclass('public.crew_locations_one_principal') is not null or to_regclass('public.crew_locations_crew_active') is not null)
      then 'REVIEW_REQUIRED' else 'PASS' end,
    'Reserved index names must not belong to unrelated objects; existing definitions are shown for review.'
  union all select 18,'projection helper signature',
    case when to_regprocedure('public.project_crew_location()') is null then 'PASS'
      when exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.project_crew_location()') and prorettype='trigger'::regtype)
        then 'PASS' else 'FAIL' end,
    'An existing zero-argument projection helper must return trigger, as required by 0008.'
)
select jsonb_build_object(
  'total_crews',(select count(*) from crews),
  'active_crews',(select count(*) from crews where active and not deleted),
  'active_crew_detail',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'location_id',location_id,'active',active,'deleted',deleted) order by id),'[]'::jsonb) from crews where active and not deleted),
  'crews_with_legacy_location',(select count(*) from crews where nullif(location_id,'') is not null),
  'crews_without_legacy_location',(select count(*) from crews where nullif(location_id,'') is null),
  'active_crews_without_location',(select coalesce(jsonb_agg(id order by id),'[]'::jsonb) from crews where active and not deleted and nullif(location_id,'') is null),
  'total_locations',(select count(*) from locations),
  'legacy_locations_used',(select count(distinct location_id) from crews where active and not deleted and nullif(location_id,'') is not null),
  'orphan_crew_location_ids',(select coalesce(jsonb_agg(jsonb_build_object('id',c.id,'location_id',c.location_id)),'[]'::jsonb) from crews c where nullif(c.location_id,'') is not null and not exists(select 1 from locations l where l.id=c.location_id and not l.deleted)),
  'orphan_legacy_locations',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from orphan_legacy o),
  'duplicate_legacy_principal_locations',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from legacy_duplicates d),
  'duplicate_legacy_locations',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from legacy_duplicates d),
  'simulated_backfill_rows',(select count(*) from seed_candidates),
  'simulated_backfill_crews',(select count(distinct id) from seed_candidates),
  'simulated_backfill_locations',(select count(distinct location_id) from seed_candidates),
  'simulated_principal_conflicts',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from principal_conflicts p),
  'multiple_principals_after_backfill',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb) from principal_conflicts p),
  'orphan_relation_references',(select coalesce(jsonb_agg(to_jsonb(o)),'[]'::jsonb) from orphan_relations o),
  'active_relations_with_inactive_master',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from inactive_masters i),
  'invalid_relation_roles',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'role',role)),'[]'::jsonb) from relations where role is null or role not in ('PRINCIPAL','APOYO')),
  'duplicate_relation_pairs',(select coalesce(jsonb_agg(to_jsonb(d)),'[]'::jsonb) from duplicate_pairs d),
  'inconsistent_master_ids',(select coalesce(jsonb_agg(jsonb_build_object('store',store,'id',id,'payload_id',payload->>'id')),'[]'::jsonb) from masters where payload->>'id' is distinct from id),
  'invalid_active_values',(select coalesce(jsonb_agg(jsonb_build_object('store',store,'id',id)),'[]'::jsonb) from masters where invalid_active),
  'crew_80_177_found',exists(select 1 from crews where id='80-177' or name ~ '(^|[^0-9])80-177([^0-9]|$)'),
  'crew_locations_table_exists',(select coverage_oid is not null from object_ids),
  'legacy_open_policy_detected',(select legacy_present or open_present from policy_state),
  'auth_cutover_compatibility',case when (select legacy_present from policy_state) then 'INCOMPATIBLE_WITH_0008'
    when exists(select 1 from checks where check_name in ('RLS/policy prerequisite','Auth dependencies') and status<>'PASS') then 'REVIEW_REQUIRED' else 'COMPATIBLE_WITH_0008' end,
  'ready_candidate',not exists(select 1 from checks where status in ('FAIL','REVIEW_REQUIRED')),
  'preconditions',(select jsonb_agg(jsonb_build_object('check_name',check_name,'status',status,'detail',detail) order by ordinal) from checks)
) as crew_location_preflight;

-- 2. conflicts_detail
with
masters as (
  select store, id, payload, deleted, updated_at,
    coalesce(lower(payload->>'active'), 'true') in ('true','t','yes','y','on','1') as active,
    payload->>'active' is not null and lower(payload->>'active') not in
      ('true','t','yes','y','on','1','false','f','no','n','off','0') as invalid_active
  from public.engrase_sync where store in ('cuadrillas','locations','crew_locations')
),
crews as (
  select *, payload->>'name' as name, payload->>'locationId' as location_id
  from masters where store = 'cuadrillas'
),
locations as (
  select *, payload->>'name' as name from masters where store = 'locations'
),
relations as (
  select *, payload->>'crew_id' as crew_id, payload->>'location_id' as location_id,
    payload->>'role' as role, active and not deleted as effective_active
  from masters where store = 'crew_locations'
),
seed_candidates as (
  select c.*, 'cl:' || c.id || ':' || c.location_id as proposed_id
  from crews c where c.active and not c.deleted and nullif(c.location_id, '') is not null
    and not exists (select 1 from relations r where r.crew_id = c.id)
),
proposed_principals as (
  select id as crew_id, location_id, 'legacy_backfill'::text as source from seed_candidates
  union all
  select crew_id, location_id, 'existing_relation' from relations
  where effective_active and role = 'PRINCIPAL'
),
principal_conflicts as (
  select location_id, array_agg(crew_id order by crew_id) as crew_ids, count(*) as principal_count
  from proposed_principals group by location_id having count(*) > 1
),
legacy_duplicates as (
  select location_id, array_agg(id order by id) as crew_ids, count(*) as crew_count
  from crews where active and not deleted and nullif(location_id, '') is not null
  group by location_id having count(*) > 1
),
orphan_legacy as (
  select c.id, c.name, c.location_id from crews c
  where c.active and not c.deleted and nullif(c.location_id,'') is not null
    and not exists (select 1 from locations l where l.id = c.location_id and not l.deleted)
),
orphan_relations as (
  select r.id, r.crew_id, r.location_id from relations r
  where not exists (select 1 from crews c where c.id = r.crew_id)
     or not exists (select 1 from locations l where l.id = r.location_id)
),
inactive_masters as (
  select r.id, r.crew_id, r.location_id from relations r where effective_active and (
    not exists (select 1 from crews c where c.id = r.crew_id and c.active and not c.deleted)
    or not exists (select 1 from locations l where l.id = r.location_id and l.active and not l.deleted))
),
duplicate_pairs as (
  select crew_id, location_id, count(*) as row_count from relations
  group by crew_id, location_id having count(*) > 1
)
select 'conflicts_detail' as result_name, p.location_id, l.name as location_name,
  p.crew_id, c.name as crew_name, p.source, 'SIMULATED_PRINCIPAL_CONFLICT' as conflict_type
from proposed_principals p join principal_conflicts f on f.location_id is not distinct from p.location_id
left join crews c on c.id=p.crew_id left join locations l on l.id=p.location_id
union all
select 'conflicts_detail', c.location_id,l.name,c.id,c.name,'legacy_reference','DUPLICATE_LEGACY_LOCATION'
from crews c join legacy_duplicates d on d.location_id=c.location_id
left join locations l on l.id=c.location_id where c.active and not c.deleted
order by location_id, conflict_type, crew_id;

-- 3. crew_80_177
with crew_matches as (
  select id,payload,deleted from public.engrase_sync where store='cuadrillas'
    and (id='80-177' or payload->>'name' ~ '(^|[^0-9])80-177([^0-9]|$)')
)
select 'crew_80_177' as result_name,c.id,c.payload->>'name' as crew_name,c.deleted,
  c.payload->>'active' as active_stored,
  coalesce(lower(c.payload->>'active'),'true') in ('true','t','yes','y','on','1') and not c.deleted as active,
  c.payload->>'locationId' as legacy_location_id,l.payload->>'name' as location_name,
  c.payload->>'isDefault' as legacy_is_default,
  coalesce(c.payload->'memberUserIds','[]'::jsonb) as member_user_ids,
  (select coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.payload->>'name','active',u.payload->>'active','deleted',u.deleted) order by u.id),'[]'::jsonb)
    from public.engrase_sync u where u.store='users' and
      case when jsonb_typeof(c.payload->'memberUserIds')='array' then c.payload->'memberUserIds' else '[]'::jsonb end ? u.id) as members,
  (select coalesce(jsonb_agg(jsonb_build_object('id',r.id,'crew_id',r.payload->>'crew_id','location_id',r.payload->>'location_id',
    'role',r.payload->>'role','active',r.payload->>'active','deleted',r.deleted) order by r.id),'[]'::jsonb)
    from public.engrase_sync r where r.store='crew_locations' and r.payload->>'crew_id'=c.id) as stored_coverage,
  'Only stored evidence; legacy locationId alone does not prove multiple locations.' as evidence_scope
from crew_matches c left join public.engrase_sync l on l.store='locations' and l.id=c.payload->>'locationId'
order by c.id;

-- 4. crew_locations_metadata
with target as (select to_regclass('public.crew_locations') as oid)
select 'crew_locations_metadata' as result_name, t.oid is not null as table_exists,
  c.relkind, c.relrowsecurity as rls_enabled,c.relforcerowsecurity as rls_forced,
  'N/A until table exists' as row_count,
  case when t.oid is null then 'Absent; row count is not applicable.'
    else 'Exact row count, active rows, roles and projection drift require a separate table-specific read after existence is confirmed.' end as row_count_detail,
  (select coalesce(jsonb_agg(jsonb_build_object('name',a.attname,'type',pg_catalog.format_type(a.atttypid,a.atttypmod),
    'not_null',a.attnotnull,'generated',a.attgenerated,'default',pg_catalog.pg_get_expr(d.adbin,d.adrelid)) order by a.attnum),'[]'::jsonb)
    from pg_catalog.pg_attribute a left join pg_catalog.pg_attrdef d on d.adrelid=a.attrelid and d.adnum=a.attnum
    where a.attrelid=t.oid and a.attnum>0 and not a.attisdropped) as columns
from target t left join pg_catalog.pg_class c on c.oid=t.oid;

-- 5. crew_locations_constraints
select 'crew_locations_constraints' as result_name,c.conname,c.contype,c.convalidated,
  pg_catalog.pg_get_constraintdef(c.oid,true) as definition,
  case when c.contype='p' then 'Compare with primary key on id'
    when c.contype='f' then 'Compare crew_store/crew_id or location_store/location_id with engrase_sync(store,id)'
    when c.contype='u' then 'Compare with unique crew_id/location_id'
    when c.contype='c' then 'Verify role permits exactly PRINCIPAL/APOYO'
    else 'Inspect for additional restrictions affecting 0008' end as expected_comparison
from pg_catalog.pg_constraint c where c.conrelid=to_regclass('public.crew_locations')
order by c.contype,c.conname;

-- 6. crew_locations_indexes
select 'crew_locations_indexes' as result_name,ic.relname as index_name,
  i.indisunique,i.indisvalid,i.indisready,pg_catalog.pg_get_indexdef(i.indexrelid) as definition,
  pg_catalog.pg_get_expr(i.indpred,i.indrelid) as predicate,
  case when ic.relname='crew_locations_one_principal' then 'Expected unique location_id where active and role PRINCIPAL'
    when ic.relname='crew_locations_crew_active' then 'Expected crew_id/active'
    else 'Compare equivalent keys and predicates; names alone are insufficient' end as expected_comparison
from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid
where i.indrelid=to_regclass('public.crew_locations') order by ic.relname;

-- 7. relevant_policies
select 'relevant_policies' as result_name,schemaname,tablename,policyname,permissive,roles,cmd,qual,with_check,
  tablename='engrase_sync' and policyname='acceso interno con anon key' as blocks_0008_by_name
from pg_policies where schemaname='public'
  and tablename in ('engrase_sync','crew_locations','app_profiles','app_store_permissions')
order by tablename,policyname;

-- 8. migration_preconditions
with
masters as (
  select store, id, payload, deleted, updated_at,
    coalesce(lower(payload->>'active'), 'true') in ('true','t','yes','y','on','1') as active,
    payload->>'active' is not null and lower(payload->>'active') not in
      ('true','t','yes','y','on','1','false','f','no','n','off','0') as invalid_active
  from public.engrase_sync where store in ('cuadrillas','locations','crew_locations')
),
crews as (
  select *, payload->>'name' as name, payload->>'locationId' as location_id
  from masters where store = 'cuadrillas'
),
locations as (
  select *, payload->>'name' as name from masters where store = 'locations'
),
relations as (
  select *, payload->>'crew_id' as crew_id, payload->>'location_id' as location_id,
    payload->>'role' as role, active and not deleted as effective_active
  from masters where store = 'crew_locations'
),
seed_candidates as (
  select c.*, 'cl:' || c.id || ':' || c.location_id as proposed_id
  from crews c where c.active and not c.deleted and nullif(c.location_id, '') is not null
    and not exists (select 1 from relations r where r.crew_id = c.id)
),
proposed_principals as (
  select id as crew_id, location_id, 'legacy_backfill'::text as source from seed_candidates
  union all
  select crew_id, location_id, 'existing_relation' from relations
  where effective_active and role = 'PRINCIPAL'
),
principal_conflicts as (
  select location_id, array_agg(crew_id order by crew_id) as crew_ids, count(*) as principal_count
  from proposed_principals group by location_id having count(*) > 1
),
legacy_duplicates as (
  select location_id, array_agg(id order by id) as crew_ids, count(*) as crew_count
  from crews where active and not deleted and nullif(location_id, '') is not null
  group by location_id having count(*) > 1
),
orphan_legacy as (
  select c.id, c.name, c.location_id from crews c
  where c.active and not c.deleted and nullif(c.location_id,'') is not null
    and not exists (select 1 from locations l where l.id = c.location_id and not l.deleted)
),
orphan_relations as (
  select r.id, r.crew_id, r.location_id from relations r
  where not exists (select 1 from crews c where c.id = r.crew_id)
     or not exists (select 1 from locations l where l.id = r.location_id)
),
inactive_masters as (
  select r.id, r.crew_id, r.location_id from relations r where effective_active and (
    not exists (select 1 from crews c where c.id = r.crew_id and c.active and not c.deleted)
    or not exists (select 1 from locations l where l.id = r.location_id and l.active and not l.deleted))
),
duplicate_pairs as (
  select crew_id, location_id, count(*) as row_count from relations
  group by crew_id, location_id having count(*) > 1
),
object_ids as (
  select to_regclass('public.crew_locations') as coverage_oid,
    to_regclass('public.engrase_sync') as transport_oid,
    to_regclass('public.app_store_permissions') as permissions_oid
),
attrs as (
  select a.attrelid, a.attnum, a.attname, a.attnotnull, a.attgenerated,
    pg_catalog.format_type(a.atttypid,a.atttypmod) as data_type,
    pg_catalog.pg_get_expr(d.adbin,d.adrelid) as default_expression
  from pg_catalog.pg_attribute a
  left join pg_catalog.pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
  where a.attnum > 0 and not a.attisdropped and a.attrelid in
    (select coverage_oid from object_ids union all select transport_oid from object_ids
      union all select permissions_oid from object_ids)
),
constraints_meta as (
  select c.conname, c.contype, c.convalidated, c.confrelid,
    pg_catalog.pg_get_constraintdef(c.oid,true) as definition,
    array(select a.attname::text from unnest(c.conkey) with ordinality k(num,ord)
      join pg_catalog.pg_attribute a on a.attrelid=c.conrelid and a.attnum=k.num order by k.ord) as columns,
    array(select a.attname::text from unnest(c.confkey) with ordinality k(num,ord)
      join pg_catalog.pg_attribute a on a.attrelid=c.confrelid and a.attnum=k.num order by k.ord) as referenced_columns
  from pg_catalog.pg_constraint c where c.conrelid=(select coverage_oid from object_ids)
),
indexes_meta as (
  select i.indexrelid, ic.relname as index_name, i.indisunique, i.indisvalid, i.indisready,
    pg_catalog.pg_get_indexdef(i.indexrelid) as definition,
    pg_catalog.pg_get_expr(i.indpred,i.indrelid) as predicate,
    array(select a.attname::text from unnest(i.indkey) with ordinality k(num,ord)
      join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
      where k.ord <= i.indnkeyatts order by k.ord) as columns
  from pg_catalog.pg_index i join pg_catalog.pg_class ic on ic.oid=i.indexrelid
  where i.indrelid=(select coverage_oid from object_ids)
),
policy_state as (
  select exists(select 1 from pg_policies where schemaname='public' and tablename='engrase_sync'
    and policyname='acceso interno con anon key') as legacy_present,
    exists(select 1 from pg_policies where schemaname='public' and tablename='engrase_sync'
      and permissive='PERMISSIVE' and
      (coalesce(qual,'') ~ '^\(*true\)*$' or coalesce(with_check,'') ~ '^\(*true\)*$')) as open_present,
    (select relrowsecurity from pg_catalog.pg_class where oid=(select transport_oid from object_ids)) as transport_rls,
    (select count(*) from pg_policies where schemaname='public' and tablename='engrase_sync'
      and coalesce(qual,'') like '%current_app_%') as auth_policy_count
),
shape_checks as (
  select
    not exists (select 1 from (values ('id','text'),('crew_id','text'),('location_id','text'),
      ('role','text'),('active','boolean'),('created_at','timestamp with time zone'),
      ('updated_at','timestamp with time zone')) expected(name,type)
      where not exists(select 1 from attrs a where a.attrelid=(select coverage_oid from object_ids)
        and a.attname=expected.name and a.data_type=expected.type and a.attnotnull))
      and not exists(select 1 from attrs where attrelid=(select coverage_oid from object_ids)
        and attname not in ('id','crew_id','location_id','role','active','created_at','updated_at','crew_store','location_store')
        and attnotnull and default_expression is null and attgenerated='') as coverage_shape,
    exists(select 1 from pg_catalog.pg_index i where i.indrelid=(select transport_oid from object_ids)
      and i.indisunique and i.indisvalid and i.indpred is null and i.indexprs is null
      and i.indnkeyatts=2 and array(select a.attname::text from unnest(i.indkey) with ordinality k(num,ord)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
        where k.ord<=i.indnkeyatts order by k.ord)=array['store','id']) as transport_key,
    exists(select 1 from pg_catalog.pg_index i where i.indrelid=(select permissions_oid from object_ids)
      and i.indisunique and i.indisvalid and i.indpred is null and i.indexprs is null and i.indnkeyatts=2
      and array(select a.attname::text from unnest(i.indkey) with ordinality k(num,ord)
        join pg_catalog.pg_attribute a on a.attrelid=i.indrelid and a.attnum=k.num
        where k.ord<=i.indnkeyatts order by k.ord)=array['store','role']) as permissions_key
),
checks as (
  select 1 as ordinal, 'PK'::text as check_name,
    case when exists(select 1 from relations where id is null) or
      exists(select 1 from relations group by id having count(*)>1) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS'
      when exists(select 1 from constraints_meta where contype='p' and columns=array['id'] and convalidated)
        then 'PASS' else 'REVIEW_REQUIRED' end as status,
    'Transport ids must be unique; existing projection requires a primary key on id.'::text as detail
  union all select 2,'FK crew',
    case when exists(select 1 from relations r where not exists(select 1 from crews c where c.id=r.crew_id))
      or not (select transport_key from shape_checks) then 'FAIL'
      when (select coverage_oid from object_ids) is not null and not exists(select 1 from constraints_meta
        where contype='f' and columns=array['crew_store','crew_id'] and referenced_columns=array['store','id']
          and confrelid=(select transport_oid from object_ids) and convalidated) then 'REVIEW_REQUIRED' else 'PASS' end,
    'All transported relations, including inactive rows, require a crew master and transport key.'
  union all select 3,'FK location',
    case when exists(select 1 from orphan_relations) or exists(select 1 from orphan_legacy o join seed_candidates s on s.id=o.id)
      or not (select transport_key from shape_checks) then 'FAIL'
      when (select coverage_oid from object_ids) is not null and not exists(select 1 from constraints_meta
        where contype='f' and columns=array['location_store','location_id'] and referenced_columns=array['store','id']
          and confrelid=(select transport_oid from object_ids) and convalidated) then 'REVIEW_REQUIRED' else 'PASS' end,
    'Both existing relations and legacy seeds require location masters.'
  union all select 4,'unique crew/location',
    case when exists(select 1 from duplicate_pairs) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS'
      when exists(select 1 from constraints_meta where contype='u' and columns=array['crew_id','location_id'] and convalidated)
        or exists(select 1 from indexes_meta where indisunique and indisvalid and predicate is null
          and columns=array['crew_id','location_id']) then 'PASS' else 'REVIEW_REQUIRED' end,
    'The pair must be unique across active and inactive relations.'
  union all select 5,'role check',
    case when exists(select 1 from relations where role is null or role not in ('PRINCIPAL','APOYO')) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS' else 'REVIEW_REQUIRED' end,
    'Allowed values are PRINCIPAL/APOYO; existing expressions are exposed for manual semantic verification.'
  union all select 6,'active constraint',
    case when exists(select 1 from masters where deleted is null) then 'FAIL'
      when exists(select 1 from masters where invalid_active) then 'REVIEW_REQUIRED'
      when (select coverage_oid from object_ids) is null then 'PASS'
      when exists(select 1 from attrs where attrelid=(select coverage_oid from object_ids)
        and attname='active' and data_type='boolean' and attnotnull and default_expression='true')
        then 'PASS' else 'REVIEW_REQUIRED' end,
    'Transport active values must be boolean-compatible; missing values default to true in 0008.'
  union all select 7,'unique active PRINCIPAL',
    case when exists(select 1 from principal_conflicts) then 'FAIL'
      when (select coverage_oid from object_ids) is null then 'PASS' else 'REVIEW_REQUIRED' end,
    'Existing partial predicates and projection rows require review; a matching index name alone proves nothing.'
  union all select 8,'legacy backfill',
    case when exists(select 1 from orphan_legacy o join seed_candidates s on s.id=o.id) or exists(select 1 from principal_conflicts)
      or exists(select 1 from seed_candidates s join relations r on r.id=s.proposed_id)
      or exists(select 1 from seed_candidates c where invalid_active) then 'FAIL' else 'PASS' end,
    'Seeds only active nondeleted crews with nonempty locationId and no relation at all, including inactive relations.'
  union all select 9,'orphan references',
    case when exists(select 1 from orphan_relations) or exists(select 1 from orphan_legacy o join seed_candidates s on s.id=o.id)
      or exists(select 1 from inactive_masters) then 'FAIL'
      when exists(select 1 from orphan_legacy) then 'REVIEW_REQUIRED' else 'PASS' end,
    'Missing masters block foreign keys; inactive/deleted masters also affect operational coverage.'
  union all select 10,'legacy principal conflicts',
    case when exists(select 1 from principal_conflicts) then 'FAIL' else 'PASS' end,
    'Combines simulated legacy seeds with active PRINCIPAL relations; covered crews are not seeded again.'
  union all select 11,'RLS/policy prerequisite',
    case when (select legacy_present from policy_state) then 'FAIL'
      when (select open_present from policy_state) or not coalesce((select transport_rls from policy_state),false)
        or (select auth_policy_count from policy_state)=0 then 'REVIEW_REQUIRED' else 'PASS' end,
    'The exact legacy policy name aborts 0008; other open policies require security review. This does not prove 0003 was applied.'
  union all select 12,'Auth dependencies',
    case when not (select permissions_key from shape_checks)
      or to_regprocedure('public.current_app_role()') is null
      or to_regprocedure('public.current_app_active()') is null
      or not exists(select 1 from pg_catalog.pg_roles where rolname='authenticated')
      or not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.current_app_role()') and prorettype='text'::regtype)
      or not exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.current_app_active()') and prorettype='boolean'::regtype) then 'FAIL'
      when exists(select 1 from (values ('store','text'),('role','text'),('can_read','boolean'),
        ('can_insert','boolean'),('can_update','boolean'),('can_delete','boolean')) expected(name,type)
        where not exists(select 1 from attrs where attrelid=(select permissions_oid from object_ids)
          and attname=expected.name and data_type=expected.type)) then 'FAIL' else 'PASS' end,
    '0008 needs the permissions key, column types, authenticated role and both Auth helper signatures.'
  union all select 13,'projection structure',
    case when (select coverage_oid from object_ids) is null then 'PASS'
      when not (select coverage_shape from shape_checks) then 'FAIL' else 'REVIEW_REQUIRED' end,
    'An existing projection needs generated discriminators, compatible defaults and direct row inspection; metadata alone is insufficient.'
  union all select 14,'payload identity and timestamps',
    case when exists(select 1 from relations where payload->>'id' is distinct from id) then 'FAIL'
      when exists(select 1 from relations where payload->>'created_at' is not null) then 'REVIEW_REQUIRED' else 'PASS' end,
    'The trigger checks payload id. Nonempty created_at needs timestamp parsing review; no potentially failing cast or version-specific validator is used.'
  union all select 15,'unfiltered data visibility',
    case when exists(select 1 from pg_catalog.pg_class c join pg_catalog.pg_roles r on r.rolname=current_user
      where c.oid=(select transport_oid from object_ids) and
        (not c.relrowsecurity or r.rolsuper or r.rolbypassrls or (c.relowner=r.oid and not c.relforcerowsecurity)))
      then 'PASS' else 'REVIEW_REQUIRED' end,
    'RLS-filtered counts cannot certify the complete production dataset.'
  union all select 16,'transport structure',
    case when exists(select 1 from (values ('store','text'),('id','text'),('payload','jsonb'),
      ('deleted','boolean'),('updated_at','timestamp with time zone')) expected(name,type)
      where not exists(select 1 from attrs where attrelid=(select transport_oid from object_ids)
        and attname=expected.name and data_type=expected.type and attnotnull)) then 'FAIL' else 'PASS' end,
    'Transport types must match the real schema used by 0008.'
  union all select 17,'reserved object names',
    case when (select coverage_oid from object_ids) is null and
      (to_regclass('public.crew_locations_one_principal') is not null or to_regclass('public.crew_locations_crew_active') is not null)
      then 'REVIEW_REQUIRED' else 'PASS' end,
    'Reserved index names must not belong to unrelated objects; existing definitions are shown for review.'
  union all select 18,'projection helper signature',
    case when to_regprocedure('public.project_crew_location()') is null then 'PASS'
      when exists(select 1 from pg_catalog.pg_proc where oid=to_regprocedure('public.project_crew_location()') and prorettype='trigger'::regtype)
        then 'PASS' else 'FAIL' end,
    'An existing zero-argument projection helper must return trigger, as required by 0008.'
)
select check_name,status,detail from checks order by ordinal;
