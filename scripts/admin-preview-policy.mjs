// ADMIN_PREVIEW_POLICY_C1B. No import-time filesystem/framework/config reads.
import {lstatSync,realpathSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {productDirectory,inspectNativePaths,controlledEnvironment,boundaryHold,assertOwnedInvocation} from '../apps/admin/lib/preview-file-boundary.mjs';
export const environmentNames=Object.freeze(['.env','.env.local','.env.production','.env.production.local','.env.development','.env.development.local','.env.test','.env.test.local']);
export const fixedTargets=Object.freeze({'build:admin':['--filter','@judoju/admin','build'],'export:android':['--filter','@judoju/mobile','export:android'],'export:ios':['--filter','@judoju/mobile','export:ios']});
function metadataCheck(root){
  const dirs=[root,path.join(root,'apps/admin'),path.join(root,'apps/mobile')],targets=dirs.flatMap(d=>environmentNames.map(n=>path.join(d,n)));
  const before=dirs.map(d=>{const st=lstatSync(d,{bigint:true});if(!st.isDirectory()||st.isSymbolicLink()||realpathSync(d)!==d)boundaryHold('ENV_PARENT');return st;});
  if(process.platform==='win32'){
    const observed=inspectNativePaths([...dirs,...targets]);
    if(observed.items.length!==27||observed.items.some((s,i)=>i<3?!s.exists:s.exists))boundaryHold('ENV_PRESENT');
  }else for(const f of targets){try{lstatSync(f);boundaryHold('ENV_PRESENT');}catch(e){if(e.code!=='ENOENT')throw e;}}
  for(let i=0;i<dirs.length;i++){const after=lstatSync(dirs[i],{bigint:true});if(after.dev!==before[i].dev||after.ino!==before[i].ino||!after.isDirectory()||after.isSymbolicLink()||realpathSync(dirs[i])!==dirs[i])boundaryHold('ENV_PARENT_CHANGED');}
  return {status:'PASS',checkedPaths:targets.length,contentsRead:0,frameworkStarted:false};
}
export function assertEnvironmentBoundary(){assertOwnedInvocation();return metadataCheck(productDirectory);}
// Explicit fixture path, never used by the executable wrapper or Next runtime.
export function inspectFixtureEnvironment(root){
  assertOwnedInvocation();
  const r=path.resolve(root),rel=path.relative(productDirectory,r),inverse=path.relative(r,productDirectory);
  if(!rel||!inverse||(!rel.startsWith('..')&&!path.isAbsolute(rel))||(!inverse.startsWith('..')&&!path.isAbsolute(inverse)))boundaryHold('FIXTURE_ROOT');
  return metadataCheck(r);
}
export function runFrameworkTarget(target){
  if(!Object.hasOwn(fixedTargets,target))boundaryHold('TARGET');
  assertEnvironmentBoundary();
  const manager=path.join(productDirectory,'.local-tools/corepack/v1/pnpm/11.25.0/bin/pnpm.cjs');
  const result=spawnSync(process.execPath,[manager,...fixedTargets[target]],{cwd:productDirectory,stdio:'inherit',windowsHide:true,env:controlledEnvironment()});
  if(result.error||result.status!==0)throw Error('FRAMEWORK_TARGET_FAILED');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==3)boundaryHold('ARGUMENTS');
  runFrameworkTarget(process.argv[2]);
}
