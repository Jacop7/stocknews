// New-stage baseline guard. Historical stage validators remain byte-frozen.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {allowedHostedPullRef} from './native-release-policy.mjs';
import {checkedSourcePath,readCloudInputs} from './cloud-source-files.mjs';
import {expectedResource,inspectCloudArtifact,allowedCloudHistory,allowedCloudMain,parseCloudJson} from './cloud-deployment-policy.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),base='94ac7e0c63d51cb646c9406992c26aafccaca0ef';
const hash=b=>createHash('sha256').update(b).digest('hex');let checks=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
function git(args,input){const r=spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{input,windowsHide:true,maxBuffer:64*1024*1024});assert.ifError(r.error);return {code:r.status,text:r.stdout.toString('utf8').trim(),bytes:r.stdout};}
check(realpathSync(git(['rev-parse','--show-toplevel']).text)===root,'Independent product root');
check(lstatSync(path.join(root,'.git')).isDirectory()&&!lstatSync(path.join(root,'.git')).isSymbolicLink(),'Own Git directory');
check(realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir']).text))===path.join(root,'.git'),'No shared Git dir');
check(!existsSync(path.join(root,'.git/objects/info/alternates'))&&!existsSync(path.join(root,'.gitmodules')),'No borrowed objects/submodules');
check(git(['config','--local','--name-only','--get-regexp','^(include\\.|includeif\\.|core\\.hookspath$)']).code===1,'No inherited hooks/includes');
for(const name of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])check(!process.env[name],'No Git routing '+name);
check(git(['remote']).text==='origin','One remote');
for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']])check(git(args).text==='https://github.com/Jacop7/stocknews.git','Authorized remote');
const head=git(['rev-parse','HEAD']).text,branch=git(['branch','--show-current']).text;
const hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews';
check(['main','feat/cloud04a-deployment-source'].includes(branch)||hosted&&!branch&&head===process.env.GITHUB_SHA,'CLOUD04A branch or hosted commit');
check(git(['rev-list','--max-parents=0','HEAD']).text==='f7dce3a9e05c39580f23a210c3ac9d2514c38b74'&&git(['merge-base','--is-ancestor',base,'HEAD']).code===0,'Independent reviewed ancestry');
const parents=git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).slice(1),count=Number(git(['rev-list','--count','HEAD']).text);
const pullRef=allowedHostedPullRef(process.env,head,ref=>{const r=git(['rev-parse','--verify',ref]);return r.code===0?r.text:null;});
const localMain=git(['rev-parse','--verify','refs/heads/main']),remoteMain=git(['rev-parse','--verify','refs/remotes/origin/main']);
check(allowedCloudMain({localMain:localMain.code===0?localMain.text:null,remoteMain:remoteMain.code===0?remoteMain.text:null,base,branch,head,hosted,pullRef}),'Actual CLOUD04A main baseline');
const other=parents.find(p=>p!==base),otherParents=parents.length===2&&other?git(['rev-list','--parents','-n','1',other]).text.split(/\s+/).slice(1):[];
check(allowedCloudHistory({head,count,parents,base,hosted,pullRef,hostedSha:process.env.GITHUB_SHA,otherParents,
  otherCount:parents.length===2&&other?Number(git(['rev-list','--count',other]).text):0,
  treeEqualsChild:parents.length===2&&other?git(['rev-parse',head+'^{tree}']).text===git(['rev-parse',other+'^{tree}']).text:false}),'Exact CLOUD04A base/one-child/equal-tree hosted merge');
const allowed=new Set(['main','feat/01-workspace','feat/02-app-admin-shell','spike/03-data-providers','feat/04-db-queue','feat/05-manual-publishing','feat/06a-catalog-preparation','feat/06b-catalog-settings','feat/06c-search-bookmarks','feat/06d-installation-analytics','feat/06e-reservation-maintenance','feat/07a-market-metrics','feat/07b1-issue-priority','feat/07b2a-home-snapshot','feat/07b2b-home-ranking','feat/cloud04a-deployment-source'].flatMap(x=>['refs/heads/'+x,'refs/remotes/origin/'+x]));allowed.add('refs/remotes/origin/HEAD');if(pullRef)allowed.add(pullRef);
check(git(['for-each-ref','--format=%(refname)']).text.split(/\r?\n/).every(ref=>allowed.has(ref)),'Allowed exact refs');
const actual=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString('utf8').split('\0').filter(Boolean))].sort();
// Boundary checks precede every working-tree body read, including JSON metadata.
for(const f of actual){checkedSourcePath(root,f);checks++;}
const read=p=>readFileSync(checkedSourcePath(root,p)),json=p=>parseCloudJson(read(p));
const tree=git(['ls-tree','-r','-z',base]);assert.equal(tree.code,0);
const entries=tree.bytes.toString('utf8').split('\0').filter(Boolean).map(line=>{const m=/^100(?:644|755) blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(line);assert.ok(m,'Only regular baseline blobs');return {oid:m[1],file:m[2]};});
assert.equal(entries.length,345);
const batch=git(['cat-file','--batch'],entries.map(e=>e.oid).join('\n')+'\n');assert.equal(batch.code,0);const originals=new Map();let offset=0;
for(const entry of entries){const end=batch.bytes.indexOf(10,offset),header=/^([0-9a-f]{40}) blob ([0-9]+)$/.exec(batch.bytes.subarray(offset,end).toString('ascii'));assert.ok(header);assert.equal(header[1],entry.oid);const size=Number(header[2]);offset=end+1;originals.set(entry.file,batch.bytes.subarray(offset,offset+size));assert.equal(batch.bytes[offset+size],10);offset+=size+1;}assert.equal(offset,batch.bytes.length);
const mutable=new Set(['docs/project-resource-manifest.json','docs/development-status.json','package.json','scripts/verify.mjs','scripts/verify-foundation.mjs']);
const additions=['docs/stages/stage-cloud04a-plan.md','docs/stages/stage-cloud04a-approval.json','docs/stages/stage-cloud04a-notes.md','docs/cloud/deployment-contract.json','supabase/cloud/cloud03/guard.sql','supabase/cloud/cloud03/seal.sql','supabase/cloud/cloud03/dev-domain-foundation.sql','supabase/cloud/cloud03/provenance.json','scripts/cloud-deployment-policy.mjs','scripts/cloud-source-files.mjs','scripts/cloud-inspect.mjs','scripts/verify-cloud04a-foundation.mjs','tests/cloud-deployment.test.mjs'];
assert.deepEqual(actual,[...originals.keys(),...additions].sort());checks++;
for(const [f,bytes] of originals)if(!mutable.has(f)){check(read(f).equals(bytes),'Frozen baseline source '+f);}
// Effective attributes can override .gitattributes without changing source bytes.
// Reject executable clean filters before asking Git to compare filtered hashes.
const snapshots=JSON.parse(read('docs/reference/provenance.json')).files;assert.equal(snapshots.length,18);
const attrs=git(['check-attr','-z','text','filter','ident','working-tree-encoding','--',...snapshots.map(f=>f.copy)]);assert.equal(attrs.code,0);
const attrParts=attrs.bytes.toString('utf8').split('\0');assert.equal(attrParts.pop(),'');assert.equal(attrParts.length,18*4*3);
for(let i=0;i<attrParts.length;i+=3){const [file,attribute,value]=attrParts.slice(i,i+3);check(snapshots.some(f=>f.copy===file)&&
  (['text','filter','ident'].includes(attribute)?value==='unset':attribute==='working-tree-encoding'&&['unset','unspecified'].includes(value)),'No effective snapshot transformation attributes');}
for(const snapshot of snapshots){const bytes=read(snapshot.copy);check(bytes.length===snapshot.bytes&&hash(bytes)===snapshot.sha256,'Snapshot byte integrity');
  const raw=git(['hash-object','--no-filters','--stdin'],bytes),filtered=git(['hash-object','--path='+snapshot.copy,'--stdin'],bytes);
  check(raw.code===0&&filtered.code===0&&raw.text===filtered.text,'No Git snapshot transformation');}
for(const file of ['.local-data/runtime/credentials.json','.local-data/runtime/worker.env','supabase/.temp/project-ref','secrets/key.pem','.env','apps/mobile/.env.production','.local-data/runtime/admin-server.json','.local-data/runtime/m1-auth-fixtures.json','.local-data/runtime/public-read.json','apps/admin/.env.local','.codex/runtime.json','.local-data/catalog-previews/result.json','.local-data/runtime/installation-server.json','.local-data/backups/before-stage06d.dump'])check(git(['check-ignore','--no-index',file]).code===0,'Secret ignore '+file);
check(!existsSync(path.join(root,'workers/common/package.json')),'No new worker npm package');
const baselineJson=p=>JSON.parse(originals.get(p));
const manifest=json('docs/project-resource-manifest.json');
for(const id of ['supabase_preview','supabase_production']){
  const row=manifest.resources.find(r=>r.id===id);assert.deepEqual({status:row.status,actual:row.actual},expectedResource(id));
  row.status='PENDING';row.actual=null;
}assert.deepEqual(manifest,baselineJson('docs/project-resource-manifest.json'));checks++;
const approval=json('docs/stages/stage-cloud04a-approval.json');
assert.deepEqual(approval,{stage:'CLOUD04A',state:'APPROVED_DUAL_R2',baseCommit:base,reviewManifest:'a0075b686c65b7c7b7a6bac094ab667ee147c85eaa12cc1a658d28e3acdf8b1e',planSha256:'8f70d19e6fcd7b7075de7f265f55d51e03c35de00244b349459c5a9fbad652e7',claudeKey:'a2c43c5e4efb1aa732a1c67aeeb72e170e336da077977b3ad3a76a60ec9ab674',codexKey:'deb05365d1a8275c0b30b18340c5ed117590d0f6e59b9f8859abf30bf68ee2a7',newFiles:13,mutableFiles:5,remoteMutationsAuthorized:false});checks++;
check(hash(read('docs/stages/stage-cloud04a-plan.md'))===approval.planSha256,'Exact approved plan bytes');
const status=json('docs/development-status.json');assert.deepEqual(status.cloudDeployment,{stage:'CLOUD04A',state:'OFFLINE_SOURCE_ONLY',planManifest:approval.reviewManifest,planSha256:approval.planSha256,appConnected:false,workerConnected:false,officialHistoryAdopted:false,liveSupplyEnabled:false,iPhone:'USER_DEFERRED'});delete status.cloudDeployment;assert.deepEqual(status,baselineJson('docs/development-status.json'));checks++;
const pkg=json('package.json');assert.equal(pkg.scripts['cloud:inspect'],'node scripts/cloud-inspect.mjs');assert.equal(pkg.scripts['test:cloud-deployment'],'node --test tests/cloud-deployment.test.mjs');delete pkg.scripts['cloud:inspect'];delete pkg.scripts['test:cloud-deployment'];assert.deepEqual(pkg,baselineJson('package.json'));checks++;
check(read('scripts/verify.mjs').equals(Buffer.from(originals.get('scripts/verify.mjs').toString('utf8').replace("'check:types'","'test:cloud-deployment','check:types'"))),'Exact full verifier additive test insertion');
check(read('scripts/verify-foundation.mjs').equals(Buffer.from(originals.get('scripts/verify-foundation.mjs').toString('utf8').replace("if(status.homeRankingPreparation?.stage==='7B2B'){","if(status.cloudDeployment?.stage==='CLOUD04A'){\n  await import('./verify-cloud04a-foundation.mjs');\n  await import('./verify-stage3-providers.mjs');\n} else if(status.homeRankingPreparation?.stage==='7B2B'){"))),'Historical dispatcher bytes preserved');
const inputs=readCloudInputs(root),p='supabase/cloud/cloud03/';
const inspected=inspectCloudArtifact({args:['--environment','preview','--project-ref','nxfpfvsdwbziowkxsxnh','--artifact','foundation1'],contract:parseCloudJson(inputs['docs/cloud/deployment-contract.json']),manifest:parseCloudJson(inputs['docs/project-resource-manifest.json']),provenance:parseCloudJson(inputs[p+'provenance.json']),source:inputs['supabase/migrations/20261114000001_m0_foundation.sql'],guard:inputs[p+'guard.sql'],seal:inputs[p+'seal.sql'],deployment:inputs[p+'dev-domain-foundation.sql']});checks++;
console.log(JSON.stringify({status:'PASS',stage:'CLOUD04A_OFFLINE_SOURCE_ONLY',checks,baselineFiles:345,frozenFiles:340,newFiles:13,
  inspected,limitations:'Historical validators preserved but not executed on new file set. Current-stage exact baseline freeze, provider/native checks and full existing test groups remain. No remote health, permissions or runtime readiness certified.'}));
