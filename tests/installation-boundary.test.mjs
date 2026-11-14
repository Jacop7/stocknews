import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes} from 'node:crypto';
import {createInstallationHandler,createInstallationRateLimiter,encryptInstallation,decryptInstallation,installationRpcNames} from '../apps/admin/lib/installation-runtime.mjs';
const c={encryptionKey:randomBytes(32).toString('hex')},generation=randomUUID();
const req=(action,{method='POST',data={generation},origin='http://127.0.0.1:8084',host='127.0.0.1:3100',headers={}}={})=>new Request('http://'+host+'/api/installations/'+action+(method==='GET'?'?generation='+generation:''),{method,headers:{host,...(origin?{origin}:{}),'Content-Type':'application/json','X-Judoju-Installation':'local-v1',...headers},...(method==='POST'?{body:JSON.stringify(data)}:{})});
test('Only new installation RPCs are exposed; M0 fixture writes are absent',()=>{
 assert.deepEqual(installationRpcNames,['m0_runtime_identity','installation_operation','installation_settings_read','installation_settings_save','installation_view']);
});
test('Encryption authenticates ciphertext; malformed or altered values never decode',()=>{
 const value=encryptInstallation({secret:'synthetic'},c.encryptionKey);assert.equal(decryptInstallation(value,c.encryptionKey).secret,'synthetic');
 assert.throws(()=>decryptInstallation(value.slice(1),c.encryptionKey),/CONNECTION_INFO_INVALID/);
});
test('Host, Origin, native+cookie and missing custom header reject before RPC',async()=>{
 let calls=0;const h=createInstallationHandler({getConfig:()=>c,rpc:async()=>{calls++;return{};}});
 for(const r of [req('start',{origin:'https://other.test'}),req('start',{host:'localhost:3100'}),req('start',{origin:null,host:'10.0.2.2:3100',headers:{'x-judoju-native':'1',cookie:'x=1'}}),req('start',{headers:{'X-Judoju-Installation':''}})])assert.equal((await h(r)).status,403);
 assert.equal(calls,0);
});
test('CORS is exact and preflight limited to consumer methods/headers',async()=>{
 const h=createInstallationHandler({getConfig:()=>c});
 const a=await h(req('state',{method:'OPTIONS',headers:{'access-control-request-method':'POST','access-control-request-headers':'Content-Type,X-CSRF-Token'}}));assert.equal(a.status,204);assert.equal(a.headers.get('Access-Control-Allow-Origin'),'http://127.0.0.1:8084');
 const b=await h(req('state',{method:'OPTIONS',headers:{'access-control-request-headers':'Authorization'}}));assert.equal(b.status,403);
 const bad=await h(req('state',{origin:'https://other.test'}));assert.equal(bad.headers.get('Access-Control-Allow-Origin'),null);
});
test('Web bootstrap issues only an HttpOnly pending cookie and no body secret',async()=>{
 const calls=[];const h=createInstallationHandler({getConfig:()=>c,rpc:async(_c,name,data)=>{calls.push({name,data});return{state:'STARTED',generation};}});
 const r=await h(req('start',{data:{generation,kind:'BOOTSTRAP'},headers:{cookie:'judoju_admin_session=untrusted-do-not-use'}}));assert.equal(r.status,200);
 const raw=await r.text();assert.ok(!/secret|nonce|hash|untrusted/.test(raw));const cookie=r.headers.get('Set-Cookie');assert.ok(cookie.includes('HttpOnly; SameSite=Strict'));assert.ok(cookie.includes('Path=/api/installations'));assert.ok(cookie.startsWith('judoju_install_pending_'+generation+'='));assert.equal(calls.length,1);assert.equal(calls[0].data.p_action,'START');
});
test('Bare operation pointer and a different generation cookie never authorize commit',async()=>{
 let calls=0;const h=createInstallationHandler({getConfig:()=>c,rpc:async()=>{calls++;return{};}});
 const cookie='judoju_install_pending_'+randomUUID()+'='+encryptInstallation({generation,nonce:randomBytes(32).toString('hex')},c.encryptionKey);
 const r=await h(req('commit',{headers:{cookie}}));assert.equal(r.status,403);assert.equal(calls,0);
});
test('State GET never sets a cookie, even with an untrusted admin cookie',async()=>{
 const h=createInstallationHandler({getConfig:()=>c,rpc:async()=>{throw new Error('unexpected');}});
 const r=await h(req('state',{method:'GET',headers:{cookie:'judoju_admin_session=not-a-consumer'}}));assert.equal(r.status,200);assert.equal((await r.json()).state,'NONE');assert.equal(r.headers.get('Set-Cookie'),null);
});
test('Bootstrap rate and active limits release exactly once, including errors',()=>{
 let now=0;const rate=createInstallationRateLimiter(()=>now);for(let n=0;n<3;n++){const done=rate('p',true,true);done();done();}
 assert.throws(()=>rate('p',true,true),/RATE_LIMITED/);now=60001;rate('p',true,true)();
 const done=[rate('a',false,false),rate('a',false,false),rate('a',false,false)];assert.throws(()=>rate('a',false,false),/RATE_LIMITED/);done.forEach(x=>x());rate('a',false,false)();
});
test('Unexpected fields, large bodies and duplicate generation query are rejected',async()=>{
 const h=createInstallationHandler({getConfig:()=>c});
 assert.equal((await h(req('start',{data:{generation,kind:'BOOTSTRAP',rpc:'m0_create_installation'}}))).status,400);
 assert.equal((await h(req('start',{data:{generation,kind:'x'.repeat(17000)}}))).status,413);
 const r=req('state',{method:'GET'});const dup=new Request(r.url+'&generation='+generation,r);assert.equal((await h(dup)).status,400);
});
test('Bounded exact-generation cleanup can remove stale names without selecting a prefix credential',async()=>{
 const h=createInstallationHandler({getConfig:()=>c});
 const old=Array.from({length:14},()=>`judoju_install_session_${randomUUID()}=opaque`).join('; ');
 const ordinary=await h(req('state',{method:'GET',headers:{cookie:old}}));assert.equal(ordinary.status,431);
 const cleanup=await h(req('cleanup',{headers:{cookie:old}}));assert.equal(cleanup.status,200);
 const names=cleanup.headers.getSetCookie();assert.equal(names.length,2);assert.ok(names.every(x=>x.includes(generation)&&x.includes('Max-Age=0')));
});
