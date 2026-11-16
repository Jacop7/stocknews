// A fixed dev-only transport. No generic RPC or Auth-admin endpoint is exported.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {AdminError,hash,seal,unseal} from './runtime-local.mjs';
import {confirmedSqlRejection} from './editor-state.mjs';
import {previewApi,previewProject,editorFunctions,serverFunctions,uuid,loadPreviewAdminConfig,previewConfigKind} from './preview-admin-config.mjs';
const nativeFetch=globalThis.fetch;
const deny=(code,status=403)=>{throw new AdminError(code,status);};
function checked(c,fetcher,now){
  const kind=previewConfigKind(c);
  if(!kind||kind==='FIXTURE'&&fetcher===nativeFetch||c.apiUrl!==previewApi||c.projectRef!==previewProject||Date.parse(c.expiresAt)<=now())deny('PREVIEW_ADMIN_NOT_ACTIVATED',503);
  return c;
}
export function createPreviewRuntime({loadConfig=loadPreviewAdminConfig,fetcher=nativeFetch,now=Date.now}={}){
  let attempts=[];
  const config=()=>checked(loadConfig(),fetcher,now);
  async function request(kind,name,{body,token}={}){
    let route,server=false;
    if(kind==='server'&&serverFunctions.includes(name)){route='/rest/v1/rpc/'+name;server=true;}
    else if(kind==='editor'&&editorFunctions.includes(name)&&typeof token==='string')route='/rest/v1/rpc/'+name;
    else if(kind==='identity'&&name==='m1_public_identity')route='/rest/v1/rpc/m1_public_identity';
    else if(kind==='password'&&name==='password')route='/auth/v1/token?grant_type=password';
    else if(kind==='user'&&name==='user'&&typeof token==='string')route='/auth/v1/user';
    else if(kind==='logout'&&name==='logout'&&typeof token==='string')route='/auth/v1/logout';
    else deny('PREVIEW_RPC_NOT_ALLOWED');
    const c=config(),headers={apikey:server?c.secretKey:c.publishableKey,'Content-Type':'application/json'};
    if(kind==='editor'||kind==='user'||kind==='logout')headers.Authorization='Bearer '+token;
    let r;try{r=await fetcher(previewApi+route,{method:kind==='user'?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});}catch{deny('PREVIEW_BACKEND_UNAVAILABLE',503);}
    const chunks=[];let size=0;try{for await(const b of r.body??[]){size+=b.length;if(size>262144)deny('BACKEND_RESPONSE_TOO_LARGE',502);chunks.push(b);}}catch(e){try{await r.body?.cancel();}catch{}if(e instanceof AdminError)throw e;deny('PREVIEW_BACKEND_UNAVAILABLE',503);}
    let value;try{value=chunks.length?JSON.parse(Buffer.concat(chunks).toString('utf8')):{};}catch{deny('BACKEND_RESPONSE_INVALID',502);}
    if(!r.ok){const code=String(value.message??value.msg??'REQUEST_REJECTED');throw new AdminError(/^[A-Z0-9_]{1,80}$/.test(code)?code:'REQUEST_REJECTED',r.status===401||r.status===403?403:409,confirmedSqlRejection(value));}
    return value;
  }
  const serverRpc=(name,data)=>request('server',name,{body:data});
  const editorRpc=(name,data,s)=>request('editor',name,{body:data,token:s?.accessToken});
  async function assertFingerprint(){
    const id=await request('identity','m1_public_identity',{body:{}});
    if(id.productId!=='judoju-news'||id.environment!=='preview'||id.sampleKind!=='SYNTHETIC'||id.bootstrapId!==null||id.contract!=='M1')deny('PRODUCT_FINGERPRINT_MISMATCH',503);
  }
  function claims(token,user,c){
    let v;try{if(typeof token!=='string'||token.length>16384||token.split('.').length!==3)throw Error();v=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{deny('AUTH_SESSION_INVALID');}
    if(user.id!==c.ownerUserId||!uuid.test(user.id??'')||v.sub!==user.id||!uuid.test(v.session_id??'')||v.iss!==previewApi+'/auth/v1'||v.role!=='authenticated'||!(v.aud==='authenticated'||Array.isArray(v.aud)&&v.aud.includes('authenticated'))||!Number.isSafeInteger(v.exp)||v.exp*1000<=now()+10000||user.app_metadata?.app_role!=='admin'||user.app_metadata?.product_id!=='judoju-news'||user.deleted_at||user.banned_until&&Date.parse(user.banned_until)>now())deny('ADMIN_REQUIRED');
    return v;
  }
  async function login(email,password){
    attempts=attempts.filter(t=>t>now()-60000);if(attempts.length>=5)deny('LOGIN_RATE_LIMITED',429);attempts.push(now());
    if(typeof email!=='string'||email.length<3||email.length>254||typeof password!=='string'||password.length<1||password.length>200)deny('LOGIN_INVALID',400);
    const c=config();await assertFingerprint();
    const t=await request('password','password',{body:{email,password}});
    if(typeof t.access_token!=='string'||typeof t.refresh_token!=='string')deny('AUTH_RESPONSE_INVALID',502);
    // getUser is authoritative; JWT decoding below only binds its confirmed identity/session/expiry.
    const u=await request('user','user',{token:t.access_token}),claim=claims(t.access_token,u,c);
    const capability=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');
    const expires=Math.min(now()+8*3600000,claim.exp*1000-5000,Date.parse(c.expiresAt));
    if(expires<=now()+5000)deny('ADMIN_SESSION_EXPIRING',401);
    const payload={accessToken:t.access_token,refreshToken:t.refresh_token,csrf,userId:u.id,sessionId:claim.session_id};
    await serverRpc('m1_open_admin_session',{p_user:u.id,p_auth_session:claim.session_id,p_hash:hash(capability),p_ciphertext:seal(payload,c.encryptionKey),p_expires:new Date(expires).toISOString()});
    await editorRpc('m1_check_editor',{},payload);
    return {capability,csrf,expires};
  }
  async function session(capability){
    if(typeof capability!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(capability))deny('LOGIN_REQUIRED',401);
    const c=config();await assertFingerprint();const row=await serverRpc('m1_read_admin_session',{p_hash:hash(capability)});
    if(!row||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=now())deny('LOGIN_REQUIRED',401);
    const s=unseal(row.ciphertext,c.encryptionKey),u=await request('user','user',{token:s.accessToken}),claim=claims(s.accessToken,u,c);
    if(u.id!==row.user_id||s.userId!==u.id||s.sessionId!==row.auth_session_id||s.sessionId!==claim.session_id||typeof s.csrf!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(s.csrf))deny('ADMIN_SESSION_INVALID');
    await editorRpc('m1_check_editor',{},s);return s;
  }
  async function logout(capability,s){
    if(typeof capability!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(capability))deny('LOGIN_REQUIRED',401);
    await serverRpc('m1_close_admin_session',{p_hash:hash(capability)});
    try{await request('logout','logout',{token:s.accessToken});}catch{/* SQL capability is already revoked. */}
  }
  function assertWrite(headers,csrf,provided){
    if(headers.get('host')!=='127.0.0.1:62333'||headers.get('origin')!=='http://127.0.0.1:62333'||headers.get('content-type')?.split(';')[0]!=='application/json')deny('ORIGIN_OR_CONTENT_TYPE_REJECTED');
    if(csrf!==undefined&&(typeof csrf!=='string'||typeof provided!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(provided))))deny('CSRF_REJECTED');
  }
  return Object.freeze({config,serverRpc,editorRpc,assertFingerprint,login,session,logout,assertWrite});
}
export const previewRuntime=createPreviewRuntime();
