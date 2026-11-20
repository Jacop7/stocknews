/** K1 development contract. Pure data only; this module cannot activate real supply. */
export const PIPELINE_CONTRACT='JUDOJU_PIPELINE_K1' as const;
export type PipelineErrorCode='INVALID_INPUT'|'VERSION_CONFLICT'|'EFFECT_CONFLICT'|'EFFECT_UNKNOWN'|'POLICY_STALE'|'RIGHTS_HOLD'|'RETRYABLE_READ_FAILURE'|'RATE_LIMITED'|'LIVE_NOT_ENABLED';
export class PipelineError extends Error {
  readonly code:PipelineErrorCode;
  constructor(code:PipelineErrorCode){super(code);this.name='PipelineError';this.code=code;}
}
export interface PipelineVersions {contractVersion:typeof PIPELINE_CONTRACT;sampleKind:'SYNTHETIC';policyVersion:string;catalogVersion:string;sourcePolicyVersion:string;}
export interface PipelineSourceRevision extends PipelineVersions {
  sourceDocumentId:string;revisionId:string;sourceId:string;endpointId:string;publisherId:string;
  originId:string|null;independenceGroupId:string|null;canonicalUrl:string;nativeId:string;
  collectedAt:string;publishedAt:string|null;updatedAt:string|null;timeQuality:'KNOWN'|'PENDING_TIME';
  contentHash:string;title:string;lead:string;bodyRef:string|null;permissionVersion:string;
}
export interface PipelineEvidence {claimId:string;revisionId:string;originId:string|null;groupId:string|null;official:boolean;verified:boolean;}
export interface PipelineDecision extends PipelineVersions {
  decisionId:string;inputRevisionIds:string[];storyCandidateKey:string;issueCandidateKey:string|null;
  decision:'COLLECT'|'PASS'|'HOLD'|'EXPIRED_HOLD';action:'NO_CHANGE'|'UPDATE'|'NEW_ANGLE'|'CORRECTION';
  reason:string;wakeCondition:string|null;deadline:string|null;knownAt:string;
  evidence:PipelineEvidence[];generatorVersion:string;promptVersion:string;evidenceVersion:string;
}
export interface PipelineDraft extends PipelineVersions {
  issueId:string;storyId:string;decisionId:string;expectedArticleVersion:number;title:string;summary:string;
  bodyRef:string;visibleSections:string[];evidenceVersion:string;firstPublishedAt:string|null;materialChangeAt:string|null;
}
export interface PipelineHighCarry {
  completedSnapshotId:string;completionDigest:string;cutoff:string;policyVersion:string;catalogVersion:string;
  evaluationSetVersion:string;nonpriceScaleVersion:string;highSignature:string;
  order:string[];rows:Array<{issueId:string;storyId:string;pool:'A'|'B'|'C';tier:'HIGH';materialChangeAt:string;score:number;M:null;}>;
}
export interface PipelineSnapshotDraft extends PipelineVersions {
  snapshotKey:string;streamId:string;expectedRevision:number;cutoff:string;marketBasis:'KR_COMBINED'|'FOREIGN_US';
  targetKrTradingDay:string;calendarVersion:string;comparisonSetVersion:string;evaluationSetVersion:string;
  nonpriceScaleVersion:string;highSignature:string;issueIds:string[];highCarry:PipelineHighCarry|null;
  payloadDigest:string;
}
export interface PipelineWrite<T> {effectKey:string;payloadHash:string;versions:PipelineVersions;value:T;}
export type PipelineReceipt<T>={sampleKind:'SYNTHETIC';persistence:'MEMORY_FIXTURE_ONLY';effectKey:string;status:'APPLIED'|'REUSED';value:T;};
function invalid():never {throw new PipelineError('INVALID_INPUT');}
const str=(v:unknown,max=160):v is string=>typeof v==='string'&&v.length>0&&v.length<=max&&v.trim()===v;
export function pipelineId(v:unknown):v is string {return typeof v==='string'&&/^[a-zA-Z0-9_.:-]{1,160}$/.test(v);}
const hash=(v:unknown):v is string=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export function pipelineInstant(v:unknown):number {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v))return NaN;
  const ms=Date.parse(v);return Number.isFinite(ms)&&new Date(ms).toISOString()===v.replace(/Z$/,v.includes('.')?'Z':'.000Z')?ms:NaN;
}
/** No getters, prototype data, holes, cycles, nonfinite values or unbounded JSON. */
export function pipelineData(raw:unknown):unknown {
  let budget=10000;const parents=new Set<object>();
  const copy=(v:unknown,depth:number):unknown=>{
    if(--budget<0||depth>12)invalid();
    if(v===null||typeof v==='boolean')return v;
    if(typeof v==='string'){if(v.length>65536)invalid();return v;}
    if(typeof v==='number'){if(!Number.isFinite(v))invalid();return v;}
    if(typeof v!=='object'||!v||parents.has(v))invalid();
    const array=Array.isArray(v),proto=Object.getPrototypeOf(v),keys=Reflect.ownKeys(v);
    if(array?(proto!==Array.prototype||v.length>1000||keys.length!==v.length+1):(proto!==Object.prototype&&proto!==null))invalid();
    parents.add(v);let out:unknown;
    if(array){const a:unknown[]=[];for(let n=0;n<v.length;n++){const d=Object.getOwnPropertyDescriptor(v,String(n));if(!d||!('value'in d)||!d.enumerable)invalid();a.push(copy(d.value,depth+1));}out=a;}
    else {const o:Record<string,unknown>={};for(const k of keys){const d=Object.getOwnPropertyDescriptor(v,k)!;if(typeof k!=='string'||!d.enumerable||!('value'in d))invalid();Object.defineProperty(o,k,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}out=o;}
    parents.delete(v);return out;
  };
  const value=copy(raw,0);if(JSON.stringify(value).length>262144)invalid();return value;
}
export function pipelineCanonical(raw:unknown):string {
  const data=pipelineData(raw);
  const sort=(v:unknown):unknown=>Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort((v as Record<string,unknown>)[k])])):v;
  return JSON.stringify(sort(data));
}
function record(raw:unknown):Record<string,unknown>{const v=pipelineData(raw);if(!v||typeof v!=='object'||Array.isArray(v))invalid();return v as Record<string,unknown>;}
function exact(v:Record<string,unknown>,keys:string[]):void{if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))invalid();}
const versionKeys=['contractVersion','sampleKind','policyVersion','catalogVersion','sourcePolicyVersion'];
function versions(v:Record<string,unknown>):void {
  if(v.sampleKind!=='SYNTHETIC')throw new PipelineError('LIVE_NOT_ENABLED');
  if(v.contractVersion!==PIPELINE_CONTRACT||!['policyVersion','catalogVersion','sourcePolicyVersion'].every(k=>str(v[k])))invalid();
}
export function validatePipelineVersions(raw:unknown):PipelineVersions {const v=record(raw);exact(v,versionKeys);versions(v);return v as unknown as PipelineVersions;}
export function assertPipelineVersions(actual:PipelineVersions,expected:PipelineVersions):void {
  // DTOs extend the version envelope. Validate its exact projection, not the DTO's unrelated fields.
  validatePipelineVersions(Object.fromEntries(versionKeys.map(k=>[k,actual[k as keyof PipelineVersions]])));validatePipelineVersions(expected);
  if(versionKeys.some(k=>actual[k as keyof PipelineVersions]!==expected[k as keyof PipelineVersions]))throw new PipelineError('POLICY_STALE');
}
function ids(raw:unknown):raw is string[]{return Array.isArray(raw)&&raw.length<=300&&raw.every(pipelineId)&&new Set(raw).size===raw.length;}
function fixtureRef(v:unknown):v is string{return str(v,512)&&/^fixture:\/[a-zA-Z0-9_./-]+$/.test(v)&&!v.includes('..');}
export function validateSourceRevision(raw:unknown):PipelineSourceRevision {
  const v=record(raw);exact(v,[...versionKeys,'sourceDocumentId','revisionId','sourceId','endpointId','publisherId','originId','independenceGroupId','canonicalUrl','nativeId','collectedAt','publishedAt','updatedAt','timeQuality','contentHash','title','lead','bodyRef','permissionVersion']);versions(v);
  if(!['sourceDocumentId','revisionId','sourceId','endpointId','publisherId','nativeId','permissionVersion'].every(k=>pipelineId(v[k]))||![v.originId,v.independenceGroupId].every(x=>x===null||pipelineId(x))||!hash(v.contentHash)||!str(v.title,500)||typeof v.lead!=='string'||v.lead.length>4000||!Number.isFinite(pipelineInstant(v.collectedAt)))invalid();
  if(v.bodyRef!==null&&!fixtureRef(v.bodyRef))invalid();
  if(!str(v.canonicalUrl,2048))invalid();
  let u:URL;try{u=new URL(v.canonicalUrl as string);}catch{invalid();}
  if(u!.protocol!=='https:'||!u!.hostname.endsWith('.invalid')||u!.username||u!.password||u!.hash||u!.port)invalid();
  if(v.timeQuality==='PENDING_TIME'){if(v.publishedAt!==null)invalid();}else if(v.timeQuality!=='KNOWN'||!Number.isFinite(pipelineInstant(v.publishedAt)))invalid();
  for(const k of ['publishedAt','updatedAt'])if(v[k]!==null&&(!Number.isFinite(pipelineInstant(v[k]))||pipelineInstant(v[k])>pipelineInstant(v.collectedAt)))invalid();
  if(v.updatedAt!==null&&v.publishedAt!==null&&pipelineInstant(v.updatedAt)<pipelineInstant(v.publishedAt))invalid();
  return v as unknown as PipelineSourceRevision;
}
export function validatePipelineDecision(raw:unknown):PipelineDecision {
  const v=record(raw);exact(v,[...versionKeys,'decisionId','inputRevisionIds','storyCandidateKey','issueCandidateKey','decision','action','reason','wakeCondition','deadline','knownAt','evidence','generatorVersion','promptVersion','evidenceVersion']);versions(v);
  if(!['decisionId','storyCandidateKey','reason','generatorVersion','promptVersion','evidenceVersion'].every(k=>str(v[k]))||!['decisionId','storyCandidateKey','evidenceVersion'].every(k=>pipelineId(v[k]))||v.issueCandidateKey!==null&&!pipelineId(v.issueCandidateKey)||!ids(v.inputRevisionIds)||!v.inputRevisionIds.length||!Number.isFinite(pipelineInstant(v.knownAt))||!['COLLECT','PASS','HOLD','EXPIRED_HOLD'].includes(v.decision as string)||!['NO_CHANGE','UPDATE','NEW_ANGLE','CORRECTION'].includes(v.action as string)||!Array.isArray(v.evidence)||v.evidence.length>300)invalid();
  if(v.decision==='HOLD'){if(!str(v.wakeCondition)||!Number.isFinite(pipelineInstant(v.deadline))||pipelineInstant(v.deadline)<=pipelineInstant(v.knownAt)||pipelineInstant(v.deadline)-pipelineInstant(v.knownAt)>72*3600000)invalid();}
  else if(v.wakeCondition!==null||v.deadline!==null)invalid();
  const seen=new Set<string>();for(const x of v.evidence){if(!x||typeof x!=='object'||Array.isArray(x))invalid();const e=x as Record<string,unknown>;exact(e,['claimId','revisionId','originId','groupId','official','verified']);if(!pipelineId(e.claimId)||seen.has(e.claimId)||!pipelineId(e.revisionId)||!v.inputRevisionIds.includes(e.revisionId)||![e.originId,e.groupId].every(a=>a===null||pipelineId(a))||typeof e.official!=='boolean'||typeof e.verified!=='boolean')invalid();seen.add(e.claimId);}
  return v as unknown as PipelineDecision;
}
/** Fixture evidence counting, not independent verification of an official claim. */
export function pipelineMacroEvidence(raw:unknown,officialCoreClaimId:string|null):{allowed:boolean;independentGroups:number;reason:string}{
  const d=validatePipelineDecision(raw),parent=new Map<string,string>();
  const root=(s:string):string=>{let at=s;while(parent.get(at)!==at)at=parent.get(at)!;return at;};
  for(const e of d.evidence.filter(e=>e.verified&&e.originId!==null&&e.groupId!==null)){
    const origin='o:'+e.originId,group='g:'+e.groupId;for(const key of [origin,group])if(!parent.has(key))parent.set(key,key);
    parent.set(root(origin),root(group));
  }
  const groups=new Set([...parent.keys()].map(root));
  const official=officialCoreClaimId!==null&&d.evidence.some(e=>e.claimId===officialCoreClaimId&&e.official&&e.verified);
  return {allowed:official||groups.size>=3,independentGroups:groups.size,reason:official?'FIXTURE_OFFICIAL_CORE':groups.size>=3?'FIXTURE_THREE_GROUPS':'INSUFFICIENT_INDEPENDENT_EVIDENCE'};
}
export function validatePipelineDraft(raw:unknown):PipelineDraft {
  const v=record(raw);exact(v,[...versionKeys,'issueId','storyId','decisionId','expectedArticleVersion','title','summary','bodyRef','visibleSections','evidenceVersion','firstPublishedAt','materialChangeAt']);versions(v);
  if(!['issueId','storyId','decisionId','evidenceVersion'].every(k=>pipelineId(v[k]))||!Number.isSafeInteger(v.expectedArticleVersion)||Number(v.expectedArticleVersion)<0||!str(v.title,500)||!str(v.summary,4000)||!fixtureRef(v.bodyRef)||!ids(v.visibleSections)||!v.visibleSections.every(s=>['KEY_ISSUES','ISSUE_ANALYSIS','SCENARIOS','BENEFIT_SECTORS','DAMAGE_SECTORS','RELATED_SECTORS','RISKS','SCHEDULE','SOURCES'].includes(s)))invalid();
  for(const k of ['firstPublishedAt','materialChangeAt'])if(v[k]!==null&&!Number.isFinite(pipelineInstant(v[k])))invalid();
  if(v.firstPublishedAt===null&&v.materialChangeAt!==null||v.firstPublishedAt!==null&&v.materialChangeAt!==null&&pipelineInstant(v.materialChangeAt)<pipelineInstant(v.firstPublishedAt))invalid();
  return v as unknown as PipelineDraft;
}
export function validateSnapshotDraft(raw:unknown):PipelineSnapshotDraft {
  const v=record(raw);exact(v,[...versionKeys,'snapshotKey','streamId','expectedRevision','cutoff','marketBasis','targetKrTradingDay','calendarVersion','comparisonSetVersion','evaluationSetVersion','nonpriceScaleVersion','highSignature','issueIds','highCarry','payloadDigest']);versions(v);
  if(!['snapshotKey','streamId','calendarVersion','comparisonSetVersion','evaluationSetVersion','nonpriceScaleVersion','highSignature'].every(k=>pipelineId(v[k]))||!hash(v.payloadDigest)||!Number.isSafeInteger(v.expectedRevision)||Number(v.expectedRevision)<0||!Number.isFinite(pipelineInstant(v.cutoff))||pipelineInstant(v.cutoff)%300000!==0||!['KR_COMBINED','FOREIGN_US'].includes(v.marketBasis as string)||!str(v.targetKrTradingDay)||!Number.isFinite(pipelineInstant(v.targetKrTradingDay+'T00:00:00Z'))||!ids(v.issueIds))invalid();
  if(v.highCarry!==null){
    const c=v.highCarry as Record<string,unknown>;if(!c||typeof c!=='object'||Array.isArray(c))invalid();exact(c,['completedSnapshotId','completionDigest','cutoff','policyVersion','catalogVersion','evaluationSetVersion','nonpriceScaleVersion','highSignature','order','rows']);
    if(!pipelineId(c.completedSnapshotId)||!hash(c.completionDigest)||!Number.isFinite(pipelineInstant(c.cutoff))||pipelineInstant(c.cutoff)>=pipelineInstant(v.cutoff)||pipelineInstant(c.cutoff)%300000!==0||!ids(c.order)||!Array.isArray(c.rows)||c.rows.length!==c.order.length||!['policyVersion','catalogVersion','evaluationSetVersion','nonpriceScaleVersion','highSignature'].every(k=>c[k]===v[k]))invalid();
    const seen=new Set<string>();for(const rawRow of c.rows){const r=rawRow as Record<string,unknown>;if(!r||typeof r!=='object'||Array.isArray(r))invalid();exact(r,['issueId','storyId','pool','tier','materialChangeAt','score','M']);if(!pipelineId(r.issueId)||seen.has(r.issueId)||!c.order.includes(r.issueId)||!v.issueIds.includes(r.issueId)||!pipelineId(r.storyId)||!['A','B','C'].includes(r.pool as string)||r.tier!=='HIGH'||r.M!==null||typeof r.score!=='number'||r.score<0||r.score>100||!Number.isFinite(pipelineInstant(r.materialChangeAt))||pipelineInstant(r.materialChangeAt)>pipelineInstant(c.cutoff))invalid();seen.add(r.issueId);}
  }
  return v as unknown as PipelineSnapshotDraft;
}
export function validatePipelineWrite<T>(raw:unknown,validate:(v:unknown)=>T):PipelineWrite<T>{
  const v=record(raw);exact(v,['effectKey','payloadHash','versions','value']);if(!pipelineId(v.effectKey)||!hash(v.payloadHash))invalid();const ver=validatePipelineVersions(v.versions),value=validate(v.value);return {effectKey:v.effectKey,payloadHash:v.payloadHash,versions:ver,value};
}
