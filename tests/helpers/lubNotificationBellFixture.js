import { LUBRICATION_FOLLOW_UP_APP_NAMES } from '../helpers/lubricationFollowUpFixture.js';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH,
  TASKS_NOTIFICATIONS_PANEL_JS_PATH } from '../helpers/loadLubricationLogic.js';

const declarations = (file, names) => names.map(name => extractDeclaration(readSource(file), name)).join('\n');
const source = [
  readSource(DB_JS_PATH),
  ...[SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH, WEEKLY_MATRIX_JS_PATH, TASKS_NOTIFICATIONS_PANEL_JS_PATH].map(readSource),
  declarations(APP_JS_PATH, ['$', '$$', 'esc', 'ic', 'todayDateISO', 'STATUS_COLOR', 'GREASE_UNIT', 'NO_EXECUTION_REASON_LABELS',
    'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope',
    'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', ...LUBRICATION_FOLLOW_UP_APP_NAMES, 'renderLubricadorHome', 'openModal', 'closeModal', 'wireMatrixOccurrenceDetails', 'wireMatrizScrollHint', 'armSyncWatchdog',
    'openLubricadorMatrizModal', 'handleOutOfPlanEquipoSelected', 'startLubricadorGreaseFlow', 'cuadrillasPanelHTML', 'wireCuadrillasPanel', 'bootLubricador', 'wirePullToSync', 'computeTasksMensajesBadgeCount', 'updateTareasMensajesNavBadge', 'markBroadcastAsRead', 'onSyncStateChange']),
  readSource(path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/lubricador-notifications.js')),
].join('\n');

const crew = { id: 'C1', name: 'Cuadrilla C1', locationId: 'volcan', isDefault: true, memberUserIds: ['lub'], active: true };
const otherCrew = { id: 'C2', name: 'Cuadrilla C2', locationId: 'volcan', isDefault: false, memberUserIds: ['lub2'], active: true };
const locations = [{ id: 'volcan', name: 'Volcán' }];
const coverage = [{ id: 'cl:volcan', crew_id: 'C1', location_id: 'volcan', role: 'PRINCIPAL', active: true, updatedAt: '2026-10-10T10:00:00.000Z' }];

export async function bootBell(page, { equipmentRows, anomalyRows = [], assignmentRows = [], crews = [crew, otherCrew] } = {}) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('dialog', d => d.accept());
  await page.route('**/__panel_fixture', route => route.fulfill({ contentType: 'text/html', body: '<html data-mode="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"></head><body><main id="app-content"></main></body></html>' }));
  await page.goto('/__panel_fixture');
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  await page.addScriptTag({ content: `

    window.App = { route: 'turno', currentUser: { id: 'lub', name: 'Lubricador de prueba', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 } };
    let lastSyncState = { status: 'ok' };
    let _syncWatchdogTimer = null;
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
    window.Auth = { isSupabaseMode: () => true, getProfile: () => ({ appUserId: 'lub' }), manageUsers: async () => ({ users: [] }) };
    window.refreshLocalNotifications = () => {}; window.redibujarPantallaActual = () => {};
    window.onSyncStateChange = onSyncStateChange;
    window.openLubAccountMenu = () => {}; window.wireQuickFind = () => {}; window.handleQrDeepLink = () => {};
    window.wireKeyboardOpenWatcher = () => {}; window.wireShiftTimer = fn => fn();
    window.updateConnBadge = () => { document.getElementById('conn-badge').textContent = 'SINCRONIZADO'; };
    window.focusTareasYMensajesItem = async (kind, id) => { window.__focus = { kind, id }; };
    window.navigate = route => { App.route = route; };
    ${source}
    window.DB = DB;
    // UX CAMPO V2 (2026-10-24): los 3 acordeones de Mi Turno nacen
    // colapsados — este fixture los expande automáticamente después de
    // CADA render (idempotente, nunca cierra lo ya abierto; cubre tanto
    // bootLubricador() -> navigate('turno') como un re-render manual),
    // para no romper la cobertura de este archivo (panel de
    // notificaciones/tareas), que no es sobre la interacción propia del
    // acordeón.
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
    window.openDB = openDB; window.updateTareasMensajesNavBadge = updateTareasMensajesNavBadge; window.bootLubricador = bootLubricador;
  ` });
  await page.evaluate(async ({ crews, locations, coverage, equipmentRows, anomalyRows, assignmentRows }) => {
    await openDB();
    await DB.setAuthorizationContext('lub', { appUserId: 'lub', authUserId: 'auth-lub', active: true, scopeType: 'CREW_SCOPED', authorizedCrewIds: ['C1'], authorizedLocationIds: ['volcan'] });
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
    bootLubricador(); await renderLubricadorHome();
  }, { crews, locations, coverage, equipmentRows, anomalyRows, assignmentRows });
  return errors;
}

