import test from 'node:test';
import assert from 'node:assert/strict';
import {OfflineBoundHomeDispatcher} from '../workers/home-ranking/src/bound-dispatch.ts';
import {HOME_BOUND_SCHEMA,homeFloor,engineData,type OfflineHomePorts,type HomeStamp,type HomeHead,type ProducerRequest,type CurrentRequest} from '../workers/home-ranking/src/bound-ports.ts';
import {RANKABLE_BATCH_SCHEMA,type SyntheticRankableBatch,type RankableIssue} from '../packages/contracts/src/rankable-batch.ts';
import {PIPELINE_CONTRACT,PipelineError} from '../packages/contracts/src/pipeline.ts';
import {SNAPSHOT_POLICY} from '../packages/domain/src/home-snapshot.ts';
import {SyntheticCompletedRanking} from '../packages/domain/src/pipeline-ranking.ts';
import {buildSyntheticRankingInputs} from '../workers/home-ranking/src/rankable-adapter.ts';

const BASE=Date.parse('2026-11-15T23:00:00Z'),at=(m:number,ms=0)=>new Date(BASE+m*60000+ms).toISOString();
const code=(expected?:string)=>(e:unknown)=>e instanceof PipelineError&&(expected===undefined||e.code===expected);
const versions={contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC' as const,policyVersion:'binding-policy-v1',catalogVersion:'catalog-v1',sourcePolicyVersion:'SYNTHETIC_SOURCE_V1'};
const sections=['KEY_ISSUES','ISSUE_ANALYSIS','RELATED_SECTORS','SOURCES'] as const;
function refresh(b:SyntheticRankableBatch){b.knowledge.revisions=[...b.issues.map(x=>({kind:'ISSUE' as const,entityId:x.article.issue.id,revision:x.revision,contentId:x.contentId,knownAt:x.knownAt,status:x.status})),...b.claims.map(x=>({kind:'CLAIM' as const,entityId:x.claim.claimId,revision:x.revision,contentId:x.contentId,knownAt:x.knownAt,status:x.status}))];}
function row(id:string):RankableIssue {
  return {revision:1,contentId:'issue-content-'+id,knownAt:at(0),status:'VALID',article:{issue:{id,storyId:'story-'+id,publication_state:'PUBLISHED',scheduled_publish_at:null,first_published_at:at(-120),material_change_at:at(-100),currentVersionId:'article-'+id},version:{id:'article-'+id,issueId:id,title:'Synthetic article',summary:'Synthetic summary',source_market:'KR',selection_market_basis:'KR',analysis_perspective:'KR_EQUITY',evidence_as_of:at(-30),impact_profile:'RELATED_CONDITIONAL',visibility_policy_version:versions.policyVersion,impacts:[{sectorId:'sector',direction:'RELATED',pathId:'path',conditions:[],companyIds:[],evidenceIds:['claim']}],visible_sections:[...sections],sourceIds:['source']}},storedDraft:{version:1,value:{...versions,issueId:id,storyId:'story-'+id,decisionId:'decision-'+id,expectedArticleVersion:0,title:'Synthetic article',summary:'Synthetic summary',bodyRef:'fixture:/article/body',visibleSections:[...sections],evidenceVersion:'evidence-v1',firstPublishedAt:at(-120),materialChangeAt:at(-100)}},decision:{...versions,decisionId:'decision-'+id,inputRevisionIds:['revision'],storyCandidateKey:'candidate-'+id,issueCandidateKey:id,decision:'COLLECT',action:'UPDATE',reason:'SYNTHETIC_FIXTURE',wakeCondition:null,deadline:null,knownAt:at(-80),evidence:[{claimId:'claim',revisionId:'revision',originId:'origin',groupId:'group',official:false,verified:true}],generatorVersion:'generator-v1',promptVersion:'prompt-v1',evidenceVersion:'evidence-v1'},visibility:{sampleKind:'SYNTHETIC',evidenceVersion:'evidence-v1',asOf:at(-30),keyIssueEvidenceIds:['claim'],analysisEvidenceIds:['claim'],impacts:[{sectorId:'sector',pathId:'path',direction:'RELATED',conditionalDirection:'NONE',evidenceIds:['claim']}],scenarios:[],risks:[],schedule:[]},publication:{kind:'SYNTHETIC_PUBLICATION_OBSERVATION',fixtureAssertionOnly:true,knownAt:at(0),issueId:id,articleVersionId:'article-'+id,storedDraftVersion:1,evidenceVersion:'evidence-v1',assessmentVersion:'assessment-v1',publicationState:'PUBLISHED',evidenceCurrent:true},priority:{issueId:id,storyId:'story-'+id,version:'article-'+id,assessmentVersion:'assessment-v1',sampleKind:'SYNTHETIC',inputKnownAt:at(-30),publishedAt:at(-120),materialChangeAt:at(-100),lastVerifiedAt:at(-30),evidenceValidUntil:at(1000),scheduledEndAt:null,publicationState:'PUBLISHED',contentClass:'SECTOR_EVENT',impactState:'ACTIVE',direction:'POSITIVE',scope:'SECTOR',assessment:{transmission:{grade:5,claimIds:['claim']},breadth:{grade:5,claimIds:['claim']},magnitude:{grade:5,claimIds:['claim']},persistence:{grade:5,claimIds:['claim']}},macroGate:null},primarySectorId:'sector'};
}
function batch(cutoff=at(10),revision=0,id='round-10',ids=['issue']):SyntheticRankableBatch {
  const b:SyntheticRankableBatch={schema:RANKABLE_BATCH_SCHEMA,sampleKind:'SYNTHETIC',fixtureAssertionOnly:true,completenessScope:'DECLARED_FIXTURE_IDS_ONLY',batchId:'batch-'+id,versions:{...versions},cutoff,snapshotId:id,expectedRevision:revision,profileId:'SYNTHETIC_PROFILE_V1',nonpriceScaleVersion:'SYNTHETIC_SCALE_V1',context:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff,policyVersion:SNAPSHOT_POLICY,catalogVersion:versions.catalogVersion,comparisonSetVersion:'compare-v1',evaluationSetVersion:'eval-v1',calendar:{calendarVersion:'calendar-v1',evidenceId:'SYNTHETIC',knownAt:'2026-11-01T00:00:00Z',validUntil:'2026-12-01T00:00:00Z',coverageStart:'2026-11-13',coverageEnd:'2026-11-23',days:Array.from({length:11},(_,n)=>({date:new Date(Date.parse('2026-11-13T00:00:00Z')+n*86400000).toISOString().slice(0,10),state:[1,2,8,9].includes(n)?'CLOSED':'OPEN'}))}},declared:{issueIds:[...ids],claimIds:ids.length?['claim']:[]},knowledge:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff,knownDataSetVersion:'known-v1',complete:true,watermarkAt:cutoff,revisions:[]},sources:ids.length?[{...versions,sourceDocumentId:'doc',revisionId:'revision',sourceId:'source',endpointId:'endpoint',publisherId:'publisher',originId:'origin',independenceGroupId:'group',canonicalUrl:'https://news.synthetic.invalid/source',nativeId:'native',collectedAt:at(-120),publishedAt:at(-180),updatedAt:null,timeQuality:'KNOWN',contentHash:'a'.repeat(64),title:'Synthetic source',lead:'Synthetic evidence',bodyRef:'fixture:/source/body',permissionVersion:'permission-v1'}]:[],claims:ids.length?[{revision:1,contentId:'claim-content',knownAt:at(-90),status:'VALID',evidenceVersion:'evidence-v1',sourceRevisionId:'revision',independenceGroupId:'group',official:false,claim:{sampleKind:'SYNTHETIC',version:'claim-v1',claimId:'claim',originId:'origin',kind:'FILING',knownAt:at(-120),validUntil:at(1000),verifiedAt:at(-100),status:'VERIFIED'}}]:[],issues:ids.map(row)};refresh(b);return b;
}
function setState(b:SyntheticRankableBatch,state:'HIDDEN'|'WITHDRAWN'|'CORRECTION_PENDING') {for(const r of b.issues){r.article.issue.publication_state=state;r.priority.publicationState=state;r.publication.publicationState=state;}}
function deferred<T>() {let resolve!:(v:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
function harness(){
  const h={now:at(10),stamp:{backendGeneration:'offline-backend',readRevision:1} as HomeStamp,producerIds:['issue'],guardIds:null as string[]|null,mutate:(b:SyntheticRankableBatch)=>{},produceHook:null as null|((r:ProducerRequest,value:unknown)=>Promise<unknown>),currentHook:null as null|((r:CurrentRequest,value:unknown)=>Promise<unknown>),produceCalls:0,currentCalls:0,currentMutate:(b:SyntheticRankableBatch)=>{}};
  const meta={schema:HOME_BOUND_SCHEMA,mode:'OFFLINE_REPLAY',fixtureAssertionOnly:true,executionEnabled:false};
  const ports:OfflineHomePorts={clock:()=>h.now,generation:()=>({...h.stamp}),produce:async r=>{h.produceCalls++;const b=batch(r.rankingCutoff,r.expectedHead.revision,r.roundId,h.producerIds);h.mutate(b);refresh(b);const value={...meta,stamp:r.stamp,batch:b};return h.produceHook?await h.produceHook(r,value):value;},current:async r=>{h.currentCalls++;const b=batch(homeFloor(r.checkedAt),0,'current',h.guardIds??r.requiredIssueIds);h.mutate(b);h.currentMutate(b);refresh(b);const value={...meta,stamp:r.stamp,observedAt:r.checkedAt,batch:b};return h.currentHook?await h.currentHook(r,value):value;}};
  return {h,ports,dispatcher:new OfflineBoundHomeDispatcher(ports)};
}
const request=(d:OfflineBoundHomeDispatcher,id='round-10',cutoff=at(10))=>({roundId:id,rankingCutoff:cutoff,expectedHead:d.head().result});
async function commit(d:OfflineBoundHomeDispatcher,id='round-10',cutoff=at(10)){const r=request(d,id,cutoff);await d.prepareBound(r);await d.completeBound({roundId:r.roundId,expectedHead:r.expectedHead});return r;}

test('private producer binding stages prepare/complete and returns internal safe read metadata',async()=>{
  const {h,dispatcher:d}=harness(),r=request(d),prepared=await d.prepareBound(r);assert.equal(prepared.result.status,'SAVED_DRAFT');assert.equal(d.head().result.revision,0);assert.equal((await d.readHomeBound()).result.state,'CALCULATING');
  assert.equal((await d.prepareBound(r)).result.status,'REUSED');assert.equal(h.produceCalls,1);
  assert.equal((await d.completeBound({roundId:r.roundId,expectedHead:r.expectedHead})).result.status,'COMPLETED');assert.equal(d.head().result.revision,1);assert.equal((await d.completeBound({roundId:r.roundId,expectedHead:r.expectedHead})).result.status,'REUSED');
  const read=await d.readHomeBound();assert.equal(read.mode,'OFFLINE_REPLAY');assert.equal(read.fixtureAssertionOnly,true);assert.equal(read.executionEnabled,false);assert.equal(read.result.state,'FRESH');assert.deepEqual(read.result.lanes.B,[{issueId:'issue',articleVersionId:'article-issue'}]);
  for(const forbidden of ['score','bodyRef','claimIds','assessment','components','weights','UV'])assert.ok(!JSON.stringify(read).includes('"'+forbidden+'"'));
});

test('raw command, caller manifest, now override and hostile getters cannot bypass ownership',async()=>{
  const {dispatcher:d,h}=harness(),r=request(d),before=d.exportBound();let calls=0;const getter={...r};Object.defineProperty(getter,'roundId',{enumerable:true,get(){calls++;return 'round-10';}});
  for(const raw of [{...r,command:{}},{...r,bindingManifest:{}},{...r,now:at(20)},getter,{...r,rankingCutoff:at(11)},{...r,expectedHead:{snapshotId:'fake',digest:'a'.repeat(64),revision:1}}])await assert.rejects(d.prepareBound(raw),code());
  await assert.rejects(d.readHomeBound({now:at(20)}),code('INVALID_INPUT'));assert.equal(calls,0);assert.equal(h.produceCalls,0);assert.deepEqual(d.exportBound(),before);assert.equal('dispatch'in d,false);
});

test('current publication changes between five-minute slots immediately hide a completed card',async()=>{
  const {dispatcher:d,h}=harness();await commit(d);const before=d.exportBound();h.now=at(10,31000);
  for(const state of ['HIDDEN','WITHDRAWN','CORRECTION_PENDING'] as const){h.currentMutate=b=>{setState(b,state);for(const r of b.issues){r.knownAt=at(10,30000);r.publication.knownAt=r.knownAt;}};const read=await d.readHomeBound();assert.equal(read.result.state,'CALCULATING');assert.equal(read.result.checkedAt,at(10,31000));assert.equal(read.result.lanes.B.length,0);}
  assert.deepEqual(d.exportBound(),before);
});

test('new deadline, current source correction, fixture rights hold and expiry block old snapshots',async()=>{
  const {dispatcher:d,h}=harness();await commit(d);h.now=at(10,31000);
  const mutations=[
    (b:SyntheticRankableBatch)=>{b.issues[0].priority.scheduledEndAt=at(10,30000);},
    (b:SyntheticRankableBatch)=>{b.issues[0].publication.evidenceCurrent=false;},
    (b:SyntheticRankableBatch)=>{b.claims[0].claim.validUntil=at(10,30000);},
    (b:SyntheticRankableBatch)=>{const s=structuredClone(b.sources[0]);s.revisionId='correction';s.updatedAt=at(-60);s.collectedAt=at(10,30000);s.contentHash='b'.repeat(64);b.sources.push(s);}
  ];
  for(const mutate of mutations){h.currentMutate=mutate;assert.equal((await d.readHomeBound()).result.state,'CALCULATING');}
});

test('current guard applies body-only claim retraction independently of ranking grades',async()=>{
  const {dispatcher:d,h}=harness();h.mutate=b=>{const s=structuredClone(b.sources[0]);s.sourceDocumentId='body-doc';s.revisionId='body-revision';s.sourceId='body-source';s.nativeId='body-native';s.originId='body-origin';s.independenceGroupId='body-group';b.sources.push(s);const c=structuredClone(b.claims[0]);c.contentId='body-content';c.sourceRevisionId=s.revisionId;c.independenceGroupId=s.independenceGroupId;c.claim.claimId='body-claim';c.claim.originId=s.originId;c.claim.version='body-v1';b.claims.push(c);b.declared.claimIds.push('body-claim');for(const r of b.issues){r.decision.inputRevisionIds.push(s.revisionId);r.decision.evidence.push({claimId:'body-claim',revisionId:s.revisionId,originId:s.originId,groupId:s.independenceGroupId,official:false,verified:true});r.article.version.sourceIds.push(s.sourceId);r.visibility.analysisEvidenceIds=['body-claim'];}};
  await commit(d);h.now=at(10,31000);h.currentMutate=b=>{b.claims.find(c=>c.claim.claimId==='body-claim')!.claim.status='RETRACTED';};assert.equal((await d.readHomeBound()).result.state,'CALCULATING');
});

test('actual fifteen-minute boundary is inclusive; a single millisecond later is calculating',async()=>{
  const {dispatcher:d,h}=harness();await commit(d);h.now=at(25);assert.equal((await d.readHomeBound()).result.state,'DELAYED');h.now=at(25,1);assert.equal((await d.readHomeBound()).result.state,'CALCULATING');
});

test('a qualification that expires during an asynchronous wait is checked against the final clock',async()=>{
  const {dispatcher:d,h}=harness();await commit(d);h.now=at(10,1000);h.currentHook=async(_r,value:any)=>{value.batch.claims[0].claim.validUntil=at(10,30000);h.now=at(10,31000);return value;};assert.equal((await d.readHomeBound()).result.state,'CALCULATING');
});

test('prepare/current qualification version changes reject completion without touching the owned draft',async()=>{
  for(const mutate of [(b:any)=>{b.issues[0].article.version.id='article-v2';b.issues[0].article.issue.currentVersionId='article-v2';b.issues[0].priority.version='article-v2';b.issues[0].publication.articleVersionId='article-v2';},(b:any)=>{b.issues[0].priority.assessmentVersion='assessment-v2';b.issues[0].publication.assessmentVersion='assessment-v2';},(b:any)=>{b.issues[0].decision.evidenceVersion='evidence-v2';b.issues[0].storedDraft.value.evidenceVersion='evidence-v2';b.issues[0].publication.evidenceVersion='evidence-v2';b.issues[0].visibility.evidenceVersion='evidence-v2';b.claims[0].evidenceVersion='evidence-v2';},(b:any)=>{b.issues[0].publication.evidenceCurrent=false;},(b:any)=>{b.issues[0].priority.scheduledEndAt=at(10);},(b:any)=>setState(b,'WITHDRAWN')]){
    const {dispatcher:d,h}=harness(),r=request(d);await d.prepareBound(r);const before=d.exportBound();h.currentMutate=mutate;await assert.rejects(d.completeBound({roundId:r.roundId,expectedHead:r.expectedHead}),code('RIGHTS_HOLD'));assert.deepEqual(d.exportBound(),before);
  }
});

test('missing old-card observations are rejected, while explicitly excluded old cards allow safe replacement',async()=>{
  const {dispatcher:d,h}=harness();await commit(d);h.now=at(15);const r=request(d,'round-15',at(15));h.producerIds=['new'];await assert.rejects(d.prepareBound(r),code('RIGHTS_HOLD'));
  h.producerIds=['issue','new'];await d.prepareBound(r);const before=d.exportBound();h.guardIds=['new'];await assert.rejects(d.completeBound({roundId:r.roundId,expectedHead:r.expectedHead}),code('RIGHTS_HOLD'));assert.deepEqual(d.exportBound(),before);assert.equal((await d.readHomeBound()).result.state,'CALCULATING');
  const safe=harness();await commit(safe.dispatcher);safe.h.now=at(15);safe.h.mutate=b=>setState(b,'WITHDRAWN');await commit(safe.dispatcher,'safe-empty',at(15));const read=await safe.dispatcher.readHomeBound();assert.equal(read.result.state,'FRESH');assert.equal(read.result.snapshotId,'safe-empty');assert.deepEqual(read.result.lanes,{A:[],B:[],C:[]});
});

test('head CAS is rechecked after awaited preparation and concurrent completion',async()=>{
  const {dispatcher:d,h}=harness();h.now=at(15);const gate=deferred<unknown>(),started=deferred<void>();h.produceHook=async(r,value)=>{if(r.roundId==='slow'){started.resolve();return await gate.promise;}return value;};
  const slow=d.prepareBound(request(d,'slow',at(10)));await started.promise;await d.prepareBound(request(d,'fast',at(15)));const before=d.exportBound();gate.resolve({});await assert.rejects(slow,code('VERSION_CONFLICT'));assert.deepEqual(d.exportBound(),before);
  const race=harness();race.h.now=at(15);const a=request(race.dispatcher,'a',at(10)),b=request(race.dispatcher,'b',at(15));await race.dispatcher.prepareBound(a);await race.dispatcher.prepareBound(b);const currentGate=deferred<unknown>(),currentStarted=deferred<void>();let captured:unknown;race.h.currentHook=async(_r,value)=>{if(!captured){captured=value;currentStarted.resolve();return await currentGate.promise;}return value;};
  const first=race.dispatcher.completeBound({roundId:'a',expectedHead:a.expectedHead});await currentStarted.promise;await race.dispatcher.completeBound({roundId:'b',expectedHead:b.expectedHead});const winner=race.dispatcher.exportBound();currentGate.resolve(captured);await assert.rejects(first,code('VERSION_CONFLICT'));assert.deepEqual(race.dispatcher.exportBound(),winner);assert.equal(race.dispatcher.head().result.snapshotId,'b');
});

test('generation/readRevision is fenced after each producer/current await',async()=>{
  const p=harness(),before=p.dispatcher.exportBound();p.h.produceHook=async(_r,value)=>{p.h.stamp.readRevision++;return value;};await assert.rejects(p.dispatcher.prepareBound(request(p.dispatcher)),code('POLICY_STALE'));assert.deepEqual(p.dispatcher.exportBound(),before);
  const c=harness(),r=request(c.dispatcher);await c.dispatcher.prepareBound(r);const draft=c.dispatcher.exportBound();c.h.currentHook=async(_r,value)=>{c.h.stamp.readRevision++;return value;};await assert.rejects(c.dispatcher.completeBound({roundId:r.roundId,expectedHead:r.expectedHead}),code('POLICY_STALE'));assert.deepEqual(c.dispatcher.exportBound(),draft);
  const read=harness();await commit(read.dispatcher);read.h.currentHook=async(_r,value)=>{read.h.stamp.readRevision++;return value;};assert.equal((await read.dispatcher.readHomeBound()).result.state,'CALCULATING');
});

test('bound JSON export/restore checks engine, binding, receipt and existing prefix together',async()=>{
  const {dispatcher:d,h,ports}=harness();await commit(d);h.now=at(15);await d.prepareBound(request(d,'pending',at(15)));const exported=JSON.parse(JSON.stringify(d.exportBound().result)),restored=new OfflineBoundHomeDispatcher(ports);assert.equal(restored.restoreBound(exported).result,null);assert.deepEqual(restored.exportBound().result.completed,d.exportBound().result.completed);assert.equal((await restored.readHomeBound()).result.state,'DELAYED');
  for(const mutate of [(x:any)=>x.bindings.pop(),(x:any)=>x.bindings[0].batchDigest='0'.repeat(64),(x:any)=>x.bindings[0].prepareReceipt.commandDigest='0'.repeat(64),(x:any)=>x.completed[0].digest='0'.repeat(64),(x:any)=>x.bindings[0].completeReceipt=null,(x:any)=>x.extra=true,(x:any)=>x.checkedAt=null,(x:any)=>x.checkedAt=at(0),(x:any)=>x.bindings[0].stamp.readRevision=999]){const bad=structuredClone(exported);mutate(bad);const before=restored.exportBound();assert.throws(()=>restored.restoreBound(bad),code());assert.deepEqual(restored.exportBound(),before);}
  assert.throws(()=>new OfflineBoundHomeDispatcher(ports).restoreBound(engineData(exported)),code('INVALID_INPUT'));
  const old=structuredClone(exported);h.now=at(20);await d.completeBound({roundId:'pending',expectedHead:exported.bindings[1].request.expectedHead});const before=d.exportBound();assert.throws(()=>d.restoreBound(old),code());assert.deepEqual(d.exportBound(),before);
});

test('sidecar/response budget failure preserves state even when the engine alone can accept it',async()=>{
  const {dispatcher:d,h}=harness();h.mutate=b=>{for(const s of b.sources)s.lead='x'.repeat(4000);for(const r of b.issues){r.article.version.summary='x'.repeat(4000);r.storedDraft.value.summary=r.article.version.summary;}};let rejected=false;
  for(let n=0;n<32&&!rejected;n++){
    h.now=at(10+n*5);const r=request(d,'budget-'+n,h.now),before=d.exportBound();
    try{await d.prepareBound(r);}catch(e){assert.ok(code('INVALID_INPUT')(e));assert.deepEqual(d.exportBound(),before);const reference=new SyntheticCompletedRanking('fixture-bound-home');reference.restore(engineData(before.result));const b=batch(h.now,r.expectedHead.revision,r.roundId);h.mutate(b);assert.doesNotThrow(()=>reference.propose(buildSyntheticRankingInputs(b).command));rejected=true;break;}
    const pending=d.exportBound();try{await d.completeBound({roundId:r.roundId,expectedHead:r.expectedHead});}catch(e){assert.ok(code('INVALID_INPUT')(e));assert.deepEqual(d.exportBound(),pending);const reference=new SyntheticCompletedRanking('fixture-bound-home');reference.restore(engineData(pending.result));assert.doesNotThrow(()=>reference.complete(r.roundId,r.expectedHead.revision));rejected=true;}
  }
  assert.equal(rejected,true);
});

test('port input/output isolation and no network calls preserve the offline boundary',async t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('UNEXPECTED_NETWORK');}),{dispatcher:d,h}=harness();let captured:any,capturedRequest:any;
  h.produceHook=async(r,value)=>{captured=value;capturedRequest=r;return value;};await commit(d);const baseline=d.exportBound();captured.batch.issues[0].publication.evidenceCurrent=false;capturedRequest.expectedHead.revision=99;
  const returned=d.exportBound();returned.result.bindings[0].batch.issues[0].publication.evidenceCurrent=false;returned.result.completed[0].result.lanes.B.length=0;const read=await d.readHomeBound();read.result.lanes.B.length=0;assert.deepEqual(d.exportBound(),baseline);assert.equal(fetch.mock.callCount(),0);assert.deepEqual(Object.keys(d),[]);
});

function bodyOnlyDependency(b:SyntheticRankableBatch){
  const s=structuredClone(b.sources[0]);s.sourceDocumentId='body-doc';s.revisionId='body-revision';s.sourceId='body-source';s.nativeId='body-native';s.originId='body-origin';s.independenceGroupId='body-group';b.sources.push(s);
  const c=structuredClone(b.claims[0]);c.contentId='body-content';c.sourceRevisionId=s.revisionId;c.independenceGroupId=s.independenceGroupId;c.claim.claimId='body-claim';c.claim.originId=s.originId;c.claim.version='body-v1';b.claims.push(c);b.declared.claimIds.push('body-claim');
  for(const r of b.issues){r.decision.inputRevisionIds.push(s.revisionId);r.decision.evidence.push({claimId:'body-claim',revisionId:s.revisionId,originId:s.originId,groupId:s.independenceGroupId,official:false,verified:true});r.article.version.sourceIds.push(s.sourceId);r.visibility.analysisEvidenceIds=['body-claim'];}
}

test('stored body-only dependency cannot be replaced after its claim is retracted',async()=>{
  const {dispatcher:d,h}=harness();h.mutate=bodyOnlyDependency;await commit(d);const before=d.exportBound();h.stamp.readRevision++;h.now=at(10,31000);
  h.currentMutate=b=>{b.claims.find(c=>c.claim.claimId==='body-claim')!.claim.status='RETRACTED';for(const r of b.issues)r.visibility.analysisEvidenceIds=['claim'];};
  assert.equal((await d.readHomeBound()).result.state,'CALCULATING');assert.deepEqual(d.exportBound(),before);
});

test('replacing the prepared body-only dependency cannot complete or mutate its owned draft',async()=>{
  const {dispatcher:d,h}=harness();h.mutate=bodyOnlyDependency;const r=request(d);await d.prepareBound(r);const before=d.exportBound();
  h.currentMutate=b=>{b.claims.find(c=>c.claim.claimId==='body-claim')!.claim.status='RETRACTED';for(const row of b.issues)row.visibility.analysisEvidenceIds=['claim'];};
  await assert.rejects(d.completeBound({roundId:r.roundId,expectedHead:r.expectedHead}),code('RIGHTS_HOLD'));assert.deepEqual(d.exportBound(),before);
});

test('same version IDs freeze grade, macro, article-impact, risk, schedule and scenario dependency graphs',async()=>{
  const cases:Array<{name:string;setup:(b:SyntheticRankableBatch)=>void;change:(b:SyntheticRankableBatch)=>void}>=[
    {name:'grade replacement',setup:b=>{for(const r of b.issues)r.priority.assessment.transmission.claimIds=['body-claim'];},change:b=>{for(const r of b.issues)r.priority.assessment.transmission.claimIds=['claim'];}},
    {name:'macro reference removal',setup:b=>{b.claims[0].official=true;for(const r of b.issues){r.decision.evidence[0].official=true;r.priority.scope='MACRO_ALL';r.priority.contentClass='SYSTEMIC_MACRO';r.primarySectorId=null;r.priority.macroGate={decision:'PASS',gateVersion:'gate',claimIds:['claim','body-claim'],independentOriginIds:['origin','body-origin'],officialCoreClaimId:'claim'};}},change:b=>{for(const r of b.issues){r.priority.macroGate!.claimIds=['claim'];r.priority.macroGate!.independentOriginIds=['origin'];}}},
    {name:'article/visibility impact replacement',setup:b=>{for(const r of b.issues){r.visibility.impacts[0].evidenceIds=['body-claim'];r.article.version.impacts[0].evidenceIds=['body-claim'];}},change:b=>{for(const r of b.issues){r.visibility.impacts[0].evidenceIds=['claim'];r.article.version.impacts[0].evidenceIds=['claim'];}}},
    {name:'risk removal',setup:b=>{for(const r of b.issues){r.visibility.risks=[{riskId:'risk',text:'Synthetic risk',pathIds:['path'],evidenceIds:['body-claim']}];r.article.version.visible_sections=['KEY_ISSUES','ISSUE_ANALYSIS','RELATED_SECTORS','RISKS','SOURCES'];r.storedDraft.value.visibleSections=[...r.article.version.visible_sections];}},change:b=>{for(const r of b.issues){r.visibility.risks=[];r.article.version.visible_sections=[...sections];r.storedDraft.value.visibleSections=[...sections];}}},
    {name:'schedule removal',setup:b=>{for(const r of b.issues){r.visibility.schedule=[{scheduleId:'event',evidenceIds:['body-claim'],knownAt:at(-30),verified:true,cancelled:false,timezone:'Asia/Seoul',label:'Synthetic event',kind:'EXACT',eventAt:at(100)}];r.article.version.visible_sections=['KEY_ISSUES','ISSUE_ANALYSIS','RELATED_SECTORS','SCHEDULE','SOURCES'];r.storedDraft.value.visibleSections=[...r.article.version.visible_sections];}},change:b=>{for(const r of b.issues){r.visibility.schedule=[];r.article.version.visible_sections=[...sections];r.storedDraft.value.visibleSections=[...sections];}}},
    {name:'scenario path replacement',setup:b=>{for(const r of b.issues){r.visibility.impacts[0].direction='BENEFIT';r.article.version.impacts[0].direction='BENEFIT';r.visibility.impacts.push({sectorId:'sector',pathId:'body-path',direction:'BENEFIT',conditionalDirection:'NONE',evidenceIds:['body-claim']});r.article.version.impacts.push({sectorId:'sector',pathId:'body-path',direction:'BENEFIT',conditions:[],companyIds:[],evidenceIds:['body-claim']});r.visibility.scenarios=[{direction:'POSITIVE',text:'Synthetic scenario',pathIds:['body-path']}];r.article.version.impact_profile='POSITIVE_ONLY';r.article.version.visible_sections=['KEY_ISSUES','ISSUE_ANALYSIS','SCENARIOS','BENEFIT_SECTORS','SOURCES'];r.storedDraft.value.visibleSections=[...r.article.version.visible_sections];}},change:b=>{for(const r of b.issues)r.visibility.scenarios[0].pathIds=['path'];}}
  ];
  for(const c of cases){const {dispatcher:d,h}=harness();h.mutate=b=>{bodyOnlyDependency(b);for(const r of b.issues)r.visibility.analysisEvidenceIds=['claim'];c.setup(b);};await commit(d);assert.equal((await d.readHomeBound()).result.state,'FRESH',c.name);const before=d.exportBound();h.stamp.readRevision++;h.currentMutate=c.change;assert.equal((await d.readHomeBound()).result.state,'CALCULATING',c.name);assert.deepEqual(d.exportBound(),before,c.name);}
});

test('removing stored claim/source observations and decision edges cannot erase old dependencies',async()=>{
  for(const bodyReferenced of [true,false]){
    const {dispatcher:d,h}=harness();h.mutate=b=>{bodyOnlyDependency(b);if(!bodyReferenced)for(const r of b.issues)r.visibility.analysisEvidenceIds=['claim'];};await commit(d);h.stamp.readRevision++;
    h.currentMutate=b=>{b.claims=b.claims.filter(c=>c.claim.claimId!=='body-claim');b.declared.claimIds=b.declared.claimIds.filter(id=>id!=='body-claim');b.sources=b.sources.filter(s=>s.revisionId!=='body-revision');for(const r of b.issues){r.visibility.analysisEvidenceIds=['claim'];r.decision.evidence=r.decision.evidence.filter(e=>e.claimId!=='body-claim');r.decision.inputRevisionIds=r.decision.inputRevisionIds.filter(id=>id!=='body-revision');r.article.version.sourceIds=r.article.version.sourceIds.filter(id=>id!=='body-source');}};
    assert.equal((await d.readHomeBound()).result.state,'CALCULATING');
  }
});

test('same dependency graph permits time-only successful current reverification',async()=>{
  const {dispatcher:d,h}=harness();h.mutate=bodyOnlyDependency;await commit(d);h.stamp.readRevision++;h.now=at(10,31000);
  h.currentMutate=b=>{for(const r of b.issues){r.knownAt=at(10,30000);r.publication.knownAt=r.knownAt;r.priority.lastVerifiedAt=r.knownAt;r.priority.inputKnownAt=r.knownAt;r.visibility.asOf=r.knownAt;}for(const c of b.claims){c.knownAt=at(10,30000);c.claim.verifiedAt=c.knownAt;}};
  assert.equal((await d.readHomeBound()).result.state,'FRESH');
});
