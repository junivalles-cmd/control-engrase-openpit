import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const declarations = (file, names) => names.map(n => extractDeclaration(readSource(file), n)).join('\n');
const db = declarations(DB_JS_PATH, ['DB_NAME', 'DB_VERSION', 'STORES', 'LOCAL_STORES', 'openDB', 'tx', 'DB', 'uid', 'nowISO', 'stamp', 'logAudit']);
const app = declarations(APP_JS_PATH, ['$', '$$', 'esc', 'openModal', 'closeModal', 'MAX_PHOTOS', 'photoFieldHTML', 'getPhotoFieldPhotos',
  'renderPhotoStrip', 'addPhotoToField', 'wirePhotoField', 'preloadPhotosIntoField', 'getSelectedPhotos', 'photosOf',
  'fileToCompressedDataURL', 'stampEquipmentEvidencePhoto', 'pickPhotoNative', 'openAnomalyForm']);
async function boot(page) {
  await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: '<main></main>' }) : route.abort());
  await page.goto('/');
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
test('editing keeps already stamped pixels; changing equipment cannot mislabel evidence', async ({ page }) => {
  await boot(page);
  await page.evaluate(() => window.openAnomaly('e1'));
  await attach(page);
  const photo = await page.locator('.photo-slot').getAttribute('data-photo');
  page.once('dialog', dialog => dialog.accept());
  await page.locator('select[name="equipmentId"]').selectOption('e2');
  await expect(page.locator('select[name="equipmentId"]')).toHaveValue('e1');
  await page.locator('textarea[name="description"]').fill('Initial');
  await page.locator('button[type="submit"]').click();
  await page.evaluate(async () => window.openAnomaly('e1', null, (await window.testDB.all('anomalies'))[0]));
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
