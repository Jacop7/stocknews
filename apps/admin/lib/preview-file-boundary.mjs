// ADMIN_PREVIEW_FILE_C1B. Fixture-only native handle operations; import performs no I/O.
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {lstatSync,realpathSync} from 'node:fs';
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
  if(!['Inspect','CreateFixture','VerifyFixture','WriteFixture','ReadFixture','Supervise','DeathTest'].includes(operation))boundaryHold('OPERATION');
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
