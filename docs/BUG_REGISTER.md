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
