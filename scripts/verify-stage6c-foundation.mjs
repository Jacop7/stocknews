// 6C continuation. Historical validators/migrations and worker boundaries remain immutable.
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
check(['main','feat/06c-search-bookmarks'].includes(branch)||hosted&&!branch&&head===process.env.GITHUB_SHA,'Stage5 branch or verified hosted commit');
check(git(['rev-list','--max-parents=0','HEAD']).text===initial&&git(['merge-base','--is-ancestor',base,'HEAD']).code===0,'Reviewed independent ancestry');
const count=Number(git(['rev-list','--count','HEAD']).text);check(count>=8&&count<=9||hosted&&count===10&&git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).length===3,'Bounded stage4 history');
const allowed=new Set(['main','feat/01-workspace','feat/02-app-admin-shell','spike/03-data-providers','feat/04-db-queue','feat/05-manual-publishing','feat/06a-catalog-preparation','feat/06b-catalog-settings','feat/06c-search-bookmarks'].flatMap(x=>['refs/heads/'+x,'refs/remotes/origin/'+x]));allowed.add('refs/remotes/origin/HEAD');
const pullRef=allowedHostedPullRef(process.env,head,ref=>{const r=git(['rev-parse','--verify',ref]);return r.code===0?r.text:null;});if(pullRef)allowed.add(pullRef);
check(git(['for-each-ref','--format=%(refname)']).text.split(/\r?\n/).every(ref=>allowed.has(ref)),'Allowed exact refs');
for(const name of git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString('utf8').split('\0').filter(Boolean)){
  let current=root;for(const part of name.split('/')){current=path.join(current,part);check(!lstatSync(current).isSymbolicLink(),'No source symlink '+name);}check(!path.relative(root,realpathSync(current)).startsWith('..'),'Internal source');
}
function validateStatus(s){
 assert.equal(s.currentStage,6);assert.ok(['IMPLEMENTING_SEARCH_BOOKMARKS','IMPLEMENTED_REVIEW_PENDING'].includes(s.state));
 assert.equal(s.stages.length,13);for(let n=0;n<13;n++){assert.equal(s.stages[n].stage,n);if(n===6)assert.equal(s.stages[n].state,s.state);else if(n===5)assert.equal(s.stages[n].state,'IMPLEMENTED_REVIEW_PENDING');else assert.equal(s.stages[n].state,n<3||n===4?'COMPLETE':n===3?'IMPLEMENTED_SUPPLY_PENDING':'NOT_STARTED');}
 assert.deepEqual(s.completedStages.map(x=>x.stage),[0,1,2,4]);assert.equal(s.completedStages.find(x=>x.stage===4).commit,base);
 assert.equal(s.supplyTrack.state,'IMPLEMENTED_SUPPLY_PENDING');assert.equal(s.supplyTrack.realRequestsExecuted,0);assert.equal(s.supplyTrack.liveGate7,'CLOSED');assert.equal(s.supplyTrack.liveGate8,'CLOSED');
 assert.equal(s.m1.mode,'LOCAL_SYNTHETIC_MANUAL');assert.notEqual(s.m1.P03b,'COMPLETE');assert.equal(s.m1.ios,'PENDING_NEW_FLOW');assert.equal(s.m1.U05,'PENDING_STAGE6');
 assert.equal(s.catalogPreparation.commit,'7718693c7c6add5e9019b1c365f67a72c174f3ea');assert.equal(s.catalogPreparation.state,'VERIFIED_LOCAL_OFFLINE');
 assert.equal(s.catalogConnection.stage,'6B');assert.equal(s.catalogConnection.state,'VERIFIED_LOCAL_REFERENCE');assert.equal(s.catalogConnection.realPublicationEnabled,false);assert.equal(s.catalogConnection.nativeGateDeferredByUser,true);
 assert.equal(s.catalogConnection.planManifest,'c1026d481625755c43cbabdd6cd92b6cfbb62e2f53a4231ba2873235ae8c6636');
}
const status=json('docs/development-status.json');validateStatus(status);checks++;
check(status.searchBookmarks?.stage==='6C'&&status.searchBookmarks.realPublicationEnabled===false&&status.searchBookmarks.serverBookmarkSync===false,'Read-only search and device-only storage');
check(status.searchBookmarks.planManifest==='f3d0271b2c5263fc4661e4e247b1c51f533c09d8ba2a29144ba9a14805265d8e','Exact approved6C plan manifest');
check(hash(read('docs/stages/stage-06c-plan.md'))==='f189a8e934e8eb42e60a51d42cc7d87ea1cfdd97b02c1df136801abe60e4aaf2','Approved plan bytes');
check(json('apps/mobile/package.json').dependencies['@react-native-async-storage/async-storage']==='2.2.0','Exact Expo58 storage module');
const beforeApp=JSON.parse(git(['show','73ab52121d6afac6e51a6f26bb181b5bf03f40b3:apps/mobile/package.json']).text),nowApp=json('apps/mobile/package.json');
const withoutStorage=structuredClone(nowApp);delete withoutStorage.dependencies['@react-native-async-storage/async-storage'];assert.deepEqual(withoutStorage,beforeApp);checks++;
for(const key of ['android','ios'])check(json('apps/mobile/app.json').expo[key].runtimeVersion===key+'-native-0005','New native runtime '+key);
check(json('docs/native-release.json').actualBuilds.ios.deviceStatus==='PENDING_NATIVE_CONFIRMATION','New iOS physical evidence not inherited');

for(const mutate of [s=>s.stages[3].state='COMPLETE',s=>s.completedStages.push({stage:3}),s=>s.supplyTrack.liveGate7='OPEN',s=>s.supplyTrack.liveGate8='OPEN',s=>s.m1.P03b='COMPLETE',s=>s.catalogConnection.realPublicationEnabled=true,s=>s.catalogConnection.nativeGateDeferredByUser=false]){const bad=structuredClone(status);mutate(bad);assert.throws(()=>validateStatus(bad));checks++;}
const completion=json('docs/stages/stage-04-completion.json');check(completion.complete===true&&completion.caseVerdict==='DUAL_READY'&&completion.postCommitFullVerify==='PASS','Verified stage4 prerequisite');
const provenance=json('docs/reference/provenance.json');assert.equal(provenance.files.length,17);checks++;
const prior=JSON.parse(git(['show','dd2f97dcbd589760311277f65d72d44f581d7222:docs/reference/provenance.json']).text);
for(const old of prior.files){assert.deepEqual(provenance.files.find(f=>f.copy===old.copy),old);check(hash(git(['show','dd2f97dcbd589760311277f65d72d44f581d7222:'+old.copy]).bytes)===old.sha256,'Previous approved bytes');}
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
check(json('docs/native-release.json').digest==='9c86c77dd9194b4677e470c5d8545f14702dcec773c7fa47f2ac54af740b3dc6','Exact new native0005 input digest, separately verified by unchanged native guard');
check(!existsSync(path.join(root,'workers/common/package.json')),'No new worker npm package');

const catalogBase='73ab52121d6afac6e51a6f26bb181b5bf03f40b3';
check(git(['merge-base','--is-ancestor',catalogBase,'HEAD']).code===0,'6C reviewed6B ancestry');
check(git(['rev-parse','main']).text===catalogBase||branch==='main'&&git(['rev-parse','main']).text===head,'Main reviewed base or committed6C');
check(hash(read('docs/stages/stage-06b-plan.md'))==='c4e7b9d385e14da554a25c1780cf57b9036023428991928e9c31f5d1e13a3931','Exact DUAL reviewed6B plan');
check(hash(read('tests/fixtures/catalog/source-20261114.json'))==='5c86278ab12d16979a1f5fd7a100e15368db2450f1ebcf47e70aced66d84a5d2','Exact frozen source');
check(hash(read('tests/fixtures/catalog/registry-v1.json'))==='160a969756bfd291c81dda390a3490f46ac60bc12eed262e1818e5ba40a03dc6','Exact immutable registry');
const mutable=new Set(["docs/environment-readiness.json","package.json", "apps/mobile/app.json", "apps/mobile/package.json", "pnpm-lock.yaml", "docs/native-release.json", "docs/project-resource-manifest.json", "scripts/verify.mjs", "scripts/verify-foundation.mjs", "docs/development-status.json", "docs/reference/provenance.json", "scripts/public-read-gateway.mjs", "packages/contracts/src/index.ts", "apps/mobile/src/app/_layout.tsx", "apps/mobile/src/app/article/[id].tsx", "apps/mobile/src/app/sector/[id].tsx", "apps/mobile/src/app/search.tsx", "apps/mobile/src/app/(tabs)/saved.tsx", "apps/mobile/src/components/NewsFeed.tsx", "apps/mobile/src/components/Screen.tsx", "apps/mobile/src/data/public-read.ts"]);
for(const file of git(['ls-tree','-r','--name-only',catalogBase]).text.split('\n'))if(!mutable.has(file))check(hash(read(file))===hash(git(['show',catalogBase+':'+file]).bytes),'Unchanged reviewed source/native/lock/old migrations/worker '+file);
for(const file of ['scripts/catalog/parse-catalog.mjs','scripts/catalog/preview-catalog.mjs']){
 const source=read(file).toString();check(!/node:(http|https|net|tls|child_process)|process\.env|fetch\(|supabase|from ['"]\.\.\/\.\.\/apps/.test(source),'6A offline CLI stays network-free');
}
check(git(['check-ignore','--no-index','.local-data/catalog-previews/result.json']).code===0,'Private previews ignored');
for(const file of ['apps/admin/app/api/catalog/[...action]/route.ts','scripts/catalog/public-route.mjs','scripts/test-catalog-operations.mjs','scripts/test-catalog-cursor.mjs','tests/catalog-connection.test.mjs'])check(existsSync(path.join(root,file)),'6B contract verification source '+file);
check(!read('apps/mobile/src/data/public-read.ts').toString().includes('serviceKey'),'Public app has no server capability');
check(read('scripts/verify-stage3-providers.mjs').equals(git(['show',catalogBase+':scripts/verify-stage3-providers.mjs']).bytes),'Provider supply guard unchanged');

console.log(JSON.stringify({status:'PASS',stage:'6C_SEARCH_DEVICE_BOOKMARKS',checks,limitations:'Source isolation, frozen-input and safety gates only; runtime/browser/DUAL/native are separate evidence.'}));
