// tests/ui/assignment-occurrence-execution-regression.spec.js
//
// Lote POST-0014 (2026-10-17) — ÚLTIMA cobertura crítica pedida antes de
// generar APK: confirmar AUTOMÁTICAMENTE que una lubrication_assignment
// atrasada (cross-crew/cross-location, caso real auditado:
// asg_muoqddz6p24k34 / equipo 05-0870 / plan_mskx6bbstrbbsz / occurrenceKey
// plan_mskx6bbstrbbsz:2026-09-30) conserva SU occurrenceKey original al
// REGISTRAR el engrase hoy — nunca uno recalculado contra la fecha actual.
//
// Ejecuta startGreaseFlow() REAL (mismo patrón ya probado en
// grease-form-layout-real.spec.js: extractDeclaration() desde la fuente
// canónica, nunca una reimplementación) contra un DB en memoria, con el
// ÚNICO límite real del sistema (DB.putExecutionOperation, el borde hacia
// IndexedDB/Supabase) interceptado — nunca Supabase real, nunca datos
// reales. El resto de la cadena (computeOccurrenceKey, buildExecutionSnapshot,
// resolveEarlyOccurrenceSatisfaction, completeAssignmentIfPending,
// queueLubricationExecution) es el código real sin tocar.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import {
  APP_JS_PATH, DB_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, HOURMETER_JS_PATH,
} from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const shiftsSource = readSource(SHIFTS_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);

const shiftsSrc = extractDeclaration(shiftsSource, 'currentShiftId');

const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'dualShiftStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');

// Todo lo que startGreaseFlow() real necesita de operational-scope.js —
// confirmado leyendo línea por línea su cuerpo real (8738-9522 de app.js),
// nunca adivinado. parseOccurrenceKeyDate() NO se incluye: ese helper es
// solo de DISPLAY (Mi Turno), startGreaseFlow() nunca lo usa.
const scopeNames = [
  'REQUIRED_SHIFT_IDS', 'ASSIGNMENT_STATUS', 'EXECUTION_TYPE', 'EXECUTION_COMPLETENESS', 'OUT_OF_PLAN_REASONS',
  'operationalDateForShift', 'toISODateUTCLocal', 'computeOccurrenceKey',
  'findActivePendingAssignment', 'findCarriedOverSkipForToday', 'computeExecutionCompleteness',
  'findNextApplicableOccurrenceForWeekdayPlan', 'findNextApplicableOccurrence', 'resolveEarlyOccurrenceSatisfaction',
  'canAdvanceHourCycle', 'findExistingWorkForEquipment', 'buildExecutionSnapshot', 'completeAssignmentIfPending',
  'ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveCrewLocationCoverage', 'resolveOperationalScope',
];
const scopeSrc = scopeNames.map(n => extractDeclaration(scopeSource, n)).join('\n\n');

const appNames = [
  '$', '$$', 'esc', 'ic', 'fmtDate', 'todayDateISO', 'GREASE_UNIT', 'STATUS_COLOR', 'WEEKDAY_ABBR_DASH',
  'NO_EXECUTION_REASON_LABELS', 'MAX_PHOTOS', 'trackRecentEquipment', 'photoFieldHTML', 'getPhotoFieldPhotos',
  'renderPhotoStrip', 'addPhotoToField', 'wirePhotoField', 'getSelectedPhotos', 'getSelectedCrewId',
  'getCurrentOperationalScope', 'shouldBlockCompleteChecklistWithoutGrease', 'confirmHourmeterChange',
  'equipoOccurrenceKey', 'startGreaseFlow',
];
const appSrc = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');

const persistenceSrc = ['uid', 'nowISO', 'stamp', 'queueLubricationExecution']
  .map(n => extractDeclaration(readSource(DB_JS_PATH), n)).join('\n');
const hourmeterSrc = extractDeclaration(readSource(HOURMETER_JS_PATH), 'validateHourmeterChange');

// Caso real auditado (post-0014) — mismos IDs/occurrenceKey de producción,
// nunca datos inventados sin relación con el bug reportado.
const EQUIPO = { id: 'e1', code: '05-0870', brand: 'CAT', model: 'D8T', status: 'Operativo', hourmeter: 1234, locationId: 'l2' };
const PLAN = { id: 'plan_mskx6bbstrbbsz', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Jueves'], shiftId: 'shift_dia' };
const ASSIGNMENT = {
  id: 'asg_muoqddz6p24k34', equipmentId: 'e1', planId: 'plan_mskx6bbstrbbsz', assignedCrewId: 'crew-fixture',
  occurrenceKey: 'plan_mskx6bbstrbbsz:2026-09-30', status: 'PENDING', active: true,
};
const LOCATION = { id: 'l2', name: 'Rajo Sur' };

async function bootPage(page) {
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue();
    }
  });
  await page.goto('/');
  await page.setContent('<div id="app-content"></div><div class="lub-shell"><main class="lub-content"><div id="reg-flow-area"></div></main><nav class="lub-bottom-nav"></nav></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = {
        currentUser: { id: 'lub1', name: 'Lubricador de prueba', role: 'LUBRICADOR' },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      window.confirm = () => true;
      window.alert = () => {};
      window.__mockData = {
        equipment: ${JSON.stringify([EQUIPO])},
        lubrication_plans: ${JSON.stringify([PLAN])},
        lubrication_points: [],
        lubrication_records: [],
        lubrication_assignments: ${JSON.stringify([ASSIGNMENT])},
        lubrication_skips: [],
        lubricants: [],
        locations: ${JSON.stringify([LOCATION])},
        users: [],
        grease_drafts: [],
        anomalies: [],
        // crew-fixture autorizada en 'l2' (APOYO) — igual que la cobertura
        // real cross-location del caso auditado (cuad_a/Mojón).
        cuadrillas: [{ id: 'crew-fixture', name: 'Cuadrilla de prueba', locationId: 'l1', memberUserIds: ['lub1'], active: true }],
        crew_locations: [
          { id: 'cl1', crew_id: 'crew-fixture', location_id: 'l1', role: 'PRINCIPAL', active: true },
          { id: 'cl2', crew_id: 'crew-fixture', location_id: 'l2', role: 'APOYO', active: true },
        ],
      };
      window.DB = {
        allActive: async (store) => window.__mockData[store] || [],
        all: async (store) => window.__mockData[store] || [],
        get: async (store, id) => (window.__mockData[store] || []).find(r => r.id === id) || null,
        put: async (store, row) => {
          const rows = window.__mockData[store] ||= [];
          const index = rows.findIndex(item => item.id === row.id);
          if (index < 0) rows.push(row); else rows[index] = row;
        },
        delete: async (store, id) => { window.__mockData[store] = (window.__mockData[store] || []).filter(row => row.id !== id); },
      };
      // ÚNICO límite real del sistema (borde hacia IndexedDB/Supabase):
      // interceptado — nunca toca red, nunca Supabase real, nunca datos
      // reales. Mismo patrón ya probado en grease-form-layout-real.spec.js.
      window.__executionOperations = [];
      DB.putExecutionOperation = async (operation, changes) => {
        for (const change of changes) await DB.put(change.store, { ...change.row, _executionOperationId: operation.id });
        __executionOperations.push(operation);
      };
      ${persistenceSrc}
      ${hourmeterSrc}
      window.createAutoAnomalies = async () => []; // sin puntos de checklist: nunca hay nada que anomalizar aquí
      window.notificarEngraseRealizado = async () => {};
      window.refreshLocalNotifications = async () => {};
      window.refreshAppBadge = async () => {};
      window.showInAppToast = () => {};
      window.logAudit = async () => {};
      window.irAMisEngrasesTrasRegistrar = () => {};
      window.Sync = { fullSync: () => {} };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${appSrc}
      window.startGreaseFlow = startGreaseFlow;
      window.computeOccurrenceKey = computeOccurrenceKey;
      window.todayDateISO = todayDateISO;
    `,
  });
}

test('REGRESIÓN POST-0014: registrar el engrase de una assignment atrasada conserva SU occurrenceKey original (nunca uno recalculado contra la fecha actual)', async ({ page }) => {
  // "Hoy" muy posterior al occurrenceKey original (2026-09-30) — mismo
  // escenario real auditado (asignación de hace semanas, ejecutada hoy).
  await page.clock.install({ time: new Date('2026-10-17T10:00:00') });
  const errors = []; page.on('pageerror', (e) => errors.push(e));

  await bootPage(page);
  await page.evaluate(() => window.startGreaseFlow('e1', document.getElementById('reg-flow-area')));
  expect(errors).toEqual([]);

  // Una sola assignment PENDING para este equipo+cuadrilla -> selectedAssignment
  // se autoselecciona (startGreaseFlow real, sin picker) — confirmado porque
  // el formulario carga directo, sin modal de selección.
  await expect(page.locator('.grease-flow-equipo-code')).toContainText('05-0870');
  await page.locator('input[name="qty"]').fill('2.0');
  await page.locator('.btn-grease-submit').click();
  await expect(page.locator('#grease-validate-now-btn')).toBeVisible();
  expect(errors).toEqual([]);

  const ORIGINAL_KEY = 'plan_mskx6bbstrbbsz:2026-09-30';

  // La clave calculada para "HOY" (si el bug reapareciera, sería la que se
  // usaría por error) — se obtiene con la función REAL, nunca hardcodeada,
  // para que la prueba siga siendo válida sin importar qué día se ejecute.
  const todayKey = await page.evaluate(() => {
    const plan = __mockData.lubrication_plans[0];
    return computeOccurrenceKey(plan, { dateISO: todayDateISO(), shiftId: 'shift_dia' });
  });
  expect(todayKey).not.toBe(ORIGINAL_KEY); // confirma que el escenario SÍ es "atrasado" de verdad

  const record = await page.evaluate(() => __mockData.lubrication_records[0]);
  expect(record).toBeTruthy();
  expect(record.planId).toBe('plan_mskx6bbstrbbsz');
  // executionDate/executedAt: la fecha REAL de hoy — nunca se exige que
  // coincida con el occurrenceKey original.
  expect(new Date(record.date).toDateString()).toBe(new Date('2026-10-17T10:00:00').toDateString());

  const snap = record.operationalSnapshot;
  expect(snap.assignmentId).toBe('asg_muoqddz6p24k34');
  expect(snap.executionType).toBe('ASSIGNED');
  expect(snap.occurrenceKey).toBe(ORIGINAL_KEY);
  expect(snap.satisfiedOccurrenceKey).toBe(ORIGINAL_KEY);
  expect(snap.assignedOccurrenceKey).toBe(ORIGINAL_KEY); // §ejecución tardía NUNCA satisface una occurrence distinta de HOY
  expect(snap.occurrenceKey).not.toBe(todayKey);
  expect(snap.satisfiedOccurrenceKey).not.toBe(todayKey);
  expect(snap.executedAt).toBeTruthy();

  // La propia assignment: se completa, pero su occurrenceKey ORIGINAL nunca cambia.
  const assignmentAfter = await page.evaluate(() => __mockData.lubrication_assignments[0]);
  expect(assignmentAfter.occurrenceKey).toBe(ORIGINAL_KEY);
  expect(assignmentAfter.status).toBe('COMPLETED');
  expect(assignmentAfter.completedRecordId).toBe(record.id);

  // El "request/operation" preparado para lubrication_execution (db.js:
  // queueLubricationExecution(), REAL, sin reimplementar) — el payload que
  // de verdad se despacharía hacia el gateway de ejecución.
  const operation = await page.evaluate(() => __executionOperations[0]);
  expect(operation.params.p_plan_id).toBe('plan_mskx6bbstrbbsz');
  expect(operation.params.p_assignment_id).toBe('asg_muoqddz6p24k34');
  expect(operation.params.p_execution_type).toBe('ASSIGNED');
  expect(operation.localRows.lubrication_records.operationalSnapshot.satisfiedOccurrenceKey).toBe(ORIGINAL_KEY);
  expect(operation.localRows.lubrication_records.operationalSnapshot.assignedOccurrenceKey).toBe(ORIGINAL_KEY);
});

for (const type of ['Articulado','Volquete','Tipo futuro']) test(`${type}: Day task executed offline at Night preserves assignment, key and actual execution shift`, async ({ page, context }) => {
  await page.clock.install({ time: new Date('2026-10-17T20:00:00') });
  await bootPage(page);
  await page.evaluate(type => {
    __mockData.equipment[0].typeId = type;
    Object.assign(__mockData.lubrication_plans[0], { requiredShifts: ['shift_dia','shift_noche'], effectiveDate: '2026-10-01', assignedDays: ['Sábado'] });
    __mockData.lubrication_assignments[0].occurrenceKey = 'plan_mskx6bbstrbbsz:2026-10-17:shift_dia';
    return startGreaseFlow('e1', document.getElementById('reg-flow-area'), { assignmentId: 'asg_muoqddz6p24k34' });
  }, type);
  await page.locator('input[name="qty"]').fill('2');
  await context.setOffline(true); await page.locator('.btn-grease-submit').click();
  await expect(page.locator('#grease-validate-now-btn')).toBeVisible();
  const result = await page.evaluate(() => ({ records: __mockData.lubrication_records, assignments: __mockData.lubrication_assignments, operations: __executionOperations }));
  expect(result.records).toHaveLength(1); expect(result.assignments).toHaveLength(1); expect(result.operations).toHaveLength(1);
  expect(result.records[0].shiftId).toBe('shift_noche');
  expect(result.records[0].operationalSnapshot.assignedOccurrenceKey).toBe('plan_mskx6bbstrbbsz:2026-10-17:shift_dia');
  expect(result.assignments[0]).toMatchObject({ id: 'asg_muoqddz6p24k34', occurrenceKey: 'plan_mskx6bbstrbbsz:2026-10-17:shift_dia', status: 'COMPLETED', completedRecordId: result.records[0].id });
  expect(result.operations[0].params.p_record_id).toBe(result.records[0].id);
  expect(result.operations[0].params.p_assignment_id).toBe('asg_muoqddz6p24k34');
});
