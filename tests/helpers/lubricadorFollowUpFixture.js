import path from 'node:path';
import { readSource, extractDeclaration } from './extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH } from './loadLubricationLogic.js';
import { LUBRICATION_FOLLOW_UP_APP_NAMES } from './lubricationFollowUpFixture.js';
const appSource = readSource(APP_JS_PATH);
const declarations = (source, names) => names.map(n => extractDeclaration(source, n)).join('\n');
const core = [SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH].map(readSource).join('\n');
const db = declarations(readSource(DB_JS_PATH), ['DB_NAME', 'DB_VERSION', 'STORES', 'LOCAL_STORES', 'tx', 'openDB', 'DB', 'uid', 'nowISO', 'stamp']);
export const followUpCrew = { id: 'C1', name: 'Cuadrilla ficticia', locationId: 'M', isDefault: true, active: true, memberUserIds: ['U1'] };
export const followUpLocations = [{ id: 'M', name: 'Mojón' }, { id: 'V', name: 'Volcán' }, { id: 'O', name: 'Otra ubicación' }];
export const followUpCoverage = [{ id: 'CM', crew_id: 'C1', location_id: 'M', role: 'PRINCIPAL', active: true }, { id: 'CV', crew_id: 'C1', location_id: 'V', role: 'APOYO', active: true }];
export const followUpEquipment = [
  { id: 'E1', code: 'TEST-M', locationId: 'M' }, { id: 'E2', code: 'TEST-V', locationId: 'V' }, { id: 'E3', code: 'TEST-O', locationId: 'O' },
].map(e => ({ ...e, brand: 'Komatsu', model: 'PC500LC-10M0', status: 'Operativo', active: true, hourmeter: 10 }));
export const followUpRecords = followUpEquipment.map((e, i) => ({ id: `R${i}`, equipmentId: e.id, date: `2026-10-0${5 + i}T08:39:00`, active: true, shiftId: 'shift_dia', userName: 'Fixture' }));
export async function bootLubricadorFollowUp(page, { source = appSource, equipos = followUpEquipment, records = followUpRecords, coverage = followUpCoverage, plans = [], assignments = [], skips = [],
  // Age-only scenarios use signed historical executions. Pass [] explicitly
  // for a pending-validation scenario; real validation rules stay enabled.
  validations = records.map(r => ({ id:`validation:${r.id}`,lubricationRecordId:r.id,signerRole:'OPERADOR',active:true })) } = {}) {
  const errors = []; page.on('pageerror', e => errors.push(e.message));
  await page.route('**/*', route => {
    if (route.request().url().endsWith('/__follow_up_fixture')) return route.fulfill({ contentType: 'text/html', body: '<main id="app-content"></main>' });
    // Fulfill imported fonts' stylesheet locally: aborting @import makes
    // Chromium reject addStyleTag. All other remote requests stay blocked.
    if (route.request().resourceType() === 'stylesheet') return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  await page.goto('/__follow_up_fixture');
  await page.clock.install({ time: new Date('2026-10-10T15:00:00') });
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  const extras = LUBRICATION_FOLLOW_UP_APP_NAMES.filter(n => source.includes(`function ${n}(`) || source.includes(`const ${n} =`));
  const app = declarations(source, ['$', '$$', 'esc', 'ic', 'todayDateISO', 'STATUS_COLOR', 'GREASE_UNIT', 'NO_EXECUTION_REASON_LABELS', 'colorLegendHTML', 'validationBadgeHTML', 'computeAllStatuses', 'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope', 'loadAssignmentContext', 'equipoOccurrenceKey', 'crewCoveragePresentation', 'renderLubricadorHome', 'handleOutOfPlanEquipoSelected', 'openModal', 'closeModal', ...extras]);
  await page.addScriptTag({ content: `
    let _db = null;
    window.App = { route: 'turno', currentUser: { id: 'U1', name: 'Usuario ficticio', role: 'LUBRICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
    let lastSyncState = { status: 'ok' };
    // This fixture starts with a populated local account; bootstrap itself
    // is exercised by lubricador-fresh-install-bootstrap.spec.js.
    window.Sync = { getAccountSyncState: async () => ({ bootstrapComplete: true }) };
    window.__flows = []; window.__details = [];
    window.startLubricadorGreaseFlow = (id, options) => window.__flows.push({ id, options: options || {} });
    window.openEquipmentDetail = id => window.__details.push(id);
    window.navigate = () => {}; window.openAnomalyForm = () => {}; window.openQrScanner = () => {};
    window.openOutOfPlanEquipmentPicker = () => {}; window.openLubricadorMatrizModal = () => {};
    window.refreshPushTokenCrewScope = async () => {}; window.updateLubricadorWidgetSnapshot = snapshot => window.__widget = snapshot;
    window.openValidationDetailModal = () => {};
    ${db}\n${core}\n${app}
    window.DB = DB;
    // UX CAMPO V2 (2026-10-24): los 3 acordeones de Mi Turno nacen
    // colapsados — este fixture los expande automáticamente después de
    // CADA render (idempotente, nunca cierra lo ya abierto) para no
    // romper la cobertura de clasificación/negocio YA existente de este
    // archivo, que no es sobre la interacción propia del acordeón.
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
    window.__offline = () => { lastSyncState.status = 'offline'; };
  ` });
  await page.evaluate(async ({ crew, locations, coverage, equipos, records, plans, assignments, skips, validations }) => {
    await openDB(); await DB.setConfig({ lastPull: 'fixture' });
    await DB.put('cuadrillas', crew); await DB.putMany('locations', locations);
    for (const [store, rows] of Object.entries({ crew_locations: coverage, equipment: equipos, lubrication_records: records, lubrication_plans: plans, lubrication_assignments: assignments, lubrication_skips: skips, grease_validations: validations })) await DB.putMany(store, rows);
    await renderLubricadorHome();
  }, { crew: followUpCrew, locations: followUpLocations, coverage, equipos, records, plans, assignments, skips, validations });
  return errors;
}
