import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { stateRecoveryDraft } from '../apps/admin/lib/editor-state.mjs';
import { m1FixtureClient,fixtureContent } from './m1-fixtures.mjs';
import { createPublicGateway,publicConfig } from './public-read-gateway.mjs';
import { logout,session as readAdminSession } from '../apps/admin/lib/runtime.mjs';
import { writePrivate,command } from './local-runtime.mjs';
import { setTimeout as sleep } from 'node:timers/promises';
const f=await m1FixtureClient(),run=randomUUID(),cases=[],origin='http://127.0.0.1:3100';let g,failed,cookie,csrf;
async function test(name,fn){await fn();cases.push({name,status:'PASS'});console.log(JSON.stringify(cases.at(-1)));}
async function admin(action,data,{sendCookie=true,sendCsrf=true,requestOrigin=origin}={}){
 const r=await fetch(origin+'/api/editor/'+action,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json',Origin:requestOrigin}),...(sendCookie&&cookie?{Cookie:cookie}:{}),...(sendCsrf&&csrf?{'X-CSRF-Token':csrf}:{})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000),redirect:'error'});
 let body;try{body=await r.json();}catch{body=null;}return {r,body};
}
async function ok(action,data){const x=await admin(action,data);assert.equal(x.r.status,200,JSON.stringify(x.body));return x.body;}
try{
g=await createPublicGateway(publicConfig(),{port:0});const base='http://127.0.0.1:'+g.port;
await test('Next login emits opaque HttpOnly cookie only; CSRF/Origin/non-admin rejected',async()=>{
 assert.equal((await admin('session',undefined,{sendCookie:false})).r.status,401);
 const denied=await admin('login',{email:f.state.users.admin.email,password:f.state.users.admin.password},{requestOrigin:'http://evil.invalid'});assert.equal(denied.r.status,403);
 assert.equal((await admin('login',{email:f.state.users.general.email,password:f.state.users.general.password})).r.status,403);
 const signed=await admin('login',{email:f.state.users.admin.email,password:f.state.users.admin.password});assert.equal(signed.r.status,200);const setCookie=signed.r.headers.get('set-cookie');assert.match(setCookie,/HttpOnly/i);assert.match(setCookie,/SameSite=strict/i);cookie=setCookie.split(';')[0];csrf=signed.body.csrf;
 assert.ok(!JSON.stringify(signed.body).includes('access_token'));assert.equal((await admin('create',{p_request:randomUUID()},{sendCsrf:false})).r.status,403);
 assert.equal((await ok('session')).admin,true);
});
await test('Actual editor HTTP → draft/preview/publish → anonymous gateway → correction/hide',async()=>{
 const issue=await ok('create',{p_request:randomUUID()});let d=await ok('draft?id='+issue.issue_id);
 await ok('save',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d,{kind:'RELATED',title:'SYNTHETIC HTTP 확인 '+run})});d=await ok('draft?id='+d.issue_id);
 const preview=await ok('preview',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_policy:d.policy_version,p_catalog:d.catalog_version});
 await ok('publish',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_effect_key:run+':publish'});
 let detail=await fetch(base+'/articles/'+d.issue_id);assert.equal(detail.headers.get('cache-control'),'no-store');let article=(await detail.json()).data;assert.deepEqual(article.body,preview.body);assert.ok(!Object.hasOwn(article.body,'scenarios'));
 f.sql('update private.claims set fact_current=false where issue_id='+f.quote(d.issue_id)+';');detail=await fetch(base+'/articles/'+d.issue_id);article=(await detail.json()).data;assert.equal(article.state,'CORRECTION_PENDING');assert.ok(!Object.hasOwn(article,'body'));
 const legacy=await f.rpc('get_public_article',{p_issue:d.issue_id},{role:'anon'});assert.equal(legacy.body.state,'CORRECTION_PENDING');assert.ok(!Object.hasOwn(legacy.body,'body'));
 assert.equal((await f.request('news_list?issue_id=eq.'+d.issue_id,{role:'anon'})).body.length,0);
 f.sql('update private.claims set fact_current=true where issue_id='+f.quote(d.issue_id)+';');d=await ok('draft?id='+d.issue_id);
 await ok('state',{p_issue:d.issue_id,p_expected_revision:d.issue_revision,p_state:'HIDDEN',p_effect_key:run+':hide'});
 detail=await fetch(base+'/articles/'+d.issue_id);article=(await detail.json()).data;assert.equal(article.state,'HIDDEN');assert.ok(!Object.hasOwn(article,'body'));
 const list=(await(await fetch(base+'/articles')).json()).data;assert.ok(!list.some(x=>x.issue_id===d.issue_id));
});
await test('Transactional outbox dispatcher restart/idempotency and real Docker worker receipts',async()=>{
 const dispatched=await Promise.all([f.rpc('m1_dispatch_outbox',{p_limit:100}),f.rpc('m1_dispatch_outbox',{p_limit:100})]);assert.ok(dispatched.every(x=>x.status===200));
 assert.equal(f.sql('select count(*) from private.jobs where effect_key='+f.quote(run+':publish')+';'),'1');
 assert.equal((await f.rpc('m1_dispatch_outbox',{p_limit:100})).body.length,0);
 for(let i=0;i<2;i++){const process=command(globalThis.process.execPath,['scripts/m1-outbox-dispatcher.mjs','--once']);assert.equal(process.code,0,'Actual dispatcher process must restart without duplicate enqueue');}
 assert.equal(f.sql('select count(*) from private.jobs where effect_key='+f.quote(run+':publish')+';'),'1');
 const started=Date.now();let success=false;while(Date.now()-started<25000){if(f.sql('select count(*) from private.jobs j join private.effect_receipts r on r.effect_key=j.effect_key where j.effect_key in ('+f.quote(run+':publish')+','+f.quote(run+':hide')+") and j.state='SUCCEEDED';")==='2'){success=true;break;}await sleep(500);}assert.ok(success,'Actual common worker must receipt and ACK both manual effects');
});
await test('S5I-C04: HTTP SQL rejection is typed; fresh state and same-key outbox status resolve conflicts without duplicate effects',async()=>{
 const created=await ok('create',{p_request:randomUUID()});let d=await ok('draft?id='+created.issue_id);
 await ok('save',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d)});d=await ok('draft?id='+d.issue_id);
 const stale={p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_effect_key:run+':stale'};
 await ok('save',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d,{title:'SYNTHETIC 다른 편집 세션 수정'})});
 const rejected=await admin('publish',stale);assert.equal(rejected.r.status,409);assert.equal(rejected.body.error,'REVISION_CONFLICT');assert.equal(rejected.body.not_applied,true);
 d=await ok('draft?id='+d.issue_id);assert.ok(d.draft_revision>stale.p_expected_revision);assert.equal((await ok('operation?id='+d.issue_id+'&key='+stale.p_effect_key)).state,'UNKNOWN');
 const a={...stale,p_expected_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_effect_key:run+':recovered'};
 await ok('publish',a);assert.equal((await ok('operation?id='+d.issue_id+'&key='+a.p_effect_key)).state,'APPLIED');assert.equal((await ok('publish',a)).status,'ALREADY_APPLIED');
 assert.equal(f.sql('select count(*) from private.outbox where issue_id='+f.quote(d.issue_id)+';'),'1');
 const hide={p_issue:d.issue_id,p_expected_revision:d.issue_revision,p_state:'HIDDEN',p_effect_key:run+':stale-hide'};
 const blocked=await admin('state',hide);assert.equal(blocked.r.status,409);assert.equal(blocked.body.not_applied,true);assert.equal((await ok('operation?id='+d.issue_id+'&key='+hide.p_effect_key)).state,'UNKNOWN');
 // This is an actual successful response + read-back. Network-loss handling is separately simulated by editor-state unit cases.
 d=await ok('draft?id='+d.issue_id);await ok('state',{...hide,p_expected_revision:d.issue_revision,p_effect_key:run+':resolved-hide'});
});
await test('S5I-C05: another editor draft save followed by successful hide cannot be overwritten with an adopted revision',async()=>{
 const created=await ok('create',{p_request:randomUUID()});let d=await ok('draft?id='+created.issue_id);
 await ok('save',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d)});d=await ok('draft?id='+d.issue_id);
 await ok('publish',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_effect_key:run+':cas-publish'});
 const a=await ok('draft?id='+d.issue_id);a.content.title='SYNTHETIC A 아직 저장하지 않은 내용';
 // A separate actual authenticated editor session writes the newer draft.
 const b=await f.editor('m1_get_draft',{p_issue:d.issue_id});await f.editor('m1_save_draft',{p_issue:b.issue_id,p_expected_revision:b.draft_revision,p_content:fixtureContent(b,{title:'SYNTHETIC B 저장본 보호'})});
 await ok('state',{p_issue:a.issue_id,p_expected_revision:a.issue_revision,p_state:'HIDDEN',p_effect_key:run+':cas-hide'});
 const latest=await ok('draft?id='+d.issue_id),recovered=stateRecoveryDraft(a,latest);assert.equal(recovered.needsReload,true);assert.equal(recovered.draft.draft_revision,a.draft_revision);assert.equal(recovered.draft.state,'HIDDEN');
 // Browser helper behavior is simulated here; SQL/HTTP stale-save rejection is actual.
 const rejected=await admin('save',{p_issue:a.issue_id,p_expected_revision:recovered.draft.draft_revision,p_content:recovered.draft.content});assert.equal(rejected.r.status,409);assert.equal(rejected.body.error,'REVISION_CONFLICT');
 const preserved=await ok('draft?id='+d.issue_id);assert.equal(preserved.content.title,'SYNTHETIC B 저장본 보호');assert.equal(preserved.draft_revision,latest.draft_revision);
});
await test('Logout removes both HTTP capability and old direct RPC access',async()=>{
 const prior=await readAdminSession(cookie.split('=')[1]);await ok('logout',{});assert.equal((await admin('session')).r.status,401);assert.equal((await admin('create',{p_request:randomUUID()})).r.status,401);
 assert.equal((await f.rpc('m1_check_editor',{}, {token:prior.accessToken})).status,403);assert.equal((await f.rpc('m0_admin_view_count',{p_issue:randomUUID()},{token:prior.accessToken})).status,403);
});
}catch(e){failed=e;}finally{if(g)await g.close();await logout(f.capability,f.adminSession);writePrivate('m1-http-'+run+'.json',{productId:'judoju-news',sample_kind:'SYNTHETIC',status:failed?'FAIL':'PASS',cases,createdAt:new Date().toISOString(),browserUi:'PENDING',android:'PENDING',ios:'PENDING',realSourceRequests:0});}
if(failed)throw failed;
