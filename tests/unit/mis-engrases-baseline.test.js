// tests/unit/mis-engrases-baseline.test.js
//
// LOTE — "Mis Engrases + baseline de validación": regresión de navegación
// post-registro (terminaba en "PLAN DE ENGRASE DEL TURNO" en vez de "Mis
// Engrases") + baseline histórico (GREASE_VALIDATION_ENABLED_FROM). Prueba
// a nivel de fuente (mismo criterio que dashboard-operativo.test.js): las
// funciones involucradas (startGreaseFlow, renderLubricadorHistorial,
// drawHistory, renderDashboard) tienen demasiadas dependencias de DOM/
// IndexedDB para ejecutarlas aquí — se verifica el texto real de la
// función. La lógica pura del baseline (isRecordSubjectToValidation/
// validationStatusForRecord/isRecordPendingValidation) ya se prueba
// ejecutada de verdad en tests/unit/grease-validation.test.js.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const startGreaseFlowSrc = extractDeclaration(appSource, 'startGreaseFlow');
const irAMisEngrasesSrc = extractDeclaration(appSource, 'irAMisEngrasesTrasRegistrar');
const misEngrasesSrc = extractDeclaration(appSource, 'renderLubricadorHistorial');
const navigateSrc = extractDeclaration(appSource, 'navigate');
const dashSrc = extractDeclaration(appSource, 'renderDashboard');
const historialTableSrc = extractDeclaration(appSource, 'drawHistory');
const validationBadgeSrc = extractDeclaration(appSource, 'validationBadgeHTML');

describe('Causa raíz: navigate(App.route) es el router de ESCRITORIO, nunca debe llamarse desde el shell del Lubricador', () => {
  it('navigate() sigue siendo el router de escritorio (renderTurno para "turno", sin cambios) — confirma por qué pintaba la tabla', () => {
    expect(navigateSrc).toContain('turno: renderTurno');
    expect(navigateSrc).toContain('historial: renderHistorial');
  });

  it('startGreaseFlow() ya NO llama a navigate() en los botones de Validar ahora/después — usa irAMisEngrasesTrasRegistrar()', () => {
    expect(startGreaseFlowSrc).not.toContain('openValidationModal(record, equipment, () => navigate(App.route))');
    expect(startGreaseFlowSrc).not.toContain("addEventListener('click', () => navigate(App.route))");
    expect(startGreaseFlowSrc).toContain('openValidationModal(record, equipment, irAMisEngrasesTrasRegistrar);');
    expect(startGreaseFlowSrc).toContain("$('#grease-validate-later-btn')?.addEventListener('click', irAMisEngrasesTrasRegistrar);");
  });

  it('irAMisEngrasesTrasRegistrar() detecta el shell del Lubricador (.lub-shell) y llama DIRECTO a renderLubricadorHistorial() — nunca navigate() en ese caso', () => {
    expect(irAMisEngrasesSrc).toContain("document.querySelector('.lub-shell')");
    expect(irAMisEngrasesSrc).toContain("App.route = 'historial';");
    expect(irAMisEngrasesSrc).toContain('renderLubricadorHistorial();');
  });

  it('fuera del shell del Lubricador (escritorio) mantiene el comportamiento previo, sin romper ese flujo', () => {
    expect(irAMisEngrasesSrc).toContain('navigate(App.route);');
  });

  it('actualiza la pestaña activa del bottom-nav a "historial" al aterrizar en Mis Engrases', () => {
    expect(irAMisEngrasesSrc).toContain("const active = x.dataset.route === 'historial';");
    expect(irAMisEngrasesSrc).toContain("x.classList.toggle('active', active);");
  });
});

describe('"Mis Engrases" (renderLubricadorHistorial) — reutiliza la vista de tarjetas existente, NO se creó una segunda versión', () => {
  it('sigue siendo la única función con este nombre — la tarjeta ahora incluye Turno, Cantidad, Lubricador y Validación', () => {
    expect(misEngrasesSrc).toContain('class="lub-record-card"');
    expect(misEngrasesSrc).toContain('Turno ${r.shiftId');
    expect(misEngrasesSrc).toContain('${fmt(r.qty, 1)} ${GREASE_UNIT}');
    expect(misEngrasesSrc).toContain('${esc(r.userName)}');
    expect(misEngrasesSrc).not.toContain('<table');
  });

  it('ordena por más reciente primero (sin tocar ese sort)', () => {
    expect(misEngrasesSrc).toContain("(a, b) => new Date(b.date) - new Date(a.date)");
  });

  it('estado de validación real vía validationStatusForRecord() (respeta el baseline histórico), nunca validationStatusFor() directo', () => {
    expect(misEngrasesSrc).toContain('validationStatusForRecord(r, validations, ahora, App.generalSettings)');
    expect(misEngrasesSrc).not.toContain('validationStatusFor(r.id, validations)');
  });

  it('acción por estado: Pendiente→Validar, 1 activa→Ver validación, 2+→Ver conflicto, Histórico→SIN botón; Vencida SIGUE pudiendo validarse (regla de doble turno: no se oculta por antigüedad)', () => {
    expect(misEngrasesSrc).toContain('lub-validar-btn');
    expect(misEngrasesSrc).toContain('lub-ver-validacion-btn');
    expect(misEngrasesSrc).toContain('lub-ver-conflicto-btn');
    expect(misEngrasesSrc).toMatch(/valStatus === VALIDATION_STATUS\.HISTORICO \? '' :/);
  });

  it('"Validar ahora" desde Mis Engrases reutiliza openValidationModal() real (mismo modal que Historial/Dashboard)', () => {
    expect(misEngrasesSrc).toContain('openValidationModal(rec, eq, () => renderLubricadorHistorial())');
  });
});

describe('Historial (drawHistory) y Dashboard respetan el baseline histórico — nunca exigen firma a un engrase antiguo', () => {
  it('drawHistory() usa validationStatusForRecord() y SOLO oculta el botón cuando el estado es HISTORICO (Vencida sigue siendo validable, ver regla E de doble turno — no desaparece por antigüedad)', () => {
    expect(historialTableSrc).toContain('validationStatusForRecord(r, validations, ahoraValHist, App.generalSettings)');
    expect(historialTableSrc).toMatch(/valStatus === VALIDATION_STATUS\.HISTORICO \? '' :/);
  });

  it('Dashboard "Pendientes de validación" usa isRecordPendingValidation() (excluye histórico y vencidas), no un filtro manual de 0 activas', () => {
    expect(dashSrc).toContain('isRecordPendingValidation(r, validations, ahoraValidacion, App.generalSettings)');
    expect(dashSrc).not.toContain('findActiveValidations(r.id, validations).length === 0');
  });
});

describe('Bug de tono encontrado y corregido: CONFLICTO (red) ya no comparte clase CSS con HISTÓRICO/neutral', () => {
  it('validationBadgeHTML() mapea el tono "red" a hist-compliance-alert (distinto de hist-compliance-neutral)', () => {
    expect(validationBadgeSrc).toContain("red: 'hist-compliance-alert'");
  });
});
