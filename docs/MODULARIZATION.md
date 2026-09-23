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
| `createAutoAnomalies` (persistencia) | app.js | ~4651 | `DB.allActive/put`, `App.currentUser`, `uid`, `stamp`, `logAudit`, `evaluateAnomalyActions` | ninguno directo | ALTO | No — sigue en app.js, fuertemente acoplada a IndexedDB (Fase 2 solo extrajo la decisión, ver abajo) |
| `evaluateAnomalyActions`/`hayPuntosOAnomaliaHorometro` (decisión de anomalías) | app.js (dentro de `createAutoAnomalies`) | ~4651 | `CRITICIDAD_POR_MOTIVO`, `fmtDate` | anomaly-actions.test.js (Fase 2, 22 casos) | BAJO | Sí — Fase 2 |
| `estadoCelda` (Matriz Semanal) | app.js (antes anidada en `renderMatrizSemanal`) | ~3722 | `plans`, `records`, `hoy` (ahora recibidos como parámetros, no cerrados) | matriz-estado-celda.test.js (Fase 2, 15 casos) | BAJO | Sí — Fase 2 (se cambió la firma para recibir los datos explícitamente, ver sección Fase 2) |

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

## Validación en dispositivo real (2026-09-23, Samsung SM-S938B)

**MODULARIZACIÓN JS FASE 1: PROBADA EN ANDROID REAL.**

- `adb install -r` sobre la instalación existente, preservando datos.
- App arranca sin `FATAL EXCEPTION`; logcat confirma que los 4 archivos se
  solicitan y cargan sin error: `Capacitor: Handling local request:
  https://localhost/src/core/{shifts,hourmeter,lubrication-status,anomalies}.js`.
- Pruebas manuales M1-M6 (login, turno, estados de engrase con datos
  reales, horómetro, anomalías, cierre y reapertura completa): **PASS**.
- **SERVICE WORKER: PROBADO OFFLINE CON NUEVOS MÓDULOS** — con el
  dispositivo en modo avión, la app cargó con normalidad, el turno y los
  estados de engrase se siguieron mostrando correctamente con los datos ya
  guardados localmente. Confirma que `sw.js` precachea correctamente los 4
  archivos nuevos.
- Durante la validación se encontraron dos hallazgos, ambos confirmados por
  investigación (timing de logcat / presencia en el commit baseline) como
  **NO relacionados con esta modularización** — ver `docs/BUG_REGISTER.md`:
  `NOTIF-ANDROID-001` (SDK Web de OneSignal) y `UI-ANDROID-005` (diseño de
  tabla del Dashboard, preexistente).

## Qué NO se tocó en esta fase (Fase 1)

`renderMatrizSemanal()`/`estadoCelda()` (extraída en la Fase 2, ver abajo),
`createAutoAnomalies()` (su decisión se extrajo en la Fase 2; la
persistencia sigue en `app.js`), `computeAllStatuses()`, IndexedDB,
`DB.allActive/put/get`, `Sync.pushAll/pullAll/fullSync`, fetch a Supabase,
fotografías, el resto de `sw.js` (lifecycle/estrategia de cacheo),
notificaciones, y toda la UI (`render*`). `app.js` sigue teniendo toda esa
lógica exactamente igual que antes.

## Siguiente fase natural (histórico — ya resuelto en Fase 2, ver abajo)

Continuar con `estadoCelda()` (requiere primero volverla una función
top-level, no anidada, antes de poder probarla y extraerla) y con
`createAutoAnomalies()` (requiere decidir cómo mockear IndexedDB — por
ejemplo `fake-indexeddb` — antes de poder probarla de punta a punta).

---

# MODULARIZACIÓN JAVASCRIPT — FASE 2

Fecha: 2026-09-23
Rama: `migration-typescript`
Objetivo: extraer y probar la lógica de la **Matriz Semanal** (`estadoCelda`)
y de la **decisión de anomalías automáticas** (`createAutoAnomalies`) — las
dos piezas que la Fase 1 había dejado pendientes por estar anidadas o
acopladas a IndexedDB. Mismas reglas que la Fase 1: sin Vite, sin ES
modules, sin tocar Supabase/IndexedDB/`sync.js`/`db.js`.

## Matriz Semanal: `estadoCelda()` → `src/core/weekly-matrix.js`

**El problema de la Fase 1:** `estadoCelda()` vivía como función **anidada**
dentro de `renderMatrizSemanal()`, cerrando sobre `plans`/`records`/`hoy`
(variables locales cargadas de IndexedDB dentro de esa misma función). Una
función anidada así no es una declaración top-level — no se puede extraer
ni probar de forma aislada sin antes desacoplarla de ese cierre.

**La solución:** se cambió la firma para que reciba esos datos
explícitamente — `estadoCelda(eq, fecha, plans, records, hoy)` — en vez de
cerrarlos del scope externo. Con eso ya es una función pura top-level,
movible tal cual a `src/core/weekly-matrix.js`. Los 4 sitios de llamada
dentro de `renderMatrizSemanal()` (la grilla HTML, los contadores de KPIs,
la exportación a Excel) se actualizaron para pasarle esos tres datos ya
cargados — el comportamiento es idéntico, solo cambió de dónde saca los
datos la función.

**Reglas conservadas exactamente** (documentadas primero, luego extraídas —
no se adivinó nada):
- 5 estados de celda: `vacio` (no le toca ese día o no hay plan), `hecho`
  (hay registro para esa fecha exacta), `futuro` (fecha posterior a hoy),
  `pendiente` (es hoy, sin registro), `no_realizado` (fecha pasada, sin
  registro, con `diasAtras`).
- **Hallazgo importante confirmado leyendo el código, no asumido:**
  `estadoCelda()` **no considera** `plan.reprogramadoHasta`/
  `reprogramadoMotivo` — a diferencia del Dashboard (`statusFor()`, que sí
  la usa). La reprogramación puntual solo afecta las tarjetas de estado del
  Dashboard, nunca la grilla de la Matriz Semanal. Este comportamiento ya
  existía antes de la extracción; no se cambió ni se "arregló".
- `active:false`: `estadoCelda()` no filtra por `active` — asume que
  `plans`/`records` ya vienen filtrados por `DB.allActive()`, igual que
  antes. Es responsabilidad de quien la llama, no de la función pura.

`WEEKDAY_NAMES` (definida en `lubrication-status.js`) se referencia como
global compartido, igual que hace el resto de `src/core/*.js`.

**Pruebas:** `tests/unit/matriz-estado-celda.test.js`, 15 casos — los 5
estados, límites de semana (domingo→lunes), cambio de mes, cambio de año,
reprogramación ignorada (documentando el comportamiento real), `active`
ignorado, registros duplicados/atrasados, y guardas de fecha
(`toMatchObject` sobre resultados reales, sin inventar expectativas).

## Anomalías automáticas: decisión vs. persistencia

**El problema:** `createAutoAnomalies()` mezclaba en una sola función la
**decisión de negocio** (¿crear una anomalía nueva? ¿actualizar una
existente para no duplicar? ¿no hacer nada?) con la **persistencia**
(`DB.allActive`, `DB.put`, `logAudit`). Eso la hacía imposible de probar
sin simular IndexedDB.

**La solución:** se extrajo la decisión a
`src/core/anomaly-actions.js`:
- `evaluateAnomalyActions(record, equipment, openAnomalies)` — pura, recibe
  el registro de engrase, el equipo y la lista de anomalías abiertas ya
  cargada, y devuelve `{ acciones, avisos }`. Cada acción es
  `{ tipo: 'crear', anomalia: {...} }` o
  `{ tipo: 'actualizar', anomaliaId, cambios: {...} }`. No ejecuta
  `DB.put`, `DB.allActive`, `fetch`, Supabase ni toca el DOM.
- `hayPuntosOAnomaliaHorometro(record)` — guarda de entrada que evita la
  llamada a `DB.allActive()` cuando el registro no tiene nada que evaluar
  (mismo comportamiento que el `if` temprano que ya existía).

`createAutoAnomalies()` en `app.js` sigue siendo la única que toca
IndexedDB: llama a `evaluateAnomalyActions()`, y luego aplica cada acción
con `DB.put(stamp(...))` — el mismo patrón de autoría que ya existía se
preservó tal cual (las anomalías **nuevas** se firman con
`record.userName`, las **actualizaciones** de contador se firman con
`App.currentUser.name` — así estaba antes, no es un cambio).

**Reglas conservadas exactamente (confirmadas leyendo el código real):**
- El duplicado se detecta **solo por `autoPointId`**, sin comparar
  `equipmentId` dentro de la función pura — el filtrado por equipo ocurre
  ANTES, en `app.js` (`abiertas = ... .filter(a => a.equipmentId ===
  equipment.id ...)`). Es responsabilidad de quien arma `openAnomalies`,
  documentado explícitamente con una prueba.
- Motivo → criticidad usa `CRITICIDAD_POR_MOTIVO` (Fase 1,
  `anomalies.js`), con `'Media'` como *fallback* para motivos desconocidos.
- El horómetro dañado/ilegible genera su propia anomalía con
  `autoPointId: '__horometro__'`, salvo cuando el motivo es exactamente
  `'El equipo no tiene horómetro'` (no es una falla, no genera anomalía).
- Contador `repeticiones`: arranca en 1 al crear, sube de a 1 en cada
  actualización (con *fallback* a 1 si el dato viejo no tiene el campo).

**Pruebas:** `tests/unit/anomaly-actions.test.js`, 22 casos — crear/
actualizar/no-duplicar por punto y por horómetro, los 3 niveles de
criticidad pedidos (`Falla mecánica`→Crítica, `Grasera dañada`→Alta,
`Punto inaccesible`→Media) más el *fallback* de motivo desconocido,
contador de repetición (con y sin valor previo), datos incompletos
(`reason`/`photos` nulos), y la guarda `hayPuntosOAnomaliaHorometro()`.

## Service Worker (Fase 2)

Se agregaron `src/core/weekly-matrix.js` y `src/core/anomaly-actions.js` a
`ASSETS` en `sw.js`, subiendo `CACHE` dos veces (`v24` → `v25` al agregar
la Matriz, `v25` → `v26` al agregar Anomalías) — cada archivo nuevo
necesita su propio bump para que los dispositivos ya instalados lo
precacheen; sin esto, la Matriz o las Anomalías podrían fallar en modo
offline en una instalación existente hasta el próximo cambio de versión.
No se tocó ninguna otra parte de `sw.js` (estrategia de cacheo/fetch/
activate sigue igual que en la Fase 1 y en `NOTIF-ANDROID-001`).

## Qué queda pendiente (fuera de alcance de esta fase)

- `createAutoAnomalies()` sigue en `app.js`, aplicando las acciones
  decididas — no se migró a `src/core/` porque sigue fuertemente acoplada
  a IndexedDB (`DB.allActive`/`DB.put`) y a `logAudit()`, y esta fase
  explícitamente no tocaba persistencia.
- `renderMatrizSemanal()` (el render/DOM/toolbar/exportación a Excel/
  impresión) sigue en `app.js` — solo se extrajo `estadoCelda()`, la
  decisión pura de cada celda.
- `computeAllStatuses()` (Dashboard, siempre toca IndexedDB) — pendiente,
  como ya decía la Fase 1.
- `horaAjustadaAlTurno()`/`confirmHourmeterChange()` — igual que en Fase 1,
  sin prueba directa todavía.

## Compatibilidad verificada (Fase 2)

- `node --check` en `app.js`, `weekly-matrix.js`, `anomaly-actions.js`,
  `sw.js`: OK.
- `npm test`: 88 → 103 (Matriz) → 125 (Anomalías), 100% PASS en cada paso.
- `tools/sync-web-to-android.mjs`: no se modificó, detectó los 2 archivos
  nuevos automáticamente.
- `npx cap sync android`: sin cambios en archivos versionados de Android
  fuera de `www`/`assets/public`.
- `./gradlew assembleDebug`: PASS.
- Validado en Samsung SM-S938B real: instalación con `adb install -r`
  preservando datos (`firstInstallTime` sin cambios), app arranca sin
  `FATAL EXCEPTION` ni errores nuevos en `Capacitor/Console`, Dashboard/
  Matriz/Anomalías abren con datos reales sin errores.
- No duplicación: `estadoCelda`/`evaluateAnomalyActions`/
  `hayPuntosOAnomaliaHorometro` existen en un único archivo cada una
  (`src/core/`), `app.js` ya no tiene una copia de ninguna de las tres.
