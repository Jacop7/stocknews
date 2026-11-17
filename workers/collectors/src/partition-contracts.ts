/** Node-only SYNTHETIC_PARTITION_JOURNAL_P2 declarations. No live rights, cursor execution or IO. */
import {PipelineError,pipelineData,pipelineCanonical,pipelineId,pipelineInstant,validatePipelineVersions,type PipelineVersions,type PipelineErrorCode} from '../../../packages/contracts/src/pipeline.ts';
import type {SourceIntent,SourceLookup} from './source-receipts.ts';
interface Hash {update(value:string):Hash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(name:'sha256'):Hash;randomUUID():string;}};
const crypto=process.getBuiltinModule('node:crypto');
export const PARTITION_JOURNAL_SCHEMA='SYNTHETIC_PARTITION_JOURNAL_P2' as const;
export const CHECKPOINT_OPERATION='COMMIT_PARTITION_CHECKPOINT' as const;
export interface FixtureClock {now():string;}
export interface JournalLimits {partitions:number;items:number;resumes:number;pages:number;effects:number;cursors:number;}
export const DEFAULT_JOURNAL_LIMITS:Readonly<JournalLimits>=Object.freeze({partitions:128,items:300,resumes:300,pages:1000,effects:1000,cursors:1000});
export interface PartitionSpec {versions:PipelineVersions;sourceId:string;endpointId:string;navigationVersion:string;queryVersion:string;adapterVersion:string;sourcePolicyVersion:string;selectionPolicyVersion:string;}
export interface RegisteredPartition {partitionId:string;spec:PartitionSpec;}
export interface FixturePermission {partitionId:string;generation:number;permissionVersion:string;purposes:{DISCOVERY:boolean;STORAGE:boolean};knownAt:string;expiresAt:string;}
export interface PartitionAccess {versions:PipelineVersions;partitionId:string;workerId:string;fence:number;permissionGeneration:number;}
export interface PartitionLease extends PartitionAccess {expiresAt:string;released:boolean;}
export interface ScanRange {from:string;to:string;}
export interface PartitionScan {scanId:string;partitionId:string;expectedVersion:number;startCursorRef:string|null;range:ScanRange;permissionGeneration:number;checkpointEffectKey:string|null;}
export interface ManifestItem {itemId:string;nativeId:string;revisionId:string;discoveredAt:string;requiresBody:boolean;}
export interface PageInput {
  pageId:string;scanId:string;ordinal:number;previousCursorRef:string|null;nextCursorOpaque:string|null;checkpointCursorOpaque:string|null;
  range:ScanRange;structureVerified:boolean;tabVerified:boolean;rangeVerified:boolean;final:boolean;outcome:'COMPLETE'|'PARTIAL'|'FAILED';atLimit:boolean;items:ManifestItem[];
}
export interface PageManifest extends Omit<PageInput,'nextCursorOpaque'|'checkpointCursorOpaque'> {partitionId:string;nextCursorRef:string|null;checkpointCursorRef:string|null;manifestDigest:string;}
export type ItemResult={kind:'SOURCE_STORED'}|{kind:'PASS';selectionPolicyVersion:string;reason:string}|{kind:'H_BODY'|'H_PERMISSION'|'HOLD_EFFECT_UNKNOWN';reason:string};
export type SourceAppliedReceipt=Extract<SourceLookup,{state:'APPLIED'}>['receipt'];
export interface JournalItem {partitionId:string;item:ManifestItem;bodyRequired:boolean;intent:SourceIntent|null;result:ItemResult|null;settledPermissionGeneration:number|null;sourceReceipt:SourceAppliedReceipt|null;}
export interface ResumeRecord {resumeId:string;partitionId:string;itemId:string;intentDigest:string;deadline:string;wakeCondition:string;createdAt:string;}
export interface PartitionCheckpoint {partitionId:string;version:number;cursorRef:string|null;scanId:string|null;manifestDigest:string|null;}
export interface CheckpointIntent {
  schema:typeof PARTITION_JOURNAL_SCHEMA;sampleKind:'SYNTHETIC';operation:typeof CHECKPOINT_OPERATION;backendGeneration:string;
  partitionId:string;effectKey:string;versions:PipelineVersions;scanId:string;expectedVersion:number;startCursorRef:string|null;cursorRef:string|null;
  manifestDigest:string;permissionGeneration:number;envelopeDigest:string;
}
export interface CheckpointReceipt {
  schema:typeof PARTITION_JOURNAL_SCHEMA;sampleKind:'SYNTHETIC';persistence:'MEMORY_FIXTURE_ONLY';operation:typeof CHECKPOINT_OPERATION;
  backendGeneration:string;partitionId:string;effectKey:string;envelopeDigest:string;status:'APPLIED'|'REUSED';value:PartitionCheckpoint;
}
export type CheckpointFault='NORMAL'|'BEFORE_WRITE_LOST'|'AFTER_INTENT_LOST'|'AFTER_RECEIPT_LOST';
export interface CheckpointLookup {schema:typeof PARTITION_JOURNAL_SCHEMA;operation:typeof CHECKPOINT_OPERATION;backendGeneration:string;partitionId:string;effectKey:string;envelopeDigest:string;diagnosticOnly:true;executionEnabled:false;state:'APPLIED'|'NOT_APPLIED'|'UNKNOWN';receipt:CheckpointReceipt|null;}
export type CheckpointRecovery=(CheckpointLookup&{recovery:'RECOVERED';receipt:CheckpointReceipt})|(CheckpointLookup&{recovery:'RETRY_SAME_INTENT';intent:CheckpointIntent})|(CheckpointLookup&{recovery:'HOLD_EFFECT_UNKNOWN'});
export interface ScanCompletion {ready:boolean;reasons:string[];manifestDigest:string;cursorRef:string|null;}

export function partitionReject(code:PipelineErrorCode='INVALID_INPUT'):never {throw new PipelineError(code);}
export const partitionClone=<T>(v:T):T=>pipelineData(v) as T;
export const partitionSha=(v:unknown):string=>crypto.createHash('sha256').update(pipelineCanonical(v)).digest('hex');
export const partitionGeneration=():string=>'fixture-'+crypto.randomUUID();
export function partitionRecord(raw:unknown):Record<string,unknown> {const v=pipelineData(raw);if(!v||typeof v!=='object'||Array.isArray(v))partitionReject();return v as Record<string,unknown>;}
export function partitionExact(v:Record<string,unknown>,keys:string[]):void {if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))partitionReject();}
export function partitionId(v:unknown):string {if(!pipelineId(v))partitionReject();return v;}
export function partitionInteger(v:unknown,min=0,max=Number.MAX_SAFE_INTEGER):number {if(typeof v!=='number'||!Number.isSafeInteger(v)||v<min||v>max)partitionReject();return v;}
export function partitionText(v:unknown,max=4000):string {if(typeof v!=='string'||!v.trim()||v.length>max)partitionReject();return v;}
export function partitionTime(v:unknown):number {const n=pipelineInstant(v);if(!Number.isFinite(n))partitionReject();return n;}
export function partitionStamp(v:unknown):string {return new Date(partitionTime(v)).toISOString();}
export function partitionNullableId(v:unknown):string|null {return v===null?null:partitionId(v);}
export function validatePartitionRange(raw:unknown):ScanRange {const v=partitionRecord(raw);partitionExact(v,['from','to']);const from=partitionStamp(v.from),to=partitionStamp(v.to);if(partitionTime(from)>partitionTime(to))partitionReject();return {from,to};}
export function validatePartitionSpec(raw:unknown):PartitionSpec {
  const v=partitionRecord(raw);partitionExact(v,['versions','sourceId','endpointId','navigationVersion','queryVersion','adapterVersion','sourcePolicyVersion','selectionPolicyVersion']);
  const versions=validatePipelineVersions(v.versions);for(const key of ['sourceId','endpointId','navigationVersion','queryVersion','adapterVersion','sourcePolicyVersion','selectionPolicyVersion'])partitionId(v[key]);
  if(v.sourcePolicyVersion!==versions.sourcePolicyVersion)partitionReject('POLICY_STALE');return {...v,versions} as unknown as PartitionSpec;
}
export function validatePartitionAccess(raw:unknown):PartitionAccess {
  const v=partitionRecord(raw);partitionExact(v,['versions','partitionId','workerId','fence','permissionGeneration']);const versions=validatePipelineVersions(v.versions);
  partitionId(v.partitionId);partitionId(v.workerId);partitionInteger(v.fence,1);partitionInteger(v.permissionGeneration,1);return {...v,versions} as unknown as PartitionAccess;
}
export function validateFixturePermission(raw:unknown):FixturePermission {
  const v=partitionRecord(raw);partitionExact(v,['partitionId','generation','permissionVersion','purposes','knownAt','expiresAt']);partitionId(v.partitionId);partitionId(v.permissionVersion);partitionInteger(v.generation,1);
  const p=partitionRecord(v.purposes);partitionExact(p,['DISCOVERY','STORAGE']);if(typeof p.DISCOVERY!=='boolean'||typeof p.STORAGE!=='boolean')partitionReject();
  const knownAt=partitionStamp(v.knownAt),expiresAt=partitionStamp(v.expiresAt);if(partitionTime(knownAt)>=partitionTime(expiresAt))partitionReject();return {...v,purposes:p,knownAt,expiresAt} as unknown as FixturePermission;
}
export function validateManifestItem(raw:unknown):ManifestItem {
  const v=partitionRecord(raw);partitionExact(v,['itemId','nativeId','revisionId','discoveredAt','requiresBody']);for(const key of ['itemId','nativeId','revisionId'])partitionId(v[key]);
  if(typeof v.requiresBody!=='boolean')partitionReject();return {...v,discoveredAt:partitionStamp(v.discoveredAt)} as unknown as ManifestItem;
}
export function validatePartitionPage(raw:unknown):PageInput {
  const v=partitionRecord(raw);partitionExact(v,['pageId','scanId','ordinal','previousCursorRef','nextCursorOpaque','checkpointCursorOpaque','range','structureVerified','tabVerified','rangeVerified','final','outcome','atLimit','items']);
  partitionId(v.pageId);partitionId(v.scanId);partitionInteger(v.ordinal,0,999);partitionNullableId(v.previousCursorRef);
  for(const k of ['nextCursorOpaque','checkpointCursorOpaque'])if(v[k]!==null)partitionText(v[k],4096);
  for(const k of ['structureVerified','tabVerified','rangeVerified','final','atLimit'])if(typeof v[k]!=='boolean')partitionReject();
  if(!['COMPLETE','PARTIAL','FAILED'].includes(v.outcome as string)||!Array.isArray(v.items)||v.items.length>300||!v.final&&v.checkpointCursorOpaque!==null)partitionReject();
  const items=v.items.map(validateManifestItem);if(new Set(items.map(i=>i.itemId)).size!==items.length)partitionReject();
  return {...v,items,range:validatePartitionRange(v.range)} as unknown as PageInput;
}
export function validateItemResult(raw:unknown):ItemResult {
  const v=partitionRecord(raw);
  if(v.kind==='SOURCE_STORED')partitionExact(v,['kind']);
  else if(v.kind==='PASS'){partitionExact(v,['kind','selectionPolicyVersion','reason']);partitionId(v.selectionPolicyVersion);partitionText(v.reason,500);}
  else if(['H_BODY','H_PERMISSION','HOLD_EFFECT_UNKNOWN'].includes(v.kind as string)){partitionExact(v,['kind','reason']);partitionText(v.reason,500);}
  else partitionReject();return v as unknown as ItemResult;
}
export function validateJournalLimits(raw:unknown):JournalLimits {const v=partitionRecord(raw);partitionExact(v,Object.keys(DEFAULT_JOURNAL_LIMITS));for(const key of Object.keys(DEFAULT_JOURNAL_LIMITS) as Array<keyof JournalLimits>)partitionInteger(v[key],1,DEFAULT_JOURNAL_LIMITS[key]);return v as unknown as JournalLimits;}
export function validateCheckpointIntent(raw:unknown):CheckpointIntent {
  const v=partitionRecord(raw);partitionExact(v,['schema','sampleKind','operation','backendGeneration','partitionId','effectKey','versions','scanId','expectedVersion','startCursorRef','cursorRef','manifestDigest','permissionGeneration','envelopeDigest']);
  if(v.schema!==PARTITION_JOURNAL_SCHEMA||v.sampleKind!=='SYNTHETIC'||v.operation!==CHECKPOINT_OPERATION)partitionReject();
  for(const key of ['backendGeneration','partitionId','effectKey','scanId'])partitionId(v[key]);partitionInteger(v.expectedVersion);partitionInteger(v.permissionGeneration,1);partitionNullableId(v.startCursorRef);partitionNullableId(v.cursorRef);
  for(const key of ['manifestDigest','envelopeDigest'])if(typeof v[key]!=='string'||!/^[a-f0-9]{64}$/.test(v[key] as string))partitionReject();
  const versions=validatePipelineVersions(v.versions),{envelopeDigest,...base}=v;if(partitionSha(base)!==envelopeDigest)partitionReject();return {...v,versions} as unknown as CheckpointIntent;
}
