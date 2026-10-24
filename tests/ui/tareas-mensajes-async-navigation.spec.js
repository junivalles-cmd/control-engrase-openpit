// TECH-04 (auditoría técnica integral V2, 2026-10-24): renderTareasYMensajes()
// no tenía guarda de navegación — una carga atrasada podía sobrescribir el DOM
// de la pantalla a la que el usuario ya había navegado. Se aplicó el mismo
// patrón de generación/ruta/usuario ya probado en renderAnomalias() (ver
// tests/ui/anomalies-async-navigation.spec.js, que sirve de modelo para este
// archivo). Alcance de este test: solo el camino de carga principal (el
// `Promise.all` inicial) para un rol manager (ADMINISTRADOR) sin selección de
// detalle — es el único await relevante antes del primer `c.innerHTML` en ese
// camino (ver app.js:renderTareasYMensajes).
import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const real = ['$', '$$', 'esc', 'ic', 'todayDateISO', 'renderTareasYMensajes']
  .map(n => extractDeclaration(source, n)).join('\n');

async function boot(page) {
  const errors = [];
  page.on('pageerror', e => errors.push(e.stack || e.message));
  await page.setContent('<main id="app-content"></main>');
  await page.addScriptTag({ content: `
    window.App = {route:'tareas-mensajes', currentUser:{id:'admin1', role:'ADMINISTRADOR'}};
    window.__errors = [];
    window.__gate = {}; __gate.promise = new Promise((resolve,reject) => Object.assign(__gate,{resolve,reject}));
    // canManageAssignments/canCreateBroadcast viven en src/core/operational-scope.js
    // (no en app.js) — se stubean acá porque este test solo ejercita la guarda de
    // navegación async, no la matriz real de permisos (ya cubierta en otros tests).
    window.canManageAssignments = role => ['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR'].includes(role);
    window.canCreateBroadcast = role => ['ADMINISTRADOR','PLANIFICADOR','SUPERVISOR'].includes(role);
    window.DB = {
      all: async store => store === 'manual_tasks' ? __gate.promise : [],
      allActive: async () => [],
    };
    ${real}
    window.startRun = () => { window.__run = renderTareasYMensajes().catch(e => __errors.push(e.stack)); };
    window.leave = route => { App.route = route; document.querySelector('#app-content').innerHTML = '<h2 id="destination">'+route+'</h2>'; };
    startRun();
  ` });
  return errors;
}
async function settle(page, reject = false) {
  await page.evaluate(async reject => {
    if (reject) __gate.reject(new Error('Controlled network failure'));
    else __gate.resolve([]);
    try { await __run; } catch (e) { /* el error real, si aplica, ya quedó en __errors */ }
    await new Promise(r => setTimeout(r, 0));
  }, reject);
}

for (const destination of ['turno', 'anomalias', 'historial', 'lubconfig']) {
  test(`Tareas → ${destination}: la carga atrasada no sobrescribe la pantalla nueva`, async ({ page }) => {
    const errors = await boot(page);
    await page.evaluate(route => leave(route), destination);
    await settle(page);
    await expect(page.locator('#destination')).toHaveText(destination);
    expect(await page.evaluate(() => App.route)).toBe(destination);
    expect(await page.evaluate(() => __errors)).toEqual([]);
    expect(errors).toEqual([]);
  });
}

test('error de red tras salir de Tareas y Mensajes se descarta en silencio', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(() => leave('historial'));
  await settle(page, true);
  await expect(page.locator('#destination')).toHaveText('historial');
  expect(await page.evaluate(() => __errors)).toEqual([]);
  expect(errors).toEqual([]);
});

test('error de red en la ejecución vigente de Tareas y Mensajes sigue siendo visible', async ({ page }) => {
  await boot(page);
  await settle(page, true);
  expect(await page.evaluate(() => __errors.join('\n'))).toContain('Controlled network failure');
});

test('Tareas → salir → volver a Tareas: la segunda carga gana', async ({ page }) => {
  const errors = await boot(page);
  await page.evaluate(async () => {
    leave('turno');
    const oldRun = __run;
    const oldGate = __gate;
    App.route = 'tareas-mensajes';
    // La 2da carga no debe quedar atascada en el mismo gate que la 1ra —
    // simula que esta vez la red responde de inmediato.
    DB.all = async store => store === 'manual_tasks' ? [] : [];
    startRun();
    await __run;
    // Solo AHORA, con la 2da carga ya pintada, se libera la 1ra (atrasada).
    oldGate.resolve([]);
    await oldRun;
    await new Promise(r => setTimeout(r, 0));
  });
  await expect(page.locator('.tym-list-head')).toContainText('Tareas y Mensajes');
  expect(await page.evaluate(() => __errors)).toEqual([]);
  expect(errors).toEqual([]);
});
