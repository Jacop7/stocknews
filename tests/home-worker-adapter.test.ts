import test from 'node:test';
import assert from 'node:assert/strict';
import {SyntheticHomeWorkerAdapter,HOME_WORKER_SCHEMA,type HomeWorkerOperation,type HomeWorkerResponse} from '../workers/home-ranking/src/completed-adapter.ts';
import {SyntheticCompletedRanking,type K1RankingCommand} from '../packages/domain/src/pipeline-ranking.ts';
import {HOME_RANKING_POLICY} from '../packages/domain/src/home-ranking.ts';
import {PRIORITY_POLICY,ATTENTION_GROUPS,type PriorityIssue} from '../packages/domain/src/issue-priority.ts';
import {SNAPSHOT_POLICY} from '../packages/domain/src/home-snapshot.ts';
import {PipelineError,pipelineData} from '../packages/contracts/src/pipeline.ts';

const BASE=Date.parse('2026-11-15T23:00:00Z'),at=(m:number)=>new Date(BASE+m*60000).toISOString();
const code=(expected:string)=>(error:unknown)=>error instanceof PipelineError&&error.code===expected;
const envelope=(operation:HomeWorkerOperation,payload:unknown=null)=>({schema:HOME_WORKER_SCHEMA,sampleKind:'SYNTHETIC',operation,payload});
function call<O extends HomeWorkerOperation>(worker:SyntheticHomeWorkerAdapter,operation:O,payload:unknown=null):Extract<HomeWorkerResponse,{operation:O}>['result'] {
  const response=worker.dispatch(envelope(operation,payload));
  assert.equal(response.schema,HOME_WORKER_SCHEMA);assert.equal(response.sampleKind,'SYNTHETIC');assert.equal(response.persistence,'MEMORY_FIXTURE_ONLY');assert.equal(response.operation,operation);
  assert.deepEqual(Object.keys(response),['schema','sampleKind','persistence','operation','result']);
  return response.result as Extract<HomeWorkerResponse,{operation:O}>['result'];
}
function issue(id:string):PriorityIssue {
  return {issueId:id,storyId:'story-'+id,version:'v1',assessmentVersion:'a1',sampleKind:'SYNTHETIC',inputKnownAt:at(-60),publishedAt:at(-720),materialChangeAt:at(-60),lastVerifiedAt:at(-60),evidenceValidUntil:at(1380),publicationState:'PUBLISHED',contentClass:'SECTOR_EVENT',impactState:'ACTIVE',direction:'POSITIVE',scope:'SECTOR',assessment:{transmission:{grade:5,claimIds:['claim']},breadth:{grade:5,claimIds:['claim']},magnitude:{grade:5,claimIds:['claim']},persistence:{grade:5,claimIds:['claim']}}};
}
function command(minutes=0,expectedRevision=0):K1RankingCommand {
  const items=[issue('ai'),issue('ship')],meta={sampleKind:'SYNTHETIC' as const,version:'signals-v1',knownAt:at(-60),validUntil:at(1440)};
  return {sampleKind:'SYNTHETIC',snapshotId:'snapshot-'+minutes,expectedRevision,profileId:'SYNTHETIC_PROFILE_V1',nonpriceScaleVersion:'SYNTHETIC_SCALE_V1',sourcePolicyVersion:'SYNTHETIC_SOURCE_V1',recipe:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',policyVersion:HOME_RANKING_POLICY,context:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:at(minutes),policyVersion:SNAPSHOT_POLICY,catalogVersion:'cat1',comparisonSetVersion:'compare1',evaluationSetVersion:'eval1',calendar:{calendarVersion:'cal1',evidenceId:'SYNTHETIC',knownAt:'2026-11-01T00:00:00Z',validUntil:'2026-12-01T00:00:00Z',coverageStart:'2026-11-13',coverageEnd:'2026-11-23',days:Array.from({length:11},(_,n)=>({date:new Date(Date.parse('2026-11-13T00:00:00Z')+n*86400000).toISOString().slice(0,10),state:[1,2,8,9].includes(n)?'CLOSED' as const:'OPEN' as const}))}},priority:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:at(minutes),policyVersion:PRIORITY_POLICY,catalogVersion:'cat1',evaluationSetVersion:'eval1',claims:[{sampleKind:'SYNTHETIC',version:'claim-v1',claimId:'claim',originId:'origin',kind:'FILING',knownAt:at(-780),verifiedAt:at(-720),validUntil:at(1440),status:'VERIFIED'}],issues:items,signals:{T:{...meta,mode:'DERIVED_SYNTHETIC',completedGroups:[...ATTENTION_GROUPS],values:items.map((x,n)=>({...meta,issueId:x.issueId,value:n===0?.8:.1}))}}},sectors:items.map(x=>({issueId:x.issueId,primarySectorId:'sector-'+x.issueId}))}};
}
function complete(worker:SyntheticHomeWorkerAdapter,c=command()) {
  call(worker,'PROPOSE',c);return call(worker,'COMPLETE',{snapshotId:c.snapshotId,expectedRevision:c.expectedRevision});
}
function fallback(c:K1RankingCommand,minutes=15) {
  return {sampleKind:'SYNTHETIC',profileId:c.profileId,nonpriceScaleVersion:c.nonpriceScaleVersion,sourcePolicyVersion:c.sourcePolicyVersion,context:{...c.recipe.context,cutoff:at(minutes),signals:{T:true,M:false,P:false}},eligibility:{knownAt:at(minutes),complete:true,rows:c.recipe.priority.issues.map(i=>({issueId:i.issueId,issueVersion:i.version,publicationState:i.publicationState,impactState:i.impactState,evidenceValidUntil:at(100),evidenceCurrent:true}))}};
}

test('two-phase command boundary preserves latest until complete and exact replay',()=>{
  const w=new SyntheticHomeWorkerAdapter(),c=command(),draft=call(w,'PROPOSE',c);
  assert.equal(draft.status,'SAVED_DRAFT');assert.equal(call(w,'READ_LATEST'),null);
  assert.deepEqual(call(w,'PROPOSE',c),{...draft,status:'REUSED'});
  const done=call(w,'COMPLETE',{snapshotId:c.snapshotId,expectedRevision:0});
  assert.equal(done.status,'COMPLETED');assert.deepEqual(call(w,'READ_LATEST'),done.snapshot);
  assert.deepEqual(call(w,'COMPLETE',{snapshotId:c.snapshotId,expectedRevision:0}),{...done,status:'REUSED'});
  const next=command(5,1);call(w,'PROPOSE',next);assert.deepEqual(call(w,'READ_LATEST'),done.snapshot);
  assert.equal(call(w,'EXPORT_STATE').drafts.length,1);
});

test('engine collision, policy, revision and stale-draft errors preserve state and error codes',()=>{
  const w=new SyntheticHomeWorkerAdapter(),c=command();call(w,'PROPOSE',c);
  const changed=structuredClone(c);changed.profileId='SYNTHETIC_PROFILE_REISSUE';
  const slot=structuredClone(c);slot.snapshotId='another-id';
  const stale=command(10,1);complete(w,c);call(w,'PROPOSE',stale);complete(w,command(5,1));
  const badPolicy=command(15,2);badPolicy.profileId='UNREGISTERED';
  const before=call(w,'EXPORT_STATE');
  for(const [op,payload,expected] of [
    ['PROPOSE',changed,'EFFECT_CONFLICT'],['PROPOSE',slot,'EFFECT_CONFLICT'],
    ['COMPLETE',{snapshotId:c.snapshotId,expectedRevision:1},'VERSION_CONFLICT'],
    ['COMPLETE',{snapshotId:stale.snapshotId,expectedRevision:1},'VERSION_CONFLICT'],
    ['PROPOSE',badPolicy,'POLICY_STALE'],['PROPOSE',command(20,99),'VERSION_CONFLICT']
  ] as const){assert.throws(()=>call(w,op,payload),code(expected));assert.deepEqual(call(w,'EXPORT_STATE'),before);}
});

test('nonempty JSON restore returns explicit null, serializes, replays and preserves the prefix',()=>{
  const source=new SyntheticHomeWorkerAdapter();complete(source);call(source,'PROPOSE',command(5,1));
  const state=JSON.parse(JSON.stringify(call(source,'EXPORT_STATE'))),w=new SyntheticHomeWorkerAdapter();
  for(let n=0;n<2;n++){
    const response=w.dispatch(envelope('RESTORE_STATE',state));assert.equal(response.result,null);
    assert.deepEqual(JSON.parse(JSON.stringify(response)),{schema:HOME_WORKER_SCHEMA,sampleKind:'SYNTHETIC',persistence:'MEMORY_FIXTURE_ONLY',operation:'RESTORE_STATE',result:null});
    assert.deepEqual(call(w,'EXPORT_STATE'),state);
  }
  assert.deepEqual(complete(w,command(5,1)),complete(source,command(5,1)));
  const before=call(w,'EXPORT_STATE'),bad=structuredClone(before);bad.completed[0].digest='0'.repeat(64);
  assert.throws(()=>call(w,'RESTORE_STATE',bad),code('INVALID_INPUT'));assert.deepEqual(call(w,'EXPORT_STATE'),before);
  assert.throws(()=>call(w,'RESTORE_STATE',state),code('INVALID_INPUT'));assert.deepEqual(call(w,'EXPORT_STATE'),before);
  const wrongStream=new SyntheticHomeWorkerAdapter('other-stream');assert.throws(()=>call(wrongStream,'RESTORE_STATE',before),code('INVALID_INPUT'));assert.equal(call(wrongStream,'READ_LATEST'),null);
});

test('fallback requires current complete eligibility and delegates time/context boundaries',()=>{
  const w=new SyntheticHomeWorkerAdapter(),c=command(10);complete(w,c);const before=call(w,'EXPORT_STATE');
  assert.equal(call(w,'FALLBACK',fallback(c,25))!.sourceCutoff,at(10));
  assert.equal(call(w,'FALLBACK',fallback(c,30)),null);assert.equal(call(w,'FALLBACK',fallback(c,5)),null);
  const missing=fallback(c);missing.eligibility.rows.pop();assert.equal(call(w,'FALLBACK',missing),null);
  const hidden=fallback(c);hidden.eligibility.rows[0].publicationState='HIDDEN';assert.equal(call(w,'FALLBACK',hidden),null);
  const incomplete=fallback(c);incomplete.eligibility.complete=false;assert.throws(()=>call(w,'FALLBACK',incomplete),code('RIGHTS_HOLD'));
  const absent=fallback(c) as Record<string,unknown>;delete absent.eligibility;assert.throws(()=>call(w,'FALLBACK',absent),code('INVALID_INPUT'));
  assert.deepEqual(call(w,'EXPORT_STATE'),before);
});

test('exact shell/payload validation rejects malformed or LIVE messages without invoking getters',()=>{
  const w=new SyntheticHomeWorkerAdapter();complete(w);const before=call(w,'EXPORT_STATE');let getterCalls=0;
  const outer=envelope('PROPOSE',command(5,1));Object.defineProperty(outer,'payload',{enumerable:true,get(){getterCalls++;return command(5,1);}});
  const nested=command(5,1);Object.defineProperty(nested.recipe.priority.issues[0],'version',{enumerable:true,get(){getterCalls++;return 'v1';}});
  const hidden=envelope('READ_LATEST');Object.defineProperty(hidden,'payload',{enumerable:false,value:null});
  const symbol=envelope('READ_LATEST');Object.defineProperty(symbol,Symbol('extra'),{value:1});
  const inherited=Object.assign(Object.create({extra:true}),envelope('READ_LATEST'));
  const cycle:any={};cycle.self=cycle;
  for(const raw of [null,[],{},outer,hidden,symbol,inherited,
    {...envelope('READ_LATEST'),schema:'OTHER'},{...envelope('READ_LATEST'),sampleKind:'LIVE'},
    {...envelope('READ_LATEST'),operation:'DIAGNOSTICS'},{...envelope('READ_LATEST'),extra:true},
    envelope('READ_LATEST',{}),{...envelope('EXPORT_STATE'),payload:undefined},envelope('PROPOSE',nested),envelope('PROPOSE',cycle),
    envelope('COMPLETE',{snapshotId:'snapshot-0',expectedRevision:0,extra:1}),envelope('COMPLETE',{snapshotId:'snapshot-0'}),
    envelope('COMPLETE',{snapshotId:'snapshot-0',expectedRevision:-1}),envelope('COMPLETE',{snapshotId:'snapshot-0',expectedRevision:NaN}),
    envelope('PROPOSE',{...command(5,1),sampleKind:'LIVE'}),envelope('PROPOSE',{...command(5,1),extra:true})
  ]){assert.throws(()=>w.dispatch(raw),code('INVALID_INPUT'));assert.deepEqual(call(w,'EXPORT_STATE'),before);}
  assert.equal(getterCalls,0);
});

test('input, snapshot, export, latest and fallback returns cannot mutate owned state',()=>{
  const w=new SyntheticHomeWorkerAdapter(),c=command(10),draft=call(w,'PROPOSE',c);c.profileId='fake';draft.snapshot.command.profileId='fake';
  const done=call(w,'COMPLETE',{snapshotId:'snapshot-10',expectedRevision:0}),baseline=call(w,'EXPORT_STATE');
  done.snapshot.result.state!.records[0].score=0;
  const exported=call(w,'EXPORT_STATE');exported.completed[0].command.profileId='fake';
  const latest=call(w,'READ_LATEST')!;latest.result.lanes.B.length=0;
  const served=call(w,'FALLBACK',fallback(command(10)))!;served.result.lanes.B.length=0;
  assert.deepEqual(call(w,'EXPORT_STATE'),baseline);
  assert.deepEqual(Object.keys(w),[]);assert.equal('engine' in w,false);assert.equal('diagnostics' in w,false);
});

test('engine size budget survives fixed wrapper overhead; over-budget propose/restore are atomic',()=>{
  // Existing priority validation accepts additional pure claim metadata. Tune only that
  // metadata, never the engine limits, to exercise its aggregate 262144-character edge.
  const c=command(),claim=c.recipe.priority.claims[0] as unknown as Record<string,unknown>;
  for(let n=0;n<4;n++)claim['fixturePadding'+n]='';
  const probe=new SyntheticCompletedRanking();probe.propose(c);
  const target=262120,padding=target-JSON.stringify(probe.export()).length;
  assert.ok(padding>0&&padding<=4*65536);
  for(let n=0,remaining=padding;n<4;n++){const count=Math.min(65536,remaining);claim['fixturePadding'+n]='x'.repeat(count);remaining-=count;}
  assert.doesNotThrow(()=>pipelineData(c));
  const w=new SyntheticHomeWorkerAdapter(),draft=call(w,'PROPOSE',c);assert.equal(draft.status,'SAVED_DRAFT');
  const exported=w.dispatch(envelope('EXPORT_STATE'));
  assert.equal(exported.operation,'EXPORT_STATE');assert.equal(JSON.stringify(exported.result).length,target);
  assert.ok(JSON.stringify(exported).length>262144);assert.doesNotThrow(()=>JSON.stringify(exported));
  assert.throws(()=>pipelineData(exported),code('INVALID_INPUT'));
  const restored=new SyntheticHomeWorkerAdapter();assert.equal(call(restored,'RESTORE_STATE',exported.result),null);
  assert.deepEqual(call(restored,'EXPORT_STATE'),exported.result);
  assert.equal(call(w,'COMPLETE',{snapshotId:c.snapshotId,expectedRevision:0}).status,'COMPLETED');
  assert.deepEqual(call(w,'READ_LATEST')!.command,c);
  const before=call(w,'EXPORT_STATE');
  assert.throws(()=>call(w,'PROPOSE',command(5,1)),code('INVALID_INPUT'));assert.deepEqual(call(w,'EXPORT_STATE'),before);
  const tooLarge=structuredClone(before);(tooLarge.completed[0].command.recipe.priority.claims[0] as unknown as Record<string,unknown>).extra='x'.repeat(100);
  assert.throws(()=>call(w,'RESTORE_STATE',tooLarge),code('INVALID_INPUT'));assert.deepEqual(call(w,'EXPORT_STATE'),before);
  const oversized=command(5,1);(oversized.recipe.priority.claims[0] as unknown as Record<string,unknown>).extra='x'.repeat(65537);
  assert.throws(()=>call(w,'PROPOSE',oversized),code('INVALID_INPUT'));assert.deepEqual(call(w,'EXPORT_STATE'),before);
});

test('export retains the engine depth and node budgets without charging wrapper metadata',()=>{
  const deep=command();
  (deep.recipe.priority.claims[0] as unknown as Record<string,unknown>).fixtureDepth={a:{a:{a:{a:'leaf'}}}};
  const depthWorker=new SyntheticHomeWorkerAdapter();call(depthWorker,'PROPOSE',deep);
  const depthResponse=depthWorker.dispatch(envelope('EXPORT_STATE'));
  assert.doesNotThrow(()=>pipelineData(depthResponse.result));
  assert.throws(()=>pipelineData(depthResponse),code('INVALID_INPUT'));
  const restore=new SyntheticHomeWorkerAdapter();assert.equal(call(restore,'RESTORE_STATE',depthResponse.result),null);
  const before=call(depthWorker,'EXPORT_STATE'),tooDeep=structuredClone(before);
  (tooDeep.drafts[0].command.recipe.priority.claims[0] as unknown as Record<string,unknown>).fixtureDepth={a:{a:{a:{a:{a:'leaf'}}}}};
  assert.throws(()=>call(depthWorker,'RESTORE_STATE',tooDeep),code('INVALID_INPUT'));assert.deepEqual(call(depthWorker,'EXPORT_STATE'),before);

  const nodes=command(),buckets:number[][]=Array.from({length:10},()=>[]);
  (nodes.recipe.priority.claims[0] as unknown as Record<string,unknown>).fixtureNodes=buckets;
  const probe=new SyntheticCompletedRanking();probe.propose(nodes);
  const count=(value:unknown):number=>1+(Array.isArray(value)?value.reduce((sum,item)=>sum+count(item),0):value&&typeof value==='object'?Object.values(value).reduce<number>((sum,item)=>sum+count(item),0):0);
  const target=9998;let remaining=target-count(probe.export());assert.ok(remaining>0);
  for(const bucket of buckets){const n=Math.min(1000,remaining);bucket.push(...Array.from({length:n},()=>0));remaining-=n;}
  assert.equal(remaining,0);
  const nodeWorker=new SyntheticHomeWorkerAdapter();call(nodeWorker,'PROPOSE',nodes);
  const nodeResponse=nodeWorker.dispatch(envelope('EXPORT_STATE'));
  assert.equal(count(nodeResponse.result),target);assert.doesNotThrow(()=>pipelineData(nodeResponse.result));
  assert.throws(()=>pipelineData(nodeResponse),code('INVALID_INPUT'));
  assert.equal(call(new SyntheticHomeWorkerAdapter(),'RESTORE_STATE',nodeResponse.result),null);
  const nodeBefore=call(nodeWorker,'EXPORT_STATE'),tooMany=command(5,0);
  (tooMany.recipe.priority.claims[0] as unknown as Record<string,unknown>).fixtureNodes=Array.from({length:10},()=>Array.from({length:1000},()=>0));
  assert.throws(()=>call(nodeWorker,'PROPOSE',tooMany),code('INVALID_INPUT'));assert.deepEqual(call(nodeWorker,'EXPORT_STATE'),nodeBefore);
});

test('all six synchronous fixture commands leave the network fetch hook unused',t=>{
  const fetch=t.mock.method(globalThis,'fetch',()=>{throw new Error('UNEXPECTED_NETWORK');});
  const w=new SyntheticHomeWorkerAdapter(),c=command(10);complete(w,c);
  const state=call(w,'EXPORT_STATE');assert.equal(call(w,'RESTORE_STATE',state),null);
  assert.ok(call(w,'READ_LATEST'));assert.ok(call(w,'FALLBACK',fallback(c)));
  assert.equal(fetch.mock.callCount(),0);
});
