# CHECKPOINT — Control de Engrase — 2026-10-17 (fin de sesión)

Rama: `migration-typescript`. **Sin commit en ningún momento de esta sesión.** Sin push. Sin tocar Supabase/RLS/0016/auth/sync backend (salvo lectura/auditoría).

---

## 1. ESTADO GENERAL

**Cerrados hoy** (lógica + pruebas dirigidas en verde, typecheck/build/verify:dist limpios):
- Doble turno genérico (sin excavadora-only).
- Validación tardía (nunca se oculta por antigüedad, mismo `record.id`).
- Mi Turno por cobertura `crew_locations` (PRINCIPAL/APOYO, multiubicación real).
- Trabajo normal por ubicación (sin `lubrication_assignment` manual requerido).
- Eliminación de "Asignar a cuadrilla" de Plan de Engrase (acción normal) — se conservó en la Ficha del equipo (excepción).
- Panel de notificaciones/tareas — cerrado el único gap real encontrado (validación pendiente sin recordatorio); el resto de la arquitectura (turnos, dedupe, persistencia, offline) ya existía y se confirmó con pruebas.

**Listo para device test (Android):**
- Doble turno (Mi Turno real, carryover Día↔Noche, validación tardía).
- Mi Turno por cobertura multiubicación (filtro de ubicación, selector de cuadrilla, apoyo).
- Plan de Engrase sin la columna "Asignar a cuadrilla".
- Notificaciones locales con el nuevo recordatorio de validaciones pendientes.

**Pendiente de validación visual/Android (no probado en dispositivo real esta sesión):**
- Todo lo de arriba — esta sesión fue 100% código + pruebas automatizadas (unit + Playwright headless). **Cero prueba en teléfono/tablet real hoy.**
- El recordatorio nuevo de "Validaciones PENDIENTES" (push local) nunca se disparó en un dispositivo real — solo verificado por código/pruebas.

**Bloques NO tocados hoy, con pendientes propios ya conocidos (ver sección 3):**
- Plan de Engrase — configuración visual/lógica del doble turno (checkbox Día+Noche, selector Turno).
- Matriz Semanal — coherencia con doble turno (mini-celdas, filas combinadas, métricas).

---

## 2. BLOQUES CERRADOS

| Bloque | Estado | Evidencia |
|---|---|---|
| Sync/bootstrap | Ya estaba cerrado antes de esta sesión (no se tocó) | Confirmado estable; "FIX FRESH INSTALL/RACE BOOTSTRAP" ya resuelto en sesión previa |
| 0016 | Ya aplicada antes de esta sesión (no se tocó) | Sin cambios en migraciones hoy |
| Mi Turno por cobertura de `crew_locations` | **Cerrado hoy** | `classifyEquipmentWork()` restaurado a multiubicación real (PRINCIPAL+APOYO); revertidos 2 bugs reales de la misma sesión previa (forzaba `normal:[]`; exigía confirmar cuadrilla incluso con 1 sola) |
| Doble turno genérico | **Cerrado hoy** | `dualShiftStatusFor`/`resolveOccurrenceState`/`estadoCelda` — sin lógica por `equipmentType`/familia; `isExcavatorEquipment()` confirmado inerte (sin callers) |
| Validación tardía | **Cerrado hoy** | `isRecordPendingValidation()` ya no excluye "vencida"; mismo `record.id`, nunca duplica |
| Trabajo normal por ubicación | **Cerrado hoy** | `equipment.locationId` → `crew_locations` PRINCIPAL → cuadrilla, sin assignment manual; APOYO nunca duplica automático |
| Eliminación de "Asignar a cuadrilla" del Plan de Engrase | **Cerrado hoy** | Columna/wiring removidos de `renderPlan()`; excepción conservada en Ficha del equipo (`openAssignGreaseModal`) |

---

## 3. PENDIENTES ABIERTOS

### A. Plan de Engrase — configuración visual/lógica del doble turno
- Checkbox "Obligaciones Día y Noche" — revisar si refleja/escribe `requiredShifts` correctamente.
- Selector de Turno — coherencia con el checkbox anterior (no deben contradecirse).
- Coherencia general con `requiredShifts`/`effectiveDate` (el plan debe guardar exactamente lo que la UI muestra).
- Caso real **05-0870** — revisar su configuración de plan específicamente (ya apareció como caso de referencia en el trabajo de cobertura multiubicación de esta sesión, pero su plan/doble turno en sí NO se auditó).

### B. Matriz Semanal
- No mostrar mini-celdas Día/Noche dentro de una matriz que YA está separada por turno (duplicación visual).
- Un equipo de doble turno debe aparecer en la matriz Día **y** en la matriz Noche (ocurrencias distintas, cada una en su propia matriz).
- Revisar **20-5530** (apareció en pruebas de "Realizado adelantado" esta sesión, pero su fila en Matriz Semanal no se auditó).
- Revisar **05-0870** (mismo caso que en A).
- Revisar filas combinadas tipo **"45-77 / A-07"** y **"A-02 / 45-69"** — posible fusión visual incorrecta de dos equipos/ocurrencias distintas en una sola fila.
- Revisar métricas de programados/realizados/no realizados/pendientes/cumplimiento cuando hay doble turno de por medio (`computeProgramadoRealizadoPeriodo` ya se tocó para doble turno genérico, pero la Matriz Semanal como PANTALLA — filas/columnas visuales — no se auditó end-to-end en esta sesión).

### C. Panel de notificaciones/tareas
- Turnos, dedupe, persistencia, offline y "sin spam" — **ya auditados y con pruebas dirigidas en verde esta sesión** (ver sección 5). Dejar explícito que lo pendiente real aquí es **prueba en dispositivo** (que el recordatorio de validaciones realmente suene/aparezca en Android), no lógica — eso no se verificó hoy.

### D. Prueba final Android end-to-end
- Ningún cambio de hoy se probó en teléfono/tablet real. Pendiente antes de considerar esta sesión lista para campo.

---

## 4. ARCHIVOS MODIFICADOS HOY (sesión completa, acumulado — ver `git status` abajo para la lista exacta y completa del working tree, que incluye también cambios de sesiones anteriores sin commitear)

**Tocados específicamente en el trabajo de HOY** (doble turno + crew_locations + Plan de Engrase + notificaciones):
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js`
- `CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/operational-scope.js`
- `tests/unit/mis-engrases-baseline.test.js`
- `tests/ui/lubricador-mi-turno-real-execution.spec.js`
- `tests/ui/mi-turno-selected-crew.spec.js` *(nuevo, sin commitear de una sesión previa; editado hoy)*
- `tests/ui/lubricador-fresh-install-bootstrap.spec.js`
- `tests/unit/crew-location-coverage.test.js`
- `tests/unit/lubricador-dashboard.test.js`
- `tests/unit/mi-turno-selected-crew.test.js` *(nuevo, sin commitear de una sesión previa; editado hoy)*
- `tests/helpers/loadNotificationLogic.js`
- `tests/unit/onesignal-identity.test.js`
- `tests/unit/sync-audit-log-legacy.test.js`
- `tests/unit/notifications-tasks-panel.test.js` *(nuevo, creado hoy)*

**El resto de la lista de `git status` (abajo) es trabajo de sesiones anteriores, ya documentado en memoria/handoffs previos — no se tocó hoy** (incluye migraciones RLS preparadas, Edge Functions, docs de auditoría de producción, etc. — todo fuera del alcance de "no tocar Supabase/RLS/0016/auth/sync" de esta sesión).

---

## 5. TESTS

**Suites ejecutadas hoy (todas en verde, salvo lo indicado):**

| Suite | Resultado |
|---|---|
| `npx vitest run` (unit, completa) | **1700/1700 PASS** (109 archivos) |
| `typecheck` (`tsc --noEmit`) | **Limpio** |
| `npm run build` | **Limpio** (solo warnings esperados de scripts no-module, iguales a siempre) |
| `node tools/verify-dist.mjs` | **TODO OK** |
| `playwright --config tools/playwright-double-shift.config.mjs` (ambos viewports) | **118/118 PASS** |
| `playwright --config tools/playwright-support.config.mjs` (ambos viewports) | **90/90 PASS** |
| `playwright tests/ui/crew-location-coverage.spec.js` (phone-390 + phone-412) | **34/38 PASS — 4 fallos conocidos, PRE-EXISTENTES** |

**Fallos conocidos (NO introducidos hoy, confirmado vía `git diff` que el texto de estos tests no cambió en esta sesión ni en la anterior — son gaps reales pero fuera del alcance de hoy):**
1. `Scenario B: principales reciben planes, APOYO solo assignment y no genera Matrix tab` — el filtro de ubicación del header de Mi Turno no incluye ubicaciones APOYO (solo PRINCIPAL). Pre-existente.
2. `COMPLETE adelantado en ambas principales no reaparece; PARTIAL y carryover siguen pendientes` — un assert de "Realizados" falla en un escenario de 2 ubicaciones PRINCIPAL. Pre-existente, no diagnosticado a fondo hoy (fuera de alcance).

**Skips pendientes:** ninguno — los 2 tests de doble turno que quedaron en `test.skip` durante parte de la sesión (bloqueados por el bug real de `classifyEquipmentWork`) ya se desbloquearon y están en verde (`test()`, no `test.skip()`).

**NO se corrió:** la suite Playwright completa (7 viewports × todos los specs) — solo las 2 configs dirigidas (`playwright-double-shift`, `playwright-support`) + `crew-location-coverage.spec.js` en 2 viewports. Pendiente si se quiere una pasada total antes de considerar esto "listo para producción".

---

## 6. GIT

```
git status --short
```

```
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/db.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/grease-validation.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/lubrication-status.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/operational-scope.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/plan-compliance.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/weekly-matrix.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-push/index.ts
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/functions/notify-vencidos/index.ts
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0007_push_tokens_ownership_rls_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0009_lubrication_execution_gateway_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0010_evidence_gateway_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0011_operational_catalog_gateway_ROLLBACK.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0012_authorization_scope_bootstrap_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0012_authorization_scope_bootstrap_ROLLBACK_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0013_authorization_row_scope_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0013_authorization_row_scope_ROLLBACK_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0015_store_permission_target_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/AUTH_RLS_FINAL_CUTOVER_PREPARED.sql
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/sync.js
 M docs/AUTHORIZATION_ROW_SCOPE_PHASE_2D2.md
 M docs/AUTHORIZATION_SCOPE_PHASE_2D1.md
 M tests/helpers/dashboardFixture.js
 M tests/helpers/loadLubricationLogic.js
 M tests/helpers/loadNotificationLogic.js
 M tests/ui/crew-location-coverage.spec.js
 M tests/ui/dashboard-compact.spec.js
 M tests/ui/evidence-gateway.spec.js
 M tests/ui/execution-gateway.spec.js
 M tests/ui/ficha-programacion-semana.spec.js
 M tests/ui/grease-validation.spec.js
 M tests/ui/lubricador-fresh-install-bootstrap.spec.js
 M tests/ui/lubricador-mi-turno-real-execution.spec.js
 M tests/ui/matrix-occurrence-detail.spec.js
 M tests/ui/operational-catalog-gateway.spec.js
 M tests/unit/client-anonymous-dependency.test.js
 M tests/unit/crew-location-coverage.test.js
 M tests/unit/dashboard-attention-order.test.js
 M tests/unit/dashboard-layout-invariance.test.js
 M tests/unit/dashboard-operativo.test.js
 M tests/unit/equipment-lookup.test.js
 M tests/unit/execution-gateway.test.js
 M tests/unit/full-refresh-windows.test.js
 M tests/unit/grease-validation.test.js
 M tests/unit/lubricador-dashboard.test.js
 M tests/unit/lubrication-follow-up.test.js
 M tests/unit/matriz-estado-celda.test.js
 M tests/unit/matriz-semanal.test.js
 M tests/unit/mis-engrases-baseline.test.js
 M tests/unit/notify-edge-functions-eligibility.test.js
 M tests/unit/onesignal-identity.test.js
 M tests/unit/operational-scope.test.js
 M tests/unit/plan-compliance.test.js
 M tests/unit/print-grease-plan-domingo.test.js
 M tests/unit/sync-auth-gate.test.js
 M tools/validate-assignment-skip-gateways.mjs
 M tools/validate-authorization-row-scope.mjs
 M tools/validate-operational-catalog-gateway.mjs
?? .agents/
?? AGENTS.md
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_ROLLBACK_PREPARED.sql
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0016_fix_support_rls_performance_PREPARED.sql
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0016_fix_support_rls_performance_ROLLBACK_PREPARED.sql
?? Test-Path
?? docs/0011_PRODUCTION_PREFLIGHT_READ_ONLY.sql
?? docs/0013_PRODUCTION_PREFLIGHT_READ_ONLY.sql
?? docs/0014_PRODUCTION_PREFLIGHT_READ_ONLY.sql
?? docs/0016_SECURITY_EQUIVALENCE_SUPABASE_FINAL.sql
?? docs/0016_SECURITY_EQUIVALENCE_VERIFICATION_READ_ONLY.sql
?? docs/20_5530_DUAL_SHIFT_APPLY.sql
?? docs/20_5530_DUAL_SHIFT_BASELINE_READ_ONLY.sql
?? docs/20_5530_DUAL_SHIFT_POSTCHECK_READ_ONLY.sql
?? docs/EXCAVATOR_DUAL_SHIFT.md
?? docs/EXCAVATOR_DUAL_SHIFT_PREFLIGHT_READ_ONLY.sql
?? docs/PRODUCTION_SYNC_BACKEND_ADDITIVE_RUNBOOK.md
?? docs/PRODUCTION_SYNC_BACKEND_PREFLIGHT_READ_ONLY.sql
?? docs/SESSION_HANDOFF.md
?? docs/SUPPORT_OTHER_LOCATION_0014.md
?? docs/evidence/EQUIPMENT_MASTER_LOCATION_AUDIT_2026-10-17.json
?? tests/ui/assignment-occurrence-execution-regression.spec.js
?? tests/ui/mi-turno-selected-crew.spec.js
?? tests/ui/support-grants-indexeddb.spec.js
?? tests/unit/double-shift-lifecycle.test.js
?? tests/unit/equipment-location-support-grant.test.js
?? tests/unit/equipment-master-location.test.js
?? tests/unit/excavator-dual-shift-notifications.test.js
?? tests/unit/excavator-dual-shift-status.test.js
?? tests/unit/lubricador-account-cursor-diagnostic.test.js
?? tests/unit/mi-turno-selected-crew.test.js
?? tests/unit/notifications-tasks-panel.test.js
?? tests/unit/push-token-migration-order.test.js
?? tests/unit/support-other-location.test.js
?? tests/unit/sync-audit-log-legacy.test.js
?? tools/diagnose-equipment-master-locations-readonly.js
?? tools/diagnose-lubricador-browser-readonly.js
?? tools/playwright-double-shift.config.mjs
?? tools/playwright-mi-turno.config.mjs
?? tools/playwright-support.config.mjs
?? tools/validate-authorization-bootstrap-production-prepared.mjs
?? "tools/validate-support-other-location (1).mjs"
?? tools/validate-support-other-location.mjs
```

**Nada de esto se tocó con `git add`/`commit`/`reset`/`checkout`/`clean` en esta sesión ni en la generación de este checkpoint.**

---

## PROMPT PARA CONTINUAR MAÑANA

```
Seguimos con CONTROL_ENGRASE.

Retomar exactamente desde: DUAL_SHIFT_PLAN_UI + WEEKLY_MATRIX

Lee primero docs/CHECKPOINT_2026-10-17.md completo antes de tocar nada.

CONTEXTO YA VALIDADO (no re-auditar, no re-implementar):
- Doble turno genérico (sin excavadora-only) — cerrado.
- Validación tardía — cerrada.
- Mi Turno por cobertura crew_locations (PRINCIPAL/APOYO) — cerrado.
- Trabajo normal por ubicación, sin assignment manual — cerrado.
- "Asignar a cuadrilla" ya se quitó de Plan de Engrase (acción normal);
  la excepción vive en la Ficha del equipo.
- Panel de notificaciones/tareas — turnos/dedupe/persistencia/offline ya
  auditados y con pruebas en verde; el recordatorio de validaciones
  pendientes es nuevo de ayer, sin probar en Android todavía.

OBJETIVO DE HOY — DOS BLOQUES, EN ESTE ORDEN:

BLOQUE 1 — DUAL_SHIFT_PLAN_UI (Plan de Engrase):
A. Auditar el checkbox "Obligaciones Día y Noche" y el selector de Turno
   en el formulario de plan — confirmar que escriben/leen requiredShifts
   y effectiveDate de forma coherente entre sí (no deben poder
   contradecirse en la UI).
B. Revisar específicamente el plan del equipo 05-0870.
C. NO tocar Supabase/RLS/0016/auth/sync. NO modificar occurrenceKey,
   doble turno en sí, ni historial — solo la UI/lógica del formulario de
   plan que decide requiredShifts/effectiveDate.

BLOQUE 2 — WEEKLY_MATRIX (Matriz Semanal):
A. Quitar/corregir las mini-celdas Día/Noche dentro de una matriz que ya
   está separada por turno (duplicación visual real).
B. Un equipo de doble turno debe aparecer en la matriz de Día Y en la de
   Noche (dos ocurrencias reales, nunca una sola celda fusionada).
C. Revisar los equipos 20-5530 y 05-0870 en la Matriz Semanal
   específicamente.
D. Revisar las filas combinadas "45-77 / A-07" y "A-02 / 45-69" — parecen
   fusionar visualmente dos equipos/ocurrencias distintas en una fila.
E. Revisar las métricas de programados/realizados/no realizados/
   pendientes/cumplimiento cuando hay doble turno de por medio.
F. NO tocar Supabase/RLS/0016/auth/sync.

Primero auditar cada bloque (como en las sesiones anteriores: leer el
código real, confirmar con git diff qué es de esta sesión y qué es
preexistente, no asumir). Aplicar el mínimo cambio necesario. Pruebas
dirigidas + typecheck + build antes de considerar cada bloque cerrado.
NO corras la suite completa hasta que las pruebas dirigidas de cada
bloque pasen. NO hagas commit salvo que se pida explícitamente.

Al cerrar cada bloque, reportar: ROOT CAUSE / CAMBIO / ARCHIVOS
MODIFICADOS / PRUEBAS / RIESGOS / VERDICT — mismo formato de siempre.
```
