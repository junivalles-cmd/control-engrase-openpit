# CHANGELOG DE LA MIGRACIÓN

## 2026-09-23 — FASE 0: baseline protegido con Git
- Se inicializó el repositorio Git en `CONTROL_ENGRASE` (raíz que contiene
  `CONTROL_ENGRASE_WEB` y `CONTROL_ENGRASE_APP_ANDROID`).
- Se creó `.gitignore` en la raíz (ver `docs/DECISIONS.md`).
- Commit baseline: `c6d6f786fe53e657dd76c6edfa32ba1df8d816cc` en `master`.
- Se creó la rama `migration-typescript` a partir del baseline.
- Se creó la carpeta `docs/` con `LINEA_BASE.md`, `MIGRATION_STATUS.md`,
  `BUG_REGISTER.md`, `TEST_MATRIX.md`, `DECISIONS.md` y este changelog.
- No se modificó, movió ni eliminó ningún archivo de código existente.

## 2026-09-23 — FASE 1: análisis de fuente única (solo documentación)
- Se comparó `CONTROL_ENGRASE_WEB` vs. `www` por hash SHA-256; código de
  negocio 100% idéntico, diferencias reales solo en `manifest.json` e íconos.
- Se documentó el flujo real de publicación (GitHub Pages manual, sin build)
  y de Capacitor (`www` → `cap sync` → `assets/public`).
- Se recomendó la Opción A (WEB como fuente canónica temporal) como paso
  ejecutable, con Vite/TypeScript como destino futuro documentado.
- Commits: `04d079f` (plan de unificación), más limpieza previa
  `e5af5ff` (archivo ajeno al proyecto).

## 2026-09-23 — FASE A2: script de sincronización (creado, solo dry-run)
- Se creó `tools/sync-web-to-android.mjs`: calcula el set runtime a
  sincronizar leyendo `index.html`/`manifest.json`/`sw.js` de la fuente,
  excluye documentación/SQL/backend, compara por hash SHA-256, nunca borra.
- Probado en dry-run contra el proyecto real (sin cambios) y con errores
  simulados en copias aisladas (ruta inexistente, manifest inválido).
- `--apply` NO se ejecutó en esta fase. Commit: `5d42f66`.

## 2026-09-23 — FASE A3: primera sincronización real WEB → www → Android
- Se ejecutó `node tools/sync-web-to-android.mjs --apply` por primera vez:
  10 archivos actualizados, 3 archivos nuevos copiados, 0 errores. Los
  sobrantes (`schema.sql`, `icon-180.png`) se dejaron intactos a propósito.
- Verificado con un dry-run posterior: 22/22 archivos runtime idénticos entre
  `CONTROL_ENGRASE_WEB` y `www` (0 ACTUALIZAR, 0 FALTAN).
- `manifest.json` de `www` quedó idéntico a la fuente: JSON válido,
  `background_color` corregido, los 10 íconos referenciados existen.
- La fuente `CONTROL_ENGRASE_WEB` no fue modificada (verificado con
  `git diff`) — el script solo escribe en el destino.
- Se ejecutó `npx cap sync android`: regeneró
  `android\app\src\main\assets\public` desde `www` sin tocar ningún archivo
  versionado de Android (confirmado con `git status`); verificado por hash
  que los archivos runtime en `assets/public` coinciden con `www`.
- Se compiló un APK de depuración (`./gradlew assembleDebug`) con éxito tras
  limpiar artefactos de build obsoletos (`./gradlew clean`) que causaban un
  `AccessDeniedException` de Windows en `build/intermediates` — no relacionado
  con el código sincronizado.
- No se probó en dispositivo/emulador real (ninguno conectado en este
  entorno): arranque, IndexedDB, cámara, QR, App Links, OneSignal y
  notificaciones locales quedan `NO PROBADO EN DISPOSITIVO`.
- No se pudo probar la web en un navegador real (extensión de automatización
  no instalada en esta sesión); se verificó en su lugar que todos los
  archivos runtime se sirven con HTTP 200 desde un servidor estático local y
  que `app.js`/`db.js`/`sync.js`/`sw.js` no tienen errores de sintaxis.
- `.nojekyll` y `.well-known/assetlinks.json` verificados intactos e
  idénticos entre fuente y destino, sin necesidad de corrección.
