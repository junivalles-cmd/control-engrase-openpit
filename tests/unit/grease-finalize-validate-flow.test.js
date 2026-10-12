// tests/unit/grease-finalize-validate-flow.test.js
//
// LOTE — "Validación inmediata o diferida": Finalizar engrase SIEMPRE guarda
// primero el lubrication_record; la firma (grease_validations) es opcional
// en el momento ("Validar ahora" / "Validar después"). Prueba a nivel de
// fuente (mismo criterio que dashboard-operativo.test.js/
// dashboard-sin-plan.test.js): startGreaseFlow()/renderDashboard() tienen
// muchas dependencias de DOM/IndexedDB que no aportan a confirmar esta
// lógica puntual — se verifica el texto real de la función, no una
// reimplementación. El comportamiento de 0/1/2+ activas en sí (conflicto)
// ya está cubierto en tests/unit/grease-validation.test.js — aquí solo se
// confirma que el flujo de Finalizar/Validar diferido sigue apoyándose en
// esas mismas funciones puras, sin inventar un estado paralelo.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const flowSrc = extractDeclaration(appSource, 'startGreaseFlow');
const dashSrc = extractDeclaration(appSource, 'renderDashboard');
const pendienteRowSrc = extractDeclaration(appSource, 'pendienteValidacionRowHTML');
const detailModalSrc = extractDeclaration(appSource, 'openValidationDetailModal');
const conflictModalSrc = extractDeclaration(appSource, 'openValidationConflictModal');
const validationModalSrc = extractDeclaration(appSource, 'openValidationModal');
const onSyncStateChangeSrc = extractDeclaration(appSource, 'onSyncStateChange');
const startLubricadorGreaseFlowSrc = extractDeclaration(appSource, 'startLubricadorGreaseFlow');
const irAMisEngrasesSrc = extractDeclaration(appSource, 'irAMisEngrasesTrasRegistrar');
const bootLubricadorSrc = extractDeclaration(appSource, 'bootLubricador');
const logoutSrc = extractDeclaration(appSource, 'logout');

describe('Finalizar engrase — guarda SIEMPRE el lubrication_record primero, la validación es opcional en el momento', () => {
  it('el record y su intent RPC se persisten atómicamente ANTES de ofrecer Validar ahora/después', () => {
    const iPut = flowSrc.indexOf("await queueLubricationExecution({ action: 'CREATE', record,");
    const iChoice = flowSrc.indexOf('grease-validate-now-btn');
    expect(iPut).toBeGreaterThan(-1);
    expect(iChoice).toBeGreaterThan(-1);
    expect(iPut).toBeLessThan(iChoice);
  });

  it('"Validar ahora" abre el MISMO modal real (openValidationModal) sobre el record/equipment recién creados, sin crear otro lubrication_record', () => {
    expect(flowSrc).toContain("$('#grease-validate-now-btn')?.addEventListener('click', () => {");
    expect(flowSrc).toContain('openValidationModal(record, equipment, irAMisEngrasesTrasRegistrar);');
    // No hay un segundo `uid('greg')` ni un segundo DB.put('lubrication_records' en esta función
    expect(flowSrc.match(/uid\('greg'\)/g) || []).toHaveLength(1);
    expect(flowSrc.match(/queueLubricationExecution\(/g) || []).toHaveLength(1);
    expect(flowSrc).not.toContain("DB.put('lubrication_records'");
  });

  it('"Validar después" solo navega (a Mis Engrases, ver irAMisEngrasesTrasRegistrar) — NO crea ningún grease_validation ni otro registro', () => {
    expect(flowSrc).toContain("$('#grease-validate-later-btn')?.addEventListener('click', irAMisEngrasesTrasRegistrar);");
    expect(flowSrc).not.toContain("DB.put('grease_validations'");
  });

  it('guarda contra doble click/doble submit: flag + botón deshabilitado antes de procesar, nunca duplica el lubrication_record', () => {
    expect(flowSrc).toContain('let enviandoEngrase = false;');
    expect(flowSrc).toContain('if (enviandoEngrase) return;');
    expect(flowSrc).toContain('enviandoEngrase = true;');
    expect(flowSrc).toContain("$('.btn-grease-submit').disabled = true;");
  });

  it('el botón se reactiva en cualquier salida (try/finally) — un error de validación no deja el formulario bloqueado para siempre', () => {
    expect(flowSrc).toContain('} finally {');
    expect(flowSrc).toContain('enviandoEngrase = false;');
    expect(flowSrc).toContain("const btnSubmit = $('.btn-grease-submit');");
  });

  it('el texto de confirmación es el pedido y no confunde con "validado"', () => {
    expect(flowSrc).toContain('Engrase registrado correctamente');
    expect(flowSrc).not.toContain('Validado correctamente');
  });
});

describe('BUG-CRÍTICO fix — un sync automático NO debe borrar el flujo de Registrar Engrase en curso ni su confirmación', () => {
  // Causa real: startLubricadorGreaseFlow() nunca cambia App.route (se queda en
  // 'turno', que SÍ está en pantallasQueSeRefrescan). Un sync de fondo (cada
  // 20s/reconexión/volver a la app) que trajera CUALQUIER cambio de CUALQUIER
  // parte del sistema disparaba redibujarPantallaActual() → renderLubricadorHome(),
  // reemplazando #app-content entero mientras el formulario o la pantalla
  // "Validar ahora/después" seguían visibles — la persona veía "Mi Turno" en vez
  // de su confirmación y, creyendo que no se guardó, repetía la operación
  // (2 lubrication_record). El guardado en sí ya era idempotente (enviandoEngrase,
  // ver describe de arriba); lo que fallaba era que la UI de confirmación
  // desaparecía antes de que la persona la viera.
  it('startLubricadorGreaseFlow() no cambia App.route (se queda en "turno")', () => {
    expect(startLubricadorGreaseFlowSrc).not.toMatch(/App\.route\s*=/);
  });

  it('onSyncStateChange() ya NO redibuja si hay un #grease-form abierto (defensa secundaria DOM)', () => {
    expect(onSyncStateChangeSrc).toContain("!document.querySelector('#grease-form')");
  });

  it('onSyncStateChange() ya NO redibuja si está mostrando la pantalla "Validar ahora/después" (.grease-validate-choice) (defensa secundaria DOM)', () => {
    expect(onSyncStateChangeSrc).toContain("!document.querySelector('.grease-validate-choice')");
  });

  it('sigue respetando el guard previo de modal abierto (no se quitó protección existente)', () => {
    expect(onSyncStateChangeSrc).toContain("!document.querySelector('#modal-overlay.open')");
  });

  it('"turno" sigue en la lista de pantallas que se refrescan (no se resolvió ocultando el síntoma con un parche ahí)', () => {
    expect(onSyncStateChangeSrc).toContain("'turno'");
  });

  it('ENDURECIDO: la fuente PRINCIPAL ahora es el estado explícito App.lubricadorGreaseFlowActive, no un selector DOM', () => {
    expect(onSyncStateChangeSrc).toContain('!App.lubricadorGreaseFlowActive');
  });

  it('startLubricadorGreaseFlow() enciende App.lubricadorGreaseFlowActive al entrar al flujo', () => {
    expect(startLubricadorGreaseFlowSrc).toContain('App.lubricadorGreaseFlowActive = true;');
  });

  it('"← Volver a mi turno" (cancelación explícita) apaga App.lubricadorGreaseFlowActive', () => {
    expect(startLubricadorGreaseFlowSrc).toMatch(/lub-back[\s\S]*App\.lubricadorGreaseFlowActive = false/);
  });

  it('irAMisEngrasesTrasRegistrar() (destino SIEMPRE correcto tras terminar) apaga App.lubricadorGreaseFlowActive', () => {
    expect(irAMisEngrasesSrc).toContain('App.lubricadorGreaseFlowActive = false;');
  });

  it('App.lubricadorGreaseFlowActive existe como campo inicial (false) en App, no se crea implícito', () => {
    const appDecl = extractDeclaration(appSource, 'App');
    expect(appDecl).toContain('lubricadorGreaseFlowActive: false');
  });

  // AUDITORÍA DE LIFECYCLE (cierre final): la barra inferior del Lubricador
  // (.lub-bottom-nav) vive FUERA de #app-content — nunca se borra al entrar a
  // Registrar Engrase — así que tocar Mi Turno/Anomalías/Mis Engrases/Ayuda
  // mientras el flujo está activo era una salida real que el flag no detectaba,
  // dejándolo en `true` para siempre y bloqueando el auto-refresh de esas
  // pantallas hasta recargar la app entera.
  it('bootLubricador(): tocar cualquier ítem de la barra inferior apaga el flag (salida explícita a otra sección)', () => {
    expect(bootLubricadorSrc).toMatch(/lub-nav-item[\s\S]*App\.lubricadorGreaseFlowActive = false/);
  });

  it('el reset de la barra inferior ocurre ANTES de despachar a la pantalla elegida (nunca dispara redraw con el flag todavía en true)', () => {
    const i = bootLubricadorSrc.indexOf('App.lubricadorGreaseFlowActive = false');
    const iDispatch = bootLubricadorSrc.indexOf("if (b.dataset.route === 'turno')");
    expect(i).toBeGreaterThan(-1);
    expect(iDispatch).toBeGreaterThan(-1);
    expect(i).toBeLessThan(iDispatch);
  });

  it('logout() también apaga el flag — no debe sobrevivir a la sesión siguiente en la misma pestaña', () => {
    expect(logoutSrc).toContain('App.lubricadorGreaseFlowActive = false;');
  });

  it('un guardado fallido de ENGRASE (alert + return dentro del try) NO apaga el flag — el usuario sigue en el mismo formulario y puede reintentar', () => {
    // El bloque catch/return del guardado del engrase nunca toca
    // App.lubricadorGreaseFlowActive — se apaga en 5 salidas reales: Mis
    // Engrases, "Volver", barra inferior, logout (verificadas arriba) y,
    // desde el lote occurrences/carryover, también "No se pudo ejecutar"
    // (openNoExecutionForm(), ver el test siguiente) — pero NUNCA desde el
    // catch de guardado fallido de un engrase en sí.
    // Ancla en el comentario único de ESTE catch (no el de openNoExecutionForm,
    // que también usa "catch (err)" pero para un error de validación distinto).
    const iCatch = flowSrc.indexOf("console.error('Fallo al guardar el engrase', err);");
    const iReturn = flowSrc.indexOf('return;', iCatch);
    expect(iCatch).toBeGreaterThan(-1);
    expect(iReturn).toBeGreaterThan(iCatch);
    const catchBlock = flowSrc.slice(iCatch, iReturn);
    expect(catchBlock).not.toMatch(/lubricadorGreaseFlowActive/);
  });

  it('"No se pudo ejecutar" (openNoExecutionForm, lote occurrences/carryover §1) es la 5ª salida real: apaga el flag SOLO después de guardar el lubrication_skips con éxito', () => {
    const iFn = flowSrc.indexOf('function openNoExecutionForm');
    expect(iFn).toBeGreaterThan(-1);
    const noExecSrc = flowSrc.slice(iFn);
    const iPutSkip = noExecSrc.indexOf("await DB.put('lubrication_skips'");
    const iFlagOff = noExecSrc.indexOf('App.lubricadorGreaseFlowActive = false;');
    expect(iPutSkip).toBeGreaterThan(-1);
    expect(iFlagOff).toBeGreaterThan(iPutSkip);
  });

  it('cancelar/cerrar el modal de validación sin firmar NO llama a onDone() (irAMisEngrasesTrasRegistrar) — la pantalla "Validar ahora/después" sigue activa, el flag no se toca ahí', () => {
    // onDone() solo se invoca tras un DB.put('grease_validations', ...) + closeModal()
    // exitosos — nunca desde un cierre/cancelación del modal.
    const iPut = validationModalSrc.indexOf('await queueGreaseValidation(validation, record);');
    const iOnDone = validationModalSrc.indexOf('if (onDone) onDone();');
    expect(iPut).toBeGreaterThan(-1);
    expect(iOnDone).toBeGreaterThan(-1);
    expect(iPut).toBeLessThan(iOnDone);
    expect(validationModalSrc.match(/onDone\(\)/g) || []).toHaveLength(1);
  });
});

describe('Validar después — el pendiente sobrevive el cierre del flujo, se puede validar horas/días/turnos después', () => {
  it('"Pendientes de validación" del Dashboard ya NO se acota a "hoy" (recordsParaValidacion, sin filtro de fecha) — un pendiente de ayer sigue apareciendo', () => {
    expect(dashSrc).toContain('const recordsParaValidacion = records.filter(r => equipoIdsFiltrados.has(r.equipmentId));');
    expect(dashSrc).toContain('const recordsPendientesValidacion = recordsParaValidacion');
    expect(dashSrc).not.toContain('const recordsPendientesValidacion = recordsHoy.filter');
  });

  it('sigue derivando el estado SOLO de grease_validations (isRecordPendingValidation → findActiveValidations), nunca de un campo guardado en el record', () => {
    expect(dashSrc).toContain('isRecordPendingValidation(r, validations, ahoraValidacion, App.generalSettings)');
  });

  it('ordena por más antiguo pendiente primero', () => {
    expect(dashSrc).toContain('.sort((a, b) => new Date(a.date) - new Date(b.date))');
  });

  it('"Pendientes del turno actual" es un subconjunto informativo por shiftId, no reemplaza ni filtra la lista completa', () => {
    expect(dashSrc).toContain('const pendientesTurnoActual = recordsPendientesValidacion.filter(r => r.shiftId === currentShiftId());');
  });

  it('no existe ninguna regla que bloquee el cierre de turno por tener pendientes (no se agregó ese gate)', () => {
    expect(dashSrc).not.toMatch(/bloque(a|ar).*turno|turno.*bloque(a|ar)/i);
  });
});

describe('Fecha del engrase vs. fecha de validación — siempre separadas, signedAt es la hora REAL de la firma', () => {
  it('el modal de detalle muestra "Fecha/hora del engrase" (recordDate) Y "Fecha/hora de la validación" (signedAt) como filas DISTINTAS', () => {
    expect(detailModalSrc).toContain('Fecha/hora del engrase');
    expect(detailModalSrc).toContain('Fecha/hora de la validación');
    expect(detailModalSrc).toContain('${fmtDate(recordDate)}');
    expect(detailModalSrc).toContain('${fmtDate(validation.signedAt)}');
  });

  it('el modal de conflicto también distingue la fecha del engrase de la fecha de cada firma', () => {
    expect(conflictModalSrc).toContain('Fecha/hora del engrase');
    expect(conflictModalSrc).toContain('<span>Fecha/hora</span>'); // por firma, sigue siendo signedAt
  });

  it('la fila de "Pendientes de validación" en el Dashboard muestra la fecha del ENGRASE (r.date), no una fecha de validación inexistente', () => {
    expect(pendienteRowSrc).toContain('fmtDate(r.date)');
  });

  it('mismo lubricationRecordId siempre — la validación posterior nunca crea otro lubrication_record, reutiliza el id original', () => {
    expect(flowSrc).toContain('openValidationModal(record, equipment');
    expect(validationModalSrc).toContain('lubricationRecordId: record.id');
  });

  it('signedAt usa la hora REAL en que se firma (nowISO() al confirmar), nunca la fecha del engrase (record.date)', () => {
    expect(validationModalSrc).toContain('signedAt: nowISO(),');
    expect(validationModalSrc).not.toContain('signedAt: record.date');
  });
});
