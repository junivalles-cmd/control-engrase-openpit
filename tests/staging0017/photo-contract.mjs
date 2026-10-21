// Offline contract audit only. Runs the real upload preparation code with
// mocked HTTP/DB; does NOT upload a real object or install any migration.
import assert from 'node:assert/strict';
import {readFile,writeFile} from 'node:fs/promises';
import {mockedPipelinePayload,DUMMY_IMAGE} from './photo-payload-fixture.mjs';
const source=await readFile('CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/0017_broadcast_messages_scope_PREPARED.sql','utf8');
const m=source.match(/p_payload - array\[([^\]]+)\]/);
assert(m);
const allowed=[...m[1].matchAll(/'([^']+)'/g)].map(m=>m[1]);
const snapshots={};
for(const store of ['manual_tasks','anomalies','lubrication_records']){
 snapshots[store]=await mockedPipelinePayload(store,{id:'TEST0017_PHOTO_'+store,crewId:'TEST0017_CREW_A',equipmentId:'TEST0017_EQUIPMENT_X',
  createdBy:'TEST0017_SUPERVISOR',title:'Synthetic contract',status:'COMPLETED',completedBy:'TEST0017_LUB_A',completedAt:'2026-10-18T12:00:00Z',completionComment:'Synthetic',photos:[DUMMY_IMAGE]});
 const audit=snapshots[store];
 assert.equal(audit.requests.length,1);assert.equal(audit.localWrites.length,1);
 assert.equal(audit.localAfter.photos[0],DUMMY_IMAGE);
 assert(audit.payload.photoUploaded===true);assert.equal(audit.payload.photo,audit.payload.photos[0]);
 assert(audit.payload.photos[0].startsWith('http://127.0.0.1:55321/storage/v1/object/public/'));
}
const forbidden=['photo','photoUploaded'].filter(f=>!allowed.includes(f));
const report={type:'OFFLINE_REAL_CODE_CONTRACT_NOT_REAL_STORAGE',completionAllowlist:allowed,forbiddenCompletionFields:forbidden,
 integrationWith0017:forbidden.length?'FAIL_CONTRACT_MISMATCH':'PASS_CONTRACT_ONLY',snapshots,
 additionalLimit:'Final payload shown is the real stripLocalAuthorizationMetadata result; actual SQL persistence is tested separately in 0017-validation.mjs. Real Storage/Auth remain for remote staging.'};
await writeFile('docs/evidence/0017_PHOTO_CONTRACT_2026-10-18.json',JSON.stringify(report,null,2)+'\n');
console.log('PHOTO CONTRACT',report.integrationWith0017,'stores audited:',Object.keys(snapshots).join(', '));
if(forbidden.length)process.exitCode=1;
