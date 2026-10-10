-- PREPARADA. NO APLICADA. Requiere autorización posterior y revisión del
-- preflight. No modifica 0003/0005/0007, Auth, equipos ni registros históricos.
-- El transporte real sigue siendo engrase_sync (CAS de sync.js). Esta tabla
-- es una proyección con constraints: ninguna escritura del store puede
-- evitar sus restricciones. No hay un segundo canal de sincronización.
begin;

create table if not exists public.crew_locations (
  id text primary key,
  crew_id text not null,
  location_id text not null,
  role text not null check (role in ('PRINCIPAL', 'APOYO')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (crew_id, location_id)
);
create unique index if not exists crew_locations_one_principal
  on public.crew_locations (location_id) where active and role = 'PRINCIPAL';
create index if not exists crew_locations_crew_active
  on public.crew_locations (crew_id, active);
alter table public.crew_locations enable row level security;
grant select on public.crew_locations to authenticated;
revoke insert, update, delete on public.crew_locations from anon, authenticated;

-- Lectura autenticada equivalente al catálogo operativo existente. El
-- alcance de ejecución procede de memberships sincronizados en cuadrillas,
-- igual que hoy; NO se afirma aislamiento de filas por membership en RLS.
drop policy if exists crew_locations_read on public.crew_locations;
create policy crew_locations_read on public.crew_locations for select
  to authenticated using (public.current_app_active() and exists (
    select 1 from public.app_store_permissions p
    where p.store = 'crew_locations' and p.role = public.current_app_role() and p.can_read
  ));
-- Sin policies INSERT/UPDATE/DELETE directas: solo transporte CAS genérico.

create or replace function public.project_crew_location()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare p jsonb;
begin
  -- Soft removal of a crew also releases its principal locations. This
  -- covers old clients without the new editor and never deletes history.
  if new.store = 'cuadrillas' and (new.deleted or not coalesce((new.payload->>'active')::boolean, true)) then
    update public.engrase_sync set payload = payload || jsonb_build_object('active', false,
      'updated_at', now(), 'updatedAt', now()), deleted = true, updated_at = now()
    where store = 'crew_locations' and payload->>'crew_id' = new.id and not deleted;
    return new;
  end if;
  if new.store <> 'crew_locations' then return new; end if;
  p := new.payload;
  if not new.deleted and coalesce((p->>'active')::boolean, true) and not exists (
    select 1 from public.engrase_sync c where c.store = 'cuadrillas'
    and c.id = p->>'crew_id' and not c.deleted and coalesce((c.payload->>'active')::boolean, true)) then
    raise exception 'Cuadrilla de cobertura no existe o está inactiva';
  end if;
  if not new.deleted and coalesce((p->>'active')::boolean, true) and not exists (select 1 from public.engrase_sync l where l.store = 'locations'
    and l.id = p->>'location_id' and not l.deleted) then
    raise exception 'Ubicación de cobertura no existe o está inactiva';
  end if;
  if p->>'id' is distinct from new.id then raise exception 'Id de cobertura inconsistente'; end if;
  -- old legacy owners without any relation still own their normal work.
  if not new.deleted and coalesce((p->>'active')::boolean, true) and p->>'role' = 'PRINCIPAL'
    and exists (select 1 from public.engrase_sync c where c.store = 'cuadrillas'
      and not c.deleted and coalesce((c.payload->>'active')::boolean, true)
      and c.id <> p->>'crew_id' and c.payload->>'locationId' = p->>'location_id'
      and coalesce((c.payload->>'isDefault')::boolean, false)
      and not exists (select 1 from public.engrase_sync r where r.store = 'crew_locations' and r.payload->>'crew_id' = c.id))
    then raise exception 'Otra cuadrilla principal legacy requiere cobertura explícita'; end if;
  insert into public.crew_locations (id, crew_id, location_id, role, active, created_at, updated_at)
  values (new.id, p->>'crew_id', p->>'location_id', p->>'role',
    not new.deleted and coalesce((p->>'active')::boolean, true),
    coalesce((p->>'created_at')::timestamptz, new.updated_at), new.updated_at)
  on conflict (id) do update set crew_id = excluded.crew_id, location_id = excluded.location_id,
    role = excluded.role, active = excluded.active, updated_at = excluded.updated_at;
  return new;
end $$;
revoke all on function public.project_crew_location() from public;
drop trigger if exists project_crew_location on public.engrase_sync;
create trigger project_crew_location after insert or update on public.engrase_sync
  for each row execute function public.project_crew_location();

-- PRE-FLIGHT BLOQUEANTE: el pedido exige convertir cada locationId legacy
-- en PRINCIPAL. Si hay auxiliares en la misma ubicación, esa conversión
-- necesita una decisión humana antes de aplicar; no se escoge ni degrada
-- ninguna cuadrilla automáticamente. La transacción completa revierte.
do $$ begin
  if exists (
    select payload->>'locationId' from public.engrase_sync c
    where c.store = 'cuadrillas' and not c.deleted
      and coalesce((c.payload->>'active')::boolean, true)
      and nullif(c.payload->>'locationId', '') is not null
      and not exists (select 1 from public.engrase_sync r where r.store = 'crew_locations' and r.payload->>'crew_id' = c.id)
    group by payload->>'locationId' having count(*) > 1
  ) then raise exception 'Preflight: varias cuadrillas legacy comparten ubicación; resolver cobertura antes de migrar'; end if;
end $$;

-- Importa relaciones ya existentes al activar por primera vez la proyección.
insert into public.crew_locations (id, crew_id, location_id, role, active, created_at, updated_at)
select id, payload->>'crew_id', payload->>'location_id', payload->>'role',
  not deleted and coalesce((payload->>'active')::boolean, true),
  coalesce((payload->>'created_at')::timestamptz, updated_at), updated_at
from public.engrase_sync where store = 'crew_locations'
on conflict (id) do nothing;

-- Seed no destructivo: conserva cuadrillas.locationId y memberships.
insert into public.engrase_sync (store, id, payload, updated_at, deleted)
select 'crew_locations', 'cl:' || c.id || ':' || (c.payload->>'locationId'),
  jsonb_build_object('id', 'cl:' || c.id || ':' || (c.payload->>'locationId'),
    'crew_id', c.id, 'location_id', c.payload->>'locationId', 'role', 'PRINCIPAL',
    'active', true, 'created_at', now(), 'updated_at', now(), 'updatedAt', now()), now(), false
from public.engrase_sync c
where c.store = 'cuadrillas' and not c.deleted and coalesce((c.payload->>'active')::boolean, true)
  and nullif(c.payload->>'locationId', '') is not null
  and not exists (select 1 from public.engrase_sync r where r.store = 'crew_locations' and r.payload->>'crew_id' = c.id)
on conflict (store, id) do nothing;

insert into public.app_store_permissions (store, role, can_read, can_insert, can_update, can_delete) values
  ('crew_locations', 'ADMINISTRADOR', true, true, true, true),
  ('crew_locations', 'PLANIFICADOR', true, true, true, true),
  ('crew_locations', 'SUPERVISOR', true, false, false, false),
  ('crew_locations', 'LUBRICADOR', true, false, false, false),
  ('crew_locations', 'VISOR', true, false, false, false)
on conflict (store, role) do update set can_read = excluded.can_read,
  can_insert = excluded.can_insert, can_update = excluded.can_update, can_delete = excluded.can_delete;
commit;
