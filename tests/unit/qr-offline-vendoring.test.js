// tests/unit/qr-offline-vendoring.test.js
//
// Lote "QR offline" — jsQR y el generador de QR pasan de CDN (jsdelivr) a
// archivos vendorizados locales (vendor/), para que el escáner/generador de
// QR funcione desde el primer arranque sin Internet. Prueba A/B/C/G del plan:
// el HTML/Service Worker reales ya no referencian la URL del CDN, los
// archivos locales existen de verdad, y el Service Worker ya no los trata
// como "mejor esfuerzo" (CDN_ASSETS) sino como precache obligatorio
// (ASSETS). D/E/F (las librerías quedan disponibles y el flujo QR sigue
// funcionando) se prueban en un navegador real — ver tests/ui/qr-offline.spec.js.
//
// Lote "QR license fix" (continuación): QRious (GPL-3.0) se eliminó del
// proyecto y se reemplazó por qrcode-generator (MIT, kazuhikoarase) como
// generador — jsQR (escáner, Apache-2.0) no cambió. Este archivo se
// actualizó para probar la librería real vigente, nunca la eliminada.

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource } from '../helpers/extractFromSource.js';

const SRC_ROOT = path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB');
const INDEX_HTML_PATH = path.join(SRC_ROOT, 'index.html');
const SW_JS_PATH = path.join(SRC_ROOT, 'sw.js');
const JSQR_PATH = path.join(SRC_ROOT, 'vendor', 'jsqr.js');
const QRCODE_GEN_PATH = path.join(SRC_ROOT, 'vendor', 'qrcode.js');

const indexHtml = readSource(INDEX_HTML_PATH);
const swSource = readSource(SW_JS_PATH);

describe('A/B) index.html — sin URL de CDN para jsQR/generador de QR', () => {
  it('A) no contiene la URL de jsdelivr para jsQR', () => {
    expect(indexHtml).not.toMatch(/cdn\.jsdelivr\.net\/npm\/jsqr@/i);
  });

  it('B) no contiene la URL de jsdelivr para QRious (eliminada) ni para qrcode-generator (tampoco se carga por CDN)', () => {
    expect(indexHtml).not.toMatch(/cdn\.jsdelivr\.net\/npm\/qrious@/i);
    expect(indexHtml).not.toMatch(/cdn\.jsdelivr\.net\/npm\/qrcode-generator@/i);
  });

  it('carga las dos librerías como archivos locales dentro de vendor/', () => {
    expect(indexHtml).toContain('<script src="vendor/qrcode.js"></script>');
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

  it('vendor/qrcode.js (generador, reemplaza a qrious.min.js) existe y tiene contenido real', () => {
    expect(fs.existsSync(QRCODE_GEN_PATH)).toBe(true);
    expect(fs.statSync(QRCODE_GEN_PATH).size).toBeGreaterThan(5000);
  });

  it('vendor/qrcode.js conserva su aviso de licencia (MIT) en el propio archivo', () => {
    const content = fs.readFileSync(QRCODE_GEN_PATH, 'utf8');
    expect(content).toMatch(/QR Code Generator for JavaScript/);
    expect(content).toMatch(/Copyright \(c\) 2009 Kazuhiko Arase/);
    expect(content).toMatch(/Licensed under the MIT license/);
  });

  it('vendor/qrious.min.js (GPL-3.0) ya NO existe — eliminada del proyecto', () => {
    const oldPath = path.join(SRC_ROOT, 'vendor', 'qrious.min.js');
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it('vendor/LICENSE-qrious-gpl-3.0.txt ya NO existe — se elimina junto con la librería', () => {
    const oldLicensePath = path.join(SRC_ROOT, 'vendor', 'LICENSE-qrious-gpl-3.0.txt');
    expect(fs.existsSync(oldLicensePath)).toBe(false);
  });

  it('vendor/LICENSE-qrcode-generator-mit.txt existe con el texto real de la licencia MIT', () => {
    const licensePath = path.join(SRC_ROOT, 'vendor', 'LICENSE-qrcode-generator-mit.txt');
    expect(fs.existsSync(licensePath)).toBe(true);
    const content = fs.readFileSync(licensePath, 'utf8');
    expect(content).toContain('MIT License');
    expect(content).toContain('Copyright (c) 2009 Kazuhiko Arase');
    expect(content).toContain('THE SOFTWARE IS PROVIDED "AS IS"');
  });

  it('vendor/LICENSES.md documenta nombre/versión/origen/licencia de ambas librerías — nunca menciona GPL/QRious como vigente', () => {
    const licensesPath = path.join(SRC_ROOT, 'vendor', 'LICENSES.md');
    expect(fs.existsSync(licensesPath)).toBe(true);
    const content = fs.readFileSync(licensesPath, 'utf8');
    expect(content).toContain('jsQR');
    expect(content).toContain('1.4.0');
    expect(content).toContain('Apache-2.0');
    expect(content).toContain('qrcode-generator');
    expect(content).toContain('MIT');
    expect(content).not.toMatch(/GPL/);
    expect(content).not.toContain('QRious');
  });
});

describe('G) Service Worker — jsQR/generador de QR ya no son "mejor esfuerzo" vía red, van en el precache obligatorio', () => {
  it('ASSETS (precache obligatorio, mismo origen) incluye los dos archivos vendorizados reales, nunca el archivo GPL eliminado', () => {
    const assetsBlock = swSource.match(/const ASSETS = \[([\s\S]*?)\];/)[1];
    expect(assetsBlock).toMatch(/'\.\/vendor\/qrcode\.js'/);
    expect(assetsBlock).toMatch(/'\.\/vendor\/jsqr\.js'/);
    // "qrious" solo puede aparecer en el COMENTARIO explicativo del cambio
    // (p. ej. "qrcode.js (MIT) reemplaza a qrious.min.js (GPL-3.0,
    // eliminada)") — nunca como string real dentro del array ASSETS.
    const codeOnly = assetsBlock.split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(codeOnly).not.toMatch(/qrious/i);
  });

  it('CDN_ASSETS (mejor esfuerzo, requiere red) ya NO contiene jsQR ni el generador de QR', () => {
    const cdnBlockMatch = swSource.match(/const CDN_ASSETS = \[([\s\S]*?)\];/);
    expect(cdnBlockMatch).not.toBeNull();
    expect(cdnBlockMatch[1]).not.toMatch(/jsqr|qrious|qrcode/i);
  });

  it('CDN_ASSETS conserva Chart.js/xlsx/jsPDF sin cambios (alcance limitado solo a QR)', () => {
    const cdnBlockMatch = swSource.match(/const CDN_ASSETS = \[([\s\S]*?)\];/);
    expect(cdnBlockMatch[1]).toMatch(/chart\.js/i);
    expect(cdnBlockMatch[1]).toMatch(/xlsx-js-style/i);
    expect(cdnBlockMatch[1]).toMatch(/jspdf/i);
  });

  it('el número de versión del cache (CACHE) se actualizó de nuevo (v69) — fuerza a los clientes a re-cachear con el generador de QR nuevo', () => {
    expect(swSource).toMatch(/const CACHE = 'engrase-openpit-v69'/);
  });
});

describe('app.js — reemplazo real del generador, sin lógica de negocio nueva', () => {
  const appSource = readSource(path.join(SRC_ROOT, 'app.js'));

  it('ya no queda ningún uso real de QRious (solo puede aparecer en comentarios explicativos del cambio)', () => {
    const codeOnly = appSource.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter(l => !l.trim().startsWith('//')).join('\n');
    expect(codeOnly).not.toContain('QRious');
  });

  it('renderQrCode() (el nuevo adaptador) usa qrcode-generator real (qrcode(0,\'M\')/addData/make/getModuleCount/isDark), nunca una reimplementación del algoritmo QR', () => {
    expect(appSource).toContain("const qr = qrcode(0, 'M');");
    expect(appSource).toContain('qr.addData(value);');
    expect(appSource).toContain('qr.make();');
    expect(appSource).toContain('qr.getModuleCount();');
    expect(appSource).toContain('qr.isDark(row, col)');
  });

  it('los 2 call sites reales (printAllQRCodes/openEquipmentQR) llaman a renderQrCode(), nunca a "new QRious"', () => {
    expect(appSource).toContain('const qr = renderQrCode({ value: qrValueForEquipment(e), size: 200 });');
    expect(appSource).toContain("renderQrCode({ element: $('#qr-canvas'), value: qrValueForEquipment(equipment), size: 220, background: '#ffffff', foreground: '#14171A' });");
  });

  it('qrValueForEquipment()/parseEquipmentIdFromScan() (formato QR/deep link) NO se tocaron — mismo comportamiento de siempre', () => {
    expect(appSource).toContain('function qrValueForEquipment(equipment) {');
    expect(appSource).toContain('return `${location.origin}${location.pathname}#eq=${equipment.id}`;');
    expect(appSource).toContain('function parseEquipmentIdFromScan(text) {');
  });
});
