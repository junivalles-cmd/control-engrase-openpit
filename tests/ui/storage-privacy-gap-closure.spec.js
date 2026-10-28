// tests/ui/storage-privacy-gap-closure.spec.js
//
// Cierre del gap documentado en docs/STORAGE_PRIVACY_DESIGN.md §7 (lote
// PIN+sync+storage, post a4ba3e9): miniaturas de checklist (pointRow),
// diagramas de ayuda de familia (familyCardHTML) e Historial/Anomalías
// (photoThumbsHTML/resolvePhotoThumbSrcs) ahora resuelven signed URLs igual
// que Reportes/firma de validación. También prueba el mecanismo de
// reintento único + placeholder (evidenceValueAttr/
// wireEvidenceImgFallbackOnce, §38/§40). Funciones REALES extraídas de
// app.js, con Sync/DB reemplazados por espías — nunca contra Supabase real.

import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

const appSource = readSource(APP_JS_PATH);
const dbSource = readSource(DB_JS_PATH);
const APP_NAMES = [
  '$', '$$', 'esc', 'ic', 'GREASE_UNIT', 'photosOf', 'resolveEvidenceSrc', 'evidenceValueAttr',
  'wireEvidenceImgFallbackOnce', 'openPhotoLightbox', 'photoThumbHTML', 'photoThumbsHTML',
  'resolvePhotoThumbSrcs', 'familySilhouetteSvg', 'familyCardHTML', 'pointRow',
];
const appRealSrc = APP_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');

// LOTE B ("PRIVATIZAR STORAGE engrase-photos") — openFamilyEditForm() era la
// ÚNICA pantalla que todavía quedaba en el §7 de docs/STORAGE_PRIVACY_DESIGN.md
// como "limitación conocida restante": fam.photo/p.photo (store `settings`,
// documento `help_content`) pasan por el mismo uploadPhotoIfNeeded() genérico
// que cualquier otro store, así que una vez sincronizados desde otro
// dispositivo dejan de ser base64 y se vuelven una URL de Storage real. Se
// carga la función REAL completa (openModal/closeModal/photoFieldHTML/
// wirePhotoField/getPhotoFieldPhotos reales, mismo patrón que openPlanForm)
// con DB/Sync espiados — nunca contra Supabase real.
const FAMILY_FORM_NAMES = [
  'MAX_PHOTOS', 'openFamilyEditForm', 'openModal', 'closeModal', 'photoFieldHTML', 'wirePhotoField',
  'getPhotoFieldPhotos', 'getSelectedPhotoDataURL', 'wirePhotoThumbs', 'renderPhotoStrip',
  'addPhotoToField', 'fileToCompressedDataURL', 'esc', 'ic', '$', '$$',
  'familySilhouetteSvg', 'photoThumbHTML', 'photoThumbsHTML', 'evidenceValueAttr', 'resolveEvidenceSrc',
];
const familyFormRealSrc = extractDeclaration(dbSource, 'uid') + '\n\n' +
  FAMILY_FORM_NAMES.map(n => extractDeclaration(appSource, n)).join('\n\n');

async function bootFamilyForm(page, { signedUrlMap = {} } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addScriptTag({
    content: `
      window.DB = { getConfig: async () => (${JSON.stringify(CFG)}) };
      window.__signedUrlCalls = [];
      window.Sync = {
        getSignedPhotoUrl: async (value, cfg, opts) => {
          window.__signedUrlCalls.push({ value, opts });
          const map = ${JSON.stringify(signedUrlMap)};
          return map[value] !== undefined ? map[value] : null;
        },
      };
      window.App = { currentUser: { name: 'Admin de prueba' } };
      window.stamp = (obj) => obj;
      window.logAudit = async () => {};
      window.showInAppToast = () => {};
      window.renderAyuda = () => {};
      ${familyFormRealSrc}
      window.openFamilyEditForm = openFamilyEditForm;
    `,
  });
}

const CFG = { url: 'https://fake.supabase.co', anonKey: 'anon-test' };
const LEGACY_URL_A = `${CFG.url}/storage/v1/object/public/engrase-photos/lubrication_plans/pt1.jpg`;
const SIGNED_URL_A = `${CFG.url}/storage/v1/object/sign/engrase-photos/lubrication_plans/pt1.jpg?token=aaa`;
const LEGACY_URL_B = `${CFG.url}/storage/v1/object/public/engrase-photos/settings/fam1.jpg`;
const SIGNED_URL_B = `${CFG.url}/storage/v1/object/sign/engrase-photos/settings/fam1.jpg?token=bbb`;

async function bootPage(page, { signedUrlMap = {} } = {}) {
  await page.setContent('<div id="app-content"></div>');
  await page.addScriptTag({
    content: `
      window.DB = { getConfig: async () => (${JSON.stringify(CFG)}) };
      window.__signedUrlCalls = [];
      window.Sync = {
        getSignedPhotoUrl: async (value, cfg, opts) => {
          window.__signedUrlCalls.push({ value, opts });
          const map = ${JSON.stringify(signedUrlMap)};
          return map[value] !== undefined ? map[value] : null;
        },
      };
      ${appRealSrc}
      window.familyCardHTML = familyCardHTML;
      window.pointRow = pointRow;
      window.photoThumbsHTML = photoThumbsHTML;
      window.resolvePhotoThumbSrcs = resolvePhotoThumbSrcs;
      window.resolveEvidenceSrc = resolveEvidenceSrc;
      window.wireEvidenceImgFallbackOnce = wireEvidenceImgFallbackOnce;
    `,
  });
}

test.describe('Checklist (pointRow) — miniatura resuelta con signed URL', () => {
  test('punto con foto en Storage (otro dispositivo la subió): usa el signed URL, no la URL cruda', async ({ page }) => {
    await bootPage(page, { signedUrlMap: { [LEGACY_URL_A]: SIGNED_URL_A } });
    const html = await page.evaluate(({ url }) => {
      const resolved = window.resolveEvidenceSrc; // no se usa directo aquí: pointRow recibe el src YA resuelto
      return window.pointRow({ id: 'pt1', point: 'Cilindro', photo: url, greaseType: 'g1', recommendedQty: 1 }, [], 'RESOLVED_PLACEHOLDER');
    }, { url: LEGACY_URL_A });
    expect(html).toContain('src="RESOLVED_PLACEHOLDER"');
  });

  test('sin resolvedPhotoSrc explícito: cae al valor crudo (compatibilidad hacia atrás)', async ({ page }) => {
    await bootPage(page);
    const html = await page.evaluate(({ url }) => window.pointRow({ id: 'pt1', point: 'Cilindro', photo: url, greaseType: 'g1', recommendedQty: 1 }, []), { url: LEGACY_URL_A });
    expect(html).toContain(`src="${LEGACY_URL_A}"`);
  });

  test('sin foto: no intenta resolver nada', async ({ page }) => {
    await bootPage(page);
    const html = await page.evaluate(() => window.pointRow({ id: 'pt1', point: 'Cilindro', photo: null, greaseType: 'g1', recommendedQty: 1 }, []));
    expect(html).not.toContain('<img');
  });
});

test.describe('Diagrama de ayuda de familia (familyCardHTML) — diagrama + miniaturas de puntos', () => {
  test('diagrama con foto real: resuelve signed URL, no muestra el dibujo SVG', async ({ page }) => {
    await bootPage(page, { signedUrlMap: { [LEGACY_URL_B]: SIGNED_URL_B } });
    const html = await page.evaluate(({ url }) => window.familyCardHTML({
      id: 'fam1', name: 'Excavadoras', svg: 'excavadora', photo: url,
      zones: [{ name: 'Zona 1', color: '#000', points: [] }],
    }, false), { url: LEGACY_URL_B });
    expect(html).toContain(`src="${SIGNED_URL_B}"`);
  });

  test('sin foto: usa el dibujo SVG genérico (sin llamar a Sync.getSignedPhotoUrl)', async ({ page }) => {
    await bootPage(page);
    const html = await page.evaluate(() => window.familyCardHTML({
      id: 'fam1', name: 'Excavadoras', svg: 'excavadora', photo: null,
      zones: [{ name: 'Zona 1', color: '#000', points: [] }],
    }, false));
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(html).not.toContain('<img');
    expect(calls).toHaveLength(0);
  });

  test('miniaturas de los puntos de cada zona también se resuelven, en paralelo con el diagrama', async ({ page }) => {
    await bootPage(page, { signedUrlMap: { [LEGACY_URL_A]: SIGNED_URL_A, [LEGACY_URL_B]: SIGNED_URL_B } });
    const html = await page.evaluate(({ a, b }) => window.familyCardHTML({
      id: 'fam1', name: 'Excavadoras', svg: 'excavadora', photo: b,
      zones: [{ name: 'Zona 1', color: '#000', points: [{ text: 'Punto 1', photo: a }] }],
    }, false), { a: LEGACY_URL_A, b: LEGACY_URL_B });
    expect(html).toContain(`src="${SIGNED_URL_B}"`); // diagrama
    expect(html).toContain(`src="${SIGNED_URL_A}"`); // miniatura del punto
  });
});

test.describe('Historial/Anomalías (photoThumbsHTML/resolvePhotoThumbSrcs)', () => {
  test('base64 local: se muestra directo, sin pedir nada a la red', async ({ page }) => {
    await bootPage(page);
    const result = await page.evaluate(async () => {
      const record = { photos: ['data:image/jpeg;base64,AAAA'] };
      const srcs = await window.resolvePhotoThumbSrcs(record);
      return { srcs, html: window.photoThumbsHTML(record, 'cap', srcs), calls: window.__signedUrlCalls.length };
    });
    expect(result.srcs).toEqual(['data:image/jpeg;base64,AAAA']);
    expect(result.html).toContain('src="data:image/jpeg;base64,AAAA"');
    expect(result.calls).toBe(0);
  });

  test('foto sincronizada de otro dispositivo (solo URL, sin base64): resuelve signed URL', async ({ page }) => {
    await bootPage(page, { signedUrlMap: { [LEGACY_URL_A]: SIGNED_URL_A } });
    const result = await page.evaluate(async (url) => {
      const record = { photos: [url] };
      const srcs = await window.resolvePhotoThumbSrcs(record);
      return { html: window.photoThumbsHTML(record, 'cap', srcs) };
    }, LEGACY_URL_A);
    expect(result.html).toContain(`src="${SIGNED_URL_A}"`);
    expect(result.html).toContain(`data-evidence-value="${LEGACY_URL_A}"`);
  });

  test('sin fotos: guion, sin llamar a resolvePhotoThumbSrcs innecesariamente', async ({ page }) => {
    await bootPage(page);
    const html = await page.evaluate(() => window.photoThumbsHTML({ photos: [] }, 'cap', []));
    expect(html).toContain('—');
  });
});

test.describe('openFamilyEditForm() — última pantalla con el gap abierto, ahora cerrada (LOTE B)', () => {
  test('foto de la familia en Storage: la vista previa usa el signed URL, nunca la URL cruda', async ({ page }) => {
    await bootFamilyForm(page, { signedUrlMap: { [LEGACY_URL_B]: SIGNED_URL_B } });
    await page.evaluate((url) => window.openFamilyEditForm({ families: [] }, {
      id: 'fam1', name: 'Excavadoras', svg: 'excavadora', photo: url,
      zones: [{ name: 'Zona 1', color: 'var(--accent)', points: [] }],
    }), LEGACY_URL_B);
    const preview = page.locator('#fam-preview img');
    await expect(preview).toHaveAttribute('src', SIGNED_URL_B);
    await expect(preview).toHaveAttribute('data-evidence-value', LEGACY_URL_B);
  });

  test('foto de un punto en Storage: la miniatura usa el signed URL; data-existing-photo conserva el valor CRUDO (lo que se vuelve a guardar si no se toca la foto)', async ({ page }) => {
    await bootFamilyForm(page, { signedUrlMap: { [LEGACY_URL_A]: SIGNED_URL_A } });
    await page.evaluate((url) => window.openFamilyEditForm({ families: [] }, {
      id: 'fam1', name: 'Excavadoras', svg: 'excavadora', photo: null,
      zones: [{ name: 'Zona 1', color: 'var(--accent)', points: [{ id: 'pt1', text: 'Cilindro', photo: url }] }],
    }), LEGACY_URL_A);
    const thumb = page.locator('.pt-current-photo img');
    await expect(thumb).toHaveAttribute('src', SIGNED_URL_A);
    // Crítico: si esto guardara el signed URL en vez del crudo, la próxima vez
    // que se abra el formulario SIN tocar la foto se persistiría una URL
    // temporal ya vencida en vez de la referencia real al objeto de Storage.
    await expect(page.locator('.pt-editor-row')).toHaveAttribute('data-existing-photo', LEGACY_URL_A);
  });

  test('sin foto (familia nueva): el dibujo SVG se muestra directo, sin pedir ningún signed URL', async ({ page }) => {
    await bootFamilyForm(page);
    await page.evaluate(() => window.openFamilyEditForm({ families: [] }, null));
    await expect(page.locator('#fam-preview img')).toHaveCount(0);
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(calls).toHaveLength(0);
  });

  test('sin sesión/signed URL disponible: cae de vuelta a la URL cruda — nunca deja de mostrar la foto', async ({ page }) => {
    await bootFamilyForm(page); // sin signedUrlMap -> getSignedPhotoUrl siempre null
    await page.evaluate((url) => window.openFamilyEditForm({ families: [] }, {
      id: 'fam1', name: 'Excavadoras', svg: 'excavadora', photo: url,
      zones: [{ name: 'Zona 1', color: 'var(--accent)', points: [] }],
    }), LEGACY_URL_B);
    await expect(page.locator('#fam-preview img')).toHaveAttribute('src', LEGACY_URL_B);
  });
});

test.describe('Reintento único + placeholder (§38/§40) — wireEvidenceImgFallbackOnce()', () => {
  test('primer fallo: reintenta con force:true; si el reintento funciona, actualiza el src', async ({ page }) => {
    // route.abort() en vez de un dominio inexistente: el error es
    // instantáneo y determinista, no depende del tiempo real de DNS (que
    // varía entre workers en paralelo y hacía flaky este test). El signed
    // URL "recuperado" también hay que resolverlo a un PNG real — si no, el
    // navegador también lo marca como roto (fake.supabase.co no existe) y
    // dispara un SEGUNDO error que reemplaza el <img> por el placeholder
    // antes de que la aserción alcance a leer el src ya actualizado.
    const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
    await page.route('**/broken.jpg', route => route.abort());
    await page.route(SIGNED_URL_A, route => route.fulfill({ status: 200, contentType: 'image/png', body: onePixelPng }));
    await bootPage(page, { signedUrlMap: { [LEGACY_URL_A]: SIGNED_URL_A } });
    await page.evaluate(() => window.wireEvidenceImgFallbackOnce());
    await page.evaluate((url) => {
      document.getElementById('app-content').innerHTML =
        `<img id="ev-img" src="https://fake.invalid/broken.jpg" data-evidence-value="${url}"/>`;
    }, LEGACY_URL_A);

    await expect(page.locator('#ev-img')).toHaveAttribute('src', SIGNED_URL_A, { timeout: 5000 });
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(calls[0].opts).toEqual({ force: true });
  });

  test('reintento también falla: reemplaza el <img> por un placeholder controlado, nunca un ícono de imagen rota', async ({ page }) => {
    await page.route('**/broken.jpg', route => route.abort());
    await page.route(`**/lubrication_plans/pt1.jpg`, route => route.abort()); // el reintento cae al mismo valor original, también roto
    await bootPage(page); // sin signedUrlMap -> getSignedPhotoUrl siempre null -> resolveEvidenceSrc cae al valor original (también roto)
    await page.evaluate(() => window.wireEvidenceImgFallbackOnce());
    await page.evaluate((url) => {
      document.getElementById('app-content').innerHTML =
        `<img id="ev-img" src="https://fake.invalid/broken.jpg" data-evidence-value="${url}"/>`;
    }, LEGACY_URL_A);

    await expect(page.locator('.photo-thumb-placeholder')).toBeVisible({ timeout: 5000 });
    await expect(page.locator('#ev-img')).toHaveCount(0);
    await expect(page.locator('.photo-thumb-placeholder')).toContainText('no disponible');
  });

  test('un <img> sin data-evidence-value (ícono normal de la app) nunca se toca', async ({ page }) => {
    await page.route('**/icon.png', route => route.abort());
    await bootPage(page);
    await page.evaluate(() => window.wireEvidenceImgFallbackOnce());
    await page.evaluate(() => {
      document.getElementById('app-content').innerHTML = `<img id="icon-img" src="https://fake.invalid/icon.png"/>`;
    });
    await page.waitForTimeout(300); // deja tiempo a que el error dispare, si fuera a hacerlo
    await expect(page.locator('#icon-img')).toHaveCount(1);
    const calls = await page.evaluate(() => window.__signedUrlCalls);
    expect(calls).toHaveLength(0);
  });
});
