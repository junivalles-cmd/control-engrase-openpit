// tests/unit/dashboard-operativo.test.js
//
// LOTE — Dashboard operativo (A): filtros Ubicación/Familia (AND, auto-
// actualizan), KPI "Pausados", "Mayor tiempo sin engrasar" (código/modelo/
// familia/ubicación/último engrase/días — "Sin registro de engrase" cuando
// nunca tuvo, prioriza Operativos, NUNCA usa el vencimiento por horómetro).
// El panel "Equipos al día" (%+barra+"X de Y") se ELIMINÓ en el ajuste
// visual final (redundante con la tarjeta "Al día" de "Estado de
// lubricación") — solo queda "Cumplimiento operativo" (Hoy/Semana/Turno),
// distinto de computeFleetCompliance() (histórico, no conectado aquí).
// Prueba a nivel de fuente (mismo criterio que dashboard-sin-plan.test.js):
// renderDashboard() tiene muchas dependencias de DOM/PERMISSIONS/STATUS_COLOR
// que no aportan al confirmar esta lógica puntual — se verifica el texto
// real de la función, no una reimplementación.

import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_CSS_PATH = path.join(path.dirname(APP_JS_PATH), 'styles.css');
const appSource = readSource(APP_JS_PATH);
const src = extractDeclaration(appSource, 'renderDashboard');

describe('Filtros generales Ubicación + Familia (AND, auto-actualizan sin botón)', () => {
  it('se guardan en App (sobreviven el re-render) y filtran `equipos` en secuencia (AND)', () => {
    expect(src).toContain("if (App.dashUbic) equipos = equipos.filter(e => e.locationId === App.dashUbic);");
    expect(src).toContain("if (App.dashFamilia) equipos = equipos.filter(e => e.typeId === App.dashFamilia);");
    // El segundo filtro actúa SOBRE el resultado ya filtrado del primero (AND),
    // no sobre el arreglo original — confirma que están encadenados, no en OR.
    const iUbic = src.indexOf('if (App.dashUbic)');
    const iFamilia = src.indexOf('if (App.dashFamilia)');
    expect(iUbic).toBeLessThan(iFamilia);
  });

  it('se cablean a "change" (auto-actualiza, sin botón Buscar/Aplicar)', () => {
    expect(src).toContain("$('#dash-ubic')?.addEventListener('change'");
    expect(src).toContain("$('#dash-familia')?.addEventListener('change'");
    expect(src).not.toContain('dash-apply');
  });

  it('el filtrado ocurre ANTES de calcular statuses/KPIs/sinPlan/pausados (todo deriva del mismo `equipos` filtrado)', () => {
    const iFiltroUbic = src.indexOf('if (App.dashUbic)');
    const iStatuses = src.indexOf('computeAllStatuses(equipos)');
    const iSinPlan = src.indexOf('const sinPlan =');
    const iPausados = src.indexOf('const pausados =');
    expect(iFiltroUbic).toBeLessThan(iStatuses);
    expect(iFiltroUbic).toBeLessThan(iSinPlan);
    expect(iFiltroUbic).toBeLessThan(iPausados);
  });
});

describe('KPI "Pausados" — equipos CON plan pero no operativos', () => {
  it('cuenta equipos con status distinto de Operativo Y con plan asociado (no confunde con sinPlan)', () => {
    expect(src).toContain("const pausados = equipos.filter(e => e.status !== 'Operativo' && planPorEquipoId.has(e.id));");
  });
  it('abre un modal propio (no reutiliza el de sin-plan, son conjuntos distintos), con typesAll/locationsAll (TODAS, no solo activas — DATA-PENDING-A02)', () => {
    expect(src).toContain("openPausadosModal(pausados, typesAll, locationsAll)");
  });
});

describe('"Mayor tiempo sin engrasar" — días de calendario, nunca vencimiento por horómetro', () => {
  it('prioriza equipos Operativos antes que por días (sort primario por status)', () => {
    expect(src).toMatch(/const opA = a\.status === 'Operativo' \? 0 : 1, opB = b\.status === 'Operativo' \? 0 : 1;/);
    expect(src).toContain('if (opA !== opB) return opA - opB;');
  });
  it('"nunca engrasado" (null) se trata como el caso más urgente (Infinity), no se oculta ni se asume 0 días', () => {
    expect(src).toContain("(dB === null ? Infinity : dB) - (dA === null ? Infinity : dA)");
  });
  it('equipo sin registro muestra el texto "Sin registro" en vez de una fecha inventada (ahora en tiempoExcepcionRowHTML)', () => {
    const rowSrc = extractDeclaration(appSource, 'tiempoExcepcionRowHTML');
    expect(rowSrc).toContain("`) : 'Sin registro'}");
  });
  it('la columna de días es independiente de counts.ROJO/AMARILLO (vencimiento por horómetro) — usa daysSinceLastGrease(), no s.remaining/s.code', () => {
    // Rediseño §H: el panel ahora va DESPUÉS de "Requieren atención" (movido
    // hacia abajo en la jerarquía) — se acota hasta "Indicadores
    // secundarios" (sección I, siempre posterior).
    const panelSrc = src.slice(src.indexOf('dash-tiempo-sin-engrase-panel'), src.indexOf('<h2 class="dash-section-title">Indicadores secundarios</h2>'));
    expect(panelSrc).toContain('daysSinceLastGrease(e.id)');
    expect(panelSrc).not.toMatch(/s\.remaining|s\.code/);
  });
  it('limita a los 10 peores casos (no una tabla sin límite)', () => {
    expect(src).toContain('.slice(0, 10)');
  });
});

describe('Rediseño estructural del Dashboard (cierre Parte D) — "Al día" pasa a Indicador secundario (dashActivityCard), ya no hero', () => {
  it('no existe más el panel duplicado (h3, pill de %, barra ni subtítulo "X de Y evaluables")', () => {
    expect(src).not.toContain('<h3>Equipos al día</h3>');
    expect(src).not.toContain('dash-al-dia-sub');
    expect(src).not.toContain('alDiaBase');
    expect(src).not.toContain('alDiaPct');
  });

  it('"Al día" sigue con el mismo cálculo/acción (counts.VERDE, al-dia), solo cambia a dashActivityCard (Indicadores secundarios)', () => {
    expect(src).toContain("dashActivityCard('Al día', counts.VERDE, 'green', 'al-dia')");
    expect(src).not.toContain("dashHeroCard('Al día'");
  });
});

describe('Rediseño estructural (cierre Parte D) — KPI principales (B) y Indicadores secundarios (I)', () => {
  it('5 tarjetas destacadas + validación en Requiere atención en el orden pedido: Vencidos/Pendientes hoy/Próximos/Realizados hoy/Pendientes de validación/Cumplimiento hoy', () => {
    expect(src).toContain("dashHeroCard('Vencidos', counts.ROJO, 'red', 'vencidos')");
    expect(src).toContain("dashHeroCard('Pendientes hoy', pendientesHoyList.length");
    expect(src).toContain("dashHeroCard('Próximos', proximosSinHoy.length");
    expect(src).toContain("dashHeroCard('Realizados hoy', doneToday, 'green'");
    expect(src).toContain("dashActivityCard('Pendientes de validación', recordsPendientesValidacion.length");
    expect(src).toContain('<div class="dash-hero-label">Cumplimiento hoy</div>');
    const iVenc = src.indexOf("dashHeroCard('Vencidos'");
    const iPendHoy = src.indexOf("dashHeroCard('Pendientes hoy'");
    const iProx = src.indexOf("dashHeroCard('Próximos'");
    const iReal = src.indexOf("dashHeroCard('Realizados hoy'");
    const iPendVal = src.indexOf("dashActivityCard('Pendientes de validación'");
    const iCumpl = src.indexOf('<div class="dash-hero-label">Cumplimiento hoy</div>');
    expect(iVenc).toBeLessThan(iPendHoy);
    expect(iPendHoy).toBeLessThan(iProx);
    expect(iProx).toBeLessThan(iReal);
    expect(iReal).toBeLessThan(iCumpl);
    expect(iCumpl).toBeLessThan(iPendVal);
  });

  it('no usa una fórmula nueva para los KPI principales — reusa counts/pendientesHoyList/proximosSinHoy/doneToday/recordsPendientesValidacion/cumplHoy ya calculados', () => {
    expect(src).not.toMatch(/dashHeroCard\('Vencidos', [^c]/); // siempre counts.ROJO
  });

  it('5 tarjetas de indicadores secundarios (I): Al día/Sin plan/Pausados/Anomalías abiertas/Total equipos, con menor peso visual (dashActivityCard)', () => {
    expect(src).toContain("dashActivityCard('Al día', counts.VERDE, 'green', 'al-dia')");
    expect(src).toContain("dashActivityCard('Sin plan', sinPlan.length");
    expect(src).toContain("dashActivityCard('Pausados', pausados.length, 'neutral', pausados.length ? 'pausados' : null)");
    expect(src).toContain("dashActivityCard('Anomalías abiertas'");
    expect(src).toContain("dashActivityCard('Total equipos'");
    const iSec = src.indexOf('<h2 class="dash-section-title">Indicadores secundarios</h2>');
    const iAlDia = src.indexOf("dashActivityCard('Al día'");
    expect(iSec).toBeGreaterThan(-1);
    expect(iAlDia).toBeGreaterThan(iSec);
  });

  it('"Indicadores secundarios" es la ÚLTIMA sección del Dashboard (menor peso visual que Vencidos, al final)', () => {
    const iSec = src.lastIndexOf('dash-section-title');
    expect(src.slice(iSec, iSec + 60)).toContain('Indicadores secundarios');
  });

  it('ya no existe el "kpi-grid" plano de 8 tarjetas iguales ni el grid "Semáforo de equipos" (menos tarjetas iguales, dedup)', () => {
    expect(src).not.toContain("kpiCard('TOTAL EQUIPOS'");
    expect(src).not.toContain('Semáforo de equipos');
    expect(src).not.toContain('equipmentCard(x.e, x.s,');
  });
});

describe('CORRECCIÓN CENTRAL — indicadores secundarios ya NO tienen su propia excepción para baseline null; dependen 100% de las funciones centrales', () => {
  const activityCardSrc = extractDeclaration(appSource, 'dashActivityCard');

  it('dashActivityCard() vuelve a su firma simple (sin workaround local de "—"/subtext) — el 0 real ya sale solo de la función central', () => {
    expect(activityCardSrc).toContain('function dashActivityCard(label, value, tone, action) {');
    expect(activityCardSrc).toContain('${fmt(value)}');
    expect(activityCardSrc).not.toContain('subtext');
    expect(activityCardSrc).not.toContain('Number.isFinite');
  });

  it('"Realizados hoy" usa tono verde (acento positivo) como KPI principal (dashHeroCard)', () => {
    expect(src).toContain("dashHeroCard('Realizados hoy', doneToday, 'green'");
  });

  it('"Pendientes de validación" es UNA SOLA rama — recordsPendientesValidacion.length directo, SIN chequeo propio de GREASE_VALIDATION_ENABLED_FROM en el Dashboard', () => {
    const iSecHero = src.indexOf('dash-requires-attention');
    const iFinSeccion = src.indexOf('</section>', iSecHero);
    const seccionSrc = src.slice(iSecHero, iFinSeccion);
    expect(seccionSrc).not.toContain('GREASE_VALIDATION_ENABLED_FROM'); // sin excepción propia de pantalla
    // Clicable SIEMPRE (incluso en 0), igual que "Vencidos"/"Próximos" — el
    // modal ya maneja su propio estado vacío ("Sin pendientes"), así que
    // condicionar la ACCIÓN por conteo solo desactivaba la tarjeta sin razón
    // (asimetría real encontrada y corregida: ver docs/SESSION_HANDOFF.md).
    expect(seccionSrc).toContain("dashActivityCard('Pendientes de validación', recordsPendientesValidacion.length, recordsPendientesValidacion.length ? 'amber' : 'neutral', 'pendientes-validacion')");
  });

  it('"Conflictos de validación" usa isRecordInConflict() (función central) — nunca hasValidationConflict() directo, para no contar un conflicto que Historial ya muestra como Histórico', () => {
    expect(src).toContain('const recordsConflictoValidacion = recordsParaValidacion.filter(r => isRecordInConflict(r, validations));');
  });

  it('el resto de indicadores secundarios (Total equipos/Anomalías) no se tocó — mismas acciones/condiciones de antes', () => {
    expect(src).toContain("dashActivityCard('Total equipos', equipos.length, 'neutral', allowedRoutes.includes('equipos') ? 'total-equipos' : null)");
    expect(src).toContain("dashActivityCard('Anomalías abiertas', openAnomalies, openAnomalies ? 'amber' : 'neutral', allowedRoutes.includes('anomalias') ? 'anomalias' : null)");
    expect(src).toContain("dashActivityCard('Conflictos de validación', recordsConflictoValidacion.length, recordsConflictoValidacion.length ? 'red' : 'neutral', 'conflictos-validacion')");
  });
});

describe('Mayor tiempo sin engrasar — ranking operativo compacto y acciones existentes', () => {
  const rowSrc = extractDeclaration(appSource, 'tiempoExcepcionRowHTML');

  it('ranking discreto sigue el índice del Top 5 sin cambiar su orden', () => {
    expect(rowSrc).toContain('class="dash-exc-rank"');
    expect(rowSrc).toContain('aria-label="Posición ${rank}"');
    expect(src).toContain('locPorId, idx === 0, idx + 1)');
  });

  it('header con título + "Ver todos" (sin contador feo pegado al texto) + resumen en vivo "Máximo: X d · CÓDIGO", nunca hardcodeado', () => {
    expect(src).toContain('<h3>Mayor tiempo sin engrasar</h3>');
    expect(src).toContain('id="dash-tiempo-ver-todos">Ver todos</button>');
    expect(src).toContain('Equipos ordenados por días desde el último engrase.');
    expect(src).toContain('const tiempoSinEngraseTop = tiempoSinEngrase[0] || null;');
    expect(src).toContain('const tiempoSinEngraseMaxDias = tiempoSinEngraseTop ? daysSinceLastGrease(tiempoSinEngraseTop.id) : null;');
    expect(src).toContain('Máximo: ${tiempoSinEngraseMaxDias} d');
  });

  it('el panel arma la lista con la MISMA fila (tiempoExcepcionRowHTML) para las 5 posiciones — sin bloque KPI aparte', () => {
    expect(src).not.toContain('data-kpi-action="tiempo-sin-engrase"');
    expect(src).toContain('class="dash-exc-list"');
    expect(src).toContain('tiempoSinEngrase.slice(0, 5).map((e, idx) => tiempoExcepcionRowHTML(e, lastRecordByEquipo[e.id], daysSinceLastGrease(e.id), locPorId, idx === 0, idx + 1))');
  });

  it('la fila trae código (línea 1, negrita), modelo·ubicación (línea 2), "Último engrase: fecha" (línea 3) y los días como campo aparte (jerarquía visual, no dentro del texto)', () => {
    expect(rowSrc).toContain('class="dash-exc-code dash-code-link mono"');
    expect(rowSrc).toContain('class="dash-exc-line2"');
    expect(rowSrc).toContain('aria-label="Último engrase"');
    expect(rowSrc).toContain('fmtDateOnly(last)');
    expect(rowSrc).toContain('fmtTime(last)');
    expect(rowSrc).toContain('datetime="${esc(last)}"');
    expect(rowSrc).toContain('class="dash-exc-days${isMax ? \' is-max\' : \'\'}"');
  });

  it('el peor caso (isMax) recibe SOLO un acento ámbar discreto (borde + color en los días), NUNCA una tarjeta separada ni distinto tamaño de fila', () => {
    expect(rowSrc).toContain("dash-exc-row operational-table-row${isMax ? ' is-max' : ''}");
    expect(rowSrc).not.toContain('is-worst');
  });

  it('REDISEÑO: acción PRINCIPAL visible — botón "Historial" pequeño (btn-sm), ya no chevron+fila-clickable-sin-control-visible', () => {
    expect(rowSrc).toContain('class="btn btn-sm dash-exc-hist-btn"');
    expect(rowSrc).not.toContain('dash-exc-chevron');
    expect(src).toContain("$$('.dash-exc-hist-btn', c).forEach(btn => {");
    expect(src).toContain("App.dashJumpEquipoId = btn.dataset.id; navigate('historial')");
  });

  it('texto explicativo corto pedido, sin la explicación técnica larga', () => {
    expect(src).toContain('Equipos ordenados por días desde el último engrase.');
    expect(src).not.toContain('independiente del vencimiento por horómetro');
  });

  it('"Ver todos" reutiliza la MISMA fila (tiempoExcepcionRowHTML) — nunca una tabla, nunca un botón Registrar, mismo orden descendente', () => {
    const iModal = src.indexOf('function openTiempoSinEngraseModal');
    const iEnd = src.indexOf('\n  }', iModal);
    const modalSrc = src.slice(iModal, iEnd);
    expect(modalSrc).toContain('tiempoExcepcionRowHTML(e, last, dias, locPorId, idx === 0)');
    expect(modalSrc).not.toContain('<table');
    expect(modalSrc).not.toContain('>Registrar<'); // el comentario SÍ puede mencionar la palabra; el BOTÓN no debe existir
  });

  it('lista de filas con separadores; desktop permite columnas tabulares sin ranking de cards', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    expect(cssSource).toMatch(/\.dash-exc-list\s*\{\s*display:\s*flex;\s*flex-direction:\s*column;/);
    expect(cssSource).toContain('border-bottom: 1px solid var(--border)'); // divisor sutil, no whitespace grande
    expect(cssSource).toContain('grid-template-columns: minmax(80px, 0.65fr)');
    expect(cssSource).not.toContain('.dash-tiempo-ranking');
  });

  it('REDISEÑO: el dato de días es un bloque destacado (número + etiqueta), no un texto aislado — con acento ámbar discreto en el top1', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    expect(cssSource).toContain('.dash-exc-days-wrap');
    expect(cssSource).toContain('.dash-exc-days-label');
    expect(cssSource).toMatch(/\.dash-exc-days-wrap\.is-max\s*\{\s*background:/);
  });

  it('REDISEÑO: "Historial" es ahora la acción PRINCIPAL visible (botón), ya no solo la fila entera clickable sin control visible', () => {
    expect(rowSrc).toContain('class="btn btn-sm dash-exc-hist-btn"');
    expect(rowSrc).toContain('>Historial<');
    expect(rowSrc).not.toContain('role="button" tabindex="0"');
    expect(src).toContain("$$('.dash-exc-hist-btn', c).forEach(btn => {");
    expect(src).toContain("App.dashJumpEquipoId = btn.dataset.id; navigate('historial')");
  });
});

describe('Rediseño — listas accionables respetan Ubicación/Familia y ofrecen Ver equipo/Historial/Registrar', () => {
  it('Al día/Próximos/Vencidos/Total equipos derivan de `statuses`/`attention` (ya filtrados arriba por dashUbic/dashFamilia)', () => {
    expect(src).toContain("const alDia = statuses.filter(x => x.s.code === 'VERDE');");
    expect(src).toContain("const proximos = attention.filter(x => x.s.code === 'AMARILLO');");
    expect(src).toContain("const vencidos = attention.filter(x => x.s.code === 'ROJO');");
  });

  it('"Realizados hoy" filtra la LISTA por el equipo filtrado, sin cambiar el número del KPI (doneToday intacto)', () => {
    expect(src).toContain('const equipoIdsFiltrados = new Set(equipos.map(e => e.id));');
    expect(src).toContain('equipoIdsFiltrados.has(r.equipmentId)');
    expect(src).toContain("const doneToday = records.filter(r => new Date(r.createdAt).toDateString() === today).length;");
  });

  it('Al día/Próximos/Vencidos/Total equipos/Realizados hoy ofrecen Ver equipo/Historial/Registrar (dashListRowActionsHTML)', () => {
    expect(src).toContain('dashListRowActionsHTML(x.e.id)');
    expect(src).toContain('dashListRowActionsHTML(eq.id)');
  });

});

describe('Rediseño — "Equipos que requieren atención" como cola operativa (reemplaza la tabla de 9 columnas)', () => {
  it('orden fijo por prioridad pedido: Vencido > Turno anterior > Pendiente hoy > Próximo > Sin plan > Pausado', () => {
    const iCola = src.indexOf('const colaAtencion = [');
    const iVenc = src.indexOf('vencidos.map(x =>', iCola);
    const iTurnoAnt = src.indexOf('pendientesTurnoAnterior.map(e =>', iCola);
    const iPendHoy = src.indexOf('pendientesHoyList.map(e =>', iCola);
    const iProx = src.indexOf('proximosSinHoy.map(x =>', iCola);
    const iSinPlan = src.indexOf('sinPlan].sort', iCola);
    const iPausados = src.indexOf('pausados.map(e =>', iCola);
    expect(iVenc).toBeLessThan(iTurnoAnt);
    expect(iTurnoAnt).toBeLessThan(iPendHoy);
    expect(iPendHoy).toBeLessThan(iProx);
    expect(iProx).toBeLessThan(iSinPlan);
    expect(iSinPlan).toBeLessThan(iPausados);
  });

  it('cada fila trae Estado/Código/Marca-modelo·Ubicación/Programación compacta/Plan aplicable, sin columnas que no aporten decisión', () => {
    expect(src).toContain('class="dash-cola-badge tone-${item.tone}">${item.estado}');
    expect(src).toContain('class="dash-cola-code dash-code-link mono" data-id="${item.e.id}">${esc(item.e.code)}');
    expect(src).toContain('class="dash-cola-meta dim">');
    expect(src).toContain("Plan: ${esc(item.plan)}");
    expect(src).toContain('class="dash-cola-prog-tag"');
    expect(src).not.toContain('Días sin engrase'); // columna descartada: no aporta decisión inmediata aquí
  });

  it('REDISEÑO densidad: ya NO hay "líneas" con el mismo flex-grow (dash-op-line2/3/4, causa real de los huecos horizontales) — fila plana con flex-wrap, badge/código/meta/programación/plan/acciones en orden', () => {
    const iCola = src.indexOf('function drawColaAtencion');
    const iFin = src.indexOf('drawColaAtencion();', iCola);
    const fnSrc = src.slice(iCola, iFin);
    expect(fnSrc).not.toContain('dash-op-line');
    // El orden en el HTML sigue la jerarquía pedida: estado, código, meta, programación, plan, acciones.
    const iBadge = fnSrc.indexOf('dash-cola-badge');
    const iCode = fnSrc.indexOf('dash-cola-code');
    const iMeta = fnSrc.indexOf('dash-cola-meta');
    const iProg = fnSrc.indexOf('dash-cola-prog-tag');
    const iPlan = fnSrc.indexOf('dash-cola-plan');
    const iActions = fnSrc.indexOf('dash-cola-actions');
    expect(iBadge).toBeLessThan(iCode);
    expect(iCode).toBeLessThan(iMeta);
    expect(iMeta).toBeLessThan(iProg);
    expect(iProg).toBeLessThan(iPlan);
    expect(iPlan).toBeLessThan(iActions);
  });

  it('progCompactaFor(): combina motivo+urgencia en un solo texto corto ("HOY · Sáb"/"VENCIDO · Sáb") para planes Día/turno; deja intacta la urgencia ya compacta de planes por horómetro ("Atraso"/"Restante")', () => {
    const iFn = src.indexOf('function progCompactaFor');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("item.urgencia.startsWith('Día: ')");
    expect(fnSrc).toContain("WEEKDAY_ABBR_DASH[item.urgencia.slice(5)]");
    expect(fnSrc).toContain("item.motivo.startsWith('Vencido')");
    expect(fnSrc).toContain('return item.urgencia;'); // horómetro: ya compacto, sin recalcular
  });

  it('planLabelFor(): Plan Día/turno usa días ABREVIADOS unidos por " · " (presentación) — plan.assignedDays (dato real) no se toca', () => {
    const iFn = src.indexOf('function planLabelFor');
    const fnSrc = src.slice(iFn, src.indexOf('\n  }', iFn));
    expect(fnSrc).toContain("plan.assignedDays.map(d => WEEKDAY_ABBR_DASH[d] || d).join(' · ')");
    expect(fnSrc).not.toContain('Día: ${'); // ya no antepone "Día:" (la fila ya dice "Plan:")
  });

  it('WEEKDAY_ABBR_DASH cubre los 7 días con las abreviaturas pedidas, sin alterar WEEKDAY_NAMES (dato completo real)', () => {
    expect(appSource).toContain("const WEEKDAY_ABBR_DASH = { 'Domingo': 'Dom', 'Lunes': 'Lun', 'Martes': 'Mar', 'Miércoles': 'Mié', 'Jueves': 'Jue', 'Viernes': 'Vie', 'Sábado': 'Sáb' };");
  });

  it('acción contextual por fila: Historial (deep-link) y Registrar (mismo flujo real, sin abrir OT)', () => {
    expect(src).toContain("App.dashJumpEquipoId = b.dataset.id; navigate('historial')");
    expect(src).toContain("$$('.dash-cola-reg', cont)");
    expect(src).toContain('startGreaseFlow(b.dataset.id)');
  });

  it('mantiene los filtros Turno/Día del bloque, con la MISMA regla de "Día asignado" que antes (excluye lo que no tenga ese plan)', () => {
    expect(src).toContain("if (!item.planObj || !item.planObj.assignedDays || !item.planObj.assignedDays.includes(diaFilter)) return false;");
  });

  it('respeta los filtros globales Ubicación/Familia (deriva de vencidos/proximos/sinPlan/pausados, ya filtrados arriba)', () => {
    const iCola = src.indexOf('const colaAtencion = [');
    const iDashUbic = src.indexOf('if (App.dashUbic) equipos = equipos.filter');
    expect(iDashUbic).toBeLessThan(iCola);
  });
});

describe('KPIs "Cumplimiento operativo" (Hoy/Semana/Turno actual) — conteo por ocurrencia', () => {
  it('el universo evaluable incluye planes semanales y planes con doble turno desde su fecha efectiva', () => {
    expect(src).toContain('const equiposDT = equipos.filter(e => {');
    expect(src).toContain("plan?.controlType === 'Día y turno de la semana' || dualConfigured");
    expect(src).toContain("&& !!plan.effectiveDate;");
  });

  it('nunca declara avgInterval ni multiplica/divide horómetro por tiempo (prohibido explícitamente, no proyección)', () => {
    expect(src).not.toMatch(/avgInterval|hourmeter\s*[*/]/);
  });

  it('"Hoy": el denominador y el numerador vienen de la lista de ocurrencias del día; DAY y NIGHT se cuentan por separado', () => {
    expect(src).toContain('function occurrencesForDate(e, date, shiftFilter = null)');
    expect(src).toContain('const ocurrenciasHoy = equiposDT.flatMap(e => occurrencesForDate(e, nowTs));');
    expect(src).toContain('const realizadasHoy = ocurrenciasHoy.filter(occurrenceIsComplete);');
    expect(src).toContain('const cumplHoy = { x: realizadasHoy.length, y: ocurrenciasHoy.length');
    expect(src).toContain('function turnoOk(plan, shiftId) { return !plan.shiftId || plan.shiftId === shiftId; }');
  });

  it('"Turno actual": filtra la lista central de ocurrencias por el shiftId real', () => {
    expect(src).toContain('const turnoActual = currentShiftId();');
    expect(src).toContain('const ocurrenciasTurno = ocurrenciasHoy.filter(o => o.shiftId === turnoActual);');
    expect(src).toContain('const realizadasTurno = ocurrenciasTurno.filter(occurrenceIsComplete);');
    expect(src).toContain('const cumplTurno = { x: realizadasTurno.length, y: ocurrenciasTurno.length');
  });

  it('"Semana": solo días YA TRANSCURRIDOS desde el Lunes hasta hoy (nunca días futuros) — sin proyección', () => {
    expect(src).toContain('function startOfWeek(d) {');
    expect(src).toContain('for (let d = startOfWeek(nowTs); d <= nowTs; d.setDate(d.getDate() + 1)) diasTranscurridosSemana.push(new Date(d));');
  });

  it('% = realizados/programados, redondeado; y=0 → null (nunca NaN/Infinity, nunca 0% inventado)', () => {
    expect(src).toContain('function cumplimientoPct(x, y) { return y ? Math.round((x / y) * 100) : null; }');
  });

  it('la tarjeta (dashComplianceCard, fuera de renderDashboard) muestra "X de Y programados", "Sin engrases programados" si y=0, y una barra en tono neutro cuando pct es null', () => {
    const cardSrc = extractDeclaration(appSource, 'dashComplianceCard');
    expect(cardSrc).toContain("c.y === 0 ? 'Sin engrases programados'");
    expect(cardSrc).toContain("c.pct === null ? '—'");
    expect(cardSrc).toContain("c.pct === null ? 0 : c.pct");
    expect(cardSrc).toContain("c.pct === null ? 'var(--text-dim)'");
  });

  it('NO se mezcla con "Equipos al día" (alDiaPct/counts) ni con computeFleetCompliance() histórico', () => {
    const cardSrc = extractDeclaration(appSource, 'dashComplianceCard');
    expect(cardSrc).not.toContain('alDiaPct');
    expect(cardSrc).not.toContain('computeFleetCompliance');
  });

  it('las 3 tarjetas se renderizan en un panel propio "Cumplimiento operativo", con texto explicativo corto (sin la explicación técnica larga)', () => {
    expect(src).toContain('<h3>Cumplimiento operativo</h3>');
    expect(src).toContain('Basado en planes programados por Día/Turno.<br>Los planes por Horas no se incluyen.');
    expect(src).not.toContain('no hay forma de saber si correspondía ejecutarlos en un período de calendario');
    expect(src).toContain("dashComplianceCard('Hoy', cumplHoy)");
    expect(src).toContain("dashComplianceCard('Semana', cumplSemana)");
    expect(src).toContain("dashComplianceCard(turnoActualLabel, cumplTurno)");
  });

  it('el label de "Turno actual" es dinámico: "Turno Día" o "Turno Noche" según currentShiftId()', () => {
    expect(src).toContain("const turnoActualLabel = turnoActual === 'shift_dia' ? 'Turno Día' : 'Turno Noche';");
  });
});

describe('Ajuste final — densidad visual de "Estado de lubricación"/"Actividad" y App.dashJumpEquipoId temporal', () => {
  it('PULIDO — "Actividad" ahora SÍ ocupa todo el ancho disponible (grid auto-fit real, ya no 4 columnas fijas con hueco/wrap forzado)', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    expect(cssSource).toContain('.dash-activity-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }');
    expect(cssSource).toMatch(/@media \(min-width: 601px\) \{ \.dash-activity-row \{ grid-template-columns: repeat\(auto-fit, minmax\(140px, 1fr\)\); \} \}/);
    expect(cssSource).not.toContain('minmax(150px, 240px)');
  });

  it('al menos 3 escrituras de App.dashJumpEquipoId (cola de atención, modales de listado, mayor tiempo sin engrasar), todas apuntando a navigate(\'historial\')', () => {
    const totalWrites = (appSource.match(/App\.dashJumpEquipoId = [\w.]+;\s*navigate\('historial'\)/g) || []).length;
    expect(totalWrites).toBeGreaterThanOrEqual(3);
  });

  it('renderHistorial() LEE y LIMPIA App.dashJumpEquipoId de inmediato (temporal, no queda selección vieja en la próxima navegación)', () => {
    const histSrc = extractDeclaration(appSource, 'renderHistorial');
    expect(histSrc).toContain('if (App.dashJumpEquipoId) {');
    const iIf = histSrc.indexOf('if (App.dashJumpEquipoId) {');
    const iRead = histSrc.indexOf('const jumpId = App.dashJumpEquipoId;', iIf);
    const iClear = histSrc.indexOf('App.dashJumpEquipoId = null;', iIf);
    const iUse = histSrc.indexOf('equipos.find(e => e.id === jumpId)', iIf);
    expect(iRead).toBeGreaterThan(iIf);
    // Se limpia ANTES de usarlo — si drawHistory()/renderEqHeader() lanzaran,
    // igual queda limpio y no se reintenta con un id viejo en el próximo render.
    expect(iClear).toBeGreaterThan(iRead);
    expect(iClear).toBeLessThan(iUse);
  });
});

describe('"Pendientes turno anterior" (sección E dedicada) — lista explícita de equipos, distinta de vencidos históricos, nunca convertida en KPI', () => {
  it('sección propia con su propio panel (#dash-pendientes-anterior-panel), no una tarjeta KPI', () => {
    expect(src).toContain('id="dash-pendientes-anterior-panel"');
    expect(src).toContain('<h3>Pendientes del turno anterior</h3>');
  });

  it('cuando hay pendientes, muestra los códigos reales (mismo array pendientesTurnoAnterior, sin recalcular)', () => {
    expect(src).toContain('${pendientesTurnoAnterior.length ? `');
    expect(src).toContain('${pendientesTurnoAnterior.map(e => `<span class="dash-motivo-chip mono">${esc(e.code)}</span>`).join(\'\')}');
  });

  it('cuando NO hay pendientes, no ocupa espacio excesivo (un solo empty-state corto, sin tabla ni lista vacía)', () => {
    const iPanel = src.indexOf('id="dash-pendientes-anterior-panel"');
    const panelSrc = src.slice(iPanel, iPanel + 700);
    expect(panelSrc).toContain('Ninguno — nada heredado del turno anterior.');
    expect(panelSrc).not.toContain('<table');
  });
});

describe('BUG REAL corregido (cierre operativo) — `turnoActual` se usaba (dentro de pendientesTurnoAnterior) ANTES de declararse', () => {
  it('const turnoActual = currentShiftId() aparece SOLO UNA VEZ, y ANTES de que pendientesTurnoAnterior lo use', () => {
    // Antes había una SEGUNDA declaración más abajo (sección "Cumplimiento
    // operativo") — `pendientesTurnoAnterior` (Panel operativo, declarado
    // ANTES de esa sección) ya leía `turnoActual` dentro de
    // `carry && carry.shiftId !== turnoActual`. Mientras `carry` fuera
    // null (sin ningún skip real ese día — el caso más común, el único que
    // cubrían los tests hasta ahora) el `&&` cortocircuitaba y la lectura
    // de `turnoActual` nunca llegaba a evaluarse, así que el bug quedó
    // invisible. En cuanto existiera un carryover REAL (justo el escenario
    // que esta sección existe para mostrar), `carry` se vuelve verdadero,
    // `turnoActual` se lee en su "temporal dead zone" (`const` usado antes
    // de su propia declaración) y TODO el render del Dashboard revienta con
    // un ReferenceError. Corregido subiendo la única declaración al
    // principio de la función.
    const ocurrencias = src.match(/const turnoActual = currentShiftId\(\);/g) || [];
    expect(ocurrencias).toHaveLength(1);

    const iDeclaracion = src.indexOf('const turnoActual = currentShiftId();');
    const iUsoPendientesTurnoAnterior = src.indexOf("const pendientesTurnoAnterior = equipos.filter(e => {");
    expect(iDeclaracion).toBeGreaterThan(-1);
    expect(iUsoPendientesTurnoAnterior).toBeGreaterThan(-1);
    expect(iDeclaracion).toBeLessThan(iUsoPendientesTurnoAnterior);
  });
});
