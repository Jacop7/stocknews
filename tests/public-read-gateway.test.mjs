import test from 'node:test';
import assert from 'node:assert/strict';
import { request } from 'node:http';
import { readRoute,createPublicGateway } from '../scripts/public-read-gateway.mjs';
const cfg={productId:'judoju-news',environment:'local',sampleKind:'SYNTHETIC',bootstrapId:'test-owned',apiUrl:'http://127.0.0.1:62321',webOrigins:['http://127.0.0.1:8084']};
const identity={productId:'judoju-news',environment:'local',sampleKind:'SYNTHETIC',bootstrapId:cfg.bootstrapId,contract:'M1'};
test('Public routes cannot become arbitrary URL/RPC/write/private-stat requests',()=>{
 assert.deepEqual(readRoute('/articles?limit=50').args,{p_sector:null,p_limit:50,p_cursor:null});
 for(const path of ['https://evil.invalid','//evil.invalid','/rest/v1/rpc/m0_bootstrap','/articles?url=https://evil.invalid','/articles?limit=51','/articles?limit=2&limit=3','/articles/../../rpc/private','/articles?sector=invalid','/articles?cursor=tomorrow','/'+ 'a'.repeat(2048)])assert.throws(()=>readRoute(path));
});
test('Owned identity is required before binding a read listener',async()=>{
 await assert.rejects(createPublicGateway(cfg,{port:0,transport:async()=>({...identity,bootstrapId:'foreign'})}),/PRODUCT_FINGERPRINT_MISMATCH/);
});
test('Actual HTTP guards reject Host/Origin/credentials/method and enforce burst limits',async()=>{
 let calls=0;const g=await createPublicGateway(cfg,{port:0,transport:async(c,name)=>{if(name==='m1_public_identity')return identity;calls++;return [];}}),url='http://127.0.0.1:'+g.port;
 try{
  const badHost=await new Promise((resolve,reject)=>{const r=request(url+'/articles',{headers:{Host:'evil.invalid'}},s=>{s.resume();resolve(s.statusCode);});r.on('error',reject);r.end();});assert.equal(badHost,403);
  for(const [headers,method,status]of [[{Origin:'null'},'GET',403],[{Cookie:'private=anything'},'GET',403],[{Authorization:'Bearer forbidden'},'GET',403],[{},'POST',405]])assert.equal((await fetch(url+'/articles',{headers,method})).status,status);
  assert.equal(calls,0);const preflight=await fetch(url+'/sectors',{method:'OPTIONS',headers:{Origin:cfg.webOrigins[0],'Access-Control-Request-Headers':'cache-control'}});assert.equal(preflight.status,204);assert.equal(preflight.headers.get('Access-Control-Allow-Origin'),cfg.webOrigins[0]);assert.match(preflight.headers.get('Access-Control-Allow-Headers'),/Cache-Control/i);assert.equal(preflight.headers.get('Access-Control-Allow-Credentials'),null);assert.equal(calls,0);
  for(let n=0;n<12;n++)assert.equal((await fetch(url+'/articles')).status,200);
  const limit=await fetch(url+'/articles');assert.equal(limit.status,429);assert.equal(limit.headers.get('Retry-After'),'1');assert.equal(calls,12);
 }finally{await g.close();}
});
test('Bounded concurrency refuses a fourth active peer request without forwarding it',async()=>{
 let release;const gate=new Promise(r=>{release=r;});let entered=0;
 const g=await createPublicGateway(cfg,{port:0,transport:async(c,name)=>{if(name==='m1_public_identity')return identity;entered++;await gate;return [];}}),url='http://127.0.0.1:'+g.port;
 try{
  const active=Array.from({length:3},()=>fetch(url+'/articles'));const started=Date.now();while(entered<3&&Date.now()-started<3000)await new Promise(r=>setTimeout(r,5));assert.equal(entered,3);
  assert.equal((await fetch(url+'/articles')).status,429);assert.equal(entered,3);release();for(const r of await Promise.all(active))assert.equal(r.status,200);
 }finally{release();await g.close();}
});
test('Oversize and real-mode responses fail closed before any public body',async()=>{
 for(const payload of [Array.from({length:50},()=>({sample_kind:'SYNTHETIC',title:'x'.repeat(6000)})),[{sample_kind:'PERMITTED_REAL'}]]){
  const g=await createPublicGateway(cfg,{port:0,transport:async(c,name)=>name==='m1_public_identity'?identity:payload});try{const r=await fetch('http://127.0.0.1:'+g.port+'/articles');assert.equal(r.status,502);assert.ok(!JSON.stringify(await r.json()).includes('xxxx'));}finally{await g.close();}
 }
});
