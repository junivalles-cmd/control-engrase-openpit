import { test, expect } from '@playwright/test';
import { readSource } from '../helpers/extractFromSource.js';
import { DB_JS_PATH } from '../helpers/loadLubricationLogic.js';

test('first context, matching grants, changed fingerprint and deletion remain local and isolated', async ({page}) => {
  await page.route('**/*', r => r.fulfill({contentType:'text/html',body:'<main></main>'}));
  await page.goto('/');
  await page.addScriptTag({content:readSource(DB_JS_PATH)});
  const result = await page.evaluate(async () => {
    await openDB();
    const first = {active:true,appUserId:'u1',scopeType:'GLOBAL'};
    await DB.setAuthorizationContext('u1',first);
    const storedFirst = await DB.getAuthorizationContext('u1');
    const signed = {...first,authUserId:'auth1',authorizationFingerprint:'one',supportGrants:{rows:[{store:'equipment',id:'e1'}]}};
    await DB.setAuthorizationContext('u1',signed);
    await DB.setAuthorizationContext('u1',{...first,authUserId:'auth1',authorizationFingerprint:'one'});
    const matching = await DB.getAuthorizationContext('u1');
    await DB.setAuthorizationContext('u1',{...first,authUserId:'auth1',authorizationFingerprint:'two'});
    const changed = await DB.getAuthorizationContext('u1');
    const other = await DB.getAuthorizationContext('u2');
    await DB.setAuthorizationContext('u1',null);
    return {storedFirst,matching,changed,other,deleted:await DB.getAuthorizationContext('u1')};
  });
  expect(result.storedFirst).toEqual({active:true,appUserId:'u1',scopeType:'GLOBAL'});
  expect(result.matching.supportGrants.rows).toHaveLength(1);
  expect(result.changed.supportGrants).toBeUndefined();
  expect(result.other).toBeNull();
  expect(result.deleted).toBeNull();
});
