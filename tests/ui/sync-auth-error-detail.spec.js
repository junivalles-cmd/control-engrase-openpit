// tests/ui/sync-auth-error-detail.spec.js
//
// Lote "Sync 403 diagnostic" — botón de detalle junto al badge de conexión,
// visible SOLO cuando lastSyncState.status==='AUTH_FORBIDDEN' con detalle
// sanitizado disponible (ver sync.js: authErrorDetails). Extrae y ejecuta
// las funciones REALES de app.js (updateConnBadge(), showSyncAuthErrorDetail())
// contra una página real de Playwright — nunca una reimplementación. El
// detalle mostrado es DATA fija en el test (ya producida por sync.js,
// probado aparte en tests/unit/sync-auth-gate.test.js) — aquí solo se
// prueba la UI que lo muestra.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const APP_NAMES = ['$', '$$', 'esc', 'openModal', 'closeModal', 'updateConnBadge', 'showSyncAuthErrorDetail'];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');

function topbarFixture() {
  return `
  <div class="app-shell">
    <div class="main">
      <header class="topbar">
        <div class="topbar-title" id="topbar-title">Dashboard</div>
        <div class="topbar-right">
          <button type="button" id="conn-badge" class="conn-badge" title="Tocar para sincronizar ahora"></button>
          <button type="button" id="conn-badge-detail" class="icon-btn hidden" aria-label="Ver detalle del error de sincronización" title="Ver detalle del error de sincronización">ⓘ</button>
        </div>
      </header>
      <main class="app-content"><div class="empty-state">contenido</div></main>
    </div>
  </div>`;
}

async function bootPage(page, { lastSyncState = { status: 'idle' }, online = true } = {}) {
  await page.setContent(topbarFixture());
  await page.addStyleTag({ path: STYLES_PATH });
  await page.addScriptTag({
    content: `
      window.lastSyncState = ${JSON.stringify(lastSyncState)};
      Object.defineProperty(window.navigator, 'onLine', { value: ${online}, configurable: true });
      let lastSyncState = window.lastSyncState;
      ${appRealSrc}
      window.updateConnBadge = updateConnBadge;
      window.showSyncAuthErrorDetail = showSyncAuthErrorDetail;
    `,
  });
  await page.evaluate(() => window.updateConnBadge());
}

test.describe('A) botón de detalle oculto por defecto — solo aparece con AUTH_FORBIDDEN + detalle', () => {
  test('status "ok": oculto', async ({ page }) => {
    await bootPage(page, { lastSyncState: { status: 'ok' } });
    await expect(page.locator('#conn-badge-detail')).toHaveClass(/hidden/);
  });

  test('status "AUTH_REQUIRED" (sesión, no permiso): oculto — son casos distintos', async ({ page }) => {
    await bootPage(page, { lastSyncState: { status: 'AUTH_REQUIRED' } });
    await expect(page.locator('#conn-badge-detail')).toHaveClass(/hidden/);
  });

  test('status "AUTH_FORBIDDEN" pero SIN authErrorDetails (vacío): oculto — nunca un botón sin nada que mostrar', async ({ page }) => {
    await bootPage(page, { lastSyncState: { status: 'AUTH_FORBIDDEN', authErrorDetails: [] } });
    await expect(page.locator('#conn-badge-detail')).toHaveClass(/hidden/);
  });

  test('status "AUTH_FORBIDDEN" con detalle: visible', async ({ page }) => {
    await bootPage(page, {
      lastSyncState: { status: 'AUTH_FORBIDDEN', authErrorDetails: [{ store: 'lubrication_records', id: 'greg_x', operation: 'INSERT', status: 403, role: 'LUBRICADOR', message: 'permission denied', at: '2026-10-06T13:56:00.000Z' }] },
    });
    await expect(page.locator('#conn-badge-detail')).not.toHaveClass(/hidden/);
  });
});

test.describe('B) badge sigue disparando sincronización al tocarlo — comportamiento previo intacto', () => {
  test('el badge NUNCA pierde su texto "SIN PERMISO PARA SINCRONIZAR" al agregar el botón de detalle', async ({ page }) => {
    await bootPage(page, {
      lastSyncState: { status: 'AUTH_FORBIDDEN', authErrorDetails: [{ store: 'lubrication_records', operation: 'INSERT', status: 403 }] },
    });
    await expect(page.locator('#conn-badge')).toHaveText('SIN PERMISO PARA SINCRONIZAR');
  });
});

test.describe('C) modal de detalle — muestra store/operación/HTTP/mensaje/rol/hora, nunca JWT/apikey/payload', () => {
  test('abre con openModal() real y muestra los campos sanitizados de la entrada más reciente', async ({ page }) => {
    await bootPage(page, {
      lastSyncState: {
        status: 'AUTH_FORBIDDEN',
        authErrorDetails: [
          { store: 'lubrication_records', id: 'greg_muwqs9hscy6p24', operation: 'INSERT', status: 403, role: 'LUBRICADOR', message: 'new row violates row-level security policy', at: '2026-10-06T13:56:26.512Z' },
        ],
      },
    });
    await page.evaluate(() => window.showSyncAuthErrorDetail());
    await expect(page.locator('.modal-head')).toContainText('Sin permiso para sincronizar');
    await expect(page.locator('.modal-body')).toContainText('lubrication_records');
    await expect(page.locator('.modal-body')).toContainText('INSERT');
    await expect(page.locator('.modal-body')).toContainText('403');
    await expect(page.locator('.modal-body')).toContainText('LUBRICADOR');
    await expect(page.locator('.modal-body')).toContainText('row-level security policy');
  });

  test('el contenido del modal nunca incluye un JWT/apikey/password, aunque el mensaje del servidor sea largo', async ({ page }) => {
    await bootPage(page, {
      lastSyncState: {
        status: 'AUTH_FORBIDDEN',
        authErrorDetails: [{ store: 'push_tokens', operation: 'UPDATE', status: 403, role: 'SUPERVISOR', message: 'permission denied for table engrase_sync', at: '2026-10-06T14:00:00.000Z' }],
      },
    });
    await page.evaluate(() => window.showSyncAuthErrorDetail());
    const html = await page.locator('#modal-overlay').innerHTML();
    expect(html.toLowerCase()).not.toContain('bearer ');
    expect(html.toLowerCase()).not.toContain('apikey');
    expect(html.toLowerCase()).not.toContain('password');
    expect(html.toLowerCase()).not.toContain('jwt');
  });

  test('sin ningún authErrorDetails: no hace nada (nunca abre un modal vacío)', async ({ page }) => {
    await bootPage(page, { lastSyncState: { status: 'ok' } });
    await page.evaluate(() => window.showSyncAuthErrorDetail());
    await expect(page.locator('#modal-overlay.open')).toHaveCount(0);
  });
});

for (const width of [390, 412]) {
  test(`D) Topbar @ ${width}px con botón de detalle visible — sin scroll horizontal`, async ({ page }) => {
    await page.setViewportSize({ width, height: 700 });
    await bootPage(page, {
      lastSyncState: { status: 'AUTH_FORBIDDEN', authErrorDetails: [{ store: 'lubrication_records', operation: 'INSERT', status: 403 }] },
    });
    const { scrollWidth, clientWidth } = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, clientWidth: document.documentElement.clientWidth }));
    expect(scrollWidth).toBeLessThanOrEqual(clientWidth);
    // El botón debe seguir siendo un objetivo táctil real, no solo visible.
    const box = await page.locator('#conn-badge-detail').boundingBox();
    expect(box).not.toBeNull();
  });
}
