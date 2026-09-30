// tests/unit/dashboard-location.test.js
//
// Rediseño estructural del Dashboard (cierre Parte D) — sección F, "Estado
// por ubicación": dinámico (nunca nombres de ubicación hardcodeados),
// reagrupa `statuses` ya calculado (sin recalcular el semáforo), y solo se
// muestra cuando hay más de una ubicación con equipos dentro del filtro
// vigente. Prueba a nivel de FUENTE.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('F — "Estado por ubicación" dinámico, nunca hardcodeado', () => {
  it('estadoPorUbicacion se construye iterando `locations` (datos reales), nunca un arreglo de nombres fijos', () => {
    expect(src).toContain('const estadoPorUbicacion = locations.map(loc => {');
    expect(src).not.toMatch(/estadoPorUbicacion\s*=\s*\[\s*\{\s*location:\s*['"]/); // nunca un literal de ubicación
  });

  it('reagrupa el MISMO `statuses` ya calculado arriba — no vuelve a llamar computeAllStatuses/statusFor', () => {
    const iFn = src.indexOf('const estadoPorUbicacion = locations.map(loc => {');
    const fnSrc = src.slice(iFn, iFn + 500);
    expect(fnSrc).toContain('const deEsaUbic = statuses.filter(x => x.e.locationId === loc.id);');
    expect(fnSrc).not.toContain('computeAllStatuses(');
    expect(fnSrc).not.toContain('statusFor(');
  });

  it('solo incluye ubicaciones con equipos dentro del filtro vigente (total > 0) — no filas vacías', () => {
    expect(src).toContain('.filter(u => u.total > 0);');
  });

  it('la tabla muestra Ubicación/Equipos/Al día/Próximos/Vencidos, coloreados con los semánticos ya definidos (verde/amber/rojo)', () => {
    const iPanel = src.indexOf('dash-ubic-panel');
    const panelSrc = src.slice(iPanel, iPanel + 900);
    expect(panelSrc).toContain('<thead><tr><th>Ubicación</th><th>Equipos</th><th>Al día</th><th>Próximos</th><th>Vencidos</th></tr></thead>');
    expect(panelSrc).toContain('u.location.name');
    expect(panelSrc).toContain("color:var(--green)");
    expect(panelSrc).toContain("color:var(--amber)");
    expect(panelSrc).toContain("color:var(--red)");
  });

  it('el panel completo (incluyendo el <h3>) solo se renderiza si hay más de 1 ubicación con equipos — nunca ocupa espacio con 0 o 1 ubicación', () => {
    const iCond = src.indexOf('${estadoPorUbicacion.length > 1 ?');
    expect(iCond).toBeGreaterThan(-1);
    const bloque = src.slice(iCond, src.indexOf('dash-ubic-panel') + 30);
    expect(bloque).toContain('dash-ubic-panel');
  });
});
