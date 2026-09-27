# PRE-CUTOVER Auth/RLS aplicado en producción — 2026-09-26

Autorización explícita del usuario, alcance exacto:
`supabase/migrations/0002_auth_profiles_rls_PREPARED.sql`, únicamente.
Base: commit `5f25806`.

**Proyecto Supabase:** `cont_engrase` (ref `havrirlapjyqrffgalqx`, región
`us-west-2`) — mismo proyecto que `DEFAULT_SYNC_CONFIG.url` en `db.js`.
Sin secretos en este documento (sin anon key, JWT, service_role,
passwords ni tokens).

**Mecanismo de ejecución:** `supabase db query --linked --project-ref
havrirlapjyqrffgalqx` (Management API de Supabase, vía CLI ya
autenticada en esta máquina por el usuario) — nunca `supabase db push`
(que aplicaría también `0001_auth_profiles_rls_DRAFT.sql` por orden de
archivo, explícitamente prohibido). Cada paso se ejecutó como una
consulta/archivo SQL individual y acotado.

## 1. Precheck del archivo SQL — PASS

Lectura completa de `0002_auth_profiles_rls_PREPARED.sql` confirmada:

**Contiene únicamente:**
- `CREATE TABLE app_profiles` (+ `CHECK` de rol, `UNIQUE`, FK a
  `auth.users(id)`, índice por `role`).
- `CREATE TABLE app_store_permissions` (+ `INSERT` de la matriz de
  permisos — metadata de la app, no datos de personas).
- `current_app_role()` / `current_app_active()` (funciones
  `SECURITY DEFINER`, `search_path` fijo).
- `ENABLE ROW LEVEL SECURITY` en ambas tablas nuevas.
- 8 `CREATE POLICY` nuevas (4 en `app_profiles`, 1 en
  `app_store_permissions`, 3 en `engrase_sync`).

**Confirmado que NO contiene:** `DROP` de la policy legacy,
`DELETE`/`TRUNCATE`, `UPDATE` de datos operativos, `INSERT` de personas
reales, creación de Junior Valles, cambios a Storage, cambios a
`auth.users`, `service_role`, secretos, `ALTER` destructivo.

## 2. Snapshot previo (solo lectura, antes de aplicar)

| Objeto | Estado antes |
|---|---|
| `app_profiles` | no existe (`to_regclass` → `null`) |
| `app_store_permissions` | no existe |
| `current_app_role()` / `current_app_active()` | no existen |
| Policies en `engrase_sync` | 1 — `"acceso interno con anon key"` (FOR ALL, permissive) |
| RLS en `engrase_sync` | `relrowsecurity=true`, `relforcerowsecurity=false` |
| Policies en `storage.objects` (bucket `engrase-photos`) | 3 — lectura pública, insert anon, update anon (sin cambios, no tocadas en este paso) |

**`engrase_sync` — conteo por store (antes):**

| store | n |
|---|---|
| anomalies | 6 |
| audit_log | 485 |
| cuadrillas | 4 |
| equipment | 11 |
| equipment_types | 11 |
| grease_validations | 7 |
| locations | 7 |
| lubricants | 4 |
| lubrication_plans | 7 |
| lubrication_points | 1031 |
| lubrication_records | 77 |
| push_tokens | 1 |
| settings | 2 |
| shifts | 2 |
| users | 7 |
| **Total** | **1662** |

## 3. Idempotencia — nada pre-existente

`app_profiles`, `app_store_permissions` y las 2 funciones no existían
antes de aplicar — sin conflicto de definición, sin necesidad de
comparar/detenerse.

## 4. Rollback preparado

`supabase/migrations/0002_auth_profiles_rls_ROLLBACK.sql` — creado ANTES
de aplicar. Revierte únicamente las 2 tablas nuevas, las 2 funciones y
las 8 policies nuevas. No toca datos de `engrase_sync`, `auth.users`,
Storage, ni la policy legacy. No se ejecutó (queda listo para usarse si
hiciera falta).

## 5. Aplicación

**Ejecutada.** `0002_auth_profiles_rls_PREPARED.sql` completo, envuelto en
`BEGIN; ... COMMIT;`, vía `supabase db query --linked --project-ref
havrirlapjyqrffgalqx --file <copia envuelta>` (el archivo del repo no se
modificó para agregar el wrapper — se envolvió solo en una copia temporal
de ejecución). Sin errores, `COMMIT` confirmado. No se usó `supabase db
push` en ningún momento (evita aplicar `0001_auth_profiles_rls_DRAFT.sql`
por orden de archivo).

## 6. Verificación post-apply

| Check | Resultado |
|---|---|
| A. `app_profiles` existe | ✅ `to_regclass` → `app_profiles` |
| B. Filas en `app_profiles` | ✅ **0** |
| C. Junior Valles NO existe | ✅ 0 coincidencias por nombre/`app_user_id` |
| D. `auth.users` no modificado | ✅ `count(*) = 0` (Supabase Auth nunca se usó en este proyecto; 0002 no toca esta tabla en ninguna sentencia) |
| E. `engrase_sync` conserva conteos | ✅ idéntico antes/después, ver tabla abajo |
| F. Policy legacy sigue activa | ✅ `"acceso interno con anon key"` (FOR ALL) presente, junto a las 3 nuevas |
| G. Rol `anon` real sigue pudiendo `SELECT` | ✅ `SET ROLE anon; SELECT count(*) FROM engrase_sync` → **1662** (idéntico) |
| H. Funciones no otorgan privilegio sin auth | ✅ `current_app_role()` → `null`, `current_app_active()` → `false` (sin `auth.uid()`) |
| `app_store_permissions` completa | ✅ 75 filas = 15 stores × 5 roles |

**`engrase_sync` — conteo por store (después, idéntico al de antes):**
anomalies 6, audit_log 485, cuadrillas 4, equipment 11, equipment_types
11, grease_validations 7, locations 7, lubricants 4, lubrication_plans 7,
lubrication_points 1031, lubrication_records 77, push_tokens 1,
settings 2, shifts 2, users 7 — **total 1662, sin ningún cambio.**

**Objetos creados (9 en total):**
- 2 tablas: `app_profiles`, `app_store_permissions`.
- 2 funciones: `current_app_role()`, `current_app_active()`.
- 1 índice: `app_profiles_role_idx`.
- 8 policies nuevas: 4 en `app_profiles`, 1 en `app_store_permissions`,
  3 en `engrase_sync`.

**Advertencia explícita mantenida:** las 3 policies nuevas de
`engrase_sync` **NO son seguridad efectiva todavía** — la policy legacy
`using(true)/with check(true)` sigue activa y, al combinarse por OR,
sigue siendo la que realmente decide el acceso. Esto es exactamente el
comportamiento PRE-CUTOVER esperado, confirmado por G.

## 7. Resultado

**PASS.** Migración aplicada exitosamente, sin errores, dentro de una
transacción. 0 cambios a datos operativos, 0 cambios a `auth.users`,
0 cambios a Storage, policy legacy intacta, 0 usuarios/perfiles reales
creados. Rollback preparado y no ejecutado (no fue necesario).
