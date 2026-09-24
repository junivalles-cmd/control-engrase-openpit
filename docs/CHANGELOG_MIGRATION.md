# CHANGELOG DE LA MIGRACIÓN

## 2026-09-23 — FASE 0: baseline protegido con Git
- Se inicializó el repositorio Git en `CONTROL_ENGRASE` (raíz que contiene
  `CONTROL_ENGRASE_WEB` y `CONTROL_ENGRASE_APP_ANDROID`).
- Se creó `.gitignore` en la raíz (ver `docs/DECISIONS.md`).
- Commit baseline: `c6d6f786fe53e657dd76c6edfa32ba1df8d816cc` en `master`.
- Se creó la rama `migration-typescript` a partir del baseline.
- Se creó la carpeta `docs/` con `LINEA_BASE.md`, `MIGRATION_STATUS.md`,
  `BUG_REGISTER.md`, `TEST_MATRIX.md`, `DECISIONS.md` y este changelog.
- No se modificó, movió ni eliminó ningún archivo de código existente.

## 2026-09-23 — FASE 1: análisis de fuente única (solo documentación)
- Se comparó `CONTROL_ENGRASE_WEB` vs. `www` por hash SHA-256; código de
  negocio 100% idéntico, diferencias reales solo en `manifest.json` e íconos.
- Se documentó el flujo real de publicación (GitHub Pages manual, sin build)
  y de Capacitor (`www` → `cap sync` → `assets/public`).
- Se recomendó la Opción A (WEB como fuente canónica temporal) como paso
  ejecutable, con Vite/TypeScript como destino futuro documentado.
- Commits: `04d079f` (plan de unificación), más limpieza previa
  `e5af5ff` (archivo ajeno al proyecto).

## 2026-09-23 — FASE A2: script de sincronización (creado, solo dry-run)
- Se creó `tools/sync-web-to-android.mjs`: calcula el set runtime a
  sincronizar leyendo `index.html`/`manifest.json`/`sw.js` de la fuente,
  excluye documentación/SQL/backend, compara por hash SHA-256, nunca borra.
- Probado en dry-run contra el proyecto real (sin cambios) y con errores
  simulados en copias aisladas (ruta inexistente, manifest inválido).
- `--apply` NO se ejecutó en esta fase. Commit: `5d42f66`.

## 2026-09-23 — FASE A3: primera sincronización real WEB → www → Android
- Se ejecutó `node tools/sync-web-to-android.mjs --apply` por primera vez:
  10 archivos actualizados, 3 archivos nuevos copiados, 0 errores. Los
  sobrantes (`schema.sql`, `icon-180.png`) se dejaron intactos a propósito.
- Verificado con un dry-run posterior: 22/22 archivos runtime idénticos entre
  `CONTROL_ENGRASE_WEB` y `www` (0 ACTUALIZAR, 0 FALTAN).
- `manifest.json` de `www` quedó idéntico a la fuente: JSON válido,
  `background_color` corregido, los 10 íconos referenciados existen.
- La fuente `CONTROL_ENGRASE_WEB` no fue modificada (verificado con
  `git diff`) — el script solo escribe en el destino.
- Se ejecutó `npx cap sync android`: regeneró
  `android\app\src\main\assets\public` desde `www` sin tocar ningún archivo
  versionado de Android (confirmado con `git status`); verificado por hash
  que los archivos runtime en `assets/public` coinciden con `www`.
- Se compiló un APK de depuración (`./gradlew assembleDebug`) con éxito tras
  limpiar artefactos de build obsoletos (`./gradlew clean`) que causaban un
  `AccessDeniedException` de Windows en `build/intermediates` — no relacionado
  con el código sincronizado.
- No se probó en dispositivo/emulador real (ninguno conectado en este
  entorno): arranque, IndexedDB, cámara, QR, App Links, OneSignal y
  notificaciones locales quedan `NO PROBADO EN DISPOSITIVO`.
- No se pudo probar la web en un navegador real (extensión de automatización
  no instalada en esta sesión); se verificó en su lugar que todos los
  archivos runtime se sirven con HTTP 200 desde un servidor estático local y
  que `app.js`/`db.js`/`sync.js`/`sw.js` no tienen errores de sintaxis.
- `.nojekyll` y `.well-known/assetlinks.json` verificados intactos e
  idénticos entre fuente y destino, sin necesidad de corrección.

## 2026-09-23 — Validación manual en dispositivo real: ajustes de UI
Serie de correcciones iterativas de interfaz, cada una sincronizada a `www`,
recompilada e instalada en el Samsung SM-S938B real preservando datos
(`adb install -r`, `firstInstallTime` sin cambios en todas):

- `5751a21` `fix: prevent mobile search bar overlap` — `flex-wrap` en
  `.topbar-right` (bug `UI-ANDROID-001`).
- `1867ba5` `fix: collapse search bar into icon on narrow screens` — el
  buscador colapsa a solo ícono en móvil y oculta sus hermanos al expandirse
  (continuación de `UI-ANDROID-001`, a pedido del usuario).
- `86ff816` `fix: use consistent logout icon for lubricador role` — bug
  `UI-ANDROID-002`, ícono Unicode reemplazado por el sistema de íconos del
  proyecto.
- `21a0ed8` `fix: compact mobile topbar spacing` — bug `UI-ANDROID-003`,
  padding/gaps/fuente reducidos en el topbar móvil (~58-60px de alto),
  manteniendo los botones de ícono en el mínimo táctil de 44px.
- `c126f82` `refactor: move theme picker out of topbar into Config/Ayuda
  screens` — a pedido del usuario, se quitó el botón de tema (🎨) del
  topbar (tanto el principal como el de Lubricador). Ahora vive dentro de
  un panel "Apariencia": en **Configuración** para Administrador (única
  pantalla con esa ruta), y en **Ayuda** para el resto de los roles
  (Planificador, Supervisor, Lubricador, Visor). El botón de tema del login
  no se tocó.

`UI-ANDROID-001` validado visualmente por el usuario (PASS). `UI-ANDROID-002`
y `UI-ANDROID-003` corregidos en código, sincronizados e instalados, aún
pendientes de validación visual — ver `docs/BUG_REGISTER.md`.

## 2026-09-23 — Continuación de validación manual: UI-ANDROID-003 (PASS) y BUG-004
- `UI-ANDROID-003` (topbar de Administrador) **validado visualmente PASS**
  por el usuario en el Samsung SM-S938B real.
- `d6b3c34` `fix: show shift badge as icon only on mobile to keep topbar on
  one line` — el turno se reduce a ícono (☀/☾) en móvil.
- Durante la prueba manual ADM-01 (Dashboard), el usuario reportó que las
  tarjetas de "Mi Turno" del Lubricador no se veían como deberían. Se
  encontró `BUG-004`: `redibujarPantallaActual()` redibujaba las pantallas
  del Lubricador con las funciones de tabla de Administrador
  (`renderTurno`, `renderHistorial`) en vez de las tarjetas del Lubricador,
  cada vez que una sincronización en segundo plano traía datos nuevos.
  Corregido en `644700f` `fix: redraw lubricador screens with correct
  handlers after sync` — una línea, corrige el mapa de funciones. Este bug
  **no es exclusivo de Android**: vive en `app.js`, compartido con la
  versión WEB.

## 2026-09-23 — Pruebas automatizadas de lógica (Vitest)
- Se creó `package.json`/`vitest.config.js` en la raíz del repositorio
  (devDependency únicamente — no afecta la web ni el build de Android) y
  `tests/` con 8 archivos, 77 pruebas, todas PASS.
- Las pruebas extraen y ejecutan las funciones **reales** de `app.js`/`db.js`
  (turnos, estado de engrase, matriz semanal, criticidad de anomalías,
  validación de horómetro, borrado lógico, reglas de sincronización,
  `esc()`) directamente desde el código fuente — `app.js`, `db.js` y
  `sync.js` no fueron modificados.
- Se descubrió y registró `ENGRASE-001` (P2): un horómetro con valor no
  numérico no dispara "DATOS INCONSISTENTES" en `statusFor()`; queda
  documentado, sin corregir en esta fase.
- Ver `docs/AUTOMATED_TESTS.md` para el detalle completo, incluida la lista
  de lo que todavía requiere extracción durante la modularización.

## 2026-09-23 — Corrección de ENGRASE-001 y Modularización JavaScript 1
- `98f3d08` `fix: validate invalid hourmeter values in lubrication status`
  — pruebas de regresión primero (reprodujeron el bug, 4/4 fallaban), luego
  el fix mínimo en `statusFor()`: `Number.isFinite(equipment.hourmeter)`
  sin coerción. 82/82 PASS. Sincronizado y compilado en Android, todo PASS.
- Modularización: se extrajeron a `src/core/` (dentro de la fuente
  canónica, scripts clásicos, sin Vite/ES modules) las 4 áreas de menor
  riesgo, ya cubiertas por pruebas: `shifts.js` (turnos), `hourmeter.js`
  (validación de horómetro), `lubrication-status.js` (estado de engrase),
  `anomalies.js` (criticidad de anomalías). `app.js` pasó de 7388 a 7243
  líneas, sin duplicar ninguna función. `index.html` y `sw.js` se
  actualizaron para cargar/precachear los archivos nuevos;
  `tools/sync-web-to-android.mjs` los detectó automáticamente, sin
  necesitar cambios. 82/82 PASS después de cada una de las 4 extracciones.
  Ver `docs/MODULARIZATION.md` para la tabla de riesgo completa y la
  decisión de arquitectura.
- No se tocó Supabase, IndexedDB ni `sync.js`. No se instaló Vite ni
  TypeScript. Ninguna funcionalidad nueva.

## 2026-09-23 — Validación en Android real de la Modularización JS Fase 1
**MODULARIZACIÓN JS FASE 1: PROBADA EN ANDROID REAL.**
**SERVICE WORKER: PROBADO OFFLINE CON NUEVOS MÓDULOS.**
- Samsung SM-S938B, `adb install -r` preservando datos. App arranca sin
  `FATAL EXCEPTION`; los 4 módulos (`src/core/*.js`) cargan sin error 404.
- Pruebas manuales M1-M6 (login/turno/estados de engrase/horómetro/
  anomalías/reapertura completa): PASS. Prueba offline (interfaz, turno y
  estados de engrase con el dispositivo en modo avión): PASS.
- Se registraron dos hallazgos NO relacionados con la modularización (ver
  `docs/BUG_REGISTER.md`): `NOTIF-ANDROID-001` (SDK Web de OneSignal lanza
  un error dentro del WebView, preexistente) y `UI-ANDROID-005` (tabla del
  Dashboard sin adaptar a tarjeta móvil, presente desde el commit
  baseline).

## 2026-09-23 — Corrección de NOTIF-ANDROID-001: separar OneSignal Web y nativo
- Causa raíz de dos partes: (1) `index.html` cargaba el `<script>` del SDK
  Web de OneSignal de forma incondicional, también dentro de
  Capacitor/Android, pese a que `app.js` ya tenía una ruta correcta
  (`initWebPush()`) gateada por `window.Capacitor`; (2) tras quitar esa
  etiqueta, el Service Worker seguía sirviendo el `index.html` viejo desde
  caché porque `sw.js` no había cambiado de bytes (sin nuevo evento
  `install`).
- Fix: se eliminó la etiqueta `<script>` incondicional de `index.html`
  (Web y su copia en `www`); se subió `CACHE` en `sw.js` de
  `engrase-openpit-v23` a `engrase-openpit-v24` para forzar la
  actualización del caché en dispositivos ya instalados. `app.js` no se
  modificó — su lógica de selección de plataforma ya era correcta.
- Se agregaron 6 pruebas unitarias nuevas (`tests/unit/notificaciones-plataforma.test.js`
  + helper `tests/helpers/loadNotificationLogic.js`) que ejercitan las
  funciones reales `initWebPush`/`initPushNotifications` extraídas de
  `app.js`. Suite completa: 82 → 88/88 PASS.
- Validado en Samsung SM-S938B real (`adb install -r`, datos preservados):
  11 lanzamientos consecutivos sin el error
  `Cannot read properties of undefined (reading 'triggerEvent')` ni el
  mensaje `Incompatible browser.` en logcat.
  Push real no se probó (`ONESIGNAL_APP_ID` vacío en producción — push
  deshabilitado por configuración, no por este fix).
- Ver `docs/BUG_REGISTER.md` (`NOTIF-ANDROID-001`) para el detalle completo
  y `docs/DECISIONS.md` para la arquitectura Web vs. Android de OneSignal.
- Commit: `fix: separate web and native OneSignal initialization`.

## 2026-09-23 — Modularización JavaScript Fase 2: Matriz Semanal y Anomalías
- Revalidación offline corta previa (Service Worker v24, tras el cambio de
  `NOTIF-ANDROID-001`): login offline, Dashboard y Matriz con datos reales,
  sin errores — PASS.
- `dbadee9` `refactor: extract weekly lubrication matrix logic` —
  `estadoCelda()` pasó de función anidada dentro de `renderMatrizSemanal()`
  (cerraba sobre `plans`/`records`/`hoy`) a función pura top-level en
  `src/core/weekly-matrix.js`, recibiendo esos datos como parámetros
  explícitos. Se confirmó leyendo el código que la reprogramación puntual
  (`reprogramadoHasta`) no afecta la Matriz (solo el Dashboard) — se
  preservó tal cual, sin inventar comportamiento. 15 pruebas nuevas
  (`matriz-estado-celda.test.js`). 88 → 103 PASS. `sw.js`: `CACHE`
  v24 → v25 (nuevo archivo a precachear).
- `488c474` `refactor: extract lubrication anomaly decision logic` — se
  separó la decisión de negocio de `createAutoAnomalies()` (¿crear,
  actualizar o nada?) de la persistencia. `evaluateAnomalyActions()` y
  `hayPuntosOAnomaliaHorometro()` (`src/core/anomaly-actions.js`) son
  puras; `createAutoAnomalies()` en `app.js` sigue siendo la única que
  llama `DB.allActive`/`DB.put`/`logAudit`. Se confirmó que el duplicado
  se detecta solo por `autoPointId` (no por equipo — responsabilidad de
  quien arma la lista de anomalías abiertas) y que
  `'El equipo no tiene horómetro'` no genera anomalía. 22 pruebas nuevas
  (`anomaly-actions.test.js`). 103 → 125 PASS. `sw.js`: `CACHE` v25 → v26.
- `app.js`: 7243 → 7187 líneas tras ambas extracciones. Sin duplicación de
  lógica — cada regla vive en un único archivo.
- `tools/sync-web-to-android.mjs --apply` (2 rondas), `npx cap sync
  android` (sin cambios en archivos versionados de Android fuera de
  `www`/`assets/public`), `./gradlew assembleDebug` PASS.
- Validado en Samsung SM-S938B real: `adb install -r` con datos
  preservados (`firstInstallTime` sin cambios); smoke test — Dashboard,
  Matriz y Anomalías abren con datos reales, sin `FATAL EXCEPTION` ni
  errores nuevos en `Capacitor/Console`.
- Hallazgo nuevo durante esta fase, **no relacionado** con la
  modularización ni con `NOTIF-ANDROID-001`: `ANDROID-DOZE-001` (P3) —
  lanzar la app con la pantalla del dispositivo apagada/dozing puede
  producir un ciclo abrupto `App resumed→paused→stopped` y, a veces, el
  mismo error `triggerEvent` pero con una firma distinta (sin
  `onesignal.com`, sin "Incompatible browser."). No se reprodujo ni una
  vez con la pantalla despierta y desbloqueada. No corregido, registrado
  para una fase futura — ver `docs/BUG_REGISTER.md`.
- No se tocó Supabase, IndexedDB ni `sync.js`. No se instaló Vite ni
  TypeScript. Ninguna funcionalidad nueva.

## 2026-09-23 — Fase Vite 1: build paralelo (shadow build)
- Tag local de checkpoint `pre-vite-js-stable` → commit `df69898` (no se
  hizo push).
- `npm install --save-dev vite` (5.4.21) en el `package.json` raíz;
  scripts `dev`/`build`/`preview` nuevos, `test`/`test:watch` intactos.
- `vite.config.js` (nuevo): `root` = fuente canónica (sin reorganizar a
  `src/`+`public/`), `base: './'`, `outDir` = `dist/` (gitignored).
- Se comprobó empíricamente (build sin plugin, antes de escribir la
  configuración final) que Vite deja intactos los `<script src>` clásicos
  pero no los copia, y SÍ hashea `manifest.json`/íconos/CSS — habría roto
  el precache exacto de `sw.js`.
- Se extrajo `computeRuntimeFileSet()` y sus auxiliares de
  `tools/sync-web-to-android.mjs` a un módulo nuevo sin shebang,
  `tools/runtime-file-set.mjs` (esbuild no tolera un shebang en un archivo
  importado) — comportamiento del script de sincronización verificado
  idéntico antes/después (mismo dry-run, mismo resultado).
- Plugin `copyStableRuntimeFiles()` en `vite.config.js`: copia, con
  nombre estable, el mismo set runtime que ya usa
  `tools/sync-web-to-android.mjs`, y reescribe en `dist/index.html` las 4
  referencias que Vite había hasheado, de vuelta a su ruta relativa
  original.
- `npm run build`: PASS. 27 archivos runtime en `dist/`, idénticos byte a
  byte a la fuente (`cmp`). `dist/index.html` solo difiere en detalles
  cosméticos de Vite. `npm run dev`/`npm run preview`: PASS por HTTP (sin
  404). `npm test`: 125/125 PASS, sin cambios en las pruebas.
- `capacitor.config.json` (`webDir: "www"`), `CONTROL_ENGRASE_APP_ANDROID/www`,
  GitHub Pages y Supabase: sin modificar. No se publicó nada.
- Ver `docs/VITE_MIGRATION.md` para el detalle completo (arquitectura,
  configuración, riesgos, rollback).

## 2026-09-23 — Fase Vite 2: `dist` → Capacitor → Android
- `capacitor.config.json`: `webDir` de `"www"` a `"../dist"` — ruta
  verificada leyendo `node_modules/@capacitor/cli/dist/config.js`
  (`webDirAbs = path.resolve(process.cwd(), webDir)`), no asumida.
- Comparación `dist` vs `www` del set runtime (28 archivos): 27 idénticos
  por hash, solo `index.html` difiere (normalizaciones cosméticas de
  Vite, ya documentadas en Fase 1). Los 2 sobrantes históricos de `www`
  (`icon-180.png`, `schema.sql`) NO se copiaron a `dist` — no forman
  parte del set runtime real.
- `npx cap sync android`: confirmado por su propia salida que copia desde
  `dist`, no desde `www`.
- Verificación por hash en dos niveles, sin texto de debug visible: el
  `.apk` local y el APK **realmente instalado** en el dispositivo
  (extraído con `adb pull` del `base.apk` real vía `adb shell pm path`)
  contienen `assets/public/index.html` con el mismo SHA-256 que
  `dist/index.html`, distinto al de `www/index.html`.
- `./gradlew assembleDebug`: PASS. `adb install -r` en el Samsung
  SM-S938B: datos conservados (`firstInstallTime` sin cambios).
- Smoke test A01–A10 (app abre, login, Dashboard, Turno, Equipos, estados
  de engrase, Matriz Semanal, Anomalías, Historial, Reportes), validado
  por el usuario con datos de producción reales: todos PASS. Logcat sin
  `FATAL EXCEPTION` ni errores de `Capacitor/Console`.
- **Offline real con `dist` (obligatoria, quedaba pendiente de Fase 1):**
  online → varias pantallas → modo avión → cierre completo → reapertura
  offline (shell desde el precache de `sw.js`) → login y navegación
  offline (Turno/Equipos/estados/Matriz/Anomalías) con datos ya
  guardados localmente → vuelta a online. **PASS.**
- `CONTROL_ENGRASE_APP_ANDROID/www` y `tools/sync-web-to-android.mjs`:
  sin tocar, sin intervenir en ningún paso de esta fase (confirmado con
  `git status`) — quedan como *fallback temporal*, documentado el
  procedimiento de rollback (3 pasos) sin ejecutarlo.
- `npm test`: 125/125 PASS, sin cambios. GitHub Pages, Supabase,
  IndexedDB, `sync.js`: sin modificar. No se publicó nada.
- Ver `docs/VITE_MIGRATION.md` (sección Fase 2) para el detalle completo.
- Commit: `build: use vite dist for capacitor android`.

## 2026-09-23 — Fase Vite 3: validar `dist` para GitHub Pages (sin publicar)
- Configuración remota de GitHub Pages reconstruida de documentación
  local ya existente (`README_SUBIR_A_GITHUB.txt`,
  `docs/PLAN_UNIFICACION_WEB_ANDROID.md`, etc.), sin duplicar el
  análisis: repo de usuario `junivalles-cmd.github.io`, raíz del
  dominio, publicación manual, sin Actions. Marcado explícitamente
  **CONFIGURACIÓN REMOTA: NO VERIFICADA** (sin `git remote` conectado,
  sin consultar GitHub).
- Inventario completo de `dist/` (28 archivos) clasificado y verificado:
  `.nojekyll` (vacío), `.well-known/assetlinks.json` (válido,
  `package_name` correcto), `manifest.json` (íconos existentes), `sw.js`
  (24 rutas de `ASSETS` resuelven todas), `OneSignalSDKWorker.js`, los 6
  `src/core/*.js`.
- Confirmado (grep, no a simple vista): ninguna ruta absoluta de raíz en
  `index.html`/`manifest.json`/`styles.css`/`sw.js`. Decisión `base:
  './'` (ya configurada en Fase 1) confirmada correcta para un dominio
  de usuario servido en la raíz, documentada en vez de cambiada.
- Confirmado que `dist/index.html` no volvió a cargar el SDK Web de
  OneSignal de forma incondicional (`NOTIF-ANDROID-001` no reapareció).
- `npm run preview`: 20 recursos, 200 en todos, 0 errores 404.
- Prueba Web real en navegador (WEB-VITE-01 a 13) y prueba offline
  obligatoria (Service Worker activo → offline de DevTools → recarga →
  shell y `src/core/` siguen disponibles): preparadas para el usuario
  (sin herramienta de automatización de navegador en esta sesión) y
  ejecutadas por él — **todo PASS**, confirmado, no inventado.
- Comparación fuente vs. `dist`: 27/28 archivos idénticos byte a byte,
  solo `index.html` con diferencias cosméticas ya documentadas.
- Nuevo `tools/verify-dist.mjs` (`npm run verify:dist`) — reutiliza
  `computeRuntimeFileSet()`, sin duplicar lógica; probado contra un
  fallo real (se quitó `.nojekyll` temporalmente, detectó el problema,
  código de salida 1, luego se restauró). Nuevo `npm run build:web`
  (`test && build && verify:dist`).
- Nuevo `docs/WEB_DEPLOYMENT.md`: procedimiento paso a paso de
  publicación (manual, sin Actions) y rollback.
- `npm test`: 125/125 PASS. Android sigue usando `dist`
  (`capacitor.config.json` sin tocar en esta fase). **No se publicó
  nada**: sin `git push`, sin subir archivos a
  `junivalles-cmd.github.io`, sin tocar GitHub Pages. `www`,
  `tools/sync-web-to-android.mjs`, Supabase, IndexedDB, `sync.js`: sin
  modificar.
- Ver `docs/VITE_MIGRATION.md` (sección Fase 3) y `docs/WEB_DEPLOYMENT.md`
  para el detalle completo.
- Commit: `build: prepare vite dist for github pages deployment`.

## 2026-09-23 — Fase Vite 4: primer despliegue controlado a GitHub Pages
- Configuración remota real verificada con `git ls-remote` (corrigiendo
  el dato desactualizado de la Fase 3): repo de Project Page
  `github.com/junivalles-cmd/control-engrase-openpit`, publicado en
  `https://junivalles-cmd.github.io/control-engrase-openpit/` (con
  subpath). `base: './'` confirmado como la única opción correcta para
  esa configuración, no solo "más portable".
- Deploy real: commit `d52d43d` sobre el repositorio de Pages (checkout
  separado, sin tocar el `remote` de este repositorio). 28 archivos
  runtime comparados por hash antes de escribir.
- Validación HTTP de producción: 16/16 URLs con 200, `sw.js` en `CACHE
  v26`, 0 referencias incondicionales a `onesignal.com`.
- `PROD-WEB-01` a `10` + offline en producción: todos **PASS**,
  confirmados uno por uno por el usuario.
- Hallazgos nuevos, ninguno causado por el deploy: `APP-LINKS-001` (P2,
  arquitectónico — Project Page no puede servir `.well-known/` en la
  raíz del host) y `MATRIZ-DOMINGO-001` (P3, preexistente — la Matriz
  Semanal nunca incluyó el domingo).
- Ver `docs/VITE_MIGRATION.md` (Fase 4) y `docs/BUG_REGISTER.md` para el
  detalle completo.
- Commit (documental): `492e05d`.

## 2026-09-23 — Fase Vite 5: retiro controlado del flujo legacy `www`
- Checkpoint: tag local `pre-remove-legacy-www` → `492e05d` (sin push).
- Auditoría previa a cualquier cambio: `capacitor.config.json` ya usaba
  `webDir: "../dist"` (desde la Fase 2); `tools/sync-web-to-android.mjs`
  no era importado ni ejecutado por `npm test`/`build`/`build:web`/
  `dev`/`preview`/`verify:dist`/Capacitor/Android — confirmado por
  inspección directa del código, no asumido.
- Comparación `www` vs. `dist` por hash: 27/29 archivos idénticos (más
  `index.html` con la diferencia cosmética ya conocida), 2 sobrantes
  no-runtime (`schema.sql`, `icon-180.png`) que no se copiaron a `dist`.
- Retirados del repositorio: `tools/sync-web-to-android.mjs` y
  `CONTROL_ENGRASE_APP_ANDROID/www` (29 archivos) — recuperables vía Git
  desde el tag de checkpoint. `android/app/src/main/assets/public` sin
  tocar (sigue siendo responsabilidad exclusiva de Capacitor).
  `docs/SYNC_WEB_ANDROID.md` conservado como referencia histórica, con
  nota de retiro agregada al inicio.
- Prueba crítica: `dist/` borrado y reconstruido desde cero (`npm run
  build:web`) con `www` ya eliminado del repositorio — 125/125 tests,
  build y `verify:dist` **PASS**, sin recuperar nada de `www`.
- `npx cap sync android` confirmó por su salida que copia desde `dist`
  sin errores por la ausencia de `www`. `./gradlew assembleDebug`:
  **BUILD SUCCESSFUL**; verificado por hash que `assets/public/index.html`
  del APK coincide con `dist/index.html`.
- Android real y offline: **NO PROBADO** (Samsung no conectado,
  `adb devices` sin dispositivos) — marcado honestamente, no asumido.
- `npm run preview`: 19/19 recursos con 200. `dist` no cambió respecto a
  la Fase 4 (fuente Web y `vite.config.js` sin tocar en esta fase) — **no
  se publicó ningún redeploy** a GitHub Pages.
- `npm test` final: 125/125 PASS. Sin cambios en Supabase, IndexedDB,
  `sync.js`, Service Worker, `AndroidManifest.xml` ni fingerprints.
- Arquitectura final: `CONTROL_ENGRASE_WEB` → Vite → `dist/` → (GitHub
  Pages + Capacitor/Android), única salida runtime.
- Ver `docs/VITE_MIGRATION.md` (Fase 5) para el detalle completo,
  incluida la auditoría archivo por archivo y el rollback en tres
  niveles.
- Commit: `build: remove legacy www deployment flow`.

## 2026-09-23 — TypeScript Fase 1: preparación segura (infraestructura)
- Checkpoint: tag local `pre-typescript-stable` → `a284e5c` (sin push).
- `typescript@^7.0.2` instalado como única devDependency nueva (`npm
  audit --omit=dev`: 0 vulnerabilidades — las 5 que reporta el audit
  completo son de `vite`/`vitest`/`esbuild`, preexistentes, no tocadas).
- `tsconfig.json`: `allowJs: true`, `checkJs: false` (opt-in por archivo
  con `// @ts-check`), `noEmit: true`, `strict: true`, `include` acotado
  a `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\src\**` (deja fuera
  `app.js`/`db.js`/`sync.js` a propósito). Nuevo `npm run typecheck`.
  Línea base: **0 errores**, sin usar `// @ts-ignore`.
- Mapa de dependencias de los 6 módulos de `src/core/` (exports,
  globales, tests, riesgo) documentado en
  `docs/TYPESCRIPT_MIGRATION.md`. Tipos del dominio nuevos, solo
  declaraciones: `src/types/lubrication.ts`, `src/types/shift.ts` —
  campos tomados de objetos reales, no referenciados desde `index.html`
  (Vite no los procesa ni los copia a `dist/`, confirmado).
- **Hallazgo crítico verificado en un proyecto Vite aislado:** un
  `<script src="archivo.ts">` clásico no se bundlea ni se copia a
  `dist/` (mismo comportamiento que un `.js` clásico) — renombrar
  cualquier `src/core/*.js` a `.ts` produciría `SyntaxError` en el
  navegador si se copiara igual. Segundo bloqueo independiente: el
  arnés de tests evalúa texto fuente crudo con `new Function(...)`,
  incompatible con sintaxis TS real. **No se renombró ningún archivo
  productivo a `.ts`** esta fase, siguiendo la regla explícita del
  pedido.
- `src/core/hourmeter.js` (elegido sobre `shifts.js` tras comparación
  técnica) recibió `// @ts-check` + JSDoc tipado, sin cambiar extensión
  ni lógica. `npm run typecheck`: PASS, 0 errores con `strict: true`.
  `npm test`: 125/125 PASS sin cambios. `npm run build:web`: PASS,
  `dist/src/core/hourmeter.js` idéntico por hash, ruta estable sin
  cambios. `npx cap sync android` + `./gradlew assembleDebug`: **BUILD
  SUCCESSFUL**, verificado por hash que el APK contiene el archivo
  correcto. Android real: **NO PROBADO** (Samsung no conectado). Sin
  cambios en Supabase, IndexedDB, `sync.js`, Service Worker.
- Ver `docs/TYPESCRIPT_MIGRATION.md` para el detalle completo, la
  estrategia de Fase 2 y el rollback en tres niveles.
- Commit(s): `build: add typescript migration foundation`,
  `refactor: type-annotate hourmeter core module with jsdoc`.

## 2026-09-23 — UI/Responsive Fase 1: auditoría (sin corregir)
- Playwright (7 resoluciones) + Stylelint instalados como tooling de
  auditoría, sin frameworks de UI nuevos. Solo se automatizó la
  pantalla de login (pública) — el resto requiere PIN real de
  producción, marcado REQUIERE VALIDACIÓN MANUAL en vez de un PASS
  inventado.
- Stylelint: 595 errores/16 reglas en la línea base → clasificados uno
  por uno → 0 errores, 56 warnings no bloqueantes, sin `--fix`.
- Hallazgos: P1=0, P2=0, P3=5. `UI-ANDROID-005` (causa raíz: densidad,
  no overflow) y `.kpi-grid` no monótono (`UI-RESP-003`) identificados
  como los únicos accionables.
- Ver `docs/UI_RESPONSIVE.md` (Fase 1) para el detalle completo.
- Commit: `test: add responsive ui audit tooling`.

## 2026-09-23 — UI/Responsive Fase 2: correcciones dirigidas
- Corregidos solamente `UI-ANDROID-005` y `.kpi-grid` (`UI-RESP-003`) —
  sin refactorización general de `styles.css`, sin tocar Lubricador,
  formularios, Matriz Semanal, lógica de negocio ni TypeScript.
- `UI-ANDROID-005`: 5 de 9 columnas del panel "Equipos que requieren
  atención" marcadas `class="col-secondary"` (`app.js`), ocultas solo
  en `≤680px` (`styles.css`) — Estado/Código/Equipo/Restante-Atraso
  siempre visibles, desktop sin cambios. Sin `overflow-x`, sin
  `nth-child`. Efecto colateral (borde huérfano) corregido con una
  regla CSS genérica adicional.
- `.kpi-grid`: progresión 2→4→3→6 (no monótona) → 2→2→3→4→6, usando
  los mismos 3 breakpoints ya existentes (600/900/1100), sin agregar
  ninguno nuevo — eliminada la declaración duplicada que causaba el
  comportamiento dependiente del orden del archivo.
- Verificación: dos specs Playwright nuevos sin login (fragmentos
  estáticos con estructura/clases reales, nunca datos de producción) —
  **21/21 PASS** (suite completa). `npm run lint:css`: 0 errores, 56
  warnings (idénticos a Fase 1). `npm test`: 125/125 PASS. `npm run
  typecheck`: PASS. `npm run build:web`: PASS. `npm run preview`: sin
  404, sin errores JS. `npx cap sync android` + `assembleDebug`:
  **BUILD SUCCESSFUL**. Android real: **NO PROBADO** (Samsung no
  conectado). Sin cambios en Supabase, IndexedDB, `sync.js`, Service
  Worker, lógica de negocio.
- Ver `docs/UI_RESPONSIVE.md` (Fase 2) para el detalle completo.
- Commit(s): `fix: reduce dashboard information density on mobile`,
  `fix: normalize responsive kpi grid`,
  `docs: record UI/Responsive Fase 2 corrections and validation status`.

## 2026-09-23 — `UI-ANDROID-005`: validación manual PASS, cerrado
- `UI-MANUAL-01` (Dashboard móvil): **PASS**, confirmado por el
  usuario — tarjetas compactas, información principal fácil de
  encontrar, sin los 9 campos apilados de antes, sin texto cortado, sin
  scroll horizontal, KPIs ordenados, topbar sin cambios.
- Tablet/desktop (768px/1366px): sin regresión, confirmado vía la
  suite automatizada de Fase 2 (ya cubría explícitamente ambas
  resoluciones con mediciones reales de CSS, no una inferencia) — no
  se pidió una segunda ronda de captura manual aparte.
- `UI-ANDROID-005`: **CORREGIDO, VALIDADO VISUALMENTE, PASS** — cerrado
  en `docs/BUG_REGISTER.md`.
