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
  it('abre un modal propio (no reutiliza el de sin-plan, son conjuntos distintos)', () => {
    expect(src).toContain("openPausadosModal(pausados, types, locations)");
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
    expect(rowSrc).toContain("last ? fmtDate(last) : 'Sin registro'");
  });
  it('la columna de días es independiente de counts.ROJO/AMARILLO (vencimiento por horómetro) — usa daysSinceLastGrease(), no s.remaining/s.code', () => {
    const panelSrc = src.slice(src.indexOf('dash-tiempo-sin-engrase-panel'), src.indexOf('dash-attention-panel'));
    expect(panelSrc).toContain('daysSinceLastGrease(e.id)');
    expect(panelSrc).not.toMatch(/s\.remaining|s\.code/);
  });
  it('limita a los 10 peores casos (no una tabla sin límite)', () => {
    expect(src).toContain('.slice(0, 10)');
  });
});

describe('Ajuste final — panel "Equipos al día" (%+barra+"X de Y") ELIMINADO, solo queda la tarjeta destacada', () => {
  it('no existe más el panel duplicado (h3, pill de %, barra ni subtítulo "X de Y evaluables")', () => {
    expect(src).not.toContain('<h3>Equipos al día</h3>');
    expect(src).not.toContain('dash-al-dia-sub');
    expect(src).not.toContain('alDiaBase');
    expect(src).not.toContain('alDiaPct');
  });

  it('la tarjeta "Al día" de "Estado de lubricación" sigue intacta (no se tocó su cálculo ni su acción)', () => {
    expect(src).toContain("dashHeroCard('Al día', counts.VERDE, 'green', 'al-dia')");
  });
});

describe('Rediseño — "Estado de lubricación" (jerarquía alta) y "Actividad" (discreta)', () => {
  it('5 tarjetas destacadas: Al día/Próximos/Vencidos/Sin plan/Pausados, con acción propia', () => {
    expect(src).toContain("dashHeroCard('Al día', counts.VERDE, 'green', 'al-dia')");
    expect(src).toContain("dashHeroCard('Próximos', counts.AMARILLO, 'amber', 'proximos')");
    expect(src).toContain("dashHeroCard('Vencidos', counts.ROJO, 'red', 'vencidos')");
    expect(src).toContain("dashHeroCard('Sin plan', sinPlan.length");
    expect(src).toContain("dashHeroCard('Pausados', pausados.length, 'neutral', pausados.length ? 'pausados' : null)");
  });

  it('3 tarjetas de actividad, discretas y separadas del bloque destacado', () => {
    expect(src).toContain("dashActivityCard('Total equipos'");
    expect(src).toContain("dashActivityCard('Realizados hoy'");
    expect(src).toContain("dashActivityCard('Anomalías abiertas'");
    // Las 2 secciones existen como bloques separados (jerarquía visual distinta).
    const iHero = src.indexOf('Estado de lubricación');
    const iActividad = src.indexOf('>Actividad<');
    expect(iHero).toBeGreaterThan(-1);
    expect(iActividad).toBeGreaterThan(iHero);
  });

  it('ya no existe el "kpi-grid" plano de 8 tarjetas iguales ni el grid "Semáforo de equipos" (menos tarjetas iguales, dedup)', () => {
    expect(src).not.toContain("kpiCard('TOTAL EQUIPOS'");
    expect(src).not.toContain('Semáforo de equipos');
    expect(src).not.toContain('equipmentCard(x.e, x.s,');
  });
});

describe('CORRECCIÓN CENTRAL — "Actividad" ya NO tiene su propia excepción para baseline null; depende 100% de las funciones centrales', () => {
  const activityCardSrc = extractDeclaration(appSource, 'dashActivityCard');

  it('dashActivityCard() vuelve a su firma simple (sin workaround local de "—"/subtext) — el 0 real ya sale solo de la función central', () => {
    expect(activityCardSrc).toContain('function dashActivityCard(label, value, tone, action) {');
    expect(activityCardSrc).toContain('${fmt(value)}');
    expect(activityCardSrc).not.toContain('subtext');
    expect(activityCardSrc).not.toContain('Number.isFinite');
  });

  it('"Realizados hoy" usa tono verde discreto (acento positivo), ya no neutral', () => {
    expect(src).toContain("dashActivityCard('Realizados hoy', doneToday, 'green'");
  });

  it('"Pendientes de validación" es UNA SOLA rama — recordsPendientesValidacion.length directo, SIN chequeo propio de GREASE_VALIDATION_ENABLED_FROM en el Dashboard', () => {
    const iSecActividad = src.indexOf('dash-activity-row');
    const iFinSeccion = src.indexOf('</section>', iSecActividad);
    const seccionSrc = src.slice(iSecActividad, iFinSeccion);
    expect(seccionSrc).not.toContain('GREASE_VALIDATION_ENABLED_FROM'); // sin excepción propia de pantalla
    expect(seccionSrc).toContain("dashActivityCard('Pendientes de validación', recordsPendientesValidacion.length, recordsPendientesValidacion.length ? 'amber' : 'neutral', recordsPendientesValidacion.length ? 'pendientes-validacion' : null)");
  });

  it('"Conflictos de validación" usa isRecordInConflict() (función central) — nunca hasValidationConflict() directo, para no contar un conflicto que Historial ya muestra como Histórico', () => {
    expect(src).toContain('const recordsConflictoValidacion = recordsParaValidacion.filter(r => isRecordInConflict(r, validations));');
  });

  it('el resto de "Actividad" (Total equipos/Realizados hoy/Anomalías/Conflictos) no se tocó — mismas acciones/condiciones de antes', () => {
    expect(src).toContain("dashActivityCard('Total equipos', equipos.length, 'neutral', allowedRoutes.includes('equipos') ? 'total-equipos' : null)");
    expect(src).toContain("dashActivityCard('Anomalías abiertas', openAnomalies, openAnomalies ? 'amber' : 'neutral', allowedRoutes.includes('anomalias') ? 'anomalias' : null)");
    expect(src).toContain("recordsConflictoValidacion.length > 0 ? dashActivityCard('Conflictos de validación', recordsConflictoValidacion.length, 'red', 'conflictos-validacion') : ''");
  });
});

describe('Rediseño DEFINITIVO — "Mayor tiempo sin engrasar" como LISTA COMPACTA de excepciones (Fiix/UpKeep/Fracttal), NUNCA ranking #1/#2/#3 ni cards', () => {
  const rowSrc = extractDeclaration(appSource, 'tiempoExcepcionRowHTML');

  it('NO hay número de ranking (#1/#2/#3) en ningún lado — ni en la fila ni en el src', () => {
    expect(rowSrc).not.toMatch(/#\$\{idx/);
    expect(rowSrc).not.toContain('dash-tiempo-rank');
    expect(src).not.toContain('dash-tiempo-rank');
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
    expect(src).toContain('tiempoSinEngrase.slice(0, 5).map((e, idx) => tiempoExcepcionRowHTML(e, lastRecordByEquipo[e.id], daysSinceLastGrease(e.id), locPorId, idx === 0))');
  });

  it('la fila trae código (línea 1, negrita), modelo·ubicación (línea 2), "Último engrase: fecha" (línea 3) y los días como campo aparte (jerarquía visual, no dentro del texto)', () => {
    expect(rowSrc).toContain('class="dash-exc-code mono"');
    expect(rowSrc).toContain('class="dash-exc-line2"');
    expect(rowSrc).toContain('Último engrase: ${last ? fmtDate(last) : \'Sin registro\'}');
    expect(rowSrc).toContain('class="dash-exc-days${isMax ? \' is-max\' : \'\'}"');
  });

  it('el peor caso (isMax) recibe SOLO un acento ámbar discreto (borde + color en los días), NUNCA una tarjeta separada ni distinto tamaño de fila', () => {
    expect(rowSrc).toContain("dash-exc-row${isMax ? ' is-max' : ''}");
    expect(rowSrc).not.toContain('is-worst');
  });

  it('acción ÚNICA y discreta: chevron "›" (NO botón grande, NO "Historial" como botón) — toda la fila es clickable/focuseable a Historial', () => {
    expect(rowSrc).toContain('class="dash-exc-chevron"');
    expect(rowSrc).not.toContain('<button');
    expect(rowSrc).toContain('role="button" tabindex="0"');
    expect(src).toContain("$$('.dash-exc-row', c).forEach(row => {");
    expect(src).toContain("App.dashJumpEquipoId = row.dataset.id; navigate('historial')");
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

  it('grid/ranking eliminados: la lista es vertical (flex-column) de filas bajas con divisores sutiles, no un grid de cards', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    expect(cssSource).toContain('.dash-exc-list { display: flex; flex-direction: column; padding: 0 14px 10px; }');
    expect(cssSource).toContain('border-bottom: 1px solid var(--border)'); // divisor sutil, no whitespace grande
    expect(cssSource).not.toMatch(/\.dash-exc-(list|row)\s*\{[^}]*display:\s*grid/);
    expect(cssSource).not.toContain('.dash-tiempo-ranking');
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
  it('orden fijo por prioridad: Vencidos > Próximos > Sin plan > Pausados', () => {
    const iCola = src.indexOf('const colaAtencion = [');
    const iVenc = src.indexOf('vencidos.map(x =>', iCola);
    const iProx = src.indexOf('proximos.map(x =>', iCola);
    const iSinPlan = src.indexOf('sinPlan].sort', iCola);
    const iPausados = src.indexOf('pausados.map(e =>', iCola);
    expect(iVenc).toBeLessThan(iProx);
    expect(iProx).toBeLessThan(iSinPlan);
    expect(iSinPlan).toBeLessThan(iPausados);
  });

  it('cada fila trae Estado/Código/Marca-modelo/Ubicación/Motivo/Plan aplicable/Urgencia, sin columnas que no aporten decisión', () => {
    expect(src).toContain('class="dash-cola-badge tone-${item.tone}">${item.estado}');
    expect(src).toContain('class="dash-op-line3 dim">${esc(item.motivo)}');
    expect(src).toContain("Plan: ${esc(item.plan)}");
    expect(src).toContain('class="dash-cola-urgencia"');
    expect(src).not.toContain('Días sin engrase'); // columna descartada: no aporta decisión inmediata aquí
  });

  it('estructura en líneas fijas (jerarquía: badge+código+urgencia / modelo·ubicación / motivo / plan / acciones), sin min-height/flex-wrap que generen huecos en móvil', () => {
    const iCola = src.indexOf('function drawColaAtencion');
    const iFin = src.indexOf('drawColaAtencion();', iCola);
    const fnSrc = src.slice(iCola, iFin);
    expect(fnSrc).toContain('class="dash-op-line1"');
    expect(fnSrc).toContain('class="dash-op-line2"');
    expect(fnSrc).toContain('class="dash-op-line4"');
    // El orden en el HTML sigue exactamente la jerarquía pedida.
    const iL1 = fnSrc.indexOf('dash-op-line1');
    const iL2 = fnSrc.indexOf('dash-op-line2');
    const iL3 = fnSrc.indexOf('dash-op-line3');
    const iL4 = fnSrc.indexOf('dash-op-line4');
    const iActions = fnSrc.indexOf('dash-cola-actions');
    expect(iL1).toBeLessThan(iL2);
    expect(iL2).toBeLessThan(iL3);
    expect(iL3).toBeLessThan(iL4);
    expect(iL4).toBeLessThan(iActions);
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

describe('KPIs "Cumplimiento operativo" (Hoy/Semana/Turno actual) — realizados/programados, SOLO Día/Turno', () => {
  it('el universo evaluable son equipos OPERATIVOS con plan "Día y turno de la semana" — Horas queda excluido a propósito', () => {
    expect(src).toContain("const equiposDT = equipos.filter(e => e.status === 'Operativo' && (planByEquipoId[e.id] || {}).controlType === 'Día y turno de la semana');");
  });

  it('nunca declara avgInterval ni multiplica/divide horómetro por tiempo (prohibido explícitamente, no proyección)', () => {
    expect(src).not.toMatch(/avgInterval|hourmeter\s*[*/]/);
  });

  it('"Hoy": programado = plan.assignedDays incluye el día real de hoy; hecho = registro real de hoy con turno acorde al plan', () => {
    expect(src).toContain("const progHoy = equiposDT.filter(e => (planByEquipoId[e.id].assignedDays || []).includes(hoyWeekday));");
    expect(src).toContain('const hechoHoy = progHoy.filter(e => hechoEnFecha(e.id, planByEquipoId[e.id], today));');
    expect(src).toContain('function turnoOk(plan, shiftId) { return !plan.shiftId || plan.shiftId === shiftId; }');
  });

  it('"Turno actual": subconjunto de lo programado hoy cuyo turno coincide con currentShiftId(), hecho EN ese turno específico', () => {
    expect(src).toContain('const turnoActual = currentShiftId();');
    expect(src).toContain('const progTurno = progHoy.filter(e => turnoOk(planByEquipoId[e.id], turnoActual));');
    expect(src).toContain("r.shiftId === turnoActual");
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
  it('PULIDO — "Actividad" ahora SÍ ocupa todo el ancho disponible (grid responsive real, ya no ancho fijo agrupado a la izquierda)', () => {
    const cssSource = readSource(STYLES_CSS_PATH);
    expect(cssSource).toContain('.dash-activity-row { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }');
    expect(cssSource).toMatch(/@media \(min-width: 601px\) \{ \.dash-activity-row \{ grid-template-columns: repeat\(4, minmax\(0, 1fr\)\); \} \}/);
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
