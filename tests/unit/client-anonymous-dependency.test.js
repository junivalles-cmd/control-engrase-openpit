import { describe,it,expect,vi,afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadSyncLogic,loadDbSeedLogic,APP_JS_PATH } from '../helpers/loadLubricationLogic.js';
import { extractDeclaration } from '../helpers/extractFromSource.js';

function fixtureDB() {
  const rows=new Map();
  // Account-scoped bootstrap: el cursor vive por cuenta/fingerprint
  // (activeAccountSyncKey + accountSyncStates), no en cfg.lastPull.
  let config={ url:'https://fixture.test',anonKey:'public-key',lastPull:'2026-10-01',
    activeAccountSyncKey:'auth-u1:fp1',
    accountSyncStates:{ 'auth-u1:fp1':{ authUserId:'auth-u1',authorizationFingerprint:'fp1',bootstrapComplete:true,lastPull:'2026-10-01' } } };
  return {
    getConfig:async()=>config,
    setConfig:async value=>{ config=value; },
    all:async store=>[...rows.values()].filter(r=>r.store===store).map(r=>r.value),
    get:async(store,id)=>rows.get(store+id)?.value,
    put:async(store,value)=>{ rows.set(store+value.id,{store,value}); },
    delete:vi.fn(),recordConflicts:vi.fn(),
  };
}
const activeAuth={ isSupabaseMode:()=>true,isAuthenticated:()=>true,getSession:()=>({accessToken:'user-jwt'}),
  getProfile:()=>({authUserId:'auth-u1',appUserId:'u1',role:'ADMINISTRADOR',authorizationFingerprint:'fp1',
    rowScopeEnforced:true,scopeType:'GLOBAL',authorizedCrewIds:[],authorizedLocationIds:[]}),
  refreshAuthorizationContext:async()=>({ok:true,changed:false,firstSnapshot:false,context:{rowScopeEnforced:true}}) };
afterEach(()=>vi.unstubAllGlobals());

describe('Client pre-cutover boundary',()=>{
  it('an unauthorized push stops the cycle before any subsequent pull',async()=>{
    const db=fixtureDB();await db.put('equipment',{id:'e',active:true,updatedAt:'new'});
    vi.stubGlobal('navigator',{onLine:true});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status:401,json:async()=>({})})));
    const {Sync}=loadSyncLogic(db,['equipment'],{...activeAuth,restoreSession:async()=>{}});
    await Sync.fullSync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect((await db.get('equipment','e'))._pushedVersion).toBeUndefined();
  });
  it.each([true,false])('entering the app waits for authenticated first pull when online=%s',async online=>{
    const app={};const order=[];
    let release;
    const pending=new Promise(resolve=>{release=resolve;});
    const source=readFileSync(APP_JS_PATH,'utf8');
    const body=extractDeclaration(source,'currentUserFromAuthProfile')+'\n'+extractDeclaration(source,'replayPendingDeeplink')+'\n'+extractDeclaration(source,'enterAppAsProfile');
    // BUG-AUTH-001 (bootstrap vs. ciclo periódico en vuelo): enterAppAsProfile()
    // reintenta hasta 2 veces si Sync.getAccountSyncState() sigue reportando
    // bootstrapComplete=false después de un fullSync() real — este mock
    // confirma el bootstrap tras ESE primer pull real (como en producción,
    // donde el propio fullSync() exitoso lo completa), para seguir probando
    // exactamente el camino de "un solo pull real, sin colisión".
    let bootstrapComplete=false;
    const enter=new Function('App','DB','Sync','Auth','navigator','bindOneSignalIdentity','boot','abrirDesdeNotificacion',body+';return enterAppAsProfile;')(
      app,{getConfig:async()=>({})},
      // El bootstrap pendiente es por cuenta/fingerprint (Sync.getAccountSyncState()),
      // ya no el cursor legacy del dispositivo.
      {getAccountSyncState:async()=>({bootstrapComplete,key:'auth-u1:fp1'}),fullSync:async()=>{order.push('pull');await pending;bootstrapComplete=true;}},
      activeAuth,{onLine:online},()=>{},()=>order.push('boot'),()=>{});
    const entering=enter({appUserId:'u',displayName:'Fixture',role:'LUBRICADOR'});
    if(online){await vi.waitFor(()=>expect(order).toEqual(['pull']));release();}
    await entering;
    expect(order).toEqual(online?['pull','boot']:['boot']);
  });

  it.each([401,403])('first pull HTTP %s leaves remote state undetermined',async status=>{
    const db=fixtureDB();await db.setConfig({url:'https://fixture.test',anonKey:'public-key'});
    vi.stubGlobal('navigator',{onLine:true});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status,json:async()=>({message:'rejected'})})));
    const {Sync}=loadSyncLogic(db,['equipment'],{...activeAuth,restoreSession:async()=>{}});
    await Sync.fullSync();
    expect((await db.getConfig()).lastPull).toBeUndefined();
    expect(await db.all('equipment')).toEqual([]);expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([401,403,200,'network'])('bootstrap never interprets response %s as an empty remote installation',async status=>{
    const db=fixtureDB();
    vi.stubGlobal('fetch',vi.fn(async()=>{ if(status==='network')throw new TypeError('offline');return {ok:status===200,status,json:async()=>[]}; }));
    vi.stubGlobal('localStorage',{getItem:()=>null,setItem:vi.fn()});
    const {seedSoloSiElSistemaEstaVacio}=loadDbSeedLogic(db,activeAuth);
    expect(await seedSoloSiElSistemaEstaVacio()).toEqual({remoteState:'NOT_CHECKED'});
    expect(fetch).not.toHaveBeenCalled();
    for(const store of ['users','equipment','cuadrillas','settings','locations'])expect(await db.all(store)).toEqual([]);
  });

  it('physical purge is blocked without remote or local deletion',async()=>{
    const db=fixtureDB();
    await db.put('equipment',{id:'e',active:false});
    vi.stubGlobal('fetch',vi.fn());
    const source=extractDeclaration(readFileSync(APP_JS_PATH,'utf8'),'borrarDefinitivo');
    const purge=new Function('DB',source+'; return borrarDefinitivo;')(db);
    await expect(purge('equipment','e')).rejects.toThrow('HARD_DELETE_REQUIRES_DESIGN_DECISION');
    expect(db.delete).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();
    expect(await db.get('equipment','e')).toEqual({id:'e',active:false});
  });

  it.each([403,500])('failed soft delete HTTP %s keeps the local tombstone queued',async status=>{
    const db=fixtureDB();
    const row={id:'e',active:false,updatedAt:'new',_pushedVersion:'old'};
    await db.put('equipment',row);
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:false,status,json:async()=>({message:'denied'})})));
    const {Sync}=loadSyncLogic(db,['equipment'],activeAuth);
    expect((await Sync.pushAll()).ok).toBe(false);
    const [,opts]=fetch.mock.calls[0];
    expect(opts.method).toBe('PATCH');expect(opts.headers.Authorization).toBe('Bearer user-jwt');
    expect(JSON.parse(opts.body).deleted).toBe(true);
    expect((await db.get('equipment','e'))._pushedVersion).toBe('old');
    expect(db.delete).not.toHaveBeenCalled();
  });

  it('successful soft delete uses CAS and public apikey with user JWT',async()=>{
    const db=fixtureDB();
    await db.put('equipment',{id:'e',active:false,updatedAt:'new',_pushedVersion:'old'});
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,json:async()=>[{id:'e'}]})));
    const {Sync}=loadSyncLogic(db,['equipment'],activeAuth);
    expect((await Sync.pushAll()).pushed).toBe(1);
    const [url,opts]=fetch.mock.calls[0];
    expect(url).toContain('updated_at=eq.old');expect(opts.method).toBe('PATCH');
    expect(opts.headers.apikey).toBe('public-key');expect(opts.headers.Authorization).toBe('Bearer user-jwt');
    expect((await db.get('equipment','e'))._pushedVersion).toBe('new');
  });

  it('local unlock/profile without a JWT cannot synchronize',async()=>{
    const db=fixtureDB();await db.put('equipment',{id:'e',active:true,updatedAt:'new'});
    vi.stubGlobal('fetch',vi.fn());
    const {Sync}=loadSyncLogic(db,['equipment'],{...activeAuth,isAuthenticated:()=>false,getSession:()=>null});
    expect((await Sync.pushAll()).reason).toBe('AUTH_REQUIRED');expect(fetch).not.toHaveBeenCalled();
  });

  it('authenticated first pull uses JWT, hydrates only server rows and never seeds catalogs',async()=>{
    const db=fixtureDB();await db.setConfig({url:'https://fixture.test',anonKey:'public-key'});
    // El bootstrap de ESTA cuenta solo se confirma con filas autorizadas
    // persistidas (un 200 vacío no lo completa, ver sync.js pullAll()).
    vi.stubGlobal('fetch',vi.fn(async()=>({ok:true,status:200,
      json:async()=>[{store:'locations',id:'locA',payload:{id:'locA',name:'A',active:true},updated_at:'2026-10-02T00:00:00.000Z',deleted:false}]})));
    const {Sync}=loadSyncLogic(db,['equipment','locations'],{...activeAuth,restoreSession:async()=>{}});
    vi.stubGlobal('navigator',{onLine:true});
    await Sync.fullSync();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][1].headers.Authorization).toBe('Bearer user-jwt');
    const cfg=await db.getConfig();
    expect(cfg.activeAccountSyncKey).toBe('auth-u1:fp1');
    expect(cfg.accountSyncStates['auth-u1:fp1']).toMatchObject({bootstrapComplete:true,lastPull:'2026-10-02T00:00:00.000Z'});
    expect(await db.all('equipment')).toEqual([]);
  });
});
