# REGISTRO DE BUGS

## UI-ANDROID-001 — Barra de búsqueda superior se superpone con otros controles en Android

- **Fecha:** 2026-09-23
- **Prioridad:** P2
- **Estado:** CORREGIDO — PROBADO EN DISPOSITIVO REAL — PASS
- **Dispositivo:** Samsung SM-S938B (Android, vía APK debug instalado por ADB)
- **Descripción:** en la barra superior (`.topbar`), el campo de búsqueda
  rápida (`#quick-find`) se renderiza superpuesto sobre el título
  ("DASHBOARD", lo tapa parcialmente) y sobre el indicador de sincronización
  (`#conn-badge`, también tapado parcialmente), en vez de acomodarse debajo o
  reducir el resto de los controles. El badge de turno ("Turno Día") queda
  visualmente apretado contra el borde derecho.
- **Evidencia:** `docs/evidence/UI-ANDROID-001_before.png` (captura real del
  dispositivo, sin datos sensibles — solo KPIs genéricos del dashboard).
- **Causa raíz:** `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\styles.css`,
  regla `.topbar-right` (bloque "Shell", cerca de la línea 289): es un
  contenedor `display:flex` con `gap:14px` que agrupa el buscador, el botón
  de tema, el indicador de conexión y el badge de turno, **sin
  `flex-wrap`**. En el breakpoint móvil (`@media (max-width: 860px)`) solo
  el campo de búsqueda se reduce de ancho; el resto de los controles
  mantiene su tamaño de escritorio. En un viewport de ~360-412px (teléfono
  real), la suma de todos los controles en una sola fila sin posibilidad de
  saltar de línea excede el ancho disponible, y el navegador termina
  superponiendo el contenido en vez de recortarlo limpiamente.
- **Se descartó** como causa el área segura del sistema (notch/status bar):
  no se usa `env(safe-area-inset-top)` en ningún lado del CSS, no hay
  configuración de edge-to-edge ni plugin `@capacitor/status-bar` en el
  proyecto Android, y el build tiene `targetSdk=34` (confirmado con `adb
  shell dumpsys package`), por debajo del umbral donde Android fuerza
  edge-to-edge — el WebView no dibuja contenido detrás de la barra de
  estado en este build, así que no es la causa.
- **Impacto:** por ahora solo se confirmó superposición **visual**. No hay
  evidencia todavía de que el buscador o el botón de sincronización dejen
  de responder al toque — si al validar la corrección se confirma que algún
  control quedó inutilizable por el solapamiento, esta entrada debe subir a
  **P1**.
- **Corrección (dos pasos, ambos en la fuente canónica
  `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`, sincronizados a `www` y Android):**
  1. Commit `5751a21` — `fix: prevent mobile search bar overlap`: se agregó
     `flex-wrap: wrap` y `justify-content: flex-end` a `.topbar-right`.
  2. Commit `1867ba5` — `fix: collapse search bar into icon on narrow
     screens`: a pedido del usuario ("se mira feo... que no aparezca arriba
     de los demás controles"), se rediseñó el comportamiento móvil: el
     buscador arranca colapsado mostrando solo el ícono de lupa
     (`#quick-find-toggle`, reutilizando `.icon-search` ya existente); al
     tocarlo, el campo se expande (`:focus-within`) y **oculta temporalmente
     sus hermanos** (tema, sincronización, turno) para quedar en la misma
     línea sin superponerse ni empujarlos a otra fila; al perder el foco,
     todo vuelve al estado colapsado.
- **Validación:** confirmada visualmente por el usuario en el dispositivo
  real (Samsung SM-S938B) tras instalar el APK debug con ambos commits.

## UI-ANDROID-002 — Ícono de cerrar sesión del Lubricador no usa el sistema de íconos del proyecto

- **Fecha:** 2026-09-23
- **Prioridad:** P3 (cosmético, el botón funciona correctamente — el `id="btn-logout"` y su listener no cambiaron)
- **Estado:** CORREGIDO EN CÓDIGO — PENDIENTE DE VALIDACIÓN VISUAL DEL USUARIO
- **Reportado por:** usuario ("corrige el ícono de cerrar sesión de los lubricos")
- **Descripción:** en la barra superior simplificada del rol Lubricador
  (`.lub-topbar`), el botón de cerrar sesión usaba el carácter Unicode
  `⏻` (U+23FB) en vez del ícono SVG en máscara (`.icon-logout`) que ya usa
  el mismo botón en el menú lateral de los demás roles. Los caracteres
  Unicode de este tipo se renderizan de forma inconsistente entre
  dispositivos/fuentes de emoji (en Samsung, con estilo y color distintos al
  resto de los íconos de la app), lo cual se veía fuera de lugar.
- **Causa raíz:** `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\app.js`, función
  `bootLubricador()`, botón `#btn-logout` con el glifo `⏻` en vez de usar el
  helper `ic('logout')` ya usado en el resto del proyecto.
- **Corrección:** commit `86ff816` — `fix: use consistent logout icon for
  lubricador role`. Se reemplazó el carácter por `${ic('logout')}`
  (reutilizando `.icon-logout`, ya definido en `styles.css`) y se agregó
  `.lub-topbar-right .btn-icon { width: 18px; height: 18px; margin-right: 0; }`
  para que el ícono tenga un tamaño de toque cómodo dentro de esa barra,
  consistente con el resto de los botones de ícono del proyecto.
- **Validación:** sincronizado a `www`/Android, recompilado e instalado en
  el dispositivo real (Samsung SM-S938B) preservando datos. **Aún no
  confirmado visualmente por el usuario** — pendiente de que inicie sesión
  con un usuario de rol Lubricador y revise el ícono.

## UI-ANDROID-003 — Topbar de Administrador excesivamente alto en móvil

- **Fecha:** 2026-09-23
- **Prioridad:** P3 UX (no tapa contenido ni impide operar — reduce el área
  útil de trabajo en pantalla, pero todo sigue siendo usable)
- **Estado:** CORREGIDO — PROBADO EN DISPOSITIVO REAL — PASS
- **Reportado por:** usuario, durante la prueba manual LOGIN-01+DASH-01
  ("todavía se ve demasiado grande... ocupa demasiado espacio vertical")
- **Dispositivo:** Samsung SM-S938B
- **Causa raíz:** dos factores combinados en `styles.css`:
  1. `.icon-btn` tiene `min-height: var(--tap)` (44px, regla de
     accesibilidad "para usar con guantes", intencional y **no se toca**).
     Con dos botones de ícono (buscador colapsado, tema) más el padding del
     `.topbar` (`10px 12px` en móvil), la barra ya mide ~64px de alto —
     dentro de lo esperado, pero...
  2. `.topbar-right` (desde el commit `5751a21`) tiene `flex-wrap: wrap` sin
     que sus hijos (`#conn-badge`, `.topbar-shift`) tuvieran ningún límite de
     ancho en móvil. `#conn-badge` puede mostrar textos largos ("SOLO LOCAL
     · SIN SERVIDOR CONFIGURADO", "SINCRONIZADO PARCIAL (N con error)"), así
     que en un viewport de ~360-412px el contenido de `.topbar-right` no
     cabía en una sola línea ni siquiera en reposo (sin buscador expandido),
     y `flex-wrap` lo mandaba a una segunda fila **todo el tiempo** — no
     solo en los casos límite para los que se pensó. Esa segunda fila
     constante es lo que hacía ver la barra "demasiado alta".
- **Corrección:** en la fuente canónica
  (`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\styles.css`, dentro del
  `@media (max-width: 900px)` ya existente), sin tocar HTML ni JS:
  - `.topbar`: padding `10px 12px` → `7px 10px`; `gap` 12px → 8px.
  - `.topbar-title`: `20px→15px` en móvil, `max-width:40vw` +
    elipsis (para que un título largo no empuje al resto).
  - `.topbar-right`: `gap` 14px → 8px.
  - `.topbar-shift` y `.conn-badge`: padding y `font-size` reducidos;
    `#conn-badge` además con `max-width:120px` + elipsis, para que sus
    textos largos ya no rompan el ancho disponible (el texto completo
    sigue existiendo en el DOM — no se oculta información, solo se
    trunca visualmente el badge; tocarlo sigue sincronizando igual).
  - Los botones de ícono (buscador, tema) **no cambiaron de tamaño** —
    siguen en el mínimo táctil de 44px, tal como se pidió.
  - Resultado esperado: ~58-60px de alto total en móvil (padding 7+7=14px +
    44px del ícono más alto), dentro del rango 56-64px pedido, con todo en
    una sola fila en la mayoría de los casos.
- **Evidencia:** no se pudo capturar una screenshot "después" por ADB — la
  pantalla del dispositivo se bloqueaba (timeout muy corto) en cada intento
  inmediatamente después de reabrir la app. El "antes" tampoco quedó
  capturado por el mismo motivo; la corrección se diseñó a partir de la
  descripción del usuario más el análisis estático del CSS.
- **Iteraciones adicionales** (a pedido del usuario, mismo bug/hilo de
  trabajo, todas sincronizadas/recompiladas/instaladas igual que arriba):
  - Commit `c126f82` — se quitó el botón de tema (🎨) del topbar por
    completo (se movió a Configuración/Ayuda, ver changelog), liberando
    espacio horizontal adicional.
  - Commit `d6b3c34` — el badge de turno muestra solo el ícono (☀/☾) en
    móvil en vez de "Turno Día"/"Turno Noche" (el texto completo queda en
    el atributo `title`), para que el topbar quede en una sola línea.
- **Validación:** confirmada visualmente por el usuario en el dispositivo
  real (Samsung SM-S938B) — topbar de Administrador en una sola línea,
  altura compacta. **PASS.**

## BUG-004 — Lubricador ve la tabla de escritorio en vez de sus tarjetas después de sincronizar

- **Fecha:** 2026-09-23
- **Prioridad:** P1 (bloquea el flujo principal de registro de engrase para
  el rol Lubricador — el motivo de ser del sistema)
- **Estado:** CORREGIDO EN CÓDIGO — PENDIENTE DE VALIDACIÓN VISUAL/FUNCIONAL
  DEL USUARIO
- **Reportado por:** usuario, durante la prueba manual ADM-01, navegando por
  la pantalla "Mi Turno" del rol Lubricador ("las tarjetas no las muestra
  como se debe")
- **Dispositivo:** Samsung SM-S938B (pero el bug **no es específico de
  Android** — vive en `app.js`, compartido byte a byte con la versión WEB,
  así que afecta igual a `CONTROL_ENGRASE_WEB`)
- **Evidencia:** `docs/evidence/lub-turno-cards-check.png` — captura real
  del dispositivo mostrando, dentro del shell de Lubricador (topbar, tira de
  usuario, bottom-nav "Mi Turno" activo), el contenido de la tabla
  `<table class="data-table">` de `renderTurno()` ("Plan de engrase del
  turno — Día", "5 equipos", filas con botón "Realizar engrase") en vez de
  las tarjetas táctiles `.lub-eq-btn` de `renderLubricadorHome()`.
- **Causa raíz:** `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\app.js`, función
  `redibujarPantallaActual()` (la que vuelve a pintar la pantalla actual
  cuando una sincronización en segundo plano trae datos nuevos —
  `onSyncStateChange()` → `pantallasQueSeRefrescan` incluye `'turno'`).
  Su mapa `pintar` para el shell de Lubricador apuntaba a las funciones
  **genéricas** (compartidas con Administrador/Planificador/Supervisor):
  ```js
  const pintar = { anomalias: renderAnomalias, historial: renderHistorial, turno: renderTurno };
  ```
  `renderHistorial` y `renderTurno` son las vistas de **tabla de
  escritorio** (`<table class="data-table">`), completamente distintas de
  `renderLubricadorHistorial()`/`renderLubricadorHome()` (tarjetas táctiles
  pensadas para el flujo de un lubricador en campo). La pantalla se
  renderiza bien al abrirla (el despachador de la barra inferior sí usa las
  funciones correctas), pero en cuanto llega una sincronización con datos
  nuevos mientras el Lubricador está en "Mi Turno" o "Mis Engrases", se
  redibuja con la función equivocada, reemplazando silenciosamente las
  tarjetas por la tabla de escritorio.
  Además, `renderTurno()` llama `startGreaseFlow(b.dataset.id)` **sin**
  el segundo argumento `target` que sí pasa `renderLubricadorHome()`
  (`startGreaseFlow(equipmentId, target)`), así que el botón "Realizar
  engrase" de la tabla mal-renderizada muy probablemente falla o no
  encuentra dónde dibujar el flujo — no se confirmó con logcat en vivo,
  pero es la lectura más probable del código.
- **Corrección:** una línea, en la fuente canónica —
  ```js
  const pintar = { anomalias: renderAnomalias, historial: renderLubricadorHistorial, turno: renderLubricadorHome };
  ```
  `anomalias: renderAnomalias` se dejó igual a propósito: esa función SÍ es
  compartida intencionalmente entre todos los roles (el Lubricador ya la ve
  igual al entrar por la barra inferior, no es un mapeo equivocado).
- **Validación:** sincronizado a `www`/Android, recompilado e instalado en
  el dispositivo real preservando datos. **Pendiente de que el usuario
  confirme** que, tras una sincronización, "Mi Turno" y "Mis Engrases" del
  Lubricador siguen mostrando las tarjetas correctas.

## ENGRASE-001 — Horómetro con valor no numérico no se detecta como dato inconsistente

- **Fecha:** 2026-09-23
- **Prioridad:** P2 (no bloquea el uso normal — el formulario de horómetro es
  un campo numérico — pero es un hueco real si el dato llega corrupto por
  importación Excel, sincronización, o edición directa en Supabase)
- **Estado:** CORREGIDO — PROBADO AUTOMÁTICAMENTE
- **Descubierto en:** `tests/unit/estado-engrase.test.js`, al escribir
  pruebas para `statusFor()` con valores límite de horómetro (Paso 7
  #11-#12 de esta fase: horómetro null/inválido)
- **Descripción:** `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\app.js`,
  función `statusFor()`. Si `equipment.hourmeter` es `undefined` o un valor
  no numérico (por ejemplo, el string `"abc"` — dato corrupto de una
  importación o edición manual), el guard existente
  `plan.lastGreaseHour > equipment.hourmeter` **no lo detecta** (la
  comparación con un no-número da `false`, no dispara "DATOS
  INCONSISTENTES"). El cálculo sigue adelante:
  `remaining = nextHour - equipment.hourmeter` da `NaN`, y como
  `NaN < 0` y `NaN <= alertYellowHours` son ambos `false`, el código cae en
  el `else` final y el equipo se muestra como **VERDE / AL DÍA** — el
  estado más tranquilizador posible, para un dato que en realidad es basura.
  (Nota: `hourmeter: null` SÍ se detecta correctamente, porque `null` se
  compara como `0` y normalmente dispara "DATOS INCONSISTENTES" si
  `lastGreaseHour > 0`; el hueco es específicamente para `undefined` y
  valores no numéricos como strings.)
- **Impacto potencial:** un equipo con horómetro corrupto podría no recibir
  atención de engrase porque el sistema lo mostraba como "al día".
- **Corrección:** `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\app.js`,
  `statusFor()` — se agregó, ANTES del chequeo existente de
  `lastGreaseHour > hourmeter`, un guard explícito:
  `if (!Number.isFinite(equipment.hourmeter)) return { code: 'GRIS', label: 'DATOS INCONSISTENTES', ... }`.
  `Number.isFinite()` no hace ninguna coerción (a propósito, para no repetir
  el patrón que causó el bug): un string como `"abc"` o `"1200"`, `null`,
  `undefined`, `NaN`, un objeto o un arreglo quedan todos excluidos por
  igual — se exige el tipo `number` real y finito. No se tocó ninguna otra
  regla de frecuencia.
- **Pruebas:** `tests/unit/estado-engrase.test.js`, bloque "ENGRASE-001 —
  horómetro inválido debe marcarse como dato inconsistente" (8 casos:
  `"abc"`, `undefined`, `""`, `NaN`, `null` [ya funcionaba, no debe
  regresar], `"1200"` [string numérico también inválido, por diseño], y un
  bucle que confirma que `remaining` nunca vuelve a ser `NaN`). Suite
  completa: 82/82 PASS (antes del fix, esas pruebas fallaban 4/4 —
  reproducción confirmada antes de corregir).
- **Sincronización:** `node tools/sync-web-to-android.mjs --apply` → `npx cap
  sync android` → `./gradlew assembleDebug` — todo PASS.

## NOTIF-ANDROID-001 — SDK Web de OneSignal lanza error dentro del WebView de Capacitor

- **Fecha:** 2026-09-23
- **Prioridad:** P2
- **Estado:** CORREGIDO — validado en dispositivo real (11 lanzamientos
  consecutivos sin reproducirse, tras el fix completo)
- **Origen:** PREEXISTENTE
- **Relacionado con modularización:** NO
- **Descripción:** el SDK Web de OneSignal
  (`https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js`, cargado
  sin condición en `index.html`) genera:
  `Uncaught TypeError: Cannot read properties of undefined (reading 'triggerEvent')`
  al ejecutarse dentro del WebView de Capacitor/Android.
- **Evidencia de que es preexistente y no relacionado con la
  modularización JS (validado en el dispositivo real, Samsung SM-S938B, con
  logcat, probado dos veces con reinicio completo de la app):**
  - El error ocurre **17 ms antes** de que se solicite siquiera
    `src/core/shifts.js` (el primero de los módulos nuevos en cargarse) —
    ocurre antes de que exista la posibilidad de que esos archivos influyan.
  - Inmediatamente después aparece en el mismo log:
    `File: https://cdn.onesignal.com/...OneSignalSDK.page.js — Msg: Incompatible browser.`
    — el propio SDK detecta que el WebView de Android "no es compatible" y,
    aparentemente, intenta disparar un evento interno sobre un objeto que
    nunca terminó de inicializarse por esa misma incompatibilidad.
  - No existe la cadena `triggerEvent` en ningún archivo propio del
    proyecto (`app.js`, `db.js`, `sync.js`, ni `src/core/*.js`) ni en el
    plugin nativo `onesignal-cordova-plugin` instalado — viene de código
    minificado del SDK **web** de terceros, cargado igual en Android que en
    el navegador.
  - No aparece ningún `FATAL EXCEPTION`, la app no se cierra, el proceso
    sigue vivo, y los 4 módulos nuevos se cargan sin ningún error 404.
  - El código propio (`app.js`) ya se protege correctamente de esto: la
    función que inicializa OneSignal para navegador comprueba
    `if (!ONESIGNAL_APP_ID || window.Capacitor) return;` antes de llamar a
    nada — el problema es que el `<script>` del SDK web se carga
    igual (sin esa misma condición a nivel de `index.html`) y él solo, por
    su cuenta, ya lanza este error interno al detectar el WebView.
- **Causa raíz (confirmada, dos partes):**
  1. `index.html` cargaba el `<script>` del SDK Web de OneSignal
     (`https://cdn.onesignal.com/sdks/web/v16/OneSignalSDK.page.js`) **de
     forma incondicional**, incluso dentro de Capacitor/Android — pese a que
     su propio comentario decía que no debía usarse ahí. `app.js` ya tenía
     una ruta separada y correcta (`initWebPush()`) que carga ese mismo SDK
     dinámicamente solo cuando `!window.Capacitor`, pero la etiqueta
     `<script>` estática de `index.html` la sobrepasaba: el SDK se cargaba
     igual, sin pasar por esa comprobación, y al detectar un WebView "no
     compatible" lanzaba `Incompatible browser.` y, acto seguido, el error
     `Cannot read properties of undefined (reading 'triggerEvent')` al
     intentar inicializarse igual sobre un objeto que nunca terminó de
     armarse.
  2. Al quitar esa etiqueta de `index.html`, el error **siguió
     reproduciéndose 8/8 veces** en las primeras pruebas post-fix. Causa:
     el Service Worker (`sw.js`) sirve `index.html` con estrategia
     cache-first; como `sw.js` no había cambiado de bytes, no se disparó un
     nuevo evento `install` y el dispositivo seguía usando el `index.html`
     cacheado (con el `<script>` viejo). Se corrigió subiendo la versión de
     `CACHE` en `sw.js` (`engrase-openpit-v23` → `v24`) para forzar la
     actualización del caché en dispositivos ya instalados.
- **Arquitectura después del fix:**
  - **Web (navegador):** `app.js` → `initWebPush()` inyecta el SDK Web de
    OneSignal dinámicamente, solo si `!window.Capacitor` y hay
    `ONESIGNAL_APP_ID` configurado. `index.html` ya no lo carga de forma
    estática.
  - **Android (app instalada):** se usa exclusivamamente el plugin nativo
    `onesignal-cordova-plugin` (`window.plugins.OneSignal`), vía
    `initPushNotifications()`. El SDK Web nunca se carga dentro de
    Capacitor.
  - La detección de plataforma sigue el mismo mecanismo que ya usaba el
    resto del proyecto: `window.Capacitor` (sin hardcodear navegador ni
    fabricante de dispositivo).
- **Archivos modificados:**
  - `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/index.html` (y su copia
    sincronizada en `CONTROL_ENGRASE_APP_ANDROID/www/index.html`): se quitó
    la etiqueta `<script>` incondicional del SDK Web.
  - `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/sw.js` (y su copia en `www/`):
    `CACHE` subido a `engrase-openpit-v24`.
  - `tests/helpers/loadNotificationLogic.js` (nuevo) y
    `tests/unit/notificaciones-plataforma.test.js` (nuevo, 6 pruebas): test
    unitario de la lógica REAL de selección de plataforma
    (`initWebPush`/`initPushNotifications`), extraída de `app.js`.
  - `app.js` **no se modificó** — su lógica de selección de plataforma ya
    era correcta antes del fix; el bug estaba solo en `index.html`.
- **Pruebas:**
  - Suite automatizada: 82 → 88/88 PASS (6 pruebas nuevas de
    NOTIF-ANDROID-001).
  - Validación en dispositivo real (Samsung SM-S938B, `adb install -r`,
    datos preservados): 11 lanzamientos consecutivos sin el error
    `triggerEvent` ni el mensaje `Incompatible browser.` en logcat (tras el
    segundo fix — los primeros 2 lanzamientos inmediatamente después de
    subir la versión de `sw.js` aún mostraban el comportamiento viejo, por
    el tiempo normal de propagación de actualización del Service Worker).
  - **PUSH REAL: NO PROBADO.** `ONESIGNAL_APP_ID` está vacío (`''`) en el
    código de producción actual (`app.js`), por lo que tanto
    `initWebPush()` como `initPushNotifications()` retornan sin hacer nada
    en ambas plataformas — el envío de push está deshabilitado por
    configuración, independientemente de este fix. No se envió ninguna
    notificación real ni se pidió autorización para hacerlo, porque no hay
    ningún App ID configurado con el que probar. Esto no bloquea la
    aprobación del fix: el error corregido era puramente de carga del SDK,
    no de recepción de push.
  - **WEB ONESIGNAL:** confirmado por revisión de código (no hay
    herramienta de automatización de navegador disponible en esta sesión).
    `initWebPush()` no se modificó y sigue intacta: crea el `<script>` del
    SDK Web dinámicamente, llama a `OneSignal.init(...)`,
    `Notifications.requestPermission()` y registra el listener de cambio de
    suscripción exactamente igual que antes del fix. El único cambio fue
    eliminar la carga *duplicada e incondicional* en `index.html`, que
    convivía con esta ruta ya correcta.
- **Acción actual:** Corregido y validado. Ver también
  `docs/DECISIONS.md` (arquitectura Web vs. Android de OneSignal) y
  `docs/CHANGELOG_MIGRATION.md`.

## UI-ANDROID-005 — Panel "Equipos que requieren atención" del Dashboard usa tabla genérica sin adaptar a tarjeta móvil

- **Fecha:** 2026-09-23
- **Prioridad:** P3 UX (los datos y estados mostrados son correctos — no es
  un problema de lógica ni de datos, solo de presentación)
- **Estado:** REPRODUCIDO, NO CORREGIDO
- **Origen:** PREEXISTENTE — confirmado presente ya en el commit baseline
  `c6d6f78` (el primer commit de todo este repositorio), mucho antes de la
  modularización JS. **No relacionado con la modularización.**
- **Reportado por:** usuario, durante la prueba manual M3 (validación de
  estados de engrase tras la modularización), en el Dashboard del Samsung
  SM-S938B real.
- **Descripción:** el panel "Equipos que requieren atención" del Dashboard
  (`renderDashboard()`, `app.js` línea ~2057) usa una `<table class="data-table">`
  genérica con columnas (Estado, Código, Equipo, Turno, Control, Horómetro,
  Próximo/Día asignado, Restante/Atraso, Días sin engrase), convertida en
  móvil a filas apiladas "ETIQUETA: valor" mediante el mecanismo genérico de
  tabla responsive (`data-label`, ver `app.js` línea ~1807) — el mismo
  patrón de fondo que causó `BUG-004` en la pantalla del Lubricador. El
  resultado es una tarjeta muy alta y densa de leer, en vez de un resumen
  compacto.
- **Verificado que los DATOS son correctos:** los equipos mostrados
  ("05-0870" Caterpillar D8, "20-5530" Komatsu PC500LC-10M0) muestran
  "VENCIDO" con el detalle de atraso correspondiente — la lógica de
  `statusFor()`/`weekdayStatusFor()` (ya modularizada en
  `src/core/lubrication-status.js`) está calculando correctamente.
- **Evidencia:** `docs/evidence/UI-ANDROID-005_dashboard-table.png`.
- **Acción actual:** NO corregir todavía. Queda para una fase de UI
  dedicada (fuera de esta fase, que es de validación, no de diseño).

## ANDROID-DOZE-001 — Lanzar la app con la pantalla apagada/dozing puede producir un `App resumed→paused→stopped` abrupto y, a veces, el mismo error JS de `triggerEvent`

- **Fecha:** 2026-09-23
- **Prioridad:** P3 (no afecta el uso normal — solo ocurre al lanzar la app
  mientras el dispositivo está en reposo/con la pantalla apagada, algo que
  el usuario real no hace: siempre desbloquea el teléfono primero)
- **Estado:** REPRODUCIDO, NO CORREGIDO
- **Origen:** PREEXISTENTE, no relacionado con la Modularización JS Fase 2
  ni con `NOTIF-ANDROID-001`
- **Descubierto durante:** la revalidación offline (PARTE A) y el smoke
  test Android (PARTE J) de la Modularización JS Fase 2, al lanzar la app
  vía `adb shell am start` mientras el Samsung SM-S938B mostraba su
  pantalla de carga (`mWakefulness=Dozing`, overlay "71% · 1 h 6 min para
  completar la carga").
- **Descripción:** cuando la app se lanza con la pantalla del dispositivo
  apagada/en reposo (dozing) o mientras la pantalla de carga de Samsung
  tiene el foco, logcat muestra un ciclo `App resumed` → `App paused` →
  `App stopped` en menos de 100 ms, y en algunos casos (no siempre — no es
  100% reproducible) inmediatamente después aparece
  `Uncaught TypeError: Cannot read properties of undefined (reading
  'triggerEvent')` con `File:` vacío y `Line 1` — un origen y una firma
  DISTINTOS al de `NOTIF-ANDROID-001` (que citaba
  `onesignal.com/sdks/.../OneSignalSDK.page.js` y el mensaje
  `Incompatible browser.`, ninguno de los cuales aparece aquí).
- **Evidencia de que es un problema distinto y de plataforma, no del SDK
  Web de OneSignal:**
  - Con la pantalla despierta y desbloqueada confirmada por
    `adb shell dumpsys power`/`dumpsys trust` antes de cada lanzamiento:
    varios lanzamientos limpios seguidos, cero reproducciones.
  - Con la pantalla dormida/dozing: el ciclo `App resumed→paused→stopped`
    aparece consistentemente; el error JS apareció en 2 de esos intentos y
    NO apareció en otro (mismo patrón de pausa/stop, sin el error) — sugiere
    una condición de carrera dependiente de en qué punto exacto de la carga
    de `index.html` ocurre la interrupción, no algo determinista.
  - No se encontró la cadena `onesignal.com` ni `Incompatible browser.` en
    ninguna de las reproducciones — descarta que sea una recurrencia de
    `NOTIF-ANDROID-001`.
- **Hipótesis (no confirmada):** algún listener de ciclo de vida del bridge
  nativo (Capacitor y/o `onesignal-cordova-plugin`) intenta disparar un
  evento sobre un objeto que todavía no terminó de inicializarse cuando la
  actividad se pausa/detiene anormalmente rápido, antes de que `app.js`
  termine de cargar.
- **Acción actual:** NO corregir en esta fase — fuera de alcance de la
  Modularización JS Fase 2 (que es sobre Matriz Semanal y Anomalías, no
  sobre notificaciones ni ciclo de vida de Android). No bloquea la
  aprobación de esta fase: en uso normal (pantalla desbloqueada, que es
  como arranca la app real) no se reprodujo ni una vez.
