import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,realpathSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {checkedCoreSource,coreInputPaths,readCoreInputs} from '../scripts/cloud-core-files.mjs';
import {parseCoreArgs,inspectRecordedCore,expectedCoreAdoption,parseCloudJson,allowedCoreHistory} from '../scripts/cloud-core-policy.mjs';
import {allowedCloudMain} from '../scripts/cloud-deployment-policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),prefix='supabase/cloud/core-dev/';
const args=['--environment','preview','--project-ref','nxfpfvsdwbziowkxsxnh'];
const fixture=()=>({args:[...args],inputs:readCoreInputs(root)}),serialize=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
test('current recorded core distinguishes the historical observation and never activates runtime',()=>{
 const f=fixture(),out=inspectRecordedCore(f),r=expectedCoreAdoption();
 assert.equal(out.state,'RECORDED_DEV_DISABLED_CORE_OFFLINE_VERIFIED');assert.equal(out.context,'CURRENT_RECORDED_CORE');assert.equal(out.historyRows,3);assert.equal(out.functions,32);
 assert.deepEqual(out.historyVersions,['20261114000000','20261114000001','20261115000101']);assert.equal(out.historicalBase.historyRows,2);assert.equal(out.historicalBase.context,'HISTORICAL_CLOUD04D_TRACKING_ONLY');
 assert.ok(out.observedAt>out.historicalBase.observedAt);assert.equal(out.liveVerified,false);assert.equal(out.appConnected,false);assert.equal(out.workerConnected,false);assert.equal(out.networkRequests,0);assert.equal(out.sqlExecutions,0);assert.equal(out.replay,'REPLAY_FORBIDDEN');
 assert.equal(r.snapshots.dev.fingerprintBefore,'3e1ea72466621695b654701ab808caa4fd125e17263e325a8e698a4813bfa3dc');assert.equal(r.snapshots.dev.fingerprintAfter,r.postBaseline.devFingerprint);
 assert.equal(r.sources[2].statementCount,46);assert.equal(r.sources[2].statementCharacters,88541);assert.equal(r.sources[2].bytes,88750);assert.equal(r.supersedes.length,4);
});
for(const [name,bad] of [
 ['missing',args.slice(0,2)],['duplicate',['--environment','preview','--environment','preview']],['unknown',['--env','preview',...args.slice(2)]],
 ['production',['--environment','production',...args.slice(2)]],['prod-ref',[...args.slice(0,3),'zkzevpinuixeuyjlffwi']],['empty-ref',[...args.slice(0,3),'']],
 ['path-ref',[...args.slice(0,3),'../../.env']],['apply',[...args,'--apply','true']],['url',[...args,'--url','https://example.com']]
])test('explicit argument boundary rejects '+name,()=>assert.throws(()=>parseCoreArgs(bad)));
test('option order has no semantic effect',()=>assert.deepEqual(parseCoreArgs([...args.slice(2),...args.slice(0,2)]),parseCoreArgs(args)));
for(const file of coreInputPaths.filter(p=>p.endsWith('.sql')||p.endsWith('.toml'))){
 test('altered source bytes rejected '+file,()=>{const f=fixture();f.inputs[file]=Buffer.from(f.inputs[file]);f.inputs[file][12]^=1;assert.throws(()=>inspectRecordedCore(f));});
}
for(const [name,change] of [
 ['ref',r=>r.projectRef=r.production.projectRef],['new version',r=>r.sources[2].version='20261115000102'],['statement count',r=>r.sources[2].statementCount=45],
 ['native array hash',r=>r.sources[2].statementArraySha256='0'.repeat(64)],['before chain',r=>r.snapshots.dev.fingerprintBefore='0'.repeat(64)],['after baseline',r=>r.postBaseline.devFingerprint='0'.repeat(64)],
 ['historical hash',r=>r.historicalBase.sha256='0'.repeat(64)],['selectors',r=>r.supersedes=[]],['API activation',r=>r.runtime.dataApiDevEnabled=true],
 ['worker activation',r=>r.runtime.workerConnected=true],['live claim',r=>r.liveVerified=true],['prod write',r=>r.production.writes=1],['extra field',r=>r.execute=true],
 ['evidence SHA',r=>r.evidence.status.sha256='0'.repeat(64)],['core execute rights',r=>r.core.publicAndApiExecutePrivileges=1]
])test('record rejects '+name,()=>{const f=fixture(),r=JSON.parse(f.inputs[prefix+'adoption.json']);change(r);f.inputs[prefix+'adoption.json']=serialize(r);assert.throws(()=>inspectRecordedCore(f),/Exact recorded core/);});
test('duplicate JSON keys and noncanonical representations are rejected before interpretation',()=>{
 assert.throws(()=>parseCloudJson(Buffer.from('{"x":1,"x":2}\n')),/Canonical/);
 const f=fixture();f.inputs[prefix+'adoption.json']=Buffer.from(f.inputs[prefix+'adoption.json'].toString().replace('"schemaVersion": 1','"schemaVersion": 0,\n  "schemaVersion": 1'));assert.throws(()=>inspectRecordedCore(f),/Canonical/);
});
test('all file and archive directory checks precede the first body read',()=>{
 for(const bad of ['late-file','extra-core','extra-historical','nonregular','escaped-realpath']){
  let reads=0;const last=path.join(root,...coreInputPaths.at(-1).split('/'));
  const fs={lstatSync:p=>{if(p===last&&bad==='late-file')throw Error('missing');if(p===last&&bad==='nonregular')return {isSymbolicLink:()=>false,isFile:()=>false,isDirectory:()=>true};return lstatSync(p);},realpathSync:p=>p===last&&bad==='escaped-realpath'?path.resolve(root,'../outside.sql'):realpathSync(p),readFileSync:p=>{reads++;return readFileSync(p);},readdirSync:p=>{const out=readdirSync(p);if(bad==='extra-core'&&path.basename(p)==='core-dev'||bad==='extra-historical'&&path.basename(p)==='dev')out.push('.temp');return out;}};
  assert.throws(()=>readCoreInputs(root,fs));assert.equal(reads,0,bad);
 }
});
test('arbitrary, drive, traversal and credential paths are refused before filesystem access',()=>{
 for(const relative of ['/etc/passwd','C:/Users/other/.env','../.env','supabase/../.env','supabase\\cloud\\core-dev\\adoption.json','.local-data/cloud-auth/cli-home/access-token','secrets/key.pem','apps/mobile/.env']){
  let calls=0;const fs={lstatSync:()=>{calls++;throw Error('not called');},realpathSync:()=>{calls++;throw Error('not called');}};
  assert.throws(()=>checkedCoreSource(root,relative,fs),/Fixed noncredential/);assert.equal(calls,0);
 }
});
test('real parent junction is refused before body access and leaves the outside sentinel intact',()=>{
 const parent=mkdtempSync(path.join(tmpdir(),'judoju-cloud05c-')),inside=path.join(parent,'product'),outside=path.join(parent,'outside');
 try{
  mkdirSync(inside);mkdirSync(outside);mkdirSync(path.join(inside,'supabase'));mkdirSync(path.join(inside,'supabase/cloud'));writeFileSync(path.join(outside,'config.toml'),'SENTINEL');
  symlinkSync(outside,path.join(inside,'supabase/cloud/dev'),process.platform==='win32'?'junction':'dir');let reads=0;
  assert.throws(()=>readCoreInputs(inside,{lstatSync,realpathSync,readdirSync,readFileSync:p=>{reads++;return readFileSync(p);}}),/link\/junction/);assert.equal(reads,0);assert.equal(readFileSync(path.join(outside,'config.toml'),'utf8'),'SENTINEL');
 }finally{assert.equal(path.dirname(path.resolve(parent)),path.resolve(tmpdir()));assert.ok(path.basename(parent).startsWith('judoju-cloud05c-'));rmSync(parent,{recursive:true,force:true});}
});
test('CLI returns only recorded offline context, or a generic target error',()=>{
 for(const [input,code] of [[args,0],[['--environment','production',...args.slice(2)],1],[['--apply'],1]]){
  const r=spawnSync(process.execPath,[path.join(root,'scripts/cloud-core-inspect.mjs'),...input],{encoding:'utf8',windowsHide:true});assert.ifError(r.error);assert.equal(r.status,code);const out=JSON.parse(code?r.stderr:r.stdout);
  assert.equal(out.sqlExecutions,0);assert.equal(out.networkRequests,0);assert.ok(!r.stdout.includes('CREATE OR REPLACE FUNCTION'));
  if(code)assert.deepEqual(out,{status:'BLOCKED',state:'NOT_EXECUTED',reason:'INVALID_TARGET_OR_RECORDED_CORE',networkRequests:0,sqlExecutions:0});
 }
});
test('history permits exact base, one child or equal-tree verified hosted merge only',()=>{
 const base='a'.repeat(40),child='b'.repeat(40),merge='c'.repeat(40),bad='d'.repeat(40),f={head:base,count:17,parents:[bad],base,hosted:false,pullRef:null,hostedSha:merge,otherParents:[],otherCount:0,treeEqualsChild:false};
 assert.equal(allowedCoreHistory(f),true);assert.equal(allowedCoreHistory({...f,head:child,count:18,parents:[base]}),true);
 for(const patch of [{count:16},{parents:[]},{head:child,count:19,parents:[base]},{head:child,count:18,parents:[bad]}])assert.equal(allowedCoreHistory({...f,...patch}),false);
 const m={...f,head:merge,count:19,parents:[base,child],hosted:true,pullRef:'verified-shape-only',otherParents:[base],otherCount:18,treeEqualsChild:true};assert.equal(allowedCoreHistory(m),true);
 for(const patch of [{treeEqualsChild:false},{hosted:false},{pullRef:null},{hostedSha:bad},{parents:[child,bad]},{otherParents:[bad]},{otherCount:17}])assert.equal(allowedCoreHistory({...m,...patch}),false);
});
test('main guard preserves base, branch and hosted fallback restrictions',()=>{
 const base='a'.repeat(40),head='b'.repeat(40),old='c'.repeat(40),f={base,head,localMain:base,remoteMain:base,branch:'feat/cloud05c-core-archive',hosted:false,pullRef:null};
 assert.equal(allowedCloudMain(f),true);assert.equal(allowedCloudMain({...f,localMain:old}),false);assert.equal(allowedCloudMain({...f,remoteMain:old}),false);assert.equal(allowedCloudMain({...f,localMain:head}),false);
 assert.equal(allowedCloudMain({...f,localMain:head,branch:'main'}),true);assert.equal(allowedCloudMain({...f,localMain:null}),false);assert.equal(allowedCloudMain({...f,localMain:null,hosted:true,pullRef:'exact-ref-shape'}),true);
});
test('policy remains pure and source archives remain outside local execution paths',()=>{
 const policy=readFileSync(path.join(root,'scripts/cloud-core-policy.mjs'),'utf8');assert.ok(!/process\.|fetch\(|node:(?:fs|http|https|child_process)|supabase-js/.test(policy));
 for(const file of ['migrate-local.mjs','start-local.mjs','apply-maintenance-local.mjs']){const s=readFileSync(path.join(root,'scripts',file),'utf8');assert.ok(s.includes("'supabase/migrations'"));assert.ok(!s.includes('supabase/cloud'));}
 assert.ok(!readFileSync(path.join(root,'supabase/config.toml'),'utf8').includes('cloud/'));
});
