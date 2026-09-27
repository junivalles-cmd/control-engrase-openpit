-- PRE-CUTOVER:
-- legacy policy remains intentionally active.
-- security is NOT enforced until controlled cutover.
--
-- P0-2 — fase segura previa al cutover, lista para producción cuando el
-- usuario decida ejecutarla (Claude NO la ejecutó — ver
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §15 para los gates que deben
-- pasar ANTES del cutover real, que es un archivo/paso SEPARADO, no
-- incluido aquí). Reemplaza a 0001_auth_profiles_rls_DRAFT.sql como la
-- versión a aplicar de verdad: mismo contenido de la fase 1/2 de aquel
-- borrador, sin la sección CUTOVER (ni siquiera comentada) — este
-- archivo, tal como está, NUNCA retira ni modifica la policy legacy
-- "acceso interno con anon key" de schema.sql. Aplicarlo entero es
-- seguro para producción: no cambia qué puede hacer hoy un dispositivo
-- con la anon key, solo agrega infraestructura nueva en paralelo.
--
-- Qué SÍ hace este archivo:
--   1) crea app_profiles (identidad -> rol/estado, sin PIN/password)
--   2) crea current_app_role()/current_app_active() (funciones auxiliares)
--   3) crea app_store_permissions con la matriz completa de 15 stores x 5 roles
--   4) crea 3 policies nuevas sobre engrase_sync (select/insert/update)
-- Ninguna de las 4 cosas anteriores tiene efecto real mientras la policy
-- legacy siga activa (Postgres combina policies permisivas por OR — ver
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §1). Sirve para probar de punta a
-- punta (Etapa C del rollout) antes de que el cutover las convierta en
-- la autoridad real.
--
-- No contiene secretos (URLs/keys/passwords) — nada de lo de abajo es
-- sensible por sí mismo. No inserta ninguna de las 7 cuentas legacy
-- productivas en app_profiles (ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md
-- §2/§16/§17) — esta tabla arranca vacía; las filas reales (empezando
-- por Junior Valles) se crean en un paso manual posterior, documentado
-- en docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §21, NUNCA en este archivo.

-- ------------------------------------------------------------
-- 1) app_profiles — identidad (auth.uid()) -> rol/estado de la app
-- ------------------------------------------------------------
-- NO guarda PIN ni password (eso vive en auth.users, gestionado por
-- Supabase Auth). NO guarda cuadrillaId/locationId: esa info ya vive en
-- el payload jsonb del store "users" (engrase_sync) — ver
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §5.

create table if not exists app_profiles (
  auth_user_id  uuid primary key references auth.users(id) on delete cascade,
  app_user_id   text not null unique,             -- id nuevo por persona real, NUNCA uno de los 7 legacy
  display_name  text not null,
  role          text not null check (role in (
                  'ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR', 'VISOR'
                )),
  active        boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists app_profiles_role_idx on app_profiles (role);

alter table app_profiles enable row level security;

-- Cualquier usuario authenticated puede leer SU PROPIO perfil (necesario
-- para que el cliente sepa su rol/estado real al reconectar).
drop policy if exists "app_profiles: leer el propio perfil" on app_profiles;
create policy "app_profiles: leer el propio perfil"
  on app_profiles for select
  using (auth.uid() = auth_user_id);

-- Solo un ADMINISTRADOR activo puede leer perfiles de OTROS.
drop policy if exists "app_profiles: admin lee todos" on app_profiles;
create policy "app_profiles: admin lee todos"
  on app_profiles for select
  using (
    exists (
      select 1 from app_profiles me
      where me.auth_user_id = auth.uid() and me.role = 'ADMINISTRADOR' and me.active
    )
  );

-- INSERT: solo un ADMINISTRADOR activo puede crear un perfil (alta de
-- personas reales, mecanismo server-side futuro — ver §11 del plan).
drop policy if exists "app_profiles: admin crea perfiles" on app_profiles;
create policy "app_profiles: admin crea perfiles"
  on app_profiles for insert
  with check (
    exists (
      select 1 from app_profiles me
      where me.auth_user_id = auth.uid() and me.role = 'ADMINISTRADOR' and me.active
    )
  );

-- UPDATE: NADIE (ni un admin) puede modificar su PROPIA fila — evita
-- auto-ascenso y auto-sabotaje. Un ADMINISTRADOR activo sí puede
-- modificar la fila de OTRO usuario. Nadie más puede modificar ninguna
-- fila, ni la propia.
drop policy if exists "app_profiles: admin edita otros" on app_profiles;
create policy "app_profiles: admin edita otros"
  on app_profiles for update
  using (
    auth.uid() <> auth_user_id
    and exists (
      select 1 from app_profiles me
      where me.auth_user_id = auth.uid() and me.role = 'ADMINISTRADOR' and me.active
    )
  )
  with check (
    auth.uid() <> auth_user_id
  );

-- Sin policy de DELETE a propósito: RLS deniega DELETE para TODOS por
-- defecto — perfiles se desactivan (active=false vía UPDATE), nunca se
-- borran físicamente.

-- ------------------------------------------------------------
-- 2) Funciones auxiliares — current_app_role() / current_app_active()
-- ------------------------------------------------------------
-- SECURITY DEFINER con search_path fijo (mitigación estándar contra
-- search_path hijacking). STABLE: mismo resultado dentro de la misma
-- transacción/statement.

create or replace function current_app_role()
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

create or replace function current_app_active()
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

-- ------------------------------------------------------------
-- 3) app_store_permissions — matriz de 15 stores x 5 roles, como DATOS
-- ------------------------------------------------------------
-- can_read/can_insert/can_update/can_delete — ver
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §7 para la evidencia de código
-- detrás de cada fila (incluye las marcadas de confianza media).

create table if not exists app_store_permissions (
  store       text not null,
  role        text not null check (role in (
                'ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR', 'LUBRICADOR', 'VISOR'
              )),
  can_read    boolean not null default false,
  can_insert  boolean not null default false,
  can_update  boolean not null default false,
  can_delete  boolean not null default false,
  primary key (store, role)
);

insert into app_store_permissions (store, role, can_read, can_insert, can_update, can_delete) values
  ('users', 'ADMINISTRADOR',  true,  true,  true,  true),
  ('users', 'PLANIFICADOR',   true,  false, false, false),
  ('users', 'SUPERVISOR',     true,  true,  true,  false),
  ('users', 'LUBRICADOR',     true,  false, false, false),
  ('users', 'VISOR',          true,  false, false, false),
  ('shifts', 'ADMINISTRADOR', true,  true,  true,  true),
  ('shifts', 'PLANIFICADOR',  true,  false, false, false),
  ('shifts', 'SUPERVISOR',    true,  false, false, false),
  ('shifts', 'LUBRICADOR',    true,  false, false, false),
  ('shifts', 'VISOR',         true,  false, false, false),
  ('locations', 'ADMINISTRADOR', true, true, true, true),
  ('locations', 'PLANIFICADOR',  true, false, false, false),
  ('locations', 'SUPERVISOR',    true, false, false, false),
  ('locations', 'LUBRICADOR',    true, false, false, false),
  ('locations', 'VISOR',         true, false, false, false),
  ('equipment_types', 'ADMINISTRADOR', true, true, true, true),
  ('equipment_types', 'PLANIFICADOR',  true, false, false, false),
  ('equipment_types', 'SUPERVISOR',    true, false, false, false),
  ('equipment_types', 'LUBRICADOR',    true, false, false, false),
  ('equipment_types', 'VISOR',         true, false, false, false),
  ('equipment', 'ADMINISTRADOR', true, true, true, true),
  ('equipment', 'PLANIFICADOR',  true, false, false, false),
  ('equipment', 'SUPERVISOR',    true, false, false, false),
  ('equipment', 'LUBRICADOR',    false, false, false, false),
  ('equipment', 'VISOR',         false, false, false, false),
  ('lubricants', 'ADMINISTRADOR', true, true, true, true),
  ('lubricants', 'PLANIFICADOR',  true, false, false, false),
  ('lubricants', 'SUPERVISOR',    true, false, false, false),
  ('lubricants', 'LUBRICADOR',    true, false, false, false),
  ('lubricants', 'VISOR',         true, false, false, false),
  ('lubrication_plans', 'ADMINISTRADOR', true, true, true, true),
  ('lubrication_plans', 'PLANIFICADOR',  true, false, false, false),
  ('lubrication_plans', 'SUPERVISOR',    true, false, false, false),
  ('lubrication_plans', 'LUBRICADOR',    true, false, true, false),
  ('lubrication_plans', 'VISOR',         false, false, false, false),
  ('lubrication_points', 'ADMINISTRADOR', true, true, true, true),
  ('lubrication_points', 'PLANIFICADOR',  true, false, false, false),
  ('lubrication_points', 'SUPERVISOR',    true, false, false, false),
  ('lubrication_points', 'LUBRICADOR',    true, false, false, false),
  ('lubrication_points', 'VISOR',         false, false, false, false),
  ('lubrication_records', 'ADMINISTRADOR', true, true, true, true),
  ('lubrication_records', 'PLANIFICADOR',  true, true, true, false),
  ('lubrication_records', 'SUPERVISOR',    true, true, true, false),
  ('lubrication_records', 'LUBRICADOR',    true, true, true, false),
  ('lubrication_records', 'VISOR',         true, false, false, false),
  ('anomalies', 'ADMINISTRADOR', true, true, true, true),
  ('anomalies', 'PLANIFICADOR',  false, false, false, false),
  ('anomalies', 'SUPERVISOR',    true, true, true, false),
  ('anomalies', 'LUBRICADOR',    true, true, false, false),
  ('anomalies', 'VISOR',         false, false, false, false),
  ('audit_log', 'ADMINISTRADOR', true, true, false, false),
  ('audit_log', 'PLANIFICADOR',  false, true, false, false),
  ('audit_log', 'SUPERVISOR',    false, true, false, false),
  ('audit_log', 'LUBRICADOR',    false, true, false, false),
  ('audit_log', 'VISOR',         false, false, false, false),
  ('settings', 'ADMINISTRADOR', true, true, true, true),
  ('settings', 'PLANIFICADOR',  false, false, false, false),
  ('settings', 'SUPERVISOR',    false, false, false, false),
  ('settings', 'LUBRICADOR',    false, false, false, false),
  ('settings', 'VISOR',         false, false, false, false),
  ('cuadrillas', 'ADMINISTRADOR', true, true, true, true),
  ('cuadrillas', 'PLANIFICADOR',  true, false, false, false),
  ('cuadrillas', 'SUPERVISOR',    true, false, false, false),
  ('cuadrillas', 'LUBRICADOR',    true, false, false, false),
  ('cuadrillas', 'VISOR',         false, false, false, false),
  ('push_tokens', 'ADMINISTRADOR', true, true, true, false),
  ('push_tokens', 'PLANIFICADOR',  true, true, true, false),
  ('push_tokens', 'SUPERVISOR',    true, true, true, false),
  ('push_tokens', 'LUBRICADOR',    true, true, true, false),
  ('push_tokens', 'VISOR',         false, true, true, false),
  ('grease_validations', 'ADMINISTRADOR', true, true, true, true),
  ('grease_validations', 'PLANIFICADOR',  true, false, false, false),
  ('grease_validations', 'SUPERVISOR',    true, true, true, false),
  ('grease_validations', 'LUBRICADOR',    true, true, true, false),
  ('grease_validations', 'VISOR',         true, false, false, false)
on conflict (store, role) do update set
  can_read = excluded.can_read, can_insert = excluded.can_insert,
  can_update = excluded.can_update, can_delete = excluded.can_delete;

alter table app_store_permissions enable row level security;

drop policy if exists "app_store_permissions: lectura autenticada" on app_store_permissions;
create policy "app_store_permissions: lectura autenticada"
  on app_store_permissions for select
  using (current_app_active());

-- ------------------------------------------------------------
-- 4) Policies NUEVAS sobre engrase_sync — preparadas, NO activas todavía
-- ------------------------------------------------------------
-- PRE-CUTOVER: mientras "acceso interno con anon key" (schema.sql) siga
-- existiendo, estas 3 policies son inertes en términos de seguridad
-- efectiva — Postgres combina policies permisivas por OR, y esa policy
-- legacy acepta cualquier cosa (using(true)/with check(true)). Se crean
-- ahora para poder probarlas de punta a punta ANTES del corte real. Este
-- archivo, tal como está, NO retira esa policy — eso es un paso
-- controlado y SEPARADO (cutover), no incluido aquí.

drop policy if exists "engrase_sync: leer según matriz" on engrase_sync;
create policy "engrase_sync: leer según matriz"
  on engrase_sync for select
  using (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and p.can_read
    )
  );

drop policy if exists "engrase_sync: crear según matriz" on engrase_sync;
create policy "engrase_sync: crear según matriz"
  on engrase_sync for insert
  with check (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and p.can_insert
    )
  );

drop policy if exists "engrase_sync: actualizar según matriz" on engrase_sync;
create policy "engrase_sync: actualizar según matriz"
  on engrase_sync for update
  using (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and (p.can_update or p.can_delete)
    )
  )
  with check (
    current_app_active()
    and exists (
      select 1 from app_store_permissions p
      where p.store = engrase_sync.store
        and p.role = current_app_role()
        and (
          (engrase_sync.deleted and p.can_delete)
          or (not engrase_sync.deleted and p.can_update)
        )
    )
  );

-- Sin policy de DELETE sobre engrase_sync a propósito — el CAS de P0-1
-- (sync.js) nunca emite un DELETE real, solo UPDATE con deleted=true.

-- ============================================================
-- FIN de la fase pre-cutover. El cutover (retirar la policy legacy) es
-- un paso SEPARADO, controlado, con sus propios gates — ver
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §15. NO está en este archivo.
-- ============================================================
