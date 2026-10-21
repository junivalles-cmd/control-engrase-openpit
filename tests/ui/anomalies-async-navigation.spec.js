import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const real = ['$', '$$', 'esc', 'ic', 'renderAnomalias'].map(n => extractDeclaration(source, n)).join('\n');
async function boot(page, phase) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.setContent('<main id="app-content"></main>');
  await page.addScriptTag({ content: `
    window.App = {route:'anomalias',currentUser:{id:'lub',role:'LUBRICADOR'}};
    window.__errors = [];
    window.__row = {id:'a1',equipmentId:'e1',component:'Punto',description:'Old load',status:'Abierta',criticality:'Media'};
    window.__gate = {}; __gate.promise = new Promise((resolve,reject) => Object.assign(__gate,{resolve,reject}));
    window.__phase = ${JSON.stringify(phase)};
    window.DB = {allActive: async store => {
      if(store === 'anomalies') return __phase === 'data' ? __gate.promise : [__row];
      return [{id:'e1',code:'TEST'}];
    }};
    window.resolvePhotoThumbSrcs = () => __phase === 'photos' ? __gate.promise : Promise.resolve([]);
    window.CRIT_COLOR = {}; window.fmtDate = () => 'Fecha'; window.photoThumbsHTML = () => '';
    window.wirePhotoThumbs = () => {}; window.makeTablesResponsive = () => {};
    window.openAnomalyForm = () => {};
    ${real}
    window.startRun = () => { App.route = 'anomalias'; window.__run = renderAnomalias().catch(e => __errors.push(e.stack)); };
    window.leave = route => { App.route = route; document.querySelector('#app-content').innerHTML = '<h2 id="destination">'+route+'</h2>'; };
    startRun();
  ` });
  if (phase === 'photos') await expect(page.locator('#anom-table')).toBeVisible();
  return errors;
}
async function settle(page, reject = false) {
  await page.evaluate(async reject => {
    if(reject) __gate.reject(new Error('Controlled network failure'));
    else __gate.resolve(__phase === 'data' ? [__row] : []);
    await __run;
    await new Promise(r => setTimeout(r, 0));
  }, reject);
}
for (const phase of ['data','photos']) {
  for (const destination of ['turno','tareas-mensajes','historial','lubconfig']) {
    test(`${phase} load cannot overwrite ${destination} after leaving`, async ({page}) => {
      const errors = await boot(page, phase);
      await page.evaluate(route => leave(route), destination);
      await settle(page);
      await expect(page.locator('#destination')).toHaveText(destination);
      expect(await page.evaluate(() => App.route)).toBe(destination);
      expect(await page.evaluate(() => __errors)).toEqual([]);
      expect(errors).toEqual([]);
    });
  }
  test(`${phase} network error after leaving is silent`, async ({page}) => {
    const errors = await boot(page, phase);
    await page.evaluate(() => leave('historial'));
    await settle(page, true);
    await expect(page.locator('#destination')).toHaveText('historial');
    expect(await page.evaluate(() => __errors)).toEqual([]);
    expect(errors).toEqual([]);
  });
  test(`${phase} first run never overwrites a newer anomaly render`, async ({page}) => {
    const errors = await boot(page, phase);
    await page.evaluate(async () => {
      leave('turno');
      const oldRun = __run;
      const oldGate = __gate;
      __phase = 'ready';
      DB.allActive = async store => store === 'anomalies' ? [{...__row,description:'New load'}] : [{id:'e1',code:'TEST'}];
      resolvePhotoThumbSrcs = async () => [];
      startRun(); await __run;
      oldGate.resolve([{...__row,description:'Old load'}]);
      await oldRun; await new Promise(r => setTimeout(r, 0));
    });
    await expect(page.locator('#anom-table')).toContainText('New load');
    await expect(page.locator('#anom-table')).not.toContainText('Old load');
    expect(errors).toEqual([]);
  });
}

test('an active-view failure is not silently swallowed', async ({page}) => {
  await boot(page, 'data');
  await settle(page, true);
  expect(await page.evaluate(() => __errors.join('\n'))).toContain('Controlled network failure');
});

test('detached content and account changes invalidate pending photo work', async ({page}) => {
  const errors = await boot(page, 'photos');
  await page.evaluate(() => {
    App.currentUser = {id:'other',role:'LUBRICADOR'};
    document.querySelector('#app-content').outerHTML = '<main id="app-content">New account</main>';
  });
  await settle(page);
  await expect(page.locator('#app-content')).toHaveText('New account');
  expect(errors).toEqual([]);
});

test('a new filter wins over an older pending photo draw', async ({page}) => {
  const errors = await boot(page, 'photos');
  await page.locator('#anom-filter').selectOption('Cerrada');
  await expect(page.locator('#anom-table')).toContainText('Sin anomalías registradas');
  await settle(page);
  await expect(page.locator('#anom-table')).toContainText('Sin anomalías registradas');
  await expect(page.locator('#anom-table')).not.toContainText('Old load');
  expect(errors).toEqual([]);
});
