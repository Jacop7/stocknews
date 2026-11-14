import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createInstallationHandler,installationConfig,installationRpc} from '../apps/admin/lib/installation-runtime.mjs';
import {writePrivate} from './local-runtime.mjs';
import {localClient} from './m0-test-client.mjs';
import {authFixtures} from './m1-auth-fixtures.mjs';
import {login} from '../apps/admin/lib/runtime.mjs';
const f=localClient(),checks=[];
const test=async(name,fn)=>{await fn();checks.push({name,status:'PASS'});console.log(JSON.stringify(checks.at(-1)));};
// Real owned DB + production request handler, no listener or proxy. Rate policy
// has its own real-clock tests; fixture sequences use an isolated admission slot.
const handle=createInstallationHandler({rate:()=>()=>{}});
function web(){const jar=new Map();return{jar,async call(action,body,csrf){
 const get=['state','generation-state'].includes(action),url='http://127.0.0.1:3100/api/installations/'+action+(get?'?'+new URLSearchParams(Object.entries(body).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])):'');
 const response=await handle(new Request(url,{method:get?'GET':'POST',headers:{Host:'127.0.0.1:3100',Origin:'http://127.0.0.1:8084','X-Judoju-Installation':'local-v1',...(!get?{'Content-Type':'application/json'}:{}),...(csrf?{'X-CSRF-Token':csrf}:{}),Cookie:[...jar].map(([k,v])=>k+'='+v).join('; ')},...(!get?{body:JSON.stringify(body)}:{})}));
 const raw=await response.text(),data=JSON.parse(raw);
 assert.ok(!/"(secret|nonce|installation_id|receipt_ciphertext|payload_hash)"/.test(raw),'Web DTO contains a private field');
 for(const item of response.headers.getSetCookie()){const [first]=item.split(';'),n=first.indexOf('='),name=first.slice(0,n),value=first.slice(n+1);assert.ok(item.includes('HttpOnly')&&item.includes('Path=/api/installations')&&item.includes('SameSite=Strict'));if(item.includes('Max-Age=0'))jar.delete(name);else jar.set(name,value);}
 return{response,data};
}};}
async function sequence(client,kind,prior){
 const generation=randomUUID(),q={generation,...(prior?{confirmed_generation:prior}:{})};
 let x=await client.call('start',{...q,kind});assert.equal(x.response.status,200);assert.equal(x.data.state,'STARTED');
 x=await client.call('state',q);assert.equal(x.data.state,'STARTED');assert.ok(x.data.csrf);
 const committed=await client.call('commit',q,x.data.csrf);assert.equal(committed.response.status,200);
 const pointer=kind==='REVOKE'?{generation}:{generation,confirmed_generation:generation};
 x=await client.call('state',pointer);assert.equal(x.data.state,'COMMITTED');
 const ack=await client.call('ack',pointer,x.data.csrf);assert.equal(ack.response.status,200);
 return{generation,state:kind==='REVOKE'?ack.data:(await client.call('state',pointer)).data};
}
const a=web(),b=web();let A,B;
await test('Two web installations bootstrap with HttpOnly generation-specific cookies and no response secrets',async()=>{
 A=await sequence(a,'BOOTSTRAP');B=await sequence(b,'BOOTSTRAP');assert.equal(A.state.state,'ACTIVE');assert.equal(A.state.settings.settings_revision,1);assert.deepEqual(A.state.settings.sector_ids,[]);assert.notEqual(A.generation,B.generation);
});
await test('Owner settings CAS saves only active leaf sectors and does not change B',async()=>{
 const tree=(await f.rpc('catalog_public_tree',{}, {role:'anon'})).body,leaf=tree.parents[0].sectors[0].id;
 const saved=await a.call('settings',{generation:A.generation,settings:{...A.state.settings,catalog_version:Number(A.state.settings.catalog_version),morning_issue:true,sector_ids:[leaf]}},A.state.csrf);assert.equal(saved.response.status,200);assert.equal(saved.data.settings_revision,2);
 const stale=await a.call('settings',{generation:A.generation,settings:{...A.state.settings,catalog_version:Number(A.state.settings.catalog_version)}},A.state.csrf);assert.equal(stale.response.status,409);
 const foreign=await b.call('state',{generation:A.generation});assert.equal(foreign.data.state,'NONE');assert.equal(foreign.data.settings,undefined);
 const own=await b.call('state',{generation:B.generation});assert.equal(own.data.settings.morning_issue,false);
});
await test('Wrong CSRF and missing nonce reject without changing preferences',async()=>{
 const bad=await a.call('settings',{generation:A.generation,settings:{...A.state.settings,catalog_version:Number(A.state.settings.catalog_version)}},'wrong');assert.equal(bad.response.status,403);
 const noPending=await a.call('commit',{generation:randomUUID()},'wrong');assert.equal(noPending.response.status,403);
});
await test('Rotation keeps preferences, rejects old cookie on general reads, and clears only exact old names',async()=>{
 const oldCookies=new Map(a.jar),rotated=await sequence(a,'ROTATE',A.generation);assert.equal(rotated.state.settings.morning_issue,true);
 const old=web();for(const [k,v]of oldCookies)old.jar.set(k,v);const r=await old.call('state',{generation:A.generation});assert.equal(r.response.status,401);
 assert.ok(a.jar.has('judoju_install_session_'+rotated.generation));assert.ok(!a.jar.has('judoju_install_session_'+A.generation));A=rotated;
});
await test('Atomic start seal blocks late start and commit; another generation still works',async()=>{
 const g=randomUUID();const sealed=await a.call('start-seal',{generation:g});assert.equal(sealed.data.state,'SEALED_START');const late=await a.call('start',{generation:g,kind:'BOOTSTRAP'});assert.equal(late.response.status,409);
 const c=web(),n=await sequence(c,'BOOTSTRAP');assert.equal(n.state.state,'ACTIVE');await sequence(c,'REVOKE',n.generation);
});
await test('Disconnect confirms revoke, clears session cookie, preserves B and records no privacy-purge claim',async()=>{
 const revoked=await sequence(a,'REVOKE',A.generation);assert.equal(revoked.state.kind,'REVOKE');assert.equal(a.jar.size,0);
 const own=await b.call('state',{generation:B.generation});assert.equal(own.data.state,'ACTIVE');await sequence(b,'REVOKE',B.generation);
});
await test('Native transport returns a capability only to explicit native mode; wrong cookie/Origin mixture rejects',async()=>{
 const generation=randomUUID(),nonce=randomBytes(32).toString('hex');
 const native=async(action,body)=>{const r=await handle(new Request('http://10.0.2.2:3100/api/installations/'+action,{method:'POST',headers:{Host:'10.0.2.2:3100','X-Judoju-Native':'1','X-Judoju-Installation':'local-v1','Content-Type':'application/json'},body:JSON.stringify(body)}));assert.ok(r.headers.get('Set-Cookie')===null,'Native response must have no cookie');return{status:r.status,body:await r.json()};};
 let r=await native('start',{generation,kind:'BOOTSTRAP',nonce});assert.equal(r.status,200);const pending=r.body.pending;
 r=await native('commit',{generation,pending});assert.equal(r.status,200);const cap=r.body.capability;assert.match(cap.secret,/^[0-9a-f]{64}$/);
 r=await native('ack',{generation,pending,capability:cap});assert.equal(r.status,200);
 const rg=randomUUID();r=await native('start',{generation:rg,confirmed_generation:generation,kind:'REVOKE',nonce:randomBytes(32).toString('hex'),capability:cap});assert.equal(r.status,200);const rp=r.body.pending;
 r=await native('commit',{generation:rg,confirmed_generation:generation,pending:rp,capability:cap});assert.equal(r.status,200);r=await native('ack',{generation:rg,pending:rp});assert.equal(r.status,200);
});
await test('Actual Next admin routes do not expose CORS to consumer Origin; public gateway still rejects credentials',async()=>{
 for(const route of ['/api/editor/session','/api/catalog/tree','/api/analytics/stats']){
  const r=await fetch('http://127.0.0.1:3100'+route,{method:'OPTIONS',headers:{Origin:'http://127.0.0.1:8084','Access-Control-Request-Method':'POST'}});assert.equal(r.headers.get('Access-Control-Allow-Origin'),null);assert.equal(r.headers.get('Access-Control-Allow-Credentials'),null);
 }
 const r=await fetch('http://127.0.0.1:62330/articles',{headers:{Authorization:'Bearer SYNTHETIC_INVALID'}});assert.equal(r.status,403);
});
await test('Admin statistics require real admin session + CSRF, and return LOCAL_QA without installation identities',async()=>{
 const fixtures=await authFixtures(),u=fixtures.state.users.admin,s=await login(u.email,u.password),p={p_start:new Date(Date.now()-86400000).toISOString(),p_end:new Date().toISOString(),p_issue:null,p_sector:null};
 const r=await fetch('http://127.0.0.1:3100/api/analytics/stats',{method:'POST',headers:{Origin:'http://127.0.0.1:3100','Content-Type':'application/json','X-CSRF-Token':s.csrf,Cookie:'judoju_admin_session='+s.capability},body:JSON.stringify(p)});assert.equal(r.status,200);const raw=await r.text(),x=JSON.parse(raw);assert.equal(x.mode,'LOCAL_QA');assert.equal(x.operational_pv,0);assert.equal(x.operational_uv,0);assert.ok(!/installation_id|secret|capability/.test(raw));
 const denied=await fetch('http://127.0.0.1:3100/api/analytics/stats',{method:'POST',headers:{Origin:'http://127.0.0.1:8084','Content-Type':'application/json',Cookie:'judoju_admin_session='+s.capability},body:JSON.stringify(p)});assert.equal(denied.status,403);assert.equal(denied.headers.get('Access-Control-Allow-Origin'),null);
});
const result={status:'PASS',checks,mode:'OWNED_LOCAL_SYNTHETIC',newNetworkListeners:0,fixtureInstallationsRevoked:true,secretsPrinted:false,operationalAnalyticsEnabled:false};writePrivate('installation-runtime-tests.json',result);console.log(JSON.stringify(result));
