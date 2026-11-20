/** NODE-ONLY HOME_BOUND_P3. Single-process offline fixture ownership, not DB atomicity. */
interface FixtureHash {update(value:string):FixtureHash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(algorithm:'sha256'):FixtureHash}};
const {createHash}=process.getBuiltinModule('node:crypto');
import {pipelineCanonical,PipelineError} from '../../../packages/contracts/src/pipeline.ts';
import {validateSyntheticRankableBatch} from '../../../packages/contracts/src/rankable-batch.ts';
import {SyntheticCompletedRanking} from '../../../packages/domain/src/pipeline-ranking.ts';
import {buildSyntheticRankingInputs} from './rankable-adapter.ts';
import {inspectCurrent,currentMatches,currentFallback,snapshotIssueIds,internalHomeRead,type InternalHomeRead} from './bound-read.ts';
import {HOME_BOUND_SCHEMA,boundData,boundRecord,boundExact,boundReject,boundEqual,boundEnvelope,boundInstant,homeStamp,prepareRequest,completeRequest,resultHead,homeFloor,engineData,type OfflineHomePorts,type HomeStamp,type HomeHead,type BoundBinding,type BoundState,type BoundReceipt,type BoundEnvelope,type CompletedSnapshot} from './bound-ports.ts';

const sha=(raw:unknown)=>createHash('sha256').update(pipelineCanonical(raw)).digest('hex');
type Owned={engine:SyntheticCompletedRanking;state:BoundState};
const cardIds=(snapshots:CompletedSnapshot[])=>[...new Set(snapshots.flatMap(snapshotIssueIds))].sort();
function receipt(binding:Omit<BoundBinding,'prepareReceipt'|'completeReceipt'>,operation:'PREPARE'|'COMPLETE',checkedAt:string,head:HomeHead):BoundReceipt {
  return {operation,roundId:binding.request.roundId,snapshotId:binding.request.roundId,batchDigest:binding.batchDigest,commandDigest:binding.commandDigest,snapshotDigest:binding.snapshotDigest,checkedAt,head,status:operation==='PREPARE'?'SAVED_DRAFT':'COMPLETED'};
}

export class OfflineBoundHomeDispatcher {
  #ports:OfflineHomePorts;#owned:Owned;#backend:string;
  constructor(ports:OfflineHomePorts,streamId='fixture-bound-home',capacity=32){
    // Ports are trusted code, copied once without evaluating constructor property getters.
    if(!ports||typeof ports!=='object'||Array.isArray(ports))boundReject();
    const keys=Reflect.ownKeys(ports),descriptors=Object.getOwnPropertyDescriptors(ports),copy:Record<string,unknown>={};
    if(keys.length!==4)boundReject();for(const key of ['clock','generation','produce','current']){const d=descriptors[key];if(!d||!d.enumerable||!('value'in d)||typeof d.value!=='function')boundReject();copy[key]=d.value;}
    this.#ports=copy as unknown as OfflineHomePorts;const stamp=homeStamp(this.#ports.generation());this.#backend=stamp.backendGeneration;
    const engine=new SyntheticCompletedRanking(streamId,capacity),{schema:engineSchema,...fields}=engine.export(),state:BoundState={...fields,schema:HOME_BOUND_SCHEMA,engineSchema,mode:'OFFLINE_REPLAY',fixtureAssertionOnly:true,executionEnabled:false,backendGeneration:this.#backend,checkedAt:null,bindings:[]};
    boundEnvelope(state);this.#owned={engine,state};
  }
  #stamp():HomeStamp {const s=homeStamp(this.#ports.generation());if(s.backendGeneration!==this.#backend)boundReject('POLICY_STALE');return s;}
  #now(start?:string):string {const value=this.#ports.clock(),n=boundInstant(value),old=this.#owned.state.checkedAt;if(start!==undefined&&n<boundInstant(start)||old!==null&&n<boundInstant(old))boundReject('POLICY_STALE');return new Date(n).toISOString();}
  #head(owned=this.#owned):HomeHead{return resultHead(owned.engine.latest());}
  #unchanged(start:Owned,stamp:HomeStamp):void {if(this.#owned!==start)boundReject('VERSION_CONFLICT');if(!boundEqual(this.#stamp(),stamp))boundReject('POLICY_STALE');}
  #stage(start:Owned):SyntheticCompletedRanking {const e=new SyntheticCompletedRanking(start.state.streamId,start.state.capacity);e.restore(engineData(start.state));return e;}
  #commit(start:Owned,stamp:HomeStamp,engine:SyntheticCompletedRanking,bindings:BoundBinding[],checkedAt:string,result:BoundReceipt|null):BoundEnvelope<BoundReceipt|null> {
    const {schema:engineSchema,...fields}=engine.export(),state:BoundState={...start.state,...fields,engineSchema,checkedAt,bindings};
    const response=boundEnvelope(result);boundEnvelope(state);
    // Preflight complete owned state plus response before the sole pointer assignment.
    const staged=boundData<{state:BoundState;response:BoundEnvelope<BoundReceipt|null>}>({state,response});
    this.#unchanged(start,stamp);this.#owned={engine,state:staged.state};return staged.response;
  }
  head():BoundEnvelope<HomeHead>{return boundEnvelope(this.#head());}
  exportBound():BoundEnvelope<BoundState>{return boundEnvelope(this.#owned.state);}
  async prepareBound(raw:unknown):Promise<BoundEnvelope<BoundReceipt>> {
    const request=prepareRequest(raw),start=this.#owned,stamp=this.#stamp(),checkedAt=this.#now();
    if(boundInstant(request.rankingCutoff)>boundInstant(checkedAt))boundReject('RIGHTS_HOLD');
    const existing=start.state.bindings.find(b=>b.request.roundId===request.roundId);
    if(existing){if(!boundEqual(existing.request,request))boundReject('EFFECT_CONFLICT');if(!boundEqual(existing.stamp,stamp))boundReject('POLICY_STALE');return boundEnvelope({...existing.prepareReceipt,status:'REUSED'});}
    if(!boundEqual(request.expectedHead,this.#head(start)))boundReject('VERSION_CONFLICT');
    const requiredIssueIds=cardIds(start.state.completed);
    let rawProduced:unknown;try{rawProduced=await this.#ports.produce(boundData({...request,requiredIssueIds,checkedAt,stamp}));}catch(e){if(e instanceof PipelineError)throw e;return boundReject('RIGHTS_HOLD');}
    this.#unchanged(start,stamp);const acceptedAt=this.#now(checkedAt),v=boundRecord(boundData(rawProduced));
    boundExact(v,['schema','mode','fixtureAssertionOnly','executionEnabled','stamp','batch']);
    if(v.schema!==HOME_BOUND_SCHEMA||v.mode!=='OFFLINE_REPLAY'||v.fixtureAssertionOnly!==true||v.executionEnabled!==false||!boundEqual(homeStamp(v.stamp),stamp))boundReject('RIGHTS_HOLD');
    const batch=validateSyntheticRankableBatch(v.batch);
    if(batch.snapshotId!==request.roundId||boundInstant(batch.cutoff)!==boundInstant(request.rankingCutoff)||batch.expectedRevision!==request.expectedHead.revision||requiredIssueIds.some(id=>!batch.declared.issueIds.includes(id)))boundReject('RIGHTS_HOLD');
    const inputs=buildSyntheticRankingInputs(batch),engine=this.#stage(start),saved=engine.propose(inputs.command);
    const base={request,stamp,batch,batchDigest:inputs.bindingManifest.batchDigest,commandDigest:inputs.bindingManifest.commandDigest,snapshotDigest:saved.snapshot.digest};
    const binding:BoundBinding={...base,prepareReceipt:receipt(base,'PREPARE',acceptedAt,request.expectedHead),completeReceipt:null};
    return this.#commit(start,stamp,engine,[...start.state.bindings,binding],acceptedAt,binding.prepareReceipt) as BoundEnvelope<BoundReceipt>;
  }
  async completeBound(raw:unknown):Promise<BoundEnvelope<BoundReceipt>> {
    const request=completeRequest(raw),start=this.#owned,binding=start.state.bindings.find(b=>b.request.roundId===request.roundId);if(!binding)boundReject('VERSION_CONFLICT');
    if(!boundEqual(request.expectedHead,binding.request.expectedHead))boundReject('VERSION_CONFLICT');
    if(binding.completeReceipt===null&&!boundEqual(request.expectedHead,this.#head(start)))boundReject('VERSION_CONFLICT');
    const stamp=this.#stamp();if(!boundEqual(binding.stamp,stamp))boundReject('POLICY_STALE');const observedAt=this.#now();
    const inputs=buildSyntheticRankingInputs(binding.batch),candidateIds=inputs.command.recipe.priority.issues.map(x=>x.issueId),requiredIssueIds=[...new Set([...cardIds(start.state.completed),...binding.batch.declared.issueIds,...candidateIds])].sort();
    let rawCurrent:unknown;try{rawCurrent=await this.#ports.current(boundData({requiredIssueIds,checkedAt:observedAt,stamp}));}catch(e){if(e instanceof PipelineError)throw e;return boundReject('RIGHTS_HOLD');}
    this.#unchanged(start,stamp);const checkedAt=this.#now(observedAt),view=inspectCurrent(rawCurrent,requiredIssueIds,stamp,observedAt,checkedAt);
    if(!currentMatches(view,binding,candidateIds))boundReject('RIGHTS_HOLD');
    if(binding.completeReceipt!==null)return boundEnvelope({...binding.completeReceipt,status:'REUSED'});
    const engine=this.#stage(start),done=engine.complete(request.roundId,request.expectedHead.revision),completed={...binding,completeReceipt:receipt(binding,'COMPLETE',checkedAt,resultHead(done.snapshot))};
    return this.#commit(start,stamp,engine,start.state.bindings.map(b=>b===binding?completed:b),checkedAt,completed.completeReceipt) as BoundEnvelope<BoundReceipt>;
  }
  async readHomeBound(raw:unknown=null):Promise<BoundEnvelope<InternalHomeRead>> {
    if(raw!==null)boundReject();const start=this.#owned,stamp=this.#stamp(),observedAt=this.#now();
    const requiredIssueIds=[...new Set([...cardIds(start.state.completed),...start.state.bindings.filter(b=>b.completeReceipt===null).flatMap(b=>b.batch.declared.issueIds)])].sort();
    try{
      const rawCurrent=await this.#ports.current(boundData({requiredIssueIds,checkedAt:observedAt,stamp}));this.#unchanged(start,stamp);const checkedAt=this.#now(observedAt),view=inspectCurrent(rawCurrent,requiredIssueIds,stamp,observedAt,checkedAt);
      const fallback=start.engine.fallback(currentFallback(view,checkedAt));if(!fallback)return boundEnvelope(internalHomeRead(null,checkedAt));
      const snapshot=start.state.completed.find(x=>x.result.context!.cutoff===fallback.sourceCutoff),binding=start.state.bindings.find(x=>x.request.roundId===snapshot?.snapshotId);
      if(!snapshot||!binding||boundInstant(checkedAt)-boundInstant(fallback.sourceCutoff)>900000||!currentMatches(view,binding,snapshotIssueIds(snapshot)))return boundEnvelope(internalHomeRead(null,checkedAt));
      return boundEnvelope(internalHomeRead(snapshot,checkedAt,snapshot.snapshotId===start.state.latest&&boundInstant(snapshot.result.context!.cutoff)===boundInstant(homeFloor(checkedAt))));
    }catch(e){
      // No old body is returned when current observation, source qualification or concurrent
      // generation/head checks fail. Read errors do not mutate any owned state.
      if(e instanceof PipelineError)return boundEnvelope(internalHomeRead(null,this.#now(observedAt)));
      return boundEnvelope(internalHomeRead(null,this.#now(observedAt)));
    }
  }
  restoreBound(raw:unknown):BoundEnvelope<null> {
    const start=this.#owned,stamp=this.#stamp(),checkedAt=this.#now(),v=boundRecord(boundData(raw));
    boundExact(v,['schema','engineSchema','sampleKind','mode','fixtureAssertionOnly','executionEnabled','streamId','capacity','backendGeneration','checkedAt','latest','completed','drafts','bindings']);
    if(v.schema!==HOME_BOUND_SCHEMA||v.mode!=='OFFLINE_REPLAY'||v.fixtureAssertionOnly!==true||v.executionEnabled!==false||v.streamId!==start.state.streamId||v.capacity!==start.state.capacity||v.backendGeneration!==this.#backend||!Array.isArray(v.bindings)||v.bindings.length>64)boundReject();
    if(v.checkedAt!==null&&boundInstant(v.checkedAt)>boundInstant(checkedAt))boundReject();
    const engine=this.#stage(start);engine.restore(engineData(v as unknown as BoundState));const restored=engine.export(),snapshots=[...restored.completed,...restored.drafts],bindings:BoundBinding[]=[],ids=new Set<string>();
    if(v.bindings.length!==snapshots.length)boundReject();
    for(const rawBinding of v.bindings){
      const b=boundRecord(rawBinding);boundExact(b,['request','stamp','batch','batchDigest','commandDigest','snapshotDigest','prepareReceipt','completeReceipt']);
      const request=prepareRequest(b.request),s=homeStamp(b.stamp),batch=validateSyntheticRankableBatch(b.batch),input=buildSyntheticRankingInputs(batch),snapshot=snapshots.find(x=>x.snapshotId===request.roundId);
      if(ids.has(request.roundId)||!snapshot||s.backendGeneration!==this.#backend||s.readRevision>stamp.readRevision||batch.snapshotId!==request.roundId||batch.expectedRevision!==request.expectedHead.revision||boundInstant(batch.cutoff)!==boundInstant(request.rankingCutoff)||b.batchDigest!==input.bindingManifest.batchDigest||b.commandDigest!==sha(input.command)||b.snapshotDigest!==snapshot.digest||!boundEqual(input.command,snapshot.command))boundReject();
      const prefix=resultHead(restored.completed[request.expectedHead.revision-1]??null);if(!boundEqual(prefix,request.expectedHead))boundReject();
      const base={request,stamp:s,batch,batchDigest:b.batchDigest as string,commandDigest:b.commandDigest as string,snapshotDigest:b.snapshotDigest as string},prepared=boundRecord(b.prepareReceipt),preparedAt=prepared.checkedAt as string;
      if(boundInstant(preparedAt)<boundInstant(request.rankingCutoff)||boundInstant(preparedAt)>boundInstant(checkedAt)||!boundEqual(b.prepareReceipt,receipt(base,'PREPARE',preparedAt,request.expectedHead)))boundReject();
      const isCompleted=restored.completed.some(x=>x.snapshotId===request.roundId);let completed:BoundReceipt|null=null;
      if(isCompleted){const c=boundRecord(b.completeReceipt),at=c.checkedAt as string;if(boundInstant(at)<boundInstant(preparedAt)||boundInstant(at)>boundInstant(checkedAt)||!boundEqual(c,receipt(base,'COMPLETE',at,resultHead(snapshot))))boundReject();completed=c as unknown as BoundReceipt;}
      else if(b.completeReceipt!==null)boundReject();
      bindings.push({...base,prepareReceipt:prepared as unknown as BoundReceipt,completeReceipt:completed});ids.add(request.roundId);
    }
    if(bindings.length&&v.checkedAt===null||v.checkedAt!==null&&bindings.some(b=>boundInstant(v.checkedAt)<boundInstant(b.completeReceipt?.checkedAt??b.prepareReceipt.checkedAt)))boundReject();
    for(const old of start.state.bindings){const incoming=bindings.find(b=>b.request.roundId===old.request.roundId);if(!incoming||!boundEqual({...old,completeReceipt:null},{...incoming,completeReceipt:null})||old.completeReceipt!==null&&!boundEqual(old.completeReceipt,incoming.completeReceipt))boundReject();}
    return this.#commit(start,stamp,engine,bindings,checkedAt,null) as BoundEnvelope<null>;
  }
}
