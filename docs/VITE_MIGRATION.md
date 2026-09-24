# MIGRACIÓN A VITE

Rama: `migration-typescript`
Checkpoint previo a Vite: tag local `pre-vite-js-stable` → commit
`df69898` (Modularización JS Fase 2 completa, 125 tests).

# FASE 1 — BUILD PARALELO (SHADOW BUILD)

Fecha: 2026-09-23

## Objetivo de esta fase

Demostrar que Vite puede construir un `dist/` **funcionalmente equivalente**
al sistema actual, **sin sustituir nada todavía**:

- GitHub Pages sigue sirviendo `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` tal
  cual.
- Capacitor sigue usando `www` (`capacitor.config.json` no se tocó,
  `webDir` sigue siendo `"www"`).
- `tools/sync-web-to-android.mjs` sigue existiendo y funcionando igual.
- No se publicó nada, no se hizo push del tag ni de ningún cambio.
- No se migró nada a TypeScript.

`dist/` es un artefacto nuevo, generado localmente, que hoy no lo consume
ni GitHub Pages ni Capacitor ni ningún otro sistema — existe solo para
comprobar que Vite puede reproducirlo correctamente.

## 1. Arquitectura ANTES de esta fase

```
CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB   (fuente canónica, HTML/CSS/JS planos, sin build)
        │
        ├── tools/sync-web-to-android.mjs  →  CONTROL_ENGRASE_APP_ANDROID\www  →  npx cap sync android  →  APK
        │
        └── (se sube manualmente/vía Git a GitHub Pages, sin build)
```

`index.html` carga todo con `<script src="...">` clásicos (sin
`type="module"`), en un orden significativo: librerías CDN → `db.js` →
`sync.js` → `src/core/*.js` → `app.js`. Todos comparten el mismo entorno
léxico global del navegador (ver `docs/MODULARIZATION.md`).

## 2. Instalación de Vite

```
npm install --save-dev vite
```

Se agregó como **devDependency única** en el `package.json` **raíz**, el
mismo que ya tenía Vitest — no se creó ningún `package.json` adicional.
Versión instalada: **Vite 5.4.21**.

Scripts agregados (junto a los ya existentes `test`/`test:watch`):

```json
"dev": "vite",
"build": "vite build",
"preview": "vite preview"
```

## 3. Configuración (`vite.config.js`, raíz del repositorio)

```js
root: SRC_DIR,              // CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB, sin mover nada
base: './',                 // rutas relativas (necesario: GitHub Pages sirve el sitio bajo un subpath)
publicDir: false,           // el copiado real lo hace un plugin propio (ver §5)
build: { outDir: <repo>/dist, emptyOutDir: true }
```

- **root**: la fuente canónica actual, sin reorganizar a `src/`+`public/`
  (petición explícita de esta fase — ese patrón de Vite es el estándar,
  pero habría obligado a mover archivos que otros sistemas (GitHub Pages,
  `sync-web-to-android.mjs`) ya referencian por su ubicación actual).
- **outDir**: `C:\Users\Planificador\Documents\CONTROL_ENGRASE\dist` — fuera
  de `CONTROL_ENGRASE_WEB` y de `CONTROL_ENGRASE_APP_ANDROID`, para no
  arriesgar sobrescribir ninguno de los dos por accidente.
- **base: './'**: sin esto, Vite genera rutas absolutas (`/assets/...`),
  que romperían tanto GitHub Pages (si el sitio no está en la raíz del
  dominio) como la carga desde `file://`/WebView local.

## 4. Lo que Vite hace por defecto (comprobado empíricamente, no asumido)

Antes de escribir la configuración final se corrió un build "ingenuo"
(`root` + `base` únicamente, sin plugin) para observar el comportamiento
real de Vite contra este HTML, tal como pedía esta fase ("no asumas que
Vite los copiará automáticamente, compruébalo físicamente"). Resultado:

| Elemento | Comportamiento real observado |
|---|---|
| `<script src="app.js">` (sin `type="module"`) | Vite imprime una advertencia (`can't be bundled without type="module"`) y **deja el `<script>` tal cual en el HTML de salida** — no lo hashea, pero **tampoco copia el archivo** al que apunta. |
| `<link rel="manifest" href="manifest.json">` | Vite **sí** lo procesa: copia `manifest.json` a `assets/manifest-<hash>.json` y reescribe el `href` del HTML para apuntar ahí. |
| `<link rel="icon">` / `<link rel="apple-touch-icon">` | Igual que el manifest: se copian a `assets/` con nombre hasheado y el HTML se reescribe. |
| `<link rel="stylesheet" href="styles.css">` | Se procesa, minifica y hashea (`assets/index-<hash>.css`), como es estándar en Vite. |
| Archivos no referenciados en el HTML (`sw.js`, `OneSignalSDKWorker.js`, `.nojekyll`, `.well-known/assetlinks.json`, los demás íconos, `db.js`, `sync.js`, `src/core/*.js`) | **No se copian en absoluto** sin `publicDir` o un mecanismo explícito. |

**Conclusión del análisis:** el riesgo señalado en el PASO 8 del pedido
("Vite no puede generar nombres con hash que hagan imposible que sw.js
encuentre `src/core/*.js`") era real, pero el mecanismo exacto era otro:
Vite no hashea los scripts clásicos (los deja intactos), el problema real
es que (a) no los copia, y (b) SÍ hashea `manifest.json`/íconos/CSS, que
`sw.js` también necesita por nombre exacto.

## 5. Solución: `copyStableRuntimeFiles()` (plugin propio, sin dependencias nuevas)

En vez de reorganizar el proyecto a `public/` (fuera de alcance de esta
fase) o instalar un plugin de terceros, `vite.config.js` define un plugin
pequeño con el hook `closeBundle` de Vite que, después de cada build:

1. **Copia con nombre estable (sin hash)** exactamente el mismo *set*
   runtime que ya calcula `tools/sync-web-to-android.mjs` para Android —
   reutilizando su lógica (ver §6), no duplicándola.
2. **Reescribe** en `dist/index.html` las 4 referencias que Vite sí hasheó
   (`manifest.json`, `favicon.png`, `apple-touch-icon.png`, `styles.css`),
   de vuelta a su ruta relativa estable — que ya existe gracias al paso 1.
3. **Borra** `dist/assets/`, que a esta altura solo contiene los
   duplicados hasheados que quedaron huérfanos (nada más se genera ahí en
   esta fase, porque no hay ningún `<script type="module">` produciendo un
   chunk real todavía).

Resultado: `dist/index.html` termina con las mismas rutas relativas que la
fuente original (`./manifest.json`, `./styles.css`, `db.js`,
`src/core/shifts.js`, etc.), y cada archivo referenciado existe en
`dist/` con ese mismo nombre — compatible con el `sw.js` actual sin
tocarlo.

## 6. Reutilización de `tools/sync-web-to-android.mjs` (sin duplicar lógica)

`computeRuntimeFileSet()` — la función que decide qué archivos son
"runtime" (allowlist derivada de `index.html`/`manifest.json`/`sw.js`, más
un denylist de `.md`/`.pdf`/`.sql`/`.txt`/`supabase/`) — vivía como función
interna de `tools/sync-web-to-android.mjs`.

**Problema encontrado:** ese archivo empieza con `#!/usr/bin/env node` (el
*shebang* que le permite ejecutarse como `./tools/sync-web-to-android.mjs`
en sistemas Unix). Cuando `vite.config.js` intentó importarlo directamente,
esbuild (el motor que usa Vite para cargar su propia configuración) falló
con `Syntax error "!"` — no tolera un shebang en un archivo importado por
otro módulo.

**Solución:** se extrajo `computeRuntimeFileSet()` y sus funciones
auxiliares (`toPosix`, `readTextIfExists`, `extractLocalRefsFromHtml`,
`extractLocalIconsFromManifest`, `extractLocalAssetsFromServiceWorker`,
`FIXED_CORE_FILES`, `NEVER_SYNC_PATTERNS`, `SRC_DIR`) a un módulo nuevo,
**sin shebang**: `tools/runtime-file-set.mjs`. `sync-web-to-android.mjs`
ahora importa de ahí en vez de definir su propia copia — comportamiento
idéntico, verificado con un dry-run antes/después (mismo resultado exacto:
27 archivos runtime detectados, mismo listado). `vite.config.js` importa
del mismo módulo nuevo. **Una sola implementación**, dos consumidores.

## 7. Archivos especiales — verificados físicamente en `dist/`

| Archivo | ¿En dist? | Cómo llegó |
|---|---|---|
| `.nojekyll` | Sí | Copia estable (§5.1) |
| `.well-known/assetlinks.json` | Sí | Copia estable |
| `manifest.json` | Sí, sin hash | Copia estable + href reescrito |
| `sw.js` | Sí | Copia estable |
| `OneSignalSDKWorker.js` | Sí | Copia estable |
| Los 10 íconos (`icon-*.png`, `icon-maskable-*.png`) | Sí | Copia estable |
| `favicon.png` / `apple-touch-icon.png` | Sí, sin hash | Copia estable + href reescrito |
| `styles.css` | Sí, sin hash (sin minificar en esta fase) | Copia estable + href reescrito |
| `app.js`, `db.js`, `sync.js`, `src/core/*.js` (6 archivos) | Sí, sin cambios | Copia estable |

Confirmado con `cmp` byte a byte contra la fuente: **los 27 archivos
runtime copiados son idénticos, sin ninguna diferencia** (ver §9).

## 8. Service Worker

**No se tocó `sw.js`.** Se analizaron las rutas que precachea (`ASSETS`,
ver `docs/MODULARIZATION.md`/`docs/DECISIONS.md`) y se confirmó que, tras
el paso 5, todas existen en `dist/` con el mismo nombre relativo que
`sw.js` espera (`./index.html`, `./styles.css`, `./app.js`, `./db.js`,
`./sync.js`, `./manifest.json`, los 6 `./src/core/*.js`, los íconos). No
se introdujo Workbox ni ningún plugin PWA — decisión explícita de esta
fase, documentada aquí para la fase siguiente.

## 9. Scripts JavaScript: se mantienen clásicos (sin ES modules)

Los 9 `<script src="...">` de `index.html` (6 CDN + `db.js`/`sync.js`/
`app.js`, más los 6 `src/core/*.js`) **siguen siendo scripts clásicos**,
sin `type="module"`, sin `export`/`import`. No se convirtió nada a ES
modules en esta fase — el objetivo era un **build equivalente**, no una
modernización. Vite los deja pasar sin procesarlos (ver §4); la copia
estable (§5) se encarga de que el archivo exista en `dist/`.

Esto es una decisión temporal, documentada: una futura Fase Vite 2/3
podría evaluar convertir estos scripts a módulos ES nativos para que Vite
los bundlee de verdad (tree-shaking, un solo archivo de salida, etc.), pero
eso es un cambio de arquitectura mayor, fuera de alcance aquí.

## 10. Primer build — inventario

```
npm run build
```

**Resultado: PASS.** `dist/` contiene, tras el post-procesado del plugin:

```
dist/
├── .nojekyll
├── .well-known/assetlinks.json
├── OneSignalSDKWorker.js
├── app.js
├── apple-touch-icon.png
├── db.js
├── favicon.png
├── icon-{72,96,128,144,152,192,384,512}.png
├── icon-maskable-{192,512}.png
├── index.html
├── manifest.json
├── src/core/{shifts,hourmeter,lubrication-status,anomalies,anomaly-actions,weekly-matrix}.js
├── styles.css
└── sw.js
```

27 archivos — el mismo número y los mismos nombres relativos que calcula
`computeRuntimeFileSet()` sobre la fuente (menos `index.html`, que Vite
procesa aparte). **Sin carpeta `assets/`** (se borró tras rescatar/
reescribir las 4 referencias que Vite había hasheado).

## 11-12. Validación de `dist` y comparación funcional contra la fuente

- **Sintaxis**: no aplica un `node --check` nuevo — son los mismos bytes
  que ya pasaron esa validación en la fuente (ver §13 sobre por qué no se
  volvieron a analizar).
- **Comparación byte a byte** (`cmp`) de los 27 archivos runtime
  copiados con nombre estable contra su original en
  `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`: **0 diferencias**.
- **`dist/index.html` vs. fuente** (`diff`): la única diferencia es
  cosmética — Vite:
  - normalizó `href="manifest.json"` → `href="./manifest.json"` (y lo
    mismo para favicon/apple-touch-icon) — equivalente, ambas son rutas
    relativas al mismo archivo;
  - agregó el atributo `crossorigin` al `<link rel="stylesheet">` — no
    tiene efecto para una hoja de estilos del mismo origen;
  - movió el `<link rel="stylesheet">` de su posición original (antes de
    los `<script>` de CDN) a justo antes de `</head>` — sigue estando
    dentro de `<head>`, sin efecto funcional (CSS y los `<script>` de CDN
    no dependen entre sí en este documento).
  - El orden y contenido de TODOS los `<script src="...">` (CDN, `db.js`,
    `sync.js`, los 6 `src/core/*.js`, `app.js`) es **idéntico**, igual que
    los comentarios explicativos.
- **Rutas / App Links**: `.well-known/assetlinks.json` idéntico byte a
  byte — sin impacto en la verificación de Android App Links (que de
  todas formas no aplica a este `dist/` porque no se usa desde Android en
  esta fase).

## 13. Pruebas automatizadas

```
npm test
```

**125/125 PASS**, sin cambios — ningún test se modificó ni necesitó
modificarse. Las pruebas leen el código fuente directamente desde
`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` (ver
`docs/AUTOMATED_TESTS.md`), no desde `dist/`, así que introducir Vite no
las afecta — es exactamente la garantía que se buscaba con la separación
"fuente canónica primero, `dist/` como artefacto derivado".

## 14. `npm run dev`

**PASS.** Arrancó el servidor de desarrollo de Vite sobre la fuente
canónica (sin pasar por `dist/`) y se comprobó por HTTP que sirve
correctamente `index.html`, `app.js`, `manifest.json`, `sw.js` y
`src/core/weekly-matrix.js` (todos `200`, con el proceso detenido después
de la comprobación).

## 15. `npm run preview` (sirve `dist/` por HTTP)

**PASS.** Se comprobó por HTTP (`curl`) cada recurso runtime — **0
errores 404**, ningún error de ruta: `index.html`, `app.js`, `db.js`,
`sync.js`, `manifest.json`, `sw.js`, `OneSignalSDKWorker.js`, `.nojekyll`,
`.well-known/assetlinks.json`, `styles.css`, `favicon.png`,
`apple-touch-icon.png`, `icon-192.png`, los 6 `src/core/*.js`. Tipos de
contenido (`Content-Type`) correctos (`text/javascript`,
`application/json`).

**Limitación honesta:** esto confirma que los archivos SE SIRVEN
correctamente por HTTP — no confirma que la aplicación se ejecute sin
errores de JavaScript en un navegador real (eso requeriría abrir la
página e inspeccionar la consola). No hay herramienta de automatización
de navegador disponible en esta sesión (extensión Claude en Chrome
declinada previamente por el usuario) — igual que en `NOTIF-ANDROID-001`,
esto se marca honestamente como **NO PROBADO** en vez de asumirse.

## Riesgos y rollback

**Riesgos identificados:**
- El plugin `copyStableRuntimeFiles()` depende de que `computeRuntimeFileSet()`
  siga reflejando correctamente el set runtime real — si `index.html`
  cambia y se agrega una referencia nueva sin que `sw.js`/manifest la
  mencionen también, el mecanismo de detección (idéntico al que ya usa
  `sync-web-to-android.mjs`) podría no recogerla. Mismo riesgo que ya
  existía antes de Vite, no es nuevo.
- Los scripts clásicos (`db.js`/`sync.js`/`app.js`/`src/core/*.js`) no
  pasan por ningún análisis de Vite (ni siquiera se transforman) — Vite
  solo los "deja pasar". Esto es intencional en esta fase, pero significa
  que Vite todavía no aporta detección de errores en ese código.
- `npm run dev`/`preview` no se probaron con interacción real de usuario
  (login, navegación, IndexedDB) — solo a nivel HTTP. La validación
  funcional real de la app seguirá dependiendo de abrir
  `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\index.html` directamente o del
  dispositivo Android, como hasta ahora.
- La prueba offline del build Vite (PASO 15) no se pudo hacer (sin
  herramienta de navegador) — queda como pendiente honesto, no bloqueante
  para esta fase (`sw.js` no cambió, y ya está validado offline sobre la
  fuente canónica, ver `docs/TEST_MATRIX.md`).

**Rollback:** trivial y de bajo riesgo, porque nada productivo cambió:
- `git tag pre-vite-js-stable` marca el commit exacto previo a esta fase.
- `dist/` es un directorio generado, no versionado (ver `.gitignore`) —
  borrarlo no tiene ningún efecto sobre GitHub Pages, Capacitor ni
  `www`.
- Si se decide no continuar con Vite: `git reset --hard pre-vite-js-stable`
  (o simplemente dejar de ejecutar `npm run build`) deja el repositorio
  exactamente como estaba, sin ningún cambio en producción, Android o
  Supabase en ningún momento de esta fase.

## Qué NO se hizo en esta fase (a propósito)

Migrar a TypeScript; cambiar `webDir` a `dist`; reemplazar `www`; eliminar
`tools/sync-web-to-android.mjs`; publicar GitHub Pages desde `dist`; mover
código a `src/`; reescribir `app.js`; reescribir el Service Worker; usar un
plugin PWA/Workbox; convertir los scripts clásicos a ES modules; tocar
Supabase/IndexedDB/Auth/RLS; corregir `UI-ANDROID-005` o
`ANDROID-DOZE-001`; agregar funcionalidades nuevas.

# FASE 2 — `dist` → CAPACITOR → ANDROID

Fecha: 2026-09-23
Commit Fase 1: `a7591de`.

## Objetivo de esta fase

Demostrar que `dist/` (generado por Vite) funciona como `webDir` real de
Capacitor, de punta a punta hasta un APK instalado en el Samsung SM-S938B
real — **sin eliminar el camino anterior todavía**:

- `CONTROL_ENGRASE_APP_ANDROID\www` NO se borró — queda como *fallback*.
- `tools/sync-web-to-android.mjs` NO se borró ni se tocó su lógica — queda
  como *fallback*, y de hecho **no intervino en ningún paso de esta fase**
  (confirmado con `git status`: `CONTROL_ENGRASE_APP_ANDROID/www` sin
  cambios en todo el flujo `npm run build` → `npx cap sync android` →
  `assembleDebug` → `adb install -r`).
- GitHub Pages no se tocó, no se publicó nada.
- No se migró nada a TypeScript.

## Arquitectura DESPUÉS de esta fase

```
CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB   (fuente canónica, sin cambios)
        │
        └── npm run build (Vite)  →  dist/  →  npx cap sync android  →  assets/public  →  APK
```

```
FALLBACK TEMPORAL (no eliminado, no usado por el flujo activo):
CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB → tools/sync-web-to-android.mjs → www → (requeriría volver webDir a "www")
```

## `webDir`: de `"www"` a `"../dist"`

**No se asumió la ruta relativa.** Se verificó en el código fuente de
`@capacitor/cli` (`node_modules/@capacitor/cli/dist/config.js`) cómo
Capacitor resuelve `webDir`:

```js
const appRootDir = process.cwd();
...
webDirAbs: path.resolve(appRootDir, webDir)
```

`appRootDir` es el directorio de trabajo desde el que se ejecuta `cap` —
en este proyecto, siempre `CONTROL_ENGRASE_APP_ANDROID` (donde vive
`capacitor.config.json`). Se confirmó con `node -e "console.log(path.resolve(process.cwd(), '../dist'))"`
ejecutado desde ahí, que arroja exactamente
`C:\Users\Planificador\Documents\CONTROL_ENGRASE\dist`.

`capacitor.config.json`:
```diff
- "webDir": "www",
+ "webDir": "../dist",
```

## Comparación `dist` vs `www` (antes del cambio)

Se comparó el set runtime completo (28 archivos, mismo cálculo de
`computeRuntimeFileSet()`) entre `dist/` y `www/`:

| Resultado | Cantidad |
|---|---|
| Idénticos (hash SHA-256) | 27 |
| Diferentes | 1 (`index.html` — normalizaciones cosméticas de Vite, ver Fase 1 §12) |
| Faltantes en `dist` | 0 |
| Faltantes en `www` | 0 |

`www` tiene 2 archivos sobrantes históricos (`icon-180.png`, `schema.sql`)
que **no** forman parte del set runtime calculado — a propósito, **no se
copiaron a `dist`** solo para igualar carpetas (habría sido inventar una
necesidad que no existe; ninguno de los dos aparece en `index.html`,
`manifest.json` ni `sw.js`).

## `npx cap sync android` usa `dist`, no `www`

Confirmado por la salida del propio comando:
```
√ Copying web assets from dist to android\app\src\main\assets\public in 177.83ms
```
(antes decía `from www`).

## Verificación por hash: Android usa `dist`

Los 16 archivos runtime clave (`index.html`, `app.js`, `db.js`, `sync.js`,
`styles.css`, `sw.js`, `manifest.json`, `OneSignalSDKWorker.js`,
`.nojekyll`, `.well-known/assetlinks.json`, los 6 `src/core/*.js`) en
`android/app/src/main/assets/public` son **idénticos byte a byte** a los
de `dist/` (`cmp`). Como control adicional, `assets/public/index.html`
**difiere** de `www/index.html` (línea 8, distinto por el `href`
normalizado de Vite) — confirma que el contenido vino de `dist`, no de
`www`.

## Android build

`./gradlew assembleDebug`: **PASS**.

## Prueba objetiva de que el APK instalado viene de `dist` (sin texto de debug)

En vez de agregar cualquier indicador visible en la UI, se verificó por
hash criptográfico en dos niveles:

1. El `.apk` generado localmente (`app-debug.apk`) contiene
   `assets/public/index.html` con SHA-256 `b928bd94...`, **idéntico** al
   de `dist/index.html`, y **distinto** al de `www/index.html`
   (`00f23cd6...`).
2. Se extrajo el APK **realmente instalado en el dispositivo**
   (`adb shell pm path` → `adb pull` del `base.apk` real) y se repitió la
   misma verificación: `assets/public/index.html` dentro del APK
   instalado tiene el mismo hash `b928bd94...` — prueba objetiva, a nivel
   de dispositivo, de que la app que se va a probar corre sobre el
   contenido de `dist`.

## `adb install -r` — datos conservados

`firstInstallTime` sin cambios antes/después de la instalación
(`2026-09-23 09:47:08`) — mismos datos locales (IndexedDB) preservados, sin
`adb uninstall` ni `pm clear`.

## Smoke test Android real (A01–A10)

Validado manualmente por el usuario en el Samsung SM-S938B real, con datos
de producción reales (sin datos ficticios): app abre, login, Dashboard,
Turno, Equipos, estados de engrase, Matriz Semanal, Anomalías, Historial y
Reportes — **todos PASS**. Logcat sin `FATAL EXCEPTION`, sin errores de
`Capacitor/Console`, sin solicitudes locales fallidas (`Handling local
request` para los 6 `src/core/*.js` y el resto del set, todas exitosas).

## Offline real con `dist` (obligatorio — quedaba pendiente de Fase 1)

Fase 1 había dejado "OFFLINE BUILD VITE = NO PROBADO" por falta de
herramienta de navegador. En Android real sí se pudo probar de punta a
punta:

1. App abierta con internet, navegación por varias pantallas — `SINCRONIZADO`.
2. Modo avión activado (confirmado: ícono de avión, Wi-Fi deshabilitado).
3. App cerrada por completo (`am force-stop`, proceso confirmado terminado).
4. Reabierta offline: shell cargó normalmente (ícono, textos, estilos
   intactos), sin errores en logcat.
5. Usuario confirmó, offline: login, Turno, Equipos, estados de engrase,
   Matriz Semanal y Anomalías — todos con los datos ya guardados
   localmente, **todos PASS**, sin registrar datos nuevos.
6. Vuelta a modo online al finalizar.

**OFFLINE DIST: PASS.** Confirma que `sw.js` (sin modificar en ninguna de
las dos fases de Vite) sigue precacheando correctamente el shell y los 6
módulos de `src/core/` cuando estos provienen de `dist/` en vez de `www/`.

## `www` no interviene en el nuevo flujo

Confirmado con `git status --short CONTROL_ENGRASE_APP_ANDROID/www` antes
y después de todo el flujo (`npm run build` → `npx cap sync android` →
`assembleDebug` → `adb install -r`): **sin cambios**. No se ejecutó
`tools/sync-web-to-android.mjs` en ningún punto de esta fase.

## Rollback documentado (no ejecutado)

Si `dist` fallara y hubiera que volver a `www`:

1. Restaurar `capacitor.config.json`: `"webDir": "www"` (revertir el
   único archivo que cambió esta fase, o `git checkout` sobre el commit
   anterior a esta fase).
2. `npx cap sync android` (vuelve a copiar desde `www`, que nunca se dejó
   de mantener actualizado).
3. `./gradlew assembleDebug` (o `clean` + `assembleDebug` si hay
   artefactos viejos).

Tres pasos, sin tocar Supabase/IndexedDB/datos del dispositivo — el mismo
nivel de riesgo que cualquier otro rebuild ya practicado en este proyecto.

## Pruebas automatizadas

`npm test`: **125/125 PASS**, sin cambios — las pruebas siguen leyendo
directamente de `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`, no de `dist/`.

## Qué NO se hizo en esta fase (a propósito)

Borrar `www`; borrar `tools/sync-web-to-android.mjs`; publicar `dist` en
GitHub Pages; cambiar el repositorio remoto; migrar a TypeScript;
reorganizar el proyecto a `src/`+`public/`; tocar Supabase/IndexedDB/
`sync.js`/Auth/RLS; corregir `UI-ANDROID-005` o `ANDROID-DOZE-001`;
agregar funcionalidades nuevas.

## Siguiente fase natural (histórico — ver FASE 3 abajo)

Fase Vite 3: validar `dist` como fuente también para GitHub Pages, y
evaluar convertir `dist` en la única salida Web + Android (momento en el
que `www` y `tools/sync-web-to-android.mjs` dejarían de ser necesarios) —
**no iniciada todavía**, pendiente de aprobación explícita.

# FASE 3 — VALIDAR `dist` PARA GITHUB PAGES

Fecha: 2026-09-23
Commit Fase 2: `c1edcd8`.

## Objetivo de esta fase

Dejar `dist/` **listo para publicarse** como sitio Web en GitHub Pages —
validado, verificado y documentado — **sin publicar nada todavía**. Ver
`docs/WEB_DEPLOYMENT.md` para el procedimiento paso a paso de cuando se
decida publicar.

## Configuración remota de GitHub Pages actual

Reconstruida a partir de documentación local ya existente
(`README_SUBIR_A_GITHUB.txt`, `GUIA_COMPLETA_INSTALACION.md`,
`ESTADO_DEL_PROYECTO.md`, `docs/PLAN_UNIFICACION_WEB_ANDROID.md`) — no se
duplicó el análisis, se reutilizó:

- **Repositorio:** `github.com/junivalles-cmd/junivalles-cmd.github.io`
  (repo de GitHub Pages de **usuario**, no de proyecto).
- **Dominio:** `https://junivalles-cmd.github.io/` — sin dominio propio
  (no hay `CNAME`), se sirve en la **raíz** del subdominio por defecto.
- **Publicación:** manual, arrastrando TODO el contenido de la carpeta
  fuente a la raíz del repositorio remoto (rama `main`, carpeta `/ (root)`
  en Settings → Pages). No existe ningún workflow de GitHub Actions.
- **CONFIGURACIÓN REMOTA: NO VERIFICADA.** El repositorio Git local
  (`CONTROL_ENGRASE`) no tiene ningún `remote` conectado con
  `junivalles-cmd.github.io` — son dos repositorios completamente
  desacoplados hoy. No se hizo ningún `git remote`, `fetch` ni consulta a
  GitHub en esta fase ni en ninguna anterior.
- El host `junivalles-cmd.github.io` también está hardcodeado como
  `WEB_HOST` en `CONTROL_ENGRASE_APP_ANDROID/configure-applinks.js` y como
  `android:host` en `AndroidManifest.xml` — usado para Android App Links,
  coincide con lo anterior.

## Inventario de `dist/` (28 archivos)

| Categoría | Archivos |
|---|---|
| **Entrada Web** | `index.html` |
| **Crítico PWA** | `manifest.json`, `sw.js` |
| **Crítico App Links** | `.nojekyll`, `.well-known/assetlinks.json` |
| **JS (scripts clásicos)** | `app.js`, `db.js`, `sync.js`, `src/core/{shifts,hourmeter,lubrication-status,anomalies,anomaly-actions,weekly-matrix}.js` |
| **CSS** | `styles.css` |
| **OneSignal Web** | `OneSignalSDKWorker.js` |
| **Íconos/recursos** | `favicon.png`, `apple-touch-icon.png`, `icon-{72,96,128,144,152,192,384,512}.png`, `icon-maskable-{192,512}.png` |

Los 10 archivos "como mínimo" pedidos (`index.html`, `app.js`, `db.js`,
`sync.js`, `styles.css`, `sw.js`, `manifest.json`,
`OneSignalSDKWorker.js`, `.nojekyll`, `.well-known/assetlinks.json`) más
`src/core/*` (6): **todos presentes**, confirmado con
`npm run verify:dist` (ver más abajo).

## `.nojekyll`

Presente en `dist/.nojekyll`, 0 bytes (igual que la fuente), byte a byte
idéntico a `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\.nojekyll`. Crítico:
sin él, GitHub Pages procesa el sitio con Jekyll, que **ignora** carpetas
que empiezan con punto — `.well-known/` desaparecería del sitio
publicado y rompería la verificación de Android App Links (ya
documentado en `docs/PLAN_UNIFICACION_WEB_ANDROID.md`, sección 4).

## `.well-known/assetlinks.json`

- JSON válido (`JSON.parse` sin errores).
- `package_name: "com.conequisa.engraseopenpit"` — coincide con `appId`
  en `capacitor.config.json`.
- `sha256_cert_fingerprints` presente, **no se modificó**.
- Byte a byte idéntico a la fuente.
- Ruta exacta al desplegarse en la raíz del dominio:
  `https://junivalles-cmd.github.io/.well-known/assetlinks.json` (misma
  URL que ya documentaba `README_SUBIR_A_GITHUB.txt` para verificar
  manualmente tras publicar).

## Rutas y `base` de Vite

Se revisaron todas las referencias locales en `index.html`,
`manifest.json`, `styles.css` y `sw.js`: **ninguna usa una ruta absoluta
de raíz** (`/algo`) — todas son relativas (`./`, nombre de archivo plano)
o URLs completas `https://` (CDN, Google Fonts). Confirmado con grep
específico buscando `src="/` / `href="/"` — cero resultados.

**Decisión sobre `base`:** se mantiene `base: './'` (ya configurado desde
la Fase 1) — **no se cambió a `base: '/'`**, y esta vez con la
confirmación explícita (no solo por precaución) de que el sitio se sirve
en la **raíz** de un dominio de usuario (`junivalles-cmd.github.io/`, sin
subpath). En ese caso concreto, `base: './'` y `base: '/'` producen el
mismo resultado funcional al desplegarse — pero `'./'` sigue siendo la
opción más portable (también funcionaría si el sitio se sirviera algún
día bajo un subpath, por ejemplo para probarlo en otro entorno), sin
ningún costo adicional. Se documenta la decisión en vez de cambiarla sin
necesidad.

## Service Worker para GitHub Pages

- `sw.js` se registra con `navigator.serviceWorker.register('./sw.js')`
  (sin `scope` explícito en el registro) — el *scope* por defecto es el
  directorio donde vive `sw.js`, que al desplegar `dist/` en la raíz del
  dominio es la raíz completa (`/`) — coincide con que `ASSETS` liste
  todo con rutas `./` relativas a esa misma raíz.
- Las 24 rutas de `ASSETS` (23 archivos propios + `'./'` como raíz)
  **todas existen** en `dist/`, verificado programáticamente (no a
  simple vista).
- No depende de `www` ni de ninguna ruta específica de Android — mismo
  `sw.js`, sin modificar, ya validado funcionando tanto desde `www` como
  desde `dist` (Fase 2, prueba offline en Android real) y ahora también
  desde `dist` servido por HTTP (`npm run preview`, ver más abajo).
- **No se reescribió el Service Worker** en esta fase, como se pidió.

## OneSignal Web

Confirmado en `dist/index.html`: **no** contiene ningún `<script
src="...onesignal.com...">` incondicional (0 coincidencias) — solo el
comentario explicativo de `NOTIF-ANDROID-001`. `initWebPush()` (que
inyecta el SDK dinámicamente, solo fuera de Capacitor) está presente y
sin cambios en `dist/app.js`. `OneSignalSDKWorker.js` presente. No se
probó ningún envío de push real (fuera de alcance, como en fases
anteriores).

## `npm run preview` — servidor tipo producción sobre `dist/`

20 recursos comprobados por HTTP: **200 en todos**, tipos de contenido
correctos (`text/javascript`, `application/json`, `text/css`,
`image/png`). **0 errores 404.**

## Prueba Web real en navegador (WEB-VITE-01 a WEB-VITE-13)

Sin herramienta de automatización de navegador disponible en esta
sesión — se preparó la prueba manual (URL del `npm run preview` local) y
el usuario la ejecutó directamente: carga inicial, login, Dashboard,
Equipos, Turno, estados de engrase, Matriz Semanal, Anomalías, Historial,
Reportes, Service Worker (registrado/activado en DevTools), manifest/
íconos (sin errores en DevTools → Application → Manifest), sin errores de
consola JavaScript — **todos PASS**, confirmado por el usuario, no
inventado.

## Prueba offline Web desde `dist` (obligatoria)

Con el mismo servidor `npm run preview`: Service Worker activado
confirmado en DevTools, luego modo offline de DevTools activado, recarga
de la página — shell y módulos `src/core/` siguieron disponibles, sin
registrar datos ficticios. **PASS**, confirmado por el usuario en la
misma sesión de prueba manual.

## Comparación funcional: fuente Web actual vs. `dist`

27 de los 28 archivos runtime son **idénticos byte a byte** (`app.js`,
`db.js`, `sync.js`, `styles.css`, `sw.js`, `manifest.json`,
`OneSignalSDKWorker.js`, `.nojekyll`, `.well-known/assetlinks.json`, los
10 íconos, los 6 `src/core/*.js`). La única diferencia es `index.html`,
ya documentada desde la Fase 1: normalización cosmética de 3 `href`
(`manifest.json` → `./manifest.json`, etc.), atributo `crossorigin`
agregado al `<link rel="stylesheet">`, y ese mismo `<link>` reordenado
dentro de `<head>` — sin efecto funcional. **Ninguna diferencia de
comportamiento** en Service Worker, manifest, OneSignal, App Links,
íconos ni módulos.

## Proceso de despliegue (preparado, no ejecutado)

Nuevo script `npm run build:web` = `npm test && npm run build && npm run
verify:dist` — encadena las tres validaciones que hoy se hacían a mano en
un solo comando, y falla rápido (antes de generar o publicar nada) si
algo se rompe. El flujo objetivo completo, sin GitHub Actions (a
propósito, "prefiero primero un proceso claro y controlado"), queda
documentado paso a paso en **`docs/WEB_DEPLOYMENT.md`** (nuevo).

## `npm run verify:dist` (nuevo)

Script `tools/verify-dist.mjs`, reutiliza `computeRuntimeFileSet()` (la
misma allowlist que ya usa `tools/sync-web-to-android.mjs` y
`vite.config.js` — sin duplicar lógica). Verifica: `index.html` y el set
runtime completo existen en `dist/`; `.nojekyll` existe y está vacío;
`.well-known/assetlinks.json` es JSON válido con `package_name`;
`manifest.json` es JSON válido y sus íconos existen; cada ruta de
`ASSETS` en `sw.js` existe; `OneSignalSDKWorker.js` existe; `src/core/`
tiene sus módulos; `index.html` no carga el SDK Web de OneSignal de forma
incondicional.

**Probado que realmente detecta fallos** (no es un "siempre PASS"): se
quitó temporalmente `.nojekyll` de `dist/`, se confirmó que el script
falla con código de salida 1 y el mensaje correcto, y se restauró el
archivo — vuelve a pasar limpio.

## Qué NO se hizo en esta fase (a propósito)

Publicar nada (`git push`, subir archivos a GitHub, tocar el repositorio
`junivalles-cmd.github.io`, usar credenciales de GitHub, cambiar
configuración de Pages); instalar TypeScript; tocar
Supabase/IndexedDB/`sync.js`; agregar funcionalidades; corregir
`UI-ANDROID-005` o `ANDROID-DOZE-001`; borrar `www` ni
`tools/sync-web-to-android.mjs`; agregar GitHub Actions; reescribir el
Service Worker; probar push real de OneSignal.

## Siguiente fase natural (histórico — ver FASE 4 abajo)

Si se aprueba esta validación: primer despliegue controlado de `dist/` a
GitHub Pages (siguiendo `docs/WEB_DEPLOYMENT.md`), y después evaluar
retirar gradualmente `www`/`tools/sync-web-to-android.mjs` — **no
iniciado todavía**, pendiente de aprobación explícita.

# FASE 4 — PRIMER DESPLIEGUE CONTROLADO A GITHUB PAGES

Fecha: **2026-09-23** — primer deploy real de `dist/` a producción.
Commit del proyecto principal previo: `70924e8` (tag local
`pre-github-pages-dist-deploy`).

## Corrección importante sobre la configuración remota

La Fase 3 había documentado (a partir de archivos locales, marcado
explícitamente como NO VERIFICADO) que el repositorio de GitHub Pages
era `junivalles-cmd/junivalles-cmd.github.io` (User Page, raíz del
dominio). **Esa información local estaba desactualizada.** Al intentar
verificarla en esta fase (`git ls-remote`), tanto ese repositorio como
`https://junivalles-cmd.github.io/` devolvieron 404 reales desde los
servidores de GitHub (confirmado que no era un problema de red, probando
`github.com` y `github.com/anthropics`, ambos 200). Seguí la instrucción
explícita de la Fase 3 ("si no puedes acceder a GitHub: DETENTE, no
inventes configuración") y me detuve a pedir la configuración correcta
en vez de adivinar o reintentar con variaciones del nombre.

**Configuración remota real (confirmada por el usuario y verificada con
`git ls-remote`):**
- Repositorio: `https://github.com/junivalles-cmd/control-engrase-openpit`
  — un **Project Page**, no un User Page.
- URL pública: `https://junivalles-cmd.github.io/control-engrase-openpit/`
  (con subpath, no en la raíz del dominio).
- Branch: `main` (única rama del remoto, coincide con `HEAD`).
- Commit de producción antes de este deploy: `4e74527` ("Add files via
  upload").

Esto cambia una conclusión de la Fase 3: con un Project Page, `base:
'/'` habría roto todo (los recursos habrían intentado cargar desde la
raíz del dominio en vez de `/control-engrase-openpit/`) — `base: './'`
(ya configurado desde la Fase 1, nunca cambiado) resultó ser no solo
"más portable" sino la única opción correcta para esta configuración
real. Se verificó explícitamente que todas las rutas (index.html,
manifest, sw.js, styles.css) resuelven correctamente bajo el subpath.

## Checkpoint y checkout separado

- Tag local `pre-github-pages-dist-deploy` → commit `70924e8` del
  proyecto principal (sin push).
- Ningún checkout local preexistente del repo de Pages (búsqueda
  acotada a `C:\Users\Planificador\Documents`, sin resultados). Se clonó
  en una carpeta separada:
  `C:\Users\Planificador\Documents\CONTROL_ENGRASE_DEPLOY\control-engrase-openpit`
  — el `remote` del proyecto principal (`CONTROL_ENGRASE`) **no se tocó
  en ningún momento**.

## Comparación y clasificación (antes de escribir nada)

| Categoría | Cantidad | Detalle |
|---|---|---|
| Agregar | 7 | `.well-known/assetlinks.json`, los 6 `src/core/*.js` |
| Actualizar (contenido real) | 4 | `app.js`, `index.html`, `styles.css`, `sw.js` |
| Sin cambio real (solo CRLF↔LF del checkout Windows) | 4 | `db.js`, `sync.js`, `manifest.json`, `OneSignalSDKWorker.js` — confirmado con `xxd`, contenido semánticamente idéntico |
| Idénticos | 13 | `.nojekyll` + los 12 íconos |
| No runtime, **conservados sin tocar** | 9 | `ESTADO_DEL_PROYECTO.md`, `GUIA_*.md` (2), `MANUAL_*.pdf` (2), `README_SUBIR_A_GITHUB.txt`, `borrar_datos_prueba.sql`, `schema.sql`, `icon-180.png` — a propósito, "no mezclar limpieza con el primer deploy" |

**DEPLOY TREE == DIST**, confirmado por hash SHA-256 para los 28 archivos
runtime, no solo a simple vista.

## Revisión de seguridad antes del commit

`git diff` completo (623 líneas) escaneado con patrones de secretos
(`service_role`, `api key`, `secret`, `password`, `token`, `bearer`,
`private key`, `.jks`, `.keystore`, `node_modules`, `AndroidManifest`):
**cero coincidencias**. Fingerprint de `assetlinks.json`: sin cambios,
idéntico al validado en fases anteriores.

## Commit y push

- Identidad Git: el checkout nuevo no tenía `user.name`/`user.email`
  configurados (ni local ni global) — se configuraron **localmente, solo
  en ese repositorio**, replicando la misma identidad que ya usa el
  proyecto principal (`Planificador <junivalles@gmail.com>`, configurada
  ahí también solo a nivel de repo, nunca global). No se tocó ninguna
  configuración global de Git.
- Commit `d52d43d` "deploy: publish vite dist build" sobre `4e74527`.
  `git push origin main` — **PASS**, sin `--force`, sin pedir
  autenticación adicional (credenciales ya disponibles en el entorno).
- `git ls-remote` posterior confirmó `HEAD` remoto = `d52d43d`.

## Validación HTTP de producción

Tras esperar a que GitHub Pages reconstruyera (sondeado sin agresividad,
esperando a que `sw.js` sirviera `CACHE v26`): **16/16 URLs con 200**,
incluidas todas las rutas `src/core/*.js` y `.well-known/assetlinks.json`
**dentro del path del proyecto**. Confirmado explícitamente:
- `sw.js` productivo: `CACHE = 'engrase-openpit-v26'` (antes `v23`).
- `index.html` productivo: **0** referencias a `onesignal.com` — el SDK
  Web de OneSignal ya no se carga de forma incondicional en producción
  (`NOTIF-ANDROID-001` corregido también en la Web, no solo en Android:
  la producción anterior a este deploy todavía tenía el bug en vivo).
- `.well-known/assetlinks.json` **en la raíz del host**
  (`https://junivalles-cmd.github.io/.well-known/assetlinks.json`, la
  URL que Android realmente consulta): sigue en 404, igual que antes del
  deploy — ver `APP-LINKS-001` en `docs/BUG_REGISTER.md`. **No se intentó
  corregir**, tal como se pidió explícitamente.

## Validación manual en producción (PROD-WEB-01 a 10 + offline)

Guiada una prueba a la vez, con confirmación explícita del usuario en
cada una — ninguna se asumió ni se dio por buena automáticamente:

| Prueba | Resultado |
|---|---|
| PROD-WEB-01 Carga inicial | PASS |
| PROD-WEB-02 Login | PASS |
| PROD-WEB-03 Dashboard | PASS |
| PROD-WEB-04 Equipos | PASS |
| PROD-WEB-05 Turno | PASS |
| PROD-WEB-06 Estados de engrase | PASS |
| PROD-WEB-07 Matriz Semanal | PASS — con hallazgo nuevo registrado aparte (`MATRIZ-DOMINGO-001`, preexistente, no causado por este deploy — confirmado comparando contra `app.js` del commit `4e74527`) |
| PROD-WEB-08 Anomalías | PASS |
| PROD-WEB-09 Historial | PASS |
| PROD-WEB-10 Reportes | PASS |
| Offline en producción (SW activo → sin red → recarga → navegación) | PASS |

Ningún fallo P0/P1 atribuible al commit `d52d43d` — **no hizo falta
ningún rollback**.

## Hallazgos de esta fase (ninguno causado por el deploy)

- **`APP-LINKS-001`** (nuevo, P2): `.well-known/assetlinks.json` no
  disponible en la raíz del host que Android necesita — limitación
  arquitectónica de un Project Page, preexistente (ya fallaba en
  `4e74527`), no corregida a propósito. `APP LINKS PRODUCCIÓN: PENDIENTE`.
- **`MATRIZ-DOMINGO-001`** (nuevo, P3): la Matriz Semanal nunca incluyó
  el domingo, en ninguna versión — confirmado preexistente comparando
  contra `4e74527`. No corregido, registrado para una fase futura.

## Rollback (documentado, no ejecutado — no hizo falta)

```
cd C:\Users\Planificador\Documents\CONTROL_ENGRASE_DEPLOY\control-engrase-openpit
git revert d52d43d
git push origin main
```
Restaura el contenido exacto de `4e74527`. Alternativa igualmente válida:
publicar de nuevo el contenido de
`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` sin pasar por Vite (el proceso
manual que se usaba antes de esta fase, documentado en
`docs/WEB_DEPLOYMENT.md`).

## Qué NO se hizo en esta fase (a propósito)

Borrar `www` ni `tools/sync-web-to-android.mjs`; migrar a TypeScript;
corregir `APP-LINKS-001`, `UI-ANDROID-005`, `ANDROID-DOZE-001` ni
`MATRIZ-DOMINGO-001`; modificar Supabase/IndexedDB/`sync.js`; cambiar
fingerprints, `AndroidManifest.xml`, Capacitor, dominio o repositorio;
enviar push real de OneSignal; usar `--force`; introducir GitHub Actions;
empezar otra fase.

## Siguiente fase natural

Retirar de forma controlada el flujo legado `www` + script
WEB→`www`, y establecer definitivamente Vite/`dist` como única salida
Web + Android — **no iniciado todavía**, pendiente de aprobación
explícita.
