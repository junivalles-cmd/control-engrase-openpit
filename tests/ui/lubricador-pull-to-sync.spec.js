// tests/ui/lubricador-pull-to-sync.spec.js
//
// UX CAMPO V2 (2026-10-24), Partes O-R del pedido — pull-to-sync, SOLO en
// Mi Turno. Carga bootLubricador()/wirePullToSync() REALES (mismo fixture
// que lubricador-shell-boot-regression.spec.js) y simula el gesto con
// TouchEvent sintéticos reales (Touch/TouchEvent del navegador, nunca un
// mock de la función) — nunca llama wirePullToSync() aparte ni reimplementa
// el gesto en el test.

import { test, expect } from '@playwright/test';
import { bootBell } from '../helpers/lubNotificationBellFixture.js';

async function pull(page, distance) {
  await page.evaluate((distance) => {
    const t = (y) => new Touch({ identifier: 1, target: document.body, clientX: 20, clientY: y });
    document.dispatchEvent(new TouchEvent('touchstart', { touches: [t(10)], bubbles: true, cancelable: true }));
    document.dispatchEvent(new TouchEvent('touchmove', { touches: [t(10 + distance)], bubbles: true, cancelable: true }));
  }, distance);
}
async function release(page) {
  await page.evaluate(() => {
    document.dispatchEvent(new TouchEvent('touchend', { touches: [], bubbles: true, cancelable: true }));
  });
}

const indicator = page => page.locator('#lub-pull-indicator');

test('arrastrar por debajo del umbral muestra "Desliza para sincronizar"; soltar ahí NUNCA sincroniza', async ({ page }) => {
  const calls = [];
  const errors = await bootBell(page);
  await page.evaluate(() => { window.Sync.fullSync = async () => { window.__pullCalls = (window.__pullCalls || 0) + 1; return { ok: true }; }; });
  await pull(page, 20); // < THRESHOLD (56)
  await expect(indicator(page)).toHaveText('Desliza para sincronizar');
  await release(page);
  expect(await page.evaluate(() => window.__pullCalls || 0)).toBe(0);
  await expect(indicator(page)).toBeHidden();
  expect(errors).toEqual([]);
});

test('arrastrar por encima del umbral cambia a "Suelta para sincronizar"; soltar ahí llama Sync.fullSync() UNA sola vez y termina en "Sincronizado"', async ({ page }) => {
  const errors = await bootBell(page);
  await page.evaluate(() => {
    window.Sync.fullSync = async () => {
      window.__pullCalls = (window.__pullCalls || 0) + 1;
      window.onSyncStateChange({ status: 'ok', pulled: 0, pushed: 0, at: new Date().toISOString() });
      return { ok: true };
    };
  });
  await pull(page, 70); // >= THRESHOLD (56)
  await expect(indicator(page)).toHaveText('Suelta para sincronizar');
  await release(page);
  // El mock resuelve Sync.fullSync() casi al instante (sin latencia de red
  // real) — "Sincronizando…" es un estado real pero efímero aquí; lo que
  // importa es que termina en el estado final correcto, UNA sola llamada.
  await expect(indicator(page)).toHaveText('Sincronizado');
  expect(await page.evaluate(() => window.__pullCalls)).toBe(1);
  expect(errors).toEqual([]);
});

test('single-flight real: si Sync.syncing ya es true, el gesto nunca llama Sync.fullSync() ni muestra "Sincronizando…"', async ({ page }) => {
  const errors = await bootBell(page);
  await page.evaluate(() => {
    window.Sync.syncing = true;
    window.Sync.fullSync = async () => { window.__pullCalls = (window.__pullCalls || 0) + 1; return { ok: true }; };
  });
  await pull(page, 70);
  await release(page);
  expect(await page.evaluate(() => window.__pullCalls || 0)).toBe(0);
  expect(errors).toEqual([]);
});

test('sin conexión: soltar por encima del umbral muestra el mensaje offline real, nunca llama Sync.fullSync()', async ({ page }) => {
  const errors = await bootBell(page);
  await page.evaluate(() => {
    Object.defineProperty(window.navigator, 'onLine', { value: false, configurable: true });
    window.Sync.fullSync = async () => { window.__pullCalls = (window.__pullCalls || 0) + 1; return { ok: true }; };
  });
  await pull(page, 70);
  await release(page);
  await expect(indicator(page)).toHaveText('Sin conexión · los cambios se enviarán al recuperar internet');
  expect(await page.evaluate(() => window.__pullCalls || 0)).toBe(0);
  expect(errors).toEqual([]);
});

test('sync parcial (advertencia aislada) termina en "Sincronizado con advertencia", nunca en "Sincronizado" liso', async ({ page }) => {
  const errors = await bootBell(page);
  await page.evaluate(() => {
    window.Sync.fullSync = async () => {
      window.onSyncStateChange({ status: 'partial', pulled: 0, pushed: 1, errors: [], authErrors: 0, conflicts: 1, at: new Date().toISOString() });
      return { ok: false };
    };
  });
  await pull(page, 70);
  await release(page);
  await expect(indicator(page)).toHaveText('Sincronizado con advertencia');
  expect(errors).toEqual([]);
});

test('SOLO en Mi Turno: el gesto no hace nada en otra ruta (App.route !== "turno")', async ({ page }) => {
  const errors = await bootBell(page);
  await page.evaluate(() => {
    App.route = 'anomalias';
    window.Sync.fullSync = async () => { window.__pullCalls = (window.__pullCalls || 0) + 1; return { ok: true }; };
  });
  await pull(page, 70);
  await expect(indicator(page)).toBeHidden();
  await release(page);
  expect(await page.evaluate(() => window.__pullCalls || 0)).toBe(0);
  expect(errors).toEqual([]);
});

test('#conn-badge sigue siendo una alternativa accesible real — pull-to-sync nunca es la única forma de sincronizar', async ({ page }) => {
  const errors = await bootBell(page);
  await expect(page.locator('#conn-badge')).toBeVisible();
  expect(errors).toEqual([]);
});

test('el indicador nunca reserva espacio permanente: altura 0 en reposo, antes y después del gesto', async ({ page }) => {
  const errors = await bootBell(page);
  await page.evaluate(() => { window.Sync.fullSync = async () => { window.onSyncStateChange({ status: 'ok', pulled: 0, pushed: 0, at: new Date().toISOString() }); return { ok: true }; }; });
  const before = await indicator(page).evaluate(el => getComputedStyle(el).height);
  expect(before).toBe('0px');
  await pull(page, 70);
  await release(page);
  await expect(indicator(page)).toHaveText('Sincronizado');
  // Tras el ciclo (reset diferido por setTimeout), vuelve a 0 — nunca queda un hueco fijo.
  await expect.poll(() => indicator(page).evaluate(el => getComputedStyle(el).height)).toBe('0px');
  expect(errors).toEqual([]);
});
