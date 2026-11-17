/** NODE-ONLY HOME_BOUND_P3. Offline fixture ports, not database or publication authority. */
import {PipelineError,pipelineData,pipelineId,pipelineInstant,pipelineCanonical} from '../../../packages/contracts/src/pipeline.ts';
import type {SyntheticRankableBatch} from '../../../packages/contracts/src/rankable-batch.ts';
import type {SyntheticCompletedRanking} from '../../../packages/domain/src/pipeline-ranking.ts';

export const HOME_BOUND_SCHEMA='HOME_BOUND_P3' as const;
export interface HomeStamp {backendGeneration:string;readRevision:number;}
export interface HomeHead {snapshotId:string|null;digest:string|null;revision:number;}
export interface PrepareBoundRequest {roundId:string;rankingCutoff:string;expectedHead:HomeHead;}
export interface CompleteBoundRequest {roundId:string;expectedHead:HomeHead;}
export interface ProducerRequest extends PrepareBoundRequest {requiredIssueIds:string[];checkedAt:string;stamp:HomeStamp;}
export interface CurrentRequest {requiredIssueIds:string[];checkedAt:string;stamp:HomeStamp;}
/** All four functions are constructor-owned trusted fixture ports. No default clock/IO exists.
 * generation must change readRevision for any producer/current observation change. Snapshot
 * callbacks are not a real authority protocol; a real DB must check eligibility and CAS together.
 */
export interface OfflineHomePorts {
  clock:()=>string;
  generation:()=>HomeStamp;
  produce:(request:ProducerRequest)=>Promise<unknown>;
  current:(request:CurrentRequest)=>Promise<unknown>;
}
export interface BoundEnvelope<T> {schema:typeof HOME_BOUND_SCHEMA;mode:'OFFLINE_REPLAY';fixtureAssertionOnly:true;executionEnabled:false;persistence:'MEMORY_FIXTURE_ONLY';result:T;}
export type EngineExport=ReturnType<SyntheticCompletedRanking['export']>;
export type CompletedSnapshot=NonNullable<ReturnType<SyntheticCompletedRanking['latest']>>;
export interface BoundReceipt {operation:'PREPARE'|'COMPLETE';roundId:string;snapshotId:string;batchDigest:string;commandDigest:string;snapshotDigest:string;checkedAt:string;head:HomeHead;status:'SAVED_DRAFT'|'COMPLETED'|'REUSED';}
export interface BoundBinding {request:PrepareBoundRequest;stamp:HomeStamp;batch:SyntheticRankableBatch;batchDigest:string;commandDigest:string;snapshotDigest:string;prepareReceipt:BoundReceipt;completeReceipt:BoundReceipt|null;}
/** Engine arrays stay at their original root depth; engineSchema distinguishes the schemas. */
export interface BoundState {schema:typeof HOME_BOUND_SCHEMA;mode:'OFFLINE_REPLAY';fixtureAssertionOnly:true;executionEnabled:false;streamId:string;capacity:number;backendGeneration:string;checkedAt:string|null;engineSchema:EngineExport['schema'];sampleKind:'SYNTHETIC';latest:string|null;completed:EngineExport['completed'];drafts:EngineExport['drafts'];bindings:BoundBinding[];}
export function engineData(state:BoundState):EngineExport {return {schema:state.engineSchema,sampleKind:state.sampleKind,streamId:state.streamId,capacity:state.capacity,latest:state.latest,completed:state.completed,drafts:state.drafts};}
export function boundReject(code:'INVALID_INPUT'|'VERSION_CONFLICT'|'EFFECT_CONFLICT'|'POLICY_STALE'|'RIGHTS_HOLD'='INVALID_INPUT'):never {throw new PipelineError(code);}
export function boundData<T>(raw:unknown):T {try{return pipelineData(raw) as T;}catch(e){if(e instanceof PipelineError)throw e;return boundReject();}}
export function boundRecord(raw:unknown):Record<string,unknown>{if(!raw||typeof raw!=='object'||Array.isArray(raw))boundReject();return raw as Record<string,unknown>;}
export function boundExact(v:Record<string,unknown>,keys:string[]):void {if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))boundReject();}
export function homeStamp(raw:unknown):HomeStamp {const v=boundRecord(boundData(raw));boundExact(v,['backendGeneration','readRevision']);if(!pipelineId(v.backendGeneration)||!Number.isSafeInteger(v.readRevision)||Number(v.readRevision)<0)boundReject();return v as unknown as HomeStamp;}
export function homeHead(raw:unknown):HomeHead {const v=boundRecord(raw);boundExact(v,['snapshotId','digest','revision']);if(!Number.isSafeInteger(v.revision)||Number(v.revision)<0)boundReject();if(v.revision===0?(v.snapshotId!==null||v.digest!==null):(!pipelineId(v.snapshotId)||typeof v.digest!=='string'||!/^[a-f0-9]{64}$/.test(v.digest)))boundReject();return v as unknown as HomeHead;}
export function prepareRequest(raw:unknown):PrepareBoundRequest {const v=boundRecord(boundData(raw));boundExact(v,['roundId','rankingCutoff','expectedHead']);if(!pipelineId(v.roundId)||!Number.isFinite(pipelineInstant(v.rankingCutoff))||pipelineInstant(v.rankingCutoff)%300000!==0)boundReject();homeHead(v.expectedHead);return v as unknown as PrepareBoundRequest;}
export function completeRequest(raw:unknown):CompleteBoundRequest {const v=boundRecord(boundData(raw));boundExact(v,['roundId','expectedHead']);if(!pipelineId(v.roundId))boundReject();homeHead(v.expectedHead);return v as unknown as CompleteBoundRequest;}
export function boundEqual(a:unknown,b:unknown):boolean {return pipelineCanonical(a)===pipelineCanonical(b);}
export function boundEnvelope<T>(result:T):BoundEnvelope<T>{return boundData({schema:HOME_BOUND_SCHEMA,mode:'OFFLINE_REPLAY',fixtureAssertionOnly:true,executionEnabled:false,persistence:'MEMORY_FIXTURE_ONLY',result});}
export function resultHead(snapshot:CompletedSnapshot|null):HomeHead{return snapshot?{snapshotId:snapshot.snapshotId,digest:snapshot.digest,revision:snapshot.globalRevision}:{snapshotId:null,digest:null,revision:0};}
export function boundInstant(value:unknown):number {const n=pipelineInstant(value);if(!Number.isFinite(n))boundReject();return n;}
export const homeFloor=(time:string)=>new Date(Math.floor(boundInstant(time)/300000)*300000).toISOString();
