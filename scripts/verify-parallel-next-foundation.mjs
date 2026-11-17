// NEXT verifies the frozen P4 historical blobs, current delta and artifact boundaries.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {allowedHostedPullRef} from './native-release-policy.mjs';
import {parallel4Readiness} from './parallel4-readiness.mjs';

const root=realpathSync(fileURLToPath(new URL('../',import.meta.url)));
const baselineFile='docs/stages/stage-parallel-next-baseline.json';
const baselineSha='fdce257b4a7d16f72ea6a684e7f13a61eab03f578c1bd4f2e3efeae2810113f9';
const base='9310533a550eeb1d2f500e9576378b972ca7a4d1',feature='feat/main-parallel-next';
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
for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']])check(git(args).text==='https://github.com/Jacop7/stocknews.git','Authorized remote');
check(sha(read(baselineFile))===baselineSha,'Frozen NEXT baseline');
const b=JSON.parse(read(baselineFile));
check(b.baseCommit===base&&b.feature===feature&&b.stage==='MAIN_PARALLEL_NEXT'&&Object.keys(b.files).length===555,'Historical 555-file baseline');
const mutable=[
  'AGENTS.md','docs/development-status.json','package.json','scripts/verify.mjs','scripts/verify-foundation.mjs',
  'scripts/test-main-p4-integration.mjs','scripts/test-collector-db-capture-v1.mjs','scripts/test-home-database-postgres.mjs',
  'supabase/home-bound-v1/contract.sql','workers/collectors/sql/collector_db_capture_v1.sql',
].sort();
const additions=[
  'workers/ai-processing/src/analysis-run.ts','tests/analysis-run.test.ts',
  'apps/admin/lib/preview-activation-proof.mjs','tests/preview-activation-proof.test.mjs',
  'scripts/verify-parallel-next-foundation.mjs',baselineFile,'docs/stages/stage-parallel-next-notes.md',
].sort();
assert.deepEqual(b.mutableFiles,mutable);assert.deepEqual(b.newFiles,additions);checks+=2;
const head=git(['rev-parse','HEAD']).text,branch=git(['branch','--show-current']).text;
const parents=git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).slice(1);
const count=Number(git(['rev-list','--count','HEAD']).text);
const hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews';
const child=parents.length===1&&parents[0]===base&&count===b.baseCount+1;
const other=parents.length===2?parents.find(p=>p!==b.refs['refs/heads/main']):null;
const hostedMerge=hosted&&parents.length===2&&new Set(parents).size===2&&parents.includes(b.refs['refs/heads/main'])&&other
  &&git(['rev-list','--parents','-n','1',other]).text.split(/\s+/).slice(1).join(' ')===base
  &&count===b.baseCount+2&&git(['rev-parse',head+'^{tree}']).text===git(['rev-parse',other+'^{tree}']).text;
check(head===base&&count===b.baseCount||child||hostedMerge,'Historical base, exact child or equal-tree hosted merge');
check(branch===feature||hosted&&!branch&&head===process.env.GITHUB_SHA,'Current feature');
check(git(['rev-list','--max-parents=0','HEAD']).text==='f7dce3a9e05c39580f23a210c3ac9d2514c38b74','Independent product ancestry');
const refs=new Map(git(['for-each-ref','--format=%(refname) %(objectname)']).text.split(/\r?\n/).filter(Boolean).map(s=>s.split(' ')));
const allowed=new Set([...Object.keys(b.refs),'refs/heads/'+feature,'refs/remotes/origin/'+feature]);
const pull=allowedHostedPullRef(process.env,head,r=>refs.get(r)??null);if(pull)allowed.add(pull);
for(const [ref,oid] of refs){
  check(allowed.has(ref),'Declared ref '+ref);
  if(Object.hasOwn(b.refs,ref))check(oid===b.refs[ref],'Historical ref '+ref);
  else check(oid===base||oid===head||hostedMerge&&oid===other,'Only NEXT ref');
}
if(!hosted)for(const [ref,oid] of Object.entries(b.refs))check(refs.get(ref)===oid,'Historical ref retained '+ref);
const files=git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString().split('\0').filter(Boolean).sort();
assert.deepEqual(files,[...Object.keys(b.files),...additions].sort());checks++;
const entries=git(['ls-tree','-r','-z','--full-tree',base]).bytes.toString().split('\0').filter(Boolean).map(line=>{
  const [meta,file]=line.split('\t'),[mode,type,oid]=meta.split(' ');
  check(mode==='100644'&&type==='blob'&&Object.hasOwn(b.files,file),'Historical regular blob');return {file,oid};
});
check(entries.length===555,'All P4 blobs');
const batch=git(['cat-file','--batch'],entries.map(e=>e.oid).join('\n')+'\n');check(batch.code===0,'Historical object bytes');
const original=new Map();let offset=0;
for(const e of entries){
  const end=batch.bytes.indexOf(10,offset),[oid,type,n]=batch.bytes.subarray(offset,end).toString().split(' '),size=Number(n);
  check(oid===e.oid&&type==='blob'&&Number.isSafeInteger(size),'Exact object');offset=end+1;
  const bytes=batch.bytes.subarray(offset,offset+size);
  check(size===b.files[e.file].bytes&&sha(bytes)===b.files[e.file].sha256,'Exact P4 '+e.file);original.set(e.file,bytes);
  if(!mutable.includes(e.file))check(read(e.file).equals(bytes),'Unchanged historical source '+e.file);offset+=size+1;
}
check(offset===batch.bytes.length,'Complete historical stream');
// External review pins this guard and baseline. Excluding them here prevents circular hashes.
const pins=[...mutable,...additions].filter(f=>f!==baselineFile&&f!=='scripts/verify-parallel-next-foundation.mjs').sort();
assert.deepEqual(Object.keys(b.sourcePins).sort(),pins);checks++;
for(const file of pins)check(sha(read(file))===b.sourcePins[file],'Exact candidate '+file);
const status=JSON.parse(read('docs/development-status.json')),addition=status.parallelNextPreparation;delete status.parallelNextPreparation;
assert.deepEqual(status,JSON.parse(original.get('docs/development-status.json')));checks++;
assert.deepEqual(addition,b.expectedStatus);checks++;
check(addition.stage==='MAIN_PARALLEL_NEXT'&&addition.state==='SYNTHETIC_IMPLEMENTATION_REVIEW_PENDING'
  &&addition.planManifest==='12d49813d102cb4d3e11a32aeff427e8a14b514fd1f74e84f552bc8e6f276052','Reviewed plan');
for(const k of ['productAiProcessingCalls','actualKeysRead','actualRemoteRequests','actualAuthCalls'])check(addition[k]===0,'No live calls '+k);
for(const k of ['workerConnected','adminConnected','M2','crossWorkerAtomicityProven','physicalCommitTimeQualificationProven'])check(addition[k]===false,'No activation '+k);
const pkg=JSON.parse(read('package.json')),oldPkg=JSON.parse(original.get('package.json'));
for(const [k,v] of Object.entries({'test:analysis-run':'node --experimental-strip-types --test tests/analysis-run.test.ts','test:preview-activation-proof':'node --test tests/preview-activation-proof.test.mjs'})){
  check(pkg.scripts[k]===v,'New command '+k);delete pkg.scripts[k];
}
assert.deepEqual(pkg,oldPkg);checks++;
check(read('AGENTS.md').subarray(0,original.get('AGENTS.md').length).equals(original.get('AGENTS.md')),'Append-only instructions');
const verify=read('scripts/verify.mjs').toString();
for(const literal of original.get('scripts/verify.mjs').toString().matchAll(/'((?:test:|check:|build:|export:)[^']+)'/g))check(verify.includes(literal[0]),'Preserved verification '+literal[1]);
check(verify.includes("next?'verify-parallel-next-foundation.mjs':p4?")&&read('scripts/verify-foundation.mjs').toString().includes("if(status.parallelNextPreparation?.stage==='MAIN_PARALLEL_NEXT')"),'NEXT guard selected');
check(verify.indexOf('assertEnvironmentBoundary();')<verify.indexOf('spawnSync(')&&verify.includes('env:verifierEnvironment')&&!verify.includes('env:{...process.env'),'Environment before tools');
for(const file of ['scripts/test-collector-db-capture-v1.mjs','scripts/test-home-database-postgres.mjs','scripts/test-main-p4-integration.mjs']){
  const parsed=spawnSync(process.execPath,['--check',path.join(root,file)],{cwd:root,windowsHide:true,encoding:'utf8'});assert.ifError(parsed.error);check(parsed.status===0,'Syntax '+file);
}
// Preserve all P4 worker/client separation markers without executing its historical stage checker.
const oldGuard=original.get('scripts/verify-parallel-p4-foundation.mjs').toString();
function oldMarkers(name){const matched=new RegExp('const '+name+'=(\\[[^;]+\\]);').exec(oldGuard);assert.ok(matched);return JSON.parse(matched[1].replaceAll("'",'"'));}
const markers=[...oldMarkers('markers'),'SYNTHETIC_ANALYSIS_RUN_V1','analysis-run.ts'];
const adminOnly=[...oldMarkers('adminOnly'),'preview-activation-proof.mjs','validatePreviewActivationProof'];
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
const attrs=git(['check-attr','-z','filter','ident','working-tree-encoding','--',...files]);check(attrs.code===0,'Source attributes');
const parts=attrs.bytes.toString().split('\0');assert.equal(parts.pop(),'');
for(let n=0;n<parts.length;n+=3)check(['unset','unspecified'].includes(parts[n+2]),'No source transform');
check(parallel4Readiness().state==='HOLD_NOT_ACTIVATED','Remote holds retained');
console.log(JSON.stringify({status:'PASS',stage:'MAIN_PARALLEL_NEXT_NOT_ACTIVATED',checks,baselineFiles:555,mutableFiles:10,newFiles:7,artifactFiles,actualRemoteRequests:0,workerConnected:false,
  limitations:'Historical source/delta and bundle checks. Separate PostgreSQL diagnostics and normal acceptance are required. No live provider, Auth, publication or cloud operation certified.'}));
