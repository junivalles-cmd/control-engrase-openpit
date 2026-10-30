// tests/unit/print-grease-plan-domingo.test.js
//
// printGreasePlan() (Plan de Engrase imprimible) trataba el domingo distinto
// de Lunes–Sábado: una sola columna combinada ("ENGRASE A FLOTA DE
// VOLQUETES") para toda la tabla, en vez de una celda por equipo. El usuario
// confirmó (2026-10-02) que sí se engrasa domingo igual que el resto de la
// semana — se corrige para que domingo sea un día más, con la MISMA lógica
// `celda()`/`estabaProgramado()` que ya usan los otros 6 días (genérica por
// `WEEKDAY_NAMES[fecha.getDay()]`, sin caso especial nuevo). Prueba a nivel
// de FUENTE (función de impresión, sin DOM real — mismo criterio que
// dashboard-carryover.test.js para este tipo de cambio).

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'printGreasePlan');

describe('printGreasePlan() — domingo es un día más, igual que Lunes-Sábado', () => {
  // Desde "CONFIGURACIÓN ADMINISTRADOR SEMANA OPERATIVA" (2026-10-30):
  // DIAS_SEMANA/el cálculo manual de `fin` se reemplazaron por
  // getOperationalWeekDays()/getOperationalWeekStart() (src/core/operational-week.js)
  // — igual que renderMatrizSemanal(), siguen siendo 7 días completos
  // (nunca 6), solo que el ORDEN ahora lo decide Configuración → Operación
  // en vez de ser lunes-fijo.
  it('ya no existe DIAS_SEMANA (lunes-fijo) — usa getOperationalWeekDays() real', () => {
    expect(src).not.toContain('DIAS_SEMANA');
    expect(src).toContain('getOperationalWeekDays(hoy, App.generalSettings)');
    expect(src).toContain('getOperationalWeekDays(inicio, App.generalSettings)');
    expect(src).toContain('getOperationalWeekDays(cursor, App.generalSettings)');
  });

  it('la semana sigue siendo de 7 días completos (dias0[6], no dias0[5]) — nunca se recorta a 6', () => {
    expect(src).toContain('const dias0 = getOperationalWeekDays(hoy, App.generalSettings);');
    expect(src).toContain('inicio = dias0[0]; fin = dias0[6];');
    expect(src).not.toContain('dias0[5]');
  });

  it('ya NO existe la columna combinada "ENGRASE A FLOTA DE VOLQUETES" ni el caso especial domingo-h/rowspan', () => {
    expect(src).not.toContain('ENGRASE A FLOTA DE VOLQUETES');
    expect(src).not.toContain('domingo-h');
    expect(src).not.toContain('rowspan');
  });

  it('la cabecera de cada tabla usa fechas.length (dinámico), no un colspan fijo en 8', () => {
    expect(src).toContain('colspan="${fechas.length + 1}"');
    expect(src).not.toContain('colspan="8"');
  });

  it('cada fila usa una sola pasada por fechas y conserva el contexto de turno cuando se imprime una vista por turno', () => {
    const iTbody = src.indexOf('<tbody>');
    const iFinTabla = src.indexOf('</table>', iTbody);
    const tbodySrc = src.slice(iTbody, iFinTabla);
    expect(tbodySrc).toContain('${fechas.map(d => celda(eq, plan, d, listaEquipos.shiftId || null)).join(\'\')}');
    // Antes había una 2da ocurrencia de fechas.map SOLO para Lun-Sáb seguida
    // de una celda domingo aparte — ahora hay una única pasada por fila.
    expect((tbodySrc.match(/fechas\.map/g) || []).length).toBe(1);
  });
});
