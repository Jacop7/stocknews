/** NODE-ONLY SYNTHETIC_EVENT_ROUTING_A2. Fixture assertions, never factual verification or publication. */
import {PipelineError,pipelineData,pipelineCanonical,pipelineId,pipelineInstant,validatePipelineVersions,validateSourceRevision,validatePipelineDecision,assertPipelineVersions,type PipelineVersions,type PipelineSourceRevision,type PipelineDecision} from '../../../packages/contracts/src/pipeline.ts';
import {k1Record,k1Exact,selectPipelineSources} from '../../../packages/contracts/src/pipeline-semantics.ts';
interface Hash {update(s:string):Hash;digest(format:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(name:'sha256'):Hash}};
const {createHash}=process.getBuiltinModule('node:crypto');
export const EVENT_ROUTING_SCHEMA='SYNTHETIC_EVENT_ROUTING_A2' as const;
type Action='NO_CHANGE'|'UPDATE'|'NEW_ANGLE'|'CORRECTION';
interface Issue {issueId:string;issueVersion:string;angleCode:string;factKeys:string[];pathKeys:string[];evidenceClaimIds:string[];}
interface Claim {claimId:string;factKey:string;kind:'FACT'|'DETAIL'|'PRICE'|'WORDING';knownAt:string;}
interface Path {pathId:string;pathKey:string;sectorId:string;claimIds:string[];knownAt:string;}
interface Comparison {issueId:string;issueVersion:string;sameDirection:boolean;updateSufficient:boolean;}
interface Correction {issueId:string;oldFactKey:string;correctedByClaimId:string;}
interface Eligibility {revisionId:string;permissionVersion:string;sourcePolicyVersion:string;analysisAllowed:boolean;expiresAt:string;}
interface Delta {evidenceVersion:string;storyVersion:string;knownAt:string;independentTitleSubstance:boolean;materialDifference:boolean;comparisons:Comparison[];}
export interface EventRoutingContext {
  schema:typeof EVENT_ROUTING_SCHEMA;versions:PipelineVersions;asOf:string;deadlineAt:string;storyId:string;storyVersion:string;canonicalEventKey:string;
  issueSetVersion:string;completeIssueIds:string[];issues:Issue[];decision:PipelineDecision;revisions:PipelineSourceRevision[];eligibility:Eligibility[];
  claims:Claim[];paths:Path[];corrections:Correction[];delta:Delta;promptVersion:string;generatorVersion:string;
}
export interface EventRoutingProposal {requestDigest:string;proposedAction:Action;targetIssueId:string|null;angleCode:string;claimIds:string[];pathIds:string[];comparisons:Comparison[];independentTitleSubstance:boolean;materialDifference:boolean;correctionClaimRefs:string[];}
export interface EventRoutingResult {
  schema:typeof EVENT_ROUTING_SCHEMA;sampleKind:'SYNTHETIC';fixtureAssertionOnly:true;executionEnabled:false;
  disposition:'PLAN'|'HOLD';action:Action|null;reason:string;requestDigest:string;storyId:string;expectedStoryVersion:string;
  expectedIssueVersions:Array<{issueId:string;issueVersion:string}>;targetIssueId:string|null;angleCode:string|null;
  claimIds:string[];pathIds:string[];deadlineAt:string|null;wakeOn:string[];
  publicationAuthorized:false;changesPublicTimestamps:false;
}
type Prepared={state:'READY_FOR_ROUTING_MODEL';request:EventRoutingContext;requestDigest:string}|{state:'HOLD';result:EventRoutingResult};
const bad=():never=>{throw new PipelineError('INVALID_INPUT');};
const copy=<T>(v:T):T=>pipelineData(v) as T;
const digest=(v:unknown)=>createHash('sha256').update(pipelineCanonical(v)).digest('hex');
function at(v:unknown):number {const n=pipelineInstant(v);if(!Number.isFinite(n))bad();return n;}
function id(v:unknown):string {if(!pipelineId(v))bad();return v as string;}
function list(v:unknown,max=300):unknown[]{if(!Array.isArray(v)||v.length>max)bad();return v as unknown[];}
function ids(v:unknown,min=0,max=300):string[]{const a=list(v,max).map(id);if(a.length<min||new Set(a).size!==a.length)bad();return a;}
function exactIds(a:string[],b:string[]):boolean{return pipelineCanonical([...a].sort())===pipelineCanonical([...b].sort());}
function unique<T>(items:T[],key:(x:T)=>string):T[]{if(new Set(items.map(key)).size!==items.length)bad();return items;}
function comparisons(raw:unknown):Comparison[]{return unique(list(raw,100).map(v=>{const x=k1Record(v);k1Exact(x,['issueId','issueVersion','sameDirection','updateSufficient']);id(x.issueId);id(x.issueVersion);if(typeof x.sameDirection!=='boolean'||typeof x.updateSufficient!=='boolean')bad();return x as unknown as Comparison;}),x=>x.issueId);}
function context(raw:unknown):EventRoutingContext {
  const x=k1Record(raw);k1Exact(x,['schema','versions','asOf','deadlineAt','storyId','storyVersion','canonicalEventKey','issueSetVersion','completeIssueIds','issues','decision','revisions','eligibility','claims','paths','corrections','delta','promptVersion','generatorVersion']);
  if(x.schema!==EVENT_ROUTING_SCHEMA)bad();const versions=validatePipelineVersions(x.versions);
  for(const f of ['storyId','storyVersion','canonicalEventKey','issueSetVersion','promptVersion','generatorVersion'])id(x[f]);
  const now=at(x.asOf),end=at(x.deadlineAt);if(end<=now||end-now>72*3600000)bad();
  const issues=unique(list(x.issues,100).map(v=>{const y=k1Record(v);k1Exact(y,['issueId','issueVersion','angleCode','factKeys','pathKeys','evidenceClaimIds']);for(const f of ['issueId','issueVersion','angleCode'])id(y[f]);ids(y.factKeys);ids(y.pathKeys);ids(y.evidenceClaimIds);return y as unknown as Issue;}),v=>v.issueId);
  if(!issues.length)bad();const complete=ids(x.completeIssueIds,1,100);if(!exactIds(complete,issues.map(i=>i.issueId)))bad();
  const decision=validatePipelineDecision(x.decision);assertPipelineVersions(decision,versions);
  const revisions=unique(list(x.revisions).map(validateSourceRevision),v=>v.revisionId);for(const r of revisions)assertPipelineVersions(r,versions);
  const eligibility=unique(list(x.eligibility).map(v=>{const y=k1Record(v);k1Exact(y,['revisionId','permissionVersion','sourcePolicyVersion','analysisAllowed','expiresAt']);for(const f of ['revisionId','permissionVersion','sourcePolicyVersion'])id(y[f]);if(typeof y.analysisAllowed!=='boolean')bad();at(y.expiresAt);return y as unknown as Eligibility;}),v=>v.revisionId);
  if(!exactIds(eligibility.map(e=>e.revisionId),decision.inputRevisionIds))bad();
  const claims=unique(list(x.claims).map(v=>{const y=k1Record(v);k1Exact(y,['claimId','factKey','kind','knownAt']);id(y.claimId);id(y.factKey);at(y.knownAt);if(!['FACT','DETAIL','PRICE','WORDING'].includes(y.kind as string))bad();return y as unknown as Claim;}),v=>v.claimId);
  if(!claims.length||!exactIds(claims.map(c=>c.claimId),decision.evidence.map(e=>e.claimId)))bad();const byClaim=new Map(claims.map(c=>[c.claimId,c]));
  const paths=unique(list(x.paths).map(v=>{const y=k1Record(v);k1Exact(y,['pathId','pathKey','sectorId','claimIds','knownAt']);for(const f of ['pathId','pathKey','sectorId'])id(y[f]);at(y.knownAt);for(const c of ids(y.claimIds,1))if(!byClaim.has(c)||!['FACT','DETAIL'].includes(byClaim.get(c)!.kind))bad();return y as unknown as Path;}),v=>v.pathId);
  // Different IDs cannot multiply a single fixture impact path.
  unique(paths,p=>p.pathKey);
  const corrections=unique(list(x.corrections).map(v=>{const y=k1Record(v);k1Exact(y,['issueId','oldFactKey','correctedByClaimId']);for(const f of ['issueId','oldFactKey','correctedByClaimId'])id(y[f]);if(!issues.find(i=>i.issueId===y.issueId)?.factKeys.includes(y.oldFactKey as string)||!byClaim.has(y.correctedByClaimId as string)||!['FACT','DETAIL'].includes(byClaim.get(y.correctedByClaimId as string)!.kind))bad();return y as unknown as Correction;}),v=>pipelineCanonical([v.issueId,v.oldFactKey]));
  const delta=k1Record(x.delta);k1Exact(delta,['evidenceVersion','storyVersion','knownAt','independentTitleSubstance','materialDifference','comparisons']);id(delta.evidenceVersion);id(delta.storyVersion);at(delta.knownAt);if(typeof delta.independentTitleSubstance!=='boolean'||typeof delta.materialDifference!=='boolean')bad();const cmp=comparisons(delta.comparisons);
  if(!exactIds(cmp.map(c=>c.issueId),complete)||cmp.some(c=>issues.find(i=>i.issueId===c.issueId)?.issueVersion!==c.issueVersion))bad();
  return {...x,versions,issues,decision,revisions,eligibility,claims,paths,corrections,delta:{...delta,comparisons:cmp}} as unknown as EventRoutingContext;
}
function result(c:EventRoutingContext,reason:string,action:Action|null=null,target:string|null=null,angle:string|null=null):EventRoutingResult {
  return {schema:EVENT_ROUTING_SCHEMA,sampleKind:'SYNTHETIC',fixtureAssertionOnly:true,executionEnabled:false,disposition:action===null?'HOLD':'PLAN',action,reason,requestDigest:digest(c),storyId:c.storyId,expectedStoryVersion:c.storyVersion,expectedIssueVersions:c.issues.map(i=>({issueId:i.issueId,issueVersion:i.issueVersion})),targetIssueId:target,angleCode:angle,claimIds:c.claims.map(v=>v.claimId),pathIds:c.paths.map(v=>v.pathId),deadlineAt:action===null?c.deadlineAt:null,wakeOn:action===null?['CURRENT_EVIDENCE_OR_VERSION']:[],publicationAuthorized:false,changesPublicTimestamps:false};
}
function prepare(c:EventRoutingContext):Prepared {
  const hold=(why:string):Prepared=>({state:'HOLD',result:result(c,why)}),now=at(c.asOf);
  if(c.decision.decision!=='COLLECT'||c.decision.storyCandidateKey!==c.canonicalEventKey||at(c.decision.knownAt)>now||c.delta.evidenceVersion!==c.decision.evidenceVersion||c.delta.storyVersion!==c.storyVersion||at(c.delta.knownAt)>now||at(c.delta.knownAt)<at(c.decision.knownAt))return hold('DECISION_OR_DELTA_NOT_CURRENT');
  if(c.decision.issueCandidateKey!==null&&!c.issues.some(i=>i.issueId===c.decision.issueCandidateKey))return hold('ISSUE_BINDING_REQUIRED');
  const sources=new Map(c.revisions.map(r=>[r.revisionId,r])),selection=selectPipelineSources(c.revisions,c.versions,c.asOf);
  for(const rid of c.decision.inputRevisionIds){const r=sources.get(rid),e=c.eligibility.find(x=>x.revisionId===rid),s=r?selection.find(x=>x.sourceDocumentId===r.sourceDocumentId):null;
    if(!r||s?.status!=='SELECTED'||s.revision?.revisionId!==rid)return hold('CURRENT_SOURCE_REQUIRED');
    if(at(r.collectedAt)>at(c.decision.knownAt))return hold('DECISION_INPUT_TIME_REQUIRED');
    if(!e?.analysisAllowed||e.permissionVersion!==r.permissionVersion||e.sourcePolicyVersion!==c.versions.sourcePolicyVersion||at(e.expiresAt)<=now)return hold('ANALYSIS_NOT_ELIGIBLE');
  }
  const evidence=new Map(c.decision.evidence.map(e=>[e.claimId,e]));
  for(const claim of c.claims){const e=evidence.get(claim.claimId),r=e?sources.get(e.revisionId):null;if(at(claim.knownAt)>at(c.decision.knownAt)||!e?.verified||!r||at(claim.knownAt)<at(r.collectedAt)||e.originId!==r.originId||e.groupId!==r.independenceGroupId)return hold('VERIFIED_CURRENT_CLAIMS_REQUIRED');}
  if(c.paths.some(p=>at(p.knownAt)>at(c.delta.knownAt)||p.claimIds.some(id=>at(c.claims.find(cl=>cl.claimId===id)!.knownAt)>at(p.knownAt))))return hold('CURRENT_KOREAN_PATH_REQUIRED');
  return {state:'READY_FOR_ROUTING_MODEL',request:copy(c),requestDigest:digest(c)};
}
export function prepareEventRoutingRequest(rawContext:unknown):Prepared{return prepare(context(rawContext));}
function proposal(raw:unknown):EventRoutingProposal {
  const p=k1Record(raw);k1Exact(p,['requestDigest','proposedAction','targetIssueId','angleCode','claimIds','pathIds','comparisons','independentTitleSubstance','materialDifference','correctionClaimRefs']);
  if(typeof p.requestDigest!=='string'||!/^[a-f0-9]{64}$/.test(p.requestDigest)||!['NO_CHANGE','UPDATE','NEW_ANGLE','CORRECTION'].includes(p.proposedAction as string)||typeof p.independentTitleSubstance!=='boolean'||typeof p.materialDifference!=='boolean')bad();
  if(p.targetIssueId!==null)id(p.targetIssueId);id(p.angleCode);ids(p.claimIds);ids(p.pathIds);ids(p.correctionClaimRefs);comparisons(p.comparisons);return p as unknown as EventRoutingProposal;
}
/** The whole context difference is authoritative; a model cannot hide new facts by omitting references. */
export function acceptEventRoutingProposal(rawContext:unknown,rawProposal:unknown):EventRoutingResult {
  const c=context(rawContext),ready=prepare(c);if(ready.state==='HOLD')return ready.result;const hold=(why:string)=>result(c,why);
  let p:EventRoutingProposal;try{p=proposal(rawProposal);}catch{return hold('MALFORMED_PROPOSAL');}
  if(p.requestDigest!==ready.requestDigest)return hold('REQUEST_MISMATCH');
  const order=(a:Comparison,b:Comparison)=>a.issueId<b.issueId?-1:a.issueId>b.issueId?1:0;
  if(!exactIds(p.claimIds,c.claims.map(x=>x.claimId))||!exactIds(p.pathIds,c.paths.map(x=>x.pathId))||pipelineCanonical([...p.comparisons].sort(order))!==pipelineCanonical([...c.delta.comparisons].sort(order))||p.independentTitleSubstance!==c.delta.independentTitleSubstance||p.materialDifference!==c.delta.materialDifference)return hold('CONTEXT_DIFFERENCE_MISMATCH');
  const correctionRefs=[...new Set(c.corrections.map(x=>x.correctedByClaimId))];
  if(!exactIds(p.correctionClaimRefs,correctionRefs))return hold('CORRECTION_REFERENCES_MISMATCH');
  const target=c.issues.find(i=>i.issueId===p.targetIssueId),cmp=c.delta.comparisons.find(i=>i.issueId===p.targetIssueId);
  // A correction never silently becomes an update, no-change, or a second angle.
  if(c.corrections.length){if(p.proposedAction!=='CORRECTION')return hold('CORRECTION_REQUIRED');const affected=[...new Set(c.corrections.map(x=>x.issueId))];if(!target||affected.length!==1||affected[0]!==target.issueId||p.angleCode!==target.angleCode)return hold('CORRECTION_TARGET_REQUIRED');return result(c,'VERIFIED_FIXTURE_CORRECTION','CORRECTION',target.issueId,target.angleCode);}
  if(p.proposedAction==='CORRECTION')return hold('CORRECTION_LINK_REQUIRED');
  const oldFacts=new Set(c.issues.flatMap(i=>i.factKeys)),oldPaths=new Set(c.issues.flatMap(i=>i.pathKeys)),oldEvidence=new Set(c.issues.flatMap(i=>i.evidenceClaimIds));
  const newFacts=c.claims.filter(x=>['FACT','DETAIL'].includes(x.kind)&&!oldFacts.has(x.factKey));
  const addedPaths=c.paths.filter(x=>!oldPaths.has(x.pathKey));
  const newAnglePaths=addedPaths.filter(x=>x.claimIds.some(cid=>!oldEvidence.has(cid)));
  // A changed path is still a context difference when its evidence is old. Fresh supporting
  // evidence is an additional NEW_ANGLE condition, not permission to erase that difference.
  const hasDelta=newFacts.length>0||addedPaths.length>0;
  const newAngleDelta=newFacts.length>0||newAnglePaths.length>0;
  const legalUpdate=!!target&&!!cmp&&cmp.sameDirection&&cmp.updateSufficient&&p.angleCode===target.angleCode;
  if(p.proposedAction==='NO_CHANGE'){if(hasDelta)return hold('UNREPORTED_MATERIAL_DIFFERENCE');if(!target||p.angleCode!==target.angleCode)return hold('TARGET_REQUIRED');return result(c,'NO_MATERIAL_CHANGE','NO_CHANGE',target.issueId,target.angleCode);}
  if(p.proposedAction==='UPDATE'){if(!legalUpdate)return hold('UPDATE_TARGET_NOT_CONFIRMED');return result(c,hasDelta?'EXISTING_DETAIL_FIRST':'EVIDENCE_ONLY_NO_PUBLIC_TIMESTAMP',hasDelta?'UPDATE':'NO_CHANGE',target!.issueId,target!.angleCode);}
  const newAngle=newAngleDelta&&c.delta.independentTitleSubstance&&c.delta.materialDifference&&c.delta.comparisons.every(x=>!x.sameDirection&&!x.updateSufficient)&&!c.issues.some(i=>i.angleCode===p.angleCode)&&p.targetIssueId===null;
  if(newAngle)return result(c,'ALL_FIVE_NEW_ANGLE_GATES','NEW_ANGLE',null,p.angleCode);
  if(legalUpdate)return result(c,hasDelta?'NEW_ANGLE_DOWNGRADED_TO_UPDATE':'NO_MATERIAL_CHANGE',hasDelta?'UPDATE':'NO_CHANGE',target!.issueId,target!.angleCode);
  return hold('NEW_ANGLE_NOT_ESTABLISHED');
}
