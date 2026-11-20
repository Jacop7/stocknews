/** NODE-ONLY SYNTHETIC_K1_COMPLETED_RANKING. Not exported by any application barrel. */
// Narrow declaration of the actual Node builtin API; no new package/types dependency or app export.
// https://nodejs.org/docs/latest-v24.x/api/process.html#processgetbuiltinmoduleid
interface FixtureHash {update(value:string):FixtureHash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(algorithm:'sha256'):FixtureHash}};
const {createHash}=process.getBuiltinModule('node:crypto');
import {draftHomeRanking,HOME_RANKING_POLICY,type HomeRankingInput,type HomeRankingDraft} from './home-ranking.ts';
import {PRIORITY_POLICY} from './issue-priority.ts';
import {SNAPSHOT_POLICY,deriveHomeContext,type HomeContextInput} from './home-snapshot.ts';
import {PIPELINE_CONTRACT,PipelineError,pipelineData,pipelineCanonical,pipelineInstant,pipelineId,validateSnapshotDraft,type PipelineVersions,type PipelineSnapshotDraft,type PipelineHighCarry} from '../../contracts/src/pipeline.ts';
import {SyntheticPipelineRepositories} from '../../contracts/src/pipeline-memory.ts';
const SCHEMA='SYNTHETIC_K1_COMPLETED_RANKING_V1' as const;
const ENGINE=Object.freeze({ranking:HOME_RANKING_POLICY,priority:PRIORITY_POLICY,context:SNAPSHOT_POLICY});
/** A reviewed reissue is a registry revision, not a claim to implement another economic algorithm. */
const PROFILES=Object.freeze(['SYNTHETIC_PROFILE_V1','SYNTHETIC_PROFILE_REISSUE'] as const);
const SCALES=Object.freeze(['SYNTHETIC_SCALE_V1','SYNTHETIC_SCALE_V2'] as const);
const SOURCE_POLICY='SYNTHETIC_SOURCE_V1';
const clone=<T>(v:T):T=>pipelineData(v) as T;
const sha=(v:unknown)=>createHash('sha256').update(pipelineCanonical(v)).digest('hex');
function reject(code:'INVALID_INPUT'|'VERSION_CONFLICT'|'EFFECT_CONFLICT'|'POLICY_STALE'|'RATE_LIMITED'|'RIGHTS_HOLD'='INVALID_INPUT'):never {throw new PipelineError(code);}
const object=(raw:unknown):Record<string,unknown>=>{const v=pipelineData(raw);if(!v||typeof v!=='object'||Array.isArray(v))reject();return v as Record<string,unknown>;};
const exact=(v:Record<string,unknown>,keys:string[])=>{if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))reject();};
const at=(v:unknown)=>{const n=pipelineInstant(v);if(!Number.isFinite(n))reject();return n;};
const integer=(n:unknown)=>Number.isSafeInteger(n)&&Number(n)>=0;
type Recipe=Omit<HomeRankingInput,'previous'|'highComparisonVersion'>;
export interface K1RankingCommand {sampleKind:'SYNTHETIC';snapshotId:string;expectedRevision:number;profileId:string;nonpriceScaleVersion:string;sourcePolicyVersion:string;recipe:Recipe;}
interface Descriptor {profileId:string;engine:typeof ENGINE;nonpriceScaleVersion:string;sourcePolicyVersion:string;}
interface Completed {snapshotId:string;globalRevision:number;previousSnapshotId:string|null;previousDigest:string|null;segmentKey:string;localRevision:number;command:K1RankingCommand;descriptor:Descriptor;result:HomeRankingDraft;projection:PipelineSnapshotDraft;digest:string;}
interface Exported {schema:typeof SCHEMA;sampleKind:'SYNTHETIC';streamId:string;capacity:number;latest:string|null;completed:Completed[];drafts:Completed[];}
const descriptor=(profileId:unknown,scale:unknown,source:unknown):Descriptor=>{
  if(!PROFILES.includes(profileId as typeof PROFILES[number])||!SCALES.includes(scale as typeof SCALES[number])||source!==SOURCE_POLICY)reject('POLICY_STALE');
  return {profileId:profileId as string,engine:{...ENGINE},nonpriceScaleVersion:scale as string,sourcePolicyVersion:source as string};
};
function command(raw:unknown):K1RankingCommand {
  const v=object(raw);exact(v,['sampleKind','snapshotId','expectedRevision','profileId','nonpriceScaleVersion','sourcePolicyVersion','recipe']);
  if(v.sampleKind!=='SYNTHETIC'||!pipelineId(v.snapshotId)||!integer(v.expectedRevision))reject();descriptor(v.profileId,v.nonpriceScaleVersion,v.sourcePolicyVersion);
  const r=object(v.recipe);exact(r,['mode','sampleKind','policyVersion','context','priority','sectors']);
  return v as unknown as K1RankingCommand;
}
const versionFor=(d:Descriptor,catalogVersion:string):PipelineVersions=>({contractVersion:PIPELINE_CONTRACT,sampleKind:'SYNTHETIC',policyVersion:'k1-policy-'+sha([d.profileId,d.engine]),catalogVersion,sourcePolicyVersion:d.sourcePolicyVersion});
function comparison(raw:unknown,profile:string,scale:string):string {
  // Namespace only a valid original HomeContext ID; hashing cannot repair malformed input.
  if(typeof raw!=='string'||raw.length<1||raw.length>160||raw.trim()!==raw)reject();
  return 'k1-compare-'+sha([raw,profile,scale]);
}
const signature=(d:Descriptor,result:HomeRankingDraft)=>sha([d,result.context!.catalogVersion,result.context!.evaluationSetVersion,result.context!.signals.T,result.context!.signals.P,result.state!.records.filter(r=>r.tier==='HIGH').map(r=>[r.issueId,r.storyId,r.role,r.materialChangeAt])]);

/** Bounded in-memory staging/replay only. No scheduler, live inputs, public DTO, persistence or authentication. */
export class SyntheticCompletedRanking {
  #streamId:string;#capacity:number;#completed:Completed[]=[];#drafts:Completed[]=[];
  constructor(streamId='fixture-home',capacity=32){if(!pipelineId(streamId)||!Number.isInteger(capacity)||capacity<1||capacity>32)reject();this.#streamId=streamId;this.#capacity=capacity;}
  #build(c:K1RankingCommand,history:Completed[]):Completed {
    if(c.expectedRevision!==history.length)reject('VERSION_CONFLICT');
    const previous=history.at(-1)??null,d=descriptor(c.profileId,c.nonpriceScaleVersion,c.sourcePolicyVersion),r=clone(c.recipe);
    if(!r.context||!r.priority||r.policyVersion!==ENGINE.ranking||r.priority.policyVersion!==ENGINE.priority||r.context.policyVersion!==ENGINE.context)reject('POLICY_STALE');
    const result=draftHomeRanking({...r,context:{...r.context,comparisonSetVersion:comparison(r.context.comparisonSetVersion,d.profileId,d.nonpriceScaleVersion)},previous:previous?.result.state??null,highComparisonVersion:'k1-high-'+sha([d.profileId,d.nonpriceScaleVersion])});
    if(result.status!=='DRAFT_SYNTHETIC'||!result.context||!result.state)reject('RIGHTS_HOLD');
    if(previous&&at(result.context.cutoff)<=at(previous.result.context!.cutoff))reject('VERSION_CONFLICT');
    const versions=versionFor(d,result.context.catalogVersion),segmentKey='segment-'+sha([versions,result.context.evaluationSetVersion,d.nonpriceScaleVersion]),localRevision=history.filter(x=>x.segmentKey===segmentKey).length+1;
    const highSignature=signature(d,result);let highCarry:PipelineHighCarry|null=null;
    if(previous&&previous.segmentKey===segmentKey&&previous.projection.highSignature===highSignature){
      const rows:PipelineHighCarry['rows']=[];
      for(const pool of ['A','B','C'] as const)for(const row of previous.result.lanes[pool])if(row.tier==='HIGH')rows.push({issueId:row.issueId,storyId:row.storyId,pool,tier:'HIGH',materialChangeAt:row.materialChangeAt,score:row.score,M:null});
      if(rows.length)highCarry={completedSnapshotId:previous.snapshotId,completionDigest:previous.digest,cutoff:previous.result.context!.cutoff,policyVersion:versions.policyVersion,catalogVersion:versions.catalogVersion,evaluationSetVersion:result.context.evaluationSetVersion,nonpriceScaleVersion:d.nonpriceScaleVersion,highSignature,order:rows.map(x=>x.issueId),rows};
    }
    const payloadDigest=sha({streamId:this.#streamId,command:c,descriptor:d,result,previousDigest:previous?.digest??null,globalRevision:history.length+1,localRevision});
    const projection=validateSnapshotDraft({...versions,snapshotKey:c.snapshotId,streamId:'k1-stream-'+sha([this.#streamId,segmentKey]),expectedRevision:localRevision-1,cutoff:result.context.cutoff,marketBasis:result.context.marketBasis,targetKrTradingDay:result.context.targetKrTradingDay,calendarVersion:result.context.calendarVersion,comparisonSetVersion:result.context.comparisonSetVersion,evaluationSetVersion:result.context.evaluationSetVersion,nonpriceScaleVersion:d.nonpriceScaleVersion,highSignature,issueIds:result.state.records.map(x=>x.issueId),highCarry,payloadDigest});
    const value={snapshotId:c.snapshotId,globalRevision:history.length+1,previousSnapshotId:previous?.snapshotId??null,previousDigest:previous?.digest??null,segmentKey,localRevision,command:clone(c),descriptor:d,result,projection};
    return {...value,digest:sha(value)};
  }
  #validateHistory(history:unknown):Completed[]{
    if(!Array.isArray(history)||history.length>this.#capacity)reject();
    const restored:Completed[]=[],bases=new Map<string,SyntheticPipelineRepositories>(),ids=new Set<string>(),slots=new Set<number>();
    for(const raw of history){
      const v=object(raw),c=command(v.command),rebuilt=this.#build(c,restored);
      if(pipelineCanonical(v)!==pipelineCanonical(rebuilt)||ids.has(rebuilt.snapshotId)||slots.has(at(rebuilt.result.context!.cutoff)))reject();
      ids.add(rebuilt.snapshotId);slots.add(at(rebuilt.result.context!.cutoff));
      let base=bases.get(rebuilt.segmentKey);if(!base){const p=rebuilt.projection;base=new SyntheticPipelineRepositories({contractVersion:p.contractVersion,sampleKind:p.sampleKind,policyVersion:p.policyVersion,catalogVersion:p.catalogVersion,sourcePolicyVersion:p.sourcePolicyVersion});bases.set(rebuilt.segmentKey,base);}
      const p=rebuilt.projection,versions={contractVersion:p.contractVersion,sampleKind:p.sampleKind,policyVersion:p.policyVersion,catalogVersion:p.catalogVersion,sourcePolicyVersion:p.sourcePolicyVersion};
      base.saveSnapshotDraft({effectKey:'save:'+sha(rebuilt.snapshotId),payloadHash:sha(p),versions,value:p});
      const completion={snapshotKey:rebuilt.snapshotId,expectedRevision:rebuilt.localRevision-1,completionDigest:p.payloadDigest};
      base.compareAndSwapLatest({effectKey:'complete:'+sha(rebuilt.snapshotId),payloadHash:sha(completion),versions,value:completion});
      if(base.readLatest(p.streamId)?.revision!==rebuilt.localRevision)reject();restored.push(rebuilt);
    }
    return restored;
  }
  #snapshot(completed=this.#completed,drafts=this.#drafts):Exported{return {schema:SCHEMA,sampleKind:'SYNTHETIC',streamId:this.#streamId,capacity:this.#capacity,latest:completed.at(-1)?.snapshotId??null,completed,drafts};}
  propose(raw:unknown){
    const c=command(raw),existing=[...this.#completed,...this.#drafts].find(x=>x.snapshotId===c.snapshotId);
    if(existing){if(pipelineCanonical(existing.command)!==pipelineCanonical(c))reject('EFFECT_CONFLICT');return {status:'REUSED' as const,snapshot:clone(existing)};}
    const cutoff=at(c.recipe.context.cutoff);
    if([...this.#completed,...this.#drafts].some(x=>at(x.result.context!.cutoff)===cutoff))reject('EFFECT_CONFLICT');
    if(this.#completed.length>=this.#capacity||this.#drafts.length>=this.#capacity)reject('RATE_LIMITED');
    const proposed=this.#build(c,this.#completed),drafts=[...this.#drafts,proposed];clone(this.#snapshot(this.#completed,drafts));this.#drafts=drafts;return {status:'SAVED_DRAFT' as const,snapshot:clone(proposed)};
  }
  complete(snapshotId:string,expectedRevision:number){
    if(!pipelineId(snapshotId)||!integer(expectedRevision))reject();
    const old=this.#completed.find(x=>x.snapshotId===snapshotId);if(old){if(old.globalRevision!==expectedRevision+1)reject('VERSION_CONFLICT');return {status:'REUSED' as const,snapshot:clone(old)};}
    const pending=this.#drafts.find(x=>x.snapshotId===snapshotId);if(!pending||expectedRevision!==this.#completed.length||pending.command.expectedRevision!==expectedRevision)reject('VERSION_CONFLICT');
    if(this.#completed.length>=this.#capacity)reject('RATE_LIMITED');
    const completed=this.#validateHistory([...this.#completed,pending]),drafts=this.#drafts.filter(x=>x.snapshotId!==snapshotId);clone(this.#snapshot(completed,drafts));
    this.#completed=completed;this.#drafts=drafts;return {status:'COMPLETED' as const,snapshot:clone(completed.at(-1)!)};
  }
  latest(){return clone(this.#completed.at(-1)??null);}
  export():Exported{return clone(this.#snapshot());}
  /** Full genesis replay. A self-consistent replacement history is not authenticated external truth. */
  restore(raw:unknown):void {
    const v=object(raw);exact(v,['schema','sampleKind','streamId','capacity','latest','completed','drafts']);
    if(v.schema!==SCHEMA||v.sampleKind!=='SYNTHETIC'||v.streamId!==this.#streamId||v.capacity!==this.#capacity||!Array.isArray(v.drafts)||v.drafts.length>this.#capacity)reject();
    const completed=this.#validateHistory(v.completed);if(v.latest!==(completed.at(-1)?.snapshotId??null)||completed.length<this.#completed.length||this.#completed.some((x,n)=>pipelineCanonical(x)!==pipelineCanonical(completed[n])))reject();
    const drafts:Completed[]=[],ids=new Set(completed.map(x=>x.snapshotId)),slots=new Set(completed.map(x=>at(x.result.context!.cutoff)));
    for(const rawDraft of v.drafts){const x=object(rawDraft),c=command(x.command);if(c.expectedRevision>completed.length)reject();const rebuilt=this.#build(c,completed.slice(0,c.expectedRevision));if(pipelineCanonical(x)!==pipelineCanonical(rebuilt)||ids.has(c.snapshotId)||slots.has(at(rebuilt.result.context!.cutoff)))reject();ids.add(c.snapshotId);slots.add(at(rebuilt.result.context!.cutoff));drafts.push(rebuilt);}
    for(const pending of this.#drafts){const incoming=[...completed,...drafts].find(x=>x.snapshotId===pending.snapshotId);if(!incoming||pipelineCanonical(incoming)!==pipelineCanonical(pending))reject();}
    clone(this.#snapshot(completed,drafts));this.#completed=completed;this.#drafts=drafts;
  }
  /** Eligibility is supplied by a current trusted fixture port; missing or stale checks never serve old cards. */
  fallback(raw:unknown):{sourceCutoff:string;asOf:string;result:HomeRankingDraft}|null {
    const v=object(raw);exact(v,['sampleKind','profileId','nonpriceScaleVersion','sourcePolicyVersion','context','eligibility']);
    if(v.sampleKind!=='SYNTHETIC')reject();const d=descriptor(v.profileId,v.nonpriceScaleVersion,v.sourcePolicyVersion),context=object(v.context),qualification=object(v.eligibility);
    exact(qualification,['knownAt','complete','rows']);if(qualification.complete!==true||at(qualification.knownAt)!==at(context.cutoff)||!Array.isArray(qualification.rows)||qualification.rows.length>300)reject('RIGHTS_HOLD');
    const derived=deriveHomeContext({...context,comparisonSetVersion:comparison(context.comparisonSetVersion,d.profileId,d.nonpriceScaleVersion)});if(derived.status!=='DRAFT_SYNTHETIC')return null;
    const current=derived.value,rows=new Map<string,Record<string,unknown>>();
    for(const rawRow of qualification.rows){const row=object(rawRow);exact(row,['issueId','issueVersion','publicationState','impactState','evidenceValidUntil','evidenceCurrent']);if(!pipelineId(row.issueId)||!pipelineId(row.issueVersion)||rows.has(row.issueId)||!['PUBLISHED','HIDDEN','WITHDRAWN','CORRECTION_PENDING','DRAFT'].includes(row.publicationState as string)||!['ACTIVE','CHECK_PENDING','RESOLVED','INVALIDATED'].includes(row.impactState as string)||typeof row.evidenceCurrent!=='boolean')reject();at(row.evidenceValidUntil);rows.set(row.issueId,row);}
    const stored=[...this.#completed].reverse().find(x=>x.result.context!.contextKey===current.contextKey&&x.descriptor.profileId===d.profileId&&x.descriptor.nonpriceScaleVersion===d.nonpriceScaleVersion&&x.descriptor.sourcePolicyVersion===d.sourcePolicyVersion&&at(x.result.context!.cutoff)<=at(current.cutoff)&&at(current.cutoff)-at(x.result.context!.cutoff)<=900000);
    if(!stored)return null;
    for(const card of [...stored.result.lanes.A,...stored.result.lanes.B,...stored.result.lanes.C]){
      const row=rows.get(card.issueId),original=stored.command.recipe.priority.issues.find(x=>x.issueId===card.issueId&&x.version===card.issueVersion);
      if(!original||original.scheduledEndAt!==undefined&&at(original.scheduledEndAt)<=at(current.cutoff)||!row||row.issueVersion!==card.issueVersion||row.publicationState!=='PUBLISHED'||row.impactState!=='ACTIVE'||row.evidenceCurrent!==true||at(row.evidenceValidUntil)<=at(current.cutoff))return null;
    }
    return {sourceCutoff:stored.result.context!.cutoff,asOf:current.cutoff,result:clone(stored.result)};
  }
  diagnostics(){return {sampleKind:'SYNTHETIC',persistence:'MEMORY_FIXTURE_ONLY',completed:this.#completed.length,drafts:this.#drafts.length,segments:new Set(this.#completed.map(x=>x.segmentKey)).size,capacity:this.#capacity,networkCalls:0,databaseWrites:0,publicationEnabled:false};}
}
