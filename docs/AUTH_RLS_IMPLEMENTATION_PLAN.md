# HISTORICAL / DEPRECATED — plan de rollout conservado para auditoría.
# Las menciones a PIN/Quick Unlock, auth legacy y policies abiertas describen
# fases anteriores; no son instrucciones operativas actuales.

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

**Sesión posterior (Pre-flight, ver §21/§22) agregó además:**

- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/auth.js` (nuevo —
  implementación real del adapter, detrás de `AUTH_MODE='legacy'`).
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0002_auth_profiles_rls_PREPARED.sql`
  (encabezado `-- PRE-CUTOVER: legacy policy remains intentionally
  active` — versión lista para producción de la fase 1/2 de `0001`, sin
  la sección CUTOVER; tampoco se ejecutó contra ningún Supabase).
- `tests/unit/auth.test.js`, `tests/unit/sync-auth-gate.test.js` (mocks,
  nunca contra producción).

`schema.sql` productivo **no se modificó**. Ningún dato ni Auth user real
se creó — todo quedó en código/tests/migraciones sin ejecutar.

## 15. Gates de cutover (todos deben estar en PASS antes de correr la Sección "CUTOVER" del SQL draft)

- [ ] Auth funciona en Web (login real, sesión persistida, logout) —
  **PARCIAL**: login real contra Supabase confirmado por el usuario desde
  `npm run dev` (localhost) el 2026-10-02 — logout/sesión-persistida en
  Web específicamente NO se confirmaron por separado todavía. El sitio
  público desplegado (`junivalles-cmd.github.io`) sigue devolviendo 404 de
  GitHub Pages (reverificado 2026-10-02 tras un intento de re-publicar) —
  el usuario dijo haberlo subido, pero la lectura pública sigue sin verlo;
  pendiente de que el usuario confirme en GitHub (Settings → Pages: repo
  público, rama/carpeta correcta, build sin errores) antes de poder marcar
  este gate completo.
- [x] Auth funciona en Android/Capacitor (mismo flujo, WebView) — **PASS,
  2026-10-02**, confirmado por el usuario en dispositivo real (serial
  `99FQVGVWRW795LW4`, build del mismo día reinstalado antes de la prueba):
  logout real (vuelve a pedir credencial completa, no Quick Unlock) y
  cambio de usuario en el mismo dispositivo (sin mezclar datos del usuario
  anterior) — ambos PASS.
- [x] Login real con las 7 cuentas reales migradas (o el subconjunto que
  corresponda tras auditar producción — ver §2) — **esta línea estaba mal
  redactada/obsoleta** (encontrado 2026-10-02, releyendo el propio plan):
  §2/§17 ya decidieron, desde el inicio, que **0 de las 7 cuentas legacy
  se migran** (congeladas como `LEGACY_SHARED`/`TEST_SEED`/
  `LEGACY_OPERATIONAL_ALIAS`, sin login futuro, decisión ya tomada y
  documentada). El "subconjunto que corresponda" ya ocurrió por otra vía:
  3 cuentas Auth NUEVAS y reales (ADMINISTRADOR/LUBRICADOR/SUPERVISOR,
  parte 2026-09-30 del handoff) — exactamente los roles que el plan exige
  para operar el teléfono en el pit. PLANIFICADOR/VISOR sin cuenta real
  todavía, pero el plan nunca los exigió para este gate.
- [x] Offline: captura local sin red, con sesión previa válida — **PASS**,
  ya confirmado por el usuario en dispositivo real el 2026-09-30 (parte
  11 del handoff) — esta casilla nunca se había marcado.
- [x] Reconexión: refresca sesión, releer perfil, luego sync — **PASS,
  2026-10-02**, confirmado por el usuario en el mismo dispositivo Android
  (modo avión → reconectar, sin pedir login de nuevo, sin quedar pegado en
  offline).
- [ ] CAS de P0-1 (PATCH condicionado / POST ignore-duplicates) sigue
  devolviendo 0/1 fila correctamente bajo JWT real, no solo bajo anon key
  — PASS. Cubierto a nivel de código/tests (`sync-auth-gate.test.js`,
  escenario G — JWT real simulado, nunca anon key) y el fix de código real
  de `pushAll()`/JWT (commit `4645e31`, 2026-09-27) — **sin una prueba
  contra producción real todavía**, por eso sigue sin marcar.
- [ ] Cada rol (ADMINISTRADOR/PLANIFICADOR/SUPERVISOR/LUBRICADOR/VISOR)
  probado contra la matriz completa de §7 — PASS. **BLOQUEADO, no por
  falta de prueba sino por diseño**: mientras la policy legacy de
  `engrase_sync` siga activa (0003 sin aplicar), CUALQUIER rol pasa
  CUALQUIER prueba — Postgres combina policies permisivas por OR, así que
  este gate es literalmente imposible de evaluar con sentido hasta que
  0003 se aplique. No tiene caso intentarlo antes.
- [ ] Usuario inactivo bloqueado en todos los stores — PASS. **Mismo
  bloqueo de diseño que el ítem de arriba**: `current_app_active()` ya
  está en las 3 policies de `engrase_sync` (0002), pero mientras la
  legacy siga activa no hay forma de observar un DENY real — se evalúa
  junto con el punto anterior, después de 0003.
- [ ] `anon` SELECT sobre `engrase_sync` → DENIED.
- [ ] `anon` INSERT/UPDATE sobre `engrase_sync` → DENIED.

  **Guión preparado para estos 4 gates (2026-10-02, NO ejecutado):**
  `tools/verify-rls-matrix.mjs` — parsea la matriz REAL directo de
  `0002_auth_profiles_rls_PREPARED.sql` (nunca una copia a mano, cero
  riesgo de que se desactualice), prueba SELECT por rol contra stores con
  datos reales conocidos, y opcionalmente (`--write`) INSERT/UPDATE con
  limpieza inmediata (soft-delete) de cualquier fila de prueba. Corre
  SOLO con JWTs reales pasados por variable de entorno — nunca
  hardcodeados, nunca pedidos por este script a Claude. Se salta con
  aviso cualquier rol sin cuenta real todavía (hoy: PLANIFICADOR, VISOR,
  y no existe ninguna cuenta inactiva real para ese gate). **Correrlo
  ANTES de 0003 da falsos positivos (ver el encabezado del archivo) — es
  para usarse DESPUÉS, cuando 0003 esté autorizado y aplicado.**
- [ ] Storage (`engrase-photos`) — explícitamente **fuera de alcance del
  cutover de P0-2**, se resuelve en P0-3; su estado actual (público) no
  bloquea este cutover pero queda pendiente después.
- [ ] Rollback probado en un entorno de prueba (re-crear la policy legacy
  y confirmar que el cliente viejo vuelve a funcionar sin cambios).
- [x] **Bootstrap inseguro eliminado** (§13) — **PASS, verificado por
  código el 2026-10-02** (`db.js`): `seedSoloSiElSistemaEstaVacio()`,
  `seedSoloUsuarioInicial()` y `seedIfEmpty()` tienen guard
  `isSupabaseAuthMode()` en los 3 (el 2do y 3ro lo tienen ADEMÁS como
  defensa propia, no solo confiando en el llamador) — con
  `AUTH_MODE='supabase'` (default actual del código), ninguno de los 4
  usuarios/PIN semilla (`1111`/`2222`/`3333`/`4444`) se crea jamás.
  `pin === selected.pin` (`app.js` L2180) vive dentro de `renderLogin()`,
  que ya es inalcanzable con `AUTH_MODE='supabase'` — `boot()` (L1813-1814)
  llama `renderAuthGateSupabase()` en su lugar. Esta rama queda como
  código muerto en la práctica mientras el flag siga en `'supabase'`.
- [ ] **Ninguna de las 7 cuentas legacy productivas recibió login Auth**
  (§17) — confirmado antes del cutover, no solo antes de crear
  `app_profiles`.
- [x] **`pushAll()`/`pullAll()` usan el `accessToken` real de la sesión (no
  `cfg.anonKey`) cuando `Auth.isSupabaseMode()` es `true`** — detectado en
  §23 (sesión 2026-09-27), **corregido el mismo día** (§24): `syncAuthHeaders()`
  en `sync.js` es ahora la única fuente del header `Authorization` de toda
  request a `engrase_sync`. En `'legacy'` sigue igual que antes (sin cambios).

Sin los 15 ítems en PASS, no se ejecuta la Sección "CUTOVER" del SQL
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

## 21. Sesión Auth persistida — auditoría y diseño final (Pre-flight)

**Auditoría de `src/core/auth.js` (implementado, no solo diseñado):**

- **`access_token`/`refresh_token`/`expires_at`:** viven SOLO en
  `DB.getAuthTokens()`/`setAuthTokens()` — un blob nuevo,
  namespace **separado** del perfil (ver abajo), bajo `app_config` (key
  `auth_tokens`, `LOCAL_STORES`, nunca sincroniza — nunca viaja por
  `pushAll()`/`pullAll()`, confirmado por auditoría de código: `STORES`
  no incluye `app_config`).
- **`restoreSession()`:** lee `DB.getAuthTokens()` primero. Si el token
  sigue vigente (`Date.now() < expiresAt`), restaura sin ninguna llamada
  de red — **sobrevive cerrar/reabrir el navegador o la app Android**,
  porque `app_config` es IndexedDB real (persiste entre reinicios, a
  diferencia de `sessionStorage`/memoria). Si expiró: con red, refresca
  sesión Y perfil ANTES de devolver nada usable; sin red, deja el
  snapshot de perfil disponible para UX pero `isAuthenticated()` da
  `false` (ver siguiente punto).
- **`signOut()`:** borra los DOS namespaces (`setAuthTokens(null)` +
  `setAuthProfileSnapshot(null)`) — nunca deja un snapshot de perfil vivo
  sin sesión detrás.
- **Refresh de token:** `_refreshSession()` hace
  `POST /auth/v1/token?grant_type=refresh_token`. Si falla, `restoreSession()`
  hace `signOut()` (limpia todo) y devuelve `null` — nunca fallback a
  anon, nunca inventa una sesión. `Sync.fullSync()` ahora llama
  `Auth.restoreSession()` **antes** de `pushAll()`/`pullAll()` cuando
  `Auth.isSupabaseMode()` es cierto (inerte en `AUTH_MODE='legacy'`); si
  tras eso `Auth.isAuthenticated()` sigue en `false`, `fullSync()` corta
  con `status:'AUTH_REQUIRED'` sin tocar la red de sync en absoluto.
- **`onAuthStateChange()`:** notifica `signed_in`/`signed_out`/
  `restored`/`pending_validation` — mismo patrón que `Sync.onChange()`.
- **Corrección de esta vuelta:** `isAuthenticated()` ahora exige además
  `Date.now() < expiresAt` (antes solo miraba que hubiera un
  `accessToken` presente, sin importar si ya había vencido). Sin este
  fix, un token vencido en caché habría dejado creer que `sync.js` podía
  escribir, y el 401 real solo se habría descubierto después de gastar
  una llamada de red — con el fix, el gate de `sync.js` corta ANTES de
  tocar la red. Esto es exactamente lo que separa "captura local
  permitida" (`getProfile()` sigue disponible) de "sync bloqueado"
  (`isAuthenticated()` da `false`).
- **Password:** nunca se persiste en ningún lado — `signIn(username,
  password)` la usa solo dentro del `body` del `POST /auth/v1/token`, no
  queda en ningún campo de `_session`/`_profile` ni en storage. Confirmado
  con test dedicado (`tests/unit/auth.test.js`, B).
- **Requisitos del pedido, todos confirmados por auditoría + tests:**
  password nunca persistida; tokens nunca dentro de `users`/`engrase_sync`
  (estructuralmente imposible: solo `app_config` los toca, y ese store no
  está en `STORES`); tokens nunca en logs (ningún `console.*` de
  `auth.js` imprime `_session`/tokens, solo status codes); tokens solo en
  storage LOCAL no sincronizado; logout borra tokens; snapshot de perfil
  offline NO equivale a token válido (namespaces separados +
  `isAuthenticated()` exige ambos); sesión expirada offline permite
  captura local pero no sync.

**Storage local — namespace separado (Sección 3 del pedido):**

| Key en `app_config` | Contenido | Sensibilidad |
|---|---|---|
| `sync` (ya existía) | URL/anon key/cursores de sync | anon key pública |
| `sync_conflicts` (P0-1) | metadata de conflictos, sin payload | baja |
| **`auth_tokens`** (nuevo) | `accessToken`/`refreshToken`/`expiresAt`/`authUserId` | **alta — credenciales** |
| **`auth_profile_snapshot`** (nuevo) | `displayName`/`role`/`active`/`lastVerifiedAt` | baja — solo UX offline |

**`DB_VERSION` no cambió (sigue 6)** — mismo patrón que
`sync_conflicts` en P0-1: son keys nuevas dentro del store `app_config`
ya existente, no un store nuevo ni un cambio de schema de IndexedDB. No
hizo falta detenerse a pedir DB_VERSION 7.

## 22. Junior Valles — piloto (pasos manuales, NO ejecutados por Claude)

Documentado para cuando el usuario decida avanzar — nada de esto se
ejecutó en este cierre:

| Campo | Valor |
|---|---|
| Nombre | Junior Valles |
| Username | `jvalles` |
| Rol | `ADMINISTRADOR` |
| Auth identifier interno | `jvalles@engrase.internal` |
| Estado | **PENDIENTE DE CREACIÓN** |

**Pasos manuales futuros (fuera de este chat):**

1. El usuario crea la cuenta en el Dashboard de Supabase (Authentication →
   Users → Add user), con email `jvalles@engrase.internal` — **el
   password lo define el propio usuario directamente ahí, nunca se
   comparte con Claude, nunca queda en el repo ni en ningún archivo**.
2. El usuario copia el `auth.uid()` (UUID) que Supabase genera para esa
   cuenta.
3. Con ese UUID, se crea manualmente (o Claude prepara el `INSERT` exacto
   cuando el usuario lo pida, en un turno posterior) la fila en
   `app_profiles`: `auth_user_id=<ese UUID>`, `app_user_id='u_jvalles'`
   (nuevo, no reutiliza ningún id legacy — ver §17),
   `display_name='Junior Valles'`, `role='ADMINISTRADOR'`, `active=true`.
4. Nada de esto activa `AUTH_MODE='supabase'` por sí solo — ese cambio de
   flag es una decisión aparte, posterior, y sigue sin tocarse en este
   cierre.

## 23. Auditoría del gate de sync sin login — cierre P0-2 (sesión 2026-09-27)

Junior Valles ya existe como cuenta real (§22 completado en sesión posterior),
`manage-users` ya está desplegada y `LIST_USERS` verificado en vivo (ver
`docs/SESSION_HANDOFF.md`). Esta sección responde a una pregunta distinta:
**¿por qué `fullSync()` puede escribir en `engrase_sync` sin que nadie haya
hecho login, y ese comportamiento cambia con `AUTH_MODE='supabase'`?**

**Causa exacta del sync sin login en `AUTH_MODE='legacy'` (comportamiento
actual, productivo):**
- `Sync.startAuto()` (`app.js` ~L1315) se llama de forma incondicional en el
  arranque de la app, ANTES de comprobar si hay una sesión PIN guardada
  (`sessionStorage.getItem('engrase_user')`, L1318-1324). No depende de
  `App.currentUser`.
- `startAuto()` llama `fullSync()` de inmediato y luego cada 20s
  (`setInterval`), además de en cada reconexión y `visibilitychange`.
- `fullSync()`/`pushAll()`/`pullAll()` (`sync.js`) solo activan el gate de
  Auth cuando `Auth.isSupabaseMode()` es `true` (líneas ~263, ~404, ~515).
  En `'legacy'` esa condición es siempre `false`, así que el gate ni se
  evalúa — el flujo sigue exactamente igual que antes de que existiera P0-2.
- Las requests a `/rest/v1/engrase_sync` siempre usan `cfg.anonKey` como
  `apikey`/`Authorization: Bearer` (la misma clave para toda la app,
  guardada una vez en `DB.getConfig()`), nunca un token por-persona. Como la
  policy legacy de Postgres es `using(true)/with check(true)` (totalmente
  permisiva para cualquiera con esa key), la request siempre se acepta.
- **Conclusión:** el login PIN nunca fue una frontera de autenticación real
  de red — es un gate puramente local/cosmético (qué pantallas se muestran,
  qué nombre queda en el log de auditoría). Esto es el diseño legacy
  conocido, no un bug nuevo. **Es deuda temporal pre-cutover**: desaparece
  quien la exige (la policy legacy + el anon key compartido), y desaparecerá
  formalmente cuando se ejecute el CUTOVER (§15) y se cierre esa policy —
  hasta entonces, sync anónimo con la anon key sigue siendo, por diseño, el
  único camino disponible en `'legacy'`.

**Comportamiento en `AUTH_MODE='supabase'` — YA implementado correctamente,
verificado con tests nuevos, SIN cambio de código necesario:**
El gate de `fullSync()`/`pushAll()`/`pullAll()` + `Auth.restoreSession()`/
`isAuthenticated()` (`src/core/auth.js`, `sync.js`, construido en la sesión de
`5f25806`/`96759ba`) ya cumple exactamente la regla pedida — "antes de
cualquier request remoto: sesión válida → perfil válido → active=true → solo
entonces sync; si no, `AUTH_REQUIRED`, 0 requests; nunca fallback anon".
Verificado en `tests/unit/sync-auth-gate.test.js` (bloques `A)`-`M)`, 13 tests,
4 nuevos en el bloque `N)` de esta sesión) + `tests/unit/auth.test.js`
(bloques `E`-`G`, `O`):

| Escenario del pedido | Resultado | Evidencia |
|---|---|---|
| A) app nueva, nunca hubo sesión, varios ciclos | 0 requests, `AUTH_REQUIRED` | `sync-auth-gate.test.js` N)A |
| B) offline con snapshot vencido | 0 requests, `offline` (corta antes de mirar Auth) | `sync-auth-gate.test.js` N)B |
| C) Junior autenticada, perfil activo | pull/push permitidos, `ok` | `sync-auth-gate.test.js` N)C |
| D) logout, varios ciclos siguientes | 0 requests, `AUTH_REQUIRED` | `sync-auth-gate.test.js` N)D |
| E) sesión expirada, refresh falla | 0 requests de sync, `signOut()`, dirty local intacto | `sync-auth-gate.test.js` G), `auth.test.js` G) |
| F) sesión válida, pull completo | 0 echo-writes (P0-1 ya cubierto aparte) | `sync-auth-gate.test.js` L) |
| G) CAS de P0-1 bajo `authenticated:true` | sigue en PASS, nunca se confunde con 401/403 | `sync-auth-gate.test.js` L) |

**Sin cambio de código en este cierre** — la implementación de `AUTH_MODE=
'supabase'` ya era correcta; el hallazgo del sync-sin-login se explica
enteramente por el modo `'legacy'` (documentado arriba), que sigue siendo el
modo activo por diseño mientras dure el pre-cutover.

**Gap real detectado, fuera de alcance de este cierre (NO corregido, solo
señalado):** incluso con `Auth.isSupabaseMode()` activo y una sesión válida,
`pushAll()`/`pullAll()` siguen enviando `cfg.anonKey` como
`Authorization: Bearer` hacia `/rest/v1/engrase_sync` — nunca el
`accessToken` real de la sesión (`Auth.getSession().accessToken`). Hoy esto
es inofensivo porque la policy legacy permisiva sigue abierta y acepta la
anon key igual. Pero **una vez cerrada esa policy en el CUTOVER, este mismo
código dejaría de poder sincronizar en absoluto** (las nuevas RLS exigen
`auth.uid()`, que solo llega vía JWT de usuario, nunca vía anon key) — así
que antes de ejecutar CUTOVER hace falta que `pushAll()`/`pullAll()` usen el
`accessToken` de la sesión cuando `Auth.isSupabaseMode()` sea `true`. Añadido
como ítem pendiente para el gate de cutover (§15), no implementado hoy por no
estar autorizado ni pedido en este cierre.

## 24. Fix del gap de §23 — sync usa el JWT real del usuario, no el anon key (sesión 2026-09-27, autorizado explícitamente)

Cierra el ítem pendiente de §23/§15. Cambio real de código, autorizado y
probado el mismo día — **no toca producción, no toca RLS, no cierra la
policy legacy, no crea usuarios, no hace push**.

**Qué cambió (`CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/sync.js`):**
- Función nueva `syncAuthHeaders(cfg)` — única fuente de verdad del header
  `Authorization` para TODA request a `engrase_sync`: si
  `Auth.isSupabaseMode() && Auth.isAuthenticated()`, usa
  `Auth.getSession().accessToken` (el JWT real de la persona); si no
  (`'legacy'`, sin `Auth` cargado, o sin sesión — este último caso no debería
  alcanzarse porque el gate de §11/§23 ya corta antes), usa `cfg.anonKey`
  igual que siempre. `apikey` sigue siendo siempre `cfg.anonKey` (nunca
  cambia — es la key del proyecto, no la identidad de la persona).
- Reemplazado en las 4 requests reales a `engrase_sync`: `pullAll()` (GET
  paginado), `pushAll()` POST create, `pushAll()` PATCH CAS, y
  `fetchRemoteUpdatedAt()` (GET de diagnóstico de conflicto).
- **Fuera de esta corrección, a propósito:** `testConnection()` (prueba una
  anon key recién escrita en el formulario de Configuración, antes de que
  exista ninguna sesión) y `uploadPhotoIfNeeded()`/`uploadSignatureIfNeeded()`
  (Supabase Storage, no `engrase_sync` — explícitamente fuera de alcance de
  P0-2 desde §15, se resuelve en P0-3). Ninguna de las tres toca la tabla
  `engrase_sync`.
- **Ninguna lógica de refresh duplicada en `sync.js`:** `syncAuthHeaders()`
  solo LEE `Auth.getSession()` en el momento de cada request; el refresh ya
  ocurrió en `Auth.restoreSession()`, llamado por `fullSync()` antes de tocar
  la red (ver §12) — una sola fuente de verdad, tal como pedía el diseño
  original.

**Tests nuevos** (`tests/unit/sync-auth-gate.test.js`, bloque `P)`, 7 tests) +
extractor de tests actualizado (`tests/helpers/loadLubricationLogic.js`,
`syncAuthHeaders` agregado a `SYNC_SOURCES`) + `makeFakeAuth()` del mismo
archivo ahora expone `getSession()`:

| Verificado | Resultado |
|---|---|
| Legacy mode | `Authorization: Bearer <anonKey>` — sin cambios |
| Supabase + Junior autenticada | `apikey=<anonKey>`, `Authorization: Bearer <JWT real>`, nunca `Bearer <anonKey>` |
| `pullAll()` | usa el JWT |
| `pushAll()` POST create | usa el JWT |
| `pushAll()` PATCH CAS | usa el JWT |
| Sesión refrescada a mitad de `fullSync()` | la request usa el JWT NUEVO, nunca el expirado |

**Validación completa:** unit 587/587 (34 archivos, +6 sobre el cierre
anterior), Playwright 1393/1393, `typecheck` limpio, `lint:css` limpio (mismo
baseline de warnings, 0 errores), `build:web` + `verify:dist` OK. SW subido
de `v41` a `v42` (runtime cambiado: `sync.js`).

**Nada de esto activa `AUTH_MODE='supabase'`** — sigue en `'legacy'` en el
código committeado; este fix solo asegura que, el día que se active, el sync
ya use el JWT real en vez de romperse contra las RLS nuevas al cerrarse la
policy legacy.

## 25. PIN rápido offline (sesión 2026-09-27, autorizado explícitamente)

Nuevo módulo `src/core/quick-unlock.js`, activo SOLO en `AUTH_MODE='supabase'`
(sigue en `'legacy'` en el código committeado — todo esto es inerte hoy).
No toca producción, no toca RLS, no cierra la policy legacy, no crea
usuarios reales.

**Principio de seguridad (sin excepción):** Supabase Auth sigue siendo la
ÚNICA identidad real. El PIN local NUNCA autentica contra Supabase, NUNCA da
permisos de servidor, NUNCA define el rol — solo decide si ESTE dispositivo
vuelve a mostrar la UI de una identidad que YA se validó antes con una
sesión Auth real. El gate de sync (§23/§24) es exactamente el mismo de
antes, sin ningún cambio — el PIN nunca participa en esa decisión.

**Almacenamiento:** PBKDF2-SHA256 (100.000 iteraciones), salt aleatorio de
16 bytes por dispositivo (Web Crypto, `crypto.subtle`/`crypto.getRandomValues`
— sin librería externa). Persistido en `auth_quick_unlock`
(`app_config`/`LOCAL_STORES`, nunca sincroniza — mismo patrón que
`auth_tokens`/`auth_profile_snapshot`, namespace propio, sin subir
`DB_VERSION`). Campos: `appUserId, salt, hash, iterations, createdAt,
failedAttempts, lockedUntil`. **Nunca** un campo `pin`/`password`/JWT.

**Reglas de PIN:** 4 o 6 dígitos exactos (`isValidPinFormat`); rechaza
`0000`/`1111`/…, `1234`/`4321`, `123456`/`654321` y equivalentes
(`isTrivialPin`). Bloqueo local tras 5 intentos fallidos, 5 minutos, contado
y persistido en DB (nunca en memoria) — sobrevive cerrar/reabrir la app. Un
PIN correcto reinicia el contador; un bloqueo nunca borra el PIN configurado.

**Flujo (`app.js`, todo detrás de `Auth.isSupabaseMode()`):**
- `renderAuthGateSupabase()` — punto de entrada único, se llama al arrancar
  Y al "Bloquear" (nunca reingresa en silencio): `Auth.restoreSession()`,
  luego si hay snapshot válido (`isValidProfile`) Y PIN configurado para esa
  identidad → `renderQuickUnlockScreen()`; si no → `renderSupabaseLoginForm()`
  (Usuario + Contraseña real, deshabilitado sin conexión).
- Login real exitoso sin PIN configurado → `offerQuickUnlockSetup()`
  ("Ahora no" entra igual sin configurar).
- `logout()` (CERRAR SESIÓN): en modo supabase, `Auth.signOut()` +
  `QuickUnlock.disable()` — borra sesión Y PIN, exige credenciales
  completas la próxima vez. Nunca toca IndexedDB operativo.
- `lockApp()` (BLOQUEAR, botón nuevo junto a "Cerrar sesión"/en el shell del
  Lubricador, solo visible en modo supabase): re-muestra
  `renderAuthGateSupabase()` sin llamar `signOut()`/`disable()` — sesión y
  PIN quedan intactos.
- Configurar/Cambiar/Desactivar PIN también disponible desde Configuración
  (`renderConfig()`), solo cuando `Auth.isAuthenticated()` ya es `true`.
- Login PIN legacy (`renderLogin()`/`doLogin()`) **sin ningún cambio** —
  módulo completamente separado, nunca se ejecuta si `AUTH_MODE='supabase'`.

**Tests nuevos:** `tests/unit/quick-unlock.test.js` (18 tests, letras A-L del
pedido de cierre — PIN nunca en texto plano, salts distintos, unlock
correcto/incorrecto, lockout y su persistencia tras "reload", desacople
total de `Auth.isAuthenticated()`, refresh inválido deja sin snapshot,
perfil inactivo nunca ofrece PIN, logout borra el PIN vs. bloquear lo
conserva) + extractor actualizado
(`tests/helpers/loadLubricationLogic.js`, `loadQuickUnlockLogic()`). M
(legacy intacto) y N (JWT de §24 sigue en PASS) se confirman con la suite
completa + `tests/ui/login-responsive.spec.js` (Playwright, sin cambios).

**Validación completa:** unit 605/605 (35 archivos, +18 sobre el cierre
anterior), Playwright relevante (`login-responsive`, `dashboard-operativo`,
`lubricador-mi-turno`, 287/287) — no se corrió el suite completo de
Playwright porque el cambio nuevo vive detrás de `AUTH_MODE='supabase'`,
inerte en todo lo demás. `typecheck` limpio, `lint:css` limpio (mismo
baseline, 0 errores), `build:web`+`verify:dist` OK (`src/core/quick-unlock.js`
detectado como el 10º módulo). SW `v42` → `v43` (runtime nuevo/cambiado:
`quick-unlock.js`, `db.js`, `app.js`, `index.html`).

## 26. Auditoría pre-cutover (sesión 2026-09-27) — todo confirmado contra producción, solo lectura

Antes de preparar el cutover, se confirmó por consulta directa (`supabase db
query --linked`, solo `SELECT`, nunca escritura) que el estado real de
producción coincide exactamente con lo documentado:

| Ítem auditado | Resultado confirmado |
|---|---|
| `AUTH_MODE` en el código (antes de este cierre) | `'legacy'` |
| Policy legacy en `engrase_sync` | `"acceso interno con anon key"` (`FOR ALL USING(true) WITH CHECK(true)`) — **sigue activa** |
| Policies `authenticated` en `engrase_sync` | `"engrase_sync: leer/crear/actualizar según matriz"` (las 3 de 0002) — existen, coexistiendo con la legacy |
| Policies de `app_profiles` | Las 4 de 0002 (`leer el propio perfil`, `admin lee todos`, `admin crea perfiles`, `admin edita otros`) — existen |
| `app_store_permissions` | 75 filas (15 stores × 5 roles), exactamente el INSERT de 0002 |
| `manage-users` | `ACTIVE` |
| `app_profiles` (filas reales) | **Exactamente 1**: `u_jvalles` / Junior Valles / `ADMINISTRADOR` / `active:true` |
| Bootstrap legacy en `AUTH_MODE='supabase'` | Ya deshabilitado (`db.js`, `isSupabaseAuthMode()` gate en `seedIfEmpty()`/`seedSoloUsuarioInicial()` — commit `4e44089`, sesión previa) |
| Sync usa JWT real en modo supabase | Confirmado (commit `4645e31`, verificado en Android real) |

**Hallazgo crítico de la auditoría, no un problema de código — una
consecuencia operativa real:** `app_profiles` tiene una sola fila. Ningún
rol de campo (SUPERVISOR/PLANIFICADOR/LUBRICADOR/VISOR) tiene todavía una
cuenta Auth real. Ver §27 para cómo esto condiciona el orden de despliegue.

## 27. Cutover preparado (sesión 2026-09-27) — código listo, NADA desplegado ni ejecutado

**Cambio de código real, committeado, pero SIN publicar/instalar/ejecutar
todavía:**

- `src/core/auth.js`: `AUTH_MODE` pasa de `'legacy'` a `'supabase'` como
  default DEFINITIVO (ya no un flip temporal para pruebas, como en las
  sesiones anteriores del piloto Android). El comentario junto a la
  constante documenta explícitamente que el código y lo que corre hoy en
  producción son dos cosas distintas hasta que se ejecute el orden de abajo.
- **Nada más cambió de código** — se auditó explícitamente §13/§3 de este
  documento (bootstrap deshabilitado, comparación PIN inalcanzable, rol
  nunca viene de `users` local) y **ya estaba todo resuelto** de sesiones
  previas; el cutover de código es, literalmente, este único cambio de
  constante.
- `supabase/migrations/0003_auth_rls_CUTOVER_PREPARED.sql` — **NO
  ejecutado**. Una sola sentencia real: `drop policy "acceso interno con
  anon key" on engrase_sync;`. Las 3 policies `authenticated` de 0002 (ya
  en producción) pasan a ser la única autoridad automáticamente — no hace
  falta recrearlas ni tocar `app_store_permissions`. anon queda `DENIED`
  por el comportamiento por defecto de RLS (sin ninguna policy permisiva
  que lo acepte), sin necesidad de una regla explícita nueva.
- `supabase/migrations/0003_auth_rls_CUTOVER_ROLLBACK.sql` — **NO
  ejecutado**. Restaura ÚNICAMENTE la policy legacy, sin tocar datos, Auth
  users, `app_profiles` ni Storage.
- Tests nuevos: `tests/unit/cutover-security.test.js` (6 tests, letras A/E
  del pedido) + `tests/unit/auth.test.js` bloque M actualizado (el default
  real ahora es `'supabase'`, no `'legacy'`).

### ⚠️ Advertencia operativa — NO desplegar sin resolver esto primero

Con `AUTH_MODE='supabase'`, el login PIN legacy queda **inaccesible** (por
diseño — ver §3 del pedido de cierre, ya implementado en sesiones previas).
Con **una sola cuenta Auth real** (Junior Valles, ADMINISTRADOR), publicar
este código tal cual dejaría a **todo el resto del personal de campo sin
poder entrar a la app**. Antes de ejecutar el paso A del orden de abajo en
producción real, deben existir cuentas Auth reales para los roles que
efectivamente operan la app a diario (mínimo: los LUBRICADOR/SUPERVISOR que
usan el teléfono en el pit) — vía `manage-users` `CREATE_USER`, ya
`ACTIVE` en producción, con autorización explícita en el momento para cada
alta.

### Orden de despliegue documentado (NO ejecutado — para cuando se autorice)

Cada paso incluye su propio rollback, para no bloquear a nadie a mitad de camino:

| Paso | Acción | Rollback si falla |
|---|---|---|
| A | Build final con `AUTH_MODE='supabase'` (`npm run build:web`) | No publicar; el repo local no afecta producción |
| B | Instalar APK actualizado en Android (`adb install -r`, preservando datos) | `adb install -r` del APK anterior (AUTH_MODE='legacy'), datos intactos |
| C | Validar login/Quick Unlock de Junior en ese dispositivo real | Si falla: no continuar a D; quedarse en el APK anterior |
| D | Publicar la Web nueva (GitHub Pages u otro hosting) | Revertir al build anterior publicado (mismo repo, commit previo) |
| E | Validar Auth real en la Web publicada | Si falla: revertir D |
| F | **Aplicar `0003_auth_rls_CUTOVER_PREPARED.sql`** (el paso real de RLS) | Aplicar `0003_..._ROLLBACK.sql` de inmediato — restaura la policy legacy, sin tocar datos |
| G | Probar `anon` → `DENIED` (SELECT/INSERT/UPDATE sin JWT) | Si no da `DENIED`: revisar antes de continuar, no avanzar a H |
| H | Probar Junior (ADMIN) → `ALLOWED` según `app_store_permissions` | Si falla: `ROLLBACK` de F |
| I | Probar sync JWT real + CAS de P0-1 con datos reales | Si falla: `ROLLBACK` de F |
| J | Smoke test final (Dashboard, Registrar Engrase, Matriz, Reportes) | Si falla: `ROLLBACK` de F, y evaluar si B/D también necesitan revertirse |

**Ninguno de estos 10 pasos se ejecutó en esta sesión** — quedan
documentados para cuando el usuario autorice explícitamente, paso por
paso, en el momento.
