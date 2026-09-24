# MIGRACIÓN A TYPESCRIPT

Rama: `migration-typescript`
Checkpoint previo: tag local `pre-typescript-stable` → commit `a284e5c`
(sin push).

# FASE 1 — PREPARACIÓN SEGURA (INFRAESTRUCTURA, NO CONVERSIÓN MASIVA)

Fecha: 2026-09-23

## Objetivo de esta fase

Introducir TypeScript como herramienta de **verificación de tipos**, no
de build. Explícitamente NO se buscaba convertir `app.js`/`db.js`/
`sync.js` ni hacer una conversión masiva de `.js` a `.ts` — solo:

1. instalar TypeScript;
2. analizar su compatibilidad con la arquitectura Vite/scripts clásicos
   ya consolidada (ver `docs/VITE_MIGRATION.md`);
3. configurar `tsconfig.json` para una migración gradual;
4. obtener una línea base de errores real;
5. preparar una estrategia incremental documentada;
6. migrar, como máximo, UN módulo puro de bajo riesgo — **solo si se
   podía demostrar que era seguro**.

El sistema debe seguir funcionando exactamente igual — cero cambios de
lógica de negocio, cero cambios en Supabase/IndexedDB/`sync.js`/Service
Worker.

## 1. Cómo Vite maneja el JavaScript actual (análisis previo, sin tocar nada)

Confirmado (reutilizando el análisis ya hecho en Fase Vite 1, sin
duplicarlo):

- Los 15 `<script src="...">` de `index.html` (6 CDN + `db.js`/`sync.js`/
  `app.js` + 6 `src/core/*.js`) son **scripts clásicos**, sin
  `type="module"`, sin `export`/`import` — comparten un único scope
  global de navegador (igual que si estuvieran concatenados).
- Vite **no bundlea ni copia** estos scripts clásicos — los deja
  intactos en el HTML de salida. Solo el plugin propio
  `copyStableRuntimeFiles()` (`vite.config.js`) los copia a `dist/` con
  nombre estable, reutilizando `computeRuntimeFileSet()`
  (`tools/runtime-file-set.mjs`).
- Vite sí procesa y **hashea** los 4 `<link href="...">`
  (`manifest.json`, `favicon.png`, `apple-touch-icon.png`,
  `styles.css`) — el mismo plugin reescribe esas referencias de vuelta a
  nombre estable.
- `app.js` consume `src/core/*.js` como **funciones/constantes
  globales** (no hay `import`) — el orden de carga en `index.html`
  importa solo para lo que se ejecuta inmediatamente al parsear (nada,
  en estos 6 archivos: solo declaran funciones/constantes), no para lo
  que se LLAMA después.
- `sw.js` precachea 24 rutas por **nombre exacto** (`ASSETS`), incluidas
  las 6 de `src/core/*.js` — cualquier archivo que cambie de nombre/ruta
  rompería el modo offline si `sw.js` no se actualiza en paralelo.

## 2. Mapa de dependencias de `src/core/*` (los 6 módulos ya extraídos)

| Archivo | Exports (global) | Dependencias globales | Usado por | DOM | IndexedDB | Tests | Riesgo TS |
|---|---|---|---|---|---|---|---|
| `shifts.js` | `currentShiftId`, `dentroDeSuTurno` | `App.currentUser`, `App.generalSettings` | `app.js` | No | No | `turnos.test.js` (13) | **BAJO** |
| `hourmeter.js` | `validateHourmeterChange` | `fmt()` (de `lubrication-status.js`) | `app.js` | No | No | `horometro-validacion.test.js` (8) | **BAJO** |
| `lubrication-status.js` | `fmt`, `WEEKDAY_NAMES`, `mostRecentAssignedDate`, `weekdayStatusFor`, `statusFor` | — (define sus propios globales) | `app.js`, `weekly-matrix.js` | No | Sí (`DB.allActive`, opcional/async) | `estado-engrase.test.js` (17) | MEDIO |
| `anomalies.js` | `CRITICIDAD_POR_MOTIVO` (objeto, sin funciones) | — | `app.js`, `anomaly-actions.js` | No | No | `anomalias.test.js` (9) | BAJO (trivial, poco valor demostrativo) |
| `weekly-matrix.js` | `estadoCelda` | `WEEKDAY_NAMES` (de `lubrication-status.js`) | `app.js` | No | No | `matriz-estado-celda.test.js` + `matriz-semanal.test.js` (22) | BAJO-MEDIO |
| `anomaly-actions.js` | `hayPuntosOAnomaliaHorometro`, `evaluateAnomalyActions` | `fmtDate` (de `app.js`), `CRITICIDAD_POR_MOTIVO` (de `anomalies.js`) | `app.js` | No | No | `anomaly-actions.test.js` (22) | MEDIO |

## 3. Instalación

```
npm install --save-dev typescript
```

Versión instalada: **`typescript@^7.0.2`** (única `devDependency`
agregada). No se instaló React/Vue/Angular/Babel/Webpack/`ts-node` — no
son necesarios; Vite ya soporta TypeScript de forma nativa cuando
corresponde, y `tsc` aquí se usa solo para verificación (`--noEmit`),
nunca para bundlear.

**Auditoría de seguridad:** `npm audit --omit=dev` → **0
vulnerabilidades**. Las 5 vulnerabilidades que reporta `npm audit`
completo son de `vite`/`vitest`/`esbuild` (dev-only, preexistentes antes
de esta fase) — TypeScript no introdujo ninguna. No se tocaron versiones
de `vite`/`vitest` (actualizarlas sería un cambio mayor y rompería lo
que ya se validó en las 5 fases de Vite; fuera de alcance de esta fase).

## 4. `tsconfig.json` — estrategia progresiva

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "lib": ["ES2020", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowJs": true,
    "checkJs": false,
    "noEmit": true,
    "strict": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true
  },
  "include": [
    "CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/**/*.ts",
    "CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/**/*.js"
  ],
  "exclude": ["node_modules", "dist", "CONTROL_ENGRASE_APP_ANDROID"]
}
```

Decisiones, una por una:

- **`allowJs: true` + `checkJs: false`**: TypeScript puede parsear
  `.js` (para inferir tipos de dependencias, ej. `fmt` para
  `hourmeter.js`) sin **diagnosticar** errores en ellos por defecto. Un
  archivo `.js` opta a ser verificado individualmente agregando
  `// @ts-check` como primera línea — mecanismo estándar de TypeScript,
  exactamente la "selección controlada" pedida, sin tocar ningún otro
  archivo.
- **`noEmit: true`**: TypeScript **nunca** genera JavaScript de salida.
  Vite sigue siendo el único responsable del build (`npm run build`) —
  `tsc` en este proyecto es una herramienta de verificación pura,
  ejecutada aparte (`npm run typecheck`).
- **`strict: true`**: activado globalmente, pero como `checkJs` está en
  `false`, no tiene efecto sobre los `.js` que no opten con
  `// @ts-check` — solo aplica con toda su fuerza a los archivos que sí
  se verifican explícitamente (hoy: `hourmeter.js` y los `.ts` de
  `src/types/`). Así se evita "activar de golpe opciones estrictas que
  produzcan cientos de errores inútiles" sin renunciar a `strict` donde
  sí importa.
- **`module: "ESNext"` / `moduleResolution: "Bundler"`**: configuración
  recomendada para proyectos Vite; en la práctica no afecta a los
  archivos de `src/core/` porque son "scripts" (sin `import`/`export`)
  desde el punto de vista de TypeScript, igual que lo son para el
  navegador.
- **`lib: ["ES2020", "DOM", "DOM.Iterable"]`**: coincide con el entorno
  real de ejecución (navegador/WebView moderno). No se incluyó
  `WebWorker` (que necesitaría `sw.js`) porque `sw.js` no está incluido
  todavía en el `include` — pendiente para cuando se decida tipar el
  Service Worker.
- **`include`**: apunta únicamente a `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\src\**`
  (donde ya viven `src/core/*.js` y el nuevo `src/types/*.ts`) — deja
  fuera a propósito `app.js`/`db.js`/`sync.js` (en la raíz de
  `CONTROL_ENGRASE_WEB`, miles de líneas sin tipar) y todo
  `CONTROL_ENGRASE_APP_ANDROID` (proyecto Gradle/Java/Kotlin, no
  relevante para `tsc`).

## 5. Script `typecheck`

```json
"typecheck": "tsc --noEmit"
```

Agregado sin modificar `test`/`build`/`build:web`/`verify:dist`. El
flujo completo ahora es:
```
npm test
npm run typecheck
npm run build:web
```

## 6. Línea base de errores

```
npm run typecheck
```

**Resultado: 0 errores** — esperado y buscado a propósito: con
`checkJs: false` y ningún archivo con `// @ts-check` todavía, TypeScript
parsea los `.js` de `src/core/` (para inferencia) pero no emite
diagnósticos sobre ellos. No hubo que clasificar "cientos de errores" ni
usar `// @ts-ignore` en ningún lado — la estrategia de opt-in por
archivo evitó el problema de raíz, en vez de silenciarlo después.

## 7. Tipos del dominio (`src/types/`)

Ubicación: `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\src\types\` (junto a
`src/core/`, dentro del `root` de Vite). Son **archivos `.ts` de solo
declaraciones** (`interface`/`type`, sin código ejecutable) — por eso
Vite nunca necesita procesarlos ni copiarlos: no están referenciados
desde `index.html`/`manifest.json`/`sw.js`, así que
`computeRuntimeFileSet()` (la allowlist que decide qué se copia a
`dist/`) no los incluye. Confirmado con `npm run build:web` +
`npm run verify:dist` después de crearlos: **sin cambios** en el
inventario de `dist/`.

- **`src/types/lubrication.ts`**: `Equipment`, `LubricationPlan`,
  `LubricationRecord`, `LubricationDetail`, `Anomaly`, `EstadoCode`,
  `CeldaTipo`. Campos tomados de objetos REALES (no inventados): el
  literal por defecto de `Equipment` en `app.js` (~línea 2781), la
  creación de `LubricationPlan` en `app.js` (~línea 3316), la creación
  de `LubricationRecord` en `app.js` (~línea 4371), y los campos que
  `src/core/lubrication-status.js`/`src/core/anomaly-actions.js`/
  `src/core/weekly-matrix.js` realmente leen o escriben.
- **`src/types/shift.ts`**: `ShiftId`, `CurrentUser`,
  `GeneralSettings` — tomados de `src/core/shifts.js` y de cómo
  `tests/unit/turnos.test.js` construye su `fakeApp` (que refleja la
  forma real de `App.currentUser`/`App.generalSettings`).

Deliberadamente **no exhaustivos**: solo los campos que alguno de los 6
módulos de `src/core/` realmente usa hoy. No se intentó tipar el 100%
del dominio (`app.js` tiene muchas más entidades/campos) — eso se irá
ampliando módulo por módulo en fases futuras, cuando cada uno se
verifique de verdad.

## 8. Primer candidato — análisis comparativo

Entre `shifts.js` y `hourmeter.js` (los dos de riesgo BAJO con mejor
cobertura de tests, sin IndexedDB/DOM/fetch):

| | `shifts.js` | `hourmeter.js` |
|---|---|---|
| Funciones | 2 (`currentShiftId`, `dentroDeSuTurno`) | 1 (`validateHourmeterChange`) |
| Dependencia externa | `App` (objeto con 2 sub-objetos: `currentUser`, `generalSettings`) | `fmt()` (una función, definida en `src/core/lubrication-status.js`, YA dentro del `include` de `tsconfig.json`) |
| Necesita declaración ambient nueva | Sí (forma de `App` no está declarada en ningún lado) | **No** — TypeScript infiere `fmt` automáticamente al parsear `lubrication-status.js`, que ya está incluido |
| Tests | 13 | 8 |
| Superficie de tipos | Media (objetos anidados, enum de turnos) | Baja (números en, unión discriminada simple de salida) |

**Elegido: `hourmeter.js`** — menor superficie de dependencias externas,
cero declaraciones ambient necesarias, tipo de retorno simple y
demostrativo (unión discriminada). `shifts.js` queda como candidato
natural para la Fase 2 (junto con `src/types/shift.ts`, ya preparado).

## 9. Problema crítico: nombres estables — analizado ANTES de convertir nada

**Prueba aislada, fuera del repositorio real** (proyecto Vite temporal
en una carpeta separada, borrado al terminar): un `<script src="foo.ts">`
clásico produce exactamente el mismo comportamiento que ya documentaba
la Fase Vite 1 para `.js` — Vite **deja el `<script>` intacto** en el
HTML de salida (misma advertencia: `can't be bundled without
type="module"`) y **no copia `foo.ts` a `dist/`** en absoluto.

Conclusión, confirmada empíricamente, no asumida: si se renombrara
cualquier `src/core/*.js` a `.ts` manteniéndolo como script clásico, ni
siquiera llegaría a `dist/` sin el plugin propio — y si el plugin lo
copiara igual (reutilizando `computeRuntimeFileSet()`), el navegador
recibiría **sintaxis TypeScript real** (`: string`, etc.) vía
`<script src="...">`, que no es JavaScript válido → `SyntaxError`
inmediato al cargar la página. Este es un problema real y bloqueante,
no una simple pregunta de nombres hasheados.

**Segundo bloqueo, independiente, descubierto en el análisis del
arnés de tests:** `tests/helpers/extractFromSource.js` extrae el texto
fuente crudo de cada función/constante y lo ejecuta con
`new Function(...)` — **no importa los archivos como módulos**.
Cualquier anotación de tipo TypeScript real en el cuerpo del archivo
haría fallar esa evaluación con `SyntaxError`, sin relación con el
problema de Vite. Ver `docs/AUTOMATED_TESTS.md` para el detalle.

**Conclusión de esta fase, siguiendo la regla explícita del pedido**
("si no puedes garantizar que el archivo compilado conserve una ruta
compatible: NO migres todavía ningún archivo productivo"): **no se
renombró ningún archivo `.js` a `.ts` esta fase.** Dos caminos posibles
para una fase futura, ambos documentados aquí para no repetir el
análisis:

1. **Convertir a ES module real** (`type="module"`, con `import`/`export`)
   y dejar que Vite lo bundlee de verdad. Cambio de arquitectura mayor:
   los módulos ES no exponen sus declaraciones top-level como globales
   de `window` — cada consumidor actual (`app.js`, otros
   `src/core/*.js`, y el propio arnés de tests) tendría que actualizarse
   para usar `import` en vez de depender del scope global compartido.
   Fuera de alcance de "preparación segura".
2. **Agregar un paso de compilación** (`tsc` con `emit` real, o un
   plugin de Vite que transpile `.ts` → `.js` clásico antes de que
   `copyStableRuntimeFiles()` actúe) que mantenga la salida como script
   clásico con nombre estable. Viable técnicamente, pero contradice la
   preferencia explícita de esta fase (`noEmit: true`, "Vite sigue
   siendo responsable del build") y no se implementó sin aprobación
   explícita de ese cambio de alcance.

## 10. Lo que SÍ se hizo en `hourmeter.js` (sin renombrar, sin cambiar lógica)

Se agregó `// @ts-check` (primera línea) + JSDoc con un `@typedef` de
unión discriminada (`HourmeterOk | HourmeterRejected | HourmeterWarning`)
y anotaciones `@param`/`@returns` en `validateHourmeterChange()`. **El
archivo sigue siendo `.js`, sigue siendo un script clásico, ni una sola
línea de lógica cambió** — solo comentarios que TypeScript puede leer.
De paso, se corrigió un comentario desactualizado (decía que `fmt()`
vivía en `app.js`; desde la Modularización JS Fase 1 vive en
`src/core/lubrication-status.js`).

Por qué es seguro, a diferencia de renombrar a `.ts`:
- Los comentarios `/** ... */` y `// @ts-check` no son código — el
  archivo sigue siendo JavaScript 100% válido, Vite lo trata exactamente
  igual que antes (confirmado: mismo hash SHA-256 salvo por el propio
  cambio de texto, misma ruta en `dist/`, mismo comportamiento en
  `sw.js`).
- `extractDeclaration()` (arnés de tests) sigue encontrando
  `function validateHourmeterChange(...)` sin problema — los comentarios
  antes de la declaración no afectan la extracción por regex/conteo de
  llaves. Confirmado: `npm test` → 125/125 PASS, sin cambios.

**`npm run typecheck` sobre `hourmeter.js`: 0 errores, con `strict: true`.**

## 11. Verificación completa

| Paso | Resultado |
|---|---|
| `npm run typecheck` | **PASS**, 0 errores (`hourmeter.js` + `src/types/*.ts`) |
| `npm test` | **125/125 PASS**, sin cambios en cantidad |
| `npm run build:web` (`test`+`build`+`verify:dist`) | **PASS** |
| `dist/src/core/hourmeter.js` | Idéntico por hash a la fuente, ruta sin cambios (`./src/core/hourmeter.js`) |
| `npm run preview` | 9 recursos comprobados (incluidos los 6 `src/core/*.js`), **200 en todos** |
| `npx cap sync android` | **PASS** — `Copying web assets from dist to ...assets/public` |
| `./gradlew assembleDebug` | **BUILD SUCCESSFUL** |
| APK ⇔ `dist` (hash de `hourmeter.js` e `index.html`) | **Idénticos** |
| Android real / offline | **NO PROBADO** — Samsung no conectado (`adb devices` sin dispositivos), igual que en Fase Vite 5 |
| Supabase / IndexedDB / `sync.js` / Service Worker | **Sin cambios** |

## 12. Orden recomendado para módulos futuros (Fase 2, no iniciada)

1. `shifts.js` (candidato natural siguiente: `src/types/shift.ts` ya
   preparado, riesgo BAJO, requiere solo declarar la forma de `App`
   como ambient o parámetro tipado).
2. `weekly-matrix.js` (riesgo BAJO-MEDIO; depende de `WEEKDAY_NAMES`
   global, ya tipable vía `src/types/lubrication.ts`).
3. `anomalies.js` (trivial — un objeto, bajo valor pero cero riesgo).
4. `lubrication-status.js` / `anomaly-actions.js` (riesgo MEDIO — async,
   dependencia de `DB`/`fmtDate`; requieren más tipos del dominio ya
   preparados en `src/types/lubrication.ts`).

Ninguno de estos se migra en esta fase. Antes de migrar cualquiera de
ellos con cambio de extensión real, **Fase 2 debe resolver primero** uno
de los dos caminos de la sección 9 (ES modules reales, o paso de
compilación adicional) — de lo contrario, seguir el mismo patrón de
`hourmeter.js` (JSDoc + `// @ts-check`, sin renombrar) sigue siendo
seguro y disponible para cualquiera de estos módulos sin esperar a
resolver ese problema mayor.

## 13. Manejo de JS legacy (`app.js`, `db.js`, `sync.js`)

No incluidos en `tsconfig.json` (`include` apunta solo a `src/**`). No
se planea tipar estos tres archivos de una sola vez — son miles de
líneas, fuertemente acopladas a IndexedDB/DOM/Supabase. La estrategia es
seguir extrayendo piezas puras a `src/core/` (como ya viene ocurriendo
desde la Modularización JS Fase 1/2, ver `docs/MODULARIZATION.md`) y
tipar cada pieza extraída con el mismo patrón demostrado aquí, en vez de
intentar tipar el monolito completo.

## 14. Rollback

Tres niveles, ninguno ejecutado (no hizo falta):

1. **Deshacer solo esta fase:** `git revert <hash>` sobre el/los
   commit(s) de esta fase.
2. **Volver al estado exacto previo:** `git reset --hard
   pre-typescript-stable` (destructivo).
3. **Quitar TypeScript sin tocar nada más:** `npm uninstall typescript`
   + borrar `tsconfig.json` + quitar el script `typecheck` de
   `package.json` + borrar `src/types/` — el resto del sistema
   (`app.js`, `src/core/*.js`, Vite, Android, GitHub Pages) sigue
   funcionando exactamente igual, porque `tsc` nunca participó en el
   build real.

Ninguna base de datos, estado del servidor, ni configuración de
Android/Capacitor está involucrada en este rollback.

## Qué NO se hizo en esta fase (a propósito)

Convertir `app.js`, `db.js` o `sync.js`; renombrar ningún archivo
productivo de `.js` a `.ts`; cambiar IndexedDB; cambiar Supabase; cambiar
la lógica de sincronización; modificar el Service Worker; agregar
funcionalidades nuevas; corregir `APP-LINKS-001`, `MATRIZ-DOMINGO-001`,
`UI-ANDROID-005` ni `ANDROID-DOZE-001`; usar `// @ts-ignore` para forzar
un PASS; actualizar `vite`/`vitest` para resolver las vulnerabilidades
preexistentes de `npm audit`.
