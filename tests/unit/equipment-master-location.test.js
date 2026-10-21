import { describe, expect, it } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

// Extract the actual presentation resolver scoped inside Mi Turno.
const render = extractDeclaration(readSource(APP_JS_PATH), 'renderLubricadorHome');
const resolver = extractDeclaration(render.replace(/^  /gm, ''), 'resolveEquipmentMasterLocation');
const resolve = new Function(`${resolver}; return resolveEquipmentMasterLocation;`)();
const locations = [{ id: 'volcan', name: 'Volcán', active: true }, { id: 'mojon', name: 'Mojón' },
  { id: 'taller', name: 'Taller', active: false }];

describe('Ubicación maestra: presentación sin inferencias desde cuadrilla/asignación', () => {
  it('resuelve exactamente el locationId del equipo', () => {
    expect(resolve({ locationId: 'mojon', crewLocationId: 'volcan' }, locations)).toMatchObject({ state: 'VALID', label: 'Mojón' });
  });
  it.each([undefined, null, '', '   '])('locationId vacío (%s) nunca se sustituye por la cuadrilla', locationId => {
    expect(resolve({ locationId, crewLocationId: 'volcan', assignedCrewId: 'cuad_a' }, locations))
      .toMatchObject({ state: 'MISSING', label: 'Ubicación maestra sin definir', name: null });
  });
  it('referencia no encontrada es inconsistencia local, no prueba de inexistencia en servidor', () => {
    const result = resolve({ locationId: 'missing' }, locations);
    expect(result.state).toBe('UNRESOLVED');
    expect(result.label).toBe('Ubicación maestra no disponible');
    expect(result.detail).toContain('no confirma que falte en el servidor');
  });
  it('ubicación inactiva no se presenta como operativa válida', () => {
    expect(resolve({ locationId: 'taller' }, locations)).toMatchObject({ state: 'INACTIVE', label: 'Ubicación maestra inactiva · Taller' });
  });
  it('ubicación eliminada también se señala', () => {
    expect(resolve({ locationId: 'volcan' }, [{ ...locations[0], deleted: true }]).state).toBe('INACTIVE');
  });
  it('nombre vacío y referencia de tipo inválido se distinguen', () => {
    expect(resolve({ locationId: 'blank' }, [{ id: 'blank', name: '  ' }]).state).toBe('MISSING_NAME');
    expect(resolve({ locationId: 123 }, locations).state).toBe('INVALID_REFERENCE');
  });
  it('no normaliza IDs silenciosamente ni muta el dato maestro', () => {
    const e = Object.freeze({ id: 'e', locationId: ' mojon ' });
    expect(resolve(e, locations).state).toBe('UNRESOLVED');
    expect(e.locationId).toBe(' mojon ');
  });
});
