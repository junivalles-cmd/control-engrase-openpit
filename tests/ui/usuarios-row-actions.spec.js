// tests/ui/usuarios-row-actions.spec.js
//
// Configuración → Usuarios (modo Supabase, renderUsuariosSupabase()): la
// celda de acciones de cada fila ("Rol" / "Desactivar" o "Activar" / "Reset
// password") usa las clases reales .data-table/.row-actions/.btn/.btn-sm —
// fragmento estático con esa estructura, nunca ejecuta Auth.manageUsers()
// ni toca producción. Causa raíz real (auditoría UI mobile 2026-10-08):
// ".row-actions .btn { flex:1 }" (pensada para los 2 botones de .point-row,
// de largo similar) alcanzaba también esta tabla sin querer — forzaba los 3
// botones a un mismo ancho, y "Reset password" (el más largo) se partía en
// 2 líneas, quedando más alto que sus 2 hermanos.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const STYLES_PATH = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css');

const FIXTURE = `
<div class="panel">
  <table class="data-table">
    <thead><tr><th>Nombre</th><th>Rol</th><th>Activo</th><th></th></tr></thead>
    <tbody>
      <tr>
        <td>Juan Pérez</td>
        <td>LUBRICADOR</td>
        <td>Sí</td>
        <td class="row-actions">
          <button class="btn btn-sm">Rol</button>
          <button class="btn btn-sm btn-danger">Desactivar</button>
          <button class="btn btn-sm">Reset password</button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
`;

for (const width of [360, 384, 390, 412]) {
  test(`Usuarios @ ${width}px — los 3 botones de acción quedan con la misma altura (sin wrap desbalanceado)`, async ({ page }, testInfo) => {
    await page.setContent(FIXTURE);
    await page.addStyleTag({ path: STYLES_PATH });
    await page.setViewportSize({ width, height: 700 });

    const heights = await page.locator('.row-actions .btn').evaluateAll(
      els => els.map(el => el.getBoundingClientRect().height)
    );
    expect(heights).toHaveLength(3);
    const [h0, h1, h2] = heights;
    expect(Math.abs(h0 - h1), `altura pareja en ${testInfo.project.name}`).toBeLessThan(1);
    expect(Math.abs(h1 - h2), `altura pareja en ${testInfo.project.name}`).toBeLessThan(1);

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `sin overflow horizontal en ${testInfo.project.name}`).toBeLessThanOrEqual(clientWidth);
  });
}

test('Usuarios — en tablet/desktop la fila sigue siendo tabla normal (nunca tarjeta apilada)', async ({ page }) => {
  await page.setContent(FIXTURE);
  await page.addStyleTag({ path: STYLES_PATH });
  await page.setViewportSize({ width: 1366, height: 800 });

  const display = await page.locator('tbody tr').first().evaluate(el => getComputedStyle(el).display);
  expect(display).not.toBe('block'); // el breakpoint de "tarjeta apilada" es <=680px, nunca en desktop
});
