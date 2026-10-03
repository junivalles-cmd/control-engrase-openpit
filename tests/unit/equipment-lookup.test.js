// tests/unit/equipment-lookup.test.js
//
// CONSULTAR EQUIPO (lote "consulta universal + formularios") — búsqueda,
// QR y ficha de engrase accesibles a TODOS los roles autenticados. Prueba
// código REAL extraído de app.js (nunca una reimplementación): funciones
// puras ejecutadas donde es posible (qrValueForEquipment/
// parseEquipmentIdFromScan/equipoMatchesQuery/PERMISSIONS), y verificación
// por patrón de fuente para las pantallas DOM+IndexedDB (openEquipmentDetail/
// wireQuickFind/showEquipmentQrInfo/handleScannedQR) que no son extraíbles
// como función pura — mismo criterio que registrar-engrase-inicial.test.js.

import { describe, it, expect, afterEach, vi } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, loadAppLogic, loadOperationalScopeLogic } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const fakeApp = { currentUser: null, generalSettings: {} };
const { qrValueForEquipment, parseEquipmentIdFromScan, equipoMatchesQuery, PERMISSIONS } = loadAppLogic(fakeApp);
const { canRegisterOutOfPlan, canLubricadorExecuteEquipment, resolveOperationalScope } = loadOperationalScopeLogic();

afterEach(() => { vi.unstubAllGlobals(); });

describe('QR — el payload SOLO identifica el equipo (§4: nunca ubicación/estado/horómetro/turno/plan)', () => {
  it('E) qrValueForEquipment(): URL real con #eq=<id>, nada más codificado', () => {
    vi.stubGlobal('location', { origin: 'https://junivalles-cmd.github.io', pathname: '/control-engrase/' });
    const url = qrValueForEquipment({ id: 'eq_123', locationId: 'loc_x', hourmeter: 999, shiftId: 'shift_dia' });
    expect(url).toBe('https://junivalles-cmd.github.io/control-engrase/#eq=eq_123');
    expect(url).not.toContain('loc_x');
    expect(url).not.toContain('999');
    expect(url).not.toContain('shift_dia');
  });

  it('E) parseEquipmentIdFromScan(): URL completa con #eq=... -> el id real', () => {
    expect(parseEquipmentIdFromScan('https://junivalles-cmd.github.io/control-engrase/#eq=eq_123')).toBe('eq_123');
  });

  it('E) parseEquipmentIdFromScan(): compatibilidad con etiquetas viejas "ENGRASE-EQ:<id>"', () => {
    expect(parseEquipmentIdFromScan('ENGRASE-EQ:eq_viejo')).toBe('eq_viejo');
  });

  it('G) parseEquipmentIdFromScan(): texto que no es URL ni formato conocido -> se devuelve tal cual (nunca lanza), el llamador decide que no existe', () => {
    expect(parseEquipmentIdFromScan('esto no es un QR de equipo')).toBe('esto no es un QR de equipo');
  });

  it('G) parseEquipmentIdFromScan(): cadena vacía -> cadena vacía, nunca lanza', () => {
    expect(() => parseEquipmentIdFromScan('   ')).not.toThrow();
  });
});

describe('BÚSQUEDA — wireQuickFind() reutiliza equipoMatchesQuery() real, nunca un filtro propio más angosto (§3/§9)', () => {
  const src = extractDeclaration(appSource, 'wireQuickFind');

  it('usa equipoMatchesQuery() (misma función ya probada en historial-equipo-search.test.js: código/marca/modelo/descripción/serie/categoría/ubicación)', () => {
    expect(src).toContain('equipoMatchesQuery(');
  });

  it('D/I) nunca llama fetch() — la búsqueda es 100% IndexedDB local, funciona offline tras la sincronización inicial', () => {
    expect(src).not.toMatch(/\bfetch\(/);
  });

  it('A) equipoMatchesQuery(): código exacto coincide (reconfirma el contrato que ahora también usa quick-find)', () => {
    const eq = { code: '45-69', brand: 'Komatsu', model: 'PC200' };
    expect(equipoMatchesQuery(eq, null, null, '45-69')).toBe(true);
  });

  it('B) equipoMatchesQuery(): por modelo (ej. "D8T")', () => {
    const eq = { code: 'T-06', brand: 'Caterpillar', model: 'D8T' };
    expect(equipoMatchesQuery(eq, null, null, 'd8t')).toBe(true);
  });

  it('C) equipoMatchesQuery(): sin coincidencia -> false (resultado vacío, no un falso positivo)', () => {
    const eq = { code: 'T-06', brand: 'Caterpillar', model: 'D8T' };
    expect(equipoMatchesQuery(eq, null, null, 'excavadora-inexistente')).toBe(false);
  });
});

describe('QR — H) escanear NUNCA cambia permisos/scope/cuadrilla/rol/ubicación (§18)', () => {
  const handleScannedQRSrc = extractDeclaration(appSource, 'handleScannedQR');
  const showEquipmentQrInfoSrc = extractDeclaration(appSource, 'showEquipmentQrInfo');

  it('handleScannedQR() solo resuelve el equipo y muestra su info — nunca escribe cuadrilla/ubicación/rol', () => {
    expect(handleScannedQRSrc).not.toMatch(/setSelectedCrewId|\.role\s*=(?!=)|\.locationId\s*=(?!=)|\.cuadrillaId\s*=(?!=)/);
  });

  it('showEquipmentQrInfo() decide ACCIONES según permisos ya existentes (canRegisterOutOfPlan/canLubricadorExecuteEquipment) — nunca otorga uno nuevo', () => {
    expect(showEquipmentQrInfoSrc).toContain('canLubricadorExecuteEquipment(');
    expect(showEquipmentQrInfoSrc).not.toMatch(/setSelectedCrewId|\.role\s*=(?!=)/);
  });

  it('D/I) ninguna de las dos llama fetch() — resuelve todo desde DB (IndexedDB) local', () => {
    expect(handleScannedQRSrc).not.toMatch(/\bfetch\(/);
    expect(showEquipmentQrInfoSrc).not.toMatch(/\bfetch\(/);
  });

  it('F) equipo inexistente o inactivo: el código real comprueba "!equipment || equipment.active === false" antes de mostrar nada', () => {
    expect(showEquipmentQrInfoSrc).toContain('!equipment || equipment.active === false');
  });
});

describe('FICHA DE ENGRASE — openEquipmentDetail() reutiliza funciones YA existentes, nunca una segunda lógica (§6/§7/§9/§20)', () => {
  const src = extractDeclaration(appSource, 'openEquipmentDetail');

  it('J) estado: usa statusFor() real (misma fuente que Dashboard/Mi Turno/Plan), nunca recalculado aquí', () => {
    expect(src).toContain('await statusFor(e)');
  });

  it('K) último engrase: viene de lubrication_records real, ordenado por fecha, nunca inventado', () => {
    expect(src).toContain("DB.allActive('lubrication_records')");
  });

  it('L) plan: usa s.plan (statusFor ya lo resuelve) y GREASE_UNIT para consumo — nunca un segundo query de planes duplicando lógica', () => {
    expect(src).toContain('s.plan');
  });

  it('M) último consumo en la unidad real (lb), misma constante GREASE_UNIT que el resto de la app', () => {
    expect(src).toContain('GREASE_UNIT');
  });

  it('N) carryover: reutiliza findCarriedOverSkipForToday() (operational-scope.js), nunca un cálculo propio', () => {
    expect(src).toContain('findCarriedOverSkipForToday(');
  });

  it('O) assignment activo: reutiliza findActivePendingAssignment() + computeOccurrenceKey() (operational-scope.js)', () => {
    expect(src).toContain('findActivePendingAssignment(');
    expect(src).toContain('computeOccurrenceKey(');
  });

  it('P) historial/cuadrilla de última ejecución: usa resolveRecordCrewId() (snapshot), nunca la ubicación/cuadrilla ACTUAL del equipo para reescribir ese dato histórico', () => {
    expect(src).toContain('resolveRecordCrewId(');
  });

  it('validación del último engrase: reutiliza validationStatusForRecord()/validationBadgeHTML() (grease-validation.js), mismo componente que Historial', () => {
    expect(src).toContain('validationStatusForRecord(');
    expect(src).toContain('validationBadgeHTML(');
  });

  it('accesible a TODOS los roles: la función no filtra por rol antes de mostrar los datos de consulta (solo los BOTONES de acción están gateados, cada uno por su propia función de permiso ya existente)', () => {
    expect(src).not.toMatch(/^\s*if \(App\.currentUser\.role !== /m);
  });
});

describe('PERMISOS — consultar ≠ modificar (§1/§8), RBAC reutilizado sin cambios', () => {
  it('Q) VISOR (VIEWER) nunca tiene "registrar" en su PERMISSIONS ni puede registrar fuera de plan', () => {
    expect(PERMISSIONS.VISOR).not.toContain('registrar');
    expect(canRegisterOutOfPlan('VISOR')).toBe(false);
  });

  it('R) LUBRICADOR puede registrar fuera de plan en general, pero canLubricadorExecuteEquipment() sigue exigiendo que el equipo esté en su scope/assignment (sin cambios)', () => {
    expect(canRegisterOutOfPlan('LUBRICADOR')).toBe(true);
    const cuadrillas = [{ id: 'crew_a', locationId: 'loc_a', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['u1'] }];
    const scope = resolveOperationalScope({ currentUser: { id: 'u1', role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const equipoFuera = { id: 'e_fuera', locationId: 'loc_b' };
    expect(canLubricadorExecuteEquipment({ scope, equipo: equipoFuera, assignments: [] })).toBe(false);
  });

  it('S) ADMINISTRADOR/PLANIFICADOR conservan su PERMISSIONS actual (sin tocar RBAC para la consulta universal)', () => {
    expect(PERMISSIONS.ADMINISTRADOR).toContain('equipos');
    expect(PERMISSIONS.PLANIFICADOR).toContain('equipos');
    expect(canRegisterOutOfPlan('ADMINISTRADOR')).toBe(true);
    expect(canRegisterOutOfPlan('PLANIFICADOR')).toBe(true);
  });
});

describe('Consulta universal — entrada desde topbar (desktop) y shell del Lubricador, sin duplicar navegación (§2)', () => {
  const bootSrc = extractDeclaration(appSource, 'boot');
  const bootLubricadorSrc = extractDeclaration(appSource, 'bootLubricador');

  it('topbar desktop: botón de escanear QR junto al buscador ya existente, reutiliza openQrScanner()', () => {
    expect(bootSrc).toContain('btn-scan-qr-topbar');
    expect(bootSrc).toContain('openQrScanner()');
  });

  it('shell del Lubricador: mismo buscador (wireQuickFind) + mismo botón de QR en su topbar persistente, visible en las 4 pestañas', () => {
    expect(bootLubricadorSrc).toContain('wireQuickFind()');
    expect(bootLubricadorSrc).toContain('btn-scan-qr-topbar');
    expect(bootLubricadorSrc).toContain('openQrScanner()');
  });

  it('"Ver ficha completa" ya no excluye a LUBRICADOR (antes del lote, estaba oculto para ese rol)', () => {
    const src = extractDeclaration(appSource, 'showEquipmentQrInfo');
    expect(src).not.toContain("role !== 'LUBRICADOR'");
    expect(src).toContain('qr-info-detail');
  });
});
