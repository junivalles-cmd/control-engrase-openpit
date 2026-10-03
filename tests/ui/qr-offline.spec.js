// tests/ui/qr-offline.spec.js
//
// Lote "QR offline" — D/E/F del plan de pruebas: jsQR y QRious, cargados
// desde los archivos LOCALES vendorizados (vendor/, nunca el CDN), quedan
// disponibles como window.jsQR/window.QRious en un navegador real, y el
// flujo QR existente (generar con QRious -> decodificar con jsQR, mismo
// patrón real que openEquipmentQR()/decodeQrFromDataUrl() en app.js) sigue
// funcionando end-to-end. Carga los archivos reales con page.addScriptTag(),
// nunca una copia/reimplementación.

import { test, expect } from '@playwright/test';
import path from 'node:path';

const SRC_ROOT = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB');
const JSQR_PATH = path.join(SRC_ROOT, 'vendor', 'jsqr.js');
const QRIOUS_PATH = path.join(SRC_ROOT, 'vendor', 'qrious.min.js');

test.describe('D/E) jsQR y QRious quedan disponibles al cargarse desde los archivos locales vendorizados', () => {
  test('window.QRious y window.jsQR existen tras cargar vendor/qrious.min.js y vendor/jsqr.js (sin red, sin CDN)', async ({ page }) => {
    await page.setContent('<div></div>');
    await page.addScriptTag({ path: QRIOUS_PATH });
    await page.addScriptTag({ path: JSQR_PATH });

    const tipos = await page.evaluate(() => ({
      qrious: typeof window.QRious,
      jsqr: typeof window.jsQR,
    }));
    expect(tipos.qrious, 'D) window.QRious debe quedar disponible').toBe('function');
    expect(tipos.jsqr, 'E) window.jsQR debe quedar disponible').toBe('function');
  });
});

test.describe('F) flujo QR existente — generar (QRious) y decodificar (jsQR) end-to-end, 100% local', () => {
  test('un QR generado con el mismo patrón que qrValueForEquipment() se decodifica correctamente con las librerías vendorizadas', async ({ page }) => {
    await page.setContent('<canvas id="qr-canvas"></canvas>');
    await page.addScriptTag({ path: QRIOUS_PATH });
    await page.addScriptTag({ path: JSQR_PATH });

    // Mismo valor conceptual que qrValueForEquipment(equipment): una URL
    // real con #eq=<id> — el QR SOLO identifica el equipo (§4/§28 del lote
    // "consulta universal"), nunca ubicación/estado/horómetro/turno/plan.
    const valorEsperado = 'https://junivalles-cmd.github.io/control-engrase/#eq=eq_test_123';

    const decodificado = await page.evaluate((valor) => {
      // Mismo patrón real que openEquipmentQR() (app.js): generar con QRious
      // sobre un <canvas>.
      // eslint-disable-next-line no-new
      new window.QRious({ element: document.getElementById('qr-canvas'), value: valor, size: 220 });

      // Mismo patrón real que decodeQrFromDataUrl() (app.js): leer los
      // píxeles del canvas y decodificarlos con jsQR.
      const canvas = document.getElementById('qr-canvas');
      const ctx = canvas.getContext('2d');
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, canvas.width, canvas.height);
      return code ? code.data : null;
    }, valorEsperado);

    expect(decodificado, 'el QR generado localmente debe decodificarse al mismo valor, sin tocar red').toBe(valorEsperado);
  });
});
