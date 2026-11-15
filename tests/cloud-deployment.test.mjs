import test from 'node:test';
import assert from 'node:assert/strict';
import {fileURLToPath} from 'node:url';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,lstatSync,realpathSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse as parseToml} from 'smol-toml';
import {inspectCloudArtifact,parseCloudArgs,expectedContract,allowedCloudHistory,allowedCloudMain,parseCloudJson} from '../scripts/cloud-deployment-policy.mjs';
import {checkedSourcePath,readCloudInputs,cloudInputPaths} from '../scripts/cloud-source-files.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),prefix='supabase/cloud/cloud03/';
const args=['--environment','preview','--project-ref','nxfpfvsdwbziowkxsxnh','--artifact','foundation1'];
function fixture(){const f=readCloudInputs(root),j=p=>JSON.parse(f[p]);return {args:[...args],contract:j('docs/cloud/deployment-contract.json'),manifest:j('docs/project-resource-manifest.json'),provenance:j(prefix+'provenance.json'),source:f['supabase/migrations/20261114000001_m0_foundation.sql'],guard:f[prefix+'guard.sql'],seal:f[prefix+'seal.sql'],deployment:f[prefix+'dev-domain-foundation.sql']};}
test('staged source is reproduced without SQL execution or current-health authorization',()=>{
 const f=fixture(),before=f.deployment.toString('hex'),out=inspectCloudArtifact(f);
 assert.equal(out.state,'NOT_EXECUTED_OFFLINE_ONLY');assert.equal(out.replay,'REPLAY_FORBIDDEN');assert.equal(out.sqlExecutions,0);assert.equal(out.networkRequests,0);assert.equal(out.officialHistoryAdopted,false);
 assert.equal(f.deployment.toString('hex'),before);assert.deepEqual(f.contract,expectedContract());
 assert.equal(f.provenance.sourceTableCount,42);assert.equal(cloudInputPaths.length,7);
});
for(const [name,invalid] of [
 ['missing',args.slice(0,4)],['extra',[...args,'--apply','true']],['duplicate',['--environment','preview','--environment','preview','--artifact','foundation1']],
 ['unknown',['--env','preview',...args.slice(2)]],['production',['--environment','production',...args.slice(2)]],
 ['wrong-ref',[...args.slice(0,3),'zkzevpinuixeuyjlffwi',...args.slice(4)]],['new-artifact',[...args.slice(0,5),'migration2']],
 ['injected-path',[...args.slice(0,5),'../../.env']],['empty-ref',[...args.slice(0,3),'',...args.slice(4)]]]){
 test('CLI rejects '+name,()=>assert.throws(()=>parseCloudArgs(invalid)));
}
test('CLI option order is irrelevant but exact values are required',()=>assert.deepEqual(parseCloudArgs([...args.slice(4),...args.slice(0,4)]),parseCloudArgs(args)));
test('JSON duplicate keys and alternate serialization fail closed',()=>{
 assert.throws(()=>parseCloudJson(Buffer.from('{"a":0,"a":1}\n')),/Canonical/);
 assert.throws(()=>parseCloudJson(Buffer.from('{"a":1}\n')),/Canonical/);
 assert.deepEqual(parseCloudJson(Buffer.from('{\n  "a": 1\n}\n')),{a:1});
});
for(const field of ['source','guard','seal','deployment'])test('tampered '+field+' bytes fail before any execution',()=>{
 const f=fixture();f[field]=Buffer.from(f[field]);f[field][5]^=1;assert.throws(()=>inspectCloudArtifact(f),/SHA256/);
});
test('manifest+contract target substitution cannot agree their way past pinned refs',()=>{
 const f=fixture();f.contract.targets[0].actual.projectRef='zkzevpinuixeuyjlffwi';f.manifest.resources.find(r=>r.id==='supabase_preview').actual.projectRef='zkzevpinuixeuyjlffwi';assert.throws(()=>inspectCloudArtifact(f),/deployment contract/);
});
for(const change of ['production-access','connected','duplicate-target','official-history','provenance-version'])test('reject '+change,()=>{
 const f=fixture(),prod=f.manifest.resources.find(r=>r.id==='supabase_production');
 if(change==='production-access')prod.actual.dataApiEnabled=true;
 if(change==='connected')prod.actual.connected=true;
 if(change==='duplicate-target')f.manifest.resources.push(structuredClone(prod));
 if(change==='official-history')f.contract.officialHistoryAdopted=true;
 if(change==='provenance-version')f.provenance.sourceSha256='0'.repeat(64);
 assert.throws(()=>inspectCloudArtifact(f));
});
test('CLI emits only offline result and rejects production with nonzero exit',()=>{
 for(const [input,code] of [[args,0],[['--environment','production',...args.slice(2)],1]]){
  const r=spawnSync(process.execPath,[path.join(root,'scripts/cloud-inspect.mjs'),...input],{encoding:'utf8',windowsHide:true});assert.ifError(r.error);assert.equal(r.status,code);
  const out=JSON.parse(code?r.stderr:r.stdout);assert.equal(out.state,'NOT_EXECUTED_OFFLINE_ONLY');assert.equal(out.sqlExecutions,0);assert.ok(!r.stdout.includes('create table'));
 }
});
test('path policy rejects file link, parent link and escaped realpath before body read',()=>{
 const owned=path.resolve(root),leaf=path.join(owned,'docs','safe.json'),outside=path.resolve(root,'..','outside-owned-fixture.json');
 const info=(kind,link=false)=>({isDirectory:()=>kind==='dir',isFile:()=>kind==='file',isSymbolicLink:()=>link});
 for(const mode of ['file-link','parent-link','escaped-realpath','not-regular']){
  const fs={lstatSync:p=>info(p===leaf?(mode==='not-regular'?'dir':'file'):'dir',(mode==='file-link'&&p===leaf)||(mode==='parent-link'&&p===path.dirname(leaf))),realpathSync:p=>mode==='escaped-realpath'&&p===leaf?outside:p};
  assert.throws(()=>checkedSourcePath(owned,'docs/safe.json',fs),/source/);
 }
 for(const value of ['../outside','/absolute','docs/../secret','docs\\secret','.',''])assert.throws(()=>checkedSourcePath(owned,value));
});
test('real parent junction/symlink is refused even with byte-identical fixture body',()=>{
 const parent=mkdtempSync(path.join(tmpdir(),'judoju-cloud04a-')),inside=path.join(parent,'product'),outside=path.join(parent,'outside');
 try{
  mkdirSync(inside);mkdirSync(outside);writeFileSync(path.join(outside,'same.json'),'{}');symlinkSync(outside,path.join(inside,'linked'),process.platform==='win32'?'junction':'dir');
  assert.ok(lstatSync(path.join(inside,'linked')).isSymbolicLink());assert.throws(()=>checkedSourcePath(inside,'linked/same.json'),/link\/junction/);
  assert.equal(readFileSync(path.join(outside,'same.json'),'utf8'),'{}');
 }finally{
  assert.equal(path.dirname(path.resolve(parent)),path.resolve(tmpdir()));assert.ok(path.basename(parent).startsWith('judoju-cloud04a-'));rmSync(parent,{recursive:true,force:true});
 }
});
test('regular internal path is readable after boundary validation',()=>{
 const f='docs/cloud/deployment-contract.json',checked=checkedSourcePath(root,f);assert.equal(realpathSync(checked),realpathSync(path.join(root,f)));assert.equal(JSON.parse(readFileSync(checked)).productId,'judoju-news');
});
test('cloud SQL is outside all configured migration/seed and local harness inputs',()=>{
 const read=p=>readFileSync(path.join(root,p),'utf8'),cfg=parseToml(read('supabase/config.toml'));
 assert.equal(cfg.db?.seed?.sql_paths,undefined);assert.equal(cfg.db?.migrations?.schema_paths,undefined);assert.ok(!read('supabase/config.toml').includes('cloud/'));
 for(const f of ['scripts/migrate-local.mjs','scripts/start-local.mjs','scripts/apply-maintenance-local.mjs']){
  assert.ok(read(f).includes("'supabase/migrations'"));assert.ok(!read(f).includes('supabase/cloud'));
 }
});
test('history admits base, one child and only equal-tree hosted two-parent merge',()=>{
 const base='a'.repeat(40),child='b'.repeat(40),merge='c'.repeat(40),bad='d'.repeat(40);
 const f={head:base,base,count:15,parents:[bad],hosted:false,pullRef:null,hostedSha:merge,otherParents:[],otherCount:0,treeEqualsChild:false};
 assert.equal(allowedCloudHistory(f),true);assert.equal(allowedCloudHistory({...f,head:child,count:16,parents:[base]}),true);
 assert.equal(allowedCloudHistory({...f,head:child,count:17,parents:[base]}),false);
 const m={...f,head:merge,count:17,parents:[base,child],hosted:true,pullRef:'verified-shape-only',otherParents:[base],otherCount:16,treeEqualsChild:true};
 assert.equal(allowedCloudHistory(m),true);
 for(const patch of [{treeEqualsChild:false},{hosted:false},{pullRef:null},{hostedSha:bad},{parents:[child,bad]},{otherParents:[bad]},{otherCount:17}])assert.equal(allowedCloudHistory({...m,...patch}),false);
});
test('main must be the reviewed base, current main HEAD, or exact hosted fallback',()=>{
 const base='a'.repeat(40),head='b'.repeat(40),old='c'.repeat(40),f={localMain:base,remoteMain:base,base,branch:'feat/cloud04a-deployment-source',head,hosted:false,pullRef:null};
 assert.equal(allowedCloudMain(f),true);assert.equal(allowedCloudMain({...f,localMain:old}),false);
 assert.equal(allowedCloudMain({...f,remoteMain:old}),false);assert.equal(allowedCloudMain({...f,remoteMain:head}),true);
 assert.equal(allowedCloudMain({...f,localMain:head}),false);assert.equal(allowedCloudMain({...f,localMain:head,branch:'main'}),true);
 assert.equal(allowedCloudMain({...f,localMain:null}),false);
 assert.equal(allowedCloudMain({...f,localMain:null,hosted:true,pullRef:'matching-ref-shape'}),true);
 assert.equal(allowedCloudMain({...f,localMain:null,remoteMain:old,hosted:true,pullRef:'matching-ref-shape'}),false);
});
