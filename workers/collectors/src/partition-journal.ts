/** Node-only SYNTHETIC_PARTITION_JOURNAL_P2. One backend lifetime, not a durable/distributed queue. */
import {assertPipelineVersions,validatePipelineVersions,validatePipelineWrite,validateSourceRevision,pipelineCanonical,PipelineError,type PipelineVersions} from '../../../packages/contracts/src/pipeline.ts';
import {SyntheticSourceReceiptSink,type SourceIntent,type SourceLookup} from './source-receipts.ts';
import {
  PARTITION_JOURNAL_SCHEMA,CHECKPOINT_OPERATION,DEFAULT_JOURNAL_LIMITS,partitionReject,partitionClone,partitionSha,partitionGeneration,partitionRecord,partitionExact,partitionId,partitionInteger,partitionText,partitionTime,partitionStamp,partitionNullableId,
  validatePartitionSpec,validatePartitionAccess,validateFixturePermission,validatePartitionRange,validatePartitionPage,validateItemResult,validateJournalLimits,validateCheckpointIntent,
  type FixtureClock,type JournalLimits,type RegisteredPartition,type FixturePermission,type PartitionAccess,type PartitionLease,type PartitionScan,type PageManifest,type JournalItem,type ResumeRecord,type PartitionCheckpoint,type CheckpointIntent,type CheckpointReceipt,type CheckpointLookup,type CheckpointRecovery,type CheckpointFault,type ScanCompletion,
} from './partition-contracts.ts';

interface Cursor {partitionId:string;cursorRef:string;opaque:string;}
interface Effect {intent:CheckpointIntent;phase:'PREPARED'|'UNKNOWN'|'APPLIED';receipt:CheckpointReceipt|null;}
interface State {
  backendGeneration:string;watermark:string|null;partitions:RegisteredPartition[];permissions:FixturePermission[];leases:PartitionLease[];
  scans:PartitionScan[];pages:PageManifest[];items:JournalItem[];resumes:ResumeRecord[];cursors:Cursor[];effects:Effect[];checkpoints:PartitionCheckpoint[];
}
interface Context {access:PartitionAccess;partition:RegisteredPartition;permission:FixturePermission;lease:PartitionLease;now:string;}
export class PartitionAckLost extends Error {constructor(){super('SYNTHETIC_PARTITION_ACK_LOST');this.name='PartitionAckLost';}}
const equal=(a:unknown,b:unknown):boolean=>pipelineCanonical(a)===pipelineCanonical(b);
const terminal=(item:JournalItem):boolean=>item.result?.kind==='PASS'||item.result?.kind==='SOURCE_STORED';

export class SyntheticPartitionJournal {
  #versions:PipelineVersions;#source:SyntheticSourceReceiptSink;#clock:FixtureClock;#limits:JournalLimits;#state:State;
  constructor(versions:unknown,sourceSink:SyntheticSourceReceiptSink,clock:FixtureClock,limits:unknown=DEFAULT_JOURNAL_LIMITS){
    this.#versions=validatePipelineVersions(versions);if(!(sourceSink instanceof SyntheticSourceReceiptSink)||!clock||typeof clock.now!=='function')partitionReject();
    this.#source=sourceSink;this.#clock=clock;this.#limits=validateJournalLimits(limits);
    this.#state={backendGeneration:partitionGeneration(),watermark:null,partitions:[],permissions:[],leases:[],scans:[],pages:[],items:[],resumes:[],cursors:[],effects:[],checkpoints:[]};
  }
  get backendGeneration():string {return this.#state.backendGeneration;}
  #command(raw:unknown,keys:string[]):Record<string,unknown> {const v=partitionRecord(raw);partitionExact(v,keys);return v;}
  #now():string {const now=partitionStamp(this.#clock.now());if(this.#state.watermark!==null&&partitionTime(now)<partitionTime(this.#state.watermark))partitionReject('POLICY_STALE');return now;}
  #partition(id:string,state=this.#state):RegisteredPartition {const found=state.partitions.find(p=>p.partitionId===id);if(!found)partitionReject();return found;}
  #permission(id:string,generation:number,now:string):FixturePermission {
    const p=this.#state.permissions.find(x=>x.partitionId===id);
    if(!p||p.generation!==generation||!p.purposes.DISCOVERY||!p.purposes.STORAGE||partitionTime(p.knownAt)>partitionTime(now)||partitionTime(p.expiresAt)<=partitionTime(now))partitionReject('RIGHTS_HOLD');return p;
  }
  #guard(raw:unknown):Context {
    const access=validatePartitionAccess(raw);assertPipelineVersions(access.versions,this.#versions);const partition=this.#partition(access.partitionId),now=this.#now(),permission=this.#permission(access.partitionId,access.permissionGeneration,now);
    const lease=this.#state.leases.find(x=>x.partitionId===access.partitionId);
    if(!lease||lease.released||lease.fence!==access.fence||lease.workerId!==access.workerId||lease.permissionGeneration!==permission.generation||partitionTime(lease.expiresAt)<=partitionTime(now))partitionReject('VERSION_CONFLICT');
    return {access,partition,permission,lease,now};
  }
  #checkpoint(id:string,state=this.#state):PartitionCheckpoint {return state.checkpoints.find(x=>x.partitionId===id)??{partitionId:id,version:0,cursorRef:null,scanId:null,manifestDigest:null};}
  #scan(scanId:string,ctx:Context,state=this.#state):PartitionScan {
    const scan=state.scans.find(x=>x.scanId===scanId);if(!scan||scan.partitionId!==ctx.access.partitionId)partitionReject();if(scan.permissionGeneration!==ctx.permission.generation)partitionReject('POLICY_STALE');return scan;
  }
  #item(itemId:string,ctx:Context,state=this.#state):JournalItem {const item=state.items.find(x=>x.partitionId===ctx.access.partitionId&&x.item.itemId===itemId);if(!item)partitionReject();return item;}
  #save<T>(now:string,state:State,result:T):T {
    // Preflight the entire staged state AND response before changing any owned reference.
    // Counts are maxima, not a promise to bypass the existing aggregate JSON/node budget.
    if(state.partitions.length>this.#limits.partitions||state.items.length>this.#limits.items||state.resumes.length>this.#limits.resumes||state.pages.length>this.#limits.pages||state.scans.length>this.#limits.pages||state.effects.length>this.#limits.effects||state.cursors.length>this.#limits.cursors)partitionReject('RATE_LIMITED');
    state.watermark=now;let detached:State;
    try{detached=partitionClone(state);}catch(e){if(e instanceof PipelineError&&e.code==='INVALID_INPUT')partitionReject('RATE_LIMITED');throw e;}
    const output=partitionClone(result);this.#state=detached;return output;
  }
  #cursor(state:State,partitionId:string,opaque:string|null):string|null {
    if(opaque===null)return null;const cursorRef='cursor-'+partitionSha({partitionId,opaque}),old=state.cursors.find(x=>x.cursorRef===cursorRef);
    if(old){if(old.partitionId!==partitionId||old.opaque!==opaque)partitionReject('EFFECT_CONFLICT');}else state.cursors.push({partitionId,cursorRef,opaque});return cursorRef;
  }
  #sourceLookup(item:JournalItem,ctx:Context):SourceLookup {
    if(!item.intent)partitionReject();const i=item.intent,safe=partitionRecord(i);
    partitionExact(safe,['schema','sampleKind','operation','storeGeneration','commandDigest','command']);
    const command=validatePipelineWrite(safe.command,validateSourceRevision),r=command.value;
    assertPipelineVersions(command.versions,this.#versions);assertPipelineVersions(r,this.#versions);
    if(r.sourceId!==ctx.partition.spec.sourceId||r.endpointId!==ctx.partition.spec.endpointId||r.nativeId!==item.item.nativeId||r.revisionId!==item.item.revisionId||partitionStamp(r.collectedAt)!==item.item.discoveredAt||r.permissionVersion!==ctx.permission.permissionVersion||partitionTime(r.collectedAt)>partitionTime(ctx.now))partitionReject('RIGHTS_HOLD');
    // Call the actual R1 implementation, with its private backing store, rather than a caller success assertion.
    return SyntheticSourceReceiptSink.prototype.lookup.call(this.#source,i);
  }
  #completion(scan:PartitionScan,ctx:Context):ScanCompletion {
    const pages=this.#state.pages.filter(p=>p.scanId===scan.scanId).sort((a,b)=>a.ordinal-b.ordinal),reasons=new Set<string>();
    if(!pages.length)reasons.add('NO_PAGES');let expected=scan.startCursorRef;const seen=new Set<string>();if(expected!==null)seen.add(expected);
    const itemIds=new Set<string>();
    pages.forEach((page,index)=>{
      if(page.ordinal!==index)reasons.add('PAGE_ORDINAL_GAP');if(page.previousCursorRef!==expected)reasons.add('PAGE_CURSOR_GAP');
      if(page.nextCursorRef!==null){if(seen.has(page.nextCursorRef))reasons.add('CURSOR_CYCLE');seen.add(page.nextCursorRef);}expected=page.nextCursorRef;
      if(!equal(page.range,scan.range)||!page.rangeVerified)reasons.add('RANGE_GAP');if(!page.structureVerified)reasons.add('STRUCTURE_UNVERIFIED');if(!page.tabVerified)reasons.add('TAB_UNVERIFIED');
      if(page.outcome!=='COMPLETE')reasons.add('PAGE_'+page.outcome);if(page.atLimit)reasons.add('PAGE_LIMIT');
      if(page.final&&index!==pages.length-1)reasons.add('EARLY_FINAL_PAGE');if(page.final&&page.nextCursorRef!==null)reasons.add('FINAL_HAS_NEXT_CURSOR');
      for(const item of page.items)itemIds.add(item.itemId);
    });
    const last=pages.at(-1);if(!last||!last.final||last.nextCursorRef!==null)reasons.add('FINAL_PAGE_UNCONFIRMED');
    // A new scan cannot erase already discovered unfinished work by omitting its item IDs.
    // There is deliberately no eviction/abandonment or durable body-resume contract in P2.
    if(this.#state.items.some(i=>i.partitionId===ctx.access.partitionId&&!terminal(i)))reasons.add('UNRESOLVED_PARTITION_ITEM');
    for(const itemId of itemIds){
      const item=this.#item(itemId,ctx);if(!terminal(item)||item.settledPermissionGeneration!==ctx.permission.generation){reasons.add('ITEM_NOT_TERMINAL');continue;}
      if(item.result?.kind==='SOURCE_STORED'){
        if(item.bodyRequired){reasons.add('BODY_RESUME_NOT_GUARANTEED');continue;}
        if(this.#sourceLookup(item,ctx).state!=='APPLIED')reasons.add('SOURCE_RECEIPT_UNCONFIRMED');
      }else if(item.result?.kind==='PASS'&&(item.intent!==null||item.result.selectionPolicyVersion!==ctx.partition.spec.selectionPolicyVersion))reasons.add('PASS_BINDING_MISMATCH');
    }
    const {checkpointEffectKey:_key,...scanBinding}=scan;
    return {ready:reasons.size===0,reasons:[...reasons].sort(),manifestDigest:partitionSha({scan:scanBinding,pages:pages.map(p=>p.manifestDigest)}),cursorRef:last?.checkpointCursorRef??null};
  }

  registerPartition(raw:unknown):RegisteredPartition {
    // Bootstrap configuration has no existing lease. Its boundary is exact versions/spec identity.
    const spec=validatePartitionSpec(raw);assertPipelineVersions(spec.versions,this.#versions);const partitionId='partition-'+partitionSha(spec),now=this.#now(),old=this.#state.partitions.find(p=>p.partitionId===partitionId);
    if(old&&!equal(old.spec,spec))partitionReject('EFFECT_CONFLICT');const next=partitionClone(this.#state),value=old??{partitionId,spec};if(!old)next.partitions.push(value);return this.#save(now,next,value);
  }
  setPermission(raw:unknown):FixturePermission {
    // Explicit fixture authority CAS also permits revocation without a runnable lease.
    const v=this.#command(raw,['versions','expectedGeneration','permission']);assertPipelineVersions(validatePipelineVersions(v.versions),this.#versions);
    const p=validateFixturePermission(v.permission),expected=partitionInteger(v.expectedGeneration),now=this.#now();this.#partition(p.partitionId);
    const old=this.#state.permissions.find(x=>x.partitionId===p.partitionId);
    if((old?.generation??0)!==expected||p.generation!==expected+1)partitionReject('VERSION_CONFLICT');if(partitionTime(p.knownAt)>partitionTime(now)||old&&partitionTime(p.knownAt)<partitionTime(old.knownAt))partitionReject();
    const next=partitionClone(this.#state);next.permissions=next.permissions.filter(x=>x.partitionId!==p.partitionId);next.permissions.push(p);return this.#save(now,next,p);
  }
  claim(raw:unknown):PartitionLease {
    const v=this.#command(raw,['versions','partitionId','workerId','permissionGeneration','expectedFence','ttlMs']);const versions=validatePipelineVersions(v.versions);assertPipelineVersions(versions,this.#versions);
    const partitionId=partitionIdOf(v.partitionId),workerId=partitionIdOf(v.workerId),permissionGeneration=partitionInteger(v.permissionGeneration,1),expectedFence=partitionInteger(v.expectedFence),ttl=partitionInteger(v.ttlMs,1,300000),now=this.#now();
    this.#partition(partitionId);this.#permission(partitionId,permissionGeneration,now);const old=this.#state.leases.find(x=>x.partitionId===partitionId);
    if((old?.fence??0)!==expectedFence||old&&!old.released&&partitionTime(old.expiresAt)>partitionTime(now))partitionReject('VERSION_CONFLICT');
    const lease:PartitionLease={versions,partitionId,workerId,fence:expectedFence+1,permissionGeneration,expiresAt:partitionStamp(new Date(partitionTime(now)+ttl).toISOString()),released:false};partitionInteger(lease.fence,1);
    const next=partitionClone(this.#state);next.leases=next.leases.filter(x=>x.partitionId!==partitionId);next.leases.push(lease);return this.#save(now,next,lease);
  }
  renew(raw:unknown):PartitionLease {
    const v=this.#command(raw,['access','ttlMs']),ttl=partitionInteger(v.ttlMs,1,300000),ctx=this.#guard(v.access),expiresAt=partitionStamp(new Date(partitionTime(ctx.now)+ttl).toISOString());
    if(partitionTime(expiresAt)<partitionTime(ctx.lease.expiresAt))partitionReject();const next=partitionClone(this.#state),lease=next.leases.find(x=>x.partitionId===ctx.access.partitionId)!;lease.expiresAt=expiresAt;return this.#save(ctx.now,next,lease);
  }
  release(raw:unknown):PartitionLease {
    const v=this.#command(raw,['access']),ctx=this.#guard(v.access),next=partitionClone(this.#state),lease=next.leases.find(x=>x.partitionId===ctx.access.partitionId)!;lease.released=true;return this.#save(ctx.now,next,lease);
  }
  beginScan(raw:unknown):PartitionScan {
    const v=this.#command(raw,['access','scanId','expectedVersion','startCursorRef','range']),scanId=partitionId(v.scanId),expectedVersion=partitionInteger(v.expectedVersion),startCursorRef=partitionNullableId(v.startCursorRef),range=validatePartitionRange(v.range),ctx=this.#guard(v.access);
    if(partitionTime(range.to)>partitionTime(ctx.now))partitionReject();const candidate:PartitionScan={scanId,partitionId:ctx.access.partitionId,expectedVersion,startCursorRef,range,permissionGeneration:ctx.permission.generation,checkpointEffectKey:null},old=this.#state.scans.find(s=>s.scanId===scanId);
    if(old){const {checkpointEffectKey:_oldKey,...oldBase}=old,{checkpointEffectKey:_newKey,...newBase}=candidate;if(!equal(oldBase,newBase))partitionReject('EFFECT_CONFLICT');return this.#save(ctx.now,partitionClone(this.#state),old);}
    const cp=this.#checkpoint(ctx.access.partitionId);if(cp.version!==expectedVersion||cp.cursorRef!==startCursorRef)partitionReject('VERSION_CONFLICT');
    const next=partitionClone(this.#state);next.scans.push(candidate);return this.#save(ctx.now,next,candidate);
  }
  appendPage(raw:unknown):PageManifest {
    const v=this.#command(raw,['access','page']),page=validatePartitionPage(v.page),ctx=this.#guard(v.access),scan=this.#scan(page.scanId,ctx);
    if(scan.checkpointEffectKey!==null)partitionReject('EFFECT_CONFLICT');
    if(page.previousCursorRef!==null&&!this.#state.cursors.some(c=>c.partitionId===ctx.access.partitionId&&c.cursorRef===page.previousCursorRef))partitionReject();
    for(const item of page.items)if(partitionTime(item.discoveredAt)>partitionTime(ctx.now))partitionReject();
    const next=partitionClone(this.#state),{nextCursorOpaque,checkpointCursorOpaque,...data}=page;
    const base={...data,partitionId:ctx.access.partitionId,nextCursorRef:this.#cursor(next,ctx.access.partitionId,nextCursorOpaque),checkpointCursorRef:this.#cursor(next,ctx.access.partitionId,checkpointCursorOpaque)},manifest:PageManifest={...base,manifestDigest:partitionSha(base)};
    const old=this.#state.pages.find(p=>p.pageId===page.pageId);if(old){if(!equal(old,manifest))partitionReject('EFFECT_CONFLICT');return this.#save(ctx.now,next,old);}
    if(this.#state.pages.some(p=>p.scanId===page.scanId&&p.ordinal===page.ordinal))partitionReject('EFFECT_CONFLICT');
    for(const item of page.items){
      const oldItem=next.items.find(x=>x.partitionId===ctx.access.partitionId&&x.item.itemId===item.itemId);
      if(oldItem){if(!equal(oldItem.item,item))partitionReject('EFFECT_CONFLICT');}
      else {
        // A replacement itemId/revisionId cannot rename the same fixed delivery to escape an UNKNOWN intent.
        if(next.items.some(x=>x.partitionId===ctx.access.partitionId&&(x.item.revisionId===item.revisionId||x.item.nativeId===item.nativeId&&x.item.discoveredAt===item.discoveredAt)))partitionReject('EFFECT_CONFLICT');
        next.items.push({partitionId:ctx.access.partitionId,item,bodyRequired:item.requiresBody,intent:null,result:null,settledPermissionGeneration:null,sourceReceipt:null});
      }
    }
    next.pages.push(manifest);return this.#save(ctx.now,next,manifest);
  }
  bindSourceIntent(raw:unknown):SourceLookup {
    const v=this.#command(raw,['access','itemId','intent']),itemId=partitionId(v.itemId),ctx=this.#guard(v.access),item=this.#item(itemId,ctx),intent=partitionClone(v.intent) as SourceIntent;
    if(item.result?.kind==='PASS')partitionReject('EFFECT_CONFLICT');if(item.intent&&!equal(item.intent,intent))partitionReject('EFFECT_CONFLICT');
    const staged={...item,intent},lookup=this.#sourceLookup(staged,ctx),next=partitionClone(this.#state);this.#item(itemId,ctx,next).intent=intent;return this.#save(ctx.now,next,lookup);
  }
  settleItem(raw:unknown):JournalItem {
    const v=this.#command(raw,['access','itemId','result']),itemId=partitionId(v.itemId),result=validateItemResult(v.result),ctx=this.#guard(v.access),item=this.#item(itemId,ctx);
    if(terminal(item)&&!equal(item.result,result))partitionReject('EFFECT_CONFLICT');
    let sourceReceipt:JournalItem['sourceReceipt']=null;
    if(result.kind==='SOURCE_STORED'){if(item.bodyRequired)partitionReject('RIGHTS_HOLD');const found=this.#sourceLookup(item,ctx);if(found.state!=='APPLIED')partitionReject('EFFECT_UNKNOWN');sourceReceipt=found.receipt;}
    if(result.kind==='PASS'&&(item.intent!==null||item.result!==null&&item.result.kind!=='PASS'||result.selectionPolicyVersion!==ctx.partition.spec.selectionPolicyVersion))partitionReject('EFFECT_CONFLICT');
    const next=partitionClone(this.#state),updated=this.#item(itemId,ctx,next);updated.result=result;if(result.kind==='H_BODY')updated.bodyRequired=true;updated.sourceReceipt=sourceReceipt;updated.settledPermissionGeneration=ctx.permission.generation;return this.#save(ctx.now,next,updated);
  }
  enqueueResume(raw:unknown):ResumeRecord {
    const v=this.#command(raw,['access','itemId','resumeId','deadline','wakeCondition']),itemId=partitionId(v.itemId),resumeId=partitionId(v.resumeId),deadline=partitionStamp(v.deadline),wakeCondition=partitionText(v.wakeCondition,500),ctx=this.#guard(v.access),item=this.#item(itemId,ctx);
    if(!item.intent||!item.result||terminal(item))partitionReject();this.#sourceLookup(item,ctx);
    const old=this.#state.resumes.find(r=>r.partitionId===ctx.access.partitionId&&r.itemId===itemId),record:ResumeRecord={resumeId,partitionId:ctx.access.partitionId,itemId,intentDigest:item.intent.commandDigest,deadline,wakeCondition,createdAt:old?.createdAt??ctx.now};
    if(old&&!equal(old,record)||this.#state.resumes.some(r=>r.resumeId===resumeId&&r!==old))partitionReject('EFFECT_CONFLICT');if(!old&&(partitionTime(deadline)<=partitionTime(ctx.now)||partitionTime(deadline)>partitionTime(ctx.now)+72*3600000))partitionReject();
    const next=partitionClone(this.#state);if(!old)next.resumes.push(record);return this.#save(ctx.now,next,record);
  }
  readPending(raw:unknown):Array<ResumeRecord&{state:'PENDING'|'EXPIRED'}> {
    const v=this.#command(raw,['access']),ctx=this.#guard(v.access);return partitionClone(this.#state.resumes.filter(r=>r.partitionId===ctx.access.partitionId&&!terminal(this.#item(r.itemId,ctx))).map(r=>({...r,state:partitionTime(r.deadline)<=partitionTime(ctx.now)?'EXPIRED' as const:'PENDING' as const})));
  }
  prepareCheckpoint(raw:unknown):CheckpointIntent {
    const v=this.#command(raw,['access','scanId','effectKey']),scanId=partitionId(v.scanId),effectKey=partitionId(v.effectKey),ctx=this.#guard(v.access),scan=this.#scan(scanId,ctx);
    if(scan.checkpointEffectKey!==null){if(scan.checkpointEffectKey!==effectKey)partitionReject('EFFECT_CONFLICT');const old=this.#state.effects.find(e=>e.intent.effectKey===effectKey)!;return this.#save(ctx.now,partitionClone(this.#state),old.intent);}
    if(this.#state.effects.some(e=>e.intent.partitionId===ctx.access.partitionId&&e.phase==='UNKNOWN'))partitionReject('EFFECT_UNKNOWN');
    if(this.#state.effects.some(e=>e.intent.effectKey===effectKey))partitionReject('EFFECT_CONFLICT');const cp=this.#checkpoint(ctx.access.partitionId);if(cp.version!==scan.expectedVersion||cp.cursorRef!==scan.startCursorRef)partitionReject('VERSION_CONFLICT');
    const complete=this.#completion(scan,ctx);if(!complete.ready)partitionReject('RETRYABLE_READ_FAILURE');
    const base={schema:PARTITION_JOURNAL_SCHEMA,sampleKind:'SYNTHETIC' as const,operation:CHECKPOINT_OPERATION,backendGeneration:this.backendGeneration,partitionId:ctx.access.partitionId,effectKey,versions:this.#versions,scanId,expectedVersion:scan.expectedVersion,startCursorRef:scan.startCursorRef,cursorRef:complete.cursorRef,manifestDigest:complete.manifestDigest,permissionGeneration:ctx.permission.generation},intent:CheckpointIntent={...base,envelopeDigest:partitionSha(base)};
    const next=partitionClone(this.#state);this.#scan(scanId,ctx,next).checkpointEffectKey=effectKey;next.effects.push({intent,phase:'PREPARED',receipt:null});return this.#save(ctx.now,next,intent);
  }
  #effect(raw:unknown):{intent:CheckpointIntent;effect:Effect} {
    const intent=validateCheckpointIntent(raw);assertPipelineVersions(intent.versions,this.#versions);if(intent.backendGeneration!==this.backendGeneration)partitionReject('POLICY_STALE');
    const effect=this.#state.effects.find(e=>e.intent.effectKey===intent.effectKey);if(!effect||!equal(effect.intent,intent))partitionReject('EFFECT_CONFLICT');return {intent,effect};
  }
  commitCheckpoint(raw:unknown,fault:CheckpointFault='NORMAL'):CheckpointReceipt {
    if(!['NORMAL','BEFORE_WRITE_LOST','AFTER_INTENT_LOST','AFTER_RECEIPT_LOST'].includes(fault))partitionReject();
    const v=this.#command(raw,['access','intent']),{intent,effect}=this.#effect(v.intent),ctx=this.#guard(v.access);
    if(intent.partitionId!==ctx.access.partitionId||intent.permissionGeneration!==ctx.permission.generation)partitionReject('RIGHTS_HOLD');
    if(effect.phase==='APPLIED')return this.#save(ctx.now,partitionClone(this.#state),{...effect.receipt!,status:'REUSED' as const});
    if(effect.phase==='UNKNOWN'||this.#state.effects.some(e=>e.intent.partitionId===ctx.access.partitionId&&e.phase==='UNKNOWN'))partitionReject('EFFECT_UNKNOWN');const scan=this.#scan(intent.scanId,ctx),complete=this.#completion(scan,ctx),cp=this.#checkpoint(ctx.access.partitionId);
    if(cp.version!==intent.expectedVersion||cp.cursorRef!==intent.startCursorRef)partitionReject('VERSION_CONFLICT');if(!complete.ready||complete.manifestDigest!==intent.manifestDigest||complete.cursorRef!==intent.cursorRef)partitionReject('RETRYABLE_READ_FAILURE');
    if(fault==='BEFORE_WRITE_LOST')throw new PartitionAckLost();
    const next=partitionClone(this.#state),entry=next.effects.find(e=>e.intent.effectKey===intent.effectKey)!;
    if(fault==='AFTER_INTENT_LOST'){entry.phase='UNKNOWN';this.#save(ctx.now,next,null);throw new PartitionAckLost();}
    const value:PartitionCheckpoint={partitionId:intent.partitionId,version:partitionInteger(cp.version+1,1),cursorRef:intent.cursorRef,scanId:intent.scanId,manifestDigest:intent.manifestDigest};
    const receipt:CheckpointReceipt={schema:PARTITION_JOURNAL_SCHEMA,sampleKind:'SYNTHETIC',persistence:'MEMORY_FIXTURE_ONLY',operation:CHECKPOINT_OPERATION,backendGeneration:this.backendGeneration,partitionId:intent.partitionId,effectKey:intent.effectKey,envelopeDigest:intent.envelopeDigest,status:'APPLIED',value};
    entry.phase='APPLIED';entry.receipt=receipt;next.checkpoints=next.checkpoints.filter(c=>c.partitionId!==intent.partitionId);next.checkpoints.push(value);const detached=this.#save(ctx.now,next,receipt);if(fault==='AFTER_RECEIPT_LOST')throw new PartitionAckLost();return detached;
  }
  lookupCheckpoint(rawIntent:unknown):CheckpointLookup {
    const {intent,effect}=this.#effect(rawIntent);return partitionClone({schema:PARTITION_JOURNAL_SCHEMA,operation:CHECKPOINT_OPERATION,backendGeneration:this.backendGeneration,partitionId:intent.partitionId,effectKey:intent.effectKey,envelopeDigest:intent.envelopeDigest,diagnosticOnly:true,executionEnabled:false,state:effect.phase==='PREPARED'?'NOT_APPLIED':effect.phase,receipt:effect.receipt});
  }
  recoverCheckpoint(rawIntent:unknown,lookupAvailable=true):CheckpointRecovery {
    if(typeof lookupAvailable!=='boolean')partitionReject();const {intent}=this.#effect(rawIntent);
    if(!lookupAvailable)return {schema:PARTITION_JOURNAL_SCHEMA,operation:CHECKPOINT_OPERATION,backendGeneration:this.backendGeneration,partitionId:intent.partitionId,effectKey:intent.effectKey,envelopeDigest:intent.envelopeDigest,diagnosticOnly:true,executionEnabled:false,state:'UNKNOWN',receipt:null,recovery:'HOLD_EFFECT_UNKNOWN'};
    const found=this.lookupCheckpoint(intent);
    if(found.state==='APPLIED')return {...found,recovery:'RECOVERED',receipt:{...found.receipt!,status:'REUSED'}};
    if(found.state==='NOT_APPLIED')return {...found,recovery:'RETRY_SAME_INTENT',intent:partitionClone(intent)};return {...found,recovery:'HOLD_EFFECT_UNKNOWN'};
  }
  inspect(){
    return partitionClone({schema:PARTITION_JOURNAL_SCHEMA,sampleKind:'SYNTHETIC' as const,persistence:'MEMORY_FIXTURE_ONLY' as const,executionEnabled:false as const,backendLifetimeOnly:true as const,backendGeneration:this.backendGeneration,watermark:this.#state.watermark,stateDigest:partitionSha(this.#state),limits:this.#limits,
      partitions:this.#state.partitions.length,items:this.#state.items.length,resumes:this.#state.resumes.length,pages:this.#state.pages.length,scans:this.#state.scans.length,effects:this.#state.effects.length,cursors:this.#state.cursors.length,unknownCheckpoints:this.#state.effects.filter(e=>e.phase==='UNKNOWN').length,checkpoints:this.#state.checkpoints,leases:this.#state.leases,networkCalls:0,databaseWrites:0});
  }
}
// Local alias avoids shadowing the validator with the DTO's partitionId variable.
const partitionIdOf=partitionId;
