// Offline DDL replay. Managed Auth/Storage services are represented only
// enough to parse DDL; this is NOT a Supabase HTTP/Storage validation.
import {readFile,writeFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import path from 'node:path';import os from 'node:os';import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
process.on('uncaughtException',e=>{console.error(e.message,e.code,e.where);process.exit(1);});
const modulePath=process.env.PGLITE_MODULE_PATH||[
 path.join(os.tmpdir(),'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js'),
 path.join(os.homedir(),'AppData/Local/Temp/control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js')
].find(existsSync);
const {PGlite}=await import(pathToFileURL(modulePath).href);const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
 create schema auth;create schema storage;
 create table auth.users(id uuid primary key);
 create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
 create table storage.objects(id uuid,bucket_id text,name text,owner uuid,owner_id text);
 alter table storage.objects enable row level security;`);
await db.exec(await readFile('tests/staging0017/target-marker.sql','utf8'));
await db.exec(await readFile('supabase/staging/0017_PRODUCTION_BASELINE_SCHEMA_PREPARED.sql','utf8'));
const actualResult=await db.exec(await readFile('tests/staging0017/capture-baseline-catalog.sql','utf8'));
const actual=actualResult.find(r=>r.rows?.[0]?.catalog)?.rows[0].catalog;
assert(actual,'No replay catalog');
const expected=JSON.parse(await readFile('supabase/staging/0017_PRODUCTION_BASELINE_REFERENCE.json','utf8'));
const tokenRows=(await db.exec(await readFile('tests/staging0017/capture-function-fingerprints.sql','utf8'))).find(r=>r.rows?.[0]?.token_md5)?.rows;
const referenceTokens=JSON.parse((await readFile('tests/staging0017/function-fingerprints.local.json','utf8')).replace(/^\uFEFF/,'' )).rows;
function canonical(obj){if(Array.isArray(obj))return obj.map(canonical).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)));if(obj&&typeof obj==='object')return Object.fromEntries(Object.keys(obj).sort().map(k=>[k,canonical(obj[k])]));return obj;}
const differences=[];
const classes=['tables','columns','constraints','indexes','policies','table_grants','function_grants','schema_grants','matrix','bucket','support_control','release_state','types','sequences','views'];
for(const type of classes){if(JSON.stringify(canonical(actual[type]))!==JSON.stringify(canonical(expected[type])))differences.push({class:type,expected:canonical(expected[type]),actual:canonical(actual[type])});}
const meta=f=>{const {source_md5,no_whitespace_md5,...m}=f;return m;};
if(JSON.stringify(canonical(actual.functions.map(meta)))!==JSON.stringify(canonical(expected.functions.map(meta))))differences.push({class:'function_metadata',expected:expected.functions.map(meta),actual:actual.functions.map(meta)});
if(JSON.stringify(canonical(tokenRows))!==JSON.stringify(canonical(referenceTokens)))differences.push({class:'function_tokens',expected:referenceTokens,actual:tokenRows});
const operationalCounts=(await db.query("select (select count(*) from public.engrase_sync)::int operations,(select count(*) from public.app_profiles)::int profiles,(select count(*) from authorization_private.support_links)::int support_links")).rows[0];
assert.deepEqual(operationalCounts,{operations:0,profiles:0,support_links:0});
const report={comparison:'PRODUCTION_METADATA_VS_OFFLINE_STAGING_DDL_REPLAY',schemaEquivalent:differences.length?'FAIL':'PASS_CRITICAL_SCOPE',
 counts:{tables:actual.tables.length,functions:actual.functions.length,policies:actual.policies.length,matrixRows:actual.matrix.length},
 differences,expectedIsolationExceptions:[{object:'public.engrase_sync trigger avisar-push',action:'OMITTED',reason:'External production webhook with credential-bearing arguments; never replay to staging'}],
 operationalCounts,remoteStagingCompared:false,limitations:'Managed Auth/Storage services are not tested; final catalog comparison must be repeated on remote staging before 0017.'};
await writeFile('docs/evidence/0017_SCHEMA_COMPARISON_2026-10-18.json',JSON.stringify(report,null,2)+'\n');
console.log('SCHEMA COMPARISON',report.schemaEquivalent,'differences:',differences.map(d=>d.class).join(',')||'none');
await db.close();if(differences.length)process.exitCode=1;
