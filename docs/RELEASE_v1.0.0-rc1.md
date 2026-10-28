# HISTORICAL / DEPRECATED — release candidate y piloto anteriores.
# Quick Unlock/PIN, rutas y menús descritos aquí pertenecen a esa versión;
# consulte la documentación CURRENT antes de instalar o desplegar.

# Release v1.0.0-rc1 — Control de Engrase (Open Pit)

**Fecha:** 2026-10-21
**Commit funcional:** `f531040e8b4c5829f87e42a41edeb6ad580d1d48`
**Commit de evidencia:** `8c16d61e92181fb6380c38daf9c8d0f2daa9f39e`
**Tag:** `v1.0.0-rc1` (apunta a `f531040`, no se mueve)
**APK SHA256:** `8262472ab8ff50217be2cc07d33a64d8c601a4bcfbaffca496438f9514210aad`
**Dispositivo validado:** Samsung SM-X135G (Galaxy Tab A9+), serial `R8YL601XNPY` — instalación + smoke test real, sin uninstall ni clear data.

Ver evidencia completa en `docs/evidence/RELEASE_2026-10-21.json`.

## Qué es este release

Primer release candidate formal del proyecto (no existía un esquema de
versión previo — ver ese mismo archivo de evidencia). Reúne el trabajo
estabilizado de varias sesiones hasta `PRE_COMMIT_FULL_E2E_READY` y cierra
el hallazgo de auditoría P0 de autorización visible.

## Capacidades principales incluidas

- Sync offline-first (IndexedDB local, cola de cambios, reconexión
  automática, `watchdog`).
- Registro de engrase (checklist de puntos, horómetro, fotos, lubricante,
  fuera de plan).
- Doble turno de equipos con control por horas (p. ej. excavadoras).
- Matriz Semanal (día/turno) y Plan de Engrase.
- Tareas y Mensajes (tareas manuales + broadcast) en un solo módulo.
- Anomalías (registro, criticidad, cierre).
- Notificaciones push/deeplink (OneSignal) + campana en la app.
- Evidencia fotográfica con marca de tiempo.
- Alcance operativo por cuadrilla/ubicación/turno (nunca por dispositivo —
  ver `docs/OPERATIONAL_SCOPE.md`).
- Quick Unlock por PIN (4h, 100% local al dispositivo, nunca amplía
  permisos — ver `LOGIC-P0-01` abajo).
- Autenticación Supabase con autorización por fila (RLS) preparada
  (migraciones `0007`–`0015` + `AUTH_RLS_FINAL_CUTOVER`, **sin aplicar**
  a producción en este release).

## Módulos disponibles por rol

| Módulo | Lubricador | Supervisor | Planificador | Administrador |
|---|---|---|---|---|
| Mi Turno | ✓ | — | — | — |
| Tareas y Mensajes | ✓ | ✓ | ✓ | ✓ |
| Anomalías | ✓ | ✓ | — | ✓ |
| Historial | ✓ | ✓ | ✓ | ✓ |
| Dashboard | — | ✓ | ✓ | ✓ |
| Equipos | — | ✓ | ✓ | ✓ |
| Plan de Engrase | — | — | ✓ | ✓ |
| Matriz Semanal | — | ✓ | ✓ | ✓ |
| Reportes | — | — | ✓ | ✓ |
| Lubricantes | — | — | — | ✓ |
| Usuarios | legacy: ✓ (propia cuadrilla) · Supabase: — | ✓ (legacy) / — (Supabase, ver P0 abajo) | — | ✓ |
| Configuración | — | — | — (backlog S5) | ✓ |
| Ayuda | ✓ | ✓ | ✓ | ✓ |

## Hallazgo P0 cerrado en este release

**LOGIC-P0-01:** en modo Supabase, SUPERVISOR veía y podía navegar a
"Usuarios" aunque el backend (`manage-users`) siempre rechaza (403) a
cualquier rol distinto de ADMINISTRADOR. Corregido en la UI
(`getAllowedRoutes()`); backend/RLS/`manage-users` no se tocaron. Legacy
sin cambios. Ver `tests/ui/supervisor-usuarios-visibility.spec.js`.

## Resumen de pruebas

- Unit (vitest): 122 archivos / 1865 tests — PASS.
- Playwright (UI, 7 viewports 360–1920px): 7070 total / 7054 pass / 16
  skip / 0 fail / 0 not_run — PASS.
- `tsc --noEmit`: PASS.
- `vite build` + `tools/verify-dist.mjs`: PASS.
- APK debug instalado en dispositivo real + smoke test (Quick Unlock, Mi
  Turno, Tareas, Anomalías, Historial, campana, sync badge): PASS, sin
  crashes en logcat.

## Limitaciones conocidas

- Smoke test de dispositivo cubrió solo una cuenta LUBRICADOR en un
  dispositivo; Administrador/Planificador no se validaron en dispositivo
  físico en este release (sí en Playwright).
- `npx cap sync android` reintroduce un mojibake (acentos corruptos) en un
  comentario de `AndroidManifest.xml` — cosmético, sin efecto en el APK
  compilado (AAPT descarta comentarios XML), pero hay que revisarlo si se
  vuelve a tocar el manifest a mano tras un sync.
- Esta máquina de build muestra presión de memoria en corridas Playwright
  largas con un solo worker — no afecta el resultado, sí el tiempo total.
- APK de este release es **debug**, no firmado para distribución pública —
  adecuado para el piloto controlado de campo (ver
  `docs/PILOTO_CAMPO_v1.0.0-rc1.md`), no para una tienda de apps.

## Backlog diferido (no bloqueante)

- `LUB-02` — checklist de puntos marcado por defecto (decisión de
  producto pendiente).
- `LUB-03` — Historial del Lubricador sin filtro de fecha.
- `DES-01` — migración de diálogos `alert()`/`confirm()`/`prompt()`
  nativos al modal propio de la app.
- `S5` — Planificador sin acceso a Configuración (confirmar si es
  intencional).
- Mejoras que surjan del piloto de campo (ver
  `docs/PILOT_ISSUES_TEMPLATE.md`).

## Rollback básico

Este release no aplicó ninguna migración de base de datos (todas las
`_PREPARED` siguen sin aplicar), así que un rollback de este release
**no requiere tocar Supabase**.

1. **Dispositivo Android:** conservar el APK anterior (si existe) con su
   SHA256 documentado. Para volver atrás: `adb install -r <apk_anterior>`.
   Nunca `adb uninstall` — eso borra los datos locales (IndexedDB) del
   dispositivo.
2. **Repositorio:** el tag `v1.0.0-rc1` no se mueve. Para volver al estado
   anterior del código: `git checkout 0c16f43` (commit previo a este
   release) en una rama/worktree aparte — nunca sobre `migration-typescript`
   sin coordinarlo.
3. **Web (si aplica):** redesplegar el `dist/` generado desde el commit
   anterior.
# HISTORICAL / DEPRECATED — release candidate y piloto anteriores.
# Quick Unlock/PIN, rutas y menús descritos aquí pertenecen a esa versión;
# consulte la documentación CURRENT antes de instalar o desplegar.

