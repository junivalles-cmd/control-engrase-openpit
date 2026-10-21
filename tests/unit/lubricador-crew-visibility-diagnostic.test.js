// tests/unit/lubricador-crew-visibility-diagnostic.test.js
//
// Diagnóstico real: "cuadrilla 76-08 Camion Lubrico (Volcán), miembro
// autorizado Jose Guerrero · LUBRICADOR, pero 'Mi Turno' no muestra los
// equipos de Volcán". Traza el ejemplo EXACTO reportado a través de las
// funciones puras REALES (resolveOperationalScope/classifyEquipmentWork,
// src/core/operational-scope.js) — nunca datos de producción (no hay acceso
// a Supabase desde este entorno), nunca una reimplementación del scope.
//
// CAUSA RAÍZ ENCONTRADA (ver reporte final): NO es un bug de lógica —
// resolveOperationalScope()/classifyEquipmentWork() ya están correctamente
// implementados y ya tenían cobertura equivalente (CASO 1/3/7/C en
// operational-scope.test.js, usando "Volcán" como ejemplo). El bug real
// encontrado en su momento era VISUAL: el checkbox "Cuadrilla principal de
// esta ubicación" en el formulario "Editar cuadrilla" no renderizaba ningún
// indicador visible. Corregido entonces en app.js.
//
// SUPERSEDIDO (corrección arquitectónica 2026-10-02, commit f467782 — ver
// docs/OPERATIONAL_SCOPE.md): ese mismo checkbox/campo isDefault del
// formulario "Editar cuadrilla" fue retirado por diseño — PRINCIPAL/APOYO
// ahora se administra solo desde el botón "Cobertura" (crew_locations, un
// <select> por ubicación, nunca un checkbox), documentado en el propio
// app.js ("Ubicación/rol (locationId/isDefault legacy) ya NO se editan
// aquí"). Las 2 pruebas HALLAZGO 1 que describían el checkbox/FormData viejo
// se retiraron (limpieza técnica 2026-10-19) — el campo isDefault SIGUE
// existiendo como fallback legacy real (ver pruebas de arriba), solo cambió
// DÓNDE se edita. "Miembros autorizados" y la tabla PRINCIPAL/APOYO siguen
// vigentes y se prueban abajo sin cambios.

import { describe, it, expect } from 'vitest';
import { loadOperationalScopeLogic } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const { getAuthorizedCrews, resolveOperationalScope, classifyEquipmentWork, resolveDefaultCrewForLocation } = loadOperationalScopeLogic();

const appSource = readSource(APP_JS_PATH);

// ============================================================
// Datos del caso real reportado (nombres tal como aparecen en el reporte,
// ids ficticios — nunca ids/valores reales de producción).
// ============================================================
const JOSE_USER_ID = 'app_user_jose_guerrero'; // equivalente a profile.appUserId / app_profiles.app_user_id
const VOLCAN_LOCATION_ID = 'loc_volcan';
const CREW_76_08_ID = 'crew_76_08';

function cuadrillas76_08({ isDefault }) {
  return [
    { id: CREW_76_08_ID, name: '76-08 Camion Lubrico', locationId: VOLCAN_LOCATION_ID, active: true, isDefault, createdAt: '2026-01-01', memberUserIds: [JOSE_USER_ID] },
  ];
}

const equiposVolcan = [
  { id: 'eq_volcan_1', code: 'V-01', locationId: VOLCAN_LOCATION_ID },
  { id: 'eq_volcan_2', code: 'V-02', locationId: VOLCAN_LOCATION_ID },
];

const planesVolcan = {
  eq_volcan_1: { id: 'plan_eq_volcan_1', equipmentId: 'eq_volcan_1', controlType: 'Día y turno de la semana', assignedDays: ['Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes'] },
};
const occFn = (e) => {
  const plan = planesVolcan[e.id];
  return plan ? `${plan.id}:2026-09-28` : null;
};

describe('EJEMPLO TRAZADO — Jose Guerrero → crew 76-08 → Volcán → equipo X → plan X → turno X', () => {
  it('PASO 1-2: Jose SÍ es miembro autorizado real de 76-08 (getAuthorizedCrews, única fuente de autorización)', () => {
    const cuadrillas = cuadrillas76_08({ isDefault: true });
    const autorizadas = getAuthorizedCrews(cuadrillas, JOSE_USER_ID);
    expect(autorizadas).toHaveLength(1);
    expect(autorizadas[0].id).toBe(CREW_76_08_ID);
  });

  it('PASO 3: con 1 sola cuadrilla autorizada, activeCrewId se autoselecciona SOLO (CREW_SCOPED) — nunca necesita selectedCrewId ni re-login', () => {
    const cuadrillas = cuadrillas76_08({ isDefault: true });
    const scope = resolveOperationalScope({ currentUser: { id: JOSE_USER_ID, role: 'LUBRICADOR' }, cuadrillas, selectedCrewId: '', shiftId: 'shift_dia' });
    expect(scope.kind).toBe('CREW_SCOPED');
    expect(scope.crewId).toBe(CREW_76_08_ID);
    expect(scope.crewLocationId).toBe(VOLCAN_LOCATION_ID);
  });

  it('CASO REAL (76-08 SÍ marcada "principal"/isDefault:true): los equipos de Volcán SÍ aparecen en "normal" — Mi Turno los muestra', () => {
    const cuadrillas = cuadrillas76_08({ isDefault: true });
    const scope = resolveOperationalScope({ currentUser: { id: JOSE_USER_ID, role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const { normal } = classifyEquipmentWork({ scope, equipos: equiposVolcan, cuadrillas, assignments: [], equipoOccurrenceKeyFn: occFn });
    expect(normal.map(e => e.id).sort()).toEqual(['eq_volcan_1', 'eq_volcan_2']);
  });

  it('CAUSA RAÍZ REPRODUCIDA — 76-08 NO marcada como principal (isDefault:false): classifyEquipmentWork() devuelve "normal" VACÍO, aunque Jose SÍ sea miembro y SÍ esté en la ubicación correcta — esto es EXACTAMENTE el síntoma reportado', () => {
    const cuadrillas = cuadrillas76_08({ isDefault: false });
    const scope = resolveOperationalScope({ currentUser: { id: JOSE_USER_ID, role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    // El scope SÍ se resuelve correctamente (Jose está autorizado, la
    // ubicación es la correcta) — el "paso" donde desaparecen los equipos
    // es classifyEquipmentWork(), no resolveOperationalScope().
    expect(scope.kind).toBe('CREW_SCOPED');
    expect(scope.crewLocationId).toBe(VOLCAN_LOCATION_ID);

    const { normal, assigned } = classifyEquipmentWork({ scope, equipos: equiposVolcan, cuadrillas, assignments: [], equipoOccurrenceKeyFn: occFn });
    expect(normal).toHaveLength(0); // CASO A: ni siquiera entra por scope/cuadrilla (ver §7 del pedido)
    expect(assigned).toHaveLength(0);

    // Confirmación directa de la causa: resolveDefaultCrewForLocation()
    // para Volcán no devuelve 76-08 en este escenario.
    const defaultCrew = resolveDefaultCrewForLocation(cuadrillas, VOLCAN_LOCATION_ID);
    expect(defaultCrew).toBeNull();
  });

  it('CASO A vs CASO B (§7 del pedido) — con isDefault:true, el equipo SIN plan configurado entra al scope (CASO A resuelto) pero no genera trabajo visible en Mi Turno (CASO B: entra al scope, sin trabajo de HOY)', () => {
    const cuadrillas = cuadrillas76_08({ isDefault: true });
    const scope = resolveOperationalScope({ currentUser: { id: JOSE_USER_ID, role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const { normal } = classifyEquipmentWork({ scope, equipos: equiposVolcan, cuadrillas, assignments: [], equipoOccurrenceKeyFn: occFn });
    // eq_volcan_2 NO tiene plan (occFn devuelve null) — igual entra en
    // "normal" (CASO A: sí está en scope), classifyEquipmentWork() no
    // decide "¿tiene trabajo hoy?", eso lo decide statusFor()/weekdayStatusFor()
    // (lubrication-status.js) más arriba en renderLubricadorHome() — nunca
    // se mezclan los dos problemas.
    expect(normal.find(e => e.id === 'eq_volcan_2')).toBeDefined();
  });
});

describe('§8 del pedido — DEFAULT CREW vs ASSIGNMENT (no requiere assignment manual por equipo)', () => {
  it('con 76-08 principal, los 2 equipos de Volcán reciben trabajo normal SIN que un Planificador tenga que crear una lubrication_assignment para cada uno', () => {
    const cuadrillas = cuadrillas76_08({ isDefault: true });
    const scope = resolveOperationalScope({ currentUser: { id: JOSE_USER_ID, role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const { normal } = classifyEquipmentWork({ scope, equipos: equiposVolcan, cuadrillas, assignments: [], equipoOccurrenceKeyFn: occFn });
    expect(normal).toHaveLength(2);
  });

  it('una asignación especial a OTRA cuadrilla sigue teniendo prioridad sobre el trabajo normal de 76-08 (ASSIGNED > PLANNED, lógica existente intacta)', () => {
    const cuadrillas = [...cuadrillas76_08({ isDefault: true }), { id: 'crew_otra', name: 'Otra cuadrilla', locationId: 'loc_taller', active: true, isDefault: true, createdAt: '2026-01-01', memberUserIds: ['otro_user'] }];
    const assignments = [{ id: 'a1', occurrenceKey: occFn(equiposVolcan[0]), equipmentId: 'eq_volcan_1', assignedCrewId: 'crew_otra', status: 'PENDING', active: true }];
    const scope = resolveOperationalScope({ currentUser: { id: JOSE_USER_ID, role: 'LUBRICADOR' }, cuadrillas, shiftId: 'shift_dia' });
    const { normal } = classifyEquipmentWork({ scope, equipos: equiposVolcan, cuadrillas, assignments, equipoOccurrenceKeyFn: occFn });
    expect(normal.find(e => e.id === 'eq_volcan_1')).toBeUndefined(); // ya no es normal-ejecutable para 76-08
    expect(normal.find(e => e.id === 'eq_volcan_2')).toBeDefined(); // el resto sigue normal
  });
});

describe('§9 del pedido — refresco tras cambios de ADMIN, nunca depende de dispositivo', () => {
  it('cambiar memberUserIds (quitar/agregar a Jose) se refleja de inmediato en getAuthorizedCrews() — no hay caché ni estado "pegado" a una sesión anterior', () => {
    const antes = cuadrillas76_08({ isDefault: true });
    expect(getAuthorizedCrews(antes, JOSE_USER_ID)).toHaveLength(1);

    // Admin quita a Jose de 76-08 (simula el cambio ya sincronizado/pulled).
    const despues = [{ ...antes[0], memberUserIds: [] }];
    expect(getAuthorizedCrews(despues, JOSE_USER_ID)).toHaveLength(0);
  });

  it('getCurrentOperationalScope() (app.js) siempre lee cuadrillas con DB.allActive() fresco — nunca cachea un snapshot viejo entre renders', () => {
    const src = extractDeclaration(appSource, 'getCurrentOperationalScope');
    expect(src).toContain("const cuadrillas = await DB.allActive('cuadrillas');");
  });

  it('la autorización NUNCA depende de un identificador de dispositivo (IMEI/serial/deviceId) — getAuthorizedCrews() y resolveOperationalScope() no reciben ni leen ninguno', () => {
    // El archivo SÍ menciona "IMEI" dentro de bloques /* ... */, pero solo
    // como ejemplo negativo explícito ("ya NO depende de..."); se quitan
    // esos bloques antes de revisar que el CÓDIGO real no lo use.
    const scopeSrc = readSource('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/src/core/operational-scope.js');
    const codeOnly = scopeSrc.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(line => !line.trim().startsWith('//')).join('\n');
    expect(codeOnly).not.toMatch(/deviceId|imei|androidId/i);
  });
});

describe('HALLAZGO 1 — fix visual: "Miembros autorizados" y la tabla PRINCIPAL/APOYO siguen vigentes', () => {
  // Las 2 pruebas que describían el checkbox "Cuadrilla principal"/FormData
  // isDefault del formulario "Editar cuadrilla" se retiraron aquí (limpieza
  // técnica 2026-10-19): ese checkbox fue retirado por diseño en la
  // corrección arquitectónica 2026-10-02 (commit f467782) — PRINCIPAL/APOYO
  // se administra desde "Cobertura" (crew_locations) desde entonces, nunca
  // una regresión. Ver comentario del archivo.
  it('los checkboxes de "Miembros autorizados" (member-check) ahora incluyen el indicador visual .check-row-mark', () => {
    const idx = appSource.indexOf('member-check');
    const block = appSource.slice(idx, idx + 300);
    expect(block).toContain('<span class="check-row-mark">✓</span>');
  });

  it('la tabla de Cuadrillas ahora muestra "PRINCIPAL"/"APOYO" en vez de "✓"/"—" (más claro, pedido §10)', () => {
    const src = extractDeclaration(appSource, 'cuadrillasPanelHTML');
    expect(src).toContain('PRINCIPAL');
    expect(src).toContain('APOYO');
    expect(src).not.toContain("cq.isDefault ? '✓' : '—'");
  });
});
