// New stage guard. Historical validators and all historical non-mutable sources stay byte-frozen.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {allowedHostedPullRef} from './native-release-policy.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),base='99a83e6f6407fb2dd42a1df373f9b1be201ba559',feature='feat/cloud11a-preview-admin-bridge';
const sha=b=>createHash('sha256').update(b).digest('hex');let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
function git(args,input){const r=spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{input,windowsHide:true,maxBuffer:64*1024*1024});assert.ifError(r.error);return {code:r.status,text:r.stdout.toString('utf8').trim(),bytes:r.stdout};}
function read(file){let at=root;for(const [index,part] of file.split('/').entries()){at=path.join(at,part);const s=lstatSync(at);check(!s.isSymbolicLink()&&(index===file.split('/').length-1?s.isFile():s.isDirectory()),'Regular owned source '+file);}const relative=path.relative(root,realpathSync(at));check(relative&&!relative.startsWith('..')&&!path.isAbsolute(relative),'Internal source '+file);return readFileSync(at);}
const json=f=>JSON.parse(read(f));
check(realpathSync(git(['rev-parse','--show-toplevel']).text)===root,'Independent product root');
check(lstatSync(path.join(root,'.git')).isDirectory()&&!lstatSync(path.join(root,'.git')).isSymbolicLink(),'Own Git directory');
check(realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir']).text))===path.join(root,'.git'),'No shared Git directory');
check(!existsSync(path.join(root,'.git/objects/info/alternates'))&&!existsSync(path.join(root,'.gitmodules')),'No borrowed objects/submodules');
check(git(['config','--local','--name-only','--get-regexp','^(include\\.|includeif\\.|core\\.hookspath$)']).code===1,'No inherited Git hooks/includes');
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])check(!process.env[key],'No Git routing '+key);
check(git(['remote']).text==='origin','One remote');
for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']])check(git(args).text==='https://github.com/Jacop7/stocknews.git','Authorized product remote');
const b=json('docs/stages/stage-cloud11a-baseline.json');
check(sha(read('docs/stages/stage-cloud11a-baseline.json'))==='76f657b9a3cbd8d1eddd3b338e409912877ba6b7ce32a2a8eac5d067733ae64e','Frozen CLOUD11A baseline contract');
check(b.baseCommit===base&&Object.keys(b.files).length===423&&b.mutableFiles.length===13&&b.newFiles.length===18,'Exact stage file counts');
const head=git(['rev-parse','HEAD']).text,branch=git(['branch','--show-current']).text,parents=git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).slice(1),count=Number(git(['rev-list','--count','HEAD']).text);
const hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews';
check(['main',feature].includes(branch)||hosted&&!branch&&head===process.env.GITHUB_SHA,'Stage branch or hosted exact commit');
check(git(['rev-list','--max-parents=0','HEAD']).text==='f7dce3a9e05c39580f23a210c3ac9d2514c38b74'&&git(['merge-base','--is-ancestor',base,'HEAD']).code===0,'Independent reviewed ancestry');
const isBase=head===base&&count===25&&parents.length===1;
const isChild=count===26&&parents.length===1&&parents[0]===base;
const other=parents.length===2?parents.find(p=>p!==base):null;
const isMerge=count===27&&parents.length===2&&new Set(parents).size===2&&parents.includes(base)&&other&&git(['rev-list','--parents','-n','1',other]).text.split(/\s+/).slice(1).join(' ')===base&&git(['rev-parse',head+'^{tree}']).text===git(['rev-parse',other+'^{tree}']).text;
check(isBase||isChild||isMerge,'Exact base, one feature child or equal-tree merge');
const refs=new Map(git(['for-each-ref','--format=%(refname) %(objectname)']).text.split(/\r?\n/).filter(Boolean).map(x=>x.split(' ')));
const allowed=new Set([...Object.keys(b.frozenRefs),'refs/heads/main','refs/remotes/origin/main','refs/heads/'+feature,'refs/remotes/origin/'+feature,'refs/remotes/origin/HEAD']);
// actions/checkout stores pull merge refs under refs/remotes/pull, not GITHUB_REF.
const pullRef=allowedHostedPullRef(process.env,head,ref=>refs.get(ref)??null);
if(pullRef)allowed.add(pullRef);
for(const [ref,oid] of refs){check(allowed.has(ref),'Declared ref '+ref);if(b.frozenRefs[ref])check(oid===b.frozenRefs[ref],'Frozen ref '+ref);}
if(!hosted)for(const ref of Object.keys(b.frozenRefs))check(refs.get(ref)===b.frozenRefs[ref],'Retained historical ref '+ref);
for(const ref of ['refs/heads/main','refs/remotes/origin/main']){const value=refs.get(ref);check(hosted&&!value||[base,...(isMerge?[head]:[])].includes(value),'Actual main baseline '+ref);}
for(const ref of ['refs/heads/'+feature,'refs/remotes/origin/'+feature])if(refs.has(ref))check([base,head,other].includes(refs.get(ref)),'Feature ref '+ref);
const actual=git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString('utf8').split('\0').filter(Boolean).sort();
assert.deepEqual(actual,[...Object.keys(b.files),...b.newFiles].sort());checks++;
const tree=git(['ls-tree','-r','-z','--full-tree',base]);check(tree.code===0,'Historical tree readable');
const entries=tree.bytes.toString('utf8').split('\0').filter(Boolean).map(x=>{const [meta,file]=x.split('\t');const [mode,type,oid]=meta.split(' ');check(mode==='100644'&&type==='blob'&&Object.hasOwn(b.files,file),'Regular historical blob');return {file,oid};});check(entries.length===423,'423 historical blobs');
const batch=git(['cat-file','--batch'],entries.map(x=>x.oid).join('\n')+'\n');check(batch.code===0,'Historical object bytes');let offset=0;const original=new Map();
for(const e of entries){const end=batch.bytes.indexOf(10,offset),header=batch.bytes.subarray(offset,end).toString().split(' '),size=Number(header[2]);check(header[0]===e.oid&&header[1]==='blob'&&Number.isSafeInteger(size),'Exact historical object');offset=end+1;const bytes=batch.bytes.subarray(offset,offset+size);original.set(e.file,bytes);check(size===b.files[e.file].bytes&&sha(bytes)===b.files[e.file].sha256,'Historical source '+e.file);offset+=size+1;}
check(offset===batch.bytes.length,'Complete historical stream');
for(const [file,bytes] of original)if(!b.mutableFiles.includes(file))check(read(file).equals(bytes),'Unchanged source '+file);
check(read('apps/admin/lib/runtime-local.mjs').equals(original.get('apps/admin/lib/runtime.mjs')),'Byte-identical historical local admin');
const attrs=git(['check-attr','-z','filter','ident','working-tree-encoding','--',...actual]);check(attrs.code===0,'Effective source attributes');const parts=attrs.bytes.toString('utf8').split('\0');assert.equal(parts.pop(),'');
for(let n=0;n<parts.length;n+=3)check(['unset','unspecified'].includes(parts[n+2]),'No executable source transform '+parts[n]);
for(const file of ['.local-data/cloud-admin/admin-server.json','.local-data/cloud-admin/activation-proof.json','.local-data/cloud-auth/cli-home/access-token','.local-data/cloud-preview/public-config.json','.env','apps/admin/.env.local'])check(git(['check-ignore','--no-index',file]).code===0,'Private path ignored '+file);
const approval=json('docs/stages/stage-cloud11a-approval.json');check(approval.stage==='CLOUD11A'&&approval.state==='PLAN_DUAL_READY_SOURCE_PREPARATION_ONLY'&&approval.baseCommit===base&&approval.planManifest==='ee22b5fecd7133d57ff7e47a758e1853a0ec730caf0bbcd3b822fc7368e663a7'&&approval.remoteMutationsAuthorized===false&&approval.actualKeysRead===0&&approval.adminConnected===false&&approval.workerConnected===false&&approval.M2===false,'Exact inactive plan authority');check(sha(read('docs/stages/stage-cloud11a-plan.md'))===approval.planSha256,'Exact reviewed plan');
const status=json('docs/development-status.json');assert.deepEqual(status.cloudAdminPreviewPreparation,{stage:'CLOUD11A',state:'SOURCE_AND_ISOLATED_TEST_PREPARATION_NOT_ACTIVATED',planManifest:approval.planManifest,registry:'supabase/cloud/admin-preview-dev/preparation.json',actualKeysRead:0,actualRemoteRequests:0,adminConnected:false,workerConnected:false,M2:false,iPhone:'USER_DEFERRED'});delete status.cloudAdminPreviewPreparation;assert.deepEqual(status,JSON.parse(original.get('docs/development-status.json')));checks++;
const prep=json('supabase/cloud/admin-preview-dev/preparation.json');check(prep.stage==='CLOUD11A'&&prep.productId==='judoju-news'&&prep.state==='SOURCE_PREPARED_NOT_ACTIVATED'&&prep.projectRef==='nxfpfvsdwbziowkxsxnh'&&prep.M2===false&&prep.actualRemoteRequests===0&&prep.actualKeysRead===0&&prep.adminConnected===false&&prep.workerConnected===false,'Inactive implementation preparation');
const expectedPins=[...b.mutableFiles,...b.newFiles].filter(x=>x!=='supabase/cloud/admin-preview-dev/preparation.json').sort();assert.deepEqual(Object.keys(prep.sourcePins).sort(),expectedPins);checks++;
for(const file of expectedPins)check(sha(read(file))===prep.sourcePins[file],'Reviewed candidate source pin '+file);
const historicalVerify=original.get('scripts/verify.mjs').toString('utf8'),currentVerify=read('scripts/verify.mjs').toString('utf8');check(historicalVerify.includes("'test:cloud-preview-read','check:types'")&&currentVerify.includes("'test:cloud-preview-read',...(adminPreview?['test:preview-admin']:[]),'check:types'"),'Add preview unit group without removing old groups');
for(const name of ['test:domain','test:providers','test:m0-contracts','test:m1-contracts','test:catalog','test:catalog-connection','test:search-bookmarks','test:installation','test:reservations','test:market-metrics','test:issue-priority','test:home-snapshot','test:home-ranking','test:cloud-deployment','test:cloud-history','test:cloud-core','test:cloud-preview-read','check:types','build:admin','export:android','export:ios'])check(currentVerify.includes("'"+name+"'"),'Historical group retained '+name);
check(!existsSync(path.join(root,'supabase/cloud/admin-preview-dev/config.toml'))&&!existsSync(path.join(root,'supabase/cloud/admin-preview-dev/migrations')),'No automatic hosted migration workdir');
console.log(JSON.stringify({status:'PASS',stage:'CLOUD11A_ADMIN_PREPARATION',checks,baselineFiles:423,mutableFiles:13,newFiles:18,actualKeysRead:0,actualRemoteRequests:0,adminConnected:false,workerConnected:false,M2:false,limitations:'Source/fixture preparation only. Historical validators preserved, new stage dispatch explicit. Actual Auth, key retrieval, hosted SQL, process supervision and activation need separate concrete execution gates and approval.'}));
