// MAIN_AI_A1 source transition and application-boundary checks; never an execution/credential authority.
import assert from 'node:assert/strict';
import {readFileSync,realpathSync,lstatSync,existsSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {allowedHostedPullRef} from './native-release-policy.mjs';
import {parallel4Readiness} from './parallel4-readiness.mjs';
const root=realpathSync(fileURLToPath(new URL('../',import.meta.url))),base='24783e82694c2a26e10284d9f844b744029bb850',feature='feat/main-ai-intake-a1';
let checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;},sha=b=>createHash('sha256').update(b).digest('hex');
function git(args,input){const r=spawnSync('git',['-c','core.quotepath=false','-C',root,...args],{input,windowsHide:true,maxBuffer:64*1024*1024});assert.ifError(r.error);return {code:r.status,text:r.stdout.toString('utf8').trim(),bytes:r.stdout};}
function read(file){let at=root;const parts=file.split('/');check(parts.every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\\')&&!p.includes(':')),'Relative source');for(const [i,p] of parts.entries()){at=path.join(at,p);const s=lstatSync(at);check(!s.isSymbolicLink()&&(i===parts.length-1?s.isFile():s.isDirectory()),'Owned regular source '+file);}const relative=path.relative(root,realpathSync(at));check(!relative.startsWith('..')&&!path.isAbsolute(relative),'Internal source');return readFileSync(at);}
const json=f=>JSON.parse(read(f));
check(realpathSync(git(['rev-parse','--show-toplevel']).text)===root,'Independent product root');
check(lstatSync(path.join(root,'.git')).isDirectory()&&!lstatSync(path.join(root,'.git')).isSymbolicLink(),'Own Git only; no worktree');
check(realpathSync(path.resolve(root,git(['rev-parse','--git-common-dir']).text))===path.join(root,'.git'),'No shared Git');
check(!existsSync(path.join(root,'.git/objects/info/alternates'))&&!existsSync(path.join(root,'.gitmodules')),'No borrowed Git');
check(git(['config','--local','--name-only','--get-regexp','^(include\\.|includeif\\.|core\\.hookspath$)']).code===1,'No inherited hooks');
for(const k of ['GIT_DIR','GIT_WORK_TREE','GIT_COMMON_DIR','GIT_OBJECT_DIRECTORY','GIT_ALTERNATE_OBJECT_DIRECTORIES'])check(!process.env[k],'No Git routing '+k);
check(git(['remote']).text==='origin','Only own remote');for(const args of [['remote','get-url','--all','origin'],['remote','get-url','--push','--all','origin']])check(git(args).text==='https://github.com/Jacop7/stocknews.git','Authorized remote');
const baseline='docs/stages/stage-main-ai-a1-baseline.json';check(sha(read(baseline))==='aba1819692165926fba0d2235d9be309efe65c53ef130d474b2bd93fbf928d0f','Frozen 460-file authority');
const b=json(baseline);check(b.baseCommit===base&&b.baseCount===28&&b.feature===feature&&Object.keys(b.files).length===460&&Object.keys(b.refs).length===37&&b.mutableFiles.length===5&&b.newFiles.length===8,'Exact transition scope');
const head=git(['rev-parse','HEAD']).text,branch=git(['branch','--show-current']).text,parents=git(['rev-list','--parents','-n','1','HEAD']).text.split(/\s+/).slice(1),count=Number(git(['rev-list','--count','HEAD']).text);
const hosted=process.env.GITHUB_ACTIONS==='true'&&process.env.GITHUB_REPOSITORY==='Jacop7/stocknews',isBase=head===base&&count===28,isChild=count===29&&parents.length===1&&parents[0]===base;
const other=parents.length===2?parents.find(p=>p!==b.refs['refs/heads/main']):null;
const isHostedMerge=hosted&&count===30&&parents.length===2&&new Set(parents).size===2&&parents.includes(b.refs['refs/heads/main'])&&other&&git(['rev-list','--parents','-n','1',other]).text.split(/\s+/).slice(1).join(' ')===base&&git(['rev-parse',head+'^{tree}']).text===git(['rev-parse',other+'^{tree}']).text;
check(isBase||isChild||isHostedMerge,'Reviewed base, one exact feature child or equal-tree hosted PR merge');
check(branch===feature||isBase&&branch==='feat/parallel4-g0b-semantics'||hosted&&!branch&&head===process.env.GITHUB_SHA,'Owned preparation feature');
check(git(['rev-list','--max-parents=0','HEAD']).text==='f7dce3a9e05c39580f23a210c3ac9d2514c38b74','New product ancestry');
const refs=new Map(git(['for-each-ref','--format=%(refname) %(objectname)']).text.split(/\r?\n/).filter(Boolean).map(s=>s.split(' '))),allowed=new Set([...Object.keys(b.refs),'refs/heads/'+feature,'refs/remotes/origin/'+feature]);
const pullRef=allowedHostedPullRef(process.env,head,r=>refs.get(r)??null);if(pullRef)allowed.add(pullRef);
for(const [ref,oid] of refs){check(allowed.has(ref),'Declared ref '+ref);if(Object.hasOwn(b.refs,ref))check(oid===b.refs[ref],'Frozen historical ref '+ref);else check(oid===base||oid===head||isHostedMerge&&oid===other,'Only preparation ref');}
if(!hosted)for(const [ref,oid] of Object.entries(b.refs))check(refs.get(ref)===oid,'Historical ref retained '+ref);
const actual=git(['ls-files','--cached','--others','--exclude-standard','-z']).bytes.toString().split('\0').filter(Boolean).sort();assert.deepEqual(actual,[...Object.keys(b.files),...b.newFiles].sort());checks++;
const entries=git(['ls-tree','-r','-z','--full-tree',base]).bytes.toString().split('\0').filter(Boolean).map(x=>{const [meta,file]=x.split('\t'),[mode,type,oid]=meta.split(' ');check(mode==='100644'&&type==='blob'&&Object.hasOwn(b.files,file),'Historical regular blob');return {file,oid};});check(entries.length===460,'460 base blobs');
const batch=git(['cat-file','--batch'],entries.map(x=>x.oid).join('\n')+'\n');check(batch.code===0,'Historical bytes');let offset=0;const original=new Map();
for(const e of entries){const end=batch.bytes.indexOf(10,offset),[oid,type,n]=batch.bytes.subarray(offset,end).toString().split(' '),size=Number(n);check(oid===e.oid&&type==='blob'&&Number.isSafeInteger(size),'Original object');offset=end+1;const bytes=batch.bytes.subarray(offset,offset+size);check(size===b.files[e.file].bytes&&sha(bytes)===b.files[e.file].sha256,'Exact 24783 '+e.file);original.set(e.file,bytes);if(!b.mutableFiles.includes(e.file))check(read(e.file).equals(bytes),'Unchanged '+e.file);offset+=size+1;}
check(offset===batch.bytes.length,'Complete original stream');
const preparation='docs/stages/stage-main-ai-a1-preparation.json',prep=json(preparation),pins=[...b.mutableFiles,...b.newFiles].filter(f=>f!==preparation).sort();assert.deepEqual(Object.keys(prep.sourcePins).sort(),pins);checks++;
for(const f of pins)check(sha(read(f))===prep.sourcePins[f],'Candidate pin '+f);
check(prep.stage==='MAIN_AI_A1'&&prep.state==='SYNTHETIC_PROPOSAL_GATE_NOT_ACTIVATED'&&prep.planManifest==='feff4625809a08204045c8d36ef820b3bfe10c4b1f21cbec942f11662a03893f'&&prep.actualModelCalls===0&&prep.actualKeysRead===0&&prep.actualRemoteRequests===0&&prep.workerConnected===false&&prep.M2===false,'Synthetic proposal only');
const status=json('docs/development-status.json'),addition=status.mainAiMetadataPreparation;delete status.mainAiMetadataPreparation;assert.deepEqual(status,JSON.parse(original.get('docs/development-status.json')));checks++;
assert.deepEqual(addition,{stage:prep.stage,state:prep.state,planManifest:prep.planManifest,actualModelCalls:0,actualKeysRead:0,actualRemoteRequests:0,workerConnected:false,M2:false});checks++;
const pkg=json('package.json'),oldPackage=JSON.parse(original.get('package.json'));
check(pkg.scripts['test:ai-intake']==='node --experimental-strip-types --test tests/ai-metadata-intake.test.ts'&&pkg.scripts['check:ai-intake']==='node node_modules/typescript/bin/tsc -p workers/ai-processing/tsconfig.json','Two added groups');delete pkg.scripts['test:ai-intake'];delete pkg.scripts['check:ai-intake'];assert.deepEqual(pkg,oldPackage);checks++;
const verifyAddition="const a1=JSON.parse(readFileSync(new URL('../docs/development-status.json',import.meta.url),'utf8')).mainAiMetadataPreparation?.stage==='MAIN_AI_A1';\n";
let expected=original.get('scripts/verify.mjs').toString().replace('const g0b=',verifyAddition+'const g0b=').replace("g0b?'verify-parallel4-g0b-foundation.mjs'","a1?'verify-main-ai-a1-foundation.mjs':g0b?'verify-parallel4-g0b-foundation.mjs'").replace("...(g0b?['test:pipeline-semantics','test:pipeline-ranking']:[])","...(g0b?['test:pipeline-semantics','test:pipeline-ranking']:[]),...(a1?['test:ai-intake','check:ai-intake']:[])").replace('if(g0b){const artifactCheck=','if(a1||g0b){const artifactCheck=').replace("new URL('verify-parallel4-g0b-foundation.mjs',import.meta.url)","new URL(a1?'verify-main-ai-a1-foundation.mjs':'verify-parallel4-g0b-foundation.mjs',import.meta.url)").replace("name:'g0b-artifact-boundary'","name:'pipeline-artifact-boundary'");check(read('scripts/verify.mjs').toString()===expected,'All 30 old groups preserved plus two; new guard first and both Node artifact boundaries');
expected=original.get('scripts/verify-foundation.mjs').toString().replace("if(status.parallelContractSemanticsPreparation?.stage==='PARALLEL4_G0B'){","if(status.mainAiMetadataPreparation?.stage==='MAIN_AI_A1'){\n  await import('./verify-main-ai-a1-foundation.mjs');\n  await import('./verify-stage3-providers.mjs');\n} else if(status.parallelContractSemanticsPreparation?.stage==='PARALLEL4_G0B'){");check(read('scripts/verify-foundation.mjs').toString()===expected,'Old foundation branches and providers preserved');
check(read('AGENTS.md').toString()===original.get('AGENTS.md').toString()+"\n- MAIN_AI_A1은 MAIN 직접 작성한 순수 합성 메타데이터 제안 검증이다. 실제 AI 호출·사실 검증·수집·게시·DB·이전 원격 worker 재시도를 활성화하지 않는다. A1 결과는 K1 판정이 아니며 후속 변환 계약이 필요하다. 기존 검사와 역사 guard는 보존하고 A1 전용 guard를 우선 선택한다.\n",'Append-only product instructions');
const worker='workers/ai-processing/src/metadata-intake.ts',body=read(worker).toString();
check((body.match(/^import /gm)||[]).length===2&&body.includes("from '../../../packages/contracts/src/pipeline.ts'")&&body.includes("from '../../../packages/contracts/src/pipeline-semantics.ts'"),'Two pure K1 imports only');
check(!/fetch\s*\(|proposeDecision|appendSourceRevision|saveDraft|resolveEffect|process\.env|node:(?:fs|child_process|net|http)/.test(body),'No IO, K1 repository writes or effects');
assert.deepEqual([...body.matchAll(/^export (?:const|function) (\w+)/gm)].map(x=>x[1]),['METADATA_SCHEMA','prepareMetadataRequest','acceptMetadataProposal']);checks++;
const allowedRanking=new Set(['packages/domain/src/pipeline-ranking.ts','tests/pipeline-ranking.test.ts','scripts/verify-parallel4-g0b-foundation.mjs','scripts/verify-main-ai-a1-foundation.mjs']);
for(const f of actual.filter(f=>/\.(?:[cm]?js|tsx?)$/.test(f))){const source=read(f).toString();if(!allowedRanking.has(f))check(!/\/pipeline-ranking(?:\.(?:ts|js))?['"]/.test(source),'Internal ranking absent from application imports '+f);if(![worker,'tests/ai-metadata-intake.test.ts','scripts/verify-main-ai-a1-foundation.mjs'].includes(f))check(!/\/metadata-intake(?:\.(?:ts|js))?['"]/.test(source),'Internal worker absent from application imports '+f);}
const attrs=git(['check-attr','-z','filter','ident','working-tree-encoding','--',...actual]);check(attrs.code===0,'Source attributes');const parts=attrs.bytes.toString().split('\0');assert.equal(parts.pop(),'');for(let n=0;n<parts.length;n+=3)check(['unset','unspecified'].includes(parts[n+2]),'No source transforms');
let artifactFiles=0;
if(process.argv.includes('--artifacts'))for(const folder of ['apps/admin/.next/server','apps/admin/.next/static','apps/mobile/dist/android','apps/mobile/dist/ios']){
 const start=path.join(root,folder);check(existsSync(start),'Built artifacts '+folder);
 function scan(dir){for(const e of readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);check(!lstatSync(f).isSymbolicLink(),'Owned artifact');if(e.isDirectory())scan(f);else if(/\.(?:js|json|map|hbc|bundle)$/.test(e.name)){const bytes=readFileSync(f);for(const marker of ['SYNTHETIC_K1_COMPLETED_RANKING','pipeline-ranking.ts','SYNTHETIC_K1_METADATA_INTAKE_A1','metadata-intake.ts'])check(!bytes.includes(Buffer.from(marker)),'Internal Node module not bundled '+marker);artifactFiles++;}}}scan(start);
}
check(parallel4Readiness().state==='HOLD_NOT_ACTIVATED','No remote-author activation');
console.log(JSON.stringify({status:'PASS',stage:'MAIN_AI_A1_SYNTHETIC_PROPOSAL_ONLY',checks,baselineFiles:460,mutableFiles:5,newFiles:8,productGroups:32,artifactFiles,actualModelCalls:0,actualRemoteRequests:0,workerConnected:false,M2:false,limitations:'Pure synthetic proposal validation only, not model accuracy, factual evidence verification, async freshness, DB durability, real collection or publication.'}));
