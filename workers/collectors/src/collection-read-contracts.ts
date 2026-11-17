/** Node-only COLLECTION_READ_P3. Offline assertions, never a real authority or executable transport. */
import {PipelineError,pipelineData,pipelineCanonical,pipelineId,pipelineInstant,type PipelineErrorCode} from '../../../packages/contracts/src/pipeline.ts';
interface Hash {update(value:string|Uint8Array):Hash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(name:'sha256'):Hash;randomUUID():string;}};
const crypto=process.getBuiltinModule('node:crypto');
export const COLLECTION_READ_SCHEMA='COLLECTION_READ_P3' as const;
export const OFFLINE_READ_FLAGS=Object.freeze({schema:COLLECTION_READ_SCHEMA,mode:'OFFLINE_REPLAY' as const,fixtureAssertionOnly:true as const,executionEnabled:false as const});
export const COLLECTION_PURPOSES=['DISCOVERY','LINK_EXTRACTION','ORIGINAL_ACCESS','STORAGE','ANALYSIS'] as const;
export type CollectionPurpose=typeof COLLECTION_PURPOSES[number];
export interface CollectionGrant {
  schema:typeof COLLECTION_READ_SCHEMA;mode:'OFFLINE_REPLAY';fixtureAssertionOnly:true;executionEnabled:false;
  grantId:string;issuer:string;evidenceRef:string;sourceId:string;endpointId:string;profileId:string;profileVersion:string;adapterVersion:string;sourcePolicyVersion:string;generation:number;
  purposes:Record<CollectionPurpose,boolean>;scope:{hosts:string[];paths:string[];methods:['GET'];queryKeys:string[]};knownAt:string;expiresAt:string;retentionMs:number;
  budget:{maxRequests:number;totalRawBytes:number;maxRawBytes:number;maxDecodedBytes:number;maxTextChars:number;maxHeaderBytes:number;maxHeaderCount:number;deadlineMs:number;maxRedirects:number};
}
export interface OfflineFixtureAuthority {current(sourceId:string,endpointId:string,checkedAt:string):unknown;}
export interface CollectionRepresentation {accept:'application/json'|'text/plain'|'text/html';language:string;}
export interface CollectionSourceAssertion {publisherId:string;originId:string|null;independenceGroupId:string|null;publishedAt:string|null;updatedAt:string|null;timeQuality:'KNOWN'|'PENDING_TIME';}
export interface CollectionCacheRef {observationId:string;bodyHash:string;}
export interface PrepareCollectionRead {
  requestId:string;sourceId:string;endpointId:string;expectedGrantGeneration:number;url:string;method:'GET';purpose:'DISCOVERY'|'LINK_EXTRACTION'|'ORIGINAL_ACCESS';
  representation:CollectionRepresentation;dnsAddresses:string[];checkedAt:string;source:CollectionSourceAssertion;parserVersion:string;cacheRef:CollectionCacheRef|null;
}
export interface CollectionReadTicket {
  schema:typeof COLLECTION_READ_SCHEMA;mode:'OFFLINE_REPLAY';fixtureAssertionOnly:true;executionEnabled:false;
  ticketId:string;backendGeneration:string;requestId:string;sourceId:string;endpointId:string;grantGeneration:number;grantDigest:string;url:string;method:'GET';purpose:PrepareCollectionRead['purpose'];
  representation:CollectionRepresentation;dnsAddresses:string[];requestedAt:string;hopStartedAt:string;deadlineAt:string;hop:number;parentTicketId:string|null;cacheRef:CollectionCacheRef|null;
}
export interface CollectionObservationMetadata {
  observationId:string;backendGeneration:string;ticketId:string;requestId:string;sourceId:string;endpointId:string;profileId:string;profileVersion:string;adapterVersion:string;sourcePolicyVersion:string;
  grantGeneration:number;grantDigest:string;purpose:PrepareCollectionRead['purpose'];url:string;representation:CollectionRepresentation;bodyHash:string;rawBytesHash:string;contentType:string;status:200;
  rawByteLength:number;decodedByteLength:number;textLength:number;requestedAt:string;receivedAt:string;acceptedAt:string;retentionUntil:string;
  publisherId:string;originId:string|null;independenceGroupId:string|null;sourcePublishedAt:string|null;sourceUpdatedAt:string|null;timeQuality:'KNOWN'|'PENDING_TIME';parserVersion:string;
}
export interface CollectionAnalysisRead {schema:typeof COLLECTION_READ_SCHEMA;mode:'OFFLINE_REPLAY';fixtureAssertionOnly:true;executionEnabled:false;metadata:CollectionObservationMetadata;text:string;}
export interface CollectionReadLimits {tickets:number;observations:number;privateBytes:number;}
export const DEFAULT_COLLECTION_READ_LIMITS:Readonly<CollectionReadLimits>=Object.freeze({tickets:64,observations:32,privateBytes:1048576});
export interface CollectionHeader {name:string;value:string;}
export interface CollectionResponse {
  ticket:CollectionReadTicket;checkedAt:string;receivedAt:string;status:number;headers:CollectionHeader[];network:{dnsAddresses:string[];peerAddress:string};
  rawBytes:Uint8Array;rawBytesHash:string;decodedBytesHash:string;
}
/** Current-hop response/network observation, followed by separately checked next-hop DNS. */
export interface CollectionRedirect extends CollectionResponse {nextDnsAddresses:string[];forwardedHeaderNames:string[];}
export interface CollectionNotModified extends CollectionResponse {cacheRef:CollectionCacheRef;}
export function collectionReject(code:PipelineErrorCode='INVALID_INPUT'):never {throw new PipelineError(code);}
export const collectionClone=<T>(value:T):T=>pipelineData(value) as T;
export const collectionCanonical=pipelineCanonical;
export const collectionHash=(value:unknown):string=>crypto.createHash('sha256').update(pipelineCanonical(value)).digest('hex');
export const collectionBytesHash=(value:Uint8Array):string=>crypto.createHash('sha256').update(value).digest('hex');
export const collectionBackend=():string=>'offline-'+crypto.randomUUID();
export function collectionRecord(raw:unknown):Record<string,unknown> {const value=pipelineData(raw);if(!value||typeof value!=='object'||Array.isArray(value))collectionReject();return value as Record<string,unknown>;}
export function collectionExact(value:Record<string,unknown>,keys:readonly string[]):void {if(Object.keys(value).length!==keys.length||keys.some(k=>!Object.hasOwn(value,k)))collectionReject();}
export function collectionId(value:unknown):string {if(!pipelineId(value))collectionReject();return value;}
export function collectionText(value:unknown,max=2048):string {if(typeof value!=='string'||!value.trim()||value.length>max)collectionReject();return value;}
export function collectionNumber(value:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {if(typeof value!=='number'||!Number.isSafeInteger(value)||value<min||value>max)collectionReject();return value;}
export function collectionTime(value:unknown):number {const ms=pipelineInstant(value);if(!Number.isFinite(ms))collectionReject();return ms;}
export function collectionStamp(value:unknown):string {return new Date(collectionTime(value)).toISOString();}
export function collectionDigest(value:unknown):string {if(typeof value!=='string'||!/^[a-f0-9]{64}$/.test(value))collectionReject();return value;}
export function collectionIds(raw:unknown,max=32):string[] {if(!Array.isArray(raw)||raw.length>max||!raw.every(pipelineId)||new Set(raw).size!==raw.length)collectionReject();return raw;}
export function collectionStrings(raw:unknown,max=32,length=2048):string[] {if(!Array.isArray(raw)||raw.length>max||!raw.every(v=>typeof v==='string'&&v.length>0&&v.length<=length)||new Set(raw).size!==raw.length)collectionReject();return raw;}
export function collectionNullableId(value:unknown):string|null {return value===null?null:collectionId(value);}
export function validateCollectionFlags(value:Record<string,unknown>):void {if(value.schema!==COLLECTION_READ_SCHEMA||value.mode!=='OFFLINE_REPLAY'||value.fixtureAssertionOnly!==true||value.executionEnabled!==false)collectionReject('LIVE_NOT_ENABLED');}
export function validateCollectionRepresentation(raw:unknown):CollectionRepresentation {
  const value=collectionRecord(raw);collectionExact(value,['accept','language']);if(!['application/json','text/plain','text/html'].includes(value.accept as string)||typeof value.language!=='string'||!/^[a-z]{2,8}(?:-[a-z0-9]{1,8})*$/.test(value.language)||value.language.length>35)collectionReject();return value as unknown as CollectionRepresentation;
}
export function validateCollectionSource(raw:unknown,asOf:string):CollectionSourceAssertion {
  const value=collectionRecord(raw);collectionExact(value,['publisherId','originId','independenceGroupId','publishedAt','updatedAt','timeQuality']);collectionId(value.publisherId);collectionNullableId(value.originId);collectionNullableId(value.independenceGroupId);
  for(const key of ['publishedAt','updatedAt'])if(value[key]!==null){value[key]=collectionStamp(value[key]);if(collectionTime(value[key])>collectionTime(asOf))collectionReject();}
  if(value.timeQuality==='KNOWN'){if(value.publishedAt===null)collectionReject();}else if(value.timeQuality!=='PENDING_TIME'||value.publishedAt!==null)collectionReject();
  if(value.updatedAt!==null&&value.publishedAt!==null&&collectionTime(value.updatedAt)<collectionTime(value.publishedAt))collectionReject();return value as unknown as CollectionSourceAssertion;
}
export function validateCollectionCacheRef(raw:unknown):CollectionCacheRef|null {if(raw===null)return null;const value=collectionRecord(raw);collectionExact(value,['observationId','bodyHash']);return {observationId:collectionId(value.observationId),bodyHash:collectionDigest(value.bodyHash)};}
export function validateCollectionGrant(raw:unknown):CollectionGrant {
  const value=collectionRecord(raw);collectionExact(value,['schema','mode','fixtureAssertionOnly','executionEnabled','grantId','issuer','evidenceRef','sourceId','endpointId','profileId','profileVersion','adapterVersion','sourcePolicyVersion','generation','purposes','scope','knownAt','expiresAt','retentionMs','budget']);validateCollectionFlags(value);
  for(const key of ['grantId','issuer','sourceId','endpointId','profileId','profileVersion','adapterVersion','sourcePolicyVersion'])collectionId(value[key]);collectionText(value.evidenceRef,512);collectionNumber(value.generation,1);
  const purposes=collectionRecord(value.purposes);collectionExact(purposes,COLLECTION_PURPOSES);for(const key of COLLECTION_PURPOSES)if(typeof purposes[key]!=='boolean')collectionReject();
  const scope=collectionRecord(value.scope);collectionExact(scope,['hosts','paths','methods','queryKeys']);const hosts=collectionStrings(scope.hosts,16,253),paths=collectionStrings(scope.paths,32,1024),queryKeys=collectionStrings(scope.queryKeys,32,100);
  if(!hosts.length||!paths.length||hosts.some(h=>h!==h.toLowerCase()||!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(h))||paths.some(p=>!p.startsWith('/')||/[\\%?#]/.test(p))||queryKeys.some(k=>!/^[A-Za-z0-9_-]+$/.test(k))||!Array.isArray(scope.methods)||scope.methods.length!==1||scope.methods[0]!=='GET')collectionReject();
  const knownAt=collectionStamp(value.knownAt),expiresAt=collectionStamp(value.expiresAt);if(collectionTime(expiresAt)<=collectionTime(knownAt))collectionReject();collectionNumber(value.retentionMs,1,30*86400000);
  const budget=collectionRecord(value.budget);collectionExact(budget,['maxRequests','totalRawBytes','maxRawBytes','maxDecodedBytes','maxTextChars','maxHeaderBytes','maxHeaderCount','deadlineMs','maxRedirects']);
  collectionNumber(budget.maxRequests,1,1000);collectionNumber(budget.totalRawBytes,1,1048576);collectionNumber(budget.maxRawBytes,1,262144);collectionNumber(budget.maxDecodedBytes,1,262144);collectionNumber(budget.maxTextChars,1,65536);collectionNumber(budget.maxHeaderBytes,1,8192);collectionNumber(budget.maxHeaderCount,1,32);collectionNumber(budget.deadlineMs,1,30000);collectionNumber(budget.maxRedirects,0,2);
  if(Number(budget.totalRawBytes)<Number(budget.maxRawBytes))collectionReject();return {...value,purposes,scope:{hosts,paths,methods:['GET'],queryKeys},knownAt,expiresAt,budget} as unknown as CollectionGrant;
}
export function validatePrepareCollectionRead(raw:unknown):PrepareCollectionRead {
  const value=collectionRecord(raw);collectionExact(value,['requestId','sourceId','endpointId','expectedGrantGeneration','url','method','purpose','representation','dnsAddresses','checkedAt','source','parserVersion','cacheRef']);
  for(const key of ['requestId','sourceId','endpointId','parserVersion'])collectionId(value[key]);collectionText(value.url);collectionNumber(value.expectedGrantGeneration,1);if(value.method!=='GET'||!['DISCOVERY','LINK_EXTRACTION','ORIGINAL_ACCESS'].includes(value.purpose as string))collectionReject();
  const checkedAt=collectionStamp(value.checkedAt);return {...value,checkedAt,representation:validateCollectionRepresentation(value.representation),dnsAddresses:collectionStrings(value.dnsAddresses,16,64),source:validateCollectionSource(value.source,checkedAt),cacheRef:validateCollectionCacheRef(value.cacheRef)} as unknown as PrepareCollectionRead;
}
export function validateCollectionReadLimits(raw:unknown):CollectionReadLimits {const value=collectionRecord(raw);collectionExact(value,Object.keys(DEFAULT_COLLECTION_READ_LIMITS));for(const key of Object.keys(DEFAULT_COLLECTION_READ_LIMITS) as Array<keyof CollectionReadLimits>)collectionNumber(value[key],1,DEFAULT_COLLECTION_READ_LIMITS[key]);return value as unknown as CollectionReadLimits;}

const metadataFields=['observationId','backendGeneration','ticketId','requestId','sourceId','endpointId','profileId','profileVersion','adapterVersion','sourcePolicyVersion','grantGeneration','grantDigest','purpose','url','representation','bodyHash','rawBytesHash','contentType','status','rawByteLength','decodedByteLength','textLength','requestedAt','receivedAt','acceptedAt','retentionUntil','publisherId','originId','independenceGroupId','sourcePublishedAt','sourceUpdatedAt','timeQuality','parserVersion'];
export function validateCollectionMetadata(raw:unknown):CollectionObservationMetadata {
  const value=collectionRecord(raw);collectionExact(value,metadataFields);for(const key of ['observationId','backendGeneration','ticketId','requestId','sourceId','endpointId','profileId','profileVersion','adapterVersion','sourcePolicyVersion','publisherId','parserVersion'])collectionId(value[key]);
  collectionNullableId(value.originId);collectionNullableId(value.independenceGroupId);collectionNumber(value.grantGeneration,1);collectionText(value.url);collectionText(value.contentType,100);collectionDigest(value.grantDigest);collectionDigest(value.bodyHash);collectionDigest(value.rawBytesHash);if(value.status!==200||!['DISCOVERY','LINK_EXTRACTION','ORIGINAL_ACCESS'].includes(value.purpose as string))collectionReject();
  collectionNumber(value.rawByteLength,0,262144);collectionNumber(value.decodedByteLength,0,262144);collectionNumber(value.textLength,0,65536);for(const key of ['requestedAt','receivedAt','acceptedAt','retentionUntil'])value[key]=collectionStamp(value[key]);
  if(collectionTime(value.receivedAt)<collectionTime(value.requestedAt)||collectionTime(value.acceptedAt)<collectionTime(value.receivedAt)||collectionTime(value.retentionUntil)<=collectionTime(value.acceptedAt))collectionReject();
  const source=validateCollectionSource({publisherId:value.publisherId,originId:value.originId,independenceGroupId:value.independenceGroupId,publishedAt:value.sourcePublishedAt,updatedAt:value.sourceUpdatedAt,timeQuality:value.timeQuality},value.receivedAt as string);
  return {...value,representation:validateCollectionRepresentation(value.representation),sourcePublishedAt:source.publishedAt,sourceUpdatedAt:source.updatedAt} as unknown as CollectionObservationMetadata;
}
export function validateCollectionAnalysisRead(raw:unknown):CollectionAnalysisRead {
  const value=collectionRecord(raw);collectionExact(value,['schema','mode','fixtureAssertionOnly','executionEnabled','metadata','text']);validateCollectionFlags(value);const metadata=validateCollectionMetadata(value.metadata);
  if(typeof value.text!=='string'||value.text.length!==metadata.textLength||value.text.length>65536||new TextEncoder().encode(value.text).length!==metadata.decodedByteLength||collectionBytesHash(new TextEncoder().encode(value.text))!==metadata.bodyHash)collectionReject('EFFECT_CONFLICT');return {...value,metadata} as unknown as CollectionAnalysisRead;
}

/** Binary input is copied separately; existing JSON limits still apply to every nonbinary DTO. */
export function collectionResponseRecord(raw:unknown,kind:'NORMAL'|'NOT_MODIFIED'|'REDIRECT'='NORMAL'):{value:Record<string,unknown>;bytes:Uint8Array} {
  if(!raw||typeof raw!=='object'||Array.isArray(raw)||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))collectionReject();
  const keys=Reflect.ownKeys(raw),expected=['ticket','checkedAt','receivedAt','status','headers','network','rawBytes','rawBytesHash','decodedBytesHash',...(kind==='NOT_MODIFIED'?['cacheRef']:kind==='REDIRECT'?['nextDnsAddresses','forwardedHeaderNames']:[])];
  if(keys.length!==expected.length||keys.some(k=>typeof k!=='string'||!expected.includes(k)))collectionReject();const plain:Record<string,unknown>={};let bytes:Uint8Array|null=null;
  for(const key of expected){const descriptor=Object.getOwnPropertyDescriptor(raw,key);if(!descriptor||!descriptor.enumerable||!('value'in descriptor))collectionReject();
    if(key==='rawBytes'){
      const input=descriptor.value;if(!ArrayBuffer.isView(input)||Object.getPrototypeOf(input)!==Uint8Array.prototype)collectionReject();
      const typed=Object.getPrototypeOf(Uint8Array.prototype),length=Object.getOwnPropertyDescriptor(typed,'byteLength')!.get!.call(input) as number;
      if(length>262144||Reflect.ownKeys(input).length!==length)collectionReject('RATE_LIMITED');
      const buffer=Object.getOwnPropertyDescriptor(typed,'buffer')!.get!.call(input);if(typeof SharedArrayBuffer!=='undefined'&&buffer instanceof SharedArrayBuffer)collectionReject();
      try{bytes=Uint8Array.prototype.slice.call(input) as Uint8Array;}catch{collectionReject();}
    }else Object.defineProperty(plain,key,{value:descriptor.value,enumerable:true,writable:true,configurable:true});
  }
  if(bytes===null)collectionReject();return {value:collectionRecord(plain),bytes};
}
