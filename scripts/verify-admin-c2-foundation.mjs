// C2 verifies the exact frozen NEXT base, allowed connection delta and artifact boundaries.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {allowedHostedPullRef} from './native-release-policy.mjs';
import {controlledEnvironment} from '../apps/admin/lib/preview-file-boundary.mjs';
import {parallel4Readiness} from './parallel4-readiness.mjs';

const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const baselineFile='docs/stages/stage-admin-c2-baseline.json';
const baselineSha='6821c4c0cfa037bd53bb8c3be2ab6113dd5678a83d2ba669bd906d3eccf5fb55';
const base='bab66bc09af2ef181b0ebfff6bc73f2ca0fe4d12',feature='feat/admin-c2-actual';
// Preserve both exact checkpoints; only validated linear C2 corrections may follow the repair.
const ciCheckpoint='2564630b955dafac373fa925691f9a4d4f765d67';
const ciRepair='b486e0f904003f4643d24e4f68c6b32fcbbd82c4';
const checkpointBaselineSha='ea090ac7e58c51ecd4612a5e4d90b4064c99d23771950f7e1bd2fdf2ab686b87';
const hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
let checks=0;
function check(value,label){assert.ok(value,label);checks++;}
function git(args,input){
  const r=spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{input,windowsHide:true,maxBuffer:64*1024*1024});
  assert.ifError(r.error);return {code:r.status,text:r.stdout.toString('utf8').trim(),bytes:r.stdout};
}
function read(file){
  const parts=file.split('/');check(parts.every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\\')&&!p.includes(':')),'Relative source');
  let target=root;
  for(const [i,p] of parts.entries()){
    target=path.join(target,p);const stat=lstatSync(target);
    check(!stat.isSymbolicLink()&&(i===parts.length-1?stat.isFile():stat.isDirectory()),'Owned regular source '+file);
  }
  check(!path.relative(root,realpathSync(target)).startsWith('..'),'Internal source');return readFileSync(target);
}
check(realpathSync(git(['rev-parse','--show-toplevel']).text)===root,'Independent product root');
check(lstatSync(path.join(root,'.git')).isDirectory()&&!lstatSync(path.join(root,'.git')).isSymbolicLink(),'Own Git');
check(realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir']).text))===path.join(root,'.git'),'No shared Git');
check(!existsSync(path.join(root,'.git/objects/info/alternates'))&&!existsSync(path.join(root,'.gitmodules')),'No borrowed objects');
check(git(['config','--local','--name-only','--get-regexp','^(include\\.|includeif\\.|core\\.hookspath$)']).code===1,'No inherited hooks');
for(const key of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])check(!process.env[key],'No Git routing '+key);
check(git(['remote']).text==='origin','One own remote');
for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']]){
  const url=git(args).text;check(url==='https://github.com/Jacop7/stocknews.git'||hosted&&url==='https://github.com/Jacop7/stocknews','Authorized remote');
}
check(sha(read(baselineFile))===baselineSha,'Frozen C2 baseline');
const b=JSON.parse(read(baselineFile));
check(b.baseCommit===base&&b.feature===feature&&b.stage==='MAIN_ADMIN_C2'&&Object.keys(b.files).length===562,'Historical 562-file baseline');
const mutable=["AGENTS.md", "apps/admin/lib/preview-admin-config.mjs", "apps/admin/lib/preview-config-writer.mjs", "apps/admin/lib/preview-file-boundary.mjs", "apps/admin/lib/runtime-preview.mjs", "docs/development-status.json", "package.json", "scripts/admin-preview-entry.mjs", "scripts/admin-preview-native.cs", "scripts/admin-preview-sql.mjs", "scripts/admin-preview-supervisor.ps1", "scripts/test-preview-admin-db.mjs", "scripts/verify-foundation.mjs", "scripts/verify.mjs", "supabase/cloud/admin-preview-dev/activation-template.sql", "supabase/cloud/admin-preview-dev/rpc-contract.json", "tests/preview-admin-sql.test.mjs"];
const additions=["apps/admin/lib/preview-actual-lifecycle.mjs", "docs/stages/stage-admin-c2-baseline.json", "docs/stages/stage-admin-c2-notes.md", "scripts/admin-preview-actual-setup.mjs", "scripts/verify-admin-c2-foundation.mjs", "tests/preview-admin-actual.test.mjs"];
assert.deepEqual(b.mutableFiles,mutable);assert.deepEqual(b.newFiles,additions);checks+=2;
const head=git(['rev-parse','HEAD']).text,branch=git(['branch','--show-current']).text;
const parents=git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).slice(1);
const count=Number(git(['rev-list','--count','HEAD']).text);
check(git(['rev-list','--parents','-n','1',ciCheckpoint]).text===ciCheckpoint+' '+base&&Number(git(['rev-list','--count',ciCheckpoint]).text)===b.baseCount+1,'Exact first checkpoint');
const checkpointBaselineBytes=git(['show',ciCheckpoint+':'+baselineFile]).bytes;
check(sha(checkpointBaselineBytes)===checkpointBaselineSha,'Checkpoint baseline bytes');
const checkpointBaseline=JSON.parse(checkpointBaselineBytes);
assert.deepEqual({...b,sourcePins:null},{...checkpointBaseline,sourcePins:null});checks++;
const historicalTrees=new Map();
function commitTree(commit){
  if(historicalTrees.has(commit))return historicalTrees.get(commit);
  const raw=git(['ls-tree','-r','-z','--full-tree',commit]);check(raw.code===0,'Readable C2 tree '+commit);
  const tree=new Map(raw.bytes.toString().split('\0').filter(Boolean).map(line=>{
    const [meta,file]=line.split('\t'),[mode,type,oid]=meta.split(' ');
    check(mode==='100644'&&type==='blob','Regular C2 history '+file);return [file,oid];
  }));historicalTrees.set(commit,tree);return tree;
}
function correctedCommit(commit,parent){
  const allowedFiles=new Set([...mutable,...additions]),expected=[...Object.keys(b.files),...additions].sort();
  const changes=git(['diff','--name-only',parent,commit]).text.split(/\r?\n/).filter(Boolean);
  check(changes.length>0&&changes.every(f=>allowedFiles.has(f)),'Nonempty C2-only corrective delta');
  const tree=commitTree(commit),old=commitTree(base);
  assert.deepEqual([...tree.keys()].sort(),expected);checks++;
  for(const [file,oid] of old)if(!mutable.includes(file))check(tree.get(file)===oid,'Frozen corrective history '+file);
  const baseline=JSON.parse(git(['show',commit+':'+baselineFile]).bytes);
  assert.deepEqual({...baseline,sourcePins:null},{...checkpointBaseline,sourcePins:null});checks++;
  const sourcePaths=[...mutable,...additions].filter(f=>f!==baselineFile&&f!=='scripts/verify-admin-c2-foundation.mjs').sort();
  assert.deepEqual(Object.keys(baseline.sourcePins).sort(),sourcePaths);checks++;
  for(const file of sourcePaths)check(sha(git(['show',commit+':'+file]).bytes)===baseline.sourcePins[file],'Pinned corrective commit '+file);
}
const ordinalCache=new Map([[ciCheckpoint,1]]);
function featureOrdinal(commit){
  if(ordinalCache.has(commit))return ordinalCache.get(commit);
  const repairParents=git(['rev-list','--parents','-n','1',ciRepair]).text.split(/\s+/).slice(1);
  if(repairParents.length!==1||repairParents[0]!==ciCheckpoint||git(['diff','--name-only',ciCheckpoint,ciRepair]).text!=='scripts/verify-admin-c2-foundation.mjs')return null;
  if(Number(git(['rev-list','--count',ciRepair]).text)!==b.baseCount+2)return null;
  ordinalCache.set(ciRepair,2);if(commit===ciRepair)return 2;
  if(git(['merge-base','--is-ancestor',ciRepair,commit]).code!==0)return null;
  const chain=[];let current=commit;
  while(current!==ciRepair){
    const parents=git(['rev-list','--parents','-n','1',current]).text.split(/\s+/).slice(1);
    if(parents.length!==1)return null;
    chain.push([current,parents[0]]);current=parents[0];
  }
  let ordinal=2;
  for(const [child,parent] of chain.reverse()){
    correctedCommit(child,parent);ordinal++;
    check(Number(git(['rev-list','--count',child]).text)===b.baseCount+ordinal,'Linear C2 commit count');ordinalCache.set(child,ordinal);
  }
  return ordinalCache.get(commit);
}
const ordinal=featureOrdinal(head);
const other=parents.length===2?parents.find(p=>p!==b.refs['refs/heads/main']):null;
const otherOrdinal=other?featureOrdinal(other):null;
const hostedMerge=hosted&&parents.length===2&&new Set(parents).size===2&&parents.includes(b.refs['refs/heads/main'])&&otherOrdinal
  &&count===b.baseCount+otherOrdinal+1&&git(['rev-parse',head+'^{tree}']).text===git(['rev-parse',other+'^{tree}']).text;
check(head===base&&count===b.baseCount||ordinal||hostedMerge,'Historical base, exact checkpoints, validated C2 corrections or equal-tree hosted merge');
check(branch===feature||hosted&&!branch&&head===process.env.GITHUB_SHA,'Current feature');
check(git(['rev-list','--max-parents=0','HEAD']).text==='f7dce3a9e05c39580f23a210c3ac9d2514c38b74','Independent product ancestry');
const refs=new Map(git(['for-each-ref','--format=%(refname) %(objectname)']).text.split(/\r?\n/).filter(Boolean).map(s=>s.split(' ')));
const allowed=new Set([...Object.keys(b.refs),'refs/heads/'+feature,'refs/remotes/origin/'+feature]);
const pull=allowedHostedPullRef(process.env,head,r=>refs.get(r)??null);if(pull)allowed.add(pull);
for(const [ref,oid] of refs){
  check(allowed.has(ref),'Declared ref '+ref);
  if(Object.hasOwn(b.refs,ref))check(oid===b.refs[ref],'Historical ref '+ref);
  else if(ref===pull)check(!!hostedMerge&&oid===head,'Exact event-bound hosted merge ref');
  else check(oid===base||oid===ciCheckpoint||!!featureOrdinal(oid)&&git(['merge-base','--is-ancestor',oid,hostedMerge?other:head]).code===0,'Only validated ancestral C2 ref');
}
if(!hosted)for(const [ref,oid] of Object.entries(b.refs))check(refs.get(ref)===oid,'Historical ref retained '+ref);
const files=git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString().split('\0').filter(Boolean).sort();
assert.deepEqual(files,[...Object.keys(b.files),...additions].sort());checks++;
const entries=git(['ls-tree','-r','-z','--full-tree',base]).bytes.toString().split('\0').filter(Boolean).map(line=>{
  const [meta,file]=line.split('\t'),[mode,type,oid]=meta.split(' ');
  check(mode==='100644'&&type==='blob'&&Object.hasOwn(b.files,file),'Historical regular blob');return {file,oid};
});
check(entries.length===562,'All NEXT blobs');
const batch=git(['cat-file','--batch'],entries.map(e=>e.oid).join('\n')+'\n');check(batch.code===0,'Historical object bytes');
const original=new Map();let offset=0;
for(const e of entries){
  const end=batch.bytes.indexOf(10,offset),[oid,type,n]=batch.bytes.subarray(offset,end).toString().split(' '),size=Number(n);
  check(oid===e.oid&&type==='blob'&&Number.isSafeInteger(size),'Exact object');offset=end+1;
  const bytes=batch.bytes.subarray(offset,offset+size);
  check(size===b.files[e.file].bytes&&sha(bytes)===b.files[e.file].sha256,'Exact NEXT '+e.file);original.set(e.file,bytes);
  if(!mutable.includes(e.file))check(read(e.file).equals(bytes),'Unchanged historical source '+e.file);offset+=size+1;
}
check(offset===batch.bytes.length,'Complete historical stream');
// External review pins this guard and baseline. Excluding them here prevents circular hashes.
const pins=[...mutable,...additions].filter(f=>f!==baselineFile&&f!=='scripts/verify-admin-c2-foundation.mjs').sort();
assert.deepEqual(Object.keys(b.sourcePins).sort(),pins);checks++;
for(const file of pins)check(sha(read(file))===b.sourcePins[file],'Exact candidate '+file);
const status=JSON.parse(read('docs/development-status.json')),addition=status.adminC2Preparation;delete status.adminC2Preparation;
assert.deepEqual(status,JSON.parse(original.get('docs/development-status.json')));checks++;
assert.deepEqual(addition,b.expectedStatus);checks++;
check(addition.stage==='MAIN_ADMIN_C2'&&addition.state==='ACTUAL_CONNECTION_CODE_NOT_APPLIED'
  &&addition.planManifest==='a0c1450ccd8a0d1543e2e060e5dee9674dee5ed475f02c073a74e047454225e1'
  &&addition.remediationPlanManifest==='f71f7bc0eeea42f3a693647445c08226c6e7a294ce5b87d570bbdc57e7235414','Reviewed plans; implementation still requires acceptance');
for(const k of ['actualKeysRead','actualRemoteRequests','actualAuthCalls','DBMutations'])check(addition[k]===0,'No live calls '+k);
for(const k of ['workerConnected','adminConnected','M2','crossWorkerAtomicityProven','physicalCommitTimeQualificationProven'])check(addition[k]===false,'No activation '+k);
const contractPath='supabase/cloud/admin-preview-dev/rpc-contract.json';
const currentContract=JSON.parse(read(contractPath)),oldContract=JSON.parse(original.get(contractPath));
check(currentContract.templateSha256===sha(read('supabase/cloud/admin-preview-dev/activation-template.sql')),'Contract binds exact final template');
delete currentContract.templateSha256;delete oldContract.templateSha256;assert.deepEqual(currentContract,oldContract);checks++;
const pkg=JSON.parse(read('package.json')),oldPkg=JSON.parse(original.get('package.json'));
for(const [k,v] of Object.entries({'test:preview-admin-actual':'node --experimental-vm-modules --test tests/preview-admin-actual.test.mjs','admin:actual':'node scripts/admin-preview-actual-setup.mjs'})){
  check(pkg.scripts[k]===v,'New command '+k);delete pkg.scripts[k];
}
assert.deepEqual(pkg,oldPkg);checks++;
check(read('AGENTS.md').subarray(0,original.get('AGENTS.md').length).equals(original.get('AGENTS.md')),'Append-only instructions');
const verify=read('scripts/verify.mjs').toString();
for(const literal of original.get('scripts/verify.mjs').toString().matchAll(/'((?:test:|check:|build:|export:)[^']+)'/g))check(verify.includes(literal[0]),'Preserved verification '+literal[1]);
check(verify.includes("c2?'verify-admin-c2-foundation.mjs':next?")&&read('scripts/verify-foundation.mjs').toString().includes("if(status.adminC2Preparation?.stage==='MAIN_ADMIN_C2')"),'C2 guard selected');
check(verify.indexOf('assertEnvironmentBoundary();')<verify.indexOf('spawnSync(')&&verify.includes('env:verifierEnvironment')&&!verify.includes('env:{...process.env'),'Environment before tools');
for(const file of ['scripts/test-preview-admin-db.mjs','scripts/admin-preview-actual-setup.mjs','apps/admin/lib/preview-actual-lifecycle.mjs','tests/preview-admin-actual.test.mjs']){
  const parsed=spawnSync(process.execPath,['--check',path.join(root,file)],{cwd:root,windowsHide:true,encoding:'utf8',env:controlledEnvironment()});assert.ifError(parsed.error);check(parsed.status===0,'Syntax '+file);
}
// Preserve all P4 worker/client separation markers without executing its historical stage checker.
const oldGuard=original.get('scripts/verify-parallel-p4-foundation.mjs').toString();
function oldMarkers(name){const matched=new RegExp('const '+name+'=(\\[[^;]+\\]);').exec(oldGuard);assert.ok(matched);return JSON.parse(matched[1].replaceAll("'",'"'));}
const markers=[...oldMarkers('markers'),'SYNTHETIC_ANALYSIS_RUN_V1','analysis-run.ts'];
const adminOnly=[...oldMarkers('adminOnly'),'preview-activation-proof.mjs','validatePreviewActivationProof','preview-actual-lifecycle.mjs','ADMIN_C2_HOLD','nativeActualBoundary','ActualRead','ReadOperatorToken','previewOwnerIdentity','e85049b7-7306-42ad-ac16-6c4bf5e82212','7bd88947e82eccad28360716d82f516c01b90733dd82ba1fe3bce5ba50c36f8d'];
for(const file of files.filter(f=>f.startsWith('apps/')&&/\.(?:[cm]?js|tsx?)$/.test(f))){
  const source=read(file).toString();for(const marker of markers)check(!source.includes(marker),'No worker in apps '+file);
  if(file.startsWith('apps/mobile/')||/^\s*['"]use client['"]/.test(source))for(const marker of adminOnly)check(!source.includes(marker),'No admin helper in client '+file);
}
let artifactFiles=0;
if(process.argv.includes('--artifacts'))for(const folder of ['apps/admin/.next/server','apps/admin/.next/static','apps/mobile/dist/android','apps/mobile/dist/ios']){
  const start=path.join(root,folder);check(existsSync(start),'Built artifact '+folder);
  const forbidden=folder==='apps/admin/.next/server'?markers:[...markers,...adminOnly];
  function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){
    const target=path.join(dir,e.name);check(!lstatSync(target).isSymbolicLink(),'Owned artifact');
    if(e.isDirectory())scan(target);else if(/\.(?:js|json|map|hbc|bundle)$/.test(e.name)){
      const bytes=readFileSync(target);for(const marker of forbidden)check(!bytes.includes(Buffer.from(marker)),'Artifact excludes '+marker);artifactFiles++;
    }
  }}scan(start);
}
check(verify.includes("['test:preview-admin-actual','test:preview-admin-db']"),'C2 native and SQL verification required');
check(verify.indexOf("if(script==='test:preview-admin-db')")<verify.indexOf("[manager,'run',script]")&&verify.includes("'--prepare-image'")&&verify.includes("receipt.sqlExecuted,false"),'Separate dependency preparation precedes mandatory offline SQL test');
const driver=read('scripts/test-preview-admin-db.mjs').toString(),template=read('supabase/cloud/admin-preview-dev/activation-template.sql').toString();
check(driver.includes("const imageReference='public.ecr.aws/supabase/postgres@'+image")&&driver.includes("['pull','--platform','linux/amd64',imageReference]")&&driver.includes("'--network','none'")&&driver.includes("'--pull','never'"),'Digest-pinned dependency and isolated fixture retained');
assert.deepEqual([...template.matchAll(/create or replace function ([a-z0-9_.]+)\(/g)].map(x=>x[1]).sort(),['private.active_admin_user','private.is_admin','public.m1_read_admin_session']);checks++;
check(template.includes('create function private.admin_preview_authority(')&&template.includes("transaction_isolation")&&template.includes('pg_advisory_xact_lock_shared'),'Private READ COMMITTED authority helper');
const attrs=git(['check-attr','-z','filter','ident','working-tree-encoding','--',...files]);check(attrs.code===0,'Source attributes');
const parts=attrs.bytes.toString().split('\0');assert.equal(parts.pop(),'');
for(let n=0;n<parts.length;n+=3)check(['unset','unspecified'].includes(parts[n+2]),'No source transform');
check(parallel4Readiness().state==='HOLD_NOT_ACTIVATED','Remote holds retained');
console.log(JSON.stringify({status:'PASS',stage:'MAIN_ADMIN_C2_NOT_ACTIVATED',checks,baselineFiles:562,mutableFiles:17,frozenFiles:545,newFiles:6,artifactFiles,actualRemoteRequests:0,workerConnected:false,
  limitations:'Historical source/delta and bundle checks. C2 private-file and isolated PostgreSQL acceptance are mandatory; previous diagnostic acceptance remains required. No live provider, Auth, publication or cloud operation certified.'}));
