/** NODE-ONLY SYNTHETIC_K1_METADATA_INTAKE_A1. Proposal validation, not factual AI classification. */
import {PipelineError,pipelineCanonical,pipelineId,pipelineInstant,validatePipelineVersions,validateSourceRevision,type PipelineVersions,type PipelineSourceRevision} from '../../../packages/contracts/src/pipeline.ts';
import {k1Record,k1Exact,selectPipelineSources} from '../../../packages/contracts/src/pipeline-semantics.ts';
interface FixtureHash {update(value:string):FixtureHash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(algorithm:'sha256'):FixtureHash}};
const {createHash}=process.getBuiltinModule('node:crypto');
export const METADATA_SCHEMA='SYNTHETIC_K1_METADATA_INTAKE_A1' as const;
const DAY=24*60*60*1000;
type Wake='SOURCE_REVISION'|'POLICY_OR_PERMISSION'|'METADATA_REVIEW';
type Reason='CURRENT_SOURCE_REQUIRED'|'SOURCE_TIME_REQUIRED'|'SOURCE_CONFLICT'|'ANALYSIS_NOT_ELIGIBLE'|'MALFORMED_PROPOSAL'|'REQUEST_MISMATCH'|'UNCLEAR_OR_MIXED'|'METADATA_EXCLUSION_ONLY'|'KOREAN_IMPACT_NEEDS_EVIDENCE';
export interface MetadataResult {
  schema:typeof METADATA_SCHEMA;sampleKind:'SYNTHETIC';evaluatedAt:string;revisionId:string;requestDigest:string|null;
  disposition:'PASS'|'HOLD'|'REQUEST_EVIDENCE';reason:Reason;deadlineAt:string|null;wakeOn:Wake[];
}
interface Eligibility {revisionId:string;permissionVersion:string;sourcePolicyVersion:string;analysisAllowed:boolean;expiresAt:string;}
export interface MetadataContext {
  versions:PipelineVersions;revisions:PipelineSourceRevision[];revisionId:string;asOf:string;sectorIds:string[];
  eligibility:Eligibility;promptVersion:string;generatorVersion:string;
}
export interface MetadataRequest {
  schema:typeof METADATA_SCHEMA;versions:PipelineVersions;asOf:string;
  source:{sourceDocumentId:string;revisionId:string;contentHash:string;title:string;lead:string;};
  sectorIds:string[];eligibility:Eligibility;promptVersion:string;generatorVersion:string;
}
export type PreparedMetadata={state:'READY_FOR_METADATA_MODEL';request:MetadataRequest;requestDigest:string}|{state:'HOLD';result:MetadataResult};
interface Span {field:'title'|'lead';start:number;end:number;quote:string;}
export interface MetadataProposal {
  requestDigest:string;classification:'RELEVANT_EVENT'|'PURE_PROMOTION'|'PRICE_RECAP_ONLY'|'UNRELATED'|'UNCLEAR';
  newCatalyst:'YES'|'NO'|'UNKNOWN';koreanImpact:'MARKET_WIDE'|'SECTOR'|'NONE'|'UNCLEAR';
  sectorIds:string[];confidence:'CLEAR'|'UNCLEAR';reasonSpans:Span[];
}
const invalid=():never=>{throw new PipelineError('INVALID_INPUT');};
function at(v:unknown):number {const ms=pipelineInstant(v);if(!Number.isFinite(ms))invalid();return ms;}
function ids(raw:unknown,min=0,max=100):string[]{if(!Array.isArray(raw)||raw.length<min||raw.length>max||!raw.every(pipelineId)||new Set(raw).size!==raw.length)invalid();return raw as string[];}
function context(raw:unknown):MetadataContext {
  const x=k1Record(raw);k1Exact(x,['versions','revisions','revisionId','asOf','sectorIds','eligibility','promptVersion','generatorVersion']);
  const versions=validatePipelineVersions(x.versions);
  if(!pipelineId(x.revisionId)||!pipelineId(x.promptVersion)||!pipelineId(x.generatorVersion)||!Array.isArray(x.revisions)||x.revisions.length>300)invalid();
  // Reject dates whose HOLD deadline could not be represented by the same strict UTC contract.
  at(new Date(at(x.asOf)+DAY).toISOString());
  const e=k1Record(x.eligibility);k1Exact(e,['revisionId','permissionVersion','sourcePolicyVersion','analysisAllowed','expiresAt']);
  if(![e.revisionId,e.permissionVersion,e.sourcePolicyVersion].every(pipelineId)||typeof e.analysisAllowed!=='boolean')invalid();at(e.expiresAt);
  return {versions,revisions:(x.revisions as unknown[]).map(validateSourceRevision),revisionId:x.revisionId as string,asOf:x.asOf as string,sectorIds:ids(x.sectorIds,1),eligibility:e as unknown as Eligibility,promptVersion:x.promptVersion as string,generatorVersion:x.generatorVersion as string};
}
function result(c:MetadataContext,digest:string|null,disposition:MetadataResult['disposition'],reason:Reason,wakeOn:Wake[]=[]):MetadataResult {
  return {schema:METADATA_SCHEMA,sampleKind:'SYNTHETIC',evaluatedAt:c.asOf,revisionId:c.revisionId,requestDigest:digest,disposition,reason,deadlineAt:disposition==='HOLD'?new Date(at(c.asOf)+DAY).toISOString():null,wakeOn};
}
function prepare(c:MetadataContext):PreparedMetadata {
  const selected=selectPipelineSources(c.revisions,c.versions,c.asOf),source=c.revisions.find(r=>r.revisionId===c.revisionId);
  const hold=(reason:Reason,wake:Wake):PreparedMetadata=>({state:'HOLD',result:result(c,null,'HOLD',reason,[wake])});
  if(!source)return hold('CURRENT_SOURCE_REQUIRED','SOURCE_REVISION');
  const pick=selected.find(s=>s.sourceDocumentId===source.sourceDocumentId);
  if(pick?.status==='PENDING_TIME'||source.timeQuality!=='KNOWN')return hold('SOURCE_TIME_REQUIRED','SOURCE_REVISION');
  if(pick?.status==='CONFLICT_SAME_TIME')return hold('SOURCE_CONFLICT','SOURCE_REVISION');
  if(pick?.revision?.revisionId!==source.revisionId||at(source.collectedAt)>at(c.asOf))return hold('CURRENT_SOURCE_REQUIRED','SOURCE_REVISION');
  const e=c.eligibility;
  if(!e.analysisAllowed||e.revisionId!==source.revisionId||e.permissionVersion!==source.permissionVersion||e.sourcePolicyVersion!==c.versions.sourcePolicyVersion||at(e.expiresAt)<=at(c.asOf))return hold('ANALYSIS_NOT_ELIGIBLE','POLICY_OR_PERMISSION');
  const request:MetadataRequest={schema:METADATA_SCHEMA,versions:c.versions,asOf:c.asOf,source:{sourceDocumentId:source.sourceDocumentId,revisionId:source.revisionId,contentHash:source.contentHash,title:source.title,lead:source.lead},sectorIds:c.sectorIds,eligibility:e,promptVersion:c.promptVersion,generatorVersion:c.generatorVersion};
  const requestDigest=createHash('sha256').update(pipelineCanonical(request)).digest('hex');
  return {state:'READY_FOR_METADATA_MODEL',request,requestDigest};
}
/** Pure preparation. No provider/body access, repository write or effect is invoked. */
export function prepareMetadataRequest(rawContext:unknown):PreparedMetadata {return prepare(context(rawContext));}
function splitPair(text:string,index:number):boolean {
  if(index<=0||index>=text.length)return false;
  const a=text.charCodeAt(index-1),b=text.charCodeAt(index);return a>=0xd800&&a<=0xdbff&&b>=0xdc00&&b<=0xdfff;
}
function proposal(raw:unknown,request:MetadataRequest):MetadataProposal {
  const p=k1Record(raw);k1Exact(p,['requestDigest','classification','newCatalyst','koreanImpact','sectorIds','confidence','reasonSpans']);
  if(typeof p.requestDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.requestDigest)||!['RELEVANT_EVENT','PURE_PROMOTION','PRICE_RECAP_ONLY','UNRELATED','UNCLEAR'].includes(p.classification as string)||!['YES','NO','UNKNOWN'].includes(p.newCatalyst as string)||!['MARKET_WIDE','SECTOR','NONE','UNCLEAR'].includes(p.koreanImpact as string)||!['CLEAR','UNCLEAR'].includes(p.confidence as string))invalid();
  const sectors=ids(p.sectorIds);if(!sectors.every(s=>request.sectorIds.includes(s)))invalid();
  if(!Array.isArray(p.reasonSpans)||p.reasonSpans.length<1||p.reasonSpans.length>8)invalid();
  const seen=new Set<string>();
  for(const rawSpan of p.reasonSpans as unknown[]){
    const s=k1Record(rawSpan);k1Exact(s,['field','start','end','quote']);
    if(s.field!=='title'&&s.field!=='lead')invalid();
    const text=request.source[s.field as 'title'|'lead'];
    if(!Number.isSafeInteger(s.start)||!Number.isSafeInteger(s.end)||Number(s.start)<0||Number(s.start)>=Number(s.end)||Number(s.end)>text.length||typeof s.quote!=='string'||!s.quote.trim()||s.quote.length>500||s.quote!==text.slice(s.start as number,s.end as number)||splitPair(text,s.start as number)||splitPair(text,s.end as number))invalid();
    const key=pipelineCanonical([s.field,s.start,s.end]);if(seen.has(key))invalid();seen.add(key);
  }
  return p as unknown as MetadataProposal;
}
/** Rechecks the supplied asOf snapshot. Actual asynchronous policy/CAS freshness belongs to a future orchestrator. */
export function acceptMetadataProposal(rawContext:unknown,rawProposal:unknown):MetadataResult {
  const c=context(rawContext),ready=prepare(c);if(ready.state==='HOLD')return ready.result;
  const hold=(reason:Reason)=>result(c,ready.requestDigest,'HOLD',reason,['METADATA_REVIEW']);
  let p:MetadataProposal;
  // The untrusted boundary includes hostile Proxy traps as well as ordinary malformed JSON.
  try{p=proposal(rawProposal,ready.request);}catch{return hold('MALFORMED_PROPOSAL');}
  if(p.requestDigest!==ready.requestDigest)return hold('REQUEST_MISMATCH');
  if(p.confidence==='CLEAR'&&['PURE_PROMOTION','PRICE_RECAP_ONLY','UNRELATED'].includes(p.classification)&&p.newCatalyst==='NO'&&p.koreanImpact==='NONE'&&p.sectorIds.length===0)return result(c,ready.requestDigest,'PASS','METADATA_EXCLUSION_ONLY');
  if(p.confidence==='CLEAR'&&p.classification==='RELEVANT_EVENT'&&p.newCatalyst==='YES'&&(p.koreanImpact==='MARKET_WIDE'||p.koreanImpact==='SECTOR'&&p.sectorIds.length>0))return result(c,ready.requestDigest,'REQUEST_EVIDENCE','KOREAN_IMPACT_NEEDS_EVIDENCE');
  return hold('UNCLEAR_OR_MIXED');
}
