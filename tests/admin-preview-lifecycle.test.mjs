import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,lstatSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {createHash,randomUUID} from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import {loadPreviewAdminFixture,previewApi,previewProject,editorFunctions,serverFunctions} from '../apps/admin/lib/preview-admin-config.mjs';
import {createPreviewRuntime} from '../apps/admin/lib/runtime-preview.mjs';
import {AdminError} from '../apps/admin/lib/runtime-local.mjs';
import {adminJson} from '../apps/admin/lib/admin-request.mjs';
import {createPreviewDeadlineTools,previewLimits,readPreviewJson} from '../apps/admin/lib/preview-deadline.mjs';

const digest=x=>createHash('sha256').update(x).digest('hex');
const flush=async()=>{for(let i=0;i<500;i++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class Clock {
  time=0;next=0;tasks=new Map();
  now=()=>this.time;
  set=(fn,ms)=>{const id=++this.next;this.tasks.set(id,{at:this.time+ms,fn});return id;};
  clear=id=>this.tasks.delete(id);
  async advance(ms){const until=this.time+ms;for(;;){await flush();const item=[...this.tasks].filter(([,x])=>x.at<=until).sort((a,b)=>a[1].at-b[1].at)[0];if(!item)break;this.time=item[1].at;this.tasks.delete(item[0]);item[1].fn();}this.time=until;await flush();}
}
function fixture(t,intercept=()=>undefined){
  const root=mkdtempSync(path.join(os.tmpdir(),'judoju-p3-admin-')),priv=path.join(root,'.local-data/cloud-admin');
  mkdirSync(priv,{recursive:true});writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'@judoju/news'}));
  t.after(()=>{assert.equal(path.dirname(path.resolve(root)),path.resolve(os.tmpdir()));assert.ok(path.basename(root).startsWith('judoju-p3-admin-'));assert.ok(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink());rmSync(root,{recursive:true});});
  const owner=randomUUID(),authSession=randomUUID(),wall=Date.now(),clock=new Clock();
  const proof={schemaVersion:1,stage:'CLOUD11A',state:'ADMIN_CONNECTION_ACTIVATED',productId:'judoju-news',projectRef:previewProject,organizationRef:'qfzgicohgpuogehdyzfx',ownerUserId:owner,fixture:true,approvedAt:new Date(wall-1000).toISOString(),expiresAt:new Date(wall+3600000).toISOString(),activationDecisionSha256:'a'.repeat(64),implementationManifestSha256:'b'.repeat(64),sqlSha256:'c'.repeat(64),M2:false,realPublicationEnabled:false,workerEnabled:false,editorFunctions,serverFunctions};
  const proofBytes=Buffer.from(JSON.stringify(proof));writeFileSync(path.join(priv,'activation-proof.json'),proofBytes);
  writeFileSync(path.join(priv,'admin-server.json'),JSON.stringify({schemaVersion:1,productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',projectRef:previewProject,apiUrl:previewApi,origin:'http://127.0.0.2:62333',ownerUserId:owner,publishableKey:'FIXTURE_PUBLISHABLE',secretKey:'FIXTURE_SECRET',encryptionKey:'d'.repeat(64),fixture:true,proofSha256:digest(proofBytes)}));
  const token=['FIXTURE',Buffer.from(JSON.stringify({iss:previewApi+'/auth/v1',aud:'authenticated',role:'authenticated',sub:owner,session_id:authSession,exp:Math.floor(wall/1000)+1800})).toString('base64url'),'FIXTURE'].join('.');
  const calls=[],rows=new Map();
  const answer=(body={},status=200)=>new Response(JSON.stringify(body),{status});
  const fetcher=async(url,init)=>{
    const name=new URL(url).pathname.split('/').at(-1),body=init.body?JSON.parse(init.body):null;
    const call={name,url,body,init};calls.push(call);const result=intercept(call,{answer,token,clock,rows});if(result!==undefined)return await result;
    if(name==='m1_public_identity')return answer({productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',bootstrapId:null,contract:'M1'});
    if(name==='token'){const data={};data['access_token']=token;data['refresh_token']='FIXTURE_REFRESH';return answer(data);}
    if(name==='user')return answer({id:owner,app_metadata:{app_role:'admin',product_id:'judoju-news'}});
    if(name==='m1_open_admin_session'){rows.set(body.p_hash,body);return answer({created:true});}
    if(name==='m1_close_admin_session'){rows.delete(body.p_hash);return answer({closed:true});}
    if(name==='m1_check_editor'||name==='logout')return answer({});
    throw Error('UNEXPECTED_FIXTURE_ROUTE');
  };
  const runtime=createPreviewRuntime({loadConfig:()=>loadPreviewAdminFixture(root),fetcher,now:()=>wall,deadlines:createPreviewDeadlineTools(clock)});
  return {runtime,clock,calls,rows,token,answer};
}
const names=f=>f.calls.map(c=>c.name);
function observed(p){const state={done:false,value:null,error:null};p.then(value=>{state.done=true;state.value=value;},error=>{state.done=true;state.error=error;});return state;}

test('login order keeps pre-password fingerprint; no cleanup before grant',async t=>{
  const f=fixture(t);await f.runtime.login('fixture@example.invalid','fixture-pass');
  assert.deepEqual(names(f),['m1_public_identity','token','user','m1_open_admin_session','m1_check_editor']);
  for(const response of [()=>Promise.reject(Error('PRIVATE_TRANSPORT_DETAIL')),(c,x)=>x.answer({productId:'wrong'})]){
    const g=fixture(t,(c,x)=>c.name==='m1_public_identity'?response(c,x):undefined);
    await assert.rejects(g.runtime.login('fixture@example.invalid','fixture-pass'));
    assert.deepEqual(names(g),['m1_public_identity']);assert.equal(g.runtime.diagnostics().grantAttempted,false);
  }
});
test('fingerprint timeout bounds abort-ignoring fetch and late result cannot grant',async t=>{
  const late=deferred(),f=fixture(t,c=>c.name==='m1_public_identity'?late.promise:undefined),state=observed(f.runtime.login('fixture@example.invalid','fixture-pass'));
  await f.clock.advance(7999);assert.equal(state.done,false);await f.clock.advance(1);assert.equal(state.error.message,'PREVIEW_BACKEND_UNAVAILABLE');
  assert.equal(f.calls[0].init.signal.aborted,true);late.resolve(f.answer({productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',bootstrapId:null,contract:'M1'}));await flush();
  assert.deepEqual(names(f),['m1_public_identity']);assert.equal(f.runtime.diagnostics().lateCompletionObserved,true);assert.equal(f.runtime.diagnostics().residualPossible,false);
});
test('unknown grant times out, late token is never reused or sent to logout',async t=>{
  const late=deferred(),f=fixture(t,c=>c.name==='token'?late.promise:undefined),state=observed(f.runtime.login('fixture@example.invalid','fixture-pass'));
  await f.clock.advance(8000);assert.equal(state.error.message,'PREVIEW_BACKEND_UNAVAILABLE');assert.deepEqual(names(f),['m1_public_identity','token']);
  const data={};data['access_token']=f.token;data['refresh_token']='LATE_FIXTURE_REFRESH';late.resolve(f.answer(data));await flush();
  assert.deepEqual(names(f),['m1_public_identity','token']);assert.equal(f.runtime.diagnostics().accessReceived,false);assert.equal(f.runtime.diagnostics().residualPossible,true);
  const diagnostic=JSON.stringify(f.runtime.diagnostics());for(const secret of [f.token,'LATE_FIXTURE_REFRESH','fixture@example.invalid','fixture-pass'])assert.ok(!diagnostic.includes(secret));
});
test('known token with malformed refresh or failed getUser independently logs out once',async t=>{
  for(const stage of ['malformed','user']){
    const f=fixture(t,(c,x)=>{if(stage==='malformed'&&c.name==='token'){const data={};data['access_token']=x.token;return x.answer(data);}if(stage==='user'&&c.name==='user')return x.answer({message:'USER_DENIED'},403);});
    await assert.rejects(f.runtime.login('fixture@example.invalid','fixture-pass'),e=>e.message===(stage==='malformed'?'AUTH_RESPONSE_INVALID':'USER_DENIED'));
    assert.deepEqual(names(f),['m1_public_identity','token',...(stage==='user'?['user']:[]),'logout']);assert.equal(new URL(f.calls.at(-1).url).searchParams.get('scope'),'local');
  }
});
test('open rejection uses exactly the attempted hash; close failure cannot replace original or skip Auth',async t=>{
  const f=fixture(t,(c,x)=>c.name==='m1_open_admin_session'?x.answer({message:'OPEN_DENIED'},403):c.name==='m1_close_admin_session'?Promise.reject(Error('SECRET_CLOSE_FAILURE')):undefined);
  await assert.rejects(f.runtime.login('fixture@example.invalid','fixture-pass'),e=>e.message==='OPEN_DENIED'&&e.status===403);
  assert.deepEqual(names(f),['m1_public_identity','token','user','m1_open_admin_session','m1_close_admin_session','logout']);
  assert.equal(f.calls[3].body.p_hash,f.calls[4].body.p_hash);assert.equal(f.runtime.diagnostics().close,'UNCONFIRMED');assert.equal(f.runtime.diagnostics().authLogout,'ACKNOWLEDGED');
});
test('editor rejection and independent failed Auth cleanup preserve confirmed SQL rejection',async t=>{
  const f=fixture(t,(c,x)=>c.name==='m1_check_editor'?x.answer({message:'EDITOR_ONLY',code:'42501'},403):c.name==='logout'?x.answer({message:'LOGOUT_FAILED'},503):undefined);
  await assert.rejects(f.runtime.login('fixture@example.invalid','fixture-pass'),e=>e.message==='EDITOR_ONLY'&&e.notApplied===true);
  assert.deepEqual(names(f).slice(-3),['m1_check_editor','m1_close_admin_session','logout']);assert.equal(f.runtime.diagnostics().authLogout,'UNCONFIRMED');
});
test('late open after acknowledged close remains a residual session, not certified cancellation',async t=>{
  const late=deferred(),f=fixture(t,(c,x)=>c.name==='m1_open_admin_session'?late.promise.then(()=>{x.rows.set(c.body.p_hash,c.body);return x.answer({created:true});}):undefined);
  const state=observed(f.runtime.login('fixture@example.invalid','fixture-pass'));await f.clock.advance(8000);
  assert.equal(state.error.message,'PREVIEW_BACKEND_UNAVAILABLE');assert.equal(f.rows.size,0);assert.deepEqual(names(f).slice(-2),['m1_close_admin_session','logout']);
  late.resolve();await flush();assert.equal(f.rows.size,1);assert.equal(f.runtime.diagnostics().residualPossible,true);assert.equal(f.runtime.diagnostics().lateCompletionObserved,true);assert.equal(f.calls.length,6);
});
test('cleanup waits are independently bounded at three seconds, no retry or global revoke',async t=>{
  const never=new Promise(()=>{}),f=fixture(t,(c,x)=>c.name==='m1_check_editor'?x.answer({message:'EDITOR_ONLY'},403):['m1_close_admin_session','logout'].includes(c.name)?never:undefined),state=observed(f.runtime.login('fixture@example.invalid','fixture-pass'));
  await f.clock.advance(2999);assert.equal(state.done,false);await f.clock.advance(1);assert.equal(names(f).at(-1),'logout');assert.equal(state.done,false);
  await f.clock.advance(3000);assert.equal(state.error.message,'EDITOR_ONLY');assert.equal(f.calls.filter(x=>x.name==='logout').length,1);assert.ok(f.calls.every(c=>!/[?&]scope=(?:global|others)/.test(c.url)));
});
test('slow fingerprint and grant consume elapsed budget; final compensation stays within total 52 seconds',async t=>{
  const f=fixture(t,(c,x)=>new Promise(resolve=>x.clock.set(()=>{
    if(c.name==='m1_public_identity')resolve(x.answer({productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',bootstrapId:null,contract:'M1'}));
    else if(c.name==='token'){const data={};data['access_token']=x.token;data['refresh_token']='FIXTURE_REFRESH';resolve(x.answer(data));}
    else if(c.name==='user')resolve(x.answer({id:'wrong'}));else resolve(x.answer({}));
  },c.name==='logout'?3001:7990)));
  // Independent request bounds remain 8 seconds; invalid getUser fails before open.
  const state=observed(f.runtime.login('fixture@example.invalid','fixture-pass'));await f.clock.advance(52000);assert.equal(state.done,true);assert.equal(state.error.message,'ADMIN_REQUIRED');assert.equal(f.clock.tasks.size,0);
  assert.deepEqual(names(f),['m1_public_identity','token','user','logout']);assert.equal(previewLimits.totalLoginMs,52000);
});
test('response byte/chunk limits and abort ignoring body/cancel stay bounded',async t=>{
  const f=fixture(t,c=>c.name==='m1_public_identity'?{ok:true,status:200,headers:new Headers(),body:{getReader:()=>({read:()=>new Promise(()=>{}),cancel:()=>new Promise(()=>{}),releaseLock(){}})}}:undefined);
  const state=observed(f.runtime.login('fixture@example.invalid','fixture-pass'));await f.clock.advance(8000);assert.equal(state.done,true);assert.equal(state.error.message,'PREVIEW_BACKEND_UNAVAILABLE');assert.equal(f.calls.length,1);
  const signal=new AbortController().signal;
  for(const value of [new Uint8Array(262145),new Uint8Array(0)]){
    let cancelled=0;const r={ok:true,status:200,headers:new Headers(),body:{getReader:()=>({read:async()=>({done:false,value}),cancel:()=>{cancelled++;return new Promise(()=>{});},releaseLock(){}})}};
    await assert.rejects(readPreviewJson(r,signal),e=>e.message==='BACKEND_RESPONSE_TOO_LARGE');assert.equal(cancelled,1);
  }
});
test('normal logout failure is visible and still attempts both independent targets',async t=>{
  for(const failed of ['m1_close_admin_session','logout']){
    const f=fixture(t,(c,x)=>c.name===failed?x.answer({message:'EXPECTED_LOGOUT_FAILURE'},503):undefined);
    await assert.rejects(f.runtime.logout('a'.repeat(43),{accessToken:f.token}),e=>e.message==='EXPECTED_LOGOUT_FAILURE');
    assert.deepEqual(names(f),['m1_close_admin_session','logout']);
  }
});
test('only owned fixed-budget fixture clocks are accepted; import has no default activation',()=>{
  assert.throws(()=>createPreviewRuntime({deadlines:{kind:'NATIVE',run:()=>{}}}),/PREVIEW_CLOCK_INVALID/);
  assert.throws(()=>createPreviewRuntime({deadlines:createPreviewDeadlineTools(new Clock())}),/PREVIEW_CLOCK_INVALID/);
  assert.deepEqual(Object.keys(previewLimits),['requestMs','loginMs','cleanupMs','totalLoginMs','responseBytes','responseChunks']);
});

test('actual editor route clears cookie on started logout failure only (VM runtime fixtures)',async()=>{
  assert.equal(typeof vm.SourceTextModule,'function','Run with --experimental-vm-modules');
  const source=readFileSync(new URL('../apps/admin/app/api/editor/[...action]/route.ts',import.meta.url),'utf8');
  const js=ts.transpileModule(source,{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext}}).outputText;
  for(const mode of ['success','close-failure','csrf','session','body']){
    let logoutCalls=0;const cookies=[],context=vm.createContext({Date,Number,Promise,AdminError});
    const mod=new vm.SourceTextModule(js,{context});
    const mocks={
      '../../../../lib/admin-request.mjs':{adminJson,beforeLoginBody(){}},
      '../../../../lib/admin-profile.mjs':{adminCookie:()=>'fixture_cookie',assertAdminRequest(){}},
      'next/server':{NextResponse:{json:(body,options)=>({body,...options,cookies:{set:(...args)=>cookies.push(args)}})}},
      '../../../../lib/runtime.mjs':{AdminError,login(){throw Error('NOT_LOGIN');},editorRpc(){throw Error('NOT_WRITE');},session:async()=>{if(mode==='session')throw new AdminError('LOGIN_REQUIRED',401);return {csrf:'fixture_csrf'};},assertWrite:(headers,csrf,provided)=>{if(csrf!==undefined&&csrf!==provided)throw new AdminError('CSRF_REJECTED',403);},logout:async()=>{logoutCalls++;if(mode==='close-failure')throw new AdminError('ORIGINAL_CLOSE_FAILURE',503,true);}}
    };
    await mod.link(spec=>{const values=mocks[spec];assert.ok(values,'Unexpected route import');return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});});await mod.evaluate();
    const request=new Request('http://127.0.0.2:62333/api/editor/logout',{method:'POST',headers:{'content-type':'application/json','x-csrf-token':mode==='csrf'?'wrong':'fixture_csrf'},body:mode==='body'?'not-json':'{}'});
    Object.defineProperty(request,'cookies',{value:{get:()=>({value:'a'.repeat(43)})}});
    const response=await mod.namespace.POST(request,{params:Promise.resolve({action:['logout']})});
    const started=['success','close-failure'].includes(mode);assert.equal(logoutCalls,started?1:0);assert.equal(cookies.length,started?1:0);
    if(started){assert.equal(cookies[0][0],'fixture_cookie');assert.equal(cookies[0][1],'');assert.equal(JSON.stringify(cookies[0][2]),JSON.stringify({httpOnly:true,sameSite:'strict',secure:false,path:'/',maxAge:0}));}
    if(mode==='close-failure'){assert.equal(response.status,503);assert.equal(response.body.error,'ORIGINAL_CLOSE_FAILURE');assert.equal(response.body.not_applied,true);}
    if(mode==='success')assert.equal(response.body.loggedOut,true);
  }
});
