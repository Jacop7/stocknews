// Stage-specific continuation; historical 0/1/2/3 validators remain intact.
import assert from 'node:assert/strict';
import { readFileSync,realpathSync,lstatSync,existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';
import { allowedHostedPullRef } from './native-release-policy.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const read=p=>readFileSync(path.join(root,p)),json=p=>JSON.parse(read(p)),hash=b=>createHash('sha256').update(b).digest('hex');
const base='c844fe14e62e427d280b58ac023b2c9f1935ed75',initial='f7dce3a9e05c39580f23a210c3ac9d2514c38b74';let checks=0;
const check=(condition,message)=>{assert.ok(condition,message);checks++;};
function git(args,input){const r=spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{input,windowsHide:true});assert.ifError(r.error);return {code:r.status,text:r.stdout.toString('utf8').trim(),bytes:r.stdout};}
check(realpathSync(git(['rev-parse','--show-toplevel']).text)===root,'Independent product root');
check(lstatSync(path.join(root,'.git')).isDirectory()&&!lstatSync(path.join(root,'.git')).isSymbolicLink(),'Own Git directory');
check(realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir']).text))===path.join(root,'.git'),'No shared Git dir');
check(!existsSync(path.join(root,'.git/objects/info/alternates'))&&!existsSync(path.join(root,'.gitmodules')),'No borrowed objects/submodules');
check(git(['config','--local','--name-only','--get-regexp','^(include\\.|includeif\\.|core\\.hookspath$)']).code===1,'No inherited hooks/includes');
for(const name of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])check(!process.env[name],'No Git routing '+name);
check(git(['remote']).text==='origin','One remote');
for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']])check(git(args).text==='https://github.com/Jacop7/stocknews.git','Authorized remote');
const head=git(['rev-parse','HEAD']).text,branch=git(['branch','--show-current']).text,hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews';
check(['main','feat/05-manual-publishing'].includes(branch)||hosted&&!branch&&head===process.env.GITHUB_SHA,'Stage5 branch or verified hosted commit');
check(git(['rev-list','--max-parents=0','HEAD']).text===initial&&git(['merge-base','--is-ancestor',base,'HEAD']).code===0,'Reviewed independent ancestry');
const count=Number(git(['rev-list','--count','HEAD']).text);check(count>=5&&count<=6||hosted&&count===7&&git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).length===3,'Bounded stage4 history');
const allowed=new Set(['main','feat/01-workspace','feat/02-app-admin-shell','spike/03-data-providers','feat/04-db-queue','feat/05-manual-publishing'].flatMap(x=>['refs/heads/'+x,'refs/remotes/origin/'+x]));allowed.add('refs/remotes/origin/HEAD');
const pullRef=allowedHostedPullRef(process.env,head,ref=>{const r=git(['rev-parse','--verify',ref]);return r.code===0?r.text:null;});if(pullRef)allowed.add(pullRef);
check(git(['for-each-ref','--format=%(refname)']).text.split(/\r?\n/).every(ref=>allowed.has(ref)),'Allowed exact refs');
for(const name of git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString('utf8').split('\0').filter(Boolean)){
  let current=root;for(const part of name.split('/')){current=path.join(current,part);check(!lstatSync(current).isSymbolicLink(),'No source symlink '+name);}check(!path.relative(root,realpathSync(current)).startsWith('..'),'Internal source');
}
function validateStatus(s){
  assert.equal(s.currentStage,5);assert.ok(['IMPLEMENTING','IMPLEMENTED_RUNTIME_PENDING','IMPLEMENTED_REVIEW_PENDING','IMPLEMENTED_DEVICE_PENDING'].includes(s.state));
  assert.equal(s.stages.length,13);for(let n=0;n<13;n++){assert.equal(s.stages[n].stage,n);assert.equal(s.stages[n].state,n<3||n===4?'COMPLETE':n===3?'IMPLEMENTED_SUPPLY_PENDING':n===5?s.state:'NOT_STARTED');}
  assert.deepEqual(s.completedStages.map(x=>x.stage),[0,1,2,4]);assert.equal(s.completedStages.find(x=>x.stage===4).commit,base);
  assert.equal(s.implementationStages.find(x=>x.stage===3)?.commit,'3c4a03447e4e0d275eb33941c25c875947766987');assert.equal(s.implementationStages.find(x=>x.stage===4)?.commit,base);
  assert.equal(s.supplyTrack.state,'IMPLEMENTED_SUPPLY_PENDING');assert.equal(s.supplyTrack.realRequestsExecuted,0);assert.equal(s.supplyTrack.liveGate7,'CLOSED');assert.equal(s.supplyTrack.liveGate8,'CLOSED');assert.equal(s.m0.stage5Gate,'PLAN_DUAL_READY');
  assert.equal(s.m1.mode,'LOCAL_SYNTHETIC_MANUAL');assert.equal(s.m1.U05,'PENDING_STAGE6');assert.equal(s.m1.planManifest,'0e69bef02ad49c63bc4ca4da1aabbb3975ebc32088ec1c0a0851892f21734794');
  if(s.m1.ios!=='USER_CONFIRMED_PHYSICAL_M1'||s.m1.android!=='AGENT_OBSERVED_NATIVE_M1')assert.notEqual(s.m1.P03b,'COMPLETE');
}
const status=json('docs/development-status.json');validateStatus(status);checks++;
for(const mutate of [s=>s.stages[3].state='COMPLETE',s=>s.completedStages.push({stage:3}),s=>s.supplyTrack.liveGate7='OPEN',s=>s.supplyTrack.liveGate8='OPEN',s=>s.stages[6].state='COMPLETE']){const bad=structuredClone(status);mutate(bad);assert.throws(()=>validateStatus(bad));checks++;}
const completion=json('docs/stages/stage-04-completion.json');check(completion.complete===true&&completion.caseVerdict==='DUAL_READY'&&completion.postCommitFullVerify==='PASS','Verified stage4 prerequisite');
const provenance=json('docs/reference/provenance.json');assert.equal(provenance.files.length,14);checks++;
const prior=JSON.parse(git(['show',base+':docs/reference/provenance.json']).text);
for(const old of prior.files){assert.deepEqual(provenance.files.find(f=>f.copy===old.copy),old);check(hash(git(['show',base+':'+old.copy]).bytes)===old.sha256,'Previous approved bytes');}
for(const f of provenance.files){const bytes=read(f.copy);check(bytes.length===f.bytes&&hash(bytes)===f.sha256,'Snapshot byte integrity');check(git(['hash-object','--no-filters','--stdin'],bytes).text===git(['hash-object','--path='+f.copy,'--stdin'],bytes).text,'No Git snapshot transformation');}
const resource=json('docs/project-resource-manifest.json'),cfg=parse(read('supabase/config.toml').toString());
check(resource.schemaVersion===2&&resource.productId==='judoju-news'&&resource.productRoot==='.'&&resource.repository.initialCommit===initial,'Portable product resources');
assert.deepEqual(resource.resources.map(r=>r.id).sort(),['expo_eas','supabase_local','supabase_preview','supabase_production','worker_local','worker_preview','worker_production','admin_hosting','push_ads','observability','backups','ci_cd','environment_secrets'].sort());checks++;
check(cfg.project_id==='judoju-news-local'&&resource.plannedLocalConfig.sha256===hash(read('supabase/config.toml')),'Config digest/identity');
assert.deepEqual(resource.plannedLocalConfig.ports,{api:cfg.api.port,db:cfg.db.port,'db.shadow':cfg.db.shadow_port,studio:cfg.studio.port,local_smtp:cfg.local_smtp.port,'local_smtp.smtp':cfg.local_smtp.smtp_port,'local_smtp.pop3':cfg.local_smtp.pop3_port});checks++;
for(const r of resource.resources){
  check(r.plannedNamespace==='judoju-news-'+r.id.replaceAll('_','-'),'Product namespace');
  if(r.id==='expo_eas'){check(r.status==='CREATED'&&r.actual.projectId==='133b3e36-2bcc-4e98-86f5-3f029e37500c','Own EAS');}
  else if(['supabase_local','worker_local'].includes(r.id)){
    check(r.status==='CREATED_LOCAL_MOCK'&&r.environment==='local'&&r.actual.createdNewForProduct===true&&r.actual.productId==='judoju-news'&&r.actual.environment==='local'&&r.actual.sampleKind==='SYNTHETIC','New local synthetic resources');
    if(r.id==='supabase_local')check(r.actual.apiUrl==='http://127.0.0.1:62321'&&r.actual.projectId==='judoju-news-local'&&r.actual.publishedBindings==='127.0.0.1'&&r.actual.networkName==='judoju-news-local-net','Exact loopback product DB');
    else check(r.actual.composeProject==='judoju-news-worker-local'&&r.actual.workers===2&&r.actual.mockSinks===1&&r.actual.hostPorts===0,'Exact internal mock worker');
  }
  else check(r.status==='PENDING'&&r.actual===null,'No fabricated cloud/resource success');
}
for(const file of ['.local-data/runtime/credentials.json','.local-data/runtime/worker.env','supabase/.temp/project-ref','secrets/key.pem','.env','apps/mobile/.env.production','.local-data/runtime/admin-server.json','.local-data/runtime/m1-auth-fixtures.json','.local-data/runtime/public-read.json','apps/admin/.env.local','.codex/runtime.json'])check(git(['check-ignore','--no-index',file]).code===0,'Secret ignore '+file);
check(hash(read('pnpm-lock.yaml'))===hash(git(['show',base+':pnpm-lock.yaml']).bytes),'Lock unchanged');
check(!existsSync(path.join(root,'workers/common/package.json')),'No new worker npm package');
console.log(JSON.stringify({status:'PASS',stage:5,checks,limitations:'Source/frozen-history validation only; runtime and DUAL implementation review remain separate gates.'}));
