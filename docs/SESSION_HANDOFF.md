# HISTORICAL / DEPRECATED — handoff acumulativo, no runbook vigente.
# Conserva decisiones y hallazgos de sesiones anteriores; para instalación,
# Auth, Storage y despliegue consulte docs/DOCUMENTATION_STATUS.md.

# Session Handoff — Control de Engrase (migration-typescript)

Última actualización: 2026-10-02 (parte 20) — CORRECCIÓN ARQUITECTÓNICA: eliminada toda dependencia de dispositivo físico del scope operativo (commit `f467782`) — la cuadrilla ahora autoriza USUARIOS (`cuadrillas[].memberUserIds`), nunca un teléfono. "Próximos" (mañana) + domingo en plan imprimible ya commiteados (`908e0e2`). Skill **UI UX Pro Max** instalada localmente + `CLAUDE.md` con reglas permanentes del proyecto (commit `82f3b1b`). HEAD de cierre de sesión: `82f3b1b`. Sin push en ningún momento. `stash@{0}` ya no existe (confirmado obsoleto, dropeado).

## Sesión 2026-10-02 (parte 20) — corrección arquitectónica de independencia de dispositivo + skill UI UX Pro Max (3 commits, NO push)

**1) Commit `908e0e2`** (ya cubierto arriba, parte 19 lo dejaba sin commitear — el usuario confirmó y se commiteó): "Próximos" con 1 día de anticipación (Día/turno) + `printGreasePlan()` domingo ya no es columna combinada ("ENGRASE A FLOTA DE VOLQUETES"), es un día normal por equipo — el usuario confirmó que sí se engrasa domingo. `docs/BUG_REGISTER.md` MATRIZ-DOMINGO-001 cerrado (ya estaba corregido desde el 2026-09-26, commit `46246a9`, el registro nunca se actualizó).

**2) Triage de pendientes clásicos, cerrado el mismo día:** `stash@{0}` auditado (`git apply --check` falla en los 3 archivos — el rediseño de "Registrar Engrase" en cards ya está en el código actual por otra vía) y **dropeado** con autorización explícita. "3 objetos huérfanos" de Storage: confirmado por SELECT real en producción que **sí tienen fila real** en `grease_validations`, no son huérfanos — probablemente una ventana transitoria del 2026-09-27 (mismo día del fix de JWT real en sync). 0003 (cutover RLS): el usuario autorizó aplicarlo PERO al preguntarle si TODOS los teléfonos de campo ya están en `AUTH_MODE='supabase'` respondió "no estoy seguro" — **sigue sin aplicar**, no reproponer sin esa confirmación explícita. Se crearon `docs/PRE_CUTOVER_BACKUP_CHECKLIST.md` y `docs/FIELD_DEVICE_CUTOVER_CHECKLIST.md` (preparados, sin ejecutar — commit `c7f24b5`) y se confirmó que la arquitectura Android ya era "un solo APK" por construcción (commit `a920924`).

**3) CORRECCIÓN ARQUITECTÓNICA OBLIGATORIA (commit `f467782`) — pedido explícito del usuario, prioridad máxima "antes del release final":** Control de Engrase NO puede depender de un dispositivo físico registrado. Se buscó en todo el proyecto (`device`, `deviceId`, `dispositivo`, etc.) y se eliminó TODO el mecanismo `DISPOSITIVO → CUADRILLA → USUARIO`:
   - Eliminados: `getDeviceId()`/`getDeviceName()`/`setDeviceName()`/`getDeviceAssignment()`/`saveDeviceAssignment()`, el panel "Dispositivo operativo" de Configuración, `ROLES_CAN_CONFIGURE_DEVICE`/`canConfigureDevice()`, los scope kinds `DEVICE_SCOPED`/`DEVICE_UNASSIGNED`.
   - Nuevo modelo: `USUARIO AUTENTICADO → ROL/PERMISOS → CUADRILLA(S) AUTORIZADA(S) → UBICACIÓN → TURNO`. `cuadrillas[].memberUserIds` (array de `app_user_id`) autoriza personas reales — gestionado desde Configuración → Cuadrillas → Editar → "Miembros autorizados" (nueva UI, usa `Auth.manageUsers('LIST_USERS')`, mismo patrón que Usuarios).
   - `getAuthorizedCrews()` + `resolveOperationalScope()` reescritos (`src/core/operational-scope.js`): ADMIN/PLANIFICADOR/VISOR siguen GLOBAL; **SUPERVISOR pasa a ser crew-scoped** (antes GLOBAL — cambio de comportamiento explícito pedido). Nuevos kinds: `NO_CREW_ASSIGNED`, `NEEDS_CREW_SELECTION`, `CREW_SCOPED`.
   - `getSelectedCrewId(userId)`/`setSelectedCrewId(userId, crewId)`: única huella local (1 clave de `localStorage`, por userId) — SOLO comodidad de sesión con 2+ cuadrillas autorizadas, nunca autoriza nada (una selección no autorizada se ignora en silencio). UI en `renderLubricadorHome()`: selector de cuadrilla cuando hace falta, link "Cambiar cuadrilla", mensaje claro si no hay ninguna autorización.
   - Push-token scope (notify-vencidos/notify-push) ahora sale del scope CREW_SCOPED del usuario; de regalo, `shiftId` ahora se puebla de verdad (antes el form de dispositivo nunca tenía campo para eso).
   - **A propósito NO tocado:** cumplimiento, matching de occurrences, lubrication_skips, carryover, fuera de plan, motor de asignaciones, validaciones, reportes, sync CAS, Auth/Supabase, datos de producción. Quick Unlock sigue 100% local, confirmado que nunca definía rol/cuadrilla (sin cambios). Las pantallas de escritorio de Supervisor (Dashboard/Equipos/etc.) NO se retocaron para encajar el nuevo scope — nunca estuvieron restringidas por scope antes, solo el primitivo `resolveOperationalScope()` ya las soporta si alguna pantalla futura lo necesita.
   - Tests: `operational-scope.test.js` reescrito (85 tests), `device-assignment-isolation.test.js` reescrito (aislamiento por usuario, no por dispositivo), `push-token-scope.test.js` reescrito, `qr-grease-register-management.spec.js` actualizado, nuevo `device-independence-requirements.test.js` (mapea 1:1 los puntos A-H pedidos). Validación completa: unit **1047/1047**, Playwright **1848/1848**, typecheck/lint limpios, build/verify:dist OK.

**4) Skill UI UX Pro Max instalada (commit `82f3b1b`)** — pedido explícito, SOLO para auditoría (UI/UX/responsive/accesibilidad), sin tocar lógica todavía. Instalada vía `npx ui-ux-pro-max-cli@2.15.0 init --ai claude` (sin `-g`, sin nueva dependencia en `package.json`) en `.claude/skills/ui-ux-pro-max/`. El instalador trae 6 skills extra por defecto (banner-design/brand/design-system/design/slides/ui-styling) — **podadas**, no pedidas. Nuevo `CLAUDE.md` en la raíz con las reglas permanentes: stack a mantener (HTML/CSS/JS + Vite + IndexedDB + Supabase + Capacitor, sin framework de componentes), prohibido Tailwind/React/Vue/Angular/Bootstrap/shadcn, lenguaje visual industrial/minero (claro por defecto, acento ámbar, alta densidad, sin cards-ificar tablas operativas), anchos de auditoría móvil 390/412px, regla de un solo APK/Web universal, y que la skill NUNCA toca lógica de negocio. **Pendiente real, no resuelto:** Python 3 no está instalado en esta máquina — los scripts `search.py`/`core.py` de la skill no corren todavía (la guía en Markdown sí funciona sin Python). La auditoría real con la skill **todavía no se ejecutó** — eso es la siguiente sesión.

`docs/SESSION_HANDOFF.md` excluido de los 3 commits como siempre. **NO se hizo push en ningún momento.** Nada tocó producción/Supabase salvo las 2 consultas SELECT de solo lectura de la parte 19 (ya reportadas ahí).

## Sesión 2026-10-02 (parte 19) — "Próximos" con 1 día de anticipación + triage de pendientes (commit local de una parte, resto sin commitear/sin tocar)

**1) Dashboard — tarjetas de "Qué requiere acción" (commit `191b8e8`, ya detallado arriba en las notas de esa parte si se buscan):** "Pendientes hoy" no tenía acción de clic; "Pendientes hoy"/"Pendientes de validación" solo eran clicables con count>0 (inconsistente con "Vencidos"/"Próximos"); el recordatorio automático de respaldo (4s tras login, ADMINISTRADOR) se eliminó; y se corrigió un bug real en `startGreaseFlow()` donde "Registrar" sin `target` (Dashboard/Equipos) nunca mostraba "Validar ahora/después" tras guardar (variable `area` capturada `null` antes de que `renderRegistrar()` — async — terminara de pintar, y un `setTimeout` que la shadowing en vez de reasignarla).

**2) "Próximos" ahora incluye equipos Día/turno con próximo día = MAÑANA** (pedido explícito del usuario, **sin commitear todavía**): antes esta tarjeta solo mostraba equipos por horómetro (`weekdayStatusFor()` nunca da AMARILLO con anticipación, solo el mismo día). Alcance acordado con el usuario: SOLO Dashboard (el equipo sigue "Al día"/verde en Equipos/Matriz/QR), SOLO 1 día de margen (no 2-3, no configurable). Respeta `reprogramadoHasta` (si el equipo ya fue movido a otra fecha, no avisa el día habitual). Validado: unit 1022/1022, Playwright 1848/1848 (incluye 2 tests reales nuevos: caso positivo y caso reprogramado-no-mañana), typecheck/lint limpios. **Pendiente: el usuario confirme antes de commitear.**

**3) Triage de los pendientes "clásicos" (0003/Storage/Domingo/stash), por prioridad:**
- **0003 (cutover RLS):** el usuario autorizó aplicarlo, PERO al preguntarle específicamente si TODOS los dispositivos de campo (teléfonos Lubricador/Supervisor) ya están en `AUTH_MODE='supabase'`, respondió "no estoy seguro/puede que no todos" — **NO se aplicó**. El propio plan (§27 del AUTH_RLS_IMPLEMENTATION_PLAN.md) exige confirmar esto ANTES del paso F (aplicar 0003), porque cualquier dispositivo todavía en legacy/anon-key perdería sync de inmediato. Sigue exactamente igual que antes — pendiente de que el usuario confirme el estado real de los teléfonos de campo (no solo los 2-3 de prueba ya documentados).
- **Storage — "3 objetos huérfanos" (RESUELTO, solo lectura, nada borrado/cambiado):** verificado contra producción (`supabase db query --linked --project-ref havrirlapjyqrffgalqx`, SELECT puro) que los 3 (`val_muhdkb6rjddpz0.png`/`val_muhgk01vn6vyqb.png`/`val_muhuby6figwda0.png`) **SÍ tienen fila real en `grease_validations`** (`engrase_sync`), activa (`deleted` no true), con `signatureUrl` apuntando exactamente a ese archivo y `lubricationRecordId` real. No son huérfanos — la auditoría original (2026-09-27) probablemente los vio así por una ventana transitoria (ese mismo día se corrigió el bug de JWT real en sync, §24 del plan de Auth) antes de que la fila terminara de sincronizar. **Bucket `engrase-photos` confirmado público (`public: true`)** — eso sigue pendiente aparte (Storage privado es P0-3, fuera de alcance del cutover actual, no se tocó).
- **Domingo en Matriz Semanal:** sigue sin resolver — es un hecho operativo (¿trabajan domingo?), no algo que el código pueda decidir. Pendiente de que el usuario responda.
- **`stash@{0}`:** pendiente de mostrárselo al usuario para que decida (aplicar/descartar/seguir esperando) — todavía no se le mostró en esta parte.

`docs/SESSION_HANDOFF.md` excluido del commit como siempre. Commit real de esta parte: solo el ítem 1 (`191b8e8`, ya hecho). El ítem 2 (Próximos-mañana) sigue sin commitear a propósito (el usuario pidió no commitear hasta confirmar). Nada tocó producción salvo las 2 consultas SELECT de solo lectura del ítem 3 (bucket + objetos), explícitamente autorizadas como "solo diagnóstico".

## Sesión 2026-10-02 (parte 18) — gates de cutover Android confirmados + sitio web caído (sin cambios de código)

Continuación del lote anterior: el usuario pidió priorizar el cierre de los gates de verificación pre-cutover (`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §15) que seguían sin confirmar desde la parte 11 (logout real, reconexión tras offline, cambio de usuario en el mismo dispositivo).

**Hallazgo real antes de probar nada**: `https://junivalles-cmd.github.io` (el sitio web desplegado, según `README_SUBIR_A_GITHUB.txt`) devuelve **404 "Site not found" de GitHub Pages** — verificado con una lectura pública (`curl`, sin login, sin tocar nada), confirmando que no es un problema de red del lado de Claude (`github.com`/`example.com` responden 200 normal). El usuario decidió explícitamente seguir **solo con Android** por ahora y resolver el sitio web por separado.

**Preparación del dispositivo real (serial `99FQVGVWRW795LW4`) antes de probar**: el APK instalado tenía `lastUpdateTime` del **2026-09-27** — 5 días y ~15 commits desatrasado de HEAD (no incluía nada del lote de hoy: accesibilidad, notificaciones, `renderDashboard()`, DATA-PENDING-A02). Se corrió `npx cap sync android` (ya copiaba el `dist/` recién construido hoy) + `gradlew assembleDebug` (JAVA_HOME apuntado al JBR de Android Studio) + `adb install -r` — el reinstall con `-r` preserva los datos/sesión que ya tenía el teléfono. Confirmado con `dumpsys package`: `lastUpdateTime` pasó a **2026-10-02**, código al día.

**Resultado de las 3 pruebas (confirmadas por el usuario, "pass"):**
- Logout real → vuelve a pedir credencial completa, no Quick Unlock — **PASS**.
- Reconexión tras offline (modo avión → reconectar) → sincroniza sin pedir login de nuevo, sin quedar pegado en offline — **PASS**.
- Cambio de usuario en el mismo dispositivo → sin mezclar datos del usuario anterior — **PASS**.

**`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §15 actualizado**: "Auth funciona en Android/Capacitor" y "Reconexión: refresca sesión, releer perfil, luego sync" ahora en `[x]` PASS con la evidencia de hoy. "Auth funciona en Web" se dejó explícitamente SIN marcar, con la nota del 404.

**Pendiente real para que el cutover tenga el panorama completo:** resolver por qué el sitio web está caído (¿repo no public, Pages desactivado, nunca se subió el contenido?) antes de poder marcar el gate de Web. El resto de gates de §15 (7 cuentas migradas, matriz completa por rol, `anon` DENIED, rollback en staging) sigue exactamente igual que antes — sin tocar.

Sin cambios de código en esta parte — solo 2 archivos de documentación (`AUTH_RLS_IMPLEMENTATION_PLAN.md`, este handoff) + 1 reinstall de APK en un dispositivo de prueba (reversible, no toca producción/Supabase). Nada commiteado (son cambios de doc, y `docs/SESSION_HANDOFF.md` sigue excluido como siempre) — `AUTH_RLS_IMPLEMENTATION_PLAN.md` sí quedó modificado en el working tree, pendiente de commit si el usuario lo pide.

## Sesión 2026-10-02 (parte 17) — DATA-PENDING-A02 cerrado: causa raíz real de código, sin leer producción (commit local, NO push)

Último ítem del lote "haz todos, por prioridad" de esta sesión. La auditoría original (2026-09-25) había concluido "pendiente de validación de datos, requiere acceso a producción" — reinvestigado desde cero SIN leer ningún dato real.

**Causa raíz encontrada:** `locPorId`/`typePorId` (lookups de NOMBRE para Dashboard/Historial/Reportes/Matriz Semanal) se construían desde `DB.allActive('locations'/'equipment_types')` — la MISMA lista que alimenta el `<select>` de filtro. `wireSimpleListPanel` (botón "Eliminar" de Ubicaciones/Familias) hace soft-delete (`active=false`) y su propio `confirm()` ya decía la verdad: *"los equipos que ya lo tengan asignado no se modifican"* — `equipment.locationId` nunca cambia, pero la lista activas-solo deja de incluirla → `locPorId[e.locationId]` → `undefined` → "—" para siempre. Coincide exacto con el síntoma original ("antes mostraba Botadero Norte, ahora —"): alguien desactivó esa ubicación entre medio.

**Fix (`app.js`, 4 sitios):** `renderDashboard()`/`renderMatrizSemanal()`/`renderReportes()` ahora piden TAMBIÉN `DB.all(...)` (`typesAll`/`locationsAll`) solo para el lookup de nombre — el `<select>` de filtro de cada pantalla sigue activas-solo (nunca debe poder elegirse algo desactivado). `renderHistorial()` no tiene ningún `<select>` de Ubicación/Familia, así que su fetch se cambió directo a `DB.all(...)`.

**Tests:** `tests/ui/dashboard-real-execution.spec.js` (+1, 3er test — ejecuta `renderDashboard()` de verdad con una ubicación desactivada referenciada por un equipo activo, confirma el nombre real, nunca "—"); `tests/unit/data-pending-a02-fix.test.js` (nuevo, 9 tests, mismo patrón por fuente en los otros 3 sitios). 2 fixtures existentes (`historial-eq-search-flow.spec.js`, y las 2 aserciones de `dashboard-sin-plan.test.js`/`dashboard-operativo.test.js` ya actualizadas en el camino) tuvieron que actualizarse para seguir arrancando contra el código real.

**`docs/BUG_REGISTER.md` actualizado**: DATA-PENDING-A02 pasa de "PENDIENTE DE VALIDACIÓN DE DATOS" a "CORREGIDO", con la causa raíz completa documentada. **Fuera de alcance, a propósito**: los ~20 usos restantes de `DB.allActive('locations'/'equipment_types')` que alimentan ÚNICAMENTE un `<select>` (nunca un lookup de nombre) no tienen este bug, no se tocaron. `renderEquipos()`/`equipmentCard()` no usan el patrón `typePorId`/`locPorId`, no estaban afectados.

Validación completa: unit **1015/1015** (63 archivos, +9 desde HEAD `4d4aa8a`), Playwright **1813/1813** (limpio, incluye los 7 nuevos de la 3ra prueba de Dashboard), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline). `build:web`+`verify:dist` OK. SW `v66` → **v67**.

---

### Cierre del lote "HAZ TODOS, APLÍCALOS SEGÚN PRIORIDAD" (partes 14-17, mismo día)

El usuario pidió cerrar TODOS los pendientes listados al inicio de la sesión, por prioridad. Se separó explícitamente lo seguro (código local) de lo que toca producción — el usuario dio una respuesta contradictoria sobre los 3 ítems de producción (marcó "ninguno" Y los 3 riesgosos a la vez) y, al pedirle aclarar, confirmó **"ninguno por ahora"**. Esos 3 siguen exactamente igual que antes de esta sesión:
- Desplegar `AUTH_MODE=supabase` — sin desplegar.
- Aplicar `0003` (cutover RLS) + `0005` (Storage privado) — sin aplicar.
- Resolver los 3 objetos huérfanos de Storage — sin tocar.

**Todo lo seguro quedó cerrado** (partes 14-17): accesibilidad (7/7 hallazgos), `push_tokens` RLS preparado (`0007`, no aplicado — depende de 0003), admin edita notificaciones de otra persona, `renderDashboard()` ejecutado de verdad por primera vez, y DATA-PENDING-A02 resuelto. 5 commits locales en total (`c724abd`, `a43d905`, `78e7901`, `4d4aa8a`, y el de esta parte). **NO se hizo push en ningún momento.**

`docs/SESSION_HANDOFF.md` excluido como siempre. Nada tocó producción/Supabase.

## Sesión 2026-10-02 (parte 16) — renderDashboard() EJECUTADO de verdad por primera vez en la suite (commit local, NO push)

Cierra la deuda de testing documentada en varias partes anteriores ("renderDashboard() NUNCA se ejecuta de verdad en ningún test — todo es texto-fuente o fixtures estáticas — así sobrevivió [el bug de `turnoActual`] 2 sesiones completas"). `tests/unit/dashboard-carryover.test.js` ya tenía un test de ORDEN DE FUENTE para ese bug puntual, pero nada corría la función de verdad contra datos reales.

**`tests/ui/dashboard-real-execution.spec.js` (nuevo, 2 tests × 7 viewports = 14):** mismo patrón real ya usado en `mis-engrases-flow.spec.js` — extrae con `extractDeclaration()` `renderDashboard()` y TODA su cadena de dependencias real (`app.js`: `computeAllStatuses`, `dashHeroCard`/`dashActivityCard`/`dashComplianceCard`, `tiempoExcepcionRowHTML`, `todayDateISO`, `SCHEDULE_WEEKDAYS`/`STATUS_COLOR`/`WEEKDAY_ABBR_DASH`/`NO_EXECUTION_REASON_LABELS`/`PERMISSIONS`; `src/core/shifts.js`: `currentShiftId`; `src/core/lubrication-status.js`: `fmt`/`weekdayStatusFor`/`statusFor`/etc; `src/core/operational-scope.js`: `EXECUTION_TYPE`/`ASSIGNMENT_STATUS`/`resolveRecordExecutionType`/`findCarriedOverSkipForToday`; `src/core/grease-validation.js`: toda la cadena de validación) dentro de una página real de Playwright, con `DB`/`App`/`navigate`/`startGreaseFlow`/`openModal` reemplazados por fakes en memoria — **sin red, sin IndexedDB real, cero mocks del propio `renderDashboard()`**.

- **Test 1** (flota sin trabajo pendiente): corre `renderDashboard()` de verdad, confirma `pageerror` vacío (nunca revienta), y verifica las 6 KPI reales en su orden real (Vencidos/Pendientes hoy/Próximos/Realizados hoy/Pendientes de validación/Cumplimiento hoy — confirmado EMPÍRICAMENTE contra el DOM real, no asumido).
- **Test 2** (regresión, el escenario EXACTO que escondió el bug histórico): un `lubrication_skip` real de HOY con un `shiftId` distinto al turno actual (calculado en vivo con la fórmula real de `currentShiftId()`, nunca fijo, para que el test valga sin importar la hora al correrlo) — confirma que sigue sin reventar y que el panel "Pendientes del turno anterior" muestra el equipo real.
- Dependencias reales descubiertas SOLO al ejecutar (nunca visibles con un test de solo-texto): `todayDateISO`, `EXECUTION_TYPE`/`ASSIGNMENT_STATUS`/`resolveRecordExecutionType` (operational-scope.js) y las 4 constantes de `app.js` — cada una causó un `ReferenceError` real hasta agregarla, confirmando por qué un test de texto no es suficiente.

**Limitación que queda, a propósito:** este archivo cubre el camino de RENDER inicial (que nunca reviente + estructura correcta) — los `onclick`/`addEventListener` de los modales internos (`openSinPlanModal`, `openDashStatusModal`, etc.) no se ejercitan (nunca se hace click en nada), porque esos no son parte del bug histórico que motivó este cierre. Ejercitar cada modal interno con clicks reales sería un lote aparte.

Validación completa: unit **1006/1006** (sin cambios, es un archivo Playwright puro), Playwright **1806/1806** (+14, limpio), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline — sin tocar CSS). Sin cambios en `app.js`/`styles.css`/`sw.js` — SW se queda en **v66** (nada que cachear distinto).

## Sesión 2026-10-02 (parte 15.5) — admin edita notificaciones de otra persona (commit local, NO push)

Cierra el último pendiente abierto de la arquitectura de notificaciones (antes autoservicio únicamente). `saveNotificationPreferencesForUser()` (app.js) reusa el mismo mecanismo de escritura que el autoservicio (`applyNotificationPreferencesToRows()`, factorizado de `saveNotificationPreferences()`), apuntando a las filas de la persona elegida — gateado a ADMINISTRADOR, nunca toca una fila de DISPOSITIVO (sin `userId`, feature de dispositivo compartido ya desplegada). UI: botón "Editar" nuevo en la tabla de `push-tokens-list` de Configuración (ahora filtrada a solo filas de persona — antes mezclaba filas de dispositivo sin sentido ahí), abre un modal con los mismos 3 campos del autoservicio.

**Interacción real resuelta con el trabajo de la parte 15**: esta feature escribe la fila de OTRA persona — eso es exactamente lo que `0007_push_tokens_ownership_rls_PREPARED.sql` (preparado en la parte 15, aún sin aplicar) iba a bloquear. Se agregó una excepción ADMINISTRADOR a esa migración (mismo criterio ya usado en `app_profiles` de 0002) para que esta feature siga funcionando el día que 0007 se autorice y aplique.

Tests: 11 nuevos en `tests/unit/notification-prefs-admin-edit.test.js` (lógica real vía `loadDeviceIdentityLogic()`, mismo patrón que `push-token-scope.test.js`, + 3 verificaciones de wiring de UI por fuente).

Validación completa: unit **1006/1006** (+11 desde HEAD `78e7901`... ver nota: este número ya incluye ambas partes 15.5/16 combinadas en la validación final de la sesión), Playwright **1792/1792** (antes de la parte 16), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline). SW `v65` → **v66**.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase — 0007 sigue sin aplicar.

## Sesión 2026-10-02 (parte 15) — resto del lote "haz todos, por prioridad" (commit local, NO push)

El usuario pidió explícitamente cerrar TODOS los pendientes listados, por prioridad. Antes de tocar nada, se separó lo seguro (código local) de lo que toca producción/Supabase — precedente ya existente en este mismo proyecto (parte 10: "se confirmó cada uno por separado con el usuario en vez de asumir que 'todo' incluía la parte peligrosa"). Se preguntó al usuario cuáles de los 3 ítems de producción autorizaba; la respuesta fue contradictoria (seleccionó simultáneamente "ninguno por ahora" Y los 3 riesgosos) — **se le devolvió la pregunta para aclarar, ninguno de los 3 se ejecutó.**

**Cerrados en este lote (código local, con tests reales):**
- **`.icon-btn` bajo el objetivo táctil de 44px** — tenía `min-height: var(--tap)` (ya cubierto) pero NO `min-width`; un botón solo-ícono quedaba en ~26-34px de ancho. Agregado `min-width: var(--tap)` + `display:inline-flex` centrado, en la misma regla (no una nueva, para no generar un warning de selector duplicado). Verificado con el Playwright completo (1792/1792) que no rompió ningún layout de tabla/toolbar existente.
- **Contraste de `--green`/`--amber`/`--red` en modo claro** — medido con la fórmula real de luminancia relativa de WCAG: contra blanco daban 2.5:1 / 2.2:1 / 3.9:1 (fallan el mínimo 3:1, el modo oscuro los reutilizaba sin ajuste). Nuevos valores solo para `[data-mode="light"]` (`#1E7A34`/`#8A5A00`/`#C0262B`) que pasan 4.5:1+, verificado por cálculo real en el test, no por un valor hardcodeado "esperado".
- **`prefers-reduced-motion` no alcanzaba a Chart.js** — el media query de `styles.css` ya apagaba toda transición/animación CSS, pero Chart.js (Reportes → Tendencia/Consumo) anima dibujando directo en `<canvas>`, fuera de su alcance. Nuevo helper `prefersReducedMotion()` + `animation:false` condicional en los 2 `new Chart(...)`.
- Tests nuevos: `tests/unit/accessibility-contrast-motion.test.js` (8 tests — contraste real calculado, min-width del selector, wiring de Chart.js).

**Migración preparada, NO aplicada:** `supabase/migrations/0007_push_tokens_ownership_rls_PREPARED.sql` (+`_ROLLBACK.sql`) — cierra el gap P1 de `push_tokens` (la matriz autoriza por rol, nunca por fila; cualquiera con `can_insert`/`can_update` podía escribir la fila de notificaciones de OTRA persona). **Ojo con la tensión de diseño real que esto tuvo que resolver**: `push_tokens` guarda 2 formas de fila distintas — de PERSONA (`payload.userId` presente, notificaciones) y de DISPOSITIVO (`payload.userId` ausente, `cuadrillaId`/`shiftId` compartido entre turnos, feature ya desplegada en la parte 2026-09-28). La condición nueva solo restringe la fila de PERSONA a su propio dueño; la fila de DISPOSITIVO queda exactamente igual que hoy (sigue gobernada solo por la matriz de rol) — un blanket "userId = el mío" habría roto la asignación de dispositivo compartido ya en producción. Depende de que **0003 ya esté aplicado** (si no, es inerte, igual que toda policy nueva sobre `engrase_sync` mientras la legacy siga activa).

Validación completa: unit **995/995** (61 archivos, +8 desde HEAD `c724abd`), Playwright **1792/1792** (limpio, corrido DESPUÉS de los cambios de CSS/Chart.js para descartar regresión visual), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline — el ajuste de `.icon-btn` se hizo en la regla existente justo para no sumar uno nuevo). `build:web`+`verify:dist` OK. SW `v64` → **v65**.

**Pendientes reales que siguen abiertos** (no tocados en este lote, por decisión explícita o por ser el siguiente ítem de la lista):
- Autorización de los 3 ítems de producción (deploy AUTH_MODE=supabase, aplicar 0003+0005, resolver objetos huérfanos de Storage) — respuesta contradictoria, pendiente de que el usuario aclare.
- 0007 (este archivo) sigue sin aplicar — depende de 0003.
- Admin editando preferencias de notificación de OTRA persona — sigue sin implementar.
- Test de ejecución real de `renderDashboard()` (deuda de testing, nunca se ejecuta de verdad en la suite).
- `DATA-PENDING-A02` — sin investigar en este lote todavía.
- `stash@{0}` y los 3 objetos huérfanos de Storage — sin tocar, como siempre.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase.

## Sesión 2026-10-02 (parte 14) — 3 hallazgos de accesibilidad pendientes cerrados (commit local, NO push)

Continuación explícita de la lista de hallazgos NO corregidos documentada en la parte 12. El usuario eligió ese hilo entre varios pendientes abiertos (cutover AUTH_MODE=supabase, rollback de 0003, etc. — todos siguen igual, sin tocar). De los 7 hallazgos de esa auditoría, se cerraron los 3 más concretos/verificables; los otros 4 (`.icon-btn` bajo 44px táctil, contraste de colores semánticos en modo claro, `prefers-reduced-motion` incompleto — ya existía en `styles.css` pero no se auditó su cobertura real) quedan igual de pendientes, a propósito, por ser decisiones de diseño/visuales más grandes.

**1) `.rep-tab` (Reportes → Consumo de grasa) — ahora con la misma semántica ARIA que `.hist-tab`:**
- Contenedor `#rep-consumo-tabs` → `role="tablist"`.
- Los 3 botones → `role="tab"` + `aria-selected` (inicial correcto en el markup, actualizado en cada click dentro de `dibujarConsumoTab()`, mismo patrón que ya usaba `.hist-tab`).

**2) `aria-current="page"` en el ítem de navegación activo (antes inexistente en toda la app):**
- `navigate()` (sidebar + bottom-nav de escritorio): lo asigna/quita junto con la clase `active`.
- `bootLubricador()` (bottom-nav del Lubricador): markup estático del ítem inicial ("Mi Turno") lo trae de una vez; el handler de click lo mueve de botón.
- `irAMisEngrasesTrasRegistrar()`: lo mueve a "Mis Engrases" al aterrizar ahí tras registrar un engrase.

**3) 6 `<img>` sin `alt` (la auditoría original contaba 4; al revisar de nuevo se encontraron 6 reales) — ahora todas con `alt` descriptivo:**
- Foto agregada a un punto de engrase (`addPhotoToField`), QR en lote para imprimir (`printAllQRCodes`), QR individual (`openEquipmentQR`), miniatura de punto durante el registro (`startGreaseFlow`), galería de fotos en Reportes (`renderReportes`), visor de foto a pantalla completa (`openPhotoLightbox`, reusa el `caption` que ya recibía).

**Tests:** nuevo `tests/unit/accessibility-tabs-nav.test.js` (13 tests, extracción de fuente real vía `extractDeclaration()` — mismo patrón que `dashboard-hierarchy.test.js` para funciones que no se ejecutan en la suite). 1 test existente (`tests/unit/mis-engrases-baseline.test.js`) actualizado porque su aserción dependía del texto literal exacto que cambió (sigue verificando el mismo comportamiento, ahora en 2 aserciones). Fixture estático de `tests/ui/reportes-rediseno.spec.js` actualizado para seguir siendo fiel al markup real de `renderReportes()`.

Validación completa: unit **987/987** (60 archivos, +13 desde HEAD `f0693a9`), Playwright **1792/1792** (limpio, sin flakes), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK. SW `v63` → **v64**.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase.

## Sesión 2026-09-30 (parte 13) — íconos faltantes en botones de usuarios (commit local, NO push)

Pedido: agregar íconos a los botones de la categoría "usuarios" que no tenían (ej. "Bloquear"), aplicando el mismo criterio en todo el sistema. Auditoría: de los botones realmente relacionados con sesión/cuenta, 4 no tenían ícono — el resto de la tabla de Usuarios (Rol/Activar/Desactivar) ya los tenía.

**Corregidos:**
- Sidebar → "Bloquear": nuevo ícono `.icon-lock` (candado).
- Sidebar → "Cambiar usuario": nuevo ícono `.icon-repeat` (flechas de intercambio) — a propósito distinto de `.icon-users` (ya usado por el ítem de navegación "Usuarios", para no repetir el mismo glifo con dos significados distintos).
- Usuarios (modo Supabase) → "Reset password": nuevo ícono `.icon-rotate-ccw`.
- Usuarios (legacy) → "+ Otro tipo de usuario": el "+" de texto suelto se reemplazó por `ic('plus')` (ícono ya existente), igual que su botón hermano "Nuevo lubricador" en la misma barra.

**Fuera de alcance, a propósito (no es "categoría usuarios", son pantallas distintas con su propia convención ya mixta — tocarlas sería una decisión de diseño aparte, no pedida):** los botones de PIN rápido en Configuración (`Configurar/Cambiar/Desactivar PIN`) y "Cambiar colores" (ya usa un emoji 🎨, no el sistema de íconos `ic()`) — notados pero no modificados. Las pantallas de login/Quick Unlock de página completa (`Ingresar`/`Entrar`/`Configurar PIN` en el primer login) tampoco se tocaron: ya son consistentes entre sí sin íconos, por diseño.

**3 íconos nuevos agregados a `styles.css`** (`icon-lock`, `icon-repeat`, `icon-rotate-ccw`), mismo set real de Lucide (lucide.dev) y mismo patrón de encoding que los 25 ya existentes — verificado el algoritmo exacto de encoding (reemplazo de `< > " # : = espacio salto-de-línea`, nada más) antes de generarlos, para que coincidan carácter por carácter con el resto del archivo.

Validación completa: unit **974/974** (sin cambios, es un fix de UI/CSS puro), Playwright **1792/1792** (limpio, sin flakes esta vez), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline). SW `v62` → **v63**.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase.

## Sesión 2026-09-30 (parte 12) — auditoría de accesibilidad + fix del modal genérico (commit local, NO push)

Pedido: auditoría de accesibilidad de botones/elementos de la app (solo lectura, listado de hallazgos), y después corregir el hallazgo #2 (mayor impacto, menor costo). Auditoría completa entregada en el chat (hallazgos 1-8, con evidencia real de grep/lectura de código — no se guardó como documento aparte, solo en la conversación).

**Corrección aplicada — `openModal()`/`closeModal()` (`app.js`):**
- Cierra con **Escape** (antes solo con el botón "✕" o click afuera).
- **Trampa de foco**: Tab/Shift+Tab nunca se escapan del modal hacia la página de atrás.
- **Foco inicial** al contenedor del modal (`tabindex="-1"`) al abrir — antes el foco se quedaba en la página de atrás.
- **Foco restaurado** a quien abrió el modal, al cerrar.
- `role="dialog"` `aria-modal="true"` `aria-labelledby` apuntando al título real.
- Botón "✕" con `aria-label="Cerrar"`.
- Todo implementado como funciones **internas** de `openModal()` (closures), a propósito: varios specs reales (`tests/ui/grease-validation.spec.js`) extraen SOLO `openModal`/`closeModal` con una lista acotada de nombres para probarlos en una página aislada — un identificador global nuevo los rompe con `ReferenceError` (pasó en el primer intento de este mismo lote, detectado y corregido antes de continuar).
- El listener de teclado se guarda como propiedad ad-hoc del propio `overlay` (nunca una variable nueva a nivel de módulo) y se reemplaza (no se acumula) si se abre otro modal en la misma sesión.

**Tests:** nuevo `tests/ui/modal-accessibility.spec.js` (7 casos × 7 viewports = 49 tests, ejecución real en Playwright: ARIA, foco inicial, Escape, trampa de foco, restauración de foco, no acumulación de listeners, click-afuera sigue funcionando).

Validación completa: unit **974/974** (sin cambios en unit, el fix es puramente de UI real), Playwright **1743/1743** (incluye los 49 nuevos + confirmación de que `grease-validation.spec.js` — el que se rompió en el primer intento — quedó en verde), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline, sin tocar CSS), `build:web`+`verify:dist` OK. SW `v61` → **v62**.

**Hallazgos de la auditoría NO corregidos todavía** (quedan documentados para otra sesión, por orden de impacto): tarjetas/filas "clickeables" sin `role="button"`/`tabindex` (0 coincidencias en todo `app.js`); `.icon-btn` bajo 44px de objetivo táctil; `.rep-tab` de Reportes sin `role="tab"`/`aria-selected` (a diferencia de `.hist-tab`, que sí lo tiene); 4 `<img>` sin `alt`; colores semánticos del modo claro reutilizan los valores del modo oscuro sin ajuste propio de contraste; `prefers-reduced-motion` casi no se respeta; ítem activo del sidebar sin `aria-current="page"`.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase.

## Sesión 2026-09-30 (parte 11) — primeras cuentas reales de campo (LUBRICADOR + SUPERVISOR), validadas en dispositivo real

Tras el fix de CORS (parte 10), el usuario creó desde la app (Configuración → Usuarios → Nuevo usuario) las primeras cuentas Auth reales de campo — **sin que ninguna contraseña pasara por Claude**. Confirmado por lectura de solo conteo (sin nombres, `select role, active, count(*) from app_profiles group by role, active`):

| role | active | n |
|---|---|---|
| ADMINISTRADOR | true | 1 |
| LUBRICADOR | true | 1 |
| SUPERVISOR | true | 1 |

**Probado por el usuario en dispositivo real (confirmado, no inferido):** login real con usuario/contraseña, configurar PIN (Quick Unlock), y captura offline (modo avión) — los 3, **PASS**.

**Estado del checklist de cutover (`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §15), actualizado con evidencia de hoy:**
- Login real Web con cuenta de campo real: **PASS** (confirmado hoy).
- Offline con sesión previa válida: **PASS** (confirmado hoy).
- Quick Unlock (PIN) tras cerrar/reabrir: **PASS** (confirmado hoy).
- Todavía **sin confirmar explícitamente**: logout real (cierra sesión y pide credencial completa la próxima vez), reconexión tras offline (refresca sesión + perfil antes de sync), cambio de usuario en el mismo dispositivo, y si la prueba fue en Web, Android, o ambos.
- PLANIFICADOR/VISOR: sin cuenta Auth real todavía (el propio plan solo exige el subconjunto que opera el teléfono en el pit — LUBRICADOR/SUPERVISOR —, así que esto no bloquea por sí solo).
- Rollback de 0003 nunca se ensayó en un entorno de prueba (sigue pendiente, sin entorno de staging en este proyecto).
- `anon` DENIED sobre `engrase_sync`: no verificable todavía — depende de que 0003 ya esté aplicado (se prueba DESPUÉS de aplicarlo, no antes).

**0003/0005_storage_privacy: siguen sin aplicar**, decisión ya tomada explícitamente en la sesión anterior (parte 10) por el riesgo de cortar el sync de dispositivos que aún no mandan JWT real. No se reconsideró en esta parte.

Nada de código cambió en esta parte — solo lectura de conteo (sin nombres/contraseñas) y actualización de este documento.

## Sesión 2026-09-30 (parte 10) — fix CORS manage-users (commit local + DEPLOY autorizado y ejecutado)

Tras el fix de la parte 9, el formulario de Usuarios mostraba "No se pudo conectar con el servidor" al cargar LIST_USERS. Diagnóstico read-only (curl real contra producción, sin tocar datos — ver esa respuesta) encontró la causa exacta: `manage-users/index.ts` declaraba `Access-Control-Allow-Headers: "authorization, content-type"`, pero `Auth.manageUsers()` (`src/core/auth.js`) siempre envía también `apikey` — el navegador bloqueaba el preflight `OPTIONS` antes de enviar el POST real, nunca llegaba a mandar el JWT. No era un problema de red/Auth/sync — `/rest/v1/*` (PostgREST) no lo sufre porque su gateway hace *echo* automático de los headers pedidos; una Edge Function propia tiene que declarar la lista a mano.

**Fix (1 línea real):** `CORS_HEADERS['Access-Control-Allow-Headers']` ahora es `"authorization, content-type, apikey"` — sin abrir ningún header de más. Nada de cliente/Auth/sync/RLS/roles tocado.

**Tests:** `tests/helpers/loadLubricationLogic.js` ahora expone `CORS_HEADERS` real (ejecutado, no solo texto) vía `loadManageUsersLogic()`; 3 tests nuevos en `manage-users-logic.test.js` confirman los 3 headers exactos (ni uno de más) y que Origin/Methods quedan intactos.

Validación: unit **974/974** (+3 desde HEAD `b6a751c`), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK (no aplica a Playwright/SW: el archivo cambiado es server-side, fuera del bundle web).

**DEPLOY ejecutado (autorizado explícitamente por el usuario):** `supabase functions deploy manage-users --project-ref havrirlapjyqrffgalqx` — subida exitosa (`"message":"Deployed Functions."`). Verificado en vivo inmediatamente después con la MISMA sonda `OPTIONS` de solo lectura usada en el diagnóstico (sin tocar datos): la producción ahora responde `access-control-allow-headers: authorization, content-type, apikey` — el fix está activo. `docs/SESSION_HANDOFF.md` excluido del commit como siempre. **NO se hizo `git push`** (no fue lo autorizado).

### Cierre de sesión — migraciones aditivas aplicadas, 0003 explícitamente diferido (mismo día)

Antes de cerrar, el usuario pidió "haz todo antes de cerrar". Se distinguió entre lo seguro y lo riesgoso, y se confirmó cada uno por separado con el usuario (`AskUserQuestion`) en vez de asumir que "todo" incluía la parte peligrosa:

- **0003 (cutover RLS, DROP de la policy legacy)**: el usuario eligió explícitamente **NO aplicarlo ahora**. Razón expuesta y aceptada: los dispositivos YA desplegados hoy siguen en `AUTH_MODE='legacy'` con la anon key — ninguno manda todavía un JWT real —, así que cerrar la policy legacy en este momento habría cortado el sync de TODOS los dispositivos de campo de inmediato, sin nadie disponible para monitorear/revertir (el usuario se desconectaba). **Sigue sin aplicar**, queda para una sesión donde el usuario pueda monitorear en vivo y ya existan cuentas Auth reales de campo.
- **0005_storage_privacy**: tampoco aplicado (depende de 0003 por diseño — ver el propio archivo).
- **0004/0005_lubrication_skips/0006 (todas `_rls_PREPARED.sql`, solo INSERT aditivo en `app_store_permissions`)**: el usuario SÍ autorizó aplicarlas — son de solo-agregar-permisos, nunca tocan la policy legacy ni cambian comportamiento real mientras esa policy siga activa (mismo criterio ya documentado en cada archivo). **Aplicadas** vía `supabase db query --linked --project-ref havrirlapjyqrffgalqx --file <archivo>.sql`, una por una. Verificado después (solo lectura):
  - `app_store_permissions`: 5 filas nuevas por cada store (`lubrication_assignments`, `lubrication_skips`, `notification_dispatch_log`) — 15 filas en total, exactamente lo que insertan los 3 archivos.
  - Policies de `engrase_sync` sin cambios: `"acceso interno con anon key"` sigue activa, junto a las 3 `authenticated` de 0002 — confirmado con `pg_policies`.
- Ningún rollback de estas 3 fue necesario. Nada de esto tocó Storage, OneSignal, usuarios/`app_profiles`, ni los datos operativos (`engrase_sync` fuera de las 15 filas nuevas de permisos).

Estado real de producción al cerrar: `app_profiles` sigue con 1 sola fila (Junior, ADMINISTRADOR) — sigue siendo el bloqueador real antes de poder considerar 0003. `AUTH_MODE` del código sigue en `'supabase'` (sin desplegar todavía como build real). Ningún push a git.

## Sesión 2026-09-30 (parte 9) — fix "Agregar usuario" / manage-users (commit local, NO push)

Pedido explícito: hacer funcional el formulario Configuración/Usuarios → Agregar usuario para crear usuarios Auth reales vía la Edge Function `manage-users` ya existente y desplegada. **Auditoría previa (sin asumir la causa):** el wiring cliente↔Edge Function ya era correcto — `userFormSupabase()` ya llamaba `Auth.manageUsers('CREATE_USER', fd)`, que ya reenviaba el JWT propio (nunca `auth.admin.*`/`service_role` desde el cliente), y `handleCreateUser()` del lado servidor ya creaba el Auth user + `app_profiles` con rollback correcto si el segundo paso fallaba (ya cubierto en `manage-users-logic.test.js`). **El problema real era la capa de UI**, nunca el protocolo:
- `Auth.manageUsers()` lanzaba mensajes ya redactados a medias mezclados con códigos crudos del servidor (`"username_taken"`, `"AUTH_REQUIRED"`), y una falla de RED (antes de tener respuesta) ni se capturaba — el error crudo de `fetch` (`"Failed to fetch"`/`"signal timed out"`) llegaba directo a la UI.
- Sin confirmación de contraseña, sin guardia de doble-submit, y el refresco de lista tras crear/cambiar rol recargaba toda la pantalla (`navigate('usuarios')`) en vez de solo la tabla.

**Fix (`src/core/auth.js` + `app.js`, sin tocar `manage-users` ni el modelo de roles):**
- `Auth.manageUsers()` ahora SIEMPRE lanza un código estable como `message` (`AUTH_REQUIRED`/`AUTH_FORBIDDEN`/`SYNC_NOT_CONFIGURED`/`NETWORK`/`TIMEOUT`/`HTTP_<status>`/el código real del servidor) — nunca una frase ya traducida, nunca la excepción cruda de `fetch`.
- `app.js`: `MANAGE_USERS_ERROR_LABELS`/`manageUsersErrorMessage()` — una sola tabla de traducción para las 4 pantallas (crear/rol/activar/resetear/listar), nunca stack trace/`service_role`/JWT en el mensaje.
- `withSubmitGuard()` — deshabilita el botón submit mientras la llamada está en vuelo ("Creando…"/"Guardando…"/"Restableciendo…"), evita doble creación por doble click o red lenta.
- Confirmación de contraseña (crear y resetear), comparada client-side ANTES de llamar al servidor — nunca sustituye la validación real (`minlength=8` del servidor sigue siendo la autoridad).
- Crear/cambiar rol exitosos ahora llaman `renderUsuariosSupabase(c)` directo (refresca solo la tabla) en vez de `navigate('usuarios')`.
- Revisado explícitamente y NO agregado: checkbox "Activo" en crear (el servidor siempre fuerza `active:true`, un campo así no tendría efecto real); roles de turno inventados (`SUPERVISOR_DIA`/etc. — el selector sigue usando los 5 roles reales de `PERMISSIONS`); campo de turno de notificaciones (dejado preparado estructuralmente — `fd` se reenvía genérico — pero sin implementar el modelo, fuera de alcance de este fix).

**Tests:** 22 nuevos en `manage-users-client.test.js` (ejecución real de `Auth.manageUsers()` con fetch mockeado + de `manageUsersErrorMessage()` extraída del código fuente; estructura de las 3 formas por fuente). No se duplicó la cobertura server-side ya existente (`manage-users-logic.test.js`: autorización, rollback, último-admin, etc.).

**Prueba real pendiente (documentada, NO ejecutada):** ADMIN real (Junior) → Agregar usuario → crear una cuenta real de un trabajador autorizado → confirmar que aparece en la lista → la persona recibe su credencial por un canal autorizado → login real en su dispositivo. Requiere sesión Auth real y contraseña introducida por la persona autorizada — ninguna de las dos cosas debe pasar por Claude.

Validación completa: unit **971/971** (60 archivos, +22 desde HEAD `7380d84`), Playwright **1742/1742** (1 fallo confirmado flaky en aislamiento — mismo assert `<2px` ya documentado en lotes anteriores, archivo no tocado en este fix), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK. SW `v60` → **v61**.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase/RLS/Storage/OneSignal: sin SQL, sin 0003/0005/0006 aplicadas, sin usuarios reales creados.

## Fase pre-cutover previa (misma sesión, 2026-09-30) — punto de retorno + auditoría, SIN cambios

Antes del fix de arriba, dos lotes de solo-lectura/preparación sobre HEAD `7380d84`:
- **Tag local** `pre-auth-users-rollout-7380d84` creado (sin push, sin remote configurado — confirmado que NO existe backup remoto de este repo).
- **Auditoría pre-cutover completa** (Auth/RLS/Storage/OneSignal/Sync/Android/migrations/backup — ver respuesta de esa auditoría): bloqueador P0 confirmado = `app_profiles` tiene una sola fila real (Junior, ADMINISTRADOR); 0003 (cutover RLS)/0005 (Storage privado) siguen sin aplicar; `push_tokens` sin restricción por fila propia (gap P1 abierto, no resuelto en esta sesión).
- Un intento de auditar `auth.users`/`app_profiles` en vivo (solo `SELECT`) fue bloqueado por el clasificador de esta sandbox ("Production Reads") — no se reintentó ni se forzó.

## Sesión 2026-09-30 (parte 8) — exportación de "No ejecutados" en CSV/Excel/PDF (commit local, NO push)

Pedido explícito: único objetivo, permitir exportar la sección "No ejecutados" (lubrication_skips) en CSV/Excel/PDF desde Reportes, respetando exactamente los mismos filtros del informe, sin tocar cumplimiento/realizados/pendientes/matriz.

**Fuente única para los 3 formatos:** `noEjecutadosFilasDetalle(applyFiltersSkips())` (nueva, dentro de `renderReportes()`) — ordena descendente por fecha una sola vez, reusada literalmente por CSV/Excel/PDF (≥3 ocurrencias exactas en el código), así los 3 formatos siempre muestran el mismo conjunto en el mismo orden. Resuelve las 12 columnas pedidas (Fecha/Hora/Equipo/Modelo/Ubicación/Turno/Motivo/Observación/Usuario/Cuadrilla/Occurrence/Estado); "Cuadrilla" se resuelve vía la cuadrilla ACTUAL del usuario que registró el skip (el skip no guarda su propia cuadrilla — fallback controlado, mismo patrón que ya usa el resto de la app cuando no hay snapshot histórico).

**CSV:** nuevo botón "No ejecutados (CSV)" en "Más exportaciones", reusa `downloadCSV()` existente sin duplicar función. 0 registros → `alert()` explicativo antes de generar nada (nunca un archivo corrupto).

**Excel:** nueva hoja "No ejecutados" en el mismo workbook del informe completo (`xlsHojaConFormato()`, mismo estilo/helper que Resumen/Histórico/Anomalías) — Título/Periodo/Filtros activos/Total en el subtítulo, tabla detallada debajo, anchos de columna ajustados.

**PDF:** nueva sección "NO EJECUTADOS" en el informe ejecutivo — título + Periodo/Filtros utilizados/Total, resumen por motivo (los 6 motivos reales SIEMPRE, en el orden pedido, aunque alguno esté en 0), tabla detallada con `autoTable` (pagina sola en varias páginas, sin truncar "Observación").

**Seguridad:** `downloadCSV()` ahora pasa cada campo por `csvSafeField()` — un valor que empieza con `=`, `+`, `-`, `@` se neutraliza con una comilla simple al frente (protección de CSV formula injection), aplicado a TODOS los CSV existentes de la app sin alterar su salida real (los valores existentes no empiezan con esos caracteres en la práctica; el caso real que lo necesitaba es la nueva "Observación" de texto libre).

**Tests:** nuevo archivo `reportes-no-ejecutados-export.test.js` (27 tests, cubre A-O + auditoría de exportadores §15, con ejecución real de `csvSafeField()`); actualizado `reportes-rediseno.test.js` (5ª exportación CSV) y `tests/ui/reportes-rediseno.spec.js` (fixture + botón nuevo, overflow 390/412px). Ningún test borrado.

Validación completa: unit **949/949** (59 archivos, +27 desde HEAD `38ff1ad`), Playwright **1742/1742** (1 fallo intermitente confirmado flaky en aislamiento — mismo assert `<2px` ya documentado en lotes anteriores, no relacionado a este lote), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK. SW `v59` → **v60**.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase: sin SQL, sin migration, sin Storage, sin usuarios ni registros reales.

## Sesión 2026-09-30 (parte 7) — rediseño estructural del Dashboard (commit local, NO push)

Pedido explícito: reordenar EXCLUSIVAMENTE la jerarquía visual del Dashboard (Parte D, documentada como pendiente en las partes 5 y 6) — mismos datos/filtros/cálculos/estilo, solo cambia JERARQUÍA + DISTRIBUCIÓN. Todo lo demás (match RECENTLY_GREASED, lubrication_skips en Historial/Reportes, Auth/PIN/Sync/Notificaciones/Registrar Engrase/Carryover) quedó explícitamente fuera de alcance por pedido y no se tocó.

**Nueva estructura A-I de `renderDashboard()`:**
- A. Cabecera + filtros (sin cambios).
- B. KPI principales (6, antes repartidos entre 3 secciones distintas): Vencidos, Pendientes hoy (NUEVO — mismo universo que "Cumplimiento Hoy", nunca una fórmula nueva), Próximos, Realizados hoy, Pendientes de validación, Cumplimiento hoy.
- C. Cumplimiento operativo (Hoy/Semana/Turno) — misma fórmula EXACTA, solo se movió arriba (declarada ahora antes de `colaAtencion`, ya que "Pendientes hoy" la necesita).
- D. Requieren atención (cola) — orden: Vencido > Turno anterior > Pendiente hoy (NUEVO bucket) > Próximo > Sin plan > Pausado.
- E. Pendientes del turno anterior — ahora su propia sección con panel dedicado (antes mezclada dentro de "Panel operativo"), lista real de códigos, nunca una tarjeta KPI.
- F. Estado por ubicación — extraído a su propio panel (antes dentro de "Panel operativo"), tabla 100% dinámica.
- G. Asignaciones activas + Fuera de plan + No ejecutados — resto de lo que era "Panel operativo", sección compacta separada.
- H. Mayor tiempo sin engrasar — se mueve hacia abajo, sin cambios de contenido.
- I. Indicadores secundarios (Al día/Sin plan/Pausados/Anomalías abiertas/Total equipos) — antes "Estado de lubricación"/"Actividad" con jerarquía alta, ahora al final con `dashActivityCard` (menor peso visual).

**🔴 BUG REAL de double-count encontrado y corregido (auditoría §15 obligatoria del pedido):** `pendientesTurnoAnterior` no excluía un equipo que YA se había engrasado más tarde el mismo día (Realizado atrasado) — ese equipo contaba como "pendiente turno anterior" Y como "realizado" a la vez. Corregido excluyendo cualquier equipo con un `lubrication_record` real de hoy, sin importar el turno del registro.

**Auditoría de no-double-count restante (§15), confirmada SIN necesidad de cambios de código:**
- "Vencidos" (ROJO, `weekdayStatusFor()`) y "Pendientes hoy" son mutuamente excluyentes POR CONSTRUCCIÓN: `mostRecentAssignedDate()` busca hacia atrás empezando por HOY — si hoy es día asignado, `lastDue` siempre es hoy (nunca ROJO); ROJO solo ocurre cuando el día más reciente asignado NO es hoy.
- "Próximos" excluye explícitamente lo etiquetado `PROGRAMADO HOY` (mismo campo que `weekdayStatusFor()` ya pone), para no duplicarlo con "Pendientes hoy".
- Assignments activas (ciclo de vida PENDING) y Fuera de plan hoy (records ya completados) son conjuntos con fuente de datos distinta entre sí y de D — nunca se suman a los KPI de arriba.
- El modal de "Próximos a engrase" (`openDashStatusModal`) se actualizó para usar la misma lista sin duplicado (`proximosSinHoy`), así el número del KPI y el del modal siempre coinciden.

**Tests:** `dashboard-operativo.test.js`/`dashboard-sin-plan.test.js` actualizados (assertions movidas a la nueva jerarquía, ninguna borrada); `tests/ui/dashboard-operativo.spec.js` (fixture estática) reescrito con la nueva composición visual. 7 archivos NUEVOS pedidos explícitamente: `dashboard-hierarchy`, `dashboard-attention-order`, `dashboard-carryover`, `dashboard-no-execution`, `dashboard-location`, `dashboard-assignment`, `dashboard-out-of-plan` (42 tests nuevos en total entre los 7).

Validación completa: unit **922/922** (57 archivos, +42 desde HEAD `bd60708`), Playwright **1729/1729** (limpio, sin flakes), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline preexistente), `build:web`+`verify:dist` OK. SW `v58` → **v59**.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase: sin SQL, sin migration, sin Storage, sin usuarios ni registros reales.

## Sesión 2026-09-30 (parte 6) — cierre histórico (3 commits locales, NO push)

Pedido explícito: cerrar 3 de los 4 pendientes documentados en la parte 5 (match automático de RECENTLY_GREASED, lubrication_skips en Historial, lubrication_skips en Reportes) — el 4º (reorden completo de jerarquía del Dashboard) sigue deliberadamente fuera de alcance, ver razón abajo.

**Parte A — Match automático de "ya fue engrasado" (`findMatchingGreaseRecordForOccurrence()`, operational-scope.js):**
- Alcance a propósito LIMITADO a planes "Día y turno de la semana" (Horas de operación no tiene fecha discreta que proyectar sin violar la prohibición ya documentada — siempre va a conciliación manual).
- Prioridad: 1) assignment COMPLETED de esa ocurrencia (ya inequívoca por diseño) → 2) records del mismo equipo, MISMA fecha de calendario, COMPLETE (nunca PARTIAL), no vinculados ya a otro skip; un OUT_OF_PLAN solo cuenta si su propio `satisfiedOccurrenceKey` ya certifica esa ocurrencia.
- 1 candidato → MATCH ("Vincular al plan"); 2+ → AMBIGUOUS (conciliación del Planificador); 0 → NONE (conciliación, sin cerrar nada).
- Wireado en `openNoExecutionForm()`: al elegir YA_ENGRASADO, busca en vivo y muestra el resultado; "Vincular al plan" guarda el skip con `linkedRecordId` (nuevo campo en `buildNoExecutionRecord()`) — NUNCA crea un `lubrication_record` nuevo, solo enlaza el skip al real existente (que YA satisfacía la ocurrencia por las reglas de weekly-matrix.js, sin cambios ahí).
- 9 tests nuevos en `operational-scope.test.js` (escenarios A-G del pedido + planes por Horas + constantes).

**Parte B — `lubrication_skips` en Historial (`drawHistory()`):**
- Línea temporal unificada (`eventosHist`): ENGRASE + NO_EJECUTADO ordenados por fecha real descendente, en la MISMA tabla de "Engrases" — nunca se borra un NO_EJECUTADO cuando el turno siguiente sí engrasa (ambos eventos quedan).
- Fila de skip: badge "No ejecutado" + motivo en texto real (nunca el código interno) + usuario/fecha/turno; columnas que no aplican (Horómetro/Grasa/Cantidad/Cumplimiento/Validación/Foto) muestran "—".
- Click en una fila de skip abre su propio modal de detalle (motivo/fecha/turno/usuario/observación, + nota si quedó vinculado a un engrase real).
- Nuevo KPI "No ejecutados" en la cabecera del período.
- 11 tests nuevos en `historial-skips.test.js`.

**Parte C — `lubrication_skips` en Reportes (nuevo panel "No ejecutados"):**
- `applyFiltersSkips()` reutiliza EXACTAMENTE los mismos filtros (Desde/Hasta/Equipo/Familia/Ubicación/Turno/Responsable) que `applyFilters()` aplica a records — ningún criterio propio distinto.
- Desglose: total, por turno (Día/Noche), por motivo (texto real), por ubicación, por equipo (top 5) — nunca se trata como cumplimiento (el panel no llama a `evaluateRecordCompliance()`/`complianceBadgeHTML()`, es un conteo aparte).
- 9 tests nuevos en `reportes-no-ejecutados.test.js`.
- **Fuera de alcance de esta parte (documentado)**: exportación a CSV/Excel/PDF de "No ejecutados" — el panel es solo visual por ahora, ninguno de los 3 exports existentes lo incluye todavía.

**Parte D — reorden del Dashboard: sigue SIN implementarse, a propósito.** Ya estaba documentado como pendiente desde la parte 5 (invalidaría ~100 tests existentes que verifican la estructura actual por nombre/orden de sección) — el pedido de esta sesión ya venía con esa limitación conocida y pidió cerrar las otras 3 partes primero; se mantiene la misma decisión.

Validación completa: unit **880/880** (52 archivos, +24 desde HEAD `9bab9d7`), Playwright **1666/1666** (limpio, sin flakes esta vez), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK (12 módulos en `src/core/`). SW `v57` → **v58**.

Commits separados por parte (A/B+C combinadas por estar ambas en drawHistory/renderReportes de app.js, D deliberadamente omitida): ninguno amendado. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase: sin SQL, sin migration 0006 aplicada, sin Storage, sin usuarios ni registros reales.

## Sesión 2026-09-30 (parte 5) — cierre operativo: Registrar Engrase + Dashboard (commit local, NO push)

Pedido explícito: cerrar la experiencia de trabajo pendiente entre turnos, "No se pudo ejecutar", Registrar Engrase y Dashboard, SIN rehacer Auth/notificaciones (ya cerrado en partes 3/4). Dado el tamaño real del pedido (rediseño completo de jerarquía del Dashboard + formulario + Historial/Reportes + ~30 escenarios de test), este lote se enfocó en lo más valioso y verificable, con alcance explícito abajo.

**🔴 BUG REAL CRÍTICO encontrado y corregido: `renderDashboard()` podía reventar con un carryover real.**
`turnoActual` (turno operativo actual) se declaraba en la sección "Cumplimiento operativo", pero `pendientesTurnoAnterior` (Panel operativo, declarado ANTES en la función) ya lo usaba dentro de `carry && carry.shiftId !== turnoActual`. Mientras `carry` fuera `null` (sin ningún `lubrication_skip` real ese día — el único caso que cubrían los tests hasta ahora, en 2 sesiones completas de "836/836 unit + 1666/1666 Playwright" sin que nadie lo notara), el `&&` cortocircuitaba y la lectura de `turnoActual` nunca se ejecutaba. En cuanto existiera un carryover REAL — justo el escenario que esta sección existe para mostrar — `carry` se vuelve verdadero, `turnoActual` se lee en su *temporal dead zone* (`const` usado antes de su propia declaración) y el Dashboard ENTERO revienta con un `ReferenceError` sin mostrar nada. Corregido subiendo la declaración al principio de la función. Test de regresión agregado en `dashboard-operativo.test.js` (verifica posición relativa en el código fuente, ya que nada ejecuta `renderDashboard()` de verdad en la suite de tests — ver limitación abajo).

**Registrar Engrase:**
- Contexto completo de la ocurrencia tras elegir equipo: Ubicación, Tipo de trabajo (reutiliza `findExistingWorkForEquipment()`, nunca reimplementa la prioridad ASSIGNED>PLANNED>NONE), Estado, Programado, Turno actual, Último engrase — todo con datos reales (`<dl class="grease-flow-contexto">`), junto a los 3 avisos ya existentes (turno distinto/vencido/carryover).
- Selector de equipo colapsa a un chip compacto (`collapseRegSelectToChip()`) tras elegir — "[código · marca modelo] [Cambiar]" — en vez de seguir ocupando espacio con el buscador+recientes mientras se llena el formulario.
- Botón "No se pudo ejecutar" ahora SOLO visible cuando `findExistingWorkForEquipment().kind !== 'NONE'` (PLANNED/ASSIGNED pendientes) — antes aparecía siempre, incluso sin ninguna ocurrencia real que "no ejecutar".
- Guardar sticky REAL en móvil (`position: sticky`, no solo el orden `column-reverse` de antes) dentro del shell del Lubricador — verificado con un test real contra el markup de `.lub-bottom-nav` (nunca la tapa, `bottom: 68px` deja el margen justo).

**Dashboard (además del bug):**
- "Pendientes turno anterior" ahora muestra los códigos de equipo reales (ej. "A11, 45-77"), no solo un número — explícitamente distinto de "vencidos históricos" en el texto.

**Fuera de alcance de este lote (documentado, NO implementado)** — demasiado grande para esta pasada sin sacrificar rigor:
- Reordenar la jerarquía completa de KPIs del Dashboard (primarios/secundarios, mover "Atención" arriba) — invalidaría ~100 tests existentes que verifican la estructura actual por nombre/orden de sección; requiere su propio lote con esos tests reescritos a propósito.
- Historial: no distingue todavía filas NO EJECUTADO+MOTIVO (los `lubrication_skips` nunca se mezclan con `lubrication_records` en esa vista) — gap real confirmado (`grep` de `lubrication_skips` en app.js solo aparece en Dashboard/startGreaseFlow), no cerrado.
- Reportes: análisis por categoría (realizados a tiempo/atrasados/adelantados/no ejecutados por motivo/fuera de plan) — no auditado ni implementado.
- `RECENTLY_GREASED` (YA_ENGRASADO) con búsqueda automática de un registro real reciente para vincular sin ambigüedad — sigue yendo directo a conciliación en todos los casos, nunca intenta el match automático.
- **Limitación estructural notada**: `renderDashboard()` NUNCA se ejecuta de verdad en ningún test (todo es texto-fuente o fixtures estáticas) — así sobrevivió el bug de arriba 2 sesiones completas. Vale la pena una sesión futura dedicada a un test de ejecución real (Playwright con app booteada + IndexedDB seedeada), no solo visual/fuente.

Validación completa: unit **845/845** (48 archivos, +9 desde HEAD `56cc8ce`), Playwright **1666/1666** (1 fallo intermitente confirmado flaky bajo carga, en un assert de tolerancia `<2px` ya existente, no relacionado a este lote — pasa limpio en aislamiento), `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK. SW `v56` → **v57**.

`docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase.

## Sesión 2026-09-30 (parte 4) — cierre de integración de notificaciones (commit local, NO push)

Pedido explícito: antes de cerrar notificaciones, identificar TODOS los callers existentes (grep de sendNotification/pushAll/notify-push/notify-vencidos/OneSignal/LocalNotifications/etc.) y migrarlos al routing central (`isUserEligibleForNotification()`) en vez de dejar caminos paralelos "rol → token".

**Inventario de callers (completo):**

| Caller | Evento | Canal | Estado antes | Estado ahora |
|---|---|---|---|---|
| `refreshLocalNotifications()` | vencidos/porEngrasar/cumplimiento/resumenSemanal/asignaciones | LOCAL (recalculado en cada sync/boot) | solo `cfg.roles.includes(rol)` | **migrado**: `elegiblePara()`→`isUserEligibleForNotification()` por tipo |
| `notifyNewAnomalies()` | anomalía nueva al sincronizar | LOCAL, inmediato | cualquier severidad, solo rol | **migrado**: `routeAnomalyEvent()` corta Media/Baja (resumen, no push individual) + elegibilidad real |
| `notificarEngraseRealizado()` | engrase registrado (toast mismo dispositivo) | LOCAL | sin distinguir OUT_OF_PLAN | **migrado**: `shouldNotifyOutOfPlanCompletion()` corta antes que cualquier otro filtro |
| `notify-push` (Edge Function) | anomalies / lubrication_records / **lubrication_skips (nuevo)** | REMOTO (OneSignal) | ya migrado en la parte 3 | **+ rama nueva**: CONDICION_INSEGURA inmediata, YA_ENGRASADO conciliación, con dedupe |
| `notify-vencidos` (Edge Function) | vencidos/porEngrasar | REMOTO | ya migrado en la parte 3 | sin cambios en este cierre |
| `createAssignment`/`reassignAssignment`/`cancelAssignment`/`completeAssignmentIfPending` (operational-scope.js) | ciclo de vida de asignación | — | puras, no notifican ellas mismas | **sin cambios** — el aviso real ya lo dispara `refreshLocalNotifications()` al recalcular desde `lubrication_assignments` (ya migrado arriba) |
| `NOTIF_ID_DAILY_TASKS` / `NOTIF_ID_WEEKDAY_PLAN` | — | — | declarados, en el cancel-list | **dead code confirmado** — nunca se usan para programar nada, no se inventó uso nuevo |

**Assignments (§3):** sin cambios de código — `refreshLocalNotifications()` ya recalcula TODO desde cero cada vez (cancela las 11 IDs conocidas primero), así que reasignar A→B ya hace que A deje de calificar y B empiece a calificar en el siguiente recálculo, sin rastreo de estado propio. Ahora además respeta RESTING (un Lubricador de descanso no recibe el aviso de asignación aunque tenga una real pendiente).

**Carryover (§4):** el turno saliente deja de recibir por construcción: `elegiblePara()` usa `currentShiftId()` real en cada recálculo, así que en el primer sync/boot después de que el turno cambie, alguien con `notificationShift` fijo a un solo turno deja de calificar (y esa notificación se cancela como parte del "cancelar todo primero" de siempre). Limitación conocida documentada (no resuelta): las horas fijas de los avisos programados (07:00, etc.) son globales, no por turno — si el recálculo ocurre durante MI turno pero la hora programada cae en el ajeno, puede haber un desfase menor; no se rediseñó el scheduling por turno en este cierre.

**No se pudo ejecutar (§5):** `lubrication_skips` NUNCA tuvo ningún caller de notificación hasta este cierre — gap real cerrado con la rama nueva en `notify-push`. REPARACION/SIN_TIEMPO/NO_DISPONIBLE/OTRO nunca disparan nada (carryover ya los muestra); CONDICION_INSEGURA es inmediata; YA_ENGRASADO es conciliación — nunca la misma ruta ni los mismos roles.

**OUT_OF_PLAN (§6):** `notificarEngraseRealizado()` (local) también corta ahora, igual que `notify-push` (remoto, desde la parte 3).

**Anomalías (§7):** `notifyNewAnomalies()` (local) ahora usa la MISMA regla de severidad que `notify-push` (remoto): Crítica/Alta inmediatas, Media/Baja a resumen — antes avisaba de cualquier severidad.

**Vencidos/resúmenes (§8):** ya usaban `settings/notifications` centralizado; ahora además pasan por elegibilidad real, no solo rol.

**Local Notifications (§9):** `logout()` ya cancelaba (parte 3); se agregó un test dedicado que verifica la fuente de `logout()`/`lockApp()`/`confirmChangeUser()`/`enterAppAsProfile()` para que esto nunca se rompa en silencio.

**Dedupe (§10):** la rama nueva de `lubrication_skips` en `notify-push` usa el MISMO formato de clave (`tipo|ocurrencia|destinatario|ventana`) que ya usaban `notify-vencidos`/las otras ramas de `notify-push`.

**OneSignal (§11):** sin cambios de código — ya verificado en la parte 3 (login→`OneSignal.login(userId)`, logout→`OneSignal.logout()`, Bloquear intacto).

**Preferencias de otros usuarios (§12):** NO implementado a propósito (pedido explícito de no bloquear este cierre por eso) — sigue siendo autoservicio únicamente, documentado como pendiente.

**Tests nuevos:** `tests/unit/notification-callers-migrated.test.js` (16 tests, uno por caller migrado + logout/lockApp/confirmChangeUser/enterAppAsProfile) + 1 test nuevo en `notification-routing.test.js` (valor de criticidad desconocido). `ANOMALY_NOTIFICATION_ROUTE`/`routeAnomalyEvent()` cambiaron sus claves de inglés (CRITICAL/HIGH/MEDIUM/LOW, inventadas) a español (Crítica/Alta/Media/Baja, el vocabulario REAL de `anomaly.criticality` en toda la app) — corrección propia encontrada al ir a conectar el caller real.

Validación completa: unit **835/835** (48 archivos, +17 desde HEAD `c9fb549`), Playwright **1666/1666**, `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK. SW `v55` → **v56**.

Commit único (`refactor: route all notifications through central recipient policy`) — el cambio real fue eso. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.** Nada tocó producción/Supabase: sin SQL, sin usuarios, sin push real, sin deploy, migration 0006 sigue sin ejecutarse.

## Sesión 2026-09-30 (parte 3) — arquitectura de notificaciones (commits locales, NO push)

Pedido explícito del usuario, sobre HEAD `50fd418`: enrutar notificaciones por usuario+turno+disponibilidad+scope, SIN crear roles de turno nuevos (NO "SUPERVISOR_DIA"/"SUPERVISOR_NOCHE"), atar la identidad de OneSignal al usuario Auth (nunca al dispositivo), y auditar/corregir `disablePushForCurrentUser()`. Alcance real (41 secciones pedidas) demasiado grande para una sola sesión con la misma rigurosidad del resto del proyecto — se implementó el núcleo completo y se dejó explícitamente fuera lo que necesita una decisión de producto separada (ver "Fuera de alcance" abajo).

**Implementado:**
- **`src/core/notification-routing.js` (nuevo)**: motor puro de elegibilidad — `isUserEligibleForNotification()` (active + rol permitido + disponibilidad AVAILABLE + turno compatible o `receiveAllShifts`), `routeNoExecutionEvent()` (§26: CONDICION_INSEGURA → alerta inmediata, YA_ENGRASADO → conciliación, el resto → sin aviso/carryover ya visible), `shouldNotifyOutOfPlanCompletion()` (§27: siempre `false`), `routeAnomalyEvent()` (§28: CRITICAL/HIGH inmediatas, MEDIUM/LOW solo resumen), `buildNotificationDedupeKey()` (§30). 28 tests.
- **Identidad OneSignal atada al usuario (§9-§13)**: `bindOneSignalIdentity()`/`clearOneSignalIdentity()` (app.js) — `OneSignal.login(userId)` en `enterAppAsProfile()` (login exitoso), `OneSignal.logout()` en `logout()` (solo modo supabase), **intacta en `lockApp()`** (Bloquear sigue siendo la misma persona). Sin efecto mientras `ONESIGNAL_APP_ID` siga vacío (como hoy). 14 tests, incluyendo la demostración user A → user B pedida (§35).
- **2 bugs reales encontrados y corregidos:**
  1. `disablePushForCurrentUser()` buscaba la fila por `tok_${userId}` (sin plataforma) — `saveOneSignalId()` SIEMPRE la guarda como `tok_${userId}_${plataforma}`. Esa clave nunca existió: la función jamás desactivó un push_token real en ningún logout desde que se escribió. Corregido buscando por el campo `userId` (desactiva todas las plataformas de la persona).
  2. El filtro de zona/turno de Lubricador en `notify-vencidos`/`notify-push` (Edge Functions, ya existente) comparaba `disp.shiftId`/`disp.locationId`/`disp.cuadrillaId` contra campos que la fila de push_tokens de la PERSONA nunca tenía (solo existían en la fila aparte del DISPOSITIVO, que nunca tiene un `token` real) — en la práctica ese filtro nunca hacía nada, todo Lubricador recibía todo sin importar zona/turno. Corregido: `saveOneSignalId()` ahora copia `cuadrillaId`/`locationId`/`shiftId` del dispositivo sobre la fila de la persona; `saveDeviceAssignment()` los refresca de inmediato si cambian mientras alguien sigue conectado (`refreshPushTokenDeviceScope()`). 13 tests nuevos (`tests/unit/push-token-scope.test.js`).
- **Preferencias de notificación propias (§2/§21/§22/§29)**: `notificationShift`/`notificationAvailability`/`receiveAllShifts` en la fila push_tokens de cada persona (default BOTH/AVAILABLE/false, preservadas entre renovaciones de subscription id). Autoservicio vía `saveNotificationPreferences()` + bloque "Mis notificaciones" en Configuración (turno/disponibilidad para cualquiera, `receiveAllShifts` solo visible para ADMINISTRADOR) — solo existe si `ONESIGNAL_APP_ID` está configurado y la persona ya activó push.
- **`cancelAllLocalNotifications()` (§15)**: factorizada fuera de `refreshLocalNotifications()`, ahora también se llama desde `logout()` — antes las notificaciones locales de la persona anterior quedaban programadas hasta que alguien más iniciaba sesión y las recalculaba; ahora se cancelan de inmediato al cerrar sesión.
- **Edge Functions (`notify-vencidos`, `notify-push`) — eligibilidad server-side real (§31)**: `isRecipientEligible()` (misma regla que `isUserEligibleForNotification()`, reimplementada porque Deno no puede importar el bundle del navegador) ahora se aplica a CUALQUIER rol, no solo Lubricador. `notify-push` además: `OUT_OF_PLAN` nunca dispara el push normal de "engrase realizado" (§27); anomalías MEDIUM/LOW ya no se envían individualmente (solo CRITICAL/HIGH, §28). Deduplicación real (§30) en ambas vía `claimDedupeKey()` — INSERT atómico con `ignore-duplicates`+`on_conflict(store,id)` sobre un store nuevo `notification_dispatch_log` (mismo mecanismo CAS que ya usa `pushAll()` en sync.js). 10 tests nuevos de la función pura de elegibilidad de cada Edge Function.
- **Migration preparada, NO ejecutada**: `0006_notification_dispatch_log_rls_PREPARED.sql` (+`_ROLLBACK.sql`) — solo ADMINISTRADOR puede leer, nadie del cliente puede escribir (solo `SERVICE_ROLE_KEY`, que ya ignora RLS).
- Validación completa: unit **818/818** (48 archivos, +67 desde HEAD `50fd418`), Playwright **1666/1666**, `typecheck` limpio, `lint:css` 0 errores (67 warnings, mismo baseline), `build:web`+`verify:dist` OK (13 módulos en `src/core/`). SW `v54` → **v55**.

**Auditado y CONFIRMADO ya correcto, sin cambios** (§4): `currentShiftId()` (src/core/shifts.js) es la ÚNICA fuente real del turno operativo — no se encontró ninguna comparación de hora duplicada en ningún otro archivo; se reutilizó tal cual (traducida a DAY/NIGHT en notification-routing.js). El admin YA tenía una UI completa para configurar horarios de notificaciones programadas (§17/§18: `renderConfig()`/`notifCardHTML()`, vencidos/porEngrasar/cumplimiento/resumenSemanal con hora+roles+enable editables y persistidos) — NO hacía falta construir nada ahí, solo se confirmó que existe.

**Deliberadamente NO implementado en esta sesión** (demasiado grande/riesgoso para una sola pasada, requiere decisión explícita antes de tocar código):
- Admin editando las preferencias de notificación de OTRA persona (solo autoservicio por ahora — cada quien configura las suyas).
- Reescribir CADA sitio existente de notificación (ciclo de assignments, carryover, "no se pudo ejecutar" real end-to-end) para pasar por el nuevo motor puro — ese trabajo ya estaba implementado y probado de sesiones anteriores; este lote agrega la INFRAESTRUCTURA (motor de elegibilidad + identidad + Edge Functions), no migra cada caller existente.
- "Recordatorio Día 12:00"/"Recordatorio Noche 00:00" como tipos de notificación nuevos (el pedido los listaba como defaults conceptuales; hoy no existen como tipos separados — solo `vencidos`/`porEngrasar` con su propio recordatorio a N horas).
- Prueba en dispositivo real / rebuild de APK (OneSignal nativo no se puede verificar sin una cuenta real configurada, que sigue sin existir — `ONESIGNAL_APP_ID` sigue vacío a propósito).
- Deploy de los Edge Functions modificados, ejecución de la migration 0006, o cualquier cambio a producción — nada de esto se hizo ni se hará sin autorización explícita y específica.

Commits (sobre `50fd418`, ninguno amendado): separados por archivo/concepto — motor puro + tests, wiring de app.js/identidad/UI, Edge Functions + migration. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.**

## Sesión 2026-09-30 (parte 2) — continuación del lote de 15 puntos pedido por el usuario (commits locales, NO push)

El usuario pidió continuar un lote de 15 puntos (motivo de no ejecución, mejoras a Registrar Engrase, Dashboard, sidebar, notificaciones locales/push programadas/inmediatas, dedupe, producción, validación, commits) partiendo de HEAD `34c1902`. Antes de tocar nada se lanzaron 4 auditorías de solo lectura en paralelo (motivo-no-ejecución/Registrar Engrase, Dashboard, sidebar, notificaciones) — ver `docs/OPERATIONAL_SCOPE.md` §"Lote occurrences/carryover (2026-09-30)" para el detalle técnico completo. Resumen de qué se implementó y qué no:

**Implementado en esta sesión:**
- **§1 "No se pudo ejecutar"**: store nuevo `lubrication_skips` (DB_VERSION 7→8), motivo+observación, NUNCA crea un engrase, carryover automático al turno siguiente (gratis, ya lo daba `estadoCelda()` por ser lógica basada en FECHA no en turno). RLS preparada (`0005_lubrication_skips_rls_PREPARED.sql`), NO aplicada.
- **§2 Registrar Engrase**: contexto de turno programado/actual + vencido + carryover en el header; selector de equipo por búsqueda (reemplaza el `<select>` gigante); validación 0 lb con checklist 100%; "Marcar todos" con confirmación; retroactivo bajo "Opciones avanzadas". "Guardar fácil en móvil" ya estaba resuelto de un lote anterior (verificado, no tocado).
- **§3 Dashboard**: nueva sección "Panel operativo" (pendientes turno anterior, asignaciones activas, fuera de plan hoy, motivos de no ejecución, estado por ubicación) — cero conteos nuevos duplicados, todo reusa funciones/datos ya existentes.

**Auditado pero CERRADO sin cambios de código:**
- **§4 Sidebar**: auditoría confirmó que NO hay duplicado real de Equipos/Historial/Actualizar Horómetros/Anomalías — cada label es una sola entrada en el array `MENU`, correctamente filtrada por rol; LUBRICADOR usa un shell completamente separado y mutuamente excluyente. Se encontró un overlap cosmético menor (bottom-nav + sidebar drawer abierto pueden mostrar el mismo ítem 2 veces en móvil), probablemente intencional, documentado pero no tocado.

**Auditado y DELIBERADAMENTE NO implementado (§5-§12, notificaciones):**
- La auditoría reveló que esto es un cambio de arquitectura, no un ajuste: OneSignal hoy es 100% anónimo/por dispositivo (cero `external_id`/`login()`), no existe ningún rol "Supervisor Día" vs "Supervisor Noche" (el enum de roles es plano, turno es un atributo separado), hay una llave rota en `disablePushForCurrentUser()` (busca `tok_${userId}` pero `saveOneSignalId()` guarda `tok_${userId}_${plat}`), y no hay UI de horarios programables por Admin. Implementar el pedido completo (identidad por usuario en dispositivos compartidos, roles turno-conscientes, ventana de "recibir alertas de todos los turnos" para Admin, horarios editables, dedupe real) requiere decidir el modelo de roles/identidad ANTES de escribir código — se detuvo aquí a propósito para que el usuario confirme el diseño, en vez de improvisar un cambio de esa magnitud sin checkpoint.
- Nada de esto se tocó: `auth.js`, `app.js` (sección OneSignal), roles/permisos, ninguna Edge Function.

**Validación completa**: unit **753/753** (+17 sobre HEAD `34c1902`), Playwright **1666/1666** (repetido 2 veces — 1 corrida tuvo 5 fallos transitorios de `page.addStyleTag` bajo carga, confirmado flaky al repetirla), `typecheck` limpio, `lint:css` 0 errores (67 warnings, +2 sobre baseline, misma clase ya tolerada), `build:web`+`verify:dist` OK. SW `v53` → **v54**.

`docs/SESSION_HANDOFF.md` excluido de los commits como siempre. **NO se hizo push.** Nada tocó producción/Supabase.

## Sesión 2026-09-30 — lote occurrences/carryover: "realizado atrasado" (1 commit local, NO push)

Al reabrir esta sesión ("continue") se encontró trabajo YA HECHO pero sin commitear en el working tree (de un turno anterior de esta misma conversación, cuyo contexto ya no estaba disponible): un nuevo estado de cumplimiento `realizado_atrasado` para el caso "el día es correcto pero el registro real quedó en el OTRO turno del mismo día" (ej. Noche cerrando lo pendiente de Día) — antes esto se reportaba como `fuera_de_plan`, engañoso porque el trabajo SÍ se hizo.

- `src/core/plan-compliance.js`: `evaluateRecordCompliance()` (control "Día y turno de la semana") devuelve `realizado_atrasado` en vez de `fuera_de_plan` cuando el día coincide y el turno no. `computeFleetCompliance()` cuenta `realizado_atrasado` como cumplimiento en el % (junto a `cumplido`), pero lo reporta aparte en `counts` para que Reportes pueda distinguirlo si quiere.
- `src/core/weekly-matrix.js`: `estadoCelda()` devuelve `hecho_atrasado` (en vez de `hecho`) cuando `plan.shiftId` existe y el registro real tiene un `shiftId` distinto — nunca oculta el registro real, solo cambia el tipo de celda.
- `app.js`: Matriz Semanal — nuevo bucket `TIPOS_HECHO` (`hecho`/`hecho_atrasado`/`hecho_adelantado`) usado en los 3 lugares que contaban "hechas" (resumen por turno, conteo semanal, header). Celdas `hecho_atrasado`/`hecho_adelantado` wireadas en la tabla interactiva (antes `hecho_adelantado` ya existía en `estadoCelda()` pero nunca se pintaba — caía en blanco) y en el export a Excel. `complianceBadgeHTML()` gana el badge "Realizado atrasado" (mismo tono `hist-compliance-teal` que "Validado · Encargado").
- `styles.css`: `.celda-hecho-atrasado` (turquesa `#2DB6A3`, igual que `hist-compliance-teal`) y `.celda-hecho-adelantado` (azulado `#5B7FBF`, color propio nuevo).
- **Bug real encontrado y corregido en el camino:** `tests/ui/historial-eq-search-flow.spec.js` tenía un test (`cumplimiento Día/Turno...`) que esperaba literalmente `'Fuera de plan'` para el caso día-correcto-turno-equivocado — es EXACTAMENTE el escenario que este lote cambia de comportamiento a propósito. Corregido a `'Realizado atrasado'`, con comentario explicando el cambio de comportamiento intencional.
- Tests nuevos: `tests/unit/plan-compliance.test.js` (+1: `computeFleetCompliance` cuenta `realizado_atrasado` como cumplimiento) + `tests/unit/matriz-estado-celda.test.js` (+2: `hecho_atrasado` cuando el plan exige turno, y que NO aplica si el plan no exige turno).
- Validación completa: unit **739/739** (43 archivos, +3 nuevos), Playwright **1666/1666** (sin nuevos specs, pero el roto quedó corregido), `typecheck` limpio, `lint:css` 0 errores (65 warnings, mismo baseline), `build:web`+`verify:dist` OK. SW `v52` → **v53**.
- Commit local (`fix: count carryover grease as compliant across shifts`) incluyendo `app.js`, `plan-compliance.js`, `weekly-matrix.js`, `styles.css`, `sw.js`, `tests/ui/historial-eq-search-flow.spec.js`, `tests/unit/matriz-estado-celda.test.js`, `tests/unit/plan-compliance.test.js`. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.**
- Nada tocó producción/Supabase.

## Sesión 2026-09-28 (parte 6, histórico) — lote pre-cutover PIN+sync+storage, 3 commits locales, NADA desplegado, bucket sigue público en producción.

## Estado del repositorio

- **Branch:** `migration-typescript`
- **HEAD:** `8065dd4` — "fix: complete private storage image rendering"
- **Working tree:** limpio, salvo este mismo archivo (`docs/SESSION_HANDOFF.md`, intencionalmente sin trackear).
- **NO se hizo push en ningún momento de esta sesión ni de las anteriores cubiertas por este documento.**
- **stash@{0}** — sigue intacto, NO tocado.

## Resumen de lo cerrado en esta sesión (P0-1 + P0-2)

### P0-1 — Sync multidispositivo (CERRADO)
- CAS atómico real en `pushAll()` (PATCH condicionado a `updated_at=eq.<_pushedVersion>`, POST con `Prefer: resolution=ignore-duplicates`) — reemplaza un diseño anterior GET-then-write con ventana de carrera real.
- `decidePullAction()` (ACCEPT/KEEP_LOCAL/CONFLICT) para el lado pull.
- Verificado con test de carrera real entre 2 "dispositivos".
- Commit: `588f076`.

### P0-2 — Supabase Auth + RLS (CERRADO, en modo pre-cutover)
- Auditoría read-only de los 7 usuarios reales de producción → ninguno es una persona real; clasificados `LEGACY_SHARED` / `TEST_SEED` / `LEGACY_OPERATIONAL_ALIAS`, todos `NO LOGIN FUTURO`.
- Regla de identidad formal: AUTH USER = persona real únicamente.
- Diseño Auth/RLS documentado (`docs/AUTH_RLS_MIGRATION_DESIGN.md`, `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md`, `docs/AUTH_USERS_ROLLOUT_TEMPLATE.md`).
- Adaptador cliente `src/core/auth.js` detrás de feature flag `AUTH_MODE` (**sigue en `'legacy'`**, nunca activado en código committeado).
- Persistencia de sesión endurecida: namespaces separados para tokens/perfil, `isAuthenticated()` valida expiración, `fullSync()` refresca sesión primero.
- **Aplicado a producción real (autorizado explícitamente):** `0002_auth_profiles_rls_PREPARED.sql` — políticas RLS nuevas coexistiendo con la policy legacy (`using(true)/with check(true)`), que **sigue activa** (Postgres OR de policies permisivas ⇒ las nuevas son comprobadamente inertes hasta que se cierre la legacy, paso NO ejecutado). Rollback preparado en `0002_auth_profiles_rls_ROLLBACK.sql`, no ejecutado.
- **Bug real encontrado y corregido en producción:** recursión infinita (Postgres 42P17) en 3 policies de `app_profiles` por un `EXISTS` autorreferencial — corregido usando las funciones `SECURITY DEFINER` (`current_app_role()`/`current_app_active()`). Autorizado explícitamente por el usuario antes de aplicar. Backporteado a `0001_..._DRAFT.sql` y `0002_..._PREPARED.sql` en el repo.
- **Junior Valles creada** en Supabase Auth (cuenta creada manualmente por el usuario, contraseña nunca pasó por Claude/terminal/script/archivo/Git) + `app_profiles` con rol `ADMINISTRADOR` (creado por mí tras precheck de solo lectura).
- **Piloto real de login verificado en vivo** (Playwright, browser visible, contraseña tecleada directamente por el usuario, nunca vista/leída por Claude): login, sesión, offline, reconexión, logout — todo OK. Bloqueo de escritura activo durante la prueba (ninguna escritura real a `engrase_sync`/Storage).
- **Bug de bootstrap encontrado durante el piloto:** una IndexedDB nueva sembraba un `u_admin`/PIN local que colisionaba con el `u_admin` real de producción al hacer push. **Corregido** en el turno siguiente: `db.js` ya no siembra usuarios/PINs legacy cuando `AUTH_MODE='supabase'` (`isSupabaseAuthMode()` como única fuente de verdad).
- Commits de este bloque: `7d14247`, `96759ba`, `5f25806`, `593bbd1`, `f3bc2aa`, `4e44089`.

### P0-2 — Administración segura de usuarios (CERRADO, NO desplegado)
- Edge Function `supabase/functions/manage-users/index.ts` — creada, **NO desplegada**. Operaciones: `LIST_USERS`, `CREATE_USER`, `UPDATE_ROLE`, `SET_ACTIVE`, `RESET_PASSWORD`.
- `service_role` confinado 100% server-side (nunca en cliente/Git/logs). Autorización server-side vía JWT → `app_profiles` (rol `ADMINISTRADOR` + `active=true`), nunca confía en `payload.role`/`localStorage`/rol del cliente.
- `CREATE_USER`: rollback (`DELETE /auth/v1/admin/users/<id>`) si falla la creación del `app_profile`.
- `UPDATE_ROLE`/`SET_ACTIVE`: protección de 0 administradores activos (`wouldLeaveZeroActiveAdmins`).
- `RESET_PASSWORD`: la contraseña nunca se devuelve ni se loguea.
- Cliente: `Auth.manageUsers(action, payload)` en `src/core/auth.js` — reenvía únicamente el JWT propio del usuario autenticado, nunca `service_role`.
- UI: `renderUsuariosSupabase()`/`userFormSupabase()`/`roleFormSupabase()`/`resetPasswordFormSupabase()` en `app.js`, activas solo cuando `Auth.isSupabaseMode()` es verdadero; modo legacy (pantalla de usuarios con PIN) **sin ningún cambio**. Offline: botones deshabilitados + banner "Requiere conexión", sin cola de reintento.
- Tests: `tests/unit/manage-users-logic.test.js` (24, nuevo) + bloque "O" en `tests/unit/auth.test.js` (offline/con-sesión) — extracción vía `loadManageUsersLogic()` en `loadLubricationLogic.js` (el `.ts` se escribió como JS válido, sin tipos reales, para ser compatible con `new Function(...)`).
- SW `CACHE` subido de `v40` a `v41` (runtime cambiado: `auth.js` + `app.js`).
- Validación completa: unit 577/577, Playwright 1393/1393, `typecheck` limpio, `lint:css` limpio (mismo baseline de warnings), `build:web` + `verify:dist` OK.
- Commit: `a4c22ea` — `feat: add secure user administration`.

## Sesión 2026-09-27 — deploy de `manage-users` (autorizado explícitamente, paso a paso)

- **Preflight (solo lectura):** CLI de Supabase enlazado a `cont_engrase` (`havrirlapjyqrffgalqx`); secrets `SUPABASE_URL`/`SUPABASE_ANON_KEY`/`SUPABASE_SERVICE_ROLE_KEY` ya existían en el proyecto (no hizo falta configurar nada); `AUTH_MODE` confirmado en `'legacy'`; tests `manage-users-logic.test.js` (24) + bloque auth (32) → 56/56 verdes.
- **Deploy ejecutado** (`supabase functions deploy manage-users --project-ref havrirlapjyqrffgalqx`) → `manage-users` ahora `ACTIVE`, versión 1, `verify_jwt: true` (mismo criterio que `notify-push`/`notify-vencidos`).
- **Prueba 401 (sin token):** POST directo sin `Authorization` → `401` (gate de plataforma de Supabase, `UNAUTHORIZED_NO_AUTH_HEADER`), antes de llegar al código propio.
- **Prueba LIST_USERS con Junior Valles (real, autorizado explícitamente):** navegador Playwright headed, DevTools abierto, el usuario tecleó él mismo `Auth.signIn('jvalles', <su contraseña real>)` y luego `Auth.manageUsers('LIST_USERS')` en la consola — Claude nunca vio la contraseña. Resultado: `200 OK`, exactamente 1 usuario (`u_jvalles`, `ADMINISTRADOR`, `active:true`), sin campos sensibles. Confirma la cadena completa: JWT validado contra `/auth/v1/user`, rol leído solo de `app_profiles`, autorización correcta.
- **Red de seguridad activa durante la prueba:** `page.route()` bloqueando cualquier PATCH/POST/PUT a `engrase_sync`/Storage. **Se activó de verdad**: el propio boot de la app intenta un `fullSync()` periódico (ajeno al login) que hizo varios POST a `engrase_sync` — todos bloqueados (`ERR_BLOCKED_BY_CLIENT`), cero escritura real. Sin este bloqueo se habría escrito en producción sin que el login lo pidiera; **tenerlo en cuenta para cualquier prueba futura con navegador real conectado a producción**.
- **403 (autenticado pero NO admin) — NO probado todavía:** no existe ningún segundo usuario real no-admin; probarlo requiere `CREATE_USER` (paso 5 del plan, autorización aparte).
- Script de prueba (`tests/_tmp_manage_users_check.mjs`) y servidor `vite dev` usados solo para esta verificación — ambos **borrados/detenidos** al terminar, nada quedó corriendo ni trackeado.
- `AUTH_MODE` **no se tocó** en ningún momento (`Auth.signIn`/`Auth.manageUsers` no dependen del flag) — sigue `'legacy'` en el código, confirmado de nuevo al cerrar.

## Sesión 2026-09-27 (parte 2) — cierre gate de sync auth + baseline (solo lectura + tests, sin tocar producción)

- **Baseline de validación verificado correcto:** `App.generalSettings.shiftDayStart = 6` (06:00 local, default de producción — no existe override `settings/general`). `GREASE_VALIDATION_ENABLED_FROM = '2026-09-27T12:00:00.000Z'` equivale a **06:00 hora Nicaragua (UTC-6)** — coincide exactamente con el inicio del Turno Día. Baseline correcto, **no se modificó**.
- **Causa del fullSync sin login en `AUTH_MODE='legacy'` identificada y documentada** (`docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §23): `Sync.startAuto()` arranca incondicionalmente en el boot de `app.js` (antes de mirar si hay sesión PIN), y `fullSync()`/`pushAll()`/`pullAll()` solo activan el gate de Auth cuando `Auth.isSupabaseMode()` es `true`. En `'legacy'` ese gate ni se evalúa y las requests usan siempre `cfg.anonKey` contra la policy legacy permisiva — el login PIN nunca fue una frontera de red real. Es deuda temporal pre-cutover conocida, **no es un bug nuevo**.
- **Gate para `AUTH_MODE='supabase'` — ya estaba implementado correctamente** (de la sesión de `5f25806`/`96759ba`), verificado ahora con 4 tests nuevos (`tests/unit/sync-auth-gate.test.js`, bloque `N`: escenarios A/B/C/D del pedido) + los ya existentes (E/F/G ya cubiertos). **Cero requests de red en los 4 escenarios sin sesión válida** (fresh install, offline+snapshot vencido, logout, refresh fallido); pull/push normal con sesión+perfil válidos. **No se tocó `sync.js` ni `auth.js`** — la implementación ya era correcta, solo se agregó cobertura de test.
- **Gap real detectado (documentado, NO corregido hoy, fuera de alcance):** `pushAll()`/`pullAll()` siguen mandando `cfg.anonKey` como Bearer hacia `engrase_sync`, nunca el `accessToken` real de la sesión — inofensivo mientras la policy legacy siga abierta, pero **bloqueante para el cutover** (las RLS nuevas exigen JWT real). Agregado como ítem nuevo al checklist de cutover (§15 del plan, ahora 15 ítems).
- **403 con usuario autenticado no-administrador sigue sin probarse en real** — sin cambios respecto a la sesión anterior, sigue requiriendo `CREATE_USER` con autorización aparte.
- **Sin cambios en `sync.js`/`auth.js`/`app.js`** — solo `tests/unit/sync-auth-gate.test.js` (+4 tests) y `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` (+§23, +1 ítem en §15) quedaron modificados, **sin commitear** (la implementación ya era correcta, no correspondía el commit `fix:` — ver §23 del plan).
- Validación: `vitest run` completo 34 archivos / **581/581 verdes** (577 previos + 4 nuevos), `typecheck` limpio. No se corrió Playwright/lint:css/build:web porque no cambió ningún archivo de runtime (solo tests + docs) — no aplica bump de SW.
- **Nada tocó producción**: sin SQL, sin usuarios nuevos, sin cambios a la policy legacy, sin deploy nuevo, sin push.

## Sesión 2026-09-27 (parte 3) — fix: sync usa el JWT real del usuario (commit local, NO push)

- **Gap de §23 corregido:** `sync.js` gana `syncAuthHeaders(cfg)` — única fuente del header `Authorization` para toda request a `engrase_sync`. En `AUTH_MODE='supabase'` con sesión válida usa `Auth.getSession().accessToken` (el JWT real de la persona); en `'legacy'` (default, activo hoy) sigue usando `cfg.anonKey`, **sin ningún cambio de comportamiento visible**. `apikey` sigue siendo siempre `cfg.anonKey`.
- Aplicado en las 4 requests reales a `engrase_sync`: `pullAll()`, `pushAll()` POST create, `pushAll()` PATCH CAS, `fetchRemoteUpdatedAt()`. **Fuera de alcance a propósito** (documentado, no tocado): `testConnection()` y las subidas a Storage (fotos/firma) — no son `engrase_sync`.
- Sin lógica de refresh duplicada: `syncAuthHeaders()` solo lee `Auth.getSession()`; el refresh sigue viviendo únicamente en `Auth.restoreSession()` (llamado por `fullSync()` antes de tocar la red).
- 7 tests nuevos (`tests/unit/sync-auth-gate.test.js`, bloque `P`) confirmando: legacy sin cambios, supabase+autenticado usa el JWT (nunca el anon key) en pull/POST/PATCH, y que tras un refresh a mitad de `fullSync()` la siguiente request usa el JWT **nuevo**, nunca el expirado.
- Validación completa: unit **587/587** (34 archivos), Playwright **1393/1393**, `typecheck` limpio, `lint:css` limpio (0 errores, mismo baseline de warnings), `build:web`+`verify:dist` OK. SW `v41` → **`v42`** (runtime cambiado: `sync.js`).
- `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md` §15 (ítem de cutover) marcado `[x]` resuelto; §24 documenta el fix completo.
- **Commit creado localmente** (`fix: authenticate sync requests with user jwt`) incluyendo `sync.js`, `sw.js`, `tests/helpers/loadLubricationLogic.js`, `tests/unit/sync-auth-gate.test.js`, `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md`. `docs/SESSION_HANDOFF.md` excluido del commit como siempre. **NO se hizo push.**
- `AUTH_MODE` sigue en `'legacy'` — este fix es inerte hasta que se active `'supabase'`, pero es un prerrequisito real para poder cerrar la policy legacy en el CUTOVER sin romper el sync.
- Nada tocó producción: sin SQL, sin usuarios nuevos, sin cambios a RLS, sin cerrar la policy legacy, sin deploy nuevo.

## Sesión 2026-09-27 (parte 4) — feat: PIN rápido offline (commit local, NO push)

- **Nuevo:** `src/core/quick-unlock.js` — PIN local (4-6 dígitos, PBKDF2-SHA256 100k iteraciones, salt aleatorio, lockout de 5 intentos/5min persistido en DB) para volver a entrar sin Internet, **solo en `AUTH_MODE='supabase'`** (sigue en `'legacy'` — inerte hoy). Nunca autentica contra Supabase, nunca define rol, nunca sustituye a Auth — ver §25 de `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md`.
- `db.js` gana `DB.getQuickUnlock()`/`setQuickUnlock()` (mismo patrón que `auth_tokens`/`auth_profile_snapshot`, `app_config`/`LOCAL_STORES`, sin subir `DB_VERSION`).
- `app.js`: `renderAuthGateSupabase()` (punto de entrada único al arrancar y al "Bloquear"), `renderSupabaseLoginForm()`, `renderQuickUnlockScreen()`, `offerQuickUnlockSetup()`, `lockApp()` (nuevo botón "Bloquear", junto a "Cerrar sesión" en sidebar y en el shell del Lubricador, solo visible en modo supabase), `logout()` ahora borra también el PIN en modo supabase, y una sección nueva en Configuración para Configurar/Cambiar/Desactivar PIN. **Login PIN legacy sin ningún cambio.**
- 18 tests nuevos (`tests/unit/quick-unlock.test.js`) + extractor actualizado.
- Validación: unit **605/605** (35 archivos), Playwright relevante (login-responsive + dashboard-operativo + lubricador-mi-turno, **287/287** — no se corrió el suite completo porque el cambio está detrás del flag `AUTH_MODE='supabase'`), `typecheck` limpio, `lint:css` limpio (mismo baseline), `build:web`+`verify:dist` OK. SW `v42` → **`v43`**.
- **Commit creado localmente** (`feat: add secure offline quick unlock`) incluyendo `src/core/quick-unlock.js`, `db.js`, `app.js`, `index.html`, `sw.js`, `tests/helpers/loadLubricationLogic.js`, `tests/unit/quick-unlock.test.js`, `docs/AUTH_RLS_IMPLEMENTATION_PLAN.md`. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.**
- `AUTH_MODE` sigue en `'legacy'` — nada de esto se activó ni se activará sin instrucción explícita.
- Nada tocó producción: sin SQL, sin usuarios nuevos, sin cambios a RLS, sin cerrar la policy legacy, sin deploy nuevo.

## Sesión 2026-09-27 (parte 5) — instalación Android + feat: intervalo de auto-sync configurable (commit local, NO push)

- **Instalación Android real:** compilado e instalado `app-debug.apk` sobre `HEAD=22864de` en el Samsung S938B (serial real `R5CY93LMDLP`, distinto al anotado antes — confirmado por el usuario que es el mismo teléfono). `adb install -r` preservando datos (equipment=11, lubrication_records=78, users=7, DB_VERSION=6, verificado vía CDP solo lectura). Usuario hizo la prueba manual de Registrar Engrase — pasó.
- **Nuevo:** intervalo de auto-sync configurable por el Administrador desde Configuración → "Sincronización con base de datos remota" (30s/1/2/5/10 min, select fijo, sin texto libre, default **2 minutos** — antes era un fijo de 20s). Vive en `settings/general` (`syncIntervalSeconds`), el mismo documento sincronizado entre TODOS los dispositivos que ya usaban `shiftDayStart` etc. — nunca solo local, sin subir `DB_VERSION`.
- `sync.js`: `Sync.startAuto(intervalSeconds)` ahora parametrizado; nuevo `Sync.setAutoInterval()`/`_restartAutoTimer()` — cambia el timer EN CALIENTE, siempre apaga el anterior primero, nunca más de 1 timer activo, sin reiniciar la app.
- **Bug real evitado antes de commitear:** el handler existente de "Turnos y umbrales" (`#general-form`) reconstruía el documento `settings/general` desde cero — de haber quedado así, guardar turnos habría borrado en silencio el intervalo de sync guardado por el otro formulario. Corregido para que ambos formularios hagan merge sobre el documento actual.
- Agregado `Sync.fullSync()` inmediato (antes solo dependía del timer) tras: guardar un engrase, actualizar un horómetro individual, e importar horómetros por Excel. Guard de `onSyncStateChange()`/`App.lubricadorGreaseFlowActive` (protección de Registrar Engrase) **sin ningún cambio** — verificado con Playwright completo.
- Solo ADMINISTRADOR puede editar (route ya lo exige; además el `<select>` queda `disabled` para otros roles y el submit handler re-valida el rol como defensa adicional).
- 12 tests nuevos (`tests/unit/sync-auto-interval.test.js`) + extractor actualizado. **Regresión real detectada y corregida en el camino:** un comentario nuevo mencionaba literalmente `lubricadorGreaseFlowActive` dentro de `startGreaseFlow()`, rompiendo un test existente (`grease-finalize-validate-flow.test.js`) que garantiza que esa función nunca referencia el flag por nombre — reescrito el comentario, sin tocar el código real.
- Validación completa: unit **617/617** (36 archivos), **Playwright completo 1393/1393** (corrido completo por tocar infraestructura común del timer de sync), `typecheck` limpio, `lint:css` limpio (mismo baseline), `build:web`+`verify:dist` OK. SW `v43` → **`v44`**.
- **Commit creado localmente** (`feat: add configurable sync interval`) incluyendo `app.js`, `sync.js`, `sw.js`, `tests/helpers/loadLubricationLogic.js`, `tests/unit/sync-auto-interval.test.js`. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.**
- Nada tocó producción/Supabase: sin SQL, sin RLS, sin usuarios nuevos. El cambio de default (20s→120s) es de comportamiento LEGACY real (no detrás de ningún flag) — intencional, pedido explícitamente por el usuario.

## Sesión 2026-09-27 (parte 6) — piloto Android real en AUTH_MODE=supabase (solo verificación, sin commits)

- **No existe mecanismo `VITE_AUTH_MODE`** — `vite.config.js` copia `auth.js`/`sync.js`/`app.js` byte a byte, nunca procesa `import.meta.env` en esos archivos. Se usó el único método real: editar `AUTH_MODE='supabase'` TEMPORALMENTE en el archivo fuente (autorizado explícitamente), compilar+instalar+probar, y **revertir a `'legacy'` antes de terminar** — `git status`/`git diff` confirmados limpios al final, `dist/` reconstruido en modo legacy.
- Teléfono: `99FQVGVWRW795LW4` (modelo `25078RA3EL`, tercer dispositivo distinto usado en este proyecto). Precheck IndexedDB: **0 filas dirty en las 15 stores** antes de tocar nada.
- **Login real de Junior Valles verificado end-to-end**: `u_jvalles`/ADMINISTRADOR/`active:true`, identidad 100% desde `app_profiles` (`legacyUserRowExists: false`), sync usa el **JWT real** (804 caracteres, `apikey` sigue siendo el anonKey de 208) — nunca fallback anon. Confirmado por CDP (`adb forward` al socket `webview_devtools_remote_<pid>` + Playwright `connectOverCDP`), sin imprimir tokens.
- **Quick Unlock verificado**: PIN configurado (salt 16 bytes/hash SHA-256/100k iteraciones, sin campo `pin`), Bloquear→reabrir→PIN funcionó, rol siguió viniendo del perfil ya validado, sin pedir contraseña.
- **Offline verificado con salvedad real (documentada, NO corregida — "no modificar código durante la prueba")**: `navigator.onLine` del WebView de este teléfono queda en `true` incluso sin conexión real (confirmado con un `fetch` que falló en 38ms) — el timer de auto-sync intenta la request igual y falla limpio (sin corromper nada), en vez de cortar antes por el chequeo de `offline`. Vale la pena revisar en una sesión futura (quizás complementar `navigator.onLine` con un ping real). Con la app realmente sin red, Registrar Engrase se mantuvo estable con los campos llenos por 2+ minutos, sin guardar nada de prueba.
- **Reconexión verificada**: tras confirmar conectividad real (la app en segundo plano también perdía red — otro hallazgo de plataforma, no de código), `fullSync()` completó `status:'ok'`, `pushed:0`/`pulled:0`/`conflicts:0`, JWT real, sin cambio de pantalla inesperado.
- **Intervalo configurable verificado en vivo** (autorizado explícitamente por afectar todos los dispositivos): cambiado a 5 min, confirmado timer único (`Sync._autoIntervalSeconds`/`_autoTimerId`) sin clobber de `shiftDayStart` etc., devuelto a 2 min. **Nota operativa real**: el primer intento de "volver a 2 min" no aplicó porque se cambió el `<select>` sin tocar "Guardar intervalo" — quedó claro al usuario y se corrigió.
- **Logout real verificado**: `auth_tokens`/`auth_profile_snapshot`/`auth_quick_unlock` los 3 en null, `isAuthenticated:false`, pantalla de Usuario/Contraseña de vuelta, datos operativos intactos (equipment=11, lubrication_records=79).
- **Incidente menor durante la prueba**: un logout accidental (usuario tocó "Cerrar sesión" en vez de "Bloquear" — botones adyacentes) obligó a repetir login+configuración de PIN una vez. **Observación de UX anotada** (no corregida, fuera de alcance de "no modificar código durante la prueba"): considerar separar/diferenciar más esos dos botones en una futura sesión.
- Nada tocó producción de forma no autorizada: sin SQL, sin RLS, sin usuarios nuevos, sin `adb uninstall`/`pm clear`, sin push. El único cambio de intervalo de sync (5→2 min) fue explícitamente autorizado por el usuario en el momento.

## Sesión 2026-09-27 (parte 7) — lote pre-cutover: pulido UX móvil + conectividad real (2 commits locales, NO push)

- **Bloque A (UX móvil, `fix: polish mobile responsive layout`, commit `fa00976`):** Cuadrillas/Ubicaciones/Categorías y Papelera ya no tapan nombres con los botones (apilado en móvil); títulos de Configuración más compactos; topbar móvil con más espacio real para el título (logo cede su lugar, badge más chico); Matriz Semanal se desliza sola a la columna HOY y ya no corta "NO REALIZADO"/"PENDIENTE HOY" (envuelve en 2 líneas en vez de forzar scroll ancho); Engrase del Turno más compacto en móvil; `alert()` técnico de OneSignal eliminado, reemplazado por "Notificaciones push no configuradas".
- **Bloque B (conectividad real, `fix: detect real backend connectivity`, commit `8b38039`):** `navigator.onLine` deja de ser la autoridad final. Nuevo `fetchWithTimeout()`/`isNetworkFailure()` en `db.js` (timeout 10s) aplicado a Auth/app_profiles/engrase_sync (NO a Storage ni a `manage-users` — ya desplegada, fuera de alcance explícito de este lote). **Bug real corregido:** una falla de RED (no un 401 real) durante `_refreshSession()`/`refreshProfile()` cerraba sesión y borraba el snapshot de perfil igual que un refresh token inválido — ahora se distinguen (`err.authRejected`) y una falla de red conserva tokens/sesión/PIN intactos. `sync.js` gana el status `'backend_unreachable'` (nunca se confunde con `'ok'`); `updateConnBadge()` ya no cae a "SINCRONIZADO" para estados no reconocidos.
- 10 tests nuevos (`tests/unit/backend-connectivity.test.js`). Validación completa: unit **627/627** (37 archivos), **Playwright completo 1393/1393**, `typecheck` limpio, `lint:css` limpio (0 errores). SW `v44` → **`v45`** (un solo bump para ambos bloques, como se pidió).
- **APK debug reconstruida e instalada** (`adb install -r`, preservando datos) en `99FQVGVWRW795LW4` — confirmado `AUTH_MODE='legacy'` en el build real, datos intactos (11 equipos, 79 registros).
- `docs/SESSION_HANDOFF.md` excluido de ambos commits, como siempre. **NO se hizo push.**
- Nada tocó producción/Supabase: sin SQL, sin RLS, sin usuarios, sin Storage, sin redeploy de `manage-users`. `AUTH_MODE` sigue en `'legacy'` en el código fuente committeado.

## Sesión 2026-09-27 (parte 8) — CUTOVER PREPARADO, NADA ejecutado (commit local, NO push)

- **⚠️ CAMBIO IMPORTANTE:** `AUTH_MODE` en `src/core/auth.js` pasa a `'supabase'` **como default DEFINITIVO del código** (ya no un flip temporal para pruebas). Esto está **committeado localmente**, pero **NO publicado, NO instalado en ningún dispositivo, NO en producción** — `git push` sigue sin hacerse, y nadie reconstruyó/republicó la Web ni la app Android con este código todavía.
- **Auditoría contra producción (solo lectura, `supabase db query --linked`):** confirmado exactamente lo documentado — policy legacy `"acceso interno con anon key"` sigue activa en `engrase_sync`, las 3 policies `authenticated` de 0002 ya existen (coexistiendo), `app_profiles` tiene **exactamente 1 fila** (Junior Valles, ADMINISTRADOR, activo), `app_store_permissions` tiene 75 filas correctas, `manage-users` sigue `ACTIVE`.
- **⚠️ ADVERTENCIA OPERATIVA REAL (no resuelta, documentada en §27):** con una sola cuenta Auth real, publicar este código tal cual dejaría a TODO el personal de campo (Lubricadores, Supervisores, etc.) sin poder entrar — el login PIN legacy queda inaccesible por diseño en `AUTH_MODE='supabase'`. **Antes de publicar/desplegar de verdad, hay que crear cuentas Auth reales para los roles que operan la app a diario.**
- **Auditoría de código confirmó que NO hacía falta ningún otro cambio**: bootstrap legacy ya deshabilitado, comparación PIN ya inalcanzable, `users.role` ya sin efecto en permisos — todo esto ya estaba resuelto en sesiones previas (quick unlock, sync JWT). El "cutover de código" fue, literalmente, un cambio de una constante.
- **SQL preparado, NO ejecutado:** `supabase/migrations/0003_auth_rls_CUTOVER_PREPARED.sql` (una sola sentencia: `DROP POLICY` de la legacy) + `0003_..._ROLLBACK.sql` (la restaura). Ninguno de los dos se corrió contra producción.
- **Orden de despliegue documentado** (§27 del plan) en 10 pasos (A-J), cada uno con su propio rollback — ninguno ejecutado en esta sesión.
- 6 tests nuevos (`tests/unit/cutover-security.test.js`: login legacy inalcanzable por estructura del código, `users.role` sin efecto en permisos) + `auth.test.js` bloque M actualizado al nuevo default real.
- Validación completa: unit **633/633** (38 archivos), **Playwright completo 1393/1393** (sin cambios — los specs no dependen del flujo real de boot/login, inyectan estado directamente), `typecheck` limpio, `lint:css` limpio. SW `v45` → **`v46`**.
- **NO se instaló ni publicó nada** (a propósito, por instrucción explícita) — `dist/` se reconstruyó localmente para validar `build:web`/`verify:dist`, pero no se tocó ningún dispositivo ni hosting.
- `docs/SESSION_HANDOFF.md` excluido del commit, como siempre. **NO se hizo push.**

## Sesión 2026-09-28 — LOTE OPERATIVO GLOBAL: dispositivos + cuadrillas + ubicaciones + asignación de engrases (2 commits locales, NO push)

Ver `docs/OPERATIONAL_SCOPE.md` para el diseño completo. Resumen:

- **Nuevo módulo puro `src/core/operational-scope.js`**: autoridad central para
  resolver qué equipos ve/ejecuta un Lubricador según el DISPOSITIVO (no el
  usuario) → CUADRILLA → UBICACIÓN, identidad de ocurrencia estable
  (`computeOccurrenceKey`, nunca `equipo+cuadrilla` permanente), y el motor de
  asignación manual (crear/reasignar/cancelar/completar). 29 tests de dominio
  (`tests/unit/operational-scope.test.js`).
- **`cuadrillas` ampliado** con `locationId`/`isDefault` (opcionales, sin
  migración de datos) — máximo una cuadrilla default por ubicación.
- **Store nuevo sincronizado `lubrication_assignments`** — `DB_VERSION` 6→7
  (no destructivo). RLS preparada (NO aplicada):
  `supabase/migrations/0004_lubrication_assignments_rls_PREPARED.sql`.
- **Infraestructura reutilizada, no creada de cero**: `getDeviceAssignment()`/
  `saveDeviceAssignment()` ya existían en `app.js` (guardadas en `push_tokens`,
  pensadas para push) pero nunca se usaban para scope operativo — ahora sí.
- **UI conectada** (alcance explícito, ver "fuera de alcance" en
  `docs/OPERATIONAL_SCOPE.md`): Mi Turno, Plan de Engrase ("Asignar a
  cuadrilla"), ficha de equipo ("Asignar a cuadrilla" + "Mover ubicación"),
  Registrar Engrase (completa la asignación al guardar), QR (bloquea fuera de
  scope), Configuración (panel dedicado de Cuadrillas + panel nuevo
  "Dispositivo operativo", con gating por rol).
- **Deliberadamente NO tocado en este lote** (transparencia): Dashboard,
  Matriz Semanal (badge de asignación), `renderTurno` de escritorio, Reportes,
  Historial, notificaciones push/OS reales para eventos de asignación (solo
  hay badge in-app persistente en Mi Turno mientras la asignación siga
  `PENDING`), snapshot completo de contexto operativo en `lubrication_records`.
- Validación completa: unit **662/662** (39 archivos, incluye 1 test viejo
  corregido — asumía `DB_VERSION === 6` a secas, ahora acepta `>=6`),
  `typecheck` limpio, `lint:css` 0 errores (mismo baseline de warnings),
  `build:web`+`verify:dist` OK. SW `v46` → **`v47`**.
- **APK debug NO reconstruida en este lote** (decisión explícita por alcance/
  tiempo — no había ningún cambio que requiriera probarse en un dispositivo
  real para completar este lote; queda pendiente si se quiere probar Mi Turno
  con un dispositivo asignado a una cuadrilla real).
- 2 commits locales: `012ca89` (`feat: add device and crew operational
  scope`) y `44a312b` (`feat: propagate operational assignments across app
  UI`). `eec02fa` (cutover Auth) **no se tocó/amendeó**. `docs/SESSION_HANDOFF.md`
  excluido como siempre. **NO se hizo push.**
- Nada tocó producción/Supabase: sin SQL aplicado, sin RLS activada, sin
  usuarios reales creados, sin Storage, sin Edge Functions, sin deploy.

## Sesión 2026-09-28 (parte 2) — cierre de 3 gaps del lote operativo (1 commit local, NO push)

Ver "Cierre del lote — 3 gaps resueltos" en `docs/OPERATIONAL_SCOPE.md` para el detalle completo. Resumen:
- Snapshot histórico en `lubrication_records` (nuevos registros), con fallback legado explícito y columna "Ubicación" en Historial.
- Ciclo completo de notificaciones de assignments (PENDING/COMPLETED/CANCELLED/REASSIGNED) vía `LocalNotifications`, sin OneSignal, reutilizando `classifyEquipmentWork()`.
- Aislamiento de device assignment verificado con 8 tests reales; reinstalación documentada sin sobreprometer (`adb install -r` preserva, `uninstall`/`pm clear` no, sin recuperación).
- Validación completa: unit 676/676, Playwright 1393/1393, typecheck limpio, lint:css 0 errores, build:web+verify:dist OK. SW v47→v48.
- Commit local `0780517` (`fix: complete operational assignment lifecycle`), sobre `44a312b`/`012ca89`. `docs/SESSION_HANDOFF.md` excluido. **NO se hizo push.**
- Nada tocó producción/Supabase.

## Sesión 2026-09-28 (parte 3) — engrase fuera de plan (1 commit local, NO push)

Ver "Engrase fuera de plan (lote 2026-09-28c)" en `docs/OPERATIONAL_SCOPE.md`. Resumen:
- Tercer tipo de ejecución `OUT_OF_PLAN` (junto a `PLANNED`/`ASSIGNED`) para PM/correctivo/oportunidad/otro, con detección de trabajo existente antes de abrir el flujo (nunca duplica), motivo+completitud calculada desde el checklist, satisfacción de ocurrencias futuras sin ambigüedad (plan día/turno) o avance normal del ciclo (plan por horas) — plan maestro nunca se toca.
- Botón "+ Fuera de plan" en Mi Turno junto a "Escanear QR", **sin pestaña nueva** en la barra inferior. Mismo flujo desde QR y ficha de equipo (jefaturas).
- Matriz Semanal: nuevo estado `hecho_adelantado`. Historial: columna "Tipo". Reportes: filtro "Ubicación" corregido para usar el snapshot histórico del registro, no la ubicación actual del equipo.
- Bug pre-existente encontrado y documentado (NO corregido, fuera de alcance): `showEquipmentQrInfo()` pasaba `App.route` (string) como `target` de `startGreaseFlow()`, que espera un elemento DOM o `undefined` — el formulario nunca aparecía para jefaturas desde ese botón específico. Ver detalle en `docs/OPERATIONAL_SCOPE.md`.
- Validación completa: unit 696/696, Playwright 1393/1393, typecheck limpio, lint:css 0 errores, build:web+verify:dist OK. SW v48→v49.
- Commit local `1bcf79f` (`feat: support out-of-plan grease execution`), sobre `0780517`. `docs/SESSION_HANDOFF.md` excluido. **NO se hizo push.**
- Nada tocó producción/Supabase.

## Sesión 2026-09-28 (parte 4) — fix: botón QR "Registrar engrase ahora" para jefaturas (1 commit local, NO push)

- **Bug corregido** (documentado sin arreglar en la parte 3): `showEquipmentQrInfo()` llamaba `startGreaseFlow(equipment.id, App.route)` para ADMIN/PLANIFICADOR/SUPERVISOR — `App.route` es un string (`'equipos'`), y `startGreaseFlow()` solo sabe escribir en un elemento DOM real o, sin `target`, navegar a Registrar Engrase. Una asignación de propiedad sobre un string primitivo no lanza error, simplemente no hace nada — el formulario nunca aparecía para jefaturas desde ese botón. Fix de una línea: ya no se pasa `App.route`, cae al fallback de navegar.
- **Test nuevo** `tests/ui/qr-grease-register-management.spec.js` (13 tests × 7 viewports = 91), cubre: regresión de código fuente (nunca más `App.route` como target), el fix en sí (jefaturas A/B/C), y de paso el scope operativo completo del botón del QR para Lubricador (D-I: ASSIGNED > PLANNED > OUT_OF_PLAN, bloqueo fuera de cuadrilla/ubicación, cero doble registro) — nada de esto tenía cobertura Playwright real todavía.
- **Bug de test real encontrado y corregido en el camino** (no en código de producción): el `bootPage()` original usaba `page.setContent()` a secas, dejando la página en `about:blank` (origen opaco) — `localStorage` ahí lanza `SecurityError` en Chromium, así que el mock de `deviceCrewId` (que depende de `getDeviceId()`/`localStorage`) era inerte en silencio. Primer intento de fix (`page.goto('/')` antes de `setContent()`) rompió TODO (86/91 tests) porque esa URL sirve la app REAL (`index.html` con `<script src="app.js">` de verdad) — cargaba dos copias de las mismas funciones/`const` top-level, colisión de nombres. Fix final: `page.route('**/*', ...)` bloqueando toda request y sirviendo un HTML vacío para el documento — da un origen real (`http://localhost:4173`) sin que la app real llegue a ejecutarse nunca.
- SW `v49` → **`v50`** (runtime cambiado: `app.js`).
- Validación completa: unit **696/696** (40 archivos), **Playwright completo 1484/1484** (1393 previos + 91 nuevos), `typecheck` limpio, `lint:css` 0 errores (65 warnings, mismo baseline), `build:web`+`verify:dist` OK.
- **Commit creado localmente** (`e2b1dd0` — `fix: pass real DOM target to startGreaseFlow from QR button`) incluyendo `app.js`, `sw.js`, `tests/ui/qr-grease-register-management.spec.js`. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.**
- Nada tocó producción/Supabase.

## Sesión 2026-09-28 (parte 5) — P0-3: preparación de Storage privado/autenticado (1 commit local, NO push)

Ver `docs/STORAGE_PRIVACY_DESIGN.md` para el diseño completo. Resumen:

- **Bucket `engrase-photos` SIGUE público en producción** — nada de este lote cambia comportamiento visible hoy. Objetivo: dejar código + migration + tests listos para cuando se autorice el cutover de Storage (después del cutover de Auth/RLS).
- **`sync.js`**: `resolvePhotoStoragePath()` extrae el storage path desde la URL pública que TODO registro (viejo y nuevo) ya guarda — **no se cambió el formato de escritura** (decisión explícita: cambiarlo hoy habría roto en silencio los renderers que no se tocaron en este lote, ver limitación abajo). `Sync.getSignedPhotoUrl()` genera un signed URL temporal a partir de ese path, con el mismo gate de sesión que `pushAll()`/`pullAll()` (cero requests sin sesión válida en modo supabase, nunca fallback anon). Las subidas de fotos/firma ahora usan `syncAuthHeaders()` (JWT real en modo supabase) en vez de la anon key fija.
- **`app.js`**: `resolveEvidenceSrc()` — base64 local se muestra directo (sin red); cualquier otra cosa pide un signed URL, con fallback al valor original si falla. Conectado en: firma de validación (`openValidationDetailModal`/`openValidationConflictModal` — la firma es contenido sensible) y galería de Reportes (`pintarTanda()`, resuelto por tanda de 24, se mantiene el lazy-loading).
- **Limitación conocida, documentada a propósito (NO corregida)**: miniaturas de puntos de checklist (`lubrication_plans`) y diagramas de ayuda de familia de equipo (`settings.help_content`) usan el MISMO mecanismo genérico de subida pero siguen mostrando la URL cruda directo — funciona mientras el bucket siga público; necesitará el mismo `resolveEvidenceSrc()` antes de que Storage se vuelva privado de verdad.
- **Migration preparada, NO ejecutada**: `supabase/migrations/0005_storage_privacy_PREPARED.sql` (+ `_ROLLBACK.sql`) — bucket a privado, policies públicas/anon-key reemplazadas por una sola autenticada (`current_app_active()`), **sin granularidad por rol/store a propósito** (reusar `app_store_permissions` tal cual habría bloqueado "Ayuda y soporte" para roles no-admin, que sí la ven hoy — documentado en el diseño).
- Tests nuevos: `tests/unit/storage-privacy.test.js` (18) + `tests/ui/storage-privacy-evidence.spec.js` (49) + `grease-validation.spec.js`/`mis-engrases-flow.spec.js` actualizados (nueva dependencia `resolveEvidenceSrc`, sin regresiones).
- Validación completa: unit **714/714** (41 archivos), Playwright **1533/1533** (1484 previos + 49 nuevos), `typecheck` limpio, `lint:css` 0 errores (mismo baseline de warnings), `build:web`+`verify:dist` OK. SW `v50` → **`v51`**.
- Commit local `a4ba3e9` (`feat: prepare private authenticated storage`). `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.**
- Nada tocó producción/Supabase: sin SQL ejecutado, sin bucket modificado, sin objetos borrados/movidos, sin deploy.

## Sesión 2026-09-28 (parte 6) — lote pre-cutover PIN+sync+storage (3 commits locales, NO push)

Precheck: HEAD confirmado en `a4ba3e9`, working tree limpio (solo este archivo), `AUTH_MODE='supabase'`, `DB_VERSION=7` — sin trabajo previo dirty que integrar.

**Auditoría primero, sin tocar nada** — encontró que la mayor parte del Bloque A ("PIN persistente") y todo el Bloque B ("quitar pantalla de Descargar Datos") YA estaban correctamente implementados de sesiones anteriores:
- `renderAuthGateSupabase()` ya muestra PIN directo si hay sesión+PIN válidos, nunca vuelve a pedir usuario/contraseña.
- `restoreSession()` ya distingue network failure (nunca logout) de rechazo real (`invalid_grant`/perfil inactivo → sí logout).
- `lockApp()` ya no toca Auth/tokens/PIN. PIN ya está tageado por `appUserId+device`.
- **No existe ni existió** ninguna pantalla manual de "Descargar datos" — `boot()` ya llamaba `Sync.fullSync()` de forma incondicional y silenciosa, con badge SINCRONIZANDO/SINCRONIZADO/SIN CONEXIÓN ya funcionando.

**Bloque A — gaps reales cerrados:** `confirmLogout()` (modal propio, ya no `logout()` directo al primer click) + `confirmChangeUser()` (nueva acción, misma operación de fondo que logout — arquitectura de una sola sesión Auth activa, sin almacén de múltiples refresh_tokens). Commit `888a545`.

**Bloque B — full refresh 07:00/19:00 + catch-up:** `dueFullRefreshWindows()`/`Sync.runFullRefreshIfDue()` (re-pull completo forzado, reusa el merge CAS de `pullAll()` sin duplicarlo) + `Sync.runAutoCycle()` (wrapper para boot/timer/reconnect/foreground). `docs/BACKGROUND_SYNC_DESIGN.md` documenta por qué NO se implementó background nativo Android (cero infraestructura WorkManager/JobScheduler existente; reescribir pull/push/CAS en Kotlin duplicaría el motor de sync, prohibido explícitamente). Commit `eae4af5`.

**⚠️ Regresión real encontrada y corregida en el camino:** la primera versión metía el chequeo de ventana DENTRO de `fullSync()` — como usa la hora real del sistema, CUALQUIER test que llamara `fullSync()` sin mockear el reloj (decenas de archivos existentes) podía disparar un pull/push extra no determinístico apenas la hora real cruzara 07:00/19:00, lo que de hecho pasó (~19:2x reales) y tumbó 92-133 tests de Playwright/unit de forma intermitente. Corregido separando `runAutoCycle()` de `fullSync()` — `fullSync()` queda 100% determinístico para los ~30 archivos `sync-*.test.js` existentes, solo `runAutoCycle()` (llamado desde boot/timer/reconnect, nunca desde un test directamente) toca el reloj real.

**Bloque C — cierre del gap de Storage privado** (documentado como pendiente en `a4ba3e9`): `pointRow()` (checklist), `familyCardHTML()` (diagramas de ayuda), `photoThumbsHTML()`/`resolvePhotoThumbSrcs()` (Historial/Anomalías) ahora resuelven signed URLs igual que firma/Reportes. Cache en memoria de signed URLs (`Sync._signedUrlCache`) + reintento único + placeholder (`wireEvidenceImgFallbackOnce()`) para cualquier `<img>` de evidencia que falle. Limitación conocida sin cerrar: editor de familias (`openFamilyEditForm()`, solo Admin). Commit `8065dd4`.

**3 specs de Playwright existentes rotas encontradas y arregladas en el camino** (extraían funciones reales de app.js que ganaron nuevas dependencias sin actualizar la lista de extracción): `grease-validation.spec.js`, `mis-engrases-flow.spec.js`, `historial-eq-search-flow.spec.js`.

**Validación final** (repetida dos veces por la regresión de reloj — la primera corrida completa de Playwright con el bug activo dio 133 fallos; tras el fix, 1574+92 en la corrida de verificación intermedia, y **1666/1666 en la corrida final, dos veces seguidas**): unit **736/736** (43 archivos), Playwright **1666/1666**, `typecheck` limpio, `lint:css` 0 errores (65 warnings, mismo baseline), `build:web`+`verify:dist` OK. SW `v51` → **`v52`** (un solo bump para todo el lote).

**Memoria del sistema:** el harness mató un intento de correr el Playwright completo por memoria crítica del sistema (no un fallo de los tests) — se resolvió corriendo primero un subconjunto dirigido (Auth/Storage/sesión, 455 tests) más typecheck/lint/build por separado, y el full run se reintentó una sola vez cuando hubo memoria disponible, exitosamente.

Commits: `eae4af5` (Bloque B) → `888a545` (Bloque A) → `8065dd4` (Bloque C), todos sobre `a4ba3e9`. `docs/SESSION_HANDOFF.md` excluido como siempre. **NO se hizo push.**

Nada tocó producción/Supabase: sin SQL ejecutado, sin bucket modificado, sin usuarios reales, sin deploy.

## Estado de producción (verificado)

- `AUTH_MODE` sigue en `'legacy'` en el código.
- Policy legacy de `engrase_sync`/`app_profiles` sigue activa (coexistiendo con las nuevas RLS, sin cierre).
- **`manage-users` Edge Function: DESPLEGADA y ACTIVE en producción** (ver arriba) — LIST_USERS verificado real; CREATE_USER/UPDATE_ROLE/SET_ACTIVE/RESET_PASSWORD aún sin probar en real.
- `engrase_sync`: 1662 filas en la última verificación conocida (no se volvió a contar en esta sesión).
- Junior Valles: única cuenta Auth real + `app_profile` ADMINISTRADOR existente en producción.
- No se ejecutó SQL nuevo, no se tocó Storage, no se creó ningún usuario adicional.

## Pendientes conocidos (no tocar/no inventar) — heredados de sesiones anteriores

- **DATA-PENDING-A02** sigue pendiente (`docs/BUG_REGISTER.md`), sin causa de código encontrada.
- **3 objetos antiguos en Storage** (`grease_validations/val_muhdkb6rjddpz0.png`, `val_muhgk01vn6vyqb.png`, `val_muhuby6figwda0.png`) sin registro correspondiente en `grease_validations` actuales — pendientes de auditar origen; NO borrar sin confirmar que son huérfanos reales.
- **CORRECCIÓN 2026-09-27: `GREASE_VALIDATION_ENABLED_FROM` NO está en `null`** — esta línea del handoff estaba desactualizada. El valor real en código (`src/core/grease-validation.js`, commit `963295b`, ya en `HEAD`) es `'2026-09-27T12:00:00.000Z'` — la validación de engrase pasa a ser exigible HOY a partir de esa hora UTC. Verificar con el usuario si esto sigue siendo la fecha deseada.
- **stash@{0}** — "UI iteración 2/3 Registrar Engrase (pendiente aprobación visual)" — NO tocar hasta que el usuario lo pida explícitamente.

## SIGUIENTE PASO (al reabrir esta sesión)

1. ~~Revisar preflight de `manage-users`~~ — **HECHO** (2026-09-27).
2. ~~Desplegar la Edge Function `manage-users`~~ — **HECHO** (2026-09-27, autorizado explícitamente), `ACTIVE` en producción.
3. ~~Probar `LIST_USERS` con Junior Valles autenticada~~ — **HECHO** (2026-09-27, ver arriba). ~~Confirmar 401 anónimo~~ — **HECHO**.
4. **Pendiente:** confirmar 403 con un usuario autenticado NO-administrador — requiere que exista un segundo usuario real, no se puede probar todavía.
5. Probar creación controlada de un segundo usuario real (`CREATE_USER`), **solo con autorización explícita** en el momento, nunca por iniciativa propia — permitiría además cerrar el punto 4.
6. Mantener `AUTH_MODE='legacy'` hasta nueva instrucción — no activar `'supabase'` en código committeado.
7. **NO cerrar todavía** la policy legacy de RLS (`using(true)/with check(true)`) — sigue siendo la red de seguridad mientras el nuevo modelo no esté 100% probado en producción.
8. **NO hacer push** de ningún commit (`588f076` en adelante) hasta autorización explícita separada.
9. Si se repite una prueba con navegador real conectado a producción: recordar que `fullSync()` periódico puede disparar escritura a `engrase_sync` **sin que el login lo pida** — mantener el bloqueo de `page.route()` activo (ver sesión 2026-09-27 arriba), no asumir que solo el click de login es riesgo.

## Mantener siempre

- `stash@{0}` intacto — NO tocar.
- NO `git reset`/`clean`/`stash pop`.
- NO `git push` sin autorización explícita y específica de ese momento.
- NO desplegar Edge Functions ni ejecutar SQL contra producción sin autorización explícita y específica de ese momento.
- `docs/SESSION_HANDOFF.md` se mantiene siempre **sin trackear** (fuera de `git add`/commits).
# HISTORICAL / DEPRECATED — handoff acumulativo, no runbook vigente.
# Conserva decisiones y hallazgos de sesiones anteriores; para instalación,
# Auth, Storage y despliegue consulte docs/DOCUMENTATION_STATUS.md.

