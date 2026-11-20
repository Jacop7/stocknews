// A fixed dev-only transport. No generic RPC or Auth-admin endpoint is exported.
import {randomBytes,timingSafeEqual} from 'node:crypto';
import {AdminError,hash,seal,unseal} from './runtime-local.mjs';
import {confirmedSqlRejection} from './editor-state.mjs';
import {previewApi,previewProject,editorFunctions,serverFunctions,uuid,loadPreviewAdminConfig,previewConfigKind,actualConfigNow,previewOwnerIdentity} from './preview-admin-config.mjs';
import {previewLimits,nativePreviewDeadlines,checkedPreviewDeadlines,readPreviewJson,stopPreviewBody} from './preview-deadline.mjs';
import {appendActualRuntimeJournal,actualJournalGeneration} from './preview-config-writer.mjs';
const nativeFetch=globalThis.fetch;
const deny=(code,status=403)=>{throw new AdminError(code,status);};
function checked(c,fetcher,now){
  const kind=previewConfigKind(c);
  if(!kind||kind==='FIXTURE'&&fetcher===nativeFetch||kind==='ACTUAL'&&fetcher!==nativeFetch||c.apiUrl!==previewApi||c.projectRef!==previewProject||Date.parse(c.expiresAt)<=(kind==='ACTUAL'?actualConfigNow(c):now()))deny('PREVIEW_ADMIN_NOT_ACTIVATED',503);
  return c;
}
export function createPreviewRuntime({loadConfig=loadPreviewAdminConfig,fetcher=nativeFetch,now:fixtureNow=Date.now,deadlines=nativePreviewDeadlines}={}){
  let attempts=[];
  const timing=checkedPreviewDeadlines(deadlines,fetcher!==nativeFetch);
  let lastLifecycle=null;
  const config=()=>{const c=loadConfig();if(previewConfigKind(c)==='ACTUAL'&&timing.kind!=='NATIVE')deny('PREVIEW_CLOCK_INVALID',503);return checked(c,fetcher,fixtureNow);};
  const now=()=>{const c=loadConfig();return previewConfigKind(c)==='ACTUAL'?actualConfigNow(c):fixtureNow();};
  const normalize=e=>e instanceof AdminError?e:new AdminError('PREVIEW_BACKEND_UNAVAILABLE',503);
  const record=(failure,state)=>{lastLifecycle=state;if(failure instanceof AdminError)Object.defineProperty(failure,'lifecycle',{value:Object.freeze({...state}),enumerable:false,configurable:true});};
  async function request(kind,name,{body,token,deadline=Infinity,onLate=()=>{},onStart=()=>{}}={}){
    let route,server=false;
    if(kind==='server'&&serverFunctions.includes(name)){route='/rest/v1/rpc/'+name;server=true;}
    else if(kind==='editor'&&editorFunctions.includes(name)&&typeof token==='string')route='/rest/v1/rpc/'+name;
    else if(kind==='identity'&&name==='m1_public_identity')route='/rest/v1/rpc/m1_public_identity';
    else if(kind==='password'&&name==='password')route='/auth/v1/token?grant_type=password';
    else if(kind==='user'&&name==='user'&&typeof token==='string')route='/auth/v1/user';
    else if(kind==='logout'&&name==='logout'&&typeof token==='string')route='/auth/v1/logout?scope=local';
    else deny('PREVIEW_RPC_NOT_ALLOWED');
    const c=config(),headers={apikey:server?c.secretKey:c.publishableKey,'Content-Type':'application/json'};
    if(kind==='editor'||kind==='user'||kind==='logout')headers.Authorization='Bearer '+token;
    const expires=Math.min(timing.end(previewLimits.requestMs),deadline);
    return timing.run(async signal=>{
      onStart();
      let r;try{r=await fetcher(previewApi+route,{method:kind==='user'?'GET':'POST',headers,body:body===undefined?undefined:JSON.stringify(body),redirect:'error',cache:'no-store',signal});}catch{deny('PREVIEW_BACKEND_UNAVAILABLE',503);}
      if(signal.aborted){stopPreviewBody(r);deny('PREVIEW_BACKEND_UNAVAILABLE',503);}
      if(kind==='logout'&&r.status===204){if(r.body!==null)deny('PREVIEW_LOGOUT_RESPONSE_INVALID',502);return null;}
      const value=await readPreviewJson(r,signal);
      if(!r.ok){const code=String(value?.message??value?.msg??'REQUEST_REJECTED');throw new AdminError(/^[A-Z0-9_]{1,80}$/.test(code)?code:'REQUEST_REJECTED',r.status===401||r.status===403?403:409,confirmedSqlRejection(value));}
      return value;
    },expires,onLate);
  }
  const serverRpc=(name,data)=>request('server',name,{body:data});
  const editorRpc=(name,data,s)=>request('editor',name,{body:data,token:s?.accessToken});
  async function assertFingerprint(options={}){
    const id=await request('identity','m1_public_identity',{body:{},...options});
    if(id.productId!=='judoju-news'||id.environment!=='preview'||id.sampleKind!=='SYNTHETIC'||id.bootstrapId!==null||id.contract!=='M1')deny('PRODUCT_FINGERPRINT_MISMATCH',503);
  }
  function claims(token,user,c){
    let v;try{if(typeof token!=='string'||token.length>16384||token.split('.').length!==3)throw Error();v=JSON.parse(Buffer.from(token.split('.')[1],'base64url').toString('utf8'));}catch{deny('AUTH_SESSION_INVALID');}
    if(!user||typeof user!=='object'||user.id!==c.ownerUserId||!uuid.test(user.id??'')||v.sub!==user.id||!uuid.test(v.session_id??'')||v.iss!==previewApi+'/auth/v1'||v.role!=='authenticated'||!(v.aud==='authenticated'||Array.isArray(v.aud)&&v.aud.includes('authenticated'))||!Number.isSafeInteger(v.exp)||v.exp*1000<=now()+10000||user.app_metadata?.app_role!=='admin'||user.app_metadata?.product_id!=='judoju-news'||user.deleted_at||user.banned_until&&Date.parse(user.banned_until)>now())deny('ADMIN_REQUIRED');
    return v;
  }
  async function login(email,password){
    attempts=attempts.filter(t=>t>now()-60000);if(attempts.length>=5)deny('LOGIN_RATE_LIMITED',429);attempts.push(now());
    if(typeof email!=='string'||email.length<3||email.length>254||typeof password!=='string'||password.length<1||password.length>200)deny('LOGIN_INVALID',400);
    const totalDeadline=timing.end(previewLimits.totalLoginMs),mainDeadline=timing.end(previewLimits.loginMs);
    const state={operation:'LOGIN',grantAttempted:false,accessReceived:false,openAttempted:false,close:'NOT_ATTEMPTED',authLogout:'NOT_ATTEMPTED',lateCompletionObserved:false,residualPossible:false};
    let accessToken=null,capabilityHash=null,journalGeneration=null,authSessionId=null;
    const onLate=()=>{state.lateCompletionObserved=true;if(state.grantAttempted)state.residualPossible=true;};
    return timing.run(async()=>{
      try{
        const c=config();
        if(previewConfigKind(c)==='ACTUAL'&&hash(email.trim().toLowerCase())!==previewOwnerIdentity().emailSha256)deny('LOGIN_INVALID',400);
        await assertFingerprint({deadline:mainDeadline,onLate});
        if(previewConfigKind(c)==='ACTUAL')journalGeneration=await timing.run(signal=>appendActualRuntimeJournal({phase:'BEFORE_AUTH'},signal),mainDeadline,onLate);
        const t=await request('password','password',{body:{email,password},deadline:mainDeadline,onLate,onStart:()=>{state.grantAttempted=true;}});
        if(typeof t?.access_token==='string'&&t.access_token.length>0&&t.access_token.length<=16384){accessToken=t.access_token;state.accessReceived=true;}
        if(accessToken===null||typeof t?.refresh_token!=='string'||!t.refresh_token.length||t.refresh_token.length>16384)deny('AUTH_RESPONSE_INVALID',502);
        // getUser is authoritative; decode only binds that confirmed identity/session/expiry.
        const u=await request('user','user',{token:accessToken,deadline:mainDeadline,onLate}),claim=claims(accessToken,u,c);
        const capability=randomBytes(32).toString('base64url'),csrf=randomBytes(24).toString('base64url');
        const expires=Math.min(now()+8*3600000,claim.exp*1000-5000,Date.parse(c.expiresAt));
        if(expires<=now()+5000)deny('ADMIN_SESSION_EXPIRING',401);
        const payload={accessToken,refreshToken:t.refresh_token,csrf,userId:u.id,sessionId:claim.session_id};
        capabilityHash=hash(capability);
        authSessionId=claim.session_id;
        if(journalGeneration!==null)await timing.run(signal=>appendActualRuntimeJournal({phase:'BEFORE_OPEN',generation:journalGeneration,authSessionId,capabilityHash},signal),mainDeadline,onLate);
        await request('server','m1_open_admin_session',{body:{p_user:u.id,p_auth_session:claim.session_id,p_hash:capabilityHash,p_ciphertext:seal(payload,c.encryptionKey),p_expires:new Date(expires).toISOString()},deadline:mainDeadline,onLate,onStart:()=>{state.openAttempted=true;}});
        await request('editor','m1_check_editor',{body:{},token:accessToken,deadline:mainDeadline,onLate});
        if(journalGeneration!==null)await timing.run(signal=>appendActualRuntimeJournal({phase:'COMPLETE',generation:journalGeneration,authSessionId,capabilityHash},signal),mainDeadline,onLate);
        record(null,state);return {capability,csrf,expires};
      }catch(raw){
        const failure=normalize(raw);state.residualPossible=state.grantAttempted;
        if(state.openAttempted){
          state.close='UNCONFIRMED';
          try{await request('server','m1_close_admin_session',{body:{p_hash:capabilityHash},deadline:Math.min(timing.end(previewLimits.cleanupMs),totalDeadline),onLate});state.close='ACKNOWLEDGED';}catch{}
        }
        if(accessToken!==null){
          state.authLogout='UNCONFIRMED';
          try{await request('logout','logout',{token:accessToken,deadline:Math.min(timing.end(previewLimits.cleanupMs),totalDeadline),onLate});state.authLogout='ACKNOWLEDGED';}catch{}
        }
        // Acknowledged cleanup is not proof a delayed open/grant cannot leave a remote session.
        if(journalGeneration!==null)try{await timing.run(signal=>appendActualRuntimeJournal({phase:'RESIDUAL',generation:journalGeneration,authSessionId,capabilityHash},signal),Math.min(timing.end(previewLimits.cleanupMs),totalDeadline),onLate);}catch{state.residualPossible=true;}
        record(failure,state);throw failure;
      }finally{accessToken=null;capabilityHash=null;}
    },totalDeadline,onLate);
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
    if(typeof s?.accessToken!=='string'||!s.accessToken.length)deny('ADMIN_SESSION_INVALID');
    const state={operation:'LOGOUT',close:'UNCONFIRMED',authLogout:'UNCONFIRMED',lateCompletionObserved:false,residualPossible:true};let failure=null;
    const onLate=()=>{state.lateCompletionObserved=true;};
    try{await request('server','m1_close_admin_session',{body:{p_hash:hash(capability)},deadline:timing.end(previewLimits.cleanupMs),onLate});state.close='ACKNOWLEDGED';}catch(e){failure=normalize(e);}
    try{await request('logout','logout',{token:s.accessToken,deadline:timing.end(previewLimits.cleanupMs),onLate});state.authLogout='ACKNOWLEDGED';}catch(e){failure??=normalize(e);}
    if(!failure&&previewConfigKind(config())==='ACTUAL')try{
      const capabilityHash=hash(capability);await timing.run(async signal=>appendActualRuntimeJournal({phase:'CLOSED',generation:await actualJournalGeneration(capabilityHash,s.sessionId,signal),authSessionId:s.sessionId,capabilityHash},signal),timing.end(previewLimits.cleanupMs),onLate);
    }catch(e){failure=normalize(e);}
    record(failure,state);if(failure)throw failure;
  }
  function assertWrite(headers,csrf,provided){
    if(headers.get('host')!=='127.0.0.2:62333'||headers.get('origin')!=='http://127.0.0.2:62333'||headers.get('content-type')?.split(';')[0]!=='application/json')deny('ORIGIN_OR_CONTENT_TYPE_REJECTED');
    if(csrf!==undefined&&(typeof csrf!=='string'||typeof provided!=='string'||Buffer.byteLength(csrf)!==Buffer.byteLength(provided)||!timingSafeEqual(Buffer.from(csrf),Buffer.from(provided))))deny('CSRF_REJECTED');
  }
  return Object.freeze({config,serverRpc,editorRpc,assertFingerprint,login,session,logout,assertWrite,diagnostics:()=>lastLifecycle===null?null:Object.freeze({...lastLifecycle})});
}
export const previewRuntime=createPreviewRuntime();
