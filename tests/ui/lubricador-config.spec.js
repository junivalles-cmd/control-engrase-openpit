// tests/ui/lubricador-config.spec.js
//
// Pantalla "Configuración" exclusiva para LUBRICADOR (pedido "CONFIGURACIÓN
// LUBRICADOR + FIX DE ALERTAS + AUDITORÍA HORÓMETRO", 2026-10-09),
// accesible desde "Mi cuenta → Configuración" — nunca un tab nuevo en el
// bottom nav. Extrae y ejecuta las funciones REALES de app.js
// (renderLubricadorConfig(), miPerfilRoleCrewSummaryHTML(),
// openThemePicker(), getTheme()/applyTheme()/saveTheme(), THEMES/MODES)
// contra una página real de Playwright — mismo mecanismo que
// tests/ui/mi-perfil.spec.js. Auth/DB/getCurrentOperationalScope se
// reemplazan por fakes (su comportamiento real ya se prueba aparte);
// confirmChangeUser() se extrae REAL (es simple: abre un modal de
// confirmación) para probar la integración real del botón "Entrar con otra
// cuenta", con `logout` como espía — su propia garantía de "nunca toca
// IndexedDB operativo" es código preexistente, documentado y sin cambios
// en este lote.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { THEME_PREFERENCE_DECLARATIONS } from '../helpers/themeFixture.js';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');
const appSource = readSource(APP_JS_PATH);
const APP_NAMES = [
  '$', '$$', 'esc', 'ic', 'openModal', 'closeModal',
  'confirmChangeUser', // real: solo abre un modal de confirmación
  'crewCoveragePresentation', 'miPerfilRoleCrewSummaryHTML', 'renderLubricadorConfig',
  ...THEME_PREFERENCE_DECLARATIONS, 'openThemePicker',
  // Fix 2026-10-09 ("CAMBIAR CUADRILLA EN CONFIGURACIÓN"): reales — se
  // prueba que renderLubricadorConfig() los invoca de verdad, nunca una
  // reimplementación. renderLubricadorHome() en sí NO se extrae (es la
  // pantalla "Mi Turno" completa, ya probada aparte en
  // tests/ui/lubricador-mi-turno-real-execution.spec.js) — se reemplaza
  // por un espía después de la extracción.
  'setSelectedCrewId', 'goToLubricadorTurno',
];
const appRealSrc = APP_NAMES.map((n) => extractDeclaration(appSource, n)).join('\n\n');

const SCOPE_CREW = {
  kind: 'CREW_SCOPED', userId: 'u2', role: 'LUBRICADOR', shiftId: 'shift_dia',
  crewId: 'cq1', crewLocationId: 'loc1', authorizedCrews: [{ id: 'cq1', name: 'Cuadrilla 76-08', locationId: 'loc1' }],
};

async function bootConfig(page, {
  displayName = 'Ana Lubricadora', appUserId = 'u_ana', role = 'LUBRICADOR',
  scope = SCOPE_CREW,
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
  await page.setContent('<main id="app-content" class="lub-content"></main>');
  await page.route('https://fonts.googleapis.com/**', route => route.fulfill({contentType:'text/css',body:''}));
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
      window.getCurrentOperationalScope = async () => (${JSON.stringify(scope)});
      window.currentShiftId = () => ${shiftDia ? "'shift_dia'" : "'shift_noche'"};
      window.navigate = (route) => { window.__navigateCalls.push(route); };
      // logout() real es enorme (OneSignal/Sync/notificaciones) y no cambia
      // en este lote — se reemplaza por un espía que SÍ pasa por
      // Auth.signOut() (igual que el real), para que "IndexedDB
      // preservado" se pueda comprobar de verdad: si el flujo real de
      // logout() tocara IndexedDB, window.DB.put/delete/clear lo
      // registrarían igual aquí.
      window.logout = async () => { await window.Auth.signOut(); };
      // Espía — renderLubricadorHome() es la pantalla "Mi Turno" completa,
      // ya probada aparte (tests/ui/lubricador-mi-turno-real-execution.spec.js);
      // acá solo importa confirmar que goToLubricadorTurno() la invoca de
      // verdad después de limpiar la cuadrilla de sesión.
      window.renderLubricadorHome = () => { window.__renderLubricadorHomeCalls = (window.__renderLubricadorHomeCalls || 0) + 1; };
      ${appRealSrc}
      applyTheme(getTheme());
      window.renderLubricadorConfig = renderLubricadorConfig;
      window.goToLubricadorTurno = goToLubricadorTurno;
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
  test('muestra Nombre, Usuario, Rol, Cuadrillas autorizadas', async ({ page }) => {
    await bootConfig(page, { displayName: 'Ana Lubricadora', appUserId: 'u_ana', role: 'LUBRICADOR', shiftDia: true });
    const content = page.locator('#app-content');
    await expect(content).toContainText('Ana Lubricadora');
    await expect(content).toContainText('ana');
    await expect(content).toContainText('LUBRICADOR');
    await expect(content).toContainText('Cuadrilla 76-08');
  });

  // Parte M, test A del pedido ("CONFIGURACIÓN FINAL"): "Mi perfil" es SOLO
  // identidad — Cuadrilla activa/Ubicación/Turno viven ÚNICAMENTE en
  // "Trabajo / Contexto operativo", nunca repetidos en los 2 paneles.
  test('"Mi perfil" NO repite Cuadrilla activa/Ubicación/Turno — eso vive solo en "Trabajo / Contexto operativo"', async ({ page }) => {
    await bootConfig(page, { shiftDia: true });
    const miPerfilPanel = page.locator('.panel-head:has-text("Mi perfil")').locator('..');
    await expect(miPerfilPanel).not.toContainText('Cuadrilla activa');
    await expect(miPerfilPanel).not.toContainText('Ubicación');
    await expect(miPerfilPanel).not.toContainText('Turno Día');
    const contextoPanel = page.locator('.panel-head:has-text("Trabajo / Contexto operativo")').locator('..');
    await expect(contextoPanel).toContainText('Cuadrilla activa');
    await expect(contextoPanel).toContainText('Volcán');
    await expect(contextoPanel).toContainText('Turno Día');
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
  // Fix 2026-10-09 ("CONFIGURACIÓN FINAL", §4 del pedido): tema/modo
  // actuales + preview compacto, antes del botón — reusa getTheme()/
  // THEMES/MODES tal cual, nunca una biblioteca nueva.
  test('muestra el tema y modo ACTUALES (getTheme() real) con un preview de color, antes del botón', async ({ page }) => {
    await bootConfig(page);
    const panel = page.locator('.panel-head:has-text("Apariencia")').locator('..');
    await expect(panel).toContainText('Azul'); // default real de getTheme()
    await expect(panel).toContainText('Claro');
    await expect(panel.locator('.lub-theme-swatch')).toHaveCount(1);
    await expect(panel.locator('#lub-config-theme')).toContainText('Personalizar apariencia');
  });

  test('el botón "Personalizar apariencia" abre el picker REAL con los 8 acentos y 3 modos', async ({ page }) => {
    await bootConfig(page);
    await page.locator('#lub-config-theme').click();
    await expect(page.locator('.theme-preview-card[data-accent]')).toHaveCount(8);
    await expect(page.locator('.theme-preview-card[data-mode]')).toHaveCount(3);
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

  test('conserva ocho IDs de acento y ofrece exactamente tres modos finales', async ({ page }) => {
    await bootConfig(page);
    const { accentIds, modeIds } = await page.evaluate(() => ({
      accentIds: window.THEMES.map((t) => t.id),
      modeIds: window.MODES.map((m) => m.id),
    }));
    expect(accentIds.length).toBe(8);
    expect(accentIds.sort()).toEqual([
      'azul-corp', 'amarillo-cat', 'azul-acero', 'petroleo-ejec', 'grafito', 'verde-bosque', 'cobre-ejec', 'violeta-ejec',
    ].sort());
    expect(modeIds.sort()).toEqual(['dark', 'light', 'sun'].sort());
  });

  test('Azul sigue siendo default; el ID amarillo-cat ahora ofrece Burdeos con texto blanco AA', async ({ page }) => {
    await bootConfig(page);
    const theme = await page.evaluate(() => window.THEMES);
    expect(theme[0].id).toBe('azul-corp');
    const amarillo = theme.find((t) => t.id === 'amarillo-cat');
    expect(amarillo.label).toBe('Burdeos');
    expect(amarillo.onColor.toUpperCase()).toBe('#FFFFFF');
  });
});

// D) Seguridad — "Configurar/Cambiar PIN rápido" se retiró con Quick
// Unlock (UX CAMPO V2, 2026-10-24); solo queda "Cambiar contraseña".
test.describe('D) Seguridad', () => {
  test('"Cambiar contraseña" reusa Mi Perfil (navigate("miperfil")) — nunca un formulario duplicado', async ({ page }) => {
    await bootConfig(page);
    await page.locator('#lub-config-password').click();
    expect(await page.evaluate(() => window.__navigateCalls)).toEqual(['miperfil']);
  });
});

// Fix 2026-10-09 ("CONFIGURACIÓN FINAL", §3 del pedido): "Entrar con otra
// cuenta" se quitó de esta pantalla — ahora vive SOLO en Mi Cuenta
// (openLubAccountMenu()). Esa cobertura (confirmChangeUser real, IndexedDB
// preservado) se movió a tests/ui/lubricador-mi-cuenta.spec.js.
test('E) "Entrar con otra cuenta" ya NO está en Configuración (se movió a Mi Cuenta)', async ({ page }) => {
  await bootConfig(page);
  await expect(page.locator('#lub-config-change-user')).toHaveCount(0);
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

// Pedido "CAMBIAR CUADRILLA EN CONFIGURACIÓN" (2026-10-09) — nueva sección
// "Trabajo / Contexto operativo". Reusa EXACTAMENTE el mismo flujo de
// selección de Mi Turno (setSelectedCrewId('') → goToLubricadorTurno() →
// scope.kind 'NEEDS_CREW_SELECTION' → el picker real de
// renderLubricadorHome(), probado aparte en
// tests/ui/lubricador-mi-turno-real-execution.spec.js) — nunca un segundo
// selector. renderLubricadorHome() se reemplaza por un espía aquí (ver
// bootConfig arriba) a propósito: "D/E/F" del §6 del pedido (Mi
// Turno/KPI/Widget se recalculan) son una propiedad YA probada de esa
// misma función real — confirmar que goToLubricadorTurno() la invoca de
// verdad es, por construcción, confirmar que se heredan gratis.
const SCOPE_CREW_MULTI = {
  kind: 'CREW_SCOPED', userId: 'u2', role: 'LUBRICADOR', shiftId: 'shift_dia',
  crewId: 'cq1', crewLocationId: 'loc1',
  authorizedCrews: [{ id: 'cq1', name: 'Cuadrilla 76-08', locationId: 'loc1' }, { id: 'cq2', name: 'Cuadrilla Volcán', locationId: 'loc2' }],
};
const SCOPE_NEEDS_SELECTION = {
  kind: 'NEEDS_CREW_SELECTION', userId: 'u2', role: 'LUBRICADOR', shiftId: 'shift_dia',
  crewId: null, crewLocationId: null,
  authorizedCrews: [{ id: 'cq1', name: 'Cuadrilla 76-08', locationId: 'loc1' }, { id: 'cq2', name: 'Cuadrilla Volcán', locationId: 'loc2' }],
};
const SCOPE_NO_CREW = {
  kind: 'NO_CREW_ASSIGNED', userId: 'u2', role: 'LUBRICADOR', shiftId: 'shift_dia',
  crewId: null, crewLocationId: null, authorizedCrews: [],
};

test.describe('H) Trabajo / Contexto operativo — Cambiar cuadrilla', () => {
  test('A. 1 cuadrilla autorizada: se muestra como activa (cuadrilla/ubicación/turno) y no muestra una acción inútil', async ({ page }) => {
    await bootConfig(page, { scope: SCOPE_CREW, cuadrillas: [{ id: 'cq1', name: 'Cuadrilla 76-08' }], locations: [{ id: 'loc1', name: 'Volcán' }] });
    const panel = page.locator('.panel-head:has-text("Trabajo / Contexto operativo")').locator('..');
    await expect(panel).toContainText('Cuadrilla 76-08');
    await expect(panel).toContainText('Volcán');
    const btn = page.locator('#lub-config-change-crew');
    await expect(btn).toHaveCount(0);
  });

  test('B. 2+ cuadrillas autorizadas: el botón "Cambiar cuadrilla" está habilitado y visible', async ({ page }) => {
    await bootConfig(page, {
      scope: SCOPE_CREW_MULTI,
      cuadrillas: [{ id: 'cq1', name: 'Cuadrilla 76-08' }, { id: 'cq2', name: 'Cuadrilla Volcán' }],
      locations: [{ id: 'loc1', name: 'Volcán' }, { id: 'loc2', name: 'Rajo Sur' }],
    });
    const btn = page.locator('#lub-config-change-crew');
    await expect(btn).toBeEnabled();
    await expect(btn).toHaveText(/Cambiar cuadrilla/);
  });

  test('C/D/E/F/G. al hacer clic: limpia SOLO la selección de sesión (localStorage, nunca memberships) y reusa goToLubricadorTurno() → renderLubricadorHome() real (Mi Turno/KPI/Widget se recalculan ahí, ya probado aparte)', async ({ page }) => {
    await bootConfig(page, {
      scope: SCOPE_CREW_MULTI,
      cuadrillas: [{ id: 'cq1', name: 'Cuadrilla 76-08' }, { id: 'cq2', name: 'Cuadrilla Volcán' }],
      locations: [{ id: 'loc1', name: 'Volcán' }, { id: 'loc2', name: 'Rajo Sur' }],
    });
    await page.locator('#lub-config-change-crew').click();

    // G: nunca escribe en IndexedDB (memberships/cuadrillas/permisos viven
    // en Supabase, fuera del alcance de este botón).
    const dbCalls = await page.evaluate(() => window.__dbWriteCalls);
    expect(dbCalls).toEqual([]);
    // La selección de SESIÓN sí se limpia (localStorage, scoped por userId)
    // — es la señal que hace que resolveOperationalScope() vuelva a pedir
    // elegir, exactamente igual que el botón real de Mi Turno.
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('engrase_session_crew')));
    expect(stored).toEqual({ userId: 'u2', crewId: '' });
    // C/D/E/F: reusa el MISMO flujo que Mi Turno — goToLubricadorTurno()
    // real termina llamando renderLubricadorHome() (espía aquí).
    const renders = await page.evaluate(() => window.__renderLubricadorHomeCalls);
    expect(renders).toBe(1);
  });

  test('H. nunca ofrece seleccionar una cuadrilla no autorizada — este botón solo limpia la selección, el picker real (con el allowlist de scope.authorizedCrews) vive en Mi Turno, nunca un segundo selector aquí', async ({ page }) => {
    await bootConfig(page, { scope: SCOPE_CREW_MULTI, cuadrillas: [], locations: [] });
    // Esta pantalla NUNCA lista cuadrillas para elegir — ningún
    // "crew-select-btn" ni listado de opciones, solo el botón que limpia
    // la sesión y reenvía al picker real de Mi Turno.
    await expect(page.locator('.crew-select-btn')).toHaveCount(0);
    await expect(page.locator('select[name], [role="listbox"]')).toHaveCount(0);
  });

  test('I. cuadrilla local inválida (ya no autorizada) nunca se presenta como activa — si el scope real la descartó (NEEDS_CREW_SELECTION), muestra el mensaje de "ir a elegir", nunca datos de una cuadrilla no autorizada', async ({ page }) => {
    // resolveOperationalScope() YA descarta un selectedCrewId no autorizado
    // (operational-scope.test.js, "CASO E del pedido") — esta pantalla
    // reusa ese mismo scope ya resuelto, nunca reimplementa la validación.
    await bootConfig(page, { scope: SCOPE_NEEDS_SELECTION, cuadrillas: [], locations: [] });
    await expect(page.locator('#lub-config-change-crew')).toHaveCount(0);
    await expect(page.locator('.panel-head:has-text("Trabajo / Contexto operativo")').locator('..')).toContainText('Entra a Mi Turno para elegir');
  });

  test('scope.kind NO_CREW_ASSIGNED: muestra el mismo mensaje real de "sin cuadrilla", nunca una pantalla de cambio de cuadrilla inexistente', async ({ page }) => {
    await bootConfig(page, { scope: SCOPE_NO_CREW, cuadrillas: [], locations: [] });
    await expect(page.locator('#lub-config-change-crew')).toHaveCount(0);
    await expect(page.locator('.panel-head:has-text("Trabajo / Contexto operativo")').locator('..')).toContainText('Sin cuadrilla autorizada todavía');
  });
});

test('UX coverage roles, informative memberships and responsive natural-height layout', async ({ page }, testInfo) => {
  const locs = [{ id: 'loc1', name: 'Volcán' }, { id: 'loc2', name: 'Mojón' }, { id: 'loc3', name: 'Ubicación ficticia de apoyo con nombre largo' }];
  await bootConfig(page, { scope: { ...SCOPE_CREW_MULTI, allAuthorizedLocationIds: locs.map(l => l.id), principalLocationIds: ['loc1', 'loc2'], supportLocationIds: ['loc3'] }, locations: locs });
  await expect(page.locator('.crew-coverage-list li')).toHaveCount(3);
  await expect(page.locator('.crew-coverage-role.principal')).toHaveCount(2);
  await expect(page.locator('.crew-coverage-role.support')).toHaveText('APOYO');
  await expect(page.locator('.authorized-crew-chip')).toHaveCount(2);
  await expect(page.locator('.authorized-crew-list button, .authorized-crew-list [role=button]')).toHaveCount(0);
  await expect(page.locator('.lub-operational-context b', { hasText: /^Ubicación$/ })).toHaveCount(0);
  const sizes = await page.evaluate(() => ({ width: innerWidth, columns: getComputedStyle(document.querySelector('.lub-profile-layout')).gridTemplateColumns.split(' ').length, overflow: document.documentElement.scrollWidth > innerWidth, max: getComputedStyle(document.querySelector('.lub-profile-layout')).maxWidth }));
  expect(sizes.columns).toBe(sizes.width >= 1024 ? 2 : 1);
  expect(sizes.max).toBe('920px'); expect(sizes.overflow).toBe(false);
  expect((await page.locator('#lub-config-change-crew').boundingBox()).height).toBeGreaterThanOrEqual(44);
  await page.screenshot({ path: testInfo.outputPath('config-coverage.png'), fullPage: true });
});
