import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,rmdirSync,lstatSync,symlinkSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {loadPreviewAdminFixture,editorFunctions,serverFunctions,previewApi,previewProject} from '../apps/admin/lib/preview-admin-config.mjs';
import {createPreviewRuntime} from '../apps/admin/lib/runtime-preview.mjs';
import {adminProfile,adminCookie,assertAdminRequest} from '../apps/admin/lib/admin-profile.mjs';
import {adminJson} from '../apps/admin/lib/admin-request.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
function fixture(){
 const root=mkdtempSync(path.join(os.tmpdir(),'judoju-cloud11a-'));
 const privateDir=path.join(root,'.local-data/cloud-admin');mkdirSync(privateDir,{recursive:true});writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@judoju/news'}));
 const owner=randomUUID(),now=Date.now(),proof={schemaVersion:1,stage:'CLOUD11A',state:'ADMIN_CONNECTION_ACTIVATED',productId:'judoju-news',projectRef:previewProject,organizationRef:'qfzgicohgpuogehdyzfx',ownerUserId:owner,fixture:true,approvedAt:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),activationDecisionSha256:'a'.repeat(64),implementationManifestSha256:'b'.repeat(64),sqlSha256:'c'.repeat(64),M2:false,realPublicationEnabled:false,workerEnabled:false,editorFunctions,serverFunctions};
 const config={schemaVersion:1,productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',projectRef:previewProject,apiUrl:previewApi,origin:'http://127.0.0.2:62333',ownerUserId:owner,publishableKey:'FIXTURE_PUBLISHABLE',secretKey:'FIXTURE_SECRET',encryptionKey:'d'.repeat(64),fixture:true};
 function save(){const b=Buffer.from(JSON.stringify(proof));writeFileSync(path.join(privateDir,'activation-proof.json'),b);writeFileSync(path.join(privateDir,'admin-server.json'),JSON.stringify({...config,proofSha256:hash(b)}));}
 save();
 function cleanup(){const target=path.resolve(root),parent=path.resolve(os.tmpdir());assert.equal(path.dirname(target),parent);assert.ok(path.basename(target).startsWith('judoju-cloud11a-'));assert.ok(lstatSync(target).isDirectory()&&!lstatSync(target).isSymbolicLink());rmSync(target,{recursive:true});}
 return {root,owner,proof,config,save,cleanup,load:()=>loadPreviewAdminFixture(root)};
}
function mocked(f,options={}){
 const requests=[],rows=new Map(),authSession=randomUUID();let revoked=false;
 const user={id:f.owner,app_metadata:{app_role:'admin',product_id:'judoju-news'},...options.user};
 const claims={iss:previewApi+'/auth/v1',aud:'authenticated',role:'authenticated',sub:f.owner,session_id:authSession,exp:Math.floor(Date.now()/1000)+1800,...options.claims};
 const token=['FIXTURE',Buffer.from(JSON.stringify(claims)).toString('base64url'),'FIXTURE'].join('.');
 const fetcher=async(url,init)=>{
  assert.ok(url.startsWith(previewApi+'/'));assert.equal(init.redirect,'error');assert.equal(init.cache,'no-store');assert.ok(init.signal);
  const name=new URL(url).pathname.split('/').at(-1),body=init.body?JSON.parse(init.body):undefined;requests.push({url,init,body});
  const answer=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'Content-Type':'application/json'}});
  if(options.intercept){const r=await options.intercept({url,name,body,init});if(r)return r;}
  if(name==='m1_public_identity')return answer({productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',bootstrapId:null,contract:'M1',...options.identity});
  if(url.endsWith('/token?grant_type=password'))return answer({access_token:token,refresh_token:'FIXTURE_REFRESH'});
  if(name==='user')return answer(user);
  if(name==='logout'){revoked=true;return answer({});}
  if(serverFunctions.includes(name)){
   assert.equal(init.headers.apikey,'FIXTURE_SECRET');assert.equal(init.headers.Authorization,undefined);
   if(name==='m1_open_admin_session'){rows.set(body.p_hash,{ciphertext:body.p_ciphertext,user_id:body.p_user,auth_session_id:body.p_auth_session,expires_at:body.p_expires});return answer({created:true},201);}
   if(name==='m1_read_admin_session')return answer(rows.get(body.p_hash)??null);
   if(name==='m1_close_admin_session'){rows.delete(body.p_hash);return answer({closed:true});}
  }
  if(editorFunctions.includes(name)){
   assert.equal(init.headers.apikey,'FIXTURE_PUBLISHABLE');assert.equal(init.headers.Authorization,'Bearer '+token);
   return options.noMembership||revoked?answer({message:'EDITOR_ONLY',code:'42501'},403):answer(name==='m1_check_editor'?{admin:true,sample_kind:'SYNTHETIC'}:{ok:true});
  }
  throw Error('UNEXPECTED_FIXTURE_REQUEST');
 };
 return {runtime:createPreviewRuntime({loadConfig:f.load,fetcher}),requests,rows,token,fetcher};
}
test('import/build has no private-config I/O or network, for either profile',()=>{
 const module=fileURLToPath(new URL('../apps/admin/lib/runtime.mjs',import.meta.url));
 for(const profile of ['local','preview']){
  const r=spawnSync(process.execPath,['--input-type=module','-e',"globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')}; await import("+JSON.stringify(module.replaceAll('\\','/').replace(/^([A-Za-z]):/,'file:///$1:'))+"); console.log('IMPORTED');"],{cwd:os.tmpdir(),encoding:'utf8',windowsHide:true,env:{...process.env,JUDOJU_ADMIN_PROFILE:profile}});
  assert.equal(r.status,0,r.stderr);assert.match(r.stdout,/IMPORTED/);
 }
});
test('fixture cannot use default network, copied config, real product root or endpoint override',async()=>{
 const f=fixture();try{
  const c=f.load();await assert.rejects(createPreviewRuntime({loadConfig:()=>c}).assertFingerprint(),/PREVIEW_ADMIN_NOT_ACTIVATED/);
  await assert.rejects(createPreviewRuntime({loadConfig:()=>({...c}),fetcher:()=>{throw Error('NO_NETWORK')}}).assertFingerprint(),/PREVIEW_ADMIN_NOT_ACTIVATED/);
  f.config.apiUrl='https://zkzevpinuixeuyjlffwi.supabase.co';f.save();assert.throws(f.load,/PREVIEW_ADMIN_CONFIG_REJECTED/);
  assert.throws(()=>loadPreviewAdminFixture(fileURLToPath(new URL('../',import.meta.url))),/PREVIEW_ADMIN_CONFIG_REJECTED/);
 }finally{f.cleanup();}
});
test('proof mismatch, missing fields, expired approval and widened RPC grants reject before transport',()=>{
 for(const alter of [f=>{f.proof.expiresAt=new Date(Date.now()-1000).toISOString();},f=>{f.proof.editorFunctions=[...editorFunctions,'m0_enqueue'];},f=>{f.config.fixture=false;},f=>{f.config.secretKey='LEGACY_JWT';},f=>{f.config.extra='forbidden';},f=>{f.proof.M2=true;}]){
  const f=fixture();try{alter(f);f.save();assert.throws(f.load,/PREVIEW_ADMIN_CONFIG_REJECTED/);}finally{f.cleanup();}
 }
 const f=fixture();try{writeFileSync(path.join(f.root,'.local-data/cloud-admin/activation-proof.json'),'{}');assert.throws(f.load,/PREVIEW_ADMIN_CONFIG_REJECTED/);}finally{f.cleanup();}
});
test('reparse/junction components and partial private files are rejected',()=>{
 const f=fixture(),target=fixture();try{
  const ownDir=path.join(f.root,'.local-data/cloud-admin');
  rmSync(path.join(ownDir,'admin-server.json'));rmSync(path.join(ownDir,'activation-proof.json'));rmdirSync(ownDir);
  symlinkSync(path.join(target.root,'.local-data/cloud-admin'),ownDir,process.platform==='win32'?'junction':'dir');
  assert.throws(f.load,/PREVIEW_ADMIN_CONFIG_REJECTED/);
 }finally{f.cleanup();target.cleanup();}
 const partial=fixture();try{writeFileSync(path.join(partial.root,'.local-data/cloud-admin/admin-server.json'),'{');assert.throws(partial.load,/PREVIEW_ADMIN_CONFIG_REJECTED/);}finally{partial.cleanup();}
});
test('headers separate public identity, verified editor JWT and secret-only session RPC',async()=>{
 const f=fixture();try{
  const {runtime:r,requests,rows,token}=mocked(f),login=await r.login('owner@example.invalid','FIXTURE_PASSWORD');
  assert.deepEqual(Object.keys(login).sort(),['capability','csrf','expires']);assert.match(login.capability,/^[A-Za-z0-9_-]{43}$/);assert.ok(!JSON.stringify(login).includes(token));
  assert.ok(![...rows.values()][0].ciphertext.includes(token));
  const s=await r.session(login.capability);assert.equal(s.userId,f.owner);
  assert.ok(requests.some(x=>x.url.endsWith('/auth/v1/user')));assert.ok(requests.some(x=>x.url.endsWith('/m1_open_admin_session')));
  for(const q of requests){if(!serverFunctions.some(n=>q.url.endsWith('/'+n)))assert.equal(q.init.headers.apikey,'FIXTURE_PUBLISHABLE');assert.notEqual(q.init.headers.Authorization,'Bearer FIXTURE_SECRET');}
  await r.logout(login.capability,s);assert.equal(rows.size,0);await assert.rejects(r.session(login.capability),/LOGIN_REQUIRED/);
  const close=requests.findIndex(q=>q.url.endsWith('/m1_close_admin_session')),logout=requests.findIndex(q=>new URL(q.url).pathname==='/auth/v1/logout');assert.ok(close<logout);assert.equal(new URL(requests[logout].url).searchParams.get('scope'),'local');
 }finally{f.cleanup();}
});
test('identity, owner, current metadata, ban, JWT session/audience/issuer/expiry and DB membership all deny',async()=>{
 const variants=[{identity:{environment:'local'}},{identity:{bootstrapId:randomUUID()}},{user:{id:randomUUID()}},{user:{app_metadata:{app_role:'reader',product_id:'judoju-news'},user_metadata:{app_role:'admin'}}},{user:{app_metadata:{app_role:'admin',product_id:'different'}}},{user:{banned_until:new Date(Date.now()+60000).toISOString()}},{user:{deleted_at:new Date().toISOString()}},{claims:{session_id:'bad'}},{claims:{iss:'https://unrelated.invalid/auth/v1'}},{claims:{aud:'other'}},{claims:{role:'service_role'}},{claims:{exp:1}},{noMembership:true}];
 for(const options of variants){const f=fixture();try{const m=mocked(f,options);await assert.rejects(m.runtime.login('owner@example.invalid','FIXTURE_PASSWORD'),/PRODUCT_FINGERPRINT_MISMATCH|ADMIN_REQUIRED|EDITOR_ONLY/);}finally{f.cleanup();}}
});
test('each exact RPC allowlist works; arbitrary/worker/REAL/legacy routes never reach transport',async()=>{
 const f=fixture();try{
  const m=mocked(f),r=m.runtime,l=await r.login('owner@example.invalid','FIXTURE_PASSWORD'),s=await r.session(l.capability);
  for(const name of editorFunctions)await r.editorRpc(name,{},s);
  const before=m.requests.length;
  for(const n of ['m0_runtime_identity','m0_enqueue','reservation_create','installation_admin_stats','maintenance_configure','m1_open_admin_session','../m1_check_editor'])await assert.rejects(r.editorRpc(n,{},s),/PREVIEW_RPC_NOT_ALLOWED/);
  for(const n of ['m1_publish_draft','catalog_apply','maintenance_tick','../m1_read_admin_session'])await assert.rejects(r.serverRpc(n,{}),/PREVIEW_RPC_NOT_ALLOWED/);
  assert.equal(m.requests.length,before);
 }finally{f.cleanup();}
});
test('server failure does not retry; Auth local logout is independently attempted after SQL close failure',async()=>{
 const f=fixture();try{
  let calls=0;const m=mocked(f,{intercept:({name})=>{if(name==='m1_close_admin_session'){calls++;throw Error('UNKNOWN');}}});
  const l=await m.runtime.login('owner@example.invalid','FIXTURE_PASSWORD'),s=await m.runtime.session(l.capability);
  await assert.rejects(m.runtime.logout(l.capability,s),/PREVIEW_BACKEND_UNAVAILABLE/);assert.equal(calls,1);const auth=m.requests.filter(q=>new URL(q.url).pathname==='/auth/v1/logout');assert.equal(auth.length,1);assert.equal(new URL(auth[0].url).searchParams.get('scope'),'local');
 }finally{f.cleanup();}
});
test('response parsing bounds and safe errors; unknown write result remains not-applied false',async()=>{
 for(const response of [()=>new Response('not-json'),()=>new Response(' '.repeat(262145)),()=>new Response(JSON.stringify({message:'private API credential output must be suppressed'}),{status:500})]){
  const f=fixture();try{const m=mocked(f,{intercept:({name})=>name==='m1_public_identity'?response():null});await assert.rejects(m.runtime.assertFingerprint(),/BACKEND_RESPONSE_INVALID|BACKEND_RESPONSE_TOO_LARGE|REQUEST_REJECTED/);}finally{f.cleanup();}
 }
});
test('profile/cookie, exact Host/Origin, CSRF and disabled preview feature gates',()=>{
 const old=process.env.JUDOJU_ADMIN_PROFILE;try{
  process.env.JUDOJU_ADMIN_PROFILE='preview';assert.equal(adminProfile(),'preview');assert.equal(adminCookie(),'judoju_admin_preview_session');
  const h=new Headers({host:'127.0.0.2:62333',origin:'http://127.0.0.2:62333','content-type':'application/json'}),r=createPreviewRuntime();
  assert.doesNotThrow(()=>assertAdminRequest(h,'editor'));assert.doesNotThrow(()=>r.assertWrite(h,'abc','abc'));
  for(const feature of ['analytics','installations','reservations','ranking','sources','settings'])assert.throws(()=>assertAdminRequest(h,feature),/PREVIEW_FEATURE_NOT_CONNECTED/);
  for(const key of ['host','origin','content-type']){const bad=new Headers(h);bad.set(key,'untrusted');assert.throws(()=>r.assertWrite(bad,'abc','abc'),/ORIGIN_OR_CONTENT_TYPE_REJECTED/);}
  assert.throws(()=>r.assertWrite(h,'abc','abd'),/CSRF_REJECTED/);assert.throws(()=>assertAdminRequest(new Headers({host:'localhost:62333'})),/HOST_REJECTED/);
  process.env.JUDOJU_ADMIN_PROFILE='invalid';assert.throws(adminProfile,/ADMIN_PROFILE_REJECTED/);
  process.env.JUDOJU_ADMIN_PROFILE='local';assert.equal(adminCookie(),'judoju_admin_session');
 }finally{if(old===undefined)delete process.env.JUDOJU_ADMIN_PROFILE;else process.env.JUDOJU_ADMIN_PROFILE=old;}
});
test('login attempt ceiling is global to the process, not spoofed IP headers',async()=>{
 const f=fixture();try{const m=mocked(f);for(let n=0;n<5;n++)await assert.rejects(m.runtime.login('', ''),/LOGIN_INVALID/);await assert.rejects(m.runtime.login('owner@example.invalid','FIXTURE_PASSWORD'),/LOGIN_RATE_LIMITED/);assert.equal(m.requests.length,0);}finally{f.cleanup();}
});
test('streaming request limit cancels over-limit body and JSON rejects non-objects',async()=>{
 assert.deepEqual(await adminJson(new Request('http://127.0.0.1',{method:'POST',body:'{"test":true}'})),{test:true});
 await assert.rejects(adminJson(new Request('http://127.0.0.1',{method:'POST',body:'[]'})),/INVALID_JSON/);
 let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new Uint8Array(131073));},cancel(){cancelled=true;}});
 await assert.rejects(adminJson(new Request('http://127.0.0.1',{method:'POST',body,duplex:'half'})),/REQUEST_TOO_LARGE/);assert.equal(cancelled,true);
});
test('request deadline returns even when underlying stream cancellation never settles',async()=>{
 let cancelled=false,timer;const started=Date.now();
 const body=new ReadableStream({pull(){},cancel(){cancelled=true;return new Promise(()=>{});}});
 try{
  await Promise.race([assert.rejects(adminJson(new Request('http://127.0.0.1',{method:'POST',body,duplex:'half'})),e=>e.message==='REQUEST_TIMEOUT'&&e.status===408),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('RESPONSE_DEADLINE_EXCEEDED')),4200);})]);
  assert.equal(cancelled,true);assert.ok(Date.now()-started<4200);
 }finally{clearTimeout(timer);}
});
test('old local runtime is byte-identical to Git baseline, preview UI never mounts reservation child',()=>{
 const root=fileURLToPath(new URL('../',import.meta.url));
 const original=spawnSync('git',['show','99a83e6f6407fb2dd42a1df373f9b1be201ba559:apps/admin/lib/runtime.mjs'],{cwd:root,windowsHide:true});assert.equal(original.status,0);
 assert.deepEqual(readFileSync(path.join(root,'apps/admin/lib/runtime-local.mjs')),original.stdout);
 const ui=readFileSync(path.join(root,'apps/admin/components/AdminConsole.tsx'),'utf8');assert.match(ui,/!previewMode&&<ReservationManager/);assert.match(ui,/previewMode&&initialPath/);
 for(const name of ['editor','catalog','analytics','reservations','installations'])assert.ok(readFileSync(path.join(root,'apps/admin/app/api',name,'[...action]/route.ts'),'utf8').includes('assertAdminRequest(request.headers'));
});
