import test from 'node:test';
import {spawnSync} from 'node:child_process';
import {controlledEnvironment} from '../apps/admin/lib/preview-file-boundary.mjs';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import {renderAdminPreviewSql} from '../scripts/admin-preview-sql.mjs';
import {editorFunctions,serverFunctions} from '../apps/admin/lib/preview-admin-config.mjs';
const text=p=>readFileSync(new URL('../'+p,import.meta.url),'utf8');
const template=text('supabase/cloud/admin-preview-dev/activation-template.sql'),contract=JSON.parse(text('supabase/cloud/admin-preview-dev/rpc-contract.json'));
const sourceRoot=new URL('../',import.meta.url);
const historicalResult=spawnSync('git',['-C',fileURLToPath(sourceRoot),'show','bab66bc09af2ef181b0ebfff6bc73f2ca0fe4d12:supabase/cloud/admin-preview-dev/activation-template.sql'],{env:controlledEnvironment(),windowsHide:true,maxBuffer:1048576});
assert.ifError(historicalResult.error);assert.equal(historicalResult.status,0,'Required historical Git blob');
const baseline=JSON.parse(text('docs/stages/stage-admin-c2-baseline.json')).files['supabase/cloud/admin-preview-dev/activation-template.sql'];
assert.equal(historicalResult.stdout.length,baseline.bytes);assert.equal(createHash('sha256').update(historicalResult.stdout).digest('hex'),baseline.sha256);
const historicalTemplate=historicalResult.stdout.toString('utf8');
const values=()=>({ownerUserId:randomUUID(),effectKey:randomUUID(),decisionSha256:'a'.repeat(64),implementationManifestSha256:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()});
test('render is pure, deterministic, binds exact template and rejects SQL injection or extra fields',()=>{
 const input=values(),a=renderAdminPreviewSql(template,input),b=renderAdminPreviewSql(template,input);assert.deepEqual(a,b);assert.match(a.renderedSqlSha256,/^[0-9a-f]{64}$/);assert.equal(a.templateSha256,contract.templateSha256);assert.ok(!a.sql.includes('__OWNER_UUID__'));
 for(const bad of [{...input,ownerUserId:"x';grant all--"},{...input,expiresAt:"now();--"},{...input,decisionSha256:'wrong'},{...input,endpoint:'https://other.invalid'}])assert.throws(()=>renderAdminPreviewSql(template,bad),/ADMIN_PREVIEW_RENDER_INPUT/);
 assert.throws(()=>renderAdminPreviewSql(template+'__UNKNOWN__',input),/ADMIN_PREVIEW_RENDER_MARKER/);
});
test('prepared SQL grants exact21 editor and3 session signatures without table or anonymous grants',()=>{
 const grants=[...template.matchAll(/^grant execute on function public\.([a-z0-9_]+)\(([^\n]*)\) to (authenticated|service_role);$/gm)];assert.equal(grants.length,24);
 assert.deepEqual(grants.filter(x=>x[3]==='authenticated').map(x=>x[1]).sort(),[...editorFunctions].sort());assert.deepEqual(grants.filter(x=>x[3]==='service_role').map(x=>x[1]).sort(),[...serverFunctions].sort());
 for(const r of contract.rpc)assert.ok(grants.some(x=>x[1]===r.name&&x[2]===r.signature&&x[3]===r.role));
 assert.doesNotMatch(template,/^grant (?!execute on function public\.)/m);assert.doesNotMatch(template,/to anon/);assert.match(template,/ACTIVATION_EXISTS_INSPECT_DO_NOT_REPLAY/);
});
test('historical177 definitions and prepared SQL retain exact preview guards, one owner, one new history',()=>{
 const f=JSON.parse(text('supabase/cloud/admin-preview-dev/historical-functions.json'));assert.equal(f.functions.length,177);
 for(const name of ['private.assert_initialized','private.catalog_sector_selectable']){assert.match(f.functions.find(x=>x.name===name).body,/environment='preview'/);assert.doesNotMatch(template,new RegExp('create (?:or replace )?function '+name.replaceAll('.','\\.')));}
 assert.equal([...historicalTemplate.matchAll(/create or replace function/g)].length,1);assert.match(historicalTemplate,/create or replace function private.active_admin_user/);
 assert.deepEqual([...template.matchAll(/create or replace function ([a-z0-9_.]+)\(/g)].map(m=>m[1]).sort(),['private.active_admin_user','private.is_admin','public.m1_read_admin_session']);
 assert.deepEqual([...template.matchAll(/create function ([a-z0-9_.]+)\(/g)].map(m=>m[1]),['private.admin_preview_authority']);
 assert.match(template,/pg_advisory_xact_lock_shared\(1246704725,1127380914\)/);assert.match(template,/transaction_isolation'\)<>'read committed'/);
 assert.match(template,/revoke execute on function private.admin_preview_authority\(uuid,uuid,text,boolean\) from public,anon,authenticated,service_role/);assert.match(template,/owner_user_id=p_user/);assert.match(template,/product_id'='judoju-news'/);
 assert.match(template,/version='20261116000107'/);assert.match(template,/<>8/);assert.match(template,/<>9/);assert.match(template,/revoke all on private.admin_preview_control from public,anon,authenticated,service_role/);
 assert.equal(contract.active,false);assert.equal(contract.actualRemoteRequests,0);assert.equal(contract.actualKeysRead,0);assert.equal(contract.workerConnected,false);
});
