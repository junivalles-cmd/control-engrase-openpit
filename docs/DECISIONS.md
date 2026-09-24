# DECISIONES — FASE 0

## 1. Raíz del repositorio Git
**Decisión:** `C:\Users\Planificador\Documents\CONTROL_ENGRASE` (carpeta que
contiene tanto `CONTROL_ENGRASE_WEB` como `CONTROL_ENGRASE_APP_ANDROID`).
**Razón:** proteger ambas versiones actuales bajo el mismo historial desde el
inicio, sin favorecer una sobre la otra antes de decidir cómo unificarlas.

## 2. Exclusión de `android\app\src\main\assets\public`
**Decisión:** excluida del control de versiones.
**Evidencia que respalda la decisión:**
- Es contenido copiado automáticamente por `npx cap sync android` a partir de
  `www` (declarado como `webDir` en `capacitor.config.json`). No se edita a
  mano — cualquier cambio ahí se pierde en el siguiente `cap sync`.
- El propio Capacitor, al agregar la plataforma Android, generó
  `CONTROL_ENGRASE_APP_ANDROID\android\.gitignore`, y ese archivo **ya**
  excluye explícitamente `app/src/main/assets/public`,
  `app/src/main/assets/capacitor.config.json`,
  `app/src/main/assets/capacitor.plugins.json` y
  `app/src/main/res/xml/config.xml`. Esta es la convención estándar de
  cualquier proyecto Capacitor/Cordova, no una decisión arbitraria de esta
  fase.
- Android Studio no depende de que esa carpeta esté en el repositorio para
  compilar: la genera Gradle/Capacitor en cada sync/build a partir de `www`.
  Versionarla solo duplicaría contenido que ya vive en `www` y generaría
  conflictos de merge sin aportar nada.
**Lo que esto NO significa:** no se está decidiendo todavía cuál será la
fuente única a futuro (`www` vs. `CONTROL_ENGRASE_WEB` vs. una carpeta nueva).
Solo se excluye un artefacto de build, consistente con cómo el propio
ecosistema Capacitor ya trata esa carpeta.

## 3. Exclusión de material de firma (`*.jks`, `*.keystore`, `CONTRASENA_KEYSTORE.txt`)
**Decisión:** excluidos del control de versiones, pero **NO eliminados del
disco**.
**Razón:** `engrase-key.jks` es la clave privada de firma de la app Android;
`CONTRASENA_KEYSTORE.txt` contiene su contraseña en texto plano. Versionar
cualquiera de los dos —incluso en un repositorio local sin remoto— crea el
hábito de que ese material termine expuesto el día que se agregue un
`git remote` o se comparta el repositorio. Se mantiene el archivo físico
intacto en `CONTROL_ENGRASE_APP_ANDROID\` para que Android Studio y los
procesos de firma sigan funcionando sin cambios.
**Pendiente de revisión humana:** confirmar si esta contraseña ya se usó
para firmar builds de producción; si es así, no requiere rotación solo por
este cambio (el archivo nunca estuvo en Git), pero conviene guardar una copia
de respaldo del `.jks` y su contraseña fuera del repositorio (gestor de
contraseñas o almacenamiento cifrado), ya que si se pierde no se puede volver
a firmar actualizaciones de la misma app en Play Store.

## 4. Clave anónima de Supabase hardcodeada en `sync.js`
**Decisión:** se deja tal cual, versionada, sin acción en esta fase.
**Razón:** es la "anon public key" de Supabase, diseñada por Supabase para
vivir en código cliente; la seguridad real depende de las políticas de Row
Level Security (RLS) configuradas en la base de datos, no de ocultar esta
llave. Clasificada como CLIENTE/PÚBLICO.
**Pendiente de revisión humana:** confirmar que las tablas expuestas vía esta
key tienen RLS activado y políticas correctas — ver `docs/BUG_REGISTER.md` /
seguimiento aparte si se detecta algo. Esto es una recomendación de
seguridad general, no un bloqueante para el control de versiones.

## 5. Nombre de la rama de trabajo
**Decisión:** `migration-typescript`, creada desde el commit baseline sobre
`master`.
**Razón:** instrucción explícita para esta fase; todavía no implica que la
migración a TypeScript esté decidida o en curso — solo reserva el nombre de
rama para cuando se planifique ese trabajo.

## 6. Baja de `PLAN_MANTENIMIENTO_MAYOR_D8T_05-68.xlsx` del repositorio
**Decisión:** eliminado del seguimiento de Git (commit `e5af5ff`) y agregado
a `.gitignore` (`/PLAN_MANTENIMIENTO_MAYOR_D8T_05-68.xlsx`), sin restaurar el
archivo físicamente.
**Razón:** el usuario confirmó que ese archivo no pertenece al sistema
Control de Engrase — se coló en el commit baseline por estar suelto en la
misma carpeta raíz. No se usó `git reset --hard` ni `git clean`; se hizo un
commit explícito de limpieza para no reescribir el commit baseline.
**Verificación:** tras la baja, se revisó el resto de la raíz del repositorio
en busca de otros archivos evidentemente ajenos (`.xlsx`, `.xls`, `.docx`,
`.pptx`, PDFs administrativos) y no se encontró ninguno más.

## 7. Arquitectura recomendada para la fuente única (FASE 1)
**Decisión:** recomendar la Opción A (`CONTROL_ENGRASE_WEB` como fuente
canónica, `www` generado automáticamente por script) como siguiente fase
ejecutable, dejando la Opción C (Vite + TypeScript, `src/`+`public/`→`dist/`)
documentada como destino final para una fase posterior, no inmediata.
**Razón:** el análisis con hashes SHA-256 (ver
`docs/PLAN_UNIFICACION_WEB_ANDROID.md`, sección 3) mostró que el código de
negocio ya es 100% idéntico entre `CONTROL_ENGRASE_WEB` y `www` — el riesgo
real no es que estén desincronizados hoy, sino que nada impide que se
desincronicen mañana por depender de una copia manual. Automatizar esa copia
resuelve el riesgo real sin tocar GitHub Pages, Capacitor, ni ningún archivo
de negocio, cumpliendo las restricciones explícitas de "evitar una
reescritura" y "minimizar el riesgo de romper el sistema actual". Adoptar
Vite/TypeScript de inmediato (Opción C) mezclaría ese cambio de bajo riesgo
con uno de alto riesgo (nuevo sistema de build, nuevo flujo de publicación),
que es más seguro separar en una fase posterior y validada aparte.
**Esta es una decisión de análisis, no ejecutada:** no se creó ningún script,
no se movió ningún archivo. Ver plan detallado en
`docs/PLAN_UNIFICACION_WEB_ANDROID.md`.

## 8. Modularización JS: scripts clásicos, no ES modules (sin Vite todavía)
**Decisión:** los archivos nuevos de `src/core/` (turnos, horómetro, estado
de engrase, criticidad de anomalías) se escribieron como scripts clásicos
comunes (sin `export`/`import`), cargados con `<script src="...">` en
`index.html` antes de `app.js` — exactamente el mismo patrón que ya usan
`db.js`/`sync.js`/`app.js`. Sus funciones quedan disponibles como globales
compartidos entre todos los scripts de la página, así que `app.js` no
cambió ni un solo punto de llamada.
**Razón:** se evaluó usar ES modules nativos (`<script type="module">`,
soportados sin bundler por navegadores modernos y por el WebView de
Capacitor), pero habría obligado a convertir `app.js` también a módulo o a
mantener un puente global igual de manual que la alternativa elegida, con
más riesgo de romper el orden de carga de los `<script>` de terceros
(Chart.js, xlsx, jsPDF, QRious, jsQR, OneSignal) — más cambio del que esta
fase pedía explícitamente ("no gran refactor", "no introduzcas una
estructura de imports que rompa index.html/GitHub Pages/Capacitor").
**Consecuencia aceptada:** `sw.js` tuvo que actualizarse (se agregaron las
4 rutas nuevas a la lista de precaché `ASSETS`) para que el modo offline
siga sirviendo estos archivos — es el único punto donde esta fase tocó el
Service Worker, y solo se agregaron entradas a una lista de datos, sin
tocar su lógica de cacheo/fetch/activate. Ver `docs/MODULARIZATION.md`
para el detalle completo, incluida la tabla de riesgo por función.

## 9. Corrección de ENGRASE-001 sin coerción de tipos
**Decisión:** `statusFor()` ahora exige `Number.isFinite(equipment.hourmeter)`
— un `number` real y finito — antes de calcular el estado de engrase. Un
horómetro `undefined`, cadena de texto (incluida una numérica como
`"1200"`), `NaN`, u otro tipo se trata como dato inconsistente, sin excepción.
**Razón:** el pedido explícito fue evitar "coerción peligrosa" que pudiera
repetir el patrón que causó el bug original (donde comparaciones implícitas
trataban `null`/`""` como `0`, ocultando el problema en vez de señalarlo).
`Number.isFinite()` no convierte nada — es la opción más simple, explícita
y sin excepciones, aunque signifique que un horómetro que llegue como
string numérico también se marque como inconsistente (el formulario real
siempre entrega un `number`, así que ese caso no debería ocurrir en uso
normal; si llega como string, es en sí mismo una señal de dato corrupto).

## 10. Arquitectura de notificaciones push: OneSignal Web SDK solo en navegador, plugin nativo solo en Android (NOTIF-ANDROID-001)
**Decisión:** hay dos rutas de inicialización de OneSignal, mutuamente
excluyentes según la plataforma:
- **Navegador (Web/GitHub Pages):** `app.js` → `initWebPush()` inyecta
  dinámicamente el `<script>` del SDK Web de OneSignal
  (`cdn.onesignal.com/sdks/web/...`) solo si `!window.Capacitor` y hay
  `ONESIGNAL_APP_ID` configurado. `index.html` **no** carga ese SDK de
  forma estática.
- **Android (app instalada con Capacitor):** se usa exclusivamente el
  plugin nativo `onesignal-cordova-plugin`
  (`window.plugins.OneSignal`/`window.OneSignal`), vía `wirePushListeners()`
  e `initPushNotifications()`.
- La plataforma se detecta con `window.Capacitor`, el mismo mecanismo que
  ya usa el resto del proyecto — no se hardcodea navegador, fabricante ni
  modelo de dispositivo.

**Razón:** el SDK Web de OneSignal, al cargarse dentro del WebView de
Capacitor, detecta un entorno "no compatible" y lanza
`Uncaught TypeError: Cannot read properties of undefined (reading
'triggerEvent')` (bug `NOTIF-ANDROID-001`, ver `docs/BUG_REGISTER.md`).
`app.js` ya tenía esta separación correctamente implementada en su propia
lógica; el bug estaba en que `index.html` cargaba el mismo SDK Web *además*,
sin la misma condición, duplicando la inicialización en Android.

**Consecuencia aceptada:** al quitar esa carga estática de `index.html`,
también fue necesario subir la versión de `CACHE` en `sw.js`
(`engrase-openpit-v23` → `v24`), porque el Service Worker sirve
`index.html` con estrategia cache-first y no vuelve a precachear un
archivo cuyo contenido cambió si `sw.js` mismo no cambió de bytes —
sin este paso, dispositivos ya instalados habrían seguido viendo el
`index.html` viejo (con el bug) indefinidamente pese al fix en el código
fuente.

## 11. Matriz Semanal y Anomalías: separar decisión pura de DOM/persistencia (Modularización JS Fase 2)
**Decisión:** para las dos piezas de lógica que la Fase 1 había dejado
pendientes, se aplicó el mismo patrón conceptual:

```
datos ya cargados → función PURA (decide) → acción/estado → quien llama aplica DOM/DB
```

- **`estadoCelda(eq, fecha, plans, records, hoy)`** (`src/core/weekly-matrix.js`):
  antes era una función anidada dentro de `renderMatrizSemanal()` que
  cerraba sobre `plans`/`records`/`hoy`. Se cambió su firma para recibir
  esos tres datos como parámetros explícitos — eso, por sí solo, ya la
  vuelve una función pura top-level, extraíble y testeable, sin cambiar ni
  una sola regla de negocio. `renderMatrizSemanal()` (DOM, toolbar,
  impresión, exportación a Excel) se quedó en `app.js`.
- **`evaluateAnomalyActions(record, equipment, openAnomalies)`**
  (`src/core/anomaly-actions.js`): separa la DECISIÓN (¿crear una anomalía
  nueva, actualizar una existente para no duplicar, o no hacer nada?) de
  la PERSISTENCIA (`DB.allActive`, `DB.put`, `logAudit`), que sigue en
  `createAutoAnomalies()` (`app.js`). La función pura devuelve una lista de
  acciones (`{ tipo: 'crear'|'actualizar', ... }`) como datos — no ejecuta
  ningún efecto secundario.

**Razón:** el pedido explícito de esta fase era exactamente esta
separación ("no quiero que la función pura manipule DOM", "quiero separar
DECISIÓN DE NEGOCIO de PERSISTENCIA"), aplicada con el menor cambio
posible — sin reescribir reglas, solo cambiando de dónde vienen los datos.

**Límites de responsabilidad documentados explícitamente (con pruebas),
no asumidos:**
- `estadoCelda()` no filtra por `active` ni considera
  `plan.reprogramadoHasta` — ninguno de los dos es un cambio de esta
  extracción, ambos comportamientos ya existían así en el código original
  (confirmado leyendo `app.js` antes de tocar nada, no adivinado).
- `evaluateAnomalyActions()` detecta duplicados **solo por `autoPointId`**,
  sin comparar `equipmentId` — el filtrado por equipo sigue siendo
  responsabilidad de `createAutoAnomalies()` en `app.js`, exactamente igual
  que en el código original.

**Consecuencia aceptada:** `sw.js` se tocó dos veces en esta fase (una por
cada archivo nuevo agregado a `ASSETS`), subiendo `CACHE` de `v24` a `v25`
y luego a `v26` — mismo patrón ya establecido en `NOTIF-ANDROID-001` y en
la Fase 1, no una novedad. No se tocó ninguna otra parte de `sw.js`
(estrategia de cacheo/fetch/activate).

## 12. Vite Fase 1: `root` sobre la fuente actual + copia estable, en vez de reorganizar a `src/`+`public/`
**Decisión:** `vite.config.js` apunta `root` directamente a
`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`, sin mover ni un archivo — el
patrón estándar de Vite (`public/` para estáticos sin procesar) se
descartó para esta fase porque habría obligado a reorganizar rutas que
otros sistemas (`sync-web-to-android.mjs`, GitHub Pages, `sw.js`) ya
referencian por su ubicación actual. En vez de eso, un plugin propio
(`copyStableRuntimeFiles()`, hook `closeBundle`) copia el set runtime con
nombres SIN hash y reescribe en `dist/index.html` las 4 referencias
(`manifest.json`, `favicon.png`, `apple-touch-icon.png`, `styles.css`) que
Vite sí hashea por tratarse de `<link href>`.

**Razón:** se comprobó empíricamente (no se asumió) que Vite deja
intactos los `<script src>` clásicos pero no los copia, y SÍ hashea
`manifest.json`/íconos/CSS — eso habría roto el precache por nombre
exacto de `sw.js` (`ASSETS`). El pedido explícito de esta fase era
"preservar nombres/rutas estables antes que rediseñar el Service Worker".

**Reutilización, no duplicación:** el plugin usa `computeRuntimeFileSet()`
— la MISMA función que ya calcula qué es "runtime" para Android —
extraída a `tools/runtime-file-set.mjs` (nuevo módulo sin shebang, porque
esbuild no tolera un `#!/usr/bin/env node` en un archivo importado desde
`vite.config.js`). `tools/sync-web-to-android.mjs` ahora importa de ahí en
vez de tener su propia copia; su comportamiento como CLI se verificó
idéntico antes/después.

**Consecuencia aceptada:** `dist/` pierde algunas optimizaciones típicas
de Vite en esta fase (CSS sin minificar, sin hashing para cache-busting
por contenido) — deliberado: la estabilidad de nombres para `sw.js` pesa
más que la optimización en una fase que solo busca demostrar equivalencia,
no reemplazar el despliegue actual. `dist/` es gitignored (artefacto
reconstruible con `npm run build`, igual que ya se declaraba en el
`.gitignore` de la Fase 0, anticipando este caso).

## 13. Vite Fase 2: `webDir` apunta a `dist`, `www` queda como fallback temporal (no se borra)
**Decisión:** `capacitor.config.json` cambió `webDir` de `"www"` a
`"../dist"` — verificado leyendo el código fuente real de
`@capacitor/cli` (no asumiendo la ruta) que la resuelve como
`path.resolve(process.cwd(), webDir)` desde `CONTROL_ENGRASE_APP_ANDROID`.
`CONTROL_ENGRASE_APP_ANDROID\www` y `tools/sync-web-to-android.mjs` NO se
eliminaron — siguen existiendo, actualizados, sin usarse en el flujo
activo, como *fallback* de bajo riesgo mientras se termina de validar
esta transición.

**Razón:** el pedido explícito de esta fase era demostrar
`dist → Capacitor → Android` sin quemar el camino anterior — "ambos
quedan temporalmente como rollback". Mantener `www` sincronizado y
`sync-web-to-android.mjs` funcional cuesta prácticamente nada (nadie lo
ejecuta en este flujo) y reduce el rollback a 3 pasos documentados
(restaurar `webDir`, `cap sync`, rebuild) en vez de tener que
reconstruir `www` desde cero si algo saliera mal.

**Verificación, no asunción:** en vez de confiar en que "seguramente"
Capacitor usó `dist`, se verificó con evidencia objetiva en dos niveles —
comparación por hash del `.apk` local Y del APK realmente instalado en el
dispositivo (extraído con `adb pull`) — sin agregar ningún texto de debug
visible a la UI de la aplicación, tal como se pidió explícitamente.

**Consecuencia aceptada:** por ahora existen DOS copias mantenidas del
mismo contenido runtime (`www`, actualizada por
`sync-web-to-android.mjs` cuando se ejecuta manualmente, y `dist`,
regenerada por `npm run build`) — redundancia temporal y deliberada,
hasta que una fase futura decida si `www`/el script de sincronización
dejan de ser necesarios.

## 14. Vite Fase 3: `base: './'` confirmado (no cambiado) para GitHub Pages de usuario
**Decisión:** se mantiene `base: './'` en `vite.config.js` (configurado
desde la Fase 1) en vez de cambiarlo a `base: '/'`, pese a haber
confirmado en esta fase que el sitio se sirve en la **raíz** de un
dominio de usuario (`junivalles-cmd.github.io/`, sin subpath, sin
`CNAME`) — un caso donde, en teoría, `'/'` también funcionaría.

**Razón:** el pedido explícito era "no configurar base de Vite
arbitrariamente. Primero determina si `base: '/'` es lo correcto... y
documenta la decisión" — no necesariamente cambiarla. Con el sitio en la
raíz, `'./'` y `'/'` producen el mismo resultado funcional; `'./'` sigue
siendo estrictamente más portable (sin costo) porque seguiría funcionando
si el sitio alguna vez se sirviera bajo un subpath (por ejemplo, para
probarlo en otro entorno o repositorio de proyecto en vez de usuario).
Cambiarla habría sido una modificación sin beneficio real, contraria a
"no cambies configuración de despliegue sin necesidad" que rige toda
esta fase.

**Verificación, no asunción:** la determinación de "raíz de dominio de
usuario, sin subpath" no se asumió — se confirmó releyendo documentación
local ya existente (`README_SUBIR_A_GITHUB.txt`,
`GUIA_COMPLETA_INSTALACION.md`, `docs/PLAN_UNIFICACION_WEB_ANDROID.md`),
sin volver a intentar acceder al panel remoto de GitHub (que ya estaba
marcado como NO VERIFICABLE desde este entorno en una fase anterior).

## 15. `npm run verify:dist`: reutilizar `computeRuntimeFileSet()` en vez de una lista propia
**Decisión:** el verificador de build Web (`tools/verify-dist.mjs`) no
mantiene su propia lista de "archivos obligatorios" — importa
`computeRuntimeFileSet()` de `tools/runtime-file-set.mjs` (la misma
función que ya usan `tools/sync-web-to-android.mjs` y
`vite.config.js`) y valida que cada archivo de esa allowlist exista en
`dist/`, además de un puñado de comprobaciones de contenido (JSON
válido, íconos del manifest existen, rutas de `sw.js` resuelven, no
reaparece la carga incondicional del SDK Web de OneSignal).

**Razón:** "PARTE F — NO DUPLICAR LÓGICA" ya establecida como principio
en fases anteriores de este proyecto — una tercera copia de la misma
lista de archivos críticos (además de la que ya usan el script de
sincronización y el plugin de Vite) sería exactamente el tipo de
duplicación que se pidió evitar, y divergiría con el tiempo si alguien
actualiza una sin la otra.

**Verificado que el script realmente detecta fallos** (no es un "siempre
PASS"): se quitó `.nojekyll` de `dist/` temporalmente, se confirmó que
`verify:dist` falla con código de salida 1 y el mensaje correcto, y se
restauró el archivo.

## 16. Vite Fase 5: retirar `www` y `sync-web-to-android.mjs` del repositorio en vez de dejarlos como código muerto

**Decisión:** una vez confirmado, por inspección directa (no asumido),
que ni `CONTROL_ENGRASE_APP_ANDROID/www` ni
`tools/sync-web-to-android.mjs` participaban ya en ningún flujo activo
(`capacitor.config.json` usa `webDir: "../dist"` desde la Fase 2; ningún
script de `package.json` ni `vite.config.js`/`tools/verify-dist.mjs`
importa o ejecuta el script legacy), se eliminaron del repositorio
(`git rm`) en vez de dejarlos en disco "por si acaso".

**Razón:** Git ya conserva el historial completo — un tag local
(`pre-remove-legacy-www`) y el propio historial de commits permiten
recuperar cualquiera de los dos exactamente como estaban
(`git checkout pre-remove-legacy-www -- tools/sync-web-to-android.mjs
CONTROL_ENGRASE_APP_ANDROID/www`). Mantener un script y una carpeta de
29 archivos sin ningún consumidor activo, "solo por si acaso", es
exactamente el tipo de código muerto que agrega confusión (¿cuál es la
fuente real, `www` o `dist`?) sin aportar seguridad real — el rollback
verdadero ya lo da Git, no un directorio duplicado en el árbol de
trabajo.

**Condición aplicada antes de borrar:** no se retiró nada hasta
demostrar con evidencia (comparación de referencias en todo el
repositorio, comparación por hash `www` vs. `dist`, y una reconstrucción
completa de `dist` desde cero con `www` ya ausente) que la retirada no
rompía nada. Ver `docs/VITE_MIGRATION.md` (Fase 5) para el detalle
completo de esa verificación.

## 17. TypeScript Fase 1: `checkJs: false` global + opt-in por archivo con `// @ts-check`, en vez de `checkJs: true` global

**Decisión:** `tsconfig.json` activa `allowJs: true` (para que
TypeScript pueda inferir tipos de dependencias entre archivos `.js`)
pero mantiene `checkJs: false` a nivel de proyecto. Cada archivo que se
quiera verificar opta individualmente agregando `// @ts-check` como
primera línea (mecanismo estándar de TypeScript).

**Razón:** `app.js`/`db.js`/`sync.js` sin tipar tienen miles de líneas;
activar `checkJs: true` globalmente habría producido cientos de errores
de una sola vez, sin ningún valor real (nadie iba a corregirlos todos en
esta fase) — exactamente lo que el pedido pidió evitar explícitamente
("no activar de golpe opciones estrictas que produzcan cientos de
errores inútiles"). El opt-in por archivo permite mantener `strict:
true` con toda su fuerza en los archivos que SÍ se verifican
(`src/core/hourmeter.js`, `src/types/*.ts`) sin que eso implique tocar
ni diagnosticar el resto del código todavía sin preparar.

**Verificado:** línea base con 0 archivos verificados → 0 errores;
tras agregar `// @ts-check` a `hourmeter.js` → sigue en 0 errores
(tipado correctamente desde el principio, sin necesitar `// @ts-ignore`
en ningún punto).

## 18. TypeScript Fase 1: no renombrar ningún archivo productivo de `.js` a `.ts`

**Decisión:** ningún archivo de `src/core/` cambió de extensión esta
fase. Donde el pedido pedía "si no puedes garantizar que el archivo
compilado conserve una ruta compatible, no migres todavía", se
interpretó y aplicó literalmente: se hizo la prueba antes de decidir, no
después.

**Razón:** dos hallazgos independientes, cada uno suficiente por sí
solo. (1) Prueba aislada en un proyecto Vite temporal (fuera del repo
real): un `<script src="archivo.ts">` clásico se comporta igual que un
`.js` clásico — Vite no lo bundlea ni lo copia a `dist/`; si se copiara
igual con el plugin propio, el navegador recibiría sintaxis TypeScript
real vía `<script src="...">`, que no es JavaScript válido. (2) El
arnés de tests (`tests/helpers/extractFromSource.js`) evalúa texto
fuente crudo con `new Function(...)` — sintaxis TS real ahí también
rompería con `SyntaxError`, sin relación con el problema de Vite.

**Alternativa aplicada en su lugar:** JSDoc + `// @ts-check` sobre el
`.js` real (`hourmeter.js`), que no cambia ni un byte de código
ejecutable — confirmado con hash idéntico salvo por los propios
comentarios agregados, mismo comportamiento en Vite/`dist`/`sw.js`/
arnés de tests. Ver `docs/TYPESCRIPT_MIGRATION.md` (sección 9) para el
detalle completo y los dos caminos posibles para resolver esto en una
fase futura.
