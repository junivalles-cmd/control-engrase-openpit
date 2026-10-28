// tests/unit/lub02-checklist-unchecked-default.test.js
//
// LUB-02 — "Los puntos de un engrase NUEVO deben iniciar desmarcados, no
// todos marcados." Prueba a nivel de fuente (mismo criterio que
// grease-finalize-validate-flow.test.js/registrar-engrase-inicial.test.js):
// startGreaseFlow() tiene muchas dependencias de DOM/IndexedDB que no aportan
// a confirmar esta lógica puntual — se verifica el texto real de la función,
// no una reimplementación.
//
// Causa raíz: el <input type="checkbox" class="chk-done" checked/> del
// template llevaba `checked` fijo para TODOS los puntos, sin importar si el
// engrase es nuevo o si se está reanudando un borrador — el progreso inicial
// también quedaba hardcodeado a "N de N" (100%). Fix: el checkbox nace sin
// `checked` (desmarcado) y el progreso inicial nace en "0 de N" / 0% — el
// estado real (marcar/desmarcar, reanudar borrador, "Marcar todos") sigue
// viviendo en el DOM/borrador, nunca en el template.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const flowSrc = extractDeclaration(appSource, 'startGreaseFlow');
const onSyncStateChangeSrc = extractDeclaration(appSource, 'onSyncStateChange');

describe('1. Nuevo engrase -> todos los puntos nacen desmarcados, progreso inicial 0/N', () => {
  it('el checkbox de cada punto ya NO lleva `checked` fijo en el template', () => {
    expect(flowSrc).toContain('<input type="checkbox" class="chk-done"/>');
    expect(flowSrc).not.toMatch(/class="chk-done"\s+checked\s*\/>/);
  });

  it('la barra/texto de progreso inicial nace en 0%, no en 100%', () => {
    expect(flowSrc).toContain('style="width:0%"');
    expect(flowSrc).toContain('0 de ${points.length} puntos marcados');
    expect(flowSrc).not.toContain('style="width:100%"');
    expect(flowSrc).not.toContain('${points.length} de ${points.length} puntos marcados');
  });

  it('el <select> de motivo ("Por qué no se realizó") nace visible (sin .hidden) — coherente con que el punto nace desmarcado', () => {
    expect(flowSrc).toContain('<select class="chk-reason">');
    expect(flowSrc).not.toContain('<select class="chk-reason hidden">');
  });

  it('el flujo de edición de un registro YA GUARDADO (pantalla distinta, usa d.done real) no se tocó', () => {
    // Ese checklist vive fuera de startGreaseFlow() y ya era correcto (data-driven) — confirma que el fix de LUB-02 no lo rozó.
    expect(appSource).toContain("done: item.querySelector('.chk-done').checked,");
  });
});

describe('2. Marcar/desmarcar mantiene el progreso actual (se calcula del DOM real, nunca del template)', () => {
  it('updateProgress() cuenta los .chk-done REALMENTE marcados en el DOM, no un valor fijo', () => {
    expect(flowSrc).toContain("const total = $$('.chk-done').length;");
    expect(flowSrc).toContain("const done = $$('.chk-done').filter(c => c.checked).length;");
    expect(flowSrc).toContain("text.textContent = `${done} de ${total} puntos marcados`;");
  });

  it('cada checkbox dispara updateProgress() en su propio evento "change" (no hay que refrescar nada más)', () => {
    const i = flowSrc.indexOf("$$('.chk-done').forEach(chk => {");
    expect(i).toBeGreaterThan(-1);
    const wireBlock = flowSrc.slice(i, flowSrc.indexOf('});', i) + 3);
    expect(wireBlock).toContain("sel.classList.toggle('hidden', e.target.checked);");
    expect(wireBlock).toContain('updateProgress();');
  });
});

describe('3/4. "Marcar todos" sigue existiendo, solo por acción explícita, con confirm() real (y cancelar no mueve nada)', () => {
  it('"Marcar todos" sigue pidiendo confirm() antes de marcar cualquier punto', () => {
    const i = flowSrc.indexOf("$('#btn-check-all')?.addEventListener('click', () => {");
    expect(i).toBeGreaterThan(-1);
    const block = flowSrc.slice(i, flowSrc.indexOf('});', i) + 3);
    expect(block).toContain('if (!confirm(');
    expect(block.indexOf('if (!confirm(')).toBeLessThan(block.indexOf('chk.checked = true;'));
  });

  it('cancelar el confirm() (return antes de la mutación) no marca ningún punto — el `return` está ANTES de tocar `chk.checked`', () => {
    const i = flowSrc.indexOf("$('#btn-check-all')?.addEventListener('click', () => {");
    const block = flowSrc.slice(i, flowSrc.indexOf('});', i) + 3);
    const iConfirm = block.indexOf('if (!confirm(');
    const iReturn = block.indexOf('return;', iConfirm);
    const iMutate = block.indexOf('chk.checked = true;');
    expect(iConfirm).toBeGreaterThan(-1);
    expect(iReturn).toBeGreaterThan(iConfirm);
    expect(iReturn).toBeLessThan(iMutate);
  });

  it('si ya estaban todos marcados, no pide confirm() de nuevo (atajo ya existente, sin cambios)', () => {
    expect(flowSrc).toContain('if (puntos.every(c => c.checked)) return;');
  });
});

describe('5. Reanudar un borrador existente preserva su estado guardado — nunca lo resetea', () => {
  it('restoreDraftIntoForm() escribe el checked/reason REAL guardado por punto, nunca un valor fijo', () => {
    // Función anidada dentro de startGreaseFlow() (no top-level) — se recorta de flowSrc, no de appSource.
    const i = flowSrc.indexOf('function restoreDraftIntoForm(d) {');
    expect(i).toBeGreaterThan(-1);
    const src = flowSrc.slice(i, flowSrc.indexOf('function wireGreaseForm()', i));
    expect(src).toContain('chk.checked = entry.checked;');
    expect(src).toContain("sel.classList.toggle('hidden', entry.checked);");
  });

  it('la restauración es por acción EXPLÍCITA ("Continuar" del borrador) — nunca automática al abrir la pantalla', () => {
    // El checklist nace desmarcado (parte 1) incluso cuando existe un borrador;
    // solo #btn-restore-draft aplica restoreDraftIntoForm() sobre el form.
    expect(flowSrc).toContain("$('#btn-restore-draft')?.addEventListener('click', () => {");
    const i = flowSrc.indexOf("$('#btn-restore-draft')?.addEventListener('click', () => {");
    const block = flowSrc.slice(i, flowSrc.indexOf('});', i) + 3);
    expect(block).toContain('restoreDraftIntoForm(draft);');
    // updateProgress() se llama DESPUÉS de restaurar, para que la barra refleje el estado restaurado (no el 0/N inicial del template).
    expect(block.indexOf('restoreDraftIntoForm(draft);')).toBeLessThan(block.indexOf('updateProgress();'));
  });

  it('collectDraftState() (autoguardado) lee el checked/reason REAL del DOM en cada guardado — nunca asume "todo marcado"', () => {
    // También anidada dentro de startGreaseFlow().
    const i = flowSrc.indexOf('function collectDraftState() {');
    expect(i).toBeGreaterThan(-1);
    const src = flowSrc.slice(i, flowSrc.indexOf('let draftSaveTimer', i));
    expect(src).toContain("checked: item.querySelector('.chk-done').checked,");
    expect(src).toContain("reason: item.querySelector('.chk-reason').value || ''");
  });
});

describe('6. Sin conexión, la selección del checklist no se pierde — ningún redraw de sync la resetea', () => {
  it('onSyncStateChange() no redibuja mientras el formulario de engrase está abierto (App.lubricadorGreaseFlowActive + guard DOM)', () => {
    expect(onSyncStateChangeSrc).toContain('!App.lubricadorGreaseFlowActive');
    expect(onSyncStateChangeSrc).toContain("!document.querySelector('#grease-form')");
  });

  it('el autoguardado de borrador (scheduleDraftSave) se dispara por "input"/"change" del propio form, nunca depende de que haya red', () => {
    expect(flowSrc).toContain("$('#grease-form').addEventListener('input', scheduleDraftSave);");
    expect(flowSrc).toContain("$('#grease-form').addEventListener('change', scheduleDraftSave);");
  });
});

describe('7. Finalizar con puntos pendientes — comportamiento actual documentado, SIN CAMBIOS', () => {
  it('cada punto desmarcado exige un motivo antes de poder finalizar (regla existente, intacta)', () => {
    expect(flowSrc).toContain("const incomplete = $$('.checklist-item').filter(item => !item.querySelector('.chk-done').checked);");
    expect(flowSrc).toContain('Selecciona el motivo de "No realizado" para: ');
  });

  it('un checklist 100% completo sigue exigiendo cantidad de grasa > 0 lb (shouldBlockCompleteChecklistWithoutGrease, sin cambios)', () => {
    expect(flowSrc).toContain('shouldBlockCompleteChecklistWithoutGrease(totalPuntosChecklist, incomplete.length, qtyIngresada)');
    const fnSrc = extractDeclaration(appSource, 'shouldBlockCompleteChecklistWithoutGrease');
    expect(fnSrc).toContain('return incompleteCount === 0 && !(qty > 0);');
  });
});
