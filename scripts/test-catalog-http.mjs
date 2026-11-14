import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {fixtureContent} from './m1-fixtures.mjs';
import {authFixtures} from './m1-auth-fixtures.mjs';
import {createPublicGateway,publicConfig} from './public-read-gateway.mjs';
import {writePrivate} from './local-runtime.mjs';
const f=await authFixtures(),origin='http://127.0.0.1:3100',checks=[],created=[];let cookie,csrf,g,failure;
async function test(name,fn){await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));}
async function request(route,data,options={}){
 const r=await fetch(origin+route,{method:data===undefined?'GET':'POST',redirect:'error',headers:{...(cookie?{Cookie:cookie}:{}),...(data===undefined?{}:{'Content-Type':'application/json',Origin:options.origin??origin,...(options.csrf===false?{}:{'X-CSRF-Token':csrf??''})})},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(15000)});
 return {status:r.status,body:await r.json(),headers:r.headers};
}
try{
await test('Actual admin HTTP requires opaque session, matching Origin and CSRF before catalog operations',async()=>{
 assert.equal((await request('/api/catalog/summary')).status,401);
 const login=await request('/api/editor/login',{email:f.state.users.admin.email,password:f.state.users.admin.password});assert.equal(login.status,200);cookie=login.headers.get('set-cookie').split(';')[0];csrf=login.body.csrf;
 const malformed={p_expected:1,p_operation_key:randomUUID(),p_kind:'SECTOR_CREATE',p_entity:null,p_payload:{}};
 assert.equal((await request('/api/catalog/mutate',malformed,{origin:'http://evil.invalid'})).status,403);
 assert.equal((await request('/api/catalog/mutate',malformed,{csrf:false})).status,403);
 const summary=await request('/api/catalog/summary');assert.equal(summary.status,200);assert.equal(summary.body.total,67);assert.ok(!JSON.stringify(summary.body).includes('access_token'));
 const rejected=await request('/api/catalog/mutate',malformed);assert.equal(rejected.status,409);assert.equal(rejected.body.status,'REJECTED');assert.equal(rejected.body.not_applied,true);
 const lookup=await request('/api/catalog/operation',malformed);assert.deepEqual(lookup.body,rejected.body);
 assert.equal((await request('/api/catalog/raw')).status,404);
});
g=await createPublicGateway(publicConfig(),{port:0});const base='http://127.0.0.1:'+g.port;
await test('HTTP fixture publication creates two current-day articles without relying on yesterday’s existing samples',async()=>{
 const catalog=(await request('/api/editor/catalog-current')).body;
 for(let n=0;n<2;n++){
  const createdResult=await request('/api/editor/create',{p_request:randomUUID()});assert.equal(createdResult.status,200);const id=createdResult.body.issue_id;created.push(id);
  const d=(await request('/api/editor/draft?id='+id)).body,content=fixtureContent(d,{title:'SYNTHETIC HTTP6B · '+randomUUID()});content.primary_sector_id=catalog.sectors[0].id;content.impacts=content.impacts.map(x=>({...x,sector_id:catalog.sectors[0].id}));
  assert.equal((await request('/api/editor/save-catalog',{p_issue:id,p_expected_revision:d.draft_revision,p_content:content,p_catalog:Number(catalog.catalog_version)})).status,200);
  const saved=(await request('/api/editor/draft?id='+id)).body;
  assert.equal((await request('/api/editor/preview',{p_issue:id,p_expected_revision:saved.draft_revision,p_policy:saved.policy_version,p_catalog:saved.catalog_version})).status,200);
  assert.equal((await request('/api/editor/publish',{p_issue:id,p_expected_revision:saved.draft_revision,p_issue_revision:saved.issue_revision,p_policy:saved.policy_version,p_catalog:saved.catalog_version,p_effect_key:randomUUID()})).status,200);
 }
});
await test('Actual v1 HTTP catalog IDs remain separate from the new56-leaf v2 tree',async()=>{
 const v1=await(await fetch(base+'/sectors')).json(),v2=await(await fetch(base+'/v2/catalog')).json();assert.equal(v1.mode,'LOCAL_SYNTHETIC');assert.equal(v1.data.length,3);assert.ok(v1.data.every(s=>s.id.startsWith('51000000-')));assert.equal(v2.data.parents.length,11);assert.equal(v2.data.parents.flatMap(p=>p.sectors).length,56);
 const first=await(await fetch(base+'/v2/articles?version='+v2.data.catalog_version+'&limit=1')).json();assert.equal(first.data.items.length,1);assert.ok(first.data.next_cursor);
 const nextUrl=base+'/v2/articles?version='+v2.data.catalog_version+'&limit=1&cursor='+first.data.next_cursor;
 const next=await(await fetch(nextUrl)).json();assert.equal(next.data.as_of,first.data.as_of);assert.notEqual(next.data.items[0].issue_id,first.data.items[0].issue_id);
 assert.equal((await fetch(nextUrl+'&period=YESTERDAY')).status,409);assert.equal((await fetch(base+'/v2/catalog?version=999999')).status,409);
});
await test('Every reference sector is readable within the256KB cap with null stock fields and no private metadata',async()=>{
 const tree=(await(await fetch(base+'/v2/catalog')).json()).data;
 // Direct owned SQL RPCs avoid a test-only rate-limit exemption on the gateway.
 for(const sector of tree.parents.flatMap(p=>p.sectors)){
  const r=await f.rpc('catalog_public_sector_page',{p_sector:sector.id,p_expected:tree.catalog_version,p_offset:0,p_limit:50},{role:'anon'});assert.equal(r.status,200);assert.ok(Buffer.byteLength(JSON.stringify(r.body))<=262144);
  const rows=r.body.groups.flatMap(g=>g.members).concat(r.body.ungrouped_members);assert.ok(rows.every(x=>x.price===null&&x.stock_code===null&&x.stock_url===null));for(const key of ['source_row','foreign_companies','direct_keywords','actor_id'])assert.ok(!JSON.stringify(r.body).includes('"'+key+'"'));
 }
});
}catch(e){failure=e;}finally{if(g)await g.close();if(cookie){for(const id of created){const current=await request('/api/editor/draft?id='+id);if(current.status===200&&current.body.state==='PUBLISHED'){const hidden=await request('/api/editor/state',{p_issue:id,p_expected_revision:current.body.issue_revision,p_state:'HIDDEN',p_effect_key:randomUUID()});if(hidden.status!==200)failure??=new Error('HTTP_FIXTURE_CLEANUP_FAILED');}}await request('/api/editor/logout',{});}writePrivate('catalog-http-tests.json',{status:failure?'FAIL':'PASS',checks,realRequestsExecuted:0,remote:false});}
if(failure)throw failure;
