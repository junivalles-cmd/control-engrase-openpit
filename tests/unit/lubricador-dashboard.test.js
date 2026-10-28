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

describe('§2 — "Vencidos por horas" (horómetro) nunca se mezcla con "Arrastrados" (día/turno)', () => {
  it('vencidosHorometro excluye explícitamente los planes "Día y turno de la semana"', () => {
    expect(src).toContain("s.code === 'ROJO' && (plansByEquipoId[e.id] || {}).controlType !== 'Día y turno de la semana'");
  });

  it('la clasificación de arrastrados SOLO corre para planes "Día y turno de la semana" (horómetro nunca entra en Arrastrados)', () => {
    const idx = src.indexOf('statusesNormal.forEach(({ e, s }) => {');
    const block = src.slice(idx, idx + 700);
    expect(block).toContain("if (!plan || plan.controlType !== 'Día y turno de la semana') return;");
  });

  // Fix 2026-10-09 ("CERRAR KPI VENCIDOS"): el KPI cuenta el ESTADO real
  // (ROJO + plan por horas), no el origen de la tarea — normal Y asignado,
  // sobre la MISMA fuente ya deduplicada (statusesNormalYAsignados) que
  // también usa la reclasificación de PARTIAL — nunca un segundo merge.
  it('vencidosHorometro se construye sobre statusesNormalYAsignados (normal + asignado), nunca solo statusesNormal', () => {
    expect(src).toContain('const vencidosHorometro = statusesNormalYAsignados.filter(');
  });

  it('statusesNormalYAsignados deduplica por normalIds (un equipo que viniera por los 2 caminos nunca se cuenta 2 veces)', () => {
    expect(src).toContain('const statusesNormalYAsignados = [...statusesNormal, ...statusesAssigned.filter(({ e }) => !normalIds.has(e.id))];');
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
    // Fix 2026-10-09 (§6 del pedido): también excluye vencidosHorometroIds —
    // un vencido por horómetro ya cuenta en el KPI "Vencidos por horas", y
    // antes se colaba también en Mi Turno porque arrastradosIds nunca lo
    // incluye (ese Set es solo para vencidos por día/turno de la semana).
    expect(src).toContain('!arrastradosIds.has(e.id) && !vencidosHorometroIds.has(e.id) && s.code !== \'VERDE\' && !realizadosHoyIds.has(e.id)');
  });
});

describe('§3 — cada tarjeta de Arrastrados trae código/modelo/ubicación/origen/motivo/acciones, reusando funciones reales', () => {
  it('el motivo reusa NO_EXECUTION_REASON_LABELS (compartido con la Ficha de equipo), nunca un mapeo nuevo', () => {
    expect(src).toContain('NO_EXECUTION_REASON_LABELS[skip.reason] || skip.reason');
  });

  it('"Ver ficha" abre openEquipmentDetail() (la Ficha real, universal) y "Registrar engrase" abre startLubricadorGreaseFlow() (el mismo flujo real)', () => {
    expect(src).toContain("$$('.lub-arr-ver', c).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.id)));");
    expect(src).toContain("$$('.lub-arr-reg', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.id, b.dataset.assignmentId ? { assignmentId: b.dataset.assignmentId } : undefined)));");
  });

  it('nunca crea una ocurrencia nueva para representar el arrastre (sin create/insert en el bloque de arrastrados)', () => {
    const iArr = src.indexOf('const arrastradoRowHTML');
    const iEnd = src.indexOf('const eqButtonHTML');
    const block = src.slice(iArr, iEnd);
    expect(block).not.toMatch(/DB\.(put|add)\(/);
  });

  it('"Mi Turno" (hardening UI 2026-10-08) también trae Registrar engrase/Ver ficha explícitos — ya no es una tarjeta clicable completa', () => {
    expect(src).toContain("$$('.lub-mt-reg', c).forEach(b => b.addEventListener('click', () => startLubricadorGreaseFlow(b.dataset.id, b.dataset.assignmentId ? { assignmentId: b.dataset.assignmentId } : undefined)));");
    expect(src).toContain("$$('.lub-mt-ver', c).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.id)));");
  });
});

// UX CAMPO V2 (2026-10-24): la fila de 4 kpiTile() se retiró — Mi Turno ya
// no muestra "tarjetas KPI" (pedido explícito: "NO KPI cards grandes").
// "Vencidos por horas"/"Pendientes hoy"/"Pendientes del turno anterior" se
// reemplazan por los 3 acordeones reales (con sus propias tarjetas, no solo
// un número) + el resumen compacto del header ("N pendientes · N prioridad
// · N turno"); "Realizados hoy" sigue como su propia sección, sin cambios.
describe('§2 — acordeones de Mi Turno (reemplazo de los 4 KPIs), SIEMPRE presentes (incluso en 0, con estado vacío)', () => {
  it('accordionHTML() construye las 3 bandejas con los MISMOS totales ya fusionados (arrastradosVisibles/atencionPrioritariaVisibles/miTurnoVisible), nunca un cálculo aparte', () => {
    const iRow = src.indexOf('<div class="lub-accordions" id="lub-accordions">');
    const iEnd = src.indexOf('</div>', src.lastIndexOf("accordionHTML('mi-turno'", src.indexOf('${followUpVisible.length')));
    const block = src.slice(iRow, iEnd);
    expect(block).toContain("accordionHTML('pendientes-anteriores', 'Pendientes anteriores', 'Trabajo de turnos anteriores sin completar', arrastradosVisibles.length,");
    expect(block).toContain("accordionHTML('atencion-prioritaria', 'Atención prioritaria', 'Equipos que requieren atención primero', atencionPrioritariaVisibles.length,");
    expect(block).toContain("accordionHTML('mi-turno', 'Engrases de mi turno', 'Trabajo programado para este turno', miTurnoVisible.length,");
  });

  it('cada acordeón SIEMPRE se pinta (nunca condicionado a su propio count) — internamente decide tarjetas vs. estado vacío, nunca desaparece', () => {
    const fn = src.slice(src.indexOf('const accordionHTML = '), src.indexOf('const eqCardHTML ='));
    expect(fn).toContain('${count ? `<div class="lub-eq-list">${listHTML}</div>` : `<p class="field-hint lub-accordion-empty">${esc(emptyText)}</p>`}');
  });

  it('el resumen del header usa los mismos 3 totales, nunca pendientesHoyList/arrastrados/realizadosHoy previos al merge con statusesAssigned', () => {
    expect(src).toContain('${arrastradosVisibles.length} pendiente${arrastradosVisibles.length === 1 ? \'\' : \'s\'} · ${atencionPrioritariaVisibles.length} prioridad · ${miTurnoVisible.length} turno');
  });
});

describe('§7 — acordeones con estado vacío propio (Pendientes anteriores/Atención prioritaria/Mi turno), nunca una tarjeta en 0 (hardening UI 2026-10-08 + UX CAMPO V2)', () => {
  it('"Pendientes anteriores" (antes "Atrasados") tiene su propio texto de estado vacío', () => {
    expect(src).toContain("'No hay pendientes de turnos anteriores.'");
  });

  it('"Atención prioritaria" (antes solo un KPI, ahora bandeja propia) tiene su propio texto de estado vacío', () => {
    expect(src).toContain("'No hay equipos que requieran atención prioritaria.'");
  });

  it('"Engrases de mi turno" (antes "Mi Turno") tiene su propio texto de estado vacío', () => {
    expect(src).toContain("'No hay engrases programados para este turno.'");
  });

  it('"Realizados" solo se renderiza si hay filas visibles en el filtro (sin cambios — no es uno de los 3 acordeones)', () => {
    expect(src).toContain('${realizadosHoyVisibles.length ? `');
  });

  it('"Requieren seguimiento" (sugerido, no es una obligación del turno, no es uno de los 3 acordeones) sigue mostrando SIEMPRE su encabezado (fix 2026-10-09, §7 original) — nunca desaparece en silencio', () => {
    expect(src).toContain('<section id="lub-pending-follow-up" aria-label="Seguimiento sugerido">');
    expect(src).toContain('Sin pendientes ni equipos que requieran seguimiento.');
  });
});

describe('"Asignaciones activas" (hardening UI 2026-10-08) — ya NO es una sección aparte: cada equipo asignado vive dentro de Atrasados o Mi Turno, con badge ASIGNADO', () => {
  it('no queda ningún encabezado "ASIGNACIONES ACTIVAS" independiente', () => {
    expect(src).not.toContain('ASIGNACIONES ACTIVAS');
  });

  it('la clasificación reusa el MISMO status.code ya calculado por computeAllStatuses() (statusesAssigned) — ROJO va a Atrasados, el resto (salvo VERDE, fix 2026-10-08) a Mi Turno, cero cálculo nuevo', () => {
    const idx = src.indexOf('const asignadosPorId');
    // Fix 2026-10-17 ("FECHA VISUAL DE ASIGNACIÓN ATRASADA") agregó un
    // comentario explicativo + parseOccurrenceKeyDate() dentro de esta misma
    // rama ROJO (ver operational-scope.js) — ensancha la ventana para seguir
    // cubriendo arrastradosTotal.push(.../miTurnoTotal.push(, sin cambiar lo
    // que esta prueba verifica.
    const block = src.slice(idx, idx + 2400);
    expect(block).toContain("if (row.kind === 'CARRYOVER') {");
    expect(block).toContain('arrastradosTotal.push(');
    expect(block).toContain('miTurnoTotal.push(');
  });

  it('dedup real: un equipo ya presente (arrastradosIds/miTurnoTotalIds) o ya realizado hoy (realizadosHoyIds) nunca se vuelve a agregar — solo se marca con el badge', () => {
    expect(src).toContain('if (seen.has(identity)) continue;');
  });

  it('el badge ASIGNADO reusa el MISMO componente/color ya usado en la Ficha de equipo (status-chip + var(--amber)), nunca una clase/paleta nueva', () => {
    // Fix 2026-10-09 (§12 del pedido): suma la clase .chip-origen (solo
    // CSS, contorno en vez de relleno) para diferenciar ASIGNADO (origen)
    // del status-chip de ESTADO al lado — mismo --c/color, mismo texto.
    expect(src).toContain("const asignadoBadgeHTML = '<span class=\"status-chip chip-origen\" style=\"--c:var(--amber)\">ASIGNADO</span>';");
  });
});

describe('"Realizados" (hardening UI 2026-10-08) — solo COMPLETE de hoy dentro del scope, nunca PARTIAL', () => {
  it('filtra por resolveRecordCompleteness() !== PARTIAL (la MISMA función ya usada en la Ficha de equipo, cero fórmula nueva)', () => {
    expect(src).toContain("resolveRecordCompleteness(r) !== EXECUTION_COMPLETENESS.PARTIAL");
  });

  it('está acotado al scope activo (normal + asignados) — nunca equipos de otra cuadrilla', () => {
    expect(src).toContain("assignments.filter(a => a.active !== false && a.status === 'COMPLETED')");
    expect(src).toContain('scopeEquipoIds.has(r.equipmentId)');
  });

  it('"Ver validación" reusa findActiveValidations()/openValidationDetailModal() reales (mismo mecanismo que Mis Engrases), nunca una reimplementación', () => {
    expect(src).toContain('findActiveValidations(r.id, validationsHoy)');
    expect(src).toContain('await openValidationDetailModal(validation, eq, rec ? rec.date : null);');
  });
});

describe('Seguimiento por antigüedad es independiente del estado formal del plan', () => {
  it('usa la proyección scoped compartida y excluye pendientes reales anteriores, nunca MI TURNO (puede coexistir)', () => {
    expect(src).toContain('const followUpRows = buildCrewLubricationFollowUp({');
    expect(src).toContain('excludedEquipmentIds: arrastradosTotal.map(row => row.e.id)');
    expect(src).not.toContain('excludedEquipmentIds: [...arrastradosTotal, ...miTurnoTotal]');
  });
  it('filtra ubicación y muestra primeros cinco más Ver todos, sin recortar el dataset', () => {
    expect(src).toContain('const followUpVisible = filterLocationRows(followUpRows)');
    expect(src).toContain('followUpVisible.slice(0, 5)');
    expect(src).toContain('followUpVisible.slice(5)');
  });
  it('un PARTIAL mantiene su clasificación de trabajo formal', () => {
    expect(src).toContain('const partialPendienteIds = new Set();');
    expect(src).toContain('partialPendienteIds.add(e.id);');
  });
  it('Ficha y registro usan los flujos existentes', () => {
    expect(src).toContain("$$('.lub-follow-up-ver', c).forEach(b => b.addEventListener('click', () => openEquipmentDetail(b.dataset.id)));");
    expect(src).toContain("$$('.lub-follow-up-reg', c).forEach(b => b.addEventListener('click', () => handleOutOfPlanEquipoSelected(b.dataset.id)));");
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

describe('§1 — Header compacto de Mi Turno: cuadrilla + ubicación + turno, sin cálculo nuevo (UX CAMPO V2: el indicador de sync ya NO se duplica aquí)', () => {
  it('el turno/ubicación/cuadrilla salen de turnoActual/headerCoverage/myCrew ya resueltos, sin cálculo nuevo', () => {
    expect(src).toContain("turnoActual === 'shift_dia' ? '☀ Turno Día' : '☾ Turno Noche'");
    expect(src).toContain('const headerCoverage = crewCoveragePresentation(scope, locations);');
    expect(src).toContain("esc(myCrew?.name || 'Sin cuadrilla')");
  });

  it('nunca duplica un segundo indicador de sincronización — #conn-badge (topbar persistente de bootLubricador()) ya cubre eso', () => {
    const header = src.slice(src.indexOf('<div class="lub-turno-header">'), src.indexOf('lub-turno-header-summary'));
    expect(header).not.toContain('lastSyncState.status');
    expect(src).toContain('el indicador de sincronización YA vive en #conn-badge');
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

  it('Matriz semanal abre openLubricadorMatrizModal() pasando equiposForLubricadorMatriz(equipos, scope) — CONSULTA GLOBAL de la ubicación (2026-10-09), ya NO `normal` (eso es el scope restrictivo de "Mi Turno")', () => {
    expect(src).toMatch(/openLubricadorMatrizModal\(\{\s*equipos: equiposForLubricadorMatriz\(equipos, scope\),/);
    // equipos: normal ya no debe aparecer como argumento de esta llamada
    // específica (puede seguir existiendo `normal` en el resto de la
    // función, para Mi Turno — solo se descarta el patrón exacto de abajo).
    expect(src).not.toMatch(/openLubricadorMatrizModal\(\{\s*equipos: normal,/);
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
    expect(src).toContain("!arrastradosIds.has(e.id) && !vencidosHorometroIds.has(e.id) && s.code !== 'VERDE' && !realizadosHoyIds.has(e.id)");
  });

  it('asignados completados se excluyen por identidad, no por el semaforo de otra ocurrencia', () => {
    expect(src).toContain('if (completed) continue;');
    expect(src).toContain('projectAssignedShiftWork({ assignedRows: assigned');
  });

  it('realizadosHoyIds se calcula ANTES que Mi Turno/Atrasados y se usa como barrera de dedup explícita (nunca solo implícita vía status.code)', () => {
    const iReal = src.indexOf('const realizadosHoyIds');
    const iMiTurno = src.indexOf('const statusesNormalRestantes');
    expect(iReal).toBeGreaterThan(-1);
    expect(iMiTurno).toBeGreaterThan(iReal);
    expect(src).toContain('if (completed) continue;');
  });
});

describe('Fix 2026-10-08 — un PARTIAL nunca desaparece de la bandeja (reclasificación SOLO de presentación, nunca una 2da regla de satisfacción)', () => {
  it('reusa resolveRecordCompleteness()/EXECUTION_COMPLETENESS — mismo criterio que Realizados, nunca una fórmula nueva', () => {
    // Fix 2026-10-09 (bug de Alertas): esta condición se separó en
    // `statusesNormal.filter(...).forEach(...)` para que `partialPendienteIds`
    // sea reusable por Alertas — mismo criterio exacto, solo cambió la forma.
    const idx = src.indexOf("const partialPendienteIds = new Set();");
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

// Fix 2026-10-09 ("FIX FRESH INSTALL / FALSE NO_CREW_ASSIGNED"): bug real —
// en una instalación nueva, boot() dispara Sync.runAutoCycle() SIN
// esperarlo (ver boot()) y sigue directo a bootLubricador() →
// renderLubricadorHome(); ese primer render corre con IndexedDB todavía
// vacío, así que scope.kind === 'NO_CREW_ASSIGNED' en ese instante es
// indistinguible de un usuario REALMENTE sin cuadrilla. Prueba por patrón
// de fuente (mismo método del resto de este archivo) que la distinción de
// los 3 estados reusa SOLO señales ya existentes — cfg.lastPull
// (sync.js, pullAll()) y lastSyncState.status (ya mantenido por
// onSyncStateChange()) — nunca un segundo sistema de estado, nunca un
// cambio a sync.js/Auth.
describe('Fix 2026-10-17 ("RACE BOOTSTRAP/SCOPE") — bootstrap se resuelve ANTES de calcular ningún scope, nunca combinado con scope.kind en una misma condición', () => {
  const idxBootstrap = src.indexOf('const accountBootstrap = await Sync.getAccountSyncState();');
  const idxNoCrew = src.indexOf("if (scope.kind === 'NO_CREW_ASSIGNED') {");
  const bootstrapBlock = src.slice(idxBootstrap, idxNoCrew);

  it('el gate de bootstrap vive ANTES de getCurrentOperationalScope() — nunca combinado con scope.kind en el mismo `if` (esa combinación era el bug real: un scope calculado con el catálogo todavía vacío podía quedar NO_CREW_ASSIGNED y usarse igual aunque bootstrapComplete ya fuera true)', () => {
    expect(idxBootstrap).toBeGreaterThan(-1);
    expect(idxNoCrew).toBeGreaterThan(idxBootstrap);
    expect(bootstrapBlock).toContain('if (!accountBootstrap.bootstrapComplete) {');
    expect(bootstrapBlock).not.toContain("scope.kind === 'NO_CREW_ASSIGNED' || !accountBootstrap.bootstrapComplete");
    expect(bootstrapBlock).not.toContain('cfg.lastPull');
    // scope (y el resto del catálogo local) recién se piden DESPUÉS de
    // confirmar bootstrapComplete — nunca antes.
    const iGate = bootstrapBlock.indexOf('if (!accountBootstrap.bootstrapComplete) {');
    const iScope = bootstrapBlock.indexOf('const scope = await getCurrentOperationalScope();');
    expect(iScope).toBeGreaterThan(iGate);
  });

  it('distingue "sync en curso/sin empezar" de "ya falló" leyendo lastSyncState.status — nunca Sync.syncing reimplementado ni un segundo estado', () => {
    expect(bootstrapBlock).toContain("const ESTADOS_FALLO_SYNC = new Set(['offline', 'backend_unreachable', 'error', 'AUTH_REQUIRED', 'AUTH_FORBIDDEN', 'unconfigured', 'AUTHORIZATION_BOOTSTRAP_INCOMPLETE', 'stalled']);");
    expect(bootstrapBlock).toContain('ESTADOS_FALLO_SYNC.has(lastSyncState.status)');
  });

  // Auditoría de sincronización 2026-10-20 (§13 "WATCHDOG UX"): 'stalled'
  // (armSyncWatchdog(), app.js) se suma a ESTADOS_FALLO_SYNC — un bootstrap
  // sin cache que lleva >45s sin terminar ofrece Reintentar, nunca se queda
  // mudo en "Sincronizando datos…" para siempre.
  it("'stalled' (watchdog de sync eterno) entra al mismo camino de fallo que offline/error/etc — nunca un texto nuevo de Sincronizando sin salida", () => {
    expect(bootstrapBlock).toContain("'stalled'");
  });

  it('Estado A ("Sincronizando") y Estado B ("No se pudo cargar" + Reintentar) nunca concluyen "Sin cuadrilla autorizada" ni navegan al dashboard — ambos terminan el render con `return` dentro del gate de bootstrap', () => {
    expect(bootstrapBlock).toContain('Sincronizando datos…');
    expect(bootstrapBlock).toContain('No se pudo cargar tu asignación de trabajo.');
    expect(bootstrapBlock).toContain('id="lub-retry-bootstrap"');
    // Estado C ("Sin cuadrilla autorizada" real) ya vive en su PROPIO bloque
    // (ver describe de abajo), nunca dentro del gate de bootstrap.
    expect(bootstrapBlock).not.toContain('Sin cuadrilla autorizada');
  });

  it('el botón "Reintentar" llama Sync.fullSync() — EXACTAMENTE el mismo mecanismo real de sync (nunca runAutoCycle() ni uno alternativo), fuerza el re-render inmediato a "Sincronizando" (App._lubBootstrapRetrying) y vuelve a renderizar cuando fullSync() termina, sin reload manual', () => {
    const iBtn = bootstrapBlock.indexOf("$('#lub-retry-bootstrap')");
    const btnBlock = bootstrapBlock.slice(iBtn, iBtn + 400);
    expect(btnBlock).toContain('App._lubBootstrapRetrying = true;');
    expect(btnBlock).toContain('renderLubricadorHome();');
    expect(btnBlock).toContain('Sync.fullSync().finally(() => {');
    expect(btnBlock).not.toContain('runAutoCycle');
    expect(btnBlock).toContain('App._lubBootstrapRetrying = false;');
  });

  it('scope.kind === "NO_CREW_ASSIGNED" (Estado C real) es ahora un chequeo SOLO de scope — nunca vuelve a leer accountBootstrap/Sync.getAccountSyncState()', () => {
    expect(idxNoCrew).toBeGreaterThan(-1);
    const noCrewBlock = src.slice(idxNoCrew, src.indexOf("if (scope.kind === 'NEEDS_CREW_SELECTION')", idxNoCrew));
    expect(noCrewBlock).toContain('Sin cuadrilla autorizada');
    expect(noCrewBlock).not.toContain('accountBootstrap');
    expect(noCrewBlock).not.toContain('Sync.getAccountSyncState');
  });

  it('nunca escribe/borra nada (DB.put/DB.delete/pushAll) — es presentación pura sobre señales ya existentes', () => {
    const fullBlock = src.slice(idxBootstrap, src.indexOf("if (scope.kind === 'NEEDS_CREW_SELECTION')", idxBootstrap));
    expect(fullBlock).not.toMatch(/DB\.(put|delete)\(/);
    expect(fullBlock).not.toContain('pushAll');
  });
});
