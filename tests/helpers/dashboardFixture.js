// Real dashboard fixture shared by compact layout regression tests.

import path from 'node:path';
import { readSource, extractDeclaration } from './extractFromSource.js';
import {
  APP_JS_PATH, SHIFTS_JS_PATH, LUBRICATION_STATUS_JS_PATH,
  OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH,
} from './loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const appSource = readSource(APP_JS_PATH);
const shiftsSource = readSource(SHIFTS_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const scopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const shiftsSrc = extractDeclaration(shiftsSource, 'currentShiftId');
const statusNames = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const statusSrc = statusNames.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const scopeNames = [
  'EXECUTION_TYPE', 'ASSIGNMENT_STATUS', 'resolveRecordExecutionType', 'findCarriedOverSkipForToday',
  // Scope por cuadrilla del SUPERVISOR en Dashboard (hardening pre-release
  // 2026-10-08) — MISMAS funciones reales ya usadas por renderLubricadorHome().
  'ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveDefaultCrewForLocation',
  'resolveCrewLocationCoverage', 'resolveOperationalScope', 'classifyEquipmentWork', 'computeOccurrenceKey', 'toISODateUTCLocal',
];
const scopeSrc = scopeNames.map(n => extractDeclaration(scopeSource, n)).join('\n\n');
const validationNames = [
  'VALIDATION_STATUS', 'VALIDATION_BADGE', 'GREASE_VALIDATION_ENABLED_FROM', 'MAX_VALIDATION_SHIFTS',
  'isRecordSubjectToValidation', 'statusForSignerRole', 'findActiveValidations', 'hasValidationConflict',
  'findActiveValidation', 'shiftKindAt', 'shiftDurationHours', 'shiftWindowStart', 'validationDeadline',
  'isValidationExpired', 'validationStatusFor', 'validationStatusForRecord', 'isRecordPendingValidation',
  'isRecordValidationExpired', 'isRecordInConflict',
];
const validationSrc = validationNames.map(n => extractDeclaration(validationSource, n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'fmtDate', 'todayDateISO', 'SCHEDULE_WEEKDAYS', 'STATUS_COLOR', 'WEEKDAY_ABBR_DASH',
  'NO_EXECUTION_REASON_LABELS', 'PERMISSIONS', 'computeAllStatuses', 'colorPorCumplimiento',
  'dashHeroCard', 'dashActivityCard', 'dashComplianceCard', 'tiempoExcepcionRowHTML', 'renderDashboard',
  'wireDashboardEquipmentRows',
  'openModal', 'closeModal', 'dashListRowActionsHTML', 'wireDashListActions',
  'tiempoPendienteDesde', 'pendienteValidacionRowHTML',
  // Scope por cuadrilla del SUPERVISOR en Dashboard (hardening pre-release 2026-10-08).
  'getSelectedCrewId', 'getCurrentOperationalScope', 'equipoOccurrenceKey',
];

const TYPES = [{ id: 't1', name: 'Excavadora' }];
const LOCATIONS = [{ id: 'l1', name: 'Botadero Norte' }];
const EQUIPOS = [
  { id: 'e1', code: '45-77', brand: 'Caterpillar', model: '740B', status: 'Operativo', typeId: 't1', locationId: 'l1' },
  { id: 'e2', code: 'EXC-02', brand: 'Komatsu', model: 'PC200', status: 'Operativo', typeId: 't1', locationId: 'l1' },
];

export async function bootDashboard(page, {
  source = appSource, css = null,
  skips = [], records = [], assignments = [], plans = [], anomalies = [], validations = [], cuadrillas = [],
  types = TYPES, locations = LOCATIONS, typesAll = types, locationsAll = locations, equipos = EQUIPOS,
  currentUser = { id: 'admin1', name: 'Junior', role: 'ADMINISTRADOR' },
} = {}) {
  await page.setContent('<main class="app-content" id="app-content"></main>');
  await page.addStyleTag(css ? { content: css } : { path: STYLES_PATH });
  const dateHelpers = ['fmtDateOnly', 'fmtTime'].filter(n => source.includes(`const ${n} =`));
  if (source.includes('function getLubricationAgeSeverity(')) dateHelpers.push('getLubricationAgeSeverity');
  const injectedAppSrc = [...appNames, ...dateHelpers].filter(n => n !== 'wireDashboardEquipmentRows' || source.includes('function wireDashboardEquipmentRows(')).map(n => extractDeclaration(source, n)).join("\n\n");
  await page.addScriptTag({
    content: `
      window.App = {
        route: 'dashboard', currentUser: ${JSON.stringify(currentUser)},
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, complianceTarget: 85 },
      };
      window.navigate = () => {};
      window.__startGreaseFlowCalls = [];
      window.startGreaseFlow = (id) => window.__startGreaseFlowCalls.push(id);
      window.makeTablesResponsive = () => {};
      window.showInAppToast = () => {};
      window.DB = {
        // DB.allActive filtra a solo activas (lo que ya pasaba antes del fix
        // de DATA-PENDING-A02); DB.all() devuelve TODAS — distinción real
        // que renderDashboard ahora explota a propósito para equipment_types/
        // locations (ver docs/BUG_REGISTER.md).
        allActive: async (store) => ({
          equipment: ${JSON.stringify(equipos)},
          equipment_types: ${JSON.stringify(types)},
          locations: ${JSON.stringify(locations)},
          lubrication_plans: ${JSON.stringify(plans)},
          lubrication_records: ${JSON.stringify(records)},
          anomalies: ${JSON.stringify(anomalies)},
          grease_validations: ${JSON.stringify(validations)},
          lubrication_assignments: ${JSON.stringify(assignments)},
          lubrication_skips: ${JSON.stringify(skips)},
          cuadrillas: ${JSON.stringify(cuadrillas)},
        }[store] || []),
        all: async (store) => ({
          equipment_types: ${JSON.stringify(typesAll)},
          locations: ${JSON.stringify(locationsAll)},
        }[store] || []),
      };
      ${shiftsSrc}
      ${statusSrc}
      ${scopeSrc}
      ${validationSrc}
      ${injectedAppSrc}
      window.currentShiftId = currentShiftId;
      window.renderDashboard = renderDashboard;
      window.openModal = openModal; window.closeModal = closeModal;
      window.dashListRowActionsHTML = dashListRowActionsHTML;
      window.wireDashListActions = wireDashListActions;
    `,
  });
}
