import type {InstallationAdapter,InstallationSettings,InstallationState} from './installation-types';
const origin='http://127.0.0.1:3100/api/installations/',namespace='judoju-news:local:installation:v1';
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
type Fence={generation:string;confirmed_generation?:string;kind:'BOOTSTRAP'|'ROTATE'|'REVOKE';phase:string};
const phases=['START_DISPATCHED','START_CONFIRMED','COMMIT_DISPATCHED','COMMIT_CONFIRMED','ACK_DISPATCHED','ACTIVE','REVOKED','UNKNOWN_START','UNKNOWN_COMMIT','UNKNOWN_ACK','SEALED_START','SEALED_FORGOTTEN'];
class ConnectionError extends Error {constructor(public code:string){super(code);}}
function readFence():Fence|null {
 try{const raw=localStorage.getItem(namespace);if(raw===null)return null;const x=JSON.parse(raw);
  if(!x||Object.keys(x).some(k=>!['generation','confirmed_generation','kind','phase'].includes(k))||!uuid.test(x.generation)||x.confirmed_generation!==undefined&&!uuid.test(x.confirmed_generation)||!['BOOTSTRAP','ROTATE','REVOKE'].includes(x.kind)||!phases.includes(x.phase))throw 0;return x;
 }catch{throw new ConnectionError('CONNECTION_FENCE_INVALID');}
}
function writeFence(f:Fence){try{const raw=JSON.stringify(f);localStorage.setItem(namespace,raw);if(localStorage.getItem(namespace)!==raw)throw 0;}catch{throw new ConnectionError('CONNECTION_STORAGE_UNAVAILABLE');}}
async function locked<T>(fn:()=>Promise<T>):Promise<T>{
 if(globalThis.location?.origin!=='http://127.0.0.1:8084'||!navigator.locks?.request||!globalThis.crypto?.randomUUID)throw new ConnectionError('CONNECTION_WRITES_UNAVAILABLE');
 return navigator.locks.request(namespace,{mode:'exclusive'},fn);
}
async function call(action:string,data:Record<string,unknown>,csrf?:string):Promise<any>{
 const get=['state','generation-state'].includes(action),controller=new AbortController();const timer=setTimeout(()=>controller.abort(),7000);
 try{const url=origin+action+(get?'?'+new URLSearchParams(Object.entries(data).filter(([,v])=>v!==undefined).map(([k,v])=>[k,String(v)])):'');
  const r=await fetch(url,{method:get?'GET':'POST',credentials:'include',redirect:'error',cache:'no-store',signal:controller.signal,
   headers:{'X-Judoju-Installation':'local-v1',...(get?{}:{'Content-Type':'application/json'}),...(csrf?{'X-CSRF-Token':csrf}:{})},...(get?{}:{body:JSON.stringify(data)})});
  const value=await r.json();if(!r.ok)throw new ConnectionError(typeof value.error==='string'?value.error:'CONNECTION_REQUEST_FAILED');return value;
 }catch(e){if(e instanceof ConnectionError)throw e;throw new ConnectionError('CONNECTION_RESPONSE_UNKNOWN');}finally{clearTimeout(timer);}
}
const query=(f:Fence)=>({generation:f.generation,...(f.confirmed_generation?{confirmed_generation:f.confirmed_generation}:{})});
async function state(f:Fence):Promise<InstallationState>{return call('state',query(f));}
const unknown=(f:Fence)=>f.phase.startsWith('UNKNOWN')||['START_DISPATCHED','START_CONFIRMED','COMMIT_DISPATCHED','COMMIT_CONFIRMED','ACK_DISPATCHED'].includes(f.phase);
function noteUnknown(f:Fence){const phase=f.phase.startsWith('START_')?'UNKNOWN_START':f.phase==='ACK_DISPATCHED'?'UNKNOWN_ACK':'UNKNOWN_COMMIT';writeFence({...f,phase});}
async function sequence(kind:Fence['kind'],previous?:Fence):Promise<InstallationState>{
 const f:Fence={generation:crypto.randomUUID(),...(previous?.confirmed_generation?{confirmed_generation:previous.confirmed_generation}:{}),kind,phase:'START_DISPATCHED'};
 writeFence(f); // durable intent precedes the first cookie-writing request
 try{
  await call('start',{...query(f),kind});f.phase='START_CONFIRMED';writeFence(f);
  const started=await state(f);if(started.state!=='STARTED'||!started.csrf)throw new ConnectionError('COOKIE_REQUIRED');
  f.phase='COMMIT_DISPATCHED';writeFence(f);await call('commit',query(f),started.csrf);
  f.phase='COMMIT_CONFIRMED';if(kind!=='REVOKE')f.confirmed_generation=f.generation;else delete f.confirmed_generation;writeFence(f);
  const committed=await state(f);if(committed.state!=='COMMITTED'||!committed.csrf)throw new ConnectionError('COMMIT_NOT_CONFIRMED');
  // A successful fetch and same-operation state establish the preceding cookie write settled.
  f.phase='ACK_DISPATCHED';writeFence(f);await call('ack',query(f),committed.csrf);
  f.phase=kind==='REVOKE'?'REVOKED':'ACTIVE';writeFence(f);
  return kind==='REVOKE'?{state:'REVOKED'}:state(f);
 }catch(e){if(['START_DISPATCHED','START_CONFIRMED','COMMIT_DISPATCHED','COMMIT_CONFIRMED','ACK_DISPATCHED'].includes(f.phase))noteUnknown(f);throw e;}
}
async function readUnlocked():Promise<InstallationState>{
 const f=readFence();if(!f)return {state:'NOT_CONNECTED'};
 if(unknown(f))return {state:f.phase.startsWith('UNKNOWN')?f.phase:'UNKNOWN_'+(f.phase.startsWith('START_')?'START':f.phase==='ACK_DISPATCHED'?'ACK':'COMMIT'),generation:f.generation};
 if(['SEALED_START','SEALED_FORGOTTEN','REVOKED'].includes(f.phase))return {state:f.phase};
 const r=await state(f);if(r.settings&&r.state==='ACKNOWLEDGED')r.state='ACTIVE';return r;
}
async function sealOrForget(f:Fence):Promise<InstallationState>{
 // A missed COMMIT may leave STARTED even when the client recorded COMMIT.
 // The server atomically chooses START sealing versus a committed generation.
 const current=await call('start-seal',{generation:f.generation});
 if(['SEALED_START','SEALED_FORGOTTEN'].includes(current.state)){
  // A failed rotation/revoke did not invalidate the previous capability.
  if(current.state==='SEALED_START'&&f.confirmed_generation&&f.confirmed_generation!==f.generation){
   const prior:Fence={generation:f.confirmed_generation,confirmed_generation:f.confirmed_generation,kind:'BOOTSTRAP',phase:'ACTIVE'};
   try{const restored=await state(prior);if(restored.settings){writeFence(prior);return restored;}}catch{/* Explicit new/default path remains available. */}
  }
  writeFence({...f,phase:current.state});return {state:current.state};
 }
 const terminal=await call('generation-state',{generation:f.generation});
 if(!['COMMITTED','ACKNOWLEDGED'].includes(terminal.state)||Date.parse(terminal.deadline)>Date.parse(terminal.server_time))return {state:'RECOVERY_DEADLINE_PENDING'};
 const result=await call('generation-forget',{generation:f.generation,confirmed:true});
 if(result.state!=='SEALED_FORGOTTEN')throw new ConnectionError('GENERATION_NOT_SEALED');
 writeFence({...f,phase:'SEALED_FORGOTTEN'});return {state:'SEALED_FORGOTTEN'};
}
export const installationAdapter:InstallationAdapter={
 async ticket(view){return locked(async()=>{const f=readFence();if(!f||f.phase!=='ACTIVE')throw new ConnectionError('CONNECTION_NOT_ACTIVE');const s=await state(f);if(!s.csrf)throw new ConnectionError('CSRF_REQUIRED');return call('view-ticket',{...query(f),view},s.csrf);});},
 async accept(view){return locked(async()=>{const f=readFence();if(!f||f.phase!=='ACTIVE')throw new ConnectionError('CONNECTION_NOT_ACTIVE');const s=await state(f);if(!s.csrf)throw new ConnectionError('CSRF_REQUIRED');return call('view-accept',{...query(f),view},s.csrf);});},
 async initialize(){return locked(async()=>{
  const f=readFence();if(f)return readUnlocked();
  // A missing fence cannot authorize guessing a surviving HttpOnly session cookie.
  const probe=await call('state',{generation:crypto.randomUUID()});
  if(probe.other_cookie_present)return {state:'FENCE_MISSING_EXISTING_COOKIE'};
  return sequence('BOOTSTRAP');
 });},
 async read(){return locked(readUnlocked);},
 async save(settings:InstallationSettings){return locked(async()=>{const f=readFence();if(!f||f.phase!=='ACTIVE')throw new ConnectionError('CONNECTION_NOT_ACTIVE');const r=await state(f);if(!r.csrf)throw new ConnectionError('CSRF_REQUIRED');await call('settings',{...query(f),settings},r.csrf);return state(f);});},
 async rotate(){return locked(async()=>{const f=readFence();if(!f||f.phase!=='ACTIVE')throw new ConnectionError('CONNECTION_NOT_ACTIVE');return sequence('ROTATE',f);});},
 async disconnect(){return locked(async()=>{const f=readFence();if(!f||f.phase!=='ACTIVE')throw new ConnectionError('CONNECTION_NOT_ACTIVE');return sequence('REVOKE',f);});},
 async recover(){return locked(async()=>{
  const f=readFence();if(!f)throw new ConnectionError('CONNECTION_NOT_FOUND');
  // A successfully installed new-generation cookie can prove the same result
  // without reissuing COMMIT or applying any old response headers again.
  const sameOperation:Fence={...f,confirmed_generation:f.generation};
  try{
   const r=await state(sameOperation);
   if(r.settings&&['COMMITTED','ACKNOWLEDGED','ACTIVE'].includes(r.state)&&r.csrf&&f.kind!=='REVOKE'){
    // ACTIVE has no pending cookie (e.g. ACK headers already applied). A valid
    // exact-generation session proves the committed result; do not reissue it.
    if(r.state!=='ACTIVE')await call('ack',query(sameOperation),r.csrf);
    writeFence({...sameOperation,phase:'ACTIVE'});return state(sameOperation);
   }
   if(f.kind==='REVOKE'&&['COMMITTED','ACKNOWLEDGED'].includes(r.state)&&r.csrf){
    await call('ack',query(f),r.csrf);writeFence({...f,phase:'REVOKED'});return {state:'REVOKED'};
   }
  }catch(error){
   // No candidate cookie is selected by prefix, and failed proof is not success.
   if(!(error instanceof ConnectionError)||!['INSTALLATION_UNAUTHORIZED','CONNECTION_INFO_INVALID','CSRF_REJECTED','PENDING_COOKIE_REQUIRED','INSTALLATION_REQUEST_REJECTED','GENERATION_SEALED'].includes(error.code))throw error;
  }
  return sealOrForget(f);
 });},
 async newConnection(){return locked(async()=>{
  let f:Fence|null;try{f=readFence();}catch{f=null;}
  if(f?.phase==='ACTIVE'){
   try{const current=await state(f);if(current.settings)throw new ConnectionError('DISCONNECT_BEFORE_NEW_CONNECTION');}
   catch(error){if(!(error instanceof ConnectionError)||error.code!=='INSTALLATION_UNAUTHORIZED')throw error;}
   const sealed=await sealOrForget(f);
   if(!['SEALED_START','SEALED_FORGOTTEN'].includes(sealed.state))throw new ConnectionError('RECOVERY_DEADLINE_PENDING');
   f=readFence();
  }
  if(f&&!['SEALED_START','SEALED_FORGOTTEN','REVOKED'].includes(f.phase))throw new ConnectionError('PREVIOUS_OPERATION_NOT_SEALED');
  // User-confirmed missing/corrupt fence path: old generation cookies remain ignored.
  // It does not revoke/delete old server data and it never changes device bookmarks.
  return sequence('BOOTSTRAP');
 });}
};
