import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SecureStore from 'expo-secure-store';
import * as Crypto from 'expo-crypto';
import {Platform} from 'react-native';
import type {InstallationAdapter,InstallationSettings,InstallationState} from './installation-types';
const secureKey='judoju.news.local.installation.v1',markerKey='judoju-news:local:installation-marker:v1';
const options={keychainService:'judoju.news.local.installation.v1',requireAuthentication:false};
type Capability={id:string;generation:string;secret:string;version:number;expires_at:string};
type Pending={generation:string;nonce:string;kind:'BOOTSTRAP'|'ROTATE'|'REVOKE';payload_hash?:string;prior:Capability|null;phase:string};
type Envelope={schema:1;capability:Capability|null;pending:Pending|null;disconnected?:true};
let tail:Promise<unknown>=Promise.resolve();
const queue=<T,>(fn:()=>Promise<T>):Promise<T>=>{const run=tail.then(fn);tail=run.catch(()=>{});return run;};
const uuid=/^[0-9a-f-]{36}$/,hex=/^[0-9a-f]{64}$/;
const validCap=(x:any):x is Capability=>x&&uuid.test(x.id)&&uuid.test(x.generation)&&hex.test(x.secret)&&Number.isSafeInteger(x.version)&&x.version>0&&Number.isFinite(Date.parse(x.expires_at));
async function readEnvelope():Promise<Envelope|null>{
 const marker=await AsyncStorage.getItem(markerKey),raw=await SecureStore.getItemAsync(secureKey,options);
 if(marker==='revoked-v1'){
  if(raw!==null){await SecureStore.deleteItemAsync(secureKey,options);if(await SecureStore.getItemAsync(secureKey,options)!==null)throw new Error('LOCAL_CLEAR_PENDING');}
  return {schema:1,capability:null,pending:null,disconnected:true};
 }
 if(marker===null){
  // iOS Keychain may survive uninstall; never inherit that prior install silently.
  if(raw!==null){await SecureStore.deleteItemAsync(secureKey,options);if(await SecureStore.getItemAsync(secureKey,options)!==null)throw new Error('LOCAL_CLEAR_PENDING');}
  return null;
 }
 if(marker!=='v1'||raw===null)throw new Error('RECONNECT_REQUIRED');
 try{const x=JSON.parse(raw);if(x?.schema!==1||x.capability!==null&&!validCap(x.capability)||x.pending!==null&&(!uuid.test(x.pending.generation)||!hex.test(x.pending.nonce)||!['BOOTSTRAP','ROTATE','REVOKE'].includes(x.pending.kind)||x.pending.prior!==null&&!validCap(x.pending.prior)))throw 0;return x;}
 catch{throw new Error('RECONNECT_REQUIRED');}
}
async function store(x:Envelope){
 // The non-secret marker is written first. A crash produces RECONNECT_REQUIRED,
 // never reuse of a leftover Keychain value as a successful new installation.
 await AsyncStorage.setItem(markerKey,'v1');await SecureStore.setItemAsync(secureKey,JSON.stringify(x),options);
 if(await SecureStore.getItemAsync(secureKey,options)!==JSON.stringify(x))throw new Error('SECURE_STORE_WRITE_FAILED');
}
function base64(value:unknown){const bytes=new TextEncoder().encode(JSON.stringify(value));let s='';for(const b of bytes)s+=String.fromCharCode(b);return btoa(s);}
async function call(action:string,data:Record<string,any>){
 if(Platform.OS!=='android')throw new Error('IOS_INSTALLATION_API_DEFERRED');
 const get=['state','generation-state'].includes(action),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),7000);
 const cap=data.capability,pending=data.pending,query=get?new URLSearchParams(Object.entries(data).filter(([k,v])=>!['capability','pending'].includes(k)&&v!==undefined).map(([k,v])=>[k,String(v)])):null;
 try{const r=await fetch('http://10.0.2.2:3100/api/installations/'+action+(query?'?'+query:''),{method:get?'GET':'POST',credentials:'omit',redirect:'error',signal:controller.signal,
  headers:{'X-Judoju-Native':'1','X-Judoju-Installation':'local-v1',...(get?{...(cap?{'X-Installation-Capability':base64(cap)}:{}),...(pending?{'X-Installation-Pending':base64(pending)}:{})}:{'Content-Type':'application/json'})},...(get?{}:{body:JSON.stringify(data)})});
  const x=await r.json();if(!r.ok)throw new Error(typeof x.error==='string'?x.error:'CONNECTION_REQUEST_FAILED');return x;
 }finally{clearTimeout(timer);}
}
const args=(e:Envelope)=>({generation:e.pending?.generation??e.capability?.generation,confirmed_generation:e.capability?.generation,...(e.capability?{capability:e.capability}:{}),...(e.pending?.payload_hash?{pending:e.pending}:{})});
async function readState(e:Envelope):Promise<InstallationState>{
 if(!e.capability&&!e.pending)return {state:e.disconnected?'REVOKED':'NOT_CONNECTED'};
 if(e.pending)return {state:'RECOVERY_REQUIRED',generation:e.pending.generation};
 const x=await call('state',args(e));if(x.settings&&x.state==='ACKNOWLEDGED')x.state='ACTIVE';return x;
}
async function finish(e:Envelope):Promise<InstallationState>{
 const p=e.pending;if(!p?.payload_hash)throw new Error('RECOVERY_REQUIRED');
 // An exact nonce/payload/prior capability is the only replay path. Native
 // responses have no browser Set-Cookie uncertainty.
 if(p.phase!=='COMMIT_CONFIRMED'){
  const r=await call('commit',{generation:p.generation,pending:p,...(p.prior?{capability:p.prior,confirmed_generation:p.prior.generation}:{})});
  if(p.kind!=='REVOKE'){
   if(!validCap(r.capability)||r.capability.generation!==p.generation)throw new Error('INVALID_SERVER_CAPABILITY');
   e.capability=r.capability;
  }else e.capability=null;
  p.phase='COMMIT_CONFIRMED';await store(e); // durable new capability before ACK
 }
 await call('ack',{generation:p.generation,pending:p,...(e.capability?{capability:e.capability,confirmed_generation:e.capability.generation}:{})});
 if(p.kind==='REVOKE'){
  // Durable non-secret opt-out survives restart. No revoked capability is kept.
  await AsyncStorage.setItem(markerKey,'revoked-v1');
  if(await AsyncStorage.getItem(markerKey)!=='revoked-v1')throw new Error('LOCAL_CLEAR_PENDING');
  await SecureStore.deleteItemAsync(secureKey,options);if(await SecureStore.getItemAsync(secureKey,options)!==null)throw new Error('LOCAL_CLEAR_PENDING');
  return {state:'REVOKED'};
 }
 e.pending=null;await store(e);return readState(e);
}
async function sequence(kind:Pending['kind'],current:Envelope|null){
 if(current?.pending)throw new Error('PREVIOUS_OPERATION_NOT_CONFIRMED');
 const p:Pending={generation:Crypto.randomUUID(),nonce:Array.from(await Crypto.getRandomBytesAsync(32),b=>b.toString(16).padStart(2,'0')).join(''),kind,prior:current?.capability??null,phase:'START_DISPATCHED'};
 p.payload_hash=await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256,JSON.stringify({kind,prior_generation:p.prior?.generation??null,installation_id:p.prior?.id??null,version:p.prior?.version??null}));
 const e:Envelope={schema:1,capability:current?.capability??null,pending:p};await store(e);
 const r=await call('start',{generation:p.generation,kind,nonce:p.nonce,...(p.prior?{capability:p.prior,confirmed_generation:p.prior.generation}:{})});
 if(r.pending?.generation!==p.generation||r.pending?.nonce!==p.nonce||!hex.test(r.pending?.payload_hash))throw new Error('INVALID_PENDING_RESULT');
 e.pending={...r.pending,phase:'START_CONFIRMED'};await store(e);return finish(e);
}
export const installationAdapter:InstallationAdapter={
 ticket:view=>queue(async()=>{const e=await readEnvelope();if(!e?.capability||e.pending)throw new Error('CONNECTION_NOT_ACTIVE');return call('view-ticket',{...args(e),view});}),
 accept:view=>queue(async()=>{const e=await readEnvelope();if(!e?.capability||e.pending)throw new Error('CONNECTION_NOT_ACTIVE');return call('view-accept',{...args(e),view});}),
 initialize:()=>queue(async()=>{const e=await readEnvelope();return e?readState(e):sequence('BOOTSTRAP',null);}),
 read:()=>queue(async()=>{const e=await readEnvelope();return e?readState(e):{state:'NOT_CONNECTED'};}),
 save:(settings:InstallationSettings)=>queue(async()=>{const e=await readEnvelope();if(!e?.capability||e.pending)throw new Error('CONNECTION_NOT_ACTIVE');await call('settings',{...args(e),settings});return readState(e);}),
 rotate:()=>queue(async()=>{const e=await readEnvelope();if(!e?.capability)throw new Error('CONNECTION_NOT_ACTIVE');return sequence('ROTATE',e);}),
 disconnect:()=>queue(async()=>{const e=await readEnvelope();if(!e?.capability)throw new Error('CONNECTION_NOT_ACTIVE');return sequence('REVOKE',e);}),
 recover:()=>queue(async()=>{const e=await readEnvelope();if(!e?.pending)throw new Error('NO_PENDING_OPERATION');
  const current=await call('generation-state',{generation:e.pending.generation});
  if(e.pending.payload_hash&&!['NONE','SEALED_START','SEALED_FORGOTTEN'].includes(current.state)){
   if(['COMMITTED','ACKNOWLEDGED'].includes(current.state)){
    // Even a locally confirmed capability can expire before its pending ACK.
    if(e.pending.phase==='COMMIT_CONFIRMED'){
     try{return await finish(e);}catch(error){if(!(error instanceof Error)||!['INSTALLATION_UNAUTHORIZED','GENERATION_SEALED'].includes(error.message))throw error;}
    }
    if(Date.parse(current.deadline)<=Date.parse(current.server_time)){
    const sealed=await call('generation-forget',{generation:e.pending.generation,confirmed:true});
    if(sealed.state!=='SEALED_FORGOTTEN')throw new Error('GENERATION_NOT_SEALED');e.pending=null;e.capability=null;await store(e);return {state:'SEALED_FORGOTTEN'};
    }
    return finish(e);
   }
   if(current.state==='STARTED'&&Date.parse(current.deadline)>Date.parse(current.server_time))return finish(e);
  }
  // START response was lost: seal before allowing a fresh operation. A native
  // nonce alone cannot reconstruct a missing authoritative payload hash.
  const r=await call('start-seal',{generation:e.pending.generation});
  if(!['SEALED_START','SEALED_FORGOTTEN'].includes(r.state))return {state:'RECOVERY_REQUIRED'};
  const prior=e.pending.prior;e.pending=null;e.capability=r.state==='SEALED_START'?prior:null;await store(e);
  if(e.capability){try{return await readState(e);}catch(error){if(!(error instanceof Error)||error.message!=='INSTALLATION_UNAUTHORIZED')throw error;e.capability=null;await store(e);}}
  return {state:r.state};
 }),
 newConnection:()=>queue(async()=>{
  let e:Envelope|null;try{e=await readEnvelope();}catch(error){if(!(error instanceof Error)||error.message!=='RECONNECT_REQUIRED')throw error;e=null;}
  if(e?.pending)throw new Error('PREVIOUS_OPERATION_NOT_CONFIRMED');
  if(e?.capability&&Date.parse(e.capability.expires_at)>Date.now()){
   try{await call('state',args(e));throw new Error('DISCONNECT_BEFORE_NEW_CONNECTION');}
   catch(error){if(!(error instanceof Error)||error.message!=='INSTALLATION_UNAUTHORIZED')throw error;}
  }
  await SecureStore.deleteItemAsync(secureKey,options);if(await SecureStore.getItemAsync(secureKey,options)!==null)throw new Error('LOCAL_CLEAR_PENDING');await AsyncStorage.removeItem(markerKey);
  return sequence('BOOTSTRAP',null);
 })
};
