// tests/ui/registro-sync-guard.spec.js
//
// BUG-CRÍTICO (Registrar Engrase guardaba dos veces) — endurecimiento del fix:
// un sync de fondo (onSyncStateChange → redibujarPantallaActual) NO debe
// interrumpir el flujo de Finalizar Engrase del Lubricador (formulario →
// guardado → "Validar ahora/después" → validación) reemplazando #app-content
// a medio camino. La fuente principal de protección es el estado EXPLÍCITO
// App.lubricadorGreaseFlowActive (no un selector DOM) — ver app.js.
//
// Carga las funciones REALES onSyncStateChange()/redibujarPantallaActual()
// (extraídas de app.js) en una página real de Playwright. renderAnomalias/
// renderLubricadorHistorial/renderLubricadorHome/navigate se reemplazan por
// espías (no aportan nada a esta prueba puntual — su propio comportamiento ya
// se prueba en otros archivos); lo que se verifica es SI redibujarPantallaActual
// llega a invocar alguno de ellos, no qué pintan.

import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const onSyncStateChangeSrc = extractDeclaration(appSource, 'onSyncStateChange');
const redibujarSrc = extractDeclaration(appSource, 'redibujarPantallaActual');
const updateConnBadgeSrc = extractDeclaration(appSource, 'updateConnBadge');
const dollarSrc = extractDeclaration(appSource, '$');

async function bootPage(page, { lubShell = true, route = 'turno' } = {}) {
  await page.setContent(lubShell ? '<div class="lub-shell"><div id="app-content"></div></div>' : '<div id="app-content"></div>');
  await page.addScriptTag({
    content: `
      window.App = { route: ${JSON.stringify(route)}, lubricadorGreaseFlowActive: false };
      let lastSyncState = { status: 'idle' };
      window.__calls = { renderAnomalias: 0, renderLubricadorHistorial: 0, renderLubricadorHome: 0, navigate: 0 };
      function renderAnomalias() { window.__calls.renderAnomalias++; }
      function renderLubricadorHistorial() { window.__calls.renderLubricadorHistorial++; }
      function renderLubricadorHome() { window.__calls.renderLubricadorHome++; }
      function navigate() { window.__calls.navigate++; }

      ${dollarSrc}
      ${updateConnBadgeSrc}
      ${redibujarSrc}
      ${onSyncStateChangeSrc}

      window.onSyncStateChange = onSyncStateChange;
      window.setFlowActive = (v) => { App.lubricadorGreaseFlowActive = v; };
      window.setRoute = (r) => { App.route = r; };
      window.getCalls = () => window.__calls;
    `,
  });
}

const SYNC_PULLED_OK = { status: 'ok', pulled: 3, newAnomalies: [] };

test.describe('A/B — mientras lubricadorGreaseFlowActive=true, un sync con pulled>0 NO redibuja', () => {
  test('shell Lubricador, App.route="turno" (formulario o "Validar ahora/después" abiertos): 0 llamadas a renderLubricadorHome', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'turno' });
    await page.evaluate(() => window.setFlowActive(true));
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderLubricadorHome).toBe(0);
    expect(calls.renderLubricadorHistorial).toBe(0);
    expect(calls.renderAnomalias).toBe(0);
  });

  test('varios syncs seguidos mientras el flujo sigue activo: siguen sin redibujar (no es un debounce de una sola vez)', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'turno' });
    await page.evaluate(() => window.setFlowActive(true));
    for (let i = 0; i < 3; i++) {
      await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    }
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderLubricadorHome).toBe(0);
  });
});

test.describe('E — al terminar/cancelar el flujo (flag vuelve a false), el sync siguiente SÍ redibuja normalmente', () => {
  test('flag false + pulled>0 + route="turno" dentro del shell Lubricador → renderLubricadorHome se llama exactamente 1 vez', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'turno' });
    await page.evaluate(() => window.setFlowActive(false));
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderLubricadorHome).toBe(1);
  });

  test('transición real: activo (0 redibujos) → false → el siguiente sync SÍ redibuja', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'turno' });
    await page.evaluate(() => window.setFlowActive(true));
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    await page.evaluate(() => window.setFlowActive(false)); // simula irAMisEngrasesTrasRegistrar() / cancelación
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderLubricadorHome).toBe(1); // solo el segundo sync redibujó
  });
});

test.describe('Defensa secundaria DOM — se conserva además del estado explícito', () => {
  test('con flag=false pero #grease-form presente en el DOM, tampoco redibuja (defensa secundaria sigue viva)', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'turno' });
    await page.evaluate(() => window.setFlowActive(false));
    await page.locator('#app-content').evaluate(el => { el.innerHTML = '<form id="grease-form"></form>'; });
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderLubricadorHome).toBe(0);
  });

  test('con flag=false pero .grease-validate-choice presente, tampoco redibuja', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'turno' });
    await page.evaluate(() => window.setFlowActive(false));
    await page.locator('#app-content').evaluate(el => { el.innerHTML = '<div class="grease-validate-choice"></div>'; });
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderLubricadorHome).toBe(0);
  });

  test('sin ningún guard activo (flag false, sin form, sin choice, sin modal): redibuja normalmente (comportamiento preexistente intacto)', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'turno' });
    await page.evaluate(() => window.setFlowActive(false));
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderLubricadorHome).toBe(1);
  });
});

test.describe('Otras pantallas del Lubricador no se ven afectadas por el flag', () => {
  test('App.route="anomalias" con flujo de registro activo (flag true) sigue sin redibujar esa pantalla tampoco (el flag es global al Lubricador mientras registra)', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'anomalias' });
    await page.evaluate(() => window.setFlowActive(true));
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderAnomalias).toBe(0);
  });

  test('App.route="anomalias" sin flujo activo: redibuja como siempre', async ({ page }) => {
    await bootPage(page, { lubShell: true, route: 'anomalias' });
    await page.evaluate(() => window.setFlowActive(false));
    await page.evaluate((state) => window.onSyncStateChange(state), SYNC_PULLED_OK);
    const calls = await page.evaluate(() => window.getCalls());
    expect(calls.renderAnomalias).toBe(1);
  });
});
