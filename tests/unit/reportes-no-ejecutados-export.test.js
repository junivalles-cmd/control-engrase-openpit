// tests/unit/reportes-no-ejecutados-export.test.js
//
// LOTE — Exportación de "No ejecutados" en Reportes (CSV/Excel/PDF). Único
// objetivo: permitir exportar la sección "No ejecutados" (lubrication_skips)
// en los 3 formatos, respetando los MISMOS filtros del informe, sin tocar
// cumplimiento/realizados/pendientes/matriz. Extiende los exportadores
// existentes (exp-cumplimiento/exp-historico/exp-anomalias/exp-puntos y los
// handlers exp-excel/exp-pdf) en vez de crear funciones nuevas paralelas.
//
// Prueba a nivel de FUENTE (mismo criterio que reportes-rediseno.test.js):
// renderReportes() tiene demasiadas dependencias de DOM/IndexedDB/XLSX/jsPDF
// para ejecutarla completa aquí. `csvSafeField()` (protección de formula
// injection) SÍ es una función pura de nivel superior — se prueba con
// EJECUCIÓN real, no solo texto.

import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderReportes');

function loadCsvSafeField() {
  const fnSrc = extractDeclaration(appSource, 'csvSafeField');
  return new Function(`${fnSrc}\nreturn csvSafeField;`)();
}

describe('A — botón dedicado "No ejecutados (CSV)" dentro de "Más exportaciones"', () => {
  it('existe el botón con su propio id, junto a los otros CSV de un solo tema', () => {
    expect(src).toContain('id="exp-no-ejecutados"');
    expect(src).toContain('No ejecutados (CSV)');
  });

  it('el handler usa la MISMA fuente que el resto del informe (applyFiltersSkips), nunca allSkips directo ni una reconstrucción propia', () => {
    const iBtn = src.indexOf("$('#exp-no-ejecutados')");
    const iFinBtn = src.indexOf('});', iBtn);
    const btnSrc = src.slice(iBtn, iFinBtn);
    expect(btnSrc).toContain('noEjecutadosFilasDetalle(applyFiltersSkips())');
    expect(btnSrc).not.toContain('allSkips.filter');
    expect(btnSrc).not.toContain('audit_log');
  });

  it('usa downloadCSV() existente (no una función paralela) con las 12 columnas pedidas en orden', () => {
    const iBtn = src.indexOf("$('#exp-no-ejecutados')");
    const iFinBtn = src.indexOf('});', iBtn);
    const btnSrc = src.slice(iBtn, iFinBtn);
    expect(btnSrc).toContain("downloadCSV(rows, 'no_ejecutados.csv')");
    expect(btnSrc).toContain("['Fecha', 'Hora', 'Equipo', 'Modelo', 'Ubicación', 'Turno', 'Motivo', 'Observación', 'Usuario', 'Cuadrilla', 'Occurrence', 'Estado']");
  });
});

describe('B — todos los formatos filtran con applyFiltersSkips(), NUNCA lubrication_records como fuente de skips', () => {
  it('noEjecutadosFilasDetalle() recibe skipsF ya filtrado como parámetro — no vuelve a leer allSkips por su cuenta', () => {
    const iFn = src.indexOf('function noEjecutadosFilasDetalle(skipsF) {');
    expect(iFn).toBeGreaterThan(-1);
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).not.toContain('allSkips');
    expect(fnSrc).not.toContain('lubrication_records');
  });

  it('CSV, Excel y PDF llaman los 3 a noEjecutadosFilasDetalle(applyFiltersSkips()) — nunca un criterio de filtro propio por formato (§O: mismo orden/mismos datos)', () => {
    const ocurrencias = src.match(/noEjecutadosFilasDetalle\(applyFiltersSkips\(\)\)/g) || [];
    expect(ocurrencias.length).toBeGreaterThanOrEqual(3);
  });
});

describe('C/D — CSV: comillas/comas/saltos de línea/UTF-8 — reutiliza downloadCSV() existente sin alterar su formato', () => {
  it('downloadCSV() sigue envolviendo cada campo en comillas y duplicando comillas internas (RFC4180) — comas y saltos de línea quedan protegidos por venir ya dentro de comillas', () => {
    const fnSrc = extractDeclaration(appSource, 'downloadCSV');
    expect(fnSrc).toContain('r.map(v => `"${csvSafeField(v).replace(/"/g, \'""\')}"`).join(\',\')');
  });

  it('mantiene el BOM UTF-8 (\\uFEFF) y el charset=utf-8 del Blob — sin alterar las exportaciones CSV existentes', () => {
    const fnSrc = extractDeclaration(appSource, 'downloadCSV');
    expect(fnSrc).toContain("new Blob(['\\uFEFF' + csv]");
    expect(fnSrc).toContain("type: 'text/csv;charset=utf-8;'");
  });
});

describe('E — protección contra CSV/Excel formula injection (csvSafeField, EJECUCIÓN real)', () => {
  const csvSafeField = loadCsvSafeField();

  it('un valor que empieza con =, +, -, @ se neutraliza con una comilla simple al frente', () => {
    expect(csvSafeField('=SUM(A1:A9)')).toBe("'=SUM(A1:A9)");
    expect(csvSafeField('+1234')).toBe("'+1234");
    expect(csvSafeField('-1234')).toBe("'-1234");
    expect(csvSafeField('@cmd')).toBe("'@cmd");
  });

  it('un valor normal (código, fecha, motivo, observación sin esos caracteres al inicio) no se altera', () => {
    expect(csvSafeField('T-06')).toBe('T-06');
    expect(csvSafeField('Equipo en reparación')).toBe('Equipo en reparación');
    expect(csvSafeField('Se revisó a las 14:30 - sin novedad')).toBe('Se revisó a las 14:30 - sin novedad');
    expect(csvSafeField(0)).toBe('0');
    expect(csvSafeField(null)).toBe('');
  });

  it('downloadCSV() pasa CADA valor por csvSafeField() antes de escapar comillas — se aplica a todos los CSV existentes, no solo a "No ejecutados"', () => {
    const fnSrc = extractDeclaration(appSource, 'downloadCSV');
    expect(fnSrc).toContain('csvSafeField(v)');
  });
});

describe('F/H — Excel: hoja "No ejecutados" reutiliza xlsHojaConFormato() (mismo estilo que el resto del informe)', () => {
  it('se agrega como hoja nueva del MISMO workbook (book_append_sheet), nunca un archivo .xlsx separado', () => {
    const iExcel = src.indexOf("$('#exp-excel')");
    const iFinExcel = src.indexOf("$('#exp-pdf')", iExcel);
    const excelSrc = src.slice(iExcel, iFinExcel);
    expect(excelSrc).toContain("titulo: 'NO EJECUTADOS'");
    expect(excelSrc).toContain("XLSX.utils.book_append_sheet(wb, wsNoEjec, 'No ejecutados');");
  });

  it('usa xlsHojaConFormato()/xlsEstiloCelda() (mismo helper que Resumen/Histórico/Anomalías), no un armado de celdas propio', () => {
    const iExcel = src.indexOf("$('#exp-excel')");
    const iFinExcel = src.indexOf("$('#exp-pdf')", iExcel);
    const excelSrc = src.slice(iExcel, iFinExcel);
    const iSheet = excelSrc.indexOf("titulo: 'NO EJECUTADOS'");
    const sheetSrc = excelSrc.slice(iSheet - 40, iSheet + 900);
    expect(sheetSrc).toContain('xlsHojaConFormato(');
    expect(sheetSrc).toContain('xlsEstiloCelda(');
  });

  it('Periodo/Filtros activos/Total van en el subtítulo (mismo patrón que las demás hojas del informe), y ajusta anchos de columna', () => {
    const iExcel = src.indexOf("$('#exp-excel')");
    const iFinExcel = src.indexOf("$('#exp-pdf')", iExcel);
    const excelSrc = src.slice(iExcel, iFinExcel);
    expect(excelSrc).toContain('subtitulo: `Total: ${filasNoEjecXls.length}  ·  ${periodoTxt}  ·  Filtros: ${filtrosActivosTexto()}`');
    expect(excelSrc).toContain("wsNoEjec['!cols'] =");
  });

  it('G — usa applyFiltersSkips() (mismos filtros del informe), no un conteo global', () => {
    const iExcel = src.indexOf("$('#exp-excel')");
    const iFinExcel = src.indexOf("$('#exp-pdf')", iExcel);
    const excelSrc = src.slice(iExcel, iFinExcel);
    expect(excelSrc).toContain('const filasNoEjecXls = noEjecutadosFilasDetalle(applyFiltersSkips());');
  });

  it('0 registros: fila-placeholder (nunca una tabla vacía/corrupta)', () => {
    const iExcel = src.indexOf("$('#exp-excel')");
    const iFinExcel = src.indexOf("$('#exp-pdf')", iExcel);
    const excelSrc = src.slice(iExcel, iFinExcel);
    expect(excelSrc).toContain('Sin "no se pudo ejecutar" en el período');
  });
});

describe('I/J/K — PDF: título, resumen por motivo, tabla detallada, multipágina', () => {
  const iPdf = src.indexOf("$('#exp-pdf')");
  const pdfSrc = src.slice(iPdf);
  const iSeccion = pdfSrc.indexOf("doc.text('NO EJECUTADOS'");
  const seccionSrc = pdfSrc.slice(iSeccion - 60, iSeccion + 2200);

  it('título "NO EJECUTADOS" + Periodo + Filtros utilizados + Total', () => {
    expect(iSeccion).toBeGreaterThan(-1);
    expect(seccionSrc).toContain("doc.text(periodoTxt, 40, y)");
    expect(seccionSrc).toContain('Filtros utilizados: ${filtrosActivosTexto()}');
    expect(seccionSrc).toContain('Total: ${filasNoEjecPdf.length}');
  });

  it('resumen por motivo: los 6 motivos reales, en el orden pedido — Reparación, No hubo tiempo, No disponible, Condición insegura, Ya engrasado, Otro (aunque alguno esté en 0)', () => {
    expect(seccionSrc).toContain("const ORDEN_MOTIVOS_RESUMEN_PDF = ['REPARACION', 'SIN_TIEMPO', 'NO_DISPONIBLE', 'CONDICION_INSEGURA', 'YA_ENGRASADO', 'OTRO'];");
    expect(seccionSrc).toContain('ORDEN_MOTIVOS_RESUMEN_PDF.map(r => [NO_EXECUTION_REASON_LABELS[r], conteoPorMotivoPdf[NO_EXECUTION_REASON_LABELS[r]] || 0])');
  });

  it('tabla detallada con las 12 columnas pedidas, en el orden pedido', () => {
    expect(seccionSrc).toContain("head: [['Fecha', 'Hora', 'Equipo', 'Modelo', 'Ubicación', 'Turno', 'Motivo', 'Observación', 'Usuario', 'Cuadrilla', 'Occurrence', 'Estado']]");
  });

  it('multipágina: guardias `if (y > 600) { doc.addPage(); y = 40; }` antes de dibujar, y NUNCA fija overflow que recorte/oculte "Observación"', () => {
    expect((seccionSrc.match(/doc\.addPage\(\)/g) || []).length).toBeGreaterThanOrEqual(1);
    expect(seccionSrc).not.toContain("overflow: 'ellipsize'");
    expect(seccionSrc).not.toContain("overflow: 'hidden'");
  });

  it('0 registros: fila-placeholder en la tabla detallada (nunca un autoTable vacío que rompa el documento)', () => {
    expect(seccionSrc).toContain('Sin "no se pudo ejecutar" en el período');
  });
});

describe('L — 0 registros en el botón CSV dedicado: aviso explícito, nunca un archivo corrupto', () => {
  it('early-return con alert() ANTES de llamar a downloadCSV() si no hay filas', () => {
    const iBtn = src.indexOf("$('#exp-no-ejecutados')");
    const iFinBtn = src.indexOf('});', iBtn);
    const btnSrc = src.slice(iBtn, iFinBtn);
    const iAlert = btnSrc.indexOf('alert(');
    const iDownload = btnSrc.indexOf('downloadCSV(');
    expect(iAlert).toBeGreaterThan(-1);
    expect(iAlert).toBeLessThan(iDownload);
    expect(btnSrc).toContain('Sin registros para exportar');
  });
});

describe('M — offline: la exportación solo lee datos ya cargados localmente (DB.allActive), sin red', () => {
  it('ni noEjecutadosFilasDetalle() ni los 3 handlers de exportación llaman fetch()/Supabase directamente', () => {
    const iFn = src.indexOf('function noEjecutadosFilasDetalle(skipsF) {');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).not.toContain('fetch(');
    expect(fnSrc).not.toContain('supabase');
    const iCsvBtn = src.indexOf("$('#exp-no-ejecutados')");
    expect(src.slice(iCsvBtn, src.indexOf('});', iCsvBtn))).not.toContain('fetch(');
  });
});

describe('N — un skip exportado NUNCA modifica cumplimiento/realizados/pendientes/matriz', () => {
  it('noEjecutadosFilasDetalle() no llama a ninguna función de cumplimiento ni escribe en `records`/progReal', () => {
    const iFn = src.indexOf('function noEjecutadosFilasDetalle(skipsF) {');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).not.toContain('evaluateRecordCompliance');
    expect(fnSrc).not.toContain('computeFleetCompliance');
    expect(fnSrc).not.toContain('computeProgramadoRealizadoPeriodo');
    expect(fnSrc).not.toContain('progReal');
    expect(fnSrc).not.toContain('records.push');
  });

  it('la sección "No ejecutados" del Excel/PDF se construye DESPUÉS y de forma independiente de las hojas/tablas de Cumplimiento (no comparte ni muta sus variables)', () => {
    const iExcel = src.indexOf("$('#exp-excel')");
    const iCumpl = src.indexOf("'CUMPLIMIENTO POR EQUIPO", iExcel);
    const iNoEjec = src.indexOf("titulo: 'NO EJECUTADOS'", iExcel);
    expect(iCumpl).toBeGreaterThan(-1);
    expect(iNoEjec).toBeGreaterThan(iCumpl); // se agrega después, sin tocar lo ya calculado arriba
  });
});

describe('O — mismo orden en los 3 formatos: más reciente primero, igual convención que puntosNoEngrasadosDe()', () => {
  it('noEjecutadosFilasDetalle() ordena descendente por fecha, una sola vez (los 3 formatos consumen el resultado ya ordenado)', () => {
    const iFn = src.indexOf('function noEjecutadosFilasDetalle(skipsF) {');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('.sort((a, b) => new Date(b.date) - new Date(a.date))');
  });
});

describe('§15 — auditoría de exportadores: se EXTENDIERON downloadCSV/exp-excel/exp-pdf existentes, no se duplicó ninguna función', () => {
  it('no existe una segunda función downloadCSV/exportExcel/exportPDF paralela', () => {
    expect((appSource.match(/function downloadCSV\(/g) || []).length).toBe(1);
    expect(appSource).not.toContain('function exportExcelNoEjecutados');
    expect(appSource).not.toContain('function exportPDFNoEjecutados');
    expect(appSource).not.toContain('function exportNoEjecutadosCSV');
  });

  it('el CSV dedicado reusa downloadCSV() existente, y Excel/PDF agregan a los MISMOS handlers exp-excel/exp-pdf (no nuevos botones de Excel/PDF)', () => {
    expect((appSource.match(/id="exp-excel"/g) || []).length).toBe(1);
    expect((appSource.match(/id="exp-pdf"/g) || []).length).toBe(1);
  });
});
