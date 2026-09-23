# MODULARIZACIÓN JAVASCRIPT — FASE 1

Fecha: 2026-09-23
Rama: `migration-typescript`
Objetivo: empezar a separar `app.js` en piezas más pequeñas, probadas y de
bajo riesgo, como paso previo a una futura migración a TypeScript — sin
introducir Vite, sin ES modules, sin tocar Supabase/IndexedDB/`sync.js`.

## Decisión de arquitectura: scripts clásicos, no ES modules

**El problema:** todavía no hay Vite ni ningún bundler. `index.html` carga
`db.js`, `sync.js` y `app.js` como scripts clásicos (`<script src="...">`,
sin `type="module"`), y así los sirve GitHub Pages y así los empaqueta
Capacitor en `assets/public`. Cualquier función que se mueva a un archivo
nuevo tiene que seguir estando disponible para `app.js` sin romper ese
esquema.

**Se evaluó y se descartó** usar `<script type="module">` con
`export`/`import` reales: aunque los navegadores modernos (y el WebView de
Capacitor, que es Chromium) sí soportan ES modules nativos sin bundler, esto
habría obligado a:
- Convertir `app.js` también a módulo (o mantener una mezcla rara de
  módulos + scripts clásicos con un puente global igual de manual que la
  alternativa elegida, pero más código).
- Revisar con cuidado que ningún `<script>` de terceros (Chart.js, xlsx,
  jsPDF, QRious, jsQR, OneSignal, todos cargados como scripts clásicos)
  tuviera algún problema de orden/scope al mezclarse con módulos.

Eso es más cambio del que esta fase pide ("no gran refactor").

**Estrategia elegida (temporal, segura):** los archivos nuevos en
`src/core/` son **scripts clásicos comunes y corrientes** — exactamente el
mismo patrón que ya usan `db.js`, `sync.js` y `app.js`. No tienen
`export`/`import`. Sus funciones (`function nombre() {...}`) y constantes
(`const NOMBRE = {...}`) quedan disponibles como **globales compartidos**
entre todos los `<script>` de la página, tal como ya ocurría antes de
separarlos — los navegadores comparten un mismo entorno léxico global entre
todos los scripts clásicos de un documento. `app.js` sigue llamando
`currentShiftId()`, `statusFor()`, etc. exactamente igual que antes; no se
tocó ni un solo punto de llamada.

Esto significa que, el día que se introduzca un bundler de verdad (Vite),
estos mismos archivos son un punto de partida natural para convertirse en
módulos reales con `export`/`import` — el trabajo de aislar la lógica ya
está hecho, solo faltaría cambiar la sintaxis de exportación.

## Qué salió de `app.js` y por qué

Cuatro áreas, en el orden pedido, todas de **riesgo BAJO** (ver tabla de
análisis abajo) y todas ya cubiertas por pruebas automatizadas antes de
moverlas:

| Archivo nuevo | Qué contiene | Por qué se extrajo |
|---|---|---|
| `src/core/shifts.js` | `currentShiftId()`, `dentroDeSuTurno()` | Turnos Día/Noche y ventana de avisos — lógica pura, con pruebas (`turnos.test.js`, 13 casos) |
| `src/core/hourmeter.js` | `validateHourmeterChange()` | Validación de horómetro — lógica pura, con pruebas (`horometro-validacion.test.js`, 8 casos) |
| `src/core/lubrication-status.js` | `fmt()`, `WEEKDAY_NAMES`, `mostRecentAssignedDate()`, `weekdayStatusFor()`, `statusFor()` | Estado de engrase (pendiente/realizado/vencido, por frecuencia de horómetro y por día/turno) — con pruebas (`estado-engrase.test.js` 17 casos, `matriz-semanal.test.js` 7 casos). Incluye la corrección `ENGRASE-001` ya aplicada. `fmt()` se movió junto porque `statusFor()`/`validateHourmeterChange()` la usan directamente — no era un objetivo en sí. |
| `src/core/anomalies.js` | `CRITICIDAD_POR_MOTIVO` | Tabla de criticidad automática por motivo — con pruebas (`anomalias.test.js`, parte) |

**Nada se duplicó:** cada función se **movió** (se borró de `app.js`,
dejando un comentario que dice dónde quedó) — no quedó una copia en cada
lado. `app.js` sigue usando los mismos nombres, que ahora resuelven a los
globales definidos en los archivos nuevos.

## Tabla de análisis (Paso B1)

| Función | Archivo actual (antes) | Líneas aprox. | Dependencias | Tests existentes | Riesgo | ¿Se extrajo? |
|---|---|---|---|---|---|---|
| `currentShiftId` | app.js | ~1081 | `App.generalSettings` | turnos.test.js | BAJO | Sí |
| `dentroDeSuTurno` | app.js | ~494 | `App.currentUser`, `App.generalSettings`, `currentShiftId` | turnos.test.js | BAJO | Sí |
| `horaAjustadaAlTurno` | app.js | ~520 | `App.currentUser`, `App.generalSettings`, `currentShiftId` | ninguno directo | MEDIO | No — sin prueba directa todavía, alimenta la programación de notificaciones locales; queda para una fase posterior con su propia prueba primero |
| `validateHourmeterChange` | app.js | ~530 | ninguna (pura) | horometro-validacion.test.js | BAJO | Sí |
| `confirmHourmeterChange` | app.js | ~543 | `alert`/`confirm` (navegador), `validateHourmeterChange` | ninguno | ALTO | No — acoplada a UI del navegador |
| `WEEKDAY_NAMES` | app.js | ~1046 | ninguna | matriz-semanal.test.js (indirecta) | BAJO | Sí |
| `mostRecentAssignedDate` | app.js | ~1049 | `WEEKDAY_NAMES` | matriz-semanal.test.js (indirecta) | BAJO | Sí |
| `weekdayStatusFor` | app.js | ~1065 | `mostRecentAssignedDate`, `WEEKDAY_NAMES`, `DB.allActive` (opcional) | matriz-semanal.test.js | BAJO | Sí |
| `statusFor` | app.js | ~1102 | `weekdayStatusFor`, `fmt`, `DB.allActive` (opcional) | estado-engrase.test.js | BAJO | Sí |
| `fmt` | app.js | ~1031 | ninguna (pura) | usada en estado-engrase.test.js | BAJO | Sí (junto con estado de engrase, por dependencia directa) |
| `computeAllStatuses` | app.js | ~1147 | `DB.allActive` (siempre) | ninguno directo | ALTO | No — siempre toca IndexedDB, no es pura |
| `CRITICIDAD_POR_MOTIVO` | app.js | ~4666 | ninguna (constante) | anomalias.test.js | BAJO | Sí |
| `createAutoAnomalies` | app.js | ~4678 | `DB.allActive/put`, `App.currentUser`, `uid`, `stamp`, `logAudit` | ninguno directo | ALTO | No — fuertemente acoplada a IndexedDB |
| `estadoCelda` (Matriz Semanal) | app.js (anidada en `renderMatrizSemanal`) | ~3849 | variables locales cerradas (`plans`, `records`, `hoy`) | ninguno directo | ALTO | No — función anidada, no top-level, requiere refactor |

## Cómo se prueba después de la modularización

`tests/helpers/loadLubricationLogic.js` ahora lee cada función/constante de
su archivo real correspondiente (`src/core/*.js` o `app.js`, según dónde
quedó) y las combina en un solo scope de prueba — exactamente el mismo
mecanismo de extracción de texto fuente que ya se usaba (ver
`docs/AUTOMATED_TESTS.md`), solo que ahora algunas piezas vienen de más de
un archivo. Ningún test cambió su forma de afirmar comportamiento — solo
cambió DE DÓNDE se lee el código real.

## Compatibilidad verificada

- `node --check` en los 6 archivos tocados/creados: OK.
- `npm test`: 82/82 PASS después de cada una de las 4 extracciones (se
  corrió la suite completa después de cada área, no solo al final).
- `index.html`: se agregaron 4 `<script src="src/core/...">` nuevos, justo
  antes de `app.js` y después de `db.js`/`sync.js` — mismo patrón que ya
  existía, sin `type="module"`, sin cambiar el resto del documento.
- `sw.js`: se agregaron las 4 rutas nuevas a `ASSETS` (la lista de
  precaché), para que el modo offline siga sirviendo estos archivos — sin
  esto, la app dejaría de tener esta lógica disponible sin conexión. Es el
  único punto donde esta fase toca `sw.js`, y solo se agregaron rutas a una
  lista de datos — no se tocó ninguna lógica de cacheo/fetch/activate.
- `tools/sync-web-to-android.mjs`: **no se modificó** — detectó los 4
  archivos nuevos automáticamente (lee las referencias `src=` de
  `index.html`), incluida la subcarpeta `src/core/`, sin ningún cambio en el
  script de sincronización.
- `npx cap sync android`: copió correctamente la subcarpeta
  `src/core/` dentro de `assets/public` (Capacitor preserva rutas
  anidadas).
- `./gradlew assembleDebug`: build exitoso.

## Qué NO se tocó en esta fase

`renderMatrizSemanal()`/`estadoCelda()`, `createAutoAnomalies()`,
`computeAllStatuses()`, IndexedDB, `DB.allActive/put/get`,
`Sync.pushAll/pullAll/fullSync`, fetch a Supabase, fotografías, el resto de
`sw.js` (lifecycle/estrategia de cacheo), notificaciones, y toda la UI
(`render*`). `app.js` sigue teniendo toda esa lógica exactamente igual que
antes.

## Siguiente fase natural

Continuar con `estadoCelda()` (requiere primero volverla una función
top-level, no anidada, antes de poder probarla y extraerla) y con
`createAutoAnomalies()` (requiere decidir cómo mockear IndexedDB — por
ejemplo `fake-indexeddb` — antes de poder probarla de punta a punta).
