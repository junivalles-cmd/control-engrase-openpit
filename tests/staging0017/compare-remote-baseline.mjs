// Local comparison of metadata files already captured from an explicitly
// identified remote staging. This program never connects or applies SQL.
import {readFile,writeFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {catalogDifferences} from './baseline-tools.mjs';
const ref=process.argv[2];assert(/^[a-z]{20}$/.test(ref||''),'Provide a staging ref');
assert(!['havrirlapjyqrffgalqx','nxbwdrfgezzrfqzxgaks'].includes(ref),'Known production/other app target denied');
const json=async path=>JSON.parse((await readFile(path,'utf8')).replace(/^\uFEFF/,''));
const expected=await json('supabase/staging/0017_PRODUCTION_BASELINE_REFERENCE.json');
const actual=(await json('tests/staging0017/remote-baseline-catalog.local.json')).rows[0].catalog;
const expectedTokens=(await json('tests/staging0017/function-fingerprints.local.json')).rows;
const actualTokens=(await json('tests/staging0017/remote-function-fingerprints.local.json')).rows;
const differences=catalogDifferences(expected,actual,expectedTokens,actualTokens);
// An actual captured trigger may never be silently dropped from comparison.
if(actual.triggers.length)differences.push({class:'unexpected_staging_triggers',actual:actual.triggers});
const report={projectRef:ref,remoteStagingCompared:true,schemaEquivalent:differences.length?'FAIL':'PASS_CRITICAL_SCOPE',differences,
 isolationExceptions:['Production external notification webhook intentionally absent; no production credentials or endpoint copied'],
 checkedAt:actual.captured_at};
await writeFile('docs/evidence/0017_REMOTE_SCHEMA_COMPARISON.json',JSON.stringify(report,null,2)+'\n');
console.log('REMOTE SCHEMA_EQUIVALENT',report.schemaEquivalent);
if(differences.length)process.exitCode=1;
