/** Node-only trusted composition of the existing pure engines. No database/provider/clock IO. */
interface HomeHash {update(value:string,encoding?:string):HomeHash;digest(encoding:'hex'):string;}
declare const process:{getBuiltinModule(name:'node:crypto'):{createHash(algorithm:'sha256'):HomeHash}};
const {createHash}=process.getBuiltinModule('node:crypto');
import {draftIssuePriority,PRIORITY_POLICY,type PriorityInput,type PriorityIssue,type PriorityClaim} from '../../../packages/domain/src/issue-priority.ts';
import {draftHomeRanking,HOME_RANKING_POLICY,type RankingState} from '../../../packages/domain/src/home-ranking.ts';
import {deriveHomeContext,SNAPSHOT_POLICY,type HomeContextInput} from '../../../packages/domain/src/home-snapshot.ts';
import {pipelineCanonical} from '../../../packages/contracts/src/pipeline.ts';
import {HOME_DATABASE_SCHEMA,HOME_DATABASE_PROFILES,HOME_GRAPH_FIELDS,homeData,homeRecord,homeExact,homeReject,homeUuid,homeHash,homeId,homeTime,homeSafeRevision,validateHomePublicationBinding,validateHomeDatabaseReply,type HomeEvaluatedRound,type HomeCaptureResult,type JsonRecord} from './database-contracts.ts';

export interface OwnedHomeDatabaseEvaluator {readonly kind:'OWNED_HOME_DATABASE_EVALUATOR';}
const owned=new WeakSet<object>();
const sha=(v:string)=>createHash('sha256').update(v,'utf8').digest('hex');
export function createHomeDatabaseEvaluator():OwnedHomeDatabaseEvaluator {const v=Object.freeze({kind:'OWNED_HOME_DATABASE_EVALUATOR' as const});owned.add(v);return v;}
export function isOwnedHomeDatabaseEvaluator(value:unknown):boolean {return !!value&&typeof value==='object'&&owned.has(value);}
/** SQL origin comes from the MAIN-owned transport/coordinator, never from this standalone function. */
export function evaluateHomeDatabaseRound(evaluator:unknown,captured:unknown):HomeEvaluatedRound {
 if(!isOwnedHomeDatabaseEvaluator(evaluator))homeReject('EVALUATOR_NOT_OWNED');
 const envelope=validateHomeDatabaseReply('capture_round',captured),capture=envelope.result as unknown as HomeCaptureResult;
 if(sha(capture.snapshotCanonical)!==capture.inputDigest)homeReject('SNAPSHOT_DIGEST_MISMATCH');
 let parsed:unknown;try{parsed=JSON.parse(capture.snapshotCanonical);}catch{homeReject('SNAPSHOT_INVALID');}
 const snapshot=homeRecord(homeData(parsed));homeExact(snapshot,['inputBatch','previousCompleted']);
 const input=homeRecord(snapshot.inputBatch);homeExact(input,['profileManifestId','profileId','nonpriceScaleVersion','catalogVersion','evaluationSetVersion','rankingCutoff','context','claims','issues','sectors','bindings']);
 const profile=HOME_DATABASE_PROFILES.find(p=>p.manifestId===input.profileManifestId);
 if(!profile||input.profileId!==profile.profileId||input.nonpriceScaleVersion!==profile.nonpriceScaleVersion||input.catalogVersion!==profile.catalogVersion||input.evaluationSetVersion!==profile.evaluationSetVersion||input.rankingCutoff!==capture.rankingCutoff)homeReject('POLICY_STALE');
 const context=homeRecord(input.context);homeExact(context,['mode','sampleKind','cutoff','policyVersion','catalogVersion','comparisonSetVersion','evaluationSetVersion','signals','calendar']);
 const off=homeRecord(context.signals);homeExact(off,['T','M','P']);
 if(off.T!==false||off.M!==false||off.P!==false||context.mode!=='LOCAL_SYNTHETIC'||context.sampleKind!=='SYNTHETIC'||context.policyVersion!==SNAPSHOT_POLICY||context.cutoff!==capture.rankingCutoff||context.catalogVersion!==profile.catalogVersion||context.evaluationSetVersion!==profile.evaluationSetVersion||context.comparisonSetVersion!==profile.comparisonSetVersion)homeReject('POLICY_STALE');
 if(deriveHomeContext(context).status!=='DRAFT_SYNTHETIC')homeReject('CONTEXT_UNAVAILABLE');
 if(!Array.isArray(input.claims)||!Array.isArray(input.issues)||input.issues.length>300||input.claims.length>300||!Array.isArray(input.sectors)||!Array.isArray(input.bindings))homeReject('INPUT_SET_TOO_LARGE');
 const claims=input.claims as unknown as PriorityClaim[],issues=input.issues as unknown as PriorityIssue[];
 for(const c of input.claims){const r=homeRecord(c);homeExact(r,['sampleKind','version','claimId','originId','kind','knownAt','validUntil','verifiedAt','status']);}
 for(const i of input.issues){const r=homeRecord(i);homeExact(r,['issueId','storyId','version','assessmentVersion','sampleKind','inputKnownAt','publishedAt','materialChangeAt','lastVerifiedAt','evidenceValidUntil',...(Object.hasOwn(r,'scheduledEndAt')?['scheduledEndAt']:[]),'publicationState','contentClass','impactState','direction','scope','assessment',...(Object.hasOwn(r,'macroGate')?['macroGate']:[])]);}
 const bindings=new Map<string,JsonRecord>();
 for(const raw of input.bindings){const b=validateHomePublicationBinding(raw);if(bindings.has(b.issueId as string))homeReject('BINDING_CONFLICT');bindings.set(b.issueId as string,b);}
 if(bindings.size!==issues.length||issues.some(i=>!bindings.has(i.issueId)))homeReject('BINDING_MISSING');
 for(const i of issues){const b=bindings.get(i.issueId)!;if(i.version!==b.articleVersionId||i.assessmentVersion!==b.assessmentVersion||i.publishedAt!==b.firstPublishedAt||i.materialChangeAt!==b.materialChangeAt)homeReject('BINDING_CONFLICT');
  const graph=homeRecord(b.graph),claimById=new Map(claims.map(c=>[c.claimId,c])),at=homeTime(capture.rankingCutoff);
  for(const key of HOME_GRAPH_FIELDS){if(key==='decisionInputRevisionIds')continue;for(const ref of graph[key] as string[]){const c=claimById.get(ref);if(!c)homeReject('BINDING_MISSING');if(c.status!=='VERIFIED'||homeTime(c.knownAt)>at||homeTime(c.verifiedAt)>at||homeTime(c.validUntil)<=at)homeReject('QUALIFICATION_HOLD');}}
  const required=new Set([...Object.values(i.assessment).flatMap(g=>[...g.claimIds]),...(i.macroGate?.claimIds??[])]);
  for(const ref of required)if(!(graph.gradeClaimIds as string[]).includes(ref)&&!(graph.macroClaimIds as string[]).includes(ref))homeReject('BINDING_MISSING');
 }
 const priority:PriorityInput={mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:capture.rankingCutoff,policyVersion:PRIORITY_POLICY,catalogVersion:profile.catalogVersion,evaluationSetVersion:profile.evaluationSetVersion,claims,issues};
 const preflight=draftIssuePriority(priority);if(preflight.status!=='DRAFT_SYNTHETIC'||preflight.excluded.length)homeReject('QUALIFICATION_HOLD');
 let previous:RankingState|null=null,previousDigest:string|null=null;
 if(capture.expectedHead.revision==='0'){if(snapshot.previousCompleted!==null)homeReject('PRIOR_STATE_MISMATCH');}
 else {
  const p=homeRecord(snapshot.previousCompleted);homeExact(p,['roundId','digest','globalRevision','localRevision','segmentKey','rankingState']);
  if(p.roundId!==capture.expectedHead.roundId||p.digest!==capture.expectedHead.digest||p.globalRevision!==capture.expectedHead.revision||!homeUuid(p.roundId)||!homeHash(p.digest)||!homeId(p.segmentKey))homeReject('PRIOR_STATE_MISMATCH');
  homeSafeRevision(p.globalRevision);homeSafeRevision(p.localRevision);previous=p.rankingState as unknown as RankingState;previousDigest=p.digest as string;
 }
 if(homeSafeRevision(capture.plannedGlobalRevision)!==homeSafeRevision(capture.expectedHead.revision)+1||homeSafeRevision(capture.plannedLocalRevision)<1)homeReject('PRIOR_STATE_MISMATCH');
 // DB input has required off-all signals. The unchanged engine explicitly accepts Omit<...,signals>.
 const {signals:_checkedOff,...engineContext}=context;
 const ranking=draftHomeRanking({mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',policyVersion:HOME_RANKING_POLICY,
  context:{...engineContext,comparisonSetVersion:'k1-compare-'+sha(pipelineCanonical([profile.comparisonSetVersion,profile.profileId,profile.nonpriceScaleVersion]))},
  priority,sectors:input.sectors,previous,highComparisonVersion:'k1-high-'+sha(pipelineCanonical([profile.profileId,profile.nonpriceScaleVersion]))});
 if(ranking.status!=='DRAFT_SYNTHETIC'||!ranking.state||!ranking.context)homeReject('RANKING_REJECTED');
 if(Object.values(ranking.state.contextInput.signals).some(v=>v!==false))homeReject('POLICY_STALE');
 const lanes=Object.fromEntries((['A','B','C'] as const).map(lane=>[lane,ranking.lanes[lane].map(card=>{
  const b=bindings.get(card.issueId)!;return {issueId:card.issueId,storyId:card.storyId,articleVersionId:b.articleVersionId,score:card.score,tier:card.tier,assessmentVersion:b.assessmentVersion,evidenceVersion:b.evidenceVersion};
 })]));
 const result={schema:'HOME_DB_BOUND_V1_RESULT',namespaceId:envelope.namespaceId,roundId:capture.roundId,streamId:capture.streamId,rankingCutoff:capture.rankingCutoff,profileManifestId:profile.manifestId,profileId:profile.profileId,nonpriceScaleVersion:profile.nonpriceScaleVersion,plannedGlobalRevision:capture.plannedGlobalRevision,plannedLocalRevision:capture.plannedLocalRevision,segmentKey:capture.segmentKey,previousDigest,context:ranking.context,lanes,rankingState:ranking.state};
 const resultCanonical=pipelineCanonical(result);if(resultCanonical.length>65536||new TextEncoder().encode(resultCanonical).length>65536)homeReject('RESULT_BUDGET');homeData(result);
 return {schema:HOME_DATABASE_SCHEMA,namespaceId:envelope.namespaceId!,roundId:capture.roundId,backendGeneration:envelope.backendGeneration!,inputDigest:capture.inputDigest,previousDigest,plannedGlobalRevision:capture.plannedGlobalRevision,plannedLocalRevision:capture.plannedLocalRevision,segmentKey:capture.segmentKey,resultCanonical,resultDigest:sha(resultCanonical)};
}
