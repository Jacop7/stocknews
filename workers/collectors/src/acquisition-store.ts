/** NODE-ONLY SYNTHETIC_ACQUISITION_A1. Immutable fixture body sidecars; no acquisition IO or real rights service. */
import {PipelineError,pipelineData,pipelineCanonical,pipelineId,pipelineInstant,validatePipelineVersions,validateSourceRevision,assertPipelineVersions,type PipelineVersions,type PipelineSourceRevision} from '../../../packages/contracts/src/pipeline.ts';
import {k1Record,k1Exact} from '../../../packages/contracts/src/pipeline-semantics.ts';
import {SyntheticSourceReceiptSink} from './source-receipts.ts';
interface Hash {update(value:string):Hash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(name:'sha256'):Hash;randomUUID():string;}};
const crypto=process.getBuiltinModule('node:crypto');
export const ACQUISITION_SCHEMA='SYNTHETIC_ACQUISITION_A1' as const;
const clone=<T>(v:T):T=>pipelineData(v) as T,sha=(v:unknown)=>crypto.createHash('sha256').update(pipelineCanonical(v)).digest('hex');
const reject=(code:'INVALID_INPUT'|'POLICY_STALE'|'RIGHTS_HOLD'|'VERSION_CONFLICT'|'EFFECT_CONFLICT'|'RATE_LIMITED'='INVALID_INPUT'):never=>{throw new PipelineError(code);};
function at(raw:unknown):number {const n=pipelineInstant(raw);if(!Number.isFinite(n))reject();return n;}
const stamp=(raw:unknown)=>new Date(at(raw)).toISOString();
const id=(raw:unknown):string=>{if(!pipelineId(raw))reject();return raw as string;};
export interface AcquisitionPermission {sourceId:string;generation:number;permissionVersion:string;sourcePolicyVersion:string;allowAcquire:boolean;allowAnalyze:boolean;knownAt:string;expiresAt:string;}
export interface AcquisitionTicket {schema:typeof ACQUISITION_SCHEMA;sampleKind:'SYNTHETIC';storeGeneration:string;effectKey:string;revisionId:string;sourceId:string;sourceDigest:string;stage:'BODY';requestedAt:string;permission:AcquisitionPermission;ticketDigest:string;}
export interface AcquisitionSidecar {schema:typeof ACQUISITION_SCHEMA;sampleKind:'SYNTHETIC';acquisitionId:string;effectKey:string;revisionId:string;sourceId:string;sourceDigest:string;stage:'BODY';requestedAt:string;acquiredAt:string;acceptedAt:string;permission:AcquisitionPermission;bodyHash:string;bodyRef:string;}
type Receipt={schema:typeof ACQUISITION_SCHEMA;sampleKind:'SYNTHETIC';status:'APPLIED'|'REUSED';sidecar:AcquisitionSidecar;};
export type AcquisitionSelection={state:'READY';sidecar:AcquisitionSidecar}|{state:'HOLD_NO_ACQUISITION'|'HOLD_BODY_CONFLICT';sidecar:null;};
function permission(raw:unknown):AcquisitionPermission {
  const p=k1Record(raw);k1Exact(p,['sourceId','generation','permissionVersion','sourcePolicyVersion','allowAcquire','allowAnalyze','knownAt','expiresAt']);
  if(![p.sourceId,p.permissionVersion,p.sourcePolicyVersion].every(pipelineId)||!Number.isSafeInteger(p.generation)||Number(p.generation)<1||typeof p.allowAcquire!=='boolean'||typeof p.allowAnalyze!=='boolean'||at(p.expiresAt)<=at(p.knownAt))reject();
  return {...p,knownAt:stamp(p.knownAt),expiresAt:stamp(p.expiresAt)} as unknown as AcquisitionPermission;
}
export class SyntheticAcquisitionStore {
  #versions:PipelineVersions;#source: SyntheticSourceReceiptSink;#capacity:number;#generation='fixture-'+crypto.randomUUID();#watermark=-Infinity;
  #permissions=new Map<string,AcquisitionPermission>();#tickets=new Map<string,AcquisitionTicket>();#effects=new Map<string,{canonical:string;sidecar:AcquisitionSidecar}>();#sidecars=new Map<string,AcquisitionSidecar>();#bodies=new Map<string,string>();
  constructor(versions:unknown,sourceSink:SyntheticSourceReceiptSink,capacity=300){
    this.#versions=validatePipelineVersions(versions);if(!(sourceSink instanceof SyntheticSourceReceiptSink)||!Number.isSafeInteger(capacity)||capacity<1||capacity>300)reject();this.#source=sourceSink;this.#capacity=capacity;
  }
  #observe(asOf:unknown):number {const now=at(asOf);if(now<this.#watermark)reject('POLICY_STALE');this.#watermark=now;return now;}
  #revision(revisionId:string,now:number):PipelineSourceRevision {
    const raw=this.#source.readSource(revisionId);if(!raw)reject();const r=validateSourceRevision(raw);assertPipelineVersions(r,this.#versions);if(at(r.collectedAt)>now)reject('RIGHTS_HOLD');return r;
  }
  #eligible(r:PipelineSourceRevision,now:number,analyze=false):AcquisitionPermission {
    const p=this.#permissions.get(r.sourceId);
    if(!p||p.permissionVersion!==r.permissionVersion||p.sourcePolicyVersion!==this.#versions.sourcePolicyVersion||at(p.knownAt)>now||at(p.expiresAt)<=now||!p.allowAcquire||analyze&&!p.allowAnalyze)reject('RIGHTS_HOLD');return p!;
  }
  setPermission(raw:unknown,expectedGeneration:number,asOf:unknown):AcquisitionPermission {
    const p=permission(raw);if(!Number.isSafeInteger(expectedGeneration)||expectedGeneration<0||p.sourcePolicyVersion!==this.#versions.sourcePolicyVersion)reject();
    const now=this.#observe(asOf),old=this.#permissions.get(p.sourceId);
    if(at(p.knownAt)>now)reject();if((old?.generation??0)!==expectedGeneration||p.generation!==expectedGeneration+1||old&&at(p.knownAt)<at(old.knownAt))reject('VERSION_CONFLICT');
    if(!old&&this.#permissions.size>=this.#capacity)reject('RATE_LIMITED');this.#permissions.set(p.sourceId,clone(p));return clone(p);
  }
  begin(revisionId:string,effectKey:string,asOf:unknown):AcquisitionTicket {
    id(revisionId);id(effectKey);const now=this.#observe(asOf),r=this.#revision(revisionId,now),p=this.#eligible(r,now);
    const base={schema:ACQUISITION_SCHEMA,sampleKind:'SYNTHETIC' as const,storeGeneration:this.#generation,effectKey,revisionId,sourceId:r.sourceId,sourceDigest:sha(r),stage:'BODY' as const,requestedAt:new Date(now).toISOString(),permission:clone(p)};
    const ticket:AcquisitionTicket={...base,ticketDigest:sha(base)},old=this.#tickets.get(effectKey);
    if(old){if(pipelineCanonical(old)!==pipelineCanonical(ticket))reject('EFFECT_CONFLICT');return clone(old);}
    if(this.#tickets.size>=this.#capacity)reject('RATE_LIMITED');this.#tickets.set(effectKey,clone(ticket));return clone(ticket);
  }
  #ticket(raw:unknown):AcquisitionTicket {
    const t=k1Record(raw);k1Exact(t,['schema','sampleKind','storeGeneration','effectKey','revisionId','sourceId','sourceDigest','stage','requestedAt','permission','ticketDigest']);
    const key=id(t.effectKey),stored=this.#tickets.get(key);if(!stored||t.storeGeneration!==this.#generation||pipelineCanonical(t)!==pipelineCanonical(stored))reject('EFFECT_CONFLICT');return clone(stored!);
  }
  accept(rawTicket:unknown,rawBody:unknown,asOf:unknown):Receipt {
    const t=this.#ticket(rawTicket),b=k1Record(rawBody);k1Exact(b,['text','acquiredAt']);
    if(typeof b.text!=='string'||!b.text.startsWith('SYNTHETIC ')||!b.text.slice(10).trim()||b.text.length>16000)reject();const text=b.text as string,acquiredAt=stamp(b.acquiredAt);
    const now=this.#observe(asOf),r=this.#revision(t.revisionId,now),p=this.#eligible(r,now);
    if(sha(r)!==t.sourceDigest||pipelineCanonical(p)!==pipelineCanonical(t.permission)||at(acquiredAt)<at(t.requestedAt)||at(acquiredAt)>now)reject('RIGHTS_HOLD');
    const canonical=pipelineCanonical({ticket:t,body:{text,acquiredAt}}),old=this.#effects.get(t.effectKey);
    if(old){if(old.canonical!==canonical)reject('EFFECT_CONFLICT');return {schema:ACQUISITION_SCHEMA,sampleKind:'SYNTHETIC',status:'REUSED',sidecar:clone(old.sidecar)};}
    if(this.#sidecars.size>=this.#capacity)reject('RATE_LIMITED');
    const bodyHash=sha(text),priorBody=this.#bodies.get(bodyHash);if(priorBody!==undefined&&priorBody!==text)reject('EFFECT_CONFLICT');
    const sidecar:AcquisitionSidecar={schema:ACQUISITION_SCHEMA,sampleKind:'SYNTHETIC',acquisitionId:'acq-'+sha({ticket:t,body:{text,acquiredAt}}),effectKey:t.effectKey,revisionId:t.revisionId,sourceId:t.sourceId,sourceDigest:t.sourceDigest,stage:'BODY',requestedAt:t.requestedAt,acquiredAt,acceptedAt:new Date(now).toISOString(),permission:clone(t.permission),bodyHash,bodyRef:'fixture:/acquisition/'+bodyHash};
    const detached=clone(sidecar);this.#bodies.set(bodyHash,text);this.#sidecars.set(sidecar.acquisitionId,sidecar);this.#effects.set(t.effectKey,{canonical,sidecar});return {schema:ACQUISITION_SCHEMA,sampleKind:'SYNTHETIC',status:'APPLIED',sidecar:detached};
  }
  #selection(r:PipelineSourceRevision,now:number):AcquisitionSelection {
    const p=this.#eligible(r,now,true),digest=sha(r),candidates=[...this.#sidecars.values()].filter(s=>s.revisionId===r.revisionId&&s.sourceDigest===digest&&pipelineCanonical(s.permission)===pipelineCanonical(p));
    if(!candidates.length)return {state:'HOLD_NO_ACQUISITION',sidecar:null};if(new Set(candidates.map(s=>s.bodyHash)).size!==1)return {state:'HOLD_BODY_CONFLICT',sidecar:null};
    candidates.sort((a,b)=>at(a.acquiredAt)-at(b.acquiredAt)||(a.acquisitionId<b.acquisitionId?-1:a.acquisitionId>b.acquisitionId?1:0));return {state:'READY',sidecar:clone(candidates[0])};
  }
  select(revisionId:string,asOf:unknown):AcquisitionSelection {id(revisionId);const now=this.#observe(asOf);return this.#selection(this.#revision(revisionId,now),now);}
  readBody(acquisitionId:string,asOf:unknown):string {
    id(acquisitionId);const now=this.#observe(asOf),s=this.#sidecars.get(acquisitionId);if(!s)reject();const r=this.#revision(s!.revisionId,now),p=this.#eligible(r,now,true);
    if(sha(r)!==s!.sourceDigest||pipelineCanonical(p)!==pipelineCanonical(s!.permission))reject('RIGHTS_HOLD');const selected=this.#selection(r,now);
    if(selected.state!=='READY'||selected.sidecar!.acquisitionId!==acquisitionId)reject('RIGHTS_HOLD');const text=this.#bodies.get(s!.bodyHash);if(text===undefined)reject();return text!;
  }
  diagnostics(){return {sampleKind:'SYNTHETIC',persistence:'MEMORY_FIXTURE_ONLY',permissions:this.#permissions.size,tickets:this.#tickets.size,sidecars:this.#sidecars.size,bodies:this.#bodies.size,watermark:Number.isFinite(this.#watermark)?new Date(this.#watermark).toISOString():null,networkCalls:0,databaseWrites:0,purgeImplemented:false};}
}
