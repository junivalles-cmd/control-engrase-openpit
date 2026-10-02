// tests/unit/data-pending-a02-fix.test.js
//
// Cierre de DATA-PENDING-A02 (docs/BUG_REGISTER.md) — la auditoría previa
// (2026-09-25) había confirmado que el CÓDIGO de lookup era correcto, pero
// no se investigó más allá por no tener acceso autorizado a producción.
// Reinvestigado sin tocar ningún dato real: el bug real es que los
// lookups typePorId/locPorId para MOSTRAR el nombre de ubicación/familia
// de un equipo se construían desde DB.allActive('locations'/'equipment_types')
// — si esa ubicación/familia se desactiva DESPUÉS (soft-delete, confirmado
// en wireSimpleListPanel/.sl-remove: el equipo NUNCA pierde su propio
// locationId/typeId), el equipo sigue con un id válido pero el lookup ya
// no lo contiene → "—" para siempre, aunque el dato real nunca cambió.
//
// Fix: separar "lista para el <select> de filtro" (sigue activas-solo,
// nunca debe poder elegirse algo desactivado) de "lookup para el NOMBRE en
// pantalla" (debe incluir TODAS, activas e inactivas). Playwright
// (tests/ui/dashboard-real-execution.spec.js) ya prueba esto EJECUTANDO
// renderDashboard() de verdad — aquí se verifica por fuente que el mismo
// criterio se aplicó en los otros 3 sitios con el patrón idéntico
// (renderHistorial/renderReportes/renderMatrizSemanal), sin duplicar esa
// prueba de ejecución real en cada uno.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);

describe('renderDashboard() — typePorId/locPorId (para mostrar nombre) usan DB.all(), nunca allActive()', () => {
  const src = extractDeclaration(appSource, 'renderDashboard');

  it('fetch de TODAS (typesAll/locationsAll), separado del fetch activas-solo que alimenta el <select> de filtro', () => {
    expect(src).toContain("const typesAll = await DB.all('equipment_types');");
    expect(src).toContain("const locationsAll = await DB.all('locations');");
  });

  it('el <select> de filtro Ubicación/Familia sigue usando solo activas (nunca debe poder elegirse algo desactivado)', () => {
    expect(src).toContain("const types = await DB.allActive('equipment_types');");
    expect(src).toContain("const locations = await DB.allActive('locations');");
    expect(src).toContain('${types.map(t => `<option value="${t.id}"');
    expect(src).toContain('${locations.map(l => `<option value="${l.id}"');
  });

  it('typePorId/locPorId (el lookup real para el nombre en pantalla) se construyen de las TODAS, no de las activas-solo', () => {
    expect(src).toContain('const typePorId = {}; typesAll.forEach(t => typePorId[t.id] = t);');
    expect(src).toContain('const locPorId = {}; locationsAll.forEach(l => locPorId[l.id] = l);');
  });

  it('los modales "Sin plan"/"Pausados" (mismo bug, mismos equipos) reciben las TODAS, no las activas-solo', () => {
    expect(src).toContain('openSinPlanModal(sinPlan, typesAll, locationsAll)');
    expect(src).toContain('openPausadosModal(pausados, typesAll, locationsAll)');
  });
});

describe('renderMatrizSemanal() — mismo fix para su propio modal "Equipos sin plan"', () => {
  const src = extractDeclaration(appSource, 'renderMatrizSemanal');

  it('fetch de TODAS, separado del fetch activas-solo que alimenta sus <select> de filtro', () => {
    expect(src).toContain("const types = await DB.allActive('equipment_types');");
    expect(src).toContain("const locations = await DB.allActive('locations');");
    expect(src).toContain("const typesAll = await DB.all('equipment_types');");
    expect(src).toContain("const locationsAll = await DB.all('locations');");
  });

  it('openSinPlanModal() recibe las TODAS', () => {
    expect(src).toContain('openSinPlanModal(sinPlan, typesAll, locationsAll)');
  });
});

describe('renderHistorial() — sin <select> de Ubicación/Familia en esta pantalla, el fetch completo se cambió directo a DB.all()', () => {
  const src = extractDeclaration(appSource, 'renderHistorial');

  it('types/locations ahora vienen de DB.all() (nunca allActive) — alimentan solo nombres, nunca un picker', () => {
    expect(src).toContain("const types = await DB.all('equipment_types');");
    expect(src).toContain("const locations = await DB.all('locations');");
    expect(src).not.toContain("DB.allActive('equipment_types')");
    expect(src).not.toContain("DB.allActive('locations')");
  });
});

describe('renderReportes() — mismo fix que Dashboard (también tiene <select> de filtro reutilizando el mismo array)', () => {
  const src = extractDeclaration(appSource, 'renderReportes');

  it('fetch de TODAS, separado del fetch activas-solo que alimenta sus <select> de filtro', () => {
    expect(src).toContain("const types = await DB.allActive('equipment_types');");
    expect(src).toContain("const locations = await DB.allActive('locations');");
    expect(src).toContain("const typesAll = await DB.all('equipment_types');");
    expect(src).toContain("const locationsAll = await DB.all('locations');");
  });

  it('typePorId/locPorId (lookup de nombre, usado en la tabla Y en los exports CSV/Excel/PDF) vienen de las TODAS', () => {
    expect(src).toContain('const typePorId = {}; typesAll.forEach(t => typePorId[t.id] = t);');
    expect(src).toContain('const locPorId = {}; locationsAll.forEach(l => locPorId[l.id] = l);');
  });
});
