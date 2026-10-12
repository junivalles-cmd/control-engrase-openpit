import { test, expect } from '@playwright/test';
import { DB_JS_PATH, SYNC_JS_PATH, OPERATIONAL_SCOPE_JS_PATH, GREASE_VALIDATION_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { readSource, extractDeclaration } from '../helpers/extractFromSource.js';

async function boot(page) {
  await page.route('**/*', r => r.fulfill({contentType:'text/html',body:'<!doctype html><body></body>'}));
  await page.goto('/');
  await page.addScriptTag({content:readSource(DB_JS_PATH)});
  await page.addScriptTag({content:`
    window.App={currentUser:{id:'u1',name:'Fixture',role:'LUBRICADOR'}};
    window.__authenticated=true;window.__epoch=1;window.__requests=[];window.__failure=null;window.__logoutInResponse=false;
    window.Auth={isSupabaseMode:()=>true,isAuthenticated:()=>__authenticated,getProfile:()=>({appUserId:'u1'}),getSession:()=>({accessToken:'fixture-jwt'}),getSessionEpoch:()=>__epoch};
    window.classifyAuthStatus=s=>s===401?'AUTH_REQUIRED':s===403?'AUTH_FORBIDDEN':null;
    window.fetch=async(url,options)=>{
      __requests.push({url,method:options.method,body:typeof options.body==='string'?options.body:null,headers:options.headers});
      if(String(url).includes('/storage/'))return {ok:true,status:200};
      const params=JSON.parse(options.body);
      if(__failure)return {ok:__failure.http===200,status:__failure.http,json:async()=>__failure.body};
      const version='2026-10-12T12:01:00Z';let rows=[];
      if(String(url).endsWith('/lubrication_execution')){
        const op=(await DB.getExecutionOperations()).find(op=>op.id===params.p_operation_id);
        rows=Object.entries(op.localRows).map(([store,payload])=>({store,id:payload.id,payload,updated_at:version}));
      }else if(String(url).endsWith('/repeat_anomaly_from_execution')){
        rows=[{store:'anomalies',id:'auto:'+params.p_record_id+':p1',payload:{id:'auto:'+params.p_record_id+':p1',active:true,equipmentId:'e1',status:'Abierta',repeticiones:1},updated_at:version}];
      }else{
        const store=String(url).includes('anomaly')?'anomalies':'grease_validations';
        const id=String(url).includes('resolve_')?'v1':params.p_id;
        const local=await DB.get(store,id);
        rows=[{store,id,payload:{...local,...(store==='grease_validations'?{signatureLocal:null,signatureUrl:params.p_signature_url||local.signatureUrl,
          recordVersion:params.p_expected||local.recordVersion,recordSnapshot:await DB.get('lubrication_records','r1')}: {})},updated_at:version}];
      }
      if(__logoutInResponse){__authenticated=false;__epoch++;}
      return {ok:true,status:200,json:async()=>({status:'APPLIED',rows})};
    };
  `});
  await page.addScriptTag({content:readSource(SYNC_JS_PATH)});
  await page.addScriptTag({content:extractDeclaration(readSource(OPERATIONAL_SCOPE_JS_PATH),'canLubricadorExecuteEquipment')});
  await page.addScriptTag({content:extractDeclaration(readSource(GREASE_VALIDATION_JS_PATH),'findActiveValidations')});
  await page.evaluate(async()=>{
    await openDB();await DB.setConfig({url:'https://fixture.test',anonKey:'public-key'});
    window.__version='2026-10-12T12:00:00Z';
    window.__equipment={id:'e1',locationId:'loc1',hourmeter:100,updatedAt:__version,_pushedVersion:__version};
    window.__record={id:'r1',equipmentId:'e1',userId:'u1',date:__version,qty:1,hourmeter:100,photos:[],details:[],updatedAt:__version,_pushedVersion:__version,operationalSnapshot:{crewId:'c1'}};
    await DB.put('equipment',__equipment);await DB.put('lubrication_records',__record);
    window.__anomaly={id:'a1',equipmentId:'e1',crewId:'c1',component:'Otro',description:'Description',criticality:'Media',status:'Abierta',photos:[],active:true,updatedAt:__version,capturedByUserId:'u1'};
    window.__signature=()=>{
      const canvas=document.createElement('canvas');canvas.width=40;canvas.height=20;
      canvas.getContext('2d').fillRect(0,0,30,10);
      return {id:'v1',lubricationRecordId:'r1',equipmentId:'e1',signerName:'Declared operator',signerRole:'OPERADOR',signatureLocal:canvas.toDataURL('image/png'),updatedAt:__version,active:true};
    };
  });
}

test('manual create/edit/close use typed RPCs and immutable upload keys',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    await queueAnomalyOperation('REPORT',__anomaly);await Sync.pushAll();
    let before=await DB.get('anomalies','a1');
    await queueAnomalyOperation('EDIT',{...before,description:'Changed',updatedAt:'2026-10-12T12:02:00Z'},before);await Sync.pushAll();
    before=await DB.get('anomalies','a1');
    await queueAnomalyOperation('CLOSE',{...before,status:'Cerrada',updatedAt:'2026-10-12T12:03:00Z'},before,'Fixed');await Sync.pushAll();
    return {requests:__requests,queue:await DB.getEvidenceOperations(),row:await DB.get('anomalies','a1')};
  });
  expect(result.queue).toHaveLength(0);expect(result.row.status).toBe('Cerrada');
  expect(result.requests.map(r=>r.url.split('/').pop())).toEqual(['report_anomaly','edit_anomaly','close_anomaly']);
  expect(JSON.parse(result.requests[1].body)).not.toHaveProperty('p_equipment_id');
});

test('offline intent is durable; missing endpoint retries exact request with no generic fallback',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    await queueAnomalyOperation('REPORT',__anomaly);_db.close();await openDB();
    __failure={http:503,body:{}};await Sync.pushAll();await Sync.pushAll();
    return {queue:await DB.getEvidenceOperations(),requests:__requests,row:await DB.get('anomalies','a1')};
  });
  expect(result.queue).toHaveLength(1);expect(result.queue[0].status).toBe('RETRYABLE');
  expect(result.requests).toHaveLength(2);expect(result.requests[0].body).toBe(result.requests[1].body);
  expect(result.requests.every(r=>r.url.includes('/rpc/report_anomaly'))).toBe(true);expect(result.row.description).toBe('Description');
});

test('own/other or scope server DENY is permanent, preserves local evidence and never loops',async({page})=>{
  await boot(page);
  for(const code of ['ANOMALY_OWNER_DENIED','SCOPE_DENIED']){
    const result=await page.evaluate(async code=>{
      __requests=[];__anomaly={...__anomaly,id:code};await queueAnomalyOperation('REPORT',__anomaly);
      __failure={http:200,body:{status:'DENIED',code}};await Sync.pushAll();await Sync.pushAll();
      return {requests:__requests,queue:await DB.getEvidenceOperations()};
    },code);
    expect(result.requests).toHaveLength(1);expect(result.queue.find(op=>op.code===code).status).toBe('BLOCKED');
  }
});

test('automatic anomaly failure retains dependent intent; retry never duplicates the execution',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    const record={...__record,id:'r2',_pushedVersion:undefined,details:[{pointId:'p1',pointName:'Point',done:false,reason:'Otro'}]};
    await queueLubricationExecution({action:'CREATE',actorId:'u1',record,equipmentBefore:__equipment});
    const initial=await DB.getEvidenceOperations();
    const originalFetch=fetch;
    window.fetch=async(url,options)=>{
      if(String(url).endsWith('/repeat_anomaly_from_execution')){
        __requests.push({url,body:options.body});return {ok:false,status:503};
      }
      return originalFetch(url,options);
    };
    await Sync.pushAll();const failed=await DB.getEvidenceOperations();const count=await Sync.pendingCount();
    window.fetch=originalFetch;await Sync.pushAll();
    return {initial,failed,count,queue:await DB.getEvidenceOperations(),requests:__requests,records:await DB.all('lubrication_records')};
  });
  expect(result.initial[0].recordDependency).toBe('r2');expect(result.failed[0].status).toBe('RETRYABLE');expect(result.count).toBeGreaterThan(0);
  expect(result.failed[0].localRecordSnapshot.details[0].reason).toBe('Otro');
  expect(result.queue).toHaveLength(0);expect(result.records).toHaveLength(2);
  expect(result.requests.filter(r=>r.url.endsWith('/lubrication_execution'))).toHaveLength(1);
  const auto=result.requests.filter(r=>r.url.endsWith('/repeat_anomaly_from_execution'));expect(auto).toHaveLength(2);expect(auto[0].body).toBe(auto[1].body);
});

test('signature captures declared signer separately, exact record version, immutable binary and local offline copy',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    const signature=__signature();await queueGreaseValidation(signature,__record);const pending=await DB.get('grease_validations','v1');
    await Sync.pushAll();return {pending,saved:await DB.get('grease_validations','v1'),requests:__requests,queue:await DB.getEvidenceOperations()};
  });
  expect(result.pending.recordSnapshot.id).toBe('r1');expect(result.pending.recordVersion).toBe('2026-10-12T12:00:00Z');
  expect(result.saved.signatureLocal).toBe(result.pending.signatureLocal);expect(result.saved.signerName).toBe('Declared operator');expect(result.queue).toHaveLength(0);
  expect(result.requests[0].headers['x-upsert']).toBe('false');expect(result.requests[1].url).toContain('/rpc/capture_grease_validation');
  expect(JSON.parse(result.requests[1].body)).not.toHaveProperty('signatureLocal');
});

test('signature upload failure preserves binary and prevents RPC dispatch',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    await queueGreaseValidation(__signature(),__record);window.fetch=async(url)=>{__requests.push({url});return {ok:false,status:503};};
    await Sync.pushAll();return {requests:__requests,queue:await DB.getEvidenceOperations(),row:await DB.get('grease_validations','v1')};
  });
  expect(result.requests).toHaveLength(1);expect(result.requests[0].url).toContain('/storage/');expect(result.row.signatureLocal).toContain('data:image/png');expect(result.queue[0].frozen).toBeUndefined();
});

test('logout/token expiry and account change never dispatch an intent without its valid JWT',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    await queueAnomalyOperation('REPORT',__anomaly);__authenticated=false;
    const loggedOut=await Sync.pushAll();__authenticated=true;Auth.getProfile=()=>({appUserId:'other'});
    await Sync.pushAll();Auth.getProfile=()=>({appUserId:'u1'});__failure={http:401,body:{}};
    const expired=await Sync.pushAll();return {loggedOut,expired,requests:__requests,queue:await DB.getEvidenceOperations()};
  });
  expect(result.loggedOut.reason).toBe('AUTH_REQUIRED');expect(result.expired.reason).toBe('AUTH_REQUIRED');expect(result.requests).toHaveLength(1);expect(result.queue).toHaveLength(1);
  expect(result.requests[0].headers.Authorization).toBe('Bearer fixture-jwt');
});

test('logout during reply cannot acknowledge or consume another session intent',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    await queueAnomalyOperation('REPORT',__anomaly);__logoutInResponse=true;
    const pushed=await Sync.pushAll();return {pushed,queue:await DB.getEvidenceOperations(),row:await DB.get('anomalies','a1')};
  });
  expect(result.pushed.reason).toBe('AUTH_REQUIRED');expect(result.queue).toHaveLength(1);expect(result.row._pushedVersion).toBeUndefined();
});

test('admin resolution is a durable CAS operation preserving alternatives; stale server resolution remains conflict',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    App.currentUser={id:'u1',role:'ADMINISTRADOR',name:'Admin'};
    for(const id of ['v1','v2'])await DB.put('grease_validations',{...__signature(),id,signatureUrl:'https://fixture.test/'+id,_pushedVersion:__version});
    await DB.resolveValidationConflict('r1',[{id:'v1',updatedAt:__version},{id:'v2',updatedAt:__version}],'v2','Reviewed',App.currentUser);
    __failure={http:200,body:{status:'CONFLICT',code:'SIGNATURES_VERSION_CONFLICT'}};await Sync.pushAll();
    const rows=await DB.all('grease_validations');
    return {requests:__requests,queue:await DB.getEvidenceOperations(),rows,active:findActiveValidations('r1',rows)};
  });
  expect(result.rows).toHaveLength(2);expect(result.rows.every(v=>v.signatureLocal.startsWith('data:image/png'))).toBe(true);
  expect(result.requests[0].url).toContain('/rpc/resolve_grease_validation_conflict');expect(result.queue[0].status).toBe('BLOCKED');
  expect(result.active).toHaveLength(2);expect(result.rows[0]._validationResolutionConflict).toBe(true);
});

test('QR denies absent crew/ambiguous scope/outside assignments; global roles remain legitimate',async({page})=>{
  await boot(page);
  const result=await page.evaluate(()=>{
    const equipo={id:'e1',locationId:'loc1'}, assignment={equipmentId:'e1',assignedCrewId:'c1',status:'PENDING'};
    return [null,{kind:'NO_CREW_ASSIGNED'},{kind:'CREW_SCOPED',crewId:'c1',crewLocationId:'other'},
      {kind:'GLOBAL',role:'VISOR'},{kind:'GLOBAL',role:'ADMINISTRADOR'},{kind:'GLOBAL',role:'PLANIFICADOR'},
      {kind:'CREW_SCOPED',crewId:'c1',crewLocationId:'loc1'}].map(scope=>canLubricadorExecuteEquipment({scope,equipo,assignments:[assignment]}));
  });
  expect(result).toEqual([false,false,false,false,true,true,true]);
});

test('signature modal execution version is preserved across ACK and a later unrelated edit',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    const record={...__record,id:'r2',_pushedVersion:undefined};
    await queueLubricationExecution({action:'CREATE',actorId:'u1',record,equipmentBefore:__equipment});
    const displayed=await DB.get('lubrication_records','r2');
    await Sync.pushAll();
    const canonical=await DB.get('lubrication_records','r2');
    await DB.put('lubrication_records',{...canonical,qty:2,updatedAt:'2026-10-12T12:05:00Z',_pushedVersion:'2026-10-12T12:05:00Z'});
    await queueGreaseValidation({...__signature(),lubricationRecordId:'r2'},displayed);
    return (await DB.getEvidenceOperations())[0];
  });
  expect(result.params.p_expected).toBe('2026-10-12T12:01:00Z');expect(result.recordDependency).toBeNull();
});

test('lost signature upload ACK accepts only identical existing bytes',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    const signature=__signature();const originalFetch=fetch;
    const bytes=await dataURLtoBlob(signature.signatureLocal).arrayBuffer();
    window.fetch=async(url,options)=>{
      if(String(url).includes('/storage/')){
        __requests.push({url,method:options.method});
        return options.method==='POST'?{ok:false,status:409}:{ok:true,status:200,arrayBuffer:async()=>bytes};
      }
      return originalFetch(url,options);
    };
    await queueGreaseValidation(signature,__record);await Sync.pushAll();
    return {requests:__requests,queue:await DB.getEvidenceOperations()};
  });
  expect(result.requests).toHaveLength(3);expect(result.requests[1].url).toContain('/object/authenticated/');expect(result.queue).toHaveLength(0);
});

test('different signature binary collision remains blocked without replacing object or dispatching capture',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    const signature=__signature();
    window.fetch=async(url,options)=>{
      __requests.push({url,method:options.method});
      return options.method==='POST'?{ok:false,status:409}:{ok:true,status:200,arrayBuffer:async()=>new Uint8Array([0]).buffer};
    };
    await queueGreaseValidation(signature,__record);await Sync.pushAll();
    return {requests:__requests,queue:await DB.getEvidenceOperations(),row:await DB.get('grease_validations','v1')};
  });
  expect(result.requests).toHaveLength(2);expect(result.queue[0].status).toBe('BLOCKED');expect(result.queue[0].code).toBe('SIGNATURE_BINARY_CONFLICT');expect(result.row.signatureLocal).toContain('data:image/png');
});

test('CAS rejected resolution restores canonical anchor while retaining the attempted audit in its blocked intent',async({page})=>{
  await boot(page);
  const result=await page.evaluate(async()=>{
    App.currentUser={id:'u1',role:'ADMINISTRADOR',name:'Admin'};
    for(const id of ['v1','v2'])await DB.put('grease_validations',{...__signature(),id,_pushedVersion:__version});
    const original=await DB.get('grease_validations','v1');
    await DB.resolveValidationConflict('r1',[{id:'v1',updatedAt:__version},{id:'v2',updatedAt:__version}],'v2','Attempted review',App.currentUser);
    __failure={http:200,body:{status:'CONFLICT',code:'SIGNATURES_VERSION_CONFLICT',rows:[{
      store:'grease_validations',id:'v1',payload:original,updated_at:'2026-10-12T12:10:00Z',
    }]}};
    await Sync.pushAll();
    return {anchor:await DB.get('grease_validations','v1'),queue:await DB.getEvidenceOperations()};
  });
  expect(result.anchor.conflictResolution).toBeUndefined();expect(result.anchor._evidenceOperationId).toBeUndefined();
  expect(result.anchor.updatedAt).toBe('2026-10-12T12:10:00Z');expect(result.anchor.signatureLocal).toContain('data:image/png');
  expect(result.queue[0].attemptedResolution.reason).toBe('Attempted review');expect(result.queue[0].status).toBe('BLOCKED');
});
