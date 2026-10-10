import { test, expect } from '@playwright/test';
import path from 'node:path';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const declarations = (file, names) => names.map(n => extractDeclaration(readSource(file), n)).join('\n');
const db = declarations(DB_JS_PATH, ['DB_NAME', 'DB_VERSION', 'STORES', 'LOCAL_STORES', 'openDB', 'tx', 'DB', 'uid', 'nowISO', 'stamp', 'logAudit']);
const app = declarations(APP_JS_PATH, ['$', '$$', 'esc', 'fmtDate', 'openModal', 'closeModal', 'MAX_PHOTOS', 'photoFieldHTML', 'getPhotoFieldPhotos',
  'renderPhotoStrip', 'addPhotoToField', 'wirePhotoField', 'preloadPhotosIntoField', 'getSelectedPhotos', 'photosOf',
  'fileToCompressedDataURL', 'stampEquipmentEvidencePhoto', 'pickPhotoNative', 'openAnomalyForm']);
async function boot(page) {
  await page.route('**/*', route => {
    if (route.request().isNavigationRequest()) return route.fulfill({ contentType: 'text/html', body: '<main></main>' });
    // El CSS real importa una fuente externa. Responder sin fuente usa el
    // fallback real y evita que un aborto de @import rechace addStyleTag.
    if (new URL(route.request().url()).hostname === 'fonts.googleapis.com') return route.fulfill({ contentType: 'text/css', body: '' });
    return route.abort();
  });
  await page.goto('/');
  await page.addStyleTag({ path: path.resolve('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/styles.css') });
  await page.addScriptTag({ content: `let _db = null; ${db}\n${app}
    const App = { currentUser: { id: 'fixture', name: 'Personal name must never appear', role: 'ADMINISTRADOR' }, route: 'other' };
    const ic = () => ''; const showInAppToast = () => {}; const wirePhotoThumbs = () => {};
    window.testDB = DB; window.openAnomaly = openAnomalyForm;
    window.__texts = [];
    const originalText = CanvasRenderingContext2D.prototype.fillText;
    CanvasRenderingContext2D.prototype.fillText = function(text, ...args) { window.__texts.push(text); return originalText.call(this, text, ...args); };
    window.makePhoto = () => {
      const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
      const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ffd000'; ctx.fillRect(0,0,800,600);
      return canvas.toDataURL('image/png');
    };
    window.dimensions = async value => {
      const image = new Image(); image.src = value; await image.decode();
      const canvas = document.createElement('canvas'); canvas.width=image.width; canvas.height=image.height;
      const ctx = canvas.getContext('2d'); ctx.drawImage(image,0,0);
      const pixels = ctx.getImageData(0,600,image.width,image.height-600).data;
      let white = 0, dark = 0;
      for (let i=0;i<pixels.length;i+=4) { if(pixels[i]>220 && pixels[i+1]>220 && pixels[i+2]>220) white++; if(pixels[i]<40 && pixels[i+1]<40 && pixels[i+2]<40) dark++; }
      return { width: image.width, height: image.height, white, dark };
    };
    window.ready = openDB().then(async () => {
      await DB.put('equipment',{id:'e1',code:'E-TEST',brand:'Fixture',model:'One'});
      await DB.put('equipment',{id:'e2',code:'E-OTHER',brand:'Fixture',model:'Two'});
    });` });
  await page.evaluate(() => window.ready);
}
async function attach(page) {
  const data = await page.evaluate(() => window.makePhoto());
  await page.locator('input[name="photo"]').setInputFiles({ name: 'evidence.png', mimeType: 'image/png', buffer: Buffer.from(data.split(',')[1], 'base64') });
  await expect(page.locator('.photo-slot')).toHaveCount(1);
}
test('gallery anomaly evidence has permanent pixels before IndexedDB, offline, without personal data', async ({ page }) => {
  await boot(page);
  await page.context().setOffline(true);
  await page.evaluate(() => window.openAnomaly('e1'));
  await expect(page.locator('select[name="equipmentId"]')).toBeHidden();
  await expect(page.locator('.val-info')).toContainText('E-TEST');
  await attach(page);
  const photo = await page.locator('.photo-slot').getAttribute('data-photo');
  const result = await page.evaluate(value => window.dimensions(value), photo);
  expect(result).toMatchObject({ width: 800, height: 636 });
  expect(result.dark).toBeGreaterThan(10000);
  expect(result.white).toBeGreaterThan(100);
  const texts = await page.evaluate(() => window.__texts);
  expect(texts).toHaveLength(1);
  expect(texts[0]).toMatch(/^E-TEST · \d{4}-\d{2}-\d{2} · \d{2}:\d{2}:\d{2}$/);
  await page.locator('textarea[name="description"]').fill('Fixture evidence');
  await page.locator('button[type="submit"]').click();
  const rows = await page.evaluate(() => window.testDB.all('anomalies'));
  expect(rows).toHaveLength(1);
  expect(rows[0].photos).toEqual([photo]);
  expect(rows[0].photo).toBe(photo);
});

for (const width of [360, 390, 412]) {
  test(`${width}px anomaly: contextual equipment and location, one free-text field, offline without photos`, async ({ page, context }) => {
    await boot(page);
    await page.setViewportSize({ width, height: 800 });
    await page.evaluate(async () => {
      await testDB.put('locations', { id: 'loc-fixture', name: 'Ubicación de prueba' });
      const equipment = await testDB.get('equipment', 'e1');
      await testDB.put('equipment', { ...equipment, locationId: 'loc-fixture' });
      await openAnomaly('e1');
    });
    await expect(page.locator('.val-info')).toContainText('Ubicación de prueba');
    await expect(page.locator('select[name="equipmentId"]')).toBeHidden();
    await expect(page.locator('#anom-form textarea')).toHaveCount(1);
    await expect(page.locator('#anom-form input[type="text"]')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const small = await page.locator('#anom-form select:visible, #anom-form textarea, #anom-form button:visible').evaluateAll(nodes => nodes.filter(node => node.getBoundingClientRect().height < 44).map(node => node.outerHTML));
    expect(small).toEqual([]);
    await context.setOffline(true);
    await page.setViewportSize({ width, height: 360 });
    await page.locator('textarea[name="description"]').fill('Descripción única');
    await page.locator('select[name="component"]').selectOption({ label: 'Fuga de grasa' });
    await page.locator('select[name="criticality"]').selectOption({ label: 'Media' });
    await page.locator('button[type="submit"]').scrollIntoViewIfNeeded();
    const button = await page.locator('button[type="submit"]').boundingBox();
    expect(button.y + button.height).toBeLessThanOrEqual(360);
    await page.locator('button[type="submit"]').click();
    const [anomaly] = await page.evaluate(() => testDB.all('anomalies'));
    expect(anomaly).toMatchObject({ equipmentId: 'e1', description: 'Descripción única', component: 'Fuga de grasa', criticality: 'Media', photos: [], photo: null });
    expect(anomaly.createdAt).toBeTruthy();
    expect(anomaly.createdBy).toBe('Personal name must never appear');
  });
}
test('editing keeps already stamped pixels; changing equipment cannot mislabel evidence', async ({ page }) => {
  await boot(page);
  // La apertura general permite elegir equipo; la apertura contextual ya lo fija.
  await page.evaluate(() => window.openAnomaly());
  await attach(page);
  const photo = await page.locator('.photo-slot').getAttribute('data-photo');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('select[name="equipmentId"]').selectOption('e2');
  await expect(page.locator('select[name="equipmentId"]')).toHaveValue('e1');
  await page.locator('textarea[name="description"]').fill('Initial');
  await page.locator('button[type="submit"]').click();
  await page.evaluate(async () => {
    App.currentUser.name = 'Otro editor de prueba';
    return window.openAnomaly('e1', null, (await window.testDB.all('anomalies'))[0]);
  });
  await expect(page.locator('.val-info')).toContainText('Personal name must never appear');
  await page.locator('textarea[name="description"]').fill('Edited');
  await page.locator('button[type="submit"]').click();
  expect(await page.evaluate(() => window.__texts.length)).toBe(1);
  expect((await page.evaluate(() => window.testDB.all('anomalies')))[0].photo).toBe(photo);
});
for (const source of ['CAMERA', 'PHOTOS']) {
  test(`native ${source} goes through the same pixel stamp before the photo field`, async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      window.Capacitor = { Plugins: { Camera: { getPhoto: async options => { window.__nativeSource = options.source; return { dataUrl: window.makePhoto() }; } } } };
    });
    await page.evaluate(() => window.openAnomaly('e1'));
    await page.locator(source === 'CAMERA' ? '.photo-pick-camera-btn' : '.photo-pick-gallery-btn').click();
    await expect(page.locator('.photo-slot')).toHaveCount(1);
    expect(await page.evaluate(() => window.__nativeSource)).toBe(source);
    const photo = await page.locator('.photo-slot').getAttribute('data-photo');
    expect((await page.evaluate(value => window.dimensions(value), photo)).white).toBeGreaterThan(100);
    expect(await page.evaluate(() => window.__texts.length)).toBe(1);
  });
}
test('invalid image cannot enter the photo field or IndexedDB as unmarked evidence', async ({ page }) => {
  await boot(page);
  const error = await page.evaluate(async () => {
    try { await stampEquipmentEvidencePhoto('data:image/png;base64,INVALID', 'E-TEST', new Date()); } catch (e) { return e.message; }
  });
  expect(error).toContain('decodificar');
  expect(await page.evaluate(() => window.testDB.all('anomalies'))).toEqual([]);
});
