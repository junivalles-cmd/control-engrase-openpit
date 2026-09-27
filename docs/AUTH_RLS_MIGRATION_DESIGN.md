# P0-2 — Auditoría y diseño: Autenticación real + Roles + RLS

Fecha: 2026-09-26. Solo auditoría y diseño — **ningún código, SQL ni dato
tocado** (ver §14 del pedido). Continúa desde `588f076` (P0-1 sync CAS,
cerrado, no tocado).

## 1. Login actual (auditoría de código, `app.js`)

- **Login** (`renderLogin()`, ~L1557-1650): el usuario elige su nombre de
  una lista (`DB.allActive('users')`) e ingresa un PIN de 4 dígitos,
  comparado con `===` contra `selected.pin` en texto plano (L1631). Sin
  ningún round-trip al servidor — 100% local contra IndexedDB.
- **Intentos fallidos**: contados por `id` de usuario en
  `localStorage.engrase_login_attempts` (L1605-1618) — 5 intentos, luego
  bloqueo de 5 minutos; se registra `LOGIN_BLOQUEADO` en `audit_log` local.
- **Logout** (~L1652-1660): `sessionStorage.removeItem('engrase_user')`,
  `App.currentUser = null`. **No** limpia IndexedDB — los datos de todos
  los usuarios/registros siguen en el dispositivo.
- **Persistencia de sesión**: `sessionStorage.engrase_user` = JSON
  `{id, name, role}`, leído en el boot (`DOMContentLoaded`, ~L1318-1324). Si
  existe, se confía en ese `role` tal cual, sin volver a validarlo contra
  nada.
- **`users` (shape real)**: `{id, name, username, pin, role, active,
  cuadrillaId?, shiftId?, locationId?, createdAt, updatedAt, createdBy}`.
  El formulario de edición (~L7428-7473) hace
  `Object.assign(existing, fd)` con el `FormData` crudo del formulario, sin
  ninguna validación server-side, y guarda con `DB.put('users', stamp(...))`.
- **PIN**: **texto plano**, sin hash, en ningún lugar del código (`app.js`
  no tiene `bcrypt`/`sha`/`crypto` para esto). El campo del formulario ni
  siquiera es `type="password"`.
- **Roles reales**: `ADMINISTRADOR, PLANIFICADOR, SUPERVISOR, LUBRICADOR,
  VISOR` — **los 5 existen ya**, definidos en `PERMISSIONS` (`app.js`
  L1019-1025) y en `ROLE_ICON` (L1559). `VISOR` no aparece en ningún seed
  ni en ningún dato real conocido (memoria de sesiones previas), pero SÍ es
  asignable hoy desde Usuarios (un Administrador puede elegirlo en el
  `<select>` de rol) y SÍ tiene rutas propias:
  `['dashboard','matriz','historial','reportes','ayuda']` — es decir, ya es
  de facto un rol de solo lectura, aunque nunca se usó en producción.
- **Permisos UI**: enteramente client-side. `PERMISSIONS[role]` filtra qué
  rutas aparecen en el menú (L1749, L1762). Dentro de cada pantalla,
  patrones repetidos `const canEdit = App.currentUser.role ===
  'ADMINISTRADOR'` (Equipos L2917/3191, Lubricantes L5540, Ayuda L7725) y
  chequeos puntuales (`anom-close` ADMIN+SUPERVISOR L5408, `anom-delete`
  solo ADMIN, `canRegister` = LUBRICADOR+ADMIN+SUPERVISOR+PLANIFICADOR
  L387). Ningún equivalente existe en el servidor.
- **Bootstrap/seed** (`db.js`, ya auditado en sesión previa): `seedIfEmpty()`
  crea 4 usuarios con PIN **hardcodeado** 1111/2222/3333/4444
  (admin/planificador/supervisor/lubricador) cuando el sistema está
  completamente vacío; `seedSoloUsuarioInicial()` crea un admin temporal
  con PIN `1111` cuando el dispositivo se une a un sistema que YA tiene
  datos en el servidor. **Nada en el código fuerza cambiar estos PIN** —
  persisten indefinidamente salvo edición manual.
- **Borrar IndexedDB/localStorage**: `DB.init()` →
  `seedSoloSiElSistemaEstaVacio()` vuelve a sembrar (catálogo completo con
  los mismos PIN default, o solo el admin temporal PIN 1111 si el servidor
  ya tiene datos) — el dispositivo queda otra vez con un PIN conocido y
  predecible hasta el próximo sync.
- **Tamper de rol desde DevTools — CONFIRMADO explotable**: no hay nada que
  impida editar `App.currentUser.role` en memoria, o editar el registro
  `users` en IndexedDB (`role: 'ADMINISTRADOR'`) y dejar que `pushAll()` lo
  suba — `users` está en `STORES` (se sincroniza) y la política RLS actual
  (`using(true) with check(true)`) acepta cualquier escritura de cualquier
  poseedor de la anon key, sin mirar contenido. El CAS de P0-1 protege
  contra *sobrescritura concurrente*, **no** contra *contenido falsificado*
  — son problemas ortogonales, P0-1 no mitiga esto en absoluto.

## 2. Supabase actual (auditoría de `schema.sql` — sin asumir nada)

```sql
create table if not exists engrase_sync (
  store text not null, id text not null, payload jsonb not null,
  updated_at timestamptz not null default now(),
  deleted boolean not null default false,
  primary key (store, id)
);
alter table engrase_sync enable row level security;

create policy "acceso interno con anon key" on engrase_sync
  for all using (true) with check (true);

insert into storage.buckets (id, name, public)
  values ('engrase-photos', 'engrase-photos', true) on conflict (id) do nothing;

create policy "engrase-photos lectura publica" on storage.objects
  for select using (bucket_id = 'engrase-photos');
create policy "engrase-photos subir con anon key" on storage.objects
  for insert with check (bucket_id = 'engrase-photos');
create policy "engrase-photos actualizar con anon key" on storage.objects
  for update using (bucket_id = 'engrase-photos');
```

- **RLS:** habilitado (`enable row level security`), pero la única política
  es `for all using(true) with check(true)` — cubre SELECT/INSERT/
  UPDATE/DELETE simultáneamente, sin distinguir `store`, sin distinguir
  usuario, sin distinguir rol. Equivalente en la práctica a RLS
  deshabilitado para cualquiera con la anon key.
- **Storage `engrase-photos`:** bucket **público** (`public: true`).
  Lectura sin restricción (`using(true)`, ni siquiera exige la anon key —
  un bucket público sirve por URL directa). Insert/update abiertos a
  cualquier anon key holder, sin distinguir prefijo/carpeta ni propietario.
- **Auth:** confirmado, **no se usa Supabase Auth en absoluto** — 0
  referencias a `supabase.auth`/`auth.uid()`/`signInWith*`/
  `@supabase/supabase-js` en todo `CONTROL_ENGRASE_WEB`. La app habla
  directo con PostgREST vía `fetch()` + anon key (`sync.js`).
  `docs/DECISIONS.md` (línea ~55) ya dejaba esto como "pendiente de
  revisión humana" desde antes — este documento es esa revisión.
- Los Edge Functions (`notify-push`, `notify-vencidos`) usan
  `SUPABASE_SERVICE_ROLE_KEY` desde variable de entorno server-side — un
  camino totalmente aparte, no interactúan con el login de usuarios ni con
  RLS de cliente.

## 3. Identidad vs. Rol

- **Identidad hoy:** no existe. El "dispositivo" se autentica ante
  Supabase con la anon key compartida (misma llave para todos, hardcodeada
  en `db.js`) — Supabase no puede distinguir un dispositivo de otro, mucho
  menos una persona.
- **Rol hoy:** un string en un registro `users` de IndexedDB, replicado a
  Supabase como cualquier otro dato, editable por cualquiera con acceso al
  dispositivo o a la anon key. El servidor nunca lo interpreta — es pura
  decoración para la UI del cliente.
- Los 5 roles (`ADMINISTRADOR, PLANIFICADOR, SUPERVISOR, LUBRICADOR,
  VISOR`) ya están definidos y su matriz de PERMISOS de **rutas** ya existe
  en código (`PERMISSIONS`, §7 abajo) — el trabajo de RLS no inventa roles
  nuevos, traduce estos 5 a políticas de servidor.

## 4. Arquitectura objetivo (recomendada, NO implementada)

**Supabase Auth (identidad) + tabla de perfiles server-side (rol/estado) +
RLS real**, exactamente la preferencia indicada:

- **Auth:** Supabase Auth con **email + password** por usuario (no PIN como
  password — ver §6). Un `auth.users` por persona real. Compatible con
  Web/Android Capacitor (el SDK de Supabase Auth funciona igual en
  WebView) y con trabajo offline (el JWT de sesión se cachea localmente y
  sigue siendo válido hasta expirar/refrescar, sin necesitar red en cada
  operación local).
- **Perfil:** tabla nueva (no reemplaza `users` en IndexedDB, la
  complementa) — nombre propuesto **`app_profiles`** en vez de
  `profiles`/`app_users` genérico, para no chocar con ningún nombre ya
  reservado por Supabase Auth:

  ```
  app_profiles
    auth_user_id   uuid primary key references auth.users(id)
    app_user_id    text not null unique   -- el id actual de users.id (ej. 'u_admin')
    name           text not null
    role           text not null           -- ADMINISTRADOR|PLANIFICADOR|SUPERVISOR|LUBRICADOR|VISOR
    active         boolean not null default true
    created_at     timestamptz not null default now()
    updated_at     timestamptz not null default now()
  ```

  (Esquema **propuesto para discusión**, no definitivo — el pedido pide
  explícitamente no cerrarlo hasta revisar datos reales de producción;
  columnas confirmadas como necesarias por el código: `role` y `active`
  son las únicas que hoy consulta el cliente para decidir permisos.)
- **RLS real:** las políticas de `engrase_sync` dejan de ser
  `using(true)` y empiezan a consultar `app_profiles` por
  `auth.uid()` (detalle SQL propuesto en §7/§9).
- **`engrase_sync` genérico:** se mantiene (ver §9) — RLS por `store` es
  viable con el schema actual, no hace falta partir en 15 tablas ahora.

## 5. UX offline — diseño de comportamiento

- **Primer uso del dispositivo:** requiere red y login real contra
  Supabase Auth (`signInWithPassword`). Sin esto, no hay JWT que cachear —
  no hay forma honesta de "confiar" en un dispositivo que nunca se validó.
- **Sesión ya conocida en el dispositivo:** el SDK de Supabase Auth
  persiste el `refresh_token`/`access_token` en su propio storage local
  (equivalente a lo que hoy hace `sessionStorage.engrase_user`, pero
  criptográficamente verificable por el servidor, no un string editable).
  Mientras el JWT cacheado no haya expirado, la app sigue funcionando
  100% offline exactamente como hoy (IndexedDB primero, sync en segundo
  plano).
- **Al recuperar internet:** el SDK intenta refrescar el token
  automáticamente; si el refresh es válido, `fullSync()` sigue igual que
  hoy pero ahora con `Authorization: Bearer <JWT real>` en vez de la anon
  key pura — el CAS de P0-1 (PATCH/POST condicionados) **no cambia**, solo
  cambia qué credencial va en el header.
- **Sesión expirada estando offline:** el refresh falla al reconectar → la
  app debe caer a pantalla de login real (no auto-relogin silencioso, no
  fallback a anon). Los registros hechos offline **antes** de la
  expiración quedan en IndexedDB con su `updatedAt`/`_pushedVersion`
  normales — se suben en cuanto haya una sesión válida de nuevo (nunca se
  pierden, solo queda pausado el push hasta re-autenticar).
- **Usuario desactivado desde otro dispositivo mientras estaba offline:**
  RLS server-side (`active = true` en `app_profiles`) rechaza cualquier
  escritura/lectura en el próximo intento de sync — el dispositivo se
  entera recién al reconectar (no hay forma de notificarlo offline, es
  aceptable: los datos ya escritos localmente no desaparecen, simplemente
  dejan de poder subirse hasta que un admin reactive al usuario).
- **Rol cambiado mientras estaba offline:** toma efecto recién al
  reconectar (RLS usa el `role` actual en `app_profiles`, no el cacheado en
  el dispositivo) — el cliente debería re-leer su propio perfil al
  reconectar y actualizar `App.currentUser.role` local para que la UI
  coincida con lo que el servidor realmente va a permitir (si no, el
  usuario vería botones que el servidor rechazaría al intentar usarlos).
- **Regla dura pedida explícitamente:** nunca caer a anon para sincronizar
  datos — si no hay sesión válida, `fullSync()` debe **abstenerse** de
  pushear/pullear (quedar en estado "pendiente de sesión"), nunca reusar la
  anon key como respaldo silencioso.

## 6. PIN actual — uso futuro

- **A) Supabase Auth = autenticación real** (password real, por persona,
  hasheado por Supabase con bcrypt server-side — no es responsabilidad del
  cliente).
- **B) PIN local = "quick unlock" opcional**, nunca autoridad de servidor:
  - Solo sirve para volver a entrar rápido en un dispositivo que YA tiene
    una sesión Auth válida cacheada — nunca sustituye el login real.
  - Si se conserva, debe guardarse con hash local (ej. SHA-256 con salt
    por dispositivo) — nunca texto plano como hoy.
  - Borrar localStorage/IndexedDB debe **forzar** login real de nuevo
    (perder la sesión Auth cacheada), nunca dejar una puerta donde
    reinstalar/limpiar datos alcance para "resetear" el PIN y entrar como
    quien sea — el JWT es lo único que otorga permisos, el PIN solo decide
    si la UI pide password otra vez o no.

## 7. Matriz de permisos — derivada del código real (`PERMISSIONS`, `canEdit`, `canRegister`, gates puntuales)

`STORES` real (`db.js` L15-20), 15 en total. R=lectura (todo dispositivo
recibe el store completo hoy, full-mirror — ver nota de riesgo abajo),
W=escritura confirmada en código, W\*=escritura incidental/lateral
(confianza media, no una pantalla CRUD dedicada), — = sin acceso de
escritura por UI hoy.

| STORE | ADMIN | PLANIFICADOR | SUPERVISOR | LUBRICADOR | VISOR |
|---|---|---|---|---|---|
| `users` | R/W (todos) | R | R/W (solo LUBRICADOR de su equipo, L7403-7404) | R (su propio registro) | R |
| `shifts` | R/W | R | R | R | R |
| `locations` | R/W | R | R | R | R |
| `equipment_types` | R/W | R | R | R | R |
| `equipment` | R/W (`canEdit`, L2917/3191) | R | R | — | — |
| `lubricants` | R/W (`canEdit`, L5540) | R | R | R | R |
| `lubrication_plans` | R/W | R | R | W\* (`lastGreaseHour` al registrar, L2153) | — |
| `lubrication_points` | R/W | R | R | R | — |
| `lubrication_records` | R/W | R/W (`canRegister`, L387) | R/W (`canRegister`) | R/W (`canRegister` — su operación principal) | R |
| `anomalies` | R/W + cerrar/borrar (L5408, borrar solo ADMIN) | — (no está en `PERMISSIONS.PLANIFICADOR`) | R/W + cerrar | R/W (crear) | — |
| `audit_log` | R (implícito) | — | — | — (solo escribe, vía `logAudit()`, todos los roles) | — |
| `settings` | R/W (`canEdit` en Ayuda L7725; ruta `config` L1733 solo ADMIN) | — | — | — | — |
| `cuadrillas` | R/W | R | R | R | — |
| `push_tokens` | W (propio dispositivo) | W (propio) | W (propio) | W (propio) | W (propio) |
| `grease_validations` | R/W | R | R/W | R/W (crear/firmar) | R |

**Notas de baja confianza marcadas explícitamente arriba (W\*)** —
requieren una segunda pasada línea por línea antes de traducir a SQL
definitivo, NO se está inventando nada pero tampoco se afirma con la misma
certeza que `canEdit`/`PERMISSIONS`, que son gates explícitos.

**LUBRICADOR — auditado específicamente (pedido explícito):** solo tiene 4
rutas (`turno, anomalias, historial, ayuda` — `PERMISSIONS.LUBRICADOR`).
Necesita **leer** casi todo el catálogo (equipment, plans, points, shifts,
locations, lubricants, cuadrillas, users) para poder operar offline, pero
solo **crea/edita** `lubrication_records` (su registro de engrase),
`grease_validations` (firma), `anomalies` (reporta), y actualiza
`lastGreaseHour` en `lubrication_plans` como efecto lateral de registrar.
Nunca toca `equipment`, `settings`, `users` de otros, `cuadrillas`.

**VISOR — confirmado en código como read-only** (`PERMISSIONS.VISOR` no
incluye ninguna ruta con formularios de edición: `dashboard, matriz,
historial, reportes, ayuda` — ninguna de esas pantallas tiene un
`canEdit`/botón de guardar visible para este rol en el código auditado).

**Riesgo de fondo que ninguna matriz por `store` resuelve por sí sola:**
hoy CADA dispositivo descarga el `STORE` completo (full-mirror, sin
filtro por fila) — RLS por `store` decide **si puede sincronizar ese
store en absoluto**, pero un LUBRICADOR con permiso de lectura sobre
`users` seguiría descargando el PIN (aunque ya no importe si migra a Auth)
y los datos de TODOS los usuarios, no solo el suyo. Aceptable para
catálogos (equipment, lubricants) pero cuestionable para `users` una vez
que ahí ya no viva ninguna credencial real — ver §9.

## 8. Escalamiento de privilegios — protecciones a diseñar (server-side)

Ninguna de estas existe hoy; todas dependen de que la política RLS
consulte `app_profiles` en vez de aceptar cualquier payload:

- **Nadie puede cambiar su propio `role`/`active`** vía `UPDATE
  app_profiles`: solo un `UPDATE` hecho por un `auth.uid()` cuyo propio
  perfil ya sea `role = 'ADMINISTRADOR' AND active = true` puede tocar la
  fila de **otro** usuario; nadie puede `UPDATE` su propia fila en las
  columnas `role`/`active` (ni siquiera un admin sobre sí mismo, para
  evitar auto-sabotaje accidental — requeriría que otro admin lo haga).
- **`settings` sensible**: solo `role = 'ADMINISTRADOR'` en `app_profiles`
  puede escribir `store = 'settings'` en `engrase_sync` (coincide con lo
  que la UI ya fuerza, ahora también en servidor).
- **`createdBy`/`userId` falsificado**: hoy el cliente escribe estos
  campos dentro de `payload` (jsonb), invisibles para RLS a nivel de
  columna real. La policy de `engrase_sync` no puede validar el contenido
  de `payload` fila por fila de forma simple — la mitigación práctica es
  que el `INSERT`/`UPDATE` en `push_tokens`, por ejemplo, exija que
  `payload->>'userId'` (o equivalente) coincida con `auth.uid()` mapeado a
  `app_user_id` — factible con una policy `with check` que lea
  `payload->>'campo'`, pero agrega complejidad; documentado como pendiente
  de decisión, no resuelto en este diseño.
- **Escribir en stores no permitidos**: la policy central de `engrase_sync`
  (§9) evalúa `store` contra el rol del `auth.uid()` — cubre esto
  directamente.

## 9. `engrase_sync` genérico — ¿alcanza RLS por `store`?

**Sí, se puede mantener la arquitectura genérica** — RLS por `store` es
suficiente para la mayoría de los casos de la matriz de §7, usando una
función auxiliar SQL (`current_role_of(auth.uid())`) y un `CASE`/tabla de
mapeo store→roles permitidos dentro de la policy. **Excepciones señaladas
(no implementadas, solo identificadas):**

- **`lubrication_records`**: hoy CUALQUIER rol con `canRegister` puede
  editar el registro de CUALQUIER otro (no hay chequeo de "creado por
  mí"). Si se quiere endurecer más allá de por-store, habría que agregar
  `with check (payload->>'createdBy' = ... )` o similar — **fuera de
  alcance de este cierre**, señalado para una fase posterior si se decide.
- **`users`**: una vez que la identidad viva en Auth, este store pasa a
  serménos sensible (ya no lleva PIN real), pero SUPERVISOR hoy solo debe
  poder editar usuarios `LUBRICADOR` de su propia cuadrilla (regla ya
  existe en cliente, L7403-7404) — replicarla en RLS exige leer
  `payload->>'role'`/`cuadrillaId'` dentro de la policy, más complejo que
  un simple mapeo por store.
- **`push_tokens`**: por diseño debería restringirse a "solo mi propio
  token" (`payload->>'userId' = mapeo de auth.uid()`), no solo por rol.
- El resto de los 15 stores (catálogos, `lubrication_plans/points`,
  `anomalies`, `settings`, `cuadrillas`, `grease_validations`,
  `audit_log`) son suficientemente seguros con RLS por `(store, role)`
  simple, según la matriz de §7.

## 10. Storage `engrase-photos` — solo auditoría

- **Estado actual confirmado:** bucket público, lectura sin ninguna
  restricción, insert/update abiertos a cualquier anon key holder, sin
  distinguir prefijo de carpeta ni quién sube qué.
- **Separación conceptual necesaria** (ya existe físicamente por
  convención de ruta, `sync.js`): fotos de anomalías/equipo/puntos de
  engrase viven bajo `<store>/<id>_<n>.<ext>` (ej.
  `lubrication_records/rec_x_0.jpg`), firmas de validación bajo
  `grease_validations/<id>.png` (ver `docs/GREASE_VALIDATION_AUDIT.md`).
  Estos dos grupos podrían tener políticas distintas (ej. una firma de
  validación es evidencia legal/auditable — más sensible que una foto de
  anomalía).
- **Política por rol a evaluar (no implementada, P0-3):** lectura
  probablemente puede seguir siendo amplia dentro del equipo (todos los
  roles necesitan VER fotos/firmas para su trabajo diario), pero
  insert/update debería exigir sesión Auth válida como mínimo, y
  potencialmente restringir por prefijo de carpeta según el store al que
  corresponde (mismo mapeo store→rol de §7, aplicado al prefijo del
  `path` en Storage). **Cambio público→privado explícitamente diferido a
  P0-3**, como pidió el usuario.

## 11. Migración de usuarios existentes

- **Se puede migrar sin pérdida:** `id`, `name`, `role`, `active`,
  `cuadrillaId` de cada `users` actual → una fila nueva en `app_profiles`
  con `app_user_id = users.id` (el mismo id de siempre, para no romper
  ninguna referencia existente en `lubrication_records.createdBy` ni en
  ninguna otra parte del código que hoy compara por ese id).
- **NO se migra automáticamente:** el campo `pin` (4 dígitos, texto
  plano) **nunca** se convierte en password de Auth — un PIN de 4 dígitos
  es una password trivialmente débil, y migrarlo automáticamente
  perpetuaría exactamente el problema que se busca resolver.
- **Debe crearse de nuevo:** una password real por persona en Supabase
  Auth (invitación por email, o alta manual por un administrador con una
  password temporal que el usuario deba cambiar). Requiere que cada
  usuario real tenga (o se le asigne) un email válido — dato que **hoy no
  existe** en `users` (solo `username`, no email) — a confirmar con el
  usuario/negocio antes de la Etapa A siguiente.
- El `auth_user_id` (uuid de Supabase Auth) es un dato NUEVO que no existe
  hoy en ningún lado — se genera al crear cada cuenta Auth y se guarda en
  `app_profiles.auth_user_id`.

## 12. Plan de rollout por etapas (con rollback)

- **Etapa A — crear Auth/perfiles/RLS sin romper el cliente actual:**
  crear `app_profiles` + políticas nuevas EN PARALELO, dejando la política
  `using(true) with check(true)` actual intacta hasta que la Etapa D la
  retire. Cero riesgo para producción — nada del cliente cambia todavía.
  **Rollback:** `drop table app_profiles` sin ningún efecto sobre
  `engrase_sync`.
- **Etapa B — adaptar cliente para usar sesión autenticada:** agregar
  `supabase-js` (o llamadas REST equivalentes a `/auth/v1/token`), login
  real, guardar JWT, usarlo en `sync.js` en vez de la anon key pura (el
  anon key sigue yendo como header `apikey`, pero `Authorization` pasa a
  ser el JWT del usuario). El PIN local pasa a "quick unlock" (§6).
  **Rollback:** revertir el commit de este cambio; la anon key sigue
  siendo válida mientras la Etapa D no la cierre.
- **Etapa C — probar Web/Android/offline** exhaustivamente (ver §13) antes
  de cualquier corte de acceso.
- **Etapa D — cerrar acceso anon:** reemplazar la policy
  `using(true) with check(true)` por las políticas reales por
  `store`/rol/`auth.uid()`. **Punto de no retorno operativo** — a partir
  de aquí, un dispositivo sin sesión Auth válida deja de poder
  sincronizar. **Rollback:** tener el `create policy` original guardado
  para poder re-crear "acceso interno con anon key" en segundos si algo
  falla en producción real.
- **Etapa E — retirar PIN inseguro/bootstrap antiguo:** eliminar
  `seedIfEmpty()`/`seedSoloUsuarioInicial()` (o cambiarlos para que ya no
  generen PIN productivos 1111-4444), y quitar la comparación `pin ===`
  como autoridad de acceso real (queda solo como quick-unlock si se
  decidió conservarlo).

## 13. Tests necesarios (diseño, no implementados)

Contra un Supabase de prueba/staging real (nunca contra producción) o
mockeado según corresponda:

- anon (sin JWT) no puede `SELECT`/`INSERT`/`UPDATE` en `engrase_sync` tras
  la Etapa D.
- VISOR autenticado: `SELECT` permitido en los `store` de su matriz,
  cualquier `INSERT`/`UPDATE`/`DELETE` rechazado por RLS (403/`42501`).
- LUBRICADOR: `INSERT`/`UPDATE` permitido solo en
  `lubrication_records`/`grease_validations`/`anomalies` (+ el campo lateral
  de `lubrication_plans`), rechazado en el resto.
- PLANIFICADOR/SUPERVISOR/ADMIN: cada uno contra su fila exacta de la
  matriz de §7.
- Usuario con `active=false` en `app_profiles`: **todo** rechazado, sin
  importar el `role`.
- Cambiar `role` de un usuario en `app_profiles` (como admin) y confirmar
  que un dispositivo YA CONECTADO con ese usuario, al reconectar, queda
  sujeto al rol nuevo (no al cacheado).
- Offline: registrar records sin red, confirmar que quedan en IndexedDB
  intactos; al reconectar con sesión válida, sincronizan igual que hoy.
- Reconexión sincroniza con la identidad correcta (el JWT nuevo, no una
  sesión vieja cacheada por error).
- Intento de `UPDATE app_profiles SET role='ADMINISTRADOR'` sobre la
  propia fila (o `active=true` sobre sí mismo estando inactivo) desde un
  cliente no-admin → rechazado por RLS.
- **El CAS de P0-1 sigue funcionando bajo RLS real:** el PATCH condicionado
  (`updated_at=eq.<base>`) y el POST `ignore-duplicates` no dependen de
  qué credencial autoriza la operación — deben seguir devolviendo 0/1 fila
  exactamente igual, solo que ahora la policy además puede rechazar el
  intento ANTES de evaluar el `WHERE` si el rol no corresponde a ese
  `store`. Un test debe confirmar que un 403 de RLS no se confunde con "0
  filas = conflicto de versión" en el código de `sync.js` (son casos
  distintos: RLS rechaza con status ≠ 200, el CAS de versión devuelve 200
  con array vacío) — **posible ajuste futuro en `sync.js` para
  distinguirlos explícitamente, no necesario todavía porque ninguna
  política nueva existe aún**.

## 15. Respuesta final (resumen — ver arriba el detalle completo)

Ver mensaje de cierre en el chat.
