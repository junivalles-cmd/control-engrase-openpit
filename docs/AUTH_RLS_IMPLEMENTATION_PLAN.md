# P0-2 — Plan de implementación: Auth real + app_profiles + RLS

Continúa `docs/AUTH_RLS_MIGRATION_DESIGN.md` (auditoría/diseño, aprobada).
Este documento resuelve las decisiones que faltaban y describe el SQL
draft (`CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0001_auth_profiles_rls_DRAFT.sql`).

**Nada de esto se ejecutó.** Sin SQL corrido, sin Supabase productivo
tocado, sin usuarios Auth creados, sin cambios al login actual, sin
commit.

## 1. Aclaración crítica de RLS — MIGRACIÓN vs. CUTOVER

Postgres combina policies **permisivas** del mismo comando por **OR**.
Mientras exista `"acceso interno con anon key" using(true) with
check(true)` sobre `engrase_sync`, **ninguna** policy nueva —sin importar
qué tan restrictiva sea— reduce el acceso real: `true OR <lo que sea>`
siempre da `true`. Esto no es una suposición, es literalmente cómo
Postgres evalúa RLS.

Por eso este trabajo se divide en dos estados **explícitos y no
ambiguos**, y el SQL draft los marca con comentarios `ESTADO 1/2` y
`ESTADO 2/2`:

| Estado | Policy legacy | Policies nuevas | ¿Protección real? |
|---|---|---|---|
| **MIGRACIÓN** | presente | pueden existir, se pueden probar | **NO** — son inertes mientras la legacy siga ahí |
| **CUTOVER** | eliminada | son la única autoridad | **SÍ** — a partir de este instante |

No se afirma en ningún lado de este documento que exista "RLS paralelo
seguro" durante MIGRACIÓN. El único propósito de la Sección 1-4 del SQL
draft durante MIGRACIÓN es dejar la infraestructura lista y probada
(Etapa C del rollout) para que el CUTOVER (Sección 15 del pedido, gates
abajo) sea un `DROP POLICY` de segundos, no una migración improvisada bajo
presión.

## 2. Usuarios actuales — auditoría productiva de solo-lectura (ya realizada)

Actualizado tras una auditoría real de producción (solo lectura, sin
login, sin `fullSync`, con bloqueo de red para cualquier método ≠ GET —
0 escrituras, 0 PIN leídos/mostrados). Reemplaza la versión anterior de
esta sección, que solo tenía los 4 seeds locales.

**Los 7 usuarios reales de producción:**

| id | name | role | active | cuadrilla | Origen/nota |
|---|---|---|---|---|---|
| `u_admin` | Administrador General | ADMINISTRADOR | true | — | seed, `createdBy:"sistema"`, **re-creado 2026-09-26** (created==updated hoy) |
| `u_lub1` | Junior Lubricador | LUBRICADOR | **false** | `cuad_a` | seed, desactivado 2026-09-25T19:16 |
| `u_mso1a02g4k05ie` | Camioneta Lubrica | LUBRICADOR | true | `""` | creado por "Administrador General", username `80-177` (código de equipo) |
| `u_mu2w78xmok1njx` | Camion Lubrico | LUBRICADOR | true | `""` | creado por "Administrador General", username `"76-08 "` (código de equipo, espacio final) |
| `u_mu2w804yo1n94u` | Planificador | PLANIFICADOR | true | `""` | creado por "Administrador General", nombrado igual que el rol |
| `u_plan` | Ana Planificadora | PLANIFICADOR | **false** | — | seed, desactivado 2026-09-25T19:16 |
| `u_sup` | Carlos Supervisor | SUPERVISOR | **false** | — | seed, desactivado 2026-09-25T19:16 |

**Hallazgo principal: ninguno de los 7 es una persona real identificable.**
Los 4 activos son genéricos (1 bootstrap de sistema, 2 atados a un
vehículo, 1 nombrado igual que su rol); los 3 inactivos son los seeds de
prueba, desactivados todos en el mismo instante. **Duplicado detectado:**
`username` de `u_plan` (`"planificador"`) vs. `u_mu2w804yo1n94u`
(`"Planificador"`) — misma palabra, distinto id, distinta mayúscula.

**Decisión resultante (obligatoria, ya tomada):** **0 de los 7 se migran
directamente a Supabase Auth.** Clasificación final y consecuencias en
§17 ("LEGACY USERS vs AUTH USERS").

## 3. Identificador de login futuro — recomendación

**Opción B — email interno administrado específicamente para la app**
(ej. `<username>@engrase.internal` o dominio equivalente que la operación
controle, NO un correo corporativo real de cada persona).

Razones (para ~100 equipos, pocos usuarios por turno, dispositivos
compartidos):

- Supabase Auth exige un identificador único por cuenta; **email** es el
  método con menos piezas nuevas (no requiere proveedor SMS/OTP, no
  requiere que Cliente configure nada adicional en el proyecto Supabase
  más allá de lo que ya existe).
- **Opción A (email corporativo real)** se descarta: `users` no tiene
  campo email hoy, y no hay garantía de que cada operador/lubricador de
  turno tenga uno gestionado por la empresa — introduciría una
  dependencia externa (IT de la empresa) fuera del control de este
  proyecto.
- **Opción C (teléfono/SMS)** se descarta: requiere configurar un
  proveedor SMS en Supabase (costo recurrente, y cobertura de señal en
  mina es precisamente el problema que la app ya resuelve evitando
  depender de conectividad en el momento crítico) — no justificado para
  el tamaño de este equipo.
- Con Opción B, un administrador puede crear/resetear la password de cada
  cuenta directamente (Supabase Admin API o dashboard), **sin que la
  persona real necesite revisar ningún correo** — la pantalla de login
  sigue mostrando "elegí tu nombre + password/PIN rápido" exactamente
  igual que hoy; el email sintético es un detalle interno de Auth que el
  usuario final nunca ve ni escribe.
- El mapeo `username actual -> email sintético` es determinístico y
  reversible (mismo `username` que ya existe en `users`), no inventa
  nueva información sensible.

**Precisión de UX (confirmada, ejemplo puramente conceptual — nada de
esto se crea todavía):** el operador nunca ve ni escribe un email.

- Usuario ve: campo **Usuario** (ej. `jguerrero`) + campo **Contraseña**.
- Internamente, la app transforma `jguerrero` → `jguerrero@engrase.internal`
  (o el dominio que se decida) antes de llamar a
  `supabase.auth.signInWithPassword()` — una sola línea de mapeo, nunca
  expuesta en la UI.
- La contraseña **nunca** se guarda en IndexedDB ni en `app_profiles` —
  vive únicamente dentro de `auth.users` (gestionado por Supabase Auth,
  con su propio hash server-side).
- **No se asume recuperación por email** (el dominio es sintético, nadie
  revisa esa bandeja) — el reseteo de contraseña es siempre una acción
  administrativa: un `ADMINISTRADOR` la reasigna vía Admin API/dashboard
  de Supabase, nunca un flujo de "olvidé mi contraseña" por correo.
- Las cuentas se administran 100% internamente por el `ADMINISTRADOR` de
  la app — coincide con quién ya administra usuarios hoy (§8).

## 4. Quick unlock vs. autenticación real

Dos capas, nunca mezcladas:

- **AUTH REAL:** Supabase Auth, JWT, única fuente de autoridad para el
  servidor (RLS lee `auth.uid()` vía `current_app_role()`/
  `current_app_active()`, ver SQL draft §2). Vive en el storage propio del
  SDK de Supabase (no en `sessionStorage.engrase_user` como hoy).
- **QUICK UNLOCK (opcional, diseño listo, NO implementado):** PIN corto
  para re-entrar rápido en un dispositivo que YA tiene una sesión Auth
  cacheada y vigente. Diseño concreto:
  - Se activa/valida **solo** si ya existe una sesión Auth restaurable
    (`restoreSession()` del futuro `auth.js`, §10) — nunca sustituye el
    login real, nunca se evalúa si no hay sesión previa.
  - **Hash disponible en el entorno sin librerías nuevas:** Web Crypto
    (`crypto.subtle.digest('SHA-256', ...)`) — disponible tanto en
    navegadores modernos como en el WebView de Capacitor Android (API
    estándar, no requiere plugin nativo).
  - Se guarda `{ saltB64, hashB64 }` por `app_user_id`, generado con
    `crypto.getRandomValues()` para la sal, **en un key nuevo de
    `app_config`** (store LOCAL, nunca sincronizado — mismo patrón ya
    usado para `sync_conflicts`, ver P0-1) — **nunca** en el registro
    `users` (que SÍ sincroniza) ni en ningún payload remoto.
  - Verificar: re-hashear el PIN ingresado con la sal guardada y comparar
    en tiempo constante (`crypto.subtle.digest` + comparación byte a
    byte, no `===` sobre el string) — evita que un PIN incorrecto revele
    información por timing, aunque el riesgo aquí es bajo (ataque
    local, no remoto).
  - Fallo de quick unlock → cae a login real (no bloquea el dispositivo,
    solo pide la password real de Auth de nuevo).
  - Borrar `localStorage`/IndexedDB borra también el quick unlock local —
    fuerza login real de nuevo, nunca "resetea" un PIN hacia un estado
    con más privilegios (el JWT es lo único que otorga permisos; sin él
    cacheado, no hay quick unlock posible en absoluto).
  - Esta pieza SÍ tiene una implementación simple y disponible en el
    entorno (Web Crypto) — no se difiere a una fase posterior por falta
    de herramienta, pero **su código no se escribe en este cierre** (el
    pedido pide diseño, no implementación, en esta vuelta).

## 5. `app_profiles` — por qué NO se agregan `cuadrillaId`/`locationId`

Estructura exacta según SQL draft §1 (`auth_user_id`, `app_user_id`,
`display_name`, `role`, `active`, `created_at`, `updated_at`). Sin
PIN/password.

**Justificación de no agregar columnas de cuadrilla/ubicación:** la
regla real que las necesitaría (`SUPERVISOR` solo administra usuarios
`LUBRICADOR` de su propia cuadrilla, `app.js` L7403-7404) es una
restricción sobre la fila **objetivo** que se está editando (¿el usuario
que estoy editando es LUBRICADOR y está en mi cuadrilla?), no sobre mi
propio perfil de autenticación. Si se implementa a nivel de RLS más
adelante, se resuelve leyendo `payload->>'cuadrillaId'` de la fila de
`engrase_sync` que se intenta escribir (store `users`), no agregando una
columna a `app_profiles`. Por eso el SQL draft deja esa restricción
señalada como pendiente/no-expresable-a-nivel-de-store (comentario en la
fila `('users', 'SUPERVISOR', ...)` de la matriz) en vez de resolverla con
una columna que en realidad no la resolvería.

## 6. Funciones server-side

**Sí, se preparan** — `current_app_role()` y `current_app_active()`,
`SECURITY DEFINER` con `search_path` fijo (`public, pg_temp`), `STABLE`.
Ver SQL draft §2 para el cuerpo exacto y la justificación de por qué
`SECURITY DEFINER` (evita acoplar las policies de `engrase_sync` a las
policies de `app_profiles`) y por qué el `search_path` fijo (mitigación
estándar de Postgres contra *search_path hijacking* en funciones
`SECURITY DEFINER`).

## 7. Matriz RLS exacta — 15 stores × 5 roles

La matriz completa (con `can_read`/`can_insert`/`can_update`/`can_delete`
por store y rol) vive como **datos**, no como SQL de policy, en
`app_store_permissions` dentro del SQL draft §3 — ahí está completa, sin
resumir, las 75 combinaciones. Resumen de las decisiones no triviales:

- **`equipment`/`lubrication_points`/`settings`/`cuadrillas` para
  LUBRICADOR y VISOR:** `false` en todo — ninguna de esas rutas está en
  `PERMISSIONS.LUBRICADOR` ni `PERMISSIONS.VISOR` (`app.js` L1019-1025).
  El LUBRICADOR sigue necesitando **leer** equipment/points/lubricants
  hoy vía el store completo replicado para operar offline — este es
  exactamente el "riesgo de fondo" ya señalado en el diseño (§7 de
  `AUTH_RLS_MIGRATION_DESIGN.md`): RLS por store decide "puede sincronizar
  este store", no "qué filas". **Decisión tomada para este draft:** dado
  que `equipment`/`lubrication_points` no contienen datos sensibles de
  personas (solo catálogo de máquinas), se mantiene su lectura amplia
  para los roles que SÍ los necesitan (ADMIN/PLANIFICADOR/SUPERVISOR) y
  se marca `false` para LUBRICADOR/VISOR **siguiendo estrictamente lo que
  el código de rutas ya impide hoy** — si en la práctica el LUBRICADOR
  necesita leer `equipment` para su flujo de "Mi Turno" (a confirmar en
  Etapa C con pruebas reales), esa fila se cambia a `can_read=true` sin
  tocar ninguna otra — es un `UPDATE` de una fila, no una migración.
- **`anomalies` para PLANIFICADOR:** `false` en todo — confirmado,
  `'anomalias'` no está en `PERMISSIONS.PLANIFICADOR` (a diferencia de la
  lista de roles que SÍ reciben notificaciones de anomalías, que es un
  concepto distinto — recibir un aviso no es lo mismo que tener acceso de
  lectura a la tabla).
- **`audit_log`:** ningún rol lee vía UI hoy (no es una ruta de
  `PERMISSIONS`) — se deja `can_read=true` solo para ADMINISTRADOR (útil
  para diagnóstico futuro desde el dashboard de Supabase) y
  `can_insert=true` para todos los roles autenticados (coincide con
  `logAudit()`, llamado desde cualquier acción de cualquier rol) — nunca
  `can_update`/`can_delete` para nadie: es append-only por diseño de toda
  la app.
- **`push_tokens`:** la matriz por sí sola NO alcanza — falta una
  restricción de "solo mi propio token" (`payload->>'userId'` = mi
  `app_user_id`), señalada explícitamente en el SQL draft como pendiente
  de un `with check` adicional específico de ese store, no genérico.
- **Columnas `can_insert`/`can_update`/`can_delete` separadas aunque hoy
  no haya ningún store/rol donde difieran realmente** (ver comentario en
  el SQL draft §3) — decisión deliberada para no tener que partir el
  esquema después.

## 8. `users`/roles — transición de autoridad

- El `role` **confiable** pasa a `app_profiles.role` (leído vía
  `current_app_role()`). El `role` dentro de `payload` del store `users`
  en `engrase_sync` **sigue existiendo y sincronizándose** — la UI actual
  lo sigue mostrando/editando visualmente sin cambios en Etapa B — pero
  deja de ser la fuente de autoridad: aunque alguien lo edite desde
  DevTools y lo suba, la policy de `engrase_sync` para otros stores
  consulta `app_profiles`, no ese payload. (El propio store `users` sí
  queda protegido por su fila en la matriz — ver §7 — pero la protección
  real de "puedo escribir ESTE payload de rol" vive en `app_profiles`, no
  en `engrase_sync`.)
- Un LUBRICADOR no puede ascenderse/activar-desactivar/cambiar rol de
  otro: la policy `UPDATE` de `app_profiles` (SQL draft §1) exige
  `role='ADMINISTRADOR' and active` del que llama, y además prohíbe
  tocar la propia fila incluso siendo admin.
- Un VISOR no puede escribir: confirmado en la matriz, `can_insert=
  can_update=can_delete=false` en las 15 filas de VISOR salvo
  `push_tokens` (recibir push no es "escribir datos de negocio").
- **Quién administra perfiles: solo ADMINISTRADOR** — decisión tomada
  siguiendo la preferencia inicial indicada en el pedido, sin
  alternativa propuesta (no hace falta un rol "gestor de usuarios"
  separado para el tamaño de este equipo).

## 9. `createdBy`/`userId`/similares — auditoría de campos

| Campo | Store(s) | Tipo de dato real | A/B |
|---|---|---|---|
| `createdBy` | todos (via `stamp()`, `db.js` L168) | **nombre** (string humano, `App.currentUser.name`) | A — descriptivo/auditoría |
| `userId` (push_tokens) | `push_tokens` | id de `users` (`App.currentUser.id`), `app.js` L665 | B — se usa para "es mi propio token", necesita protección real (§7) |
| `userId` (lubrication_records) | `lubrication_records` | id de `users`, **pero seleccionable por el propio cliente** en el flujo "retroactivo" (`fd.retroUser`, `app.js` L5130-5137) | A — es un dato de atribución de negocio (quién hizo el trabajo), NO evidencia de identidad del que está logueado ahora; ya es, por diseño, un campo que un usuario autorizado puede asignar a OTRO |
| `userId` (grease_drafts) | `grease_drafts` | id de `users`, `app.js` L4954 | N/A — store LOCAL, nunca sincroniza |

**Conclusión:** ningún campo dentro de `payload` puede usarse hoy como
evidencia fuerte de "quién está autenticado ahora" — todos son
client-writable por definición (jsonb sin restricción de columna). La
autorización real debe apoyarse **siempre** en `auth.uid()` vía
`current_app_role()`/`current_app_active()`, nunca en
`payload->>'userId'`/`payload->>'createdBy'`.

**Propuesta a futuro (NO implementada) para auditoría fuerte:** si se
necesita alguna vez poder demostrar "esta fila la escribió realmente el
dispositivo autenticado como tal persona" (más allá de lo que el cliente
declara en el payload), la única forma confiable es un trigger
`BEFORE INSERT OR UPDATE` en `engrase_sync` que escriba
`auth.uid()`/`current_app_role()` en columnas reales de la tabla (no en el
jsonb) — quedaría fuera del payload editable por el cliente. Señalado
como posible trabajo de una fase posterior, no de este cierre.

## 10. Cliente — API pública futura de `src/core/auth.js` (diseño, sin implementar)

**No se crea el archivo en este cierre** (el pedido de creación de
archivos, Sección 14, solo lista los 2 documentos/SQL de este plan) — se
deja la API definida para cuando corresponda implementarlo:

```
signIn(identifier, password)   -> { user, session } | throws AuthError
signOut()                      -> void (limpia sesión Auth + quick unlock local)
restoreSession()               -> { user, session } | null   (al boot, sin red si hay caché válido)
getSession()                   -> Session | null              (síncrono, del estado en memoria)
getProfile()                   -> { role, active, appUserId } | null   (de app_profiles, con caché local)
isAuthenticated()               -> boolean
onSessionChange(fn)             -> void   (mismo patrón que Sync.onChange(), para que app.js reaccione)
```

**Dependencias:** el SDK `@supabase/supabase-js` (o llamadas REST
directas a `/auth/v1/*`, consistente con que `sync.js` ya habla PostgREST
crudo sin SDK — decisión de Etapa B, no de este documento) + acceso a
`DB` (para el quick unlock local, §4) + un evento que `app.js` pueda
escuchar para re-renderizar el shell cuando la sesión cambia (logout
remoto, expiración, cambio de rol al reconectar).

## 11. `sync.js` — separar 401/403 del CAS de P0-1 (diseño, sin implementar)

Hoy `pushAll()`/`pullAll()` solo distinguen "ok" vs. "no ok" genérico
(`if (!resp.ok) throw ...`). El ajuste futuro necesario:

| Código | Significado | Tratamiento |
|---|---|---|
| `200` con 0 filas (PATCH) | CAS de P0-1: la base ya cambió | conflicto de **versión** — comportamiento actual, sin cambios |
| `200` con 0 filas (POST ignore-duplicates) | CAS de P0-1: id ya existe | conflicto de **creación** — comportamiento actual, sin cambios |
| `401` | Sesión inválida/expirada/no autenticada | **detener** el ciclo de sync completo (no solo ese store), **no** registrar como conflicto, conservar todo el trabajo local dirty tal cual, disparar `onSessionChange` para que la UI pida re-login |
| `403` | RLS rechazó (rol sin permiso para ese store, o usuario inactivo) | registrar como **error de autorización** (nuevo tipo, distinto de `conflicts`), conservar dirty local, **no** reintentar automáticamente en el próximo ciclo de 20s (evitar loop de 403 infinito) hasta que cambie la sesión/perfil |
| `409`/0 filas CAS | conflicto de concurrencia real (P0-1) | sin cambios |

**Por qué separarlos es obligatorio:** un 403 y "0 filas por CAS" ambos
podrían, sin este ajuste, caer en la misma rama `if (!resp.ok)` y
tratarse como el mismo tipo de error — pero un 403 significa "este rol
nunca podrá escribir aquí, reintentar es inútil hasta que cambie el
rol/estado", mientras que un conflicto CAS significa "reintentará solo en
cuanto se resuelva la divergencia de versión". Mezclarlos generaría
reintentos infinitos e inútiles cada 20 segundos para el caso 403.

## 12. Offline — estados y transiciones

| Estado | Trabajo local | Sync |
|---|---|---|
| ONLINE + Auth OK | permitido | permitido, normal |
| OFFLINE + sesión previamente válida (JWT cacheado, no expirado) | permitido | pendiente, en cola |
| RECONNECT | permitido | **primero** refrescar sesión + releer `app_profiles` propio, **después** `fullSync()` — nunca sync con una sesión que no se intentó refrescar primero |
| Usuario desactivado (detectado al reconectar, `current_app_active()=false` -> 403) | trabajo YA hecho se conserva íntegro en IndexedDB | se **detiene** de intentar subir nada nuevo; se muestra aviso/bloqueo en la UI (a diseñar en Etapa B) |
| Rol cambiado mientras offline | sin cambio retroactivo sobre lo ya hecho | al reconectar, el cliente relee su propio perfil y actualiza `App.currentUser.role` local — la UI pasa a reflejar el rol nuevo desde ese momento, no antes |
| JWT expirado estando offline | **se permite seguir capturando localmente** (nunca se bloquea el trabajo de campo por esto) | **no** sync hasta renovar sesión exitosamente |
| Cualquier estado sin sesión válida | — | **nunca** cae a la anon key como respaldo silencioso — si no hay sesión, el ciclo de sync se abstiene por completo (no pushea, no pullea), no reintenta con otra credencial |

## 13. Bootstrap inseguro — ubicaciones exactas (marcadas para Etapa E, NO tocadas ahora)

- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/db.js`, función `seedIfEmpty()`
  (bloque `users_seed`, dentro de la función que arranca cerca de la
  línea 207 según la última lectura completa de este archivo): 4 usuarios
  con PIN hardcodeado `1111`/`2222`/`3333`/`4444`.
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/db.js`, función
  `seedSoloUsuarioInicial()` (justo antes de `seedIfEmpty()` en el mismo
  archivo): usuario temporal `u_admin` / PIN `1111`.
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js`, `renderLogin()`
  (~L1557-1650): la comparación `pin === selected.pin` en texto plano es,
  en sí misma, el "bootstrap inseguro" activo — no es solo el dato semilla,
  es el mecanismo de verificación completo.
- **No se elimina nada de esto en este cierre** — hacerlo ahora rompería
  el login actual antes de que exista ningún reemplazo (Etapa B). Queda
  marcado para Etapa E del rollout (`docs/AUTH_RLS_MIGRATION_DESIGN.md`
  §12), después de que el cutover ya esté en producción y validado.
- **Ahora es, además, un gate OBLIGATORIO de cutover** (agregado a §15):
  antes de retirar la policy legacy, deben eliminarse las 3 piezas de
  arriba (bootstrap de `seedIfEmpty()`, bootstrap de
  `seedSoloUsuarioInicial()`, comparación `pin ===` como autoridad) — de
  lo contrario, aunque RLS ya esté activo en el servidor, cualquier
  dispositivo nuevo (o reinstalado) seguiría pudiendo "entrar" localmente
  como `u_admin`/PIN `1111` sin ninguna sesión Auth real, aunque luego no
  logre sincronizar nada — sigue siendo una superficie de confusión/riesgo
  que no debe sobrevivir al cutover.

## 14. Archivos creados en este cierre

- `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` (este archivo).
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0001_auth_profiles_rls_DRAFT.sql`
  (encabezado `-- DRAFT — DO NOT APPLY TO PRODUCTION YET`, sin secretos,
  sin ejecutar contra ningún Supabase).
- `docs/AUTH_USERS_ROLLOUT_TEMPLATE.md` (plantilla vacía para altas
  futuras de personas reales, ver §20).

`schema.sql` productivo **no se modificó**. Ningún archivo `.js` del
cliente se tocó.

## 15. Gates de cutover (todos deben estar en PASS antes de correr la Sección "CUTOVER" del SQL draft)

- [ ] Auth funciona en Web (login real, sesión persistida, logout).
- [ ] Auth funciona en Android/Capacitor (mismo flujo, WebView).
- [ ] Login real con las 7 cuentas reales migradas (o el subconjunto que
  corresponda tras auditar producción — ver §2) — PASS.
- [ ] Offline: captura local sin red, con sesión previa válida — PASS.
- [ ] Reconexión: refresca sesión, releer perfil, luego sync — PASS.
- [ ] CAS de P0-1 (PATCH condicionado / POST ignore-duplicates) sigue
  devolviendo 0/1 fila correctamente bajo JWT real, no solo bajo anon key
  — PASS.
- [ ] Cada rol (ADMINISTRADOR/PLANIFICADOR/SUPERVISOR/LUBRICADOR/VISOR)
  probado contra la matriz completa de §7 — PASS.
- [ ] Usuario inactivo bloqueado en todos los stores — PASS.
- [ ] `anon` SELECT sobre `engrase_sync` → DENIED.
- [ ] `anon` INSERT/UPDATE sobre `engrase_sync` → DENIED.
- [ ] Storage (`engrase-photos`) — explícitamente **fuera de alcance del
  cutover de P0-2**, se resuelve en P0-3; su estado actual (público) no
  bloquea este cutover pero queda pendiente después.
- [ ] Rollback probado en un entorno de prueba (re-crear la policy legacy
  y confirmar que el cliente viejo vuelve a funcionar sin cambios).
- [ ] **Bootstrap inseguro eliminado** (§13): `seedIfEmpty()` y
  `seedSoloUsuarioInicial()` ya no generan usuarios con PIN default
  (`1111`/`2222`/`3333`/`4444`), y la comparación `pin === selected.pin`
  ya no es la autoridad de acceso (reemplazada por Auth real + quick
  unlock opcional, §4).
- [ ] **Ninguna de las 7 cuentas legacy productivas recibió login Auth**
  (§17) — confirmado antes del cutover, no solo antes de crear
  `app_profiles`.

Sin los 14 ítems en PASS, no se ejecuta la Sección "CUTOVER" del SQL
draft bajo ninguna circunstancia.

## 16. Regla de identidad — AUTH USER = persona real

**Definición formal, sin ambigüedad:**

> **AUTH USER** = una persona real que usa Control de Engrase. Un
> auth user siempre corresponde a exactamente una persona; una persona
> puede trabajar desde distintos dispositivos/equipos/turnos sin que eso
> cambie su identidad Auth.

**NO pueden ser Auth users** (lista cerrada, cualquier caso nuevo que
encaje en este patrón se trata igual sin pedir excepción):

- un vehículo/equipo (ej. "Camioneta Lubrica", "Camión Lubrico 76-08", o
  cualquier nombre/código de equipo).
- una cuadrilla o un turno.
- una cuenta genérica nombrada igual que un rol (ej. "Planificador",
  "Supervisor", "Administrador General").
- una cuenta seed/bootstrap/de prueba del propio sistema.

Esta regla es la que resuelve por qué **0 de los 7 usuarios productivos
actuales** se migran directamente (ver §17) — todos encajan en alguna de
estas categorías prohibidas, no en "persona real".

## 17. LEGACY USERS vs. AUTH USERS — clasificación final y decisión

**Decisión adoptada:** las cuentas históricas compartidas se conservan
para referencias históricas, pero **no reciben identidad Auth**. Ninguna
de las 7 se activa, se borra ni se reescribe en este cierre.

| id | Nombre | Clasificación final | Login futuro |
|---|---|---|---|
| `u_admin` | Administrador General | `LEGACY_SHARED` | NO LOGIN FUTURO |
| `u_lub1` | Junior Lubricador | `TEST_SEED` | NO LOGIN FUTURO |
| `u_mso1a02g4k05ie` | Camioneta Lubrica | `LEGACY_OPERATIONAL_ALIAS` | NO LOGIN FUTURO |
| `u_mu2w78xmok1njx` | Camion Lubrico | `LEGACY_OPERATIONAL_ALIAS` | NO LOGIN FUTURO |
| `u_mu2w804yo1n94u` | Planificador | `LEGACY_SHARED` | NO LOGIN FUTURO |
| `u_plan` | Ana Planificadora | `TEST_SEED` | NO LOGIN FUTURO |
| `u_sup` | Carlos Supervisor | `TEST_SEED` | NO LOGIN FUTURO |

Ninguno se borra todavía (ni se activa/desactiva) — permanecen tal cual
en `users`/`engrase_sync` para que el historial (§18) siga siendo legible.
`app_profiles` (SQL draft) **no inserta ninguna fila para estos 7** —
confirmado también como comentario dentro del propio archivo SQL.

## 18. Histórico — los nombres legacy se preservan tal cual

Los registros ya existentes (`lubrication_records.userId/userName`,
`createdBy` en cualquier store, `grease_validations.signerName`, etc.)
que hoy apuntan a `u_admin`/`u_mso1a02g4k05ie`/`u_mu2w804yo1n94u`/etc., o
que muestran los nombres "Camioneta Lubrica", "Planificador",
"Administrador General", **se dejan exactamente como están**:

- **No se reescribe** ningún `createdBy`/`userId` antiguo.
- **No se intenta atribuir retroactivamente** un registro histórico a una
  persona real — si el dato original dice "Camioneta Lubrica", ese sigue
  siendo el nombre que el Historial/Reportes muestra para ese registro
  viejo, indefinidamente.
- Esto es consistente con cómo ya funciona el resto de la app: `createdBy`
  siempre fue una foto del nombre en el momento de crear el registro
  (`stamp()`, `db.js` L168), nunca una referencia viva — migrar la
  identidad futura no cambia ese contrato para lo ya escrito.

## 19. Persona vs. recurso operativo — dónde vive cada cosa (sin store nuevo)

La separación que pide la Sección 6 del pedido **ya existe
estructuralmente** en el modelo de datos actual — el problema de las 7
cuentas legacy fue de *proceso* (usar un "usuario" para representar un
camión), no de falta de un lugar donde guardar la relación real:

- **Identidad (persona):** futuro `app_profiles`/`users.id` real.
- **Rol:** `app_profiles.role` (autoridad) / `users.role` (display).
- **Recurso operativo (vehículo/equipo):** ya vive en el store
  `equipment` (catálogo de máquinas, con su propio `id`/código — los
  mismos códigos `80-177`/`76-08` que hoy están mal ubicados como
  `username` de una cuenta de usuario). `lubrication_records` /
  `lubrication_points` ya referencian esto vía `equipmentId` — un campo
  **separado** de `userId`, ya presente hoy.
- **Cuadrilla/turno (contexto):** ya viven en `cuadrillas` (store propio)
  y `shiftId` (campo ya presente en `lubrication_records` y en
  `users.cuadrillaId`).
- **Conclusión:** una vez que existan personas reales en Auth, un
  `lubrication_record` queda como: `userId` = la persona real que hizo el
  trabajo, `equipmentId` = el vehículo/máquina (ya existente), `shiftId` =
  el turno (ya existente) — **exactamente la forma que el store ya tiene
  hoy**, solo que hoy `userId` apunta, por error de proceso, a una cuenta
  que en realidad describe el vehículo. No se necesita ningún store
  nuevo ni columna nueva para esta separación.

## 20. Trazabilidad futura y plantilla de altas

Para `lubrication_records`/`grease_validations` nuevos, una vez migrado:

- `app_user_id` (persona real) — autoridad de "quién es", nunca el nombre
  mostrado.
- `display_name` snapshot (igual que `createdBy` hoy) — solo descriptivo,
  ver §9/§18.
- `equipmentId`/`cuadrillaId`/`shiftId` — contexto operativo, ya separado
  (§19).
- `auth.uid()` server-side en auditoría fuerte — sigue siendo la
  propuesta a futuro de §9 (trigger `BEFORE INSERT/UPDATE`), no
  implementada.
- **La autorización nunca depende del nombre mostrado** — ya es así hoy
  (§9) y sigue siéndolo con Auth real: siempre `auth.uid()` vía
  `current_app_role()`/`current_app_active()`.

**Plantilla para altas futuras:** `docs/AUTH_USERS_ROLLOUT_TEMPLATE.md`
(archivo nuevo, tabla vacía, sin nombres inventados) — columnas
`app_user_id, display_name, username/login_alias, role, active,
auth_identifier, auth_user_id`, sin ningún campo de password.
