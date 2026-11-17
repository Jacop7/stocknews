import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,symlinkSync,unlinkSync,readFileSync,existsSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import {environmentNames,inspectFixtureEnvironment,assertEnvironmentBoundary,fixedTargets} from '../scripts/admin-preview-policy.mjs';
import {controlledEnvironment,productDirectory,nativePowerShell} from '../apps/admin/lib/preview-file-boundary.mjs';
import {adminProfile,assertAdminRequest,previewOrigin} from '../apps/admin/lib/admin-profile.mjs';
import {createPreviewRuntime} from '../apps/admin/lib/runtime-preview.mjs';
import {pathToFileURL} from 'node:url';
function fixture(t){const r=mkdtempSync(path.join(os.tmpdir(),'judoju-c1b-env-'));for(const app of ['admin','mobile'])mkdirSync(path.join(r,'apps',app),{recursive:true});t.after(()=>{assert.equal(path.dirname(r),path.resolve(os.tmpdir()));assert.ok(path.basename(r).startsWith('judoju-c1b-env-'));rmSync(r,{recursive:true});});return r;}
test('guard checks exact 24 autoload paths using metadata only',t=>{
 const root=fixture(t);writeFileSync(path.join(root,'.env.example'),'PUBLIC_SAMPLE');assert.equal(inspectFixtureEnvironment(root).checkedPaths,24);assert.equal(assertEnvironmentBoundary().contentsRead,0);
});
test('every autoload name blocks before any framework starts, for every app root',t=>{
 const root=fixture(t);for(const dir of [root,path.join(root,'apps/admin'),path.join(root,'apps/mobile')])for(const name of environmentNames){const f=path.join(dir,name);writeFileSync(f,'SYNTHETIC_NOT_READ');let frameworkStarted=false;assert.throws(()=>{inspectFixtureEnvironment(root);frameworkStarted=true;},/HOLD/);assert.equal(frameworkStarted,false);assert.equal(readFileSync(f,'utf8'),'SYNTHETIC_NOT_READ');unlinkSync(f);}
});
test('autoload directory, broken link and parent junction stop bootstrap',t=>{
 const root=fixture(t),f=path.join(root,'.env');mkdirSync(f);assert.throws(()=>inspectFixtureEnvironment(root),/HOLD/);rmSync(f,{recursive:true});
 // Junction creation does not require Windows symlink privilege and may target a missing directory.
 symlinkSync(path.join(root,'absent'),f,process.platform==='win32'?'junction':'dir');assert.throws(()=>inspectFixtureEnvironment(root),/HOLD/);unlinkSync(f);
 rmSync(path.join(root,'apps/admin'),{recursive:true});symlinkSync(path.join(root,'apps/mobile'),path.join(root,'apps/admin'),'junction');assert.throws(()=>inspectFixtureEnvironment(root),/HOLD/);
});
test('controlled child environment excludes provider/cloud/Node injection and public overrides',()=>{
 const e=controlledEnvironment({PATH:'FIXTURE_PATH',OPENAI_API_KEY:'SYNTHETIC',SUPABASE_URL:'SYNTHETIC',NODE_OPTIONS:'--import=wrong',NODE_PATH:'wrong',NEXT_PUBLIC_URL:'wrong',EXPO_PUBLIC_READ_API_URL:'wrong',CI:'wrong',GITHUB_TOKEN:'SYNTHETIC'});
 assert.equal(e.PATH,'FIXTURE_PATH');assert.equal(e.NODE_ENV,'production');assert.equal(e.CI,'1');for(const k of ['OPENAI_API_KEY','SUPABASE_URL','NODE_OPTIONS','NODE_PATH','NEXT_PUBLIC_URL','EXPO_PUBLIC_READ_API_URL','GITHUB_TOKEN'])assert.equal(Object.hasOwn(e,k),false);
});
test('root wrappers preserve the old targets and the full verifier runs its guard first',()=>{
 const pkg=JSON.parse(readFileSync(path.join(productDirectory,'package.json')));for(const target of Object.keys(fixedTargets))assert.equal(pkg.scripts[target],'node scripts/admin-preview-policy.mjs '+target);
 const v=readFileSync(path.join(productDirectory,'scripts/verify.mjs'),'utf8');assert.ok(v.indexOf('assertEnvironmentBoundary();')<v.indexOf('spawnSync('));assert.match(v,/env:verifierEnvironment/);
});
test('actual wrapper/full verifier and native supervisor bootstrap stop on a synthetic env before the tool sentinel',t=>{
 const root=fixture(t);
 const copies=['scripts/admin-preview-policy.mjs','scripts/verify.mjs','scripts/admin-preview-supervisor.ps1','scripts/admin-preview-native.cs','scripts/admin-preview-entry.mjs','apps/admin/lib/preview-file-boundary.mjs'];
 for(const relative of copies){mkdirSync(path.dirname(path.join(root,relative)),{recursive:true});writeFileSync(path.join(root,relative),readFileSync(path.join(productDirectory,relative)));}
 const manager=path.join(root,'.local-tools/corepack/v1/pnpm/11.25.0/bin/pnpm.cjs');mkdirSync(path.dirname(manager),{recursive:true});
 const marker=path.join(root,'FRAMEWORK_STARTED');writeFileSync(manager,"require('node:fs').writeFileSync("+JSON.stringify(marker)+",'BAD');");
 writeFileSync(path.join(root,'.env.production'),'SYNTHETIC_NOT_READ');
 for(const args of [['scripts/admin-preview-policy.mjs','build:admin'],['scripts/admin-preview-policy.mjs','export:ios'],['scripts/admin-preview-policy.mjs','export:android'],['scripts/verify.mjs']]){
  const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,env:controlledEnvironment(),timeout:20000});assert.ifError(r.error);assert.notEqual(r.status,0);assert.match(r.stderr,/ENV_PRESENT/);assert.equal(existsSync(marker),false);
 }
 if(process.platform==='win32'){
  const r=spawnSync(nativePowerShell,['-NoProfile','-NonInteractive','-File',path.join(root,'scripts/admin-preview-supervisor.ps1'),'-Operation','Supervise'],{cwd:root,encoding:'utf8',windowsHide:true,env:controlledEnvironment(),input:JSON.stringify({mode:'Fixture'}),timeout:20000});assert.ifError(r.error);assert.notEqual(r.status,0);assert.match(r.stdout,/PREFLIGHT_HOLD/);assert.doesNotMatch(r.stdout,/BeforeCreate|Suspended|handshake/);assert.equal(existsSync(marker),false);
 }
});
test('original source invoked from another cwd rejects before both fake native and framework sentinels',t=>{
 const root=fixture(t),nativeMarker=path.join(root,'NATIVE_STARTED'),frameworkMarker=path.join(root,'FRAMEWORK_STARTED');
 const manager=path.join(root,'.local-tools/corepack/v1/pnpm/11.25.0/bin/pnpm.cjs');mkdirSync(path.dirname(manager),{recursive:true});writeFileSync(manager,"require('node:fs').writeFileSync("+JSON.stringify(frameworkMarker)+",'BAD');");
 mkdirSync(path.join(root,'scripts'));const literal=nativeMarker.replaceAll("'","''");writeFileSync(path.join(root,'scripts/admin-preview-supervisor.ps1'),"[IO.File]::WriteAllText('"+literal+"','BAD')\n$p=ConvertFrom-Json([Console]::In.ReadToEnd())\n$items=@();for($i=0;$i -lt $p.paths.Count;$i++){$items+=@{exists=($i -lt 3)}}\n@{status='PASS';items=$items}|ConvertTo-Json -Depth 4 -Compress\n");
 const source=path.join(productDirectory,'scripts/admin-preview-policy.mjs'),verify=path.join(productDirectory,'scripts/verify.mjs'),entry=path.join(productDirectory,'scripts/admin-preview-entry.mjs');
 for(const args of [[source,'build:admin'],[source,'export:android'],[source,'export:ios'],[verify],[entry,'--mode','Fixture'],['--input-type=module','-e',"import {nativeBoundary} from "+JSON.stringify(pathToFileURL(path.join(productDirectory,'apps/admin/lib/preview-file-boundary.mjs')).href)+";nativeBoundary('Inspect',{paths:[]});"]]){
  const r=spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,env:controlledEnvironment(),timeout:15000});assert.ifError(r.error);assert.notEqual(r.status,0);assert.match(r.stderr,/FIXED_CWD_REQUIRED/);assert.equal(existsSync(nativeMarker),false);assert.equal(existsSync(frameworkMarker),false);
 }
 if(process.platform==='win32'){
  const r=spawnSync(nativePowerShell,['-NoProfile','-NonInteractive','-File',path.join(productDirectory,'scripts/admin-preview-supervisor.ps1'),'-Operation','Supervise'],{cwd:root,encoding:'utf8',windowsHide:true,input:JSON.stringify({mode:'Fixture'}),env:controlledEnvironment(),timeout:15000});assert.ifError(r.error);assert.notEqual(r.status,0);assert.match(r.stdout,/HOLD/);assert.equal(existsSync(nativeMarker),false);assert.equal(existsSync(frameworkMarker),false);
 }
});
test('preview host and Origin are isolated from local/public hosts without changing cookie semantics',()=>{
 const old=process.env.JUDOJU_ADMIN_PROFILE;process.env.JUDOJU_ADMIN_PROFILE='preview';try{
  assert.equal(adminProfile(),'preview');assert.equal(previewOrigin,'http://127.0.0.2:62333');assertAdminRequest(new Headers({host:'127.0.0.2:62333'}));
  for(const host of ['127.0.0.1:62333','127.0.0.1:62331','localhost:62333','0.0.0.0:62333'])assert.throws(()=>assertAdminRequest(new Headers({host})),/HOST_REJECTED/);
  const runtime=createPreviewRuntime();assert.throws(()=>runtime.assertWrite(new Headers({host:'127.0.0.2:62333',origin:'http://127.0.0.1:62333','content-type':'application/json'}),'abc','abc'),/ORIGIN_OR_CONTENT_TYPE_REJECTED/);
 }finally{if(old===undefined)delete process.env.JUDOJU_ADMIN_PROFILE;else process.env.JUDOJU_ADMIN_PROFILE=old;}
});
