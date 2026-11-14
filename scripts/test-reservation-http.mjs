import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {m1FixtureClient,fixtureContent} from './m1-fixtures.mjs';
import {logout} from '../apps/admin/lib/runtime.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=await m1FixtureClient(),origin='http://127.0.0.1:3100',checks=[];
async function request(route,{method='GET',data,cookie=true,headers={}}={}){const r=await fetch(origin+'/api/reservations/'+route,{method,redirect:'error',headers:{...(cookie?{Cookie:'judoju_admin_session='+f.capability}:{}),...(data===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':f.adminSession.csrf}),...headers},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});const body=await r.json();assert.equal(r.headers.get('access-control-allow-origin'),null);assert.ok(r.headers.get('cache-control')?.includes('no-store'));return {status:r.status,body};}
async function test(name,fn){await fn();checks.push({name,status:'PASS'});}
try{
 await test('Admin list and maintenance exclude capabilities, JWTs and raw source content',async()=>{for(const route of ['list','maintenance']){const r=await request(route);assert.equal(r.status,200);const text=JSON.stringify(r.body);for(const secret of [f.capability,f.adminSession.accessToken,f.adminSession.refreshToken])assert.ok(!text.includes(secret));assert.equal(r.body.real_push_sent,0);}});
 await test('Anonymous, consumer capability and invalid Origin/CSRF cannot mutate admin schedules',async()=>{
  const r=await request('list',{cookie:false});assert.equal(r.status,401);
  const args={p_schedule:randomUUID(),p_revision:1,p_request:randomUUID()};
  assert.equal((await request('cancel',{method:'POST',data:args,headers:{Origin:'https://example.invalid'}})).status,403);
  assert.equal((await request('cancel',{method:'POST',data:args,headers:{'X-CSRF-Token':'bad'}})).status,403);
  assert.equal((await request('cancel',{method:'POST',data:args,cookie:false,headers:{Authorization:'Bearer consumer-capability'}})).status,401);
  assert.equal((await request('list',{method:'OPTIONS'})).status,405);
 });
 await test('Exact request shape, timezone and body-size limits reject before mutation',async()=>{
  assert.equal((await request('configure',{method:'POST',data:{p_enabled:false,command:'arbitrary'}})).status,400);
  assert.equal((await request('unknown',{method:'POST',data:{}})).status,400);
  assert.equal((await request('create',{method:'POST',data:{text:'x'.repeat(5000)}})).status,413);
 });
 await test('Maintenance pause/resume records the server-derived authenticated admin',async()=>{
  const before=f.sql('select count(*) from private.audits where actor_id='+f.quote(f.adminSession.userId)+" and action in('ADMIN_MAINTENANCE_PAUSE','ADMIN_MAINTENANCE_ENABLE');");
  assert.equal((await request('configure',{method:'POST',data:{p_enabled:false,p_actor:randomUUID()}})).status,400);
  try{assert.equal((await request('configure',{method:'POST',data:{p_enabled:false}})).status,200);}finally{assert.equal((await request('configure',{method:'POST',data:{p_enabled:true}})).status,200);}
  const after=f.sql('select count(*) from private.audits where actor_id='+f.quote(f.adminSession.userId)+" and action in('ADMIN_MAINTENANCE_PAUSE','ADMIN_MAINTENANCE_ENABLE');");assert.equal(Number(after)-Number(before),2);
 });
 await test('Actual admin HTTP create replay, request status and cancel are idempotent',async()=>{
  let d=await f.create();await f.editor('m1_save_draft',{p_issue:d.issue_id,p_expected_revision:d.draft_revision,p_content:fixtureContent(d,{title:'SYNTHETIC 6E HTTP reservation'})});d=await f.editor('m1_get_draft',{p_issue:d.issue_id});
  const args={p_issue:d.issue_id,p_draft_revision:d.draft_revision,p_issue_revision:d.issue_revision,p_policy:d.policy_version,p_catalog:d.catalog_version,p_due_at:new Date(Date.now()+120000).toISOString(),p_request:randomUUID()};
  const a=await request('create',{method:'POST',data:args}),b=await request('create',{method:'POST',data:args});assert.equal(a.status,200);assert.deepEqual(a.body,b.body);
  assert.equal((await request('create',{method:'POST',data:{...args,p_due_at:new Date(Date.now()+240000).toISOString()}})).status,409);
  const status=await request('request?id='+args.p_request);assert.equal(status.body.result.schedule_id,a.body.schedule_id);
  const list=await request('list?issue='+d.issue_id);assert.ok(list.body.items.every(x=>x.issue_id===d.issue_id));assert.match(list.body.request_owner,/^[0-9a-f]{64}$/);
  const cancel={p_schedule:a.body.schedule_id,p_revision:1,p_request:randomUUID()};const c=await request('cancel',{method:'POST',data:cancel});assert.equal(c.body.status,'CANCELLED');assert.deepEqual((await request('cancel',{method:'POST',data:cancel})).body,c.body);
  assert.equal(f.sql('select count(*) from private.article_versions where issue_id='+f.quote(d.issue_id)+';'),'0');
 });
 await test('Public read gateway still rejects credentials and exposes no reservation mutation',async()=>{let r=await fetch('http://127.0.0.1:62330/articles',{headers:{Authorization:'Bearer not-a-public-client'}});assert.ok([401,403].includes(r.status));r=await fetch('http://127.0.0.1:62330/api/reservations/create',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(r.status,405);});
 const result={status:'PASS',checks,onlyOwnedLocalSynthetic:true,realNewsRequests:0,realPushSent:0};writePrivate('stage06e-http-tests.json',result);console.log(JSON.stringify(result));
}finally{await logout(f.capability,f.adminSession);}
