/** NODE-ONLY SYNTHETIC_RANKABLE_BINDING_B1. Pure fixture transformation, no dispatch or service port. */
interface FixtureHash {update(value:string):FixtureHash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(algorithm:'sha256'):FixtureHash}};
const {createHash}=process.getBuiltinModule('node:crypto');
import {PipelineError,pipelineCanonical,pipelineData,pipelineInstant,pipelineMacroEvidence} from '../../../packages/contracts/src/pipeline.ts';
import {selectPipelineSources} from '../../../packages/contracts/src/pipeline-semantics.ts';
import {RANKABLE_BATCH_SCHEMA,validateSyntheticRankableBatch,type RankableIssue} from '../../../packages/contracts/src/rankable-batch.ts';
import {deriveHomeContext,selectKnownRevisions,type HomeContextInput} from '../../../packages/domain/src/home-snapshot.ts';
import {draftIssuePriority,PRIORITY_POLICY,type PriorityIssue,type PriorityInput} from '../../../packages/domain/src/issue-priority.ts';
import {HOME_RANKING_POLICY} from '../../../packages/domain/src/home-ranking.ts';
import type {K1RankingCommand} from '../../../packages/domain/src/pipeline-ranking.ts';

const sha=(raw:unknown)=>createHash('sha256').update(pipelineCanonical(raw)).digest('hex');
function reject(code:'INVALID_INPUT'|'RIGHTS_HOLD'|'POLICY_STALE'='INVALID_INPUT'):never {throw new PipelineError(code);}
const at=(value:string)=>pipelineInstant(value);
type Context=Omit<HomeContextInput,'signals'>;
interface EligibilityRow {issueId:string;issueVersion:string;publicationState:RankableIssue['priority']['publicationState'];impactState:RankableIssue['priority']['impactState'];evidenceValidUntil:string;evidenceCurrent:boolean;}
export interface SyntheticRankingInputs {
  command:K1RankingCommand;
  /** Exact payload for P1 FALLBACK; its cutoff represents the current fixture observation. */
  eligibility:{sampleKind:'SYNTHETIC';profileId:string;nonpriceScaleVersion:string;sourcePolicyVersion:string;context:HomeContextInput;eligibility:{knownAt:string;complete:true;rows:EligibilityRow[]}};
  bindingManifest:{schema:typeof RANKABLE_BATCH_SCHEMA;sampleKind:'SYNTHETIC';fixtureAssertionOnly:true;completenessScope:'DECLARED_FIXTURE_IDS_ONLY';p1Enforced:false;executionEnabled:false;batchId:string;batchDigest:string;commandDigest:string;cutoff:string;knownDataSetVersion:string;issues:Array<{issueId:string;articleVersionId:string;storedDraftVersion:number;decisionId:string;evidenceVersion:string;assessmentVersion:string;observationRevision:number;contentId:string;rankable:boolean;reasons:string[]}>;claims:Array<{claimId:string;claimVersion:string;observationRevision:number;contentId:string;sourceRevisionId:string;evidenceVersion:string;originId:string;independenceGroupId:string|null}>};
}

/** No live clock, producer, publication, IO, persistence, ranking formula or previous-state input. */
export function buildSyntheticRankingInputs(raw:unknown):SyntheticRankingInputs {
  const b=validateSyntheticRankableBatch(raw),cutoff=at(b.cutoff),context=b.context as Record<string,unknown>;
  const contextKeys=['mode','sampleKind','cutoff','policyVersion','catalogVersion','comparisonSetVersion','evaluationSetVersion','calendar'];
  if(Object.keys(context).length!==contextKeys.length||contextKeys.some(k=>!Object.hasOwn(context,k)))reject();
  if(at(context.cutoff as string)!==cutoff||context.catalogVersion!==b.versions.catalogVersion)reject('POLICY_STALE');
  const derived=deriveHomeContext({...context,signals:{T:false,M:false,P:false}});if(derived.status!=='DRAFT_SYNTHETIC')reject('RIGHTS_HOLD');
  // Registry subset already supported by K1. This adapter neither adds profiles nor rewrites policy IDs.
  if(!['SYNTHETIC_PROFILE_V1','SYNTHETIC_PROFILE_REISSUE'].includes(b.profileId)||!['SYNTHETIC_SCALE_V1','SYNTHETIC_SCALE_V2'].includes(b.nonpriceScaleVersion)||b.versions.sourcePolicyVersion!=='SYNTHETIC_SOURCE_V1')reject('POLICY_STALE');
  const known=selectKnownRevisions(b.knowledge);if(known.status!=='DRAFT_SYNTHETIC')reject('RIGHTS_HOLD');
  const selectedIssues=new Map(known.value.selected.filter(r=>r.kind==='ISSUE').map(r=>[r.entityId,r]));
  const selectedClaims=new Map(known.value.selected.filter(r=>r.kind==='CLAIM').map(r=>[r.entityId,r]));
  if(selectedIssues.size!==b.declared.issueIds.length||selectedClaims.size!==b.declared.claimIds.length)reject('RIGHTS_HOLD');
  const issues=b.declared.issueIds.slice().sort().map(id=>{const ref=selectedIssues.get(id)!;const row=b.issues.find(x=>x.article.issue.id===id&&x.revision===ref.revision);if(!row)reject('RIGHTS_HOLD');return row;});
  const claims=b.declared.claimIds.slice().sort().map(id=>{const ref=selectedClaims.get(id)!;const row=b.claims.find(x=>x.claim.claimId===id&&x.revision===ref.revision);if(!row)reject('RIGHTS_HOLD');return row;});
  const byClaim=new Map(claims.map(c=>[c.claim.claimId,c])),sources=new Map(b.sources.map(s=>[s.revisionId,s]));
  // Reuse the existing collectedAt/asOf + source-time representative rules exactly.
  const currentSources=new Map(selectPipelineSources(b.sources,b.versions,b.cutoff).map(s=>[s.sourceDocumentId,s]));
  const currentSource=(revisionId:string)=>{
    const source=sources.get(revisionId);if(!source)return false;
    const selected=currentSources.get(source.sourceDocumentId);
    return selected?.status==='SELECTED'&&selected.revision?.revisionId===revisionId;
  };
  const currentClaim=(id:string)=>{
    const c=byClaim.get(id);if(!c)return false;
    return c.status==='VALID'&&c.claim.status==='VERIFIED'&&at(c.claim.verifiedAt)<=cutoff&&at(c.claim.validUntil)>cutoff&&currentSource(c.sourceRevisionId);
  };
  const normalizedContext=pipelineData(context) as Context;
  normalizedContext.cutoff=new Date(cutoff).toISOString();
  normalizedContext.calendar.days=[...normalizedContext.calendar.days].sort((a,b)=>a.date<b.date?-1:a.date>b.date?1:0);
  const priority:PriorityInput={mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:normalizedContext.cutoff,policyVersion:PRIORITY_POLICY,catalogVersion:b.versions.catalogVersion,evaluationSetVersion:normalizedContext.evaluationSetVersion,claims:claims.map(c=>c.claim),issues:[]};
  const eligibilityRows:EligibilityRow[]=[],sectors:K1RankingCommand['recipe']['sectors']=[],bindings:SyntheticRankingInputs['bindingManifest']['issues']=[];
  for(const row of issues){
    const p=row.priority,decision=row.decision,reasons:string[]=[],evidence=new Map(decision.evidence.map(e=>[e.claimId,e]));
    // Each selected claim must retain the exact source/origin/group/evidence binding. A current
    // expiry or source replacement is an eligibility failure, not permission to relabel a claim.
    for(const e of decision.evidence){
      const c=byClaim.get(e.claimId);
      if(!c||c.evidenceVersion!==decision.evidenceVersion||c.sourceRevisionId!==e.revisionId||c.claim.originId!==e.originId||c.independenceGroupId!==e.groupId||c.official!==e.official)reject('RIGHTS_HOLD');
    }
    const gradeRefs=[...new Set(Object.values(p.assessment).flatMap(g=>g.claimIds))];
    // Current publication safety also covers evidence used outside the ranking grades.
    // Include every present visibility/article reference (even a schedule filtered from
    // display); unrelated decision evidence retains its identity check above, not a new
    // claim-current requirement. Scenario path references reach evidence through impacts.
    const visibleRefs=[...row.visibility.keyIssueEvidenceIds,...row.visibility.analysisEvidenceIds,
      ...row.visibility.impacts.flatMap(x=>x.evidenceIds),...row.visibility.risks.flatMap(x=>x.evidenceIds),
      ...row.visibility.schedule.flatMap(x=>x.evidenceIds),...row.article.version.impacts.flatMap(x=>x.evidenceIds)];
    const boundRefs=[...new Set([...gradeRefs,...(p.macroGate?.claimIds??[]),...visibleRefs])];
    for(const id of boundRefs)if(!evidence.get(id)?.verified)reject('RIGHTS_HOLD');
    const sourcesCurrent=decision.inputRevisionIds.every(currentSource);
    let evidenceCurrent=row.publication.evidenceCurrent&&sourcesCurrent&&boundRefs.every(currentClaim);
    if(!sourcesCurrent)reasons.push('SOURCE_NOT_CURRENT');
    if(at(p.evidenceValidUntil)<=cutoff||cutoff-at(p.lastVerifiedAt)>=86400000)evidenceCurrent=false;
    if(!evidenceCurrent)reasons.push('EVIDENCE_NOT_CURRENT');
    if(p.macroGate){
      const gate=p.macroGate,gateClaims=new Set(gate.claimIds);
      const gateEvidence=decision.evidence.filter(e=>gateClaims.has(e.claimId));
      if(gate.independentOriginIds.some(id=>!gateEvidence.some(e=>e.originId===id)))reject();
      // MPP2P-02: unrelated evidence from this decision cannot fill the macro independence gate.
      const macro=pipelineMacroEvidence({...decision,evidence:gateEvidence},gate.officialCoreClaimId);
      if(gate.decision!=='PASS'||!macro.allowed){evidenceCurrent=false;reasons.push('MACRO_EVIDENCE_HOLD');}
    }
    if(row.status!=='VALID'){evidenceCurrent=false;reasons.push('OBSERVATION_BLOCKED');}
    if(p.publicationState!=='PUBLISHED')reasons.push('PUBLICATION_'+p.publicationState);
    if(p.impactState!=='ACTIVE')reasons.push('IMPACT_'+p.impactState);
    // P1 fallback checks the stored deadline. Its fixed eligibility shape has no new deadline
    // field, so a newly observed hard end must also deny the current eligibility flag.
    if(p.scheduledEndAt!==null&&at(p.scheduledEndAt)<=cutoff){evidenceCurrent=false;reasons.push('SCHEDULED_END');}
    let rankable=evidenceCurrent&&reasons.length===0;
    if(rankable){
      // WITHDRAWN never crosses into the PriorityIssue enum. Optional K1 fields are emitted
      // only when present, preserving the existing command shape and all-off signal behavior.
      const {macroGate,scheduledEndAt,...base}=p;
      const candidate:PriorityIssue={...base,publicationState:'PUBLISHED',...(scheduledEndAt===null?{}:{scheduledEndAt}),...(macroGate===null?{}:{macroGate:{...macroGate,...(macroGate.officialCoreClaimId===null?{}:{officialCoreClaimId:macroGate.officialCoreClaimId})} as NonNullable<PriorityIssue['macroGate']>})};
      if(candidate.macroGate&&macroGate?.officialCoreClaimId===null)delete candidate.macroGate.officialCoreClaimId;
      const admitted=draftIssuePriority({...priority,issues:[candidate]});
      if(admitted.status!=='DRAFT_SYNTHETIC')reject();
      if(admitted.rows.length!==1){rankable=false;evidenceCurrent=false;reasons.push(...admitted.excluded.map(x=>'PRIORITY_'+x.reason));}
      else {priority.issues=[...priority.issues,candidate];sectors.push({issueId:p.issueId,primarySectorId:row.primarySectorId});}
    }
    eligibilityRows.push({issueId:p.issueId,issueVersion:row.article.version.id,publicationState:p.publicationState,impactState:p.impactState,evidenceValidUntil:p.evidenceValidUntil,evidenceCurrent});
    bindings.push({issueId:p.issueId,articleVersionId:row.article.version.id,storedDraftVersion:row.storedDraft.version,decisionId:decision.decisionId,evidenceVersion:decision.evidenceVersion,assessmentVersion:p.assessmentVersion,observationRevision:row.revision,contentId:row.contentId,rankable,reasons});
  }
  const checked=draftIssuePriority(priority);if(checked.status!=='DRAFT_SYNTHETIC')reject();
  const command:K1RankingCommand={sampleKind:'SYNTHETIC',snapshotId:b.snapshotId,expectedRevision:b.expectedRevision,profileId:b.profileId,nonpriceScaleVersion:b.nonpriceScaleVersion,sourcePolicyVersion:b.versions.sourcePolicyVersion,recipe:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',policyVersion:HOME_RANKING_POLICY,context:normalizedContext,priority,sectors}};
  const result:SyntheticRankingInputs={command,eligibility:{sampleKind:'SYNTHETIC',profileId:b.profileId,nonpriceScaleVersion:b.nonpriceScaleVersion,sourcePolicyVersion:b.versions.sourcePolicyVersion,context:{...normalizedContext,signals:{T:false,M:false,P:false}},eligibility:{knownAt:normalizedContext.cutoff,complete:true,rows:eligibilityRows}},bindingManifest:{schema:RANKABLE_BATCH_SCHEMA,sampleKind:'SYNTHETIC',fixtureAssertionOnly:true,completenessScope:'DECLARED_FIXTURE_IDS_ONLY',p1Enforced:false,executionEnabled:false,batchId:b.batchId,batchDigest:sha(b),commandDigest:sha(command),cutoff:normalizedContext.cutoff,knownDataSetVersion:known.value.knownDataSetVersion,issues:bindings,claims:claims.map(c=>({claimId:c.claim.claimId,claimVersion:c.claim.version,observationRevision:c.revision,contentId:c.contentId,sourceRevisionId:c.sourceRevisionId,evidenceVersion:c.evidenceVersion,originId:c.claim.originId,independenceGroupId:c.independenceGroupId}))}};
  // This is a pure builder: bound the complete output before returning; no ledger can be mutated.
  return pipelineData(result) as unknown as SyntheticRankingInputs;
}
