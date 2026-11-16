import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PIPELINE_CONTRACT,PipelineError,pipelineData,pipelineCanonical,validatePipelineVersions,validateSourceRevision,validatePipelineDecision,validatePipelineDraft,validateSnapshotDraft,pipelineMacroEvidence,type PipelineVersions,type PipelineSourceRevision,type PipelineDecision,type PipelineDraft,type PipelineSnapshotDraft} from '../packages/contracts/src/pipeline.ts';
import {SyntheticPipelineRepositories} from '../packages/contracts/src/pipeline-memory.ts';
const versions:PipelineVersions={contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC',policyVersion:'policy-v1',catalogVersion:'catalog-v2',sourcePolicyVersion:'source-v1'};
const digest=(s:string)=>createHash('sha256').update(s).digest('hex');
function source():PipelineSourceRevision{return {...versions,sourceDocumentId:'doc-1',revisionId:'rev-1',sourceId:'source-1',endpointId:'endpoint-1',publisherId:'publisher-1',originId:'origin-1',independenceGroupId:'group-1',canonicalUrl:'https://news.invalid/article/1',nativeId:'article-1',collectedAt:'2026-11-16T00:00:00Z',publishedAt:'2026-11-15T23:59:00Z',updatedAt:null,timeQuality:'KNOWN',contentHash:digest('synthetic-one'),title:'합성 이슈',lead:'실제 기사와 무관한 합성 입력',bodyRef:'fixture:/body/one',permissionVersion:'permission-fixture-v1'};}
function decision():PipelineDecision{return {...versions,decisionId:'decision-1',inputRevisionIds:['rev-1'],storyCandidateKey:'candidate-story-1',issueCandidateKey:null,decision:'COLLECT',action:'UPDATE',reason:'FIXTURE_EVIDENCE',wakeCondition:null,deadline:null,knownAt:'2026-11-16T00:00:00Z',evidence:[{claimId:'claim-1',revisionId:'rev-1',originId:'origin-1',groupId:'group-1',official:false,verified:true}],generatorVersion:'fake-model-v1',promptVersion:'prompt-v1',evidenceVersion:'evidence-v1'};}
function draft():PipelineDraft{return {...versions,issueId:'owned-issue-1',storyId:'owned-story-1',decisionId:'decision-1',expectedArticleVersion:0,title:'합성 초안',summary:'실제 기사·게시 없음',bodyRef:'fixture:/draft/one',visibleSections:['KEY_ISSUES','SOURCES'],evidenceVersion:'evidence-v1',firstPublishedAt:null,materialChangeAt:null};}
function snapshot():PipelineSnapshotDraft{return {...versions,snapshotKey:'snapshot-1',streamId:'stream-1',expectedRevision:0,cutoff:'2026-11-16T00:10:00Z',marketBasis:'KR_COMBINED',targetKrTradingDay:'2026-11-16',calendarVersion:'calendar-v1',comparisonSetVersion:'comparison-v1',evaluationSetVersion:'evaluation-v1',nonpriceScaleVersion:'scale-v1',highSignature:'high-signature-v1',issueIds:['owned-issue-1'],highCarry:null,payloadDigest:digest('complete-payload-one')};}
function write<T>(value:T,key='effect-1'){return {effectKey:key,payloadHash:digest(pipelineCanonical(value)),versions:{...versions},value};}
const code=(wanted:string)=>(e:unknown)=>e instanceof PipelineError&&e.code===wanted;

test('K1 accepts bounded synthetic data and preserves unknown origin/time as null',()=>{
  const s=source();s.originId=null;s.independenceGroupId=null;s.timeQuality='PENDING_TIME';s.publishedAt=null;
  assert.deepEqual(validateSourceRevision(s),s);assert.equal(validateSourceRevision(s).originId,null);
  assert.deepEqual(validatePipelineVersions(versions),versions);assert.deepEqual(validatePipelineDecision(decision()),decision());assert.deepEqual(validatePipelineDraft(draft()),draft());assert.deepEqual(validateSnapshotDraft(snapshot()),snapshot());
});
test('REAL data, extra secret-like fields and unexpected schema cannot enter K1',()=>{
  assert.throws(()=>validateSourceRevision({...source(),sampleKind:'PERMITTED_REAL'}),code('LIVE_NOT_ENABLED'));
  assert.throws(()=>validateSourceRevision({...source(),accessToken:'not-a-token'}),code('INVALID_INPUT'));
  assert.throws(()=>validatePipelineVersions({...versions,contractVersion:'unknown'}),code('INVALID_INPUT'));
});
test('source metadata rejects real endpoints, auth URLs, arbitrary file refs and inconsistent times',()=>{
  for(const url of ['https://example.com/article','https://user:pass@news.invalid/x','https://news.invalid:8443/x','https://news.invalid/x#fragment','file:///C:/private'])assert.throws(()=>validateSourceRevision({...source(),canonicalUrl:url}),code('INVALID_INPUT'));
  for(const bodyRef of ['C:/private/file','file:///tmp/body','fixture:/../private'])assert.throws(()=>validateSourceRevision({...source(),bodyRef}),code('INVALID_INPUT'));
  assert.throws(()=>validateSourceRevision({...source(),publishedAt:'2026-11-17T00:00:00Z'}),code('INVALID_INPUT'));
  assert.throws(()=>validateSourceRevision({...source(),publishedAt:'2026-02-30T00:00:00Z'}),code('INVALID_INPUT'));
});
test('input copying does not invoke getters; sparse/cyclic/prototype/nonfinite/oversized data rejected',()=>{
  let touched=false;const value={...source()};Object.defineProperty(value,'title',{enumerable:true,get(){touched=true;return 'wrong';}});
  assert.throws(()=>validateSourceRevision(value),code('INVALID_INPUT'));assert.equal(touched,false);
  const cycle:any={};cycle.self=cycle;for(const bad of [cycle,new Date(),[1,,2],{x:Infinity},{x:'x'.repeat(65537)}])assert.throws(()=>pipelineData(bad),code('INVALID_INPUT'));
  assert.equal(pipelineCanonical({b:1,a:{y:2,x:3}}),pipelineCanonical({a:{x:3,y:2},b:1}));
});
test('independence is not three articles; same origin or owner group remains one',()=>{
  const d=decision();d.evidence=[1,2,3].map(n=>({claimId:'c'+n,revisionId:'rev-1',originId:'same-origin',groupId:'g'+n,official:false,verified:true}));
  assert.equal(pipelineMacroEvidence(d,null).independentGroups,1);assert.equal(pipelineMacroEvidence(d,null).allowed,false);
  d.evidence.forEach((e,n)=>{e.originId='o'+n;e.groupId='same-group';});assert.equal(pipelineMacroEvidence(d,null).independentGroups,1);
  d.evidence.forEach((e,n)=>{e.groupId='g'+n;});assert.equal(pipelineMacroEvidence(d,null).allowed,true);
  d.evidence[2].groupId=null;assert.equal(pipelineMacroEvidence(d,null).allowed,false);
  d.evidence[0].official=true;assert.equal(pipelineMacroEvidence(d,'c1').allowed,true);assert.equal(pipelineMacroEvidence(d,'missing-core').allowed,false);
});
test('HOLD requires a future bounded deadline and wake condition; no anonymous infinite hold',()=>{
  const d={...decision(),decision:'HOLD',wakeCondition:'NEW_EVIDENCE',deadline:'2026-11-17T00:00:00Z'};
  assert.equal(validatePipelineDecision(d).decision,'HOLD');for(const extra of [{deadline:null},{wakeCondition:null},{deadline:'2026-11-20T00:00:00Z'},{deadline:'2026-11-15T00:00:00Z'}])assert.throws(()=>validatePipelineDecision({...d,...extra}),code('INVALID_INPUT'));
});
test('HIGH carry is separate from current context but rejects future state, scale mismatch and price components',()=>{
  const s=snapshot();s.highCarry={completedSnapshotId:'completed-previous',completionDigest:digest('previous'),cutoff:'2026-11-16T00:05:00Z',policyVersion:s.policyVersion,catalogVersion:s.catalogVersion,evaluationSetVersion:s.evaluationSetVersion,nonpriceScaleVersion:s.nonpriceScaleVersion,highSignature:s.highSignature,order:['owned-issue-1'],rows:[{issueId:'owned-issue-1',storyId:'owned-story-1',pool:'B',tier:'HIGH',materialChangeAt:'2026-11-15T23:00:00Z',score:80,M:null}]};
  assert.deepEqual(validateSnapshotDraft(s),s);
  for(const change of [{cutoff:s.cutoff},{nonpriceScaleVersion:'other-scale'},{policyVersion:'old-policy'}])assert.throws(()=>validateSnapshotDraft({...s,highCarry:{...s.highCarry,...change}}),code('INVALID_INPUT'));
  assert.throws(()=>validateSnapshotDraft({...s,highCarry:{...s.highCarry,rows:[{...s.highCarry.rows[0],M:0.5}]}}),code('INVALID_INPUT'));
});
test('source replays are idempotent and new metadata revisions preserve document identity',()=>{
  const repo=new SyntheticPipelineRepositories(versions),s=source(),c=write(s);
  const first=repo.appendSourceRevision(c);assert.equal(first.status,'APPLIED');assert.equal(repo.appendSourceRevision(c).status,'REUSED');
  assert.throws(()=>repo.appendSourceRevision({...c,value:{...s,title:'changed'}}),code('EFFECT_CONFLICT'));
  assert.equal(repo.appendSourceRevision(write({...s,revisionId:'rev-alias'},'effect-alias')).value.revisionId,'rev-1');
  const next=repo.appendSourceRevision(write({...s,revisionId:'rev-2',updatedAt:'2026-11-16T00:00:00Z',contentHash:digest('two')},'effect-2'));assert.equal(next.value.revision,2);
  assert.throws(()=>repo.appendSourceRevision(write({...s,revisionId:'bad',nativeId:'other-native'},'bad-effect')),code('INVALID_INPUT'));
  assert.throws(()=>repo.appendSourceRevision(write({...s,sourceDocumentId:'other-doc',revisionId:'other'},'other-effect')),code('INVALID_INPUT'));
  first.value.revision=999;assert.equal(repo.appendSourceRevision(c).value.revision,1);
});
test('checkpoint gaps and concurrent stale CAS cannot skip missing work',()=>{
  const repo=new SyntheticPipelineRepositories(versions);repo.appendSourceRevision(write(source()));
  const v={sourceId:'source-1',expectedVersion:0,cursor:'page-2',revisionIds:['rev-1'],hasGap:true};
  assert.throws(()=>repo.compareAndSwapCheckpoint(write(v,'checkpoint-gap')),code('RETRYABLE_READ_FAILURE'));assert.equal(repo.readCheckpoint('source-1').version,0);
  const c=write({...v,hasGap:false},'checkpoint-1');assert.equal(repo.compareAndSwapCheckpoint(c).value.version,1);assert.equal(repo.compareAndSwapCheckpoint(c).status,'REUSED');
  assert.throws(()=>repo.compareAndSwapCheckpoint(write({...v,hasGap:false},'stale-checkpoint')),code('VERSION_CONFLICT'));
});
test('draft save requires collected decision and known revisions; old versions lose the CAS',()=>{
  const repo=new SyntheticPipelineRepositories(versions);assert.throws(()=>repo.proposeDecision(write(decision(),'decision-effect')),code('INVALID_INPUT'));
  repo.appendSourceRevision(write(source()));repo.proposeDecision(write(decision(),'decision-effect'));
  assert.equal(repo.saveDraftExpectedVersion(write(draft(),'draft-effect')).value.articleVersion,1);
  assert.throws(()=>repo.saveDraftExpectedVersion(write({...draft(),title:'stale'},'draft-stale')),code('VERSION_CONFLICT'));
  const saved=repo.readDraft('owned-issue-1')!;saved.value.title='mutated';assert.equal(repo.readDraft('owned-issue-1')!.value.title,'합성 초안');
  const hold={...decision(),decisionId:'hold-decision',decision:'HOLD',wakeCondition:'NEW_EVIDENCE',deadline:'2026-11-17T00:00:00Z'};repo.proposeDecision(write(hold,'hold-effect'));
  assert.throws(()=>repo.saveDraftExpectedVersion(write({...draft(),decisionId:'hold-decision'},'blocked-draft')),code('RIGHTS_HOLD'));
});
test('snapshot draft does not move latest; only explicit fixture completion CAS advances it',()=>{
  const repo=new SyntheticPipelineRepositories(versions),s=snapshot();repo.saveSnapshotDraft(write(s,'snapshot-effect'));assert.equal(repo.readLatest(s.streamId),null);
  const c=write({snapshotKey:s.snapshotKey,expectedRevision:0,completionDigest:s.payloadDigest},'complete-effect');
  assert.equal(repo.compareAndSwapLatest(c).value.revision,1);assert.equal(repo.compareAndSwapLatest(c).status,'REUSED');
  repo.saveSnapshotDraft(write({...s,snapshotKey:'snapshot-stale',cutoff:'2026-11-16T00:05:00Z'},'stale-draft'));
  assert.throws(()=>repo.compareAndSwapLatest(write({snapshotKey:'snapshot-stale',expectedRevision:0,completionDigest:s.payloadDigest},'stale-complete')),code('VERSION_CONFLICT'));
  const diag=repo.diagnostics();assert.equal(diag.databaseWrites,0);assert.equal(diag.networkCalls,0);assert.equal(diag.publicationEnabled,false);
});
test('policy drift and bounded effect memory fail before mutations, fixture never enables real mode',()=>{
  const repo=new SyntheticPipelineRepositories(versions,1);repo.appendSourceRevision(write(source()));
  assert.throws(()=>repo.appendSourceRevision(write({...source(),revisionId:'two',contentHash:digest('new')},'second-effect')),code('RATE_LIMITED'));
  assert.throws(()=>new SyntheticPipelineRepositories({...versions,sampleKind:'PERMITTED_REAL'}),code('LIVE_NOT_ENABLED'));
  const changed={...write(source(),'policy-effect'),versions:{...versions,catalogVersion:'old'}};assert.throws(()=>new SyntheticPipelineRepositories(versions).appendSourceRevision(changed),code('POLICY_STALE'));
});

test('one identifier rule applies before writes and across reads, effects and CAS',()=>{
  for(const bad of ['id/1','공통키','with space','x'.repeat(161)]){
    for(const field of ['sourceId','revisionId','sourceDocumentId','nativeId'])assert.throws(()=>validateSourceRevision({...source(),[field]:bad}),code('INVALID_INPUT'));
    for(const field of ['issueId','storyId','decisionId'])assert.throws(()=>validatePipelineDraft({...draft(),[field]:bad}),code('INVALID_INPUT'));
    for(const field of ['snapshotKey','streamId'])assert.throws(()=>validateSnapshotDraft({...snapshot(),[field]:bad}),code('INVALID_INPUT'));
    const repo=new SyntheticPipelineRepositories(versions);
    assert.throws(()=>repo.appendSourceRevision({...write(source()),effectKey:bad}),code('INVALID_INPUT'));
    for(const read of [()=>repo.resolveEffect(bad),()=>repo.readCheckpoint(bad),()=>repo.readDraft(bad),()=>repo.readLatest(bad),()=>repo.readSourceRevision(bad)])assert.throws(read,code('INVALID_INPUT'));
  }
  const repo=new SyntheticPipelineRepositories(versions),s={...source(),revisionId:'rev:1._-'};
  repo.appendSourceRevision(write(s,'effect:1._-'));assert.equal((repo.resolveEffect('effect:1._-') as any).revisionId,s.revisionId);
  assert.equal(repo.readSourceRevision(s.revisionId)!.revisionId,s.revisionId);
  assert.equal(repo.compareAndSwapCheckpoint(write({sourceId:s.sourceId,expectedVersion:0,cursor:'cursor:1._-',revisionIds:[s.revisionId],hasGap:false},'checkpoint:1')).value.version,1);
});

test('canonical URL is a bounded string, never an implicitly coerced JSON value',()=>{
  for(const canonicalUrl of [['https://news.invalid/article/1'],{},null,123,true,'https://news.invalid/'+'x'.repeat(2048)])assert.throws(()=>validateSourceRevision({...source(),canonicalUrl}),code('INVALID_INPUT'));
});

test('same instant and older cutoff lose latest CAS with the correct expected revision',()=>{
  for(const firstCutoff of ['2026-11-16T00:10:00Z','2026-11-16T00:10:00.000Z']){
    const repo=new SyntheticPipelineRepositories(versions),first={...snapshot(),cutoff:firstCutoff};
    repo.saveSnapshotDraft(write(first,'first-snapshot'));repo.compareAndSwapLatest(write({snapshotKey:first.snapshotKey,expectedRevision:0,completionDigest:first.payloadDigest},'first-complete'));
    const cutoffs=['2026-11-16T00:10:00Z','2026-11-16T00:10:00.000Z','2026-11-16T00:05:00Z'];
    cutoffs.forEach((cutoff,n)=>{
      const next={...snapshot(),snapshotKey:'same-or-older-'+n,expectedRevision:1,cutoff,payloadDigest:digest('other-payload-'+n)};
      repo.saveSnapshotDraft(write(next,'candidate-'+n));
      assert.throws(()=>repo.compareAndSwapLatest(write({snapshotKey:next.snapshotKey,expectedRevision:1,completionDigest:next.payloadDigest},'rejected-completion-'+n)),code('VERSION_CONFLICT'));
      assert.equal(repo.readLatest(first.streamId)!.revision,1);
    });
    const forward={...snapshot(),snapshotKey:'forward',expectedRevision:1,cutoff:'2026-11-16T00:15:00.000Z'};
    repo.saveSnapshotDraft(write(forward,'forward-draft'));assert.equal(repo.compareAndSwapLatest(write({snapshotKey:forward.snapshotKey,expectedRevision:1,completionDigest:forward.payloadDigest},'forward-complete')).value.revision,2);
  }
});

test('decision cannot invent origin/group metadata and draft cannot swap evidence version',()=>{
  const repo=new SyntheticPipelineRepositories(versions);repo.appendSourceRevision(write({...source(),originId:null,independenceGroupId:null}));
  assert.throws(()=>repo.proposeDecision(write(decision(),'invented-origin')),code('INVALID_INPUT'));
  const d=decision();d.evidence[0].originId=null;d.evidence[0].groupId=null;
  repo.proposeDecision(write(d,'unknown-origin'));assert.equal(pipelineMacroEvidence(d,null).allowed,false);
  assert.throws(()=>repo.saveDraftExpectedVersion(write({...draft(),evidenceVersion:'other-evidence'},'changed-evidence')),code('INVALID_INPUT'));
  assert.equal(repo.saveDraftExpectedVersion(write(draft(),'matching-evidence')).value.articleVersion,1);
});

test('late older source revisions are retained; arrival number does not replace source times',()=>{
  const repo=new SyntheticPipelineRepositories(versions);
  repo.appendSourceRevision(write({...source(),updatedAt:'2026-11-16T00:00:00Z'}));
  const older={...source(),revisionId:'late-older',publishedAt:'2026-11-15T23:58:00Z',updatedAt:'2026-11-15T23:58:00Z',contentHash:digest('late-old-body')};
  assert.equal(repo.appendSourceRevision(write(older,'late-arrival')).value.revision,2);
  const read=repo.readSourceRevision('late-older')!;assert.equal(read.updatedAt,'2026-11-15T23:58:00Z');read.title='mutated';assert.equal(repo.readSourceRevision('late-older')!.title,older.title);
  assert.equal(repo.readSourceRevision('rev-1')!.updatedAt,'2026-11-16T00:00:00Z');
});

test('evidence version has one format from decision through stored draft',()=>{
  for(const evidenceVersion of ['evidence/v1','with space','근거버전','x'.repeat(161)]){
    assert.throws(()=>validatePipelineDecision({...decision(),evidenceVersion}),code('INVALID_INPUT'));
    assert.throws(()=>validatePipelineDraft({...draft(),evidenceVersion}),code('INVALID_INPUT'));
    const repo=new SyntheticPipelineRepositories(versions);repo.appendSourceRevision(write(source()));
    assert.throws(()=>repo.proposeDecision(write({...decision(),evidenceVersion},'invalid-version')),code('INVALID_INPUT'));
    assert.equal(repo.diagnostics().decisions,0);
  }
  const repo=new SyntheticPipelineRepositories(versions),evidenceVersion='evidence:1._-';repo.appendSourceRevision(write(source()));
  repo.proposeDecision(write({...decision(),evidenceVersion},'valid-version'));
  assert.equal(repo.saveDraftExpectedVersion(write({...draft(),evidenceVersion},'matching-version')).value.articleVersion,1);
  assert.equal(repo.readDraft(draft().issueId)!.value.evidenceVersion,evidenceVersion);
});
