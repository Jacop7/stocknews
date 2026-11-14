// Server-only module. Configuration is loaded lazily; build/import performs no I/O.
import { readFileSync } from 'node:fs';
import { createHash,randomBytes,createCipheriv,createDecipheriv,timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { confirmedSqlRejection } from './editor-state.mjs';
export class AdminError extends Error{constructor(code,status=400,notApplied=false){super(code);this.status=status;this.notApplied=notApplied===true;}}
export function config(){
  let c;try{
    const cwd=process.cwd(),name=JSON.parse(readFileSync(path.join(cwd,'package.json'),'utf8')).name;
    const root=name==='@judoju/news'?cwd:name==='@judoju/admin'?path.resolve(cwd,'../..'):null;
    if(!root||JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).name!=='@judoju/news')throw new Error('OWNED_ROOT_REQUIRED');
    c=JSON.parse(readFileSync(path.join(root,'.local-data/runtime/admin-server.json'),'utf8'));
  }catch{throw new AdminError('LOCAL_ADMIN_NOT_CONFIGURED',503);}
  if(c.productId!=='judoju-news'||c.environment!=='local'||c.sampleKind!=='SYNTHETIC'||c.apiUrl!=='http://127.0.0.1:62321'||c.origin!=='http://127.0.0.1:3100'||!/^[0-9a-f]{64}$/.test(c.encryptionKey??''))throw new AdminError('LOCAL_ADMIN_CONFIG_REJECTED',503);
  return c;
}
export const hash=value=>createHash('sha256').update(value).digest('hex');
export function seal(value,key){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const encrypted=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return [iv,cipher.getAuthTag(),encrypted].map(x=>x.toString('base64url')).join('.');}
export function unseal(value,key){try{const [iv,tag,data]=value.split('.').map(x=>Buffer.from(x,'base64url'));const cipher=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);cipher.setAuthTag(tag);return JSON.parse(Buffer.concat([cipher.update(data),cipher.final()]).toString('utf8'));}catch{throw new AdminError('ADMIN_SESSION_INVALID',401);}}
async function jsonFetch(route,{token,method='GET',body}={}){
  const c=config();let r;try{r=await fetch(c.apiUrl+route,{method,redirect:'error',cache:'no-store',headers:{apikey:c.anonKey,Authorization:'Bearer '+(token??c.serviceKey),'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(8000)});}catch{throw new AdminError('LOCAL_BACKEND_UNAVAILABLE',503);}
  const chunks=[];let size=0;for await(const b of r.body??[]){size+=b.length;if(size>262144){await r.body?.cancel().catch(()=>{});throw new AdminError('BACKEND_RESPONSE_TOO_LARGE',502);}chunks.push(b);}
  let data;try{data=JSON.parse(Buffer.concat(chunks).toString());}catch{throw new AdminError('BACKEND_RESPONSE_INVALID',502);}
  if(!r.ok){const code=String(data.message??data.msg??'REQUEST_REJECTED');throw new AdminError(/^[A-Z0-9_]+$/.test(code)?code:'REQUEST_REJECTED',r.status===401||r.status===403?403:409,confirmedSqlRejection(data));}
  return data;
}
export const serverRpc=(name,data)=>jsonFetch('/rest/v1/rpc/'+name,{method:'POST',body:data});
export const editorRpc=(name,data,session)=>jsonFetch('/rest/v1/rpc/'+name,{method:'POST',body:data,token:session.accessToken});
export async function assertFingerprint(){const c=config(),id=await serverRpc('m0_runtime_identity',{});if(id.productId!=='judoju-news'||id.environment!=='local'||id.bootstrapId!==c.bootstrapId)throw new AdminError('PRODUCT_FINGERPRINT_MISMATCH',503);}
export async function login(email,password){
  const c=config();await assertFingerprint();
  if(typeof email!=='string'||typeof password!=='string'||email.length>254||password.length>200)throw new AdminError('LOGIN_INVALID',400);
  const t=await jsonFetch('/auth/v1/token?grant_type=password',{method:'POST',token:c.anonKey,body:{email,password}});
  const u=await jsonFetch('/auth/v1/user',{token:t.access_token});if(u.app_metadata?.app_role!=='admin')throw new AdminError('ADMIN_REQUIRED',403);
  const claim=JSON.parse(Buffer.from(t.access_token.split('.')[1],'base64url').toString());
  if(claim.sub!==u.id||!/^[0-9a-f-]{36}$/.test(claim.session_id??''))throw new AdminError('AUTH_SESSION_MISSING',403);
  const capability=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');
  const expires=Date.now()+Math.min(8*3600*1000,Math.max(0,(Number(claim.exp)*1000-Date.now())-5000));
  const payload={accessToken:t.access_token,refreshToken:t.refresh_token,csrf,userId:u.id,sessionId:claim.session_id};
  await serverRpc('m1_open_admin_session',{p_user:u.id,p_auth_session:claim.session_id,p_hash:hash(capability),p_ciphertext:seal(payload,c.encryptionKey),p_expires:new Date(expires).toISOString()});
  await editorRpc('m1_check_editor',{},payload);
  return {capability,csrf,expires};
}
export async function session(capability){
  if(typeof capability!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(capability))throw new AdminError('LOGIN_REQUIRED',401);
  await assertFingerprint();const row=await serverRpc('m1_read_admin_session',{p_hash:hash(capability)});
  if(!row)throw new AdminError('LOGIN_REQUIRED',401);const s=unseal(row.ciphertext,config().encryptionKey);
  const u=await jsonFetch('/auth/v1/user',{token:s.accessToken});
  if(u.id!==row.user_id||s.userId!==u.id||s.sessionId!==row.auth_session_id||u.app_metadata?.app_role!=='admin')throw new AdminError('ADMIN_SESSION_INVALID',403);
  await editorRpc('m1_check_editor',{},s);return s;
}
export async function logout(capability,s){
  // Revoke the application's SQL capability before best-effort refresh-token logout.
  await serverRpc('m1_close_admin_session',{p_hash:hash(capability)});
  try{await jsonFetch('/auth/v1/logout',{method:'POST',token:s.accessToken});}catch{/* private session is already revoked; no token is exposed */}
}
export function assertWrite(headers,csrf,provided){
  if(headers.get('origin')!==config().origin||headers.get('content-type')?.split(';')[0]!=='application/json')throw new AdminError('ORIGIN_OR_CONTENT_TYPE_REJECTED',403);
  if(csrf!==undefined){if(typeof provided!=='string'||Buffer.byteLength(provided)!==Buffer.byteLength(csrf)||!timingSafeEqual(Buffer.from(provided),Buffer.from(csrf)))throw new AdminError('CSRF_REJECTED',403);}
}
