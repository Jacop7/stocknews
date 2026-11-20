import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {PIPELINE_CONTRACT,pipelineCanonical,PipelineError} from '../packages/contracts/src/pipeline.ts';
import {EVENT_ROUTING_SCHEMA,prepareEventRoutingRequest,acceptEventRoutingProposal,type EventRoutingContext,type EventRoutingProposal} from '../workers/ai-processing/src/event-routing.ts';
const now='2026-11-17T00:00:00.000Z',before='2026-11-16T23:00:00.000Z',later='2026-11-18T00:00:00.000Z';
const hash=(x:unknown)=>createHash('sha256').update(pipelineCanonical(x)).digest('hex');
function ctx():EventRoutingContext {
  const versions={contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC' as const,policyVersion:'p1',catalogVersion:'c1',sourcePolicyVersion:'s1'};
  return {schema:EVENT_ROUTING_SCHEMA,versions,asOf:now,deadlineAt:later,storyId:'story1',storyVersion:'story-v1',canonicalEventKey:'event1',issueSetVersion:'set1',completeIssueIds:['issue1'],issues:[{issueId:'issue1',issueVersion:'article1',angleCode:'demand',factKeys:['fact-old'],pathKeys:['path-old'],evidenceClaimIds:['claim-old']}],
    decision:{...versions,decisionId:'decision1',inputRevisionIds:['rev1'],storyCandidateKey:'event1',issueCandidateKey:'issue1',decision:'COLLECT',action:'UPDATE',reason:'SYNTHETIC verified assertion',wakeCondition:null,deadline:null,knownAt:now,evidence:[{claimId:'claim1',revisionId:'rev1',originId:'origin1',groupId:'group1',official:true,verified:true}],generatorVersion:'fixture-model',promptVersion:'fixture-prompt',evidenceVersion:'evidence1'},
    revisions:[{...versions,sourceDocumentId:'doc1',revisionId:'rev1',sourceId:'source1',endpointId:'endpoint1',publisherId:'publisher1',originId:'origin1',independenceGroupId:'group1',canonicalUrl:'https://news.invalid/one',nativeId:'one',collectedAt:before,publishedAt:before,updatedAt:null,timeQuality:'KNOWN',contentHash:hash('fixture source'),title:'SYNTHETIC policy confirmed',lead:'SYNTHETIC details',bodyRef:null,permissionVersion:'rights1'}],
    eligibility:[{revisionId:'rev1',permissionVersion:'rights1',sourcePolicyVersion:'s1',analysisAllowed:true,expiresAt:later}],claims:[{claimId:'claim1',factKey:'fact-new',kind:'DETAIL',knownAt:now}],paths:[],corrections:[],delta:{evidenceVersion:'evidence1',storyVersion:'story-v1',knownAt:now,independentTitleSubstance:false,materialDifference:false,comparisons:[{issueId:'issue1',issueVersion:'article1',sameDirection:true,updateSufficient:true}]},promptVersion:'prompt1',generatorVersion:'generator1'};
}
function prop(c=ctx(),action:EventRoutingProposal['proposedAction']='UPDATE'):EventRoutingProposal {
  const p=prepareEventRoutingRequest(c);assert.equal(p.state,'READY_FOR_ROUTING_MODEL');if(p.state!=='READY_FOR_ROUTING_MODEL')throw Error('fixture');
  return {requestDigest:p.requestDigest,proposedAction:action,targetIssueId:'issue1',angleCode:'demand',claimIds:c.claims.map(x=>x.claimId),pathIds:c.paths.map(x=>x.pathId),comparisons:structuredClone(c.delta.comparisons),independentTitleSubstance:c.delta.independentTitleSubstance,materialDifference:c.delta.materialDifference,correctionClaimRefs:[...new Set(c.corrections.map(x=>x.correctedByClaimId))]};
}
function newAngle():EventRoutingContext {const c=ctx();c.delta.independentTitleSubstance=true;c.delta.materialDifference=true;c.delta.comparisons[0].sameDirection=false;c.delta.comparisons[0].updateSufficient=false;return c;}
function correction():EventRoutingContext {const c=ctx();c.corrections=[{issueId:'issue1',oldFactKey:'fact-old',correctedByClaimId:'claim1'}];return c;}
function firstIssue():EventRoutingContext {
  const c=ctx();
  c.completeIssueIds=[];c.issues=[];c.delta.comparisons=[];
  c.decision.action='NEW_ANGLE';c.decision.issueCandidateKey=null;
  c.delta.independentTitleSubstance=true;c.delta.materialDifference=true;
  c.claims[0].kind='FACT';
  c.paths=[{pathId:'korea-path',pathKey:'domestic-impact',sectorId:'power',claimIds:['claim1'],knownAt:now}];
  return c;
}
test('an empty complete story with a current fact and Korean path can plan its first private issue',()=>{
  const c=firstIssue(),p={...prop(c,'NEW_ANGLE'),targetIssueId:null};
  const result=acceptEventRoutingProposal(c,p);
  assert.equal(result.reason,'INITIAL_ISSUE_UNDER_EMPTY_STORY');
  assert.equal(result.action,'NEW_ANGLE');
  assert.deepEqual(result.expectedIssueVersions,[]);
  assert.equal(result.publicationAuthorized,false);
  assert.equal(result.changesPublicTimestamps,false);
  for(const action of ['NO_CHANGE','UPDATE','CORRECTION'] as const){
    assert.equal(acceptEventRoutingProposal(c,{...p,proposedAction:action}).disposition,'HOLD');
  }
  assert.equal(acceptEventRoutingProposal(c,{...p,targetIssueId:'nonexistent'}).disposition,'HOLD');
});
test('the first issue holds before model routing when facts, the linked Korean path or the complete set are absent',()=>{
  for(const change of [
    (c:EventRoutingContext)=>{c.decision.action='UPDATE';},
    (c:EventRoutingContext)=>{c.decision.issueCandidateKey='missing';},
    (c:EventRoutingContext)=>{c.claims[0].kind='DETAIL';},
    (c:EventRoutingContext)=>{c.paths=[];},
    (c:EventRoutingContext)=>{c.delta.independentTitleSubstance=false;},
    (c:EventRoutingContext)=>{c.delta.materialDifference=false;},
    (c:EventRoutingContext)=>{c.eligibility[0].analysisAllowed=false;},
  ]){const c=firstIssue();change(c);assert.equal(prepareEventRoutingRequest(c).state,'HOLD');}
  const c=firstIssue();
  c.claims.push({...c.claims[0],claimId:'detail',kind:'DETAIL'});
  c.decision.evidence.push({...c.decision.evidence[0],claimId:'detail'});
  c.paths[0].claimIds=['detail'];
  assert.equal(prepareEventRoutingRequest(c).state,'HOLD');
  assert.throws(()=>prepareEventRoutingRequest({...firstIssue(),issueSetVersion:null}));
  assert.throws(()=>prepareEventRoutingRequest({...firstIssue(),completeIssueIds:['not-empty']}));
});
test('deterministic digest binds whole request; detached fixture preparation has no publication authority',()=>{const c=ctx(),old=structuredClone(c),a=prepareEventRoutingRequest(c),b=prepareEventRoutingRequest(c);assert.deepEqual(a,b);assert.equal(a.state,'READY_FOR_ROUTING_MODEL');if(a.state!=='READY_FOR_ROUTING_MODEL')return;assert.equal(a.requestDigest,hash(a.request));a.request.issues[0].factKeys.push('tampered');assert.deepEqual(c,old);const r=acceptEventRoutingProposal(c,prop(c));assert.equal(r.action,'UPDATE');assert.equal(r.fixtureAssertionOnly,true);assert.equal(r.publicationAuthorized,false);assert.equal(r.changesPublicTimestamps,false);r.expectedIssueVersions[0].issueVersion='tampered';assert.equal(c.issues[0].issueVersion,'article1');});
test('ordinary new details UPDATE existing issue, never new Story or publication timestamp',()=>{const c=ctx(),r=acceptEventRoutingProposal(c,prop(c));assert.equal(r.action,'UPDATE');assert.equal(r.targetIssueId,'issue1');assert.equal(r.expectedStoryVersion,'story-v1');assert.equal(r.reason,'EXISTING_DETAIL_FIRST');assert.ok(!('materialChangeAt'in r));});
test('same facts, wording and price-only changes do not create a new issue',()=>{for(const kind of ['FACT','PRICE','WORDING'] as const){const c=ctx();c.claims[0].kind=kind;if(kind==='FACT')c.claims[0].factKey='fact-old';assert.equal(acceptEventRoutingProposal(c,prop(c,'NO_CHANGE')).action,'NO_CHANGE');assert.equal(acceptEventRoutingProposal(c,prop(c)).action,'NO_CHANGE');const n={...prop(c,'NEW_ANGLE'),targetIssueId:null,angleCode:'new-angle'};assert.equal(acceptEventRoutingProposal(c,n).disposition,'HOLD');}});
test('NO_CHANGE cannot omit a current new fact or quietly keep old references',()=>{const c=ctx(),p=prop(c,'NO_CHANGE');assert.equal(acceptEventRoutingProposal(c,p).reason,'UNREPORTED_MATERIAL_DIFFERENCE');p.claimIds=[];assert.equal(acceptEventRoutingProposal(c,p).reason,'CONTEXT_DIFFERENCE_MISMATCH');});
test('new fixture fact plus all five angle gates permits a separate angle plan only',()=>{const c=newAngle(),p={...prop(c,'NEW_ANGLE'),targetIssueId:null,angleCode:'supply-cost'},r=acceptEventRoutingProposal(c,p);assert.equal(r.action,'NEW_ANGLE');assert.equal(r.reason,'ALL_FIVE_NEW_ANGLE_GATES');assert.equal(r.targetIssueId,null);assert.equal(r.executionEnabled,false);});
test('each failed angle gate holds unless a same-direction sufficient target is established',()=>{
  for(const change of [(c:EventRoutingContext)=>{c.delta.independentTitleSubstance=false;},(c:EventRoutingContext)=>{c.delta.materialDifference=false;},(c:EventRoutingContext)=>{c.delta.comparisons[0].sameDirection=true;},(c:EventRoutingContext)=>{c.delta.comparisons[0].updateSufficient=true;},(c:EventRoutingContext)=>{c.claims[0].factKey='fact-old';}]){const c=newAngle();change(c);assert.equal(acceptEventRoutingProposal(c,{...prop(c,'NEW_ANGLE'),targetIssueId:null,angleCode:'supply-cost'}).disposition,'HOLD');}
  const c=ctx();assert.equal(acceptEventRoutingProposal(c,prop(c,'NEW_ANGLE')).action,'UPDATE');const wrong=ctx();wrong.delta.comparisons[0].sameDirection=false;assert.equal(acceptEventRoutingProposal(wrong,prop(wrong,'NEW_ANGLE')).disposition,'HOLD');
});
test('new Korean path requires current verified non-price evidence absent from old issue evidence',()=>{const c=newAngle();c.claims[0].factKey='fact-old';c.paths=[{pathId:'path1',pathKey:'kr-new-path',sectorId:'kr-power',claimIds:['claim1'],knownAt:now}];assert.equal(acceptEventRoutingProposal(c,{...prop(c,'NEW_ANGLE'),targetIssueId:null,angleCode:'supply-cost'}).action,'NEW_ANGLE');c.issues[0].evidenceClaimIds.push('claim1');assert.equal(acceptEventRoutingProposal(c,{...prop(c,'NEW_ANGLE'),targetIssueId:null,angleCode:'supply-cost'}).disposition,'HOLD');c.claims[0].kind='PRICE';assert.throws(()=>prepareEventRoutingRequest(c),PipelineError);});
test('complete all-issue comparison and versions cannot be omitted or replaced',()=>{const c=ctx();c.issues.push({...structuredClone(c.issues[0]),issueId:'issue2',issueVersion:'article2',angleCode:'other'});c.completeIssueIds.push('issue2');c.delta.comparisons.push({issueId:'issue2',issueVersion:'article2',sameDirection:false,updateSufficient:false});const p=prop(c);p.comparisons.pop();assert.equal(acceptEventRoutingProposal(c,p).disposition,'HOLD');c.delta.comparisons.pop();assert.throws(()=>prepareEventRoutingRequest(c));});
test('model cannot change semantic assertion booleans or direct an update to a foreign angle',()=>{const c=ctx(),p=prop(c);for(const patch of [{independentTitleSubstance:true},{materialDifference:true},{comparisons:[{...p.comparisons[0],sameDirection:false}]},{targetIssueId:'outside'},{angleCode:'other'}])assert.equal(acceptEventRoutingProposal(c,{...p,...patch}).disposition,'HOLD');});
test('correction context requires correction action and exact links, omissions cannot hide it',()=>{const c=correction();for(const action of ['NO_CHANGE','UPDATE','NEW_ANGLE'] as const)assert.equal(acceptEventRoutingProposal(c,prop(c,action)).reason,'CORRECTION_REQUIRED');const p=prop(c,'CORRECTION');assert.equal(acceptEventRoutingProposal(c,p).action,'CORRECTION');p.correctionClaimRefs=[];assert.equal(acceptEventRoutingProposal(c,p).reason,'CORRECTION_REFERENCES_MISMATCH');assert.equal(acceptEventRoutingProposal(ctx(),prop(ctx(),'CORRECTION')).reason,'CORRECTION_LINK_REQUIRED');});
test('correction with several affected issues holds for full downstream reanalysis',()=>{const c=correction();c.issues.push({...structuredClone(c.issues[0]),issueId:'issue2',issueVersion:'article2'});c.completeIssueIds.push('issue2');c.delta.comparisons.push({issueId:'issue2',issueVersion:'article2',sameDirection:true,updateSufficient:true});c.corrections.push({issueId:'issue2',oldFactKey:'fact-old',correctedByClaimId:'claim1'});assert.equal(acceptEventRoutingProposal(c,prop(c,'CORRECTION')).reason,'CORRECTION_TARGET_REQUIRED');});
test('whole-request digest binds source/title, evidence, rights, story, issue-set, prompt and generator versions',()=>{for(const change of [(c:EventRoutingContext)=>{c.revisions[0].title+=' revised';},(c:EventRoutingContext)=>{c.decision.evidenceVersion='e2';c.delta.evidenceVersion='e2';},(c:EventRoutingContext)=>{c.eligibility[0].expiresAt='2026-11-18T01:00:00.000Z';},(c:EventRoutingContext)=>{c.storyVersion='story-v2';c.delta.storyVersion='story-v2';},(c:EventRoutingContext)=>{c.issues[0].issueVersion='article2';c.delta.comparisons[0].issueVersion='article2';},(c:EventRoutingContext)=>{c.issueSetVersion='set2';},(c:EventRoutingContext)=>{c.promptVersion='p2';},(c:EventRoutingContext)=>{c.generatorVersion='g2';}]){const c=ctx(),p=prop(c);change(c);assert.equal(acceptEventRoutingProposal(c,p).reason,'REQUEST_MISMATCH');}});
test('denied or expired rights hold before evaluating hostile proposal',()=>{for(const patch of [{analysisAllowed:false},{expiresAt:now},{permissionVersion:'wrong'},{sourcePolicyVersion:'wrong'}]){const c=ctx();Object.assign(c.eligibility[0],patch);let calls=0;const p=Object.defineProperty({},'requestDigest',{get(){calls++;throw Error('private');}});assert.equal(acceptEventRoutingProposal(c,p).reason,'ANALYSIS_NOT_ELIGIBLE');assert.equal(calls,0);}});
test('stale and future evidence, source representative and temporal bindings fail closed',()=>{
  for(const change of [(c:EventRoutingContext)=>{c.claims[0].knownAt=later;},(c:EventRoutingContext)=>{c.decision.evidence[0].verified=false;},(c:EventRoutingContext)=>{c.decision.evidence[0].groupId='wrong';},(c:EventRoutingContext)=>{c.revisions.push({...c.revisions[0],revisionId:'new-rev',collectedAt:now,updatedAt:now,title:'SYNTHETIC revision'});},(c:EventRoutingContext)=>{c.delta.evidenceVersion='wrong';},(c:EventRoutingContext)=>{c.delta.knownAt=before;},(c:EventRoutingContext)=>{c.claims[0].knownAt='2026-11-16T22:00:00.000Z';}]){const c=ctx();change(c);assert.equal(prepareEventRoutingRequest(c).state,'HOLD');}
});
test('getters, malformed proposals and injected instructions cannot execute or escape raw errors',()=>{const c=ctx(),p=prop(c),old=structuredClone(c);let calls=0;const getter=Object.defineProperty({...p},'requestDigest',{get(){calls++;throw Error('private');},enumerable:true});const hostile=new Proxy({},{getPrototypeOf(){throw Error('private');}});const cyclic:any={};cyclic.self=cyclic;for(const raw of [getter,hostile,cyclic,{...p,execute:'publish everything'},null,{...p,claimIds:Array(301).fill('a')},{...p,requestDigest:'bad'}])assert.equal(acceptEventRoutingProposal(c,raw).reason,'MALFORMED_PROPOSAL');assert.equal(calls,0);assert.deepEqual(c,old);});
test('context shape, versions, completeness, unknown correction and bounded deadline reject',()=>{const c=ctx();let calls=0;const getter=Object.defineProperty({...c},'asOf',{get(){calls++;return now;},enumerable:true});assert.throws(()=>prepareEventRoutingRequest(getter));assert.equal(calls,0);for(const raw of [{...c,extra:1},{...c,completeIssueIds:[]},{...c,deadlineAt:now},{...c,deadlineAt:'2026-11-21T00:00:00.000Z'},{...c,issues:Array(101).fill(c.issues[0])},{...c,versions:{...c.versions,sampleKind:'LIVE'}},{...c,revisions:[{...c.revisions[0],catalogVersion:'wrong'}]},{...c,corrections:[{issueId:'outside',oldFactKey:'x',correctedByClaimId:'claim1'}]}])assert.throws(()=>prepareEventRoutingRequest(raw));});
test('context cannot omit a decision claim; known decision issue and path chronology remain bound',()=>{const c=ctx();c.decision.evidence.push({...c.decision.evidence[0],claimId:'claim2'});assert.throws(()=>prepareEventRoutingRequest(c));const d=ctx();d.decision.issueCandidateKey='outside';const r=prepareEventRoutingRequest(d);assert.equal(r.state,'HOLD');if(r.state==='HOLD')assert.equal(r.result.reason,'ISSUE_BINDING_REQUIRED');const p=ctx();p.paths=[{pathId:'path1',pathKey:'kr-path',sectorId:'kr-power',claimIds:['claim1'],knownAt:before}];assert.equal(prepareEventRoutingRequest(p).state,'HOLD');});
test('MPP2I-02 old-evidence added path is a difference: NO_CHANGE holds, valid UPDATE remains UPDATE',()=>{
  const c=ctx();c.claims[0].factKey='fact-old';c.issues[0].evidenceClaimIds.push('claim1');c.paths=[{pathId:'path1',pathKey:'added-path',sectorId:'kr-power',claimIds:['claim1'],knownAt:now}];
  assert.equal(acceptEventRoutingProposal(c,prop(c,'NO_CHANGE')).reason,'UNREPORTED_MATERIAL_DIFFERENCE');
  assert.equal(acceptEventRoutingProposal(c,prop(c,'UPDATE')).action,'UPDATE');
  const angle=structuredClone(c);angle.delta.independentTitleSubstance=true;angle.delta.materialDifference=true;angle.delta.comparisons[0].sameDirection=false;angle.delta.comparisons[0].updateSufficient=false;
  assert.equal(acceptEventRoutingProposal(angle,{...prop(angle,'NEW_ANGLE'),targetIssueId:null,angleCode:'new-angle'}).reason,'NEW_ANGLE_NOT_ESTABLISHED');
  assert.equal(acceptEventRoutingProposal(angle,prop(angle,'UPDATE')).reason,'UPDATE_TARGET_NOT_CONFIRMED');
});
test('MPP2I-03 even an input source unused by evidence must have arrived before the decision',()=>{
  const c=ctx(),oldProposal=prop(c);c.asOf='2026-11-17T00:00:02.000Z';
  c.revisions.push({...c.revisions[0],sourceDocumentId:'doc2',revisionId:'rev2',nativeId:'two',canonicalUrl:'https://news.invalid/two',collectedAt:'2026-11-17T00:00:01.000Z'});c.decision.inputRevisionIds.push('rev2');c.eligibility.push({...c.eligibility[0],revisionId:'rev2'});
  assert.ok(!c.decision.evidence.some(e=>e.revisionId==='rev2'));
  const prepared=prepareEventRoutingRequest(c);assert.equal(prepared.state,'HOLD');if(prepared.state==='HOLD')assert.equal(prepared.result.reason,'DECISION_INPUT_TIME_REQUIRED');
  assert.equal(acceptEventRoutingProposal(c,oldProposal).reason,'DECISION_INPUT_TIME_REQUIRED');
  c.decision.knownAt='2026-11-17T00:00:01.000Z';c.delta.knownAt=c.decision.knownAt;assert.equal(prepareEventRoutingRequest(c).state,'READY_FOR_ROUTING_MODEL');assert.equal(acceptEventRoutingProposal(c,prop(c)).action,'UPDATE');
});
