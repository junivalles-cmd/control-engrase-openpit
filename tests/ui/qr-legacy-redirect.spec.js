// tests/ui/qr-legacy-redirect.spec.js
//
// Pedido "COMPATIBILIDAD QR LEGACY ANTES DE MIGRACIÓN PAGES" (2026-10-10):
// QR físicos impresos cuando el sitio vivía en
// /control-engrase-openpit/ deben seguir funcionando después de renombrar
// el repo a junivalles-cmd.github.io (que sirve en la raíz). Esta página
// de compatibilidad (CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/control-
// engrase-openpit/index.html) solo reenvía a la raíz preservando
// hash/query — nunca interpreta un parámetro como destino (sin open-
// redirect posible).
//
// Corre contra `vite preview` (sirve dist/ ESTÁTICO, como GitHub Pages
// real) en vez del servidor de desarrollo compartido por el resto de la
// suite (playwright.config.js, `npm run dev`): el middleware HTML de Vite
// dev normaliza /control-engrase-openpit/index.html?x=1 descartando la
// query ANTES de que el script de esta página llegue a correr — un
// artefacto propio del dev server, confirmado con curl, que no existe al
// servir estático (ni en `vite preview` ni en GitHub Pages real). Por eso
// este archivo arranca su PROPIO server efímero sobre dist/, apuntando a
// exactamente lo que build+verify:dist ya validaron.

import { test as base, expect } from '@playwright/test';
import { spawn } from 'node:child_process';

// Puerto único por worker de Playwright: fullyParallel reparte los tests de
// este archivo entre varios workers, cada uno necesita su propio `vite
// preview` (--strictPort hace que el 2o/3er worker fallen si comparten puerto).
let PORT;
let BASE;
let previewProcess;

base.beforeAll(async ({}, testInfo) => {
  PORT = 4175 + testInfo.workerIndex;
  BASE = `http://localhost:${PORT}`;
  previewProcess = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    shell: true, stdio: 'pipe', cwd: process.cwd(),
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('vite preview no arrancó a tiempo')), 20000);
    const onData = (chunk) => {
      if (chunk.toString().includes('Local:') || chunk.toString().includes(String(PORT))) {
        clearTimeout(timeout);
        previewProcess.stdout.off('data', onData);
        setTimeout(resolve, 300); // margen corto para que el socket ya acepte conexiones
      }
    };
    previewProcess.stdout.on('data', onData);
    previewProcess.on('error', reject);
  });
});

base.afterAll(async () => {
  // spawn(..., { shell: true }) en Windows deja el proceso real de
  // `vite preview` como NIETO del PID devuelto (cmd.exe de por medio) —
  // .kill() normal solo mata el cmd.exe y el server queda huérfano,
  // ocupando el puerto para la próxima corrida. taskkill /T mata el árbol
  // completo.
  if (previewProcess?.pid) {
    await new Promise((resolve) => {
      const k = spawn('taskkill', ['/PID', String(previewProcess.pid), '/T', '/F'], { shell: true, stdio: 'ignore' });
      k.on('exit', resolve);
      k.on('error', resolve);
    });
  }
});

const test = base.extend({});

// NOTA sobre el estado "final" vs el redirect en sí: una vez que el
// redirect llega a "/" con #eq=... en el hash, captureQrDeepLink() (app.js,
// código YA existente, sin tocar) consume ese hash con
// history.replaceState(null, '', pathname + search) — lo guarda en
// App.pendingQrEquipmentId y LIMPIA el hash de la barra, a propósito
// ("limpia el hash"), igual que con cualquier link #eq= nuevo (no es un
// comportamiento especial de la página legacy). Por eso estos tests
// verifican la navegación INTERMEDIA (el redirect en sí, que es lo que
// este lote implementa) en vez de pelear con esa 2a reescritura, que es
// lógica ajena y correcta de la app.
async function navegar(page, destino) {
  const navegaciones = [];
  page.on('framenavigated', (frame) => { if (frame === page.mainFrame()) navegaciones.push(frame.url()); });
  await page.goto(destino);
  await page.waitForFunction(() => !location.pathname.includes('control-engrase-openpit'));
  await page.waitForTimeout(250); // deja que captureQrDeepLink() (si aplica) termine de reescribir
  return navegaciones;
}

test('A — /control-engrase-openpit/#eq=123 redirige (paso intermedio) a /#eq=123 preservando el hash', async ({ page }) => {
  const navs = await navegar(page, `${BASE}/control-engrase-openpit/#eq=123`);
  expect(navs[1]).toBe(`${BASE}/#eq=123`);
  // Estado final: el hash ya lo consumió captureQrDeepLink() (app.js, sin tocar) — se verifica aparte, no aquí.
});

test('B — /control-engrase-openpit/?x=1#eq=123 redirige (paso intermedio) a /?x=1#eq=123, y el query SOBREVIVE al final', async ({ page }) => {
  const navs = await navegar(page, `${BASE}/control-engrase-openpit/?x=1#eq=123`);
  expect(navs[1]).toBe(`${BASE}/?x=1#eq=123`);
  const url = new URL(page.url());
  expect(url.pathname).toBe('/');
  expect(url.search).toBe('?x=1'); // captureQrDeepLink() solo limpia el hash, nunca el query (ver su código)
});

test('C — /control-engrase-openpit/ (sin hash/query) redirige a / limpio', async ({ page }) => {
  await page.goto(`${BASE}/control-engrase-openpit/`);
  await page.waitForURL(`${BASE}/`);
  const url = new URL(page.url());
  expect(url.pathname).toBe('/');
  expect(url.search).toBe('');
  expect(url.hash).toBe('');
});

test('No hay redirect loop: la página legacy se visita UNA sola vez, nunca vuelve a aparecer en la navegación', async ({ page }) => {
  const navs = await navegar(page, `${BASE}/control-engrase-openpit/?x=1#eq=abc`);
  expect(navs.filter((u) => u.includes('control-engrase-openpit')).length).toBe(1);
});

test('La raíz "/" sigue cargando normalmente (no es solo la página de compatibilidad)', async ({ page }) => {
  await page.goto(`${BASE}/`);
  // La app real (login) nunca muestra el texto de compatibilidad "Redirigiendo a".
  await expect(page.locator('body')).not.toContainText('Redirigiendo a');
});

test('Seguridad: un query que PARECE una URL externa viaja como texto inerte, nunca como salto real a ese origin', async ({ page }) => {
  const navs = await navegar(page, `${BASE}/control-engrase-openpit/?next=https://evil.example.com#eq=1`);
  // El "paso intermedio" (el redirect real) ya prueba que nunca navegó A
  // evil.example.com — sigue siendo este mismo origin/puerto.
  expect(navs[1]).toBe(`${BASE}/?next=https://evil.example.com#eq=1`);
  const resultado = new URL(page.url());
  expect(resultado.origin).toBe(BASE);
  expect(resultado.pathname).toBe('/');
});
