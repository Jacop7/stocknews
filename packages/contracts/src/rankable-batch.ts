/** SYNTHETIC_RANKABLE_BINDING_B1. Internal fixture contract; never exported by the app barrel.
 * Publication, evidence verification and completeness are assertions about declared fixture IDs,
 * not authenticated publication receipts, facts or a complete database snapshot. No domain/IO imports.
 */
import type {Article,PublicationState} from './index.ts';
import {PipelineError,pipelineData,pipelineCanonical,pipelineId,pipelineInstant,validatePipelineVersions,assertPipelineVersions,validateSourceRevision,validatePipelineDecision,validatePipelineDraft,type PipelineVersions,type PipelineSourceRevision,type PipelineDecision,type PipelineDraft} from './pipeline.ts';
import {projectPipelineVisibility,type K1VisibilityInput} from './pipeline-semantics.ts';

export const RANKABLE_BATCH_SCHEMA='SYNTHETIC_RANKABLE_BINDING_B1' as const;
interface Revision {revision:number;contentId:string;knownAt:string;status:'VALID'|'BLOCKED';}
interface Grade {grade:number;claimIds:string[];}
export interface RankableClaim extends Revision {
  evidenceVersion:string;sourceRevisionId:string;independenceGroupId:string|null;official:boolean;
  claim:{sampleKind:'SYNTHETIC';version:string;claimId:string;originId:string;kind:'OFFICIAL_ANNOUNCEMENT'|'FILING'|'ENACTED_POLICY'|'INDUSTRY_DATA'|'OTHER';knownAt:string;validUntil:string;verifiedAt:string;status:'VERIFIED'|'UNVERIFIED'|'RETRACTED'};
}
export interface RankablePriorityIssue {
  issueId:string;storyId:string;version:string;assessmentVersion:string;sampleKind:'SYNTHETIC';
  inputKnownAt:string;publishedAt:string;materialChangeAt:string;lastVerifiedAt:string;evidenceValidUntil:string;scheduledEndAt:string|null;
  publicationState:PublicationState;contentClass:'SECTOR_EVENT'|'SYSTEMIC_MACRO'|'AD_PROMOTION'|'IRRELEVANT'|'UNVERIFIED';
  impactState:'ACTIVE'|'CHECK_PENDING'|'RESOLVED'|'INVALIDATED';direction:'POSITIVE'|'NEGATIVE'|'MIXED'|'UNCERTAIN';scope:'SECTOR'|'MACRO_ALL';
  assessment:{transmission:Grade;breadth:Grade;magnitude:Grade;persistence:Grade};
  macroGate:null|{decision:'PASS'|'HOLD';gateVersion:string;claimIds:string[];independentOriginIds:string[];officialCoreClaimId:string|null};
}
export interface RankableIssue extends Revision {
  article:Article;storedDraft:{value:PipelineDraft;version:number};decision:PipelineDecision;visibility:K1VisibilityInput;
  publication:{kind:'SYNTHETIC_PUBLICATION_OBSERVATION';fixtureAssertionOnly:true;knownAt:string;issueId:string;articleVersionId:string;storedDraftVersion:number;evidenceVersion:string;assessmentVersion:string;publicationState:PublicationState;evidenceCurrent:boolean};
  priority:RankablePriorityIssue;primarySectorId:string|null;
}
export interface SyntheticRankableBatch {
  schema:typeof RANKABLE_BATCH_SCHEMA;sampleKind:'SYNTHETIC';fixtureAssertionOnly:true;completenessScope:'DECLARED_FIXTURE_IDS_ONLY';
  batchId:string;versions:PipelineVersions;cutoff:string;snapshotId:string;expectedRevision:number;profileId:string;nonpriceScaleVersion:string;
  /** Validated against the existing synthetic domain policy in the worker, with signals off. */
  context:unknown;
  declared:{issueIds:string[];claimIds:string[]};
  knowledge:{mode:'LOCAL_SYNTHETIC';sampleKind:'SYNTHETIC';cutoff:string;knownDataSetVersion:string;complete:true;watermarkAt:string;revisions:Array<Revision&{kind:'ISSUE'|'CLAIM';entityId:string}>};
  sources:PipelineSourceRevision[];issues:RankableIssue[];claims:RankableClaim[];
}

const states=['DRAFT','PUBLISHED','CORRECTION_PENDING','WITHDRAWN','HIDDEN'];
const sections=['KEY_ISSUES','ISSUE_ANALYSIS','SCENARIOS','BENEFIT_SECTORS','DAMAGE_SECTORS','RELATED_SECTORS','RISKS','SCHEDULE','SOURCES'];
const dimensions=['transmission','breadth','magnitude','persistence'] as const;
function bad(code:'INVALID_INPUT'|'POLICY_STALE'|'RIGHTS_HOLD'|'LIVE_NOT_ENABLED'='INVALID_INPUT'):never {throw new PipelineError(code);}
function record(v:unknown):Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v))bad();return v as Record<string,unknown>;}
function exact(v:Record<string,unknown>,keys:string[]):void {if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))bad();}
function list(v:unknown,max=300):unknown[]{if(!Array.isArray(v)||v.length>max)bad();return v;}
function ids(v:unknown):string[]{const a=list(v);if(!a.every(pipelineId)||new Set(a).size!==a.length)bad();return a as string[];}
function id(v:unknown):void {if(!pipelineId(v))bad();}
function instant(v:unknown):number {const n=pipelineInstant(v);if(!Number.isFinite(n))bad();return n;}
function integer(v:unknown,min=0):void {if(!Number.isSafeInteger(v)||Number(v)<min)bad();}
function text(v:unknown,max:number):void {if(typeof v!=='string'||!v.trim()||v.length>max)bad();}
function one(v:unknown,values:readonly string[]):void {if(typeof v!=='string'||!values.includes(v))bad();}
function equal(a:unknown,b:unknown):void {if(pipelineCanonical(a)!==pipelineCanonical(b))bad();}
function sameTime(a:unknown,b:unknown):void {if(instant(a)!==instant(b))bad();}
function revision(v:Record<string,unknown>):void {integer(v.revision,1);id(v.contentId);instant(v.knownAt);one(v.status,['VALID','BLOCKED']);}

function validateArticle(raw:unknown):Article {
  const a=record(raw);exact(a,['issue','version']);const i=record(a.issue),v=record(a.version);
  exact(i,['id','storyId','publication_state','scheduled_publish_at','first_published_at','material_change_at','currentVersionId']);
  id(i.id);id(i.storyId);one(i.publication_state,states);id(i.currentVersionId);
  for(const key of ['scheduled_publish_at','first_published_at','material_change_at'])if(i[key]!==null)instant(i[key]);
  // B1 binds existing article versions, including currently withdrawn ones. Unpublished drafts
  // without original publication times are not promoted into this contract.
  if(i.first_published_at===null||i.material_change_at===null||instant(i.first_published_at)>instant(i.material_change_at))bad('RIGHTS_HOLD');
  exact(v,['id','issueId','title','summary','source_market','selection_market_basis','analysis_perspective','evidence_as_of','impact_profile','visibility_policy_version','impacts','visible_sections','sourceIds']);
  id(v.id);id(v.issueId);text(v.title,500);text(v.summary,4000);id(v.source_market);one(v.selection_market_basis,['KR','FOREIGN_US']);one(v.analysis_perspective,['KR_EQUITY']);instant(v.evidence_as_of);
  one(v.impact_profile,['POSITIVE_ONLY','POSITIVE_NEGATIVE','DAMAGE_ONLY','RELATED_CONDITIONAL']);id(v.visibility_policy_version);ids(v.sourceIds);
  for(const section of ids(v.visible_sections))one(section,sections);
  const paths=new Set<string>();
  for(const rawImpact of list(v.impacts)){
    const x=record(rawImpact);exact(x,['sectorId','direction','pathId','conditions','companyIds','evidenceIds']);id(x.sectorId);id(x.pathId);one(x.direction,['BENEFIT','DAMAGE','RELATED']);
    if(paths.has(x.pathId as string))bad();paths.add(x.pathId as string);ids(x.companyIds);ids(x.evidenceIds);for(const condition of list(x.conditions))text(condition,4000);
  }
  if(i.id!==v.issueId||i.currentVersionId!==v.id)bad();return a as unknown as Article;
}
function validatePriority(raw:unknown):RankablePriorityIssue {
  const p=record(raw);exact(p,['issueId','storyId','version','assessmentVersion','sampleKind','inputKnownAt','publishedAt','materialChangeAt','lastVerifiedAt','evidenceValidUntil','scheduledEndAt','publicationState','contentClass','impactState','direction','scope','assessment','macroGate']);
  for(const key of ['issueId','storyId','version','assessmentVersion'])id(p[key]);if(p.sampleKind!=='SYNTHETIC')bad('LIVE_NOT_ENABLED');
  const published=instant(p.publishedAt),changed=instant(p.materialChangeAt),verified=instant(p.lastVerifiedAt),expires=instant(p.evidenceValidUntil);instant(p.inputKnownAt);
  if(changed<published||verified<changed||expires<=verified||expires-verified>86400000)bad();if(p.scheduledEndAt!==null&&instant(p.scheduledEndAt)<published)bad();
  one(p.publicationState,states);one(p.contentClass,['SECTOR_EVENT','SYSTEMIC_MACRO','AD_PROMOTION','IRRELEVANT','UNVERIFIED']);one(p.impactState,['ACTIVE','CHECK_PENDING','RESOLVED','INVALIDATED']);one(p.direction,['POSITIVE','NEGATIVE','MIXED','UNCERTAIN']);one(p.scope,['SECTOR','MACRO_ALL']);
  const assessment=record(p.assessment);exact(assessment,[...dimensions]);
  for(const dim of dimensions){const g=record(assessment[dim]);exact(g,['grade','claimIds']);integer(g.grade);if(Number(g.grade)>5)bad();ids(g.claimIds);if(Number(g.grade)>0&&!(g.claimIds as string[]).length)bad('RIGHTS_HOLD');}
  if(p.macroGate!==null){const g=record(p.macroGate);exact(g,['decision','gateVersion','claimIds','independentOriginIds','officialCoreClaimId']);one(g.decision,['PASS','HOLD']);id(g.gateVersion);const refs=ids(g.claimIds);ids(g.independentOriginIds);if(g.officialCoreClaimId!==null){id(g.officialCoreClaimId);if(!refs.includes(g.officialCoreClaimId as string))bad();}}
  if((p.scope==='MACRO_ALL')!==(p.contentClass==='SYSTEMIC_MACRO')||p.scope==='MACRO_ALL'&&p.macroGate===null||p.scope==='SECTOR'&&p.macroGate!==null)bad();
  return p as unknown as RankablePriorityIssue;
}

/** Strict data/identity validation only. Domain selection, macro gate and command assembly live in the worker. */
export function validateSyntheticRankableBatch(raw:unknown):SyntheticRankableBatch {
  let data:unknown;try{data=pipelineData(raw);}catch(e){if(e instanceof PipelineError)throw e;return bad();}
  const b=record(data);exact(b,['schema','sampleKind','fixtureAssertionOnly','completenessScope','batchId','versions','cutoff','snapshotId','expectedRevision','profileId','nonpriceScaleVersion','context','declared','knowledge','sources','issues','claims']);
  if(b.schema!==RANKABLE_BATCH_SCHEMA||b.fixtureAssertionOnly!==true||b.completenessScope!=='DECLARED_FIXTURE_IDS_ONLY')bad();if(b.sampleKind!=='SYNTHETIC')bad('LIVE_NOT_ENABLED');
  for(const key of ['batchId','snapshotId','profileId','nonpriceScaleVersion'])id(b[key]);integer(b.expectedRevision);const cutoff=instant(b.cutoff);if(cutoff%300000!==0)bad();record(b.context);
  const versions=validatePipelineVersions(b.versions),declared=record(b.declared);exact(declared,['issueIds','claimIds']);const issueIds=ids(declared.issueIds),claimIds=ids(declared.claimIds);
  const knowledge=record(b.knowledge);exact(knowledge,['mode','sampleKind','cutoff','knownDataSetVersion','complete','watermarkAt','revisions']);
  if(knowledge.mode!=='LOCAL_SYNTHETIC'||knowledge.sampleKind!=='SYNTHETIC')bad('LIVE_NOT_ENABLED');id(knowledge.knownDataSetVersion);sameTime(knowledge.cutoff,b.cutoff);sameTime(knowledge.watermarkAt,b.cutoff);if(knowledge.complete!==true)bad('RIGHTS_HOLD');
  const refs=new Map<string,Record<string,unknown>>();
  for(const rawRef of list(knowledge.revisions,600)){
    const r=record(rawRef);exact(r,['kind','entityId','revision','contentId','knownAt','status']);revision(r);one(r.kind,['ISSUE','CLAIM']);id(r.entityId);
    if(!(r.kind==='ISSUE'?issueIds:claimIds).includes(r.entityId as string))bad();const key=JSON.stringify([r.kind,r.entityId,r.revision]);if(refs.has(key))bad();refs.set(key,r);
  }
  const sources=new Map<string,PipelineSourceRevision>();
  for(const rawSource of list(b.sources)){const s=validateSourceRevision(rawSource);assertPipelineVersions(s,versions);if(sources.has(s.revisionId))bad();sources.set(s.revisionId,s);}
  const observed=new Set<string>(),observedContent=new Set<string>(),seenIssues=new Set<string>(),seenClaims=new Set<string>();
  const bindRef=(kind:'ISSUE'|'CLAIM',entityId:string,row:Record<string,unknown>)=>{
    revision(row);if(!(kind==='ISSUE'?issueIds:claimIds).includes(entityId))bad();const key=JSON.stringify([kind,entityId,row.revision]),ref=refs.get(key);
    if(!ref||observed.has(key)||observedContent.has(row.contentId as string)||ref.contentId!==row.contentId||ref.status!==row.status)bad();sameTime(ref.knownAt,row.knownAt);observed.add(key);observedContent.add(row.contentId as string);(kind==='ISSUE'?seenIssues:seenClaims).add(entityId);
  };
  for(const rawClaim of list(b.claims)){
    const c=record(rawClaim);exact(c,['revision','contentId','knownAt','status','evidenceVersion','sourceRevisionId','independenceGroupId','official','claim']);
    id(c.evidenceVersion);id(c.sourceRevisionId);if(c.independenceGroupId!==null)id(c.independenceGroupId);if(typeof c.official!=='boolean')bad();
    const p=record(c.claim);exact(p,['sampleKind','version','claimId','originId','kind','knownAt','validUntil','verifiedAt','status']);if(p.sampleKind!=='SYNTHETIC')bad('LIVE_NOT_ENABLED');for(const key of ['version','claimId','originId'])id(p[key]);
    one(p.kind,['OFFICIAL_ANNOUNCEMENT','FILING','ENACTED_POLICY','INDUSTRY_DATA','OTHER']);one(p.status,['VERIFIED','UNVERIFIED','RETRACTED']);const known=instant(p.knownAt),verified=instant(p.verifiedAt),until=instant(p.validUntil);
    if(verified<known||until<=verified||instant(c.knownAt)<verified)bad();
    const source=sources.get(c.sourceRevisionId as string);if(!source||p.originId!==source.originId||c.independenceGroupId!==source.independenceGroupId||instant(source.collectedAt)>instant(c.knownAt))bad();
    bindRef('CLAIM',p.claimId as string,c);
  }
  const lineage=new Map<string,RankableIssue[]>(),articleOwners=new Map<string,string>();
  for(const rawIssue of list(b.issues)){
    const row=record(rawIssue);exact(row,['revision','contentId','knownAt','status','article','storedDraft','decision','visibility','publication','priority','primarySectorId']);
    const article=validateArticle(row.article),stored=record(row.storedDraft);exact(stored,['value','version']);integer(stored.version,1);const draft=validatePipelineDraft(stored.value),decision=validatePipelineDecision(row.decision);assertPipelineVersions(draft,versions);assertPipelineVersions(decision,versions);
    if(decision.decision!=='COLLECT')bad('RIGHTS_HOLD');if(stored.version!==draft.expectedArticleVersion+1||draft.decisionId!==decision.decisionId||draft.evidenceVersion!==decision.evidenceVersion)bad();
    const priority=validatePriority(row.priority),publication=record(row.publication);exact(publication,['kind','fixtureAssertionOnly','knownAt','issueId','articleVersionId','storedDraftVersion','evidenceVersion','assessmentVersion','publicationState','evidenceCurrent']);
    if(publication.kind!=='SYNTHETIC_PUBLICATION_OBSERVATION'||publication.fixtureAssertionOnly!==true||typeof publication.evidenceCurrent!=='boolean')bad();
    if(publication.issueId!==article.issue.id||draft.issueId!==article.issue.id||priority.issueId!==article.issue.id||draft.storyId!==article.issue.storyId||priority.storyId!==article.issue.storyId||publication.articleVersionId!==article.version.id||priority.version!==article.version.id||publication.storedDraftVersion!==stored.version||publication.evidenceVersion!==draft.evidenceVersion||publication.assessmentVersion!==priority.assessmentVersion||publication.publicationState!==article.issue.publication_state||priority.publicationState!==article.issue.publication_state)bad();
    if(decision.issueCandidateKey!==null&&decision.issueCandidateKey!==article.issue.id)bad();
    sameTime(publication.knownAt,row.knownAt);sameTime(priority.publishedAt,article.issue.first_published_at);sameTime(priority.materialChangeAt,article.issue.material_change_at);sameTime(draft.firstPublishedAt,priority.publishedAt);sameTime(draft.materialChangeAt,priority.materialChangeAt);
    if(instant(priority.inputKnownAt)>instant(row.knownAt)||instant(priority.materialChangeAt)>instant(row.knownAt)||instant(priority.lastVerifiedAt)>instant(row.knownAt)||instant(decision.knownAt)>instant(row.knownAt)||instant(article.version.evidence_as_of)>instant(priority.lastVerifiedAt))bad();
    if(article.version.title!==draft.title||article.version.summary!==draft.summary||article.version.visibility_policy_version!==versions.policyVersion)bad();
    const owner=articleOwners.get(article.version.id);if(owner!==undefined&&owner!==article.issue.id)bad();articleOwners.set(article.version.id,article.issue.id);
    for(const ref of decision.inputRevisionIds){const source=sources.get(ref);if(!source||instant(source.collectedAt)>instant(decision.knownAt))bad();}
    const sourceIds=[...new Set(decision.inputRevisionIds.map(ref=>sources.get(ref)!.sourceId))].sort();equal([...article.version.sourceIds].sort(),sourceIds);
    const visibility=projectPipelineVisibility(row.visibility,decision);if(instant(visibility.asOf)>instant(row.knownAt)||article.version.impact_profile!==visibility.impactProfile)bad();equal(article.version.visible_sections,visibility.visibleSections);equal(draft.visibleSections,visibility.visibleSections);
    equal(article.version.impacts.map(x=>({sectorId:x.sectorId,pathId:x.pathId,direction:x.direction,evidenceIds:x.evidenceIds})),visibility.impacts.map(x=>({sectorId:x.sectorId,pathId:x.pathId,direction:x.direction,evidenceIds:x.evidenceIds})));
    if(row.primarySectorId!==null)id(row.primarySectorId);if((priority.scope==='MACRO_ALL')!==(row.primarySectorId===null))bad();
    bindRef('ISSUE',article.issue.id,row);const history=lineage.get(article.issue.id)??[];history.push(row as unknown as RankableIssue);lineage.set(article.issue.id,history);
  }
  if(observed.size!==refs.size||seenIssues.size!==issueIds.length||seenClaims.size!==claimIds.length)bad('RIGHTS_HOLD');
  for(const history of lineage.values()){
    history.sort((a,b)=>a.revision-b.revision);
    const articleContents=new Map<string,string>(),draftBindings=new Map<number,string>();
    for(const row of history){
      const content=pipelineCanonical(row.article.version),binding=pipelineCanonical({articleVersionId:row.article.version.id,draft:row.storedDraft.value});
      if(articleContents.has(row.article.version.id)&&articleContents.get(row.article.version.id)!==content||draftBindings.has(row.storedDraft.version)&&draftBindings.get(row.storedDraft.version)!==binding)bad();
      articleContents.set(row.article.version.id,content);draftBindings.set(row.storedDraft.version,binding);
    }
    for(let n=1;n<history.length;n++){
      const old=history[n-1],next=history[n];
      if(old.article.issue.storyId!==next.article.issue.storyId)bad();sameTime(old.priority.publishedAt,next.priority.publishedAt);
      if(instant(next.priority.materialChangeAt)<instant(old.priority.materialChangeAt)||next.storedDraft.version<old.storedDraft.version)bad();
      if(old.article.version.id===next.article.version.id){equal(old.article.version,next.article.version);sameTime(old.priority.materialChangeAt,next.priority.materialChangeAt);if(old.storedDraft.version!==next.storedDraft.version)bad();}
    }
  }
  return b as unknown as SyntheticRankableBatch;
}
