// Hallazgo LOGIC-P0-01 (auditoría pre-release 2026-10-21): en modo
// Supabase, manage-users rechaza con 403 a cualquiera que no sea
// ADMINISTRADOR (supabase/functions/manage-users/index.ts) — SUPERVISOR no
// debe ver ni poder navegar manualmente a "Usuarios" en ese modo. En modo
// legacy, SUPERVISOR sigue administrando lubricadores de su cuadrilla sin
// cambios (getAllowedRoutes() solo filtra en modo Supabase).
//
// Misma técnica que sidebar-real-render.spec.js: ejecuta el código REAL de
// app.js (boot()/navigate()/getAllowedRoutes(), extraídos de la fuente) en
// una página real de Playwright, sin servidor ni IndexedDB — boot() renderiza
// el shell de forma síncrona antes de que navigate() dispare el render
// async de la pantalla (que sí necesitaría DB real), así que las
// aserciones sobre el sidebar y sobre App.route no dependen de eso.
import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const source = readSource(APP_JS_PATH);
const declarations = ['$', '$$', 'esc', 'PERMISSIONS', 'getAllowedRoutes', 'MENU', 'boot', 'navigate']
  .map(name => extractDeclaration(source, name)).join('\n');

function buildPageScript({ role, supabaseMode }) {
  return `
    window.App = { currentUser: { role: '${role}', name: 'Fixture' }, route: null };
    window.Sync = { runAutoCycle() {} };
    window.Auth = { isSupabaseMode: () => ${supabaseMode} };
    window.ic = () => '';
    ${['updateTareasMensajesNavBadge', 'wireEvidenceImgFallbackOnce', 'refreshLocalNotifications', 'refreshAppBadge', 'startInactivityTracking',
      'programarCierrePorFinDeTurno', 'updateConnBadge', 'wireShiftTimer', 'updateShiftBadge', 'confirmLogout',
      'lockApp', 'confirmChangeUser', 'wireQuickFind', 'openQrScanner', 'handleQrDeepLink',
      // Renderers reales de cada pantalla NO se cargan (necesitan DB real) —
      // se stubean para que el render async disparado por navigate() no
      // explote con ReferenceError; las aserciones de este spec nunca
      // dependen de lo que estos devuelvan.
      'renderDashboard', 'renderEquipos', 'renderPlan', 'renderTurno', 'renderRegistrar', 'renderHorometros',
      'renderMatrizSemanal', 'renderAnomalias', 'renderLubricantes', 'renderHistorial', 'renderReportes',
      'renderUsuarios', 'renderConfig', 'renderAyuda', 'renderMiPerfil', 'renderLubricadorConfig',
      'renderTareasYMensajes', 'bootLubricador', 'makeTablesResponsive',
    ].map(name => `window.${name} = () => {};`).join('\n')}
    ${declarations}
    window.boot = boot;
    window.navigate = navigate;
  `;
}

test('SUPERVISOR en modo Supabase: "Usuarios" no aparece en el menú', async ({ page }) => {
  await page.setContent('<div></div>');
  await page.addScriptTag({ content: buildPageScript({ role: 'SUPERVISOR', supabaseMode: true }) });
  await page.evaluate(() => window.boot());
  const routes = await page.locator('#sidebar .menu-item[data-route]').evaluateAll(nodes => nodes.map(n => n.dataset.route));
  expect(routes).not.toContain('usuarios');
  // Sin regresión (§11 del pedido): el resto de las rutas de Supervisor sigue intacto.
  expect(routes).toEqual(expect.arrayContaining(['dashboard', 'tareas-mensajes', 'equipos', 'matriz', 'turno', 'anomalias', 'historial', 'ayuda']));
});

test('SUPERVISOR en modo legacy: "Usuarios" sigue en el menú (sin romper el modo conservado)', async ({ page }) => {
  await page.setContent('<div></div>');
  await page.addScriptTag({ content: buildPageScript({ role: 'SUPERVISOR', supabaseMode: false }) });
  await page.evaluate(() => window.boot());
  const routes = await page.locator('#sidebar .menu-item[data-route]').evaluateAll(nodes => nodes.map(n => n.dataset.route));
  expect(routes).toContain('usuarios');
});

test('ADMINISTRADOR en modo Supabase: sigue con acceso a Usuarios (vía getAllowedRoutes)', async ({ page }) => {
  await page.setContent('<div></div>');
  await page.addScriptTag({ content: buildPageScript({ role: 'ADMINISTRADOR', supabaseMode: true }) });
  const allowed = await page.evaluate(() => window.getAllowedRoutes('ADMINISTRADOR'));
  expect(allowed).toContain('usuarios');
});

test('SUPERVISOR en modo Supabase: navegar manualmente a "usuarios" no abre el módulo (redirige a dashboard)', async ({ page }) => {
  await page.setContent('<div></div>');
  await page.addScriptTag({ content: buildPageScript({ role: 'SUPERVISOR', supabaseMode: true }) });
  await page.evaluate(() => window.boot()); // deja el shell real (#sidebar/#topbar-title) en el DOM
  await page.evaluate(() => window.navigate('usuarios'));
  const route = await page.evaluate(() => window.App.route);
  expect(route).toBe('dashboard');
});
