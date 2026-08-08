-- ============================================================
-- CONTROL DE ENGRASE - OPEN PIT
-- Script de creación de la base de datos remota (Supabase)
--
-- CÓMO USARLO:
-- 1. Crea una cuenta gratis en https://supabase.com y un nuevo proyecto.
-- 2. Ve a "SQL Editor" en el panel izquierdo, pega este script completo
--    y presiona "Run".
-- 3. Ve a "Project Settings" → "API". Copia:
--      - "Project URL"            → esto es la URL
--      - "anon public" API key    → esta es la llave
-- 4. Abre la app → Configuración → Sincronización, pega ambos valores
--    y presiona "Guardar y probar conexión".
-- ============================================================

create table if not exists engrase_sync (
  store       text not null,
  id          text not null,
  payload     jsonb not null,
  updated_at  timestamptz not null default now(),
  deleted     boolean not null default false,
  primary key (store, id)
);

create index if not exists engrase_sync_updated_at_idx on engrase_sync (updated_at);

alter table engrase_sync enable row level security;

-- NOTA DE SEGURIDAD:
-- Esta política permite lectura/escritura a cualquiera que tenga la
-- "anon key" del proyecto. Es aceptable para una herramienta interna
-- donde la llave no se publica, pero NO la subas a un repositorio
-- público ni la compartas fuera del equipo. Si más adelante quieres
-- control de acceso por usuario, se puede migrar a Supabase Auth y
-- restringir esta política por usuario autenticado.
drop policy if exists "acceso interno con anon key" on engrase_sync;
create policy "acceso interno con anon key"
  on engrase_sync
  for all
  using (true)
  with check (true);
