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

## 7. Resultado (fase pre-cutover, sin Junior)

**PASS.** Migración aplicada exitosamente, sin errores, dentro de una
transacción. 0 cambios a datos operativos, 0 cambios a `auth.users`,
0 cambios a Storage, policy legacy intacta, 0 usuarios/perfiles reales
creados. Rollback preparado y no ejecutado (no fue necesario).

## 8. Junior Valles — primer administrador Auth real (mismo día, 2026-09-26)

**Precheck (solo lectura):**

| Check | Resultado |
|---|---|
| `auth.users` NO contenía `jvalles@engrase.internal` antes | Ya existía 1 fila — cuenta creada manualmente por el usuario en el Dashboard antes de este paso |
| `app_profiles` sin fila para Junior/`u_jvalles` | Confirmado, 0 filas totales |
| Colisión de `app_user_id='u_jvalles'` | Ninguna |
| Policy legacy activa | Sí |
| `AUTH_MODE` en código | `'legacy'` (sin cambios) |
| ¿`u_jvalles` necesita una fila equivalente en el store `users`? | **NO, no para que la app funcione hoy** — `AUTH_MODE` sigue `'legacy'`, nada en `src/core/auth.js` ni en el login actual consulta `app_profiles` en relación con `users`; no se creó ninguna fila en `users` |

**Auth (paso manual, ya hecho por el usuario):** confirmado por lectura —
exactamente 1 fila en `auth.users` con ese email, `email_confirmed_at`
no nulo (cuenta confirmada), sin baneo. `auth.uid()` obtenido por
lectura (no es secreto, es solo un identificador):
`81b7420b-444f-4404-b470-fbeda30ed887`.

**`app_profiles` creado:**

| Campo | Valor |
|---|---|
| `auth_user_id` | `81b7420b-444f-4404-b470-fbeda30ed887` |
| `app_user_id` | `u_jvalles` |
| `display_name` | `Junior Valles` |
| `role` | `ADMINISTRADOR` |
| `active` | `true` |
| password/PIN | **NO REGISTRADA** — nunca pasó por Claude/terminal/script/archivo |

Insertado en una transacción (`BEGIN; INSERT ...; COMMIT;`). Verificado
después: exactamente 1 fila en `app_profiles`, con esos valores exactos.

### Bug encontrado y corregido durante la prueba de RLS (paso 6)

Al simular a Junior autenticada (rol `authenticated`, `request.jwt.claims`
con su `sub`) y consultar `app_profiles`, Postgres devolvió:

```
ERROR: 42P17: infinite recursion detected in policy for relation "app_profiles"
```

**Causa:** las policies `"app_profiles: admin lee todos"`, `"admin crea
perfiles"` y `"admin edita otros"` (tal como se aplicaron en la Sección
5) usaban `EXISTS (SELECT 1 FROM app_profiles me WHERE ...)` — una
subconsulta cruda contra la misma tabla, que vuelve a disparar RLS sobre
`app_profiles` y reevalúa la misma policy indefinidamente. Afectaba
CUALQUIER acceso autenticado real a `app_profiles`, incluida la propia
Junior leyendo su perfil (Postgres evalúa todas las policies permisivas
del comando, no solo la que matchea).

**Fix aplicado (autorizado explícitamente por el usuario antes de
ejecutar), en una transacción separada:** las 3 policies se
reemplazaron para usar `current_app_role() = 'ADMINISTRADOR' AND
current_app_active()` en vez de la subconsulta cruda — el mismo patrón
`SECURITY DEFINER` que ya se usaba correctamente en las policies de
`engrase_sync`/`app_store_permissions`. Sin tocar `engrase_sync`,
`auth.users`, Storage ni la policy legacy. El archivo de migración en el
repo (`0002_auth_profiles_rls_PREPARED.sql`, y también
`0001_auth_profiles_rls_DRAFT.sql` por consistencia) se corrigió para
reflejar exactamente lo que quedó aplicado.

### Verificación RLS (post-fix) — todo PASS

| Check | Resultado |
|---|---|
| Junior autenticada puede `SELECT` su propio perfil | ✅ Sin recursión, devuelve su fila completa |
| Junior NO puede cambiar su propio `role` vía policy | ✅ `UPDATE` intentado (rollback) → `role` sigue `ADMINISTRADOR` sin cambios |
| Junior NO puede cambiar su propio `active` vía policy | ✅ `UPDATE` intentado (rollback) → `active` sigue `true` sin cambios |
| `anon` no obtiene privilegio `ADMINISTRADOR` | ✅ `current_app_role()`→`null`, `current_app_active()`→`false` sin `auth.uid()` |
| `current_app_role()` depende de `auth.uid()`, no de payload | ✅ por definición de la función (lee `app_profiles` por `auth_user_id=auth.uid()`, nunca lee ningún payload de `engrase_sync`) |

Todos los intentos de escritura de estas pruebas terminaron en
`ROLLBACK` explícito — 0 cambios permanentes de las pruebas mismas.

### Estado final confirmado

- `app_profiles`: **exactamente 1 fila** (Junior), legacy (7 cuentas) **0
  filas** en `app_profiles` — sin cambios respecto a la Sección 6.
- `engrase_sync`: **1662 filas, idéntico por store** (sin cambios).
- Policy legacy `"acceso interno con anon key"`: **activa**.
- `AUTH_MODE` en código: **`'legacy'`** (sin cambios).
- Acceso `anon` de `engrase_sync`: sin cambios (no se probó de nuevo en
  este paso porque nada de este paso tocó `engrase_sync`).

## 9. Resultado final

**PASS** (incluye el fix de recursión, aplicado con autorización
explícita antes de ejecutarse). Junior Valles es el primer y único
administrador Auth real de producción. `AUTH_MODE` sigue `'legacy'` —
esto no activa ningún comportamiento nuevo en el cliente todavía.
