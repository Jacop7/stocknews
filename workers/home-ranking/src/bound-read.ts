/** NODE-ONLY HOME_BOUND_P3 current guards and internal ID-only home read model. No public DTO/IO. */
import {validateSyntheticRankableBatch,type SyntheticRankableBatch,type RankableIssue,type RankableClaim} from '../../../packages/contracts/src/rankable-batch.ts';
import {selectPipelineSources} from '../../../packages/contracts/src/pipeline-semantics.ts';
import {pipelineMacroEvidence,type PipelineEvidence} from '../../../packages/contracts/src/pipeline.ts';
import {deriveHomeContext,type HomeContextInput} from '../../../packages/domain/src/home-snapshot.ts';
import {buildSyntheticRankingInputs} from './rankable-adapter.ts';
import {boundData,boundRecord,boundExact,boundReject,boundEqual,boundInstant,homeStamp,homeFloor,HOME_BOUND_SCHEMA,type HomeStamp,type BoundBinding,type CompletedSnapshot} from './bound-ports.ts';

export interface CurrentView {batch:SyntheticRankableBatch;rows:Map<string,{articleVersionId:string;evidenceVersion:string;assessmentVersion:string;eligible:boolean}>;claims:Map<string,RankableClaim>;currentSource:(revisionId:string)=>boolean;currentClaim:(id:string,evidence:PipelineEvidence|undefined,evidenceVersion:string)=>boolean;}
export interface InternalHomeRead {state:'FRESH'|'DELAYED'|'CALCULATING';checkedAt:string;rankingCutoff:string;snapshotId:string|null;sourceCutoff:string|null;marketBasis:'KR_COMBINED'|'FOREIGN_US'|null;targetKrTradingDay:string|null;lanes:Record<'A'|'B'|'C',Array<{issueId:string;articleVersionId:string}>>;}
function dependencyRefs(row:RankableIssue):string[]{
  return [...new Set([...Object.values(row.priority.assessment).flatMap(g=>g.claimIds),...(row.priority.macroGate?.claimIds??[]),...row.visibility.keyIssueEvidenceIds,...row.visibility.analysisEvidenceIds,...row.visibility.impacts.flatMap(x=>x.evidenceIds),...row.visibility.risks.flatMap(x=>x.evidenceIds),...row.visibility.schedule.flatMap(x=>x.evidenceIds),...row.article.version.impacts.flatMap(x=>x.evidenceIds)])].sort();
}
/** Same article/evidence/assessment versions require an identical dependency projection.
 * Reverification timestamps, current publication/impact state, expiry and new hard deadlines
 * remain dynamic qualification inputs. Source revisions, draft binding, grades, macro gate,
 * article content and the visibility/path graph remain immutable for these version IDs.
 */
function dependencyProjection(row:RankableIssue,batch:SyntheticRankableBatch,claims:Map<string,RankableClaim>){
  const {asOf,...visibility}=row.visibility;
  return {article:row.article.version,storedDraft:row.storedDraft,decision:row.decision,visibility,
    assessment:row.priority.assessment,macroGate:row.priority.macroGate,scope:row.priority.scope,contentClass:row.priority.contentClass,direction:row.priority.direction,primarySectorId:row.primarySectorId,publishedAt:row.priority.publishedAt,materialChangeAt:row.priority.materialChangeAt,
    sources:row.decision.inputRevisionIds.map(id=>batch.sources.find(s=>s.revisionId===id)??null),
    claims:dependencyRefs(row).map(id=>{const c=claims.get(id);return c?{claimId:id,claimVersion:c.claim.version,kind:c.claim.kind,evidenceVersion:c.evidenceVersion,sourceRevisionId:c.sourceRevisionId,originId:c.claim.originId,independenceGroupId:c.independenceGroupId,official:c.official}:null;})};
}
/** Current port returns a B1 data container with exactly one current observation per declared
 * entity. A row may be known after its 5-minute ranking cutoff; this guard uses checkedAt,
 * never B1's ranking selector, so it cannot rewrite historical ranking input. Completeness
 * and publication remain fixture assertions. Original B1 structural checks are reused.
 */
export function inspectCurrent(raw:unknown,requiredIssueIds:string[],stamp:HomeStamp,observedAt:string,checkedAt:string):CurrentView {
  const v=boundRecord(boundData(raw));boundExact(v,['schema','mode','fixtureAssertionOnly','executionEnabled','stamp','observedAt','batch']);
  if(v.schema!==HOME_BOUND_SCHEMA||v.mode!=='OFFLINE_REPLAY'||v.fixtureAssertionOnly!==true||v.executionEnabled!==false||!boundEqual(homeStamp(v.stamp),stamp)||boundInstant(v.observedAt)!==boundInstant(observedAt)||boundInstant(checkedAt)<boundInstant(observedAt))boundReject('RIGHTS_HOLD');
  const b=validateSyntheticRankableBatch(v.batch),now=boundInstant(checkedAt),observed=boundInstant(observedAt);
  if(!boundEqual([...b.declared.issueIds].sort(),[...requiredIssueIds].sort())||b.issues.length!==b.declared.issueIds.length||b.claims.length!==b.declared.claimIds.length||new Set(b.issues.map(x=>x.article.issue.id)).size!==b.issues.length||new Set(b.claims.map(x=>x.claim.claimId)).size!==b.claims.length)boundReject('RIGHTS_HOLD');
  if(boundInstant(b.cutoff)!==boundInstant(homeFloor(observedAt)))boundReject('RIGHTS_HOLD');
  if([...b.issues,...b.claims].some(x=>boundInstant(x.knownAt)>observed))boundReject('RIGHTS_HOLD');
  const claims=new Map(b.claims.map(c=>[c.claim.claimId,c])),sources=new Map(b.sources.map(s=>[s.revisionId,s]));
  const selected=new Map(selectPipelineSources(b.sources,b.versions,checkedAt).map(s=>[s.sourceDocumentId,s]));
  const currentSource=(id:string)=>{const s=sources.get(id),x=s?selected.get(s.sourceDocumentId):null;return !!s&&x?.status==='SELECTED'&&x.revision?.revisionId===id;};
  const currentClaim=(id:string,e:PipelineEvidence|undefined,evidenceVersion:string)=>{const c=claims.get(id);return !!c&&e?.verified===true&&c.evidenceVersion===evidenceVersion&&c.sourceRevisionId===e.revisionId&&c.claim.originId===e.originId&&c.independenceGroupId===e.groupId&&c.official===e.official&&c.status==='VALID'&&c.claim.status==='VERIFIED'&&boundInstant(c.claim.validUntil)>now&&boundInstant(c.claim.verifiedAt)<=observed&&currentSource(c.sourceRevisionId);};
  const rows:CurrentView['rows']=new Map();
  for(const row of b.issues){
    const p=row.priority,d=row.decision,evidence=new Map(d.evidence.map(e=>[e.claimId,e]));
    let eligible=row.status==='VALID'&&p.publicationState==='PUBLISHED'&&p.impactState==='ACTIVE'&&row.publication.evidenceCurrent&&boundInstant(p.evidenceValidUntil)>now&&now-boundInstant(p.lastVerifiedAt)<86400000&&(p.scheduledEndAt===null||boundInstant(p.scheduledEndAt)>now)&&d.inputRevisionIds.every(currentSource);
    for(const e of d.evidence){const c=claims.get(e.claimId);if(!c||c.evidenceVersion!==d.evidenceVersion||c.sourceRevisionId!==e.revisionId||c.claim.originId!==e.originId||c.independenceGroupId!==e.groupId||c.official!==e.official)eligible=false;}
    for(const id of dependencyRefs(row))if(!currentClaim(id,evidence.get(id),d.evidenceVersion))eligible=false;
    if(p.macroGate){const g=p.macroGate,set=new Set(g.claimIds),gateEvidence=d.evidence.filter(e=>set.has(e.claimId));if(g.decision!=='PASS'||g.independentOriginIds.some(id=>!gateEvidence.some(e=>e.originId===id))||!pipelineMacroEvidence({...d,evidence:gateEvidence},g.officialCoreClaimId).allowed)eligible=false;}
    rows.set(p.issueId,{articleVersionId:row.article.version.id,evidenceVersion:d.evidenceVersion,assessmentVersion:p.assessmentVersion,eligible});
  }
  return {batch:b,rows,claims,currentSource,currentClaim};
}
export function currentMatches(view:CurrentView,binding:BoundBinding,issueIds:string[]):boolean {
  if(!boundEqual(view.batch.versions,binding.batch.versions))return false;
  // Rebuild through B1's existing selectKnownRevisions path; no second revision selector.
  const manifest=buildSyntheticRankingInputs(binding.batch).bindingManifest;
  const storedClaims=new Map(manifest.claims.map(c=>[c.claimId,binding.batch.claims.find(x=>x.claim.claimId===c.claimId&&x.revision===c.observationRevision)!]));
  for(const id of issueIds){const current=view.rows.get(id),candidate=manifest.issues.find(x=>x.issueId===id);
    if(!current?.eligible||!candidate?.rankable||current.articleVersionId!==candidate.articleVersionId||current.evidenceVersion!==candidate.evidenceVersion||current.assessmentVersion!==candidate.assessmentVersion)return false;
    const stored=binding.batch.issues.find(x=>x.article.issue.id===id&&x.revision===candidate.observationRevision&&x.contentId===candidate.contentId),currentRow=view.batch.issues.find(x=>x.article.issue.id===id);
    if(!stored||!currentRow)return false;
    // Check the saved dependency set against current observations independently of current
    // visibility. Removing/replacing a ref cannot erase the old card's safety dependency.
    const evidence=new Map(stored.decision.evidence.map(e=>[e.claimId,e]));
    if(!stored.decision.inputRevisionIds.every(view.currentSource)||dependencyRefs(stored).some(ref=>!view.currentClaim(ref,evidence.get(ref),stored.decision.evidenceVersion)))return false;
    if(!boundEqual(dependencyProjection(stored,binding.batch,storedClaims),dependencyProjection(currentRow,view.batch,view.claims)))return false;
  }
  return true;
}
export function currentFallback(view:CurrentView,checkedAt:string){
  const b=view.batch,context=boundRecord(b.context),keys=['mode','sampleKind','cutoff','policyVersion','catalogVersion','comparisonSetVersion','evaluationSetVersion','calendar'];
  if(Object.keys(context).length!==keys.length||keys.some(k=>!Object.hasOwn(context,k))||boundInstant(context.cutoff)!==boundInstant(homeFloor(checkedAt)))boundReject('RIGHTS_HOLD');
  const c={...context,signals:{T:false,M:false,P:false}} as unknown as HomeContextInput;if(deriveHomeContext(c).status!=='DRAFT_SYNTHETIC')boundReject('RIGHTS_HOLD');
  return {sampleKind:'SYNTHETIC',profileId:b.profileId,nonpriceScaleVersion:b.nonpriceScaleVersion,sourcePolicyVersion:b.versions.sourcePolicyVersion,context:c,eligibility:{knownAt:homeFloor(checkedAt),complete:true,rows:b.issues.map(row=>({issueId:row.priority.issueId,issueVersion:row.article.version.id,publicationState:row.priority.publicationState,impactState:row.priority.impactState,evidenceValidUntil:row.priority.evidenceValidUntil,evidenceCurrent:view.rows.get(row.priority.issueId)?.eligible===true}))}};
}
export function snapshotIssueIds(snapshot:CompletedSnapshot):string[]{return [...new Set((['A','B','C'] as const).flatMap(l=>snapshot.result.lanes[l].map(x=>x.issueId)))].sort();}
export function internalHomeRead(snapshot:CompletedSnapshot|null,checkedAt:string,fresh=false):InternalHomeRead {
  return {state:snapshot?(fresh?'FRESH':'DELAYED'):'CALCULATING',checkedAt,rankingCutoff:homeFloor(checkedAt),snapshotId:snapshot?.snapshotId??null,sourceCutoff:snapshot?.result.context?.cutoff??null,marketBasis:snapshot?.result.context?.marketBasis??null,targetKrTradingDay:snapshot?.result.context?.targetKrTradingDay??null,lanes:{A:snapshot?.result.lanes.A.map(x=>({issueId:x.issueId,articleVersionId:x.issueVersion}))??[],B:snapshot?.result.lanes.B.map(x=>({issueId:x.issueId,articleVersionId:x.issueVersion}))??[],C:snapshot?.result.lanes.C.map(x=>({issueId:x.issueId,articleVersionId:x.issueVersion}))??[]}};
}
