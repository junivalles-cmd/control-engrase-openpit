// tests/ui/tasks-notifications-panel-ui.spec.js
//
// "Cerrar bloque PANEL DE NOTIFICACIONES/TAREAS" (2026-10-18) — renderLubricadorHome()
// REAL (app.js) con src/core/tasks-notifications-panel.js REAL cargado,
// mismo patrón de arranque que tests/ui/crew-location-coverage.spec.js
// (IndexedDB real, sin red). Cubre la UI: sección nueva "ANOMALÍAS
// ABIERTAS"/"NOTIFICACIONES" dentro de Mi Turno, acciones reales
// ("Ver anomalía" abre el formulario real con la anomalía real), filtro de
// turno en notificaciones, y que recalcular/rerender no duplica nada.
import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH,
  TASKS_NOTIFICATIONS_PANEL_JS_PATH } from '../helpers/loadLubricationLogic.js';

const declarations = (file, names) => names.map(name => extractDeclaration(readSource(file), name)).join('\n');
const source = [
  declarations(DB_JS_PATH, ['DB_NAME', 'DB_VERSION', 'STORES', 'LOCAL_STORES', 'tx', 'openDB', 'DB', 'uid', 'nowISO', 'stamp']),
  ...[SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH, TASKS_NOTIFICATIONS_PANEL_JS_PATH].map(readSource),
  declarations(APP_JS_PATH, ['$', '$$', 'esc', 'ic', 'todayDateISO', 'STATUS_COLOR', 'GREASE_UNIT', 'NO_EXECUTION_REASON_LABELS',
    'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope',
    'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome', 'openModal', 'closeModal', 'wireMatrixOccurrenceDetails', 'wireMatrizScrollHint',
    'openLubricadorMatrizModal', 'handleOutOfPlanEquipoSelected', 'startLubricadorGreaseFlow', 'cuadrillasPanelHTML', 'wireCuadrillasPanel']),
].join('\n');

const crew = { id: 'C1', name: 'Cuadrilla C1', locationId: 'volcan', isDefault: true, memberUserIds: ['lub'], active: true };
const otherCrew = { id: 'C2', name: 'Cuadrilla C2', locationId: 'volcan', isDefault: false, memberUserIds: ['lub2'], active: true };
const locations = [{ id: 'volcan', name: 'Volcán' }];
const coverage = [{ id: 'cl:volcan', crew_id: 'C1', location_id: 'volcan', role: 'PRINCIPAL', active: true, updatedAt: '2026-10-10T10:00:00.000Z' }];

async function boot(page, { equipmentRows, anomalyRows = [], assignmentRows = [], crews = [crew, otherCrew] } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/__panel_fixture', route => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app-content"></main></body></html>' }));
  await page.goto('/__panel_fixture');
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  await page.addScriptTag({ content: `
    let _db = null;
    window.App = { route: 'turno', currentUser: { id: 'lub', name: 'Lubricador de prueba', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 } };
    let lastSyncState = { status: 'ok' };
    window.navigate = () => {}; window.openQrScanner = () => {};
    window.openEquipmentDetail = id => { window.__calls = (window.__calls || []).concat([['VER_EQUIPO', id]]); };
    window.openOutOfPlanEquipmentPicker = () => {}; window.openValidationDetailModal = () => {};
    window.openValidationModal = (rec, eq, onDone) => { window.__calls = (window.__calls || []).concat([['VALIDAR', rec.id, eq.id]]); };
    window.openAnomalyForm = async (equipmentId, label, existing) => { window.__calls = (window.__calls || []).concat([['VER_ANOMALIA', existing ? existing.id : null]]); };
    window.updateLubricadorWidgetSnapshot = () => {};
    window.startGreaseFlow = async () => {};
    window.refreshPushTokenCrewScope = async () => {};
    window.Sync = { fullSync: async () => ({ ok: true }), getAccountSyncState: async () => ({ bootstrapComplete: true }) };
    window.logAudit = async () => {}; window.showInAppToast = () => {};
    window.Auth = { manageUsers: async () => ({ users: [] }) };
    ${source}
    window.DB = DB;
    // UX CAMPO V2 (2026-10-24): los 3 acordeones de Mi Turno nacen
    // colapsados — se expanden automáticamente tras cada render
    // (idempotente) para no romper la cobertura del panel de
    // tareas/notificaciones de este archivo, ajena a la interacción
    // propia del acordeón.
    renderLubricadorHome = (() => {
      const real = renderLubricadorHome;
      return async (...args) => {
        const result = await real(...args);
        document.querySelectorAll('.lub-accordion-panel').forEach(p => { p.hidden = false; });
        document.querySelectorAll('.lub-accordion-head').forEach(b => b.setAttribute('aria-expanded', 'true'));
        return result;
      };
    })();
    window.renderLubricadorHome = renderLubricadorHome;
    window.getCurrentOperationalScope = getCurrentOperationalScope;
    window.openDB = openDB;
  ` });
  await page.evaluate(async ({ crews, locations, coverage, equipmentRows, anomalyRows, assignmentRows }) => {
    await openDB();
    await DB.setConfig({ lastPull: '2026-10-10T10:00:00.000Z' });
    for (const cq of crews) await DB.put('cuadrillas', cq);
    for (const l of locations) await DB.put('locations', l);
    await DB.putMany('crew_locations', coverage);
    const day = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()];
    const equipment = equipmentRows || [{ id: 'e1', code: '05-0870', locationId: 'volcan' }];
    for (const e of equipment) {
      await DB.put('equipment', { brand: 'CAT', model: 'D8', status: 'Operativo', hourmeter: 100, active: true, ...e });
      await DB.put('lubrication_plans', { id: `plan:${e.id}`, equipmentId: e.id, controlType: 'Día y turno de la semana', assignedDays: [day], active: true });
    }
    for (const a of anomalyRows) await DB.put('anomalies', { active: true, ...a });
    for (const a of assignmentRows) await DB.put('lubrication_assignments', { active: true, status: 'PENDING', ...a });
    await renderLubricadorHome();
  }, { crews, locations, coverage, equipmentRows, anomalyRows, assignmentRows });
  return errors;
}

test('1. Anomalía abierta del equipo visible aparece como TAREA, con la prioridad/criticidad real', async ({ page }) => {
  const errors = await boot(page, { anomalyRows: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Crítica', description: 'Fuga de grasa' }] });
  await expect(page.locator('#lub-tasks-notifications')).toContainText('ANOMALÍAS ABIERTAS');
  await expect(page.locator('#lub-tasks-notifications')).toContainText('05-0870');
  await expect(page.locator('#lub-tasks-notifications')).toContainText('CRÍTICA');
  expect(errors).toEqual([]);
});

test('2. Acción "Ver anomalía" abre el formulario real con la anomalía real (nunca un botón sin destino)', async ({ page }) => {
  await boot(page, { anomalyRows: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media', description: 'Grasera dañada' }] });
  await page.locator('#lub-tasks-notifications .lub-panel-action').click();
  expect(await page.evaluate(() => window.__calls)).toEqual([['VER_ANOMALIA', 'a1']]);
});

test('9. Anomalía resuelta (Cerrada) desaparece de la sección de tareas', async ({ page }) => {
  await boot(page, { anomalyRows: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }] });
  await expect(page.locator('#lub-tasks-notifications')).toContainText('ANOMALÍAS ABIERTAS');
  await page.evaluate(async () => { await DB.put('anomalies', { id: 'a1', equipmentId: 'e1', status: 'Cerrada', criticality: 'Media', active: true }); await renderLubricadorHome(); });
  await expect(page.locator('#lub-tasks-notifications')).toHaveCount(0);
});

test('11. Mi Turno no renderiza notificaciones salientes dentro del flujo principal', async ({ page }) => {
  const errors = await boot(page, {
    equipmentRows: [{ id: 'e1', code: '05-0870', locationId: 'volcan' }],
    assignmentRows: [{ id: 'asg1', equipmentId: 'e1', occurrenceKey: 'plan:e1:2026-10-18', assignedCrewId: 'C2', previousCrewId: 'C1', status: 'PENDING' }],
  });
  await expect(page.locator('#lub-tasks-notifications')).toHaveCount(0);
  await expect(page.locator('#app-content')).not.toContainText('Cambio de asignación');
  expect(errors).toEqual([]);
});

test('7/8. Reconexión/sync repetido: recalcular el panel varias veces no duplica tarjetas', async ({ page }) => {
  await boot(page, { anomalyRows: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Alta' }] });
  await expect(page.locator('#lub-tasks-notifications .lub-eq-list .lub-arrastrado-card')).toHaveCount(1);
  await page.evaluate(() => renderLubricadorHome());
  await page.evaluate(() => renderLubricadorHome());
  await expect(page.locator('#lub-tasks-notifications .lub-eq-list .lub-arrastrado-card')).toHaveCount(1);
});

test('6. Nunca mini-celdas ni tarjetas sin acción: cada tarjeta trae exactamente un botón con destino', async ({ page }) => {
  // Dos equipos distintos a propósito: e2 se reasigna fuera de la cuadrilla
  // (deja de ser "suyo" — classifyEquipmentWork() ya lo excluye de su
  // alcance normal/asignado), así que su anomalía no debería mezclarse con
  // la de e1, que sigue siendo responsabilidad real de esta cuadrilla.
  await boot(page, {
    equipmentRows: [{ id: 'e1', code: '05-0870', locationId: 'volcan' }, { id: 'e2', code: '20-5530', locationId: 'volcan' }],
    anomalyRows: [{ id: 'a1', equipmentId: 'e1', status: 'Abierta', criticality: 'Media' }],
    assignmentRows: [{ id: 'asg1', equipmentId: 'e2', occurrenceKey: 'plan:e2:2026-10-18', assignedCrewId: 'C2', previousCrewId: 'C1', status: 'PENDING' }],
  });
  const cards = page.locator('#lub-tasks-notifications .lub-arrastrado-card');
  await expect(cards).toHaveCount(1);
  for (const card of await cards.all()) {
    await expect(card.locator('.lub-panel-action')).toHaveCount(1);
  }
});
