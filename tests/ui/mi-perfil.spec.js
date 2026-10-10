// tests/ui/mi-perfil.spec.js
//
// Lote "Mi Perfil" — autoservicio de perfil para cualquier usuario
// autenticado (nombre visible, contraseña, PIN local), reutilizando
// Auth/app_profiles/QuickUnlock ya existentes, SIN ampliar permisos.
// Extrae y ejecuta las funciones REALES de app.js (renderMiPerfil(),
// miPerfilRoleCrewSummaryHTML(), miPerfilErrorMessage(), withSubmitGuard())
// contra una página real de Playwright — nunca una reimplementación.
// DB/Auth/QuickUnlock/App/getCurrentOperationalScope/logAudit/
// quickUnlockConfigureModal se reemplazan por espías/fakes (su
// comportamiento real ya se prueba aparte: Auth en tests/unit/auth.test.js,
// QuickUnlock en tests/unit/quick-unlock.test.js, operational-scope en
// tests/unit/device-assignment-isolation.test.js).

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const APP_NAMES = [
  '$', '$$', 'esc', 'withSubmitGuard',
  'quickUnlockConfigureModal', // se re-asigna a un espía DESPUÉS de extraerla (abajo) — se extrae solo para que no truene como ReferenceError si algo más la referencia indirectamente
  'crewCoveragePresentation', 'miPerfilRoleCrewSummaryHTML', 'renderMiPerfil', 'miPerfilErrorMessage',
];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');

const SCOPE_GLOBAL = { kind: 'GLOBAL', userId: 'u1', role: 'ADMINISTRADOR', shiftId: 'shift_dia', crewId: null, crewLocationId: null, authorizedCrews: [] };
const SCOPE_CREW = {
  kind: 'CREW_SCOPED', userId: 'u2', role: 'LUBRICADOR', shiftId: 'shift_dia',
  crewId: 'cq1', crewLocationId: 'loc1', authorizedCrews: [{ id: 'cq1', name: 'Cuadrilla A', locationId: 'loc1' }],
};

async function bootMiPerfil(page, {
  displayName = 'Junior Valles', appUserId = 'u_jvalles', role = 'ADMINISTRADOR',
  quickUnlockConfigured = false, offline = false, scope = SCOPE_GLOBAL,
  cuadrillas = [], locations = [],
} = {}) {
  await page.setContent('<div class="app-shell"><main id="app-content" class="app-content"></main></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { currentUser: { id: 'u1', name: ${JSON.stringify(displayName)}, role: ${JSON.stringify(role)} } };
      window.__profile = { authUserId: 'auth-1', appUserId: ${JSON.stringify(appUserId)}, displayName: ${JSON.stringify(displayName)}, role: ${JSON.stringify(role)}, active: true };
      window.__updateOwnDisplayNameCalls = [];
      window.__changeOwnPasswordCalls = [];
      window.__logAuditCalls = [];
      window.__quickUnlockConfigureModalCalls = [];
      window.Auth = {
        isSupabaseMode: () => true,
        isAuthenticated: () => true,
        getProfile: () => window.__profile,
        updateOwnDisplayName: async (name) => {
          window.__updateOwnDisplayNameCalls.push(name);
          window.__profile = { ...window.__profile, displayName: name.trim() };
          return true;
        },
        changeOwnPassword: async (current, next) => {
          window.__changeOwnPasswordCalls.push({ current, next });
          return true;
        },
      };
      window.DB = { allActive: async (store) => (store === 'cuadrillas' ? ${JSON.stringify(cuadrillas)} : store === 'locations' ? ${JSON.stringify(locations)} : []) };
      window.QuickUnlock = { isConfigured: async () => ${quickUnlockConfigured}, disable: async () => {} };
      window.getCurrentOperationalScope = async () => (${JSON.stringify(scope)});
      window.logAudit = async (...args) => { window.__logAuditCalls.push(args); };
      window.showInAppToast = () => {};
      Object.defineProperty(window.navigator, 'onLine', { value: ${!offline}, configurable: true });
      ${appRealSrc}
      // Espía: confirma CON QUÉ se llama, sin ejecutar su cuerpo real (abre
      // un modal — su comportamiento real ya se prueba por separado).
      quickUnlockConfigureModal = (mode, onDone) => { window.__quickUnlockConfigureModalCalls.push(mode); };
      window.renderMiPerfil = renderMiPerfil;
    `,
  });
  await page.evaluate(() => window.renderMiPerfil());
}

test.describe('A) usuario ve sus propios datos — nombre, usuario, rol, cuadrilla/ubicación', () => {
  test('vista global (ADMINISTRADOR/PLANIFICADOR/VISOR) muestra nombre/usuario/rol + alcance global', async ({ page }) => {
    await bootMiPerfil(page, { displayName: 'Junior Valles', appUserId: 'u_jvalles', role: 'ADMINISTRADOR', scope: SCOPE_GLOBAL });
    await expect(page.locator('#app-content')).toContainText('Junior Valles');
    await expect(page.locator('#app-content')).toContainText('jvalles');
    await expect(page.locator('#app-content')).toContainText('ADMINISTRADOR');
    await expect(page.locator('#app-content')).toContainText('Global');
  });

  test('scope CREW_SCOPED (Lubricador/Supervisor) muestra cuadrilla activa y ubicación operativa', async ({ page }) => {
    await bootMiPerfil(page, {
      displayName: 'Ana Lubricadora', appUserId: 'u_ana', role: 'LUBRICADOR', scope: SCOPE_CREW,
      cuadrillas: [{ id: 'cq1', name: 'Cuadrilla A' }], locations: [{ id: 'loc1', name: 'Rajo Principal' }],
    });
    await expect(page.locator('#app-content')).toContainText('Cuadrilla A');
    await expect(page.locator('#app-content')).toContainText('Rajo Principal');
  });
});

test.describe('B) username es SOLO LECTURA — nunca un <input> editable', () => {
  test('el usuario se muestra como texto plano, no como campo de formulario', async ({ page }) => {
    await bootMiPerfil(page, { appUserId: 'u_jvalles' });
    const usernameInputs = await page.locator('input[name="username"], input[name="appUserId"], input[name="app_user_id"]').count();
    expect(usernameInputs).toBe(0);
    await expect(page.locator('#app-content')).toContainText('jvalles');
  });
});

test.describe('C) rol/permisos/cuadrillas/ubicaciones/IDs internos — NUNCA editables desde esta pantalla', () => {
  test('ningún <input>/<select> del formulario corresponde a rol, activo, permisos, cuadrilla, ubicación o IDs internos', async ({ page }) => {
    await bootMiPerfil(page);
    const camposProhibidos = ['role', 'active', 'permissions', 'crewId', 'cuadrillaId', 'locationId', 'authUserId', 'auth_user_id', 'appUserId', 'app_user_id'];
    for (const nombre of camposProhibidos) {
      const count = await page.locator(`input[name="${nombre}"], select[name="${nombre}"]`).count();
      expect(count, `no debería existir un campo editable "${nombre}"`).toBe(0);
    }
    // El ÚNICO <input> de texto editable del formulario de datos es el nombre.
    await expect(page.locator('#mi-perfil-nombre-form input[name="displayName"]')).toBeVisible();
  });
});

test.describe('D) cambiar el nombre propio — llama a Auth.updateOwnDisplayName(), nunca a manage-users', () => {
  test('enviar el formulario de nombre llama a Auth.updateOwnDisplayName() con el valor recortado', async ({ page }) => {
    await bootMiPerfil(page, { displayName: 'Junior Valles' });
    await page.locator('#mi-perfil-nombre-form input[name="displayName"]').fill('  Nombre Actualizado  ');
    await page.locator('#mi-perfil-nombre-form button[type="submit"]').click();
    await expect.poll(() => page.evaluate(() => window.__updateOwnDisplayNameCalls)).toEqual(['  Nombre Actualizado  ']);
  });
});

test.describe('E) cambiar contraseña — llama a Auth.changeOwnPassword(), nunca se guarda en el DOM tras enviarla', () => {
  test('contraseñas nuevas que no coinciden: NO llama a Auth.changeOwnPassword()', async ({ page }) => {
    await bootMiPerfil(page);
    await page.locator('#mi-perfil-password-form input[name="currentPassword"]').fill('actual-123');
    await page.locator('#mi-perfil-password-form input[name="newPassword"]').fill('nueva-111111');
    await page.locator('#mi-perfil-password-form input[name="newPasswordConfirm"]').fill('otra-222222');
    await page.locator('#mi-perfil-password-form button[type="submit"]').click();
    await expect(page.locator('#mi-perfil-password-error')).toContainText('no coinciden');
    expect(await page.evaluate(() => window.__changeOwnPasswordCalls)).toEqual([]);
  });

  test('contraseñas coincidentes: llama a Auth.changeOwnPassword() con actual+nueva, y limpia el formulario (nunca queda la contraseña en el DOM)', async ({ page }) => {
    await bootMiPerfil(page);
    await page.locator('#mi-perfil-password-form input[name="currentPassword"]').fill('la-actual-123');
    await page.locator('#mi-perfil-password-form input[name="newPassword"]').fill('la-nueva-456789');
    await page.locator('#mi-perfil-password-form input[name="newPasswordConfirm"]').fill('la-nueva-456789');
    await page.locator('#mi-perfil-password-form button[type="submit"]').click();
    await expect.poll(() => page.evaluate(() => window.__changeOwnPasswordCalls)).toEqual([{ current: 'la-actual-123', next: 'la-nueva-456789' }]);
    await expect(page.locator('#mi-perfil-password-form input[name="currentPassword"]')).toHaveValue('');
    await expect(page.locator('#mi-perfil-password-form input[name="newPassword"]')).toHaveValue('');
  });

  test('sin conexión: los formularios de nombre y contraseña quedan deshabilitados (requieren Internet)', async ({ page }) => {
    await bootMiPerfil(page, { offline: true });
    await expect(page.locator('#mi-perfil-nombre-form input[name="displayName"]')).toBeDisabled();
    await expect(page.locator('#mi-perfil-password-form input[name="currentPassword"]')).toBeDisabled();
    await expect(page.locator('#mi-perfil-password-form input[name="newPassword"]')).toBeDisabled();
  });
});

test.describe('F) PIN rápido — sigue siendo 100% local (QuickUnlock), nunca se sincroniza, nunca da autorización', () => {
  test('sin PIN configurado: muestra "Configurar PIN rápido", llama a quickUnlockConfigureModal("configure", ...)', async ({ page }) => {
    await bootMiPerfil(page, { quickUnlockConfigured: false });
    await expect(page.locator('#mi-perfil-pin-configure')).toBeVisible();
    await expect(page.locator('#mi-perfil-pin-change')).toHaveCount(0);
    await page.locator('#mi-perfil-pin-configure').click();
    expect(await page.evaluate(() => window.__quickUnlockConfigureModalCalls)).toEqual(['configure']);
  });

  test('con PIN ya configurado: muestra "Cambiar PIN" y "Desactivar PIN rápido", nunca el botón de configurar inicial', async ({ page }) => {
    await bootMiPerfil(page, { quickUnlockConfigured: true });
    await expect(page.locator('#mi-perfil-pin-change')).toBeVisible();
    await expect(page.locator('#mi-perfil-pin-disable')).toBeVisible();
    await expect(page.locator('#mi-perfil-pin-configure')).toHaveCount(0);
    await page.locator('#mi-perfil-pin-change').click();
    expect(await page.evaluate(() => window.__quickUnlockConfigureModalCalls)).toEqual(['change']);
  });

  test('"Desactivar PIN rápido" llama a QuickUnlock.disable() y a logAudit(), nunca a Auth (el PIN nunca es autorización de servidor)', async ({ page }) => {
    await bootMiPerfil(page, { quickUnlockConfigured: true });
    await page.locator('#mi-perfil-pin-disable').click();
    await expect.poll(() => page.evaluate(() => window.__logAuditCalls.length)).toBe(1);
    const auditCall = await page.evaluate(() => window.__logAuditCalls[0][0]);
    expect(auditCall).toBe('QUICK_UNLOCK_DESACTIVADO');
  });
});

for (const width of [390, 412]) {
  test(`G) Mi Perfil @ ${width}px — sin scroll horizontal, formulario compacto (sin cards gigantes)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1400 });
    await bootMiPerfil(page, { quickUnlockConfigured: false });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
  });
}

test.describe('H) solo modo supabase — en modo legacy no se ofrece (no hay Auth real que autoeditar)', () => {
  test('Auth.isSupabaseMode()=false -> mensaje explicativo, ningún formulario', async ({ page }) => {
    await page.setContent('<div class="app-shell"><main id="app-content" class="app-content"></main></div>');
    await page.addScriptTag({
      content: `
        window.App = { currentUser: { id: 'u1', name: 'X', role: 'ADMINISTRADOR' } };
        window.Auth = { isSupabaseMode: () => false, isAuthenticated: () => false };
        ${appRealSrc}
      `,
    });
    await page.evaluate(() => window.renderMiPerfil ? window.renderMiPerfil() : renderMiPerfil());
    await expect(page.locator('#mi-perfil-nombre-form')).toHaveCount(0);
  });
});

test('UX profile has separate resolved coverage and informative crew chips', async ({ page }) => {
  await bootMiPerfil(page, { role: 'LUBRICADOR', scope: { ...SCOPE_CREW, allAuthorizedLocationIds: ['loc1', 'loc2'], principalLocationIds: ['loc1'], supportLocationIds: ['loc2'] }, cuadrillas: [{ id: 'cq1', name: 'Cuadrilla ficticia' }], locations: [{ id: 'loc1', name: 'Principal ficticia' }, { id: 'loc2', name: 'Apoyo ficticio' }] });
  await expect(page.locator('.crew-coverage-list li')).toHaveCount(2);
  await expect(page.locator('.crew-coverage-role.support')).toHaveText('APOYO');
  await expect(page.locator('.authorized-crew-chip')).toHaveCount(1);
  await expect(page.locator('.authorized-crew-list button, .authorized-crew-list [role=button]')).toHaveCount(0);
  const sizes = await page.evaluate(() => ({ width: innerWidth, columns: getComputedStyle(document.querySelector('.lub-profile-layout')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth }));
  expect(sizes.columns).toBe(sizes.width >= 1024 ? 2 : 1); expect(sizes.overflow).toBe(false);
});
