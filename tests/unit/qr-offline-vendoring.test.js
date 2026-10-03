// tests/unit/qr-offline-vendoring.test.js
//
// Lote "QR offline" — jsQR y QRious pasan de CDN (jsdelivr) a archivos
// vendorizados locales (vendor/), para que el escáner/generador de QR
// funcione desde el primer arranque sin Internet. Prueba A/B/C/G del plan:
// el HTML/Service Worker reales ya no referencian la URL del CDN, los
// archivos locales existen de verdad, y el Service Worker ya no los trata
// como "mejor esfuerzo" (CDN_ASSETS) sino como precache obligatorio
// (ASSETS). D/E/F (las librerías quedan disponibles y el flujo QR sigue
// funcionando) se prueban en un navegador real — ver tests/ui/qr-offline.spec.js.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource } from '../helpers/extractFromSource.js';

const SRC_ROOT = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB');
const INDEX_HTML_PATH = path.join(SRC_ROOT, 'index.html');
const SW_JS_PATH = path.join(SRC_ROOT, 'sw.js');
const JSQR_PATH = path.join(SRC_ROOT, 'vendor', 'jsqr.js');
const QRIOUS_PATH = path.join(SRC_ROOT, 'vendor', 'qrious.min.js');

const indexHtml = readSource(INDEX_HTML_PATH);
const swSource = readSource(SW_JS_PATH);

describe('A/B) index.html — sin URL de CDN para jsQR/QRious', () => {
  it('A) no contiene la URL de jsdelivr para jsQR', () => {
    expect(indexHtml).not.toMatch(/cdn\.jsdelivr\.net\/npm\/jsqr@/i);
  });

  it('B) no contiene la URL de jsdelivr para QRious', () => {
    expect(indexHtml).not.toMatch(/cdn\.jsdelivr\.net\/npm\/qrious@/i);
  });

  it('carga las dos librerías como archivos locales dentro de vendor/', () => {
    expect(indexHtml).toContain('<script src="vendor/qrious.min.js"></script>');
    expect(indexHtml).toContain('<script src="vendor/jsqr.js"></script>');
  });

  it('otras librerías externas (Chart.js/xlsx/jsPDF) NO se tocaron — alcance limitado solo a QR', () => {
    expect(indexHtml).toContain('cdn.jsdelivr.net/npm/chart.js@4.4.4');
    expect(indexHtml).toContain('cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0');
    expect(indexHtml).toContain('cdn.jsdelivr.net/npm/jspdf@2.5.1');
  });
});

describe('C) assets locales — los archivos vendorizados existen de verdad en la fuente canónica', () => {
  it('vendor/jsqr.js existe y tiene contenido real (no un archivo vacío/placeholder)', () => {
    expect(fs.existsSync(JSQR_PATH)).toBe(true);
    expect(fs.statSync(JSQR_PATH).size).toBeGreaterThan(10000);
  });

  it('vendor/qrious.min.js existe y tiene contenido real', () => {
    expect(fs.existsSync(QRIOUS_PATH)).toBe(true);
    expect(fs.statSync(QRIOUS_PATH).size).toBeGreaterThan(5000);
  });

  it('vendor/qrious.min.js conserva su aviso de licencia (GPL-3.0) en el propio archivo', () => {
    const content = fs.readFileSync(QRIOUS_PATH, 'utf8');
    expect(content).toMatch(/QRious v4\.0\.2/);
    expect(content).toMatch(/GPL v3 License/);
  });

  it('vendor/LICENSES.md documenta nombre/versión/origen/licencia de ambas librerías', () => {
    const licensesPath = path.join(SRC_ROOT, 'vendor', 'LICENSES.md');
    expect(fs.existsSync(licensesPath)).toBe(true);
    const content = fs.readFileSync(licensesPath, 'utf8');
    expect(content).toContain('jsQR');
    expect(content).toContain('1.4.0');
    expect(content).toContain('Apache-2.0');
    expect(content).toContain('QRious');
    expect(content).toContain('4.0.2');
    expect(content).toContain('GPL-3.0');
  });
});

describe('G) Service Worker — jsQR/QRious ya no son "mejor esfuerzo" vía red, van en el precache obligatorio', () => {
  it('ASSETS (precache obligatorio, mismo origen) incluye los dos archivos vendorizados', () => {
    expect(swSource).toMatch(/const ASSETS = \[[\s\S]*?'\.\/vendor\/qrious\.min\.js'[\s\S]*?\];/);
    expect(swSource).toMatch(/const ASSETS = \[[\s\S]*?'\.\/vendor\/jsqr\.js'[\s\S]*?\];/);
  });

  it('CDN_ASSETS (mejor esfuerzo, requiere red) ya NO contiene jsQR ni QRious', () => {
    const cdnBlockMatch = swSource.match(/const CDN_ASSETS = \[([\s\S]*?)\];/);
    expect(cdnBlockMatch).not.toBeNull();
    expect(cdnBlockMatch[1]).not.toMatch(/jsqr|qrious/i);
  });

  it('CDN_ASSETS conserva Chart.js/xlsx/jsPDF sin cambios (alcance limitado solo a QR)', () => {
    const cdnBlockMatch = swSource.match(/const CDN_ASSETS = \[([\s\S]*?)\];/);
    expect(cdnBlockMatch[1]).toMatch(/chart\.js/i);
    expect(cdnBlockMatch[1]).toMatch(/xlsx-js-style/i);
    expect(cdnBlockMatch[1]).toMatch(/jspdf/i);
  });

  it('el número de versión del cache (CACHE) se actualizó — fuerza a los clientes a re-cachear con los assets nuevos', () => {
    expect(swSource).toMatch(/const CACHE = 'engrase-openpit-v68'/);
  });
});
