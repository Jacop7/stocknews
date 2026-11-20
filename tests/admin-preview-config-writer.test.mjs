import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,readdirSync,rmSync,lstatSync,linkSync,writeFileSync} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {writePreviewFixture} from '../apps/admin/lib/preview-config-writer.mjs';
import {nativeBoundary,productDirectory,createPreviewFixtureRoot,assertFixtureRoot,writeOwnedPreviewFixture} from '../apps/admin/lib/preview-file-boundary.mjs';
import {loadPreviewAdminConfig,loadPreviewAdminFixture,previewConfigKind,editorFunctions,serverFunctions} from '../apps/admin/lib/preview-admin-config.mjs';
const win=process.platform==='win32';
function fixture(t){const handle=createPreviewFixtureRoot(),root=handle.path;t.after(()=>{assertFixtureRoot(handle);assert.equal(path.basename(path.dirname(root)),'JudojuNewsAdminC1B');assert.match(path.basename(root),/^fixture-[0-9a-f]{32}$/);assert.ok(!lstatSync(root).isSymbolicLink());rmSync(root,{recursive:true});});return handle;}
function proof(){const now=Date.now();return {schemaVersion:1,stage:'CLOUD11A',state:'ADMIN_CONNECTION_ACTIVATED',productId:'judoju-news',projectRef:'nxfpfvsdwbziowkxsxnh',organizationRef:'qfzgicohgpuogehdyzfx',ownerUserId:randomUUID(),fixture:true,approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),activationDecisionSha256:'a'.repeat(64),implementationManifestSha256:'b'.repeat(64),sqlSha256:'c'.repeat(64),M2:false,realPublicationEnabled:false,workerEnabled:false,editorFunctions,serverFunctions};}
const secretSource=()=>({publishableKey:'FIXTURE_PUBLISHABLE',secretKey:'FIXTURE_SECRET',encryptionKey:'d'.repeat(64)});
test('ACTUAL is denied before mock source or private I/O, independent of env',()=>{
 let calls=0;assert.throws(()=>writePreviewFixture({mode:'ACTUAL',root:productDirectory,proof:{},secretSource:()=>{calls++;throw Error('SECRET_READ');}}),/NOT_ACTIVATED/);assert.equal(calls,0);
 assert.throws(loadPreviewAdminConfig,/PREVIEW_ADMIN_CONFIG_REJECTED/);
});
test('Windows fixture writer flushes proof then hash-bound config; loader brands fixture only',{skip:!win?'NOT_VERIFIED_WINDOWS':false},t=>{
 const root=fixture(t),p=proof();const r=writePreviewFixture({mode:'FIXTURE',root,proof:p,secretSource});assert.equal(r.proofFlushed,true);assert.equal(r.configFlushed,true);
 const config=loadPreviewAdminFixture(root.path);assert.equal(previewConfigKind(config),'FIXTURE');
 const bytes=readFileSync(path.join(root.path,'.local-data/cloud-admin/activation-proof.json'));assert.equal(config.proofSha256,createHash('sha256').update(bytes).digest('hex'));
 const before=readFileSync(path.join(root.path,'.local-data/cloud-admin/admin-server.json'));assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:p,secretSource}),/NOT_EMPTY/);assert.deepEqual(readFileSync(path.join(root.path,'.local-data/cloud-admin/admin-server.json')),before);
});
test('proof wrong scope, TTL, RPCs, getters and actual-shaped keys are rejected',{skip:!win?'NOT_VERIFIED_WINDOWS':false},t=>{
 const root=fixture(t);for(const mutate of [p=>p.projectRef='other',p=>p.workerEnabled=true,p=>p.expiresAt=new Date(Date.now()+90000000).toISOString(),p=>p.editorFunctions=[...editorFunctions,'extra']]){const p=proof();mutate(p);assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:p,secretSource}),/FIXTURE_PROOF/);assert.deepEqual(readdirSync(root.path),['fixture-owner.json']);}
 let read=false;const p=proof();Object.defineProperty(p,'ownerUserId',{get(){read=true;return randomUUID();},enumerable:true});assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:p,secretSource}),/GETTER/);assert.equal(read,false);
 assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:proof(),secretSource:()=>({...secretSource(),secretKey:'NOT_FIXTURE'})}),/FIXTURE_SECRET/);assert.deepEqual(readdirSync(root.path),['fixture-owner.json']);
});
test('hard links fail handle link-count boundary and preserve source bytes',{skip:!win?'NOT_VERIFIED_WINDOWS':false},t=>{
 const root=fixture(t);writePreviewFixture({mode:'FIXTURE',root,proof:proof(),secretSource});const f=path.join(root.path,'.local-data/cloud-admin/admin-server.json'),before=readFileSync(f);linkSync(f,path.join(root.path,'second-link.json'));assert.throws(()=>loadPreviewAdminFixture(root.path),/CONFIG_REJECTED/);assert.deepEqual(readFileSync(f),before);
});
test('partial proof failure is kept on disk and cannot be retried over existing files',{skip:!win?'NOT_VERIFIED_WINDOWS':false},t=>{
 const root=fixture(t),p=proof(),c={...secretSource(),fixture:true};assert.throws(()=>writeOwnedPreviewFixture(root,{proof:Buffer.from(JSON.stringify(p)).toString('base64'),config:Buffer.from(JSON.stringify(c)).toString('base64'),fault:'AFTER_PROOF'}),/PARTIAL_PROOF/);
 const file=path.join(root.path,'.local-data/cloud-admin/activation-proof.json'),before=readFileSync(file);assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:p,secretSource}),/NOT_EMPTY/);assert.deepEqual(readFileSync(file),before);assert.throws(()=>loadPreviewAdminFixture(root.path),/CONFIG_REJECTED/);
});
test('proof flush failure leaves an explicit partial state without config success or overwrite',{skip:!win?'NOT_VERIFIED_WINDOWS':false},t=>{
 const root=fixture(t),p=proof(),c={...secretSource(),fixture:true};assert.throws(()=>writeOwnedPreviewFixture(root,{proof:Buffer.from(JSON.stringify(p)).toString('base64'),config:Buffer.from(JSON.stringify(c)).toString('base64'),fault:'PROOF_FLUSH'}),/PARTIAL_PROOF/);
 assert.ok(readdirSync(path.join(root.path,'.local-data/cloud-admin')).includes('activation-proof.json'));assert.equal(readdirSync(path.join(root.path,'.local-data/cloud-admin')).includes('admin-server.json'),false);assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:p,secretSource}),/NOT_EMPTY/);
});
test('product root and ancestors are never fixture destinations',{skip:!win?'NOT_VERIFIED_WINDOWS':false},()=>{
 for(const root of [productDirectory,path.dirname(productDirectory),path.join(productDirectory,'.local-data')])assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:proof(),secretSource}),/UNOWNED_FIXTURE_ROOT/);
});
test('unissued temp and workspace siblings fail before secret source or any writer file creation',{skip:!win?'NOT_VERIFIED_WINDOWS':false},t=>{
 const owned=fixture(t);let calls=0;const source=()=>{calls++;return secretSource();};
 const roots=[mkdtempSync(path.join(os.tmpdir(),'judoju-c1b-unowned-')),mkdtempSync(path.join(path.dirname(productDirectory),'.judoju-c1b-unowned-'))];
 for(const root of roots){t.after(()=>{assert.ok([path.resolve(os.tmpdir()),path.dirname(productDirectory)].includes(path.dirname(root)));assert.match(path.basename(root),/^\.?judoju-c1b-unowned-/);assert.ok(!lstatSync(root).isSymbolicLink());rmSync(root,{recursive:true});});
  assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:proof(),secretSource:source}),/UNOWNED_FIXTURE_ROOT/);assert.deepEqual(readdirSync(root),[]);
  const c={...secretSource(),fixture:true};assert.throws(()=>nativeBoundary('WriteFixture',{root,rootId:'unowned',nonce:'a'.repeat(64),proof:Buffer.from(JSON.stringify(proof())).toString('base64'),config:Buffer.from(JSON.stringify(c)).toString('base64')}),/HOLD/);assert.deepEqual(readdirSync(root),[]);
 }
 for(const root of [owned.path,{...owned},new Proxy(owned,{})])assert.throws(()=>writePreviewFixture({mode:'FIXTURE',root,proof:proof(),secretSource:source}),/UNOWNED_FIXTURE_ROOT/);
 assert.equal(calls,0);assert.deepEqual(readdirSync(owned.path),['fixture-owner.json']);
});
