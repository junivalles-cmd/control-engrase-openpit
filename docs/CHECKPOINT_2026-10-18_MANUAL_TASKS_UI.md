# CHECKPOINT — Control de Engrase — 2026-10-18 — antes de MANUAL_TASKS_UI

Rama: `migration-typescript`. **Sin commit en ningún momento de esta sesión.** Sin push.

---

## 1. ESTADO ACTUAL

**0017 (`broadcast_messages` / `broadcast_message_reads` / `manual_tasks`) está `ACTIVE` en producción (`cont_engrase`, ref `havrirlapjyqrffgalqx`)**, aplicada el 18/10/2026 19:28:12 UTC. Batería funcional completa corrida en vivo contra producción con fixtures `TEST0017_*` (sesiones forjadas con las 4 cuentas reales existentes, sin contraseñas, sin usuarios sintéticos):

- 44/44 checks PASS, 0 fallos.
- `EXISTING STORE EQUIVALENCE`: OLD_NOT_NEW=0, NEW_NOT_OLD=0 (17 stores previos, conteos idénticos antes/después/post-limpieza).
- BROADCAST RLS: PASS (ADMIN/PLANIFICADOR crean, SUPERVISOR no crea ni recibe, LUBRICADOR recibe ALL_LUBRICATORS/CREW/LOCATION propios, no otra cuadrilla).
- `manual_tasks` create/visibility/completion: PASS.
- 8 campos protegidos (equipmentId, crewId, createdBy, title, description, taskType, priority, dueAt): los 8 DENY confirmados, fila intacta tras cada intento.
- Otra cuadrilla (ver/completar tarea ajena): DENY confirmado.
- Backend/payload/allowlist de fotos (`photos`/`photo`/`photoUploaded`, vía SQL real contra producción — sin HTTP real a Storage, sin credenciales): PASS.
- Reasignación (crewId A→B, mismo `task.id`/`equipmentId`, A pierde acceso): PASS. "B gana acceso" sólo verificado a nivel de función (no existe 2da cuenta LUBRICADOR real en producción) — limitación documentada, no un fallo.
- Cancelación (PENDING→CANCELLED, fila persiste): PASS.
- Performance: ~1.4–1.7 ms por consulta, sin tocar `statement_timeout`.
- Fixtures `TEST0017_*` limpiados — `TEST_FIXTURES_LEFT = 0`. Sin filas huérfanas en `notification_dispatch_log` (el webhook `avisar-push` ignora los 3 stores nuevos, confirmado).
- **ROLLBACK: NO usado.** Ninguna de las 6 condiciones de rollback pactadas se activó.

Detalle completo del reporte (comandos SQL, evidencia, incidente de herramienta corregido durante la corrida) en la respuesta de esa tarea — no se duplica aquí.

---

## 2. QUÉ QUEDÓ CERRADO

- Migración `0017_broadcast_messages_scope_PREPARED.sql` — **aplicada y activa en producción**.
- Rollback `0017_broadcast_messages_scope_ROLLBACK_PREPARED.sql` — revisado línea por línea, confirmado que restaura exactamente el comportamiento de 0016 (no destructivo, deja funciones nuevas instaladas-pero-revocadas). **Sigue disponible si se necesita en el futuro** — no se usó.
- Autorización RLS para los 3 stores nuevos (broadcast_messages, broadcast_message_reads, manual_tasks) — **completamente validada en producción real**, no solo local/PGlite.
- Pipeline de fotos: allowlist de cierre corregida para incluir `photo`/`photos`/`photoUploaded` (coincide exactamente con lo que persiste `Sync.uploadPhotoIfNeeded()`/`stripLocalAuthorizationMetadata()` hoy).

---

## 3. QUÉ NO SE TOCÓ (a propósito, y debe seguir así)

- 0014 / 0015 / 0016 / 0017 — ningún archivo de migración existente se editó.
- RLS / backend de Supabase — sin cambios adicionales a los de 0017 ya aplicados.
- Matriz Semanal / Doble turno — sin tocar en esta sesión.
- **Cliente (`app.js`/`db.js`/`sync.js`/`STORES`) — `manual_tasks` NO está integrado todavía.** No hay UI, no hay IndexedDB, no hay sync cliente para esta store. Todo lo validado hoy fue backend/SQL directo contra producción, nunca a través de la app real.

---

## 4. ARCHIVOS MODIFICADOS SIN COMMIT (ver sección 5 para el detalle exacto)

**Importante — hay dos lotes de trabajo sin commitear mezclados en el working tree, de sesiones/bloques distintos:**

- **Lote DUAL_SHIFT_PLAN_UI / WEEKLY_MATRIX** (bloque pendiente documentado en `docs/CHECKPOINT_2026-10-17.md`, trabajo de Codex/sesión previa — **no tocado hoy**): `app.js`, `db.js`, `index.html`, `src/core/*.js`, `styles.css`, gran parte de `tests/unit/*` y `tests/ui/*`, `tools/validate-*.mjs`, más los archivos nuevos `tests/ui/plan-dual-shift-form.spec.js`, `tests/ui/weekly-matrix-dual-shift.spec.js`, `tests/ui/configuration-navigation-real.spec.js`, `tools/playwright-plan-dual-shift.config.mjs`, `tools/playwright-weekly-matrix.config.mjs`, `tools/playwright-config-nav.config.mjs`, `tools/playwright-crew-config-ui.config.mjs`, `src/core/tasks-notifications-panel.js`, `tests/unit/tasks-notifications-panel.test.js`, `tests/ui/tasks-notifications-panel-ui.spec.js`, entre otros.
- **Lote 0017 (hoy y sesión previa, docs/evidencia/preparación — nunca código de cliente)**: migraciones `0007`/`0009`–`0013` `_PREPARED`/`_ROLLBACK` (ya existían modificados, no se re-tocaron hoy), `0014_*_ROLLBACK_PREPARED.sql`, `0016_fix_support_rls_performance_*.sql`, `0017_broadcast_messages_scope_PREPARED.sql` + `_ROLLBACK_PREPARED.sql` (aplicada hoy, sin cambios de contenido en esta sesión de checkpoint), `docs/0017_*.md`/`*.sql`, `docs/evidence/0017_*.json`, `tests/sql/0017-*`, `tests/staging0017/*`, `supabase/staging/0017_*` (preparación de staging, nunca ejecutada), `supabase/.temp/*` (caché local del CLI, no versionable).
- **Sueltos / sin relación con ninguno de los dos bloques**: `.agents/` y `AGENTS.md` (configuración propia de Codex, no tocar), `Test-Path` (archivo residual, probablemente de un comando mal interpretado — revisar/eliminar en otra sesión, no se tocó hoy), `docs/SESSION_HANDOFF.md` (excluido de commits como siempre, por convención de este proyecto).

**Nada de esto se tocó con `git add`/`commit`/`reset`/`checkout`/`clean` en esta sesión.**

---

## 5. GIT STATUS --SHORT (snapshot exacto de este checkpoint)

```
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/db.js
 M CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/index.html
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
 M tests/ui/config-desktop-grid.spec.js
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
 M tests/unit/config-categories.test.js
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
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/tasks-notifications-panel.js
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0014_assignment_skip_gateways_ROLLBACK_PREPARED.sql
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0016_fix_support_rls_performance_PREPARED.sql
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0016_fix_support_rls_performance_ROLLBACK_PREPARED.sql
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0017_broadcast_messages_scope_PREPARED.sql
?? CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0017_broadcast_messages_scope_ROLLBACK_PREPARED.sql
?? Test-Path
?? docs/0011_PRODUCTION_PREFLIGHT_READ_ONLY.sql
?? docs/0013_PRODUCTION_PREFLIGHT_READ_ONLY.sql
?? docs/0014_PRODUCTION_PREFLIGHT_READ_ONLY.sql
?? docs/0016_SECURITY_EQUIVALENCE_SUPABASE_FINAL.sql
?? docs/0016_SECURITY_EQUIVALENCE_VERIFICATION_READ_ONLY.sql
?? docs/0017_BROADCAST_MESSAGES_EQUIVALENCE_TESTS_READ_ONLY.sql
?? docs/0017_PREAPPLY_FUNCTION_CATALOG_READ_ONLY.sql
?? docs/0017_PREAPPLY_PREFLIGHT_READ_ONLY.sql
?? docs/0017_STAGING_PREPARATION_2026-10-18.md
?? docs/0017_SUPABASE_PREAPPLY_2026-10-18.md
?? docs/0017_VALIDATION_2026-10-18.md
?? docs/20_5530_DUAL_SHIFT_APPLY.sql
?? docs/20_5530_DUAL_SHIFT_BASELINE_READ_ONLY.sql
?? docs/20_5530_DUAL_SHIFT_POSTCHECK_READ_ONLY.sql
?? docs/CHECKPOINT_2026-10-17.md
?? docs/CHECKPOINT_2026-10-18_MANUAL_TASKS_UI.md
?? docs/EXCAVATOR_DUAL_SHIFT.md
?? docs/EXCAVATOR_DUAL_SHIFT_PREFLIGHT_READ_ONLY.sql
?? docs/PRODUCTION_SYNC_BACKEND_ADDITIVE_RUNBOOK.md
?? docs/PRODUCTION_SYNC_BACKEND_PREFLIGHT_READ_ONLY.sql
?? docs/SESSION_HANDOFF.md
?? docs/SUPPORT_OTHER_LOCATION_0014.md
?? docs/evidence/0017_BASELINE_BUILD_2026-10-18.json
?? docs/evidence/0017_LOCAL_VALIDATION_2026-10-18.json
?? docs/evidence/0017_PHOTO_CONTRACT_2026-10-18.json
?? docs/evidence/0017_PHOTO_SQL_CONTRACT_2026-10-18.json
?? docs/evidence/0017_SCHEMA_COMPARISON_2026-10-18.json
?? docs/evidence/0017_STAGING_PREPARATION_2026-10-18.json
?? docs/evidence/0017_SUPABASE_FUNCTION_HASHES_2026-10-18.json
?? docs/evidence/0017_SUPABASE_PREAPPLY_FINAL_2026-10-18.json
?? docs/evidence/0017_SUPABASE_PREAPPLY_PREFLIGHT_2026-10-18.json
?? docs/evidence/EQUIPMENT_MASTER_LOCATION_AUDIT_2026-10-17.json
?? supabase/
?? tests/sql/
?? tests/staging0017/
?? tests/ui/assignment-occurrence-execution-regression.spec.js
?? tests/ui/configuration-navigation-real.spec.js
?? tests/ui/mi-turno-selected-crew.spec.js
?? tests/ui/plan-dual-shift-form.spec.js
?? tests/ui/support-grants-indexeddb.spec.js
?? tests/ui/tasks-notifications-panel-ui.spec.js
?? tests/ui/weekly-matrix-dual-shift.spec.js
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
?? tests/unit/tasks-notifications-panel.test.js
?? tools/diagnose-equipment-master-locations-readonly.js
?? tools/diagnose-lubricador-browser-readonly.js
?? tools/playwright-config-nav.config.mjs
?? tools/playwright-crew-config-ui.config.mjs
?? tools/playwright-double-shift.config.mjs
?? tools/playwright-mi-turno.config.mjs
?? tools/playwright-plan-dual-shift.config.mjs
?? tools/playwright-support.config.mjs
?? tools/playwright-weekly-matrix.config.mjs
?? tools/validate-authorization-bootstrap-production-prepared.mjs
?? "tools/validate-support-other-location (1).mjs"
?? tools/validate-support-other-location.mjs
```

---

## 6. PENDIENTES

1. **MANUAL_TASKS_UI** (siguiente bloque — ver sección 7).
2. Prueba HTTP real de subida de foto a Storage para `manual_tasks` — bloqueada hasta que exista UI/cliente real desde donde dispararla (no se va a inventar JWT ni pedir contraseñas).
3. "B gana acceso" en reasignación — sólo verificado a nivel de función; para una prueba 100% end-to-end haría falta una 2da cuenta LUBRICADOR real en producción (no crear sin que el usuario lo pida explícitamente).
4. Bloque DUAL_SHIFT_PLAN_UI / WEEKLY_MATRIX (de `docs/CHECKPOINT_2026-10-17.md`) sigue abierto, sin tocar — es un bloque **distinto** al de hoy, no mezclar.
5. `Test-Path` (archivo suelto en la raíz) — revisar qué lo generó y si se puede borrar, en otra sesión.

---

## 7. RIESGOS CONOCIDOS

- **El working tree mezcla 2+ lotes de trabajo sin commitear** (0017 + dual-shift/weekly-matrix + sueltos). Cualquier commit futuro debe revisar con cuidado qué archivos pertenecen a qué bloque antes de agrupar — no asumir que "todo lo modificado" es de un solo tema.
- `manual_tasks` ya tiene autorización RLS real y activa en producción, pero **cero cliente** la usa todavía — esto es seguro (nadie puede escribir ahí sin pasar por la matriz/row-scope ya probada), pero significa que cualquier UI nueva debe integrarse exactamente contra el contrato ya validado (payload, campos protegidos, allowlist de cierre) sin asumir nada distinto.
- El pipeline de fotos para `manual_tasks` fue validado solo a nivel SQL/backend — la primera vez que se dispare un upload real desde la UI nueva es la primera prueba end-to-end real de ese flujo con este store. Probar con cuidado (cuadrilla propia, offline/online, tamaño de imagen) antes de darlo por cerrado.
- `supabase/.temp/` quedó en el working tree (caché del CLI de los comandos `db query --linked` de hoy) — no es código, pero conviene confirmar que está en `.gitignore` antes de cualquier commit futuro.

---

## 8. PRÓXIMO BLOQUE — MANUAL_TASKS_UI

Flujo a implementar al retomar (NO empezar todavía):

```
SUPERVISOR / ADMINISTRADOR / PLANIFICADOR
→ crear tarea
→ seleccionar equipo
→ seleccionar cuadrilla
→ tipo de tarea
→ descripción/prioridad
→ LUBRICADOR de esa cuadrilla la ve
→ completar tarea
→ comentario/respuesta
→ foto(s) de evidencia
→ sincronización/offline
→ historial de cierre
```

También debe integrarse `manual_tasks` en `STORES`/IndexedDB/sync cliente (`db.js`/`sync.js`), reusando el pipeline de fotos genérico existente (`Sync.uploadPhotoIfNeeded('manual_tasks', row, cfg)` — ya es compatible, sin cambios de sync.js necesarios según el comentario de cabecera de la propia migración 0017).

**NO tocar al implementar este bloque:** 0014, 0015, 0016, 0017, RLS, backend de Supabase, Matriz Semanal, doble turno.

---

## PROMPT PARA CONTINUAR

```
Seguimos con CONTROL_ENGRASE.

Retomar exactamente desde: MANUAL_TASKS_UI

Lee primero docs/CHECKPOINT_2026-10-18_MANUAL_TASKS_UI.md completo antes
de tocar nada.

CONTEXTO YA VALIDADO (no re-auditar, no re-aplicar, no re-probar RLS):
- 0017 está ACTIVE en producción desde el 18/10/2026. 44/44 checks PASS
  en vivo contra producción real (broadcast, manual_tasks create/
  visibility/completion, 8 campos protegidos DENY, otra cuadrilla DENY,
  backend de fotos, reasignación, cancelación, performance). Rollback
  no usado, no reproponer aplicar/revertir 0017 sin que se pida.

OBJETIVO DE HOY — MANUAL_TASKS_UI:
1. Integrar manual_tasks en STORES/IndexedDB/sync cliente (db.js/sync.js).
2. UI de creación (ADMIN/PLANIFICADOR/SUPERVISOR): equipo, cuadrilla,
   tipo de tarea, descripción/prioridad.
3. Visibilidad para LUBRICADOR de su(s) cuadrilla(s).
4. Completar tarea: comentario + foto(s) de evidencia, reusando
   Sync.uploadPhotoIfNeeded('manual_tasks', row, cfg) — pipeline
   genérico ya existente, sin tocar sync.js si no hace falta.
5. Offline/sincronización real.
6. Historial de cierre.

NO tocar: 0014, 0015, 0016, 0017, RLS, backend de Supabase, Matriz
Semanal, doble turno.

Primero auditar el contrato RLS ya validado (ver el reporte de la tarea
0017 y el archivo 0017_broadcast_messages_scope_PREPARED.sql) antes de
diseñar la UI, para no asumir ningún campo/permiso distinto a lo ya
probado. Aplicar el mínimo cambio necesario. Pruebas dirigidas +
typecheck + build antes de considerar el bloque cerrado. NO corras la
suite completa hasta que las pruebas dirigidas pasen. NO hagas commit
salvo que se pida explícitamente.

Al cerrar, reportar: ROOT CAUSE / CAMBIO / ARCHIVOS MODIFICADOS /
PRUEBAS / RIESGOS / VERDICT.
```
