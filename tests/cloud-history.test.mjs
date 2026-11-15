import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,lstatSync,realpathSync,mkdtempSync,mkdirSync,writeFileSync,symlinkSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {parse as parseToml} from 'smol-toml';
import {historyInputPaths,readHistoryInputs} from '../scripts/cloud-history-files.mjs';
import {parseHistoryArgs,inspectRecordedHistory,expectedAdoption,parseCloudJson,allowedRecordedHistory} from '../scripts/cloud-history-policy.mjs';
import {allowedCloudMain} from '../scripts/cloud-deployment-policy.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),prefix='supabase/cloud/dev/';
const args=['--environment','preview','--project-ref','nxfpfvsdwbziowkxsxnh'];
const fixture=()=>({args:[...args],inputs:readHistoryInputs(root)});
const serialize=v=>Buffer.from(JSON.stringify(v,null,2)+'\n');
test('stored history is verified offline with explicit precedence and disabled runtime',()=>{
 const f=fixture(),before=Buffer.from(f.inputs[prefix+'adoption.json']),out=inspectRecordedHistory(f);
 assert.equal(out.state,'RECORDED_ADOPTED_DISABLED_OFFLINE_VERIFIED');assert.equal(out.recordedOfficialHistoryAdopted,true);
 assert.equal(out.liveVerified,false);assert.equal(out.sqlExecutions,0);assert.equal(out.networkRequests,0);
 assert.equal(out.appConnected,false);assert.equal(out.workerConnected,false);assert.equal(out.replay,'REPLAY_FORBIDDEN');
 assert.deepEqual(out.historyVersions,['20261114000000','20261114000001']);assert.equal(out.supersedes.length,3);
 assert.ok(out.supersedes.some(s=>s.startsWith('docs/project-resource-manifest.json#')));
 assert.ok(out.supersedes.some(s=>s.startsWith('docs/cloud/deployment-contract.json#')));
 assert.deepEqual(f.inputs[prefix+'adoption.json'],before);
});
for(const [name,bad] of [
 ['missing',args.slice(0,2)],['duplicate',['--environment','preview','--environment','preview']],['unknown',['--env','preview',...args.slice(2)]],
 ['production',['--environment','production',...args.slice(2)]],['prod-ref',[...args.slice(0,3),'zkzevpinuixeuyjlffwi']],
 ['empty-ref',[...args.slice(0,3),'']],['path-ref',[...args.slice(0,3),'../../.env']],['apply',[...args,'--apply','true']],['url',[...args,'--url','https://example.com']]
])test('argument boundary rejects '+name,()=>assert.throws(()=>parseHistoryArgs(bad)));
test('option order has no semantic effect',()=>assert.deepEqual(parseHistoryArgs([...args.slice(2),...args.slice(0,2)]),parseHistoryArgs(args)));
for(const file of historyInputPaths.filter(p=>p.endsWith('.sql')||p.endsWith('.toml'))){
 test('altering stored bytes fails closed: '+file,()=>{const f=fixture();f.inputs[file]=Buffer.from(f.inputs[file]);f.inputs[file][10]^=1;assert.throws(()=>inspectRecordedHistory(f));});
}
for(const [label,mutate] of [
 ['dev ref',r=>r.projectRef=r.production.projectRef],['version',r=>r.sources[1].version='20261114000002'],
 ['statement count',r=>r.sources[0].statementCount=17],['array digest',r=>r.sources[1].statementArraySha256='0'.repeat(64)],
 ['connected',r=>r.runtime.appConnected=true],['API enabled',r=>r.runtime.dataApiDevEnabled=true],['live claim',r=>r.liveVerified=true],
 ['prod adoption',r=>r.production.recordedOfficialHistoryAdopted=true],['unknown field',r=>r.autoApply=true],['precedence removal',r=>r.supersedes=[]],
 ['observation time',r=>r.observedAt='2026-11-14T00:00:00Z'],['receipt digest',r=>r.evidence.remoteProof.sha256='0'.repeat(64)],
 ['config workdir',r=>r.config.purpose='CLI_WORKDIR'],['SQL replay',r=>r.history.originalSqlReplayed=true]
])test('record rejects '+label,()=>{const f=fixture(),r=JSON.parse(f.inputs[prefix+'adoption.json']);mutate(r);f.inputs[prefix+'adoption.json']=serialize(r);assert.throws(()=>inspectRecordedHistory(f),/Exact recorded/);});
test('JSON duplicate keys and alternate representation fail before record interpretation',()=>{
 for(const b of [Buffer.from('{"a":1,"a":2}\n'),Buffer.from('{"a":2}\n')])assert.throws(()=>parseCloudJson(b),/Canonical/);
 const f=fixture();f.inputs[prefix+'adoption.json']=Buffer.from(f.inputs[prefix+'adoption.json'].toString().replace('"schemaVersion": 1','"schemaVersion": 0,\n  "schemaVersion": 1'));assert.throws(()=>inspectRecordedHistory(f),/Canonical/);
});
test('config disabled and source streams isolated from local execution',()=>{
 const f=fixture(),cfg=parseToml(f.inputs[prefix+'config.toml'].toString());
 for(const key of ['api','auth','studio','storage','edge_runtime','analytics'])assert.equal(cfg[key].enabled,false);
 assert.equal(cfg.db.seed.enabled,false);assert.deepEqual(cfg.db.seed.sql_paths,[]);assert.deepEqual(cfg.db.migrations.schema_paths,[]);
 assert.equal(cfg.project_id,'judoju-news-cloud-dev-source');assert.equal(expectedAdoption().config.purpose,'ARCHIVE_NOT_CLI_WORKDIR');
 for(const name of ['migrate-local.mjs','start-local.mjs','apply-maintenance-local.mjs']){const source=readFileSync(path.join(root,'scripts',name),'utf8');assert.ok(source.includes("'supabase/migrations'"));assert.ok(!source.includes('supabase/cloud'));}
 assert.ok(!readFileSync(path.join(root,'supabase/config.toml'),'utf8').includes('cloud/'));
});
test('entire input and directory boundary is checked before first body read',()=>{
 for(const bad of ['late-file','extra-migration','extra-archive','dir-instead-file','escaped-realpath']){
  let reads=0;
  const last=path.join(root,...historyInputPaths.at(-1).split('/'));
  const fs={lstatSync:p=>{if(p===last&&bad==='late-file')throw Error('late-file');if(p===last&&bad==='dir-instead-file')return {isSymbolicLink:()=>false,isFile:()=>false,isDirectory:()=>true};return lstatSync(p);},realpathSync:p=>p===last&&bad==='escaped-realpath'?path.resolve(root,'../outside.json'):realpathSync(p),readFileSync:p=>{reads++;return readFileSync(p);},readdirSync:p=>{const out=readdirSync(p);if(bad==='extra-migration'&&path.basename(p)==='migrations')out.push('99999999999999_unapproved.sql');if(bad==='extra-archive'&&path.basename(p)==='dev')out.push('.temp');return out;}};
  assert.throws(()=>readHistoryInputs(root,fs));assert.equal(reads,0,bad);
 }
});
test('real parent junction rejected before bytes are read and outside remains intact',()=>{
 const parent=mkdtempSync(path.join(tmpdir(),'judoju-cloud04e-')),inside=path.join(parent,'product'),outside=path.join(parent,'outside');
 try{
  mkdirSync(inside);mkdirSync(outside);mkdirSync(path.join(inside,'supabase'));mkdirSync(path.join(inside,'supabase/cloud'));writeFileSync(path.join(outside,'config.toml'),'SENTINEL');
  symlinkSync(outside,path.join(inside,'supabase/cloud/dev'),process.platform==='win32'?'junction':'dir');let reads=0;
  assert.throws(()=>readHistoryInputs(inside,{lstatSync,realpathSync,readdirSync,readFileSync:p=>{reads++;return readFileSync(p);}}),/link\/junction/);assert.equal(reads,0);assert.equal(readFileSync(path.join(outside,'config.toml'),'utf8'),'SENTINEL');
 }finally{assert.equal(path.dirname(path.resolve(parent)),path.resolve(tmpdir()));assert.ok(path.basename(parent).startsWith('judoju-cloud04e-'));rmSync(parent,{recursive:true,force:true});}
});
test('CLI exposes recorded offline result only and reports a generic target error',()=>{
 for(const [input,code] of [[args,0],[['--environment','production',...args.slice(2)],1],[['--apply'],1]]){
  const r=spawnSync(process.execPath,[path.join(root,'scripts/cloud-history-inspect.mjs'),...input],{encoding:'utf8',windowsHide:true});assert.ifError(r.error);assert.equal(r.status,code);
  const out=JSON.parse(code?r.stderr:r.stdout);assert.equal(out.sqlExecutions,0);assert.equal(out.networkRequests,0);assert.ok(!r.stdout.includes('create table'));
  if(code)assert.deepEqual(out,{status:'BLOCKED',state:'NOT_EXECUTED',reason:'INVALID_TARGET_OR_RECORDED_SOURCE',networkRequests:0,sqlExecutions:0});
 }
});
test('history supports exact base, one child and equal-tree hosted merge only',()=>{
 const base='a'.repeat(40),child='b'.repeat(40),merge='c'.repeat(40),bad='d'.repeat(40),f={head:base,count:16,parents:[bad],base,hosted:false,pullRef:null,hostedSha:merge,otherParents:[],otherCount:0,treeEqualsChild:false};
 assert.equal(allowedRecordedHistory(f),true);assert.equal(allowedRecordedHistory({...f,head:child,count:17,parents:[base]}),true);
 for(const patch of [{count:15},{parents:[]},{head:child,count:18,parents:[base]},{head:child,count:17,parents:[bad]}])assert.equal(allowedRecordedHistory({...f,...patch}),false);
 const m={...f,head:merge,count:18,parents:[base,child],hosted:true,pullRef:'verified-shape-only',otherParents:[base],otherCount:17,treeEqualsChild:true};assert.equal(allowedRecordedHistory(m),true);
 for(const patch of [{treeEqualsChild:false},{hosted:false},{pullRef:null},{hostedSha:bad},{parents:[child,bad]},{otherParents:[bad]},{otherCount:16}])assert.equal(allowedRecordedHistory({...m,...patch}),false);
});
test('main guard retains base/head and hosted fallback restrictions',()=>{
 const base='a'.repeat(40),head='b'.repeat(40),old='c'.repeat(40),f={base,head,localMain:base,remoteMain:base,branch:'feat/cloud04e-history-source',hosted:false,pullRef:null};
 assert.equal(allowedCloudMain(f),true);assert.equal(allowedCloudMain({...f,localMain:old}),false);assert.equal(allowedCloudMain({...f,remoteMain:old}),false);assert.equal(allowedCloudMain({...f,localMain:head}),false);
 assert.equal(allowedCloudMain({...f,localMain:head,branch:'main'}),true);assert.equal(allowedCloudMain({...f,localMain:null}),false);assert.equal(allowedCloudMain({...f,localMain:null,hosted:true,pullRef:'exact-ref-shape'}),true);
});
