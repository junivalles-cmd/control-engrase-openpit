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
