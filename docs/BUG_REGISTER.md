# REGISTRO DE BUGS

## UI-ANDROID-001 — Barra de búsqueda superior se superpone con otros controles en Android

- **Fecha:** 2026-09-23
- **Prioridad:** P2
- **Estado:** REPRODUCIDO EN DISPOSITIVO REAL
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
- **Corrección:** ver `docs/CHANGELOG_MIGRATION.md` y el commit
  `fix: prevent mobile search bar overlap` — se agregó `flex-wrap: wrap` y
  `justify-content: flex-end` a `.topbar-right` en la fuente canónica
  (`CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB\styles.css`), sincronizado luego
  a `www` y a Android. **Pendiente de validación visual del usuario en el
  dispositivo real** antes de marcar este bug como resuelto.
