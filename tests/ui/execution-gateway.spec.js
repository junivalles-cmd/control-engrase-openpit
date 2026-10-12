import { test, expect } from '@playwright/test';
import { DB_JS_PATH, SYNC_JS_PATH, APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { extractDeclaration, readSource } from '../helpers/extractFromSource.js';

async function boot(page) {
  // Entire persistence/transport source, real browser IndexedDB, synthetic identity only.
  await page.route('**/*', route => route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body></body>'}));
  await page.goto('/');
  await page.addScriptTag({content:readSource(DB_JS_PATH)});
  await page.addScriptTag({content:`
    window.Auth={isSupabaseMode:()=>true,isAuthenticated:()=>true,getProfile:()=>({appUserId:'u1'}),getSession:()=>({accessToken:'fixture-jwt'}),getSessionEpoch:()=>1};
    window.classifyAuthStatus = status => status===401?'AUTH_REQUIRED':status===403?'AUTH_FORBIDDEN':null;
    window.__requests=[];window.__response={status:503,body:{}};
    window.fetch=async(url,options)=>{__requests.push({url,method:options.method,body:options.body});
      return {ok:__response.status===200,status:__response.status,json:async()=>__response.body};};
  `});
  await page.addScriptTag({content:readSource(SYNC_JS_PATH)});
  await page.evaluate(async()=>{
    await openDB();await DB.setConfig({url:'https://fixture.test',anonKey:'public-key'});
    window.__before={id:'e1',hourmeter:100,locationId:'loc1',updatedAt:'2026-01-01T00:00:00Z',_pushedVersion:'2026-01-01T00:00:00Z'};
    window.__plan={id:'p1',equipmentId:'e1',lastGreaseHour:100,frequency:10,updatedAt:__before.updatedAt,_pushedVersion:__before.updatedAt};
    window.__record={id:'r1',equipmentId:'e1',planId:'p1',hourmeter:110,qty:1,userId:'u1',date:new Date().toISOString(),shiftId:'shift_dia',details:[],photos:[],updatedAt:'2026-10-12T12:00:00Z',operationalSnapshot:{crewId:'c1',executionType:'PLANNED'}};
    await DB.put('equipment',__before);await DB.put('lubrication_plans',__plan);
    window.__create=()=>queueLubricationExecution({action:'CREATE',actorId:'u1',record:__record,equipmentBefore:__before,planBefore:__plan,
      equipmentAfter:{...__before,hourmeter:110,updatedAt:__record.updatedAt},planAfter:{...__plan,lastGreaseHour:110,updatedAt:__record.updatedAt}});
  });
}
test('real IndexedDB atomically saves execution and retry intent; restart keeps queue',async({page})=>{
  await boot(page);await page.evaluate(()=>__create());
  const saved=await page.evaluate(async()=>({operations:await DB.getExecutionOperations(),equipment:await DB.get('equipment','e1'),record:await DB.get('lubrication_records','r1')}));
  expect(saved.operations).toHaveLength(1);expect(saved.record._executionOperationId).toBe('r1');expect(saved.equipment.hourmeter).toBe(110);
  await page.evaluate(()=>{_db.close();return openDB();});
  expect(await page.evaluate(async()=>(await DB.getExecutionOperations()).length)).toBe(1);
  await page.evaluate(()=>Sync.pushAll());
  expect(await page.evaluate(()=>__requests)).toHaveLength(1);
  expect(await page.evaluate(async()=>(await DB.getExecutionOperations())[0].status)).toBe('RETRYABLE');
});
test('local version conflict aborts entire transaction before changing any row',async({page})=>{
  await boot(page);
  const state=await page.evaluate(async()=>{
    await DB.put('equipment',{...__before,updatedAt:'newer',hourmeter:120});
    let error;try{await __create();}catch(e){error=e.message;}
    return {error,record:await DB.get('lubrication_records','r1'),equipment:await DB.get('equipment','e1'),plan:await DB.get('lubrication_plans','p1'),operations:await DB.getExecutionOperations()};
  });
  expect(state.error).toBe('LOCAL_VERSION_CONFLICT');expect(state.record).toBeNull();expect(state.equipment.hourmeter).toBe(120);
  expect(state.plan.lastGreaseHour).toBe(100);expect(state.operations).toHaveLength(0);
});
test('canonical acknowledgment rebases dependent edit, preserves newer local edit, and retries exact request',async({page})=>{
  await boot(page);
  const state=await page.evaluate(async()=>{
    await __create();const before=await DB.get('lubrication_records','r1');const equipment=await DB.get('equipment','e1');const plan=await DB.get('lubrication_plans','p1');
    const edit=await queueLubricationExecution({action:'EDIT',actorId:'u1',recordBefore:before,record:{...before,notes:'Later edit',updatedAt:'2026-10-12T12:01:00Z'},
      equipmentBefore:equipment,planBefore:plan});
    const first=(await DB.getExecutionOperations())[0];
    const rows=['lubrication_records','equipment','lubrication_plans'].map(store=>({store,id:store==='lubrication_records'?'r1':store==='equipment'?'e1':'p1',payload:first.localRows[store],updated_at:'2026-10-12T12:00:30Z'}));
    await DB.finishExecutionOperation(first,rows);
    const rebased=(await DB.getExecutionOperations())[0];
    return {record:await DB.get('lubrication_records','r1'),rebased,editId:edit.id};
  });
  expect(state.record.notes).toBe('Later edit');expect(state.record._executionOperationId).toBe(state.editId);
  expect(state.rebased.dependencies).toEqual({});expect(state.rebased.params.p_expected_record).toBe('2026-10-12T12:00:30Z');
  expect(state.rebased.params.p_expected_plan).toBe('2026-10-12T12:00:30Z');
  await page.evaluate(()=>Sync.pushAll());const body=await page.evaluate(()=>__requests[0].body);
  await page.evaluate(()=>Sync.pushAll());expect(await page.evaluate(()=>__requests[1].body)).toBe(body);
});
test('acknowledgment preserves unrelated catalog edits made during dispatch',async({page})=>{
  await boot(page);
  const state=await page.evaluate(async()=>{
    await __create();const op=(await DB.getExecutionOperations())[0];const local=await DB.get('equipment','e1');
    await DB.put('equipment',{...local,model:'Updated model',updatedAt:'2026-10-12T12:02:00Z'});
    await DB.finishExecutionOperation(op,[{store:'equipment',id:'e1',payload:{...__before,hourmeter:110},updated_at:'2026-10-12T12:00:30Z'}]);
    return DB.get('equipment','e1');
  });
  expect(state.model).toBe('Updated model');expect(state.hourmeter).toBe(110);expect(state._executionOperationId).toBeUndefined();
  expect(state._pushedVersion).toBe('2026-10-12T12:00:30Z');
});
test('terminal signed-record response is visible, preserves all data, and never loops',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    await __create();window.__messages=[];window.showInAppToast=m=>__messages.push(m);
    __response={status:200,body:{status:'DENIED',code:'SIGNED_RECORD_LOCKED'}};
    const before=await DB.get('lubrication_records','r1');await Sync.pushAll();await Sync.pushAll();
    return {before,after:await DB.get('lubrication_records','r1'),operations:await DB.getExecutionOperations(),requests:__requests,messages:__messages};
  });
  expect(result.after).toEqual(result.before);expect(result.requests).toHaveLength(1);expect(result.operations[0].status).toBe('BLOCKED');
  expect(result.messages).toEqual(['Este engrase tiene firmas asociadas y no puede editarse directamente.']);
});
test('ADMIN also receives the existing UI signed-record lock before opening editor',async({page})=>{
  await boot(page);
  await page.addScriptTag({content:extractDeclaration(readSource(APP_JS_PATH),'openEditGreaseRecordForm')});
  const result=await page.evaluate(async()=>{
    window.App={currentUser:{id:'u1',role:'ADMINISTRADOR'}};window.__alerts=[];window.alert=m=>__alerts.push(m);
    await DB.put('grease_validations',{id:'v1',lubricationRecordId:'r1',active:true,signatureUrl:'https://fixture.test/signature'});
    await openEditGreaseRecordForm(__record);return {messages:__alerts,signature:await DB.get('grease_validations','v1')};
  });
  expect(result.messages).toEqual(['Este engrase tiene firmas asociadas y no puede editarse directamente.']);
  expect(result.signature.signatureUrl).toBe('https://fixture.test/signature');
});
test('offline edit rejected by a remote signature restores original official version and retains attempted edit',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    const original={...__record,notes:'Signed original',photos:['data:image/png;base64,AA=='],photo:'data:image/png;base64,AA==',_pushedVersion:__record.updatedAt};
    await DB.put('lubrication_records',original);
    const signature={id:'v1',active:true,lubricationRecordId:'r1',signatureUrl:'https://fixture.test/original-signature',updatedAt:'sig',_pushedVersion:'sig'};
    await DB.put('grease_validations',signature);
    const op=await queueLubricationExecution({action:'EDIT',actorId:'u1',recordBefore:original,
      record:{...original,notes:'Attempted edit',photos:[],photo:null,hourmeter:115,updatedAt:'2026-10-12T12:02:00Z'},equipmentBefore:__before,planBefore:__plan,
      equipmentAfter:{...__before,hourmeter:115,updatedAt:'2026-10-12T12:02:00Z'}});
    __response={status:200,body:{status:'DENIED',code:'SIGNED_RECORD_LOCKED',rows:[
      {store:'lubrication_records',id:'r1',payload:{...original,photos:['https://fixture.test/original-photo'],photo:'https://fixture.test/original-photo'},updated_at:'2026-10-12T12:00:00+00:00'},
      {store:'equipment',id:'e1',payload:__before,updated_at:__before.updatedAt},
      {store:'lubrication_plans',id:'p1',payload:__plan,updated_at:__plan.updatedAt},
    ]}};
    await Sync.pushAll();await Sync.pushAll();return {record:await DB.get('lubrication_records','r1'),equipment:await DB.get('equipment','e1'),
      signature:await DB.get('grease_validations','v1'),originalSignature:signature,operations:await DB.getExecutionOperations(),requests:__requests};
  });
  expect(result.record.notes).toBe('Signed original');expect(result.record.hourmeter).toBe(110);expect(result.record._executionOperationId).toBeUndefined();
  expect(result.record.photos).toEqual(['data:image/png;base64,AA==']);
  expect(result.equipment.hourmeter).toBe(100);expect(result.signature).toEqual(result.originalSignature);
  expect(result.operations[0]).toMatchObject({status:'BLOCKED',code:'SIGNED_RECORD_LOCKED',params:{p_notes:'Attempted edit'}});
  expect(result.requests).toHaveLength(1);
});
