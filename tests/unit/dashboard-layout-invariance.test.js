import { it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const baseline = execFileSync('git', ['show', '23fef96:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' }).replace(/\r\n/g, '\n');
const current = readSource(APP_JS_PATH).replace(/\r\n/g, '\n');
const normalize = source => source.split('\n').filter(line => !line.trim().startsWith('//')).join('\n').trim();
it('all dashboard calculations and data scopes match the initial release source', () => {
  const calculation = source => {
    const render = extractDeclaration(source, 'renderDashboard');
    return normalize(render.slice(0, render.indexOf('  c.innerHTML = `', render.indexOf('const colaAtencion ='))));
  };
  expect(calculation(current)).toBe(calculation(baseline));
});
it('all dashboard action and filter handlers match the initial release source', () => {
  const handlers = source => {
    const render = extractDeclaration(source, 'renderDashboard');
    return normalize(render.slice(render.indexOf("  $$('.arreglar-plan'")));
  };
  expect(handlers(current)).toBe(handlers(baseline));
});
it.each(['computeAllStatuses', 'getCurrentOperationalScope', 'openValidationConflictModal', 'openValidationDetailModal',
  'stampEquipmentEvidencePhoto', 'wirePhotoField', 'boot', 'MENU'])('%s is unchanged', name => {
  expect(extractDeclaration(current, name)).toBe(extractDeclaration(baseline, name));
});
