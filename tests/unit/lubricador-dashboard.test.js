// tests/unit/lubricador-dashboard.test.js
//
// "Dashboard del Lubricador" (lote "Ajuste importante al Dashboard del
// Lubricador"): reestructura renderLubricadorHome() (ruta 'turno', tab "Mi
// Turno" de la barra inferior del Lubricador — se confirmó con el usuario
// que esta es la pantalla a reestructurar, no una pestaña nueva). Prueba
// por patrón de fuente (mismo método que dashboard-hierarchy.test.js/
// dashboard-priority-tiers.test.js): confirma que la función REAL reusa las
// piezas ya probadas (estadoCelda/findCarriedOverSkipForToday/statusFor/
// classifyEquipmentWork) en vez de reinventar lógica de negocio, y que el
// scope nunca se calcula "global para luego ocultar" (§9 del pedido).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderLubricadorHome');

describe('§9 — TODO el cálculo sale del scope ya resuelto (usuario→cuadrilla→ubicación→turno), nunca datos globales ocultados después', () => {
  it('classifyEquipmentWork() sigue siendo la única fuente de equipos ("normal"/"assigned") — nunca DB.allActive("equipment") sin pasar por el scope para los KPIs', () => {
    expect(src).toContain('const { normal, assigned } = classifyEquipmentWork({');
    // Los KPIs/arrastrados se derivan de `normal` (y de `statusesNormal`,
    // calculado sobre `normal`) — nunca de `equipos` (la lista sin filtrar
    // por cuadrilla) directamente.
    expect(src).toContain('const pendientesTurnoAnterior = normal.filter(e => {');
    expect(src).toContain('const normalIds = new Set(normal.map(e => e.id));');
  });

  it('el "Turno anterior" reusa EXACTAMENTE findCarriedOverSkipForToday() — mismo mecanismo que pendientesTurnoAnterior del Dashboard admin, nunca una segunda implementación', () => {
    expect(src).toContain("findCarriedOverSkipForToday(skipsHoyScope, { equipmentId: e.id, dateISO: todayISODash })");
    expect(src).toContain('if (!carry || carry.shiftId === turnoActual) return false;');
  });

  it('"día anterior"/"mayor antigüedad" reusan s.scheduleDate de statusFor()/weekdayStatusFor() (ya calculado en computeAllStatuses) — cero cálculo de vencimiento nuevo', () => {
    expect(src).toContain("if (s.code === 'ROJO' && s.scheduleDate) {");
    expect(src).toContain('new Date(s.scheduleDate).setHours(0, 0, 0, 0)');
  });
});

describe('§2 — "Vencidos" (horómetro) nunca se mezcla con "Arrastrados" (día/turno)', () => {
  it('vencidosHorometro excluye explícitamente los planes "Día y turno de la semana"', () => {
    expect(src).toContain("s.code === 'ROJO' && (plansByEquipoId[e.id] || {}).controlType !== 'Día y turno de la semana'");
  });

  it('la clasificación de arrastrados SOLO corre para planes "Día y turno de la semana" (horómetro nunca entra en Arrastrados)', () => {
    const idx = src.indexOf('statusesNormal.forEach(({ e, s }) => {');
    const block = src.slice(idx, idx + 700);
    expect(block).toContain("if (!plan || plan.controlType !== 'Día y turno de la semana') return;");
  });
});

describe('§3 — "Arrastrados" nunca cuenta dos veces el mismo equipo (turno anterior excluido de día anterior/pendientes hoy)', () => {
  it('turnoAnteriorIds se descarta ANTES de evaluar día anterior/mayor antigüedad/pendientes hoy', () => {
    expect(src).toContain('if (turnoAnteriorIds.has(e.id)) return; // ya contado como "Turno anterior" — nunca doble conteo');
  });

  it('el orden de construcción de `arrastrados` es Turno anterior > Día anterior > Mayor antigüedad', () => {
    const iArr = src.indexOf('const arrastrados = [');
    const block = src.slice(iArr, iArr + 400);
    const iTurno = block.indexOf('pendientesTurnoAnterior.map');
    const iDia = block.indexOf('diaAnteriorList.map');
    const iAntiguo = block.indexOf('masAntiguoList.map');
    expect(iTurno).toBeGreaterThan(-1);
    expect(iDia).toBeGreaterThan(iTurno);
    expect(iAntiguo).toBeGreaterThan(iDia);
  });

  it('"Trabajo del turno actual" excluye los equipos ya mostrados en Arrastrados (cada equipo aparece una sola vez en toda la pantalla; fix 2026-10-08 agregó también excluir VERDE/realizadosHoyIds, ver describe aparte)', () => {
    expect(src).toContain('!arrastradosIds.has(e.id) && s.code !== \'VERDE\' && !realizadosHoyIds.has(e.id)');
  });
});

describe('§3 — cada tarjeta de Arrastrados trae código/modelo/ubicación/origen/motivo/acciones, reusando funciones reales', () => {
  it('el motivo reusa NO_EXECUTION_REASON_LABELS (compartido con la Ficha de equipo), nunca un mapeo nuevo', () => {
    expect(src).toContain('NO_EXECUTION_REASON_LABELS[skip.reason] || skip.reason');
  });

  it('"Ver ficha" abre openEquipmentDetail() (la Ficha real, universal) y "Registrar engrase" abre startLubricadorGreaseFlow() (el mismo flujo real)', () => {
    expect(src).toContain("$$('.lub-arr-ver', c).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.id)));");
    expect(src).toContain("$$('.lub-arr-reg', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.id)));");
  });

  it('nunca crea una ocurrencia nueva para representar el arrastre (sin create/insert en el bloque de arrastrados)', () => {
    const iArr = src.indexOf('const arrastradoRowHTML');
    const iEnd = src.indexOf('const eqButtonHTML');
    const block = src.slice(iArr, iEnd);
    expect(block).not.toMatch(/DB\.(put|add)\(/);
  });

  it('"Mi Turno" (hardening UI 2026-10-08) también trae Registrar engrase/Ver ficha explícitos — ya no es una tarjeta clicable completa', () => {
    expect(src).toContain("$$('.lub-mt-reg', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.id)));");
    expect(src).toContain("$$('.lub-mt-ver', c).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.id)));");
  });
});

describe('§2 — exactamente 4 KPIs, SIEMPRE visibles (incluso en 0)', () => {
  it('los 4 kpiTile() son Vencidos/Pendientes hoy/Arrastrados/Realizados hoy, sin condicional que los oculte', () => {
    const iRow = src.indexOf('<div class="lub-kpi-row">');
    const iEnd = src.indexOf('</div>', src.indexOf('Realizados hoy', iRow));
    const block = src.slice(iRow, iEnd);
    expect(block).toContain("kpiTile('Vencidos', vencidosHorometro.length");
    expect(block).toContain("kpiTile('Pendientes hoy', pendientesHoyList.length");
    expect(block).toContain("kpiTile('Arrastrados', arrastrados.length");
    expect(block).toContain("kpiTile('Realizados hoy', realizadosHoy");
  });
});

describe('§7 — bloques vacíos ocultos (Atrasados/Mi Turno/Realizados/Alertas), nunca una tarjeta en 0 (hardening UI 2026-10-08, "simplificar Mi Turno")', () => {
  it('"Atrasados" solo se renderiza si arrastradosTotal.length > 0', () => {
    expect(src).toContain('${arrastradosTotal.length ? `');
  });

  it('"Mi Turno" solo se renderiza si miTurnoTotal.length > 0', () => {
    expect(src).toContain('${miTurnoTotal.length ? `');
  });

  it('"Realizados" solo se renderiza si realizadosHoyList.length > 0', () => {
    expect(src).toContain('${realizadosHoyList.length ? `');
  });

  it('"Alertas" solo se renderiza si alertasTiempoSinEngrase.length > 0', () => {
    expect(src).toContain('${alertasTiempoSinEngrase.length ? `');
  });
});

describe('"Asignaciones activas" (hardening UI 2026-10-08) — ya NO es una sección aparte: cada equipo asignado vive dentro de Atrasados o Mi Turno, con badge ASIGNADO', () => {
  it('no queda ningún encabezado "ASIGNACIONES ACTIVAS" independiente', () => {
    expect(src).not.toContain('ASIGNACIONES ACTIVAS');
  });

  it('la clasificación reusa el MISMO status.code ya calculado por computeAllStatuses() (statusesAssigned) — ROJO va a Atrasados, el resto (salvo VERDE, fix 2026-10-08) a Mi Turno, cero cálculo nuevo', () => {
    const idx = src.indexOf('const asignadosPorId');
    const block = src.slice(idx, idx + 1300);
    expect(block).toContain("if (s.code === 'ROJO') {");
    expect(block).toContain('arrastradosTotal.push(');
    expect(block).toContain('miTurnoTotal.push(');
  });

  it('dedup real: un equipo ya presente (arrastradosIds/miTurnoTotalIds) o ya realizado hoy (realizadosHoyIds) nunca se vuelve a agregar — solo se marca con el badge', () => {
    expect(src).toContain('if (arrastradosIds.has(e.id) || miTurnoTotalIds.has(e.id) || realizadosHoyIds.has(e.id)) return;');
  });

  it('el badge ASIGNADO reusa el MISMO componente/color ya usado en la Ficha de equipo (status-chip + var(--amber)), nunca una clase/paleta nueva', () => {
    expect(src).toContain("const asignadoBadgeHTML = '<span class=\"status-chip\" style=\"--c:var(--amber)\">ASIGNADO</span>';");
  });
});

describe('"Realizados" (hardening UI 2026-10-08) — solo COMPLETE de hoy dentro del scope, nunca PARTIAL', () => {
  it('filtra por resolveRecordCompleteness() !== PARTIAL (la MISMA función ya usada en la Ficha de equipo, cero fórmula nueva)', () => {
    expect(src).toContain("resolveRecordCompleteness(r) !== EXECUTION_COMPLETENESS.PARTIAL");
  });

  it('está acotado al scope activo (normal + asignados) — nunca equipos de otra cuadrilla', () => {
    expect(src).toContain('const scopeEquipoIds = new Set([...normalIds, ...equiposAsignados.map(e => e.id)]);');
    expect(src).toContain('scopeEquipoIds.has(r.equipmentId)');
  });

  it('"Ver validación" reusa findActiveValidations()/openValidationDetailModal() reales (mismo mecanismo que Mis Engrases), nunca una reimplementación', () => {
    expect(src).toContain('findActiveValidations(r.id, validationsHoy)');
    expect(src).toContain('await openValidationDetailModal(validation, eq, rec ? rec.date : null);');
  });
});

describe('"Alertas — Mayor tiempo sin engrasar" (hardening UI 2026-10-08) — MISMA fórmula que renderDashboard(), acotada al scope del Lubricador', () => {
  it('mismo criterio de orden (Operativo primero, luego más días sin registro primero, null=Infinity)', () => {
    const idx = src.indexOf('const alertasTiempoSinEngrase');
    const block = src.slice(idx, idx + 400);
    expect(block).toContain("a.status === 'Operativo' ? 0 : 1");
    expect(block).toContain('dB === null ? Infinity : dB');
  });

  it('acotada a `normal` (nunca equipos.length sin filtrar) y máximo 5', () => {
    expect(src).toContain('const alertasTiempoSinEngrase = [...normal].sort((a, b) => {');
    expect(src).toContain('.slice(0, 5)');
  });

  it('el código de equipo abre la Ficha real (openEquipmentDetail), nunca una ficha nueva', () => {
    expect(src).toContain("$$('.lub-alerta-code', c).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.id)));");
  });
});

describe('§8/§9 — nunca se muestra cumplimiento global, otras ubicaciones, ni estado de flota completa', () => {
  it('no hay ningún DB.allActive("equipment") SIN pasar por classifyEquipmentWork/scope dentro de esta función', () => {
    // Única llamada a equipos "crudos" es la de arriba de todo (antes de
    // resolver el scope) — se usa solo para pasarla a classifyEquipmentWork,
    // nunca para calcular KPIs directamente.
    const matches = src.match(/DB\.allActive\('equipment'\)/g) || [];
    expect(matches.length).toBe(1);
  });

  it('no se calcula ningún "cumplimiento" porcentual global (sin cumplHoy/cumplSemana/complianceTarget, eso es exclusivo del Dashboard admin)', () => {
    expect(src).not.toMatch(/cumpl(Hoy|Semana|Turno)/);
    expect(src).not.toContain('complianceTarget');
  });
});

describe('§1 — Contexto compacto: turno + ubicación + cuadrilla + sincronización, sin cálculo nuevo', () => {
  it('el turno reusa currentShiftId() (ya global), la ubicación/cuadrilla salen de scope.crewLocationId/myCrew ya resueltos', () => {
    expect(src).toContain("turnoActual === 'shift_dia' ? '☀ Turno Día' : '☾ Turno Noche'");
    expect(src).toContain('locations.find(l => l.id === scope.crewLocationId)');
    expect(src).toContain('esc(myCrew.name)');
  });

  it('la sincronización lee lastSyncState.status (el mismo estado global que ya mantiene updateConnBadge(), nunca un segundo sistema de sync)', () => {
    expect(src).toContain('const st = lastSyncState.status;');
  });
});

describe('§6 — Acciones rápidas reusan funciones reales, nunca reimplementan QR/búsqueda/matriz', () => {
  it('Escanear QR llama openQrScanner() (la función real, ya usada en el topbar)', () => {
    expect(src).toContain("$('#lub-quick-qr').addEventListener('click', () => openQrScanner());");
  });

  it('Buscar equipo enfoca el #quick-find real (wireQuickFind() ya lo deja wireado) — nunca un segundo input/buscador', () => {
    expect(src).toContain("$('#lub-quick-buscar').addEventListener('click', () => $('#quick-find')?.focus());");
  });

  it('Registrar engrase reusa openOutOfPlanEquipmentPicker() — mismo picker ya scoped a la cuadrilla, nunca una reimplementación', () => {
    expect(src).toContain("$('#lub-quick-registrar').addEventListener('click', () => openOutOfPlanEquipmentPicker());");
  });

  it('Matriz semanal abre openLubricadorMatrizModal() pasando `normal` (equipos YA scoped) — nunca equipos sin filtrar', () => {
    expect(src).toMatch(/openLubricadorMatrizModal\(\{\s*equipos: normal,/);
  });
});

describe('openLubricadorMatrizModal() — matriz de solo lectura, scoped, reusa estadoCelda() real', () => {
  const matrizSrc = extractDeclaration(appSource, 'openLubricadorMatrizModal');

  it('reusa estadoCelda() (weekly-matrix.js) — nunca recalcula el estado de una celda', () => {
    expect(matrizSrc).toContain('estadoCelda(eq, d, plans, records, hoy)');
  });

  it('nunca recibe ni ofrece un selector de Ubicación/Familia (scope-lock — §8/§9: nunca otra ubicación)', () => {
    expect(matrizSrc).not.toContain('mtz-ubic');
    expect(matrizSrc).not.toContain('<select');
  });

  it('solo incluye equipos con plan "Día y turno de la semana" (mismo criterio que la Matriz Semanal real)', () => {
    expect(matrizSrc).toContain("p.controlType === 'Día y turno de la semana'");
  });

  it('usa los MISMOS colores/clases que la Matriz Semanal real (celda-hecho-atrasado, etc. — el fix de Hallazgo 2 aplica también aquí)', () => {
    expect(matrizSrc).toContain('celda-hecho-atrasado');
    expect(matrizSrc).toContain('#8A5A00');
  });
});

describe('Fix 2026-10-08 ("alinear estado y trabajo realizado") — VERDE/"AL DÍA" nunca en la bandeja de trabajo, sin tocar statusFor()/weekdayStatusFor()', () => {
  it('"Mi Turno" excluye explícitamente s.code === \'VERDE\' (un equipo al día no tiene ocurrencia pendiente)', () => {
    expect(src).toContain("!arrastradosIds.has(e.id) && s.code !== 'VERDE' && !realizadosHoyIds.has(e.id)");
  });

  it('el camino de asignados también excluye VERDE antes de agregar a Mi Turno (mismo criterio, sin duplicar código de cálculo)', () => {
    const idx = src.indexOf("if (s.code === 'ROJO') {");
    const block = src.slice(idx, idx + 300);
    expect(block).toContain("} else if (s.code !== 'VERDE') {");
  });

  it('realizadosHoyIds se calcula ANTES que Mi Turno/Atrasados y se usa como barrera de dedup explícita (nunca solo implícita vía status.code)', () => {
    const iReal = src.indexOf('const realizadosHoyIds');
    const iMiTurno = src.indexOf('const statusesNormalRestantes');
    expect(iReal).toBeGreaterThan(-1);
    expect(iMiTurno).toBeGreaterThan(iReal);
    expect(src).toContain('|| realizadosHoyIds.has(e.id)) return;');
  });
});

describe('Fix 2026-10-08 — un PARTIAL nunca desaparece de la bandeja (reclasificación SOLO de presentación, nunca una 2da regla de satisfacción)', () => {
  it('reusa resolveRecordCompleteness()/EXECUTION_COMPLETENESS — mismo criterio que Realizados, nunca una fórmula nueva', () => {
    const idx = src.indexOf('statusesNormal.forEach(({ e, s }) => {\n    if (s.code !== \'VERDE\'');
    const block = src.slice(idx, idx + 1200);
    expect(block).toContain('resolveRecordCompleteness(r) !== EXECUTION_COMPLETENESS.PARTIAL');
  });

  it('NUNCA reescribe weekdayStatusFor()/statusFor() — solo arma un objeto `s` local para esta tarjeta (código/label ya conocidos: PROGRAMADO HOY)', () => {
    expect(src).toContain("s: { ...s, code: 'AMARILLO', label: 'PROGRAMADO HOY' }");
  });

  it('un día programado ya pasado (schedDate0 < hoy0) va a Atrasados con el mismo criterio día-anterior/mayor-antigüedad ya usado arriba', () => {
    const idx = src.indexOf('if (schedDate0 < hoy0) {');
    const block = src.slice(idx, idx + 400);
    expect(block).toContain("diasAtras === 1 ? 'Día anterior' : `Pendiente desde ${fmtOrigenFecha(s.scheduleDate)}`");
  });
});
