import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { extractDeclaration, readSource } from '../helpers/extractFromSource.js';

const root = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB');
const source = readSource(path.join(root, 'app.js'));
const before = execFileSync('git', ['show', 'c6e9372:CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/app.js'], { encoding: 'utf8' }).replace(/\r\n?/g, '\n');
const chart = path.join(os.tmpdir(), 'control-engrase-chart-4.4.4.umd.js');
const sections = ['rep-resumen', 'rep-turno-area', 'rep-equipo-area', 'rep-consumo-stats', 'rep-motivos-pareto', 'skipped-points-area', 'rep-anomalias-area', 'rep-no-ejecutados-area', 'rep-validacion-area', 'rep-actividad-resp-area'];

test.beforeAll(async () => {
  // La misma dependencia externa que index.html; cache temporal, sin instalar paquetes.
  if (!fs.existsSync(chart)) {
    const response = await fetch('https://cdn.jsdelivr.net/npm/chart.js@4.4.4/dist/chart.umd.min.js');
    if (!response.ok) throw new Error('Chart.js existente no disponible: '+response.status);
    fs.writeFileSync(chart, Buffer.from(await response.arrayBuffer()));
  }
});

async function boot(page, appSource = source) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('https://**/*', route => route.fulfill({ body: '', contentType: 'text/css' }));
  await page.goto('about:blank');
  await page.setContent('<main id="app-content" class="app-content"></main>');
  await page.addStyleTag({ path: path.join(root, 'styles.css') });
  await page.addScriptTag({ path: chart });
  const names = ['$', '$$', 'esc', 'ic', 'fmtDate', 'ddmmyyyy', 'GREASE_UNIT', 'kpiCard', 'prefersReducedMotion', 'construirBucketsTendencia', 'makeTablesResponsive', 'renderReportes'];
  const declarations = names.map(name => extractDeclaration(appSource, name)).join('\n');
  const coreNames = [['lubrication-status.js', ['fmt', 'WEEKDAY_NAMES']], ['plan-compliance.js', ['computeProgramadoRealizadoPeriodo']]];
  const core = coreNames.flatMap(([file, names]) => names.map(name => extractDeclaration(readSource(path.join(root, 'src/core', file)), name))).join('\n');
  await page.addScriptTag({ content: `
    const App = { generalSettings: { complianceTarget: 95 } };
    const GREASE_VALIDATION_ENABLED_FROM = '2020-01-01'; const MAX_VALIDATION_SHIFTS = 2;
    const NO_EXECUTION_REASON_LABELS = { OTHER: 'Otro' };
    const isRecordSubjectToValidation = () => true;
    const findActiveValidations = (id, rows) => rows.filter(v => v.recordId === id);
    const isRecordValidationExpired = () => false;
    const resolveRecordEquipmentLocationId = (r, e) => ({ value: e.locationId });
    const computeAllStatuses = async eqs => eqs.map(e => ({ e, s: { label: 'Operativo' } }));
    const resolveEvidenceSrc = async photo => photo;
    const evidenceValueAttr = () => '';
    window.__viewer = []; const openPhotoLightbox = (...args) => window.__viewer.push(args);
    window.__exports = []; const downloadCSV = (...args) => window.__exports.push(args);
    const dataset = {
      equipment: [1,2,3].map(i => ({ id: 'E'+i, code: 'TEST-'+i, brand: 'Marca', model: 'Modelo largo '+i, status: 'Operativo', typeId: 'T1', locationId: 'L1', hourmeter: 100 })),
      lubrication_plans: [1,2,3].map(i => ({ equipmentId: 'E'+i, controlType: 'Día y turno de la semana', assignedDays: ['Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'], shiftId: 'shift_dia' })),
      lubrication_records: [1,2,3].map(i => ({ id: 'R'+i, equipmentId: 'E'+i, date: '2026-09-21T08:00:00', shiftId: 'shift_dia', userId: 'U1', userName: 'Persona ficticia', qty: i*2, greaseType: 'G1', condition: 'Normal', details: [{ pointName: 'Punto controlado', done: false, reason: 'Línea obstruida' }], photo: 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="200" height="150"><rect width="200" height="150" fill="gray"/></svg>') })),
      users: [{ id:'U1', name:'Persona ficticia', cuadrillaId:'C1' }], locations:[{ id:'L1', name:'Ubicación ficticia' }], equipment_types:[{ id:'T1', name:'Familia ficticia' }], lubricants:[{ id:'G1', name:'Grasa ficticia' }], cuadrillas:[{ id:'C1', name:'Cuadrilla ficticia' }],
      anomalies: [{ equipmentId:'E1', createdAt:'2026-09-21T08:00:00', createdBy:'Persona ficticia', component:'Sistema', status:'Abierta' }],
      lubrication_skips: [], grease_validations:[{ recordId:'R1', signerRole:'OPERADOR' }, { recordId:'R2', signerRole:'ENCARGADO' }, { recordId:'R2', signerRole:'OPERADOR' }]
    };
    const DB = { allActive: async name => dataset[name] || [], all: async name => dataset[name] || [] };
    ${core}\n${declarations}
    window.__render = renderReportes;
  ` });
  await page.evaluate(() => window.__render());
  await page.locator('#f-from').fill('2026-09-21');
  await page.locator('#f-to').fill('2026-09-27');
  await page.locator('#f-apply').click();
  await expect(page.locator('#chart-consumo')).toBeVisible();
  return errors;
}

async function snapshot(page) {
  return page.evaluate(ids => ({
    values: ids.map(id => [...document.querySelectorAll('#'+id+' .kpi-value, #'+id+' .rep-turno-pct, #'+id+' .rep-turno-frac, #'+id+' td, #'+id+' .skipped-chip, #'+id+' .rep-consumo-row, #'+id+' .rep-actividad-row:not(.rep-actividad-head)')].map(el => el.textContent.trim())),
    charts: ['chart-tendencia', 'chart-consumo'].map(id => { const chart = Chart.getChart(document.getElementById(id)); return { labels: [...chart.data.labels], values: chart.data.datasets.map(d => [...d.data]) }; }),
  }), sections);
}

test('Reportes reales: métricas, datasets, filtros, tabs y CSV idénticos al HEAD inicial', async ({ page }) => {
  const previousErrors = await boot(page, before);
  const previous = await snapshot(page);
  const previousTabs = [];
  for (const tab of ['familia', 'lubricante']) { await page.locator('[data-tab="'+tab+'"]').click(); previousTabs.push(await snapshot(page)); }
  await page.locator('.rep-more-exports').evaluate(el => el.open = true);
  for (const id of ['exp-cumplimiento', 'exp-historico', 'exp-anomalias', 'exp-puntos']) await page.locator('#'+id).click();
  const exportsBefore = await page.evaluate(() => window.__exports);
  expect(previousErrors).toEqual([]);
  const errors = await boot(page);
  expect(await snapshot(page)).toEqual(previous);
  for (const [index, tab] of ['familia', 'lubricante'].entries()) { await page.locator('[data-tab="'+tab+'"]').click(); expect(await snapshot(page)).toEqual(previousTabs[index]); }
  await page.locator('.rep-more-exports').evaluate(el => el.open = true);
  for (const id of ['exp-cumplimiento', 'exp-historico', 'exp-anomalias', 'exp-puntos']) await page.locator('#'+id).click();
  expect(await page.evaluate(() => window.__exports)).toEqual(exportsBefore);
  await page.locator('#f-equipo').selectOption('E1'); await page.locator('#f-apply').click();
  await expect(page.locator('#rep-equipo-area tbody tr')).toHaveCount(1);
  await page.locator('#rep-photo-toggle').click(); await page.locator('.photo-thumb-lg').first().click();
  expect(await page.evaluate(() => window.__viewer.length)).toBe(1);
  expect(errors).toEqual([]);
});

test('Reportes reales: siete anchos, cuatro modos, gráficos, tablas, touch y focus', async ({ page }, info) => {
  const errors = await boot(page);
  await page.locator('#rep-photo-toggle').click();
  for (const mode of ['light','dark','sun','contrast']) {
    await page.evaluate(mode => { document.documentElement.dataset.mode = mode; document.documentElement.dataset.theme = 'amarillo-cat'; }, mode);
    for (const width of [360,390,412,768,1024,1366,1920]) {
      await page.setViewportSize({ width, height:900 });
      await page.locator('#f-apply').click();
      await page.waitForTimeout(100);
      const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth, controls: [...document.querySelectorAll('.rep-page button, .rep-page input, .rep-page select')].filter(el => el.getBoundingClientRect().height).every(el => el.getBoundingClientRect().height >= 44), canvases: [...document.querySelectorAll('.rep-page canvas')].every(el => el.getBoundingClientRect().width <= el.parentElement.clientWidth && el.width > 0) }));
      expect(geometry, mode+' '+width).toEqual({ overflow:false, controls:true, canvases:true });
      const turno = await page.locator('#rep-turno-area').boundingBox();
      const panel = await page.locator('#rep-turno-area').evaluate(el => el.closest('.panel').getBoundingClientRect().width);
      expect(turno.width, mode+' '+width).toBeGreaterThan(panel - 40);
      const contrast = await page.evaluate(() => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1; const ctx = canvas.getContext('2d');
        const pixel = color => { ctx.clearRect(0,0,1,1); ctx.fillStyle = color; ctx.fillRect(0,0,1,1); return [...ctx.getImageData(0,0,1,1).data]; };
        const luminance = rgb => { const values = rgb.slice(0,3).map(v => { v /= 255; return v <= .04045 ? v/12.92 : ((v+.055)/1.055)**2.4; }); return values[0]*.2126+values[1]*.7152+values[2]*.0722; };
        return [...document.querySelectorAll('.rep-page .kpi-label, .rep-page .rep-subhead, .rep-page .rep-tab, .rep-page .data-table th, .rep-page .skipped-chip, .rep-page .motivo-tag, .rep-page .rep-actividad-nota')].filter(el => el.getBoundingClientRect().height).map(el => {
          const parents = []; for (let p=el;p;p=p.parentElement) parents.unshift(p);
          let bg = [255,255,255]; parents.forEach(p => { const c=pixel(getComputedStyle(p).backgroundColor), alpha=c[3]/255; bg=bg.map((v,i)=>c[i]*alpha+v*(1-alpha)); });
          const a=luminance(pixel(getComputedStyle(el).color)), b=luminance(bg);
          return { text:el.textContent.trim().slice(0,50), ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05) };
        }).filter(item => item.ratio < 4.5);
      });
      expect(contrast, mode+' '+width).toEqual([]);
      await page.keyboard.press('Tab');
      await page.locator('[data-tab="familia"]').focus();
      expect(await page.locator('[data-tab="familia"]').evaluate(el => getComputedStyle(el).outlineStyle)).not.toBe('none');
      await page.locator('.rep-page').screenshot({ path:info.outputPath('reports-'+mode+'-'+width+'.png') });
    }
  }
  expect(errors).toEqual([]);
});
