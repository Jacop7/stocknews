import test from 'node:test';
import assert from 'node:assert/strict';
import {RANKABLE_BATCH_SCHEMA,validateSyntheticRankableBatch,type SyntheticRankableBatch,type RankableClaim} from '../packages/contracts/src/rankable-batch.ts';
import {buildSyntheticRankingInputs} from '../workers/home-ranking/src/rankable-adapter.ts';
import {SyntheticHomeWorkerAdapter,HOME_WORKER_SCHEMA} from '../workers/home-ranking/src/completed-adapter.ts';
import {PipelineError,PIPELINE_CONTRACT,pipelineMacroEvidence,type PipelineSourceRevision} from '../packages/contracts/src/pipeline.ts';
import {SNAPSHOT_POLICY,selectKnownRevisions} from '../packages/domain/src/home-snapshot.ts';
import {selectPipelineSources} from '../packages/contracts/src/pipeline-semantics.ts';

const BASE=Date.parse('2026-11-15T23:00:00Z'),at=(m:number)=>new Date(BASE+m*60000).toISOString();
const code=(expected?:string)=>(e:unknown)=>e instanceof PipelineError&&(expected===undefined||e.code===expected);
const versions={contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC' as const,policyVersion:'binding-policy-v1',catalogVersion:'catalog-v1',sourcePolicyVersion:'SYNTHETIC_SOURCE_V1'};
function source(id='claim',group='group'):PipelineSourceRevision {
  return {...versions,sourceDocumentId:'doc-'+id,revisionId:'source-revision-'+id,sourceId:'source-'+id,endpointId:'endpoint-'+id,publisherId:'publisher-'+id,originId:'origin-'+id,independenceGroupId:group,canonicalUrl:'https://news.synthetic.invalid/'+id,nativeId:'native-'+id,collectedAt:at(-120),publishedAt:at(-180),updatedAt:null,timeQuality:'KNOWN',contentHash:'a'.repeat(64),title:'Synthetic source',lead:'Synthetic evidence',bodyRef:'fixture:/source/'+id,permissionVersion:'permission-v1'};
}
function claimFor(s:PipelineSourceRevision,id='claim'):RankableClaim {
  return {revision:1,contentId:'claim-content-'+id,knownAt:at(-90),status:'VALID',evidenceVersion:'evidence-v1',sourceRevisionId:s.revisionId,independenceGroupId:s.independenceGroupId,official:false,claim:{sampleKind:'SYNTHETIC',version:'claim-version-'+id,claimId:id,originId:s.originId!,kind:'FILING',knownAt:at(-120),validUntil:at(1000),verifiedAt:at(-100),status:'VERIFIED'}};
}
function knowledge(b:SyntheticRankableBatch) {
  b.knowledge.revisions=[...b.issues.map(x=>({kind:'ISSUE' as const,entityId:x.article.issue.id,revision:x.revision,contentId:x.contentId,knownAt:x.knownAt,status:x.status})),...b.claims.map(x=>({kind:'CLAIM' as const,entityId:x.claim.claimId,revision:x.revision,contentId:x.contentId,knownAt:x.knownAt,status:x.status}))];
}
function fixture(minutes=10,expectedRevision=0):SyntheticRankableBatch {
  const s=source(),sections=['KEY_ISSUES','ISSUE_ANALYSIS','RELATED_SECTORS','SOURCES'] as const;
  const b:SyntheticRankableBatch={schema:RANKABLE_BATCH_SCHEMA,sampleKind:'SYNTHETIC',fixtureAssertionOnly:true,completenessScope:'DECLARED_FIXTURE_IDS_ONLY',batchId:'batch-'+minutes,versions:{...versions},cutoff:at(minutes),snapshotId:'snapshot-'+minutes,expectedRevision,profileId:'SYNTHETIC_PROFILE_V1',nonpriceScaleVersion:'SYNTHETIC_SCALE_V1',context:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:at(minutes),policyVersion:SNAPSHOT_POLICY,catalogVersion:versions.catalogVersion,comparisonSetVersion:'compare-v1',evaluationSetVersion:'eval-v1',calendar:{calendarVersion:'calendar-v1',evidenceId:'SYNTHETIC',knownAt:'2026-11-01T00:00:00Z',validUntil:'2026-12-01T00:00:00Z',coverageStart:'2026-11-13',coverageEnd:'2026-11-23',days:Array.from({length:11},(_,n)=>({date:new Date(Date.parse('2026-11-13T00:00:00Z')+n*86400000).toISOString().slice(0,10),state:[1,2,8,9].includes(n)?'CLOSED':'OPEN'}))}},declared:{issueIds:['issue'],claimIds:['claim']},knowledge:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:at(minutes),knownDataSetVersion:'known-set-v1',complete:true,watermarkAt:at(minutes),revisions:[]},sources:[s],claims:[claimFor(s)],issues:[{
    revision:1,contentId:'issue-content-v1',knownAt:at(0),status:'VALID',
    article:{issue:{id:'issue',storyId:'story',publication_state:'PUBLISHED',scheduled_publish_at:null,first_published_at:at(-120),material_change_at:at(-100),currentVersionId:'article-v1'},version:{id:'article-v1',issueId:'issue',title:'Synthetic article',summary:'Synthetic summary',source_market:'KR',selection_market_basis:'KR',analysis_perspective:'KR_EQUITY',evidence_as_of:at(-30),impact_profile:'RELATED_CONDITIONAL',visibility_policy_version:versions.policyVersion,impacts:[{sectorId:'sector',direction:'RELATED',pathId:'path',conditions:[],companyIds:[],evidenceIds:['claim']}],visible_sections:[...sections],sourceIds:[s.sourceId]}},
    storedDraft:{version:1,value:{...versions,issueId:'issue',storyId:'story',decisionId:'decision',expectedArticleVersion:0,title:'Synthetic article',summary:'Synthetic summary',bodyRef:'fixture:/article/body',visibleSections:[...sections],evidenceVersion:'evidence-v1',firstPublishedAt:at(-120),materialChangeAt:at(-100)}},
    decision:{...versions,decisionId:'decision',inputRevisionIds:[s.revisionId],storyCandidateKey:'story-candidate',issueCandidateKey:'issue',decision:'COLLECT',action:'UPDATE',reason:'SYNTHETIC_FIXTURE',wakeCondition:null,deadline:null,knownAt:at(-80),evidence:[{claimId:'claim',revisionId:s.revisionId,originId:s.originId,groupId:s.independenceGroupId,official:false,verified:true}],generatorVersion:'generator-v1',promptVersion:'prompt-v1',evidenceVersion:'evidence-v1'},
    visibility:{sampleKind:'SYNTHETIC',evidenceVersion:'evidence-v1',asOf:at(-30),keyIssueEvidenceIds:['claim'],analysisEvidenceIds:['claim'],impacts:[{sectorId:'sector',pathId:'path',direction:'RELATED',conditionalDirection:'NONE',evidenceIds:['claim']}],scenarios:[],risks:[],schedule:[]},
    publication:{kind:'SYNTHETIC_PUBLICATION_OBSERVATION',fixtureAssertionOnly:true,knownAt:at(0),issueId:'issue',articleVersionId:'article-v1',storedDraftVersion:1,evidenceVersion:'evidence-v1',assessmentVersion:'assessment-v1',publicationState:'PUBLISHED',evidenceCurrent:true},
    priority:{issueId:'issue',storyId:'story',version:'article-v1',assessmentVersion:'assessment-v1',sampleKind:'SYNTHETIC',inputKnownAt:at(-30),publishedAt:at(-120),materialChangeAt:at(-100),lastVerifiedAt:at(-30),evidenceValidUntil:at(1000),scheduledEndAt:null,publicationState:'PUBLISHED',contentClass:'SECTOR_EVENT',impactState:'ACTIVE',direction:'POSITIVE',scope:'SECTOR',assessment:{transmission:{grade:5,claimIds:['claim']},breadth:{grade:5,claimIds:['claim']},magnitude:{grade:5,claimIds:['claim']},persistence:{grade:5,claimIds:['claim']}},macroGate:null},primarySectorId:'sector'
  }]};knowledge(b);return b;
}
function state(b:SyntheticRankableBatch,value:'WITHDRAWN'|'HIDDEN'|'CORRECTION_PENDING'|'DRAFT') {
  const row=b.issues[0];row.article.issue.publication_state=value;row.publication.publicationState=value;row.priority.publicationState=value;
}
function workerCall(w:SyntheticHomeWorkerAdapter,operation:string,payload:unknown=null) {
  return w.dispatch({schema:HOME_WORKER_SCHEMA,sampleKind:'SYNTHETIC',operation,payload});
}
function addClaim(b:SyntheticRankableBatch,id:string,group:string) {
  const s=source(id,group),c=claimFor(s,id),row=b.issues[0];b.sources.push(s);b.claims.push(c);b.declared.claimIds.push(id);
  row.decision.inputRevisionIds.push(s.revisionId);row.decision.evidence.push({claimId:id,revisionId:s.revisionId,originId:s.originId,groupId:s.independenceGroupId,official:false,verified:true});row.article.version.sourceIds.push(s.sourceId);knowledge(b);
}
function macro(groups:string[],extra=false) {
  const b=fixture();b.sources[0].independenceGroupId=groups[0];b.claims[0].independenceGroupId=groups[0];b.issues[0].decision.evidence[0].groupId=groups[0];
  for(let n=1;n<groups.length;n++)addClaim(b,'bound'+n,groups[n]);
  const row=b.issues[0],refs=[...b.declared.claimIds];row.primarySectorId=null;row.priority.scope='MACRO_ALL';row.priority.contentClass='SYSTEMIC_MACRO';row.priority.macroGate={decision:'PASS',gateVersion:'gate-v1',claimIds:refs,independentOriginIds:b.claims.map(c=>c.claim.originId),officialCoreClaimId:null};
  for(const g of Object.values(row.priority.assessment))g.claimIds=[...refs];
  if(extra)for(let n=0;n<3;n++)addClaim(b,'unrelated'+n,'unrelated-group'+n);
  return b;
}

test('explicit fixture binding compiles to all-off K1 and completes/restores through unchanged P1',()=>{
  const b=fixture(),validated=validateSyntheticRankableBatch(b),inputs=buildSyntheticRankingInputs(b),w=new SyntheticHomeWorkerAdapter();
  assert.deepEqual(validated,b);assert.deepEqual(buildSyntheticRankingInputs(JSON.parse(JSON.stringify(b))),inputs);
  assert.equal(inputs.command.recipe.priority.signals,undefined);assert.deepEqual(inputs.eligibility.context.signals,{T:false,M:false,P:false});
  assert.equal(inputs.command.recipe.priority.issues[0].version,b.issues[0].article.version.id);assert.equal(inputs.eligibility.eligibility.rows[0].issueVersion,'article-v1');
  assert.equal(inputs.bindingManifest.fixtureAssertionOnly,true);assert.equal(inputs.bindingManifest.p1Enforced,false);assert.equal(inputs.bindingManifest.executionEnabled,false);assert.equal(inputs.bindingManifest.completenessScope,'DECLARED_FIXTURE_IDS_ONLY');
  assert.match(inputs.bindingManifest.batchDigest,/^[a-f0-9]{64}$/);assert.match(inputs.bindingManifest.commandDigest,/^[a-f0-9]{64}$/);
  assert.equal(workerCall(w,'PROPOSE',inputs.command).operation,'PROPOSE');assert.equal(workerCall(w,'READ_LATEST').result,null);
  const done=workerCall(w,'COMPLETE',{snapshotId:b.snapshotId,expectedRevision:0});assert.equal(done.operation,'COMPLETE');
  if(done.operation!=='COMPLETE')assert.fail();assert.equal(done.result.snapshot.result.lanes.B[0].issueVersion,'article-v1');assert.deepEqual(done.result.snapshot.result.context!.signals,{T:false,M:false,P:false});
  const saved=workerCall(w,'EXPORT_STATE'),restored=new SyntheticHomeWorkerAdapter();assert.equal(workerCall(restored,'RESTORE_STATE',JSON.parse(JSON.stringify(saved.result))).result,null);
  assert.deepEqual(workerCall(restored,'READ_LATEST'),workerCall(w,'READ_LATEST'));
  assert.ok(workerCall(restored,'FALLBACK',inputs.eligibility).result);
  const next=buildSyntheticRankingInputs(fixture(15,1));workerCall(restored,'PROPOSE',next.command);assert.equal(workerCall(restored,'COMPLETE',{snapshotId:'snapshot-15',expectedRevision:1}).operation,'COMPLETE');
});

test('draft, COLLECT or visibility alone cannot invent the mandatory publication assertion',()=>{
  for(const mutate of [
    (b:any)=>delete b.issues[0].publication,
    (b:any)=>b.issues[0].publication.fixtureAssertionOnly=false,
    (b:any)=>b.issues[0].publication.kind='REAL_PUBLICATION_RECEIPT',
    (b:any)=>b.issues[0].decision.decision='PASS',
    (b:any)=>{b.issues[0].article.issue.first_published_at=null;b.issues[0].article.issue.material_change_at=null;state(b,'DRAFT');}
  ]){const b=fixture();mutate(b);assert.throws(()=>buildSyntheticRankingInputs(b),code());}
  const draft=fixture();state(draft,'DRAFT');const out=buildSyntheticRankingInputs(draft);assert.equal(out.command.recipe.priority.issues.length,0);assert.equal(out.eligibility.eligibility.rows[0].publicationState,'DRAFT');
});

test('numeric stored draft and string article IDs require explicit binding, not conversion',()=>{
  const b=fixture();b.issues[0].storedDraft.version=8;b.issues[0].storedDraft.value.expectedArticleVersion=7;b.issues[0].publication.storedDraftVersion=8;
  assert.equal(buildSyntheticRankingInputs(b).bindingManifest.issues[0].storedDraftVersion,8);assert.equal(buildSyntheticRankingInputs(b).command.recipe.priority.issues[0].version,'article-v1');
  for(const mutate of [(x:any)=>x.issues[0].publication.storedDraftVersion='8',(x:any)=>x.issues[0].priority.version='8',(x:any)=>x.issues[0].publication.articleVersionId='8',(x:any)=>x.issues[0].storedDraft.value.expectedArticleVersion=8]){
    const bad=structuredClone(b);mutate(bad);assert.throws(()=>buildSyntheticRankingInputs(bad),code());
  }
});

test('story, issue, current article, decision, evidence, assessment and policy mismatches reject',()=>{
  const mutations=[
    (b:any)=>b.issues[0].article.issue.storyId='other-story',
    (b:any)=>b.issues[0].article.version.issueId='other-issue',
    (b:any)=>b.issues[0].article.issue.currentVersionId='other-article',
    (b:any)=>b.issues[0].storedDraft.value.decisionId='other-decision',
    (b:any)=>b.issues[0].publication.evidenceVersion='other-evidence',
    (b:any)=>b.issues[0].priority.assessmentVersion='other-assessment',
    (b:any)=>b.issues[0].visibility.evidenceVersion='other-evidence',
    (b:any)=>b.issues[0].article.version.title='other-title',
    (b:any)=>b.issues[0].article.version.visibility_policy_version='other-policy',
    (b:any)=>b.issues[0].storedDraft.value.catalogVersion='other-catalog',
    (b:any)=>b.sources[0].sourcePolicyVersion='other-source-policy',
    (b:any)=>b.issues[0].priority.publicationState='HIDDEN',
    (b:any)=>b.claims[0].evidenceVersion='other-evidence'
  ];
  for(const mutate of mutations){const b=fixture();mutate(b);assert.throws(()=>buildSyntheticRankingInputs(b),code());}
});

test('declared fixture IDs, observations and knowledge form an exact complete set',()=>{
  const mutations=[
    (b:any)=>b.declared.issueIds.push('missing'),(b:any)=>b.declared.claimIds.push('missing'),
    (b:any)=>b.declared.issueIds.push('issue'),(b:any)=>b.declared.claimIds=[],
    (b:any)=>b.issues=[],(b:any)=>b.claims=[],(b:any)=>b.knowledge.revisions.pop(),
    (b:any)=>b.knowledge.revisions.push(structuredClone(b.knowledge.revisions[0])),
    (b:any)=>b.issues.push(structuredClone(b.issues[0])),(b:any)=>b.claims.push(structuredClone(b.claims[0])),
    (b:any)=>b.knowledge.revisions[0].contentId='wrong-content',
    (b:any)=>b.knowledge.revisions[0].knownAt=at(1),
    (b:any)=>b.knowledge.complete=false,(b:any)=>b.knowledge.watermarkAt=at(5),
    (b:any)=>b.knowledge.revisions[0].kind='QUOTE',
    (b:any)=>{b.claims[0].contentId=b.issues[0].contentId;knowledge(b);}
  ];
  for(const mutate of mutations){const b=fixture();mutate(b);assert.throws(()=>buildSyntheticRankingInputs(b),code());}
});

test('existing selectKnownRevisions excludes cutoff-late issue/claim corrections and rejects time reversal',()=>{
  const original=fixture(),b=fixture(),lateIssue=structuredClone(b.issues[0]),lateClaim=structuredClone(b.claims[0]);
  lateIssue.revision=2;lateIssue.contentId='issue-content-v2';lateIssue.knownAt=at(20);lateIssue.publication.knownAt=at(20);lateIssue.article.issue.publication_state='WITHDRAWN';lateIssue.priority.publicationState='WITHDRAWN';lateIssue.publication.publicationState='WITHDRAWN';
  lateClaim.revision=2;lateClaim.contentId='claim-content-v2';lateClaim.knownAt=at(20);lateClaim.claim.status='RETRACTED';
  b.issues.push(lateIssue);b.claims.push(lateClaim);knowledge(b);
  const selected=selectKnownRevisions(b.knowledge);assert.equal(selected.status,'DRAFT_SYNTHETIC');if(selected.status!=='DRAFT_SYNTHETIC')assert.fail();assert.ok(selected.value.selected.every(x=>x.revision===1));
  assert.deepEqual(buildSyntheticRankingInputs(b).command,buildSyntheticRankingInputs(original).command);
  b.cutoff=at(25);(b.context as any).cutoff=at(25);b.knowledge.cutoff=at(25);b.knowledge.watermarkAt=at(25);
  const out=buildSyntheticRankingInputs(b);assert.equal(out.command.recipe.priority.issues.length,0);assert.equal(out.eligibility.eligibility.rows[0].publicationState,'WITHDRAWN');assert.equal(out.eligibility.eligibility.rows[0].evidenceCurrent,false);
  const reversed=fixture();const r=structuredClone(reversed.claims[0]);r.revision=2;r.contentId='reverse';r.knownAt=at(-110);r.claim.verifiedAt=at(-115);reversed.claims.push(r);knowledge(reversed);assert.throws(()=>buildSyntheticRankingInputs(reversed),code('RIGHTS_HOLD'));
  const onlyFuture=fixture();onlyFuture.issues[0].knownAt=at(20);onlyFuture.issues[0].publication.knownAt=at(20);knowledge(onlyFuture);assert.throws(()=>buildSyntheticRankingInputs(onlyFuture),code('RIGHTS_HOLD'));
});

test('source selection reuses collectedAt and source-time rules; later correction never leaks backwards',()=>{
  const b=fixture(),late=structuredClone(b.sources[0]);late.revisionId='source-correction';late.collectedAt=at(20);late.updatedAt=at(-60);late.contentHash='b'.repeat(64);b.sources.push(late);
  assert.equal(selectPipelineSources(b.sources,b.versions,b.cutoff)[0].revision!.revisionId,b.sources[0].revisionId);
  assert.equal(buildSyntheticRankingInputs(b).command.recipe.priority.issues.length,1);
  b.cutoff=at(25);(b.context as any).cutoff=at(25);b.knowledge.cutoff=at(25);b.knowledge.watermarkAt=at(25);
  assert.equal(selectPipelineSources(b.sources,b.versions,b.cutoff)[0].revision!.revisionId,'source-correction');
  const out=buildSyntheticRankingInputs(b);assert.equal(out.command.recipe.priority.issues.length,0);assert.equal(out.eligibility.eligibility.rows[0].evidenceCurrent,false);
  assert.equal(b.issues[0].publication.evidenceCurrent,true);
  const conflict=fixture(),tie=structuredClone(conflict.sources[0]);tie.revisionId='source-conflict';tie.contentHash='c'.repeat(64);conflict.sources.push(tie);
  assert.equal(selectPipelineSources(conflict.sources,conflict.versions,conflict.cutoff)[0].status,'CONFLICT_SAME_TIME');assert.equal(buildSyntheticRankingInputs(conflict).command.recipe.priority.issues.length,0);
});

test('every decision input source is required and current, including inputs outside grade evidence',()=>{
  const b=fixture(),extra=source('additional','additional-group');b.sources.push(extra);b.issues[0].decision.inputRevisionIds.push(extra.revisionId);b.issues[0].article.version.sourceIds.push(extra.sourceId);
  assert.equal(buildSyntheticRankingInputs(b).command.recipe.priority.issues.length,1);
  const missing=structuredClone(b);missing.sources.pop();assert.throws(()=>buildSyntheticRankingInputs(missing),code('INVALID_INPUT'));
  const correction=structuredClone(extra);correction.revisionId='additional-correction';correction.updatedAt=at(-60);correction.collectedAt=at(5);correction.contentHash='d'.repeat(64);b.sources.push(correction);
  const out=buildSyntheticRankingInputs(b);assert.equal(b.issues[0].publication.evidenceCurrent,true);assert.equal(out.command.recipe.priority.issues.length,0);assert.equal(out.eligibility.eligibility.rows[0].evidenceCurrent,false);assert.ok(out.bindingManifest.issues[0].reasons.includes('SOURCE_NOT_CURRENT'));
});

test('current WITHDRAWN, hidden, correction, impact and validity checks block candidates and fallback',()=>{
  const w=new SyntheticHomeWorkerAdapter(),base=fixture(),initial=buildSyntheticRankingInputs(base);workerCall(w,'PROPOSE',initial.command);workerCall(w,'COMPLETE',{snapshotId:base.snapshotId,expectedRevision:0});
  for(const status of ['WITHDRAWN','HIDDEN','CORRECTION_PENDING'] as const){const b=fixture();state(b,status);const out=buildSyntheticRankingInputs(b);assert.equal(out.command.recipe.priority.issues.length,0);assert.equal(out.eligibility.eligibility.rows[0].publicationState,status);assert.equal(workerCall(w,'FALLBACK',out.eligibility).result,null);assert.ok(!JSON.stringify(out).includes('RETRACTED'));}
  for(const mutate of [(b:any)=>b.issues[0].priority.impactState='RESOLVED',(b:any)=>b.issues[0].priority.impactState='CHECK_PENDING',(b:any)=>b.issues[0].priority.evidenceValidUntil=at(10),(b:any)=>b.claims[0].claim.validUntil=at(10),(b:any)=>b.issues[0].publication.evidenceCurrent=false,(b:any)=>b.issues[0].priority.scheduledEndAt=at(10),(b:any)=>{b.issues[0].status='BLOCKED';knowledge(b);}]){
    const b=fixture();mutate(b);const out=buildSyntheticRankingInputs(b);assert.equal(out.command.recipe.priority.issues.length,0);assert.equal(workerCall(w,'FALLBACK',out.eligibility).result,null);
  }
  const before=workerCall(w,'EXPORT_STATE');assert.equal(workerCall(w,'READ_LATEST').operation,'READ_LATEST');assert.deepEqual(workerCall(w,'EXPORT_STATE'),before);
});

test('same-group origins and unrelated decision groups cannot promote a bound macro gate',()=>{
  const sameGroup=macro(['owner','owner','owner']);assert.equal(pipelineMacroEvidence(sameGroup.issues[0].decision,null).allowed,false);assert.equal(buildSyntheticRankingInputs(sameGroup).command.recipe.priority.issues.length,0);
  const unrelated=macro(['owner','owner','owner'],true);assert.equal(pipelineMacroEvidence(unrelated.issues[0].decision,null).allowed,true);
  const blocked=buildSyntheticRankingInputs(unrelated);assert.equal(blocked.command.recipe.priority.issues.length,0);assert.equal(blocked.eligibility.eligibility.rows[0].evidenceCurrent,false);assert.ok(blocked.bindingManifest.issues[0].reasons.includes('MACRO_EVIDENCE_HOLD'));
  const independent=buildSyntheticRankingInputs(macro(['owner1','owner2','owner3']));assert.equal(independent.command.recipe.priority.issues.length,1);assert.equal(independent.command.recipe.priority.issues[0].scope,'MACRO_ALL');assert.equal(independent.command.recipe.priority.issues[0].macroGate!.officialCoreClaimId,undefined);
});

test('grade/macro references retain verified decision, source, origin and group bindings',()=>{
  for(const mutate of [(b:any)=>b.issues[0].priority.assessment.transmission.claimIds=['missing'],(b:any)=>b.issues[0].decision.evidence[0].verified=false,(b:any)=>b.issues[0].decision.evidence[0].groupId='other-group',(b:any)=>b.claims[0].claim.originId='other-origin',(b:any)=>b.claims[0].sourceRevisionId='missing',(b:any)=>b.claims[0].official=true]){
    const b=fixture();mutate(b);assert.throws(()=>buildSyntheticRankingInputs(b),code());
  }
  const b=macro(['owner1','owner2','owner3']);b.issues[0].priority.macroGate!.officialCoreClaimId='unbound';assert.throws(()=>buildSyntheticRankingInputs(b),code());
});

test('reverification preserves original first publication/material time; conflicting lineage is rejected',()=>{
  const b=fixture(25),again=structuredClone(b.issues[0]);again.revision=2;again.contentId='reverified';again.knownAt=at(20);again.publication.knownAt=at(20);again.priority.lastVerifiedAt=at(15);again.priority.evidenceValidUntil=at(1000);b.issues.push(again);knowledge(b);
  const out=buildSyntheticRankingInputs(b);assert.equal(out.command.recipe.priority.issues[0].publishedAt,at(-120));assert.equal(out.command.recipe.priority.issues[0].materialChangeAt,at(-100));assert.equal(out.command.recipe.priority.issues[0].lastVerifiedAt,at(15));
  for(const mutate of [(x:any)=>{x.issues[1].priority.publishedAt=at(-110);x.issues[1].article.issue.first_published_at=at(-110);x.issues[1].storedDraft.value.firstPublishedAt=at(-110);},(x:any)=>{x.issues[1].priority.materialChangeAt=at(15);x.issues[1].article.issue.material_change_at=at(15);x.issues[1].storedDraft.value.materialChangeAt=at(15);},(x:any)=>{x.issues[1].article.version.title='new title';x.issues[1].storedDraft.value.title='new title';}]){
    const bad=structuredClone(b);mutate(bad);assert.throws(()=>buildSyntheticRankingInputs(bad),code());
  }
});

test('invalid chronology, live mode, signals and malformed/getter input fail before any P1 state changes',()=>{
  const w=new SyntheticHomeWorkerAdapter(),before=workerCall(w,'EXPORT_STATE');let getterCalls=0;
  const getter=fixture();Object.defineProperty(getter.issues[0].publication,'articleVersionId',{enumerable:true,get(){getterCalls++;return 'article-v1';}});
  const cyclic:any=fixture();cyclic.context.self=cyclic;
  const symbol=fixture();Object.defineProperty(symbol,Symbol('extra'),{enumerable:true,value:true});
  const hidden=fixture();Object.defineProperty(hidden,'batchId',{enumerable:false,value:'hidden'});
  const malformed:any[]=[getter,cyclic,symbol,hidden,Object.assign(Object.create({inherited:true}),fixture()),null,[],{...fixture(),sampleKind:'PERMITTED_REAL'},{...fixture(),extra:true}];
  for(const mutate of [(b:any)=>b.cutoff=at(11),(b:any)=>b.issues[0].priority.lastVerifiedAt=at(20),(b:any)=>b.issues[0].priority.evidenceValidUntil=at(-100),(b:any)=>b.context.signals={T:true,M:false,P:false},(b:any)=>b.context.policyVersion='old-policy',(b:any)=>b.context.catalogVersion='other-catalog',(b:any)=>b.issues[0].priority.assessment.magnitude.grade=6,(b:any)=>b.issues[0].priority.signals={T:true}]){const b=fixture();mutate(b);malformed.push(b);}
  for(const b of malformed){assert.throws(()=>buildSyntheticRankingInputs(b),code());assert.deepEqual(workerCall(w,'EXPORT_STATE'),before);}
  assert.equal(getterCalls,0);
});

test('input and complete output budgets stay bounded and all returned data is detached',()=>{
  const b=fixture(),baseline=structuredClone(b),validated=validateSyntheticRankableBatch(b),out=buildSyntheticRankingInputs(b),repeat=buildSyntheticRankingInputs(b);
  validated.issues[0].publication.evidenceCurrent=false;out.command.recipe.priority.issues[0].assessment.transmission.grade=0;out.eligibility.eligibility.rows[0].publicationState='HIDDEN';out.bindingManifest.issues[0].reasons.push('tampered');
  assert.deepEqual(b,baseline);assert.deepEqual(buildSyntheticRankingInputs(b),repeat);
  for(const mutate of [(x:any)=>x.batchId='x'.repeat(65537),(x:any)=>x.sources=Array.from({length:1001},()=>structuredClone(x.sources[0])),(x:any)=>{let deep:any={};x.context.deep=deep;for(let n=0;n<15;n++){deep.next={};deep=deep.next;}},(x:any)=>x.context.nodes=Array.from({length:10},()=>Array.from({length:1000},()=>0))]){const bad=fixture();mutate(bad);assert.throws(()=>buildSyntheticRankingInputs(bad),code('INVALID_INPUT'));assert.deepEqual(b,baseline);}
});

test('builder is synchronous and cannot call the mocked network fetch hook',t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('UNEXPECTED_NETWORK');});assert.equal(buildSyntheticRankingInputs(fixture()).bindingManifest.executionEnabled,false);assert.equal(fetch.mock.callCount(),0);
});

for(const status of ['RETRACTED','BLOCKED','EXPIRED'] as const)test('visibility-only evidence '+status+' blocks candidate and previous completed fallback',()=>{
  const b=fixture();addClaim(b,'visible','visible-group');
  b.issues[0].visibility.keyIssueEvidenceIds.push('visible');b.issues[0].visibility.analysisEvidenceIds=['visible'];
  const initial=buildSyntheticRankingInputs(b),w=new SyntheticHomeWorkerAdapter();
  workerCall(w,'PROPOSE',initial.command);workerCall(w,'COMPLETE',{snapshotId:b.snapshotId,expectedRevision:0});
  assert.ok(workerCall(w,'FALLBACK',initial.eligibility).result);
  const current=structuredClone(b),claim=current.claims.find(x=>x.claim.claimId==='visible')!;
  if(status==='RETRACTED')claim.claim.status='RETRACTED';
  if(status==='BLOCKED')claim.status='BLOCKED';
  if(status==='EXPIRED')claim.claim.validUntil=current.cutoff;
  knowledge(current);const before=workerCall(w,'EXPORT_STATE'),out=buildSyntheticRankingInputs(current);
  assert.equal(current.issues[0].publication.evidenceCurrent,true);
  assert.ok(Object.values(current.issues[0].priority.assessment).every(g=>!g.claimIds.includes('visible')));
  assert.deepEqual({candidates:out.command.recipe.priority.issues.length,current:out.eligibility.eligibility.rows[0].evidenceCurrent,fallback:workerCall(w,'FALLBACK',out.eligibility).result!==null},{candidates:0,current:false,fallback:false});
  assert.deepEqual(workerCall(w,'EXPORT_STATE'),before);
});

test('each article/visibility evidence field independently applies selected current claim safety',()=>{
  const placements:[string,(b:SyntheticRankableBatch)=>void][]=[
    ['key issues',b=>{b.issues[0].visibility.keyIssueEvidenceIds=['visible'];}],
    ['analysis',b=>{b.issues[0].visibility.analysisEvidenceIds=['visible'];}],
    ['article and visibility impact',b=>{b.issues[0].visibility.impacts[0].evidenceIds=['visible'];b.issues[0].article.version.impacts[0].evidenceIds=['visible'];}],
    ['risk',b=>{
      const row=b.issues[0];row.visibility.risks=[{riskId:'risk',text:'Synthetic risk',pathIds:['path'],evidenceIds:['visible']}];
      row.article.version.visible_sections=['KEY_ISSUES','ISSUE_ANALYSIS','RELATED_SECTORS','RISKS','SOURCES'];row.storedDraft.value.visibleSections=[...row.article.version.visible_sections];
    }],
    ['exact schedule',b=>{
      const row=b.issues[0];row.visibility.schedule=[{scheduleId:'schedule',evidenceIds:['visible'],knownAt:at(-30),verified:true,cancelled:false,timezone:'Asia/Seoul',label:'Synthetic event',kind:'EXACT',eventAt:at(100)}];
      row.article.version.visible_sections=['KEY_ISSUES','ISSUE_ANALYSIS','RELATED_SECTORS','SCHEDULE','SOURCES'];row.storedDraft.value.visibleSections=[...row.article.version.visible_sections];
    }],
    ['period schedule',b=>{
      const row=b.issues[0];row.visibility.schedule=[{scheduleId:'schedule',evidenceIds:['visible'],knownAt:at(-30),verified:true,cancelled:false,timezone:'Asia/Seoul',label:'Synthetic period',kind:'PERIOD',startAt:at(100),endAt:at(200)}];
      row.article.version.visible_sections=['KEY_ISSUES','ISSUE_ANALYSIS','RELATED_SECTORS','SCHEDULE','SOURCES'];row.storedDraft.value.visibleSections=[...row.article.version.visible_sections];
    }],
    ['scenario path through impact',b=>{
      const row=b.issues[0];row.visibility.impacts[0].direction='BENEFIT';row.visibility.impacts[0].evidenceIds=['visible'];row.visibility.scenarios=[{direction:'POSITIVE',text:'Synthetic scenario',pathIds:['path']}];
      row.article.version.impacts[0].direction='BENEFIT';row.article.version.impacts[0].evidenceIds=['visible'];row.article.version.impact_profile='POSITIVE_ONLY';
      row.article.version.visible_sections=['KEY_ISSUES','ISSUE_ANALYSIS','SCENARIOS','BENEFIT_SECTORS','SOURCES'];row.storedDraft.value.visibleSections=[...row.article.version.visible_sections];
    }],
    ['present filtered schedule',b=>{
      b.issues[0].visibility.schedule=[{scheduleId:'cancelled',evidenceIds:['visible'],knownAt:at(-30),verified:true,cancelled:true,timezone:'Asia/Seoul',label:'Synthetic cancelled event',kind:'EXACT',eventAt:at(100)}];
    }]
  ];
  for(const [name,place] of placements){
    const b=fixture();addClaim(b,'visible','visible-group');place(b);const baseline=buildSyntheticRankingInputs(b),w=new SyntheticHomeWorkerAdapter();
    assert.equal(baseline.command.recipe.priority.issues.length,1,name);workerCall(w,'PROPOSE',baseline.command);workerCall(w,'COMPLETE',{snapshotId:b.snapshotId,expectedRevision:0});
    const current=structuredClone(b);current.claims.find(c=>c.claim.claimId==='visible')!.claim.status='RETRACTED';
    const out=buildSyntheticRankingInputs(current);assert.equal(out.command.recipe.priority.issues.length,0,name);assert.equal(out.eligibility.eligibility.rows[0].evidenceCurrent,false,name);assert.equal(workerCall(w,'FALLBACK',out.eligibility).result,null,name);
  }
});

test('missing/unverified visible claims fail closed while unused decision claims do not become publication references',()=>{
  const used=fixture();addClaim(used,'visible','visible-group');used.issues[0].visibility.keyIssueEvidenceIds=['visible'];
  const missing=structuredClone(used);missing.claims=missing.claims.filter(c=>c.claim.claimId!=='visible');missing.declared.claimIds=missing.declared.claimIds.filter(id=>id!=='visible');knowledge(missing);
  assert.throws(()=>buildSyntheticRankingInputs(missing),code('RIGHTS_HOLD'));
  const unverified=structuredClone(used);unverified.issues[0].decision.evidence.find(e=>e.claimId==='visible')!.verified=false;
  assert.throws(()=>buildSyntheticRankingInputs(unverified),code('RIGHTS_HOLD'));
  const selectedOnlyFuture=structuredClone(used),c=selectedOnlyFuture.claims.find(x=>x.claim.claimId==='visible')!;c.knownAt=at(20);knowledge(selectedOnlyFuture);
  assert.throws(()=>buildSyntheticRankingInputs(selectedOnlyFuture),code('RIGHTS_HOLD'));
  const unrelated=fixture();addClaim(unrelated,'unused','unused-group');unrelated.claims.find(c=>c.claim.claimId==='unused')!.claim.status='RETRACTED';
  const out=buildSyntheticRankingInputs(unrelated);assert.equal(out.command.recipe.priority.issues.length,1);assert.equal(out.eligibility.eligibility.rows[0].evidenceCurrent,true);
});
