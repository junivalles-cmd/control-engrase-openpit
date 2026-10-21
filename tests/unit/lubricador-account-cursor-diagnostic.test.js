// Local fixtures only; no production network or browser storage access.
import { describe,it,expect,vi,afterEach } from 'vitest';
import {loadSyncLogic,loadDbLogic,loadOperationalScopeLogic} from '../helpers/loadLubricationLogic.js';
import {DB_JS_PATH} from '../helpers/loadLubricationLogic.js';
import {readSource,extractDeclaration} from '../helpers/extractFromSource.js';
const {localAuthorizationState}=loadDbLogic();
const {resolveOperationalScope}=loadOperationalScopeLogic();
const OLD='2026-03-01T00:00:00.000Z',CURSOR='2026-03-02T00:00:00.000Z',EPOCH='1970-01-01T00:00:00.000Z';
const lub={authUserId:'fixture-auth-lub',appUserId:'fixture-lub',role:'LUBRICADOR',active:true,scopeType:'CREW_SCOPED',authorizedCrewIds:['c1','c2','c3'],authorizedLocationIds:['l1','l2','l3'],authorizationFingerprint:'fp-lub',rowScopeEnforced:true};
const admin={...lub,authUserId:'fixture-auth-admin',appUserId:'fixture-admin',role:'ADMINISTRADOR',scopeType:'GLOBAL',authorizationFingerprint:'fp-admin'};
const catalog=[...lub.authorizedCrewIds.map((id,i)=>({store:'cuadrillas',id,updated_at:OLD,deleted:false,payload:{id,active:true,memberUserIds:[lub.appUserId],locationId:lub.authorizedLocationIds[i],updatedAt:OLD}})),...lub.authorizedLocationIds.map(id=>({store:'locations',id,updated_at:OLD,deleted:false,payload:{id,active:true,updatedAt:OLD}}))];
function fixture({owner='fixture-admin',current=lub,lastPull=CURSOR}={}){
 let profile={...current},cfg={url:'https://fixture.invalid',anonKey:'fixture-public-key',lastPull};
 let source=structuredClone(catalog);
 const rows=new Map(owner?catalog.map(r=>[r.store+':'+r.id,{...r.payload,_pushedVersion:OLD,__authorizationAppUserId:owner}]):[]);
 const db={getConfig:async()=>cfg,setConfig:async v=>{cfg=v;},
  all:async s=>[...rows].filter(([k])=>k.startsWith(s+':')).map(([,r])=>r).filter(r=>localAuthorizationState(s,r,profile,profile.appUserId)!=='OUT_OF_SCOPE'),
  getRaw:async(s,id)=>rows.get(s+':'+id)||null,
  put:async(s,r)=>{rows.set(s+':'+r.id,r);},recordConflicts:async()=>{}};
 const auth={isSupabaseMode:()=>true,isAuthenticated:()=>true,getSession:()=>({accessToken:'fixture-only'}),getProfile:()=>profile,restoreSession:async()=>{},getSessionEpoch:()=>1,refreshAuthorizationContext:async()=>({ok:true,changed:false,firstSnapshot:false,context:profile})};
 const {Sync}=loadSyncLogic(db,['cuadrillas','locations','equipment'],auth);
 // These are pre-0014 catalog/bootstrap fixtures; point-grant transport has
 // its own production-source integration coverage in support-other-location.
 vi.spyOn(Sync,'fetchSupportManifest').mockImplementation(async(cfg,account)=>({status:'AUTHORIZED',authUserId:account.authUserId,appUserId:account.context.appUserId,operational:[],rows:[],revision:'pre-0014'}));
 const order=[];
 const upload=vi.spyOn(Sync,'pushAll').mockImplementation(async()=>{order.push('push');return {pushed:0,errors:[]};});
 vi.stubGlobal('navigator',{onLine:true});
 const fetch=vi.fn(async url=>{order.push('pull');const since=new URL(url).searchParams.get('updated_at').slice(3);return {ok:true,status:200,json:async()=>structuredClone(source.filter(r=>r.updated_at>since))};});
 vi.stubGlobal('fetch',fetch);
 const states=[];Sync.onChange(s=>states.push(s));
 return {db,rows,Sync,fetch,states,order,upload,switchTo:p=>{profile={...p};},source:r=>{source=r;}};
}
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals();});
describe('account and fingerprint bootstrap',()=>{
 it('A-C/K/M: ignores legacy cursor, hydrates three crews and locations and selects multiple crews before upload',async()=>{
  const f=fixture();await f.Sync.fullSync();
  expect(new URL(f.fetch.mock.calls[0][0]).searchParams.get('updated_at')).toBe('gt.'+EPOCH);
  expect((await f.db.getConfig()).lastPull).toBe(CURSOR);
  expect(f.order).toEqual(['pull','push']);expect(f.states.at(-1).status).toBe('ok');
  expect(await f.db.all('locations')).toHaveLength(3);
  expect(resolveOperationalScope({currentUser:{id:lub.appUserId,role:lub.role},cuadrillas:await f.db.all('cuadrillas'),shiftId:'shift_dia'}).kind).toBe('NEEDS_CREW_SELECTION');
  const empty=fixture({owner:null,lastPull:null});await empty.Sync.fullSync();expect((await empty.Sync.getAccountSyncState()).bootstrapComplete).toBe(true);
 });
 it('D: second sync uses own incremental cursor and an empty incremental is valid',async()=>{
  const f=fixture();await f.Sync.fullSync();f.fetch.mockClear();f.order.length=0;await f.Sync.fullSync();
  expect(new URL(f.fetch.mock.calls[0][0]).searchParams.get('updated_at')).toBe('gt.'+OLD);
  expect(f.order).toEqual(['push','pull']);expect(f.states.at(-1)).toMatchObject({status:'ok',pulled:0});
 });
 it('E: a new fingerprint reboots before upload and keeps old state and pending work',async()=>{
  const f=fixture();await f.Sync.fullSync();f.rows.set('equipment:pending',{id:'pending',locationId:'l1',updatedAt:CURSOR,_pushedVersion:OLD,__authorizationAppUserId:lub.appUserId,photos:['fixture-photo']});
  f.switchTo({...lub,authorizationFingerprint:'fp-new'});f.fetch.mockClear();f.order.length=0;await f.Sync.fullSync();
  expect(new URL(f.fetch.mock.calls[0][0]).searchParams.get('updated_at')).toBe('gt.'+EPOCH);
  expect(f.order).toEqual(['pull','push']);expect(Object.keys((await f.db.getConfig()).accountSyncStates)).toHaveLength(2);
  expect(f.rows.get('equipment:pending').photos).toEqual(['fixture-photo']);
 });
 it('F-H: foreign pending data stays isolated; own dirty versions remain intact',async()=>{
  const f=fixture();const foreign={id:'foreign',locationId:'l1',updatedAt:CURSOR,_pushedVersion:OLD,__authorizationAppUserId:admin.appUserId,photos:['private-fixture']};f.rows.set('equipment:foreign',foreign);
  f.rows.set('cuadrillas:c1',{...catalog[0].payload,updatedAt:CURSOR,_pushedVersion:OLD,__authorizationAppUserId:lub.appUserId});
  await f.Sync.fullSync();expect(f.rows.get('equipment:foreign')).toEqual(foreign);expect(await f.db.all('equipment')).toEqual([]);
  expect(f.rows.get('cuadrillas:c1').updatedAt).toBe(CURSOR);expect(f.states.at(-1).status).toBe('ok');
 });
 it('I: zero rows never completes an unhydrated account or uploads work',async()=>{
  const f=fixture({owner:null});f.source([]);await f.Sync.fullSync();
  expect((await f.Sync.getAccountSyncState()).bootstrapComplete).toBe(false);expect(f.upload).not.toHaveBeenCalled();expect(f.states.at(-1).status).toBe('AUTHORIZATION_BOOTSTRAP_INCOMPLETE');
 });
 it('foreign dirty catalog collisions preserve data and block bootstrap instead of falsely declaring no crew',async()=>{
  const f=fixture();f.rows.get('cuadrillas:c1').updatedAt=CURSOR;await f.Sync.fullSync();
  expect(f.rows.get('cuadrillas:c1').__authorizationAppUserId).toBe(admin.appUserId);expect((await f.Sync.getAccountSyncState()).bootstrapComplete).toBe(false);expect(f.upload).not.toHaveBeenCalled();
 });
 it('J: a genuinely empty membership after a nonempty valid bootstrap resolves NO_CREW_ASSIGNED',async()=>{
  const f=fixture({owner:null,current:{...lub,authorizedCrewIds:[],authorizedLocationIds:[]}});f.source(catalog.filter(r=>r.store==='locations'));await f.Sync.fullSync();
  expect((await f.Sync.getAccountSyncState()).bootstrapComplete).toBe(true);expect(resolveOperationalScope({currentUser:{id:lub.appUserId,role:lub.role},cuadrillas:await f.db.all('cuadrillas')}).kind).toBe('NO_CREW_ASSIGNED');
 });
 it('switches Admin -> Lub -> Admin -> Lub with rehydration on account changes and incremental afterward',async()=>{
  const f=fixture({current:admin});for(const p of [admin,lub,admin,lub]){f.switchTo(p);f.fetch.mockClear();await f.Sync.fullSync();expect(new URL(f.fetch.mock.calls[0][0]).searchParams.get('updated_at')).toBe('gt.'+EPOCH);expect((await f.Sync.getAccountSyncState()).bootstrapComplete).toBe(true);}
  expect(Object.keys((await f.db.getConfig()).accountSyncStates)).toHaveLength(2);f.fetch.mockClear();await f.Sync.fullSync();expect(new URL(f.fetch.mock.calls[0][0]).searchParams.get('updated_at')).toBe('gt.'+OLD);
 });
 it('L: offline retains completed state and readable same-account catalog',async()=>{
  const f=fixture();await f.Sync.fullSync();vi.stubGlobal('navigator',{onLine:false});f.fetch.mockClear();await f.Sync.fullSync();expect(f.fetch).not.toHaveBeenCalled();expect((await f.Sync.getAccountSyncState()).bootstrapComplete).toBe(true);expect(await f.db.all('cuadrillas')).toHaveLength(3);
 });
 it('write failure does not advance scoped cursor or mark bootstrap complete',async()=>{
  const f=fixture({owner:null});vi.spyOn(console,'warn').mockImplementation(()=>{});vi.spyOn(console,'error').mockImplementation(()=>{});f.db.put=async()=>{throw new Error('fixture-write-failure');};await f.Sync.fullSync();expect((await f.db.getConfig()).accountSyncStates).toBeUndefined();expect(f.upload).not.toHaveBeenCalled();
 });
 it('a failed account-switch pull invalidates prior cache readiness without erasing its cursor',async()=>{
  const f=fixture({current:admin});await f.Sync.fullSync();const oldState=await f.Sync.getAccountSyncState();
  f.switchTo(lub);const put=f.db.put;let written=0;f.db.put=async(s,r)=>{if(++written===2) throw new Error('fixture-partial-write');await put(s,r);};
  vi.spyOn(console,'error').mockImplementation(()=>{});await f.Sync.fullSync();f.switchTo(admin);
  const state=await f.Sync.getAccountSyncState();expect(state.bootstrapComplete).toBe(false);expect(state.lastPull).toBe(oldState.lastPull);
 });
 it('H: real execution dispatcher never submits the previous account intent or changes its photos',async()=>{
  const f=fixture();const intent={id:'foreign-intent',actorId:admin.appUserId,authorizationFingerprint:admin.authorizationFingerprint,localPhotos:['private-fixture'],dependencies:{},status:'PENDING'};
  f.db.getExecutionOperations=async()=>[intent];f.fetch.mockClear();
  const result=await f.Sync.pushExecutionOperations(await f.db.getConfig());expect(result.errors).toContain('EXECUTION_ACCOUNT_MISMATCH');expect(f.fetch).not.toHaveBeenCalled();expect(intent.localPhotos).toEqual(['private-fixture']);
 });
 it('relational plan/point fallback cannot expose pending rows of another account',async()=>{
  const db=new Function('localAuthorizationState',extractDeclaration(readSource(DB_JS_PATH),'DB')+';return DB;')(localAuthorizationState);
  db.getRaw=async()=>({id:'equipment',locationId:'l1'});
  for(const store of ['lubrication_plans','lubrication_points']) {
   expect(await db.authorizationStateForRow(store,{id:'foreign',equipmentId:'equipment',__authorizationAppUserId:admin.appUserId},lub,lub.appUserId)).toBe('OUT_OF_SCOPE');
  }
 });
 it('pending intent markers prevent overwrite even when version matches the last pushed version',async()=>{
  const f=fixture();const row=f.rows.get('cuadrillas:c1');row._evidenceOperationId='pending-fixture-intent';row.photos=['pending-fixture-photo'];
  await f.Sync.fullSync();expect(row.photos).toEqual(['pending-fixture-photo']);expect(f.rows.get('cuadrillas:c1')._evidenceOperationId).toBe('pending-fixture-intent');expect((await f.Sync.getAccountSyncState()).bootstrapComplete).toBe(false);
 });

 // ROOT CAUSE #2 (cierre, 2026-10-20): un refresh forzado de la MISMA cuenta
 // (ej. la ventana 07:00/19:00 de runFullRefreshIfDue(), que SOLO corre
 // sobre una cuenta ya bootstrapeada) que se interrumpe a mitad de camino
 // (app cerrada, red caída, WebView reiniciado) NUNCA debe dejar
 // bootstrapComplete en false para SIEMPRE — la caché local de esta misma
 // cuenta ya era válida ANTES de este intento, y el intento interrumpido no
 // mezcló datos de otra identidad (nunca hubo cambio de cuenta). Antes del
 // fix, pullAll() neuteaba `activeAccountSyncKey` incondicionalmente en esta
 // rama, así que una interrupción aquí rompía el bootstrap para siempre
 // (el síntoma real reportado: "Sincronizando datos..." con caché válida).
 it('ROOT CAUSE #2 — A: mismo cuenta + refresh forzado interrumpido a mitad de escritura (app matada) recupera bootstrapComplete de inmediato',async()=>{
  const f=fixture();await f.Sync.fullSync();
  const before=await f.Sync.getAccountSyncState();
  expect(before.bootstrapComplete).toBe(true);
  const validLastPull=before.lastPull;

  const originalPut=f.db.put;let writes=0;
  f.db.put=async(s,r)=>{if(++writes===2) throw new Error('fixture-app-killed-mid-write');await originalPut(s,r);};
  vi.spyOn(console,'error').mockImplementation(()=>{});

  // Mismo perfil (NUNCA f.switchTo) — igual que runFullRefreshIfDue(), que
  // solo se llama sobre una cuenta ya bootstrapeada.
  await expect(f.Sync.pullAll({forceFull:true})).rejects.toThrow('fixture-app-killed-mid-write');

  const after=await f.Sync.getAccountSyncState();
  expect(after.bootstrapComplete).toBe(true); // antes del fix: false para siempre
  expect(after.lastPull).toBe(validLastPull); // el cursor tampoco se tocó
 });

 // Hallazgo de la auditoría (§10 "RED CAE DURANTE REHIDRATACIÓN"): TODAS las
 // llamadas de red de pullAll() (fetchSupportManifest/fetchSupportRows, el
 // loop de paginación, y la reconfirmación de permisos) terminan ANTES del
 // null-out de activeAccountSyncKey (ver su comentario, más arriba en
 // sync.js) — una caída de red durante la descarga nunca llega a alcanzar
 // ese punto, así que nunca pudo (ni antes ni después del fix de ROOT CAUSE
 // #2) dejar `activeAccountSyncKey` en null. La única ventana real
 // vulnerable es LOCAL (proceso matado, excepción de IndexedDB) durante el
 // loop de merge/escritura — exactamente lo que prueba el test de arriba
 // ("app matada"). Este test confirma que la variante de red, aunque
 // también es una interrupción real, nunca estuvo en riesgo — es una
 // confirmación de seguridad, no una reproducción de ROOT CAUSE #2.
 it('una caída de red durante la descarga de un refresh forzado de la MISMA cuenta nunca llega a tocar activeAccountSyncKey (ventana ya segura antes y después del fix)',async()=>{
  const f=fixture();await f.Sync.fullSync();
  const validLastPull=(await f.Sync.getAccountSyncState()).lastPull;

  f.fetch.mockImplementationOnce(async()=>{throw new TypeError('fixture-network-down');});
  await expect(f.Sync.pullAll({forceFull:true})).rejects.toThrow('fixture-network-down');

  const after=await f.Sync.getAccountSyncState();
  expect(after.bootstrapComplete).toBe(true);
  expect(after.lastPull).toBe(validLastPull);
 });

 // Contraparte explícita de "A→B interrumpido" ya cubierto arriba ("a failed
 // account-switch pull invalidates..."): aquí se confirma del lado de LA
 // CUENTA NUEVA (B) misma, inmediatamente después del intento interrumpido
 // — nunca reporta bootstrapComplete=true ni expone filas de A como propias.
 it('ROOT CAUSE #2 — B: cuenta nueva con bootstrap interrumpido NUNCA se marca completa ni expone filas de la cuenta anterior',async()=>{
  const f=fixture({current:admin});await f.Sync.fullSync(); // A completo
  f.switchTo(lub); // cambio real de identidad
  const put=f.db.put;let written=0;
  f.db.put=async(s,r)=>{if(++written===2) throw new Error('fixture-partial-write-account-switch');await put(s,r);};
  vi.spyOn(console,'error').mockImplementation(()=>{});
  await expect(f.Sync.pullAll({forceFull:false})).rejects.toThrow('fixture-partial-write-account-switch');

  const bState=await f.Sync.getAccountSyncState();
  expect(bState.bootstrapComplete).toBe(false); // B nunca queda "lista" con un pull a medias
  // Las filas que SÍ se escribieron antes del throw quedan con la
  // autorización de B (nunca re-etiquetadas como de A) — ninguna fila de B
  // es visible como propiedad de A.
  expect(await f.db.all('equipment')).toEqual([]); // B no tenía equipment propio en este fixture — nunca aparece nada ajeno
 });
});
