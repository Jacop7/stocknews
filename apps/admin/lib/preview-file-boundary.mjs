// ADMIN_PREVIEW_FILE_C1B. Fixed server-only native handles; import performs no I/O. Actual operations require bound authority.
import {spawnSync,spawn} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {lstatSync,realpathSync,readFileSync} from 'node:fs';
// Explicit Node tools bind their root to this source, never to caller cwd or an env override.
// Bundled Next fixture helpers are not executable entrypoints; ACTUAL stays unconditionally closed.
const sourceModuleFile=fileURLToPath(import.meta.url);
export const productDirectory=path.resolve(path.dirname(sourceModuleFile),'../../..');
export const nativePowerShell='C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
export const nativeNode='C:\\Program Files\\nodejs\\node.exe';
const ownedFixtureRoots=new WeakMap();
export function boundaryHold(reason){throw new Error('ADMIN_PREVIEW_HOLD:'+reason);}
export function assertOwnedInvocation(){
  if(path.resolve(process.cwd())!==productDirectory)boundaryHold('FIXED_CWD_REQUIRED');
  if(path.resolve(sourceModuleFile)!==path.join(productDirectory,'apps/admin/lib/preview-file-boundary.mjs')||realpathSync(productDirectory)!==productDirectory||realpathSync(sourceModuleFile)!==sourceModuleFile)boundaryHold('OWNED_SOURCE_REQUIRED');
  for(const f of [productDirectory,path.join(productDirectory,'apps'),path.join(productDirectory,'apps/admin'),path.join(productDirectory,'apps/admin/lib'),sourceModuleFile])if(lstatSync(f).isSymbolicLink())boundaryHold('SOURCE_LINK');
}
export function controlledEnvironment(source=process.env){
  const out={};
  for(const key of ['SystemRoot','WINDIR','ComSpec','TEMP','TMP','USERPROFILE','APPDATA','LOCALAPPDATA','ProgramFiles','ProgramFiles(x86)','ProgramData','PATHEXT','PATH','Path','NUMBER_OF_PROCESSORS','PROCESSOR_ARCHITECTURE','OS'])if(typeof source[key]==='string')out[key]=source[key];
  Object.assign(out,{NODE_ENV:'production',CI:'1',EXPO_NO_TELEMETRY:'1',NEXT_TELEMETRY_DISABLED:'1',COREPACK_HOME:path.join(productDirectory,'.local-tools/corepack')});
  // Only the non-secret hosted verifier identity is admitted; no arbitrary CI prefix.
  for(const key of ['GITHUB_ACTIONS','GITHUB_REPOSITORY','GITHUB_SHA','GITHUB_REF','GITHUB_EVENT_NAME'])if(typeof source[key]==='string')out[key]=source[key];
  if(/^[0-9a-f]{40}$/.test(source.JUDOJU_NATIVE_BASE_SHA??''))out.JUDOJU_NATIVE_BASE_SHA=source.JUDOJU_NATIVE_BASE_SHA;
  out.COREPACK_ENABLE_DOWNLOAD_PROMPT='0';
  return out;
}
export function nativeBoundary(operation,payload){
  assertOwnedInvocation();
  if(process.platform!=='win32')boundaryHold('NOT_VERIFIED_WINDOWS');
  if(!['Inspect','CreateFixture','VerifyFixture','WriteFixture','ReadFixture','PrivateFixture','Supervise','DeathTest'].includes(operation))boundaryHold('OPERATION');
  const r=spawnSync(nativePowerShell,['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(productDirectory,'scripts/admin-preview-supervisor.ps1'),'-Operation',operation],{cwd:productDirectory,input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,timeout:operation==='Supervise'?165000:operation==='DeathTest'?45000:20000,maxBuffer:2*1024*1024,env:controlledEnvironment()});
  if(r.error||r.status!==0)boundaryHold('NATIVE_FAILED');
  let result;try{result=JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));}catch{boundaryHold('NATIVE_RESPONSE');}
  if(result.status!=='PASS')boundaryHold(result.reason??'NATIVE_HOLD');return result;
}
export function createPreviewFixtureRoot(){
  const receipt=nativeBoundary('CreateFixture',{});
  if(receipt.createdExclusive!==true||typeof receipt.root!=='string'||typeof receipt.rootId!=='string'||!/^[0-9a-f]{64}$/.test(receipt.nonce??''))boundaryHold('FIXTURE_CREATION_RECEIPT');
  const handle=Object.freeze({path:receipt.root});ownedFixtureRoots.set(handle,Object.freeze({root:receipt.root,rootId:receipt.rootId,nonce:receipt.nonce}));return handle;
}
export function assertFixtureRoot(handle){
  if(!ownedFixtureRoots.has(handle))boundaryHold('UNOWNED_FIXTURE_ROOT');
  const receipt=ownedFixtureRoots.get(handle),root=receipt.root;
  nativeBoundary('VerifyFixture',receipt);
  const resolved=path.resolve(root),relation=path.relative(productDirectory,resolved),inverse=path.relative(resolved,productDirectory);
  if(!relation||!inverse||(!relation.startsWith('..')&&!path.isAbsolute(relation))||(!inverse.startsWith('..')&&!path.isAbsolute(inverse)))boundaryHold('ACTUAL_ROOT');
  if(realpathSync(resolved)!==resolved||!lstatSync(resolved).isDirectory()||lstatSync(resolved).isSymbolicLink())boundaryHold('FIXTURE_REALPATH');
  return resolved; // VerifyFixture already checks all native ancestors and the opened directory identity.
}
export function writeOwnedPreviewFixture(handle,payload){
  assertFixtureRoot(handle);return nativeBoundary('WriteFixture',{...payload,...ownedFixtureRoots.get(handle)});
}
export function inspectNativePaths(paths){return nativeBoundary('Inspect',{paths});}
export function verifyPrivatePreviewFixture(handle){assertFixtureRoot(handle);return nativeBoundary('PrivateFixture',ownedFixtureRoots.get(handle));}

// Server-only C2 explicit execution. ReadActual additionally requires this process's inherited live Windows Job.
export function nativeActualBoundary(operation,payload={},options={}){
  if(process.platform!=='win32')boundaryHold('NOT_VERIFIED_WINDOWS');
  if(!['CreateActual','WriteActualFile','ReadActualFile','ReadActual','AppendActualJournal','ReadActualJournal','ActualStatus','DeleteActualSecrets','Clock','OperatorIdentity','ReadOperatorToken','Supervise'].includes(operation))boundaryHold('ACTUAL_OPERATION');
  const root=path.resolve(process.cwd());
  for(const part of [root,path.join(root,'.git'),path.join(root,'scripts'),path.join(root,'scripts/admin-preview-supervisor.ps1'),path.join(root,'scripts/admin-preview-native.cs'),path.join(root,'package.json')]){
    if(lstatSync(part).isSymbolicLink()||realpathSync(part)!==part)boundaryHold('ACTUAL_OWNED_SOURCE');
  }
  if(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).name!=='@judoju/news')boundaryHold('ACTUAL_PRODUCT_ROOT');
  const maximum=operation==='Supervise'?1950000:20000;
  if(!options||Object.keys(options).some(k=>k!=='timeoutMs')||Object.hasOwn(options,'timeoutMs')&&(!Number.isSafeInteger(options.timeoutMs)||options.timeoutMs<1||options.timeoutMs>maximum))boundaryHold('ACTUAL_NATIVE_BUDGET');
  const limit=options.timeoutMs??maximum;
  const r=spawnSync(nativePowerShell,['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(root,'scripts/admin-preview-supervisor.ps1'),'-Operation',operation],
    {cwd:root,input:JSON.stringify(payload),encoding:'utf8',windowsHide:true,timeout:limit,maxBuffer:2*1024*1024,env:controlledEnvironment()});
  if(r.error||r.status!==0)boundaryHold('ACTUAL_NATIVE_FAILED');
  let result;try{result=JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));}catch{boundaryHold('ACTUAL_NATIVE_RESPONSE');}
  if(operation==='DeleteActualSecrets'&&result?.status==='HOLD'&&Array.isArray(result.files)&&result.files.length===3)return result;
  if(result?.status!=='PASS')boundaryHold('ACTUAL_NATIVE_HOLD');return result;
}
export function nativeActualJournal(operation,payload,signal){
  if(process.platform!=='win32'||!['ReadActualJournal','AppendActualJournal'].includes(operation))return Promise.reject(new Error('ADMIN_PREVIEW_HOLD:ACTUAL_JOURNAL_OPERATION'));
  const root=path.resolve(process.cwd());
  try{for(const part of [root,path.join(root,'.git'),path.join(root,'scripts/admin-preview-supervisor.ps1'),path.join(root,'scripts/admin-preview-native.cs')])if(lstatSync(part).isSymbolicLink()||realpathSync(part)!==part)boundaryHold('ACTUAL_OWNED_SOURCE');
    if(JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).name!=='@judoju/news')boundaryHold('ACTUAL_PRODUCT_ROOT');
  }catch{return Promise.reject(new Error('ADMIN_PREVIEW_HOLD:ACTUAL_JOURNAL_ROOT'));}
  return new Promise((resolve,reject)=>{
    let child,settled=false,size=0,output='';
    const finish=(ok,value)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',abort);ok?resolve(value):reject(new Error('ADMIN_PREVIEW_HOLD:ACTUAL_JOURNAL_UNCONFIRMED'));};
    const abort=()=>{try{child?.kill();}catch{}finish(false);};
    const timer=setTimeout(abort,20000);signal?.addEventListener('abort',abort,{once:true});
    if(signal?.aborted){abort();return;}
    try{
      child=spawn(nativePowerShell,['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(root,'scripts/admin-preview-supervisor.ps1'),'-Operation',operation],{cwd:root,windowsHide:true,env:controlledEnvironment(),stdio:['pipe','pipe','pipe']});
      child.on('error',()=>finish(false));child.stdin.on('error',()=>finish(false));
      child.stdout.on('data',bytes=>{size+=bytes.length;if(size>262144){abort();return;}output+=bytes.toString('utf8');});
      child.stderr.on('data',()=>{});
      child.on('close',code=>{if(settled)return;try{const value=JSON.parse(output.trim().split(/\r?\n/).at(-1));finish(code===0&&value.status==='PASS',value);}catch{finish(false);}});
      child.stdin.end(JSON.stringify(payload));
    }catch{abort();}
  });
}
