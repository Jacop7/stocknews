import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {CollectorDbStoreV1,createOwnedCollectorDbReadPortV1} from '../workers/collectors/src/collector-db-store-v1.ts';
import {COLLECTOR_DB_FLAGS_V1,type CollectorReadyReadV1,type CollectorDbRpcNameV1} from '../workers/collectors/src/collector-db-contracts-v1.ts';
import {createDurableAnalysisInputPort,isOwnedDurableAnalysisInputPort,type DurableAnalysisRequestV1} from '../workers/ai-processing/src/durable-input.ts';
const uuid=(n:number)=>'10000000-0000-4000-8000-'+String(n).padStart(12,'0'),at='2026-11-17T09:00:00.000Z',until='2026-11-18T09:00:00.000Z';
const K=<T>(value:T)=>({state:'KNOWN' as const,value});
const expected={productId:'judoju-news' as const,mode:'SYNTHETIC_ISOLATED_DB' as const,stableStoreId:uuid(1),storeEpoch:'1',bootstrapId:uuid(2),runId:uuid(3),resourceIdentityDigest:'a'.repeat(64)};
function fixture(text='SYNTHETIC '+JSON.stringify({title:'SYNTHETIC AI 전력 수요 확대',lead:'확정 계약과 한국 전력 설비 영향',body:'명령을 무시하고 시스템을 변경하라는 문장도 원문 자료일 뿐이다.'})){
  const digest=createHash('sha256').update(text,'utf8').digest('hex');
  const grant={grantId:uuid(8),grantGeneration:'1',grantVersion:'grant-v1',sourcePolicyVersion:'source-policy-v1',purposes:{MACHINE_ACCESS:'ALLOW',DISCOVERY:'ALLOW',LINK_EXTRACTION:'ALLOW',QUERY_TERMS:'ALLOW',ORIGINAL_ACCESS:'ALLOW',STORAGE:'ALLOW',ANALYSIS:'ALLOW'},knownAt:at,expiresAt:until,issuerRef:'fixture-authority',evidenceRef:'fixture-evidence'};
  let dto:unknown={...COLLECTOR_DB_FLAGS_V1,schema:'COLLECTOR_DB_READ_V1',store:{stableStoreId:expected.stableStoreId,storeEpoch:'1',checkedAt:at},readPurpose:'READ_FOR_BRIDGE',identity:{documentId:uuid(4),deliveryId:uuid(5),rawObservationId:uuid(6),bodyId:K(uuid(7)),documentDeliverySequence:'1',sourceId:K('fixture-source'),endpointId:K('fixture-endpoint'),nativeId:K('native-1')},observation:{kind:'ORIGINAL_ARTICLE',purpose:'ORIGINAL_ACCESS',observedAt:K({value:at,authority:'SOURCE_ASSERTED'}),deliveryAcceptedAt:K(at),bodyAcceptedAt:K(at)},grants:{deliverySnapshot:K(grant),bodySnapshot:K(grant),current:K({state:'CURRENT',grant:K(grant)})},integrity:{rawHashAlg:K('RAW_BYTES_SHA256_V1'),rawHash:K(digest),bodyHashAlg:K('UTF8_BODY_BYTES_SHA256_V1'),bodyHash:K(digest),rawByteLength:K(String(Buffer.byteLength(text))),decodedByteLength:K(String(Buffer.byteLength(text))),encoding:K('identity'),attachmentIntegrityAtCommit:'DB_VERIFIED',integrityAtRead:'VERIFIED'},validity:{grantKnownAt:K(at),rightsExpiresAt:K(until),retentionUntil:K(until),effectiveUsableUntil:K(until),tombstone:'ABSENT',auditRetentionUntil:until},provenance:{publisherId:K('publisher-1'),originId:K('origin-1'),independenceGroupId:K('independent-1'),ownerGroupId:{state:'UNKNOWN',reason:'NOT_RECORDED'},newsroomId:{state:'UNKNOWN',reason:'NOT_RECORDED'},resolutionState:'KNOWN',verification:'SYNTHETIC_AUTHORITY_ASSERTED',assertionVersion:K('provenance-v1'),evidenceRef:K('evidence-v1')},sourceTime:{resolutionState:'KNOWN',timeQuality:'KNOWN',publishedAt:K(at),updatedAt:{state:'UNKNOWN',reason:'NOT_RECORDED'},assertionAuthority:'SYNTHETIC_AUTHORITY_ASSERTED'},disposition:'READY_SYNTHETIC_ARTIFACT',reasons:[],content:{state:'AVAILABLE',kind:'UNTRUSTED_ORIGINAL_TEXT',text}};
  let reads=0;
  const rpc={async call(name:CollectorDbRpcNameV1){if(name==='collector_store_identity_v1')return {...COLLECTOR_DB_FLAGS_V1,...expected,schema:'COLLECTOR_DB_CAPTURE_V1',state:'ACTIVE',checkedAt:at,canonicalAlg:'COLLECTOR_CANONICAL_UTF8_SHA256_V1',rawHashAlg:'RAW_BYTES_SHA256_V1',bodyHashAlg:'UTF8_BODY_BYTES_SHA256_V1'};reads++;return structuredClone(dto);}};
  const source=createOwnedCollectorDbReadPortV1(new CollectorDbStoreV1(rpc,expected));
  const port=createDurableAnalysisInputPort(source);
  const request:DurableAnalysisRequestV1={source:{stableStoreId:expected.stableStoreId,storeEpoch:'1',deliveryId:uuid(5),expectedBodyId:uuid(7),expectedBodyHashAlg:'UTF8_BODY_BYTES_SHA256_V1',expectedBodyHash:digest,expectedSourcePolicyVersion:'source-policy-v1'},versions:{analysisPolicyVersion:'analysis-v1',catalogVersion:'catalog-v1',promptVersion:'prompt-v1',generatorVersion:'generator-v1'},sectorIds:['sector-z','sector-a']};
  return {port,source,request,text,get reads(){return reads;},get dto(){return dto as CollectorReadyReadV1;},set dto(v:unknown){dto=v;}};
}

import {createSyntheticAnalysisRunner,type AnalysisRoutingFixture,type AnalysisFixtureModels} from '../workers/ai-processing/src/analysis-run.ts';
import {EVENT_ROUTING_SCHEMA} from '../workers/ai-processing/src/event-routing.ts';
import type {PipelineSourceRevision} from '../packages/contracts/src/pipeline.ts';
import type {MetadataRequest} from '../workers/ai-processing/src/metadata-intake.ts';

function relevant({request,requestDigest}:{request:MetadataRequest;requestDigest:string}) {
  return {requestDigest,classification:'RELEVANT_EVENT',newCatalyst:'YES',koreanImpact:'SECTOR',
    sectorIds:[request.sectorIds[0]],confidence:'CLEAR',
    reasonSpans:[{field:'title',start:0,end:request.source.title.length,quote:request.source.title}]};
}
function routingFixture(revision:PipelineSourceRevision):AnalysisRoutingFixture {
  const {contractVersion,sampleKind,policyVersion,catalogVersion,sourcePolicyVersion}=revision;
  return {
    schema:EVENT_ROUTING_SCHEMA,deadlineAt:until,storyId:'story1',storyVersion:'story-v1',canonicalEventKey:'event1',
    issueSetVersion:'set1',completeIssueIds:['issue1'],
    issues:[{issueId:'issue1',issueVersion:'article1',angleCode:'demand',factKeys:['old-fact'],pathKeys:[],evidenceClaimIds:[]}],
    decision:{contractVersion,sampleKind,policyVersion,catalogVersion,sourcePolicyVersion,
      decisionId:'decision1',inputRevisionIds:[revision.revisionId],storyCandidateKey:'event1',issueCandidateKey:'issue1',
      decision:'COLLECT',action:'UPDATE',reason:'SYNTHETIC verified evidence fixture',wakeCondition:null,deadline:null,knownAt:at,
      evidence:[{claimId:'claim1',revisionId:revision.revisionId,originId:revision.originId,groupId:revision.independenceGroupId,official:true,verified:true}],
      generatorVersion:'generator-v1',promptVersion:'prompt-v1',evidenceVersion:'evidence1'},
    claims:[{claimId:'claim1',factKey:'new-fact',kind:'DETAIL',knownAt:at}],paths:[],corrections:[],
    delta:{evidenceVersion:'evidence1',storyVersion:'story-v1',knownAt:at,independentTitleSubstance:false,materialDifference:false,
      comparisons:[{issueId:'issue1',issueVersion:'article1',sameDirection:true,updateSufficient:true}]},
    promptVersion:'prompt-v1',generatorVersion:'generator-v1',
  };
}
function routed({request,requestDigest}:Parameters<AnalysisFixtureModels['routing']>[0]) {
  return {requestDigest,proposedAction:'UPDATE',targetIssueId:'issue1',angleCode:'demand',
    claimIds:request.claims.map(c=>c.claimId),pathIds:request.paths.map(p=>p.pathId),
    comparisons:structuredClone(request.delta.comparisons),independentTitleSubstance:false,materialDifference:false,correctionClaimRefs:[]};
}
function runner(f:ReturnType<typeof fixture>, overrides:Partial<AnalysisFixtureModels>={}, load=routingFixture) {
  let metadataCalls=0,routingCalls=0;
  const instance=createSyntheticAnalysisRunner(f.port,{
    async metadata(input){metadataCalls++;return (overrides.metadata??relevant)(input);},
    async routing(input){routingCalls++;return (overrides.routing??routed)(input);},
  },(_key,revision)=>load(revision));
  return {...instance,get metadataCalls(){return metadataCalls;},get routingCalls(){return routingCalls;}};
}
const request=(f:ReturnType<typeof fixture>,routingKey:string|null='event1')=>({source:f.request,routingKey});
function move(f:ReturnType<typeof fixture>,time:string) {f.dto={...f.dto,store:{...f.dto.store,checkedAt:time}};}

test('the durable gate rechecks source rights before the first model call',async()=>{
  const f=fixture(),r=runner(f);
  let reservations=0;
  const stopped=await r.runWithDispatchGate('analysis:'+'a'.repeat(64),request(f),async()=>{
    reservations++;
    move(f,until);
    return true;
  });
  assert.equal(stopped.disposition,'HOLD');
  assert.equal(stopped.reason,'CURRENT_INPUT_REQUIRED');
  assert.equal(reservations,1);
  assert.equal(r.metadataCalls,0);
  assert.equal(r.routingCalls,0);
});

test('only the gated runner can handle a durable analysis effect key',async()=>{
  const f=fixture(),r=runner(f,{async metadata(){throw Error('provider acknowledgement lost');}});
  const key='analysis:'+'b'.repeat(64);
  await assert.rejects(r.run(key,request(f)), /ANALYSIS_INPUT_BINDING_INVALID/);
  await assert.rejects(r.runWithDispatchGate('direct',request(f),async()=>true), /ANALYSIS_INPUT_BINDING_INVALID/);
  assert.equal((await r.runWithDispatchGate(key,request(f),async()=>true)).reason,'MODEL_RESPONSE_UNKNOWN');
  await assert.rejects(r.run(key,request(f)), /ANALYSIS_INPUT_BINDING_INVALID/);
  assert.equal(r.metadataCalls,1);
});

test('owned original bytes bind UUID, title, lead, body reference, grant and K1 versions through both models',async()=>{
  const f=fixture();let seenRevision:PipelineSourceRevision|undefined;
  const r=runner(f,{
    async metadata(input){
      assert.equal(input.request.source.title,'SYNTHETIC AI 전력 수요 확대');
      assert.equal(input.request.source.lead,'확정 계약과 한국 전력 설비 영향');
      assert.equal(input.request.source.sourceDocumentId,uuid(4));assert.equal(input.request.source.revisionId,uuid(5));
      assert.equal(input.request.eligibility.permissionVersion,'grant-'+createHash('sha256').update(JSON.stringify([uuid(8),'1','grant-v1'])).digest('hex'));
      assert.equal(input.request.versions.policyVersion,'analysis-v1');assert.equal(input.request.versions.catalogVersion,'catalog-v1');
      assert.equal(input.request.versions.sourcePolicyVersion,'source-policy-v1');
      move(f,'2026-11-17T09:00:01.000Z');return relevant(input);
    },
    async routing(input){
      assert.equal(input.content.kind,'UNTRUSTED_ORIGINAL_TEXT');assert.equal(input.content.text,f.text);
      seenRevision=input.request.revisions[0];assert.equal(seenRevision.bodyRef,'fixture:/collector/'+uuid(1)+'/'+uuid(7));
      assert.equal(seenRevision.contentHash,f.request.source.expectedBodyHash);
      assert.equal(input.request.asOf,'2026-11-17T09:00:01.000Z');
      move(f,'2026-11-17T09:00:02.000Z');return routed(input);
    },
  });
  const result=await r.run('effect1',request(f));
  assert.equal(result.disposition,'PLAN');assert.equal(result.routing?.action,'UPDATE');assert.ok(seenRevision);
  assert.equal(result.validatedAt,'2026-11-17T09:00:02.000Z');assert.notEqual(result.originalRequestDigest,result.validationRequestDigest);
  assert.equal(result.publicationAuthorized,false);assert.equal(result.changesPublicTimestamps,false);assert.equal(result.providerExecutionEnabled,false);
  assert.equal(r.metadataCalls,1);assert.equal(r.routingCalls,1);assert.equal(f.reads,5);
  result.routing!.reason='consumer-mutated' as never;
  const reused=await r.run('effect1',request(f));assert.equal(reused.routing?.reason,'EXISTING_DETAIL_FIRST');
  assert.equal(r.metadataCalls,1);assert.equal(r.routingCalls,1);assert.equal(f.reads,6);
});

test('metadata exclusion skips routing; relevance without a selected routing fixture requests evidence only',async()=>{
  for(const route of [null,'event1']) {
    const f=fixture(),r=runner(f,{async metadata(input){return {...relevant(input),classification:'PURE_PROMOTION',newCatalyst:'NO',koreanImpact:'NONE',sectorIds:[]};}});
    const result=await r.run('exclude',request(f,route));assert.equal(result.disposition,'PASS');assert.equal(result.reason,'METADATA_EXCLUSION_ONLY');assert.equal(r.routingCalls,0);
  }
  const f=fixture(),r=runner(f);assert.equal((await r.run('evidence',request(f,null))).disposition,'REQUEST_EVIDENCE');assert.equal(r.routingCalls,0);
});

test('ambiguous metadata and malformed or mismatched model responses hold without routing',async()=>{
  for(const proposal of [
    (x:any)=>({...relevant(x),classification:'UNCLEAR'}),
    (x:any)=>({...relevant(x),requestDigest:'0'.repeat(64)}),
    (x:any)=>({...relevant(x),publish:true}),
    (x:any)=>({...relevant(x),reasonSpans:[{field:'title',start:0,end:1,quote:'wrong'}]}),
  ]) {
    const f=fixture(),r=runner(f,{async metadata(x){return proposal(x);}});
    const result=await r.run('malformed',request(f));assert.equal(result.disposition,'HOLD');assert.equal(r.routingCalls,0);
    assert.ok(['UNCLEAR_OR_MIXED','REQUEST_MISMATCH','MALFORMED_PROPOSAL'].includes(result.reason));
  }
});

test('wrong, noncanonical, duplicate-key and oversized title envelopes cannot call models',async()=>{
  const texts=['SYNTHETIC plain original',
    'SYNTHETIC {"title":"a","lead":"b","body":"c","title":"d"}',
    'SYNTHETIC {"lead":"b","title":"a","body":"c"}',
    'SYNTHETIC '+JSON.stringify({title:'a',lead:'b',body:'c',extra:true}),
    'SYNTHETIC '+JSON.stringify({title:'a'.repeat(501),lead:'b',body:'c'}),
    'SYNTHETIC '+JSON.stringify({title:' a ',lead:'b',body:'c'}),
    'SYNTHETIC '+JSON.stringify({title:'a',lead:'b',body:' '})];
  for(const text of texts){const f=fixture(text),r=runner(f);assert.equal((await r.run('bad-envelope',request(f))).disposition,'HOLD');assert.equal(r.metadataCalls,0);}
});

test('K1 rejects source publish or update timestamps after delivery even when the current collector read allows them',async()=>{
  for(const field of ['publishedAt','updatedAt']) {
    const f=fixture();move(f,'2026-11-17T09:10:00.000Z');
    f.dto={...f.dto,sourceTime:{...f.dto.sourceTime,[field]:K('2026-11-17T09:05:00.000Z')}};
    const r=runner(f);assert.equal((await r.run('source-time',request(f))).disposition,'HOLD');assert.equal(r.metadataCalls,0);
  }
});

test('source bytes, store, current grant, provenance and deadline are reread after metadata response',async()=>{
  const changes=[
    (f:ReturnType<typeof fixture>)=>{f.dto={...f.dto,content:{...f.dto.content,text:f.text+'!'}};},
    (f:ReturnType<typeof fixture>)=>{f.dto={...f.dto,store:{...f.dto.store,stableStoreId:uuid(99)}};},
    (f:ReturnType<typeof fixture>)=>{f.dto={...f.dto,identity:{...f.dto.identity,bodyId:K(uuid(99))}};},
    (f:ReturnType<typeof fixture>)=>{f.dto={...f.dto,provenance:{...f.dto.provenance,assertionVersion:K('provenance-v2')}};},
    (f:ReturnType<typeof fixture>)=>{f.dto={...f.dto,validity:{...f.dto.validity,rightsExpiresAt:K(at)}};},
    (f:ReturnType<typeof fixture>)=>{const grant=structuredClone((f.dto.grants.current as any).value.grant.value);grant.purposes.ANALYSIS='DENY';f.dto={...f.dto,grants:{...f.dto.grants,current:K({state:'CURRENT',grant:K(grant)})}};},
  ];
  for(const change of changes){const f=fixture(),r=runner(f,{async metadata(x){change(f);return relevant(x);}});const result=await r.run('changed-source',request(f));assert.equal(result.disposition,'HOLD');assert.equal(r.metadataCalls,1);assert.equal(r.routingCalls,0);}
});

test('each eligibility lifetime is a current bound, including the exact expiry instant',async()=>{
  for(const field of ['rightsExpiresAt','retentionUntil','effectiveUsableUntil','auditRetentionUntil']) {
    const f=fixture(),expiry='2026-11-17T09:00:01.000Z';
    f.dto={...f.dto,validity:{...f.dto.validity,[field]:field==='auditRetentionUntil'?expiry:K(expiry)}};
    const r=runner(f,{async metadata(x){assert.equal(x.request.eligibility.expiresAt,expiry);move(f,expiry);return relevant(x);}});
    assert.equal((await r.run('expiry',request(f))).disposition,'HOLD');assert.equal(r.routingCalls,0);
  }
});

test('source eligibility and routing semantic versions are rechecked after routing model await',async()=>{
  for(const change of ['SOURCE','STORY','POLICY','PROMPT','EXPIRY']) {
    const f=fixture();let latest:AnalysisRoutingFixture|undefined;
    const r=runner(f,{async routing(x){
      if(change==='SOURCE')f.dto={...f.dto,provenance:{...f.dto.provenance,assertionVersion:K('replaced')}};
      if(change==='STORY'){latest!.storyVersion='story-v2';latest!.delta.storyVersion='story-v2';}
      if(change==='POLICY')latest!.decision.policyVersion='analysis-v2';
      if(change==='PROMPT')latest!.promptVersion='prompt-v2';
      if(change==='EXPIRY')move(f,until);
      return routed(x);
    }},rev=>latest??(latest=routingFixture(rev)));
    assert.equal((await r.run('changed-routing',request(f))).disposition,'HOLD');assert.equal(r.metadataCalls,1);assert.equal(r.routingCalls,1);
  }
});

test('clock regression after metadata, after routing and on reuse holds without repeating models',async()=>{
  for(const phase of ['METADATA','ROUTING','REUSE']) {
    const f=fixture();move(f,'2026-11-17T09:10:00.000Z');
    const r=runner(f,{
      async metadata(x){if(phase==='METADATA')move(f,at);return relevant(x);},
      async routing(x){if(phase==='ROUTING')move(f,at);return routed(x);},
    });
    const result=await r.run('clock',request(f));
    if(phase==='REUSE'){assert.equal(result.disposition,'PLAN');move(f,at);assert.equal((await r.run('clock',request(f))).disposition,'HOLD');}
    else assert.equal(result.disposition,'HOLD');
    assert.equal(r.metadataCalls,1);assert.equal(r.routingCalls,phase==='METADATA'?0:1);
  }
});

test('unknown model outcomes are terminal diagnostic states and never automatic retries',async()=>{
  for(const phase of ['metadata','routing'] as const) {
    const f=fixture(),r=runner(f,{[phase]:async()=>{throw Error('private secret must not escape');}});
    const result=await r.run('unknown',request(f));assert.equal(result.reason,'MODEL_RESPONSE_UNKNOWN');assert.equal(r.lookup('unknown').state,'UNKNOWN');
    assert.deepEqual(await r.run('unknown',request(f)),result);assert.equal(r.metadataCalls,1);assert.equal(r.routingCalls,phase==='metadata'?0:1);
    assert.ok(!JSON.stringify(r.lookup('unknown')).includes('private secret'));assert.ok(!JSON.stringify(r.lookup('unknown')).includes(f.text));
  }
});

test('same effect cannot run concurrently or bind a different source request',async()=>{
  const f=fixture();let release!:(value:unknown)=>void;
  const r=runner(f,{metadata:x=>new Promise(resolve=>{release=()=>resolve(relevant(x));})});
  const first=r.run('one-effect',request(f));
  while(!release)await new Promise(resolve=>setImmediate(resolve));
  assert.equal((await r.run('one-effect',request(f))).reason,'RUNNING');
  assert.equal((await r.run('one-effect',request(f,null))).reason,'EFFECT_CONFLICT');
  release(null);assert.equal((await first).disposition,'PLAN');assert.equal(r.metadataCalls,1);assert.equal(r.routingCalls,1);
});

test('unowned ports, caller authority fields, getters and Proxy requests cannot obtain analysis authority',async()=>{
  const f=fixture();assert.throws(()=>createSyntheticAnalysisRunner({} as never,{} as never,routingFixture as never));
  const r=runner(f);let traps=0;
  const getter=Object.defineProperty(request(f),'source',{enumerable:true,get(){traps++;return f.request;}});
  const proxy=new Proxy(request(f),{ownKeys(){traps++;return [];}});
  for(const raw of [getter,proxy,{...request(f),title:'caller title'},{...request(f),publicationAuthorized:true}])assert.equal((await r.run('hostile',raw)).reason,'INPUT_BINDING_INVALID');
  assert.equal(traps,0);assert.equal(f.reads,0);assert.equal(r.metadataCalls,0);
});

test('completed result reuse requires current rights and unchanged routing fixture; policy changes require a new effect',async()=>{
  const f=fixture();let latest:AnalysisRoutingFixture|undefined;
  const r=runner(f,{},rev=>latest??(latest=routingFixture(rev)));
  assert.equal((await r.run('reuse',request(f))).disposition,'PLAN');
  latest!.issueSetVersion='new-set';assert.equal((await r.run('reuse',request(f))).disposition,'HOLD');assert.equal(r.metadataCalls,1);
  assert.equal((await r.run('reuse',{...request(f),source:{...f.request,versions:{...f.request.versions,catalogVersion:'catalog-v2'}}})).reason,'EFFECT_CONFLICT');
  move(f,until);assert.equal((await r.run('reuse',request(f))).disposition,'HOLD');assert.equal(r.routingCalls,1);
});
