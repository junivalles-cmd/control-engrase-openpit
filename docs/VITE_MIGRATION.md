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

## Siguiente fase natural

Fase Vite 3: validar `dist` como fuente también para GitHub Pages, y
evaluar convertir `dist` en la única salida Web + Android (momento en el
que `www` y `tools/sync-web-to-android.mjs` dejarían de ser necesarios) —
**no iniciada todavía**, pendiente de aprobación explícita.
