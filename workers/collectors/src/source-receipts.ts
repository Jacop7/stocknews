/** NODE-ONLY SYNTHETIC_SOURCE_RECEIPT_R1. Same-backend lifetime fixture, not durable storage. */
import {PipelineError,pipelineData,pipelineCanonical,pipelineId,validatePipelineVersions,validatePipelineWrite,validateSourceRevision,assertPipelineVersions,type PipelineVersions,type PipelineSourceRevision,type PipelineWrite,type PipelineReceipt} from '../../../packages/contracts/src/pipeline.ts';
import {k1Record,k1Exact} from '../../../packages/contracts/src/pipeline-semantics.ts';
import {SyntheticK1Repository} from '../../../packages/contracts/src/pipeline-k1-memory.ts';
interface Hash {update(value:string):Hash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(name:'sha256'):Hash;randomUUID():string;}};
const crypto=process.getBuiltinModule('node:crypto');
export const SOURCE_RECEIPT_SCHEMA='SYNTHETIC_SOURCE_RECEIPT_R1' as const;
const OP='APPEND_SOURCE_EXACT' as const,copy=<T>(v:T):T=>pipelineData(v) as T;
const sha=(v:unknown)=>crypto.createHash('sha256').update(pipelineCanonical(v)).digest('hex');
type Command=PipelineWrite<PipelineSourceRevision>;
type SourceValue={revisionId:string;sourceDocumentId:string;revision:number;};
type Receipt=PipelineReceipt<SourceValue>;
export interface SourceIntent {schema:typeof SOURCE_RECEIPT_SCHEMA;sampleKind:'SYNTHETIC';operation:typeof OP;storeGeneration:string;commandDigest:string;command:Command;}
type Binding={schema:typeof SOURCE_RECEIPT_SCHEMA;sampleKind:'SYNTHETIC';operation:typeof OP;storeGeneration:string;effectKey:string;commandDigest:string;};
export type SourceLookup=(Binding&{state:'APPLIED';receipt:Receipt})|(Binding&{state:'NOT_APPLIED'|'UNKNOWN'});
export type SourceRecovery=(Binding&{state:'RECOVERED';receipt:Receipt})|(Binding&{state:'RETRY_SAME_INTENT';intent:SourceIntent})|(Binding&{state:'HOLD_EFFECT_UNKNOWN'});
type Fault='NORMAL'|'BEFORE_WRITE_LOST'|'AFTER_INTENT_LOST'|'AFTER_RECEIPT_LOST';
type Entry={canonical:string;phase:'UNKNOWN'}|{canonical:string;phase:'APPLIED';receipt:Receipt};
export class SourceAckLost extends Error {constructor(){super('SYNTHETIC_SOURCE_ACK_LOST');this.name='SourceAckLost';}}
export class SyntheticSourceReceiptSink {
  #versions:PipelineVersions;#generation:string;#capacity:number;#repository:SyntheticK1Repository;#entries=new Map<string,Entry>();
  constructor(versions:unknown,capacity=1000){
    this.#versions=validatePipelineVersions(versions);if(!Number.isSafeInteger(capacity)||capacity<1||capacity>1000)throw new PipelineError('INVALID_INPUT');
    this.#capacity=capacity;this.#generation='fixture-'+crypto.randomUUID();this.#repository=new SyntheticK1Repository(this.#versions,capacity);
  }
  get storeGeneration():string{return this.#generation;}
  makeIntent(rawWrite:unknown):SourceIntent {
    const command=validatePipelineWrite(rawWrite,validateSourceRevision);assertPipelineVersions(command.versions,this.#versions);assertPipelineVersions(command.value,this.#versions);
    if(command.payloadHash!==sha(command.value))throw new PipelineError('INVALID_INPUT');
    const base={schema:SOURCE_RECEIPT_SCHEMA,sampleKind:'SYNTHETIC' as const,operation:OP,storeGeneration:this.#generation,command};return {...base,commandDigest:sha(base)};
  }
  #intent(raw:unknown):SourceIntent {
    const x=k1Record(raw);k1Exact(x,['schema','sampleKind','operation','storeGeneration','commandDigest','command']);
    if(x.storeGeneration!==this.#generation)throw new PipelineError('POLICY_STALE');
    const expected=this.makeIntent(x.command);if(pipelineCanonical(x)!==pipelineCanonical(expected))throw new PipelineError('INVALID_INPUT');return expected;
  }
  #binding(i:SourceIntent):Binding{return {schema:SOURCE_RECEIPT_SCHEMA,sampleKind:'SYNTHETIC',operation:OP,storeGeneration:this.#generation,effectKey:i.command.effectKey,commandDigest:i.commandDigest};}
  #entry(i:SourceIntent):Entry|undefined {const entry=this.#entries.get(i.command.effectKey);if(entry&&entry.canonical!==pipelineCanonical(i))throw new PipelineError('EFFECT_CONFLICT');return entry;}
  #receipt(raw:unknown,i:SourceIntent):Receipt {
    const r=k1Record(raw);k1Exact(r,['sampleKind','persistence','effectKey','status','value']);const v=k1Record(r.value);k1Exact(v,['revisionId','sourceDocumentId','revision']);
    if(r.sampleKind!=='SYNTHETIC'||r.persistence!=='MEMORY_FIXTURE_ONLY'||r.effectKey!==i.command.effectKey||!['APPLIED','REUSED'].includes(r.status as string)||v.revisionId!==i.command.value.revisionId||v.sourceDocumentId!==i.command.value.sourceDocumentId||!Number.isSafeInteger(v.revision)||Number(v.revision)<1)throw new PipelineError('EFFECT_UNKNOWN');
    return r as unknown as Receipt;
  }
  write(rawIntent:unknown,fault:Fault='NORMAL'):Receipt {
    if(!['NORMAL','BEFORE_WRITE_LOST','AFTER_INTENT_LOST','AFTER_RECEIPT_LOST'].includes(fault))throw new PipelineError('INVALID_INPUT');
    const i=this.#intent(rawIntent),old=this.#entry(i);
    if(old?.phase==='APPLIED')return {...copy(old.receipt),status:'REUSED'};
    if(old)throw new PipelineError('EFFECT_UNKNOWN');
    if(this.#entries.size>=this.#capacity)throw new PipelineError('RATE_LIMITED');
    if(fault==='BEFORE_WRITE_LOST')throw new SourceAckLost();
    const canonical=pipelineCanonical(i);this.#entries.set(i.command.effectKey,{canonical,phase:'UNKNOWN'});
    if(fault==='AFTER_INTENT_LOST')throw new SourceAckLost();
    let receipt:Receipt;
    // Once strict append is entered, every failure is conservatively UNKNOWN, including pre-write limits.
    try{receipt=this.#receipt(this.#repository.appendSourceRevision(i.command),i);}catch(e){if(e instanceof PipelineError)throw e;throw new PipelineError('EFFECT_UNKNOWN');}
    this.#entries.set(i.command.effectKey,{canonical,phase:'APPLIED',receipt:copy(receipt)});
    if(fault==='AFTER_RECEIPT_LOST')throw new SourceAckLost();
    return copy(receipt);
  }
  lookup(rawIntent:unknown):SourceLookup {
    const i=this.#intent(rawIntent),entry=this.#entry(i),binding=this.#binding(i);
    return entry?.phase==='APPLIED'?{...binding,state:'APPLIED',receipt:copy(entry.receipt)}:{...binding,state:entry?'UNKNOWN':'NOT_APPLIED'};
  }
  recovery(rawIntent:unknown,lookupAvailable=true):SourceRecovery {
    if(typeof lookupAvailable!=='boolean')throw new PipelineError('INVALID_INPUT');const i=this.#intent(rawIntent),binding=this.#binding(i);
    if(!lookupAvailable)return {...binding,state:'HOLD_EFFECT_UNKNOWN'};
    const found=this.lookup(i);
    if(found.state==='APPLIED')return {...binding,state:'RECOVERED',receipt:{...found.receipt,status:'REUSED'}};
    if(found.state==='NOT_APPLIED')return {...binding,state:'RETRY_SAME_INTENT',intent:copy(i)};
    return {...binding,state:'HOLD_EFFECT_UNKNOWN'};
  }
  readSource(revisionId:string):PipelineSourceRevision|null {if(!pipelineId(revisionId))throw new PipelineError('INVALID_INPUT');return this.#repository.readSourceRevision(revisionId);}
  diagnostics(){return {...this.#repository.diagnostics(),receiptEntries:this.#entries.size,unknownReceipts:[...this.#entries.values()].filter(x=>x.phase==='UNKNOWN').length,storeGeneration:this.#generation,backendLifetimeOnly:true};}
}
