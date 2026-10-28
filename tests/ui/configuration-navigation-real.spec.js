// tests/ui/configuration-navigation-real.spec.js
//
// "Cerrar bloque CONFIGURACIÓN" (2026-10-18) — A: el bug de navegación
// ("Guardar saca al usuario de la sección actual") se había probado antes
// SOLO contra un fixture estático de wireConfigCategoryNav()
// (tests/ui/config-desktop-grid.spec.js), nunca contra renderConfig() REAL
// con sus handlers de Guardar REALES — ESO es lo que no cubría todos los
// flujos. Esta suite arranca renderConfig() de verdad (app.js), con sus
// dependencias reales (cuadrillasPanelHTML/wireCuadrillasPanel,
// simpleListPanelHTML/wireSimpleListPanel, renderUsuarios/
// renderUsuariosSupabase, notifCardHTML/mergeNotifSettings) contra una
// IndexedDB/Auth/Sync fake — solo se stubean las piezas pesadas fuera de
// alcance (papelera, espacio, tema, push, backup). (La categoría
// "Seguridad"/Quick Unlock que este archivo probaba originalmente se
// retiró por completo en UX CAMPO V2, 2026-10-24 — ver
// lubricador-session-safety.test.js.)
//
// B: Usuarios y accesos ya NO redirige a una pantalla separada — embebe
// renderUsuarios()/renderUsuariosSupabase() real dentro de su propio
// contenedor (#config-usuarios-embed). navigate('usuarios') (acceso
// antiguo) redirige a Configuración > Usuarios y accesos para quien
// también tiene permiso "config" (ADMINISTRADOR); para quien NO lo tiene
// (SUPERVISOR) sigue abriendo la pantalla separada de siempre, sin cambios
// de permisos backend.
import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, OPERATIONAL_SCOPE_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const dbNames = ['nowISO', 'stamp', 'uid'];
const dbSrc = dbNames.map(n => extractDeclaration(readSource(DB_JS_PATH), n)).join('\n\n');
const appNames = [
  '$', '$$', 'esc', 'ic', 'fmtDate',
  'MENU', 'PERMISSIONS', 'navigate', 'openModal', 'closeModal',
  'mergeNotifSettings', 'NOTIF_ROLES_DISPONIBLES', 'notifCardHTML',
  'SYNC_INTERVAL_OPTIONS', 'normalizeSyncInterval', 'syncIntervalLabel', 'loadGeneralSettings',
  'cuadrillasPanelHTML', 'wireCuadrillasPanel', 'simpleListPanelHTML', 'wireSimpleListPanel',
  'wireConfigCategoryNav', 'CONFIG_DEFAULT_CATEGORY', 'renderConfig',
  'renderUsuarios', 'renderUsuariosSupabase', 'manageUsersErrorMessage', 'withSubmitGuard',
  'userFormSupabase', 'roleFormSupabase', 'resetPasswordFormSupabase', 'MANAGE_USERS_ERROR_LABELS',
  'makeTablesResponsive',
  // broadcastPanelHTML/wireBroadcastPanel (panel "Mensajes operativos" dentro
  // de Configuración > Notificaciones, ya solo un enlace a Tareas y Mensajes)
  // — renderConfig() los llama desde el lote "Tareas y Mensajes" 2026-10-18;
  // faltaban aquí (limpieza técnica 2026-10-19: ReferenceError real al
  // correr este spec, no relacionado con la limpieza en sí — harness
  // desactualizado desde ese lote anterior).
  'broadcastPanelHTML', 'wireBroadcastPanel',
  // Diagnóstico BLOCKED (lote "DIAGNÓSTICO BLOCKED"): renderConfig() ahora
  // también llama wireBlockedOperationsPanel() al final — nunca se invoca
  // de verdad aquí (DB.getConfig() no trae `url`, así que el bloque entero
  // de diagnóstico ni se pinta), pero debe existir como función real o
  // renderConfig() revienta con un ReferenceError al definirse/llamarse.
  'wireBlockedOperationsPanel',
];
const app = appNames.map(n => extractDeclaration(appSource, n)).join('\n\n');
const scope = readSource(OPERATIONAL_SCOPE_JS_PATH); // canManageCrewMembership/resolveCrewLocationCoverage/validateCrewLocationCoverage

async function boot(page, { role = 'ADMINISTRADOR', supabaseMode = true, users = [], manageUsersList = [] } = {}) {
  page.on('dialog', d => d.accept());
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else { route.continue(); }
  });
  await page.goto('/');
  await page.setContent('<div class="app-shell"><main id="app-content"></main></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { route: 'config', currentUser: { id: 'u1', name: 'Admin de prueba', role: ${JSON.stringify(role)} },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18, defaultAlertYellowHours: 10, complianceTarget: 85, syncIntervalSeconds: 60 } };
      window.ic = () => '';
      window.__data = {
        cuadrillas: [{ id: 'cq1', name: 'Cuadrilla A', memberUserIds: [], active: true }],
        crew_locations: [],
        locations: [{ id: 'loc1', name: 'Volcán', active: true }],
        equipment_types: [{ id: 'ty1', name: 'Camión', active: true }],
        audit_log: [],
        push_tokens: [],
        settings: {},
        users: ${JSON.stringify(users)},
      };
      window.DB = {
        getConfig: async () => ({}),
        get: async (store, id) => { if (store === 'settings') return window.__data.settings[id] || null; return (window.__data[store] || []).find(r => r.id === id) || null; },
        allActive: async (store) => (window.__data[store] || []).filter(r => r.active !== false),
        all: async (store) => window.__data[store] || [],
        put: async (store, row) => {
          if (store === 'settings') { window.__data.settings[row.id] = row; return row; }
          const list = window.__data[store] || (window.__data[store] = []);
          const i = list.findIndex(r => r.id === row.id);
          if (i >= 0) list[i] = row; else list.push(row);
          return row;
        },
        putMany: async (store, rows) => { for (const r of rows) await window.DB.put(store, r); },
      };
      window.Sync = {
        getAccountSyncState: async () => ({bootstrapComplete:true,lastPull:null}),
        pendingCount: async () => 0, fullSync: async () => ({ ok: true }), setAutoInterval: () => {},
        saveConfig: async () => {},
      };
      window.Auth = {
        isSupabaseMode: () => ${supabaseMode}, isAuthenticated: () => true,
        getProfile: () => ({ appUserId: 'u1' }),
        manageUsers: async (action) => {
          window.__manageUsersCalls = (window.__manageUsersCalls || []).concat([action]);
          if (action === 'LIST_USERS') return { users: ${JSON.stringify(manageUsersList)} };
          return {};
        },
      };
      window.logAudit = async () => {};
      window.showInAppToast = () => {};
      window.refreshLocalNotifications = async () => {};
      window.openThemePicker = () => {};
      window.purgarPapelera = () => {};
      window.purgarRegistrosAntiguos = () => {};
      window.purgarFotosAntiguas = () => {};
      window.exportFullBackup = () => {};
      window.previewAndImportBackup = async () => {};
      window.initPushNotifications = async () => {};
      window.renderTrash = async () => {};
      window.renderStorageStats = () => {};
      // navigate() construye su tabla "renderers" evaluando TODAS las
      // funciones del objeto de una vez (object literal), aunque solo
      // vaya a invocar una — hay que darle algo a cada nombre o revienta
      // con ReferenceError incluso para rutas que sí nos interesan
      // (config/usuarios). Ninguna de estas pantallas está bajo prueba
      // aquí (fuera de alcance: "no tocar otros módulos").
      for (const name of ['renderDashboard', 'renderEquipos', 'renderPlan', 'renderTurno', 'renderRegistrar',
        'renderHorometros', 'renderMatrizSemanal', 'renderAnomalias', 'renderLubricantes', 'renderHistorial',
        'renderReportes', 'renderAyuda', 'renderMiPerfil', 'renderLubricadorConfig', 'renderTareasYMensajes']) {
        window[name] = async () => {};
      }
      window.ONESIGNAL_APP_ID = '';
      // _configCategoryApply/_configResizeListenerWired/_activeConfigCategory
      // son "let" a nivel de módulo en app.js, declarados FUERA de
      // wireConfigCategoryNav() (para sobrevivir entre llamadas — ver
      // comentario real en app.js). extractDeclaration() solo extrae
      // function/const, así que se declaran aquí igual que en el archivo
      // real (mismo patrón que tests/ui/config-desktop-grid.spec.js).
      let _configCategoryApply = null;
      let _configResizeListenerWired = false;
      let _activeConfigCategory = null;
      // Datos por defecto reales de NOTIF_DEFAULTS (app.js) — copiados tal
      // cual, SIN las notas numeradas "1) ... 7)" que llevan en el código
      // fuente: esas anotaciones rompen extractDeclaration() (cuenta
      // paréntesis letra por letra, "1)" cuenta como un ")" sin par). Datos
      // puros, no lógica — mergeNotifSettings()/notifCardHTML()/el submit
      // real de #notif-form SÍ son el código real extraído de app.js.
      window.NOTIF_DEFAULTS = {
        id: 'notifications', enabled: true, soloEnTurno: true, minutosAntesDelTurno: 15, minutosDespuesDelTurno: 30,
        vencidos: { enabled: true, hour: 7, minute: 0, roles: ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR'], soloSiHay: true, recordatorio: true, recordatorioHoras: 6, escalarDias: 3, escalarA: ['ADMINISTRADOR'] },
        porEngrasar: { enabled: true, hour: 6, minute: 0, roles: ['LUBRICADOR', 'SUPERVISOR'], soloSiHay: true, recordatorio: true, recordatorioHoras: 4 },
        engraseRealizado: { enabled: false, roles: ['SUPERVISOR'], soloCriticos: false },
        cumplimiento: { enabled: true, hour: 7, minute: 30, roles: ['ADMINISTRADOR', 'PLANIFICADOR'] },
        anomalias: { enabled: true, roles: ['ADMINISTRADOR', 'SUPERVISOR', 'PLANIFICADOR'], agruparMinutos: 30 },
        resumenSemanal: { enabled: true, hour: 7, minute: 0, diaSemana: 1, roles: ['ADMINISTRADOR', 'PLANIFICADOR'] },
        validaciones: { enabled: true, roles: ['LUBRICADOR'] },
      };
      ${dbSrc}
      ${scope}
      ${app}
      window.renderConfig = renderConfig;
      window.navigate = navigate;
    `,
  });
  await page.evaluate(() => renderConfig());
}

const configTab = (page, key) => page.locator(`#config-tab-${key}`);
const configCat = (page, key) => page.locator(`#config-cat-${key}`);

test('1. Organización > Editar cuadrilla > Guardar => sigue en Organización', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page);
  await configTab(page, 'organizacion').click();
  await expect(configCat(page, 'organizacion')).toBeVisible();
  await page.locator('.cq-edit').click();
  await page.locator('#cq-form [name="name"]').fill('Cuadrilla A (editada)');
  await page.locator('#cq-form button[type="submit"]').click();
  await expect(page.locator('#cq-form')).toHaveCount(0);
  await expect(configCat(page, 'organizacion')).toBeVisible();
  await expect(configCat(page, 'general')).toBeHidden();
  await expect(page.locator('[data-cuadrillas-panel]')).toContainText('Cuadrilla A (editada)');
});

test('2. Organización > Cobertura > Guardar => sigue en Organización', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page);
  await configTab(page, 'organizacion').click();
  await page.locator('.cq-coverage').click();
  await page.locator('.coverage-location').first().check();
  await page.locator('#crew-coverage-form button[type="submit"]').click();
  await expect(page.locator('#crew-coverage-form')).toHaveCount(0);
  await expect(configCat(page, 'organizacion')).toBeVisible();
  await expect(configCat(page, 'general')).toBeHidden();
});

test('3. Organización > Ubicación > Guardar (agregar) => sigue en Organización', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page);
  await configTab(page, 'organizacion').click();
  await page.locator('[data-simple-store="locations"] .sl-new-input').fill('Mojón');
  await page.locator('[data-simple-store="locations"] .sl-add').click();
  await expect(configCat(page, 'organizacion')).toBeVisible();
  await expect(configCat(page, 'general')).toBeHidden();
  await expect(page.locator('[data-simple-store="locations"]')).toContainText('Mojón');
});

test('4. Usuarios y accesos > Editar usuario > Guardar => sigue en Usuarios y accesos (embebido, nunca una pantalla separada)', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, { manageUsersList: [{ app_user_id: 'au1', display_name: 'Lucía', role: 'LUBRICADOR', active: true }] });
  await configTab(page, 'usuarios').click();
  await expect(configCat(page, 'usuarios')).toBeVisible();
  await expect(page.locator('#config-usuarios-embed')).toContainText('Lucía');
  await page.locator('#config-usuarios-embed button[data-role="au1"]').click();
  await page.locator('#role-form-sb [name="role"]').selectOption('SUPERVISOR');
  await page.locator('#role-form-sb button[type="submit"]').click();
  await expect(page.locator('#role-form-sb')).toHaveCount(0);
  await expect(configCat(page, 'usuarios')).toBeVisible();
  await expect(configCat(page, 'general')).toBeHidden();
  expect(await page.evaluate(() => window.__manageUsersCalls)).toContain('UPDATE_ROLE');
});

test('5. Notificaciones > Guardar => sigue en Notificaciones', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page);
  await configTab(page, 'notificaciones').click();
  await page.locator('#notif-form button[type="submit"]').click();
  await expect(configCat(page, 'notificaciones')).toBeVisible();
  await expect(configCat(page, 'general')).toBeHidden();
});

test('7/8. Mobile: categoría > editar > guardar => no vuelve al listado principal (mismo comportamiento que desktop)', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await boot(page);
  await page.locator('.config-mobile-item[data-category="organizacion"]').click();
  await expect(configCat(page, 'organizacion')).toBeVisible();
  await expect(page.locator('#config-mobile-menu')).toBeHidden();
  await page.locator('.cq-edit').click();
  await page.locator('#cq-form [name="name"]').fill('Cuadrilla A (móvil)');
  await page.locator('#cq-form button[type="submit"]').click();
  await expect(page.locator('#cq-form')).toHaveCount(0);
  await expect(configCat(page, 'organizacion')).toBeVisible();
  await expect(page.locator('#config-mobile-menu')).toBeHidden();
  await expect(page.locator('#config-mobile-back')).toBeVisible();
});

test('9a. Acceso antiguo navigate(\'usuarios\') para rol con "config" (ADMINISTRADOR) -> abre Configuración > Usuarios y accesos, nunca una pantalla duplicada', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, { role: 'ADMINISTRADOR' });
  await page.evaluate(() => navigate('usuarios'));
  await expect(page.locator('#config-root')).toHaveCount(1);
  await expect(configCat(page, 'usuarios')).toBeVisible();
  await expect(page.locator('#config-usuarios-embed')).not.toHaveCount(0);
});

test('9b. Acceso antiguo navigate(\'usuarios\') para rol SIN "config" (SUPERVISOR) -> sigue abriendo la pantalla separada de siempre, sin cambios', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await boot(page, { role: 'SUPERVISOR', supabaseMode: false, users: [{ id: 'u2', name: 'Pedro', username: 'pedro', role: 'LUBRICADOR', active: true }] });
  await page.evaluate(() => navigate('usuarios'));
  await expect(page.locator('#config-root')).toHaveCount(0);
  await expect(page.locator('table.data-table')).toContainText('Pedro');
});
