import { test, expect } from '@playwright/test';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';
import { APP_JS_PATH, DB_JS_PATH, GREASE_VALIDATION_JS_PATH } from '../helpers/loadLubricationLogic.js';

const declarations = (file, names) => names.map(n => extractDeclaration(readSource(file), n)).join('\n');
const realDB = declarations(DB_JS_PATH, ['DB_NAME', 'DB_VERSION', 'STORES', 'LOCAL_STORES', 'openDB', 'tx', 'DB', 'uid', 'nowISO', 'stamp']);
const core = declarations(GREASE_VALIDATION_JS_PATH, ['findActiveValidations', 'findActiveValidation']);
const app = declarations(APP_JS_PATH, ['$', '$$', 'esc', 'fmtDate', 'openModal', 'closeModal', 'openValidationConflictModal']);
async function boot(page) {
  await page.route('**/*', route => route.request().isNavigationRequest() ? route.fulfill({ contentType: 'text/html', body: '<main></main>' }) : route.abort());
  await page.goto('/');
  await page.addScriptTag({ content: `let _db = null; ${realDB}\n${core}\n${app}
    const App = { currentUser: { id: 'admin', name: 'Admin fixture', role: 'ADMINISTRADOR' } };
    const resolveEvidenceSrc = async value => value; const evidenceValueAttr = () => '';
    window.testDB = DB; window.testApp = App;
    window.showConflict = async () => openValidationConflictModal(await DB.allActive('grease_validations'), { code: 'E-TEST' }, null);
    window.ready = openDB().then(async () => {
      await DB.put('grease_validations', { id: 'a', lubricationRecordId: 'r', updatedAt: 'v1', signerName: 'First', signerRole: 'OPERADOR', signatureLocal: 'data:image/png;base64,AAAA' });
      await DB.put('grease_validations', { id: 'b', lubricationRecordId: 'r', updatedAt: 'v1', signerName: 'Second', signerRole: 'ENCARGADO', signatureLocal: 'data:image/png;base64,BBBB' });
    });` });
  await page.evaluate(() => window.ready);
}
test('admin resolves offline; official, alternatives and audit survive IndexedDB reload', async ({ page }) => {
  await boot(page);
  await page.context().setOffline(true);
  await page.evaluate(() => window.showConflict());
  await page.locator('#resolution-official').selectOption('b');
  await page.locator('#resolution-reason').fill('Confirmed with both signers');
  await page.locator('#resolution-confirm').click();
  await expect(page.locator('.val-conflict-item')).toHaveCount(2);
  await expect(page.locator('.modal')).toContainText('OFICIAL');
  await expect(page.locator('.modal')).toContainText('ALTERNATIVA CONSERVADA');
  const rows = await page.evaluate(() => window.testDB.all('grease_validations'));
  expect(rows[0].conflictResolution).toMatchObject({ officialValidationId: 'b', resolvedById: 'admin', reason: 'Confirmed with both signers' });
  expect(rows[0].conflictResolution.resolvedAt).toBeTruthy();
  expect(rows.map(v => v.signatureLocal)).toEqual(['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']);
  await page.evaluate(() => window.showConflict());
  await expect(page.locator('#resolution-confirm')).toHaveCount(0);
});
test('nonadmin and missing reason are rejected by persistence, not just by UI', async ({ page }) => {
  await boot(page);
  const failures = await page.evaluate(async () => {
    const expected = [{ id: 'a', updatedAt: 'v1' }, { id: 'b', updatedAt: 'v1' }];
    const errors = [];
    for (const [actor, reason] of [[{ id: 's', role: 'SUPERVISOR' }, 'reason'], [window.testApp.currentUser, '']]) {
      try { await window.testDB.resolveValidationConflict('r', expected, 'b', reason, actor); } catch (e) { errors.push(e.message); }
    }
    window.testApp.currentUser.role = 'SUPERVISOR';
    return errors;
  });
  expect(failures).toHaveLength(2);
  await page.evaluate(() => window.showConflict());
  await expect(page.locator('#resolution-confirm')).toHaveCount(0);
});
test('two simultaneous local decisions use an atomic snapshot check', async ({ page }) => {
  await boot(page);
  const results = await page.evaluate(async () => {
    const expected = [{ id: 'a', updatedAt: 'v1' }, { id: 'b', updatedAt: 'v1' }];
    const decisions = await Promise.allSettled(['a', 'b'].map(id => window.testDB.resolveValidationConflict('r', expected, id, 'decision', window.testApp.currentUser)));
    return decisions.map(result => result.status);
  });
  expect(results).toEqual(['fulfilled', 'rejected']);
});
test('a sync CAS conflict preserves the local audit and reopens the validation conflict', async ({ page }) => {
  await boot(page);
  await page.evaluate(async () => {
    await window.testDB.resolveValidationConflict('r', [{ id: 'a', updatedAt: 'v1' }, { id: 'b', updatedAt: 'v1' }], 'b', 'review', window.testApp.currentUser);
    await window.testDB.recordConflicts([{ store: 'grease_validations', id: 'a', remoteVersion: 'another-decision' }]);
    await window.showConflict();
  });
  await expect(page.locator('.modal')).toContainText('Resolución pendiente de revisión');
  await expect(page.locator('.modal')).not.toContainText('OFICIAL');
  const row = await page.evaluate(() => window.testDB.get('grease_validations', 'a'));
  expect(row.conflictResolution.reason).toBe('review');
  expect(row.signatureLocal).toBe('data:image/png;base64,AAAA');
});
