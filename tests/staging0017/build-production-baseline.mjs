// OFFLINE: rebuild from production catalog metadata and verified LOCAL
// source definitions. Does not copy production function bodies or execute SQL.
import {readFile,writeFile,readdir,mkdir} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {functionsIn,qi,ql} from './baseline-tools.mjs';
const unwrap=s=>{const x=JSON.parse(s.replace(/^\uFEFF/,''));return x.rows?x.rows[0].catalog:x;};
const catalog=unwrap(await readFile('tests/staging0017/production-baseline-catalog.local.json','utf8'));
assert.equal(catalog.read_only,'on');
const fingerprints=JSON.parse((await readFile('tests/staging0017/function-fingerprints.local.json','utf8')).replace(/^\uFEFF/,'' )).rows;
const lexer=(await readFile('tests/staging0017/capture-function-fingerprints.sql','utf8')).match(/\$lex\$([\s\S]*?)\$lex\$/)[1];
const modulePath=process.env.PGLITE_MODULE_PATH||[
 path.join(os.tmpdir(),'control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js'),
 path.join(os.homedir(),'AppData/Local/Temp/control-engrase-sql-preflight/node_modules/@electric-sql/pglite/dist/index.js')
].find(existsSync);
assert(modulePath,'Existing PGlite needed only as offline SQL tokenizer/DDL checker');
const {PGlite}=await import(pathToFileURL(modulePath).href);const db=new PGlite();
const root='CONTROL_ENGRASE_WEB/CONTROL_ENGRASE_WEB/supabase/migrations/';
const candidates=[];
for(const dir of [root,'docs/'])for(const file of (await readdir(dir)).filter(f=>f.endsWith('.sql'))){
 candidates.push(...functionsIn(await readFile(dir+file,'utf8'),dir+file));
}
const selected=[],missing=[];
for(const f of catalog.functions){
 const name=f.schema+'.'+f.name;
 let matches=candidates.filter(c=>c.name===name&&c.hash===f.source_md5);
 if(!matches.length&&f.name==='authorization_row_in_scope_baseline_0013')matches=candidates.filter(c=>c.name==='authorization_private.authorization_row_in_scope'&&c.hash===f.source_md5);
 // The 0016 wrapper's literals have no significant whitespace. This
 // exception is limited to that known wrapper; do not normalize arbitrary
 // functions with exception strings or dynamic SQL this way.
 if(!matches.length&&name==='authorization_private.authorization_row_in_scope')matches=candidates.filter(c=>c.name===name&&c.noWhitespaceHash===f.no_whitespace_md5&&![...c.body.matchAll(/'(?:''|[^'])*'/g)].some(m=>/\s/.test(m[0])));
 const fingerprint=fingerprints.find(p=>p.schema===f.schema&&p.name===f.name&&p.args===f.args);
 if(!matches.length&&fingerprint&&!fingerprint.has_dollar_literals){
  const eligible=candidates.filter(c=>(c.name===name||(f.name==='authorization_row_in_scope_baseline_0013'&&c.name==='authorization_private.authorization_row_in_scope'))&&!/\$[A-Za-z_0-9]*\$/.test(c.body));
  for(const c of eligible){
   const hash=(await db.query("select md5(coalesce(string_agg(m[1],chr(31) order by ord),'')) h from regexp_matches($1,$2,'g') with ordinality tokens(m,ord) where m[1] !~ '^(--|/\\*)'",[c.body,lexer])).rows[0].h;
   if(hash===fingerprint.token_md5){matches.push({...c,tokenMatch:true});break;}
  }
 }
 if(!matches.length){missing.push({name,args:f.args,sourceMd5:f.source_md5,noWhitespaceMd5:f.no_whitespace_md5});continue;}
 const match=matches[0];
 const statement=match.statement.replace(/^(create\s+(?:or\s+replace\s+)?function\s+)[\w.]+/i,'$1'+name);
 selected.push({name,signature:f.args,source:match.file,match:match.hash===f.source_md5?'EXACT_NORMALIZED_BODY':match.tokenMatch?'SQL_TOKENS_IDENTICAL':'KNOWN_0016_WHITESPACE_ONLY',statement});
}
await mkdir('supabase/staging',{recursive:true});
const report={capturedAt:catalog.captured_at,readOnly:true,functionCount:catalog.functions.length,verifiedLocalFunctions:selected.map(({statement,...m})=>m),missingFunctions:missing,
 unsupported:{types:catalog.types,sequences:catalog.sequences,views:catalog.views,partitionedTables:catalog.tables.filter(t=>t.relkind!=='r')},
 schemaEquivalent:missing.length?'BLOCKED_UNVERIFIED_FUNCTIONS':'PENDING_BASELINE_REPLAY',remoteStagingCompared:false};
await writeFile('docs/evidence/0017_BASELINE_BUILD_2026-10-18.json',JSON.stringify(report,null,2)+'\n');
console.log('Local functions verified:',selected.length,'/',catalog.functions.length);
console.log('Missing:',JSON.stringify(missing.map(f=>f.name)));
await writeFile('supabase/staging/0017_PRODUCTION_BASELINE_REFERENCE.json',JSON.stringify(catalog,null,2)+'\n');
assert.equal(missing.length,0,'Never generate an incomplete baseline');
assert(!catalog.types.length&&!catalog.sequences.length&&!catalog.views.length,'Unsupported object kinds require implementation, not silent omission');
assert(catalog.tables.every(t=>t.relkind==='r'&&t.owner==='postgres'),'Unsupported table kind or owner');
assert(catalog.columns.every(c=>!c.identity),'Identity columns require separate sequence replay');
const fq=(schema,name)=>qi(schema)+'.'+qi(name);
const role=r=>r==='PUBLIC'?'PUBLIC':qi(r);
const sig=f=>fq(f.schema,f.name)+'('+f.args+')';
const lines=[`-- STAGING ONLY: captured production PRE-0017 schema/config, no app data.
-- Generated from metadata + verified local function sources. No production function source was exported.
-- External notification webhook intentionally OMITTED: must never contact production.
-- Requires an EMPTY, explicitly identified Supabase staging, with managed Auth/Storage schemas.
-- No historical migration is executed. No users, photos, operation history or credentials copied.
begin;
do $staging_guard$ begin
 if to_regclass('test0017_private.environment') is null then raise exception 'No explicit staging marker'; end if;
 if not exists(select 1 from test0017_private.environment where id='TEST0017' and environment='STAGING') then raise exception 'Wrong environment'; end if;
 if to_regclass('public.engrase_sync') is not null or to_regclass('public.app_profiles') is not null
   or to_regnamespace('authorization_private') is not null then raise exception 'Destination app schema is not empty'; end if;
 if to_regclass('auth.users') is null or to_regclass('storage.objects') is null then raise exception 'Managed Supabase Auth/Storage required'; end if;
end $staging_guard$;
set local search_path=public,extensions,pg_catalog;
set local check_function_bodies=off;
create schema authorization_private authorization postgres;`];
for(const t of catalog.tables){
 const cols=catalog.columns.filter(c=>c.schema===t.schema&&c.table===t.name).map(c=>
  qi(c.name)+' '+c.type+(c.generated?' GENERATED ALWAYS AS ('+c.default+') STORED':c.default?' DEFAULT '+c.default:'')+(c.not_null?' NOT NULL':''));
 lines.push('create table '+fq(t.schema,t.name)+' (\n  '+cols.join(',\n  ')+'\n);');
}
// Non-FK constraints first; FK dependencies already have all target tables.
for(const c of [...catalog.constraints].sort((a,b)=>(a.type==='f')-(b.type==='f')))
 lines.push('alter table '+fq(c.schema,c.table)+' add constraint '+qi(c.name)+' '+c.definition+';');
for(const index of catalog.indexes){assert(index.valid,'Invalid source index needs review');if(!index.constraint_index)lines.push(index.definition+';');}
for(const f of selected){
 lines.push('-- Verified local source: '+f.source+' ('+f.match+')');lines.push(f.statement);
}
// The production source can differ in header annotations. Restore exact
// captured execution attributes independently from the verified body.
for(const f of catalog.functions){
 const signature=sig(f);
 lines.push(`alter function ${signature} owner to ${qi(f.owner)};`);
 lines.push(`alter function ${signature} ${f.prosecdef?'security definer':'security invoker'} ${f.provolatile==='s'?'stable':f.provolatile==='i'?'immutable':'volatile'} ${f.proisstrict?'strict':'called on null input'} ${f.proleakproof?'leakproof':'not leakproof'} parallel ${f.proparallel==='s'?'safe':f.proparallel==='r'?'restricted':'unsafe'} cost ${f.procost}${f.prorows?' rows '+f.prorows:''};`);
 lines.push(`alter function ${signature} reset all;`);
 for(const config of f.proconfig||[]){const i=config.indexOf('=');lines.push(`alter function ${signature} set ${qi(config.slice(0,i))} to ${config.slice(i+1)};`);}
}
for(const t of catalog.tables){
 const target=fq(t.schema,t.name);
 lines.push('alter table '+target+(t.relrowsecurity?' enable':' disable')+' row level security;');
 lines.push('alter table '+target+(t.relforcerowsecurity?' force':' no force')+' row level security;');
}
// Do not touch managed Storage objects/policies not in the captured scope.
for(const p of catalog.policies){
 const target=fq(p.schemaname,p.tablename);
 if(p.schemaname==='storage')lines.push('drop policy if exists '+qi(p.policyname)+' on '+target+';');
 lines.push('create policy '+qi(p.policyname)+' on '+target+' as '+p.permissive+' for '+p.cmd+' to '+p.roles.map(role).join(',')+(p.qual?' using ('+p.qual+')':'')+(p.with_check?' with check ('+p.with_check+')':'')+';');
}
const matrixCols=['store','role','can_read','can_insert','can_update','can_delete'];
lines.push('insert into public.app_store_permissions('+matrixCols.join(',')+') values\n'+catalog.matrix.map(m=>'('+matrixCols.map(k=>typeof m[k]==='boolean'?String(m[k]):ql(m[k])).join(',')+')').join(',\n')+';');
for(const control of catalog.support_control||[])lines.push(`insert into authorization_private.support_control(singleton,enabled) values(${control.singleton},${control.enabled});`);
for(const release of catalog.release_state||[])lines.push(`insert into authorization_private.release_migration_state(version,matrix_digest) values(${ql(release.version)},${ql(release.matrix_digest)});`);
for(const b of catalog.bucket){
 lines.push(`insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values(${ql(b.id)},${ql(b.name)},${b.public},${b.file_size_limit??'null'},${b.allowed_mime_types?'array['+b.allowed_mime_types.map(ql).join(',')+']::text[]':'null'});`);
}
const relevantRoles=[...new Set([...catalog.schema_grants,...catalog.table_grants,...catalog.function_grants].map(g=>g.grantee))];
for(const schema of ['public','authorization_private'])lines.push('revoke all on schema '+qi(schema)+' from '+relevantRoles.map(role).join(',')+';');
for(const t of catalog.tables)lines.push('revoke all on table '+fq(t.schema,t.name)+' from '+relevantRoles.map(role).join(',')+';');
for(const f of catalog.functions)lines.push('revoke all on function '+sig(f)+' from '+relevantRoles.map(role).join(',')+';');
for(const g of catalog.schema_grants)lines.push('grant '+g.privilege+' on schema '+qi(g.schema)+' to '+role(g.grantee)+(g.grantable?' with grant option':'')+';');
for(const g of catalog.table_grants)lines.push('grant '+g.privilege+' on table '+fq(g.schema,g.table)+' to '+role(g.grantee)+(g.grantable?' with grant option':'')+';');
for(const g of catalog.function_grants)lines.push('grant '+g.privilege+' on function '+sig(g)+' to '+role(g.grantee)+(g.grantable?' with grant option':'')+';');
lines.push('commit;');
const baseline=lines.join('\n\n')+'\n';
assert(!/sb_secret_[\w-]{12,}|sbp_[\w-]{20,}|eyJ[\w-]{15,}\.[\w-]{15,}\.[\w-]{15,}|havrirlapjyqrffgalqx/.test(baseline),'Credential/production endpoint guard');
await writeFile('supabase/staging/0017_PRODUCTION_BASELINE_SCHEMA_PREPARED.sql',baseline);
console.log('Generated staging-only baseline: '+catalog.tables.length+' tables, '+selected.length+' functions, '+catalog.policies.length+' policies, '+catalog.matrix.length+' matrix rows.');
await db.close();
