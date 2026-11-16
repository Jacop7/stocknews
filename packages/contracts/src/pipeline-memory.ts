/** Bounded SYNTHETIC repositories. No IO, auth, real IDs, database or publication. */
import {PipelineError,pipelineData,pipelineInstant,pipelineId,pipelineCanonical,validatePipelineVersions,assertPipelineVersions,validateSourceRevision,validatePipelineDecision,validatePipelineDraft,validateSnapshotDraft,validatePipelineWrite,type PipelineVersions,type PipelineSourceRevision,type PipelineDecision,type PipelineDraft,type PipelineSnapshotDraft,type PipelineReceipt,type PipelineWrite} from './pipeline.ts';
// revision is an arrival sequence, never the source's chronological latest revision.
interface RevisionResult {revisionId:string;sourceDocumentId:string;revision:number;}
interface DecisionResult {decisionId:string;decisionVersion:number;}
interface DraftResult {issueId:string;articleVersion:number;}
interface SnapshotResult {snapshotKey:string;streamId:string;revision:number;cutoff:string;}
interface Checkpoint {sourceId:string;version:number;cursor:string|null;}
type Result=RevisionResult|DecisionResult|DraftResult|SnapshotResult|Checkpoint;
function copy<T>(v:T):T{return pipelineData(v) as T;}
const id=pipelineId;
export class SyntheticPipelineRepositories {
  private readonly versions:PipelineVersions;
  private readonly effects=new Map<string,{canonical:string;result:Result}>();
  private readonly revisions=new Map<string,{canonical:string;result:RevisionResult;value:PipelineSourceRevision}>();
  private readonly documents=new Map<string,number>();
  private readonly decisions=new Map<string,{canonical:string;value:PipelineDecision;version:number}>();
  private readonly drafts=new Map<string,{value:PipelineDraft;version:number}>();
  private readonly snapshots=new Map<string,{canonical:string;value:PipelineSnapshotDraft;result:SnapshotResult}>();
  private readonly streams=new Map<string,SnapshotResult>();
  private readonly checkpoints=new Map<string,Checkpoint>();
  private readonly capacity:number;
  constructor(versions:unknown,capacity=1000){this.versions=validatePipelineVersions(versions);if(!Number.isInteger(capacity)||capacity<1||capacity>1000)throw new PipelineError('INVALID_INPUT');this.capacity=capacity;}
  private transact<T extends Result>(op:string,command:PipelineWrite<unknown>,effect:()=>T):PipelineReceipt<T>{
    assertPipelineVersions(command.versions,this.versions);
    const canonical=pipelineCanonical({op,command}),old=this.effects.get(command.effectKey);
    if(old){if(old.canonical!==canonical)throw new PipelineError('EFFECT_CONFLICT');return {sampleKind:'SYNTHETIC',persistence:'MEMORY_FIXTURE_ONLY',effectKey:command.effectKey,status:'REUSED',value:copy(old.result) as T};}
    if(this.effects.size>=this.capacity)throw new PipelineError('RATE_LIMITED');
    const value=effect();this.effects.set(command.effectKey,{canonical,result:copy(value)});return {sampleKind:'SYNTHETIC',persistence:'MEMORY_FIXTURE_ONLY',effectKey:command.effectKey,status:'APPLIED',value:copy(value)};
  }
  appendSourceRevision(raw:unknown):PipelineReceipt<RevisionResult>{
    const c=validatePipelineWrite(raw,validateSourceRevision);assertPipelineVersions(c.value,c.versions);
    return this.transact('appendSourceRevision',c,()=>{
      const value=c.value,canonical=pipelineCanonical(value),old=this.revisions.get(value.revisionId);
      if(old){if(old.canonical!==canonical)throw new PipelineError('EFFECT_CONFLICT');return copy(old.result);}
      if([...this.revisions.values()].some(r=>r.value.sourceDocumentId===value.sourceDocumentId&&(r.value.sourceId!==value.sourceId||r.value.nativeId!==value.nativeId)||r.value.sourceId===value.sourceId&&r.value.nativeId===value.nativeId&&r.value.sourceDocumentId!==value.sourceDocumentId))throw new PipelineError('INVALID_INPUT');
      const identity=(v:PipelineSourceRevision)=>pipelineCanonical(Object.fromEntries(Object.entries(v).filter(([k])=>!['revisionId','collectedAt'].includes(k))));
      const duplicate=[...this.revisions.values()].find(r=>identity(r.value)===identity(value));
      if(duplicate)return copy(duplicate.result);
      const revision=(this.documents.get(value.sourceDocumentId)??0)+1,result={revisionId:value.revisionId,sourceDocumentId:value.sourceDocumentId,revision};
      this.revisions.set(value.revisionId,{canonical,result,value:copy(value)});this.documents.set(value.sourceDocumentId,revision);return result;
    });
  }
  readCheckpoint(sourceId:string):Checkpoint {if(!id(sourceId))throw new PipelineError('INVALID_INPUT');return copy(this.checkpoints.get(sourceId)??{sourceId,version:0,cursor:null});}
  readSourceRevision(revisionId:string):PipelineSourceRevision|null {if(!id(revisionId))throw new PipelineError('INVALID_INPUT');return copy(this.revisions.get(revisionId)?.value??null);}
  compareAndSwapCheckpoint(raw:unknown):PipelineReceipt<Checkpoint>{
    const c=validatePipelineWrite(raw,(v)=>{
      const x=pipelineData(v) as {sourceId:string;expectedVersion:number;cursor:string|null;revisionIds:string[];hasGap:boolean;};
      if(!x||Object.keys(x).sort().join(',')!=='cursor,expectedVersion,hasGap,revisionIds,sourceId'||!id(x.sourceId)||!Number.isSafeInteger(x.expectedVersion)||x.expectedVersion<0||x.cursor!==null&&!id(x.cursor)||typeof x.hasGap!=='boolean'||!Array.isArray(x.revisionIds)||x.revisionIds.length>300||!x.revisionIds.every(id)||new Set(x.revisionIds).size!==x.revisionIds.length)throw new PipelineError('INVALID_INPUT');return x;
    });
    return this.transact('compareAndSwapCheckpoint',c,()=>{const x=c.value;if(x.hasGap)throw new PipelineError('RETRYABLE_READ_FAILURE');const old=this.readCheckpoint(x.sourceId);if(old.version!==x.expectedVersion)throw new PipelineError('VERSION_CONFLICT');if(!x.revisionIds.every(k=>this.revisions.get(k)?.value.sourceId===x.sourceId))throw new PipelineError('INVALID_INPUT');const next={sourceId:x.sourceId,version:old.version+1,cursor:x.cursor};this.checkpoints.set(x.sourceId,next);return next;});
  }
  proposeDecision(raw:unknown):PipelineReceipt<DecisionResult>{
    const c=validatePipelineWrite(raw,validatePipelineDecision);assertPipelineVersions(c.value,c.versions);
    return this.transact('proposeDecision',c,()=>{const x=c.value;if(!x.inputRevisionIds.every(id=>this.revisions.has(id)))throw new PipelineError('INVALID_INPUT');if(!x.evidence.every(e=>{const r=this.revisions.get(e.revisionId)!.value;return e.originId===r.originId&&e.groupId===r.independenceGroupId;}))throw new PipelineError('INVALID_INPUT');const canonical=pipelineCanonical(x),old=this.decisions.get(x.decisionId);if(old){if(old.canonical!==canonical)throw new PipelineError('EFFECT_CONFLICT');return {decisionId:x.decisionId,decisionVersion:old.version};}this.decisions.set(x.decisionId,{canonical,value:copy(x),version:1});return {decisionId:x.decisionId,decisionVersion:1};});
  }
  saveDraftExpectedVersion(raw:unknown):PipelineReceipt<DraftResult>{
    const c=validatePipelineWrite(raw,validatePipelineDraft);assertPipelineVersions(c.value,c.versions);
    return this.transact('saveDraftExpectedVersion',c,()=>{const x=c.value,decision=this.decisions.get(x.decisionId)?.value;if(!decision||decision.decision!=='COLLECT')throw new PipelineError('RIGHTS_HOLD');if(decision.evidenceVersion!==x.evidenceVersion)throw new PipelineError('INVALID_INPUT');const old=this.drafts.get(x.issueId);if((old?.version??0)!==x.expectedArticleVersion)throw new PipelineError('VERSION_CONFLICT');if(old&&(old.value.storyId!==x.storyId||old.value.firstPublishedAt!==x.firstPublishedAt))throw new PipelineError('INVALID_INPUT');const version=(old?.version??0)+1;this.drafts.set(x.issueId,{value:copy(x),version});return {issueId:x.issueId,articleVersion:version};});
  }
  readDraft(issueId:string):{value:PipelineDraft;version:number}|null {if(!id(issueId))throw new PipelineError('INVALID_INPUT');const v=this.drafts.get(issueId);return v?copy(v):null;}
  saveSnapshotDraft(raw:unknown):PipelineReceipt<SnapshotResult>{
    const c=validatePipelineWrite(raw,validateSnapshotDraft);assertPipelineVersions(c.value,c.versions);
    return this.transact('saveSnapshotDraft',c,()=>{const x=c.value,canonical=pipelineCanonical(x),old=this.snapshots.get(x.snapshotKey);if(old){if(old.canonical!==canonical)throw new PipelineError('EFFECT_CONFLICT');return copy(old.result);}const result={snapshotKey:x.snapshotKey,streamId:x.streamId,revision:x.expectedRevision+1,cutoff:x.cutoff};this.snapshots.set(x.snapshotKey,{canonical,value:copy(x),result});return result;});
  }
  compareAndSwapLatest(raw:unknown):PipelineReceipt<SnapshotResult>{
    const c=validatePipelineWrite(raw,(v)=>{const x=pipelineData(v) as {snapshotKey:string;expectedRevision:number;completionDigest:string;};if(!x||Object.keys(x).sort().join(',')!=='completionDigest,expectedRevision,snapshotKey'||!id(x.snapshotKey)||!Number.isSafeInteger(x.expectedRevision)||x.expectedRevision<0||typeof x.completionDigest!=='string'||!/^[a-f0-9]{64}$/.test(x.completionDigest))throw new PipelineError('INVALID_INPUT');return x;});
    return this.transact('compareAndSwapLatest',c,()=>{const x=c.value,saved=this.snapshots.get(x.snapshotKey);if(!saved||saved.value.payloadDigest!==x.completionDigest)throw new PipelineError('INVALID_INPUT');const current=this.streams.get(saved.result.streamId);if((current?.revision??0)!==x.expectedRevision||saved.value.expectedRevision!==x.expectedRevision||current&&pipelineInstant(current.cutoff)>=pipelineInstant(saved.result.cutoff))throw new PipelineError('VERSION_CONFLICT');this.streams.set(saved.result.streamId,copy(saved.result));return saved.result;});
  }
  readLatest(streamId:string):SnapshotResult|null {if(!id(streamId))throw new PipelineError('INVALID_INPUT');return copy(this.streams.get(streamId)??null);}
  resolveEffect(effectKey:string):Result|null {if(!id(effectKey))throw new PipelineError('INVALID_INPUT');return copy(this.effects.get(effectKey)?.result??null);}
  diagnostics(){return Object.freeze({sampleKind:'SYNTHETIC',persistence:'MEMORY_FIXTURE_ONLY',effects:this.effects.size,revisions:this.revisions.size,decisions:this.decisions.size,drafts:this.drafts.size,snapshots:this.snapshots.size,capacity:this.capacity,networkCalls:0,databaseWrites:0,publicationEnabled:false});}
}
