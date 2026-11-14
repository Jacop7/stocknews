import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { authFixtures } from './m1-auth-fixtures.mjs';
import { login,session,logout,hash,seal,unseal,config,assertWrite } from '../apps/admin/lib/runtime.mjs';
import { writePrivate } from './local-runtime.mjs';
const f=await authFixtures(),q=f.quote,run=randomUUID(),cases=[];
async function test(name,fn){await fn();cases.push({name,status:'PASS'});console.log(JSON.stringify(cases.at(-1)));}
const admin=f.state.users.admin,general=f.state.users.general;
let failure;
try{
await test('Actual Auth: opaque capability, encrypted tokens, metadata and private store',async()=>{
  const r=await login(admin.email,admin.password),s=await session(r.capability);
  assert.match(r.capability,/^[A-Za-z0-9_-]{43}$/);assert.equal(s.userId,admin.id);
  const cipher=f.sql('select ciphertext from private.admin_sessions where capability_hash='+q(hash(r.capability))+';');assert.ok(!cipher.includes(s.accessToken));
  const c=config();assert.equal(unseal(seal({test:true},c.encryptionKey),c.encryptionKey).test,true);
  assert.throws(()=>unseal(cipher.slice(0,-5)+'AAAAA',c.encryptionKey),/ADMIN_SESSION_INVALID/);
  const leaked=await f.request('admin_sessions?select=*',{role:'anon'});assert.ok(leaked.status>=400);
  await logout(r.capability,s);assert.equal(f.sql('select count(*) from auth.sessions where id='+q(s.sessionId)+';'),'0','Auth logout must delete own session');
  await assert.rejects(session(r.capability),/LOGIN_REQUIRED/);
  for(const [name,args] of [['m1_check_editor',{}],['m0_publish',{p_issue:randomUUID(),p_expected_revision:0,p_title:'x',p_summary:'x',p_body:{},p_profile:'POSITIVE_ONLY',p_policy:1,p_catalog:1,p_effect_key:run}],['m0_set_publication_state',{p_issue:randomUUID(),p_expected_revision:0,p_state:'HIDDEN'}],['m0_reconcile',{p_job:randomUUID(),p_outcome:'UNKNOWN',p_proof:null}],['m0_requeue_dlq',{p_job:randomUUID(),p_reason:'SYNTHETIC'}],['m0_admin_view_count',{p_issue:randomUUID()}]]){
    const denied=await f.rpc(name,args,{token:s.accessToken});assert.ok(denied.status>=400);assert.match(denied.body?.message??'',/EDITOR_ONLY/);
  }
});
await test('Current membership and current Auth role revoke old JWT direct SQL rights',async()=>{
  const r=await login(admin.email,admin.password),s=await session(r.capability);
  f.sql('update private.admin_memberships set active=false where user_id='+q(admin.id)+';');
  assert.equal((await f.rpc('m1_check_editor',{}, {token:s.accessToken})).status,403);await assert.rejects(session(r.capability),/LOGIN_REQUIRED/);
  f.sql('update private.admin_memberships set active=true where user_id='+q(admin.id)+";update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{app_role}','\"reader\"') where id="+q(admin.id)+';');
  assert.equal((await f.rpc('m1_check_editor',{}, {token:s.accessToken})).status,403);
  f.sql("update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{app_role}','\"admin\"') where id="+q(admin.id)+';');
  assert.equal((await f.rpc('m1_check_editor',{}, {token:s.accessToken})).status,200);
  f.sql('update auth.sessions set not_after=now()-interval \'1 second\' where id='+q(s.sessionId)+';');
  assert.equal((await f.rpc('m1_check_editor',{}, {token:s.accessToken})).status,403);await assert.rejects(session(r.capability),/LOGIN_REQUIRED/);
  await logout(r.capability,s);
});
await test('General/forged claims/expired application capability cannot edit',async()=>{
  await assert.rejects(login(general.email,general.password),/ADMIN_REQUIRED/);
  const g=await f.login('general');assert.equal((await f.rpc('m1_check_editor',{}, {token:g.tokens.access_token})).status,403);
  for(const claims of [{sub:randomUUID(),app_metadata:{app_role:'admin'}},{sub:admin.id,user_metadata:{app_role:'admin'}},{sub:admin.id,app_metadata:{app_role:'admin'},session_id:randomUUID()}])assert.equal((await f.rpc('m1_check_editor',{}, {token:f.jwt({role:'authenticated',...claims})})).status,403);
  const r=await login(admin.email,admin.password),s=await session(r.capability);f.sql('update private.admin_sessions set expires_at=now()-interval \'1 second\' where capability_hash='+q(hash(r.capability))+';');
  await assert.rejects(session(r.capability),/LOGIN_REQUIRED/);assert.equal((await f.rpc('m1_check_editor',{}, {token:s.accessToken})).status,403);await logout(r.capability,s);
});
await test('Exact Origin, content type, CSRF, and Unicode input rejection',async()=>{
  const headers=new Headers({'origin':'http://127.0.0.1:3100','content-type':'application/json'});assert.doesNotThrow(()=>assertWrite(headers,'abc','abc'));
  for(const h of [new Headers({'origin':'http://evil.invalid','content-type':'application/json'}),new Headers({'origin':'http://127.0.0.1:3100','content-type':'text/plain'})])assert.throws(()=>assertWrite(h,'abc','abc'),/ORIGIN_OR_CONTENT_TYPE_REJECTED/);
  for(const csrf of [null,'bad','한글자'])assert.throws(()=>assertWrite(headers,'abc',csrf),/CSRF_REJECTED/);
});
}catch(e){failure=e;}finally{
  f.sql('update private.admin_memberships set active=true where user_id='+q(admin.id)+";update auth.users set raw_app_meta_data=jsonb_set(raw_app_meta_data,'{app_role}','\"admin\"') where id="+q(admin.id)+';');
  writePrivate('m1-auth-test-'+run+'.json',{productId:'judoju-news',sample_kind:'SYNTHETIC',status:failure?'FAIL':'PASS',cases,createdAt:new Date().toISOString(),realSourceRequests:0});
}
if(failure)throw failure;
