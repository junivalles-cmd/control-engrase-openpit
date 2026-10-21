-- STAGING ONLY: captured production PRE-0017 schema/config, no app data.
-- Generated from metadata + verified local function sources. No production function source was exported.
-- External notification webhook intentionally OMITTED: must never contact production.
-- Requires an EMPTY, explicitly identified Supabase staging, with managed Auth/Storage schemas.
-- No historical migration is executed. No users, photos, operation history or credentials copied.
begin;
do $staging_guard$ begin
 if to_regclass('test0017_private.environment') is null then raise exception 'No explicit staging marker'; end if;
 if not exists(select 1 from test0017_private.environment where id='TEST0017' and environment='STAGING') then raise exception 'Wrong environment'; end if;
 if to_regclass('public.engrase_sync') is not null or to_regclass('public.app_profiles') is not null
   or to_regnamespace('authorization_private') is not null then raise exception 'Destination app schema is not empty'; end if;
 if to_regclass('auth.users') is null or to_regclass('storage.objects') is null then raise exception 'Managed Supabase Auth/Storage required'; end if;
end $staging_guard$;
set local search_path=public,extensions,pg_catalog;
set local check_function_bodies=off;
create schema authorization_private authorization postgres;

create table "authorization_private"."release_migration_state" (
  "version" text NOT NULL,
  "applied_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL,
  "matrix_digest" text NOT NULL
);

create table "authorization_private"."support_control" (
  "singleton" boolean DEFAULT true NOT NULL,
  "enabled" boolean NOT NULL
);

create table "authorization_private"."support_links" (
  "store" text NOT NULL,
  "entity_id" text NOT NULL,
  "assignment_id" text NOT NULL,
  "crew_id" text NOT NULL,
  "equipment_id" text NOT NULL,
  "plan_id" text NOT NULL,
  "occurrence_key" text NOT NULL,
  "accepted_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

create table "public"."app_profiles" (
  "auth_user_id" uuid NOT NULL,
  "app_user_id" text NOT NULL,
  "display_name" text NOT NULL,
  "role" text NOT NULL,
  "active" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

create table "public"."app_store_permissions" (
  "store" text NOT NULL,
  "role" text NOT NULL,
  "can_read" boolean DEFAULT false NOT NULL,
  "can_insert" boolean DEFAULT false NOT NULL,
  "can_update" boolean DEFAULT false NOT NULL,
  "can_delete" boolean DEFAULT false NOT NULL
);

create table "public"."assignment_skip_operation_receipts" (
  "auth_user_id" uuid NOT NULL,
  "operation_id" text NOT NULL,
  "request" jsonb NOT NULL,
  "result" jsonb NOT NULL,
  "applied_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

create table "public"."engrase_sync" (
  "store" text NOT NULL,
  "id" text NOT NULL,
  "payload" jsonb NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted" boolean DEFAULT false NOT NULL
);

create table "public"."evidence_operation_receipts" (
  "auth_user_id" uuid NOT NULL,
  "operation_id" text NOT NULL,
  "request" jsonb NOT NULL,
  "result" jsonb NOT NULL
);

create table "public"."lubrication_execution_receipts" (
  "auth_user_id" uuid NOT NULL,
  "operation_id" text NOT NULL,
  "request" jsonb NOT NULL,
  "result" jsonb NOT NULL,
  "applied_at" timestamp with time zone DEFAULT clock_timestamp() NOT NULL
);

create table "public"."operational_catalog_receipts" (
  "auth_user_id" uuid NOT NULL,
  "operation_id" text NOT NULL,
  "request" jsonb NOT NULL,
  "result" jsonb NOT NULL
);

alter table "authorization_private"."release_migration_state" add constraint "release_migration_state_pkey" PRIMARY KEY (version);

alter table "authorization_private"."support_control" add constraint "support_control_pkey" PRIMARY KEY (singleton);

alter table "authorization_private"."support_control" add constraint "support_control_singleton_check" CHECK (singleton);

alter table "authorization_private"."support_links" add constraint "support_links_pkey" PRIMARY KEY (store, entity_id, crew_id);

alter table "public"."app_profiles" add constraint "app_profiles_app_user_id_key" UNIQUE (app_user_id);

alter table "public"."app_profiles" add constraint "app_profiles_pkey" PRIMARY KEY (auth_user_id);

alter table "public"."app_profiles" add constraint "app_profiles_role_check" CHECK ((role = ANY (ARRAY['ADMINISTRADOR'::text, 'PLANIFICADOR'::text, 'SUPERVISOR'::text, 'LUBRICADOR'::text, 'VISOR'::text])));

alter table "public"."app_store_permissions" add constraint "app_store_permissions_pkey" PRIMARY KEY (store, role);

alter table "public"."app_store_permissions" add constraint "app_store_permissions_role_check" CHECK ((role = ANY (ARRAY['ADMINISTRADOR'::text, 'PLANIFICADOR'::text, 'SUPERVISOR'::text, 'LUBRICADOR'::text, 'VISOR'::text])));

alter table "public"."assignment_skip_operation_receipts" add constraint "assignment_skip_operation_receipts_pkey" PRIMARY KEY (auth_user_id, operation_id);

alter table "public"."engrase_sync" add constraint "engrase_sync_pkey" PRIMARY KEY (store, id);

alter table "public"."evidence_operation_receipts" add constraint "evidence_operation_receipts_pkey" PRIMARY KEY (auth_user_id, operation_id);

alter table "public"."lubrication_execution_receipts" add constraint "lubrication_execution_receipts_pkey" PRIMARY KEY (auth_user_id, operation_id);

alter table "public"."operational_catalog_receipts" add constraint "operational_catalog_receipts_pkey" PRIMARY KEY (auth_user_id, operation_id);

alter table "public"."app_profiles" add constraint "app_profiles_auth_user_id_fkey" FOREIGN KEY (auth_user_id) REFERENCES auth.users(id) ON DELETE CASCADE;

CREATE INDEX app_profiles_role_idx ON public.app_profiles USING btree (role);

CREATE INDEX engrase_sync_updated_at_idx ON public.engrase_sync USING btree (updated_at);

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0016_fix_support_rls_performance_PREPARED.sql (KNOWN_0016_WHITESPACE_ONLY)

create or replace function authorization_private.authorization_row_in_scope(
  p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $$
begin
 if p_action='SELECT' and auth.uid() is not null and p_context->>'status'='AUTHORIZED'
   and p_context->'context'->>'authUserId'=auth.uid()::text
   and authorization_private.support_row_granted(p_store,p_id,p_context) then return true; end if;
 return authorization_private.authorization_row_in_scope_baseline_0013(p_store,p_id,p_payload,p_action,p_context);
end $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0013_authorization_row_scope_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create or replace function authorization_private.authorization_row_in_scope_baseline_0013(
  p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $row_scope$
declare
  result jsonb;
  ctx jsonb;
  app_user text;
  crews jsonb;
  locations jsonb;
  crew_id text;
  location_id text;
  equipment_id text;
  record_id text;
  linked_payload jsonb;
  is_global boolean;
  own_row boolean;
begin
  if auth.uid() is null or p_store is null or p_id is null or p_payload is null then return false; end if;
  if p_store='crew_locations' then return false; end if;
  result := p_context;
  if result->>'status' is distinct from 'AUTHORIZED' then return false; end if;
  ctx := result->'context';
  if ctx->>'authUserId' is distinct from auth.uid()::text then return false; end if;
  app_user := ctx->>'appUserId';
  crews := coalesce(ctx->'authorizedCrewIds','[]'::jsonb);
  locations := coalesce(ctx->'authorizedLocationIds','[]'::jsonb);
  is_global := ctx->>'scopeType'='GLOBAL';

  -- Device registrations are strictly account-owned, including for Admin.
  if p_store='push_tokens' then
    return p_payload->>'userId'=app_user and p_payload->>'id'=p_id;
  elsif p_store='audit_log' and p_action in ('INSERT','UPDATE') then
    return p_payload->>'authUserId'=auth.uid()::text
      and (p_payload->>'appUserId' is null or p_payload->>'appUserId'=app_user);
  elsif p_store='users' then
    -- Treat this legacy account store as personal even for global operational
    -- roles. Admin user administration uses app_profiles/Auth, not this cache.
    own_row := p_id=app_user or p_payload->>'appUserId'=app_user
      or p_payload->>'authUserId'=auth.uid()::text;
    return own_row;
  end if;

  -- Global rows still require the independent restrictive store matrix gate.
  if is_global then return true; end if;

  -- Shared reference data with no per-crew ownership. The ordinary matrix
  -- policy still decides whether this role may read the store at all.
  if p_store in ('shifts','equipment_types','lubricants','settings') then return true; end if;

  if p_store='cuadrillas' then
    return crews ? p_id;
  elsif p_store='locations' then
    return locations ? p_id;
  elsif p_store='equipment' then
    return locations ? (p_payload->>'locationId');
  elsif p_store='lubrication_plans' then
    equipment_id := p_payload->>'equipmentId';
    if equipment_id is null then return false; end if;
    select e.payload->>'locationId' into location_id from public.engrase_sync e
      where e.store='equipment' and e.id=equipment_id and not e.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store='lubrication_points' then
    select e.payload->>'locationId' into location_id
    from public.engrase_sync p join public.engrase_sync e
      on e.store='equipment' and e.id=p.payload->>'equipmentId' and not e.deleted
    where p.store='lubrication_plans' and p.id=p_payload->>'planId' and not p.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store in ('lubrication_records','lubrication_skips','anomalies') then
    equipment_id := p_payload->>'equipmentId';
    location_id := coalesce(p_payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
      p_payload->'operationalSnapshot'->>'executionLocationId',p_payload->>'locationId');
    crew_id := coalesce(p_payload->'operationalSnapshot'->>'crewId',p_payload->>'crewId',p_payload->>'cuadrillaId');
    if location_id is null and equipment_id is not null then
      select e.payload->>'locationId' into location_id from public.engrase_sync e
        where e.store='equipment' and e.id=equipment_id and not e.deleted;
    end if;
    if location_id is not null and not (locations ? location_id) then return false; end if;
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    -- A row must carry at least one verifiable scope link; unlinked legacy
    -- rows are not leaked into a crew-scoped first pull.
    return location_id is not null or crew_id is not null;
  elsif p_store='lubrication_assignments' then
    equipment_id := p_payload->>'equipmentId';
    crew_id := p_payload->>'assignedCrewId';
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    if equipment_id is null then return false; end if;
    select e.payload->>'locationId' into location_id from public.engrase_sync e
      where e.store='equipment' and e.id=equipment_id and not e.deleted;
    return location_id is not null and locations ? location_id;
  elsif p_store='grease_validations' then
    record_id := coalesce(p_payload->>'lubricationRecordId',p_payload->>'recordId');
    if record_id is null then return false; end if;
    select r.payload into linked_payload from public.engrase_sync r
      where r.store='lubrication_records' and r.id=record_id and not r.deleted;
    if linked_payload is null then return false; end if;
    equipment_id := linked_payload->>'equipmentId';
    location_id := coalesce(linked_payload->'operationalSnapshot'->>'equipmentLocationIdAtExecution',
      linked_payload->'operationalSnapshot'->>'executionLocationId',linked_payload->>'locationId');
    crew_id := coalesce(linked_payload->'operationalSnapshot'->>'crewId',linked_payload->>'crewId',linked_payload->>'cuadrillaId');
    if location_id is null and equipment_id is not null then
      select e.payload->>'locationId' into location_id from public.engrase_sync e
        where e.store='equipment' and e.id=equipment_id and not e.deleted;
    end if;
    if location_id is not null and not (locations ? location_id) then return false; end if;
    if crew_id is not null and not (crews ? crew_id) then return false; end if;
    return location_id is not null or crew_id is not null;
  end if;

  -- Unknown stores fail closed for crew-scoped accounts.
  return false;
end
$row_scope$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0013_authorization_row_scope_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.authorization_store_action_allowed(
  p_store text, p_action text, p_deleted boolean
) returns boolean
language sql stable security definer set search_path=pg_catalog as $matrix$
  select auth.uid() is not null and p_store<>'crew_locations' and exists (
    select 1 from public.app_profiles a
    join public.app_store_permissions m on m.role=a.role and m.store=p_store
    where a.auth_user_id=auth.uid() and a.active=true
      and a.role in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR')
      and case p_action
        when 'SELECT' then m.can_read
        when 'INSERT' then m.can_insert
        when 'UPDATE_USING' then m.can_update or m.can_delete
        when 'UPDATE_CHECK' then (p_deleted and m.can_delete) or (not p_deleted and m.can_update)
        when 'DELETE' then m.can_delete
        else false end
  );
$matrix$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.link_support_entity(p_store text,p_id text,p_assignment text,p_crew text default null)
returns void language sql volatile security definer set search_path=pg_catalog as $$
 insert into authorization_private.support_links(store,entity_id,assignment_id,crew_id,equipment_id,plan_id,occurrence_key)
 select p_store,p_id,a.id,coalesce(p_crew,a.payload->>'assignedCrewId'),a.payload->>'equipmentId',a.payload->>'planId',a.payload->>'occurrenceKey'
 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=p_assignment
 on conflict do nothing;
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.support_assignment_valid(p_id text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from public.engrase_sync a
 join public.engrase_sync e on e.store='equipment' and e.id=a.payload->>'equipmentId' and not e.deleted and coalesce(e.payload->>'active','true')='true'
 join public.engrase_sync p on p.store='lubrication_plans' and p.id=a.payload->>'planId' and p.payload->>'equipmentId'=e.id and not p.deleted and coalesce(p.payload->>'active','true')='true'
 join public.engrase_sync c on c.store='cuadrillas' and c.id=a.payload->>'assignedCrewId' and not c.deleted and coalesce(c.payload->>'active','true')='true'
 join public.engrase_sync el on el.store='locations' and el.id=e.payload->>'locationId' and not el.deleted and coalesce(el.payload->>'active','true')='true'
 join public.engrase_sync cl on cl.store='locations' and cl.id=c.payload->>'locationId' and not cl.deleted and coalesce(cl.payload->>'active','true')='true'
 where a.store='lubrication_assignments' and a.id=p_id and not a.deleted
 and coalesce(a.payload->>'active','true')='true' and a.payload->>'status'='PENDING'
 and authorization_private.support_occurrence_valid(p.id,a.payload->>'occurrenceKey')
 and (select enabled from authorization_private.support_control where singleton)
 and (select count(*) from public.engrase_sync other where other.store='lubrication_assignments' and not other.deleted
   and coalesce(other.payload->>'active','true')='true' and other.payload->>'status'='PENDING'
   and other.payload->>'occurrenceKey'=a.payload->>'occurrenceKey')=1);
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.support_grant_rows()
returns table(store text,id text) language sql stable security definer set search_path=pg_catalog as $$
 with ctx as (select public.resolve_authorization_scope(auth.uid()) as c),
 operational as (
   select a.id,a.payload from public.engrase_sync a,ctx where a.store='lubrication_assignments'
   and ctx.c->>'status'='AUTHORIZED' and ctx.c->'context'->'authorizedCrewIds' ? (a.payload->>'assignedCrewId')
   and authorization_private.support_assignment_valid(a.id)
 ), historical as (
   select l.* from authorization_private.support_links l,ctx where ctx.c->>'status'='AUTHORIZED'
   and ctx.c->'context'->'authorizedCrewIds' ? l.crew_id
 ), refs as (
   select o.id assignment_id,o.payload->>'equipmentId' equipment_id,o.payload->>'planId' plan_id from operational o
   union select h.assignment_id,h.equipment_id,h.plan_id from historical h
 )
 select 'lubrication_assignments',r.assignment_id from refs r
 union select 'equipment',r.equipment_id from refs r
 union select 'lubrication_plans',r.plan_id from refs r
 union select 'lubrication_points',p.id from public.engrase_sync p join operational a on p.store='lubrication_points' and p.payload->>'planId'=a.payload->>'planId'
 union select 'locations',e.payload->>'locationId' from public.engrase_sync e join refs r on e.store='equipment' and e.id=r.equipment_id
 union select h.store,h.entity_id from historical h;
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.support_history_allowed(p_store text,p_id text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select exists(select 1 from authorization_private.support_links l,
 lateral (select public.resolve_authorization_scope(auth.uid()) as c) ctx
 where l.store=p_store and l.entity_id=p_id and ctx.c->>'status'='AUTHORIZED'
 and (ctx.c->'context'->'authorizedCrewIds' ? l.crew_id));
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.support_occurrence_valid(p_plan text,p_key text)
returns boolean language plpgsql immutable set search_path=pg_catalog as $$
declare tail text; d text;
begin
  if p_plan is null or p_key is null or left(p_key,length(p_plan)+1)<>p_plan||':' then return false; end if;
  tail:=substr(p_key,length(p_plan)+2);
  if tail ~ '^h:[0-9]+(\.[0-9]+)?$' then return true; end if;
  if tail !~ '^\d{4}-\d{2}-\d{2}(:shift_(dia|noche))?$' then return false; end if;
  d:=left(tail,10); return (d::date)::text=d;
exception when others then return false;
end $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.support_photos_owned(p_photos jsonb,p_existing jsonb default '[]'::jsonb)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 select not exists(select 1 from jsonb_array_elements(coalesce(p_photos,'[]'::jsonb)) photo
 where not coalesce(p_existing,'[]'::jsonb) @> jsonb_build_array(photo)
 and not exists(select 1 from storage.objects o where o.bucket_id='engrase-photos'
   and o.name=substring(photo#>>'{}' from '/engrase-photos/([^?#]+)$')
   and coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=auth.uid()::text));
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0016_fix_support_rls_performance_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function authorization_private.support_row_granted(
  p_store text, p_id text, p_context jsonb
) returns boolean
language plpgsql stable security definer set search_path=pg_catalog as $granted$
declare
  crews jsonb;
begin
  if p_store is null or p_id is null then return false; end if;
  crews := coalesce(p_context->'context'->'authorizedCrewIds','[]'::jsonb);
  case p_store
    -- support_grant_rows(): `select 'lubrication_assignments',r.assignment_id
    -- from refs r` (refs = operational UNION historical). `historical`
    -- selects `l.*` from ALL of support_links — NOT filtered by l.store —
    -- so refs.assignment_id comes from l.assignment_id regardless of which
    -- store that support_links row was originally linked under (e.g. a
    -- 'lubrication_records' link still grants its assignment_id here).
    -- FIX (caught in review before production): a prior draft of this
    -- branch filtered the historical exists() by `l.store=
    -- 'lubrication_assignments'`, which would deny assignment grants coming
    -- from support_links rows of any OTHER store — a real regression vs.
    -- 0014 (FALTANTES). Matching refs exactly requires matching on
    -- l.assignment_id alone, with no l.store filter.
    when 'lubrication_assignments' then
      return exists(
        select 1 from public.engrase_sync a
        where a.store='lubrication_assignments' and a.id=p_id and not a.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from authorization_private.support_links l
        where l.assignment_id=p_id and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select 'equipment',r.equipment_id from refs r`.
    when 'equipment' then
      return exists(
        select 1 from public.engrase_sync a
        where a.store='lubrication_assignments' and a.payload->>'equipmentId'=p_id and not a.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from authorization_private.support_links l
        where l.equipment_id=p_id and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select 'lubrication_plans',r.plan_id from refs r`.
    when 'lubrication_plans' then
      return exists(
        select 1 from public.engrase_sync a
        where a.store='lubrication_assignments' and a.payload->>'planId'=p_id and not a.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from authorization_private.support_links l
        where l.plan_id=p_id and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select 'lubrication_points',p.id from
    -- engrase_sync p join operational a on p.store='lubrication_points'
    -- and p.payload->>'planId'=a.payload->>'planId'` — joins `operational`
    -- ONLY, never `historical`. Preserved verbatim: no support_links branch
    -- here on purpose (a historical/support_links branch would WIDEN
    -- access beyond what 0014 actually grants for this store).
    when 'lubrication_points' then
      return exists(
        select 1 from public.engrase_sync pt
        join public.engrase_sync a on a.store='lubrication_assignments'
          and a.payload->>'planId'=pt.payload->>'planId' and not a.deleted
        where pt.store='lubrication_points' and pt.id=p_id
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      );
    -- support_grant_rows(): `select 'locations',e.payload->>'locationId'
    -- from engrase_sync e join refs r on e.store='equipment' and
    -- e.id=r.equipment_id` (refs = operational UNION historical) — this
    -- UNION branch in 0014 has NO `not e.deleted` filter at all, for either
    -- source of refs.equipment_id.
    -- The operational exists() below keeps `not e.deleted` as a harmless
    -- redundancy: any equipment_id reachable through `operational`/
    -- support_assignment_valid() is ALREADY guaranteed not deleted by that
    -- function's own join (`join engrase_sync e on ... and not e.deleted`
    -- in support_assignment_valid()), so adding the filter here changes
    -- nothing for that branch — left untouched per review.
    -- FIX (caught in review before production): the historical exists()
    -- below had the SAME `not e.deleted` filter, but support_links.
    -- equipment_id is captured once at link time with no ongoing validity
    -- check, so 0014 can still grant a location behind an equipment that
    -- was deleted AFTER the link was created. Keeping `not e.deleted` here
    -- would deny that case — a real regression vs. 0014 (FALTANTES) —
    -- removed to match 0014 exactly.
    when 'locations' then
      return exists(
        select 1 from public.engrase_sync e
        join public.engrase_sync a on a.store='lubrication_assignments'
          and a.payload->>'equipmentId'=e.id and not a.deleted
        where e.store='equipment' and e.payload->>'locationId'=p_id and not e.deleted
          and (crews ? (a.payload->>'assignedCrewId'))
          and authorization_private.support_assignment_valid(a.id)
      ) or exists(
        select 1 from public.engrase_sync e
        join authorization_private.support_links l on l.equipment_id=e.id
        where e.store='equipment' and e.payload->>'locationId'=p_id
          and (crews ? l.crew_id)
      );
    -- support_grant_rows(): `select h.store,h.entity_id from historical h`
    -- — every OTHER store it can ever emit comes ONLY from this branch
    -- (support_links directly, e.g. lubrication_records/lubrication_skips/
    -- anomalies/grease_validations today — see link_support_entity() call
    -- sites). Checking support_links by (store,id) here for ANY store,
    -- rather than a hardcoded allow-list, keeps this exactly as permissive
    -- as the original for every store in use today AND never silently
    -- diverges if a future migration calls link_support_entity() with a
    -- new store — it only ever fails CLOSED (returns false) for a store
    -- that never appears in support_links, same as today.
    else
      return exists(
        select 1 from authorization_private.support_links l
        where l.store=p_store and l.entity_id=p_id and (crews ? l.crew_id)
      );
  end case;
end
$granted$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.assignment_skip_operation(
  p_operation_id text, p_action text, p_id text, p_expected timestamptz,
  p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text,
  p_notes text, p_date timestamptz, p_shift_id text, p_reason text,
  p_observacion text, p_linked_record_id text
) returns jsonb
language plpgsql security definer set search_path=pg_catalog
as $gateway$
declare
  actor public.app_profiles%rowtype;
  ctx jsonb;
  context jsonb;
  equipment public.engrase_sync%rowtype;
  plan public.engrase_sync%rowtype;
  crew public.engrase_sync%rowtype;
  original public.engrase_sync%rowtype;
  receipt public.assignment_skip_operation_receipts%rowtype;
  request jsonb;
  result jsonb;
  row_payload jsonb;
  destination text;
  at timestamptz := clock_timestamp();
  local_day date;
  expected_occurrence text;
  weekday_name text;
  role_global boolean;
  pending_count integer;
  v_can_read boolean;
  effective_crew_id text := p_crew_id;
  day_start numeric := 6;
  night_start numeric := 18;
  dual_shift_active boolean := false;
  occurrence_shift text;
  written_count integer;
  support_assignment text;
begin
  if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into actor from public.app_profiles where auth_user_id=auth.uid() for share;
  if not found or actor.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if actor.role is null or actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
  if nullif(p_operation_id,'') is null or p_action is null or p_action not in ('CREATE','REASSIGN','CANCEL','SKIP') then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;

  lock table public.engrase_sync in share row exclusive mode;
  ctx := public.get_authorization_context();
  if ctx->>'status' is distinct from 'AUTHORIZED' or coalesce((ctx->'context'->>'rowScopeEnforced')::boolean,false) is not true then
    return jsonb_build_object('status','DENIED','code','AUTHORIZATION_SCOPE_UNAVAILABLE'); end if;
  context := ctx->'context'; role_global := context->>'scopeType'='GLOBAL';
  destination := case when p_action='SKIP' then 'lubrication_skips' else 'lubrication_assignments' end;
  select p.can_read into v_can_read from public.app_store_permissions p
    where role=actor.role and store=destination;
  if v_can_read is distinct from true then return jsonb_build_object('status','DENIED','code','PERMISSION_DENIED'); end if;
  if p_action in ('CREATE','REASSIGN','CANCEL') and actor.role='LUBRICADOR' then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;

  request := jsonb_build_array(p_action,p_id,p_expected,p_equipment_id,p_plan_id,p_occurrence_key,p_crew_id,
    p_notes,p_date,p_shift_id,p_reason,p_observacion,p_linked_record_id);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(auth.uid()::text||':'||p_operation_id,0));
  select * into receipt from public.assignment_skip_operation_receipts
    where auth_user_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.request<>request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    return receipt.result;
  end if;

  if p_action in ('CREATE','SKIP') then
    if nullif(p_id,'') is null or nullif(p_equipment_id,'') is null or (p_action='CREATE' and nullif(p_crew_id,'') is null)
       or (p_action='CREATE' and length(coalesce(p_notes,''))>1000) then
      return jsonb_build_object('status','DENIED','code','INVALID_INPUT'); end if;
    select * into equipment from public.engrase_sync where store='equipment' and id=p_equipment_id
      and not deleted and coalesce(payload->>'active','true')='true' for share;
    if not found then return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND'); end if;
    if effective_crew_id is null and p_action='SKIP' and role_global then
      select count(*),min(id) into pending_count,effective_crew_id from public.engrase_sync
        where store='cuadrillas' and not deleted and coalesce(payload->>'active','true')='true'
          and payload->>'locationId'=equipment.payload->>'locationId' and coalesce((payload->>'isDefault')::boolean,false);
      if pending_count<>1 then return jsonb_build_object('status','DENIED','code','DEFAULT_CREW_REQUIRED'); end if;
    end if;
    if effective_crew_id is null then return jsonb_build_object('status','DENIED','code','CREW_REQUIRED'); end if;
    select * into crew from public.engrase_sync where store='cuadrillas' and id=effective_crew_id
      and not deleted and coalesce(payload->>'active','true')='true' for share;
    if not found then return jsonb_build_object('status','DENIED','code','CREW_NOT_FOUND'); end if;
    select a.id into support_assignment from public.engrase_sync a
      where a.store='lubrication_assignments' and a.payload->>'equipmentId'=p_equipment_id
      and a.payload->>'planId'=p_plan_id and a.payload->>'assignedCrewId'=effective_crew_id
      and a.payload->>'occurrenceKey'=p_occurrence_key and authorization_private.support_assignment_valid(a.id);
    if crew.payload->>'locationId' is distinct from equipment.payload->>'locationId'
       and not (p_action='CREATE' and role_global) and not (p_action='SKIP' and support_assignment is not null) then
      return jsonb_build_object('status','DENIED','code','CREW_EQUIPMENT_LOCATION_MISMATCH'); end if;
    if not role_global and (not (context->'authorizedCrewIds' ? effective_crew_id)
       or (not (context->'authorizedLocationIds' ? (equipment.payload->>'locationId')) and support_assignment is null)) then
      return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
    if actor.role='SUPERVISOR' and not (crew.payload->'memberUserIds' ? actor.app_user_id) then
      return jsonb_build_object('status','DENIED','code','CREW_SCOPE_DENIED'); end if;
    select * into plan from public.engrase_sync where store='lubrication_plans'
      and id=p_plan_id and not deleted and coalesce(payload->>'active','true')='true'
      and payload->>'equipmentId'=p_equipment_id for share;
    if not found then return jsonb_build_object('status','DENIED','code','PLAN_MISMATCH'); end if;
    local_day := (at at time zone 'America/Managua')::date;
    select coalesce((payload->>'shiftDayStart')::numeric,6),coalesce((payload->>'shiftNightStart')::numeric,18)
      into day_start,night_start from public.engrase_sync where store='settings' and id='general' and not deleted;
    day_start:=coalesce(day_start,6); night_start:=coalesce(night_start,18);
    if p_action='SKIP' then occurrence_shift:=p_shift_id;
    else occurrence_shift:=regexp_replace(p_occurrence_key,'^.*:(shift_dia|shift_noche)$','\1'); end if;
    if plan.payload->'requiredShifts' @> '["shift_dia","shift_noche"]'::jsonb
       and nullif(plan.payload->>'effectiveDate','') is not null then
      if occurrence_shift='shift_noche' and extract(hour from at at time zone 'America/Managua')<day_start
         and local_day-1 >= (plan.payload->>'effectiveDate')::date then local_day:=local_day-1; end if;
      dual_shift_active:=local_day >= (plan.payload->>'effectiveDate')::date;
    end if;
    if plan.payload->>'controlType'='Día y turno de la semana' then
      expected_occurrence := case when dual_shift_active then plan.id||':'||local_day::text||':'||occurrence_shift else plan.id||':'||local_day::text end;
      weekday_name := (array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'])[extract(dow from local_day)::integer+1];
      if not dual_shift_active and support_assignment is null and not (coalesce(plan.payload->'assignedDays','[]'::jsonb) ? weekday_name) then
        return jsonb_build_object('status','DENIED','code','OCCURRENCE_NOT_SCHEDULED'); end if;
    elsif dual_shift_active then
      expected_occurrence:=plan.id||':'||local_day::text||':'||occurrence_shift;
    else
      expected_occurrence := plan.id||':h:'||coalesce(nullif(plan.payload->>'lastGreaseHour',''),'0');
    end if;
    if dual_shift_active and occurrence_shift not in ('shift_dia','shift_noche') and support_assignment is null then
      return jsonb_build_object('status','DENIED','code','SHIFT_REQUIRED'); end if;
    if p_occurrence_key is distinct from expected_occurrence and not (p_action='SKIP' and support_assignment is not null) then
      return jsonb_build_object('status','CONFLICT','code','OCCURRENCE_VERSION_CONFLICT'); end if;
  end if;

  if p_action in ('CREATE','REASSIGN','CANCEL') then
    if actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
    if p_action='CREATE' then
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment:'||p_occurrence_key,0));
      if exists(select 1 from public.engrase_sync where store='lubrication_assignments' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=p_occurrence_key and payload->>'status'='PENDING') then
        return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_ALREADY_PENDING'); end if;
      if exists(select 1 from public.engrase_sync where store='lubrication_assignments' and id=p_id) then
        return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
      row_payload := jsonb_build_object('id',p_id,'occurrenceKey',p_occurrence_key,'equipmentId',p_equipment_id,
        'planId',p_plan_id,'assignmentType',case when crew.payload->>'locationId' is distinct from equipment.payload->>'locationId' then 'SUPPORT_OTHER_LOCATION' else 'MANUAL' end,'assignedCrewId',effective_crew_id,'assignedByUserId',actor.app_user_id,
        'assignedByUserName',actor.display_name,'assignedAt',at,'status','PENDING','completedAt',null,
        'completedRecordId',null,'previousCrewId',null,'notes',coalesce(p_notes,''),'active',true,'updatedAt',at);
    else
      select * into original from public.engrase_sync where store='lubrication_assignments' and id=p_id and not deleted for update;
      if not found then return jsonb_build_object('status','DENIED','code','ASSIGNMENT_NOT_FOUND'); end if;
      if original.updated_at is distinct from p_expected then return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT'); end if;
      if original.payload->>'status' is distinct from 'PENDING' then return jsonb_build_object('status','DENIED','code','INVALID_TRANSITION'); end if;
      if original.payload->>'equipmentId' is distinct from p_equipment_id
        or original.payload->>'planId' is distinct from p_plan_id then
        return jsonb_build_object('status','DENIED','code','ASSIGNMENT_REFERENCE_MISMATCH'); end if;
      select * into equipment from public.engrase_sync where store='equipment' and id=original.payload->>'equipmentId' and not deleted for share;
      if not found then return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND'); end if;
      if not role_global and (not (context->'authorizedCrewIds' ? (original.payload->>'assignedCrewId'))
        or (not (context->'authorizedLocationIds' ? (equipment.payload->>'locationId')) and not authorization_private.support_assignment_valid(original.id))) then
        return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
      if original.payload->>'occurrenceKey' is distinct from p_occurrence_key then
        return jsonb_build_object('status','CONFLICT','code','OCCURRENCE_VERSION_CONFLICT'); end if;
      perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('assignment:'||(original.payload->>'occurrenceKey'),0));
      if p_action='REASSIGN' then
        select * into crew from public.engrase_sync where store='cuadrillas' and id=p_crew_id and not deleted
          and coalesce(payload->>'active','true')='true' for share;
        if not found then
          return jsonb_build_object('status','DENIED','code','CREW_EQUIPMENT_LOCATION_MISMATCH'); end if;
        if not role_global and not (context->'authorizedCrewIds' ? p_crew_id) then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
        if actor.role='SUPERVISOR' and not (crew.payload->'memberUserIds' ? actor.app_user_id) then return jsonb_build_object('status','DENIED','code','CREW_SCOPE_DENIED'); end if;
        if effective_crew_id is not distinct from original.payload->>'assignedCrewId' then return jsonb_build_object('status','DENIED','code','SAME_CREW'); end if;
        if exists(select 1 from public.engrase_sync where store='lubrication_assignments' and id<>p_id and not deleted
          and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=original.payload->>'occurrenceKey' and payload->>'status'='PENDING') then
          return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_ALREADY_PENDING'); end if;
        row_payload:=original.payload||jsonb_build_object('previousCrewId',original.payload->>'assignedCrewId','assignedCrewId',effective_crew_id,'updatedAt',greatest(at,original.updated_at+interval '1 microsecond'));
      else
        row_payload:=original.payload||jsonb_build_object('status','CANCELLED','completedAt',null,'updatedAt',greatest(at,original.updated_at+interval '1 microsecond'));
      end if;
    end if;
  else
    if p_date is null or p_date > at + interval '5 minutes' or p_shift_id is null or p_shift_id not in ('shift_dia','shift_noche')
      or p_reason is null or p_reason not in ('REPARACION','YA_ENGRASADO','SIN_TIEMPO','NO_DISPONIBLE','CONDICION_INSEGURA','OTRO')
      or (p_reason='OTRO' and nullif(btrim(p_observacion),'') is null)
      or (p_observacion is not null and length(p_observacion)>1000) then
      return jsonb_build_object('status','DENIED','code','INVALID_SKIP'); end if;
    if (p_date at time zone 'America/Managua')::date <> (at at time zone 'America/Managua')::date then
      return jsonb_build_object('status','DENIED','code','SKIP_DATE_NOT_CURRENT'); end if;
    if p_shift_id is distinct from (case when extract(hour from p_date at time zone 'America/Managua')>=day_start
      and extract(hour from p_date at time zone 'America/Managua')<night_start then 'shift_dia' else 'shift_noche' end) then
      return jsonb_build_object('status','DENIED','code','SHIFT_MISMATCH'); end if;
    if p_linked_record_id is not null and not exists(select 1 from public.engrase_sync r where r.store='lubrication_records'
      and r.id=p_linked_record_id and not r.deleted and r.payload->>'equipmentId'=p_equipment_id
      and coalesce(r.payload->'operationalSnapshot'->>'satisfiedOccurrenceKey',r.payload->'operationalSnapshot'->>'occurrenceKey')=p_occurrence_key) then
      return jsonb_build_object('status','DENIED','code','LINKED_RECORD_MISMATCH'); end if;
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('skip:'||p_equipment_id||':'||p_occurrence_key,0));
    if exists(select 1 from public.engrase_sync where store='lubrication_skips' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=p_occurrence_key
      and payload->>'equipmentId'=p_equipment_id) then
      return jsonb_build_object('status','CONFLICT','code','SKIP_ALREADY_RECORDED'); end if;
    if exists(select 1 from public.engrase_sync where store='lubrication_skips' and id=p_id) then
      return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
    row_payload:=jsonb_build_object('id',p_id,'equipmentId',p_equipment_id,'planId',p_plan_id,
      'occurrenceKey',p_occurrence_key,'date',p_date,'shiftId',p_shift_id,'reason',p_reason,
      'crewId',effective_crew_id,'locationId',equipment.payload->>'locationId',
      'observacion',nullif(btrim(p_observacion),''),'userId',actor.app_user_id,'userName',actor.display_name,
      'createdByAuthUserId',auth.uid(),'createdAt',at,'active',true,'linkedRecordId',p_linked_record_id,'updatedAt',at);
  end if;
  row_payload:=row_payload||jsonb_build_object('updatedAt',coalesce((row_payload->>'updatedAt')::timestamptz,at));
  -- CREATE/SKIP must never overwrite an ID inserted concurrently for a
  -- different occurrence (the occurrence advisory locks would differ).
  if p_action in ('CREATE','SKIP') then
    insert into public.engrase_sync(store,id,payload,updated_at,deleted)
      values(destination,p_id,row_payload,(row_payload->>'updatedAt')::timestamptz,false)
      on conflict(store,id) do nothing;
    get diagnostics written_count = row_count;
    if written_count=0 then return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
  else
    -- REASSIGN/CANCEL operate only on the existing row already locked and
    -- CAS-validated above; they do not create or revive a missing assignment.
    update public.engrase_sync set payload=row_payload,updated_at=(row_payload->>'updatedAt')::timestamptz
      where store=destination and id=p_id and not deleted and updated_at=p_expected;
    get diagnostics written_count = row_count;
    if written_count<>1 then return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT'); end if;
  end if;
  insert into public.engrase_sync(store,id,payload,updated_at,deleted)
    values('audit_log','assignment-skip:'||auth.uid()::text||':'||p_operation_id,
      jsonb_build_object('id','assignment-skip:'||auth.uid()::text||':'||p_operation_id,
        'action',case when p_action='SKIP' then 'LUBRICATION_SKIPPED' else 'ASSIGNMENT_'||p_action end,
        'entityId',p_id,'actorAuthUserId',auth.uid(),'appUserId',actor.app_user_id,
        'user',actor.display_name,'createdAt',at,'active',true),at,false);
  result:=jsonb_build_object('status','APPLIED','rows',jsonb_build_array(jsonb_build_object(
    'store',destination,'id',p_id,'payload',row_payload,'updated_at',(row_payload->>'updatedAt')::timestamptz)));
  if p_action='SKIP' and support_assignment is not null then perform authorization_private.link_support_entity(destination,p_id,support_assignment); end if;
  insert into public.assignment_skip_operation_receipts(auth_user_id,operation_id,request,result)
    values(auth.uid(),p_operation_id,request,result);
  return result;
end
$gateway$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.authorize_assignment_evidence_upload(p_assignment_id text,p_record_id text,p_crew_id text)
returns boolean language sql stable security definer set search_path=pg_catalog as $$
 with ctx as (select public.get_authorization_context() as c)
 select ctx.c->>'status'='AUTHORIZED' and (select enabled from authorization_private.support_control where singleton)
 and (ctx.c->'context'->>'scopeType'='GLOBAL' or ctx.c->'context'->'authorizedCrewIds' ? p_crew_id)
 and (exists(select 1 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=p_assignment_id
     and a.payload->>'assignedCrewId'=p_crew_id and authorization_private.support_assignment_valid(a.id))
   or exists(select 1 from authorization_private.support_links l where l.store in ('lubrication_records','anomalies') and l.entity_id=p_record_id
     and l.crew_id=p_crew_id and (ctx.c->'context'->>'scopeType'='GLOBAL' or authorization_private.support_history_allowed(l.store,l.entity_id)))) from ctx;
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.capture_grease_validation(p_operation_id text,p_id text,p_record_id text,p_crew_id text,p_expected timestamptz,p_signer_name text,p_signer_role text,p_note text,p_signature_url text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'CAPTURE',p_id,null,p_crew_id,p_expected,null,null,null,null,null,p_note,p_record_id,p_signer_name,p_signer_role,p_signature_url,null); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.catalog_writer_role() returns text language sql stable security definer set search_path=pg_catalog as $$
 select role from public.app_profiles where auth_user_id=auth.uid() and active=true;
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.close_anomaly(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_note text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'CLOSE',p_id,null,p_crew_id,p_expected,null,null,null,null,null,p_note,null,null,null,null,null); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0001_auth_profiles_rls_DRAFT.sql (SQL_TOKENS_IDENTICAL)

create or replace function public.current_app_active()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (select active from app_profiles where auth_user_id = auth.uid() limit 1),
    false  -- sin perfil = inactivo por defecto, nunca "permitido por omisión"
  );
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0001_auth_profiles_rls_DRAFT.sql (SQL_TOKENS_IDENTICAL)

create or replace function public.current_app_role()
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select role from app_profiles
  where auth_user_id = auth.uid()
  limit 1;
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.edit_anomaly(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_component text,p_description text,p_criticality text,p_status text,p_photos jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'EDIT',p_id,null,p_crew_id,p_expected,p_component,p_description,p_criticality,p_status,p_photos,null,null,null,null,null,null); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create or replace function public.evidence_operation(
  p_operation_id text, p_action text, p_id text, p_equipment_id text,
  p_crew_id text, p_expected timestamptz, p_component text, p_description text,
  p_criticality text, p_status text, p_photos jsonb, p_note text,
  p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text,
  p_expected_signatures jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog as $evidence$
#variable_conflict use_variable
declare
  actor public.app_profiles%rowtype;
  equipment public.engrase_sync%rowtype;
  original public.engrase_sync%rowtype;
  record public.engrase_sync%rowtype;
  receipt public.evidence_operation_receipts%rowtype;
  request jsonb; result jsonb; row_payload jsonb; rows jsonb := '[]';
  signatures jsonb; ids jsonb; resolution jsonb; detail jsonb; details jsonb;
  point_id text; component text; description text; criticality text;
  row_id text; destination text; crew_id text := p_crew_id;
  support_id text;
  n integer; repetitions integer; at timestamptz; revision timestamptz;
begin
  if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into actor from public.app_profiles where auth_user_id=auth.uid() for share;
  if not found or actor.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','INVALID_ROLE'); end if;
  if nullif(p_operation_id,'') is null or p_action is null or p_action not in ('REPORT','EDIT','CLOSE','RETIRE','AUTOMATIC','CAPTURE','RESOLVE') then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;
  if p_action='AUTOMATIC' and p_operation_id is distinct from 'auto:'||p_record_id then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION'); end if;
  lock table public.engrase_sync in share row exclusive mode;
  at := clock_timestamp();
  request := jsonb_build_array(p_action,p_id,p_equipment_id,p_crew_id,p_expected,p_component,p_description,
    p_criticality,p_status,p_photos,p_note,p_record_id,p_signer_name,p_signer_role,p_signature_url,p_expected_signatures);
  select * into receipt from public.evidence_operation_receipts where auth_user_id=auth.uid() and operation_id=p_operation_id;
  if found and authorization_private.support_history_allowed(receipt.result->'rows'->0->>'store',receipt.result->'rows'->0->>'id') then
    if receipt.request<>request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    return receipt.result;
  end if;
  if p_action in ('AUTOMATIC','CAPTURE','RESOLVE') then
    select * into record from public.engrase_sync where store='lubrication_records' and id=p_record_id and not deleted
      and coalesce(payload->>'active','true')='true';
    if not found then return jsonb_build_object('status','DENIED','code','RECORD_NOT_FOUND'); end if;
    select * into equipment from public.engrase_sync where store='equipment' and id=record.payload->>'equipmentId' and not deleted;
  elsif p_action='REPORT' then
    select * into equipment from public.engrase_sync where store='equipment' and id=p_equipment_id and not deleted;
  else
    select * into original from public.engrase_sync where store='anomalies' and id=p_id;
    if not found then return jsonb_build_object('status','DENIED','code','ANOMALY_NOT_FOUND'); end if;
    select * into equipment from public.engrase_sync where store='equipment' and id=original.payload->>'equipmentId' and not deleted;
  end if;
  if equipment.id is null or coalesce(equipment.payload->>'active','true')<>'true' then
    return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND'); end if;
  if p_action in ('AUTOMATIC','CAPTURE','RESOLVE') then
    select l.assignment_id into support_id from authorization_private.support_links l where l.store='lubrication_records' and l.entity_id=record.id
      and (actor.role in ('ADMINISTRADOR','PLANIFICADOR') or authorization_private.support_history_allowed(l.store,l.entity_id));
  elsif p_action='REPORT' and p_record_id is not null then
    select a.id into support_id from public.engrase_sync a where a.store='lubrication_assignments' and a.id=p_record_id
      and a.payload->>'equipmentId'=equipment.id and a.payload->>'assignedCrewId'=crew_id
      and authorization_private.support_assignment_valid(a.id);
    if support_id is null then return jsonb_build_object('status','DENIED','code','ASSIGNMENT_MISMATCH'); end if;
  elsif p_action in ('EDIT','CLOSE','RETIRE') then
    select l.assignment_id into support_id from authorization_private.support_links l where l.store='anomalies' and l.entity_id=original.id
      and (actor.role in ('ADMINISTRADOR','PLANIFICADOR') or authorization_private.support_history_allowed(l.store,l.entity_id));
  end if;
  if actor.role in ('SUPERVISOR','LUBRICADOR') then
    if crew_id is null then
      select count(*),min(id) into n,crew_id from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
      if n<>1 then return jsonb_build_object('status','DENIED','code','CREW_SELECTION_REQUIRED'); end if;
    end if;
    perform 1 from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id
       and (nullif(payload->>'locationId','')=equipment.payload->>'locationId' or (support_id is not null and (
         exists(select 1 from authorization_private.support_links l where l.assignment_id=support_id and l.crew_id=crew_id and ((l.store='lubrication_records' and l.entity_id=record.id) or (l.store='anomalies' and l.entity_id=original.id)))
         or (p_action='REPORT' and exists(select 1 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=support_id and a.payload->>'assignedCrewId'=crew_id)))));
    if not found then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
  end if;
  if p_action='AUTOMATIC' then
    -- Delegation is only for this actor's accepted 0009 execution, not a general editor.
    if record.payload->>'capturedByAuthUserId' is distinct from auth.uid()::text then
      return jsonb_build_object('status','DENIED','code','EXECUTION_ACTOR_DENIED'); end if;
    -- This derived evidence is part of an accepted 0009 execution. Generic
    -- record INSERT is disabled in the target matrix; accepted execution,
    -- actor and version checks below are authoritative.
    null;
  elsif p_action in ('CAPTURE','RESOLVE') then
    if p_action='RESOLVE' and actor.role<>'ADMINISTRADOR' then
      return jsonb_build_object('status','DENIED','code','ADMIN_REQUIRED'); end if;
    if p_action='CAPTURE' and actor.role not in ('ADMINISTRADOR','SUPERVISOR','LUBRICADOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
  else
    if actor.role='PLANIFICADOR' or (p_action='RETIRE' and actor.role<>'ADMINISTRADOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
    if actor.role='LUBRICADOR' and p_action<>'REPORT'
      and original.payload->>'capturedByAuthUserId' is distinct from auth.uid()::text then
      return jsonb_build_object('status','DENIED','code','ANOMALY_OWNER_DENIED'); end if;
    -- Anomaly mutations are available only through this typed, scoped RPC.
    -- Planner remains denied above; retirement is Admin-only; Lubricador
    -- edits stay owner-bound below. The target matrix has no generic writes.
    if actor.role not in ('ADMINISTRADOR','SUPERVISOR','LUBRICADOR') then
      return jsonb_build_object('status','DENIED','code','ROLE_DENIED'); end if;
  end if;
  select * into receipt from public.evidence_operation_receipts where auth_user_id=auth.uid() and operation_id=p_operation_id;
  if found then
    if receipt.request<>request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    return receipt.result;
  end if;
  if p_action in ('EDIT','CLOSE','RETIRE') and (original.deleted or coalesce(original.payload->>'active','true')<>'true') then
    return jsonb_build_object('status','DENIED','code','ANOMALY_NOT_FOUND'); end if;
  if p_action in ('EDIT','CLOSE','RETIRE') and original.updated_at is distinct from p_expected then
    return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT'); end if;
  if p_action in ('CAPTURE','AUTOMATIC') and record.updated_at is distinct from p_expected then
    return jsonb_build_object('status','CONFLICT','code','RECORD_VERSION_CONFLICT'); end if;
  if p_action='AUTOMATIC' and not exists(
    select 1 from public.lubrication_execution_receipts r,
      jsonb_array_elements(r.result->'rows') accepted
    where r.auth_user_id=auth.uid() and r.request->>0='CREATE' and r.request->>1=record.id
      and accepted->>'store'='lubrication_records' and accepted->>'id'=record.id
      and accepted->'payload'=record.payload
  ) then return jsonb_build_object('status','DENIED','code','EXECUTION_NOT_ACCEPTED'); end if;

  if support_id is not null and p_action in ('REPORT','EDIT') and not authorization_private.support_photos_owned(p_photos,case when p_action='EDIT' then original.payload->'photos' else '[]'::jsonb end) then return jsonb_build_object('status','DENIED','code','PHOTO_OBJECT_DENIED'); end if;
  if p_action in ('REPORT','EDIT','CLOSE','RETIRE') then
    if p_action in ('REPORT','EDIT') and (nullif(p_id,'') is null or nullif(btrim(p_component),'') is null or nullif(btrim(p_description),'') is null
      or p_criticality is null or p_criticality not in ('Baja','Media','Alta','Crítica') or jsonb_typeof(p_photos) is distinct from 'array') then
      return jsonb_build_object('status','DENIED','code','INVALID_ANOMALY'); end if;
    if p_action in ('REPORT','EDIT') and (
      exists(select 1 from jsonb_array_elements(p_photos) x where jsonb_typeof(x)<>'string' or x#>>'{}' !~ '^https://')) then
      return jsonb_build_object('status','DENIED','code','INVALID_ANOMALY'); end if;
    -- Existing editor exposes every transition among these three real states (including reopen).
    if p_action='EDIT' and (p_status is null or p_status not in ('Abierta','En atención','Cerrada') or
      original.payload->>'status' not in ('Abierta','En atención','Cerrada')) then
      return jsonb_build_object('status','DENIED','code','INVALID_TRANSITION'); end if;
    if p_action='CLOSE' and original.payload->>'status' not in ('Abierta','En atención') then
      return jsonb_build_object('status','DENIED','code','INVALID_TRANSITION'); end if;
    destination:='anomalies'; row_id:=p_id;
    row_payload:=case when p_action='REPORT' then jsonb_build_object('id',p_id,'active',true,'createdAt',at,
      'createdBy',actor.display_name,'capturedByAuthUserId',auth.uid(),'capturedByUserId',actor.app_user_id,
      'equipmentId',equipment.id,'locationId',equipment.payload->>'locationId','crewId',crew_id,'supportAssignmentId',support_id,'status','Abierta') else original.payload end;
    if p_action in ('REPORT','EDIT') then row_payload:=row_payload||jsonb_build_object('component',p_component,'description',p_description,
      'criticality',p_criticality,'photos',p_photos,'photo',p_photos->0); end if;
    if p_action='EDIT' then row_payload:=row_payload||jsonb_build_object('status',p_status); end if;
    if p_action='CLOSE' then row_payload:=row_payload||jsonb_build_object('status','Cerrada','resolutionNote',p_note); end if;
    if p_action='RETIRE' then row_payload:=row_payload||jsonb_build_object('active',false); end if;
    revision:=greatest(at,coalesce(original.updated_at,at)+interval '1 microsecond');
    row_payload:=row_payload||jsonb_build_object('updatedAt',revision,'updatedByAuthUserId',auth.uid());
    if p_action='REPORT' and exists(select 1 from public.engrase_sync where store=destination and id=row_id) then
      return jsonb_build_object('status','CONFLICT','code','ID_CONFLICT'); end if;
    insert into public.engrase_sync(store,id,payload,updated_at,deleted) values(destination,row_id,row_payload,revision,p_action='RETIRE')
      on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at,deleted=excluded.deleted;
    rows:=jsonb_build_array(jsonb_build_object('store',destination,'id',row_id,'payload',row_payload,'updated_at',revision));
  elsif p_action='AUTOMATIC' then
    details:=coalesce(record.payload->'details','[]');
    if record.payload->>'sinHorometro'='true' then details:=details||jsonb_build_array(jsonb_build_object(
      'pointId','__horometro__','pointName','Horómetro','done',false,'reason',coalesce(record.payload->>'noHourmeterReason','Horómetro no legible'))); end if;
    for detail in select value from jsonb_array_elements(details) loop
      if detail->>'done' is distinct from 'false' then continue; end if;
      point_id:=detail->>'pointId';
      select count(*) into n from public.engrase_sync where store='anomalies' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=equipment.id
        and payload->>'autoPointId'=point_id and payload->>'status'<>'Cerrada'
        and (case when support_id is not null then payload->>'supportAssignmentId'=support_id else payload->>'supportAssignmentId' is null and payload->>'crewId'=crew_id end);
      if n>1 then raise exception using errcode='P2B01',message='AUTOMATIC_ANOMALY_AMBIGUOUS'; end if;
      select * into original from public.engrase_sync where store='anomalies' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=equipment.id
        and payload->>'autoPointId'=point_id and payload->>'status'<>'Cerrada'
        and (case when support_id is not null then payload->>'supportAssignmentId'=support_id else payload->>'supportAssignmentId' is null and payload->>'crewId'=crew_id end);
      if original.id is null and point_id='__horometro__' and detail->>'reason'='El equipo no tiene horómetro' then continue; end if;
      row_id:=coalesce(original.id,'auto:'||p_record_id||':'||point_id);
      if original.id is null and exists(select 1 from public.engrase_sync where store='anomalies' and id=row_id) then
        raise exception using errcode='P2B02',message='AUTOMATIC_ID_CONFLICT'; end if;
      repetitions:=case when original.id is null then 1 else coalesce(nullif((original.payload->>'repeticiones')::integer,0),1)+1 end;
      component:=case when point_id='__horometro__' then 'Horómetro' else coalesce(nullif(detail->>'reason',''),'Sin motivo indicado') end;
      criticality:=case component when 'Falla mecánica' then 'Crítica' when 'Grasera dañada' then 'Alta'
        when 'Línea de engrase obstruida' then 'Alta' when 'Sello dañado' then 'Alta'
        when 'Equipo trabajando' then 'Baja' when 'Equipo detenido' then 'Baja' else 'Media' end;
      description:=coalesce(detail->>'pointName',point_id)||': '||coalesce(detail->>'reason','Otro')||'. Reportado '||repetitions||' veces.';
      row_payload:=coalesce(original.payload,jsonb_build_object('id',row_id,'equipmentId',equipment.id,'locationId',equipment.payload->>'locationId',
        'supportAssignmentId',support_id,'crewId',crew_id,'createdAt',at,'createdBy',actor.display_name,'capturedByAuthUserId',auth.uid(),
        'capturedByUserId',actor.app_user_id,'active',true,'status','Abierta','autoGenerada',true,'autoPointId',point_id,
        'component',component,'criticality',criticality,'photos',case when point_id='__horometro__' then '[]'::jsonb else coalesce(record.payload->'photos','[]') end));
      revision:=greatest(at,coalesce(original.updated_at,at)+interval '1 microsecond');
      row_payload:=row_payload||jsonb_build_object('description',description,'repeticiones',repetitions,'updatedAt',revision,'lastExecutionId',p_record_id);
      insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('anomalies',row_id,row_payload,revision,false)
        on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
      if support_id is not null then perform authorization_private.link_support_entity('anomalies',row_id,support_id,crew_id); end if;
      rows:=rows||jsonb_build_array(jsonb_build_object('store','anomalies','id',row_id,'payload',row_payload,'updated_at',revision));
    end loop;
  elsif p_action='CAPTURE' then
    if nullif(p_signature_url,'') is null or nullif(p_id,'') is null or nullif(btrim(p_signer_name),'') is null or p_signer_role is null or p_signer_role not in ('OPERADOR','ENCARGADO')
      or (p_signer_role='ENCARGADO' and nullif(btrim(p_note),'') is null)
      or p_signature_url !~ ('^https://[^?#]+/grease_validations/'||p_id||'\.png$')
      or p_id !~ '^[A-Za-z0-9_-]+$' then return jsonb_build_object('status','DENIED','code','INVALID_SIGNATURE'); end if;
    if actor.role='SUPERVISOR' and (p_signer_role<>'ENCARGADO' or btrim(p_signer_name)<>actor.display_name) then
      return jsonb_build_object('status','DENIED','code','INVALID_SIGNER_ROLE'); end if;
    -- Storage owns the object; a caller cannot substitute a different host/object
    -- as evidence. The canonical reference is derived, never accepted as authority.
    perform 1 from storage.objects o where o.bucket_id='engrase-photos' and o.name='grease_validations/'||p_id||'.png'
      and coalesce(to_jsonb(o)->>'owner_id',to_jsonb(o)->>'owner')=auth.uid()::text;
    if not found then return jsonb_build_object('status','DENIED','code','SIGNATURE_OBJECT_DENIED'); end if;
    if exists(select 1 from public.engrase_sync where store='grease_validations' and
      (id=p_id or payload->>'signatureUrl'=p_signature_url)) then return jsonb_build_object('status','CONFLICT','code','SIGNATURE_EXISTS'); end if;
    row_payload:=jsonb_build_object('id',p_id,'active',true,'lubricationRecordId',record.id,'equipmentId',equipment.id,
      'signerName',btrim(p_signer_name),'signerRole',p_signer_role,'reason',p_note,'signatureUrl','grease_validations/'||p_id||'.png',
      'signedAt',at,'createdAt',at,'updatedAt',at,'createdBy',actor.display_name,'signerUserId',actor.app_user_id,
      'capturedByAuthUserId',auth.uid(),'recordVersion',record.updated_at,'recordSnapshot',record.payload);
    insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('grease_validations',p_id,row_payload,at,false);
    rows:=jsonb_build_array(jsonb_build_object('store','grease_validations','id',p_id,'payload',row_payload,'updated_at',at));
  else
    select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at) order by id),jsonb_agg(to_jsonb(id) order by id),count(*)
      into signatures,ids,n from public.engrase_sync where store='grease_validations' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'lubricationRecordId'=record.id;
    if n<2 or not ids ? p_id or nullif(btrim(p_note),'') is null then
      return jsonb_build_object('status','DENIED','code','INVALID_RESOLUTION'); end if;
    if signatures is distinct from p_expected_signatures then
      select jsonb_agg(jsonb_build_object('store',store,'id',id,'payload',payload,'updated_at',updated_at)) into rows
        from public.engrase_sync where store='grease_validations' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'lubricationRecordId'=record.id;
      return jsonb_build_object('status','CONFLICT','code','SIGNATURES_VERSION_CONFLICT','rows',rows);
    end if;
    select * into original from public.engrase_sync where store='grease_validations' and id=ids->>0;
    resolution:=jsonb_build_object('id',p_operation_id,'officialValidationId',p_id,'signatureIds',ids,'resolvedById',actor.app_user_id,
      'resolvedByAuthUserId',auth.uid(),'resolvedByName',actor.display_name,'resolvedAt',at,'reason',btrim(p_note),
      'selectedRecordVersion',(select payload->'recordVersion' from public.engrase_sync where store='grease_validations' and id=p_id),
      'history',coalesce(original.payload->'conflictResolution'->'history','[]')||case when original.payload ? 'conflictResolution'
        then jsonb_build_array((original.payload->'conflictResolution')-'history') else '[]'::jsonb end);
    revision:=greatest(at,original.updated_at+interval '1 microsecond');
    row_payload:=original.payload||jsonb_build_object('conflictResolution',resolution,'updatedAt',revision);
    update public.engrase_sync set payload=row_payload,updated_at=revision where store='grease_validations' and id=original.id;
    rows:=jsonb_build_array(jsonb_build_object('store','grease_validations','id',original.id,'payload',row_payload,'updated_at',revision));
  end if;
  if support_id is not null and p_action in ('REPORT','CAPTURE') then
    perform authorization_private.link_support_entity(case when p_action='REPORT' then 'anomalies' else 'grease_validations' end,p_id,support_id,crew_id);
  end if;
  insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('audit_log','evidence:'||auth.uid()||':'||p_operation_id,
    jsonb_build_object('id','evidence:'||auth.uid()||':'||p_operation_id,'active',true,'action','EVIDENCE_'||p_action,
      'entityId',coalesce(p_record_id,p_id),'user',actor.display_name,'actorAuthUserId',auth.uid(),'createdAt',at,'updatedAt',at),at,false);
  result:=jsonb_build_object('status','APPLIED','rows',rows);
  insert into public.evidence_operation_receipts values(auth.uid(),p_operation_id,request,result);
  return result;
exception when sqlstate 'P2B01' then
  -- Entire function subtransaction rolls back, including earlier points in this loop.
  return jsonb_build_object('status','CONFLICT','code','AUTOMATIC_ANOMALY_AMBIGUOUS');
when sqlstate 'P2B02' then
  return jsonb_build_object('status','CONFLICT','code','AUTOMATIC_ID_CONFLICT');
end $evidence$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.get_assignment_support_context()
returns jsonb language sql stable security definer set search_path=pg_catalog as $$
 with ctx as (select public.get_authorization_context() as c),
 ops as (select coalesce(jsonb_agg(jsonb_build_object('assignmentId',a.id,'assignedCrewId',a.payload->>'assignedCrewId',
   'equipmentId',a.payload->>'equipmentId','planId',a.payload->>'planId','occurrenceKey',a.payload->>'occurrenceKey','version',a.updated_at) order by a.id),'[]'::jsonb) as v
   from public.engrase_sync a,ctx where a.store='lubrication_assignments' and ctx.c->>'status'='AUTHORIZED'
   and ctx.c->'context'->'authorizedCrewIds' ? (a.payload->>'assignedCrewId') and authorization_private.support_assignment_valid(a.id)
   and authorization_private.authorization_store_action_allowed('lubrication_assignments','SELECT',false)),
 refs as (select coalesce(jsonb_agg(jsonb_build_object('store',g.store,'id',g.id) order by g.store,g.id),'[]'::jsonb) as v
   from authorization_private.support_grant_rows() g join public.engrase_sync s on s.store=g.store and s.id=g.id
   where authorization_private.authorization_store_action_allowed(s.store,'SELECT',s.deleted))
 select case when ctx.c->>'status'='AUTHORIZED' then jsonb_build_object('status','AUTHORIZED',
   'authUserId',auth.uid(),'appUserId',ctx.c->'context'->>'appUserId','operational',ops.v,'rows',refs.v,
   'revision',md5(ops.v::text||refs.v::text)) else jsonb_build_object('status','DENIED') end from ctx,ops,refs;
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0013_authorization_row_scope_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create or replace function public.get_authorization_context()
returns jsonb language sql stable security definer set search_path=pg_catalog as $bootstrap$
  select case when c->>'status'='AUTHORIZED'
    then jsonb_set(c,'{context,rowScopeEnforced}','true'::jsonb,false)
    else c end
  from (select public.resolve_authorization_scope(auth.uid()) as c) s;
$bootstrap$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create or replace function public.lubrication_execution(
  p_operation_id text, p_action text, p_record_id text,
  p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text,
  p_execution_date timestamptz, p_client_captured_at timestamptz, p_shift_id text, p_execution_type text,
  p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean,
  p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text,
  p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text,
  p_details jsonb, p_photos jsonb,
  p_expected_record timestamptz, p_expected_equipment timestamptz,
  p_expected_plan timestamptz, p_expected_assignment timestamptz
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog
as $gateway$
#variable_conflict use_variable
declare
  actor public.app_profiles%rowtype;
  equipment public.engrase_sync%rowtype;
  plan public.engrase_sync%rowtype;
  original public.engrase_sync%rowtype;
  assignment public.engrase_sync%rowtype;
  crew public.engrase_sync%rowtype;
  receipt public.lubrication_execution_receipts%rowtype;
  request jsonb;
  result jsonb;
  row_payload jsonb;
  snapshot jsonb;
  canonical jsonb;
  normalized_details jsonb := '[]'::jsonb;
  detail jsonb;
  point public.engrase_sync%rowtype;
  point_name text;
  role_global boolean;
  complete boolean := true;
  is_latest boolean;
  n integer;
  occurrence text;
  satisfied text;
  candidate date;
  candidates date[] := '{}';
  weekdays text[] := array['Domingo','Lunes','Martes','Miércoles','Jueves','Viernes','Sábado'];
  execution_day date;
  crew_id text := p_crew_id;
  performer_name text;
  stamp_at timestamptz := clock_timestamp();
  version_at timestamptz;
  day_start numeric := 6;
  night_start numeric := 18;
  dual_shift_active boolean := false;
  operational_day date;
  support_id text;
  assigned_occurrence text;
  current_occurrence text;
begin
  if auth.uid() is null then return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED'); end if;
  select * into actor from public.app_profiles where auth_user_id = auth.uid() for share;
  if not found or not actor.active then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if actor.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','INVALID_ROLE');
  end if;
  if p_action is null or p_action not in ('CREATE','EDIT') or nullif(p_operation_id,'') is null or nullif(p_record_id,'') is null then
    return jsonb_build_object('status','DENIED','code','INVALID_OPERATION');
  end if;
  -- The typed execution gateway is the authorization boundary. Generic
  -- app_store_permissions mutation flags are intentionally false in the
  -- final matrix for this RPC-only store; role, ownership and scope checks
  -- below govern execution and edit operations.

  -- Conservative serialization includes concurrent legacy REST signatures and catalog writes.
  -- No row lock protocol can protect signed edits while signatures still use generic REST.
  -- Keep transaction short; replace with per-equipment protocol only after all writers participate.
  lock table public.engrase_sync in share row exclusive mode;
  stamp_at := clock_timestamp();
  request := jsonb_build_array(p_action,p_record_id,p_equipment_id,p_plan_id,p_crew_id,p_assignment_id,
    p_execution_date,p_client_captured_at,p_shift_id,p_execution_type,p_out_of_plan_reason,p_performed_by,p_retroactive,
    p_hourmeter,p_no_hourmeter,p_no_hourmeter_reason,p_lubricant_id,p_quantity,p_condition,p_notes,
    p_details,p_photos,p_expected_record,p_expected_equipment,p_expected_plan,p_expected_assignment);
  select * into receipt from public.lubrication_execution_receipts
    where auth_user_id = actor.auth_user_id and operation_id = p_operation_id;
  if found then
    if receipt.request <> request then return jsonb_build_object('status','CONFLICT','code','IDEMPOTENCY_CONFLICT'); end if;
    if actor.role in ('SUPERVISOR','LUBRICADOR') and not exists(select 1 from public.engrase_sync c
      where c.store='cuadrillas' and c.id=coalesce(p_crew_id,(select row->'payload'->'operationalSnapshot'->>'crewId' from jsonb_array_elements(receipt.result->'rows') row where row->>'store'='lubrication_records' limit 1)) and not c.deleted and coalesce(c.payload->>'active','true')='true'
      and c.payload->'memberUserIds' ? actor.app_user_id) then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
    return receipt.result;
  end if;
  select * into equipment from public.engrase_sync where store='equipment' and id=p_equipment_id and not deleted;
  if not found or coalesce(equipment.payload->>'active','true') <> 'true' then
    return jsonb_build_object('status','DENIED','code','EQUIPMENT_NOT_FOUND');
  end if;
  role_global := actor.role in ('ADMINISTRADOR','PLANIFICADOR');
  if p_action='CREATE' and p_execution_type='ASSIGNED' then
    select * into assignment from public.engrase_sync where store='lubrication_assignments' and id=p_assignment_id and not deleted;
    if not found or not authorization_private.support_assignment_valid(assignment.id)
      or assignment.payload->>'equipmentId' is distinct from p_equipment_id
      or assignment.payload->>'planId' is distinct from p_plan_id
      or assignment.payload->>'assignedCrewId' is distinct from crew_id then
      return jsonb_build_object('status','DENIED','code','ASSIGNMENT_MISMATCH'); end if;
    support_id:=assignment.id; assigned_occurrence:=assignment.payload->>'occurrenceKey';
  elsif p_action='EDIT' then
    select l.assignment_id into support_id from authorization_private.support_links l
      where l.store='lubrication_records' and l.entity_id=p_record_id
      and (role_global or authorization_private.support_history_allowed(l.store,l.entity_id));
  end if;
  if not role_global then
    if crew_id is null then
      select count(*), min(id) into n,crew_id from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
      if n <> 1 then return jsonb_build_object('status','DENIED','code','CREW_SELECTION_REQUIRED'); end if;
    end if;
    select * into crew from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->'memberUserIds' ? actor.app_user_id;
    if not found or nullif(crew.payload->>'locationId','') is null
      or (crew.payload->>'locationId' is distinct from equipment.payload->>'locationId' and support_id is null) then
      return jsonb_build_object('status','DENIED','code','SCOPE_DENIED');
    end if;
  elsif crew_id is not null then
    select * into crew from public.engrase_sync where store='cuadrillas' and id=crew_id and not deleted
      and coalesce(payload->>'active','true')='true';
    if not found then return jsonb_build_object('status','DENIED','code','CREW_NOT_FOUND'); end if;
  end if;
  if not exists (select 1 from public.engrase_sync where store='locations' and id=equipment.payload->>'locationId' and not deleted
    and coalesce(payload->>'active','true')='true') then return jsonb_build_object('status','DENIED','code','LOCATION_NOT_FOUND'); end if;
  if support_id is not null and not role_global and not exists (
    select 1 from authorization_private.support_links l where l.store='lubrication_records' and l.entity_id=p_record_id and l.crew_id=crew_id
    union all select 1 from public.engrase_sync a where a.store='lubrication_assignments' and a.id=support_id and p_action='CREATE' and a.payload->>'assignedCrewId'=crew_id
  ) then return jsonb_build_object('status','DENIED','code','SCOPE_DENIED'); end if;
  select * into original from public.engrase_sync where store='lubrication_records' and id=p_record_id;
  if p_action='CREATE' and found then return jsonb_build_object('status','CONFLICT','code','RECORD_EXISTS'); end if;
  if p_action='EDIT' then
    if original.id is null or original.deleted then return jsonb_build_object('status','DENIED','code','RECORD_NOT_FOUND'); end if;
    if original.payload->>'equipmentId' is distinct from p_equipment_id
      or (original.payload->>'date')::timestamptz is distinct from p_execution_date
      or coalesce((original.payload->>'createdAt')::timestamptz,(original.payload->>'date')::timestamptz) is distinct from p_client_captured_at
      or original.payload->>'userId' is distinct from p_performed_by
      or original.payload->>'shiftId' is distinct from p_shift_id
      or (original.payload->>'planId' is not null and original.payload->>'planId' is distinct from p_plan_id)
      or original.payload->'operationalSnapshot'->>'outOfPlanReason' is distinct from p_out_of_plan_reason
      or coalesce(original.payload->'operationalSnapshot'->>'executionType','PLANNED') is distinct from p_execution_type
      or original.payload->'operationalSnapshot'->>'assignmentId' is distinct from p_assignment_id
      or coalesce((original.payload->>'retroactivo')::boolean,false) is distinct from p_retroactive
      or coalesce((original.payload->>'sinHorometro')::boolean,false) is distinct from p_no_hourmeter
      or original.payload->>'noHourmeterReason' is distinct from p_no_hourmeter_reason then
      return jsonb_build_object('status','DENIED','code','IMMUTABLE_RECORD_FIELDS');
    end if;
    if actor.role='LUBRICADOR' and original.payload->>'userId' is distinct from actor.app_user_id then
      return jsonb_build_object('status','DENIED','code','EDIT_WINDOW_OR_OWNER');
    end if;
    if exists (select 1 from public.engrase_sync where store='grease_validations' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'lubricationRecordId'=p_record_id) then
      select jsonb_agg(jsonb_build_object('store',store,'id',id,'payload',payload,'updated_at',updated_at)) into canonical
        from public.engrase_sync where (store='lubrication_records' and id=p_record_id) or (store='equipment' and id=p_equipment_id)
          or (store='lubrication_plans' and id=p_plan_id and payload->>'equipmentId'=p_equipment_id);
      return jsonb_build_object('status','DENIED','code','SIGNED_RECORD_LOCKED','rows',canonical);
    end if;
    -- Existing field editor: own same operating day. Admin has no signed-record exception.
    if actor.role='LUBRICADOR' and (original.payload->>'userId' <> actor.app_user_id
      or (original.payload->>'date')::timestamptz at time zone 'America/Managua' < date_trunc('day',stamp_at at time zone 'America/Managua')
      or (original.payload->>'date')::timestamptz at time zone 'America/Managua' >= date_trunc('day',stamp_at at time zone 'America/Managua') + interval '1 day') then
      return jsonb_build_object('status','DENIED','code','EDIT_WINDOW_OR_OWNER');
    end if;
  end if;
  if p_plan_id is not null then
    select * into plan from public.engrase_sync where store='lubrication_plans' and id=p_plan_id and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id;
    if not found then return jsonb_build_object('status','DENIED','code','PLAN_MISMATCH'); end if;
  elsif exists(select 1 from public.engrase_sync where store='lubrication_plans' and not deleted
    and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id) then
    return jsonb_build_object('status','DENIED','code','PLAN_REQUIRED');
  end if;
  if (equipment.updated_at is distinct from p_expected_equipment)
    or (plan.id is not null and plan.updated_at is distinct from p_expected_plan)
    or (p_action='EDIT' and original.updated_at is distinct from p_expected_record)
    or (p_action='CREATE' and p_expected_record is not null) then
    return jsonb_build_object('status','CONFLICT','code','VERSION_CONFLICT');
  end if;
  if p_execution_date is null or p_execution_date > stamp_at + interval '5 minutes'
    or p_client_captured_at is null or p_client_captured_at > stamp_at + interval '5 minutes'
    or p_retroactive is null or p_no_hourmeter is null or p_execution_type is null
    or p_execution_type not in ('PLANNED','ASSIGNED','OUT_OF_PLAN')
    or p_shift_id is null or p_shift_id not in ('shift_dia','shift_noche')
    or p_hourmeter is null or p_hourmeter < 0 or p_hourmeter::text in ('NaN','Infinity','-Infinity')
    or p_quantity is null or p_quantity < 0 or p_quantity::text in ('NaN','Infinity','-Infinity')
    or p_condition is null or p_condition not in ('Normal','Con desgaste','Requiere atención')
    or p_details is null or jsonb_typeof(p_details)<>'array'
    or p_photos is null or jsonb_typeof(p_photos)<>'array'
    or jsonb_array_length(p_photos)>5 then return jsonb_build_object('status','DENIED','code','INVALID_INPUT'); end if;
  if p_action='CREATE' and not role_global and (p_retroactive or p_performed_by is distinct from actor.app_user_id) then
    return jsonb_build_object('status','DENIED','code','PERFORMER_DENIED');
  end if;
  if p_action='CREATE' and not p_retroactive and p_performed_by is distinct from actor.app_user_id then
    return jsonb_build_object('status','DENIED','code','PERFORMER_DENIED');
  end if;
  if p_action='CREATE' and p_no_hourmeter and (p_no_hourmeter_reason is null
    or p_no_hourmeter_reason not in ('El equipo no tiene horómetro','Horómetro dañado','Pantalla ilegible / rota','Equipo apagado, no se pudo leer','Otro')
    or p_hourmeter is distinct from coalesce((equipment.payload->>'hourmeter')::numeric,0)) then
    return jsonb_build_object('status','DENIED','code','NO_HOURMETER_INPUT');
  end if;
  performer_name := actor.display_name;
  if p_performed_by is distinct from actor.app_user_id then
    select payload->>'name' into performer_name from public.engrase_sync where store='users' and id=p_performed_by and not deleted;
    if performer_name is null then return jsonb_build_object('status','DENIED','code','PERFORMER_NOT_FOUND'); end if;
  end if;
  if p_lubricant_id is not null and not exists(select 1 from public.engrase_sync where store='lubricants' and id=p_lubricant_id
    and not deleted and coalesce(payload->>'active','true')='true') then return jsonb_build_object('status','DENIED','code','LUBRICANT_NOT_FOUND'); end if;
  for detail in select value from jsonb_array_elements(p_photos) loop
    if jsonb_typeof(detail)<>'string' or (detail#>>'{}') !~ '^https://' or length(detail#>>'{}')>2048 then
      return jsonb_build_object('status','DENIED','code','INVALID_PHOTO_REFERENCE');
    end if;
  end loop;
  if p_action='CREATE' then
    select count(*) into n from public.engrase_sync where store='lubrication_points' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'planId'=p_plan_id;
  else n := jsonb_array_length(coalesce(original.payload->'details','[]'::jsonb)); end if;
  if n <> jsonb_array_length(p_details) or (select count(distinct value->>'pointId') from jsonb_array_elements(p_details)) <> n then
    return jsonb_build_object('status','DENIED','code','CHECKLIST_MISMATCH');
  end if;
  for detail in select value from jsonb_array_elements(p_details) loop
    if jsonb_typeof(detail)<>'object' or jsonb_typeof(detail->'done') is distinct from 'boolean'
      or jsonb_typeof(detail->'pointId') is distinct from 'string'
      or (detail->'reason' is not null and jsonb_typeof(detail->'reason') not in ('string','null'))
      or exists(select 1 from jsonb_object_keys(detail) as k where k not in ('pointId','pointName','done','reason')) then
      return jsonb_build_object('status','DENIED','code','INVALID_CHECKLIST');
    end if;
    if p_action='CREATE' then
      select * into point from public.engrase_sync where store='lubrication_points' and id=detail->>'pointId'
        and not deleted and coalesce(payload->>'active','true')='true' and payload->>'planId'=p_plan_id;
      point_name := point.payload->>'point';
    else select value->>'pointName' into point_name from jsonb_array_elements(original.payload->'details') where value->>'pointId'=detail->>'pointId'; end if;
    if point_name is null or (not (detail->>'done')::boolean and nullif(btrim(detail->>'reason'),'') is null) then
      return jsonb_build_object('status','DENIED','code','INVALID_POINT');
    end if;
    complete := complete and (detail->>'done')::boolean;
    normalized_details := normalized_details || jsonb_build_array(jsonb_build_object('pointId',detail->>'pointId',
      'pointName',point_name,'done',detail->'done','reason',detail->'reason'));
  end loop;
  if p_action='EDIT' and support_id is not null and complete is distinct from (original.payload->'operationalSnapshot'->>'executionCompleteness'='COMPLETE') then return jsonb_build_object('status','DENIED','code','ASSIGNED_COMPLETENESS_IMMUTABLE'); end if;
  if complete and p_quantity<=0 then return jsonb_build_object('status','DENIED','code','COMPLETE_REQUIRES_GREASE'); end if;
  if p_action='CREATE' and p_execution_type='OUT_OF_PLAN' and (p_out_of_plan_reason is null
    or p_out_of_plan_reason not in ('PM','CORRECTIVO','OPORTUNIDAD','SUPPORT_OTHER_LOCATION','OTRO')
    or (p_out_of_plan_reason='OTRO' and nullif(btrim(p_notes),'') is null)) then
    return jsonb_build_object('status','DENIED','code','OUT_OF_PLAN_REASON_REQUIRED');
  end if;
  execution_day := (p_execution_date at time zone 'America/Managua')::date;
  select coalesce((payload->>'shiftDayStart')::numeric,6),coalesce((payload->>'shiftNightStart')::numeric,18)
    into day_start,night_start from public.engrase_sync where store='settings' and id='general' and not deleted;
  day_start := coalesce(day_start,6); night_start := coalesce(night_start,18);
  operational_day := execution_day;
  if plan.id is not null and plan.payload->'requiredShifts' @> '["shift_dia","shift_noche"]'::jsonb
     and nullif(plan.payload->>'effectiveDate','') is not null
     and p_shift_id='shift_noche'
     and extract(hour from p_execution_date at time zone 'America/Managua') < day_start
     and execution_day - 1 >= (plan.payload->>'effectiveDate')::date then
    operational_day := execution_day - 1;
  end if;
  dual_shift_active := plan.id is not null
    and plan.payload->'requiredShifts' @> '["shift_dia","shift_noche"]'::jsonb
    and nullif(plan.payload->>'effectiveDate','') is not null
    and operational_day >= (plan.payload->>'effectiveDate')::date;
  if dual_shift_active then execution_day := operational_day; end if;
  if p_action='CREATE' and not p_retroactive and p_shift_id <> (case when extract(hour from p_execution_date at time zone 'America/Managua') >= day_start
    and extract(hour from p_execution_date at time zone 'America/Managua') < night_start then 'shift_dia' else 'shift_noche' end) then
    return jsonb_build_object('status','DENIED','code','SHIFT_MISMATCH');
  end if;
  if p_action='CREATE' then
    if plan.id is not null then
      occurrence := case when dual_shift_active then plan.id||':'||execution_day::text||':'||p_shift_id
        when plan.payload->>'controlType'='Día y turno de la semana' then plan.id||':'||execution_day::text
        else plan.id||':h:'||(case when jsonb_typeof(plan.payload->'lastGreaseHour')='number'
          then trim_scale((plan.payload->>'lastGreaseHour')::numeric)::text else coalesce(plan.payload->>'lastGreaseHour','0') end) end;
    end if;
    current_occurrence:=occurrence;
    if assigned_occurrence is not null then occurrence:=assigned_occurrence; end if;
    select count(*) into n from public.engrase_sync where store='lubrication_assignments' and not deleted
      and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=occurrence and payload->>'status'='PENDING';
    if n>1 then return jsonb_build_object('status','DENIED','code','AMBIGUOUS_ASSIGNMENT'); end if;
    if n=1 then
      select * into assignment from public.engrase_sync where store='lubrication_assignments' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'occurrenceKey'=occurrence and payload->>'status'='PENDING';
      if p_assignment_id is distinct from assignment.id or p_execution_type<>'ASSIGNED'
        or assignment.payload->>'equipmentId' is distinct from p_equipment_id
        or (assignment.payload->>'planId' is not null and assignment.payload->>'planId' is distinct from p_plan_id)
        or assignment.payload->>'assignedCrewId' is distinct from crew_id then
        return jsonb_build_object('status','DENIED','code','ASSIGNMENT_MISMATCH');
      end if;
      if assignment.updated_at is distinct from p_expected_assignment then return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_VERSION_CONFLICT'); end if;
      -- Completion is an atomic side effect of this typed execution RPC.
      -- It does not require generic UPDATE on lubrication_assignments.
    elsif p_assignment_id is not null or p_execution_type='ASSIGNED' then return jsonb_build_object('status','CONFLICT','code','ASSIGNMENT_NOT_PENDING'); end if;
    if not role_global and p_execution_type='PLANNED' then
      select count(*) into n from public.engrase_sync where store='cuadrillas' and not deleted
        and coalesce(payload->>'active','true')='true' and payload->>'locationId'=equipment.payload->>'locationId'
        and (payload->>'isDefault')::boolean;
      if n<>1 or coalesce((crew.payload->>'isDefault')::boolean,false) is not true then
        return jsonb_build_object('status','DENIED','code','DEFAULT_CREW_REQUIRED');
      end if;
      -- Execution shift was checked against capture time. The existing QR/early
      -- execution flow permits recording before the equipment's scheduled shift.
    end if;
    if complete and plan.id is not null then
      if dual_shift_active then
        for i in 0..1 loop
          candidate := execution_day+i;
          if not exists(select 1 from public.engrase_sync where store='lubrication_records' and not deleted
            and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id
            and (payload->'operationalSnapshot'->>'assignedOccurrenceKey' is null or payload->'operationalSnapshot'->>'assignedOccurrenceKey'=plan.id||':'||candidate::text||':'||p_shift_id)
            and payload->>'shiftId'=p_shift_id
            and (payload->'operationalSnapshot'->>'operationalDate'=candidate::text
              or ((payload->>'date')::timestamptz at time zone 'America/Managua')::date=candidate)) then
            candidates := array_append(candidates,candidate);
          end if;
        end loop;
        if cardinality(candidates)=1 then satisfied := plan.id||':'||candidates[1]::text||':'||p_shift_id; end if;
      elsif plan.payload->>'controlType'='Día y turno de la semana' then
        for i in 0..1 loop
          candidate := execution_day+i;
          if plan.payload->'assignedDays' ? weekdays[extract(dow from candidate)::integer+1]
            and not exists(select 1 from public.engrase_sync where store='lubrication_records' and not deleted
              and coalesce(payload->>'active','true')='true' and (payload->'operationalSnapshot'->>'assignedOccurrenceKey' is null or payload->'operationalSnapshot'->>'assignedOccurrenceKey'=plan.id||':'||candidate::text) and payload->>'equipmentId'=p_equipment_id and (payload->>'date')::timestamptz at time zone 'America/Managua' >= candidate
              and (payload->>'date')::timestamptz at time zone 'America/Managua' < candidate+interval '1 day') then candidates := array_append(candidates,candidate); end if;
        end loop;
        if cardinality(candidates)=1 then satisfied := plan.id||':'||candidates[1]::text; end if;
      else satisfied := occurrence; end if;
    end if;
    if assigned_occurrence is not null then satisfied:=case when complete then assigned_occurrence else null end; end if;
    snapshot := jsonb_build_object('equipmentLocationIdAtExecution',equipment.payload->>'locationId','executionLocationId',equipment.payload->>'locationId',
      'crewId',crew_id,'crewLocationIdAtExecution',crew.payload->>'locationId','performedByUserId',p_performed_by,
      'shiftId',p_shift_id,'operationalDate',execution_day::text,'executedAt',p_execution_date,'assignedOccurrenceKey',assigned_occurrence,'occurrenceKey',occurrence,
      'assignmentId',p_assignment_id,'executionType',p_execution_type,'outOfPlanReason',p_out_of_plan_reason,
      'executionCompleteness',case when complete then 'COMPLETE' else 'PARTIAL' end,'satisfiedOccurrenceKey',satisfied);
    row_payload := jsonb_build_object('id',p_record_id,'equipmentId',p_equipment_id,'planId',p_plan_id,'date',p_execution_date,
      'shiftId',p_shift_id,'userId',p_performed_by,'userName',performer_name,'retroactivo',p_retroactive,
      'sinHorometro',p_no_hourmeter,'noHourmeterReason',p_no_hourmeter_reason,'operationalSnapshot',snapshot,
      'createdAt',p_client_captured_at,'createdBy',actor.display_name,'capturadoPor',case when p_retroactive then actor.display_name else null end,
      'capturedByAuthUserId',actor.auth_user_id,'capturedByAppUserId',actor.app_user_id,'capturedAt',stamp_at,'active',true);
  else row_payload := original.payload; end if;
  row_payload := row_payload || jsonb_build_object('hourmeter',p_hourmeter,'greaseType',p_lubricant_id,'qty',p_quantity,
    'condition',p_condition,'notes',p_notes,'details',normalized_details,'photos',p_photos,'photo',p_photos->0,'updatedAt',stamp_at);
  is_latest := not exists(select 1 from public.engrase_sync where store='lubrication_records' and id<>p_record_id and not deleted
    and coalesce(payload->>'active','true')='true' and payload->>'equipmentId'=p_equipment_id
    and ((payload->>'date')::timestamptz > p_execution_date or (p_action='EDIT' and (payload->>'date')::timestamptz=p_execution_date and id collate "C" < p_record_id collate "C")));
  if p_action='CREATE' and not p_no_hourmeter and not p_retroactive
    and p_hourmeter < coalesce((equipment.payload->>'hourmeter')::numeric,0) then
    return jsonb_build_object('status','DENIED','code','HOURMETER_REGRESSION');
  end if;
  if p_action='EDIT' and is_latest and p_hourmeter < coalesce((equipment.payload->>'hourmeter')::numeric,0) then
    return jsonb_build_object('status','DENIED','code','HOURMETER_REGRESSION');
  end if;
  if support_id is not null and not authorization_private.support_photos_owned(p_photos,case when p_action='EDIT' then original.payload->'photos' else '[]'::jsonb end) then return jsonb_build_object('status','DENIED','code','PHOTO_OBJECT_DENIED'); end if;
  -- All validation finishes before the first write. Exceptions still roll back the whole RPC.
  -- Keep versions monotonic even if an older client supplied a future device timestamp.
  -- This version clock is distinct from the trusted capturedAt/completedAt clock.
  version_at := greatest(clock_timestamp(),equipment.updated_at + interval '1 microsecond',
    plan.updated_at + interval '1 microsecond',original.updated_at + interval '1 microsecond',assignment.updated_at + interval '1 microsecond');
  row_payload := row_payload || jsonb_build_object('updatedAt',version_at);
  insert into public.engrase_sync(store,id,payload,updated_at,deleted) values('lubrication_records',p_record_id,row_payload,version_at,false)
    on conflict(store,id) do update set payload=excluded.payload,updated_at=excluded.updated_at;
  if is_latest and (p_action='EDIT' or not p_no_hourmeter) then
    if p_action='EDIT' or not p_retroactive or p_hourmeter > coalesce((equipment.payload->>'hourmeter')::numeric,0) then
      update public.engrase_sync set payload=payload||jsonb_build_object('hourmeter',p_hourmeter,'updatedAt',version_at),updated_at=version_at
        where store='equipment' and id=p_equipment_id;
    end if;
    if (support_id is null or (p_action='CREATE' and assigned_occurrence=current_occurrence)) and plan.id is not null and not dual_shift_active and (plan.payload->>'controlType'<>'Horas de operación' or complete) then
      update public.engrase_sync set payload=payload||jsonb_build_object('lastGreaseHour',p_hourmeter,'updatedAt',version_at),updated_at=version_at
        where store='lubrication_plans' and id=p_plan_id;
    end if;
  elsif p_action='CREATE' and (assigned_occurrence is null or assigned_occurrence=current_occurrence) and p_no_hourmeter and not dual_shift_active and plan.payload->>'controlType'='Horas de operación' then
    update public.engrase_sync set payload=payload||jsonb_build_object('lastGreaseDateNoHm',p_execution_date,'updatedAt',version_at),updated_at=version_at
      where store='lubrication_plans' and id=p_plan_id;
  end if;
  if p_action='CREATE' and assignment.id is not null then perform authorization_private.link_support_entity('lubrication_records',p_record_id,assignment.id); end if;
  if p_action='CREATE' and assignment.id is not null and complete then
    update public.engrase_sync set payload=payload||jsonb_build_object('status','COMPLETED','completedAt',stamp_at,'completedRecordId',p_record_id,'updatedAt',version_at),updated_at=version_at
      where store='lubrication_assignments' and id=assignment.id;
  end if;
  insert into public.engrase_sync(store,id,payload,updated_at,deleted)
    values('audit_log','execution:'||actor.auth_user_id::text||':'||p_operation_id,
      jsonb_build_object('id','execution:'||actor.auth_user_id::text||':'||p_operation_id,'action',case when p_action='EDIT' then 'ENGRASE_EDITADO'
        when p_retroactive then 'ENGRASE_RETROACTIVO_REGISTRADO' else 'ENGRASE_REGISTRADO' end,
        'detail',coalesce(equipment.payload->>'code',p_equipment_id)||' · registro '||p_execution_date::text||' · '||p_hourmeter::text||' h',
        'user',actor.display_name,'authUserId',actor.auth_user_id,'appUserId',actor.app_user_id,'createdAt',stamp_at,'updatedAt',version_at,'active',true),version_at,false);
  if p_action='CREATE' and (p_execution_type='OUT_OF_PLAN' or assignment.id is not null) then
    insert into public.engrase_sync(store,id,payload,updated_at,deleted)
      values('audit_log','execution-effect:'||actor.auth_user_id::text||':'||p_operation_id,
        jsonb_build_object('id','execution-effect:'||actor.auth_user_id::text||':'||p_operation_id,
          'action',case when assignment.id is not null then (case when complete then 'GREASE_ASSIGNMENT_COMPLETED' else 'GREASE_ASSIGNMENT_PARTIAL' end) else 'OUT_OF_PLAN_GREASE_RECORDED' end,
          'detail',jsonb_build_object('recordId',p_record_id,'equipmentId',p_equipment_id,'assignmentId',assignment.id,
            'reason',p_out_of_plan_reason,'completeness',case when complete then 'COMPLETE' else 'PARTIAL' end,'satisfiedOccurrenceKey',satisfied)::text,
          'user',actor.display_name,'authUserId',actor.auth_user_id,'appUserId',actor.app_user_id,'createdAt',stamp_at,'updatedAt',version_at,'active',true),version_at,false);
  end if;
  select jsonb_agg(jsonb_build_object('store',store,'id',id,'payload',payload,'updated_at',updated_at)) into canonical
    from public.engrase_sync where (store='lubrication_records' and id=p_record_id) or (store='equipment' and id=p_equipment_id)
      or (store='lubrication_plans' and id=p_plan_id) or (p_action='CREATE' and store='lubrication_assignments' and id=assignment.id);
  result := jsonb_build_object('status','APPLIED','rows',canonical);
  insert into public.lubrication_execution_receipts(auth_user_id,operation_id,request,result) values(actor.auth_user_id,p_operation_id,request,result);
  return result;
end;
$gateway$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.manage_lubrication_assignment(p_operation_id text,p_action text,p_id text,p_expected timestamptz,
  p_equipment_id text,p_plan_id text,p_occurrence_key text,p_crew_id text,p_notes text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
  select public.assignment_skip_operation(p_operation_id,p_action,p_id,p_expected,p_equipment_id,p_plan_id,p_occurrence_key,p_crew_id,p_notes,null,null,null,null,null)
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql (EXACT_NORMALIZED_BODY)

create function public.move_equipment_master_location(p_operation_id text,p_id text,p_expected timestamptz,p_location_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'MOVE',p_id,null,p_expected,p_location_id,null,null,null,null,null)$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

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

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.record_lubrication_skip(p_operation_id text,p_id text,p_expected timestamptz,
  p_equipment_id text,p_plan_id text,p_occurrence_key text,p_crew_id text,p_date timestamptz,
  p_shift_id text,p_reason text,p_observacion text,p_linked_record_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
  select public.assignment_skip_operation(p_operation_id,'SKIP',p_id,p_expected,p_equipment_id,p_plan_id,p_occurrence_key,p_crew_id,null,p_date,p_shift_id,p_reason,p_observacion,p_linked_record_id)
$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.repeat_anomaly_from_execution(p_operation_id text,p_record_id text,p_crew_id text,p_expected timestamptz)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'AUTOMATIC',null,null,p_crew_id,p_expected,null,null,null,null,null,null,p_record_id,null,null,null,null); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.report_anomaly(p_operation_id text,p_id text,p_equipment_id text,p_crew_id text,p_component text,p_description text,p_criticality text,p_photos jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'REPORT',p_id,p_equipment_id,p_crew_id,null,p_component,p_description,p_criticality,null,p_photos,null,null,null,null,null,null); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.report_assignment_anomaly(p_operation_id text,p_id text,p_equipment_id text,p_crew_id text,p_component text,p_description text,p_criticality text,p_photos jsonb,p_assignment_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'REPORT',p_id,p_equipment_id,p_crew_id,null,p_component,p_description,p_criticality,null,p_photos,null,p_assignment_id,null,null,null,null); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql (EXACT_NORMALIZED_BODY)

create function public.reprogram_lubrication_plan(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_until date,p_reason text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'REPROGRAM',p_id,p_crew_id,p_expected,null,null,p_until,p_reason,null,null)$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0012_authorization_scope_bootstrap_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create or replace function public.resolve_authorization_scope(p_auth_user_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog
as $scope$
declare
  profile public.app_profiles%rowtype;
  crew_ids text[] := array[]::text[];
  location_ids text[] := array[]::text[];
  bad_crew boolean := false;
  scope_kind text := 'DENIED';
  fingerprint text;
begin
  if p_auth_user_id is null then
    return jsonb_build_object('status','DENIED','code','AUTH_REQUIRED');
  end if;

  select * into profile from public.app_profiles where auth_user_id=p_auth_user_id;
  if not found then return jsonb_build_object('status','DENIED','code','PROFILE_NOT_FOUND'); end if;
  if profile.active is distinct from true then return jsonb_build_object('status','DENIED','code','INACTIVE_PROFILE'); end if;
  if profile.role is null or profile.role not in ('ADMINISTRADOR','PLANIFICADOR','SUPERVISOR','LUBRICADOR') then
    return jsonb_build_object('status','DENIED','code','ROLE_DENIED');
  end if;

  if profile.role in ('ADMINISTRADOR','PLANIFICADOR') then
    scope_kind := 'GLOBAL';
    select coalesce(array_agg(x.id order by x.id),array[]::text[])
      into crew_ids from (
        select distinct s.id from public.engrase_sync s
        where s.store='cuadrillas' and not s.deleted
          and coalesce(s.payload->>'active','true')='true'
      ) x;
    select coalesce(array_agg(x.id order by x.id),array[]::text[])
      into location_ids from (
        select distinct s.id from public.engrase_sync s
        where s.store='locations' and not s.deleted
          and coalesce(s.payload->>'active','true')='true'
      ) x;
  else
    select coalesce(bool_or(nullif(btrim(s.payload->>'locationId'),'') is null
      or not exists (select 1 from public.engrase_sync l
        where l.store='locations' and l.id=s.payload->>'locationId' and not l.deleted
          and coalesce(l.payload->>'active','true')='true')),false)
      into bad_crew
    from public.engrase_sync s
    where s.store='cuadrillas' and not s.deleted
      and coalesce(s.payload->>'active','true')='true'
      and jsonb_typeof(s.payload->'memberUserIds')='array'
      and s.payload->'memberUserIds' ? profile.app_user_id;

    if bad_crew then return jsonb_build_object('status','DENIED','code','AMBIGUOUS_CREW_SCOPE'); end if;

    select coalesce(array_agg(x.id order by x.id),array[]::text[]),
           coalesce(array_agg(distinct x.location_id order by x.location_id),array[]::text[])
      into crew_ids,location_ids
    from (
      select s.id, s.payload->>'locationId' as location_id
      from public.engrase_sync s
      where s.store='cuadrillas' and not s.deleted
        and coalesce(s.payload->>'active','true')='true'
        and jsonb_typeof(s.payload->'memberUserIds')='array'
        and s.payload->'memberUserIds' ? profile.app_user_id
        and exists (select 1 from public.engrase_sync l
          where l.store='locations' and l.id=s.payload->>'locationId' and not l.deleted
            and coalesce(l.payload->>'active','true')='true')
    ) x;
    if cardinality(crew_ids)=0 or cardinality(location_ids)=0 then
      return jsonb_build_object('status','DENIED','code','NO_VALID_CREW_MEMBERSHIP');
    end if;
    scope_kind := 'CREW_SCOPED';
  end if;

  fingerprint := md5(jsonb_build_object(
    'authUserId',profile.auth_user_id,
    'appUserId',profile.app_user_id,
    'role',profile.role,
    'active',profile.active,
    'scopeType',scope_kind,
    'authorizedCrewIds',to_jsonb(crew_ids),
    'authorizedLocationIds',to_jsonb(location_ids)
  )::text);

  return jsonb_build_object(
    'status','AUTHORIZED',
    'context',jsonb_build_object(
      'authUserId',profile.auth_user_id,
      'appUserId',profile.app_user_id,
      'displayName',profile.display_name,
      'role',profile.role,
      'active',profile.active,
      'scopeType',scope_kind,
      'authorizedCrewIds',to_jsonb(crew_ids),
      'authorizedLocationIds',to_jsonb(location_ids),
      'authorizationFingerprint',fingerprint,
      'rowScopeEnforced',false
    )
  );
end
$scope$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.resolve_grease_validation_conflict(p_operation_id text,p_record_id text,p_id text,p_note text,p_expected_signatures jsonb)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'RESOLVE',p_id,null,null,null,null,null,null,null,null,p_note,p_record_id,null,null,null,p_expected_signatures); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql (SQL_TOKENS_IDENTICAL)

create function public.retire_anomaly(p_operation_id text,p_id text,p_expected timestamptz)
returns jsonb language sql security definer set search_path=pg_catalog as $$
 select public.evidence_operation(p_operation_id,'RETIRE',p_id,null,null,p_expected,null,null,null,null,null,null,null,null,null,null,null); $$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql (EXACT_NORMALIZED_BODY)

create function public.set_equipment_alert_pause(p_operation_id text,p_id text,p_crew_id text,p_expected timestamptz,p_until date,p_reason text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'PAUSE',p_id,p_crew_id,p_expected,null,null,p_until,p_reason,null,null)$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql (EXACT_NORMALIZED_BODY)

create function public.set_equipment_shift(p_operation_id text,p_id text,p_expected timestamptz,p_shift_id text)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'SHIFT',p_id,null,p_expected,null,p_shift_id,null,null,null,null)$$;

-- Verified local source: CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql (EXACT_NORMALIZED_BODY)

create function public.update_equipment_hourmeter(p_operation_id text,p_id text,p_expected timestamptz,p_hourmeter numeric,p_confirm_large_jump boolean)
returns jsonb language sql security definer set search_path=pg_catalog as $$select public.operational_catalog_operation(p_operation_id,'HOURMETER',p_id,null,p_expected,null,null,null,null,p_hourmeter,p_confirm_large_jump)$$;

alter function "authorization_private"."authorization_row_in_scope"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) owner to "postgres";

alter function "authorization_private"."authorization_row_in_scope"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."authorization_row_in_scope"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) reset all;

alter function "authorization_private"."authorization_row_in_scope"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) set "search_path" to pg_catalog;

alter function "authorization_private"."authorization_row_in_scope_baseline_0013"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) owner to "postgres";

alter function "authorization_private"."authorization_row_in_scope_baseline_0013"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."authorization_row_in_scope_baseline_0013"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) reset all;

alter function "authorization_private"."authorization_row_in_scope_baseline_0013"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) set "search_path" to pg_catalog;

alter function "authorization_private"."authorization_store_action_allowed"(p_store text, p_action text, p_deleted boolean) owner to "postgres";

alter function "authorization_private"."authorization_store_action_allowed"(p_store text, p_action text, p_deleted boolean) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."authorization_store_action_allowed"(p_store text, p_action text, p_deleted boolean) reset all;

alter function "authorization_private"."authorization_store_action_allowed"(p_store text, p_action text, p_deleted boolean) set "search_path" to pg_catalog;

alter function "authorization_private"."link_support_entity"(p_store text, p_id text, p_assignment text, p_crew text) owner to "postgres";

alter function "authorization_private"."link_support_entity"(p_store text, p_id text, p_assignment text, p_crew text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."link_support_entity"(p_store text, p_id text, p_assignment text, p_crew text) reset all;

alter function "authorization_private"."link_support_entity"(p_store text, p_id text, p_assignment text, p_crew text) set "search_path" to pg_catalog;

alter function "authorization_private"."support_assignment_valid"(p_id text) owner to "postgres";

alter function "authorization_private"."support_assignment_valid"(p_id text) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."support_assignment_valid"(p_id text) reset all;

alter function "authorization_private"."support_assignment_valid"(p_id text) set "search_path" to pg_catalog;

alter function "authorization_private"."support_grant_rows"() owner to "postgres";

alter function "authorization_private"."support_grant_rows"() security definer stable called on null input not leakproof parallel unsafe cost 100 rows 1000;

alter function "authorization_private"."support_grant_rows"() reset all;

alter function "authorization_private"."support_grant_rows"() set "search_path" to pg_catalog;

alter function "authorization_private"."support_history_allowed"(p_store text, p_id text) owner to "postgres";

alter function "authorization_private"."support_history_allowed"(p_store text, p_id text) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."support_history_allowed"(p_store text, p_id text) reset all;

alter function "authorization_private"."support_history_allowed"(p_store text, p_id text) set "search_path" to pg_catalog;

alter function "authorization_private"."support_occurrence_valid"(p_plan text, p_key text) owner to "postgres";

alter function "authorization_private"."support_occurrence_valid"(p_plan text, p_key text) security invoker immutable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."support_occurrence_valid"(p_plan text, p_key text) reset all;

alter function "authorization_private"."support_occurrence_valid"(p_plan text, p_key text) set "search_path" to pg_catalog;

alter function "authorization_private"."support_photos_owned"(p_photos jsonb, p_existing jsonb) owner to "postgres";

alter function "authorization_private"."support_photos_owned"(p_photos jsonb, p_existing jsonb) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."support_photos_owned"(p_photos jsonb, p_existing jsonb) reset all;

alter function "authorization_private"."support_photos_owned"(p_photos jsonb, p_existing jsonb) set "search_path" to pg_catalog;

alter function "authorization_private"."support_row_granted"(p_store text, p_id text, p_context jsonb) owner to "postgres";

alter function "authorization_private"."support_row_granted"(p_store text, p_id text, p_context jsonb) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "authorization_private"."support_row_granted"(p_store text, p_id text, p_context jsonb) reset all;

alter function "authorization_private"."support_row_granted"(p_store text, p_id text, p_context jsonb) set "search_path" to pg_catalog;

alter function "public"."assignment_skip_operation"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) owner to "postgres";

alter function "public"."assignment_skip_operation"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."assignment_skip_operation"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) reset all;

alter function "public"."assignment_skip_operation"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) set "search_path" to pg_catalog;

alter function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) owner to "postgres";

alter function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) reset all;

alter function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) set "search_path" to pg_catalog;

alter function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) owner to "postgres";

alter function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) reset all;

alter function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) set "search_path" to pg_catalog;

alter function "public"."catalog_writer_role"() owner to "postgres";

alter function "public"."catalog_writer_role"() security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "public"."catalog_writer_role"() reset all;

alter function "public"."catalog_writer_role"() set "search_path" to pg_catalog;

alter function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) owner to "postgres";

alter function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) reset all;

alter function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) set "search_path" to pg_catalog;

alter function "public"."current_app_active"() owner to "postgres";

alter function "public"."current_app_active"() security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "public"."current_app_active"() reset all;

alter function "public"."current_app_active"() set "search_path" to public, pg_temp;

alter function "public"."current_app_role"() owner to "postgres";

alter function "public"."current_app_role"() security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "public"."current_app_role"() reset all;

alter function "public"."current_app_role"() set "search_path" to public, pg_temp;

alter function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) owner to "postgres";

alter function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) reset all;

alter function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) set "search_path" to pg_catalog;

alter function "public"."evidence_operation"(p_operation_id text, p_action text, p_id text, p_equipment_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb, p_note text, p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text, p_expected_signatures jsonb) owner to "postgres";

alter function "public"."evidence_operation"(p_operation_id text, p_action text, p_id text, p_equipment_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb, p_note text, p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text, p_expected_signatures jsonb) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."evidence_operation"(p_operation_id text, p_action text, p_id text, p_equipment_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb, p_note text, p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text, p_expected_signatures jsonb) reset all;

alter function "public"."evidence_operation"(p_operation_id text, p_action text, p_id text, p_equipment_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb, p_note text, p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text, p_expected_signatures jsonb) set "search_path" to pg_catalog;

alter function "public"."get_assignment_support_context"() owner to "postgres";

alter function "public"."get_assignment_support_context"() security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "public"."get_assignment_support_context"() reset all;

alter function "public"."get_assignment_support_context"() set "search_path" to pg_catalog;

alter function "public"."get_authorization_context"() owner to "postgres";

alter function "public"."get_authorization_context"() security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "public"."get_authorization_context"() reset all;

alter function "public"."get_authorization_context"() set "search_path" to pg_catalog;

alter function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) owner to "postgres";

alter function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) reset all;

alter function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) set "search_path" to pg_catalog;

alter function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) owner to "postgres";

alter function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) reset all;

alter function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) set "search_path" to pg_catalog;

alter function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) owner to "postgres";

alter function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) reset all;

alter function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) set "search_path" to pg_catalog;

alter function "public"."operational_catalog_operation"(p_operation_id text, p_action text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_location_id text, p_shift_id text, p_until date, p_reason text, p_hourmeter numeric, p_confirm_large_jump boolean) owner to "postgres";

alter function "public"."operational_catalog_operation"(p_operation_id text, p_action text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_location_id text, p_shift_id text, p_until date, p_reason text, p_hourmeter numeric, p_confirm_large_jump boolean) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."operational_catalog_operation"(p_operation_id text, p_action text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_location_id text, p_shift_id text, p_until date, p_reason text, p_hourmeter numeric, p_confirm_large_jump boolean) reset all;

alter function "public"."operational_catalog_operation"(p_operation_id text, p_action text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_location_id text, p_shift_id text, p_until date, p_reason text, p_hourmeter numeric, p_confirm_large_jump boolean) set "search_path" to pg_catalog;

alter function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) owner to "postgres";

alter function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) reset all;

alter function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) set "search_path" to pg_catalog;

alter function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) owner to "postgres";

alter function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) reset all;

alter function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) set "search_path" to pg_catalog;

alter function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) owner to "postgres";

alter function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) reset all;

alter function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) set "search_path" to pg_catalog;

alter function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) owner to "postgres";

alter function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) reset all;

alter function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) set "search_path" to pg_catalog;

alter function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) owner to "postgres";

alter function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) reset all;

alter function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) set "search_path" to pg_catalog;

alter function "public"."resolve_authorization_scope"(p_auth_user_id uuid) owner to "postgres";

alter function "public"."resolve_authorization_scope"(p_auth_user_id uuid) security definer stable called on null input not leakproof parallel unsafe cost 100;

alter function "public"."resolve_authorization_scope"(p_auth_user_id uuid) reset all;

alter function "public"."resolve_authorization_scope"(p_auth_user_id uuid) set "search_path" to pg_catalog;

alter function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) owner to "postgres";

alter function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) reset all;

alter function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) set "search_path" to pg_catalog;

alter function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) owner to "postgres";

alter function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) reset all;

alter function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) set "search_path" to pg_catalog;

alter function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) owner to "postgres";

alter function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) reset all;

alter function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) set "search_path" to pg_catalog;

alter function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) owner to "postgres";

alter function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) reset all;

alter function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) set "search_path" to pg_catalog;

alter function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) owner to "postgres";

alter function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) security definer volatile called on null input not leakproof parallel unsafe cost 100;

alter function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) reset all;

alter function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) set "search_path" to pg_catalog;

alter table "authorization_private"."release_migration_state" enable row level security;

alter table "authorization_private"."release_migration_state" no force row level security;

alter table "authorization_private"."support_control" enable row level security;

alter table "authorization_private"."support_control" no force row level security;

alter table "authorization_private"."support_links" enable row level security;

alter table "authorization_private"."support_links" no force row level security;

alter table "public"."app_profiles" enable row level security;

alter table "public"."app_profiles" no force row level security;

alter table "public"."app_store_permissions" enable row level security;

alter table "public"."app_store_permissions" no force row level security;

alter table "public"."assignment_skip_operation_receipts" enable row level security;

alter table "public"."assignment_skip_operation_receipts" no force row level security;

alter table "public"."engrase_sync" enable row level security;

alter table "public"."engrase_sync" no force row level security;

alter table "public"."evidence_operation_receipts" enable row level security;

alter table "public"."evidence_operation_receipts" no force row level security;

alter table "public"."lubrication_execution_receipts" enable row level security;

alter table "public"."lubrication_execution_receipts" no force row level security;

alter table "public"."operational_catalog_receipts" enable row level security;

alter table "public"."operational_catalog_receipts" no force row level security;

create policy "app_profiles: admin crea perfiles" on "public"."app_profiles" as PERMISSIVE for INSERT to "public" with check (((current_app_role() = 'ADMINISTRADOR'::text) AND current_app_active()));

create policy "app_profiles: admin edita otros" on "public"."app_profiles" as PERMISSIVE for UPDATE to "public" using (((auth.uid() <> auth_user_id) AND (current_app_role() = 'ADMINISTRADOR'::text) AND current_app_active())) with check ((auth.uid() <> auth_user_id));

create policy "app_profiles: admin lee todos" on "public"."app_profiles" as PERMISSIVE for SELECT to "public" using (((current_app_role() = 'ADMINISTRADOR'::text) AND current_app_active()));

create policy "app_profiles: leer el propio perfil" on "public"."app_profiles" as PERMISSIVE for SELECT to "public" using ((auth.uid() = auth_user_id));

create policy "app_store_permissions: lectura autenticada" on "public"."app_store_permissions" as PERMISSIVE for SELECT to "public" using (current_app_active());

create policy "acceso interno con anon key" on "public"."engrase_sync" as PERMISSIVE for ALL to "public" using (true) with check (true);

create policy "assignment_skip_rpc_delete_only" on "public"."engrase_sync" as RESTRICTIVE for DELETE to "public" using ((store <> ALL (ARRAY['lubrication_assignments'::text, 'lubrication_skips'::text, 'lubrication_records'::text])));

create policy "assignment_skip_rpc_insert_only" on "public"."engrase_sync" as RESTRICTIVE for INSERT to "public" with check ((store <> ALL (ARRAY['lubrication_assignments'::text, 'lubrication_skips'::text, 'lubrication_records'::text])));

create policy "assignment_skip_rpc_update_only" on "public"."engrase_sync" as RESTRICTIVE for UPDATE to "public" using ((store <> ALL (ARRAY['lubrication_assignments'::text, 'lubrication_skips'::text, 'lubrication_records'::text]))) with check ((store <> ALL (ARRAY['lubrication_assignments'::text, 'lubrication_skips'::text, 'lubrication_records'::text])));

create policy "authorization_scope_delete" on "public"."engrase_sync" as RESTRICTIVE for DELETE to "authenticated" using (authorization_private.authorization_row_in_scope_baseline_0013(store, id, payload, 'DELETE'::text, ( SELECT get_authorization_context() AS get_authorization_context)));

create policy "authorization_scope_insert" on "public"."engrase_sync" as RESTRICTIVE for INSERT to "authenticated" with check (authorization_private.authorization_row_in_scope_baseline_0013(store, id, payload, 'INSERT'::text, ( SELECT get_authorization_context() AS get_authorization_context)));

create policy "authorization_scope_select" on "public"."engrase_sync" as RESTRICTIVE for SELECT to "authenticated" using ((authorization_private.authorization_row_in_scope(store, id, payload, 'SELECT'::text, ( SELECT get_authorization_context() AS get_authorization_context)) OR ((store = 'settings'::text) AND (( SELECT (get_authorization_context() ->> 'status'::text)) = 'AUTHORIZED'::text))));

create policy "authorization_scope_update" on "public"."engrase_sync" as RESTRICTIVE for UPDATE to "authenticated" using (authorization_private.authorization_row_in_scope_baseline_0013(store, id, payload, 'UPDATE'::text, ( SELECT get_authorization_context() AS get_authorization_context))) with check (authorization_private.authorization_row_in_scope_baseline_0013(store, id, payload, 'UPDATE'::text, ( SELECT get_authorization_context() AS get_authorization_context)));

create policy "authorization_store_delete" on "public"."engrase_sync" as RESTRICTIVE for DELETE to "authenticated" using (authorization_private.authorization_store_action_allowed(store, 'DELETE'::text, deleted));

create policy "authorization_store_insert" on "public"."engrase_sync" as RESTRICTIVE for INSERT to "authenticated" with check (authorization_private.authorization_store_action_allowed(store, 'INSERT'::text, deleted));

create policy "authorization_store_select" on "public"."engrase_sync" as RESTRICTIVE for SELECT to "authenticated" using (authorization_private.authorization_store_action_allowed(store, 'SELECT'::text, deleted));

create policy "authorization_store_update" on "public"."engrase_sync" as RESTRICTIVE for UPDATE to "authenticated" using (authorization_private.authorization_store_action_allowed(store, 'UPDATE_USING'::text, deleted)) with check (authorization_private.authorization_store_action_allowed(store, 'UPDATE_CHECK'::text, deleted));

create policy "catalog_delete_roles" on "public"."engrase_sync" as RESTRICTIVE for DELETE to "authenticated" using ((store <> ALL (ARRAY['equipment'::text, 'lubrication_plans'::text, 'lubrication_points'::text, 'settings'::text])));

create policy "catalog_insert_roles" on "public"."engrase_sync" as RESTRICTIVE for INSERT to "authenticated" with check (
CASE
    WHEN (store = ANY (ARRAY['equipment'::text, 'settings'::text])) THEN (catalog_writer_role() = 'ADMINISTRADOR'::text)
    WHEN (store = ANY (ARRAY['lubrication_plans'::text, 'lubrication_points'::text])) THEN (catalog_writer_role() = ANY (ARRAY['ADMINISTRADOR'::text, 'PLANIFICADOR'::text]))
    ELSE true
END);

create policy "catalog_settings_read" on "public"."engrase_sync" as PERMISSIVE for SELECT to "authenticated" using (((store = 'settings'::text) AND (catalog_writer_role() = ANY (ARRAY['ADMINISTRADOR'::text, 'PLANIFICADOR'::text, 'SUPERVISOR'::text, 'LUBRICADOR'::text]))));

create policy "catalog_update_roles" on "public"."engrase_sync" as RESTRICTIVE for UPDATE to "authenticated" using (
CASE
    WHEN (store = ANY (ARRAY['equipment'::text, 'settings'::text])) THEN (catalog_writer_role() = 'ADMINISTRADOR'::text)
    WHEN (store = ANY (ARRAY['lubrication_plans'::text, 'lubrication_points'::text])) THEN (catalog_writer_role() = ANY (ARRAY['ADMINISTRADOR'::text, 'PLANIFICADOR'::text]))
    ELSE true
END) with check (
CASE
    WHEN (store = ANY (ARRAY['equipment'::text, 'settings'::text])) THEN (catalog_writer_role() = 'ADMINISTRADOR'::text)
    WHEN (store = ANY (ARRAY['lubrication_plans'::text, 'lubrication_points'::text])) THEN (catalog_writer_role() = ANY (ARRAY['ADMINISTRADOR'::text, 'PLANIFICADOR'::text]))
    ELSE true
END);

create policy "engrase_sync: actualizar según matriz" on "public"."engrase_sync" as PERMISSIVE for UPDATE to "public" using ((current_app_active() AND (EXISTS ( SELECT 1
   FROM app_store_permissions p
  WHERE ((p.store = engrase_sync.store) AND (p.role = current_app_role()) AND (p.can_update OR p.can_delete)))))) with check ((current_app_active() AND (EXISTS ( SELECT 1
   FROM app_store_permissions p
  WHERE ((p.store = engrase_sync.store) AND (p.role = current_app_role()) AND ((engrase_sync.deleted AND p.can_delete) OR ((NOT engrase_sync.deleted) AND p.can_update)))))));

create policy "engrase_sync: crear según matriz" on "public"."engrase_sync" as PERMISSIVE for INSERT to "public" with check ((current_app_active() AND (EXISTS ( SELECT 1
   FROM app_store_permissions p
  WHERE ((p.store = engrase_sync.store) AND (p.role = current_app_role()) AND p.can_insert)))));

create policy "engrase_sync: leer según matriz" on "public"."engrase_sync" as PERMISSIVE for SELECT to "public" using ((current_app_active() AND (EXISTS ( SELECT 1
   FROM app_store_permissions p
  WHERE ((p.store = engrase_sync.store) AND (p.role = current_app_role()) AND p.can_read)))));

create policy "evidence_rpc_delete_only" on "public"."engrase_sync" as RESTRICTIVE for DELETE to "public" using ((store <> ALL (ARRAY['anomalies'::text, 'grease_validations'::text])));

create policy "evidence_rpc_insert_only" on "public"."engrase_sync" as RESTRICTIVE for INSERT to "public" with check ((store <> ALL (ARRAY['anomalies'::text, 'grease_validations'::text])));

create policy "evidence_rpc_update_only" on "public"."engrase_sync" as RESTRICTIVE for UPDATE to "public" using ((store <> ALL (ARRAY['anomalies'::text, 'grease_validations'::text]))) with check ((store <> ALL (ARRAY['anomalies'::text, 'grease_validations'::text])));

drop policy if exists "engrase-photos actualizar con anon key" on "storage"."objects";

create policy "engrase-photos actualizar con anon key" on "storage"."objects" as PERMISSIVE for UPDATE to "public" using ((bucket_id = 'engrase-photos'::text));

drop policy if exists "engrase-photos lectura publica" on "storage"."objects";

create policy "engrase-photos lectura publica" on "storage"."objects" as PERMISSIVE for SELECT to "public" using ((bucket_id = 'engrase-photos'::text));

drop policy if exists "engrase-photos subir con anon key" on "storage"."objects";

create policy "engrase-photos subir con anon key" on "storage"."objects" as PERMISSIVE for INSERT to "public" with check ((bucket_id = 'engrase-photos'::text));

drop policy if exists "signature_objects_immutable_delete" on "storage"."objects";

create policy "signature_objects_immutable_delete" on "storage"."objects" as RESTRICTIVE for DELETE to "public" using ((NOT ((bucket_id = 'engrase-photos'::text) AND (name ~~ 'grease_validations/%'::text))));

drop policy if exists "signature_objects_immutable_update" on "storage"."objects";

create policy "signature_objects_immutable_update" on "storage"."objects" as RESTRICTIVE for UPDATE to "public" using ((NOT ((bucket_id = 'engrase-photos'::text) AND (name ~~ 'grease_validations/%'::text)))) with check ((NOT ((bucket_id = 'engrase-photos'::text) AND (name ~~ 'grease_validations/%'::text))));

insert into public.app_store_permissions(store,role,can_read,can_insert,can_update,can_delete) values
('anomalies','ADMINISTRADOR',true,true,true,true),
('anomalies','LUBRICADOR',true,true,false,false),
('anomalies','PLANIFICADOR',false,false,false,false),
('anomalies','SUPERVISOR',true,true,true,false),
('anomalies','VISOR',false,false,false,false),
('audit_log','ADMINISTRADOR',true,true,false,false),
('audit_log','LUBRICADOR',false,true,false,false),
('audit_log','PLANIFICADOR',false,true,false,false),
('audit_log','SUPERVISOR',false,true,false,false),
('audit_log','VISOR',false,false,false,false),
('cuadrillas','ADMINISTRADOR',true,true,true,true),
('cuadrillas','LUBRICADOR',true,false,false,false),
('cuadrillas','PLANIFICADOR',true,false,false,false),
('cuadrillas','SUPERVISOR',true,false,false,false),
('cuadrillas','VISOR',false,false,false,false),
('equipment','ADMINISTRADOR',true,true,true,true),
('equipment','LUBRICADOR',true,false,false,false),
('equipment','PLANIFICADOR',true,false,false,false),
('equipment','SUPERVISOR',true,false,false,false),
('equipment','VISOR',false,false,false,false),
('equipment_types','ADMINISTRADOR',true,true,true,true),
('equipment_types','LUBRICADOR',true,false,false,false),
('equipment_types','PLANIFICADOR',true,false,false,false),
('equipment_types','SUPERVISOR',true,false,false,false),
('equipment_types','VISOR',true,false,false,false),
('grease_validations','ADMINISTRADOR',true,true,true,true),
('grease_validations','LUBRICADOR',true,true,true,false),
('grease_validations','PLANIFICADOR',true,false,false,false),
('grease_validations','SUPERVISOR',true,true,true,false),
('grease_validations','VISOR',true,false,false,false),
('locations','ADMINISTRADOR',true,true,true,true),
('locations','LUBRICADOR',true,false,false,false),
('locations','PLANIFICADOR',true,false,false,false),
('locations','SUPERVISOR',true,false,false,false),
('locations','VISOR',true,false,false,false),
('lubricants','ADMINISTRADOR',true,true,true,true),
('lubricants','LUBRICADOR',true,false,false,false),
('lubricants','PLANIFICADOR',true,false,false,false),
('lubricants','SUPERVISOR',true,false,false,false),
('lubricants','VISOR',true,false,false,false),
('lubrication_assignments','ADMINISTRADOR',true,true,true,true),
('lubrication_assignments','LUBRICADOR',true,false,true,false),
('lubrication_assignments','PLANIFICADOR',true,true,true,false),
('lubrication_assignments','SUPERVISOR',true,true,true,false),
('lubrication_assignments','VISOR',true,false,false,false),
('lubrication_plans','ADMINISTRADOR',true,true,true,true),
('lubrication_plans','LUBRICADOR',true,false,true,false),
('lubrication_plans','PLANIFICADOR',true,false,false,false),
('lubrication_plans','SUPERVISOR',true,false,false,false),
('lubrication_plans','VISOR',false,false,false,false),
('lubrication_points','ADMINISTRADOR',true,true,true,true),
('lubrication_points','LUBRICADOR',true,false,false,false),
('lubrication_points','PLANIFICADOR',true,false,false,false),
('lubrication_points','SUPERVISOR',true,false,false,false),
('lubrication_points','VISOR',false,false,false,false),
('lubrication_records','ADMINISTRADOR',true,true,true,true),
('lubrication_records','LUBRICADOR',true,true,true,false),
('lubrication_records','PLANIFICADOR',true,true,true,false),
('lubrication_records','SUPERVISOR',true,true,true,false),
('lubrication_records','VISOR',true,false,false,false),
('lubrication_skips','ADMINISTRADOR',true,true,true,false),
('lubrication_skips','LUBRICADOR',true,true,true,false),
('lubrication_skips','PLANIFICADOR',true,true,true,false),
('lubrication_skips','SUPERVISOR',true,true,true,false),
('lubrication_skips','VISOR',true,false,false,false),
('notification_dispatch_log','ADMINISTRADOR',true,false,false,false),
('notification_dispatch_log','LUBRICADOR',false,false,false,false),
('notification_dispatch_log','PLANIFICADOR',false,false,false,false),
('notification_dispatch_log','SUPERVISOR',false,false,false,false),
('notification_dispatch_log','VISOR',false,false,false,false),
('push_tokens','ADMINISTRADOR',true,true,true,false),
('push_tokens','LUBRICADOR',true,true,true,false),
('push_tokens','PLANIFICADOR',true,true,true,false),
('push_tokens','SUPERVISOR',true,true,true,false),
('push_tokens','VISOR',false,true,true,false),
('settings','ADMINISTRADOR',true,true,true,true),
('settings','LUBRICADOR',true,false,false,false),
('settings','PLANIFICADOR',true,false,false,false),
('settings','SUPERVISOR',true,false,false,false),
('settings','VISOR',false,false,false,false),
('shifts','ADMINISTRADOR',true,true,true,true),
('shifts','LUBRICADOR',true,false,false,false),
('shifts','PLANIFICADOR',true,false,false,false),
('shifts','SUPERVISOR',true,false,false,false),
('shifts','VISOR',true,false,false,false),
('users','ADMINISTRADOR',true,true,true,true),
('users','LUBRICADOR',true,false,false,false),
('users','PLANIFICADOR',true,false,false,false),
('users','SUPERVISOR',true,true,true,false),
('users','VISOR',true,false,false,false);

insert into authorization_private.support_control(singleton,enabled) values(true,true);

insert into authorization_private.release_migration_state(version,matrix_digest) values('0016_fix_support_rls_performance','n/a: performance-only, no app_store_permissions change');

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('engrase-photos','engrase-photos',true,null,null);

revoke all on schema "public" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on schema "authorization_private" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "authorization_private"."release_migration_state" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "authorization_private"."support_control" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "authorization_private"."support_links" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "public"."app_profiles" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "public"."app_store_permissions" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "public"."assignment_skip_operation_receipts" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "public"."engrase_sync" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "public"."evidence_operation_receipts" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "public"."lubrication_execution_receipts" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on table "public"."operational_catalog_receipts" from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."authorization_row_in_scope"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."authorization_row_in_scope_baseline_0013"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."authorization_store_action_allowed"(p_store text, p_action text, p_deleted boolean) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."link_support_entity"(p_store text, p_id text, p_assignment text, p_crew text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."support_assignment_valid"(p_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."support_grant_rows"() from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."support_history_allowed"(p_store text, p_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."support_occurrence_valid"(p_plan text, p_key text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."support_photos_owned"(p_photos jsonb, p_existing jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "authorization_private"."support_row_granted"(p_store text, p_id text, p_context jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."assignment_skip_operation"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."catalog_writer_role"() from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."current_app_active"() from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."current_app_role"() from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."evidence_operation"(p_operation_id text, p_action text, p_id text, p_equipment_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb, p_note text, p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text, p_expected_signatures jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."get_assignment_support_context"() from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."get_authorization_context"() from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."operational_catalog_operation"(p_operation_id text, p_action text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_location_id text, p_shift_id text, p_until date, p_reason text, p_hourmeter numeric, p_confirm_large_jump boolean) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."resolve_authorization_scope"(p_auth_user_id uuid) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

revoke all on function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) from "postgres","authenticated",PUBLIC,"pg_database_owner","anon","service_role";

grant CREATE on schema "authorization_private" to "postgres";

grant USAGE on schema "authorization_private" to "postgres";

grant USAGE on schema "authorization_private" to "authenticated";

grant USAGE on schema "public" to PUBLIC;

grant CREATE on schema "public" to "pg_database_owner";

grant USAGE on schema "public" to "pg_database_owner";

grant USAGE on schema "public" to "postgres";

grant USAGE on schema "public" to "anon";

grant USAGE on schema "public" to "authenticated";

grant USAGE on schema "public" to "service_role";

grant DELETE on table "authorization_private"."release_migration_state" to "postgres";

grant INSERT on table "authorization_private"."release_migration_state" to "postgres";

grant MAINTAIN on table "authorization_private"."release_migration_state" to "postgres";

grant REFERENCES on table "authorization_private"."release_migration_state" to "postgres";

grant SELECT on table "authorization_private"."release_migration_state" to "postgres";

grant TRIGGER on table "authorization_private"."release_migration_state" to "postgres";

grant TRUNCATE on table "authorization_private"."release_migration_state" to "postgres";

grant UPDATE on table "authorization_private"."release_migration_state" to "postgres";

grant DELETE on table "authorization_private"."support_control" to "postgres";

grant INSERT on table "authorization_private"."support_control" to "postgres";

grant MAINTAIN on table "authorization_private"."support_control" to "postgres";

grant REFERENCES on table "authorization_private"."support_control" to "postgres";

grant SELECT on table "authorization_private"."support_control" to "postgres";

grant TRIGGER on table "authorization_private"."support_control" to "postgres";

grant TRUNCATE on table "authorization_private"."support_control" to "postgres";

grant UPDATE on table "authorization_private"."support_control" to "postgres";

grant DELETE on table "authorization_private"."support_links" to "postgres";

grant INSERT on table "authorization_private"."support_links" to "postgres";

grant MAINTAIN on table "authorization_private"."support_links" to "postgres";

grant REFERENCES on table "authorization_private"."support_links" to "postgres";

grant SELECT on table "authorization_private"."support_links" to "postgres";

grant TRIGGER on table "authorization_private"."support_links" to "postgres";

grant TRUNCATE on table "authorization_private"."support_links" to "postgres";

grant UPDATE on table "authorization_private"."support_links" to "postgres";

grant DELETE on table "public"."app_profiles" to "postgres";

grant INSERT on table "public"."app_profiles" to "postgres";

grant MAINTAIN on table "public"."app_profiles" to "postgres";

grant REFERENCES on table "public"."app_profiles" to "postgres";

grant SELECT on table "public"."app_profiles" to "postgres";

grant TRIGGER on table "public"."app_profiles" to "postgres";

grant TRUNCATE on table "public"."app_profiles" to "postgres";

grant UPDATE on table "public"."app_profiles" to "postgres";

grant DELETE on table "public"."app_profiles" to "anon";

grant INSERT on table "public"."app_profiles" to "anon";

grant MAINTAIN on table "public"."app_profiles" to "anon";

grant REFERENCES on table "public"."app_profiles" to "anon";

grant SELECT on table "public"."app_profiles" to "anon";

grant TRIGGER on table "public"."app_profiles" to "anon";

grant TRUNCATE on table "public"."app_profiles" to "anon";

grant UPDATE on table "public"."app_profiles" to "anon";

grant DELETE on table "public"."app_profiles" to "authenticated";

grant INSERT on table "public"."app_profiles" to "authenticated";

grant MAINTAIN on table "public"."app_profiles" to "authenticated";

grant REFERENCES on table "public"."app_profiles" to "authenticated";

grant SELECT on table "public"."app_profiles" to "authenticated";

grant TRIGGER on table "public"."app_profiles" to "authenticated";

grant TRUNCATE on table "public"."app_profiles" to "authenticated";

grant UPDATE on table "public"."app_profiles" to "authenticated";

grant DELETE on table "public"."app_profiles" to "service_role";

grant INSERT on table "public"."app_profiles" to "service_role";

grant MAINTAIN on table "public"."app_profiles" to "service_role";

grant REFERENCES on table "public"."app_profiles" to "service_role";

grant SELECT on table "public"."app_profiles" to "service_role";

grant TRIGGER on table "public"."app_profiles" to "service_role";

grant TRUNCATE on table "public"."app_profiles" to "service_role";

grant UPDATE on table "public"."app_profiles" to "service_role";

grant DELETE on table "public"."app_store_permissions" to "postgres";

grant INSERT on table "public"."app_store_permissions" to "postgres";

grant MAINTAIN on table "public"."app_store_permissions" to "postgres";

grant REFERENCES on table "public"."app_store_permissions" to "postgres";

grant SELECT on table "public"."app_store_permissions" to "postgres";

grant TRIGGER on table "public"."app_store_permissions" to "postgres";

grant TRUNCATE on table "public"."app_store_permissions" to "postgres";

grant UPDATE on table "public"."app_store_permissions" to "postgres";

grant DELETE on table "public"."app_store_permissions" to "anon";

grant INSERT on table "public"."app_store_permissions" to "anon";

grant MAINTAIN on table "public"."app_store_permissions" to "anon";

grant REFERENCES on table "public"."app_store_permissions" to "anon";

grant SELECT on table "public"."app_store_permissions" to "anon";

grant TRIGGER on table "public"."app_store_permissions" to "anon";

grant TRUNCATE on table "public"."app_store_permissions" to "anon";

grant UPDATE on table "public"."app_store_permissions" to "anon";

grant DELETE on table "public"."app_store_permissions" to "authenticated";

grant INSERT on table "public"."app_store_permissions" to "authenticated";

grant MAINTAIN on table "public"."app_store_permissions" to "authenticated";

grant REFERENCES on table "public"."app_store_permissions" to "authenticated";

grant SELECT on table "public"."app_store_permissions" to "authenticated";

grant TRIGGER on table "public"."app_store_permissions" to "authenticated";

grant TRUNCATE on table "public"."app_store_permissions" to "authenticated";

grant UPDATE on table "public"."app_store_permissions" to "authenticated";

grant DELETE on table "public"."app_store_permissions" to "service_role";

grant INSERT on table "public"."app_store_permissions" to "service_role";

grant MAINTAIN on table "public"."app_store_permissions" to "service_role";

grant REFERENCES on table "public"."app_store_permissions" to "service_role";

grant SELECT on table "public"."app_store_permissions" to "service_role";

grant TRIGGER on table "public"."app_store_permissions" to "service_role";

grant TRUNCATE on table "public"."app_store_permissions" to "service_role";

grant UPDATE on table "public"."app_store_permissions" to "service_role";

grant DELETE on table "public"."assignment_skip_operation_receipts" to "postgres";

grant INSERT on table "public"."assignment_skip_operation_receipts" to "postgres";

grant MAINTAIN on table "public"."assignment_skip_operation_receipts" to "postgres";

grant REFERENCES on table "public"."assignment_skip_operation_receipts" to "postgres";

grant SELECT on table "public"."assignment_skip_operation_receipts" to "postgres";

grant TRIGGER on table "public"."assignment_skip_operation_receipts" to "postgres";

grant TRUNCATE on table "public"."assignment_skip_operation_receipts" to "postgres";

grant UPDATE on table "public"."assignment_skip_operation_receipts" to "postgres";

grant DELETE on table "public"."assignment_skip_operation_receipts" to "service_role";

grant INSERT on table "public"."assignment_skip_operation_receipts" to "service_role";

grant MAINTAIN on table "public"."assignment_skip_operation_receipts" to "service_role";

grant REFERENCES on table "public"."assignment_skip_operation_receipts" to "service_role";

grant SELECT on table "public"."assignment_skip_operation_receipts" to "service_role";

grant TRIGGER on table "public"."assignment_skip_operation_receipts" to "service_role";

grant TRUNCATE on table "public"."assignment_skip_operation_receipts" to "service_role";

grant UPDATE on table "public"."assignment_skip_operation_receipts" to "service_role";

grant DELETE on table "public"."engrase_sync" to "postgres";

grant INSERT on table "public"."engrase_sync" to "postgres";

grant MAINTAIN on table "public"."engrase_sync" to "postgres";

grant REFERENCES on table "public"."engrase_sync" to "postgres";

grant SELECT on table "public"."engrase_sync" to "postgres";

grant TRIGGER on table "public"."engrase_sync" to "postgres";

grant TRUNCATE on table "public"."engrase_sync" to "postgres";

grant UPDATE on table "public"."engrase_sync" to "postgres";

grant DELETE on table "public"."engrase_sync" to "anon";

grant INSERT on table "public"."engrase_sync" to "anon";

grant MAINTAIN on table "public"."engrase_sync" to "anon";

grant REFERENCES on table "public"."engrase_sync" to "anon";

grant SELECT on table "public"."engrase_sync" to "anon";

grant TRIGGER on table "public"."engrase_sync" to "anon";

grant TRUNCATE on table "public"."engrase_sync" to "anon";

grant UPDATE on table "public"."engrase_sync" to "anon";

grant DELETE on table "public"."engrase_sync" to "authenticated";

grant INSERT on table "public"."engrase_sync" to "authenticated";

grant MAINTAIN on table "public"."engrase_sync" to "authenticated";

grant REFERENCES on table "public"."engrase_sync" to "authenticated";

grant SELECT on table "public"."engrase_sync" to "authenticated";

grant TRIGGER on table "public"."engrase_sync" to "authenticated";

grant TRUNCATE on table "public"."engrase_sync" to "authenticated";

grant UPDATE on table "public"."engrase_sync" to "authenticated";

grant DELETE on table "public"."engrase_sync" to "service_role";

grant INSERT on table "public"."engrase_sync" to "service_role";

grant MAINTAIN on table "public"."engrase_sync" to "service_role";

grant REFERENCES on table "public"."engrase_sync" to "service_role";

grant SELECT on table "public"."engrase_sync" to "service_role";

grant TRIGGER on table "public"."engrase_sync" to "service_role";

grant TRUNCATE on table "public"."engrase_sync" to "service_role";

grant UPDATE on table "public"."engrase_sync" to "service_role";

grant DELETE on table "public"."evidence_operation_receipts" to "postgres";

grant INSERT on table "public"."evidence_operation_receipts" to "postgres";

grant MAINTAIN on table "public"."evidence_operation_receipts" to "postgres";

grant REFERENCES on table "public"."evidence_operation_receipts" to "postgres";

grant SELECT on table "public"."evidence_operation_receipts" to "postgres";

grant TRIGGER on table "public"."evidence_operation_receipts" to "postgres";

grant TRUNCATE on table "public"."evidence_operation_receipts" to "postgres";

grant UPDATE on table "public"."evidence_operation_receipts" to "postgres";

grant DELETE on table "public"."evidence_operation_receipts" to "service_role";

grant INSERT on table "public"."evidence_operation_receipts" to "service_role";

grant MAINTAIN on table "public"."evidence_operation_receipts" to "service_role";

grant REFERENCES on table "public"."evidence_operation_receipts" to "service_role";

grant SELECT on table "public"."evidence_operation_receipts" to "service_role";

grant TRIGGER on table "public"."evidence_operation_receipts" to "service_role";

grant TRUNCATE on table "public"."evidence_operation_receipts" to "service_role";

grant UPDATE on table "public"."evidence_operation_receipts" to "service_role";

grant DELETE on table "public"."lubrication_execution_receipts" to "postgres";

grant INSERT on table "public"."lubrication_execution_receipts" to "postgres";

grant MAINTAIN on table "public"."lubrication_execution_receipts" to "postgres";

grant REFERENCES on table "public"."lubrication_execution_receipts" to "postgres";

grant SELECT on table "public"."lubrication_execution_receipts" to "postgres";

grant TRIGGER on table "public"."lubrication_execution_receipts" to "postgres";

grant TRUNCATE on table "public"."lubrication_execution_receipts" to "postgres";

grant UPDATE on table "public"."lubrication_execution_receipts" to "postgres";

grant DELETE on table "public"."lubrication_execution_receipts" to "service_role";

grant INSERT on table "public"."lubrication_execution_receipts" to "service_role";

grant MAINTAIN on table "public"."lubrication_execution_receipts" to "service_role";

grant REFERENCES on table "public"."lubrication_execution_receipts" to "service_role";

grant SELECT on table "public"."lubrication_execution_receipts" to "service_role";

grant TRIGGER on table "public"."lubrication_execution_receipts" to "service_role";

grant TRUNCATE on table "public"."lubrication_execution_receipts" to "service_role";

grant UPDATE on table "public"."lubrication_execution_receipts" to "service_role";

grant DELETE on table "public"."operational_catalog_receipts" to "postgres";

grant INSERT on table "public"."operational_catalog_receipts" to "postgres";

grant MAINTAIN on table "public"."operational_catalog_receipts" to "postgres";

grant REFERENCES on table "public"."operational_catalog_receipts" to "postgres";

grant SELECT on table "public"."operational_catalog_receipts" to "postgres";

grant TRIGGER on table "public"."operational_catalog_receipts" to "postgres";

grant TRUNCATE on table "public"."operational_catalog_receipts" to "postgres";

grant UPDATE on table "public"."operational_catalog_receipts" to "postgres";

grant DELETE on table "public"."operational_catalog_receipts" to "service_role";

grant INSERT on table "public"."operational_catalog_receipts" to "service_role";

grant MAINTAIN on table "public"."operational_catalog_receipts" to "service_role";

grant REFERENCES on table "public"."operational_catalog_receipts" to "service_role";

grant SELECT on table "public"."operational_catalog_receipts" to "service_role";

grant TRIGGER on table "public"."operational_catalog_receipts" to "service_role";

grant TRUNCATE on table "public"."operational_catalog_receipts" to "service_role";

grant UPDATE on table "public"."operational_catalog_receipts" to "service_role";

grant EXECUTE on function "authorization_private"."authorization_row_in_scope"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) to "postgres";

grant EXECUTE on function "authorization_private"."authorization_row_in_scope"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) to "authenticated";

grant EXECUTE on function "authorization_private"."authorization_row_in_scope_baseline_0013"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) to "postgres";

grant EXECUTE on function "authorization_private"."authorization_row_in_scope_baseline_0013"(p_store text, p_id text, p_payload jsonb, p_action text, p_context jsonb) to "authenticated";

grant EXECUTE on function "authorization_private"."authorization_store_action_allowed"(p_store text, p_action text, p_deleted boolean) to "postgres";

grant EXECUTE on function "authorization_private"."authorization_store_action_allowed"(p_store text, p_action text, p_deleted boolean) to "authenticated";

grant EXECUTE on function "authorization_private"."link_support_entity"(p_store text, p_id text, p_assignment text, p_crew text) to "postgres";

grant EXECUTE on function "authorization_private"."support_assignment_valid"(p_id text) to "postgres";

grant EXECUTE on function "authorization_private"."support_grant_rows"() to "postgres";

grant EXECUTE on function "authorization_private"."support_history_allowed"(p_store text, p_id text) to "postgres";

grant EXECUTE on function "authorization_private"."support_occurrence_valid"(p_plan text, p_key text) to "postgres";

grant EXECUTE on function "authorization_private"."support_photos_owned"(p_photos jsonb, p_existing jsonb) to "postgres";

grant EXECUTE on function "authorization_private"."support_row_granted"(p_store text, p_id text, p_context jsonb) to "postgres";

grant EXECUTE on function "public"."assignment_skip_operation"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) to "postgres";

grant EXECUTE on function "public"."assignment_skip_operation"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) to "service_role";

grant EXECUTE on function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) to "postgres";

grant EXECUTE on function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) to "authenticated";

grant EXECUTE on function "public"."authorize_assignment_evidence_upload"(p_assignment_id text, p_record_id text, p_crew_id text) to "service_role";

grant EXECUTE on function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) to "postgres";

grant EXECUTE on function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) to "authenticated";

grant EXECUTE on function "public"."capture_grease_validation"(p_operation_id text, p_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone, p_signer_name text, p_signer_role text, p_note text, p_signature_url text) to "service_role";

grant EXECUTE on function "public"."catalog_writer_role"() to "postgres";

grant EXECUTE on function "public"."catalog_writer_role"() to "authenticated";

grant EXECUTE on function "public"."catalog_writer_role"() to "service_role";

grant EXECUTE on function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) to "postgres";

grant EXECUTE on function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) to "authenticated";

grant EXECUTE on function "public"."close_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_note text) to "service_role";

grant EXECUTE on function "public"."current_app_active"() to PUBLIC;

grant EXECUTE on function "public"."current_app_active"() to "postgres";

grant EXECUTE on function "public"."current_app_active"() to "anon";

grant EXECUTE on function "public"."current_app_active"() to "authenticated";

grant EXECUTE on function "public"."current_app_active"() to "service_role";

grant EXECUTE on function "public"."current_app_role"() to PUBLIC;

grant EXECUTE on function "public"."current_app_role"() to "postgres";

grant EXECUTE on function "public"."current_app_role"() to "anon";

grant EXECUTE on function "public"."current_app_role"() to "authenticated";

grant EXECUTE on function "public"."current_app_role"() to "service_role";

grant EXECUTE on function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) to "postgres";

grant EXECUTE on function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) to "authenticated";

grant EXECUTE on function "public"."edit_anomaly"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb) to "service_role";

grant EXECUTE on function "public"."evidence_operation"(p_operation_id text, p_action text, p_id text, p_equipment_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb, p_note text, p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text, p_expected_signatures jsonb) to "postgres";

grant EXECUTE on function "public"."evidence_operation"(p_operation_id text, p_action text, p_id text, p_equipment_id text, p_crew_id text, p_expected timestamp with time zone, p_component text, p_description text, p_criticality text, p_status text, p_photos jsonb, p_note text, p_record_id text, p_signer_name text, p_signer_role text, p_signature_url text, p_expected_signatures jsonb) to "service_role";

grant EXECUTE on function "public"."get_assignment_support_context"() to "postgres";

grant EXECUTE on function "public"."get_assignment_support_context"() to "authenticated";

grant EXECUTE on function "public"."get_assignment_support_context"() to "service_role";

grant EXECUTE on function "public"."get_authorization_context"() to "postgres";

grant EXECUTE on function "public"."get_authorization_context"() to "authenticated";

grant EXECUTE on function "public"."get_authorization_context"() to "service_role";

grant EXECUTE on function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) to "postgres";

grant EXECUTE on function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) to "authenticated";

grant EXECUTE on function "public"."lubrication_execution"(p_operation_id text, p_action text, p_record_id text, p_equipment_id text, p_plan_id text, p_crew_id text, p_assignment_id text, p_execution_date timestamp with time zone, p_client_captured_at timestamp with time zone, p_shift_id text, p_execution_type text, p_out_of_plan_reason text, p_performed_by text, p_retroactive boolean, p_hourmeter numeric, p_no_hourmeter boolean, p_no_hourmeter_reason text, p_lubricant_id text, p_quantity numeric, p_condition text, p_notes text, p_details jsonb, p_photos jsonb, p_expected_record timestamp with time zone, p_expected_equipment timestamp with time zone, p_expected_plan timestamp with time zone, p_expected_assignment timestamp with time zone) to "service_role";

grant EXECUTE on function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) to "postgres";

grant EXECUTE on function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) to "authenticated";

grant EXECUTE on function "public"."manage_lubrication_assignment"(p_operation_id text, p_action text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_notes text) to "service_role";

grant EXECUTE on function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) to "postgres";

grant EXECUTE on function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) to "authenticated";

grant EXECUTE on function "public"."move_equipment_master_location"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_location_id text) to "service_role";

grant EXECUTE on function "public"."operational_catalog_operation"(p_operation_id text, p_action text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_location_id text, p_shift_id text, p_until date, p_reason text, p_hourmeter numeric, p_confirm_large_jump boolean) to "postgres";

grant EXECUTE on function "public"."operational_catalog_operation"(p_operation_id text, p_action text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_location_id text, p_shift_id text, p_until date, p_reason text, p_hourmeter numeric, p_confirm_large_jump boolean) to "service_role";

grant EXECUTE on function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) to "postgres";

grant EXECUTE on function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) to "authenticated";

grant EXECUTE on function "public"."record_lubrication_skip"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_equipment_id text, p_plan_id text, p_occurrence_key text, p_crew_id text, p_date timestamp with time zone, p_shift_id text, p_reason text, p_observacion text, p_linked_record_id text) to "service_role";

grant EXECUTE on function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) to "postgres";

grant EXECUTE on function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) to "authenticated";

grant EXECUTE on function "public"."repeat_anomaly_from_execution"(p_operation_id text, p_record_id text, p_crew_id text, p_expected timestamp with time zone) to "service_role";

grant EXECUTE on function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) to "postgres";

grant EXECUTE on function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) to "authenticated";

grant EXECUTE on function "public"."report_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb) to "service_role";

grant EXECUTE on function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) to "postgres";

grant EXECUTE on function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) to "authenticated";

grant EXECUTE on function "public"."report_assignment_anomaly"(p_operation_id text, p_id text, p_equipment_id text, p_crew_id text, p_component text, p_description text, p_criticality text, p_photos jsonb, p_assignment_id text) to "service_role";

grant EXECUTE on function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) to "postgres";

grant EXECUTE on function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) to "authenticated";

grant EXECUTE on function "public"."reprogram_lubrication_plan"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) to "service_role";

grant EXECUTE on function "public"."resolve_authorization_scope"(p_auth_user_id uuid) to "postgres";

grant EXECUTE on function "public"."resolve_authorization_scope"(p_auth_user_id uuid) to "service_role";

grant EXECUTE on function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) to "postgres";

grant EXECUTE on function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) to "authenticated";

grant EXECUTE on function "public"."resolve_grease_validation_conflict"(p_operation_id text, p_record_id text, p_id text, p_note text, p_expected_signatures jsonb) to "service_role";

grant EXECUTE on function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) to "postgres";

grant EXECUTE on function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) to "authenticated";

grant EXECUTE on function "public"."retire_anomaly"(p_operation_id text, p_id text, p_expected timestamp with time zone) to "service_role";

grant EXECUTE on function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) to "postgres";

grant EXECUTE on function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) to "authenticated";

grant EXECUTE on function "public"."set_equipment_alert_pause"(p_operation_id text, p_id text, p_crew_id text, p_expected timestamp with time zone, p_until date, p_reason text) to "service_role";

grant EXECUTE on function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) to "postgres";

grant EXECUTE on function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) to "authenticated";

grant EXECUTE on function "public"."set_equipment_shift"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_shift_id text) to "service_role";

grant EXECUTE on function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) to "postgres";

grant EXECUTE on function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) to "authenticated";

grant EXECUTE on function "public"."update_equipment_hourmeter"(p_operation_id text, p_id text, p_expected timestamp with time zone, p_hourmeter numeric, p_confirm_large_jump boolean) to "service_role";

commit;
