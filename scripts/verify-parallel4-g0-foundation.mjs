// Explicit source-only transition; does not authorize a child, worktree or real connection.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {allowedHostedPullRef} from './native-release-policy.mjs';
import {parallel4Readiness} from './parallel4-readiness.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),base='553a14e4b0d54b90901f1adf51fa51f033bcf853',feature='feat/parallel4-g0-contracts';
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;},sha=b=>createHash('sha256').update(b).digest('hex');
function git(args,input){const r=spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{input,windowsHide:true,maxBuffer:64*1024*1024});assert.ifError(r.error);return {code:r.status,text:r.stdout.toString('utf8').trim(),bytes:r.stdout};}
function read(file){let at=root;const parts=file.split('/');check(parts.every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\\')&&!p.includes(':')),'Relative source');for(const [i,p] of parts.entries()){at=path.join(at,p);const s=lstatSync(at);check(!s.isSymbolicLink()&&(i===parts.length-1?s.isFile():s.isDirectory()),'Owned regular source '+file);}check(!path.relative(root,realpathSync(at)).startsWith('..'),'Internal source');return readFileSync(at);}
const json=f=>JSON.parse(read(f));
check(realpathSync(git(['rev-parse','--show-toplevel']).text)===root,'Independent product root');
check(lstatSync(path.join(root,'.git')).isDirectory()&&!lstatSync(path.join(root,'.git')).isSymbolicLink(),'Own Git, no worktree transition yet');
check(realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir']).text))===path.join(root,'.git'),'No shared Git');
check(!existsSync(path.join(root,'.git/objects/info/alternates'))&&!existsSync(path.join(root,'.gitmodules')),'No borrowed Git');
check(git(['config','--local','--name-only','--get-regexp','^(include\\.|includeif\\.|core\\.hookspath$)']).code===1,'No inherited hooks');
for(const k of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])check(!process.env[k],'No Git routing '+k);
check(git(['remote']).text==='origin','Only own remote');for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']])check(git(args).text==='https://github.com/Jacop7/stocknews.git','Authorized remote');
check(sha(read('docs/stages/stage-parallel4-g0a-baseline.json'))==='47dd9c483ad53a62a23d070c7895aaefe855f082e4f0802635b178a1df65ac20','Frozen 441-file authority');
const b=json('docs/stages/stage-parallel4-g0a-baseline.json');check(b.baseCommit===base&&b.baseCount===26&&b.feature===feature&&Object.keys(b.files).length===441&&b.mutableFiles.length===6&&b.newFiles.length===10,'Exact transition scope');
const head=git(['rev-parse','HEAD']).text,branch=git(['branch','--show-current']).text,parents=git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).slice(1),count=Number(git(['rev-list','--count','HEAD']).text);
const hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews';
const isBase=head===base&&count===26,isChild=count===27&&parents.length===1&&parents[0]===base;
const other=parents.length===2?parents.find(p=>p!==b.refs['refs/heads/main']):null;
const isHostedMerge=hosted&&count===28&&parents.length===2&&new Set(parents).size===2&&parents.includes(b.refs['refs/heads/main'])&&other&&git(['rev-list','--parents','-n','1',other]).text.split(/\s+/).slice(1).join(' ')===base&&git(['rev-parse',head+'^{tree}']).text===git(['rev-parse',other+'^{tree}']).text;
check(isBase||isChild||isHostedMerge,'Reviewed base, one feature child or exact hosted equal-tree PR merge');
check(branch===feature||isBase&&branch==='feat/cloud11a-preview-admin-bridge'||hosted&&!branch&&head===process.env.GITHUB_SHA,'Preparation feature branch');
check(git(['rev-list','--max-parents=0','HEAD']).text==='f7dce3a9e05c39580f23a210c3ac9d2514c38b74','New product ancestry');
const refs=new Map(git(['for-each-ref','--format=%(refname) %(objectname)']).text.split(/\r?\n/).filter(Boolean).map(s=>s.split(' '))),allowed=new Set([...Object.keys(b.refs),'refs/heads/'+feature,'refs/remotes/origin/'+feature,'refs/remotes/origin/HEAD']);
const pullRef=allowedHostedPullRef(process.env,head,ref=>refs.get(ref)??null);if(pullRef)allowed.add(pullRef);
for(const [ref,oid] of refs){check(allowed.has(ref),'Declared ref '+ref);if(Object.hasOwn(b.refs,ref))check(oid===b.refs[ref],'Frozen ref '+ref);else check(oid===base||oid===head||isHostedMerge&&oid===other,'Only preparation refs');}
if(!hosted)for(const [ref,oid] of Object.entries(b.refs))check(refs.get(ref)===oid,'Retained historical ref '+ref);
const actual=git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString().split('\0').filter(Boolean).sort();assert.deepEqual(actual,[...Object.keys(b.files),...b.newFiles].sort());checks++;
const entries=git(['ls-tree','-r','-z','--full-tree',base]).bytes.toString().split('\0').filter(Boolean).map(x=>{const [meta,file]=x.split('\t'),[mode,type,oid]=meta.split(' ');check(mode==='100644'&&type==='blob'&&Object.hasOwn(b.files,file),'Historical regular blob');return {file,oid};});check(entries.length===441,'441 base blobs');
const batch=git(['cat-file','--batch'],entries.map(x=>x.oid).join('\n')+'\n');check(batch.code===0,'Historical bytes');let offset=0;const original=new Map();
for(const e of entries){const end=batch.bytes.indexOf(10,offset),[oid,type,n]=batch.bytes.subarray(offset,end).toString().split(' '),size=Number(n);check(oid===e.oid&&type==='blob'&&Number.isSafeInteger(size),'Original object');offset=end+1;const bytes=batch.bytes.subarray(offset,offset+size);check(size===b.files[e.file].bytes&&sha(bytes)===b.files[e.file].sha256,'Exact base '+e.file);original.set(e.file,bytes);if(!b.mutableFiles.includes(e.file))check(read(e.file).equals(bytes),'Unchanged '+e.file);offset+=size+1;}
check(offset===batch.bytes.length,'Complete original stream');
const prep=json('docs/stages/stage-parallel4-g0a-preparation.json'),pins=[...b.mutableFiles,...b.newFiles].filter(f=>f!=='docs/stages/stage-parallel4-g0a-preparation.json').sort();assert.deepEqual(Object.keys(prep.sourcePins).sort(),pins);checks++;
for(const file of pins)check(sha(read(file))===prep.sourcePins[file],'Candidate pin '+file);
check(prep.stage==='PARALLEL4_G0A'&&prep.state==='SOURCE_PREPARED_REVIEW_PENDING_NOT_ACTIVATED'&&prep.planManifest==='f2639973c41691d3b91cea12220d11a509db178e866f3cce598077b0a6ae7077'&&prep.forksCreated===0&&prep.actualKeysRead===0&&prep.actualRemoteRequests===0&&prep.readIsolationVerified===false&&prep.M2===false,'Honest inactive preparation');
const status=json('docs/development-status.json'),parallel=status.parallelDevelopmentPreparation;delete status.parallelDevelopmentPreparation;assert.deepEqual(status,JSON.parse(original.get('docs/development-status.json')));check(parallel.stage===prep.stage&&parallel.state==='CONTRACT_SOURCE_PREPARATION_NOT_ACTIVATED'&&parallel.planManifest===prep.planManifest&&parallel.forksCreated===0&&parallel.messagesDispatched===0&&parallel.readIsolationVerified===false&&parallel.adminConnected===false&&parallel.workerConnected===false&&parallel.M2===false,'Only honest stage addition');
const oldPackage=JSON.parse(original.get('package.json')),pkg=json('package.json');check(pkg.scripts['test:pipeline-contracts']==='node --experimental-strip-types --test tests/pipeline-contracts.test.ts'&&pkg.scripts['test:parallel4-readiness']==='node --test tests/parallel4-readiness.test.mjs','Exact new groups');delete pkg.scripts['test:pipeline-contracts'];delete pkg.scripts['test:parallel4-readiness'];assert.deepEqual(pkg,oldPackage);checks++;
let expected=original.get('scripts/verify.mjs').toString().replace('const results = [];',"const results = [];\nconst parallel4=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).parallelDevelopmentPreparation?.stage==='PARALLEL4_G0A';").replace("adminPreview?'verify-cloud11a-foundation.mjs'","parallel4?'verify-parallel4-g0-foundation.mjs':adminPreview?'verify-cloud11a-foundation.mjs'").replace("'check:types','build:admin'","...(parallel4?['test:pipeline-contracts','test:parallel4-readiness']:[]),'check:types','build:admin'");check(read('scripts/verify.mjs').toString()===expected,'All 26 groups retained plus two');
expected=original.get('scripts/verify-foundation.mjs').toString().replace("if(status.cloudAdminPreviewPreparation?.stage==='CLOUD11A'){","if(status.parallelDevelopmentPreparation?.stage==='PARALLEL4_G0A'){\n  await import('./verify-parallel4-g0-foundation.mjs');\n  await import('./verify-stage3-providers.mjs');\n} else if(status.cloudAdminPreviewPreparation?.stage==='CLOUD11A'){");check(read('scripts/verify-foundation.mjs').toString()===expected,'Historical foundation branches preserved');
check(read('.github/workflows/verify.yml').toString()===original.get('.github/workflows/verify.yml').toString().replace('Verify admin preview preparation independently','Verify current foundation stage independently').replace('node scripts/verify-cloud11a-foundation.mjs','node scripts/verify-foundation.mjs'),'Hosted full checks retained');
const attrs=git(['check-attr','-z','filter','ident','working-tree-encoding','--',...actual]);check(attrs.code===0,'Source attributes');const parts=attrs.bytes.toString().split('\0');assert.equal(parts.pop(),'');for(let n=0;n<parts.length;n+=3)check(['unset','unspecified'].includes(parts[n+2]),'No source transforms');
check(parallel4Readiness().state==='HOLD_NOT_ACTIVATED','No launch authority');
console.log(JSON.stringify({status:'PASS',stage:'PARALLEL4_G0A_SOURCE_ONLY',checks,baselineFiles:441,mutableFiles:6,newFiles:10,productGroups:28,forksCreated:0,readIsolationVerified:false,actualKeysRead:0,actualRemoteRequests:0,adminConnected:false,workerConnected:false,M2:false,limitations:'Synthetic contracts and fixture storage only. Not four-task activation or full K1 readiness.'}));
