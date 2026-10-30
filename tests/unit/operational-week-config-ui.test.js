// tests/unit/operational-week-config-ui.test.js
//
// "CONFIGURACIÓN ADMINISTRADOR PARA CAMBIAR LOS DÍAS DE LA SEMANA
// OPERATIVA" — prueba por patrón de fuente (mismo método que
// tests/unit/config-categories.test.js) las partes de renderConfig() y de
// las pantallas semanales que requieren DB/App/DOM reales:
//   A) El panel "Semana operativa" vive en Configuración → Operación,
//      deshabilitado para quien no es ADMINISTRADOR (Planificador/
//      Supervisor ven el valor, no lo pueden tocar).
//   B) El submit guarda en settings/general (mismo documento/mecanismo
//      de sincronización que el resto de App.generalSettings), audita,
//      recarga App.generalSettings y sólo escribe si el valor cambió.
//   C) Las 5 pantallas semanales (Plan/impresión, Matriz Semanal, Ficha,
//      Dashboard, modal de Lubricador) y el filtro nuevo de Historial
//      usan los helpers reales de operational-week.js — nunca un cálculo
//      de "lunes fijo" propio.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const renderConfigSrc = extractDeclaration(appSource, 'renderConfig');
const renderMatrizSemanalSrc = extractDeclaration(appSource, 'renderMatrizSemanal');
const printGreasePlanSrc = extractDeclaration(appSource, 'printGreasePlan');
const openLubricadorMatrizModalSrc = extractDeclaration(appSource, 'openLubricadorMatrizModal');
const renderHistorialSrc = extractDeclaration(appSource, 'renderHistorial');

describe('A) Panel "Semana operativa" en Configuración → Operación', () => {
  it('vive dentro de config-cat-operacion, con el <select> de 7 días y la <input type="time"> de corte', () => {
    const operacionMatch = renderConfigSrc.match(/config-cat-operacion[\s\S]*?config-cat-organizacion/);
    expect(operacionMatch).not.toBeNull();
    const block = operacionMatch[0];
    expect(block).toContain('Semana operativa');
    expect(block).toContain('id="opweek-start-day"');
    expect(block).toContain('name="operationalWeekStartDay"');
    expect(block).toContain('id="opweek-start-time"');
    expect(block).toContain('name="operationalWeekStartTime"');
    expect(block).toContain('type="time"');
  });

  it('las opciones del <select> son OPERATIONAL_WEEK_START_DAY_OPTIONS (nunca una lista hardcodeada aparte)', () => {
    expect(renderConfigSrc).toContain('OPERATIONAL_WEEK_START_DAY_OPTIONS.map(o =>');
  });

  it('deshabilita AMBOS controles para cualquiera que no sea ADMINISTRADOR (Planificador/Supervisor: solo lectura)', () => {
    const operacionMatch = renderConfigSrc.match(/id="opweek-start-day"[\s\S]{0,400}/);
    const timeMatch = renderConfigSrc.match(/id="opweek-start-time"[\s\S]{0,200}/);
    expect(operacionMatch[0]).toContain("App.currentUser.role !== 'ADMINISTRADOR' ? 'disabled' : ''");
    expect(timeMatch[0]).toContain("App.currentUser.role !== 'ADMINISTRADOR' ? 'disabled' : ''");
  });

  it('el botón "Guardar" solo se imprime para ADMINISTRADOR (Planificador/Supervisor no ven ni un botón inerte)', () => {
    const formMatch = renderConfigSrc.match(/id="operational-week-form"[\s\S]*?<\/form>/);
    expect(formMatch).not.toBeNull();
    expect(formMatch[0]).toContain("App.currentUser.role === 'ADMINISTRADOR' ? `");
    expect(formMatch[0]).toContain('Guardar semana operativa');
  });

  it('muestra una vista previa en vivo (semana actual + orden de columnas) con los helpers reales, no un cálculo de muestra aparte', () => {
    expect(renderConfigSrc).toContain('function renderOperationalWeekPreview()');
    expect(renderConfigSrc).toContain('getOperationalWeekDays(new Date(), previewConfig)');
    expect(renderConfigSrc).toContain('getOperationalWeekLabel(new Date(), previewConfig)');
    expect(renderConfigSrc).toContain("$('#opweek-start-day')?.addEventListener('change', renderOperationalWeekPreview)");
    expect(renderConfigSrc).toContain("$('#opweek-start-time')?.addEventListener('input', renderOperationalWeekPreview)");
  });
});

describe('B) Guardado — mismo mecanismo settings/general, auditoría, recarga en memoria, solo si cambia', () => {
  const formHandlerMatch = renderConfigSrc.match(/\$\('#operational-week-form'\)\.addEventListener\('submit'[\s\S]*?\n {2}\}\);/);
  const handler = formHandlerMatch ? formHandlerMatch[0] : '';

  it('existe el handler de submit del formulario', () => {
    expect(formHandlerMatch).not.toBeNull();
  });

  it('rechaza el guardado (defensa adicional a los disabled) si el rol no es ADMINISTRADOR', () => {
    expect(handler).toContain("if (App.currentUser.role !== 'ADMINISTRADOR') return;");
  });

  it('guarda DENTRO de settings/general preservando el resto del documento (nunca lo reconstruye desde cero)', () => {
    expect(handler).toContain("const current = (await DB.get('settings', 'general')) || {};");
    expect(handler).toContain('...current, id: \'general\', operationalWeekStartDay: startDay, operationalWeekStartTime: startTime');
    expect(handler).toContain("await DB.put('settings', stamp(updated, App.currentUser.name));");
  });

  it('solo escribe si el valor realmente cambió (§VALIDACIONES del pedido)', () => {
    expect(handler).toContain('startDay === App.generalSettings.operationalWeekStartDay && startTime === App.generalSettings.operationalWeekStartTime');
  });

  it('audita el cambio y recarga App.generalSettings en memoria (cambio en vivo sin cerrar sesión)', () => {
    expect(handler).toContain("logAudit('CONFIG_SEMANA_OPERATIVA_ACTUALIZADA'");
    expect(handler).toContain('await loadGeneralSettings();');
    expect(handler).toContain('renderConfig();');
  });

  it('normaliza día/hora con los validadores reales antes de guardar (nunca una config incompleta)', () => {
    expect(handler).toContain('normalizeOperationalWeekStartDay(fd.operationalWeekStartDay)');
    expect(handler).toContain('normalizeOperationalWeekStartTime(fd.operationalWeekStartTime)');
  });
});

describe('C) Pantallas semanales — usan los helpers reales de operational-week.js, nunca un cálculo de "lunes fijo" propio', () => {
  it('App.generalSettings normaliza operationalWeekStartDay/Time al cargar (loadGeneralSettings)', () => {
    const loadGeneralSettingsSrc = extractDeclaration(appSource, 'loadGeneralSettings');
    expect(loadGeneralSettingsSrc).toContain('normalizeOperationalWeekStartDay(App.generalSettings.operationalWeekStartDay)');
    expect(loadGeneralSettingsSrc).toContain('normalizeOperationalWeekStartTime(App.generalSettings.operationalWeekStartTime)');
  });

  it('Matriz Semanal: construye `dias` con getOperationalWeekDays(), nunca con un "lunes" calculado a mano', () => {
    expect(renderMatrizSemanalSrc).toContain('getOperationalWeekDays(hoy, App.generalSettings, App.matrizOffset)');
    expect(renderMatrizSemanalSrc).not.toMatch(/getDay\(\) \+ 6\) % 7/);
  });

  it('Modal de matriz del Lubricador: mismo helper, con su propio `offset`', () => {
    expect(openLubricadorMatrizModalSrc).toContain('getOperationalWeekDays(hoy, App.generalSettings, offset)');
    expect(openLubricadorMatrizModalSrc).not.toMatch(/getDay\(\) \+ 6\) % 7/);
  });

  it('Impresión del plan (semana y mes): usa getOperationalWeekDays()/getOperationalWeekStart(), encabezados derivados de WEEKDAY_NAMES[d.getDay()] (nunca un índice fijo)', () => {
    expect(printGreasePlanSrc).toContain('getOperationalWeekDays(hoy, App.generalSettings)');
    expect(printGreasePlanSrc).toContain('getOperationalWeekStart(inicio, App.generalSettings)');
    expect(printGreasePlanSrc).toContain('getOperationalWeekDays(cursor, App.generalSettings)');
    expect(printGreasePlanSrc).toContain('WEEKDAY_NAMES[d.getDay()]}<div class="fechita">');
    expect(printGreasePlanSrc).not.toMatch(/DIAS_SEMANA\[i\]/);
  });

  it('Ficha ("Semana actual"): usa getOperationalWeekDays(), ya no existe `lunesFicha` calculado a mano', () => {
    expect(appSource).toContain('const diasSemanaFicha = getOperationalWeekDays(hoyFicha, App.generalSettings);');
    expect(appSource).not.toContain('lunesFicha');
  });

  it('Historial global: filtro "Semana operativa" (gh-periodo) rellena Desde/Hasta con getOperationalWeekDays(), y editar Desde/Hasta a mano vuelve a "Personalizado"', () => {
    expect(renderHistorialSrc).toContain('id="gh-periodo"');
    expect(renderHistorialSrc).toContain('Semana operativa actual');
    expect(renderHistorialSrc).toContain('Semana operativa anterior');
    expect(renderHistorialSrc).toContain('getOperationalWeekDays(new Date(), App.generalSettings, parseInt(val, 10))');
    expect(renderHistorialSrc).toContain("$('#gh-from').addEventListener('change', () => { $('#gh-periodo').value = ''; runGeneralSearch(); });");
    expect(renderHistorialSrc).toContain("$('#gh-to').addEventListener('change', () => { $('#gh-periodo').value = ''; runGeneralSearch(); });");
  });
});

describe('Regresión — nunca reaparece un patrón de "lunes fijo" en las pantallas tocadas', () => {
  it('ninguna de las 4 pantallas/funciones reescritas vuelve a calcular el lunes a mano ((getDay()+6)%7)', () => {
    [renderMatrizSemanalSrc, openLubricadorMatrizModalSrc, printGreasePlanSrc].forEach(src => {
      expect(src).not.toMatch(/\(getDay\(\) \+ 6\) % 7/);
      expect(src).not.toMatch(/dow === 0 \? 6 : dow - 1/);
    });
  });
});
