# PRUEBAS AUTOMATIZADAS

Fecha de creación: 2026-09-23
Rama: `migration-typescript`
Objetivo: proteger la lógica actual de negocio (turnos, engrase, horómetros,
anomalías, matriz semanal, sincronización, borrado lógico) con pruebas reales
antes de empezar la modularización y, más adelante, la migración a
TypeScript — sin tocar todavía `app.js`, `db.js` ni `sync.js`.

## Framework: Vitest

**Elegido por:**
- Es la opción explícitamente preferida en el pedido, y es compatible.
- ESM nativo, cero configuración para Node, rápido.
- Su API (`describe`/`it`/`expect`/`vi`) es compatible con la sintaxis que
  se usará también si en el futuro se adopta TypeScript (Vitest soporta
  `.ts` sin configuración adicional).
- Es una dependencia de **desarrollo únicamente** (`devDependencies`).
  Vitest usa Vite internamente como motor de transformación, pero eso nunca
  toca lo que se publica en GitHub Pages ni lo que Capacitor empaqueta —
  `CONTROL_ENGRASE_WEB` y `www` siguen siendo HTML/CSS/JS planos, sin build.

No se encontró ninguna razón técnica para usar otra herramienta.

## Por qué las pruebas viven en la raíz del repositorio (no dentro de `CONTROL_ENGRASE_WEB` ni `CONTROL_ENGRASE_APP_ANDROID`)

- `CONTROL_ENGRASE_WEB` es, a propósito, una carpeta de archivos estáticos
  sin `package.json` ni proceso de build (ver `docs/LINEA_BASE.md` y
  `docs/PLAN_UNIFICACION_WEB_ANDROID.md`) — agregarle tooling de pruebas
  rompería esa propiedad sin necesidad.
- `CONTROL_ENGRASE_APP_ANDROID` ya tiene su propio `package.json`, pero con
  dependencias de **Capacitor** (Android, plugins nativos). Mezclar ahí las
  dependencias de pruebas de lógica de negocio (que no tienen nada que ver
  con Android) sería confuso y acoplaría cosas que no deberían estarlo.
- La raíz del repositorio (`C:\Users\Planificador\Documents\CONTROL_ENGRASE`)
  ya tiene precedente de alojar herramientas de desarrollo compartidas
  (`tools/sync-web-to-android.mjs`, sin su propio `package.json`). Agregar
  `package.json` + `tests/` ahí sigue el mismo patrón, sin duplicar
  dependencias y sin tocar ninguno de los dos proyectos existentes.

Las pruebas **leen** el código fuente de `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`
(la fuente canónica) directamente desde su ubicación actual — no se copió ni
se movió ningún archivo de código.

## Instalación

Desde la raíz del repositorio:
```
npm install
```
Instala Vitest como `devDependency` (nada se publica ni se empaqueta con
esto — no afecta a la web ni a la app Android).

## Cómo ejecutar

Desde la raíz del repositorio (`C:\Users\Planificador\Documents\CONTROL_ENGRASE`):
```
npm test          # corre toda la suite una vez
npm run test:watch  # modo observador, útil mientras se escriben más pruebas
```

## Estructura

```
CONTROL_ENGRASE/
├── package.json           ← nombre del proyecto, scripts test/test:watch, devDependency de Vitest
├── vitest.config.js        ← entorno "node", busca tests/unit/**/*.test.js
└── tests/
    ├── helpers/
    │   ├── extractFromSource.js     ← extrae texto de funciones/const reales de un archivo fuente
    │   └── loadLubricationLogic.js  ← carga funciones reales de app.js/db.js/src/core/*.js para probarlas
    └── unit/
        ├── turnos.test.js
        ├── estado-engrase.test.js
        ├── matriz-semanal.test.js
        ├── anomalias.test.js
        ├── horometro-validacion.test.js
        ├── active-flag.test.js
        ├── sync-dirty-check.test.js
        └── seguridad-basica.test.js
```

**Actualización 2026-09-23 (modularización):** parte de la lógica que antes
vivía solo en `app.js` ahora está en
`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\src\core\*.js` (turnos, horómetro,
estado de engrase, criticidad de anomalías — ver `docs/MODULARIZATION.md`).
`loadLubricationLogic.js` se actualizó para leer cada función del archivo
real donde vive ahora; los tests en sí no cambiaron su forma de afirmar
comportamiento.

## Cómo se prueba código que no es un módulo (sin `export`)

`app.js`/`db.js`/`sync.js` son scripts clásicos pensados para `<script>` en
el navegador — no tienen `export`, así que no se pueden `import` directo en
un test. En vez de reescribir o duplicar la lógica a mano (lo cual dejaría
de proteger el código real), `tests/helpers/extractFromSource.js`:

1. Lee el archivo fuente como texto plano.
2. Ubica una declaración top-level por nombre (`function NOMBRE(...)` o
   `const NOMBRE = ...`) contando el anidamiento real de `(`, `{`, `[` para
   encontrar dónde termina — no es una copia manual, es el texto **exacto**
   del archivo.
3. Concatena las declaraciones pedidas (en orden, para que las que dependen
   de otras las encuentren) y las ejecuta con `new Function(...)`, devolviendo
   un objeto con esas funciones/constantes listas para usar en un test.

Si el código fuente cambia, la próxima corrida de `npm test` extrae y prueba
la versión nueva automáticamente — no hay copia que se pueda desactualizar.

**Limitación conocida:** el extractor cuenta caracteres `(`, `{`, `[` sin
analizar si están dentro de un string o comentario. Funciona bien para las
funciones ya identificadas aquí; si en el futuro se agrega una función a la
lista de prueba y falla la extracción, probablemente sea por esto.

## Qué se prueba

| Área (Paso 7) | Archivo de prueba | Función real probada | Casos clave |
|---|---|---|---|
| Turno Día / Turno Noche / cruce de medianoche | `turnos.test.js` | `currentShiftId()`, `dentroDeSuTurno()` | 17:59, 18:00, 23:59, 00:00, 00:01, 05:59, 06:00; ventana de avisos con margen antes/después del turno |
| Engrase pendiente/realizado/vencido; plan por frecuencia de horómetro | `estado-engrase.test.js` | `statusFor()` | DETENIDO, SIN PLAN, frecuencia 0/negativa, `lastGreaseHour` inconsistente, horómetro exacto/mayor/menor a la frecuencia, horómetro null, horómetro inválido (bug documentado, ver abajo) |
| Matriz semanal (plan por día/turno) | `matriz-semanal.test.js` | `weekdayStatusFor()` | sin días asignados, programado hoy, al día (realizado), vencido (no realizado), reprogramación puntual |
| Criticidad de anomalía automática; no duplicar | `anomalias.test.js` | `CRITICIDAD_POR_MOTIVO` (real) + regla de no-duplicado (documentada) | motivo → criticidad; anomalía cerrada no cuenta como "ya existe" |
| Validación de horómetro | `horometro-validacion.test.js` | `validateHourmeterChange()` | negativo, NaN, menor al anterior, salto grande (advertencia), límite exacto de 500h |
| Borrado lógico `active:true/false` | `active-flag.test.js` | `stamp()` (real) + filtro `active!==false` (documentado) | default `active:true`, no se sobrescribe `active:false` existente, registros sin el campo siguen visibles |
| Sincronización: qué sube, orden de un dispositivo nuevo | `sync-dirty-check.test.js` | reglas documentadas (`_pushedVersion`, orden pull/push) | nuevo/editado/sincronizado; primera sincronización baja antes de subir |
| Seguridad básica | `seguridad-basica.test.js` | `esc()` (real) + `stamp()` con objetos incompletos | XSS vía `<script>`, comillas, `&`; null/undefined; objetos con campos desconocidos |

**"(real)"** = se ejecuta el código extraído verbatim del archivo fuente.
**"(documentada)"** = la regla se reproduce en la prueba misma porque la
función real está demasiado acoplada a IndexedDB/red para ejecutarse aislada
(ver siguiente sección) — protege la *regla de negocio*, no literalmente la
misma línea de código.

## Qué todavía NO se puede probar (requiere extracción durante la modularización)

- **`estadoCelda()`** (dentro de `renderMatrizSemanal()`, `app.js`): calcula
  REALIZADO / NO REALIZADO / PENDIENTE HOY / futuro para cada celda de la
  grilla. Es una función **anidada** que cierra sobre variables locales
  (`plans`, `records`, `hoy`) cargadas de IndexedDB — no es una declaración
  top-level, no se puede extraer de forma aislada sin refactor.
- **`createAutoAnomalies()`** (`app.js`): genera anomalías automáticas desde
  puntos no atendidos. Llama `DB.allActive`/`DB.put` y lee `App.currentUser`
  directamente — necesita una base de datos real o un mock completo de
  IndexedDB para probarse de punta a punta. Se probó por separado la tabla
  `CRITICIDAD_POR_MOTIVO` (real) y la regla de no-duplicado (documentada).
- **`Sync.pushAll()` / `Sync.pullAll()` / `Sync.fullSync()`** (`sync.js`):
  hacen `fetch()` real contra Supabase y leen/escriben IndexedDB. Se
  documentaron por separado, con mocks locales, las reglas de negocio que
  gobiernan (qué se sube, en qué orden sincroniza un dispositivo nuevo,
  cómo se resuelve un registro entrante que ya coincide) — pero el
  código real de estas tres funciones no se ejecuta en las pruebas.
- **`DB.allActive()` / `DB.all()` / `DB.put()` / `DB.get()`** (`db.js`): usan
  IndexedDB real (`indexedDB.open(...)`, transacciones). No hay polyfill de
  IndexedDB instalado en esta fase (por ejemplo `fake-indexeddb`) — se
  probó el filtro `active !== false` como regla documentada, y `stamp()`
  (que sí es independiente de IndexedDB) de forma real.
- **Todo lo que dibuja HTML** (`render*()`): estas pruebas son de lógica
  pura, no de interfaz — la validación visual/funcional de pantallas sigue
  siendo manual (ver `docs/MANUAL_VALIDATION.md`).

## Bug real descubierto al escribir estas pruebas

**`ENGRASE-001`** — `statusFor()` no detecta un horómetro con valor no
numérico (`undefined` o un string como `"abc"`) como dato inconsistente;
lo muestra como "AL DÍA" en vez de marcar un error. Documentado en
`docs/BUG_REGISTER.md`, **no corregido** en esta fase (no se pidió modificar
lógica de negocio; el bug se descubrió, se protegió con una prueba que
documenta el comportamiento actual, y se registró para decidir después si se
corrige).

## Limitaciones generales de esta fase

- Estas pruebas corren en Node, sin navegador real ni WebView — no
  reemplazan la validación manual en dispositivo (`docs/MANUAL_VALIDATION.md`,
  `docs/TEST_MATRIX.md`), que sigue siendo necesaria para IndexedDB real,
  Service Worker, Capacitor, cámara, QR, OneSignal, notificaciones, y la
  interfaz en sí.
- No se instaló ningún polyfill de IndexedDB ni se mockeó `fetch` — por
  diseño, para no introducir más infraestructura de la necesaria en esta
  fase ("no gran refactor").
- 77 pruebas en 8 archivos — deliberadamente acotado a lo que protege
  ENGRASE / TURNOS / HORÓMETROS / ANOMALÍAS / CUMPLIMIENTO / MATRIZ / SYNC,
  no cobertura artificial.
