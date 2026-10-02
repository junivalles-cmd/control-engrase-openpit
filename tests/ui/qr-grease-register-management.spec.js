// tests/ui/qr-grease-register-management.spec.js
//
// FIX QUIRÚRGICO — bug documentado en docs/OPERATIONAL_SCOPE.md
// ("Bug pre-existente encontrado..."): en showEquipmentQrInfo(), el botón
// "Registrar engrase ahora" para ADMIN/PLANIFICADOR/SUPERVISOR llamaba a
// startGreaseFlow(equipment.id, App.route) — App.route es un STRING (p.ej.
// 'equipos'), no un elemento DOM ni undefined. startGreaseFlow() solo sabe
// escribir en un elemento real o, sin `target`, navegar a Registrar Engrase
// — un string ahí nunca hace aparecer el formulario en ningún lado (una
// asignación de propiedad sobre un string primitivo no lanza, simplemente
// no hace nada).
//
// Carga la función REAL showEquipmentQrInfo() (extraída de app.js, sin
// reimplementar nada) en una página real de Playwright, con DB/App y
// startGreaseFlow/startLubricadorGreaseFlow reemplazados por ESPÍAS (no se
// vuelve a probar aquí su comportamiento interno, ya cubierto en otros
// archivos) — lo que se verifica es CON QUÉ ARGUMENTOS los llama el botón
// del QR, para cada rol y escenario.

import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, LUBRICATION_STATUS_JS_PATH, SHIFTS_JS_PATH, OPERATIONAL_SCOPE_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const statusSource = readSource(LUBRICATION_STATUS_JS_PATH);
const shiftsSource = readSource(SHIFTS_JS_PATH);
const opScopeSource = readSource(OPERATIONAL_SCOPE_JS_PATH);

const APP_NAMES = [
  '$', '$$', 'esc', 'ic', 'fmtDate', 'STATUS_COLOR',
  'getSelectedCrewId', 'setSelectedCrewId', 'getCurrentOperationalScope',
  'loadAssignmentContext', 'openModal', 'closeModal',
  'showEquipmentQrInfo',
];
const STATUS_NAMES = ['fmt', 'WEEKDAY_NAMES', 'mostRecentAssignedDate', 'weekdayStatusFor', 'statusFor'];
const SHIFTS_NAMES = ['currentShiftId'];
const OP_SCOPE_NAMES = [
  'ASSIGNMENT_STATUS', 'ROLES_CREW_SCOPED', 'getAuthorizedCrews', 'resolveOperationalScope',
  'computeOccurrenceKey', 'toISODateUTCLocal',
  'findActivePendingAssignment', 'canLubricadorExecuteEquipment', 'findExistingWorkForEquipment',
];

const appSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');
const statusSrc = STATUS_NAMES.map(n => extractDeclaration(statusSource, n)).join('\n\n');
const shiftsSrc = SHIFTS_NAMES.map(n => extractDeclaration(shiftsSource, n)).join('\n\n');
const opScopeSrc = OP_SCOPE_NAMES.map(n => extractDeclaration(opScopeSource, n)).join('\n\n');

// Se detecta directo en el texto fuente REAL de showEquipmentQrInfo() — si
// alguna vez alguien reintroduce `App.route` como segundo argumento de
// startGreaseFlow(), este test también lo detecta sin necesitar ejecutar
// nada (defensa adicional a la funcional de abajo).
test('showEquipmentQrInfo(): el código fuente real nunca pasa App.route como target de startGreaseFlow (regresión del bug documentado)', () => {
  const src = extractDeclaration(appSource, 'showEquipmentQrInfo');
  expect(src).not.toMatch(/startGreaseFlow\([^)]*App\.route/);
});

const HOY_NOMBRE = ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'][new Date().getDay()];
const HOY_ISO = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();

const LOCATIONS = [{ id: 'loc_volcan', name: 'Volcán', active: true }];
// memberUserIds siempre incluye 'u1' (corrección arquitectónica 2026-10-02
// — la cuadrilla autoriza al USUARIO, nunca a un dispositivo): inerte para
// los roles de jefatura (GLOBAL, ni siquiera consultan authorizedCrews),
// real para LUBRICADOR — con 1 sola cuadrilla autorizada se autoselecciona
// sola (CREW_SCOPED), sin necesitar el viejo parámetro `deviceCrewId`.
const CUADRILLAS = [{ id: 'crew_volcan', name: 'Cuadrilla Volcán', locationId: 'loc_volcan', isDefault: true, active: true, createdAt: '2026-01-01', memberUserIds: ['u1'] }];

// eq_planned: plan "Día y turno" programado HOY, sin assignment -> PLANNED
// eq_assigned: mismo plan, CON assignment activa para la ocurrencia de hoy -> ASSIGNED
// eq_none: plan "Día y turno" que NO incluye hoy -> sin trabajo aplicable (OUT_OF_PLAN)
// eq_out_of_scope: otra ubicación, SIN assignment alguna -> bloqueado para el Lubricador de crew_volcan
const EQUIPOS = [
  { id: 'eq_planned', code: 'EQ-PLANNED', shortCode: '', brand: 'Cat', model: '740B', locationId: 'loc_volcan', status: 'Operativo', hourmeter: 100, shiftId: 'shift_dia' },
  { id: 'eq_assigned', code: 'EQ-ASSIGNED', shortCode: '', brand: 'Cat', model: '740B', locationId: 'loc_taller', status: 'Operativo', hourmeter: 100, shiftId: 'shift_dia' },
  { id: 'eq_none', code: 'EQ-NONE', shortCode: '', brand: 'Cat', model: '740B', locationId: 'loc_volcan', status: 'Operativo', hourmeter: 100, shiftId: 'shift_dia' },
  { id: 'eq_out_of_scope', code: 'EQ-OOS', shortCode: '', brand: 'Cat', model: '740B', locationId: 'loc_taller', status: 'Operativo', hourmeter: 100, shiftId: 'shift_dia' },
];
const OTRO_DIA = HOY_NOMBRE === 'Lunes' ? 'Martes' : 'Lunes';
const PLANS = [
  { id: 'plan_planned', equipmentId: 'eq_planned', controlType: 'Día y turno de la semana', assignedDays: [HOY_NOMBRE] },
  { id: 'plan_assigned', equipmentId: 'eq_assigned', controlType: 'Día y turno de la semana', assignedDays: [HOY_NOMBRE] },
  { id: 'plan_oos', equipmentId: 'eq_out_of_scope', controlType: 'Día y turno de la semana', assignedDays: [HOY_NOMBRE] },
  { id: 'plan_none', equipmentId: 'eq_none', controlType: 'Día y turno de la semana', assignedDays: [OTRO_DIA] },
];
const ASSIGNMENTS = [
  { id: 'asg1', occurrenceKey: `plan_assigned:${HOY_ISO}`, equipmentId: 'eq_assigned', assignedCrewId: 'crew_volcan', status: 'PENDING', active: true },
];

async function bootPage(page, { role } = {}) {
  // `page.setContent()` a secas deja la página en `about:blank` (origen
  // opaco) — `localStorage` ahí lanza SecurityError en Chromium, y
  // getSelectedCrewId()/setSelectedCrewId() (comodidad de sesión, corrección
  // arquitectónica 2026-10-02) lo usan — mismo motivo que antes (patrón de
  // fallo silencioso que este archivo ya evitaba). Navegar a la baseURL real
  // del webServer de Playwright da un origen real para localStorage — pero
  // esa baseURL sirve la app REAL (index.html con <script src="app.js"> de
  // verdad): dejarla cargar declararía de nuevo (colisión de nombres) todo
  // lo que este archivo ya inyecta por su cuenta más abajo. Se bloquea toda
  // request de red y se sirve un HTML vacío en su lugar — el origen queda
  // siendo real (http://localhost:4173), pero sin que la app real llegue a
  // ejecutarse.
  await page.route('**/*', route => {
    if (route.request().resourceType() === 'document') {
      route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html><body></body></html>' });
    } else {
      route.abort();
    }
  });
  await page.goto('/');
  await page.setContent('<div id="app-content"></div>');
  await page.addScriptTag({
    content: `
      window.App = {
        currentUser: { id: 'u1', name: 'Test User', role: ${JSON.stringify(role)} },
        generalSettings: { shiftDayStart: 6, shiftNightStart: 18 },
        route: 'equipos',
      };
      window.__calls = { startGreaseFlow: [], startLubricadorGreaseFlow: [], openEquipmentDetail: [] };
      window.startGreaseFlow = (...args) => { window.__calls.startGreaseFlow.push(args); };
      window.startLubricadorGreaseFlow = (...args) => { window.__calls.startLubricadorGreaseFlow.push(args); };
      window.openEquipmentDetail = (...args) => { window.__calls.openEquipmentDetail.push(args); };
      window.showInAppToast = () => {};

      // Comodidad de sesión (corrección arquitectónica 2026-10-02): sin
      // ninguna selección previa, un Lubricador con 1 sola cuadrilla
      // autorizada (ver CUADRILLAS, memberUserIds siempre incluye 'u1') se
      // autoselecciona sola — no hace falta sembrar nada en localStorage
      // para estos tests. Se limpia igual, por higiene entre tests.
      try { localStorage.clear(); } catch (e) {}

      window.DB = {
        allActive: async (store) => ({
          equipment: ${JSON.stringify(EQUIPOS)},
          locations: ${JSON.stringify(LOCATIONS)},
          lubrication_records: [],
          lubrication_plans: ${JSON.stringify(PLANS)},
          cuadrillas: ${JSON.stringify(CUADRILLAS)},
          lubrication_assignments: ${JSON.stringify(ASSIGNMENTS)},
        }[store] || []),
        get: async (store, id) => {
          if (store === 'equipment') return ${JSON.stringify(EQUIPOS)}.find(e => e.id === id) || null;
          return null;
        },
      };

      ${shiftsSrc}
      ${statusSrc}
      ${opScopeSrc}
      ${appSrc}
      window.showEquipmentQrInfo = showEquipmentQrInfo;
    `,
  });
}

async function abrirQr(page, equipmentId) {
  await page.evaluate((id) => window.showEquipmentQrInfo(id), equipmentId);
}

test.describe('A/B/C — jefaturas, QR "Registrar engrase ahora" (bug del target string)', () => {
  for (const role of ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR']) {
    test(`${role}: click "Registrar engrase ahora" llama a startGreaseFlow SIN un string como target (nunca App.route)`, async ({ page }) => {
      await bootPage(page, { role });
      await abrirQr(page, 'eq_planned');
      await expect(page.locator('#qr-info-register')).toBeVisible();
      await page.locator('#qr-info-register').click();

      const calls = await page.evaluate(() => window.__calls.startGreaseFlow);
      expect(calls).toHaveLength(1);
      const [, target] = calls[0];
      // El fix: nunca un string (era App.route === 'equipos') — solo
      // undefined (cae a navigate('registrar')) o un elemento DOM real.
      expect(typeof target).not.toBe('string');
    });
  }
});

test.describe('D/E — Lubricador, scope operativo (sin regresión de permisos)', () => {
  test('D — Lubricador CON dispositivo asignado a la cuadrilla del equipo: puede registrar (botón visible)', async ({ page }) => {
    await bootPage(page, { role: 'LUBRICADOR' });
    await abrirQr(page, 'eq_planned'); // loc_volcan, misma ubicación que la cuadrilla del dispositivo
    await expect(page.locator('#qr-info-register')).toBeVisible();
    await page.locator('#qr-info-register').click();
    const calls = await page.evaluate(() => window.__calls.startLubricadorGreaseFlow);
    expect(calls).toHaveLength(1);
  });

  test('E — Lubricador FUERA de su cuadrilla/ubicación y sin assignment: bloqueado, sin botón de registrar', async ({ page }) => {
    await bootPage(page, { role: 'LUBRICADOR' });
    // eq_out_of_scope: otra ubicación (loc_taller) y SIN ninguna assignment
    // hacia crew_volcan -> canLubricadorExecuteEquipment() debe bloquear.
    await abrirQr(page, 'eq_out_of_scope');
    await expect(page.locator('#qr-info-register')).toHaveCount(0);
    await expect(page.locator('#qr-info-out-of-plan')).toHaveCount(0);
    await expect(page.locator('.qr-info-alert', { hasText: 'no pertenece a tu cuadrilla' })).toBeVisible();
    const calls = await page.evaluate(() => window.__calls.startLubricadorGreaseFlow);
    expect(calls).toHaveLength(0);
  });
});

test.describe('F/G/H — prioridad ASSIGNED > PLANNED > OUT_OF_PLAN vía QR (Lubricador, mismo dispositivo)', () => {
  test('F — equipo con assignment activa hacia mi cuadrilla: se ofrece "Registrar engrase ahora" (abre ASSIGNED), NUNCA "fuera de plan"', async ({ page }) => {
    await bootPage(page, { role: 'LUBRICADOR' });
    await abrirQr(page, 'eq_assigned'); // fuera de ubicación normal, pero con assignment a crew_volcan
    await expect(page.locator('#qr-info-register')).toBeVisible();
    await expect(page.locator('#qr-info-out-of-plan')).toHaveCount(0);
  });

  test('G — equipo con occurrence normal pendiente hoy (dentro de mi ubicación): "Registrar engrase ahora", nunca "fuera de plan"', async ({ page }) => {
    await bootPage(page, { role: 'LUBRICADOR' });
    await abrirQr(page, 'eq_planned');
    await expect(page.locator('#qr-info-register')).toBeVisible();
    await expect(page.locator('#qr-info-out-of-plan')).toHaveCount(0);
  });

  test('H — equipo sin ninguna ocurrencia aplicable hoy (dentro de mi ubicación): SOLO se ofrece "Registrar fuera de plan"', async ({ page }) => {
    await bootPage(page, { role: 'LUBRICADOR' });
    await abrirQr(page, 'eq_none'); // loc_volcan, plan programado otro día, sin assignment
    await expect(page.locator('#qr-info-out-of-plan')).toBeVisible();
    await expect(page.locator('#qr-info-register')).toHaveCount(0);
    await page.locator('#qr-info-out-of-plan').click();
    const calls = await page.evaluate(() => window.__calls.startLubricadorGreaseFlow);
    expect(calls).toHaveLength(1);
    expect(calls[0][1]).toEqual({ outOfPlan: true });
  });
});

test.describe('I — cero doble registro', () => {
  // Un test por rol (page fresca de Playwright cada vez — reutilizar la
  // misma `page` entre iteraciones de un for-loop deja `window.__calls` de
  // la iteración anterior sin recargar el documento de verdad).
  for (const role of ['ADMINISTRADOR', 'PLANIFICADOR', 'SUPERVISOR']) {
    test(`${role}: un solo click en "Registrar engrase ahora" dispara exactamente UNA llamada de arranque de flujo`, async ({ page }) => {
      await bootPage(page, { role });
      await abrirQr(page, 'eq_planned');
      await page.locator('#qr-info-register').click();
      const calls = await page.evaluate(() => window.__calls.startGreaseFlow);
      expect(calls).toHaveLength(1);
    });
  }

  test('Lubricador: un solo click no crea dos flujos ni dos assignments distintas para la misma ocurrencia', async ({ page }) => {
    await bootPage(page, { role: 'LUBRICADOR' });
    await abrirQr(page, 'eq_assigned');
    await page.locator('#qr-info-register').click();
    const calls = await page.evaluate(() => window.__calls.startLubricadorGreaseFlow);
    expect(calls).toHaveLength(1);
    // ASSIGNED: arranca el flujo normal (sin outOfPlan) — nunca duplica la
    // asignación ya existente ni la convierte en fuera de plan.
    expect(calls[0][1]).toBeUndefined();
  });
});
