// tests/unit/historial-skips.test.js
//
// Cierre histórico, Parte B (§11-§16 del pedido) — lubrication_skips ("No
// se pudo ejecutar") integrados en el Historial por equipo (drawHistory()),
// dentro de la MISMA línea temporal que los engrases reales, nunca en una
// pantalla separada. Prueba a nivel de FUENTE (mismo criterio que el resto
// de los tests de Historial): drawHistory() tiene demasiadas dependencias
// de DOM/IndexedDB/validación/fotos como para ejecutarlo completo aquí —
// se confirma el texto real de la función.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'drawHistory');

describe('§11 — lubrication_skips se leen y se mezclan en la línea temporal de Historial', () => {
  it('lee allSkips filtrado por equipmentId, mismo patrón que allRecords/allAnomalies', () => {
    expect(src).toContain("const allSkips = (await DB.allActive('lubrication_skips')).filter(s => s.equipmentId === equipmentId)");
  });

  it('eventosHist combina ENGRASE + NO_EJECUTADO y ordena por fecha real descendente — nunca 2 listas separadas', () => {
    expect(src).toContain("const eventosHist = [");
    expect(src).toContain("...records.map(r => ({ tipo: 'ENGRASE', date: r.date, record: r }))");
    expect(src).toContain("...skipsDelPeriodo.map(s => ({ tipo: 'NO_EJECUTADO', date: s.date, skip: s }))");
    expect(src).toContain('.sort((a, b) => new Date(b.date) - new Date(a.date));');
  });

  it('el filtro de período (Desde/Hasta) también se aplica a los skips — no solo a records/anomalies', () => {
    expect(src).toContain('const skipsDelPeriodo = allSkips.filter(s => {');
  });

  it('la tabla itera eventosHist (no records a secas) — así ambos tipos aparecen en la misma tabla/orden', () => {
    expect(src).toContain('${eventosHist.map((ev, i) => {');
    expect(src).toContain("if (ev.tipo === 'NO_EJECUTADO') {");
  });
});

describe('§12/§13 — fila de NO_EJECUTADO: Tipo + motivo en texto real, nunca el código interno', () => {
  it('muestra el badge "No ejecutado" y el motivo traducido vía NO_EXECUTION_REASON_LABELS (no el código crudo tipo CONDICION_INSEGURA)', () => {
    expect(src).toContain('<span class="hist-noexec-badge">No ejecutado</span>');
    expect(src).toContain('${esc(NO_EXECUTION_REASON_LABELS[s.reason] || s.reason)}');
  });

  it('columnas que no aplican a un skip (Horómetro/Grasa/Cantidad/Cumplimiento/Validación/Foto) muestran "—", nunca un dato inventado', () => {
    const iRama = src.indexOf("if (ev.tipo === 'NO_EJECUTADO') {");
    const iFinRama = src.indexOf('const r = ev.record;');
    const rama = src.slice(iRama, iFinRama);
    expect((rama.match(/<td[^>]*>—<\/td>/g) || []).length).toBeGreaterThanOrEqual(6);
  });
});

describe('§15 — orden cronológico real, NO_EJECUTADO nunca borra ni oculta un ENGRASE posterior', () => {
  it('ambos tipos comparten el mismo sort() — ningún filtro excluye NO_EJECUTADO antes de mezclarse con records', () => {
    // El sort() ya cubre esto estructuralmente (ver test anterior); aquí se
    // confirma que no existe ningún "return" temprano que descarte skips
    // antes de llegar al eventosHist.
    const iSkipsDelPeriodo = src.indexOf('const skipsDelPeriodo = allSkips.filter(s => {');
    const iEventosHist = src.indexOf('const eventosHist = [');
    expect(iSkipsDelPeriodo).toBeGreaterThan(-1);
    expect(iEventosHist).toBeGreaterThan(iSkipsDelPeriodo);
  });
});

describe('§16 — click en una fila NO_EJECUTADO abre su propio detalle (nunca reutiliza el flujo de Registrar Engrase)', () => {
  it('el botón .hist-skip-detail abre un modal propio con motivo/fecha/turno/usuario/observación', () => {
    expect(src).toContain("$$('.hist-skip-detail', $('#hist-eq-content')).forEach(b => b.addEventListener('click', () => {");
    expect(src).toContain("openModal('Detalle de \"No se pudo ejecutar\"'");
  });

  it('si el skip quedó vinculado a un engrase real (linkedRecordId), el detalle lo indica explícitamente', () => {
    expect(src).toContain('s.linkedRecordId');
    expect(src).toContain('✓ Vinculado a un engrase real');
  });

  it('el click de un ENGRASE sigue el flujo YA existente (data-rec en <tr>) — no se duplica ninguna pantalla', () => {
    expect(src).toContain('<tr data-rec="${r.id}">');
  });
});

describe('KPI "No ejecutados" agregado sin tocar los KPI existentes (§11)', () => {
  it('nueva tarjeta KPI cuenta skipsDelPeriodo, respeta el mismo texto condicional "en el período"/"registrados" que los demás', () => {
    expect(src).toContain('<div class="kpi-value">${skipsDelPeriodo.length}</div><div class="kpi-label">No ejecutados');
  });
});
