import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadSyncLogic, DB_JS_PATH, APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { extractDeclaration, readSource } from '../helpers/extractFromSource.js';

const source=readSource(DB_JS_PATH);
function loadQueue(db) {
  return new Function('DB','Auth', ['uid','nowISO','queueLubricationExecution'].map(n=>extractDeclaration(source,n)).join('\n')+';return queueLubricationExecution;')(db,auth);
}
const auth={isSupabaseMode:()=>true,isAuthenticated:()=>true,getSession:()=>({accessToken:'user-jwt'}),getProfile:()=>({appUserId:'u1',authorizationFingerprint:'fp1'}),getSessionEpoch:()=>1};
function fixture() {
  const rows={};const operations=[];
  const db={getConfig:async()=>({url:'https://fixture.test',anonKey:'public-key'}),all:async s=>Object.values(rows[s]||{}),
    get:async(s,id)=>rows[s]?.[id]||null,
    put:async(s,r)=>{(rows[s]||={})[r.id]=structuredClone(r);},recordConflicts:vi.fn(),
    getExecutionOperations:async()=>structuredClone(operations),
    updateExecutionOperation:async op=>{operations[operations.findIndex(r=>r.id===op.id)]=structuredClone(op);},
    putExecutionOperation:async(op,changes)=>{operations.push(structuredClone(op));for(const c of changes)await db.put(c.store,{...c.row,_executionOperationId:op.id});},
    finishExecutionOperation:vi.fn(async op=>{operations.splice(operations.findIndex(r=>r.id===op.id),1);for(const s of Object.values(rows))for(const r of Object.values(s)){
      delete r._executionOperationId;r._pushedVersion=r.updatedAt;
    }}),
  };
  const queue=loadQueue(db);
  const record={id:'r1',date:'2026-10-12T12:00:00Z',updatedAt:'local',equipmentId:'e1',planId:'p1',shiftId:'shift_dia',
    userId:'u1',greaseType:'lub1',hourmeter:110,qty:1,details:[],photos:[],operationalSnapshot:{crewId:'c1',executionType:'PLANNED'}};
  const equipment={id:'e1',updatedAt:'old',_pushedVersion:'old',hourmeter:100,locationId:'loc1'};
  const plan={id:'p1',updatedAt:'old',_pushedVersion:'old',lastGreaseHour:100,frequency:10};
  const create=async(extra={})=>queue({action:'CREATE',record,equipmentBefore:equipment,planBefore:plan,
    equipmentAfter:{...equipment,hourmeter:110,updatedAt:'local'},planAfter:{...plan,lastGreaseHour:110,updatedAt:'local'},actorId:'u1',...extra});
  const {Sync}=loadSyncLogic(db,['equipment','lubrication_plans','lubrication_records','lubrication_assignments','grease_validations'],auth);
  return {db,queue,record,equipment,plan,create,Sync,operations,rows};
}
afterEach(()=>vi.unstubAllGlobals());
const response=(status,body)=>({ok:status>=200&&status<300,status,json:async()=>body});
const applied=f=>({status:'APPLIED',rows:Object.entries(f.rows).flatMap(([store,rows])=>Object.values(rows).map(row=>({store,id:row.id,payload:row,updated_at:'2026-10-12T12:00:00Z'})))});

describe('Restricted lubrication transport',()=>{
  it('cache version equivalence keeps UTC precision through microseconds',()=>{
    const same=new Function(extractDeclaration(source,'sameExecutionVersion')+';return sameExecutionVersion;')();
    expect(same('2026-10-12T12:00:00.000Z','2026-10-12T12:00:00+00:00')).toBe(true);
    expect(same('2026-10-12T12:00:00.000001Z','2026-10-12T12:00:00.000002+00:00')).toBe(false);
  });
  it.each(['CREATE','EDIT'])('%s uses only typed RPC, never catalog PATCH',async action=>{
    const f=fixture();await f.create({action,recordBefore:{...f.record,_pushedVersion:f.record.updatedAt}});
    vi.stubGlobal('fetch',vi.fn(async()=>response(200,applied(f))));
    expect((await f.Sync.pushAll()).ok).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url,options]=fetch.mock.calls[0];expect(url).toContain('/rpc/lubrication_execution');expect(options.method).toBe('POST');
    const body=JSON.parse(options.body);expect(body.p_action).toBe(action);expect(body).not.toHaveProperty('payload');
    expect(body).not.toHaveProperty('store');expect(body).not.toHaveProperty('locationId');expect(body).not.toHaveProperty('frequency');
    expect(options.headers.Authorization).toBe('Bearer user-jwt');
  });
  it('assignment completion stays in the same RPC intent',async()=>{
    const f=fixture();f.record.operationalSnapshot={...f.record.operationalSnapshot,assignmentId:'a1',executionType:'ASSIGNED'};
    await f.create({assignmentBefore:{id:'a1',_pushedVersion:'old'},assignmentAfter:{id:'a1',status:'COMPLETED',updatedAt:'local'}});
    vi.stubGlobal('fetch',vi.fn(async()=>response(503,{})));await f.Sync.pushAll();
    expect(fetch).toHaveBeenCalledTimes(1);expect(JSON.parse(fetch.mock.calls[0][1].body).p_assignment_id).toBe('a1');
    expect(f.rows.lubrication_assignments.a1._executionOperationId).toBe('r1');
  });
  it.each([404,500,503])('HTTP %s preserves queue with no fallback; retry uses identical body',async status=>{
    const f=fixture();await f.create();vi.stubGlobal('fetch',vi.fn(async()=>response(status,{})));
    expect((await f.Sync.pushAll()).ok).toBe(false);const first=fetch.mock.calls[0][1].body;
    expect(f.operations).toHaveLength(1);expect(f.operations[0].status).toBe('RETRYABLE');
    fetch.mockResolvedValue(response(200,applied(f)));await f.Sync.pushAll();
    expect(fetch.mock.calls[1][1].body).toBe(first);expect(f.operations).toHaveLength(0);
  });
  it('offline network failure preserves frozen request for reconnection',async()=>{
    const f=fixture();await f.create();vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('Offline');}));
    await f.Sync.pushAll();expect(f.operations).toHaveLength(1);expect(f.operations[0].frozen).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);expect(f.db.finishExecutionOperation).not.toHaveBeenCalled();
  });
  it('malformed canonical response cannot consume the queue',async()=>{
    const f=fixture();await f.create();vi.stubGlobal('fetch',vi.fn(async()=>response(200,{status:'APPLIED',rows:[]})));
    await f.Sync.pushAll();expect(f.operations).toHaveLength(1);expect(f.operations[0].code).toBe('GATEWAY_INVALID_RESPONSE');
    expect(f.db.finishExecutionOperation).not.toHaveBeenCalled();
  });
  it.each(['SIGNED_RECORD_LOCKED','VERSION_CONFLICT','SCOPE_DENIED'])('%s blocks intent without transient retries',async code=>{
    const f=fixture();await f.create();vi.stubGlobal('fetch',vi.fn(async()=>response(200,{status:'DENIED',code})));
    vi.stubGlobal('showInAppToast',vi.fn());await f.Sync.pushAll();await f.Sync.pushAll();
    expect(fetch).toHaveBeenCalledTimes(1);expect(f.operations[0]).toMatchObject({status:'BLOCKED',code});
    expect(f.db.finishExecutionOperation).not.toHaveBeenCalled();
    if(code==='SIGNED_RECORD_LOCKED')expect(showInAppToast).toHaveBeenCalledWith('Este engrase tiene firmas asociadas y no puede editarse directamente.');
  });
  it('logout during dispatch never acknowledges or falls back',async()=>{
    const f=fixture();await f.create();let epoch=1;auth.getSessionEpoch=()=>epoch;
    vi.stubGlobal('fetch',vi.fn(async()=>{epoch++;return response(200,{status:'APPLIED',rows:[]});}));
    expect((await f.Sync.pushAll()).reason).toBe('AUTH_REQUIRED');expect(f.operations).toHaveLength(1);expect(f.db.finishExecutionOperation).not.toHaveBeenCalled();
    auth.getSessionEpoch=()=>1;
  });
  it('Quick Unlock without remote auth never authorizes RPC',async()=>{
    const f=fixture();await f.create();const {Sync}=loadSyncLogic(f.db,['equipment'],{...auth,isAuthenticated:()=>false});
    vi.stubGlobal('fetch',vi.fn());expect((await Sync.pushAll()).reason).toBe('AUTH_REQUIRED');expect(fetch).not.toHaveBeenCalled();
  });
  it('a different account cannot replay the offline intent',async()=>{
    const f=fixture();await f.create();const {Sync}=loadSyncLogic(f.db,['equipment'],{...auth,getProfile:()=>({appUserId:'someone-else'})});
    vi.stubGlobal('fetch',vi.fn());await Sync.pushAll();expect(fetch).not.toHaveBeenCalled();expect(f.operations).toHaveLength(1);
  });
  it('evidence upload failure never sends base64 to SQL',async()=>{
    const f=fixture();f.record.photos=['data:image/png;base64,AA=='];await f.create();vi.stubGlobal('fetch',vi.fn(async()=>response(503,{})));
    await f.Sync.pushAll();expect(fetch.mock.calls.every(([url])=>url.includes('/storage/'))).toBe(true);expect(f.operations[0].frozen).toBeUndefined();
  });
  it('edit evidence uses its operation ID and cannot overwrite original record objects',async()=>{
    const f=fixture();f.record.photos=['data:image/png;base64,AA=='];
    const op=await f.create({action:'EDIT',recordBefore:{...f.record,_pushedVersion:f.record.updatedAt}});
    vi.stubGlobal('fetch',vi.fn(async url=>url.includes('/storage/')?response(200,{}):response(200,{status:'DENIED',code:'SIGNED_RECORD_LOCKED'})));
    await f.Sync.pushAll();expect(fetch.mock.calls[0][0]).toContain('/'+op.id+'_0.jpg');
    expect(fetch.mock.calls[0][0]).not.toContain('/r1_0.jpg');expect(f.operations[0].code).toBe('SIGNED_RECORD_LOCKED');
  });
  it('signature transport waits for its record gateway acknowledgment',async()=>{
    const f=fixture();await f.create();await f.db.put('grease_validations',{id:'v1',lubricationRecordId:'r1',updatedAt:'local'});
    vi.stubGlobal('fetch',vi.fn(async()=>response(503,{})));await f.Sync.pushAll();expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('queued dependency uses prior operation identity, not a guessed future version',async()=>{
    const f=fixture();await f.create();const before=await f.db.get('equipment','e1');
    const record2={...f.record,id:'r2'};await f.queue({action:'CREATE',record:record2,equipmentBefore:before,actorId:'u1'});
    expect(f.operations[1].dependencies.p_expected_equipment).toEqual({operationId:'r1',store:'equipment',id:'e1'});
  });
  it('pending unrelated master changes cannot be absorbed/lost in the execution',async()=>{
    const f=fixture();await expect(f.create({equipmentBefore:{...f.equipment,model:'Changed',updatedAt:'pending-master'}})).rejects.toThrow('CATALOG_SYNC_REQUIRED');
    expect(f.operations).toHaveLength(0);expect(f.rows).toEqual({});
  });
  it('both real form handlers persist execution intents, not generic derived writes',()=>{
    const app=readSource(APP_JS_PATH);
    for(const name of ['startGreaseFlow','openEditGreaseRecordForm']) {
      const body=extractDeclaration(app,name);expect(body).toContain('queueLubricationExecution(');
      for(const store of ['equipment','lubrication_plans','lubrication_records'])expect(body).not.toContain(`DB.put('${store}'`);
    }
  });
});
