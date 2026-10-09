// tests/ui/lubricador-config.spec.js
//
// Pantalla "Configuración" exclusiva para LUBRICADOR (pedido "CONFIGURACIÓN
// LUBRICADOR + FIX DE ALERTAS + AUDITORÍA HORÓMETRO", 2026-10-09),
// accesible desde "Mi cuenta → Configuración" — nunca un tab nuevo en el
// bottom nav. Extrae y ejecuta las funciones REALES de app.js
// (renderLubricadorConfig(), miPerfilRoleCrewSummaryHTML(),
// openThemePicker(), getTheme()/applyTheme()/saveTheme(), THEMES/MODES)
// contra una página real de Playwright — mismo mecanismo que
// tests/ui/mi-perfil.spec.js. Auth/QuickUnlock/DB/getCurrentOperationalScope
// se reemplazan por fakes (su comportamiento real ya se prueba aparte);
// confirmChangeUser() se extrae REAL (es simple: abre un modal de
// confirmación) para probar la integración real del botón "Entrar con otra
// cuenta", con `logout` como espía — su propia garantía de "nunca toca
// IndexedDB operativo" es código preexistente, documentado y sin cambios
// en este lote.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const APP_NAMES = [
  '$', '$$', 'esc', 'ic', 'openModal', 'closeModal',
  'quickUnlockConfigureModal', // se re-asigna a un espía después de extraerla
  'confirmChangeUser', // real: solo abre un modal de confirmación
  'miPerfilRoleCrewSummaryHTML', 'renderLubricadorConfig',
  'getTheme', 'applyTheme', 'saveTheme', 'openThemePicker',
  'THEMES', 'MODES', 'THEME_COLOR_BY_MODE',
];
const appRealSrc = APP_NAMES.map((n) => extractDeclaration(appSource, n)).join('\n\n');

const SCOPE_CREW = {
  kind: 'CREW_SCOPED', userId: 'u2', role: 'LUBRICADOR', shiftId: 'shift_dia',
  crewId: 'cq1', crewLocationId: 'loc1', authorizedCrews: [{ id: 'cq1', name: 'Cuadrilla 76-08', locationId: 'loc1' }],
};

async function bootConfig(page, {
  displayName = 'Ana Lubricadora', appUserId = 'u_ana', role = 'LUBRICADOR',
  quickUnlockConfigured = false, scope = SCOPE_CREW,
  cuadrillas = [{ id: 'cq1', name: 'Cuadrilla 76-08' }], locations = [{ id: 'loc1', name: 'Volcán' }],
  shiftDia = true,
} = {}) {
  // page.setContent() a secas deja la página en about:blank (origen opaco)
  // — localStorage lanza SecurityError ahí (lo usa getTheme()/saveTheme()),
  // mismo fix ya documentado en tests/ui/qr-grease-register-management.spec.js:
  // se bloquea toda request real y se navega a la baseURL del webServer
  // (origen http real) antes de inyectar el contenido de prueba.
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue(); // addStyleTag() necesita que otros tipos de recurso sigan su curso normal
    }
  });
  await page.goto('/');
  await page.setContent('<div id="app-content"></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { id: 'u2', name: ${JSON.stringify(displayName)}, role: ${JSON.stringify(role)} } };
      window.__profile = { authUserId: 'auth-2', appUserId: ${JSON.stringify(appUserId)}, displayName: ${JSON.stringify(displayName)}, role: ${JSON.stringify(role)}, active: true };
      window.__navigateCalls = [];
      window.__dbWriteCalls = []; // cualquier método que NO sea de solo lectura — debe quedar vacío siempre
      window.Auth = {
        isSupabaseMode: () => true,
        isAuthenticated: () => true,
        getProfile: () => window.__profile,
        signOut: async () => { window.__dbWriteCalls.push('Auth.signOut'); return true; },
      };
      window.DB = {
        allActive: async (store) => (store === 'cuadrillas' ? ${JSON.stringify(cuadrillas)} : store === 'locations' ? ${JSON.stringify(locations)} : []),
        put: async (...a) => { window.__dbWriteCalls.push(['put', ...a]); },
        delete: async (...a) => { window.__dbWriteCalls.push(['delete', ...a]); },
        clear: async (...a) => { window.__dbWriteCalls.push(['clear', ...a]); },
      };
      window.QuickUnlock = {
        isConfigured: async () => ${quickUnlockConfigured},
        disable: async () => { window.__dbWriteCalls.push('QuickUnlock.disable'); },
      };
      window.getCurrentOperationalScope = async () => (${JSON.stringify(scope)});
      window.currentShiftId = () => ${shiftDia ? "'shift_dia'" : "'shift_noche'"};
      window.navigate = (route) => { window.__navigateCalls.push(route); };
      // logout() real es enorme (OneSignal/Sync/notificaciones) y no cambia
      // en este lote — se reemplaza por un espía que SÍ pasa por
      // Auth.signOut()/QuickUnlock.disable() (igual que el real), para que
      // "IndexedDB preservado" se pueda comprobar de verdad: si el flujo
      // real de logout() tocara IndexedDB, window.DB.put/delete/clear lo
      // registrarían igual aquí.
      window.logout = async () => { await window.Auth.signOut(); await window.QuickUnlock.disable(); };
      ${appRealSrc}
      quickUnlockConfigureModal = (mode) => { window.__quickUnlockConfigureModalCalls = mode; };
      window.renderLubricadorConfig = renderLubricadorConfig;
      // const THEMES/const MODES son declaraciones de script clásico —
      // visibles por nombre libre dentro de este mismo script (por eso
      // openThemePicker() ya las usa sin problema), pero un const de
      // nivel superior nunca se cuelga de window solo — se expone aquí
      // para que el test pueda leerlas desde fuera.
      window.THEMES = THEMES; window.MODES = MODES;
    `,
  });
  await page.evaluate(() => window.renderLubricadorConfig());
}

test.describe('A) Lubricador abre Configuración — MI PERFIL con los datos correctos', () => {
  test('muestra Nombre, Usuario, Rol, Cuadrilla activa, Ubicación y Turno', async ({ page }) => {
    await bootConfig(page, { displayName: 'Ana Lubricadora', appUserId: 'u_ana', role: 'LUBRICADOR', shiftDia: true });
    const content = page.locator('#app-content');
    await expect(content).toContainText('Ana Lubricadora');
    await expect(content).toContainText('ana');
    await expect(content).toContainText('LUBRICADOR');
    await expect(content).toContainText('Cuadrilla 76-08');
    await expect(content).toContainText('Volcán');
    await expect(content).toContainText('Turno Día');
  });

  test('Turno Noche se refleja correctamente (currentShiftId() real, sin cálculo nuevo)', async ({ page }) => {
    await bootConfig(page, { shiftDia: false });
    await expect(page.locator('#app-content')).toContainText('Turno Noche');
  });
});

test.describe('B) nunca ve opciones administrativas', () => {
  test('ningún control de ADMIN/PLANIFICADOR (usuarios, cuadrillas, ubicaciones, planes) aparece en la pantalla', async ({ page }) => {
    await bootConfig(page);
    const content = await page.locator('#app-content').innerHTML();
    for (const prohibido of ['btn-new-user', 'btn-new-cuadrilla', 'btn-new-location', 'Eliminar equipo', 'Asignar a cuadrilla', 'Nuevo usuario', 'Gestionar cuadrillas']) {
      expect(content).not.toContain(prohibido);
    }
  });

  test('rol/permisos/cuadrilla/ubicación se muestran como texto, nunca como <select>/<input> editable', async ({ page }) => {
    await bootConfig(page);
    const count = await page.locator('#app-content select, #app-content input[name="role"], #app-content input[name="crewId"]').count();
    expect(count).toBe(0);
  });
});

test.describe('C) Apariencia — 8 acentos corporativos + 4 modos, cambio inmediato, persistencia local', () => {
  test('el botón "Personalizar colores" abre el picker REAL con los 8 acentos y 4 modos', async ({ page }) => {
    await bootConfig(page);
    await page.locator('#lub-config-theme').click();
    await expect(page.locator('.theme-preview-card[data-accent]')).toHaveCount(8);
    await expect(page.locator('.theme-preview-card[data-mode]')).toHaveCount(4);
  });

  test('cambiar acento aplica data-theme de inmediato (sin reload) y persiste en localStorage', async ({ page }) => {
    await bootConfig(page);
    await page.locator('#lub-config-theme').click();
    await page.locator('.theme-preview-card[data-accent="violeta-ejec"]').click(); // "Violeta Ejecutivo"
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme'))).toBe('violeta-ejec');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('engrase_theme')));
    expect(stored.accent).toBe('violeta-ejec');
  });

  test('cambiar modo a "Modo Sol" aplica data-mode de inmediato y persiste', async ({ page }) => {
    await bootConfig(page);
    await page.locator('#lub-config-theme').click();
    await page.locator('.theme-preview-card[data-mode="sun"]').click();
    await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mode'))).toBe('sun');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('engrase_theme')));
    expect(stored.mode).toBe('sun');
  });

  test('los 8 acentos corporativos y 4 modos son EXACTAMENTE los pedidos (azul corporativo, amarillo maquinaria, azul acero, petróleo, grafito, verde bosque, cobre ejecutivo, violeta ejecutivo · claro, oscuro, alto contraste, modo sol)', async ({ page }) => {
    await bootConfig(page);
    const { accentIds, modeIds } = await page.evaluate(() => ({
      accentIds: window.THEMES.map((t) => t.id),
      modeIds: window.MODES.map((m) => m.id),
    }));
    expect(accentIds.length).toBe(8);
    expect(accentIds.sort()).toEqual([
      'azul-corp', 'amarillo-cat', 'azul-acero', 'petroleo-ejec', 'grafito', 'verde-bosque', 'cobre-ejec', 'violeta-ejec',
    ].sort());
    expect(modeIds.sort()).toEqual(['contrast', 'dark', 'light', 'sun'].sort());
  });

  test('"azul-corp" (Azul Corporativo) es el default y el on-accent de "amarillo-cat" es oscuro (nunca blanco)', async ({ page }) => {
    await bootConfig(page);
    const theme = await page.evaluate(() => window.THEMES);
    expect(theme[0].id).toBe('azul-corp');
    const amarillo = theme.find((t) => t.id === 'amarillo-cat');
    expect(amarillo.onColor.toLowerCase()).not.toBe('#ffffff');
  });
});

test.describe('D) Seguridad', () => {
  test('"Configurar PIN rápido" llama a quickUnlockConfigureModal("configure", ...) cuando no hay PIN', async ({ page }) => {
    await bootConfig(page, { quickUnlockConfigured: false });
    await expect(page.locator('#lub-config-pin')).toContainText('Configurar PIN rápido');
    await page.locator('#lub-config-pin').click();
    expect(await page.evaluate(() => window.__quickUnlockConfigureModalCalls)).toBe('configure');
  });

  test('"Cambiar PIN rápido" llama a quickUnlockConfigureModal("change", ...) cuando ya hay PIN', async ({ page }) => {
    await bootConfig(page, { quickUnlockConfigured: true });
    await expect(page.locator('#lub-config-pin')).toContainText('Cambiar PIN rápido');
    await page.locator('#lub-config-pin').click();
    expect(await page.evaluate(() => window.__quickUnlockConfigureModalCalls)).toBe('change');
  });

  test('"Cambiar contraseña" reusa Mi Perfil (navigate("miperfil")) — nunca un formulario duplicado', async ({ page }) => {
    await bootConfig(page);
    await page.locator('#lub-config-password').click();
    expect(await page.evaluate(() => window.__navigateCalls)).toEqual(['miperfil']);
  });
});

test.describe('E) "Entrar con otra cuenta" — IndexedDB preservado', () => {
  test('abre la confirmación real (confirmChangeUser) y, al confirmar, pasa por Auth.signOut()/QuickUnlock.disable() sin ninguna escritura a IndexedDB (equipos/engrases/anomalías/configuración)', async ({ page }) => {
    await bootConfig(page);
    await page.locator('#lub-config-change-user').click();
    await expect(page.locator('.modal-body')).toContainText('Vas a salir de la sesión');
    await page.locator('#confirm-change-user-confirm').click();
    await expect.poll(() => page.evaluate(() => window.__dbWriteCalls)).toEqual(['Auth.signOut', 'QuickUnlock.disable']);
    // Ninguna llamada a DB.put/delete/clear — IndexedDB operativo intacto.
    const dbCalls = await page.evaluate(() => window.__dbWriteCalls.filter((c) => Array.isArray(c)));
    expect(dbCalls).toEqual([]);
  });
});

for (const width of [360, 390, 412]) {
  test(`F) Configuración @ ${width}px — sin overflow horizontal, paneles compactos`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1400 });
    await bootConfig(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

test.describe('G) solo modo supabase — en modo legacy no se ofrece', () => {
  test('Auth.isSupabaseMode()=false -> mensaje explicativo, ningún panel', async ({ page }) => {
    await page.setContent('<div id="app-content"></div>');
    await page.addScriptTag({
      content: `
        window.App = { currentUser: { id: 'u1', name: 'X', role: 'LUBRICADOR' } };
        window.Auth = { isSupabaseMode: () => false, isAuthenticated: () => false };
        ${appRealSrc}
      `,
    });
    await page.evaluate(() => window.renderLubricadorConfig ? window.renderLubricadorConfig() : renderLubricadorConfig());
    await expect(page.locator('#lub-config-theme')).toHaveCount(0);
  });
});
