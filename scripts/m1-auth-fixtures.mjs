// Explicit owned-local test setup only. Importing does not create users or connect.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync,existsSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { localClient } from './m0-test-client.mjs';
import { runtimeDir,writePrivate } from './local-runtime.mjs';
export async function authFixtures(){
  const c=localClient(),credentials=JSON.parse(readFileSync(path.join(runtimeDir,'credentials.json'),'utf8'));
  const file=path.join(runtimeDir,'m1-auth-fixtures.json');
  const state=existsSync(file)?JSON.parse(readFileSync(file,'utf8')):{productId:'judoju-news',bootstrapId:c.id.bootstrapId,users:{}};
  assert.equal(state.productId,'judoju-news');assert.equal(state.bootstrapId,c.id.bootstrapId);
  async function auth(route,{method='GET',data,token=credentials.serviceKey}={}){
    const response=await fetch(credentials.apiUrl+'/auth/v1/'+route,{method,redirect:'error',headers:{apikey:credentials.anonKey,Authorization:'Bearer '+token,'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:AbortSignal.timeout(10000)});
    const body=await response.json();assert.ok(response.ok,'OWNED_LOCAL_AUTH_FAILED_'+response.status);return body;
  }
  for(const role of ['admin','general']){
    let u=state.users[role];
    if(!u){u=state.users[role]={email:'judoju-m1-'+role+'-'+c.id.bootstrapId+'@example.invalid',password:randomBytes(30).toString('base64url'),state:'CREATE_INTENT'};writePrivate('m1-auth-fixtures.json',state);}
    if(u.state==='CREATE_INTENT'){
      const existing=c.sql('select id::text from auth.users where email='+c.quote(u.email)+';');
      let created;
      if(existing){created=await auth('admin/users/'+existing);assert.equal(created.user_metadata?.product_id,'judoju-news');assert.equal(created.user_metadata?.bootstrap_id,c.id.bootstrapId);}
      else created=await auth('admin/users',{method:'POST',data:{email:u.email,password:u.password,email_confirm:true,app_metadata:{app_role:role==='admin'?'admin':'reader'},user_metadata:{product_id:'judoju-news',bootstrap_id:c.id.bootstrapId,sample_kind:'SYNTHETIC'}}});
      u.id=created.id;u.state='CREATED';writePrivate('m1-auth-fixtures.json',state);
    }
    assert.equal(u.state,'CREATED');const user=await auth('admin/users/'+u.id);assert.equal(user.email,u.email);assert.equal(user.user_metadata?.bootstrap_id,c.id.bootstrapId);
  }
  const login=async(role)=>{
    const u=state.users[role];assert.ok(u);
    const tokens=await auth('token?grant_type=password',{method:'POST',data:{email:u.email,password:u.password},token:credentials.anonKey});
    const verified=await auth('user',{token:tokens.access_token});assert.equal(verified.id,u.id);
    const claims=JSON.parse(Buffer.from(tokens.access_token.split('.')[1],'base64url').toString());
    assert.equal(claims.sub,verified.id);assert.match(claims.session_id??'',/^[0-9a-f-]{36}$/);
    assert.equal(c.sql('select count(*) from auth.sessions where id='+c.quote(claims.session_id)+' and user_id='+c.quote(verified.id)+';'),'1');
    return {tokens,user:verified,sessionId:claims.session_id};
  };
  return {...c,state,auth,login};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  const f=await authFixtures(),admin=await f.login('admin'),general=await f.login('general');
  const ownership=f.sql("select has_table_privilege('postgres','auth.users','SELECT'),has_table_privilege('postgres','auth.sessions','SELECT');");
  assert.equal(ownership,'t|t');
  writePrivate('m1-auth-capability-evidence.json',{productId:'judoju-news',sample_kind:'SYNTHETIC',status:'PASS',actualAuthLogin:true,authGetUserVerified:true,adminMetadata:admin.user.app_metadata.app_role==='admin',generalMetadata:general.user.app_metadata.app_role==='reader',sessionClaimPresent:true,sessionDbBinding:true,functionOwnerPostgresCanSelectBoth:true,authSchemaGrantsChanged:false,createdAt:new Date().toISOString()});
  console.log(JSON.stringify({phase:'S5P04_ACTUAL_AUTH_CAPABILITY',status:'PASS',syntheticUsers:2,actualLogin:true,sessionClaimAndDbBinding:true,functionOwnerSelect:true,authSchemaGrantsChanged:false,secretsPrinted:false}));
}
