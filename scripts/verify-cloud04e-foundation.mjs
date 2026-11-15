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
import {expectedAdoption,inspectRecordedHistory,allowedRecordedHistory} from './cloud-history-policy.mjs';
import {readHistoryInputs} from './cloud-history-files.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),base='a4bbbedfa4137372ac85e9830b42cadadf698f9d';
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
check(['main','feat/cloud04e-history-source'].includes(branch)||hosted&&!branch&&head===process.env.GITHUB_SHA,'CLOUD04E branch or hosted commit');
check(git(['rev-list','--max-parents=0','HEAD']).text==='f7dce3a9e05c39580f23a210c3ac9d2514c38b74'&&git(['merge-base','--is-ancestor',base,'HEAD']).code===0,'Independent reviewed ancestry');
const parents=git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).slice(1),count=Number(git(['rev-list','--count','HEAD']).text);
const pullRef=allowedHostedPullRef(process.env,head,ref=>{const r=git(['rev-parse','--verify',ref]);return r.code===0?r.text:null;});
const localMain=git(['rev-parse','--verify','refs/heads/main']),remoteMain=git(['rev-parse','--verify','refs/remotes/origin/main']);
check(allowedCloudMain({localMain:localMain.code===0?localMain.text:null,remoteMain:remoteMain.code===0?remoteMain.text:null,base,branch,head,hosted,pullRef}),'Actual CLOUD04E main baseline');
const other=parents.find(p=>p!==base),otherParents=parents.length===2&&other?git(['rev-list','--parents','-n','1',other]).text.split(/\s+/).slice(1):[];
check(allowedRecordedHistory({head,count,parents,base,hosted,pullRef,hostedSha:process.env.GITHUB_SHA,otherParents,
  otherCount:parents.length===2&&other?Number(git(['rev-list','--count',other]).text):0,
  treeEqualsChild:parents.length===2&&other?git(['rev-parse',head+'^{tree}']).text===git(['rev-parse',other+'^{tree}']).text:false}),'Exact CLOUD04E base/one-child/equal-tree hosted merge');
const allowed=new Set(['main','feat/01-workspace','feat/02-app-admin-shell','spike/03-data-providers','feat/04-db-queue','feat/05-manual-publishing','feat/06a-catalog-preparation','feat/06b-catalog-settings','feat/06c-search-bookmarks','feat/06d-installation-analytics','feat/06e-reservation-maintenance','feat/07a-market-metrics','feat/07b1-issue-priority','feat/07b2a-home-snapshot','feat/07b2b-home-ranking','feat/cloud04a-deployment-source','feat/cloud04e-history-source'].flatMap(x=>['refs/heads/'+x,'refs/remotes/origin/'+x]));allowed.add('refs/remotes/origin/HEAD');if(pullRef)allowed.add(pullRef);
check(git(['for-each-ref','--format=%(refname)']).text.split(/\r?\n/).every(ref=>allowed.has(ref)),'Allowed exact refs');
const actual=[...new Set(git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString('utf8').split('\0').filter(Boolean))].sort();
// Boundary checks precede every working-tree body read, including JSON metadata.
for(const f of actual){checkedSourcePath(root,f);checks++;}
const read=p=>readFileSync(checkedSourcePath(root,p)),json=p=>parseCloudJson(read(p));
const tree=git(['ls-tree','-r','-z',base]);assert.equal(tree.code,0);
const entries=tree.bytes.toString('utf8').split('\0').filter(Boolean).map(line=>{const m=/^100(?:644|755) blob ([0-9a-f]{40})\t([\s\S]+)$/.exec(line);assert.ok(m,'Only regular baseline blobs');return {oid:m[1],file:m[2]};});
assert.equal(entries.length,358);
const batch=git(['cat-file','--batch'],entries.map(e=>e.oid).join('\n')+'\n');assert.equal(batch.code,0);const originals=new Map();let offset=0;
for(const entry of entries){const end=batch.bytes.indexOf(10,offset),header=/^([0-9a-f]{40}) blob ([0-9]+)$/.exec(batch.bytes.subarray(offset,end).toString('ascii'));assert.ok(header);assert.equal(header[1],entry.oid);const size=Number(header[2]);offset=end+1;originals.set(entry.file,batch.bytes.subarray(offset,offset+size));assert.equal(batch.bytes[offset+size],10);offset+=size+1;}assert.equal(offset,batch.bytes.length);
const mutable=new Set(['docs/development-status.json','package.json','scripts/verify.mjs','scripts/verify-foundation.mjs']);
const additions=["docs/stages/stage-cloud04e-plan.md", "docs/stages/stage-cloud04e-approval.json", "docs/stages/stage-cloud04e-notes.md", "supabase/cloud/dev/config.toml", "supabase/cloud/dev/migrations/20261114000000_cloud02_dev_control.sql", "supabase/cloud/dev/migrations/20261114000001_cloud03_dev_domain_foundation.sql", "supabase/cloud/dev/adoption.json", "scripts/cloud-history-policy.mjs", "scripts/cloud-history-files.mjs", "scripts/cloud-history-inspect.mjs", "scripts/verify-cloud04e-foundation.mjs", "tests/cloud-history.test.mjs"];
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
const approval=json('docs/stages/stage-cloud04e-approval.json');
assert.deepEqual(approval,{"stage": "CLOUD04E", "state": "APPROVED_DUAL_R1", "baseCommit": "a4bbbedfa4137372ac85e9830b42cadadf698f9d", "reviewManifest": "ca40473c1c24a09b2fbc015f0178b29301565dc353243f0ea9d24bbd93a1c8d7", "planSha256": "41ce7ccc3ecb0f3eadea54622cc56f0cbaa7534e83d754928a7cc1709607ef70", "claudeKey": "0fad75873f1cc27081b8d5fcdf5dfaf484d7b9b81bec79dddaaa3ebad9f2e66d", "codexKey": "936d6fc895a5a15688ce59828d79768e7bd823103b67662b9bed9f1dce69be6f", "newFiles": 12, "mutableFiles": 4, "remoteMutationsAuthorized": false});checks++;
check(hash(read('docs/stages/stage-cloud04e-plan.md'))===approval.planSha256,'Exact approved plan bytes');
const record=expectedAdoption(),status=json('docs/development-status.json');
assert.deepEqual(status.cloudHistory,{"stage": "CLOUD04E", "state": "RECORDED_ADOPTED_DISABLED", "registry": "supabase/cloud/dev/adoption.json", "planManifest": "ca40473c1c24a09b2fbc015f0178b29301565dc353243f0ea9d24bbd93a1c8d7", "planSha256": "41ce7ccc3ecb0f3eadea54622cc56f0cbaa7534e83d754928a7cc1709607ef70", "recordedOfficialHistoryAdopted": true, "liveVerified": false, "appConnected": false, "workerConnected": false, "supersedes": ["docs/project-resource-manifest.json#resources.supabase_preview.actual.officialHistoryAdopted", "docs/cloud/deployment-contract.json#officialHistoryAdopted", "docs/development-status.json#cloudDeployment.officialHistoryAdopted"]});
assert.deepEqual(status.cloudHistory.supersedes,record.supersedes,'Latest recorded history supersedes only listed historical fields');delete status.cloudHistory;assert.deepEqual(status,baselineJson('docs/development-status.json'));checks++;
const pkg=json('package.json');assert.equal(pkg.scripts['cloud:history:inspect'],'node scripts/cloud-history-inspect.mjs');assert.equal(pkg.scripts['test:cloud-history'],'node --test tests/cloud-history.test.mjs');delete pkg.scripts['cloud:history:inspect'];delete pkg.scripts['test:cloud-history'];assert.deepEqual(pkg,baselineJson('package.json'));checks++;
check(read('scripts/verify.mjs').equals(Buffer.from(originals.get('scripts/verify.mjs').toString('utf8').replace("'test:cloud-deployment','check:types'","'test:cloud-deployment','test:cloud-history','check:types'"))),'Exact additive full verifier group');
check(read('scripts/verify-foundation.mjs').equals(Buffer.from(originals.get('scripts/verify-foundation.mjs').toString('utf8').replace("if(status.cloudDeployment?.stage==='CLOUD04A'){","if(status.cloudHistory?.stage==='CLOUD04E'){\n  await import('./verify-cloud04e-foundation.mjs');\n  await import('./verify-stage3-providers.mjs');\n} else if(status.cloudDeployment?.stage==='CLOUD04A'){"))),'Historical dispatcher preserved');
const inspected=inspectRecordedHistory({args:['--environment','preview','--project-ref','nxfpfvsdwbziowkxsxnh'],inputs:readHistoryInputs(root)});checks++;
const cloudSources=[record.config.path,...record.sources.map(s=>s.path)];
// Reject executable filters before asking Git to transform cloud source bytes.
const cloudAttrs=git(['check-attr','-z','filter','ident','working-tree-encoding','--',...cloudSources]);assert.equal(cloudAttrs.code,0);
const cloudAttrParts=cloudAttrs.bytes.toString('utf8').split('\0');assert.equal(cloudAttrParts.pop(),'');assert.equal(cloudAttrParts.length,cloudSources.length*9);
for(let i=0;i<cloudAttrParts.length;i+=3){const [file,attribute,value]=cloudAttrParts.slice(i,i+3);check(cloudSources.includes(file)&&['filter','ident','working-tree-encoding'].includes(attribute)&&['unset','unspecified'].includes(value),'No effective cloud source filter/encoding');}
for(const p of cloudSources){const bytes=read(p);check(!bytes.includes(13),'Cloud source LF bytes');const raw=git(['hash-object','--no-filters','--stdin'],bytes),filtered=git(['hash-object','--path='+p,'--stdin'],bytes);check(raw.code===0&&filtered.code===0&&raw.text===filtered.text,'No Git cloud source transformation');}
for(const p of ['scripts/migrate-local.mjs','scripts/start-local.mjs','scripts/apply-maintenance-local.mjs'])check(read(p).toString().includes("'supabase/migrations'")&&!read(p).toString().includes('supabase/cloud'),'Cloud archive outside local execution stream');
check(!read('supabase/config.toml').toString().includes('cloud/'),'Root config does not route to cloud archive');
console.log(JSON.stringify({status:'PASS',stage:'CLOUD04E_RECORDED_HISTORY_ONLY',checks,baselineFiles:358,frozenFiles:354,newFiles:12,inspected,limitations:'Historical validators preserved, current baseline boundaries checked here. Offline recorded source/history only, not live connection or deployment approval.'}));
