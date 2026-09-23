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
