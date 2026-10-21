import { test, expect } from '@playwright/test';
import { DB_JS_PATH, SYNC_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { readSource } from '../helpers/extractFromSource.js';

async function boot(page, role = 'PLANIFICADOR') {
  await page.route('**/*', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><body></body>' }));
  await page.goto('/');
  await page.addScriptTag({ content: readSource(DB_JS_PATH) });
  await page.addScriptTag({ content: `
    window.App={currentUser:{id:'u1',name:'Fixture',role:${JSON.stringify(role)}}};
    window.Auth={isSupabaseMode:()=>true,isAuthenticated:()=>true,getProfile:()=>({appUserId:'u1',role:${JSON.stringify(role)},authorizationFingerprint:'fixture-fingerprint'}),
      getSession:()=>({accessToken:'fixture-user-jwt'}),getSessionEpoch:()=>1};
    window.classifyAuthStatus=s=>s===401?'AUTH_REQUIRED':s===403?'AUTH_FORBIDDEN':null;
    window.__requests=[];window.__rpcFailure=null;
    window.fetch=async(url,options={})=>{
      __requests.push({url:String(url),method:options.method||'GET',body:options.body||null,authorization:options.headers?.Authorization||null});
      if(String(url).includes('/rpc/')){
        if(__rpcFailure){const failure=__rpcFailure;__rpcFailure=null;return {ok:failure.status===200,status:failure.status,json:async()=>failure.body};}
        const op=(await DB.getEvidenceOperations())[0];
        return {ok:true,status:200,json:async()=>({status:'APPLIED',rows:[{store:op.targetStore,id:op.params.p_id,
          payload:op.localRow,updated_at:'2026-10-12T12:00:01Z'}]})};
      }
      return {ok:true,status:200,json:async()=>({rows:[]})};
    };
  ` });
  await page.addScriptTag({ content: readSource(SYNC_JS_PATH) });
  await page.evaluate(async () => {
    await openDB();
    await DB.setConfig({ url: 'https://fixture.test', anonKey: 'public-key' });
    await DB.setAuthorizationContext('u1',{appUserId:'u1',active:true,scopeType:'GLOBAL',authorizedCrewIds:[],authorizedLocationIds:[],rowScopeEnforced:true});
    const version = '2026-10-12T12:00:00Z';
    await DB.put('equipment', { id: 'e1', code: 'E1', model: 'M1', locationId: 'loc1', updatedAt: version, _pushedVersion: version });
  });
}

test('location move persists offline intent and uses only the authenticated typed RPC', async ({ page }) => {
  await boot(page);
  const result = await page.evaluate(async () => {
    const before = await DB.get('equipment', 'e1');
    await DB.queueCatalogOperation('MOVE', before, { locationId: 'loc2' });
    const queued = await DB.getEvidenceOperations();
    __rpcFailure = { status: 503, body: {} };
    await Sync.pushAll();
    const retry = (await DB.getEvidenceOperations())[0];
    const firstBody = __requests.find(r => r.url.includes('/rpc/'))?.body;
    await Sync.pushAll();
    return { queued, retry, firstBody, requests: __requests, row: await DB.get('equipment', 'e1'), remaining: await DB.getEvidenceOperations() };
  });
  expect(result.queued).toHaveLength(1);
  expect(result.retry.status).toBe('RETRYABLE');
  expect(result.retry.rpc).toBe('move_equipment_master_location');
  expect(result.remaining).toHaveLength(0);
  expect(result.row.locationId).toBe('loc2');
  const rpcRequests = result.requests.filter(request => request.url.includes('/rpc/'));
  expect(rpcRequests).toHaveLength(2);
  expect(rpcRequests.every(request => request.method === 'POST' && request.authorization === 'Bearer fixture-user-jwt')).toBe(true);
  expect(rpcRequests.map(request => request.body)).toEqual([result.firstBody, result.firstBody]);
  expect(result.requests.some(request => request.method === 'PATCH')).toBe(false);
});

test('Supervisor cannot locally queue a master-location move', async ({ page }) => {
  await boot(page, 'SUPERVISOR');
  const result = await page.evaluate(async () => {
    let code;
    try { await DB.queueCatalogOperation('MOVE', await DB.get('equipment', 'e1'), { locationId: 'loc2' }); }
    catch (error) { code = error.message; }
    return { code, operations: await DB.getEvidenceOperations(), requests: __requests };
  });
  expect(result.code).toBe('ROLE_DENIED');
  expect(result.operations).toHaveLength(0);
  expect(result.requests).toHaveLength(0);
});
