// tests/ui/qr-offline.spec.js
//
// Lote "QR offline" — D/E/F del plan de pruebas: jsQR y el generador de QR,
// cargados desde los archivos LOCALES vendorizados (vendor/, nunca el CDN),
// quedan disponibles en un navegador real, y el flujo QR existente sigue
// funcionando end-to-end. Carga los archivos reales con page.addScriptTag(),
// nunca una copia/reimplementación.
//
// Lote "QR license fix" (continuación): QRious (GPL-3.0) se eliminó del
// proyecto. El generador ahora es qrcode-generator (MIT, vendor/qrcode.js,
// window.qrcode) + el adaptador real renderQrCode() de app.js (extraído con
// extractDeclaration — nunca reimplementado aquí) — el round-trip generar→
// decodificar prueba el ADAPTADOR REAL, no solo la librería en crudo.

import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH } from '../helpers/loadLubricationLogic.js';

const SRC_ROOT = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB');
const JSQR_PATH = path.join(SRC_ROOT, 'vendor', 'jsqr.js');
const QRCODE_GEN_PATH = path.join(SRC_ROOT, 'vendor', 'qrcode.js');

const appSource = readSource(APP_JS_PATH);
const RENDER_QR_SRC = extractDeclaration(appSource, 'renderQrCode');

test.describe('D/E) jsQR y el generador de QR quedan disponibles al cargarse desde los archivos locales vendorizados', () => {
  test('window.qrcode y window.jsQR existen tras cargar vendor/qrcode.js y vendor/jsqr.js (sin red, sin CDN)', async ({ page }) => {
    await page.setContent('<div></div>');
    await page.addScriptTag({ path: QRCODE_GEN_PATH });
    await page.addScriptTag({ path: JSQR_PATH });

    const tipos = await page.evaluate(() => ({
      qrcode: typeof window.qrcode,
      jsqr: typeof window.jsQR,
    }));
    expect(tipos.qrcode, 'D) window.qrcode debe quedar disponible').toBe('function');
    expect(tipos.jsqr, 'E) window.jsQR debe quedar disponible').toBe('function');
  });

  test('window.QRious ya NO existe — la librería GPL fue eliminada del proyecto', async ({ page }) => {
    await page.setContent('<div></div>');
    await page.addScriptTag({ path: QRCODE_GEN_PATH });
    await page.addScriptTag({ path: JSQR_PATH });
    const tipo = await page.evaluate(() => typeof window.QRious);
    expect(tipo).toBe('undefined');
  });
});

test.describe('F) flujo QR existente — generar (renderQrCode(), el adaptador REAL de app.js) y decodificar (jsQR) end-to-end, 100% local', () => {
  test('un QR generado con renderQrCode() sobre un <canvas> se decodifica correctamente con jsQR', async ({ page }) => {
    await page.setContent('<canvas id="qr-canvas"></canvas>');
    await page.addScriptTag({ path: QRCODE_GEN_PATH });
    await page.addScriptTag({ path: JSQR_PATH });
    await page.addScriptTag({ content: RENDER_QR_SRC });

    // Mismo valor conceptual que qrValueForEquipment(equipment): una URL
    // real con #eq=<id> — el QR SOLO identifica el equipo (§4/§28 del lote
    // "consulta universal"), nunca ubicación/estado/horómetro/turno/plan.
    const valorEsperado = 'https://junivalles-cmd.github.io/control-engrase/#eq=eq_test_123';

    const decodificado = await page.evaluate((valor) => {
      // Mismo patrón real que openEquipmentQR() (app.js): generar con el
      // adaptador real sobre un <canvas>, con los mismos colores reales.
      renderQrCode({ element: document.getElementById('qr-canvas'), value: valor, size: 220, background: '#ffffff', foreground: '#14171A' });

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

  test('renderQrCode() con solo {value, size} (sin element, patrón de printAllQRCodes) da un .toDataURL() decodificable', async ({ page }) => {
    await page.setContent('<canvas id="decode-canvas"></canvas>');
    await page.addScriptTag({ path: QRCODE_GEN_PATH });
    await page.addScriptTag({ path: JSQR_PATH });
    await page.addScriptTag({ content: RENDER_QR_SRC });

    const valorEsperado = 'https://junivalles-cmd.github.io/control-engrase/#eq=eq_print_456';

    const decodificado = await page.evaluate(async (valor) => {
      // Mismo patrón real que printAllQRCodes() (app.js): sin "element",
      // solo value+size, y se lee vía .toDataURL() (para un <img src>).
      const qr = renderQrCode({ value: valor, size: 200 });
      const dataUrl = qr.toDataURL();

      // Decodifica la dataURL dibujándola en un canvas (mismo mecanismo que
      // un navegador real usaría para mostrar el <img>), y lee con jsQR.
      const img = new Image();
      await new Promise((resolve, reject) => { img.onload = resolve; img.onerror = reject; img.src = dataUrl; });
      const canvas = document.getElementById('decode-canvas');
      canvas.width = img.width; canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = window.jsQR(imageData.data, canvas.width, canvas.height);
      return code ? code.data : null;
    }, valorEsperado);

    expect(decodificado, 'el dataURL de printAllQRCodes() debe decodificarse al mismo valor').toBe(valorEsperado);
  });
});
