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

## FASE VITE 3 — Validar `dist` para GitHub Pages
**Estado:** COMPLETADA — LISTA PARA PUBLICAR, NO PUBLICADA (2026-09-23)

Configuración remota reconstruida de documentación local existente (sin
duplicar análisis): repo de usuario
`github.com/junivalles-cmd/junivalles-cmd.github.io`, servido en la raíz
de `https://junivalles-cmd.github.io/`, publicación manual (drag-and-drop
a la raíz del repo), sin GitHub Actions. **CONFIGURACIÓN REMOTA: NO
VERIFICADA** — este repositorio local no tiene ningún `remote` conectado
con ese repo; no se intentó ninguna conexión.

Inventario completo de `dist/` (28 archivos) confirmado: `.nojekyll`
(vacío, crítico para que GitHub Pages no oculte `.well-known/`),
`.well-known/assetlinks.json` (JSON válido, `package_name` correcto, sin
tocar el fingerprint), `manifest.json` (íconos existentes), `sw.js` (sus
24 rutas de `ASSETS` resuelven en `dist/`, scope raíz correcto para un
dominio de usuario), `OneSignalSDKWorker.js`, los 6 `src/core/*.js`, y
confirmado que `index.html` no vuelve a cargar el SDK Web de OneSignal de
forma incondicional (no reapareció `NOTIF-ANDROID-001`). Ninguna ruta
absoluta de raíz (`/algo`) en ningún archivo — `base: './'` (ya
configurado desde la Fase 1) confirmado correcto para este dominio de
usuario, decisión documentada en vez de cambiada sin necesidad.

`npm run preview` sobre `dist/`: 20 recursos, 200 en todos, 0 errores
404. Pruebas manuales en navegador real (WEB-VITE-01 a 13: carga, login,
las 8 pantallas principales, Service Worker, manifest/íconos, sin
errores de consola) y la prueba offline obligatoria (Service Worker
activo → modo offline del navegador → recarga → shell y módulos
`src/core/` siguen disponibles) — **ambas validadas por el usuario, todo
PASS**, no automatizadas por falta de herramienta de navegador en esta
sesión pero tampoco inventadas.

Comparación fuente vs. `dist`: 27/28 archivos idénticos byte a byte, solo
`index.html` difiere de forma cosmética (ya documentado desde la Fase
1) — sin diferencias de comportamiento en Service Worker, manifest,
OneSignal, App Links ni módulos.

Nuevo: `npm run verify:dist` (`tools/verify-dist.mjs`, reutiliza
`computeRuntimeFileSet()`, sin duplicar lógica) y `npm run build:web`
(`test && build && verify:dist` encadenados) — proceso de despliegue
reproducible sin GitHub Actions, documentado paso a paso en el nuevo
`docs/WEB_DEPLOYMENT.md` (incluye rollback). El verificador se probó
contra un fallo real (se quitó `.nojekyll` temporalmente): detectó el
problema y falló con código de salida 1, como se esperaba.

`npm test`: 125/125 PASS. **No se publicó nada** — ni `git push`, ni
subida a `junivalles-cmd.github.io`, ni cambios en GitHub Pages. Android
sigue usando `dist` sin cambios (`capacitor.config.json` no se tocó en
esta fase). `www`, `tools/sync-web-to-android.mjs`, Supabase, IndexedDB,
`sync.js`: sin modificar.

## FASE VITE 4 — Primer despliegue controlado a GitHub Pages
**Estado:** COMPLETADA Y VALIDADA EN PRODUCCIÓN (2026-09-23)

Primer deploy real de `dist/` a producción, sobre el repositorio de
Project Page `github.com/junivalles-cmd/control-engrase-openpit`
(`https://junivalles-cmd.github.io/control-engrase-openpit/`) — la
Fase 3 tenía la configuración remota desactualizada (asumía un User
Page en la raíz); se detuvo y se pidió la configuración real en vez de
adivinar. `base: './'` confirmado como la única opción correcta para
un Project Page. Commit `d52d43d` sobre el repo de Pages, 16/16 URLs de
producción con 200, `PROD-WEB-01` a `10` + offline: todos **PASS**
validados por el usuario. Dos hallazgos nuevos registrados (ninguno
causado por el deploy): `APP-LINKS-001` (P2, arquitectónico) y
`MATRIZ-DOMINGO-001` (P3, preexistente). Ver `docs/VITE_MIGRATION.md`
(Fase 4) y `docs/BUG_REGISTER.md` para el detalle completo.

## FASE VITE 5 — Retiro controlado del flujo legacy `www`
**Estado:** COMPLETADA (2026-09-23)

Checkpoint: tag local `pre-remove-legacy-www` → commit `492e05d` (sin
push). Auditoría completa (sin modificar nada primero) confirmó que ni
`CONTROL_ENGRASE_APP_ANDROID/www` ni `tools/sync-web-to-android.mjs`
participaban ya en ningún flujo activo (`capacitor.config.json` usa
`webDir: "../dist"` desde la Fase 2; ningún script de `npm test`/`build`/
`build:web`/`dev`/`preview`/`verify:dist` los importa o ejecuta). `www`
solo contenía 27 archivos idénticos por hash a `dist` (más `index.html`
con la diferencia cosmética ya conocida) y 2 sobrantes no-runtime
(`schema.sql`, `icon-180.png`) — nada se copió de `www` a `dist`.

Retirados del repositorio: `tools/sync-web-to-android.mjs` y
`CONTROL_ENGRASE_APP_ANDROID/www` (29 archivos), recuperables vía Git
(`git checkout pre-remove-legacy-www -- ...`). `android/app/src/main/assets/public`
no se tocó — sigue siendo generado solo por Capacitor.

Prueba crítica: `dist/` borrado y reconstruido desde cero (`npm run
build:web`, 125/125 tests + build + `verify:dist`, todo PASS) **sin que
`www` existiera en disco**. `npx cap sync android` confirmó por su
salida que copia desde `dist`, sin errores por la ausencia de `www`.
`./gradlew assembleDebug`: **BUILD SUCCESSFUL**; verificado por hash que
`assets/public/index.html` del APK coincide con `dist/index.html`.
`npm run preview`: 19/19 recursos con 200. `dist` no cambió respecto a
la Fase 4 (fuente y `vite.config.js` sin tocar) — **no se publicó ningún
redeploy**. `npm test` final: 125/125 PASS.

**Android real y offline: NO PROBADO** — Samsung no conectado durante
esta fase (`adb devices` sin dispositivos), marcado honestamente como
pendiente en vez de asumido. Sin cambios en Supabase, IndexedDB,
`sync.js`, Service Worker, `AndroidManifest.xml` ni fingerprints.
Arquitectura final: `CONTROL_ENGRASE_WEB` → Vite → `dist/` → (GitHub
Pages + Capacitor/Android), única salida runtime. Ver
`docs/VITE_MIGRATION.md` (Fase 5) para el detalle completo, incluida la
auditoría archivo por archivo y el plan de rollback en tres niveles.

## TYPESCRIPT FASE 1 — Preparación segura (infraestructura, sin conversión masiva)
**Estado:** COMPLETADA (2026-09-23)

Checkpoint: tag local `pre-typescript-stable` → commit `a284e5c` (sin
push). `typescript@^7.0.2` instalado como única `devDependency` nueva
(`npm audit --omit=dev`: 0 vulnerabilidades). `tsconfig.json` con
`allowJs: true`, `checkJs: false` (opt-in por archivo vía
`// @ts-check`), `noEmit: true`, `strict: true`, `include` acotado a
`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\src\**` — deja fuera
`app.js`/`db.js`/`sync.js` a propósito. Nuevo `npm run typecheck`
(`tsc --noEmit`), sin tocar `test`/`build`/`build:web`/`verify:dist`.
Línea base: **0 errores** (estrategia de opt-in evitó "cientos de
errores inútiles" sin usar `// @ts-ignore`).

Mapa de dependencias completo de los 6 módulos de `src/core/`
(exports, dependencias globales, tests, riesgo) documentado en
`docs/TYPESCRIPT_MIGRATION.md`. Tipos del dominio creados como
declaraciones puras (`src/types/lubrication.ts`, `src/types/shift.ts`),
derivados de objetos reales del código — no referenciados desde
`index.html`, por lo que Vite nunca los procesa ni los copia a `dist/`
(confirmado sin cambios en el inventario tras `build:web`).

**Hallazgo crítico, verificado empíricamente en un proyecto Vite
aislado (no en el repo real):** un `<script src="archivo.ts">` clásico
se comporta igual que un `.js` clásico en Vite — no se bundlea NI se
copia a `dist/`. Renombrar cualquier `src/core/*.js` a `.ts`
manteniéndolo como script clásico dejaría al navegador recibiendo
sintaxis TypeScript real vía `<script src="...">` → `SyntaxError`
inmediato. Segundo bloqueo independiente: el arnés de tests
(`tests/helpers/extractFromSource.js`) evalúa texto fuente crudo con
`new Function(...)`, incompatible con sintaxis TS real. Por la regla
explícita del pedido ("si no puedes garantizar la ruta, no migres
todavía"), **no se renombró ningún archivo productivo a `.ts`** esta
fase.

En su lugar: `src/core/hourmeter.js` (elegido tras comparar
técnicamente contra `shifts.js` — menor superficie de dependencias,
cero declaraciones ambient necesarias) recibió `// @ts-check` + JSDoc
tipado (unión discriminada para el resultado de
`validateHourmeterChange()`), **sin cambiar su extensión ni una sola
línea de lógica**. `npm run typecheck`: PASS, 0 errores bajo `strict:
true`. `npm test`: 125/125 PASS sin cambios (el arnés de extracción
sigue funcionando idéntico). `npm run build:web`: PASS;
`dist/src/core/hourmeter.js` idéntico por hash a la fuente, misma ruta
estable. `npx cap sync android` + `./gradlew assembleDebug`: **BUILD
SUCCESSFUL**; verificado por hash que el APK contiene el
`hourmeter.js` correcto. **Android real: NO PROBADO** (Samsung no
conectado). Sin cambios en Supabase, IndexedDB, `sync.js`, Service
Worker. Ver `docs/TYPESCRIPT_MIGRATION.md` para el detalle completo,
incluida la estrategia recomendada para Fase 2 (orden de módulos
siguientes y los dos caminos posibles para resolver la conversión real
de extensión).

## UI/RESPONSIVE FASE 1 — Auditoría (sin corregir)
**Estado:** COMPLETADA (2026-09-23)

Playwright (7 resoluciones: 360/390/412/768/1024/1366/1920) + Stylelint
instalados como tooling de auditoría — sin Tailwind/Bootstrap/Material
UI/React/Vue/Angular. Solo se automatizó la pantalla de login (pública,
sin autenticación) — el resto de pantallas requiere PIN real de
producción, sin credenciales de prueba seguras en este entorno; se
marcaron **REQUIERE VALIDACIÓN MANUAL** en vez de inventar un PASS.
Stylelint: línea base 595 errores/16 reglas (bare `stylelint-config-
standard`) clasificados uno por uno → 0 errores, 56 warnings no
bloqueantes tras configuración controlada (sin `--fix`).

Hallazgos: **P1=0, P2=0, P3=5** — el más relevante, `UI-ANDROID-005`
(causa raíz confirmada: densidad de información, no overflow) y un
comportamiento no monótono de `.kpi-grid` (`UI-RESP-003`, 2→4→3→6
columnas al aumentar el ancho). También se encontró que el sistema ya
tenía una base de accesibilidad/responsive más madura de lo asumido
(touch targets de 44px, escalas `--sp-*`/`--fs-*`) aunque estas últimas
casi sin adoptar en la práctica (0 y 6 usos reales respectivamente,
clasificado como deuda técnica CSS, no bug). Ver `docs/UI_RESPONSIVE.md`
(Fase 1) para el detalle completo, incluida la tabla de hallazgos.

## UI/RESPONSIVE FASE 2 — Correcciones dirigidas
**Estado:** CORREGIDO, VALIDADO VISUALMENTE, PASS (2026-09-23)

Dos correcciones puntuales sobre los únicos hallazgos accionables de la
Fase 1 (P1=0, P2=0) — sin refactorización general de `styles.css`, sin
tocar Lubricador, formularios, Matriz Semanal, lógica de negocio,
TypeScript, ni los 56 warnings de Stylelint/22 `@media`/`--sp-*`/
`--fs-*` clasificados como deuda técnica CSS.

**`UI-ANDROID-005`:** de las 9 columnas del panel "Equipos que
requieren atención" del Dashboard, se priorizaron 4 (Estado, Código,
Equipo, Restante/Atraso) como siempre visibles y se marcaron 5 como
`class="col-secondary"` (Turno, Control, Horómetro, Próximo/Día
asignado, Días sin engrase), ocultas solo en la tarjeta móvil
(`≤680px`). Desktop conserva las 9 columnas sin cambios. Sin
`overflow-x: auto`, sin `nth-child` — clases semánticas, sin tocar el
mecanismo genérico `data-label` que comparten otras tablas (Historial,
Reportes, Usuarios). Efecto colateral (borde inferior huérfano en la
última celda visible) corregido con una regla CSS genérica adicional.

**`.kpi-grid` (`UI-RESP-003`):** progresión de columnas corregida de no
monótona (2→4→3→6) a monótona (2→2→3→4→6), usando los mismos 3
breakpoints que ya existían (600/900/1100 — ninguno nuevo), eliminando
la declaración duplicada que causaba el comportamiento dependiente del
orden del archivo.

Verificación: dos specs nuevos de Playwright sin requerir login
(`tests/ui/kpi-grid.spec.js`, `tests/ui/dashboard-table-density.spec.js`
— fragmentos estáticos con la estructura/clases REALES contra el
`styles.css` real, nunca datos de producción) — **21/21 PASS** (suite
completa, 3 specs × 7 resoluciones). `npm run lint:css`: 0 errores, 56
warnings (idénticos a la Fase 1, ninguno nuevo). `npm test`: 125/125
PASS. `npm run typecheck`: PASS. `npm run build:web`: PASS. `npm run
preview`: sin 404, sin errores JS, login visible. `npx cap sync android`
+ `./gradlew assembleDebug`: **BUILD SUCCESSFUL**. **Android real: NO
PROBADO** (Samsung no conectado). Sin cambios en Supabase, IndexedDB,
`sync.js`, Service Worker, lógica de negocio.

**`UI-MANUAL-01` (Dashboard móvil): PASS confirmado por el usuario.**
768px/1366px verificados sin regresión vía la suite automatizada (ya
cubrían esas 2 resoluciones explícitamente). **`UI-ANDROID-005`:
CORREGIDO, VALIDADO VISUALMENTE, PASS** — cerrado en
`docs/BUG_REGISTER.md`. Ver `docs/UI_RESPONSIVE.md` (Fase 2) para el
detalle completo, incluida la tabla de priorización de columnas.

## UI/RESPONSIVE FASE 3 — Experiencia del Lubricador
**Estado:** CORREGIDO EN CÓDIGO, PENDIENTE DE VALIDACIÓN MANUAL EN DISPOSITIVO (2026-09-23)

Tres mejoras puntuales pedidas por el usuario, propuestas primero
(tabla de columnas/campos reales) y aprobadas antes de tocar código —
sin lógica de negocio, IndexedDB, Supabase, `sync.js`, TypeScript ni
Service Worker.

**Mi Turno:** inset lateral acumulado (medido con Playwright antes de
proponer nada) 36px → 30px por lado — `.lub-content`/`.lub-eq-btn`/
`.lub-anomaly-fab` pasan su padding lateral a `var(--sp-3)`, sin tocar
el vertical (ningún área táctil se reduce).

**Ícono de equipo:** nuevo `.icon-hauler` (camión articulado minero,
decisión del usuario) en el mismo formato exacto que los 24 íconos ya
existentes — sin librería nueva. Validado por decodificación,
renderizado vía `mask-image` y a tamaños reales de uso antes de
integrarlo. Colocado en cada tarjeta de "Mi Turno".

**Registrar engrase:** los mismos campos (ningún campo nuevo/quitado/
reordenado en el `FormData`) agrupados en 4 secciones visuales
(Horómetro/Engrase/Evidencia/Finalizar). Botón "Finalizar engrase" más
prominente en móvil (52px vs. 44px base).

Verificación: dos specs Playwright nuevos sin login — **35/35 PASS**
(5 specs × 7 resoluciones, incluidas explícitamente 360/390/412/768/
1366). `npm test`: 125/125 PASS. `npm run typecheck`: PASS. `npm run
build:web`: PASS. `npm run lint:css`: 0 errores, 56 warnings (idéntico
a fases previas). `npx cap sync android` + `assembleDebug`: **BUILD
SUCCESSFUL**. Android real: **NO PROBADO** (Samsung no conectado).

**Pendiente validación manual en dispositivo real** — Ver
`docs/UI_RESPONSIVE.md` (Fase 3) para el detalle completo.
