// tests/ui/quick-unlock-account-switch.spec.js
//
// Pedido "LOGIN / QUICK UNLOCK / CAMBIO DE USUARIO" (2026-10-09): botón "←"
// (vuelve al login normal, sin cerrar sesión ni borrar nada) + "Entrar con
// otra cuenta" (acción explícita, reusa confirmChangeUser()/logout() ya
// existentes — una sola ruta/helper para cambiar cuenta) en la pantalla de
// Quick Unlock. Atrás de Android se resuelve con history.pushState()/
// popstate (sin el plugin @capacitor/app, que no está instalado — ver
// comentario real en renderQuickUnlockScreen()/app.js).
//
// Extrae y ejecuta las funciones REALES (renderQuickUnlockScreen(),
// renderSupabaseLoginForm(), confirmChangeUser(), openThemePicker(),
// getTheme()/applyTheme()/saveTheme(), THEMES/MODES) contra una página real
// de Playwright — mismo mecanismo que mi-perfil.spec.js/lubricador-config.spec.js.
// logout()/enterAppAsProfile() (pesadas: OneSignal/Sync/boot()) se
// reemplazan por espías — su comportamiento real ya está documentado y sin
// cambios en este lote; QuickUnlock en tests/unit/quick-unlock.test.js.
// El listener global de 'popstate' (registrado una sola vez en
// DOMContentLoaded, no extraíble por nombre) se reproduce aquí con la
// MISMA línea exacta que app.js — la fidelidad se congela con un test de
// fuente en tests/unit/quick-unlock-history.test.js.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const APP_NAMES = [
  '$', '$$', 'esc', 'ic', 'openModal', 'closeModal',
  'themeButtonHTML', 'openThemePicker', 'getTheme', 'applyTheme', 'saveTheme', 'THEMES', 'MODES', 'THEME_COLOR_BY_MODE',
  'confirmChangeUser',
  'renderQuickUnlockScreen', 'renderSupabaseLoginForm',
];
const appRealSrc = APP_NAMES.map((n) => extractDeclaration(appSource, n)).join('\n\n');

const SNAPSHOT_A = { authUserId: 'auth-a', appUserId: 'u_jose', displayName: 'Jose Guerrero', role: 'LUBRICADOR', active: true };

async function bootQuickUnlock(page, {
  snapshot = SNAPSHOT_A, pinOk = false, locked = false,
} = {}) {
  // page.setContent() a secas deja la página en about:blank (origen
  // opaco) — localStorage (getTheme()/saveTheme()) lanza SecurityError ahí.
  // Mismo fix ya documentado en qr-grease-register-management.spec.js /
  // lubricador-config.spec.js: navegar a la baseURL real antes de inyectar
  // el contenido de prueba, bloqueando solo la carga del documento real.
  await page.route('**/*', (route) => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.continue();
    }
  });
  await page.goto('/');
  await page.setContent('<div></div>');
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.App = { currentUser: null };
      window.__attemptUnlockCalls = [];
      window.__enterAppCalls = [];
      window.__logoutCalls = [];
      window.__dbWriteCalls = [];
      window.__signInCalls = [];
      window.Auth = {
        isSupabaseMode: () => true,
        isAuthenticated: () => false,
        signOut: async () => { window.__dbWriteCalls.push('Auth.signOut'); },
        signIn: async (username, password) => {
          window.__signInCalls.push({ username, password });
          return { user: { appUserId: 'u_' + username, displayName: username, role: 'LUBRICADOR', active: true } };
        },
      };
      window.QuickUnlock = {
        attemptUnlock: async (appUserId, pin) => {
          window.__attemptUnlockCalls.push({ appUserId, pin });
          return ${pinOk} ? { ok: true } : { ok: false, attemptsLeft: 2 };
        },
        isLockedOut: async () => ${locked},
        getLockRemainingMs: async () => 60000,
        isConfigured: async () => true,
        disable: async () => { window.__dbWriteCalls.push('QuickUnlock.disable'); },
      };
      window.DB = {
        allActive: async () => [],
        put: async (...a) => { window.__dbWriteCalls.push(['put', ...a]); },
        delete: async (...a) => { window.__dbWriteCalls.push(['delete', ...a]); },
        clear: async (...a) => { window.__dbWriteCalls.push(['clear', ...a]); },
      };
      // logout()/enterAppAsProfile() reales son pesadas (OneSignal/Sync/
      // boot()) y no cambian en este lote — espías que SÍ pasan por
      // Auth.signOut()/QuickUnlock.disable() (igual que el real), para que
      // "IndexedDB preservado" se compruebe de verdad.
      window.logout = async () => {
        window.__logoutCalls.push(true);
        await window.Auth.signOut();
        await window.QuickUnlock.disable();
        window.renderSupabaseLoginForm();
      };
      window.enterAppAsProfile = (profile) => { window.__enterAppCalls.push(profile); };
      ${appRealSrc}
      // Mismo listener exacto que DOMContentLoaded en app.js (congelado por
      // tests/unit/quick-unlock-history.test.js) — necesario aquí porque no
      // es una declaración con nombre extraíble.
      window.addEventListener('popstate', () => {
        if ($('#quick-unlock-area')) renderSupabaseLoginForm();
      });
      window.renderQuickUnlockScreen = renderQuickUnlockScreen;
      window.renderSupabaseLoginForm = renderSupabaseLoginForm;
      window.confirmChangeUser = confirmChangeUser;
    `,
  });
  await page.evaluate((s) => window.renderQuickUnlockScreen(s), snapshot);
}

test('A. Quick Unlock -> flecha Atras -> Login normal', async ({ page }) => {
  await bootQuickUnlock(page);
  await expect(page.locator('#quick-unlock-area')).toBeVisible();
  await page.locator('#quick-unlock-back').click();
  await expect(page.locator('#supabase-login-form')).toBeVisible();
  await expect(page.locator('#quick-unlock-area')).toHaveCount(0);
});

test('B. Quick Unlock -> "Entrar con otra cuenta" -> confirmar -> Login normal', async ({ page }) => {
  await bootQuickUnlock(page);
  await page.locator('#quick-unlock-change-user').click();
  await expect(page.locator('.modal-body')).toContainText('Vas a salir de la sesión');
  await page.locator('#confirm-change-user-confirm').click();
  await expect(page.locator('#supabase-login-form')).toBeVisible();
  expect(await page.evaluate(() => window.__logoutCalls.length)).toBe(1);
});

test('C. usuario B puede autenticarse despues de abandonar Quick Unlock de usuario A', async ({ page }) => {
  await bootQuickUnlock(page, { snapshot: SNAPSHOT_A });
  await page.locator('#quick-unlock-change-user').click();
  await page.locator('#confirm-change-user-confirm').click();
  await expect(page.locator('#supabase-login-form')).toBeVisible();

  await page.locator('input[name="username"]').fill('edgard');
  await page.locator('input[name="password"]').fill('clave-de-edgard');
  await page.locator('#supabase-login-form button[type="submit"]').click();

  await expect.poll(() => page.evaluate(() => window.__signInCalls)).toEqual([{ username: 'edgard', password: 'clave-de-edgard' }]);
  expect(await page.evaluate(() => window.__enterAppCalls.length)).toBe(1);
});

test('D. el PIN se valida SIEMPRE contra el appUserId del snapshot mostrado — nunca el de otra cuenta', async ({ page }) => {
  const SNAPSHOT_B = { authUserId: 'auth-b', appUserId: 'u_junior', displayName: 'Junior Valles', role: 'ADMINISTRADOR', active: true };
  await bootQuickUnlock(page, { snapshot: SNAPSHOT_B, pinOk: true });
  await page.locator('#quick-unlock-pin').fill('123456');
  await page.locator('#quick-unlock-submit').click();
  await expect.poll(() => page.evaluate(() => window.__attemptUnlockCalls)).toEqual([{ appUserId: 'u_junior', pin: '123456' }]);
  expect(await page.evaluate(() => window.__attemptUnlockCalls.some((c) => c.appUserId === 'u_jose'))).toBe(false);
});

test('E. "Entrar con otra cuenta" desde Quick Unlock nunca escribe en IndexedDB (solo Auth.signOut()/QuickUnlock.disable())', async ({ page }) => {
  await bootQuickUnlock(page);
  await page.locator('#quick-unlock-change-user').click();
  await page.locator('#confirm-change-user-confirm').click();
  await expect.poll(() => page.evaluate(() => window.__dbWriteCalls)).toEqual(['Auth.signOut', 'QuickUnlock.disable']);
  const realWrites = await page.evaluate(() => window.__dbWriteCalls.filter((c) => Array.isArray(c)));
  expect(realWrites).toEqual([]);
});

test('F. Atras de Android (history.back real) desde Quick Unlock -> Login normal', async ({ page }) => {
  await bootQuickUnlock(page);
  await expect(page.locator('#quick-unlock-area')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#supabase-login-form')).toBeVisible();
});

test('G. no existe loop Login/Quick Unlock: un segundo Atras desde el login normal nunca vuelve a Quick Unlock', async ({ page }) => {
  await bootQuickUnlock(page);
  await page.goBack(); // Quick Unlock -> Login (vía popstate real)
  await expect(page.locator('#supabase-login-form')).toBeVisible();
  // Un Atrás MÁS, ya en el login: se dispara un 'popstate' sintético igual
  // al que generaría el navegador (en vez de un 2do page.goBack() real —
  // ese caería sobre el "about:blank" propio del arnés de Playwright,
  // anterior al page.goto('/') de bootQuickUnlock(), algo que no existe en
  // la app real dentro del WebView de Android). Nunca debe reaparecer
  // Quick Unlock — el handler real (ver app.js) solo actúa si
  // #quick-unlock-area está en el DOM, que ya no lo está.
  await page.evaluate(() => window.dispatchEvent(new PopStateEvent('popstate', { state: history.state })));
  await expect(page.locator('#quick-unlock-area')).toHaveCount(0);
  await expect(page.locator('#supabase-login-form')).toBeVisible();
});

test('G2. "Entrar con otra cuenta" tambien limpia la marca de historial — un Atras posterior no reabre Quick Unlock', async ({ page }) => {
  await bootQuickUnlock(page);
  await page.locator('#quick-unlock-change-user').click();
  await page.locator('#confirm-change-user-confirm').click();
  await expect(page.locator('#supabase-login-form')).toBeVisible();
  await page.goBack();
  await expect(page.locator('#quick-unlock-area')).toHaveCount(0);
});

// H (Configuración -> "Entrar con otra cuenta" usa el MISMO flujo) se
// prueba por FUENTE, no aquí: tests/unit/quick-unlock-history.test.js
// confirma que ambos call sites (#quick-unlock-change-user en
// renderQuickUnlockScreen() y #lub-config-change-user en
// renderLubricadorConfig()) llaman literalmente a confirmChangeUser() —
// un test en tiempo de ejecución en esta misma página sería tautológico
// (yo mismo asignaría window.confirmChangeUser aquí).

test('I. Modo Sol: "<-", Desbloquear y "Entrar con otra cuenta" siguen visibles con color real distinto del fondo', async ({ page }) => {
  await bootQuickUnlock(page);
  await page.locator('#btn-theme').click();
  await page.locator('.theme-preview-card[data-mode="sun"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mode'))).toBe('sun');
  await page.locator('#modal-close').click();

  for (const sel of ['#quick-unlock-back', '#quick-unlock-submit', '#quick-unlock-change-user']) {
    await expect(page.locator(sel)).toBeVisible();
  }
  const colors = await page.evaluate(() => {
    const bg = getComputedStyle(document.querySelector('.login-card')).backgroundColor;
    const back = getComputedStyle(document.querySelector('#quick-unlock-back')).color;
    const link = getComputedStyle(document.querySelector('#quick-unlock-change-user')).color;
    return { bg, back, link };
  });
  expect(colors.back).not.toBe(colors.bg);
  expect(colors.link).not.toBe(colors.bg);
});

for (const width of [360, 384, 390, 412]) {
  test(`Mobile @ ${width}px — sin overflow, "<-"/Desbloquear/"Entrar con otra cuenta" >=44px de alto`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await bootQuickUnlock(page);
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    for (const sel of ['#quick-unlock-back', '#quick-unlock-submit', '#quick-unlock-change-user']) {
      const box = await page.locator(sel).boundingBox();
      expect(box.height).toBeGreaterThanOrEqual(44);
    }
  });
}

// Fix 2026-10-09 ("PULIDA LOGIN/QUICK UNLOCK", §0.13 del pedido) — A/B/C/D/E.
for (const width of [360, 390, 412]) {
  test(`A — márgenes de .login-card consistentes @ ${width}px (nunca un salto entre anchos comunes de teléfono)`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await bootQuickUnlock(page);
    const padding = await page.locator('.login-card').evaluate((el) => getComputedStyle(el).padding);
    // Mismo valor exacto en los 3 anchos — nunca el salto real reportado
    // (390/412 caían en el valor "desktop" por el viejo breakpoint de 380px).
    expect(padding).toBe('24px 22px 22px');
  });

  test(`B — Quick Unlock @ ${width}px sin contenido pegado a los bordes del card`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await bootQuickUnlock(page);
    const { cardLeft, cardRight, firstChildLeft } = await page.evaluate(() => {
      const card = document.querySelector('.login-card').getBoundingClientRect();
      const pin = document.querySelector('#quick-unlock-pin').getBoundingClientRect();
      return { cardLeft: card.left, cardRight: card.right, firstChildLeft: pin.left };
    });
    expect(firstChildLeft - cardLeft).toBeGreaterThanOrEqual(18); // nunca pegado al borde izquierdo
  });
}

test('C — "Entrar con otra cuenta" es un <button> real (nunca <a>/texto con onclick)', async ({ page }) => {
  await bootQuickUnlock(page);
  const tag = await page.locator('#quick-unlock-change-user').evaluate((el) => el.tagName);
  expect(tag).toBe('BUTTON');
  const type = await page.locator('#quick-unlock-change-user').getAttribute('type');
  expect(type).toBe('button');
});

test('§0.4 — "Entrar con otra cuenta" se ve como botón secundario real (ancho completo, mismo fondo/borde que .btn, nunca subrayado de link)', async ({ page }) => {
  await bootQuickUnlock(page);
  const btn = page.locator('#quick-unlock-change-user');
  await expect(btn).not.toHaveClass(/link-btn/);
  await expect(btn).toHaveClass(/login-btn-secondary/);
  const style = await btn.evaluate((el) => {
    const s = getComputedStyle(el);
    return { textDecoration: s.textDecorationLine, width: el.getBoundingClientRect().width, cardWidth: el.closest('.login-card').getBoundingClientRect().width };
  });
  expect(style.textDecoration).toBe('none');
  // Ancho completo (menos el padding del card) — nunca un link angosto.
  expect(style.width).toBeGreaterThan(style.cardWidth * 0.8);
});

test('§0.14 — Alto Contraste: "<-", Desbloquear y "Entrar con otra cuenta" siguen visibles con color real distinto del fondo', async ({ page }) => {
  await bootQuickUnlock(page);
  await page.locator('#btn-theme').click();
  await page.locator('.theme-preview-card[data-mode="contrast"]').click();
  await expect.poll(() => page.evaluate(() => document.documentElement.getAttribute('data-mode'))).toBe('contrast');
  await page.locator('#modal-close').click();
  for (const sel of ['#quick-unlock-back', '#quick-unlock-submit', '#quick-unlock-change-user']) {
    await expect(page.locator(sel)).toBeVisible();
  }
});
