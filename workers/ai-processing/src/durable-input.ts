/** Node-only DURABLE_ANALYSIS_INPUT_V1. Synthetic DB input; no model/provider/publication execution. */
import {isOwnedCollectorDbReadPortV1,readOwnedCollectorDbAnalysisInputV1} from '../../collectors/src/collector-db-store-v1.ts';
import {validateCollectorBridgeRequestV1,validateCollectorBridgeReadResultV1,type CollectorBridgeReadRequestV1,type CollectorReadyReadV1,type KnownV1} from '../../collectors/src/collector-db-contracts-v1.ts';

const flags=Object.freeze({schema:'DURABLE_ANALYSIS_INPUT_V1' as const,mode:'SYNTHETIC_ISOLATED_DB' as const,fixtureAssertionOnly:true as const,providerExecutionEnabled:false as const,publicationEnabled:false as const,crossWorkerAtomicityProven:false as const});
// Node-only builtins with the exact small surface used here; no ambient Node typings or dependency change.
interface Hash {update(value:string|Uint8Array,encoding?:'utf8'):Hash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(name:'sha256'):Hash};getBuiltinModule(name:'node:util'):{types:{isProxy(value:unknown):boolean}}};
const {createHash}=process.getBuiltinModule('node:crypto'),{types}=process.getBuiltinModule('node:util'),encoder=new TextEncoder();
export interface DurableAnalysisRequestV1 {
  source:CollectorBridgeReadRequestV1;
  versions:{analysisPolicyVersion:string;catalogVersion:string;promptVersion:string;generatorVersion:string};
  sectorIds:string[];
}
export type DurableAnalysisSourceV1=Omit<CollectorReadyReadV1,'content'>;
export interface DurableAnalysisInputV1 {perspective:'KR_LISTED_EQUITIES';source:DurableAnalysisSourceV1;versions:DurableAnalysisRequestV1['versions'];sectorIds:string[];content:{kind:'UNTRUSTED_ORIGINAL_TEXT';text:string};checkedAt:string;}
export type DurableAnalysisPreparationV1=typeof flags&(
  {disposition:'READY_SYNTHETIC_INPUT';handle:object;checkedAt:string;input:DurableAnalysisInputV1}
  |{disposition:'HOLD';reason:'SOURCE_UNAVAILABLE'|'SOURCE_NOT_READY'|'SOURCE_BINDING_CHANGED';source:{deliveryId:string}}
);
export interface OwnedDurableAnalysisInputPort {
  readonly readForAnalysis:(request:DurableAnalysisRequestV1)=>Promise<DurableAnalysisPreparationV1>;
  readonly readOwnedAnalysisInput:(handle:unknown)=>Promise<DurableAnalysisPreparationV1>;
}
interface PortState {collectorPort:unknown;prepare:OwnedDurableAnalysisInputPort['readForAnalysis'];reread:OwnedDurableAnalysisInputPort['readOwnedAnalysisInput'];}
interface HandleState {owner:OwnedDurableAnalysisInputPort;request:DurableAnalysisRequestV1;fingerprint:string;}
const ports=new WeakMap<object,PortState>(),handles=new WeakMap<object,HandleState>();
const readCollector=readOwnedCollectorDbAnalysisInputV1,checkCollector=isOwnedCollectorDbReadPortV1;
function fail():never{throw new Error('DURABLE_ANALYSIS_INVALID_INPUT');}

/** No accessors/toJSON/Proxy execution and no retained caller-owned children. */
function data(raw:unknown,depthLimit=16,nodeLimit=4096):unknown {
  let nodes=0;const active=new Set<object>();
  const copy=(v:unknown,depth:number):unknown=>{
    if(++nodes>nodeLimit||depth>depthLimit)fail();
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'){if(/\u0000|[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(v))fail();return v;}
    if(typeof v==='number'){if(!Number.isSafeInteger(v))fail();return v;}
    if(!v||typeof v!=='object'||types.isProxy(v)||active.has(v))fail();
    const array=Array.isArray(v),proto=Object.getPrototypeOf(v),keys=Reflect.ownKeys(v);active.add(v);
    if(array){if(proto!==Array.prototype||keys.length!==v.length+1||v.length>nodeLimit)fail();const out:unknown[]=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!('value'in d))fail();out.push(copy(d.value,depth+1));}active.delete(v);return out;}
    if(proto!==Object.prototype&&proto!==null)fail();const out:Record<string,unknown>={};
    for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key);if(typeof key!=='string'||!d||!d.enumerable||!('value'in d))fail();Object.defineProperty(out,key,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}active.delete(v);return out;
  };
  const result=copy(raw,0);if(encoder.encode(JSON.stringify(result)).length>131072)fail();return result;
}
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))fail();return v as Record<string,unknown>;}
function exact(v:Record<string,unknown>,keys:string[]):void{if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))fail();}
function id(v:unknown):string{if(typeof v!=='string'||v.length>160||! /^[A-Za-z0-9][A-Za-z0-9_.:/-]*$/.test(v))fail();return v;}
function request(raw:unknown):DurableAnalysisRequestV1 {
  const v=record(data(raw));exact(v,['source','versions','sectorIds']);const versions=record(v.versions);exact(versions,['analysisPolicyVersion','catalogVersion','promptVersion','generatorVersion']);for(const key of Object.keys(versions))id(versions[key]);
  if(!Array.isArray(v.sectorIds)||v.sectorIds.length<1||v.sectorIds.length>100)fail();const sectors=v.sectorIds.map(id);if(new Set(sectors).size!==sectors.length)fail();
  return {source:validateCollectorBridgeRequestV1(v.source),versions:versions as unknown as DurableAnalysisRequestV1['versions'],sectorIds:sectors.sort()};
}
function known<T>(v:KnownV1<T>):T{if(v.state!=='KNOWN')fail();return v.value;}
function inspect(raw:unknown,r:DurableAnalysisRequestV1):{metadata:DurableAnalysisSourceV1;text:string;fingerprint:string}|null {
  const dto=validateCollectorBridgeReadResultV1(data(raw,8,2048));
  if(dto.disposition!=='READY_SYNTHETIC_ARTIFACT')return null;
  if(dto.store.stableStoreId!==r.source.stableStoreId||dto.store.storeEpoch!==r.source.storeEpoch||dto.identity.deliveryId!==r.source.deliveryId||known(dto.identity.bodyId)!==r.source.expectedBodyId)fail();
  if(dto.readPurpose!=='READ_FOR_BRIDGE'||dto.physicalCommitTimeRightsProven!==false||dto.observation.kind!=='ORIGINAL_ARTICLE'||dto.observation.purpose!=='ORIGINAL_ACCESS'||dto.reasons.length!==0)fail();
  const h=dto.integrity,bytes=encoder.encode(dto.content.text),digest=createHash('sha256').update(bytes).digest('hex');
  if(!dto.content.text.startsWith('SYNTHETIC ')||!dto.content.text.slice(10).trim()||bytes.length>65536||known(h.bodyHashAlg)!=='UTF8_BODY_BYTES_SHA256_V1'||known(h.rawHashAlg)!=='RAW_BYTES_SHA256_V1'||known(h.bodyHash)!==digest||known(h.rawHash)!==digest||digest!==r.source.expectedBodyHash||r.source.expectedBodyHashAlg!=='UTF8_BODY_BYTES_SHA256_V1'||known(h.rawByteLength)!==String(bytes.length)||known(h.decodedByteLength)!==String(bytes.length)||known(h.encoding)!=='identity'||h.integrityAtRead!=='VERIFIED'||h.attachmentIntegrityAtCommit!=='DB_VERIFIED')fail();
  const current=known(dto.grants.current);if(current.state!=='CURRENT')fail();const grant=known(current.grant),body=known(dto.grants.bodySnapshot),delivery=known(dto.grants.deliverySnapshot),at=dto.store.checkedAt;
  for(const k of ['grantId','grantGeneration','grantVersion','sourcePolicyVersion'] as const)if(grant[k]!==body[k]||grant[k]!==delivery[k])fail();
  if(grant.sourcePolicyVersion!==r.source.expectedSourcePolicyVersion||grant.knownAt>at||grant.expiresAt<=at)fail();for(const p of ['ORIGINAL_ACCESS','STORAGE','ANALYSIS'] as const)if(grant.purposes[p]!=='ALLOW'||body.purposes[p]!=='ALLOW')fail();
  if(dto.validity.tombstone!=='ABSENT'||dto.validity.auditRetentionUntil<=at||known(dto.validity.grantKnownAt)>at)fail();for(const k of ['rightsExpiresAt','retentionUntil','effectiveUsableUntil'] as const)if(known(dto.validity[k])<=at)fail();
  const provenance=dto.provenance,st=dto.sourceTime;if(provenance.resolutionState!=='KNOWN'||provenance.verification!=='SYNTHETIC_AUTHORITY_ASSERTED'||st.resolutionState!=='KNOWN'||st.timeQuality!=='KNOWN'||!['SOURCE_ASSERTED','SYNTHETIC_AUTHORITY_ASSERTED'].includes(st.assertionAuthority))fail();
  for(const k of ['publisherId','originId','independenceGroupId','assertionVersion','evidenceRef'] as const)known(provenance[k]);
  for(const k of ['sourceId','endpointId','nativeId'] as const)known(dto.identity[k]);const published=known(st.publishedAt);if(published>at)fail();if(st.updatedAt.state==='KNOWN'){if(st.updatedAt.value<published||st.updatedAt.value>at)fail();}else if(st.updatedAt.reason!=='NOT_RECORDED')fail();
  const {content,...metadata}=dto;
  // checkedAt is the current read's evidence, never part of immutable artifact identity.
  const fingerprint=createHash('sha256').update(JSON.stringify({store:{stableStoreId:dto.store.stableStoreId,storeEpoch:dto.store.storeEpoch},identity:dto.identity,hash:{algorithm:known(h.bodyHashAlg),value:digest,byteLength:String(bytes.length)},grant:{grantId:grant.grantId,generation:grant.grantGeneration,version:grant.grantVersion,sourcePolicyVersion:grant.sourcePolicyVersion},provenance,sourceTime:st,versions:r.versions,sectors:r.sectorIds}),'utf8').digest('hex');
  return {metadata,text:content.text,fingerprint};
}
const hold=(deliveryId:string,reason:'SOURCE_UNAVAILABLE'|'SOURCE_NOT_READY'|'SOURCE_BINDING_CHANGED'):DurableAnalysisPreparationV1=>({...flags,disposition:'HOLD',reason,source:{deliveryId}});
async function obtain(owner:OwnedDurableAnalysisInputPort,r:DurableAnalysisRequestV1,prior?:HandleState,handle?:object):Promise<DurableAnalysisPreparationV1>{
  const state=ports.get(owner);if(!state||!checkCollector(state.collectorPort))return hold(r.source.deliveryId,'SOURCE_UNAVAILABLE');let checked;
  try{checked=inspect(await readCollector(state.collectorPort,data(r.source) as CollectorBridgeReadRequestV1),r);}catch{return hold(r.source.deliveryId,'SOURCE_UNAVAILABLE');}
  if(!checked)return hold(r.source.deliveryId,'SOURCE_NOT_READY');if(prior&&prior.fingerprint!==checked.fingerprint)return hold(r.source.deliveryId,'SOURCE_BINDING_CHANGED');
  const issued=handle??Object.freeze(Object.create(null)) as object;if(!prior)handles.set(issued,{owner,request:request(r),fingerprint:checked.fingerprint});
  const input:DurableAnalysisInputV1={perspective:'KR_LISTED_EQUITIES',source:checked.metadata,versions:data(r.versions) as DurableAnalysisRequestV1['versions'],sectorIds:[...r.sectorIds],content:{kind:'UNTRUSTED_ORIGINAL_TEXT',text:checked.text},checkedAt:checked.metadata.store.checkedAt};
  return {...flags,disposition:'READY_SYNTHETIC_INPUT',handle:issued,checkedAt:input.checkedAt,input};
}
export function isOwnedDurableAnalysisInputPort(raw:unknown):raw is OwnedDurableAnalysisInputPort {
  if(!raw||typeof raw!=='object'||types.isProxy(raw)||!ports.has(raw))return false;const state=ports.get(raw)!;
  return Object.getPrototypeOf(raw)===null&&Object.isFrozen(raw)&&Object.getOwnPropertyDescriptor(raw,'readForAnalysis')?.value===state.prepare&&Object.getOwnPropertyDescriptor(raw,'readOwnedAnalysisInput')?.value===state.reread;
}
export function createDurableAnalysisInputPort(collectorPort:unknown):OwnedDurableAnalysisInputPort {
  if(!checkCollector(collectorPort))fail();const port=Object.create(null) as OwnedDurableAnalysisInputPort;
  const prepare=async function(this:unknown,raw:DurableAnalysisRequestV1){if(this!==port||!isOwnedDurableAnalysisInputPort(port))fail();return obtain(port,request(raw));};
  const reread=async function(this:unknown,raw:unknown){if(this!==port||!isOwnedDurableAnalysisInputPort(port)||!raw||typeof raw!=='object'||types.isProxy(raw)||!handles.has(raw))fail();const prior=handles.get(raw)!;if(prior.owner!==port)fail();return obtain(port,request(prior.request),prior,raw);};
  Object.defineProperties(port,{readForAnalysis:{value:prepare,enumerable:true},readOwnedAnalysisInput:{value:reread,enumerable:true}});ports.set(port,{collectorPort,prepare,reread});return Object.freeze(port);
}
