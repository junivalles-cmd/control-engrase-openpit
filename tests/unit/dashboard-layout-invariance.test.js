import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const baseline = execFileSync('git', ['show', '04e7d24:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
const current = readSource(APP_JS_PATH).replace(/\r\n/g, '\n');
const normalize = source => source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n').trim();
it('dashboard data scopes before KPI aggregation match the initial release; dual-shift KPIs use occurrence identities', () => {
  const dataScope = source => {
    const render = extractDeclaration(source, 'renderDashboard');
    return normalize(render.slice(0, render.indexOf('  const nowTs = new Date();')));
  };
  expect(dataScope(current)).toBe(dataScope(baseline));
  const currentRender = extractDeclaration(current, 'renderDashboard');
  expect(currentRender).toContain('occurrencesForDate(e, date, shiftFilter = null)');
  expect(currentRender).toContain("['shift_dia', 'shift_noche']");
  expect(currentRender).toContain('resolveOccurrenceState({ plan, operationalDate: dateISO, shiftId, records');
});
it('all dashboard action and filter handlers match the initial release source', () => {
  const handlers = source => {
    const render = extractDeclaration(source, 'renderDashboard');
    return normalize(render.slice(render.indexOf("  $$('.arreglar-plan'")));
  };
  expect(handlers(current)).toBe(handlers(baseline));
});
// 'boot'/'MENU' se retiraron de esta lista (limpieza técnica 2026-10-19):
// son shell/navegación global, no cálculo de dashboard, y evolucionan por
// diseño con el menú (entrada "Tareas y Mensajes" 2026-10-18, consolidación
// de "Usuarios" dentro de Configuración) — exigirles byte-a-byte contra el
// release inicial ya no tiene sentido; las funciones de ESTE archivo (cálculo/
// render puro del dashboard) sí deben seguir congeladas.
it.each(['computeAllStatuses', 'getCurrentOperationalScope', 'openValidationConflictModal', 'openValidationDetailModal',
  'stampEquipmentEvidencePhoto', 'wirePhotoField', 'wireDashboardEquipmentRows',
  'dashHeroCard', 'dashActivityCard', 'fmtDate'])('%s is unchanged', name => {
  expect(extractDeclaration(current, name)).toBe(extractDeclaration(baseline, name));
});
