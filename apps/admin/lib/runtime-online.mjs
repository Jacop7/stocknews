// CLOUD11-online runtime (public HTTPS admin on the AWS worker). Server-only; import performs no I/O.
// - Config: one Linux file (owner-only mode, no symlink/hardlink, exact fields). No secret key here.
// - Session functions go through the broker (HMAC-signed requests over a Unix socket); the broker holds the secret.
// - Editor RPCs carry the raw capability in x-judoju-capability; the DB checks it against the open admin session.
// - Login: password (aal1) -> TOTP challenge/verify (aal2) -> broker opens the admin session. The aal1 token stays in
//   a server-memory pending record (5 minutes, 5 code attempts) and never reaches the browser.
import {readFileSync,lstatSync,writeFileSync,renameSync} from 'node:fs';
import {createHash,createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import {request as httpRequest} from 'node:http';
import {AdminError,hash,seal,unseal} from './runtime-local.mjs';
import {confirmedSqlRejection} from './editor-state.mjs';
import {onlineHost,onlineOrigin} from './admin-profile.mjs';
import {previewApi,previewProject,editorFunctions} from './preview-admin-config.mjs';

const deny=(code,status=403)=>{throw new AdminError(code,status);};
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,hex64=/^[0-9a-f]{64}$/,capabilityPattern=/^[A-Za-z0-9_-]{43}$/;
export const onlineConfigPath=()=>process.env.JUDOJU_ADMIN_ONLINE_CONFIG??'/opt/judoju/.local-data/admin-online/config.json';
export const onlineStatePath=()=>process.env.JUDOJU_ADMIN_ONLINE_STATE??'/data/admin-online/limits.json';
const configFields=['apiUrl','brokerSocket','encryptionKey','ipcKey','origin','ownerEmailSha256','ownerUserId','projectRef','publishableKey'];

export function validateOnlineConfig(c){
  if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).sort().join(',')!==configFields.join(','))deny('ONLINE_CONFIG_REJECTED',503);
  if(c.apiUrl!==previewApi||c.projectRef!==previewProject||c.origin!==onlineOrigin||!/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(c.publishableKey)
    ||!hex64.test(c.encryptionKey)||!hex64.test(c.ipcKey)||!uuid.test(c.ownerUserId)||!hex64.test(c.ownerEmailSha256)||!/^\/[A-Za-z0-9/_.-]{1,200}\.sock$/.test(c.brokerSocket))deny('ONLINE_CONFIG_REJECTED',503);
  return Object.freeze({...c});
}
// Owner-only regular file with a single link; anything else is refused before reading.
export function readPrivateJson(file){
  let st;try{st=lstatSync(file);}catch{deny('ONLINE_CONFIG_MISSING',503);}
  if(!st.isFile()||st.isSymbolicLink()||st.nlink!==1||(st.mode&0o077)!==0||(typeof process.getuid==='function'&&st.uid!==process.getuid()))deny('ONLINE_CONFIG_REJECTED',503);
  try{return JSON.parse(readFileSync(file,'utf8'));}catch{deny('ONLINE_CONFIG_REJECTED',503);}
}

// HMAC over "ts.nonce.op.sha256(body)"; the broker rejects stale timestamps and reused nonces.
export function brokerSignature(ipcKey,ts,nonce,op,body){return createHmac('sha256',Buffer.from(ipcKey,'hex')).update(`${ts}.${nonce}.${op}.${createHash('sha256').update(body).digest('hex')}`).digest('hex');}
function brokerCall(c,op,payload,{transport}={}){
  const body=JSON.stringify(payload),ts=String(Date.now()),nonce=randomBytes(16).toString('hex');
  const headers={'content-type':'application/json','content-length':Buffer.byteLength(body),'x-ts':ts,'x-nonce':nonce,'x-sig':brokerSignature(c.ipcKey,ts,nonce,op,body)};
  if(transport)return transport(op,body,headers);
  return new Promise((resolve,reject)=>{
    const req=httpRequest({socketPath:c.brokerSocket,path:'/'+op,method:'POST',headers,timeout:10000},res=>{
      const chunks=[];let size=0;res.on('data',b=>{size+=b.length;if(size>262144){req.destroy();reject(new AdminError('BROKER_RESPONSE_TOO_LARGE',502));}else chunks.push(b);});
      res.on('end',()=>{let v;try{v=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{return reject(new AdminError('BROKER_RESPONSE_INVALID',502));}
        if(res.statusCode!==200)return reject(new AdminError(typeof v?.error==='string'&&/^[A-Z0-9_]{1,80}$/.test(v.error)?v.error:'BROKER_REJECTED',res.statusCode===401||res.statusCode===403?403:502));resolve(v.data);});
    });
    req.on('timeout',()=>req.destroy(new Error('timeout')));req.on('error',()=>reject(new AdminError('BROKER_UNAVAILABLE',503)));req.end(body);
  });
}
const claimsOf=token=>{try{if(typeof token!=='string'||token.length>16384||token.split('.').length!==3)throw 0;return JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{deny('AUTH_SESSION_INVALID');}};

export function createOnlineRuntime({loadConfig=()=>validateOnlineConfig(readPrivateJson(onlineConfigPath())),fetcher=globalThis.fetch,brokerTransport,now=Date.now,statePath=onlineStatePath}={}){
  const pending=new Map();
  const config=()=>loadConfig();
  async function api(route,{method='POST',token,body,capability,apikey}={}){
    const c=config(),headers={apikey:apikey??c.publishableKey,'Content-Type':'application/json'};
    if(token)headers.Authorization='Bearer '+token;
    if(capability!==undefined)headers['x-judoju-capability']=capability;
    let r;try{r=await fetcher(c.apiUrl+route,{method,headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(8000)});}catch{deny('BACKEND_UNAVAILABLE',503);}
    if(r.status===204)return null;
    const text=await r.text();if(text.length>262144)deny('BACKEND_RESPONSE_TOO_LARGE',502);
    let v=null;try{v=text?JSON.parse(text):null;}catch{deny('BACKEND_RESPONSE_INVALID',502);}
    if(!r.ok){const code=String(v?.message??v?.msg??v?.error_code??'REQUEST_REJECTED');throw new AdminError(/^[A-Z0-9_]{1,80}$/.test(code)?code:'REQUEST_REJECTED',r.status===401||r.status===403?403:409,confirmedSqlRejection(v));}
    return v;
  }
  const broker=(op,payload)=>brokerCall(config(),op,payload,{transport:brokerTransport});
  async function assertFingerprint(){
    const id=await api('/rest/v1/rpc/m1_public_identity',{body:{}});
    if(id?.productId!=='judoju-news'||id.environment!=='preview'||id.sampleKind!=='SYNTHETIC'||id.bootstrapId!==null||id.contract!=='M1')deny('PRODUCT_FINGERPRINT_MISMATCH',503);
  }
  // Persistent limits: 5 attempts per client per minute, 20 per hour in total. Survive restarts via the state file.
  function limit(client){
    const at=now(),file=statePath();let s={clients:{},all:[]};
    try{s=JSON.parse(readFileSync(file,'utf8'));}catch{}
    s.all=(Array.isArray(s.all)?s.all:[]).filter(t=>t>at-3600000);const mine=(s.clients?.[client]??[]).filter(t=>t>at-60000);
    if(mine.length>=5||s.all.length>=20)deny('LOGIN_RATE_LIMITED',429);
    const clients={};for(const [k,v] of Object.entries(s.clients??{})){const kept=(v??[]).filter(t=>t>at-60000);if(kept.length)clients[k]=kept;}
    clients[client]=[...mine,at];s={clients,all:[...s.all,at]};
    try{writeFileSync(file+'.tmp',JSON.stringify(s),{mode:0o600});renameSync(file+'.tmp',file);}catch{deny('LOGIN_STATE_UNAVAILABLE',503);}
  }
  // Expired pending logins also end their aal1 Auth session (best effort; aal1 can never edit or open a session).
  function sweep(){for(const [k,v] of pending)if(v.expires<=now()){pending.delete(k);try{const token=unseal(v.sealed,config().encryptionKey).accessToken;void api('/auth/v1/logout?scope=local',{token}).catch(()=>{});}catch{}}}
  async function login(email,password,client){
    if(typeof client!=='string'||!/^[0-9a-f:.]{2,45}$/i.test(client))deny('CLIENT_ADDRESS_REQUIRED',400);
    limit(client);
    if(typeof email!=='string'||email.length<3||email.length>254||typeof password!=='string'||password.length<1||password.length>200)deny('LOGIN_INVALID',400);
    const c=config();
    // Only the owner's address is ever sent to Auth.
    if(!timingSafeEqual(Buffer.from(hash(email.trim().toLowerCase()),'hex'),Buffer.from(c.ownerEmailSha256,'hex')))deny('LOGIN_INVALID',400);
    await assertFingerprint();
    const t=await api('/auth/v1/token?grant_type=password',{body:{email:email.trim(),password}});
    if(typeof t?.access_token!=='string'||typeof t.refresh_token!=='string')deny('AUTH_RESPONSE_INVALID',502);
    const u=await api('/auth/v1/user',{method:'GET',token:t.access_token}),claim=claimsOf(t.access_token);
    if(u?.id!==c.ownerUserId||claim.sub!==u.id||!uuid.test(claim.session_id??''))deny('LOGIN_INVALID',400);
    sweep();if(pending.size>=4)deny('LOGIN_RATE_LIMITED',429);
    const id=randomBytes(32).toString('base64url'),verified=(u.factors??[]).find(f=>f.factor_type==='totp'&&f.status==='verified');
    pending.set(id,{sealed:seal({accessToken:t.access_token},c.encryptionKey),factorId:verified?.id??null,attempts:0,expires:now()+300000});
    return {pendingId:id,step:verified?'challenge':'enroll'};
  }
  function takePending(id){
    sweep();if(typeof id!=='string'||!capabilityPattern.test(id))deny('MFA_PENDING_REQUIRED',401);
    const p=pending.get(id);if(!p)deny('MFA_PENDING_REQUIRED',401);return {p,token:unseal(p.sealed,config().encryptionKey).accessToken};
  }
  async function drop(id,token){pending.delete(id);try{await api('/auth/v1/logout?scope=local',{token});}catch{}}
  async function mfaEnroll(id){
    const {p,token}=takePending(id);if(p.factorId&&p.enrolled!==true)deny('MFA_ALREADY_ENROLLED',409);
    const u=await api('/auth/v1/user',{method:'GET',token});
    if((u?.factors??[]).some(f=>f.factor_type==='totp'&&f.status==='verified'))deny('MFA_ALREADY_ENROLLED',409);
    // Earlier unfinished enrolments are removed so only one TOTP factor can exist.
    for(const f of u?.factors??[])if(f.status!=='verified')await api('/auth/v1/factors/'+encodeURIComponent(f.id),{method:'DELETE',token});
    const f=await api('/auth/v1/factors',{body:{factor_type:'totp',friendly_name:'judoju-admin'},token});
    if(!uuid.test(f?.id??'')||typeof f?.totp?.qr_code!=='string'||typeof f.totp.secret!=='string')deny('MFA_ENROLL_FAILED',502);
    p.factorId=f.id;p.enrolled=true;return {qrCode:f.totp.qr_code,secret:f.totp.secret};
  }
  async function mfaVerify(id,code){
    const {p,token}=takePending(id);const c=config();
    if(typeof code!=='string'||!/^\d{6}$/.test(code)||!p.factorId){p.attempts++;if(p.attempts>=5)await drop(id,token);deny('MFA_CODE_INVALID',400);}
    let t;try{
      const ch=await api('/auth/v1/factors/'+encodeURIComponent(p.factorId)+'/challenge',{body:{},token});
      t=await api('/auth/v1/factors/'+encodeURIComponent(p.factorId)+'/verify',{body:{challenge_id:ch?.id,code},token});
    }catch(e){p.attempts++;if(p.attempts>=5)await drop(id,token);throw e instanceof AdminError?new AdminError('MFA_CODE_INVALID',400):e;}
    const claim=claimsOf(t?.access_token);
    if(claim.aal!=='aal2'||claim.sub!==c.ownerUserId||!uuid.test(claim.session_id??''))deny('MFA_NOT_AAL2');
    pending.delete(id);
    const capability=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');
    const expires=Math.min(now()+8*3600000,claim.exp*1000-5000);if(expires<=now()+5000)deny('ADMIN_SESSION_EXPIRING',401);
    const payload={accessToken:t.access_token,csrf,userId:claim.sub,sessionId:claim.session_id};
    try{
      await broker('open',{accessToken:t.access_token,hash:hash(capability),ciphertext:seal(payload,c.encryptionKey),expires:new Date(expires).toISOString()});
      await api('/rest/v1/rpc/m1_check_editor',{body:{},token:t.access_token,capability});
    }catch(e){try{await broker('close',{hash:hash(capability)});}catch{}try{await api('/auth/v1/logout?scope=local',{token:t.access_token});}catch{}throw e;}
    // Every other Auth session of the owner ends here, including aal1 leftovers from abandoned or pre-restart logins.
    try{await api('/auth/v1/logout?scope=others',{token:t.access_token});}catch{}
    return {capability,csrf,expires};
  }
  async function session(capability){
    if(typeof capability!=='string'||!capabilityPattern.test(capability))deny('LOGIN_REQUIRED',401);
    const c=config(),row=await broker('read',{hash:hash(capability)});
    if(!row||!Number.isFinite(Date.parse(row.expires_at))||Date.parse(row.expires_at)<=now())deny('LOGIN_REQUIRED',401);
    const s=unseal(row.ciphertext,c.encryptionKey),claim=claimsOf(s.accessToken);
    // No refresh: the admin session ends with the aal2 access token; the owner signs in again (password + TOTP).
    if(claim.aal!=='aal2'||claim.exp*1000<=now()+5000||claim.sub!==row.user_id||s.userId!==row.user_id||s.sessionId!==row.auth_session_id||claim.session_id!==s.sessionId
      ||typeof s.csrf!=='string'||!/^[A-Za-z0-9_-]{32}$/.test(s.csrf))deny('LOGIN_REQUIRED',401);
    return Object.freeze({...s,capability});
  }
  async function editorRpc(name,data,s){
    if(!editorFunctions.includes(name))deny('RPC_NOT_ALLOWED');
    return api('/rest/v1/rpc/'+name,{body:data,token:s?.accessToken,capability:s?.capability});
  }
  async function logout(capability,s){
    let failure=null;
    try{await broker('close',{hash:hash(capability)});}catch(e){failure=e;}
    try{await api('/auth/v1/logout?scope=local',{token:s?.accessToken});}catch(e){failure??=e;}
    if(failure)throw failure instanceof AdminError?failure:new AdminError('LOGOUT_INCOMPLETE',502);
  }
  function assertWrite(headers,csrf,provided){
    if(headers.get('host')!==onlineHost||headers.get('origin')!==onlineOrigin||headers.get('content-type')?.split(';')[0]!=='application/json')deny('ORIGIN_OR_CONTENT_TYPE_REJECTED');
    if(csrf!==undefined&&(typeof csrf!=='string'||typeof provided!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(provided))))deny('CSRF_REJECTED');
  }
  const serverRpc=()=>deny('SERVER_RPC_NOT_AVAILABLE');
  return Object.freeze({config,serverRpc,editorRpc,assertFingerprint,login,mfaEnroll,mfaVerify,session,logout,assertWrite});
}
export const onlineRuntime=createOnlineRuntime();
