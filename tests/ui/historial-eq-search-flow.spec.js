// tests/ui/historial-eq-search-flow.spec.js
//
// Prueba de FLUJO REAL del buscador "Historial por equipo": carga las
// funciones REALES renderHistorial()/drawHistory()/equipoMatchesQuery()/$/$$
// /esc/ic (extraídas de app.js, sin reimplementar nada) dentro de una página
// real de Playwright, con DB/App/helpers de efectos secundarios reemplazados
// por stubs mínimos (fixtures en memoria, sin red ni IndexedDB real — mismo
// criterio de seguridad que el resto de la suite). Ejecuta el flujo completo:
// escribir en el buscador → aparecen resultados (debounce real) →
// seleccionar → se carga el encabezado/KPI del equipo correcto.
//
// Objetivo explícito de este archivo: confirmar (o refutar con evidencia)
// el reporte "el buscador de Historial por equipo no funciona".

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, PLAN_COMPLIANCE_JS_PATH, GREASE_VALIDATION_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const complianceSource = readSource(PLAN_COMPLIANCE_JS_PATH);
const validationSource = readSource(GREASE_VALIDATION_JS_PATH);

const REAL_NAMES = ['$', '$$', 'esc', 'ic', 'equipoMatchesQuery', 'complianceBadgeHTML', 'validationBadgeHTML', 'renderHistorial', 'drawHistory'];
const realSrc = REAL_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');
const fmtSrc = extractDeclaration(statusSource, 'fmt');
const weekdayNamesSrc = extractDeclaration(statusSource, 'WEEKDAY_NAMES');
const fmtDateSrc = extractDeclaration(appSource, 'fmtDate');
const complianceSrc = ['evaluateRecordCompliance', 'findPreviousRecord'].map(n => extractDeclaration(complianceSource, n)).join('\n\n');
// Validación del engrase (grease-validation.js) — la tabla de Engrases de
// drawHistory() ya tiene su columna "Validación" (openValidationModal se
// deja SIN cargar aquí a propósito: este spec no prueba ese flujo, ver
// tests/ui/grease-validation.spec.js — solo necesita que la columna renderice).
const validationSrc = ['VALIDATION_STATUS', 'VALIDATION_BADGE', 'GREASE_VALIDATION_ENABLED_FROM', 'MAX_VALIDATION_SHIFTS', 'isRecordSubjectToValidation', 'statusForSignerRole', 'findActiveValidations', 'hasValidationConflict', 'findActiveValidation', 'shiftKindAt', 'shiftDurationHours', 'shiftWindowStart', 'validationDeadline', 'isValidationExpired', 'validationStatusFor', 'validationStatusForRecord', 'isRecordPendingValidation', 'isRecordValidationExpired'].map(n => extractDeclaration(validationSource, n)).join('\n\n');

const EQUIPOS = [
  { id: 'e1', code: '45-77', shortCode: '45-77', brand: 'Caterpillar', model: '740B', typeId: 't1', locationId: 'l1', status: 'Operativo', hourmeter: 5200.5 },
  { id: 'e2', code: 'T-06', shortCode: '', brand: 'Caterpillar', model: 'D8T', typeId: 't2', locationId: 'l2', status: 'Operativo', hourmeter: 12480.5 },
  { id: 'e3', code: 'EXC-02', shortCode: '', brand: 'Komatsu', model: 'PC200', typeId: 't3', locationId: 'l3', status: 'Detenido', hourmeter: 8950 },
];
const TYPES = [{ id: 't1', name: 'Camión Articulado' }, { id: 't2', name: 'Tractor de Oruga' }, { id: 't3', name: 'Excavadora' }];
const LOCATIONS = [{ id: 'l1', name: 'Volcán' }, { id: 'l2', name: 'Rajo Principal' }, { id: 'l3', name: 'Botadero Norte' }];
const RECORDS = [
  { id: 'r1', equipmentId: 'e1', date: '2026-09-05T08:00:00', hourmeter: 5100, shiftId: 'shift_dia', userName: 'Juan Pérez', greaseType: 'lub1', qty: 1.5, condition: 'Normal', details: [], planId: 'p-dia' },
  { id: 'r2', equipmentId: 'e1', date: '2026-09-15T08:00:00', hourmeter: 5150, shiftId: 'shift_dia', userName: 'Juan Pérez', greaseType: 'lub1', qty: 1.4, condition: 'Normal', details: [], planId: 'p-dia' },
  { id: 'r3', equipmentId: 'e1', date: '2026-09-25T08:00:00', hourmeter: 5190, shiftId: 'shift_noche', userName: 'Ana G.', greaseType: 'lub1', qty: 1.6, condition: 'Normal', details: [], planId: 'p-dia' },
];
const RECORDS_HORAS_E2 = [
  { id: 'r4', equipmentId: 'e2', date: '2026-09-01T08:00:00', hourmeter: 12000, shiftId: 'shift_dia', userName: 'Juan Pérez', greaseType: 'lub1', qty: 1.5, condition: 'Normal', details: [], planId: 'p-horas' },
  { id: 'r5', equipmentId: 'e2', date: '2026-09-15T08:00:00', hourmeter: 12230, shiftId: 'shift_dia', userName: 'Juan Pérez', greaseType: 'lub1', qty: 1.5, condition: 'Normal', details: [], planId: 'p-horas' },
];
const ANOMALIES = [
  { id: 'a1', equipmentId: 'e1', createdAt: '2026-09-10T09:00:00', component: 'Motor', description: 'Fuga leve', criticality: 'Media', status: 'Cerrada' },
  { id: 'a2', equipmentId: 'e1', createdAt: '2026-09-22T09:00:00', component: 'Tren de rodaje', description: 'Ruido', criticality: 'Alta', status: 'Abierta' },
];

async function bootPage(page, plans = [], validations = []) {
  await page.setContent(`
    <div class="app-shell">
      <aside class="sidebar" id="sidebar"><nav class="menu"></nav></aside>
      <div class="main"><header class="topbar"><div class="topbar-title">Historial</div></header>
        <main id="app-content" class="app-content"></main>
      </div>
    </div>`);
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { name: 'Test', role: 'PLANIFICADOR' }, generalSettings: { shiftDayStart: 6, shiftNightStart: 18 } };
      window.DB = {
        allActive: async (store) => ({
          equipment: ${JSON.stringify(EQUIPOS)},
          equipment_types: ${JSON.stringify(TYPES)},
          locations: ${JSON.stringify(LOCATIONS)},
          lubrication_records: ${JSON.stringify([...RECORDS, ...RECORDS_HORAS_E2])},
          lubricants: [{ id: 'lub1', name: 'Grasa EP-2' }],
          anomalies: ${JSON.stringify(ANOMALIES)},
          lubrication_plans: ${JSON.stringify(plans)},
          grease_validations: ${JSON.stringify(validations)},
        }[store] || []),
        get: async (store, id) => (store === 'equipment' ? ${JSON.stringify(EQUIPOS)}.find(e => e.id === id) : null),
      };
      window.computeAllStatuses = async () => [];
      window.photoThumbsHTML = () => '<span class="dim">—</span>';
      window.wirePhotoThumbs = () => {};
      window.makeTablesResponsive = () => {};
      window.downloadCSV = () => {};
      window.openModal = () => {};
      window.logAudit = async () => {};
      window.stamp = (o) => o;
      window.showInAppToast = () => {};
      window.GREASE_UNIT = 'lb';

      ${fmtSrc}
      ${fmtDateSrc}
      ${weekdayNamesSrc}
      ${complianceSrc}
      window.evaluateRecordCompliance = evaluateRecordCompliance;
      window.findPreviousRecord = findPreviousRecord;
      ${validationSrc}
      window.VALIDATION_STATUS = VALIDATION_STATUS; window.VALIDATION_BADGE = VALIDATION_BADGE;
      window.validationStatusFor = validationStatusFor;
      ${realSrc}
      window.$ = $; window.$$ = $$; window.esc = esc; window.ic = ic;
      window.equipoMatchesQuery = equipoMatchesQuery;
      window.complianceBadgeHTML = complianceBadgeHTML;
      window.validationBadgeHTML = validationBadgeHTML;
      window.renderHistorial = renderHistorial;
      window.drawHistory = drawHistory;
      window.fmt = fmt; window.fmtDate = fmtDate;
    `,
  });
  await page.evaluate(() => window.renderHistorial());
}

test('REGRESIÓN causa raíz: #hist-eq-panel ya no recorta el dropdown (overflow-y visible)', async ({ page }) => {
  // Antes: .panel trae overflow:hidden y una regla posterior solo pisaba
  // overflow-x, dejando overflow-y:hidden — el dropdown (position:absolute,
  // se abre hacia abajo) quedaba clippeado e invisible para el usuario real,
  // aunque el DOM/lógica de filtrado funcionaran bien (por eso "no funciona"
  // no se detectaba con toHaveCount/toContainText). Ver styles.css.
  await bootPage(page);
  const overflowY = await page.locator('#hist-eq-panel').evaluate(el => getComputedStyle(el).overflowY);
  expect(overflowY).not.toBe('hidden');
});

test('escribir código parcial ("45-77") → aparece el resultado correcto', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('45-77');
  await page.waitForTimeout(400); // debounce real (~280ms) + margen
  const results = page.locator('.hist-eq-result');
  await expect(results).toHaveCount(1);
  await expect(results.first()).toContainText('45-77');
  await expect(results.first()).toContainText('740B');
});

test('escribir por modelo ("D8T") case-insensitive/minúsculas → coincide', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('d8t');
  await page.waitForTimeout(400);
  await expect(page.locator('.hist-eq-result')).toHaveCount(1);
  await expect(page.locator('.hist-eq-result')).toContainText('T-06');
});

test('escribir por marca ("Caterpillar") → 2 coincidencias (45-77 y T-06)', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('Caterpillar');
  await page.waitForTimeout(400);
  await expect(page.locator('.hist-eq-result')).toHaveCount(2);
});

test('escribir por ubicación ("Volcán") → coincide 45-77', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('Volcán');
  await page.waitForTimeout(400);
  await expect(page.locator('.hist-eq-result')).toHaveCount(1);
  await expect(page.locator('.hist-eq-result')).toContainText('45-77');
});

test('escribir por familia ("Excavadora") → coincide EXC-02', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('Excavadora');
  await page.waitForTimeout(400);
  await expect(page.locator('.hist-eq-result')).toHaveCount(1);
  await expect(page.locator('.hist-eq-result')).toContainText('EXC-02');
});

test('flujo completo: escribir → aparecen resultados → seleccionar → carga el detalle/KPI correcto', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('45-77');
  await page.waitForTimeout(400);
  await expect(page.locator('.hist-eq-result')).toHaveCount(1);

  await page.locator('.hist-eq-result').first().click();

  // El buscador se reemplaza por el encabezado del equipo SELECCIONADO (no otro).
  await expect(page.locator('.hist-eq-header-code')).toHaveText('45-77');
  await expect(page.locator('.hist-eq-header-model')).toContainText('740B');

  // El detalle/KPI carga con datos reales de ESE equipo (horómetro 5200.5 h,
  // fmt() redondea a 0 decimales por defecto → "5,201 h"; 3 engrases registrados
  // — sin fechas activas, la etiqueta es "registrados" (histórico total)).
  await expect(page.locator('.hist-kpi-grid .kpi-card').first()).toContainText('5,201');
  await expect(page.locator('.hist-kpi-grid .kpi-card').nth(1)).toContainText('3');
  await expect(page.locator('.hist-kpi-grid .kpi-card').nth(1)).toContainText('Engrases registrados');
  await expect(page.locator('#hist-eq-clear-dates')).toBeHidden();
});

test('búsqueda sin coincidencias muestra el estado vacío (no queda en blanco/roto)', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('xyz-inexistente');
  await page.waitForTimeout(400);
  await expect(page.locator('.hist-eq-empty')).toBeVisible();
  await expect(page.locator('.hist-eq-result')).toHaveCount(0);
});

test('vaciar el textbox oculta los resultados sin mostrar ningún detalle', async ({ page }) => {
  await bootPage(page);
  await page.locator('#hist-eq-search').fill('T-06');
  await page.waitForTimeout(400);
  await expect(page.locator('.hist-eq-result')).toHaveCount(1);
  await page.locator('#hist-eq-search').fill('');
  await page.waitForTimeout(400);
  await expect(page.locator('#hist-eq-results')).toHaveClass(/hidden/);
  await expect(page.locator('.hist-eq-header')).toHaveCount(0);
});

test.describe('Capturas de validación (prefijo _, no es regresión permanente)', () => {
  const SHOT_DIR = path.resolve('tests/screenshots/_validacion');
  fs.mkdirSync(SHOT_DIR, { recursive: true });

  test('captura: Por equipo @ 1366 (con equipo seleccionado)', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1100 });
    await bootPage(page);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();
    await page.screenshot({ path: path.join(SHOT_DIR, 'historial-tab-equipo-1366.png'), fullPage: true });
  });

  test('captura: Por equipo @ 412', async ({ page }) => {
    await page.setViewportSize({ width: 412, height: 900 });
    await bootPage(page);
    await page.screenshot({ path: path.join(SHOT_DIR, 'historial-tab-equipo-412.png'), fullPage: true });
  });

  test('captura: Historial global @ 1366', async ({ page }) => {
    await page.setViewportSize({ width: 1366, height: 1000 });
    await bootPage(page);
    await page.locator('.hist-tab[data-tab="global"]').click();
    await page.screenshot({ path: path.join(SHOT_DIR, 'historial-tab-global-1366.png'), fullPage: true });
  });
});

test.describe('Pestañas Por equipo / Historial global', () => {
  test('por defecto abre "Por equipo": pestaña activa + panel visible, global oculto', async ({ page }) => {
    await bootPage(page);
    await expect(page.locator('.hist-tab[data-tab="equipo"]')).toHaveClass(/active/);
    await expect(page.locator('[data-hist-panel="equipo"]')).toBeVisible();
    await expect(page.locator('[data-hist-panel="global"]')).toBeHidden();
  });

  test('cambiar a "Historial global" no navega ni recarga — alterna sin botón Buscar', async ({ page }) => {
    await bootPage(page);
    await page.locator('.hist-tab[data-tab="global"]').click();
    await expect(page.locator('.hist-tab[data-tab="global"]')).toHaveClass(/active/);
    await expect(page.locator('.hist-tab[data-tab="equipo"]')).not.toHaveClass(/active/);
    await expect(page.locator('[data-hist-panel="global"]')).toBeVisible();
    await expect(page.locator('[data-hist-panel="equipo"]')).toBeHidden();
    // La tabla global ya cargó sola (auto-run inicial), sin botón Buscar.
    await expect(page.locator('#gh-apply')).toHaveCount(0);
    await expect(page.locator('.hist-global-table tbody tr')).toHaveCount(5);
  });

  test('cambiar de pestaña y volver conserva el texto/resultados ya escritos (no se pierden)', async ({ page }) => {
    await bootPage(page);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await expect(page.locator('.hist-eq-result')).toHaveCount(1);

    await page.locator('.hist-tab[data-tab="global"]').click();
    await page.locator('.hist-tab[data-tab="equipo"]').click();

    await expect(page.locator('#hist-eq-search')).toHaveValue('45-77');
    await expect(page.locator('.hist-eq-result')).toHaveCount(1);
  });

  test('cambio de pestaña conserva filtros de fecha INDEPENDIENTES entre equipo y global', async ({ page }) => {
    await bootPage(page);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();
    await page.locator('#hist-eq-from').fill('2026-09-14');

    await page.locator('.hist-tab[data-tab="global"]').click();
    await page.locator('#gh-from').fill('2026-09-01');
    await page.locator('#gh-to').fill('2026-09-06');

    await page.locator('.hist-tab[data-tab="equipo"]').click();
    // El filtro del equipo sigue siendo el suyo — no se contagió con el global.
    await expect(page.locator('#hist-eq-from')).toHaveValue('2026-09-14');
    await expect(page.locator('#hist-eq-to')).toHaveValue('');

    await page.locator('.hist-tab[data-tab="global"]').click();
    // El filtro global sigue siendo el suyo — no se contagió con el del equipo.
    await expect(page.locator('#gh-from')).toHaveValue('2026-09-01');
    await expect(page.locator('#gh-to')).toHaveValue('2026-09-06');
  });
});

test.describe('Filtro de período (Desde/Hasta) del equipo seleccionado', () => {
  // 3 engrases (05/09, 15/09, 25/09) y 2 anomalías (10/09, 22/09) para e1.
  async function selectEquipo(page) {
    await bootPage(page);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();
  }

  test('equipo + Desde: excluye lo anterior, incluye lo posterior (AND con el equipo)', async ({ page }) => {
    await selectEquipo(page);
    await page.locator('#hist-eq-from').fill('2026-09-14');
    await expect(page.locator('.hist-table tbody tr')).toHaveCount(2); // 15/09 y 25/09, no 05/09
    const kpiEngrases = page.locator('.hist-kpi-grid .kpi-card').nth(1);
    await expect(kpiEngrases).toContainText('2');
    await expect(kpiEngrases).toContainText('en el período'); // etiqueta clara de período filtrado
    // Anomalías también filtradas por la misma fecha (AND): solo 22/09.
    await expect(page.locator('#hist-eq-content .panel:has-text("Anomalías") tbody tr')).toHaveCount(1);
  });

  test('equipo + Hasta: incluye lo anterior, excluye lo posterior', async ({ page }) => {
    await selectEquipo(page);
    await page.locator('#hist-eq-to').fill('2026-09-16');
    await expect(page.locator('.hist-table tbody tr')).toHaveCount(2); // 05/09 y 15/09, no 25/09
    await expect(page.locator('.hist-kpi-grid .kpi-card').nth(1)).toContainText('2');
  });

  test('equipo + rango (Desde y Hasta juntos): solo lo que cae dentro, AND con el equipo', async ({ page }) => {
    await selectEquipo(page);
    await page.locator('#hist-eq-from').fill('2026-09-06');
    await page.locator('#hist-eq-to').fill('2026-09-20');
    await expect(page.locator('.hist-table tbody tr')).toHaveCount(1); // solo 15/09
    await expect(page.locator('.hist-table tbody tr td').first()).toContainText('15/09/2026');
  });

  test('Desde/Hasta vacíos muestra todo el historial del equipo (sin filtrar)', async ({ page }) => {
    await selectEquipo(page);
    await expect(page.locator('.hist-table tbody tr')).toHaveCount(3);
    await expect(page.locator('.hist-kpi-grid .kpi-card').nth(1)).toContainText('Engrases registrados');
  });

  test('"Limpiar fechas" restaura el historial completo y oculta el botón', async ({ page }) => {
    await selectEquipo(page);
    await page.locator('#hist-eq-from').fill('2026-09-14');
    await expect(page.locator('.hist-table tbody tr')).toHaveCount(2);
    await expect(page.locator('#hist-eq-clear-dates')).toBeVisible();

    await page.locator('#hist-eq-clear-dates').click();
    await expect(page.locator('#hist-eq-from')).toHaveValue('');
    await expect(page.locator('.hist-table tbody tr')).toHaveCount(3);
    await expect(page.locator('#hist-eq-clear-dates')).toBeHidden();
    await expect(page.locator('.hist-kpi-grid .kpi-card').nth(1)).toContainText('Engrases registrados');
  });
});

test.describe('Cumplimiento del plan — columna en la tabla de Engrases', () => {
  // 2026-09-05=Sábado, 2026-09-15=Martes, 2026-09-25=Viernes.
  const PLAN_DIA = { id: 'p-dia', equipmentId: 'e1', controlType: 'Día y turno de la semana', assignedDays: ['Sábado', 'Viernes'], shiftId: 'shift_dia', updatedAt: '2026-08-01T00:00:00' };
  const PLAN_HORAS = { id: 'p-horas', equipmentId: 'e2', controlType: 'Horas de operación', frequency: 250, updatedAt: '2026-08-01T00:00:00' };

  test('cumplimiento Día/Turno: cumplido (sábado+día) y fuera de plan (día y turno equivocados)', async ({ page }) => {
    await bootPage(page, [PLAN_DIA]);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();

    const rows = page.locator('.hist-table tbody tr');
    // .first(): la fila ahora también trae el badge de Validación (misma
    // clase .hist-compliance-badge, columna siguiente) — el de Cumplimiento
    // siempre es el primero en el DOM dentro de la fila.
    // Orden descendente por fecha: r3 (25/09, Viernes/noche), r2 (15/09, Martes), r1 (05/09, Sábado/día).
    await expect(rows.nth(0).locator('.hist-compliance-badge').first()).toHaveText('Fuera de plan'); // turno equivocado
    await expect(rows.nth(1).locator('.hist-compliance-badge').first()).toHaveText('Fuera de plan'); // día no asignado
    await expect(rows.nth(2).locator('.hist-compliance-badge').first()).toHaveText('Cumplido');
  });

  test('cumplimiento por Horas: usa el horómetro REAL del registro anterior (no fecha proyectada)', async ({ page }) => {
    await bootPage(page, [PLAN_HORAS]);
    await page.locator('#hist-eq-search').fill('T-06');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();

    const rows = page.locator('.hist-table tbody tr');
    // r5 (15/09, 12230h) es el más reciente: previo r4=12000h, delta=230h, ratio=230/250=0.92 (0.90-1.10) → cumplido.
    await expect(rows.nth(0).locator('.hist-compliance-badge').first()).toHaveText('Cumplido');
    // r4 (01/09) es el primer registro del equipo: sin base de comparación → no evaluable.
    await expect(rows.nth(1).locator('.hist-compliance-badge').first()).toHaveText('No evaluable');
  });

  test('histórico sin plan asociado (o sin trazabilidad) → No evaluable, nunca Sí/No', async ({ page }) => {
    await bootPage(page, []); // sin ningún plan
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();

    // Solo el badge de Cumplimiento (columna 8 de la fila, td:nth-child(8)) —
    // el de Validación (columna 9) es un badge distinto ("Pendiente"), no forma parte de esta prueba.
    const badges = await page.locator('.hist-table tbody tr td:nth-child(8) .hist-compliance-badge').allTextContents();
    expect(badges.length).toBeGreaterThan(0);
    for (const b of badges) expect(b).toBe('No evaluable');
  });
});

test.describe('Validación del engrase — columna en la tabla de Engrases (lectura REAL de grease_validations)', () => {
  // Rollout activado (ver docs/BUG_REGISTER.md / grease-validation.js):
  // GREASE_VALIDATION_ENABLED_FROM ya no es null, pero los registros fijos de
  // este archivo (2026-09-25) siguen siendo ANTERIORES a ese baseline
  // (2026-09-27T12:00:00.000Z) — con la constante productiva real,
  // isRecordSubjectToValidation() sigue devolviendo false para ellos, así que
  // se muestran como Histórico (ver el test dedicado más abajo). Para probar
  // aquí las transiciones 0/1/active:false que sí necesitan un registro
  // SUJETO a validación, se define un baseline EXPLÍCITO solo en esta página
  // de prueba — nunca se toca la constante productiva para esto.
  async function activarBaselineDePrueba(page) {
    // Estas pruebas cubren las transiciones 0/1/active:false — no el plazo de
    // MAX_VALIDATION_SHIFTS turnos (eso se prueba aparte, con fechas
    // deterministas, en tests/unit/grease-validation.test.js). Los registros
    // aquí usan fechas fijas de calendario (2026-09-25) reutilizadas por
    // otras pruebas de este archivo (filtros de rango/día de la semana), así
    // que en vez de fechas dinámicas se aísla el plazo con un stub explícito
    // (mismo patrón que isRecordSubjectToValidation de abajo).
    await page.evaluate(() => {
      window.isRecordSubjectToValidation = () => true;
      window.isValidationExpired = () => false;
    });
  }

  test('sin ninguna validación activa: badge "Pendiente" + botón "Validar" en cada fila', async ({ page }) => {
    await bootPage(page, [], []);
    await activarBaselineDePrueba(page);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();

    const rows = page.locator('.hist-table tbody tr');
    await expect(rows.first().locator('.hist-compliance-badge').nth(1)).toHaveText('Engrasado · Pendiente de validación');
    await expect(rows.first().locator('.hist-validar-btn')).toBeVisible();
    await expect(rows.first().locator('.hist-ver-validacion-btn')).toHaveCount(0);
  });

  test('con una validación activa (Operador): badge "Validado · Operador" + botón "Ver validación" (no "Validar")', async ({ page }) => {
    const validations = [{ id: 'val_1', lubricationRecordId: 'r3', equipmentId: 'e1', signerName: 'Juan Pérez', signerRole: 'OPERADOR', signedAt: '2026-09-25T09:00:00', active: true }];
    await bootPage(page, [], validations);
    await activarBaselineDePrueba(page);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();

    // r3 (25/09) es la fila más reciente (orden descendente) → primera fila.
    const primera = page.locator('.hist-table tbody tr').first();
    await expect(primera.locator('.hist-compliance-badge').nth(1)).toHaveText('Validado · Operador');
    await expect(primera.locator('.hist-ver-validacion-btn')).toBeVisible();
    await expect(primera.locator('.hist-validar-btn')).toHaveCount(0);
  });

  test('una validación con active:false (revertida) sigue mostrando "Pendiente" — no cuenta', async ({ page }) => {
    const validations = [{ id: 'val_1', lubricationRecordId: 'r3', equipmentId: 'e1', signerName: 'Juan Pérez', signerRole: 'OPERADOR', signedAt: '2026-09-25T09:00:00', active: false }];
    await bootPage(page, [], validations);
    await activarBaselineDePrueba(page);
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();

    const primera = page.locator('.hist-table tbody tr').first();
    await expect(primera.locator('.hist-compliance-badge').nth(1)).toHaveText('Engrasado · Pendiente de validación');
  });

  test('con la constante productiva REAL (sin override): registros de 2026-09-25 (anteriores al baseline 2026-09-27T12:00Z) son "Histórico · Sin validación requerida", sin botón Validar/Ver validación', async ({ page }) => {
    const validations = [{ id: 'val_1', lubricationRecordId: 'r3', equipmentId: 'e1', signerName: 'Juan Pérez', signerRole: 'OPERADOR', signedAt: '2026-09-25T09:00:00', active: true }];
    await bootPage(page, [], validations); // sin activarBaselineDePrueba(): usa la constante productiva real
    await page.locator('#hist-eq-search').fill('45-77');
    await page.waitForTimeout(400);
    await page.locator('.hist-eq-result').first().click();

    const rows = page.locator('.hist-table tbody tr');
    const count = await rows.count();
    for (let i = 0; i < count; i++) {
      await expect(rows.nth(i).locator('.hist-compliance-badge').nth(1)).toHaveText('Histórico · Sin validación requerida');
      await expect(rows.nth(i).locator('.hist-validar-btn')).toHaveCount(0);
      await expect(rows.nth(i).locator('.hist-ver-validacion-btn')).toHaveCount(0);
    }
  });
});
