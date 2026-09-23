# ESTADO DE LA MIGRACIÓN

## FASE 0 — Protección del estado actual con Git
**Estado:** COMPLETADA (2026-09-23)

- Repositorio Git inicializado en la raíz `CONTROL_ENGRASE`.
- `.gitignore` configurado (ver `docs/DECISIONS.md` para el detalle de cada
  exclusión).
- Commit baseline creado: `c6d6f786fe53e657dd76c6edfa32ba1df8d816cc` en
  `master`.
- Rama de trabajo `migration-typescript` creada a partir del baseline.
- **No se movió, copió, borró ni modificó ningún archivo de código
  (`app.js`, `db.js`, `sync.js`, `capacitor.config.json`, etc.).**

## Limpieza puntual — archivo ajeno al proyecto
**Estado:** COMPLETADA (2026-09-23)

Se detectó que el commit baseline había incluido por error
`PLAN_MANTENIMIENTO_MAYOR_D8T_05-68.xlsx` (un archivo suelto en la raíz, sin
relación con el sistema Control de Engrase, que el usuario ya había eliminado
del disco fuera de este flujo). Se registró su baja en Git y se agregó a
`.gitignore` para evitar que vuelva a incorporarse por accidente. Commit:
`e5af5ff` — `chore: remove unrelated maintenance spreadsheet from project
tracking`. No se encontraron otros archivos ajenos al proyecto en la raíz.

## FASE 1 — Análisis de fuente única
**Estado:** COMPLETADA (2026-09-23, solo análisis — nada ejecutado)

- Se compararon `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB` y
  `CONTROL_ENGRASE_APP_ANDROID\www` archivo por archivo, con hash SHA-256.
  Resultado: el código de negocio (`app.js`, `db.js`, `sync.js`, `styles.css`,
  `index.html`, `sw.js`, `OneSignalSDKWorker.js`, `schema.sql`, `.nojekyll`,
  `.well-known/assetlinks.json`) es 100% idéntico entre ambas copias. Las
  diferencias reales están en `manifest.json` (roto en `www`: color inválido
  y rutas de íconos fuera de la carpeta servida) y en 3 íconos PWA que faltan
  en `www`.
- Se documentó cómo se publica la web hoy (manual, sin build, a
  `junivalles-cmd.github.io`) y cómo Capacitor genera `assets/public` desde
  `www`. Ver detalle completo en `docs/PLAN_UNIFICACION_WEB_ANDROID.md`.
- **Arquitectura recomendada:** Opción A — `CONTROL_ENGRASE_WEB` como fuente
  única, con un script que genere `www` automáticamente (dejando de copiarse
  a mano), con la Opción C (Vite + TypeScript, `src/`+`public/`→`dist/`) como
  destino final documentado para una fase posterior.
- **No se movió, copió, borró ni modificó ningún archivo de código en esta
  fase.**

## FASE A2 — Script de sincronización WEB → www
**Estado:** COMPLETADA (2026-09-23) — herramienta creada y probada, `--apply`
NO ejecutado.

- FUENTE CANÓNICA TEMPORAL: `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`
- SINCRONIZACIÓN: script creado en `tools/sync-web-to-android.mjs` (ver
  `docs/SYNC_WEB_ANDROID.md`). Calcula el set de archivos runtime a partir de
  `index.html`, `manifest.json` y `sw.js` de la fuente (no copia a ciegas);
  excluye explícitamente documentación, manuales, SQL y Edge Functions.
- APPLY: **NO EJECUTADO**. Solo se corrió en modo dry-run.
- ANDROID: **NO MODIFICADO** (ni `www`, ni `android\app\src\main\assets\public`,
  ni ningún archivo de Android Studio/Gradle).
- GITHUB PAGES: **NO MODIFICADO**.
- Dry-run contra el proyecto real confirmó las diferencias ya conocidas
  (`manifest.json` desactualizado en `www`, 3 íconos faltantes, 10 íconos con
  contenido distinto) y además detectó dos hallazgos nuevos: `www` contiene
  `schema.sql` (no es runtime del frontend, no debería estar ahí) e
  `icon-180.png` (existe en ambas copias pero no está referenciado por
  `manifest.json`, `index.html` ni `sw.js` — parece un ícono huérfano). Ambos
  quedan documentados, sin tocarlos.
- Pruebas del script (ruta inexistente, manifest inválido) se hicieron en
  copias aisladas dentro de una carpeta temporal, nunca contra el proyecto
  real.
- Commit: `5d42f66` — `build: add safe web to android sync tool`.

## FASE A3 — Primera sincronización real WEB → www → Android
**Estado:** COMPLETADA (2026-09-23)

- FUENTE CANÓNICA TEMPORAL: `CONTROL_ENGRASE_WEB\CONTROL_ENGRASE_WEB`.
- APPLY: **EJECUTADO** por primera vez. 13 archivos escritos (10 actualizados,
  3 nuevos), 0 errores. Sobrantes (`schema.sql`, `icon-180.png`) conservados
  sin tocar, como se decidió explícitamente para esta fase.
- Verificación posterior: dry-run en 0/0 (22/22 archivos runtime idénticos
  por hash SHA-256 entre `CONTROL_ENGRASE_WEB` y `www`).
- `manifest.json` de `www`: ahora idéntico a la fuente, JSON válido,
  `background_color` corregido, los 10 íconos existen.
- FUENTE WEB: **NO MODIFICADA** (confirmado con `git diff`).
- `npx cap sync android`: ejecutado sin errores. `android\app\src\main\assets\public`
  regenerado desde `www`; coincide por hash con los archivos runtime de `www`.
  Ningún archivo versionado de Android fue modificado.
- ANDROID BUILD: `./gradlew assembleDebug` **exitoso** (APK de depuración
  generado, ~8.9 MB), tras limpiar artefactos de build obsoletos que
  causaban un error de Windows no relacionado con el código.
- ANDROID EN DISPOSITIVO: **NO PROBADO** (sin dispositivo/emulador conectado).
- WEB EN NAVEGADOR: **NO PROBADO** (sin herramienta de automatización de
  navegador disponible en esta sesión); sí se verificó que todos los
  archivos runtime se sirven correctamente vía HTTP y que el JS no tiene
  errores de sintaxis. Ver `docs/TEST_MATRIX.md` para el detalle completo.
- GITHUB PAGES: **NO MODIFICADO**. No se hizo push ni publicación.
- Commits: `build: synchronize android web assets from canonical web source`
  (sincronización real de `www` + documentación).

## Validación manual en dispositivo real (post Fase A3)
**Estado:** EN CURSO (iniciada 2026-09-23)

- Dispositivo: Samsung SM-S938B, conectado por USB, autorizado en ADB.
- APK debug instalado con `adb install` (limpio, sin instalación previa —
  0 riesgo de pérdida de datos) y actualizado varias veces con
  `adb install -r` (preservando datos; `firstInstallTime` sin cambios en
  todas las reinstalaciones).
- Arranque de la app confirmado (proceso vivo, actividad en primer plano,
  sin errores fatales en logcat).
- **UI-ANDROID-001** (buscador superpuesto): reproducido con evidencia real
  (`docs/evidence/UI-ANDROID-001_before.png`), corregido en dos commits
  (`5751a21`, `1867ba5`) y **validado visualmente por el usuario en el
  dispositivo real — PASS**. Ver `docs/BUG_REGISTER.md`.
- **UI-ANDROID-002** (ícono de logout del Lubricador): corregido en código
  (commit `86ff816`), sincronizado e instalado en el dispositivo —
  **pendiente de validación visual del usuario**.
- App Links con el APK debug: analizado y **BLOQUEADO EN DEBUG** (el
  certificado del keystore de depuración no coincide con el que exige
  `assetlinks.json`, que sí coincide con el keystore de release
  `engrase-key.jks`) — requiere un build firmado para probarse de verdad,
  fuera de alcance de esta fase.
- Checklist completo de validación manual (login por rol, navegación,
  Lubricador, Equipos, Matriz Semanal, offline, etc.) preparado en
  `docs/MANUAL_VALIDATION.md`, aún no ejecutado caso por caso.

## Próximas fases (NO iniciadas)

Estas fases se planificarán y ejecutarán en conversaciones futuras, una por
una, con confirmación explícita antes de cada paso. Ver el detalle completo
de cada una en `docs/PLAN_UNIFICACION_WEB_ANDROID.md`, sección 9:

- **FASE A1:** fijar formalmente `CONTROL_ENGRASE_WEB` como fuente canónica
  (documental, ya cubierto por este mismo documento y el plan).
- **FASE A2:** crear (sin ejecutar todavía) el script de sincronización
  automática `CONTROL_ENGRASE_WEB → www`.
- **FASE A3:** ejecutar ese script una vez sobre `www` real, validar en Web
  y Android, y comitear el resultado.
- **FASE A4:** consolidar la documentación/backend duplicados entre las
  raíces de `CONTROL_ENGRASE_WEB` y `CONTROL_ENGRASE_APP_ANDROID`.
- **FASE C1/C2 (mucho más adelante):** introducir Vite, reorganizar en
  `src/`+`public/`, y migrar a TypeScript, archivo por archivo.
- **Ninguna de estas fases ha sido iniciada.** La rama `migration-typescript`
  existe pero no contiene cambios de código todavía.
