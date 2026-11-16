/** Strict bounded fixture ports; this facade cannot publish or activate a real service. */
import {SyntheticPipelineRepositories} from './pipeline-memory.ts';
import {PipelineError,pipelineData,pipelineCanonical,pipelineInstant,validatePipelineVersions,validatePipelineWrite,validateSourceRevision,validatePipelineDecision,validatePipelineDraft,type PipelineVersions,type PipelineSourceRevision,type PipelineDecision,type PipelineReceipt} from './pipeline.ts';
import {selectPipelineSources,projectPipelineVisibility,k1Record,k1Exact,type K1Visibility,type K1VisibilityInput} from './pipeline-semantics.ts';
const clone=<T>(x:T):T=>pipelineData(x) as T;
export class SyntheticK1Repository {
  #base:SyntheticPipelineRepositories;
  #versions:PipelineVersions;
  #capacity:number;
  #sources=new Map<string,PipelineSourceRevision>();
  #decisions=new Map<string,PipelineDecision>();
  #projections=new Map<string,K1Visibility>();
  #effects=new Map<string,{canonical:string;receipt:unknown}>();
  constructor(versions:unknown,capacity=1000){this.#versions=validatePipelineVersions(versions);this.#base=new SyntheticPipelineRepositories(this.#versions,capacity);this.#capacity=capacity;}
  #execute<T>(effectKey:string,op:string,input:unknown,apply:()=>T):T {
    const canonical=pipelineCanonical({op,input}),old=this.#effects.get(effectKey);
    if(old){if(old.canonical!==canonical)throw new PipelineError('EFFECT_CONFLICT');const r=clone(old.receipt) as T&{status:string};r.status='REUSED';return r;}
    if(this.#effects.size>=this.#capacity)throw new PipelineError('RATE_LIMITED');
    const receipt=apply();this.#effects.set(effectKey,{canonical,receipt:clone(receipt)});return clone(receipt);
  }
  appendSourceRevision(raw:unknown){
    const c=validatePipelineWrite(raw,validateSourceRevision);
    return this.#execute(c.effectKey,'exactSource',c,()=>{
      const existing=this.#sources.get(c.value.revisionId);
      if(existing&&pipelineCanonical(existing)!==pipelineCanonical(c.value))throw new PipelineError('EFFECT_CONFLICT');
      const staged=[...this.#sources.values(),...(existing?[]:[c.value])];
      if(staged.length>300)throw new PipelineError('RATE_LIMITED');
      // Every accepted aggregate must remain selectable. Reject before either repository or effect changes.
      try{pipelineData(staged);}catch(e){if(e instanceof PipelineError&&e.code==='INVALID_INPUT')throw new PipelineError('RATE_LIMITED');throw e;}
      selectPipelineSources(staged,this.#versions,c.value.collectedAt);
      const receipt=this.#base.appendSourceRevisionExact(c),stored=this.#base.readSourceRevision(receipt.value.revisionId);if(!stored||stored.revisionId!==c.value.revisionId)throw new PipelineError('INVALID_INPUT');this.#sources.set(stored.revisionId,stored);return receipt;
    });
  }
  selectSources(asOf:string){return selectPipelineSources([...this.#sources.values()],this.#versions,asOf);}
  #current(d:PipelineDecision,asOf:string):void {
    const byId=new Map(this.selectSources(asOf).map(x=>[x.sourceDocumentId,x]));
    for(const id of d.inputRevisionIds){const source=this.#sources.get(id),selected=source?byId.get(source.sourceDocumentId):null;if(!source||!selected||selected.status!=='SELECTED'||selected.revision?.revisionId!==id)throw new PipelineError('RIGHTS_HOLD');}
  }
  proposeDecision(raw:unknown){
    const c=validatePipelineWrite(raw,validatePipelineDecision);
    return this.#execute(c.effectKey,'strictDecision',c,()=>{if(c.value.decision==='COLLECT')this.#current(c.value,c.value.knownAt);const receipt=this.#base.proposeDecision(c);this.#decisions.set(c.value.decisionId,clone(c.value));return receipt;});
  }
  saveDraftExpectedVersion(raw:unknown){
    const envelope=k1Record(raw);k1Exact(envelope,['command','visibility']);
    const c=validatePipelineWrite(envelope.command,validatePipelineDraft),visibility=envelope.visibility;
    return this.#execute(c.effectKey,'strictDraft',envelope,()=>{
      const d=this.#decisions.get(c.value.decisionId);if(!d||d.decision!=='COLLECT')throw new PipelineError('RIGHTS_HOLD');
      const p=projectPipelineVisibility(visibility,d);this.#current(d,p.asOf);
      if(c.value.evidenceVersion!==p.evidenceVersion||pipelineCanonical(c.value.visibleSections)!==pipelineCanonical(p.visibleSections))throw new PipelineError('INVALID_INPUT');
      for(const t of [c.value.firstPublishedAt,c.value.materialChangeAt])if(t!==null&&pipelineInstant(t)>pipelineInstant(p.asOf))throw new PipelineError('INVALID_INPUT');
      const receipt=this.#base.saveDraftExpectedVersion(c);this.#projections.set(c.value.issueId,p);return receipt;
    });
  }
  readSourceRevision(revisionId:string){return this.#base.readSourceRevision(revisionId);}
  readDraft(issueId:string){return this.#base.readDraft(issueId);}
  readProjection(issueId:string):K1Visibility|null {this.#base.readDraft(issueId);return clone(this.#projections.get(issueId)??null);}
  readCheckpoint(sourceId:string){return this.#base.readCheckpoint(sourceId);}
  compareAndSwapCheckpoint(raw:unknown){return this.#base.compareAndSwapCheckpoint(raw);}
  resolveEffect(effectKey:string){return this.#base.resolveEffect(effectKey);}
  diagnostics(){return {...this.#base.diagnostics(),strictFixtureOnly:true,projections:this.#projections.size};}
}
export type K1DraftEnvelope={command:unknown;visibility:K1VisibilityInput};
