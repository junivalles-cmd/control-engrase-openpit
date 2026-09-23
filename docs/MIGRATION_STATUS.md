# ESTADO DE LA MIGRACIÓN

## FASE 0 — Protección del estado actual con Git
**Estado:** COMPLETADA (2026-09-23)

- Repositorio Git inicializado en la raíz `CONTROL_ENGRASE`.
- `.gitignore` configurado (ver `docs/DECISIONS.md` para el detalle de cada
  exclusión).
- Commit baseline creado: `c6d6f786fe53e657dd76c6edfa32ba1df8d816cc` en
  `master`.
- Rama de trabajo `migration-typescript` creada a partir del baseline.
- **No se movió, copió, borró ni modificó ningún archivo de código
  (`app.js`, `db.js`, `sync.js`, `capacitor.config.json`, etc.).**

## Limpieza puntual — archivo ajeno al proyecto
**Estado:** COMPLETADA (2026-09-23)

Se detectó que el commit baseline había incluido por error
`PLAN_MANTENIMIENTO_MAYOR_D8T_05-68.xlsx` (un archivo suelto en la raíz, sin
relación con el sistema Control de Engrase, que el usuario ya había eliminado
del disco fuera de este flujo). Se registró su baja en Git y se agregó a
`.gitignore` para evitar que vuelva a incorporarse por accidente. Commit:
`e5af5ff` — `chore: remove unrelated maintenance spreadsheet from project
tracking`. No se encontraron otros archivos ajenos al proyecto en la raíz.

## FASE 1 — Análisis de fuente única
**Estado:** COMPLETADA (2026-09-23, solo análisis — nada ejecutado)

- Se compararon `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` y
  `CONTROL_ENGRASE_APP_ANDROID\www` archivo por archivo, con hash SHA-256.
  Resultado: el código de negocio (`app.js`, `db.js`, `sync.js`, `styles.css`,
  `index.html`, `sw.js`, `OneSignalSDKWorker.js`, `schema.sql`, `.nojekyll`,
  `.well-known/assetlinks.json`) es 100% idéntico entre ambas copias. Las
  diferencias reales están en `manifest.json` (roto en `www`: color inválido
  y rutas de íconos fuera de la carpeta servida) y en 3 íconos PWA que faltan
  en `www`.
- Se documentó cómo se publica la web hoy (manual, sin build, a
  `junivalles-cmd.github.io`) y cómo Capacitor genera `assets/public` desde
  `www`. Ver detalle completo en `docs/PLAN_UNIFICACION_WEB_ANDROID.md`.
- **Arquitectura recomendada:** Opción A — `CONTROL_ENGRASE_WEB` como fuente
  única, con un script que genere `www` automáticamente (dejando de copiarse
  a mano), con la Opción C (Vite + TypeScript, `src/`+`public/`→`dist/`) como
  destino final documentado para una fase posterior.
- **No se movió, copió, borró ni modificó ningún archivo de código en esta
  fase.**

## FASE A2 — Script de sincronización WEB → www
**Estado:** COMPLETADA (2026-09-23) — herramienta creada y probada, `--apply`
NO ejecutado.

- FUENTE CANÓNICA TEMPORAL: `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`
- SINCRONIZACIÓN: script creado en `tools/sync-web-to-android.mjs` (ver
  `docs/SYNC_WEB_ANDROID.md`). Calcula el set de archivos runtime a partir de
  `index.html`, `manifest.json` y `sw.js` de la fuente (no copia a ciegas);
  excluye explícitamente documentación, manuales, SQL y Edge Functions.
- APPLY: **NO EJECUTADO**. Solo se corrió en modo dry-run.
- ANDROID: **NO MODIFICADO** (ni `www`, ni `android\app\src\main\assets\public`,
  ni ningún archivo de Android Studio/Gradle).
- GITHUB PAGES: **NO MODIFICADO**.
- Dry-run contra el proyecto real confirmó las diferencias ya conocidas
  (`manifest.json` desactualizado en `www`, 3 íconos faltantes, 10 íconos con
  contenido distinto) y además detectó dos hallazgos nuevos: `www` contiene
  `schema.sql` (no es runtime del frontend, no debería estar ahí) e
  `icon-180.png` (existe en ambas copias pero no está referenciado por
  `manifest.json`, `index.html` ni `sw.js` — parece un ícono huérfano). Ambos
  quedan documentados, sin tocarlos.
- Pruebas del script (ruta inexistente, manifest inválido) se hicieron en
  copias aisladas dentro de una carpeta temporal, nunca contra el proyecto
  real.
- Commit: `5d42f66` — `build: add safe web to android sync tool`.

## FASE A3 — Primera sincronización real WEB → www → Android
**Estado:** COMPLETADA (2026-09-23)

- FUENTE CANÓNICA TEMPORAL: `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`.
- APPLY: **EJECUTADO** por primera vez. 13 archivos escritos (10 actualizados,
  3 nuevos), 0 errores. Sobrantes (`schema.sql`, `icon-180.png`) conservados
  sin tocar, como se decidió explícitamente para esta fase.
- Verificación posterior: dry-run en 0/0 (22/22 archivos runtime idénticos
  por hash SHA-256 entre `CONTROL_ENGRASE_WEB` y `www`).
- `manifest.json` de `www`: ahora idéntico a la fuente, JSON válido,
  `background_color` corregido, los 10 íconos existen.
- FUENTE WEB: **NO MODIFICADA** (confirmado con `git diff`).
- `npx cap sync android`: ejecutado sin errores. `android\app\src\main\assets\public`
  regenerado desde `www`; coincide por hash con los archivos runtime de `www`.
  Ningún archivo versionado de Android fue modificado.
- ANDROID BUILD: `./gradlew assembleDebug` **exitoso** (APK de depuración
  generado, ~8.9 MB), tras limpiar artefactos de build obsoletos que
  causaban un error de Windows no relacionado con el código.
- ANDROID EN DISPOSITIVO: **NO PROBADO** (sin dispositivo/emulador conectado).
- WEB EN NAVEGADOR: **NO PROBADO** (sin herramienta de automatización de
  navegador disponible en esta sesión); sí se verificó que todos los
  archivos runtime se sirven correctamente vía HTTP y que el JS no tiene
  errores de sintaxis. Ver `docs/TEST_MATRIX.md` para el detalle completo.
- GITHUB PAGES: **NO MODIFICADO**. No se hizo push ni publicación.
- Commits: `build: synchronize android web assets from canonical web source`
  (sincronización real de `www` + documentación).

## Validación manual en dispositivo real (post Fase A3)
**Estado:** EN CURSO (iniciada 2026-09-23)

- Dispositivo: Samsung SM-S938B, conectado por USB, autorizado en ADB.
- APK debug instalado con `adb install` (limpio, sin instalación previa —
  0 riesgo de pérdida de datos) y actualizado varias veces con
  `adb install -r` (preservando datos; `firstInstallTime` sin cambios en
  todas las reinstalaciones).
- Arranque de la app confirmado (proceso vivo, actividad en primer plano,
  sin errores fatales en logcat).
- **UI-ANDROID-001** (buscador superpuesto): reproducido con evidencia real
  (`docs/evidence/UI-ANDROID-001_before.png`), corregido en dos commits
  (`5751a21`, `1867ba5`) y **validado visualmente por el usuario en el
  dispositivo real — PASS**. Ver `docs/BUG_REGISTER.md`.
- **UI-ANDROID-002** (ícono de logout del Lubricador): corregido en código
  (commit `86ff816`), sincronizado e instalado en el dispositivo —
  **pendiente de validación visual del usuario**.
- **UI-ANDROID-003** (topbar de Administrador excesivamente alto en móvil):
  corregido en tres iteraciones (`21a0ed8` compactar padding/gaps,
  `c126f82` sacar el botón de tema del topbar, `d6b3c34` turno solo ícono en
  móvil) y **validado visualmente por el usuario en el dispositivo real —
  PASS**. Topbar de Administrador ahora en una sola línea. Ver
  `docs/BUG_REGISTER.md`.
- App Links con el APK debug: analizado y **BLOQUEADO EN DEBUG** (el
  certificado del keystore de depuración no coincide con el que exige
  `assetlinks.json`, que sí coincide con el keystore de release
  `engrase-key.jks`) — requiere un build firmado para probarse de verdad,
  fuera de alcance de esta fase.
- Checklist completo de validación manual (login por rol, navegación,
  Lubricador, Equipos, Matriz Semanal, offline, etc.) preparado en
  `docs/MANUAL_VALIDATION.md`, aún no ejecutado caso por caso.

## Cierre de validación funcional manual (previo a esta fase)
- `UI-ANDROID-001` y `UI-ANDROID-003`: **PASS**, validados visualmente por
  el usuario en el Samsung SM-S938B real.
- `UI-ANDROID-002` y `BUG-004`: corregidos en código, sincronizados e
  instalados; **pendiente confirmación visual/funcional del usuario**.
- El checklist detallado por pantalla (`ADM-01`…`ADM-13` para
  Administrador, y el bloque de profundidad para Lubricador) preparado en
  la conversación **no llegó a completarse caso por caso** — la sesión de
  pruebas se desvió hacia la corrección de `UI-ANDROID-003` y `BUG-004` en
  cuanto aparecieron. El usuario indicó que las pruebas funcionales de la
  versión actual ya se dieron por realizadas y aprobadas para continuar,
  pero **no existe un registro fila-por-fila** de cada pantalla en
  `docs/MANUAL_VALIDATION.md` más allá de lo ya anotado ahí.
- **Explícitamente sin probar (no se marca PASS por inferencia):** modo
  offline real, reconexión, sincronización real contra Supabase, y
  verificación de que no se dupliquen registros al sincronizar. Ver
  `docs/TEST_MATRIX.md`.

## FASE — Pruebas automatizadas de lógica
**Estado:** COMPLETADA (2026-09-23)

- Framework: Vitest (devDependency, raíz del repositorio). Ver
  `docs/AUTOMATED_TESTS.md` para el detalle completo.
- 77 pruebas en 8 archivos, todas **PASS**, protegiendo: turnos (incluye
  cruce de medianoche en turno Noche), estado de engrase por frecuencia de
  horómetro, matriz semanal (plan por día/turno), criticidad y no-duplicado
  de anomalías automáticas, validación de horómetro, borrado lógico
  `active:true/false`, y las reglas de orden/detección de sincronización
  (sin tocar Supabase real).
- Las funciones probadas se **extraen del código fuente real**
  (`tests/helpers/extractFromSource.js`) — no se reescribió ni se duplicó
  lógica a mano. `app.js`, `db.js` y `sync.js` **no fueron modificados**.
- Se descubrió y registró un bug real (`ENGRASE-001`, P2): un horómetro con
  valor no numérico no se detecta como dato inconsistente. No se corrigió
  en esta fase (no se pidió tocar lógica de negocio); queda documentado en
  `docs/BUG_REGISTER.md`.
- Queda documentado qué requiere extracción durante la modularización antes
  de poder probarse: `estadoCelda()` (Matriz Semanal), `createAutoAnomalies()`,
  `Sync.pushAll/pullAll/fullSync`, y `DB.allActive`/`DB.put`/etc. reales.

## Próximas fases (NO iniciadas)

Estas fases se planificarán y ejecutarán en conversaciones futuras, una por
una, con confirmación explícita antes de cada paso. Ver el detalle completo
de cada una en `docs/PLAN_UNIFICACION_WEB_ANDROID.md`, sección 9:

- **FASE A1:** fijar formalmente `CONTROL_ENGRASE_WEB` como fuente canónica
  (documental, ya cubierto por este mismo documento y el plan).
- **FASE A2:** crear (sin ejecutar todavía) el script de sincronización
  automática `CONTROL_ENGRASE_WEB → www`.
- **FASE A3:** ejecutar ese script una vez sobre `www` real, validar en Web
  y Android, y comitear el resultado.
- **FASE A4:** consolidar la documentación/backend duplicados entre las
  raíces de `CONTROL_ENGRASE_WEB` y `CONTROL_ENGRASE_APP_ANDROID`.
- **FASE C1/C2 (mucho más adelante):** introducir Vite, reorganizar en
  `src/`+`public/`, y migrar a TypeScript, archivo por archivo.

## FASE — Corrección de ENGRASE-001
**Estado:** COMPLETADA (2026-09-23)

- `statusFor()` (`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\app.js`, luego
  movida a `src/core/lubrication-status.js`) ahora valida
  `Number.isFinite(equipment.hourmeter)` antes de calcular el estado —
  sin coerción de tipos. Un horómetro `undefined`, `""`, `"abc"`, `NaN` o
  cualquier valor no numérico se marca como **DATOS INCONSISTENTES** en vez
  de "AL DÍA".
- Pruebas de regresión agregadas ANTES de corregir (confirmaron la
  reproducción: 4/4 fallaban contra el código viejo); 82/82 PASS después.
- Sincronizado a `www`/Android, `npx cap sync android` y build debug, todo
  PASS.
- Commit: `98f3d08` — `fix: validate invalid hourmeter values in
  lubrication status`.

## FASE — Modularización JavaScript 1
**Estado:** COMPLETADA (2026-09-23)

- Se extrajeron de `app.js` a `src/core/` (scripts clásicos, sin
  ES modules/Vite) 4 áreas de riesgo BAJO, ya cubiertas por pruebas:
  turnos (`shifts.js`), validación de horómetro (`hourmeter.js`), estado de
  engrase (`lubrication-status.js`), criticidad de anomalías
  (`anomalies.js`). Detalle completo, tabla de riesgo, y la decisión de
  arquitectura (por qué scripts clásicos y no ES modules) en
  `docs/MODULARIZATION.md`.
- `app.js`: 7388 → 7243 líneas (-145). Sin duplicación de lógica — cada
  función se movió, no se copió.
- `index.html` recibió 4 `<script src="src/core/...">` nuevos (mismo patrón
  ya usado para db.js/sync.js/app.js). `sw.js` recibió las mismas 4 rutas en
  su lista de precaché, para no romper el modo offline.
- `tools/sync-web-to-android.mjs` **no se modificó** — detectó los archivos
  nuevos automáticamente. Sincronizado a `www`/Android, `npx cap sync
  android` y build debug, todo PASS.
- Supabase, IndexedDB y `sync.js` sin cambios. Ninguna funcionalidad nueva.
- Commit: `refactor: extract tested lubrication core logic` (ver hash en
  `docs/CHANGELOG_MIGRATION.md`).

**MODULARIZACIÓN JS FASE 1: PROBADA EN ANDROID REAL** (2026-09-23,
Samsung SM-S938B). `adb install -r` preservando datos, app arranca sin
`FATAL EXCEPTION`, los 4 módulos nuevos (`src/core/*.js`) se cargan sin
error 404 (confirmado en logcat: `Capacitor: Handling local request:
https://localhost/src/core/*.js`, todos exitosos). Pruebas manuales
M1-M6 (login, turno, estados de engrase, horómetro, anomalías, reapertura
completa): **PASS**. **SERVICE WORKER: PROBADO OFFLINE CON NUEVOS
MÓDULOS** — con el dispositivo en modo avión, la interfaz, el turno y los
estados de engrase siguieron cargando con normalidad (PASS).

Durante esta validación se encontraron y registraron dos hallazgos, ambos
confirmados **NO relacionados con la modularización** (ver
`docs/BUG_REGISTER.md`): `NOTIF-ANDROID-001` (error del SDK Web de
OneSignal dentro del WebView, preexistente — ocurre antes de que carguen
los módulos nuevos) y `UI-ANDROID-005` (tabla genérica sin adaptar a
tarjeta móvil en el Dashboard, presente desde el commit baseline).

**NOTIF-ANDROID-001: CORREGIDO Y VALIDADO EN ANDROID REAL** (2026-09-23).
Causa raíz de dos partes: `index.html` cargaba el SDK Web de OneSignal sin
condición (también en Android) pese a que `app.js` ya tenía la separación
correcta por plataforma; y el Service Worker servía el `index.html` viejo
desde caché tras el primer fix, por lo que también se subió la versión de
`CACHE` en `sw.js`. 88/88 pruebas automatizadas PASS (6 nuevas). 11
lanzamientos consecutivos en el Samsung SM-S938B sin el error
`triggerEvent`. Push real no probado (`ONESIGNAL_APP_ID` vacío en
producción). Ver `docs/BUG_REGISTER.md` y `docs/DECISIONS.md` (§10) para el
detalle completo. `UI-ANDROID-005` permanece sin corregir, deferido a
propósito.

## MODULARIZACIÓN JS FASE 2 — Matriz Semanal y Anomalías
**Estado:** COMPLETADA Y VALIDADA EN ANDROID REAL (2026-09-23)

Antes de tocar código: revalidación offline corta con Service Worker v24
(login offline, Dashboard y Matriz con datos reales, sin errores) —
**PASS**.

Se extrajeron las dos piezas de lógica que la Fase 1 había dejado
pendientes por estar anidada (`estadoCelda`) o acoplada a IndexedDB
(`createAutoAnomalies`):
- **Matriz Semanal:** `estadoCelda()` cambió de función anidada (cerraba
  sobre `plans`/`records`/`hoy`) a función pura top-level en
  `src/core/weekly-matrix.js`, recibiendo esos datos como parámetros. Se
  confirmó leyendo el código (no se asumió) que la reprogramación puntual
  (`reprogramadoHasta`) NO afecta la Matriz, solo el Dashboard — se
  preservó ese comportamiento tal cual. 15 pruebas nuevas.
- **Anomalías automáticas:** se separó la decisión de negocio (¿crear,
  actualizar o nada?) de la persistencia. `evaluateAnomalyActions()` y
  `hayPuntosOAnomaliaHorometro()` (`src/core/anomaly-actions.js`) son
  puras — `createAutoAnomalies()` en `app.js` sigue siendo la única que
  toca `DB.allActive/put`. Se confirmó que el duplicado se detecta solo
  por `autoPointId` (no por equipo — responsabilidad del caller) y que
  `'El equipo no tiene horómetro'` no genera anomalía. 22 pruebas nuevas.

`app.js`: 7243 → 7187 líneas. `sw.js`: `CACHE` subido dos veces (v24 → v25
al agregar la Matriz, v25 → v26 al agregar Anomalías). Suite completa:
88 → 103 → 125 pruebas, 100% PASS en cada paso. Sin duplicación de lógica.

Validado en Samsung SM-S938B real: `./gradlew assembleDebug` PASS,
`adb install -r` con datos preservados, smoke test (Dashboard/Matriz/
Anomalías abren con datos reales, sin `FATAL EXCEPTION` ni errores nuevos)
PASS.

Durante esta fase se descubrió y registró un hallazgo nuevo, **no
relacionado** con la modularización ni con `NOTIF-ANDROID-001`:
`ANDROID-DOZE-001` (P3) — lanzar la app con la pantalla del dispositivo
apagada/dozing puede producir un ciclo abrupto `App resumed→paused→stopped`
y, en algunos casos, el mismo error `triggerEvent` pero con una firma
distinta (sin `onesignal.com`, sin "Incompatible browser."). Con la
pantalla despierta y desbloqueada (uso normal), no se reprodujo ni una vez.
No corregido, fuera de alcance de esta fase. Ver `docs/BUG_REGISTER.md`.

No se tocó Supabase, IndexedDB ni `sync.js`. No se instaló Vite ni
TypeScript. Ninguna funcionalidad nueva. `UI-ANDROID-005` sigue sin
corregir, deferido a propósito.

## FASE VITE 1 — Build paralelo / shadow build
**Estado:** COMPLETADA (2026-09-23)

Checkpoint previo: tag local `pre-vite-js-stable` → commit `df69898`. Se
instaló Vite 5.4.21 como devDependency única en el `package.json` raíz
(scripts `dev`/`build`/`preview`), configurado para leer la fuente
canónica (`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`) sin reorganizarla, y
generar `dist/` (gitignored, artefacto reconstruible) — sin sustituir
`www` ni GitHub Pages.

Hallazgo empírico clave: Vite no hashea los `<script src>` clásicos (los
deja intactos) pero tampoco los copia; en cambio SÍ hashea
`manifest.json`/íconos/CSS referenciados por `<link>`, lo que habría roto
el precache exacto de `sw.js`. Se resolvió con un plugin propio
(`copyStableRuntimeFiles()` en `vite.config.js`) que copia el mismo *set*
runtime que ya calcula `tools/sync-web-to-android.mjs` con nombres
estables, y reescribe las 4 referencias hasheadas de vuelta. Esa lógica
compartida se extrajo a `tools/runtime-file-set.mjs` (nuevo, sin shebang —
esbuild no tolera un shebang en un módulo importado) para no duplicarla.

`npm run build`: PASS. Los 27 archivos runtime en `dist/` son idénticos
byte a byte a la fuente (verificado con `cmp`); `dist/index.html` solo
difiere en normalizaciones cosméticas de Vite (rutas `./`, atributo
`crossorigin`, orden del `<link>` de estilos). `npm run dev` y
`npm run preview`: PASS por HTTP (sin 404, tipos de contenido correctos) —
sin validación de interacción real en navegador (sin herramienta de
automatización disponible en esta sesión, marcado honestamente NO
PROBADO, igual que la prueba offline del build Vite). `npm test`: 125/125
PASS, sin cambios en las pruebas. `capacitor.config.json`/`webDir`/`www`/
GitHub Pages/Supabase: sin modificar. Ver `docs/VITE_MIGRATION.md` para el
detalle completo, riesgos y plan de rollback.

## FASE VITE 2 — `dist` → Capacitor → Android
**Estado:** COMPLETADA Y VALIDADA EN ANDROID REAL (2026-09-23)

`capacitor.config.json`: `webDir` cambiado de `"www"` a `"../dist"` (ruta
verificada leyendo el código fuente de `@capacitor/cli`, no asumida).
`npx cap sync android` confirmó por su propia salida
(`Copying web assets from dist to ...assets/public`) que usa `dist`, no
`www`. `www` y `tools/sync-web-to-android.mjs` **no se borraron** y **no
intervinieron** en ningún paso de esta fase (`git status` sin cambios en
`www` antes/después de todo el flujo) — quedan como *fallback temporal*.

Verificación por hash en dos niveles (sin texto de debug visible en la
UI): el `.apk` local y el APK **realmente instalado** en el dispositivo
(extraído con `adb pull` del `base.apk` real) contienen
`assets/public/index.html` con el mismo SHA-256 que `dist/index.html`, y
distinto al de `www/index.html` — prueba objetiva de que el APK probado
viene de `dist`.

`./gradlew assembleDebug`: PASS. `adb install -r`: datos conservados
(`firstInstallTime` sin cambios). Smoke test A01–A10 (app abre, login,
Dashboard, Turno, Equipos, estados de engrase, Matriz Semanal, Anomalías,
Historial, Reportes) validado por el usuario en el Samsung SM-S938B real
con datos de producción: **todos PASS**, sin `FATAL EXCEPTION` ni errores
de `Capacitor/Console`.

**Prueba obligatoria pendiente de Fase 1 completada:** offline real con
`dist` — app abierta online, modo avión, cierre completo, reapertura
offline (shell cargó desde el precache de `sw.js`, sin modificar), login y
navegación offline (Turno/Equipos/estados/Matriz/Anomalías) con datos ya
guardados localmente: **PASS**. Confirma que `sw.js` funciona igual de
bien sirviendo contenido de `dist/` que de `www/`.

`npm test`: 125/125 PASS, sin cambios. Rollback a `www` documentado (3
pasos: restaurar `webDir`, `cap sync`, rebuild) pero no ejecutado — no
hizo falta. Ver `docs/VITE_MIGRATION.md` (sección Fase 2) para el detalle
completo.
