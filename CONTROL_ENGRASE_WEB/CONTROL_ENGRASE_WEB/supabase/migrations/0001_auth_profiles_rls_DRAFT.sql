-- DRAFT — DO NOT APPLY TO PRODUCTION YET
--
-- P0-2 — Auth real + app_profiles + RLS por store/rol.
-- Ver docs/AUTH_RLS_MIGRATION_DESIGN.md (auditoría/diseño aprobado) y
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md (este archivo es su contraparte SQL).
--
-- Este archivo NO se ejecutó contra ningún Supabase, ni de prueba ni
-- productivo. Es un borrador para revisión humana antes de aplicar nada.
-- No contiene secretos (URLs/keys/passwords) — nada de lo de abajo es
-- sensible por sí mismo.
--
-- ============================================================
-- ESTADO 1/2: MIGRACIÓN (este archivo, tal como está)
-- ============================================================
-- Todo lo de abajo hasta la sección "CUTOVER" se puede aplicar en paralelo
-- SIN afectar al cliente actual, PORQUE la policy legacy de schema.sql
-- ("acceso interno con anon key", using(true) with check(true)) sigue
-- activa. Postgres combina policies permisivas del mismo comando por OR:
-- mientras esa policy exista, CUALQUIER policy nueva más restrictiva que
-- se agregue aquí NO reduce el acceso real en absoluto (true OR
-- lo-que-sea siempre da true). Es decir: aplicar esta sección sola NO es
-- "RLS seguro en paralelo" — es solo preparar la infraestructura (tabla,
-- funciones, policies nuevas) para el día del CUTOVER, sin riesgo de
-- romper nada porque todavía no son la autoridad real.
--
-- La autoridad real solo empieza a existir cuando la sección "CUTOVER" se
-- ejecuta (retira la policy legacy). Hasta entonces, este archivo es
-- inerte en términos de seguridad efectiva.

-- ------------------------------------------------------------
-- 1) app_profiles — identidad (auth.uid()) -> rol/estado de la app
-- ------------------------------------------------------------
-- NO guarda PIN ni password (eso vive en auth.users, gestionado por
-- Supabase Auth). NO guarda cuadrillaId/locationId: esa info ya vive en el
-- payload jsonb del store "users" (engrase_sync) y no la necesita ninguna
-- policy de este archivo — ver docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §5
-- para la justificación de por qué NO se agregan columnas de más.
--
-- IMPORTANTE (auditoría productiva de solo-lectura ya realizada, ver
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §2/§16/§17): los 7 usuarios reales
-- que existen hoy en el store "users" de engrase_sync NO son personas
-- reales identificables — 3 son seeds/de prueba, 4 son cuentas genéricas
-- compartidas (una por vehículo/equipo, una nombrada igual que su rol,
-- una de bootstrap del sistema). Por regla de identidad (AUTH USER =
-- persona real, §16), NINGUNA de esas 7 filas se inserta en esta tabla.
-- Este archivo NO trae ningún INSERT into app_profiles a propósito — las
-- filas reales se crean recién cuando el usuario entregue la lista de
-- personas reales (plantilla: docs/AUTH_USERS_ROLLOUT_TEMPLATE.md),
-- usando NUEVOS app_user_id (no reciclando u_admin/u_lub1/u_plan/u_sup/
-- ni las cuentas "Camioneta Lubrica"/"Camion Lubrico"/"Planificador").

create table if not exists app_profiles (
  auth_user_id  uuid primary key references auth.users(id) on delete cascade,
  app_user_id   text not null unique,             -- coincide con users.id actual (ej. 'u_admin')
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

-- Cualquier usuario autenticado puede leer SU PROPIO perfil (necesario
-- para que el cliente sepa su rol/estado real al reconectar — ver §12 del
-- plan de implementación). Nadie lee el perfil de otro por esta vía.
drop policy if exists "app_profiles: leer el propio perfil" on app_profiles;
create policy "app_profiles: leer el propio perfil"
  on app_profiles for select
  using (auth.uid() = auth_user_id);

-- Solo un ADMINISTRADOR activo puede leer perfiles de OTROS (pantalla de
-- Usuarios). No se combina con la policy anterior — Postgres evalúa todas
-- las policies del mismo comando por OR, así que un admin sigue pudiendo
-- leer también su propio perfil por la policy de arriba.
drop policy if exists "app_profiles: admin lee todos" on app_profiles;
create policy "app_profiles: admin lee todos"
  on app_profiles for select
  using (
    exists (
      select 1 from app_profiles me
      where me.auth_user_id = auth.uid() and me.role = 'ADMINISTRADOR' and me.active
    )
  );

-- INSERT: reservado para el flujo de alta de usuarios (Etapa B/D del
-- rollout) — por ahora, solo un ADMINISTRADOR activo puede crear un
-- perfil, y NUNCA para sí mismo con with check adicional (ver más abajo,
-- "nadie puede tocar su propio role/active").
drop policy if exists "app_profiles: admin crea perfiles" on app_profiles;
create policy "app_profiles: admin crea perfiles"
  on app_profiles for insert
  with check (
    exists (
      select 1 from app_profiles me
      where me.auth_user_id = auth.uid() and me.role = 'ADMINISTRADOR' and me.active
    )
  );

-- UPDATE: la regla central de la Sección 8 del pedido —
--   - NADIE (ni un admin) puede modificar su PROPIA fila en role/active.
--     Evita auto-sabotaje (desactivarse a sí mismo sin salida) y
--     auto-ascenso trivial si algún día se relaja la policy de INSERT.
--   - Un ADMINISTRADOR activo puede modificar la fila de OTRO usuario.
--   - Nadie que no sea ADMINISTRADOR puede modificar ninguna fila (ni la
--     propia: display_name, etc. tampoco — se edita vía admin por ahora;
--     se puede relajar más adelante para que cada uno edite su propio
--     display_name, pero NO role/active, si se decide útil).
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

-- Sin policy de DELETE a propósito: sin ninguna policy que lo permita,
-- RLS deniega DELETE para TODOS (incluido admin) por defecto — no se
-- borran perfiles físicamente, solo se desactivan (active=false vía
-- UPDATE). Coincide con el patrón de soft-delete que ya usa toda la app.

-- ------------------------------------------------------------
-- 2) Funciones auxiliares — current_app_role() / current_app_active()
-- ------------------------------------------------------------
-- SECURITY DEFINER (no INVOKER): así las policies de engrase_sync pueden
-- llamarlas sin depender de que el usuario que llama tenga, además, una
-- policy de SELECT que le alcance para leer su propia fila de
-- app_profiles en ESE contexto (evita acoplar la seguridad de una tabla a
-- las policies de otra). search_path fijo a 'public' — mitigación
-- estándar contra search_path hijacking en funciones SECURITY DEFINER
-- (una función sin este SET podría resolver "app_profiles" contra un
-- schema distinto si alguien lo antepone al search_path de la sesión).
-- STABLE (no VOLATILE): el resultado no cambia dentro de la misma
-- transacción/statement — permite que el planner las evalúe una sola vez.

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
-- 3) app_store_permissions — la matriz de la Sección 7, como DATOS
-- ------------------------------------------------------------
-- En vez de escribir una policy gigante con un CASE por cada uno de los
-- 15 stores x 5 roles (75 combinaciones), la matriz vive como filas en
-- esta tabla y la policy de engrase_sync hace un EXISTS contra ella. Dos
-- ventajas: (1) la matriz completa queda visible y auditable como datos,
-- no escondida en lógica SQL; (2) ajustar un permiso más adelante es un
-- UPDATE de una fila, no una migración de policy nueva.
--
-- can_read     -> puede hacer SELECT de filas de ese store
-- can_insert   -> puede crear una fila NUEVA en ese store
-- can_update   -> puede modificar una fila existente SIN marcarla deleted
-- can_delete   -> puede modificar una fila existente marcándola deleted=true
--                 (soft-delete — nunca hay DELETE real, ver nota en §1)
--
-- Ningún store/rol de la matriz auditada (ver
-- docs/AUTH_RLS_MIGRATION_DESIGN.md §7 y
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §7) necesita HOY que can_update y
-- can_delete difieran para el mismo store/rol — se dejan como columnas
-- separadas de una vez porque partirlas después (sin romper policies ya
-- aplicadas) es más caro que declararlas ahora, aunque hoy siempre viajen
-- iguales en la siembra de abajo.

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

-- Matriz completa — 15 STORES reales (db.js STORES, sin app_config ni
-- grease_drafts: esos son LOCAL_STORES, nunca llegan a engrase_sync) x 5
-- ROLES reales (PERMISSIONS de app.js). Derivada de PERMISSIONS/canEdit/
-- canRegister — ver la auditoría línea por línea en
-- docs/AUTH_RLS_IMPLEMENTATION_PLAN.md §7 (incluye qué evidencia de código
-- respalda cada fila y cuáles quedan marcadas de confianza media).

insert into app_store_permissions (store, role, can_read, can_insert, can_update, can_delete) values
  -- users
  ('users', 'ADMINISTRADOR',  true,  true,  true,  true),
  ('users', 'PLANIFICADOR',   true,  false, false, false),
  ('users', 'SUPERVISOR',     true,  true,  true,  false), -- solo LUBRICADOR de su cuadrilla: no expresable por store solo, ver nota
  ('users', 'LUBRICADOR',     true,  false, false, false),
  ('users', 'VISOR',          true,  false, false, false),
  -- shifts
  ('shifts', 'ADMINISTRADOR', true,  true,  true,  true),
  ('shifts', 'PLANIFICADOR',  true,  false, false, false),
  ('shifts', 'SUPERVISOR',    true,  false, false, false),
  ('shifts', 'LUBRICADOR',    true,  false, false, false),
  ('shifts', 'VISOR',         true,  false, false, false),
  -- locations
  ('locations', 'ADMINISTRADOR', true, true, true, true),
  ('locations', 'PLANIFICADOR',  true, false, false, false),
  ('locations', 'SUPERVISOR',    true, false, false, false),
  ('locations', 'LUBRICADOR',    true, false, false, false),
  ('locations', 'VISOR',         true, false, false, false),
  -- equipment_types
  ('equipment_types', 'ADMINISTRADOR', true, true, true, true),
  ('equipment_types', 'PLANIFICADOR',  true, false, false, false),
  ('equipment_types', 'SUPERVISOR',    true, false, false, false),
  ('equipment_types', 'LUBRICADOR',    true, false, false, false),
  ('equipment_types', 'VISOR',         true, false, false, false),
  -- equipment
  ('equipment', 'ADMINISTRADOR', true, true, true, true),
  ('equipment', 'PLANIFICADOR',  true, false, false, false),
  ('equipment', 'SUPERVISOR',    true, false, false, false),
  ('equipment', 'LUBRICADOR',    false, false, false, false), -- ver nota: hoy LUBRICADOR no tiene ruta "equipos"
  ('equipment', 'VISOR',         false, false, false, false), -- 'equipos' no está en PERMISSIONS.VISOR
  -- lubricants
  ('lubricants', 'ADMINISTRADOR', true, true, true, true),
  ('lubricants', 'PLANIFICADOR',  true, false, false, false),
  ('lubricants', 'SUPERVISOR',    true, false, false, false),
  ('lubricants', 'LUBRICADOR',    true, false, false, false),
  ('lubricants', 'VISOR',         true, false, false, false),
  -- lubrication_plans (confianza media: LUBRICADOR solo actualiza lastGreaseHour como efecto lateral, ver nota)
  ('lubrication_plans', 'ADMINISTRADOR', true, true, true, true),
  ('lubrication_plans', 'PLANIFICADOR',  true, false, false, false),
  ('lubrication_plans', 'SUPERVISOR',    true, false, false, false),
  ('lubrication_plans', 'LUBRICADOR',    true, false, true, false), -- solo update (lastGreaseHour), nunca insert/delete
  ('lubrication_plans', 'VISOR',         false, false, false, false),
  -- lubrication_points
  ('lubrication_points', 'ADMINISTRADOR', true, true, true, true),
  ('lubrication_points', 'PLANIFICADOR',  true, false, false, false),
  ('lubrication_points', 'SUPERVISOR',    true, false, false, false),
  ('lubrication_points', 'LUBRICADOR',    true, false, false, false),
  ('lubrication_points', 'VISOR',         false, false, false, false),
  -- lubrication_records (operación principal de LUBRICADOR)
  ('lubrication_records', 'ADMINISTRADOR', true, true, true, true),
  ('lubrication_records', 'PLANIFICADOR',  true, true, true, false),
  ('lubrication_records', 'SUPERVISOR',    true, true, true, false),
  ('lubrication_records', 'LUBRICADOR',    true, true, true, false),
  ('lubrication_records', 'VISOR',         true, false, false, false),
  -- anomalies (PLANIFICADOR no tiene esta ruta en PERMISSIONS -> sin acceso)
  ('anomalies', 'ADMINISTRADOR', true, true, true, true),
  ('anomalies', 'PLANIFICADOR',  false, false, false, false),
  ('anomalies', 'SUPERVISOR',    true, true, true, false), -- "Cerrar" es un campo de estado (update), no delete
  ('anomalies', 'LUBRICADOR',    true, true, false, false), -- crea, no cierra ni borra
  ('anomalies', 'VISOR',         false, false, false, false),
  -- audit_log (append-only por diseño de toda la app, TODOS los roles autenticados escriben)
  ('audit_log', 'ADMINISTRADOR', true, true, false, false),
  ('audit_log', 'PLANIFICADOR',  false, true, false, false),
  ('audit_log', 'SUPERVISOR',    false, true, false, false),
  ('audit_log', 'LUBRICADOR',    false, true, false, false),
  ('audit_log', 'VISOR',         false, false, false, false),
  -- settings (ruta "config", solo ADMINISTRADOR en PERMISSIONS)
  ('settings', 'ADMINISTRADOR', true, true, true, true),
  ('settings', 'PLANIFICADOR',  false, false, false, false),
  ('settings', 'SUPERVISOR',    false, false, false, false),
  ('settings', 'LUBRICADOR',    false, false, false, false),
  ('settings', 'VISOR',         false, false, false, false),
  -- cuadrillas
  ('cuadrillas', 'ADMINISTRADOR', true, true, true, true),
  ('cuadrillas', 'PLANIFICADOR',  true, false, false, false),
  ('cuadrillas', 'SUPERVISOR',    true, false, false, false),
  ('cuadrillas', 'LUBRICADOR',    true, false, false, false),
  ('cuadrillas', 'VISOR',         false, false, false, false),
  -- push_tokens (cada dispositivo escribe SOLO el suyo — ver nota, esto NO
  -- lo puede expresar app_store_permissions por sí sola, falta un with
  -- check adicional a nivel de policy específica de este store)
  ('push_tokens', 'ADMINISTRADOR', true, true, true, false),
  ('push_tokens', 'PLANIFICADOR',  true, true, true, false),
  ('push_tokens', 'SUPERVISOR',    true, true, true, false),
  ('push_tokens', 'LUBRICADOR',    true, true, true, false),
  ('push_tokens', 'VISOR',         false, true, true, false), -- puede recibir push aunque no opere
  -- grease_validations
  ('grease_validations', 'ADMINISTRADOR', true, true, true, true),
  ('grease_validations', 'PLANIFICADOR',  true, false, false, false),
  ('grease_validations', 'SUPERVISOR',    true, true, true, false),
  ('grease_validations', 'LUBRICADOR',    true, true, true, false),
  ('grease_validations', 'VISOR',         true, false, false, false)
on conflict (store, role) do update set
  can_read = excluded.can_read, can_insert = excluded.can_insert,
  can_update = excluded.can_update, can_delete = excluded.can_delete;

alter table app_store_permissions enable row level security;

-- La matriz misma es de solo lectura para cualquier usuario autenticado
-- activo (el cliente NO necesita esto hoy, pero es inofensivo exponerlo
-- para poder auditar permisos desde el propio dashboard de Supabase sin
-- usar el service role). Nadie except un futuro proceso admin la escribe
-- por API — se edita a mano en SQL Editor por ahora.
drop policy if exists "app_store_permissions: lectura autenticada" on app_store_permissions;
create policy "app_store_permissions: lectura autenticada"
  on app_store_permissions for select
  using (current_app_active());

-- ------------------------------------------------------------
-- 4) Policies NUEVAS sobre engrase_sync (NO reemplazan la legacy todavía)
-- ------------------------------------------------------------
-- Mientras "acceso interno con anon key" siga existiendo, estas 3 policies
-- son inertes en términos de seguridad efectiva (ver nota de MIGRACIÓN al
-- inicio del archivo) — se crean ahora para poder probarlas de punta a
-- punta (Etapa C del rollout) ANTES del corte real.

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
    -- USING gobierna qué filas EXISTENTES puede tocar: alcanza con
    -- can_update O can_delete (el WITH CHECK decide cuál aplica según lo
    -- que traiga la fila nueva).
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

-- Sin policy de DELETE sobre engrase_sync a propósito — igual que en
-- app_profiles, el CAS de P0-1 (sync.js) nunca emite un DELETE real, solo
-- UPDATE con deleted=true. Sin ninguna policy de DELETE, RLS deniega
-- cualquier DELETE real para TODOS una vez que exista siquiera una policy
-- restrictiva en la tabla — defensa en profundidad gratuita.

-- ============================================================
-- ESTADO 2/2: CUTOVER — NO EJECUTAR junto con lo de arriba
-- ============================================================
-- Esta sección es el punto de no retorno operativo (ver Sección 15 del
-- pedido / gates de cutover en docs/AUTH_RLS_IMPLEMENTATION_PLAN.md).
-- Requiere que TODOS los gates de cutover estén en PASS antes de correrla.
-- A partir de aquí, un dispositivo sin JWT de Supabase Auth válido deja de
-- poder sincronizar — el bootstrap/anon-key-únicamente muere en este
-- instante. Comandos separados y comentados, NO se ejecutan como parte de
-- la Sección 1-4 de arriba.

-- CUTOVER 1: retirar la policy legacy que hoy hace "OR true" con todo.
-- drop policy if exists "acceso interno con anon key" on engrase_sync;

-- CUTOVER 2 (Storage, referencia — el cambio real de Storage es P0-3, NO
-- se toca en este cierre; se deja el comando aquí solo para que quede
-- documentado dónde va cuando corresponda):
-- drop policy if exists "engrase-photos subir con anon key" on storage.objects;
-- drop policy if exists "engrase-photos actualizar con anon key" on storage.objects;
-- (la política de lectura pública de Storage NO se toca en P0-2 — eso es
-- P0-3 explícitamente, ver docs/AUTH_RLS_MIGRATION_DESIGN.md §10)

-- ROLLBACK del cutover (si algo falla en producción real, ejecutar esto
-- de inmediato para volver al estado de MIGRACIÓN sin pérdida de datos —
-- ninguna fila de engrase_sync se toca al hacer rollback, solo cambia
-- quién puede leer/escribir):
-- create policy "acceso interno con anon key" on engrase_sync
--   for all using (true) with check (true);
