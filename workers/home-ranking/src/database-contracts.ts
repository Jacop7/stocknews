/** HOME_DB_BOUND_V1. Pure decoded-value contracts; no domain, crypto or IO imports.
 * jsonb has already collapsed duplicate keys. These validators do not certify original wire bytes.
 */
declare const process:{getBuiltinModule(name:'node:util'):{types:{isProxy(value:unknown):boolean}}};
const proxyType=process.getBuiltinModule('node:util').types;
export const homeIsProxy=(value:unknown):boolean=>proxyType.isProxy(value);
export const HOME_DATABASE_SCHEMA='HOME_DB_BOUND_V1' as const;
export const HOME_DATABASE_IMAGE='sha256:7c31363a3f7434ff14945f1b8a4880e6eca8b362e197e88b87c476c77aa3cf8c' as const;
// Existing K1 reviewed profile/scale/source registry; no new economic profile is invented here.
export const HOME_DATABASE_PROFILE=Object.freeze({manifestId:'00000000-0000-4000-8000-000000000001',profileId:'SYNTHETIC_PROFILE_V1',nonpriceScaleVersion:'SYNTHETIC_SCALE_V1',catalogVersion:'catalog-db-p4-v1',evaluationSetVersion:'evaluation-db-p4-v1',comparisonSetVersion:'comparison-db-p4-v1',sourcePolicyVersion:'SYNTHETIC_SOURCE_V1'} as const);
export const HOME_DATABASE_PROFILES=Object.freeze([HOME_DATABASE_PROFILE,Object.freeze({...HOME_DATABASE_PROFILE,manifestId:'00000000-0000-4000-8000-000000000002',profileId:'SYNTHETIC_PROFILE_REISSUE',nonpriceScaleVersion:'SYNTHETIC_SCALE_V2'} as const)] as const);
export type JsonValue=null|boolean|number|string|JsonValue[]|JsonRecord;
export interface JsonRecord {[key:string]:JsonValue;}
export type HomeDbRole='home_v1_fixture_writer'|'home_v1_capture_worker'|'home_v1_commit_worker'|'home_v1_internal_reader';
export type HomeDbRpc='resource_identity'|'fixture_apply'|'get_head'|'capture_round'|'commit_round'|'lookup_effect'|'discard_stale_round'|'read_current_home';
export const HOME_DATABASE_ROLES:readonly HomeDbRole[]=Object.freeze(['home_v1_fixture_writer','home_v1_capture_worker','home_v1_commit_worker','home_v1_internal_reader']);
export const HOME_DATABASE_RPCS:readonly HomeDbRpc[]=Object.freeze(['resource_identity','fixture_apply','get_head','capture_round','commit_round','lookup_effect','discard_stale_round','read_current_home']);
export const HOME_DATABASE_FLAGS=Object.freeze({schema:HOME_DATABASE_SCHEMA,mode:'ISOLATED_SYNTHETIC_POSTGRES',sampleKind:'SYNTHETIC',fixtureAssertionOnly:true,executionEnabled:false,persistence:'POSTGRES_TEST_ONLY',databaseAlgorithmAuthenticity:false,commitTimeQualificationProven:false,crossworkerAtomicity:false} as const);
export class HomeDatabaseError extends Error {
 readonly code:string;
 constructor(code:string){super(code);this.name='HomeDatabaseError';this.code=code;}
}
export function homeReject(code='INVALID_REQUEST'):never {throw new HomeDatabaseError(code);}
export const homeUuid=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
export const homeHash=(v:unknown):v is string=>typeof v==='string'&&/^[0-9a-f]{64}$/.test(v);
export const homeDecimal=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,18})$/.test(v)&&BigInt(v)<=9223372036854775807n;
export const homeId=(v:unknown):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.:-]{1,160}$/.test(v);
export function homeTime(v:unknown):number {
 if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}(?:\d{3})?Z$/.test(v))homeReject();
 const n=Date.parse(v);if(!Number.isFinite(n)||new Date(n).toISOString()!==v.replace(/(\.\d{3})\d{3}Z$/,'$1Z'))homeReject();return n;
}
/** Same root budgets as pipelineData; a wire byte cap is an additional conservative limit. */
export function homeData(raw:unknown):JsonValue {
 let nodes=10000;const parents=new Set<object>();
 const copy=(v:unknown,depth:number):JsonValue=>{
  if(--nodes<0||depth>12)homeReject('JSON_BUDGET');
  if(v===null||typeof v==='boolean')return v;
  if(typeof v==='string'){
   if(v.length>65536||v.includes('\0'))homeReject('JSON_BUDGET');
   for(const c of v){const n=c.codePointAt(0)!;if(n>=0xd800&&n<=0xdfff)homeReject();}
   return v;
  }
  if(typeof v==='number'){if(!Number.isFinite(v))homeReject();return v;}
  if(!v||typeof v!=='object'||homeIsProxy(v)||parents.has(v))homeReject();
  const arr=Array.isArray(v),proto=Object.getPrototypeOf(v),keys=Reflect.ownKeys(v);
  if(arr?(proto!==Array.prototype||v.length>1000||keys.length!==v.length+1):(proto!==Object.prototype&&proto!==null))homeReject();
  parents.add(v);let out:JsonValue;
  if(arr){const values:JsonValue[]=[];for(let i=0;i<v.length;i++){const d=Object.getOwnPropertyDescriptor(v,String(i));if(!d||!d.enumerable||!('value'in d))homeReject();values.push(copy(d.value,depth+1));}out=values;}
  else {const values:JsonRecord={};for(const key of keys){const d=Object.getOwnPropertyDescriptor(v,key)!;if(typeof key!=='string'||!d.enumerable||!('value'in d)||!/^[A-Za-z][A-Za-z0-9_]*$/.test(key))homeReject();Object.defineProperty(values,key,{value:copy(d.value,depth+1),enumerable:true,writable:true,configurable:true});}out=values;}
  parents.delete(v);return out;
 };
 const value=copy(raw,0),wire=JSON.stringify(value);if(wire.length>262144||new TextEncoder().encode(wire).length>262144)homeReject('JSON_BUDGET');return value;
}
export function homeRecord(raw:unknown):JsonRecord {if(!raw||typeof raw!=='object'||Array.isArray(raw))homeReject();return raw as JsonRecord;}
export function homeExact(v:JsonRecord,keys:readonly string[]):void {if(Object.keys(v).length!==keys.length||keys.some(k=>!Object.hasOwn(v,k)))homeReject();}
export function homeIds(v:unknown,max=300):string[] {if(!Array.isArray(v)||v.length>max||!v.every(homeId)||new Set(v).size!==v.length)homeReject();return v as string[];}
export function homeSafeRevision(v:unknown):number {if(!homeDecimal(v)||BigInt(v)>BigInt(Number.MAX_SAFE_INTEGER))homeReject('REVISION_RANGE');return Number(v);}
/** Request codec: decoded values, ASCII keys, safe integers, JSON.stringify scalar escapes. */
export function homeRequestCanonical(raw:unknown):string {
 const sort=(v:JsonValue):JsonValue=>{
  if(typeof v==='number'&&!Number.isSafeInteger(v))homeReject();
  if(Array.isArray(v))return v.map(sort);
  if(v&&typeof v==='object')return Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k]!)]));
  return v;
 };
 return JSON.stringify(sort(homeData(raw)));
}
export interface HomeDatabaseResourceIdentity {
 schema:'HOME_DB_BOUND_V1_RESOURCE';productId:'judoju-news';stage:'MAIN_PARALLEL_P4';component:'HOME_DB_BOUND_V1';
 resourceId:string;runId:string;containerId:string;imageId:typeof HOME_DATABASE_IMAGE;
 clusterSystemIdentifier:string;databaseName:string;databaseOid:string;bootstrapUuid:string;contractSha256:string;
}
export interface HomePrincipal {sessionUser:string;sessionUserOid:string;componentRole:HomeDbRole;resourceId:string;runId:string;}
export interface HomeHead {revision:string;roundId:string|null;digest:string|null;}
export interface HomeCaptureRequest {namespaceId:string;effectKey:string;roundId:string;streamId:string;rankingCutoff:string;expectedHead:HomeHead;supersedesRoundId:string|null;}
export interface HomeCaptureResult {
 roundId:string;streamId:string;rankingCutoff:string;expectedHead:HomeHead;producerRevision:string;inputDigest:string;slotGeneration:string;
 plannedGlobalRevision:string;plannedLocalRevision:string;segmentKey:string;snapshotCanonical:string;
}
export interface HomeCommitResult {roundId:string;roundState:'COMPLETED'|'SUPERSEDED';head:HomeHead;globalRevision:string;localRevision:string;slotGeneration:string;inputDigest:string;resultDigest:string|null;qualificationCheckedAt:string|null;}
export interface HomeReadResult {state:'FRESH'|'DELAYED'|'CALCULATING';checkedAt:string;rankingCutoff:string;snapshotId:string|null;sourceCutoff:string|null;marketBasis:'KR_COMBINED'|'FOREIGN_US'|null;targetKrTradingDay:string|null;lanes:Record<'A'|'B'|'C',{issueId:string;articleVersionId:string;}[]>;}
export type HomeDatabaseReply=typeof HOME_DATABASE_FLAGS & {
 resourceId:string;namespaceId:string|null;backendGeneration:string|null;principal:HomePrincipal;serverCheckedAt:string;operation:HomeDbRpc;result:JsonRecord;
 effectKey?:string;requestDigest?:string;status?:'APPLIED'|'REUSED';
};
export type HomeHeadReply=HomeDatabaseReply;
export type HomeWriteReceipt=HomeDatabaseReply;
export type HomeEffectReply=HomeDatabaseReply;
export type HomeInternalReadReply=HomeDatabaseReply;
export type HomeDatabaseTransport=(call:Readonly<{role:HomeDbRole;rpc:HomeDbRpc;args:{p_request:JsonRecord};}>)=>Promise<unknown>;
export interface HomeEvaluatedRound {schema:typeof HOME_DATABASE_SCHEMA;namespaceId:string;roundId:string;backendGeneration:string;inputDigest:string;previousDigest:string|null;plannedGlobalRevision:string;plannedLocalRevision:string;segmentKey:string;resultCanonical:string;resultDigest:string;}
export interface HomePreparedRoundSummary {schema:typeof HOME_DATABASE_SCHEMA;status:'PREPARED';namespaceId:string;roundId:string;streamId:string;rankingCutoff:string;backendGeneration:string;producerRevision:string;expectedHead:HomeHead;inputDigest:string;resultDigest:string;}
export interface HomePreparedRoundHandle {readonly opaque:'HOME_DB_PREPARED';}

export function validateHomeDatabaseResource(raw:unknown):HomeDatabaseResourceIdentity {
 const r=homeRecord(homeData(raw));homeExact(r,['schema','productId','stage','component','resourceId','runId','containerId','imageId','clusterSystemIdentifier','databaseName','databaseOid','bootstrapUuid','contractSha256']);
 if(r.schema!=='HOME_DB_BOUND_V1_RESOURCE'||r.productId!=='judoju-news'||r.stage!=='MAIN_PARALLEL_P4'||r.component!==HOME_DATABASE_SCHEMA||r.imageId!==HOME_DATABASE_IMAGE||![r.resourceId,r.runId,r.bootstrapUuid].every(homeUuid)||![r.containerId,r.contractSha256].every(homeHash)||![r.clusterSystemIdentifier,r.databaseOid].every(homeDecimal)||!homeId(r.databaseName))homeReject('RESOURCE_MISMATCH');
 return r as unknown as HomeDatabaseResourceIdentity;
}
export function validateHomeHead(raw:unknown):HomeHead {
 const h=homeRecord(raw);homeExact(h,['revision','roundId','digest']);if(!homeDecimal(h.revision)||(h.revision==='0'?(h.roundId!==null||h.digest!==null):(!homeUuid(h.roundId)||!homeHash(h.digest))))homeReject();return h as unknown as HomeHead;
}
export function homeRoleAllows(role:HomeDbRole,rpc:HomeDbRpc):boolean {
 return rpc==='resource_identity'||({home_v1_fixture_writer:['fixture_apply','lookup_effect'],home_v1_capture_worker:['get_head','capture_round','lookup_effect','read_current_home'],home_v1_commit_worker:['get_head','commit_round','discard_stale_round','lookup_effect'],home_v1_internal_reader:['read_current_home']} as Record<HomeDbRole,string[]>)[role]?.includes(rpc)===true;
}
export function validateHomeDatabaseRequest(rpc:HomeDbRpc,raw:unknown):JsonRecord {
 if(!HOME_DATABASE_RPCS.includes(rpc))homeReject();const r=homeRecord(homeData(raw));
 const shapes:Partial<Record<HomeDbRpc,string[]>>={resource_identity:['resourceId'],get_head:['namespaceId','streamId'],read_current_home:['namespaceId','streamId'],capture_round:['namespaceId','effectKey','roundId','streamId','rankingCutoff','expectedHead','supersedesRoundId'],commit_round:['namespaceId','effectKey','roundId','expectedHead','backendGeneration','producerRevision','inputDigest','resultCanonical'],lookup_effect:['namespaceId','operation','effectKey','requestDigest','backendGeneration'],discard_stale_round:['namespaceId','effectKey','roundId','expectedHead','inputDigest','slotGeneration','reason']};
 if(rpc==='fixture_apply'){
  const s=r.action==='CREATE_NAMESPACE'?['action','resourceId','namespaceId','effectKey','initialStreamId']:r.action==='APPEND'?['action','namespaceId','effectKey','expectedInputRevision','observations','publicationBindings']:r.action==='ACTIVATE_PROFILE'?['action','namespaceId','effectKey','expectedInputRevision','streamId','profileManifestId']:null;
  if(!s)homeReject();homeExact(r,s);
  if(r.action==='APPEND'){
   if(!Array.isArray(r.observations)||r.observations.length>1000||!Array.isArray(r.publicationBindings)||r.publicationBindings.length>300)homeReject();
   for(const x of r.observations){const o=homeRecord(x);homeExact(o,['kind','entityId','revision','contentId','knownAt','payload']);if(!['ISSUE','CLAIM','SOURCE','CALENDAR','ASSESSMENT','GRANT'].includes(String(o.kind))||!homeId(o.entityId)||!homeDecimal(o.revision)||o.revision==='0'||!homeId(o.contentId))homeReject();homeTime(o.knownAt);homeRecord(o.payload);}
   for(const b of r.publicationBindings)validateHomePublicationBinding(b);
  }
 }else homeExact(r,shapes[rpc]!);
 for(const key of ['resourceId','namespaceId','effectKey','roundId','backendGeneration','profileManifestId'])if(Object.hasOwn(r,key)&&!homeUuid(r[key]))homeReject();
 for(const key of ['streamId','initialStreamId'])if(Object.hasOwn(r,key)&&!homeId(r[key]))homeReject();
 for(const key of ['producerRevision','slotGeneration','expectedInputRevision'])if(Object.hasOwn(r,key)&&!homeDecimal(r[key]))homeReject();
 for(const key of ['inputDigest','requestDigest'])if(Object.hasOwn(r,key)&&!homeHash(r[key]))homeReject();
 if(Object.hasOwn(r,'expectedHead'))validateHomeHead(r.expectedHead);
 if(Object.hasOwn(r,'supersedesRoundId')&&r.supersedesRoundId!==null&&!homeUuid(r.supersedesRoundId))homeReject();
 if(Object.hasOwn(r,'rankingCutoff')&&(homeTime(r.rankingCutoff)%300000!==0||(r.rankingCutoff as string).length!==24))homeReject();
 if(rpc==='commit_round'){if(typeof r.resultCanonical!=='string')homeReject();homeData(JSON.parse(r.resultCanonical));}
 if(rpc==='discard_stale_round'&&!['INPUT_STALE','HEAD_ADVANCED'].includes(String(r.reason)))homeReject();
 if(rpc==='lookup_effect'&&!['fixture_apply','capture_round','commit_round','discard_stale_round'].includes(String(r.operation)))homeReject();
 homeRequestCanonical(r);return r;
}

/** Fixed publication dependency graph, supplied as an explicit isolated fixture assertion.
 * Every present body/visibility path remains here even if the UI would filter that section.
 */
export const HOME_GRAPH_FIELDS=Object.freeze(['gradeClaimIds','macroClaimIds','keyIssueEvidenceIds','analysisEvidenceIds','impactEvidenceIds','riskEvidenceIds','scheduleEvidenceIds','scenarioEvidenceIds','articleImpactEvidenceIds','decisionClaimIds','decisionInputRevisionIds'] as const);
export function validateHomePublicationBinding(raw:unknown):JsonRecord {
 const b=homeRecord(raw);homeExact(b,['articleVersionId','publicationEffectKey','issueId','editorDraftRevision','issueRevisionBefore','issueRevisionAfter','requestDigest','contentDigest','evidenceVersion','assessmentVersion','firstPublishedAt','materialChangeAt','graph']);
 if(!homeUuid(b.articleVersionId)||!homeUuid(b.publicationEffectKey)||!homeId(b.issueId)||![b.editorDraftRevision,b.issueRevisionBefore,b.issueRevisionAfter].every(homeDecimal)||BigInt(b.issueRevisionAfter as string)!==BigInt(b.issueRevisionBefore as string)+1n||![b.requestDigest,b.contentDigest].every(homeHash)||!homeId(b.evidenceVersion)||!homeId(b.assessmentVersion))homeReject();
 if(homeTime(b.firstPublishedAt)>homeTime(b.materialChangeAt))homeReject();const g=homeRecord(b.graph);homeExact(g,HOME_GRAPH_FIELDS);for(const k of HOME_GRAPH_FIELDS)homeIds(g[k]);return b;
}
function validatePrincipal(raw:unknown):HomePrincipal {
 const p=homeRecord(raw);homeExact(p,['sessionUser','sessionUserOid','componentRole','resourceId','runId']);
 if(typeof p.sessionUser!=='string'||!/^h4_[a-f0-9]{32}_(fixture|capture|commit|read)$/.test(p.sessionUser)||!homeDecimal(p.sessionUserOid)||!HOME_DATABASE_ROLES.includes(p.componentRole as HomeDbRole)||!homeUuid(p.resourceId)||!homeUuid(p.runId))homeReject('PRINCIPAL_MISMATCH');
 const suffix=({home_v1_fixture_writer:'fixture',home_v1_capture_worker:'capture',home_v1_commit_worker:'commit',home_v1_internal_reader:'read'} as const)[p.componentRole as HomeDbRole];
 if(p.sessionUser!==`h4_${(p.runId as string).replaceAll('-','')}_${suffix}`)homeReject('PRINCIPAL_MISMATCH');return p as unknown as HomePrincipal;
}
export function validateHomeDatabaseReply(rpc:HomeDbRpc,raw:unknown):HomeDatabaseReply {
 const e=homeRecord(homeData(raw)),write=['fixture_apply','capture_round','commit_round','discard_stale_round'].includes(rpc);
 homeExact(e,[...Object.keys(HOME_DATABASE_FLAGS),'resourceId','namespaceId','backendGeneration','principal','serverCheckedAt','operation','result',...(write?['effectKey','requestDigest','status']:[])]);
 for(const k of Object.keys(HOME_DATABASE_FLAGS))if(e[k]!==HOME_DATABASE_FLAGS[k as keyof typeof HOME_DATABASE_FLAGS])homeReject('REPLY_MISMATCH');
 if(e.operation!==rpc||!homeUuid(e.resourceId)||(rpc==='resource_identity'?(e.namespaceId!==null||e.backendGeneration!==null):(!homeUuid(e.namespaceId)||!homeUuid(e.backendGeneration))))homeReject('REPLY_MISMATCH');
 const p=validatePrincipal(e.principal);if(p.resourceId!==e.resourceId)homeReject('PRINCIPAL_MISMATCH');homeTime(e.serverCheckedAt);
 if(write&&(!homeUuid(e.effectKey)||!homeHash(e.requestDigest)||!['APPLIED','REUSED'].includes(String(e.status))))homeReject('REPLY_MISMATCH');
 const r=homeRecord(e.result);
 if(rpc==='resource_identity'){homeExact(r,['resourceIdentity','postmasterStartedAt']);validateHomeDatabaseResource(r.resourceIdentity);homeTime(r.postmasterStartedAt);}
 if(rpc==='get_head'){homeExact(r,['head','activeProfileManifestId','inputRevision']);validateHomeHead(r.head);if(!homeUuid(r.activeProfileManifestId)||!homeDecimal(r.inputRevision))homeReject();}
 if(rpc==='fixture_apply'){homeExact(r,['inputRevision','observationsAdded','publicationBindingsAdded','profileManifestId']);if(!homeDecimal(r.inputRevision)||!Number.isSafeInteger(r.observationsAdded)||Number(r.observationsAdded)<0||!Number.isSafeInteger(r.publicationBindingsAdded)||Number(r.publicationBindingsAdded)<0||!homeUuid(r.profileManifestId))homeReject();}
 if(rpc==='capture_round'){
  homeExact(r,['roundId','streamId','rankingCutoff','expectedHead','producerRevision','inputDigest','slotGeneration','plannedGlobalRevision','plannedLocalRevision','segmentKey','snapshotCanonical']);
  if(!homeUuid(r.roundId)||!homeId(r.streamId)||!homeHash(r.inputDigest)||!homeId(r.segmentKey)||typeof r.snapshotCanonical!=='string')homeReject();
  homeTime(r.rankingCutoff);validateHomeHead(r.expectedHead);for(const k of ['producerRevision','slotGeneration','plannedGlobalRevision','plannedLocalRevision'])if(!homeDecimal(r[k]))homeReject();
 }
 if(rpc==='commit_round'||rpc==='discard_stale_round'){
  homeExact(r,['roundId','roundState','head','globalRevision','localRevision','slotGeneration','inputDigest','resultDigest','qualificationCheckedAt']);
  if(!homeUuid(r.roundId)||r.roundState!==(rpc==='commit_round'?'COMPLETED':'SUPERSEDED')||!homeHash(r.inputDigest))homeReject();validateHomeHead(r.head);
  for(const k of ['globalRevision','localRevision','slotGeneration'])if(!homeDecimal(r[k]))homeReject();
  if(rpc==='commit_round'){if(!homeHash(r.resultDigest))homeReject();homeTime(r.qualificationCheckedAt);}else if(r.resultDigest!==null||r.qualificationCheckedAt!==null)homeReject();
 }
 if(rpc==='lookup_effect'){
  if(r.state==='UNKNOWN')homeExact(r,['state']);else if(r.state==='APPLIED'){homeExact(r,['state','receipt']);const receipt=homeRecord(r.receipt);if(!['fixture_apply','capture_round','commit_round','discard_stale_round'].includes(String(receipt.operation)))homeReject();validateHomeDatabaseReply(receipt.operation as HomeDbRpc,receipt);}else homeReject();
 }
 if(rpc==='read_current_home'){
  homeExact(r,['state','checkedAt','rankingCutoff','snapshotId','sourceCutoff','marketBasis','targetKrTradingDay','lanes']);if(!['FRESH','DELAYED','CALCULATING'].includes(String(r.state)))homeReject();homeTime(r.checkedAt);homeTime(r.rankingCutoff);
  const lanes=homeRecord(r.lanes);homeExact(lanes,['A','B','C']);const seen=new Set<string>();
  for(const [lane,max] of [['A',2],['B',3],['C',20]] as const){const rows=lanes[lane];if(!Array.isArray(rows)||rows.length>max)homeReject();for(const x of rows){const row=homeRecord(x);homeExact(row,['issueId','articleVersionId']);if(!homeId(row.issueId)||!homeUuid(row.articleVersionId)||seen.has(row.issueId))homeReject();seen.add(row.issueId);}}
  if(r.state==='CALCULATING'){if(r.snapshotId!==null||r.sourceCutoff!==null||r.marketBasis!==null||r.targetKrTradingDay!==null||seen.size!==0)homeReject();}
  else {if(!homeUuid(r.snapshotId)||!['KR_COMBINED','FOREIGN_US'].includes(String(r.marketBasis))||typeof r.targetKrTradingDay!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(r.targetKrTradingDay))homeReject();homeTime(r.sourceCutoff);}
 }
 return e as unknown as HomeDatabaseReply;
}
