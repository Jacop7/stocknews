/** No default network, DB client, clock, env or journal. MAIN owns the trusted autocommit transport.
 * A transport resolution means COMMIT ACK; it must not expose an outer BEGIN API.
 * Brands are composition boundaries, not real DB/authority or physical COMMIT-time authentication.
 */
interface HomeHash {update(value:string,encoding?:string):HomeHash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(algorithm:'sha256'):HomeHash}};
const {createHash}=process.getBuiltinModule('node:crypto');
import {HOME_DATABASE_SCHEMA,homeData,homeIsProxy,homeRecord,homeExact,homeReject,homeUuid,homeId,homeRoleAllows,homeRequestCanonical,validateHomeDatabaseRequest,validateHomeDatabaseReply,validateHomeDatabaseResource,type HomeDatabaseResourceIdentity,type HomeDatabaseTransport,type HomeDbRole,type HomeDbRpc,type HomeDatabaseReply,type HomeHeadReply,type HomeWriteReceipt,type HomeEffectReply,type HomeInternalReadReply,type HomePreparedRoundHandle,type HomePreparedRoundSummary,type HomeEvaluatedRound,type HomeCaptureResult,type JsonRecord} from './database-contracts.ts';
import {evaluateHomeDatabaseRound,isOwnedHomeDatabaseEvaluator} from './database-evaluator.ts';

export interface HomeDatabaseAdapterOptions {namespaceId:string;streamId:string;expectedResourceIdentity:HomeDatabaseResourceIdentity;transport:HomeDatabaseTransport;}
export interface OwnedHomeDatabaseAdapter {readonly kind:'OWNED_HOME_DATABASE_ADAPTER';}
export interface HomeDatabaseCoordinator {
 getHead():Promise<HomeHeadReply>;
 captureEvaluate(request:unknown):Promise<HomePreparedRoundHandle>;
 inspectPrepared(handle:unknown):HomePreparedRoundSummary;
 commitPrepared(handle:unknown,effectKey:string):Promise<HomeWriteReceipt>;
 lookupEffect(request:unknown):Promise<HomeEffectReply>;
 discardStaleRound(request:unknown):Promise<HomeWriteReceipt>;
 readCurrentHome():Promise<HomeInternalReadReply>;
}
interface State {namespaceId:string;streamId:string;identity:HomeDatabaseResourceIdentity;transport:HomeDatabaseTransport;generation:string|null;ready:Promise<void>|null;}
const adapters=new WeakMap<object,State>();
const sha=(s:string)=>createHash('sha256').update(s,'utf8').digest('hex');
const same=(a:unknown,b:unknown)=>homeRequestCanonical(a)===homeRequestCanonical(b);
function optionValues(raw:unknown):Record<string,unknown> {
 if(!raw||typeof raw!=='object'||homeIsProxy(raw)||Object.getPrototypeOf(raw)!==Object.prototype)homeReject();
 const descriptors=Object.getOwnPropertyDescriptors(raw);if(Reflect.ownKeys(raw).length!==4)homeReject();const result:Record<string,unknown>={};
 for(const key of ['namespaceId','streamId','expectedResourceIdentity','transport']){const d=descriptors[key];if(!d||!d.enumerable||!('value'in d))homeReject();result[key]=d.value;}
 return result;
}
export function createHomeDatabaseAdapter(options:HomeDatabaseAdapterOptions):OwnedHomeDatabaseAdapter {
 const v=optionValues(options);if(!homeUuid(v.namespaceId)||!homeId(v.streamId)||typeof v.transport!=='function'||homeIsProxy(v.transport))homeReject();
 const identity=validateHomeDatabaseResource(v.expectedResourceIdentity),adapter=Object.freeze({kind:'OWNED_HOME_DATABASE_ADAPTER' as const});
 adapters.set(adapter,{namespaceId:v.namespaceId,streamId:v.streamId,identity,transport:v.transport as HomeDatabaseTransport,generation:null,ready:null});return adapter;
}
export function isOwnedHomeDatabaseAdapter(value:unknown):boolean {return !!value&&typeof value==='object'&&adapters.has(value);}
function stateOf(adapter:unknown):State {if(!isOwnedHomeDatabaseAdapter(adapter))homeReject('ADAPTER_NOT_OWNED');return adapters.get(adapter as object)!;}
/** Precomputable before send, including an ACK-lost first attempt. No input mutation. */
function requestDigest(s:State,rpc:HomeDbRpc,r:JsonRecord):string {
 return sha(homeRequestCanonical({schema:'HOME_DB_BOUND_V1_REQUEST',resourceId:s.identity.resourceId,namespaceId:s.namespaceId,backendGeneration:rpc==='fixture_apply'&&r.action==='CREATE_NAMESPACE'?null:s.generation,operation:rpc,request:r}));
}
async function invoke(s:State,role:HomeDbRole,rpc:HomeDbRpc,raw:unknown):Promise<HomeDatabaseReply> {
 if(!homeRoleAllows(role,rpc))homeReject('FORBIDDEN');const request=validateHomeDatabaseRequest(rpc,raw);
 if(rpc!=='resource_identity'&&request.namespaceId!==s.namespaceId)homeReject('NAMESPACE_MISMATCH');
 if(Object.hasOwn(request,'streamId')&&request.streamId!==s.streamId)homeReject('STREAM_MISMATCH');
 // Transport errors or malformed post-ACK replies never mean NOT_APPLIED. Recover the same intent/key.
 const response=validateHomeDatabaseReply(rpc,await s.transport({role,rpc,args:{p_request:homeData(request) as JsonRecord}}));
 if(response.resourceId!==s.identity.resourceId||response.principal.resourceId!==s.identity.resourceId||response.principal.runId!==s.identity.runId||response.principal.componentRole!==role)homeReject('RESOURCE_MISMATCH');
 if(rpc==='resource_identity'){
  if(!same(response.result.resourceIdentity,s.identity))homeReject('RESOURCE_MISMATCH');
 }else {
  if(response.namespaceId!==s.namespaceId||!response.backendGeneration||s.generation!==null&&response.backendGeneration!==s.generation)homeReject('GENERATION_CONFLICT');
  if(response.effectKey!==undefined&&(response.effectKey!==request.effectKey||response.requestDigest!==requestDigest(s,rpc,request)))homeReject('EFFECT_CONFLICT');
 }
 return response;
}
async function ready(s:State):Promise<void> {
 if(s.ready===null){s.ready=(async()=>{
  await invoke(s,'home_v1_capture_worker','resource_identity',{resourceId:s.identity.resourceId});
  const head=await invoke(s,'home_v1_capture_worker','get_head',{namespaceId:s.namespaceId,streamId:s.streamId});
  s.generation=head.backendGeneration;
 })();}
 try{await s.ready;}catch(e){s.ready=null;throw e;}
}
async function call(s:State,role:HomeDbRole,rpc:HomeDbRpc,raw:unknown):Promise<HomeDatabaseReply> {
 await ready(s);
 // A new resource check on each operation keeps the pinned physical identity explicit.
 await invoke(s,role,'resource_identity',{resourceId:s.identity.resourceId});return invoke(s,role,rpc,raw);
}
interface Prepared {capture:HomeDatabaseReply;evaluated:HomeEvaluatedRound;summary:HomePreparedRoundSummary;}
export function createHomeDatabaseCoordinator(options:{adapter:unknown;evaluator:unknown}):HomeDatabaseCoordinator {
 if(!options||typeof options!=='object'||homeIsProxy(options)||Object.getPrototypeOf(options)!==Object.prototype||Reflect.ownKeys(options).length!==2)homeReject();
 const descriptors=Object.getOwnPropertyDescriptors(options);for(const key of ['adapter','evaluator'])if(!descriptors[key]||!('value'in descriptors[key]!)||!descriptors[key]!.enumerable)homeReject();
 const s=stateOf(descriptors.adapter!.value),evaluator:unknown=descriptors.evaluator!.value;if(!isOwnedHomeDatabaseEvaluator(evaluator))homeReject('EVALUATOR_NOT_OWNED');
 const prepared=new WeakMap<object,Prepared>();
 const get=(handle:unknown):Prepared=>{if(!handle||typeof handle!=='object'||!prepared.has(handle))homeReject('HANDLE_NOT_OWNED');return prepared.get(handle)!;};
 const coordinator:HomeDatabaseCoordinator={
  async getHead(){return call(s,'home_v1_capture_worker','get_head',{namespaceId:s.namespaceId,streamId:s.streamId});},
  async captureEvaluate(raw:unknown){
   const r=validateHomeDatabaseRequest('capture_round',raw);if(r.namespaceId!==s.namespaceId||r.streamId!==s.streamId)homeReject('STREAM_MISMATCH');
   const capture=await call(s,'home_v1_capture_worker','capture_round',r),value=capture.result as unknown as HomeCaptureResult;
   if(value.roundId!==r.roundId||value.streamId!==r.streamId||value.rankingCutoff!==r.rankingCutoff||!same(value.expectedHead,r.expectedHead))homeReject('CAPTURE_MISMATCH');
   const evaluated=evaluateHomeDatabaseRound(evaluator,capture);
   const summary:HomePreparedRoundSummary={schema:HOME_DATABASE_SCHEMA,status:'PREPARED',namespaceId:s.namespaceId,roundId:value.roundId,streamId:s.streamId,rankingCutoff:value.rankingCutoff,backendGeneration:capture.backendGeneration!,producerRevision:value.producerRevision,expectedHead:value.expectedHead,inputDigest:value.inputDigest,resultDigest:evaluated.resultDigest};
   // All bounded copies are made before inserting local state; no caller-supplied raw commit value.
   const stored={capture:homeData(capture) as unknown as HomeDatabaseReply,evaluated:homeData(evaluated) as unknown as HomeEvaluatedRound,summary:homeData(summary) as unknown as HomePreparedRoundSummary};
   const handle=Object.freeze({opaque:'HOME_DB_PREPARED' as const});prepared.set(handle,stored);return handle;
  },
  inspectPrepared(handle:unknown){return homeData(get(handle).summary) as unknown as HomePreparedRoundSummary;},
  async commitPrepared(handle:unknown,effectKey:string){
   if(!homeUuid(effectKey))homeReject();const p=get(handle),v=p.capture.result as unknown as HomeCaptureResult;
   const r={namespaceId:s.namespaceId,effectKey,roundId:v.roundId,expectedHead:v.expectedHead,backendGeneration:p.capture.backendGeneration,producerRevision:v.producerRevision,inputDigest:v.inputDigest,resultCanonical:p.evaluated.resultCanonical};
   const receipt=await call(s,'home_v1_commit_worker','commit_round',r);
   if(receipt.result.roundId!==v.roundId||receipt.result.inputDigest!==v.inputDigest||receipt.result.resultDigest!==p.evaluated.resultDigest)homeReject('RECEIPT_MISMATCH');return receipt;
  },
  async lookupEffect(raw:unknown){const r=validateHomeDatabaseRequest('lookup_effect',raw);await ready(s);if(r.backendGeneration!==s.generation)homeReject('GENERATION_CONFLICT');const role:HomeDbRole=r.operation==='fixture_apply'?'home_v1_fixture_writer':r.operation==='capture_round'?'home_v1_capture_worker':'home_v1_commit_worker';return call(s,role,'lookup_effect',r);},
  async discardStaleRound(raw:unknown){return call(s,'home_v1_commit_worker','discard_stale_round',validateHomeDatabaseRequest('discard_stale_round',raw));},
  async readCurrentHome(){return call(s,'home_v1_internal_reader','read_current_home',{namespaceId:s.namespaceId,streamId:s.streamId});},
 };
 return Object.freeze(coordinator);
}
