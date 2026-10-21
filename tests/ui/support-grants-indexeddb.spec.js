import {test,expect} from '@playwright/test';
import {DB_JS_PATH,OPERATIONAL_SCOPE_JS_PATH} from '../helpers/loadLubricationLogic.js';
import {readSource} from '../helpers/extractFromSource.js';

test('real IndexedDB: grant decoration, revocation and account isolation preserve stored work',async({page})=>{
 await page.route('**/*',route=>route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><body></body>'}));await page.goto('/');
 await page.addScriptTag({content:readSource(DB_JS_PATH)});await page.addScriptTag({content:readSource(OPERATIONAL_SCOPE_JS_PATH)});
 await page.addScriptTag({content:`window.__identity={authUserId:'auth-a',appUserId:'u',authorizationFingerprint:'fp'};window.Auth={getProfile:()=>__identity,isSupabaseMode:()=>true};`});
 const result=await page.evaluate(async()=>{
  await openDB();
  const context={...__identity,active:true,scopeType:'CREW_SCOPED',authorizedCrewIds:['c'],authorizedLocationIds:['Volcan']};
  const assignment={id:'asg',equipmentId:'e',planId:'p',assignedCrewId:'c',occurrenceKey:'p:2026-09-30',status:'PENDING',active:true};
  const supportGrants={...__identity,rows:[{store:'equipment',id:'e'},{store:'lubrication_assignments',id:'asg'}],operational:[{...assignment,assignmentId:'asg'}],revision:'v1'};
  await DB.setAuthorizationContext('u',{...context,supportGrants});
  for(const [store,row] of [['equipment',{id:'e',locationId:'Mojon'}],['equipment',{id:'other',locationId:'Mojon'}],['lubrication_assignments',assignment]])await DB.put(store,{...row,updatedAt:'v',_pushedVersion:'v',__authorizationAppUserId:'u'},{source:'server'});
  const before={equipment:(await DB.all('equipment')).map(e=>e.id),assignment:await DB.get('lubrication_assignments','asg')};
  await DB.setAuthorizationContext('u',{...context,supportGrants:{...supportGrants,rows:[],operational:[],revision:'v2'}});
  const revoked=await DB.get('equipment','e');const retained=await DB.getRaw('equipment','e');
  window.__identity={authUserId:'auth-b',appUserId:'b',authorizationFingerprint:'fp-b'};
  await DB.setAuthorizationContext('b',{...context,...__identity});
  const foreign=await DB.all('equipment');
  return {before,revoked,retained,foreign};
 });
 expect(result.before.equipment).toEqual(['e']);expect(result.before.assignment._supportOperational).toBe(true);
 expect(result.revoked).toBeNull();expect(result.retained.id).toBe('e');expect(result.foreign).toEqual([]);
});
