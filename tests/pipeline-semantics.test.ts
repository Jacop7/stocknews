import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PIPELINE_CONTRACT,pipelineCanonical,PipelineError,type PipelineVersions,type PipelineSourceRevision,type PipelineDecision,type PipelineDraft} from '../packages/contracts/src/pipeline.ts';
import {SyntheticPipelineRepositories} from '../packages/contracts/src/pipeline-memory.ts';
import {SyntheticK1Repository} from '../packages/contracts/src/pipeline-k1-memory.ts';
import {selectPipelineSources,projectPipelineVisibility,type K1VisibilityInput} from '../packages/contracts/src/pipeline-semantics.ts';
const ver:PipelineVersions={contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC',policyVersion:'fixture-policy',catalogVersion:'fixture-catalog',sourcePolicyVersion:'fixture-source-policy'};
const at=(n:number)=>new Date(Date.parse('2026-11-17T00:00:00Z')+n*60000).toISOString();
const hash=(x:unknown)=>createHash('sha256').update(pipelineCanonical(x)).digest('hex');
const write=<T>(value:T,effectKey:string)=>({value,versions:ver,effectKey,payloadHash:hash(value)});
const code=(s:string)=>(e:unknown)=>e instanceof PipelineError&&e.code===s;
function source(id='rev-z',collected=10,updated:number|null=0):PipelineSourceRevision{return {...ver,sourceDocumentId:'doc',revisionId:id,sourceId:'source',endpointId:'endpoint',publisherId:'publisher',originId:'origin',independenceGroupId:'group',canonicalUrl:'https://fixture.invalid/one',nativeId:'native',collectedAt:at(collected),publishedAt:at(-10),updatedAt:updated===null?null:at(updated),timeQuality:'KNOWN',contentHash:hash('fixture'),title:'SYNTHETIC 원문',lead:'실제 기사 아님',bodyRef:'fixture:/body',permissionVersion:'fixture-permission'};}
function decision(rev='rev-z'):PipelineDecision{return {...ver,decisionId:'decision',inputRevisionIds:[rev],storyCandidateKey:'story-candidate',issueCandidateKey:null,decision:'COLLECT',action:'UPDATE',reason:'SYNTHETIC',wakeCondition:null,deadline:null,knownAt:at(10),evidence:[{claimId:'claim',revisionId:rev,originId:'origin',groupId:'group',official:false,verified:true}],generatorVersion:'fake',promptVersion:'fake',evidenceVersion:'ev1'};}
function visibility():K1VisibilityInput{return {sampleKind:'SYNTHETIC',evidenceVersion:'ev1',asOf:at(10),keyIssueEvidenceIds:['claim'],analysisEvidenceIds:['claim'],impacts:[{sectorId:'kr-sector',pathId:'path',direction:'BENEFIT',conditionalDirection:'NONE',evidenceIds:['claim']}],scenarios:[{direction:'POSITIVE',text:'SYNTHETIC 조건부 결과',pathIds:['path']}],risks:[],schedule:[]};}
function draft(sections:string[]):PipelineDraft{return {...ver,issueId:'issue',storyId:'story',decisionId:'decision',expectedArticleVersion:0,title:'SYNTHETIC 초안',summary:'실제 게시 없음',bodyRef:'fixture:/draft',visibleSections:sections,evidenceVersion:'ev1',firstPublishedAt:null,materialChangeAt:null};}

test('latest uses source effective time, not arrival sequence; missing updated falls back to published',()=>{
  const current=source('current',10,5),old=source('old',20,0);assert.equal(selectPipelineSources([current,old],ver,at(20))[0].revision!.revisionId,'current');
  const published=source('published',20,null);published.publishedAt=at(8);assert.equal(selectPipelineSources([current,published],ver,at(20))[0].revision!.revisionId,'published');
});
test('same instant semantic disagreement holds; future collection cannot rewrite known history',()=>{
  const a=source('a'),b=source('b');b.title='SYNTHETIC 다른 사실';assert.equal(selectPipelineSources([a,b],ver,at(10))[0].status,'CONFLICT_SAME_TIME');b.collectedAt=at(15);assert.equal(selectPipelineSources([a,b],ver,at(10))[0].revision!.revisionId,'a');
});
test('unknown time holds document; entirely future document is not known',()=>{const a=source(),b=source('unknown');b.publishedAt=null;b.updatedAt=null;b.timeQuality='PENDING_TIME';assert.equal(selectPipelineSources([a,b],ver,at(10))[0].status,'PENDING_TIME');assert.equal(selectPipelineSources([a],ver,at(5))[0].status,'NOT_KNOWN');});
test('equal UTC notation and input permutation select same actual representative without mutation',()=>{
  const a=source('rev-a',5),z=source('rev-z',10);z.updatedAt=z.updatedAt!.replace('.000Z','Z');z.publishedAt=z.publishedAt!.replace('.000Z','Z');const before=structuredClone([a,z]);assert.equal(selectPipelineSources([z,a],ver,at(10))[0].revision!.revisionId,'rev-a');assert.deepEqual(selectPipelineSources([a,z],ver,at(10)),selectPipelineSources([z,a],ver,at(10)));assert.deepEqual([a,z],before);
});
test('metadata disagreements are conflicts even with identical contentHash; version mismatch rejects',()=>{const a=source('a'),b=source('b');b.permissionVersion='permission2';assert.equal(selectPipelineSources([a,b],ver,at(10))[0].status,'CONFLICT_SAME_TIME');assert.throws(()=>selectPipelineSources([{...a,catalogVersion:'other'}],ver,at(10)),code('POLICY_STALE'));});
test('document/native mappings and revision identity cannot be reassigned',()=>{const a=source('a'),b=source('b');b.nativeId='other';assert.throws(()=>selectPipelineSources([a,b],ver,at(10)),code('INVALID_INPUT'));assert.throws(()=>selectPipelineSources([a,{...a,collectedAt:at(11)}],ver,at(20)),code('INVALID_INPUT'));});
test('legacy semantic dedup is preserved while exact delivery retains both original references',()=>{
  const old=new SyntheticPipelineRepositories(ver);old.appendSourceRevision(write(source('z'),'z'));assert.equal(old.appendSourceRevision(write(source('a',5),'a')).value.revisionId,'z');assert.equal(old.readSourceRevision('a'),null);
  const exact=new SyntheticPipelineRepositories(ver);exact.appendSourceRevisionExact(write(source('z'),'z'));assert.equal(exact.appendSourceRevisionExact(write(source('a',5),'a')).value.revisionId,'a');assert.equal(exact.readSourceRevision('a')!.collectedAt,at(5));
});
test('both delivery orders and UTC notation survive append→selection→decision→draft',()=>{
  for(const reverse of [false,true]){const repo=new SyntheticK1Repository(ver),a=source('rev-a',5),z=source('rev-z',10);z.updatedAt=z.updatedAt!.replace('.000Z','Z');for(const r of reverse?[z,a]:[a,z])repo.appendSourceRevision(write(r,'append-'+r.revisionId));
    assert.equal(repo.selectSources(at(7))[0].revision!.revisionId,'rev-a');const d=decision('rev-a');repo.proposeDecision(write(d,'decision'));const v=visibility(),sections=projectPipelineVisibility(v,d).visibleSections,receipt=repo.saveDraftExpectedVersion({command:write(draft(sections),'draft'),visibility:v});assert.equal(receipt.value.articleVersion,1);assert.equal(repo.readProjection('issue')!.scenarioMode,'POSITIVE');assert.equal(repo.diagnostics().networkCalls,0);
  }
});
test('strict COLLECT rejects absent alias, obsolete representative and ambiguous time',()=>{
  const repo=new SyntheticK1Repository(ver);repo.appendSourceRevision(write(source('rev-z'),'z'));repo.appendSourceRevision(write(source('rev-a',5),'a'));assert.throws(()=>repo.proposeDecision(write(decision('rev-z'),'stale')),code('RIGHTS_HOLD'));assert.throws(()=>repo.proposeDecision(write(decision('alias'),'missing')),code('RIGHTS_HOLD'));
  const b=source('conflict');b.title='SYNTHETIC 충돌';repo.appendSourceRevision(write(b,'b'));assert.throws(()=>repo.proposeDecision(write(decision('rev-a'),'conflict')),code('RIGHTS_HOLD'));
});
test('HOLD can be recorded with wake condition but cannot yield a draft',()=>{
  const repo=new SyntheticK1Repository(ver);repo.appendSourceRevision(write(source(),'source'));const d=decision();d.decision='HOLD';d.wakeCondition='SOURCE_TIME_REQUIRED';d.deadline=at(20);repo.proposeDecision(write(d,'hold'));assert.throws(()=>repo.saveDraftExpectedVersion({command:write(draft([]),'draft'),visibility:visibility()}),code('RIGHTS_HOLD'));assert.equal(repo.readDraft('issue'),null);
});
test('new source after decision is rechecked at draft time, failure leaves draft/effect absent',()=>{
  const repo=new SyntheticK1Repository(ver);repo.appendSourceRevision(write(source(),'source'));const d=decision();repo.proposeDecision(write(d,'decision'));repo.appendSourceRevision(write(source('new',12,11),'new'));const v=visibility();v.asOf=at(15);assert.throws(()=>repo.saveDraftExpectedVersion({command:write(draft(projectPipelineVisibility(v,d).visibleSections),'draft'),visibility:v}),code('RIGHTS_HOLD'));assert.equal(repo.readDraft('issue'),null);assert.equal(repo.resolveEffect('draft'),null);
});
test('mixed benefit+damage requires both scenarios, damage-only hides scenarios and requires risk',()=>{
  const d=decision(),v=visibility();v.impacts.push({...v.impacts[0],pathId:'damage',sectorId:'other-sector',direction:'DAMAGE'});assert.throws(()=>projectPipelineVisibility(v,d),code('RIGHTS_HOLD'));v.scenarios.push({direction:'NEGATIVE',text:'SYNTHETIC 피해 조건',pathIds:['damage']});const mixed=projectPipelineVisibility(v,d);assert.equal(mixed.impactProfile,'POSITIVE_NEGATIVE');assert.ok(mixed.visibleSections.includes('DAMAGE_SECTORS'));
  v.impacts.shift();v.scenarios=[];assert.throws(()=>projectPipelineVisibility(v,d),code('RIGHTS_HOLD'));v.risks=[{riskId:'risk',text:'SYNTHETIC 피해 확인',pathIds:['damage'],evidenceIds:['claim']}];const damage=projectPipelineVisibility(v,d);assert.equal(damage.scenarioMode,'HIDDEN');assert.equal(damage.impactProfile,'DAMAGE_ONLY');assert.ok(!damage.visibleSections.includes('SCENARIOS'));assert.ok(damage.visibleSections.includes('RISKS'));
});
test('related positive/mixed/negative-only never becomes a confirmed benefit',()=>{
  const v=visibility(),d=decision();v.impacts[0].direction='RELATED';v.impacts[0].conditionalDirection='POSITIVE';assert.equal(projectPipelineVisibility(v,d).impactProfile,'RELATED_CONDITIONAL');assert.ok(!projectPipelineVisibility(v,d).visibleSections.includes('BENEFIT_SECTORS'));
  v.impacts.push({...v.impacts[0],pathId:'negative',conditionalDirection:'NEGATIVE'});v.scenarios.push({direction:'NEGATIVE',text:'SYNTHETIC 부정 조건',pathIds:['negative']});assert.equal(projectPipelineVisibility(v,d).scenarioMode,'POSITIVE_NEGATIVE');v.impacts.shift();v.scenarios=[];v.risks=[{riskId:'r',text:'SYNTHETIC 불확실성',pathIds:['negative'],evidenceIds:['claim']}];assert.equal(projectPipelineVisibility(v,d).scenarioMode,'HIDDEN');
});
test('scenario text alone cannot invent a positive path; refs/version and duplicate paths reject',()=>{
  const v=visibility(),d=decision();v.impacts=[];assert.throws(()=>projectPipelineVisibility(v,d),code('RIGHTS_HOLD'));assert.throws(()=>projectPipelineVisibility({...visibility(),evidenceVersion:'ev2'},d),code('INVALID_INPUT'));const x=visibility();x.impacts.push({...x.impacts[0],direction:'DAMAGE'});assert.throws(()=>projectPipelineVisibility(x,d),code('INVALID_INPUT'));const missing=visibility();missing.impacts[0].evidenceIds=['missing'];assert.throws(()=>projectPipelineVisibility(missing,d),code('RIGHTS_HOLD'));
});
test('only verified future exact/nonfinished period schedules display; timezone/period label retained',()=>{
  const v=visibility(),d=decision(),common={evidenceIds:['claim'],knownAt:at(0),verified:true,cancelled:false,timezone:'Asia/Seoul',label:'SYNTHETIC 일정'};
  v.schedule=[{...common,scheduleId:'future',kind:'EXACT',eventAt:at(20)},{...common,scheduleId:'past',kind:'EXACT',eventAt:at(10)},{...common,scheduleId:'cancel',cancelled:true,kind:'EXACT',eventAt:at(20)},{...common,scheduleId:'unknown',knownAt:at(11),kind:'EXACT',eventAt:at(20)},{...common,scheduleId:'period',kind:'PERIOD',startAt:at(5),endAt:at(30)}];
  const p=projectPipelineVisibility(v,d);assert.deepEqual(p.schedule.map(x=>x.scheduleId),['future','period']);assert.equal(p.schedule[1].kind,'PERIOD');assert.equal(p.schedule[1].timezone,'Asia/Seoul');assert.ok(p.visibleSections.includes('SCHEDULE'));v.schedule=[];assert.ok(!projectPipelineVisibility(v,d).visibleSections.includes('SCHEDULE'));
});
test('strict draft rejects client sections and binds the full projection to idempotency',()=>{
  const repo=new SyntheticK1Repository(ver),s=source(),d=decision(),v=visibility();repo.appendSourceRevision(write(s,'source'));repo.proposeDecision(write(d,'decision'));assert.throws(()=>repo.saveDraftExpectedVersion({command:write(draft(['KEY_ISSUES']),'invalid'),visibility:v}),code('INVALID_INPUT'));
  const envelope={command:write(draft(projectPipelineVisibility(v,d).visibleSections),'draft'),visibility:v};assert.equal(repo.saveDraftExpectedVersion(envelope).status,'APPLIED');assert.equal(repo.saveDraftExpectedVersion(envelope).status,'REUSED');const changed=structuredClone(envelope);changed.visibility.scenarios[0].text='SYNTHETIC 바뀐 내용';assert.throws(()=>repo.saveDraftExpectedVersion(changed),code('EFFECT_CONFLICT'));assert.equal(repo.readDraft('issue')!.version,1);
});
test('returned projection mutations cannot change stored projection; malformed JSON never executes getters',()=>{
  const repo=new SyntheticK1Repository(ver),d=decision(),v=visibility();repo.appendSourceRevision(write(source(),'source'));repo.proposeDecision(write(d,'decision'));repo.saveDraftExpectedVersion({command:write(draft(projectPipelineVisibility(v,d).visibleSections),'draft'),visibility:v});repo.readProjection('issue')!.impacts[0].direction='DAMAGE';assert.equal(repo.readProjection('issue')!.impacts[0].direction,'BENEFIT');let calls=0;const malformed:any={};Object.defineProperty(malformed,'asOf',{enumerable:true,get(){calls++;return at(10);}});assert.throws(()=>projectPipelineVisibility(malformed,d));assert.equal(calls,0);
});
test('aggregate count limit rejects append before effect/source changes and keeps prior selection usable',()=>{
  const repo=new SyntheticK1Repository(ver,1000);let rejected=false;
  for(let n=0;n<400;n++){
    const s=source('rev-'+String(n).padStart(4,'0')),key='source-'+n,before=repo.diagnostics(),selected=repo.selectSources(at(10));
    try{repo.appendSourceRevision(write(s,key));}
    catch(e){assert.ok(code('RATE_LIMITED')(e));assert.deepEqual(repo.diagnostics(),before);assert.deepEqual(repo.selectSources(at(10)),selected);assert.equal(repo.readSourceRevision(s.revisionId),null);assert.equal(repo.resolveEffect(key),null);rejected=true;break;}
  }
  assert.ok(rejected);assert.ok(repo.diagnostics().revisions<=300);assert.equal(repo.selectSources(at(10))[0].status,'SELECTED');
});
test('aggregate JSON byte/node budget rejects before storing and exact existing delivery remains reusable',()=>{
  const repo=new SyntheticK1Repository(ver,1000);let rejected=false;
  for(let n=0;n<150;n++){
    const s=source('large-'+n);s.lead='S'.repeat(4000);const key='large-effect-'+n,before=repo.diagnostics(),selected=repo.selectSources(at(10));
    try{repo.appendSourceRevision(write(s,key));}
    catch(e){assert.ok(code('RATE_LIMITED')(e));assert.deepEqual(repo.diagnostics(),before);assert.deepEqual(repo.selectSources(at(10)),selected);assert.equal(repo.readSourceRevision(s.revisionId),null);assert.equal(repo.resolveEffect(key),null);rejected=true;break;}
  }
  assert.ok(rejected);assert.ok(repo.diagnostics().revisions<150);const stored=repo.readSourceRevision('large-0')!;assert.equal(repo.appendSourceRevision(write(stored,'same-delivery-new-effect')).value.revisionId,'large-0');assert.equal(repo.selectSources(at(10))[0].status,'SELECTED');
});
