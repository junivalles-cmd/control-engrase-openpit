// tests/unit/reportes-rediseno.test.js
//
// LOTE "Reportes/Informes" — Reportes deja de ser un segundo Dashboard y
// pasa a ser análisis HISTÓRICO por período (Cumplimiento Realizados/
// Programados, tendencia, consumo, Pareto de motivos, anomalías,
// validación). Prueba a nivel de fuente (mismo criterio que
// dashboard-operativo.test.js): renderReportes() tiene demasiadas
// dependencias de DOM/IndexedDB/Chart.js/jsPDF/XLSX para ejecutarla aquí —
// se verifica el texto real de la función. La lógica pura de Programados/
// Realizados ya se prueba ejecutada de verdad en
// tests/unit/reportes-programado-realizado.test.js.

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_CSS_PATH = path.join(path.dirname(APP_JS_PATH), 'styles.css');

const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderReportes');
const bucketsSrc = extractDeclaration(appSource, 'construirBucketsTendencia');

describe('Filtros del informe — Desde/Hasta/Equipo/Familia/Ubicación/Turno/Responsable, todos AND', () => {
  it('agrega Familia y Ubicación (antes faltaban) junto a los filtros existentes', () => {
    expect(src).toContain('id="f-familia"');
    expect(src).toContain('id="f-ubic"');
    expect(src).toContain('id="f-equipo"');
    expect(src).toContain('id="f-turno"');
    expect(src).toContain('id="f-resp"');
  });

  it('equiposFiltrados() combina Equipo/Familia/Ubicación con AND (early-return false, nunca OR)', () => {
    expect(src).toContain('if (eqId && e.id !== eqId) return false;');
    expect(src).toContain('if (fam && e.typeId !== fam) return false;');
    expect(src).toContain('if (ubic && e.locationId !== ubic) return false;');
  });

  it('applyFilters() reutiliza equiposFiltrados() (no duplica la lógica de Equipo/Familia/Ubicación)', () => {
    expect(src).toContain('const idsPermitidos = new Set(equiposFiltrados().map(e => e.id));');
  });

  it('anomalías y fotos también respetan los filtros de Equipo/Familia/Ubicación (antes las anomalías exportaban TODO sin filtrar)', () => {
    const iAnomFn = src.indexOf('function applyFiltersAnomalias');
    const anomFnSrc = src.slice(iAnomFn, src.indexOf('\n  }', iAnomFn));
    expect(anomFnSrc).toContain('equiposFiltrados()');
    const iPhotoFn = src.indexOf('function drawPhotoReport');
    const photoFnSrc = src.slice(iPhotoFn, src.indexOf('\n  }\n\n  function drawAll', iPhotoFn) || src.length);
    expect(photoFnSrc).toContain('equiposFiltrados()');
  });
});

describe('Resumen del período — reemplaza los KPIs poco útiles anteriores', () => {
  it('ya NO prioriza "Total equipos" en el resumen del período', () => {
    const iResumenFn = src.indexOf('function drawResumen');
    const resumenFnSrc = src.slice(iResumenFn, src.indexOf('\n  }', iResumenFn));
    expect(resumenFnSrc).not.toContain("kpiCard('TOTAL EQUIPOS'");
    expect(resumenFnSrc).not.toContain("kpiCard('Total equipos'");
  });

  it('muestra Cumplimiento del período, Programados, Realizados, No realizados y Consumo total', () => {
    expect(src).toContain('Cumplimiento del período');
    expect(src).toContain("kpiCard('Programados', programados, 'neutral')");
    expect(src).toContain("kpiCard('Realizados', realizados, 'green')");
    expect(src).toContain("kpiCard('No realizados', noRealizados,");
    expect(src).toContain('Consumo total');
  });

  it('"Vencidos (actual)" ya NO aparece en el Resumen del período (es estado actual de la flota, pertenece al Dashboard)', () => {
    const iResumenFn = src.indexOf('function drawResumen');
    const resumenFnSrc = src.slice(iResumenFn, src.indexOf('\n  }', iResumenFn));
    expect(resumenFnSrc).not.toContain("kpiCard('Vencidos"); // el KPI en sí ya no existe (el comentario explicando por qué SÍ puede mencionar la palabra)
    expect(resumenFnSrc).not.toContain('vencidosF');
  });

  it('No realizados nunca es negativo (Math.max con 0) y no cuenta días futuros (diasDelPeriodo recorta a HOY)', () => {
    expect(src).toContain('const noRealizados = Math.max(programados - realizados, 0);');
    const iDiasFn = src.indexOf('function diasDelPeriodo');
    const diasFnSrc = src.slice(iDiasFn, src.indexOf('\n  }', iDiasFn));
    expect(diasFnSrc).toContain('hastaInput > hoy ? hoy : hastaInput');
  });

  it('nunca NaN/Infinity: cumplimiento "—" cuando programados es 0, división protegida', () => {
    expect(src).toContain('const pct = programados ? Math.round((realizados / programados) * 100) : null;');
    expect(src).toContain("pct === null ? '—' : pct + '%'");
  });

  it('deja claro que corresponde al período filtrado (línea "Período: dd/mm/aaaa – dd/mm/aaaa" con formato DD/MM/YYYY, vía ddmmyyyy())', () => {
    expect(src).toContain('rep-periodo-line');
    expect(src).toContain("Período: ${ddmmyyyy($('#f-from').value)} – ${ddmmyyyy($('#f-to').value)");
    expect(appSource).toContain('function ddmmyyyy(isoDate)');
  });

  it('el texto técnico debajo del resumen es corto (PULIDO visual, ya no la explicación larga de antes)', () => {
    expect(src).toContain('rep-resumen-note');
    expect(src).toContain('Cumplimiento basado en planes Día/Turno evaluables.');
  });

  it('PULIDO — Resumen usa su propio grid de 5 columnas iguales (rep-resumen-grid), no el .kpi-grid genérico compartido con otras pantallas', () => {
    const iFn = src.indexOf('function drawResumen');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('rep-resumen-grid');
    expect(fnSrc).not.toContain('class="kpi-grid"');
  });
});

describe('Cumplimiento del plan — REALIZADOS/PROGRAMADOS como reporte principal, no conteo de records', () => {
  it('usa computeProgramadoRealizadoPeriodo() (reutiliza reglas de programación existentes), no un simple .length de lubrication_records', () => {
    expect(src).toContain('computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, dias, turnoSel)');
  });

  it('SOLO planes "Día y turno de la semana" — nunca planes por Horas (no inventa proyección horómetro→fecha)', () => {
    expect(src).toContain("(planByEquipoId[e.id] || {}).controlType === 'Día y turno de la semana'");
  });

  it('no usa avgInterval en ningún lado del reporte', () => {
    expect(src).not.toContain('avgInterval');
  });
});

describe('Tendencia de cumplimiento — reemplaza "Engrases por día", es % no cantidad', () => {
  it('el título ya no es "Engrases por día"', () => {
    expect(src).not.toContain('Engrases por día');
    expect(src).toContain('Tendencia de cumplimiento');
  });

  it('cada punto es cumplimiento % (realizados/programados por cubeta), no conteo de engrases', () => {
    expect(src).toContain('r.general.programados ? Math.round((r.general.realizados / r.general.programados) * 100) : null');
  });

  it('agrupa por día si el rango es corto (≤31) y por semana si es amplio (infraestructura simple, sin inventar un tercer criterio)', () => {
    expect(bucketsSrc).toContain('dias.length <= 31');
    expect(bucketsSrc).toContain("actual.dias.length >= 7");
  });
});

describe('Cumplimiento por turno — Realizados/Programados/%, no cantidad de engrases', () => {
  it('el título ya no es "Engrases por turno"', () => {
    expect(src).not.toContain('Engrases por turno');
    expect(src).toContain('Cumplimiento por turno');
  });

  it('cada turno muestra el % como cifra PRINCIPAL, realizados/programados como secundario, y una barra de progreso', () => {
    const iFn = src.indexOf('function drawCumplimientoTurno');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('${t.realizados} de ${t.programados}');
    expect(fnSrc).toContain("pct === null ? '—' : pct + '%'");
    expect(fnSrc).toContain('class="progress-track rep-turno-bar"');
    // El % (rep-turno-pct) va ANTES que la fracción (rep-turno-frac) en el markup — jerarquía visual primario/secundario
    expect(fnSrc.indexOf('rep-turno-pct')).toBeLessThan(fnSrc.indexOf('rep-turno-frac'));
  });
});

describe('Cumplimiento por equipo — reemplaza "Engrases por equipo", ordenado por MENOR cumplimiento primero', () => {
  it('el título ya no es "Engrases por equipo"', () => {
    expect(src).not.toContain('Engrases por equipo');
    expect(src).toContain('Cumplimiento por equipo');
  });

  it('ordena ascendente por cumplimiento % (peor primero), nunca por cantidad de engrases', () => {
    const iFn = src.indexOf('function drawCumplimientoEquipo');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('.sort((a, b) => a.pct - b.pct)');
  });

  it('muestra Código, Modelo, Realizados/Programados y Cumplimiento % (no solo un conteo de engrases)', () => {
    const iFn = src.indexOf('function drawCumplimientoEquipo');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('<th>Código</th><th>Modelo</th><th>Realizados/Programados</th><th>Cumplimiento</th>');
  });

  it('equipos con 0 programados NUNCA muestran 0% — se excluyen del ranking principal, con nota explicativa', () => {
    const iFn = src.indexOf('function drawCumplimientoEquipo');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('.filter(x => x.programados > 0)');
    expect(fnSrc).toContain('sin programación');
    expect(fnSrc).toContain('no es un incumplimiento');
  });
});

describe('Consumo de grasa — sección prioritaria nueva, usa qty y GREASE_UNIT existentes', () => {
  it('existe la sección con total y promedio, sin inventar datos faltantes', () => {
    expect(src).toContain('Consumo de grasa');
    expect(src).toContain('function consumoDe(records)');
    expect(src).toContain('Promedio por engrase');
  });

  it('consumoDe(): qty válida = número finito; total y promedio NUNCA cuentan registros sin qty válida', () => {
    const iFn = src.indexOf('function consumoDe');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('records.filter(r => Number.isFinite(Number(r.qty)))');
    expect(fnSrc).toContain('registrosConQty.reduce((s, r) => s + Number(r.qty), 0)');
    expect(fnSrc).toContain('registrosConQty.length ? totalQty / registrosConQty.length : null');
  });

  it('Resumen, sección Consumo, Excel y PDF usan la MISMA función consumoDe() — nunca cada uno calcula su propio total', () => {
    expect(src.match(/consumoDe\(records\)/g).length).toBeGreaterThanOrEqual(4);
  });

  it('PULIDO densidad — UN solo gráfico con tabs (Por equipo/Familia/Lubricante), no 3 visualizaciones simultáneas', () => {
    expect(src).toContain('id="rep-consumo-tabs"');
    expect(src).toContain('data-tab="equipo"');
    expect(src).toContain('data-tab="familia"');
    expect(src).toContain('data-tab="lubricante"');
    expect(src).toContain('id="chart-consumo-box"');
    expect(src).not.toContain('chart-consumo-equipo-box');
    expect(src).not.toContain('id="rep-consumo-familia"');
    expect(src).not.toContain('id="rep-consumo-lub"');
  });

  it('"Por equipo" muestra Top 7 con mayor consumo, excluyendo (solo visualmente) los de 0 lb del ranking', () => {
    const iFn = src.indexOf('function drawConsumo(');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain(".filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 7)");
  });

  it('la altura del gráfico de consumo es proporcional a la cantidad real de categorías (nunca reserva espacio para filas inexistentes), tope 220px', () => {
    const iFn = src.indexOf('function dibujarConsumoTab(');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("Math.max(120, Math.min(220, entries.length * 32 + 40))");
  });
});

describe('Puntos no engrasados — se mantiene, mejora con Pareto (motivo + cantidad + %)', () => {
  it('el chip de motivo ahora incluye el porcentaje', () => {
    expect(src).toContain("${esc(motivo)}: <b>${n}</b> (${Math.round(n / filas.length * 100)}%)");
  });

  it('la lógica de armar las filas está en una sola función reutilizada por pantalla Y CSV (puntosNoEngrasadosDe)', () => {
    expect(src).toContain('function puntosNoEngrasadosDe(records)');
    expect(src.match(/puntosNoEngrasadosDe\(/g).length).toBeGreaterThanOrEqual(3); // pantalla + CSV + Excel/PDF
  });
});

describe('Anomalías de lubricación — nueva sección de análisis del período', () => {
  it('muestra detectadas/abiertas/cerradas, principales tipos y equipos con más anomalías', () => {
    const iFn = src.indexOf('function drawAnomaliasSeccion');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("kpiCard('Detectadas'");
    expect(fnSrc).toContain("kpiCard('Abiertas'");
    expect(fnSrc).toContain("kpiCard('Cerradas'");
    expect(fnSrc).toContain('Principales tipos');
    expect(fnSrc).toContain('Equipos con más anomalías');
  });

  it('no inventa un estado "resuelto" distinto de Cerrada (el único estado real del modelo)', () => {
    const iFn = src.indexOf('function drawAnomaliasSeccion');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("a.status === 'Cerrada'");
    expect(fnSrc).not.toContain('Resuelta');
  });

  it('el modelo real tiene 3 valores de status (Abierta/En atención/Cerrada) — el desglose "Por estado" agrupa el valor EXACTO de a.status, sin hardcodear cuáles existen', () => {
    expect(appSource).toContain("['Abierta', 'En atención', 'Cerrada']"); // confirmado en el formulario real de edición de anomalías (fuera de renderReportes)
    const iFn = src.indexOf('function drawAnomaliasSeccion');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("const k = a.status || 'Sin estado'; porEstado[k] = (porEstado[k] || 0) + 1;");
    expect(fnSrc).toContain('Por estado (real)');
  });
});

describe('Validación de engrases en Reportes — análisis del período, respeta el baseline, nunca fabrica datos con null', () => {
  it('SIN excepción propia: `sujetos` sale de la MISMA función central (isRecordSubjectToValidation) — con baseline null da vacío solo, nunca por una rama aparte', () => {
    const iFn = src.indexOf('function drawValidacionSeccion');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('const sujetos = records.filter(r => isRecordSubjectToValidation(r.date));');
    // El chequeo de "hay algo que mostrar" es sobre `sujetos` (resultado de la función central), no sobre GREASE_VALIDATION_ENABLED_FROM directo
    const iSujetos = fnSrc.indexOf('const sujetos =');
    const iIfSujetos = fnSrc.indexOf('if (!sujetos.length)');
    expect(iIfSujetos).toBeGreaterThan(iSujetos);
    expect(fnSrc.indexOf('if (!sujetos.length)')).toBeLessThan(fnSrc.indexOf('pctValidado'));
  });

  it('el mensaje distingue "no configurado" de "sin registros en el período" — pero NUNCA fabrica un porcentaje (ni 0%) en ninguno de los dos casos', () => {
    const iFn = src.indexOf('function drawValidacionSeccion');
    const iPct = src.indexOf('pctValidado', iFn);
    const ramaSinSujetos = src.slice(iFn, iPct);
    expect(ramaSinSujetos).toContain('Validación pendiente de activación');
    expect(ramaSinSujetos).toContain('Ningún registro del período está sujeto a validación');
    expect(ramaSinSujetos).not.toContain('0%');
  });

  it('muestra Sujetos/Validados/Pendientes/Conflictos/Por Operador/Por Encargado', () => {
    const iFn = src.indexOf('function drawValidacionSeccion');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("kpiCard('Sujetos a validación'");
    expect(fnSrc).toContain("kpiCard('Validados'");
    expect(fnSrc).toContain("kpiCard('Pendientes'");
    expect(fnSrc).toContain("kpiCard('Conflictos'");
    expect(fnSrc).toContain("kpiCard('Por Operador'");
    expect(fnSrc).toContain("kpiCard('Por Encargado'");
  });

  it('Cumplimiento y Validación siguen siendo conceptos separados (drawValidacionSeccion no toca progReal/computeProgramadoRealizadoPeriodo)', () => {
    const iFn = src.indexOf('function drawValidacionSeccion');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).not.toContain('computeProgramadoRealizadoPeriodo');
    expect(fnSrc).not.toContain('progReal');
  });
});

describe('Actividad por responsable — bajó de prioridad, ya NO se llama "desempeño" ni "mejor lubricador"', () => {
  it('el panel se llama "Actividad por responsable", no "Engrases por responsable"', () => {
    expect(src).not.toContain('Engrases por responsable');
    expect(src).toContain('Actividad por responsable');
  });

  it('aclara explícitamente que NO es cumplimiento ni desempeño laboral', () => {
    expect(src).toContain('NO es una medición de cumplimiento ni de desempeño laboral');
  });

  it('PULIDO densidad — ya NO es un gráfico grande (Chart.js): es una lista/ranking compacto', () => {
    const iFn = src.indexOf('function drawActividadResponsable');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).not.toContain('new Chart(');
    expect(fnSrc).toContain('rep-consumo-row');
    expect(src).not.toContain('chart-actividad-resp-box');
  });
});

describe('PULIDO DE DENSIDAD — Tendencia+Turno más compactos, Pareto+Anomalías lado a lado', () => {
  it('Tendencia bajó a 230-250px (antes 300-320px) — cálculos sin cambios', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    expect(cssSource).toContain('.rep-chart-tendencia-box { aspect-ratio: auto; min-height: 220px; height: 230px; }');
    expect(cssSource).toContain('.rep-chart-tendencia-box { height: 250px; }');
    expect(cssSource).not.toContain('.rep-chart-tendencia-box { aspect-ratio: auto; min-height: 260px; height: 300px; }');
  });

  it('Turno se estira a la MISMA altura que Tendencia (grid stretch por defecto) y su contenido se centra, sin agregar hueco vacío visible', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    const iGridRule = cssSource.indexOf('.rep-tendencia-turno-grid { display: grid');
    const finRule = cssSource.indexOf('}', iGridRule);
    expect(cssSource.slice(iGridRule, finRule)).not.toContain('align-items'); // sin forzar start: stretch por defecto
    expect(cssSource).toContain('.rep-turno-grid { display: grid; grid-template-columns: 1fr; gap: 12px; padding: 0 14px 14px; flex: 1; align-content: center; }');
  });

  it('Pareto de motivos (compacto) y Anomalías van en un grid 1fr 1fr desde 900px, apilados debajo de 900px', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    expect(cssSource).toContain('.rep-pareto-anomalias-grid { display: flex; flex-direction: column; gap: 16px; }');
    expect(cssSource).toMatch(/@media \(min-width: 900px\) \{ \.rep-pareto-anomalias-grid \{ display: grid; grid-template-columns: 1fr 1fr;/);
  });

  it('drawSkippedPoints() separa el Pareto compacto (#rep-motivos-pareto) del detalle completo (#skipped-points-area) — misma información, 2 paneles', () => {
    const iFn = src.indexOf('function drawSkippedPoints');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("$('#rep-motivos-pareto')");
    expect(fnSrc).toContain("$('#skipped-points-area')");
  });

  it('el detalle completo de puntos no engrasados sigue existiendo en su propio panel ("Detalle de puntos no engrasados")', () => {
    expect(src).toContain('<h3>Detalle de puntos no engrasados</h3>');
  });
});

describe('"Estado actual de la flota" — ELIMINADO del cuerpo principal de Reportes (ya vive en el Dashboard)', () => {
  it('no existe ya el gráfico/canvas chart-fleet ni su título', () => {
    expect(src).not.toContain('chart-fleet');
    expect(src).not.toContain('Estado actual de la flota');
  });

  it('no queda un doughnut de composición de flota en el cuerpo de la pantalla', () => {
    expect(src).not.toContain("type: 'doughnut'");
  });
});

describe('Evidencia fotográfica — bajó prioridad visual, colapsada por defecto, respeta filtros', () => {
  it('arranca oculta (clase hidden) con contador + botón "Ver fotos", no una tira enorme siempre visible', () => {
    expect(src).toContain('class="photo-report-grid hidden"');
    expect(src).toContain('id="rep-photo-toggle"');
    expect(src).toContain('id="rep-photo-count"');
  });

  it('el contador de evidencias se actualiza con el total real filtrado', () => {
    expect(src).toContain("$('#rep-photo-count').textContent = `${photoItems.length} evidencia(s)`;");
  });
});

describe('Generar informe — exportaciones unificadas visualmente (PDF/Excel primero, CSV en "Más exportaciones")', () => {
  it('PDF y Excel son las acciones principales, sin varias cajas grandes separadas para CSV', () => {
    expect(src).toContain('Informe ejecutivo (PDF)');
    expect(src).toContain('Informe completo (Excel)');
    expect(src).toContain('<details class="rep-more-exports"');
    expect(src).toContain('Más exportaciones');
  });

  it('las 4 exportaciones CSV siguen disponibles dentro de "Más exportaciones"', () => {
    expect(src).toContain('id="exp-cumplimiento"');
    expect(src).toContain('id="exp-historico"');
    expect(src).toContain('id="exp-anomalias"');
    expect(src).toContain('id="exp-puntos"');
  });
});

describe('No se tocaron fórmulas protegidas ni arquitectura fuera de alcance', () => {
  it('no redefine evaluateRecordCompliance/computeFleetCompliance dentro de renderReportes (sigue delegando en plan-compliance.js)', () => {
    expect(src).not.toContain('function evaluateRecordCompliance');
    expect(src).not.toContain('function computeFleetCompliance');
  });

  it('sigue usando XLSX/jsPDF (mismo motor, no se reescribió)', () => {
    expect(src).toContain('XLSX.utils.book_new()');
    expect(src).toContain('new jsPDF(');
  });
});

describe('PULIDO — nunca contar días futuros como programados/no realizados', () => {
  it('el input "Hasta" trae max=hoy (freno también a nivel de UI, no solo de cálculo)', () => {
    expect(src).toContain('id="f-to" class="input input-sm" value="${toInput}" max="${toInput}"');
  });

  it('diasDelPeriodo() recorta "Hasta" a HOY aunque el valor guardado sea futuro', () => {
    const iFn = src.indexOf('function diasDelPeriodo');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain('const to = hastaInput > hoy ? hoy : hastaInput;');
  });
});

describe('PULIDO — PDF/Excel calculan a partir del MISMO conjunto filtrado que la pantalla', () => {
  it('el handler de Excel recomputa records/equiposFiltrados/progReal/consumoDe con las MISMAS funciones que drawAll(), no valores ya calculados en otro momento', () => {
    const iExcel = src.indexOf("$('#exp-excel')");
    const excelSrc = src.slice(iExcel, src.indexOf("$('#exp-pdf')", iExcel));
    expect(excelSrc).toContain('applyFilters()');
    expect(excelSrc).toContain('applyFiltersAnomalias()');
    expect(excelSrc).toContain('equiposFiltrados()');
    expect(excelSrc).toContain('computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, dias, turnoSel)');
    expect(excelSrc).toContain('consumoDe(records)');
  });

  it('el handler de PDF hace exactamente lo mismo (mismas funciones, no otro cálculo paralelo)', () => {
    const iPdf = src.indexOf("$('#exp-pdf')");
    const pdfSrc = src.slice(iPdf);
    expect(pdfSrc).toContain('applyFilters()');
    expect(pdfSrc).toContain('applyFiltersAnomalias()');
    expect(pdfSrc).toContain('equiposFiltrados()');
    expect(pdfSrc).toContain('computeProgramadoRealizadoPeriodo(equiposDT, records, planByEquipoId, dias, turnoSel)');
    expect(pdfSrc).toContain('consumoDe(records)');
  });
});
