// tests/unit/registrar-engrase-inicial.test.js
//
// Rediseño de la pantalla inicial de Registrar Engrase (renderRegistrar,
// ANTES de elegir equipo) — mismo contenedor protagonista de siempre. Desde
// el lote occurrences/carryover (§2, "selector de equipo compacto"), el
// <select> con TODOS los equipos activos fue reemplazado por un buscador
// en vivo (wireRegEquipoSearch(), mismo patrón que wireQuickFind() de la
// topbar pero con su propio contenedor) — se agrega el bloque de equipos
// recientes reutilizando recentEquiposHTML()/trackRecentEquipment() YA
// EXISTENTES (Mi Turno/Equipos) — no se inventa persistencia nueva.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderRegistrar');
const searchSrc = extractDeclaration(appSource, 'wireRegEquipoSearch');
const collapseSrc = extractDeclaration(appSource, 'collapseRegSelectToChip');
const startGreaseFlowSrc = extractDeclaration(appSource, 'startGreaseFlow');

describe('renderRegistrar() — pantalla "Seleccionar equipo" más protagonista, mismo flujo funcional', () => {
  it('título y subtítulo pedidos, dentro de un contenedor con ancho de lectura limitado (no todo el monitor)', () => {
    expect(src).toContain('<h2 class="reg-select-title">Seleccionar equipo</h2>');
    expect(src).toContain('<p class="reg-select-subtitle">Busca y selecciona un equipo para registrar el engrase.</p>');
    expect(src).toContain('class="reg-select-wrap"');
    expect(src).toContain('class="reg-select-card"');
  });

  it('selector compacto: buscador en vivo (no un <select> con todos los equipos), delega en wireRegEquipoSearch()', () => {
    expect(src).not.toContain('<select id="reg-eq-select"');
    expect(src).toContain('<input type="text" id="reg-eq-search"');
    expect(src).toContain('<div id="reg-eq-search-results"');
    expect(src).toContain('wireRegEquipoSearch(equipos, $(\'#reg-flow-area\'));');
    expect(src).toContain('<div id="reg-flow-area"></div>');
  });

  it('wireRegEquipoSearch(): filtra por código/shortCode/marca+modelo y abre startGreaseFlow() al elegir un resultado — sin listener global en document (esta pantalla se redibuja completa en cada navegación)', () => {
    expect(searchSrc).toContain("(e.code || '').toLowerCase().includes(q)");
    expect(searchSrc).toContain("(e.shortCode || '').toLowerCase().includes(q)");
    expect(searchSrc).toContain('startGreaseFlow(eq.id, flowArea);');
    expect(searchSrc).not.toContain("document.addEventListener");
  });

  it('reutiliza recentEquiposHTML() ya existente (Mi Turno/Equipos) — no inventa una funcionalidad ni persistencia nueva', () => {
    expect(src).toContain('const recentsHTML = await recentEquiposHTML();');
    expect(src).toContain("$$('.recents-chip', c).forEach(b => b.addEventListener('click', () => {");
    expect(src).toContain('startGreaseFlow(b.dataset.recentId, $(\'#reg-flow-area\'));');
  });

  it('un equipo reciente también colapsa el selector al chip (cierre operativo §13), igual que un resultado de búsqueda', () => {
    expect(src).toContain('if (eq) collapseRegSelectToChip(eq);');
  });
});

describe('collapseRegSelectToChip() — selector compacto tras elegir equipo (cierre operativo §13)', () => {
  it('reemplaza .reg-select-card por un chip código+marca+modelo con botón "Cambiar"', () => {
    expect(collapseSrc).toContain('class="reg-select-chip"');
    expect(collapseSrc).toContain('id="reg-select-change"');
    expect(collapseSrc).toContain('${esc(equipo.code)}');
  });

  it('"Cambiar" vuelve a dibujar renderRegistrar() desde cero (nunca intenta reconstruir el estado de búsqueda a mano)', () => {
    expect(collapseSrc).toContain("$('#reg-select-change').addEventListener('click', () => renderRegistrar());");
  });
});

describe('Contexto completo de la ocurrencia — Ubicación/Tipo de trabajo/Estado/Programado/Turno actual/Último engrase (cierre operativo §11/§12)', () => {
  it('las 6 etiquetas del contexto están presentes, con datos reales (nunca texto fijo)', () => {
    expect(startGreaseFlowSrc).toContain('<dt>Ubicación</dt><dd>${esc(ubicacionReg ? ubicacionReg.name : \'—\')}</dd>');
    expect(startGreaseFlowSrc).toContain('<dt>Tipo de trabajo</dt><dd>${esc(tipoTrabajoLabelReg)}</dd>');
    // Fix 2026-10-10 ("REDISEÑO UX FORMULARIO REGISTRAR ENGRASE"): Estado
    // ahora es un .status-chip semántico (mismo STATUS_COLOR de siempre,
    // nunca una paleta nueva) y Programado ("Programación") se renderiza
    // como chips por día cuando el plan es semanal — mismo dato real.
    expect(startGreaseFlowSrc).toContain('<dt>Estado</dt><dd><span class="status-chip" style="--c:${STATUS_COLOR[estadoPrevio]');
    expect(startGreaseFlowSrc).toContain('${esc(ESTADO_PREVIO_LABELS[estadoPrevio] || estadoPrevio)}</span></dd>');
    expect(startGreaseFlowSrc).toContain('<dt>Programación</dt><dd>${plan && plan.controlType ===');
    expect(startGreaseFlowSrc).toContain("plan.assignedDays.map(d => `<span class=\"grease-flow-daychip\">${esc(WEEKDAY_ABBR_DASH[d] || d)}</span>`).join('')");
    expect(startGreaseFlowSrc).toContain('<dt>Turno actual</dt><dd><span class="grease-flow-daychip">${shiftLabel(turnoActualReg)}</span></dd>');
    expect(startGreaseFlowSrc).toContain('<dt>Último engrase</dt><dd>${esc(ultimoEngraseLabelReg)}</dd>');
  });

  it('"Tipo de trabajo" reutiliza findExistingWorkForEquipment() — nunca reimplementa ASSIGNED > PLANNED > NONE a mano', () => {
    expect(startGreaseFlowSrc).toContain('findExistingWorkForEquipment({');
    expect(startGreaseFlowSrc).toContain("const TIPO_TRABAJO_LABELS = { ASSIGNED: 'Asignado', PLANNED: 'Planificado', NONE:");
  });

  it('"Último engrase" viene del registro REAL más reciente de este equipo (allRecordsForEq[0]), "Nunca registrado" si no hay ninguno', () => {
    expect(startGreaseFlowSrc).toContain('const ultimoEngraseReg = allRecordsForEq[0] || null;');
    expect(startGreaseFlowSrc).toContain("const ultimoEngraseLabelReg = ultimoEngraseReg ? ");
    expect(startGreaseFlowSrc).toContain("'Nunca registrado'");
  });
});

describe('"No se pudo ejecutar" — visible SOLO para PLANNED/ASSIGNED pendientes (cierre operativo §14)', () => {
  it('el botón se gatea por trabajoReg.kind !== \'NONE\' y nunca aparece en el flujo "Fuera de plan"', () => {
    expect(startGreaseFlowSrc).toContain("!outOfPlan && trabajoReg.kind !== 'NONE' ? `<button type=\"button\" class=\"btn\" id=\"btn-no-ejecutado\">");
  });

  it('trabajoReg reutiliza findExistingWorkForEquipment() (operational-scope.js) — misma prioridad ASSIGNED > PLANNED > NONE que el resto de la app, nunca reimplementada', () => {
    expect(startGreaseFlowSrc).toContain('const trabajoReg = findExistingWorkForEquipment({');
  });
});

describe('YA_ENGRASADO — búsqueda automática de match antes de conciliación (cierre histórico Parte A)', () => {
  it('el cambio de motivo a YA_ENGRASADO dispara la búsqueda (findMatchingGreaseRecordForOccurrence), nunca cierra nada sin ella', () => {
    expect(startGreaseFlowSrc).toContain("$('#noexec-reason').addEventListener('change', actualizarMatchYaEngrasado);");
    expect(startGreaseFlowSrc).toContain('findMatchingGreaseRecordForOccurrence({');
  });

  it('MATCH ofrece "Vincular al plan"; AMBIGUOUS pide conciliación del Planificador; NONE avisa sin match — las 3 ramas, ninguna cierra nada por su cuenta', () => {
    expect(startGreaseFlowSrc).toContain('Vincular al plan');
    expect(startGreaseFlowSrc).toContain('Se encontraron varios engrases posibles. Requiere revisión del Planificador.');
    expect(startGreaseFlowSrc).toContain('No se encontró un engrase compatible.');
  });

  it('"Vincular al plan" pasa linkedRecordId al guardar — NUNCA crea un lubrication_record nuevo, solo enlaza el skip al real existente', () => {
    const iVincular = startGreaseFlowSrc.indexOf("$('#noexec-vincular').addEventListener('click', () => guardarNoEjecucion({ linkedRecordId: rec.id }));");
    expect(iVincular).toBeGreaterThan(-1);
    expect(startGreaseFlowSrc).not.toMatch(/noexec-vincular[\s\S]{0,200}uid\('greg'\)/);
  });

  it('"Confirmar" normal (sin match) sigue guardando el skip sin linkedRecordId, como antes de este lote', () => {
    expect(startGreaseFlowSrc).toContain("$('#noexec-confirm').addEventListener('click', () => guardarNoEjecucion());");
  });
});

describe('BUG REAL encontrado y corregido — "Registrar" sin target (Dashboard/Equipos) nunca mostraba "Validar ahora/después" tras guardar', () => {
  // Causa raíz: renderRegistrar() es ASYNC. Justo después de navigate('registrar'),
  // #reg-flow-area TODAVÍA no existe (la pantalla anterior sigue en el DOM) — por
  // eso ya existía un setTimeout(30ms) que esperaba y volvía a buscar el contenedor.
  // Pero ese setTimeout declaraba su PROPIA variable local `area` (misma palabra,
  // shadowing) — wireGreaseForm() es una función hermana, definida en el scope
  // EXTERIOR, así que su propio `area.innerHTML = ...` (al guardar, para pintar
  // "Validar ahora/después") seguía resolviendo la variable EXTERIOR original,
  // nunca la reasignada dentro del setTimeout. Sin `target` esa variable exterior
  // era `null` (capturada ANTES de que renderRegistrar() terminara de pintar) —
  // el guardado funcionaba (toast incluido), pero `area.innerHTML = ...` reventaba
  // sobre `null` y la pantalla se quedaba congelada en el formulario.
  it('`area` es `let` (reasignable), nunca `const` — wireGreaseForm() necesita ver la reasignación posterior', () => {
    expect(startGreaseFlowSrc).toContain('let area = target;');
    expect(startGreaseFlowSrc).not.toMatch(/const area = target/);
  });

  it('el setTimeout REASIGNA la misma `area` exterior (`area = ...`), nunca la vuelve a declarar (`const area =`/`let area =` adentro, que la taparía)', () => {
    const iTimeout = startGreaseFlowSrc.indexOf('setTimeout(() => {');
    const iFinTimeout = startGreaseFlowSrc.indexOf('}, 30);');
    const timeoutBody = startGreaseFlowSrc.slice(iTimeout, iFinTimeout);
    expect(timeoutBody).toContain("area = $('#reg-flow-area');");
    expect(timeoutBody).not.toMatch(/const area =|let area =/);
  });

  it('sin `target`, navigate(\'registrar\') se llama ANTES del setTimeout que resuelve `area` (nunca dentro de una IIFE síncrona que la deja en null)', () => {
    const iNavigate = startGreaseFlowSrc.indexOf("navigate('registrar');");
    const iTimeout = startGreaseFlowSrc.indexOf('setTimeout(() => {');
    expect(iNavigate).toBeGreaterThan(-1);
    expect(iTimeout).toBeGreaterThan(-1);
    expect(iNavigate).toBeLessThan(iTimeout);
  });

  it('con `target` sí presente, wireGreaseForm() se llama en el mismo momento que se pinta el HTML (sin esperar ningún setTimeout)', () => {
    const iTargetBranch = startGreaseFlowSrc.indexOf('if (target) {');
    const iElse = startGreaseFlowSrc.indexOf('} else {', iTargetBranch);
    const targetBranch = startGreaseFlowSrc.slice(iTargetBranch, iElse);
    expect(targetBranch).toContain('target.innerHTML = html;');
    expect(targetBranch).toContain('wireGreaseForm();');
  });

  it('"Validar ahora/después" sigue escribiendo sobre `area` (la misma variable, ahora reasignable) — no se cambió a qué contenedor apunta', () => {
    expect(startGreaseFlowSrc).toContain('area.innerHTML = `<div class="panel">');
    expect(startGreaseFlowSrc).toContain('¿Quién valida este engrase?');
  });
});
