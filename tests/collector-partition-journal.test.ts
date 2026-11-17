import test from 'node:test';
import assert from 'node:assert/strict';
import {PIPELINE_CONTRACT,PipelineError,pipelineCanonical,type PipelineSourceRevision} from '../packages/contracts/src/pipeline.ts';
import {SyntheticSourceReceiptSink,SourceAckLost} from '../workers/collectors/src/source-receipts.ts';
import {SyntheticPartitionJournal,PartitionAckLost} from '../workers/collectors/src/partition-journal.ts';
import {PARTITION_JOURNAL_SCHEMA,DEFAULT_JOURNAL_LIMITS,partitionSha,type JournalLimits,type PartitionAccess,type PartitionLease,type ManifestItem,type PageInput,type CheckpointIntent} from '../workers/collectors/src/partition-contracts.ts';

const versions={contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC' as const,policyVersion:'policy-v1',catalogVersion:'catalog-v1',sourcePolicyVersion:'source-v1'};
const T0='2026-11-17T00:00:00.000Z',T1='2026-11-17T00:01:00.000Z',T6='2026-11-17T00:06:00.000Z',DAY='2026-11-18T00:00:00.000Z';
const range={from:'2026-11-16T23:00:00.000Z',to:T0};
class FakeClock {value=T0;now(){return this.value;}}
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const code=(expected:string)=>(error:unknown)=>error instanceof PipelineError&&error.code===expected;
const accessOf=(l:PartitionLease):PartitionAccess=>({versions:l.versions,partitionId:l.partitionId,workerId:l.workerId,fence:l.fence,permissionGeneration:l.permissionGeneration});
const spec=(patch={})=>({versions,sourceId:'fixture-source',endpointId:'fixture-endpoint',navigationVersion:'nav-v1',queryVersion:'query-v1',adapterVersion:'adapter-v1',sourcePolicyVersion:versions.sourcePolicyVersion,selectionPolicyVersion:'selection-v1',...patch});
function setup(limits:Partial<JournalLimits>={}){
  const clock=new FakeClock(),sink=new SyntheticSourceReceiptSink(versions),journal=new SyntheticPartitionJournal(versions,sink,clock,{...DEFAULT_JOURNAL_LIMITS,...limits}),partition=journal.registerPartition(spec());
  const permission={partitionId:partition.partitionId,generation:1,permissionVersion:'permission-v1',purposes:{DISCOVERY:true,STORAGE:true},knownAt:T0,expiresAt:DAY};
  journal.setPermission({versions,expectedGeneration:0,permission});
  const lease=journal.claim({versions,partitionId:partition.partitionId,workerId:'worker-a',permissionGeneration:1,expectedFence:0,ttlMs:300000});
  return {clock,sink,journal,partition,permission,access:accessOf(lease)};
}
type Fixture=ReturnType<typeof setup>;
const item=(id:string,requiresBody=false):ManifestItem=>({itemId:id,nativeId:'native-'+id,revisionId:'revision-'+id,discoveredAt:T0,requiresBody});
function begin(f:Fixture,scanId='scan',expectedVersion=0,startCursorRef:string|null=null){return f.journal.beginScan({access:f.access,scanId,expectedVersion,startCursorRef,range});}
function page(f:Fixture,items:ManifestItem[]=[],patch:Partial<PageInput>={}){
  return f.journal.appendPage({access:f.access,page:{pageId:'page',scanId:'scan',ordinal:0,previousCursorRef:null,nextCursorOpaque:null,checkpointCursorOpaque:'SYNTHETIC boundary',range,structureVerified:true,tabVerified:true,rangeVerified:true,final:true,outcome:'COMPLETE',atLimit:false,items,...patch}});
}
function command(f:Fixture,i:ManifestItem,key='source-effect-'+i.itemId,patch:Partial<PipelineSourceRevision>={}){
  const value:PipelineSourceRevision={...versions,sourceDocumentId:'document-'+i.itemId,revisionId:i.revisionId,sourceId:f.partition.spec.sourceId,endpointId:f.partition.spec.endpointId,publisherId:'fixture-publisher',originId:null,independenceGroupId:null,canonicalUrl:'https://fixture.invalid/article/'+i.itemId,nativeId:i.nativeId,collectedAt:i.discoveredAt,publishedAt:range.from,updatedAt:null,timeQuality:'KNOWN',contentHash:partitionSha('SYNTHETIC content'),title:'SYNTHETIC fixture title',lead:'SYNTHETIC fixture lead',bodyRef:null,permissionVersion:'permission-v1',...patch};
  return {effectKey:key,versions,value,payloadHash:partitionSha(value)};
}
function bind(f:Fixture,i:ManifestItem,key?:string,patch:Partial<PipelineSourceRevision>={}){
  const intent=f.sink.makeIntent(command(f,i,key,patch));f.journal.bindSourceIntent({access:f.access,itemId:i.itemId,intent});return intent;
}
function pass(f:Fixture,i:ManifestItem){return f.journal.settleItem({access:f.access,itemId:i.itemId,result:{kind:'PASS',selectionPolicyVersion:'selection-v1',reason:'SYNTHETIC out of declared scope'}});}
function prepare(f:Fixture,effectKey='checkpoint-effect',scanId='scan'){return f.journal.prepareCheckpoint({access:f.access,scanId,effectKey});}
function readyEmpty(limits:Partial<JournalLimits>={}){const f=setup(limits);begin(f);page(f);return {...f,intent:prepare(f)};}
function unchanged(f:Fixture,run:()=>unknown,expected:string){const before=f.journal.inspect();assert.throws(run,code(expected));assert.deepEqual(f.journal.inspect(),before);}

test('partition canonical identity binds all route/tab/query/adapter/policy versions without changing source identity',()=>{
  const f=setup(),first=f.partition;
  assert.deepEqual(f.journal.registerPartition(spec()),first);
  for(const patch of [{navigationVersion:'nav-v2'},{queryVersion:'query-v2'},{adapterVersion:'adapter-v2'},{selectionPolicyVersion:'selection-v2'},{endpointId:'another-endpoint'}]){
    const p=f.journal.registerPartition(spec(patch));assert.notEqual(p.partitionId,first.partitionId);assert.equal(p.spec.sourceId,first.spec.sourceId);
  }
  const reordered=Object.fromEntries(Object.entries(spec()).reverse());assert.deepEqual(f.journal.registerPartition(reordered),first);
  unchanged(f,()=>f.journal.registerPartition(spec({sourcePolicyVersion:'mixed'})),'POLICY_STALE');
  unchanged(f,()=>f.journal.registerPartition(spec({versions:{...versions,catalogVersion:'other'}})),'POLICY_STALE');
  assert.equal(f.journal.inspect().executionEnabled,false);assert.equal(f.journal.inspect().schema,PARTITION_JOURNAL_SCHEMA);
});

test('two-page scan stores exact source receipt and explicit PASS before a single checkpoint CAS',()=>{
  const f=setup(),a=item('a'),b=item('b');begin(f);
  const first=page(f,[a],{final:false,nextCursorOpaque:'SYNTHETIC page two',checkpointCursorOpaque:null});
  unchanged(f,()=>prepare(f),'RETRYABLE_READ_FAILURE');
  page(f,[a,b],{pageId:'page-two',ordinal:1,previousCursorRef:first.nextCursorRef});
  const intent=bind(f,a);unchanged(f,()=>f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}}),'EFFECT_UNKNOWN');
  f.sink.write(intent);const stored=f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}});assert.equal(stored.sourceReceipt!.value.revisionId,a.revisionId);
  pass(f,b);const checkpoint=prepare(f),receipt=f.journal.commitCheckpoint({access:f.access,intent:checkpoint});
  assert.equal(receipt.status,'APPLIED');assert.equal(receipt.value.version,1);assert.match(receipt.value.cursorRef!,/^cursor-/);assert.notEqual(receipt.value.cursorRef,'SYNTHETIC boundary');
  f.clock.value=T1;assert.equal(f.journal.commitCheckpoint({access:f.access,intent:checkpoint}).status,'REUSED');assert.equal(f.journal.inspect().checkpoints.length,1);assert.equal(f.sink.diagnostics().revisions,1);
  assert.equal(f.journal.lookupCheckpoint(checkpoint).state,'APPLIED');assert.equal(f.journal.lookupCheckpoint(checkpoint).diagnosticOnly,true);
});

test('normal empty scope still requires explicit valid final page; next=null alone is not complete',()=>{
  const good=setup();begin(good);unchanged(good,()=>prepare(good),'RETRYABLE_READ_FAILURE');page(good);assert.equal(good.journal.commitCheckpoint({access:good.access,intent:prepare(good)}).value.version,1);
  const onlyNull=setup();begin(onlyNull);page(onlyNull,[],{final:false,checkpointCursorOpaque:null});unchanged(onlyNull,()=>prepare(onlyNull),'RETRYABLE_READ_FAILURE');
});

test('gap, failed/partial/at-limit pages, range and tab/structure mismatches never advance checkpoint',()=>{
  const patches:Partial<PageInput>[]=[{ordinal:1},{outcome:'FAILED'},{outcome:'PARTIAL'},{atLimit:true},{tabVerified:false},{structureVerified:false},{rangeVerified:false},{range:{...range,from:'2026-11-16T22:00:00.000Z'}},{nextCursorOpaque:'SYNTHETIC unexpected continuation'}];
  for(const patch of patches){const f=setup();begin(f);page(f,[],patch);unchanged(f,()=>prepare(f),'RETRYABLE_READ_FAILURE');assert.deepEqual(f.journal.inspect().checkpoints,[]);}
});

test('page cursor cycle, cursor discontinuity and an early final page remain gaps',()=>{
  const cycle=setup();begin(cycle);const p=page(cycle,[],{final:false,nextCursorOpaque:'SYNTHETIC cycle',checkpointCursorOpaque:null});
  page(cycle,[],{pageId:'page2',ordinal:1,previousCursorRef:p.nextCursorRef,final:false,nextCursorOpaque:'SYNTHETIC cycle',checkpointCursorOpaque:null});
  page(cycle,[],{pageId:'page3',ordinal:2,previousCursorRef:p.nextCursorRef});unchanged(cycle,()=>prepare(cycle),'RETRYABLE_READ_FAILURE');
  const gap=setup();begin(gap);page(gap,[],{final:false,nextCursorOpaque:'SYNTHETIC next',checkpointCursorOpaque:null});page(gap,[],{pageId:'page2',ordinal:1,previousCursorRef:null});unchanged(gap,()=>prepare(gap),'RETRYABLE_READ_FAILURE');
  const early=setup();begin(early);page(early);page(early,[],{pageId:'page2',ordinal:1});unchanged(early,()=>prepare(early),'RETRYABLE_READ_FAILURE');
});

test('page and item identities are immutable; pagination overlap reuses the same delivery',()=>{
  const f=setup(),a=item('same');begin(f);const p=page(f,[a],{final:false,nextCursorOpaque:'SYNTHETIC next',checkpointCursorOpaque:null});
  assert.deepEqual(page(f,[a],{final:false,nextCursorOpaque:'SYNTHETIC next',checkpointCursorOpaque:null}),p);
  unchanged(f,()=>page(f,[{...a,nativeId:'changed'}],{final:false,nextCursorOpaque:'SYNTHETIC next',checkpointCursorOpaque:null}),'EFFECT_CONFLICT');
  unchanged(f,()=>page(f,[{...a,nativeId:'changed'}],{pageId:'page2',ordinal:1,previousCursorRef:p.nextCursorRef}),'EFFECT_CONFLICT');
  page(f,[a],{pageId:'page2',ordinal:1,previousCursorRef:p.nextCursorRef});assert.equal(f.journal.inspect().items,1);pass(f,a);assert.ok(prepare(f));
});

test('SOURCE_STORED requires actual injected R1 lookup and exact source/endpoint/native/revision/time/permission identity',()=>{
  const patches:Partial<PipelineSourceRevision>[]=[{sourceId:'other'},{endpointId:'other'},{nativeId:'other'},{revisionId:'other'},{collectedAt:T1},{permissionVersion:'other'}];
  for(const patch of patches){const f=setup(),a=item('a');begin(f);page(f,[a]);const sourceIntent=f.sink.makeIntent(command(f,a,undefined,patch));unchanged(f,()=>f.journal.bindSourceIntent({access:f.access,itemId:a.itemId,intent:sourceIntent}),'RIGHTS_HOLD');}
  const f=setup(),a=item('a');begin(f);page(f,[a]);const intent=bind(f,a);assert.equal(f.journal.bindSourceIntent({access:f.access,itemId:a.itemId,intent}).state,'NOT_APPLIED');
  unchanged(f,()=>f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED',success:true}}),'INVALID_INPUT');
  const different=f.sink.makeIntent(command(f,a,'new-key'));unchanged(f,()=>f.journal.bindSourceIntent({access:f.access,itemId:a.itemId,intent:different}),'EFFECT_CONFLICT');
  unchanged(f,()=>f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'PASS',selectionPolicyVersion:'selection-v1',reason:'skip unknown'}}),'EFFECT_CONFLICT');
});

test('R1 before-write/after-receipt ACK losses recover the same intent without duplicate delivery',()=>{
  for(const fault of ['BEFORE_WRITE_LOST','AFTER_RECEIPT_LOST'] as const){
    const f=setup(),a=item('a');begin(f);page(f,[a]);const intent=bind(f,a);assert.throws(()=>f.sink.write(intent,fault),SourceAckLost);
    const recovered=f.sink.recovery(intent);if(recovered.state==='RETRY_SAME_INTENT'){assert.deepEqual(recovered.intent,intent);f.sink.write(recovered.intent);}else assert.equal(recovered.state,'RECOVERED');
    f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}});f.journal.commitCheckpoint({access:f.access,intent:prepare(f)});assert.equal(f.sink.diagnostics().revisions,1);assert.equal(f.sink.diagnostics().effects,1);
  }
});

test('R1 after-intent UNKNOWN cannot settle, prepare, PASS or bind a replacement effect',()=>{
  const f=setup(),a=item('a');begin(f);page(f,[a]);const intent=bind(f,a);assert.throws(()=>f.sink.write(intent,'AFTER_INTENT_LOST'),SourceAckLost);
  unchanged(f,()=>f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}}),'EFFECT_UNKNOWN');
  f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'HOLD_EFFECT_UNKNOWN',reason:'SYNTHETIC unknown'}});
  unchanged(f,()=>prepare(f),'RETRYABLE_READ_FAILURE');unchanged(f,()=>f.journal.bindSourceIntent({access:f.access,itemId:a.itemId,intent:f.sink.makeIntent(command(f,a,'replacement'))}),'EFFECT_CONFLICT');
  unchanged(f,()=>f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'PASS',selectionPolicyVersion:'selection-v1',reason:'bypass'}}),'EFFECT_CONFLICT');assert.equal(f.sink.diagnostics().revisions,0);
});

test('source UNKNOWN cannot be renamed or omitted from a replacement scan to bypass unfinished delivery',()=>{
  const f=setup(),a=item('original');begin(f);page(f,[a]);const intent=bind(f,a);assert.throws(()=>f.sink.write(intent,'AFTER_INTENT_LOST'),SourceAckLost);
  begin(f,'replacement-scan');
  unchanged(f,()=>page(f,[{...a,itemId:'alias'}],{pageId:'alias-page',scanId:'replacement-scan'}),'EFFECT_CONFLICT');
  unchanged(f,()=>page(f,[{...a,itemId:'alias',revisionId:'alias-revision'}],{pageId:'alias-page',scanId:'replacement-scan'}),'EFFECT_CONFLICT');
  page(f,[],{pageId:'empty-replacement',scanId:'replacement-scan'});unchanged(f,()=>prepare(f,'replacement-checkpoint','replacement-scan'),'RETRYABLE_READ_FAILURE');
  assert.equal(f.journal.inspect().items,1);assert.equal(f.sink.lookup(intent).state,'UNKNOWN');
});

test('resume keeps original intent/deadline and H_BODY never becomes checkpoint terminal merely by queueing',()=>{
  const f=setup(),a=item('body',true);begin(f);page(f,[a]);const intent=bind(f,a);f.sink.write(intent);
  f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'H_BODY',reason:'SYNTHETIC body needed'}});
  const command={access:f.access,itemId:a.itemId,resumeId:'resume-body',deadline:'2026-11-17T00:02:00.000Z',wakeCondition:'SYNTHETIC body evidence'};
  const resume=f.journal.enqueueResume(command);assert.equal(resume.intentDigest,intent.commandDigest);f.clock.value=T1;assert.deepEqual(f.journal.enqueueResume(command),resume);
  unchanged(f,()=>f.journal.enqueueResume({...command,deadline:DAY}),'EFFECT_CONFLICT');unchanged(f,()=>prepare(f),'RETRYABLE_READ_FAILURE');
  unchanged(f,()=>f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}}),'RIGHTS_HOLD');
  f.clock.value='2026-11-17T00:03:00.000Z';assert.equal(f.journal.readPending({access:f.access})[0].state,'EXPIRED');assert.equal(f.journal.readPending({access:f.access})[0].deadline,command.deadline);unchanged(f,()=>prepare(f),'RETRYABLE_READ_FAILURE');
  begin(f,'replacement');page(f,[],{pageId:'empty-replacement',scanId:'replacement'});unchanged(f,()=>prepare(f,'replacement-effect','replacement'),'RETRYABLE_READ_FAILURE');
});

test('a later H_BODY is sticky even when the original manifest did not require body',()=>{
  const f=setup(),a=item('late-body');begin(f);page(f,[a]);const intent=bind(f,a);f.sink.write(intent);
  const held=f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'H_BODY',reason:'SYNTHETIC later body need'}});assert.equal(held.bodyRequired,true);assert.equal(held.item.requiresBody,false);
  f.journal.enqueueResume({access:f.access,itemId:a.itemId,resumeId:'late-body-resume',deadline:T1,wakeCondition:'SYNTHETIC evidence'});
  f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'H_PERMISSION',reason:'SYNTHETIC other hold'}});
  unchanged(f,()=>f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}}),'RIGHTS_HOLD');
  unchanged(f,()=>pass(f,a),'EFFECT_CONFLICT');unchanged(f,()=>prepare(f),'RETRYABLE_READ_FAILURE');
});

test('lease expiration/reclaim fences stale renew, release, scan, source binding, item and checkpoint mutation',()=>{
  const f=setup(),a=item('lease');begin(f);page(f,[a]);const sourceIntent=bind(f,a);f.sink.write(sourceIntent);f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}});const intent=prepare(f),stale=copy(f.access);f.clock.value=T6;
  const lease=f.journal.claim({versions,partitionId:f.partition.partitionId,workerId:'worker-b',permissionGeneration:1,expectedFence:1,ttlMs:300000});f.access=accessOf(lease);assert.equal(f.access.fence,2);
  const staleCalls=[()=>f.journal.renew({access:stale,ttlMs:300000}),()=>f.journal.release({access:stale}),()=>f.journal.beginScan({access:stale,scanId:'other',expectedVersion:0,startCursorRef:null,range}),()=>f.journal.appendPage({access:stale,page:{}}),()=>f.journal.bindSourceIntent({access:stale,itemId:a.itemId,intent:sourceIntent}),()=>f.journal.settleItem({access:stale,itemId:a.itemId,result:{kind:'SOURCE_STORED'}}),()=>f.journal.commitCheckpoint({access:stale,intent})];
  for(const run of staleCalls){const before=f.journal.inspect();assert.throws(run);assert.deepEqual(f.journal.inspect(),before);}
  assert.equal(f.journal.commitCheckpoint({access:f.access,intent}).value.version,1);
});

test('lease exact expiry, explicit release and renewal use a monotonic CAS fence',()=>{
  const f=setup();unchanged(f,()=>f.journal.claim({versions,partitionId:f.partition.partitionId,workerId:'worker-b',permissionGeneration:1,expectedFence:1,ttlMs:300000}),'VERSION_CONFLICT');
  f.clock.value=T1;const renewed=f.journal.renew({access:f.access,ttlMs:300000});assert.equal(renewed.expiresAt,T6);f.access=accessOf(renewed);
  f.clock.value=T6;unchanged(f,()=>f.journal.release({access:f.access}),'VERSION_CONFLICT');
  const fresh=f.journal.claim({versions,partitionId:f.partition.partitionId,workerId:'worker-b',permissionGeneration:1,expectedFence:1,ttlMs:300000});f.access=accessOf(fresh);f.journal.release({access:f.access});
  const third=f.journal.claim({versions,partitionId:f.partition.partitionId,workerId:'worker-c',permissionGeneration:1,expectedFence:2,ttlMs:300000});assert.equal(third.fence,3);
});

test('two scans prepared at the same version have exactly one CAS winner; cursor/version start is enforced',()=>{
  const f=setup();begin(f,'scan-a');begin(f,'scan-b');page(f,[],{scanId:'scan-a',pageId:'page-a'});page(f,[],{scanId:'scan-b',pageId:'page-b',checkpointCursorOpaque:'SYNTHETIC other boundary'});
  const a=prepare(f,'cp-a','scan-a'),b=prepare(f,'cp-b','scan-b');f.journal.commitCheckpoint({access:f.access,intent:a});unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:b}),'VERSION_CONFLICT');
  unchanged(f,()=>begin(f,'wrong-version',0,a.cursorRef),'VERSION_CONFLICT');unchanged(f,()=>begin(f,'wrong-cursor',1,null),'VERSION_CONFLICT');
  begin(f,'next-scan',1,a.cursorRef);assert.equal(f.journal.lookupCheckpoint(b).state,'NOT_APPLIED');
});

test('checkpoint BEFORE_WRITE_LOST is NOT_APPLIED and retries identical intent after lease reacquisition',()=>{
  const f=readyEmpty(),before=f.journal.inspect();assert.throws(()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent},'BEFORE_WRITE_LOST'),PartitionAckLost);assert.deepEqual(f.journal.inspect(),before);
  assert.equal(f.journal.lookupCheckpoint(f.intent).state,'NOT_APPLIED');const recovery=f.journal.recoverCheckpoint(f.intent);assert.equal(recovery.recovery,'RETRY_SAME_INTENT');if(recovery.recovery==='RETRY_SAME_INTENT')assert.deepEqual(recovery.intent,f.intent);
  f.clock.value=T6;f.access=accessOf(f.journal.claim({versions,partitionId:f.partition.partitionId,workerId:'worker-b',permissionGeneration:1,expectedFence:1,ttlMs:300000}));
  assert.deepEqual(prepare(f),f.intent);assert.equal(f.journal.commitCheckpoint({access:f.access,intent:f.intent}).status,'APPLIED');
});

test('checkpoint AFTER_INTENT_LOST is UNKNOWN, recovery is read-only and scan forbids a replacement key',()=>{
  const f=readyEmpty();assert.throws(()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent},'AFTER_INTENT_LOST'),PartitionAckLost);const before=f.journal.inspect();
  assert.equal(f.journal.lookupCheckpoint(f.intent).state,'UNKNOWN');assert.equal(f.journal.recoverCheckpoint(f.intent).recovery,'HOLD_EFFECT_UNKNOWN');assert.deepEqual(f.journal.inspect(),before);
  unchanged(f,()=>prepare(f,'new-effect'),'EFFECT_CONFLICT');unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent}),'EFFECT_UNKNOWN');assert.equal(f.journal.inspect().checkpoints.length,0);
});

test('partition UNKNOWN blocks a new scan/key and already prepared competing effect, while other partitions continue',()=>{
  const f=setup();begin(f,'first');begin(f,'competing');page(f,[],{pageId:'first-page',scanId:'first'});page(f,[],{pageId:'competing-page',scanId:'competing'});
  const first=prepare(f,'first-effect','first'),competing=prepare(f,'competing-effect','competing');assert.throws(()=>f.journal.commitCheckpoint({access:f.access,intent:first},'AFTER_INTENT_LOST'),PartitionAckLost);
  unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:competing}),'EFFECT_UNKNOWN');begin(f,'replacement');page(f,[],{pageId:'replacement-page',scanId:'replacement'});unchanged(f,()=>prepare(f,'replacement-effect','replacement'),'EFFECT_UNKNOWN');
  assert.equal(f.journal.lookupCheckpoint(competing).state,'NOT_APPLIED');assert.equal(f.journal.inspect().checkpoints.length,0);
  const second=f.journal.registerPartition(spec({endpointId:'independent-endpoint'})),permission={...f.permission,partitionId:second.partitionId};f.journal.setPermission({versions,expectedGeneration:0,permission});
  const access=accessOf(f.journal.claim({versions,partitionId:second.partitionId,workerId:'other-worker',permissionGeneration:1,expectedFence:0,ttlMs:300000}));const independent={...f,partition:second,permission,access};
  begin(independent,'independent');page(independent,[],{pageId:'independent-page',scanId:'independent'});assert.equal(f.journal.commitCheckpoint({access,intent:prepare(independent,'independent-effect','independent')}).value.version,1);assert.equal(f.journal.inspect().unknownCheckpoints,1);
});

test('checkpoint AFTER_RECEIPT_LOST recovers REUSED without writing, including unavailable lookup HOLD',()=>{
  const f=readyEmpty();assert.throws(()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent},'AFTER_RECEIPT_LOST'),PartitionAckLost);const before=f.journal.inspect(),recovery=f.journal.recoverCheckpoint(f.intent);
  assert.equal(recovery.recovery,'RECOVERED');if(recovery.recovery==='RECOVERED')assert.equal(recovery.receipt.status,'REUSED');const unavailable=f.journal.recoverCheckpoint(f.intent,false);assert.equal(unavailable.recovery,'HOLD_EFFECT_UNKNOWN');assert.equal(unavailable.state,'UNKNOWN');assert.equal(unavailable.receipt,null);assert.deepEqual(f.journal.inspect(),before);
  assert.equal(f.journal.commitCheckpoint({access:f.access,intent:f.intent}).status,'REUSED');assert.equal(f.journal.inspect().checkpoints[0].version,1);
});

test('permission revocation/expiry blocks replay and mutations; old APPLIED lookup remains diagnostic only',()=>{
  const f=readyEmpty();f.journal.commitCheckpoint({access:f.access,intent:f.intent});f.clock.value=T1;
  f.journal.setPermission({versions,expectedGeneration:1,permission:{...f.permission,generation:2,knownAt:T1,purposes:{DISCOVERY:false,STORAGE:false}}});
  unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent}),'RIGHTS_HOLD');unchanged(f,()=>f.journal.renew({access:f.access,ttlMs:300000}),'RIGHTS_HOLD');
  const before=f.journal.inspect(),found=f.journal.lookupCheckpoint(f.intent);assert.equal(found.state,'APPLIED');assert.equal(found.diagnosticOnly,true);assert.equal(found.executionEnabled,false);assert.equal(f.journal.recoverCheckpoint(f.intent).recovery,'RECOVERED');assert.deepEqual(f.journal.inspect(),before);
  f.journal.setPermission({versions,expectedGeneration:2,permission:{...f.permission,generation:3,knownAt:T1}});f.clock.value=T6;
  f.access=accessOf(f.journal.claim({versions,partitionId:f.partition.partitionId,workerId:'worker-b',permissionGeneration:3,expectedFence:1,ttlMs:300000}));unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent}),'RIGHTS_HOLD');
  const expired=setup();expired.clock.value=DAY;unchanged(expired,()=>expired.journal.renew({access:expired.access,ttlMs:300000}),'RIGHTS_HOLD');
});

test('backend/operation/envelope/version tampering and wrong partition reject; no effect-key substitution',()=>{
  const f=readyEmpty(),other=setup();unchanged(other,()=>other.journal.lookupCheckpoint(f.intent),'POLICY_STALE');
  const changed={...f.intent,cursorRef:null};const {envelopeDigest:_hash,...base}=changed;const resigned:CheckpointIntent={...base,envelopeDigest:partitionSha(base)};
  unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:resigned}),'EFFECT_CONFLICT');
  for(const intent of [{...f.intent,operation:'OTHER'},{...f.intent,envelopeDigest:'0'.repeat(64)},{...f.intent,extra:1}])unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent}),'INVALID_INPUT');
  unchanged(f,()=>f.journal.commitCheckpoint({access:{...f.access,versions:{...versions,catalogVersion:'other'}},intent:f.intent}),'POLICY_STALE');
  unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent},'BAD' as any),'INVALID_INPUT');
});

test('rejected future mutation never advances watermark or changes state; successful mutations alone observe time',()=>{
  const f=readyEmpty();f.clock.value='2099-01-01T00:00:00.000Z';
  unchanged(f,()=>f.journal.commitCheckpoint({access:f.access,intent:f.intent}),'RIGHTS_HOLD');
  unchanged(f,()=>f.journal.setPermission({versions,expectedGeneration:99,permission:{...f.permission,generation:100}}),'VERSION_CONFLICT');
  f.clock.value=T1;assert.equal(f.journal.commitCheckpoint({access:f.access,intent:f.intent}).status,'APPLIED');assert.equal(f.journal.inspect().watermark,T1);
  f.clock.value=T0;unchanged(f,()=>f.journal.renew({access:f.access,ttlMs:300000}),'POLICY_STALE');
});

test('source stored before worker exit resumes the same delivery and checkpoint on the same backend',()=>{
  const f=setup(),a=item('a');begin(f);page(f,[a]);const intent=bind(f,a);f.sink.write(intent);f.clock.value=T6;
  f.access=accessOf(f.journal.claim({versions,partitionId:f.partition.partitionId,workerId:'replacement-worker',permissionGeneration:1,expectedFence:1,ttlMs:300000}));
  assert.equal(f.journal.bindSourceIntent({access:f.access,itemId:a.itemId,intent}).state,'APPLIED');f.journal.settleItem({access:f.access,itemId:a.itemId,result:{kind:'SOURCE_STORED'}});f.journal.commitCheckpoint({access:f.access,intent:prepare(f)});
  assert.equal(f.sink.diagnostics().revisions,1);assert.equal(f.journal.inspect().checkpoints[0].version,1);
});

test('count limits preflight partition/item/page/cursor/effect changes without partial inserts',()=>{
  const partition=setup({partitions:1});unchanged(partition,()=>partition.journal.registerPartition(spec({navigationVersion:'different'})),'RATE_LIMITED');
  const itemLimit=setup({items:1});begin(itemLimit);const p=page(itemLimit,[item('a')],{final:false,nextCursorOpaque:'SYNTHETIC next',checkpointCursorOpaque:null});unchanged(itemLimit,()=>page(itemLimit,[item('b')],{pageId:'two',ordinal:1,previousCursorRef:p.nextCursorRef}),'RATE_LIMITED');assert.equal(itemLimit.journal.inspect().items,1);assert.equal(itemLimit.journal.inspect().cursors,1);
  const pageLimit=setup({pages:1});begin(pageLimit);page(pageLimit);unchanged(pageLimit,()=>page(pageLimit,[],{pageId:'two',ordinal:1}),'RATE_LIMITED');
  const cursorLimit=setup({cursors:1});begin(cursorLimit);const c=page(cursorLimit,[],{final:false,nextCursorOpaque:'SYNTHETIC next',checkpointCursorOpaque:null});unchanged(cursorLimit,()=>page(cursorLimit,[],{pageId:'two',ordinal:1,previousCursorRef:c.nextCursorRef}),'RATE_LIMITED');assert.equal(cursorLimit.journal.inspect().pages,1);
  const effectLimit=readyEmpty({effects:1});const receipt=effectLimit.journal.commitCheckpoint({access:effectLimit.access,intent:effectLimit.intent});begin(effectLimit,'next',1,receipt.value.cursorRef);page(effectLimit,[],{pageId:'next-page',scanId:'next',previousCursorRef:receipt.value.cursorRef});unchanged(effectLimit,()=>prepare(effectLimit,'next-effect','next'),'RATE_LIMITED');assert.equal(effectLimit.journal.inspect().effects,1);
});

test('resume count limit cannot modify another job or extend its original deadline',()=>{
  const f=setup({resumes:1}),a=item('a',true),b=item('b',true);begin(f);page(f,[a,b]);
  for(const i of [a,b]){bind(f,i);f.journal.settleItem({access:f.access,itemId:i.itemId,result:{kind:'H_BODY',reason:'SYNTHETIC body'}});}
  const command={access:f.access,itemId:a.itemId,resumeId:'resume-a',deadline:T1,wakeCondition:'SYNTHETIC new body'};const saved=f.journal.enqueueResume(command);
  unchanged(f,()=>f.journal.enqueueResume({...command,itemId:b.itemId,resumeId:'resume-b'}),'RATE_LIMITED');assert.deepEqual(f.journal.readPending({access:f.access})[0],{...saved,state:'PENDING'});
});

test('aggregate JSON cap rejects large cursor history atomically before count caps',()=>{
  const f=setup();begin(f);let previousCursorRef:string|null=null,limited=false;
  for(let n=0;n<100;n++){
    const before=f.journal.inspect();try{const result=page(f,[],{pageId:'page-'+n,ordinal:n,previousCursorRef,final:false,nextCursorOpaque:'SYNTHETIC '+String(n)+'x'.repeat(4000),checkpointCursorOpaque:null});previousCursorRef=result.nextCursorRef;}
    catch(error){assert.ok(code('RATE_LIMITED')(error));assert.deepEqual(f.journal.inspect(),before);assert.ok(before.pages<1000);limited=true;break;}
  }
  assert.ok(limited);assert.equal(f.journal.inspect().checkpoints.length,0);
});

test('aggregate node cap rejects repeated bounded manifests without deleting original items',()=>{
  const f=setup();begin(f);const items=Array.from({length:300},(_,n)=>item('n'+n));let previousCursorRef:string|null=null,limited=false;
  for(let n=0;n<8;n++){
    const before=f.journal.inspect();try{const result=page(f,items,{pageId:'page-'+n,ordinal:n,previousCursorRef,final:false,nextCursorOpaque:'SYNTHETIC next '+n,checkpointCursorOpaque:null});previousCursorRef=result.nextCursorRef;}
    catch(error){assert.ok(code('RATE_LIMITED')(error));assert.deepEqual(f.journal.inspect(),before);assert.equal(before.items,300);assert.ok(before.pages<8);limited=true;break;}
  }
  assert.ok(limited);
});

test('safe DTO boundary rejects getters/cycles/extra fields/LIVE without invoking getters or changing state',()=>{
  const f=setup();let called=0;const hostile=Object.defineProperty({access:f.access},'scanId',{enumerable:true,get(){called++;throw Error('getter');}});
  unchanged(f,()=>f.journal.beginScan(hostile),'INVALID_INPUT');assert.equal(called,0);
  const cycle:any={};cycle.self=cycle;unchanged(f,()=>f.journal.registerPartition(cycle),'INVALID_INPUT');
  unchanged(f,()=>f.journal.registerPartition({...spec(),executionEnabled:true}),'INVALID_INPUT');unchanged(f,()=>f.journal.registerPartition(spec({versions:{...versions,sampleKind:'LIVE'}})),'LIVE_NOT_ENABLED');
  for(const limits of [{...DEFAULT_JOURNAL_LIMITS,items:301},{...DEFAULT_JOURNAL_LIMITS,items:0},{...DEFAULT_JOURNAL_LIMITS,extra:1}])assert.throws(()=>new SyntheticPartitionJournal(versions,f.sink,f.clock,limits),code('INVALID_INPUT'));
});

test('all public results and caller inputs are detached; no fetch, DB or real cursor execution',()=>{
  const oldFetch=globalThis.fetch;let calls=0;globalThis.fetch=(()=>{calls++;throw Error('forbidden');}) as typeof fetch;
  try{
    const f=setup(),input=spec({navigationVersion:'second'}),saved=f.journal.registerPartition(input);input.navigationVersion='changed';saved.spec.navigationVersion='mutated';assert.equal(f.journal.registerPartition(spec({navigationVersion:'second'})).spec.navigationVersion,'second');
    begin(f);const result=page(f);result.items.push(item('outside'));const intent=prepare(f),submitted=copy(intent),receipt=f.journal.commitCheckpoint({access:f.access,intent:submitted});submitted.cursorRef=null;receipt.value.version=999;
    const lookup=f.journal.lookupCheckpoint(intent);lookup.receipt!.value.version=999;const inspect=f.journal.inspect();inspect.checkpoints[0].version=999;inspect.leases[0].workerId='changed';
    assert.equal(f.journal.lookupCheckpoint(intent).receipt!.value.version,1);assert.equal(f.journal.inspect().leases[0].workerId,'worker-a');assert.equal(f.journal.inspect().networkCalls,0);assert.equal(f.journal.inspect().databaseWrites,0);assert.equal(calls,0);
    assert.equal(pipelineCanonical(f.journal.recoverCheckpoint(intent)),pipelineCanonical(f.journal.recoverCheckpoint(intent)));
  }finally{globalThis.fetch=oldFetch;}
});
