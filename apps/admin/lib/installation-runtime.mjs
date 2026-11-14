// Local consumer boundary. It never authenticates with or decrypts an admin cookie.
import {readFileSync} from 'node:fs';
import path from 'node:path';
import {createHash,createHmac,randomBytes,randomUUID,createCipheriv,createDecipheriv,timingSafeEqual} from 'node:crypto';
export class InstallationError extends Error {constructor(code,status=400){super(code);this.status=status;}}
export const installationRpcNames=Object.freeze(['m0_runtime_identity','installation_operation','installation_settings_read','installation_settings_save','installation_view']);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const hex=/^[0-9a-f]{64}$/;
export const digest=x=>createHash('sha256').update(x).digest('hex');
export function installationConfig(){
 try{
  const cwd=process.cwd(),name=JSON.parse(readFileSync(path.join(cwd,'package.json'),'utf8')).name;
  const root=name==='@judoju/news'?cwd:name==='@judoju/admin'?path.resolve(cwd,'../..'):null;
  if(!root||JSON.parse(readFileSync(path.join(root,'package.json'),'utf8')).name!=='@judoju/news')throw 0;
  const c=JSON.parse(readFileSync(path.join(root,'.local-data/runtime/installation-server.json'),'utf8'));
  const admin=JSON.parse(readFileSync(path.join(root,'.local-data/runtime/admin-server.json'),'utf8'));
  if(c.productId!=='judoju-news'||c.environment!=='local'||c.sampleKind!=='SYNTHETIC'||c.apiUrl!=='http://127.0.0.1:62321'
   ||!uuid.test(c.bootstrapId)||!hex.test(c.encryptionKey)||c.encryptionKey===admin.encryptionKey
   ||c.bootstrapId!==admin.bootstrapId||c.serviceKey!==admin.serviceKey||c.anonKey!==admin.anonKey)throw 0;
  return c;
 }catch{throw new InstallationError('INSTALLATION_SERVER_UNAVAILABLE',503);}
}
export function encryptInstallation(value,key){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);const data=Buffer.concat([c.update(JSON.stringify(value)),c.final()]);return [iv,c.getAuthTag(),data].map(b=>b.toString('base64url')).join('.');}
export function decryptInstallation(value,key){
 try{if(typeof value!=='string'||value.length>4096)throw 0;const a=value.split('.');if(a.length!==3)throw 0;const [iv,tag,data]=a.map(x=>Buffer.from(x,'base64url'));const c=createDecipheriv('aes-256-gcm',Buffer.from(key,'hex'),iv);c.setAuthTag(tag);return JSON.parse(Buffer.concat([c.update(data),c.final()]).toString());}
 catch{throw new InstallationError('CONNECTION_INFO_INVALID',401);}
}
async function rpcWithConfig(c,name,data){
 if(!installationRpcNames.includes(name))throw new InstallationError('INSTALLATION_RPC_REJECTED',403);
 let r;try{const remaining=(c.deadline??Date.now()+7000)-Date.now();if(remaining<=0)throw 0;r=await fetch(c.apiUrl+'/rest/v1/rpc/'+name,{method:'POST',redirect:'error',cache:'no-store',signal:AbortSignal.timeout(remaining),
  headers:{apikey:c.anonKey,Authorization:'Bearer '+c.serviceKey,'Content-Type':'application/json'},body:JSON.stringify(data)});
  let size=0;const chunks=[];for await(const chunk of r.body??[]){size+=chunk.length;if(size>262144)throw 0;chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString());
  if(!r.ok){const safe=new Set(['INSTALLATION_UNAUTHORIZED','SETTINGS_CONFLICT','INVALID_SETTINGS','INACTIVE_SECTOR','OPERATION_PENDING','GENERATION_ALREADY_EXISTS','PENDING_COOKIE_REQUIRED','GENERATION_SEALED','OPERATION_EXPIRED','OPERATION_PAYLOAD_CONFLICT','OPERATION_OWNER_CONFLICT','OPERATION_NOT_COMMITTED','FORGET_NOT_READY']);
   throw new InstallationError(safe.has(value.message)?value.message:'INSTALLATION_REQUEST_REJECTED',value.message==='INSTALLATION_UNAUTHORIZED'?401:409);}
  return value;
 }catch(e){if(e instanceof InstallationError)throw e;throw new InstallationError('INSTALLATION_BACKEND_UNKNOWN',503);}
}
export async function installationRpc(c,name,data){
 const identity=await rpcWithConfig(c,'m0_runtime_identity',{});
 if(identity.productId!=='judoju-news'||identity.environment!=='local'||identity.bootstrapId!==c.bootstrapId)throw new InstallationError('PRODUCT_FINGERPRINT_MISMATCH',503);
 return rpcWithConfig(c,name,data);
}
const caps=x=>x&&uuid.test(x.id)&&uuid.test(x.generation)&&hex.test(x.secret)&&Number.isSafeInteger(x.version)&&x.version>0;
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const cookieName=(type,generation)=>`judoju_install_${type}_${generation}`;
const setCookie=(type,generation,value,age)=>`${cookieName(type,generation)}=${value}; Path=/api/installations; HttpOnly; SameSite=Strict; Max-Age=${age}`;
const csrf=(key,proof,generation)=>createHmac('sha256',Buffer.from(key,'hex')).update(generation+':'+proof).digest('base64url');
const payloadHash=(kind,prior)=>digest(JSON.stringify({kind,prior_generation:prior?.generation??null,installation_id:prior?.id??null,version:prior?.version??null}));
function parseCookies(raw){
 if(Buffer.byteLength(raw??'')>12288)throw new InstallationError('COOKIE_CLEANUP_REQUIRED',431);
 const map=new Map();let count=0;for(const item of (raw??'').split(';')){const n=item.indexOf('=');if(n<1)continue;const k=item.slice(0,n).trim();if(!k.startsWith('judoju_install_'))continue;if(map.has(k))throw new InstallationError('DUPLICATE_INSTALLATION_COOKIE',400);map.set(k,item.slice(n+1).trim());count++;}
 if(count>12)throw new InstallationError('COOKIE_CLEANUP_REQUIRED',431);return map;
}
export function createInstallationRateLimiter(now=Date.now){
 const peers=new Map();let global=[];let active=0;
 return (peer,start,mutation)=>{
  const t=now();for(const [k,v] of peers)if(v.last<t-120000&&v.active===0)peers.delete(k);
  if(!peers.has(peer)&&peers.size>=512)throw new InstallationError('RATE_LIMITED',429);
  const p=peers.get(peer)??{times:[],starts:[],mutations:[],last:t,active:0};peers.set(peer,p);
  for(const k of ['times','starts','mutations'])p[k]=p[k].filter(x=>x>t-60000);global=global.filter(x=>x>t-60000);
  if(active>=8||p.active>=3||global.length>=240||p.times.length>=60||p.times.filter(x=>x>t-1000).length>=12||start&&p.starts.length>=3||mutation&&p.mutations.length>=20)throw new InstallationError('RATE_LIMITED',429);
  p.times.push(t);if(start)p.starts.push(t);if(mutation)p.mutations.push(t);global.push(t);p.last=t;p.active++;active++;
  let done=false;return()=>{if(!done){done=true;p.active--;active--;}};
 };
}
const limit=createInstallationRateLimiter();
async function readBody(request){
 if(request.headers.get('content-type')?.split(';')[0]!=='application/json')throw new InstallationError('CONTENT_TYPE_REJECTED',415);
 if(Number(request.headers.get('content-length')??0)>16384)throw new InstallationError('BODY_TOO_LARGE',413);
 const reader=request.body?.getReader();let size=0;const chunks=[];let timer;
 try{const read=async()=>{if(reader)for(;;){const b=await reader.read();if(b.done)break;size+=b.value.length;if(size>16384)throw new InstallationError('BODY_TOO_LARGE',413);chunks.push(b.value);}return JSON.parse(Buffer.concat(chunks).toString());};
  const x=await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>reject(new InstallationError('BODY_TIMEOUT',408)),7000);})]);
  if(!x||Array.isArray(x)||typeof x!=='object')throw new InstallationError('INVALID_JSON');return x;
 }catch(e){void reader?.cancel().catch(()=>{});if(e instanceof InstallationError)throw e;throw new InstallationError('INVALID_JSON');}finally{clearTimeout(timer);}
}
export function createInstallationHandler({getConfig=installationConfig,rpc=installationRpc,rate=limit}={}){
 return async function handle(request){
  let release,cors=false;const deadline=Date.now()+7000,headers={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Vary':'Origin'};
  const response=(value,status=200,cookies=[])=>{let payload=JSON.stringify(value);if(Buffer.byteLength(payload??'')>262144){status=502;cookies=[];payload=JSON.stringify({error:'INSTALLATION_RESPONSE_TOO_LARGE',outcome:'NOT_CONFIRMED'});}const h=new Headers(headers);if(cors){h.set('Access-Control-Allow-Origin','http://127.0.0.1:8084');h.set('Access-Control-Allow-Credentials','true');}if(status===429)h.set('Retry-After','60');for(const c of cookies)h.append('Set-Cookie',c);return new Response(status===204?null:payload,{status,headers:h});};
  try{
   const u=new URL(request.url),origin=request.headers.get('origin'),native=request.headers.get('x-judoju-native')==='1',host=request.headers.get('host');
   if(u.username||u.password||u.search.length>1024||request.url.length>2048||!['127.0.0.1:3100','10.0.2.2:3100'].includes(host))throw new InstallationError('HOST_REJECTED',403);
   if(native){if(origin||host!=='10.0.2.2:3100'&&host!=='127.0.0.1:3100'||request.headers.has('cookie'))throw new InstallationError('NATIVE_TRANSPORT_REJECTED',403);}
   else {if(origin!=='http://127.0.0.1:8084'||host!=='127.0.0.1:3100')throw new InstallationError('ORIGIN_REJECTED',403);cors=true;}
   if(request.method==='OPTIONS'){
    if(native||request.headers.get('access-control-request-method')&&!['GET','POST'].includes(request.headers.get('access-control-request-method')))throw new InstallationError('METHOD_REJECTED',405);
    const requested=(request.headers.get('access-control-request-headers')??'').toLowerCase().split(',').map(x=>x.trim()).filter(Boolean);
    if(requested.some(x=>!['content-type','x-judoju-installation','x-csrf-token'].includes(x)))throw new InstallationError('HEADER_REJECTED',403);
    headers['Access-Control-Allow-Methods']='GET, POST';headers['Access-Control-Allow-Headers']='Content-Type, X-Judoju-Installation, X-CSRF-Token';return response(null,204);
   }
   if(request.headers.get('x-judoju-installation')!=='local-v1')throw new InstallationError('INSTALLATION_HEADER_REQUIRED',403);
   if(!['GET','POST'].includes(request.method)||!u.pathname.startsWith('/api/installations/'))throw new InstallationError('METHOD_REJECTED',405);
   const action=u.pathname.slice('/api/installations/'.length);
   if(!['state','start','commit','ack','start-seal','generation-state','generation-forget','settings','cleanup','view-ticket','view-accept'].includes(action))throw new InstallationError('ROUTE_NOT_FOUND',404);
   if((request.method==='GET')!==['state','generation-state'].includes(action))throw new InstallationError('METHOD_REJECTED',405);
   // No proxy headers are trusted on the loopback-only local server.
   release=rate(native?'owned-native-emulator':'owned-browser',action==='start',request.method==='POST');
   const c={...getConfig(),deadline},body=request.method==='POST'?await readBody(request):Object.fromEntries(u.searchParams);
   const allowed={state:['generation','confirmed_generation'],start:['generation','confirmed_generation','kind','nonce','capability'],commit:['generation','confirmed_generation','pending','capability'],ack:['generation','confirmed_generation','pending','capability'],'start-seal':['generation'],'generation-state':['generation'],'generation-forget':['generation','confirmed'],settings:['generation','confirmed_generation','capability','settings'],cleanup:['generation'],'view-ticket':['generation','confirmed_generation','capability','view'],'view-accept':['generation','confirmed_generation','capability','view']};
   if(Object.keys(body).some(k=>!allowed[action].includes(k))||!uuid.test(body.generation)||!native&&(body.nonce!==undefined||body.capability!==undefined||body.pending!==undefined))throw new InstallationError('INVALID_PARAMETER');
   if(request.method==='GET'&&new Set([...u.searchParams.keys()]).size!==[...u.searchParams.keys()].length)throw new InstallationError('INVALID_PARAMETER');
   if(body.confirmed_generation!==undefined&&!uuid.test(body.confirmed_generation))throw new InstallationError('INVALID_PARAMETER');
   // Exact-name cleanup does not select or authenticate any cookie. It must also
   // work when stale generations exceed the ordinary credential parsing bound.
   const generation=body.generation,cookies=native||action==='cleanup'?new Map():parseCookies(request.headers.get('cookie'));
   const cookieObject=(type,g)=>{const x=cookies.get(cookieName(type,g));return x?decryptInstallation(x,c.encryptionKey):null;};
   const nativeObject=(name)=>{const x=request.headers.get(name);if(!x)return null;try{if(x.length>8192)throw 0;return JSON.parse(Buffer.from(x,'base64url').toString());}catch{throw new InstallationError('INVALID_NATIVE_CAPABILITY');}};
   const cap=native?(body.capability??nativeObject('x-installation-capability')):cookieObject('session',body.confirmed_generation??generation);
   if(cap&&(!caps(cap)||cap.generation!==(body.confirmed_generation??generation)))throw new InstallationError('CONNECTION_INFO_INVALID',401);
   const pending=native?(body.pending??nativeObject('x-installation-pending')):cookieObject('pending',generation);
   if(pending&&(pending.generation!==generation||!hex.test(pending.nonce)||!hex.test(pending.payload_hash)||!['BOOTSTRAP','ROTATE','REVOKE'].includes(pending.kind)))throw new InstallationError('CONNECTION_INFO_INVALID',401);
   const auth=(x)=>x?{installation_id:x.id,secret:x.secret,version:x.version}:{};
   const csrfProof=pending?.nonce??cap?.secret;
   if(request.method==='POST'&&!native&&!['start','start-seal','generation-forget','cleanup'].includes(action)
    &&(!csrfProof||!same(request.headers.get('x-csrf-token'),csrf(c.encryptionKey,csrfProof,generation))))throw new InstallationError('CSRF_REJECTED',403);
   const call=(op,data={})=>rpc(c,'installation_operation',{p_action:op,p_generation:generation,p_request:data});
   if(action==='generation-state')return response(await call('GENERATION_STATE'));
   if(action==='start-seal')return response(await call('START_SEAL'));
   if(action==='generation-forget')return response(await call('GENERATION_FORGET',{confirmed:body.confirmed===true}));
   if(action==='cleanup')return response({state:'LOCAL_COOKIE_CLEARED',generation},200,native?[]:[setCookie('pending',generation,'',0),setCookie('session',generation,'',0)]);
   if(action==='start'){
    if(!['BOOTSTRAP','ROTATE','REVOKE'].includes(body.kind)||body.kind==='BOOTSTRAP'&&cap||body.kind!=='BOOTSTRAP'&&!cap)throw new InstallationError('INVALID_OPERATION');
    if(body.kind!=='BOOTSTRAP'&&body.confirmed_generation===generation)throw new InstallationError('NEW_GENERATION_REQUIRED');
    const nonce=native?body.nonce:randomBytes(32).toString('hex');if(!hex.test(nonce??''))throw new InstallationError('INVALID_NONCE');
    const ph=payloadHash(body.kind,cap);const result=await call('START',{kind:body.kind,transport:native?'NATIVE':'WEB',pending:nonce,payload_hash:ph,prior_generation:cap?.generation??null,...auth(cap)});
    const value={generation,kind:body.kind,nonce,payload_hash:ph,prior:cap};
    return response({...result,...(native?{pending:value}:{})},200,native?[]:[setCookie('pending',generation,encryptInstallation(value,c.encryptionKey),600)]);
   }
   if(action==='view-ticket'||action==='view-accept'){
    if(!cap)throw new InstallationError('INSTALLATION_UNAUTHORIZED',401);
    const v=body.view,keys=action==='view-ticket'?['issue_id','version_id','visit_id']:['ticket_id','event_key'];
    if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).sort().join(',')!==keys.sort().join(',')||Object.values(v).some(x=>!uuid.test(x)))throw new InstallationError('INVALID_VIEW_REQUEST');
    return response(await rpc(c,'installation_view',{p_action:action==='view-ticket'?'TICKET':'ACCEPT',p_install:cap.id,p_secret:cap.secret,p_version:cap.version,p_request:v}));
   }
   if(action==='settings'){
    if(!cap)throw new InstallationError('INSTALLATION_UNAUTHORIZED',401);const s=body.settings;
    if(!s||Object.keys(s).sort().join(',')!=='catalog_version,closing_issue,favorite_sector_issue,morning_issue,sector_ids,settings_revision'
     ||![s.morning_issue,s.closing_issue,s.favorite_sector_issue].every(x=>typeof x==='boolean')||!Array.isArray(s.sector_ids)||s.sector_ids.length>56||!s.sector_ids.every(x=>uuid.test(x))
     ||!Number.isSafeInteger(s.catalog_version)||!Number.isSafeInteger(s.settings_revision))throw new InstallationError('INVALID_SETTINGS');
    return response(await rpc(c,'installation_settings_save',{p_install:cap.id,p_secret:cap.secret,p_version:cap.version,p_catalog:s.catalog_version,p_revision:s.settings_revision,p_morning:s.morning_issue,p_closing:s.closing_issue,p_favorite:s.favorite_sector_issue,p_sectors:s.sector_ids}));
   }
   if(action==='state'){
    const state={state:'NONE',generation,mode:'LOCAL_QA',other_cookie_present:!native&&!cap&&!pending&&cookies.size>0};
    if(pending){const r=await call('STATE',{transport:native?'NATIVE':'WEB',pending:pending.nonce,payload_hash:pending.payload_hash});Object.assign(state,r);}
    if(cap){const data=await rpc(c,'installation_settings_read',{p_install:cap.id,p_secret:cap.secret,p_version:cap.version});Object.assign(state,{state:pending?state.state:'ACTIVE',...data,version:cap.version,expires_at:cap.expires_at});}
    if(csrfProof)Object.assign(state,{csrf:csrf(c.encryptionKey,csrfProof,generation)});
    return response(state);
   }
   if(!pending)throw new InstallationError('PENDING_COOKIE_REQUIRED',401);
   const prior=pending.prior;
   const opArgs={transport:native?'NATIVE':'WEB',pending:pending.nonce,payload_hash:pending.payload_hash,...auth(prior)};
   if(action==='ack'){
    const result=await call('ACK',{...opArgs,...auth(cap)});
    const clear=native?[]:[setCookie('pending',generation,'',0)];
    if(!native&&pending.kind==='REVOKE'&&prior)clear.push(setCookie('session',prior.generation,'',0));
    if(!native&&pending.kind==='ROTATE'&&prior)clear.push(setCookie('session',prior.generation,'',0));
    return response(result,200,clear);
   }
   const next={id:prior?.id??randomUUID(),secret:randomBytes(32).toString('hex'),version:(prior?.version??0)+1,generation,expires_at:new Date(Date.now()+86400000).toISOString()};
   const result=await call('COMMIT',{...opArgs,new_id:next.id,new_secret:next.secret,receipt_ciphertext:encryptInstallation(next,c.encryptionKey)});
   let issued;if(result.kind!=='REVOKE'){issued=decryptInstallation(result.receipt_ciphertext,c.encryptionKey);if(!caps(issued)||issued.generation!==generation)throw new InstallationError('RECEIPT_INVALID',503);}
   return response({state:result.state,generation,kind:result.kind,...(native&&issued?{capability:issued}:{})},200,!native&&issued?[setCookie('session',generation,encryptInstallation(issued,c.encryptionKey),86400)]:[]);
  }catch(e){return response({error:e instanceof InstallationError?e.message:'INSTALLATION_REQUEST_FAILED',outcome:'NOT_CONFIRMED'},e instanceof InstallationError?e.status:500);}
  finally{release?.();}
 };
}
