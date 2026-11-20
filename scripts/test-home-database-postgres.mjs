/** HOME_DB_BOUND_V1 test-only acceptance library. No discovery, Docker, SQL install, credentials or default DB.
 * MAIN provides a NEW independently owned HOME resource and separate non-super LOGIN connections.
 * Running this library is MAIN's responsibility. This file is not a production worker entrypoint.
 */
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {HOME_DATABASE_FLAGS,HOME_DATABASE_PROFILE,HOME_DATABASE_ROLES,HOME_DATABASE_RPCS,HOME_GRAPH_FIELDS,homeIsProxy,homeRequestCanonical,homeRoleAllows,validateHomeDatabaseRequest,validateHomeDatabaseReply,validateHomeDatabaseResource} from '../workers/home-ranking/src/database-contracts.ts';
import {createHomeDatabaseEvaluator,evaluateHomeDatabaseRound} from '../workers/home-ranking/src/database-evaluator.ts';
import {createHomeDatabaseAdapter,createHomeDatabaseCoordinator} from '../workers/home-ranking/src/database-adapter.ts';
import {selectPipelineSources} from '../packages/contracts/src/pipeline-semantics.ts';

const P=HOME_DATABASE_PROFILE,sha=s=>createHash('sha256').update(s,'utf8').digest('hex'),clone=v=>JSON.parse(JSON.stringify(v));
const stamp=n=>new Date(n).toISOString(),floor=s=>stamp(Math.floor(Date.parse(s)/300000)*300000);
const literal=v=>`'${JSON.stringify(v).replaceAll("'","''")}'::jsonb`;
const allowedErrors=new Set(['FORBIDDEN','ISOLATION_NOT_SUPPORTED','HEAD_CONFLICT','SLOT_CONFLICT','INPUT_STALE','QUALIFICATION_HOLD','DEPENDENCY_GRAPH_CHANGED','BINDING_CONFLICT','BINDING_MISSING','CLAIM_MISSING','SOURCE_IDENTITY_CONFLICT','INVALID_REQUEST','JSON_BUDGET','RESULT_BUDGET','RESULT_INVALID','EFFECT_CONFLICT','GENERATION_CONFLICT','NOT_STALE','ROUND_NOT_PENDING','CUTOFF_NOT_CURRENT','STALE_CUTOFF','FIRST_PUBLICATION_CHANGED']);
function code(error){if(error?.code==='ERR_ASSERTION')return 'ASSERTION_FAILED';for(const key of ['code','message']){const d=error&&Object.getOwnPropertyDescriptor(error,key);if(d&&'value'in d&&allowedErrors.has(d.value))return d.value;}return 'UNEXPECTED_SQL_ERROR';}
function errorEvidence(error){const scalar=v=>typeof v==='boolean'||typeof v==='number'?v:typeof v==='string'&&/^[A-Za-z0-9_.:-]{0,160}$/.test(v)?v:null;return {code:code(error),sqlState:typeof error?.sqlState==='string'&&/^[0-9A-Z]{5}$/.test(error.sqlState)?error.sqlState:null,...(error?.code==='ERR_ASSERTION'?{assertion:{operator:scalar(error.operator),actual:scalar(error.actual),expected:scalar(error.expected)}}:{})};}
const watch=promise=>{promise.catch(()=>{});return promise;};
class Hold extends Error {constructor(reason){super(reason);this.reason=reason;}}
function parse(text){assert.equal(typeof text,'string');return JSON.parse(text.trim());}
function sql(rpc,request){assert(HOME_DATABASE_RPCS.includes(rpc));return `SELECT home_bound_v1.${rpc}(${literal(validateHomeDatabaseRequest(rpc,request))})::text;`;}
function requestHash(identity,generation,operation,request){return sha(homeRequestCanonical({schema:'HOME_DB_BOUND_V1_REQUEST',resourceId:identity.resourceId,namespaceId:request.namespaceId,backendGeneration:request.action==='CREATE_NAMESPACE'?null:generation,operation,request}));}
function fixture(cutoff,{expiry=null,bodyField=null,closeCurrentKoreanDay=false}={}){
 const at=Date.parse(cutoff),known=stamp(at),published=stamp(at-1800000),verified=stamp(at-60000),until=expiry??stamp(at+7200000);
 const days=Array.from({length:6},(_,n)=>({date:stamp(at-86400000+n*86400000).slice(0,10),state:'OPEN'}));
 if(closeCurrentKoreanDay){
  // Explicit synthetic holiday assertion for the AGE test only, not an actual exchange calendar.
  const koreaDate=stamp(at+9*3600000).slice(0,10),today=days.find(d=>d.date===koreaDate);
  assert(today);today.state='CLOSED';assert(days.some(d=>d.date>koreaDate&&d.state==='OPEN'));
 }
 const calendar={calendarVersion:'calendar-p4-fixture',evidenceId:'calendar-p4-evidence',knownAt:stamp(at-86400000),validUntil:stamp(at+4*86400000),coverageStart:days[0].date,coverageEnd:days.at(-1).date,days};
 const sources=[],claims=[],issues=[],bindings=[],observations=[];
 const observe=(kind,entityId,payload,revision='1')=>({kind,entityId,revision,contentId:`content-${kind}-${entityId}-${revision}`,knownAt:known,payload});
 const count=bodyField?3:2;
 for(let n=0;n<count;n++){
  const source={contractVersion:'JUDOJU_PIPELINE_K1',sampleKind:'SYNTHETIC',policyVersion:'fixture-source-policy',catalogVersion:P.catalogVersion,sourcePolicyVersion:P.sourcePolicyVersion,sourceDocumentId:`document-${n}`,revisionId:`source-revision-${n}`,sourceId:`source-${n}`,endpointId:`endpoint-${n}`,publisherId:`publisher-${n}`,originId:`origin-${n}`,independenceGroupId:`group-${n}`,canonicalUrl:`https://source-${n}.invalid/item`,nativeId:`native-${n}`,collectedAt:stamp(at-120000),publishedAt:stamp(at-300000),updatedAt:null,timeQuality:'KNOWN',contentHash:sha(`SYNTHETIC source ${n}`),title:`SYNTHETIC source ${n}`,lead:'SYNTHETIC fixture metadata only',bodyRef:`fixture:/home-db/source-${n}`,permissionVersion:'fixture-permission-v1'};
  const sourcePayload={source,deliveryRef:`delivery-${n}`,bodyHash:source.contentHash,sourceDigest:sha(homeRequestCanonical(source)),grantId:'fixture-grant',grantGeneration:'1',status:'VALID',expiresAt:until};sources.push(sourcePayload);
  const claim={sampleKind:'SYNTHETIC',version:'claim-v1',claimId:`claim-${n}`,originId:source.originId,kind:'FILING',knownAt:source.collectedAt,validUntil:until,verifiedAt:verified,status:'VERIFIED'};
  claims.push({claim,sourceRevisionId:source.revisionId,evidenceVersion:'evidence-v1',status:'VALID'});
 }
 observations.push(observe('GRANT','fixture-grant',{authority:'ISOLATED_FIXTURE',issuer:'fixture-issuer',evidenceRef:'fixture-rights-evidence',generation:'1',purposes:['STORAGE','ANALYSIS','DISPLAY'],artifactSourceIds:sources.map(s=>s.source.sourceId),knownAt:stamp(at-3600000),expiresAt:stamp(at+7200000),revokedAt:null}));
 sources.forEach(s=>observations.push(observe('SOURCE',s.source.sourceDocumentId,s)));claims.forEach(c=>observations.push(observe('CLAIM',c.claim.claimId,c)));observations.push(observe('CALENDAR','fixture-calendar',calendar));
 for(let n=0;n<2;n++){
  const issueId=`issue-${n}`,articleVersionId=randomUUID(),assessmentVersion='assessment-v1',evidenceVersion='evidence-v1';
  const priority={issueId,storyId:`story-${n}`,version:articleVersionId,assessmentVersion,sampleKind:'SYNTHETIC',inputKnownAt:verified,publishedAt:published,materialChangeAt:published,lastVerifiedAt:verified,evidenceValidUntil:until,scheduledEndAt:null,publicationState:'PUBLISHED',contentClass:'SECTOR_EVENT',impactState:'ACTIVE',direction:'POSITIVE',scope:'SECTOR',assessment:Object.fromEntries(['transmission','breadth','magnitude','persistence'].map(k=>[k,{grade:4,claimIds:[`claim-${n}`]}])),macroGate:null};
  const graph=Object.fromEntries(HOME_GRAPH_FIELDS.map(k=>[k,k==='macroClaimIds'?[]:k==='decisionInputRevisionIds'?[sources[n].source.revisionId]:[`claim-${n}`]]));
  if(n===0&&bodyField){graph[bodyField]=[...new Set([...graph[bodyField],'claim-2'])];graph.decisionClaimIds.push('claim-2');graph.decisionInputRevisionIds.push(sources[2].source.revisionId);}
  const binding={articleVersionId,publicationEffectKey:randomUUID(),issueId,editorDraftRevision:'7',issueRevisionBefore:'0',issueRevisionAfter:'1',requestDigest:sha(`fixture-request-${issueId}`),contentDigest:sha(`SYNTHETIC article ${issueId}`),evidenceVersion,assessmentVersion,firstPublishedAt:published,materialChangeAt:published,graph};bindings.push(binding);
  const value={priority,primarySectorId:'sector-fixture',articleVersionId,evidenceVersion,assessmentVersion,publicationState:'PUBLISHED',dependencyGraph:graph};issues.push(value);
  observations.push(observe('ASSESSMENT',issueId,{issueId,assessmentVersion,evidenceVersion,knownAt:verified,verifiedAt:verified,validUntil:until,status:'ACTIVE'}),observe('ISSUE',issueId,value));
 }
 return {cutoff,calendar,sources,claims,issues,bindings,observations,observe};
}

/** Exact seven-field MAIN test context. execute resolves plain psql -X -qAt text or rejects a sanitized SQL error.
 * No product caller may use openSession's explicit transaction/test capability.
 */
export async function runHomeDatabasePostgresAcceptance(context){
 assert(context&&typeof context==='object'&&!homeIsProxy(context));
 const keys=['resourceIdentity','outputDirectory','transport','openSession','inspectResource','observeState','restartServer'];assert.deepEqual(Object.keys(context).sort(),keys.sort());
 for(const key of keys){const d=Object.getOwnPropertyDescriptor(context,key);assert(d&&'value'in d&&d.enumerable);}
 const identity=validateHomeDatabaseResource(context.resourceIdentity);for(const key of ['transport','openSession','inspectResource','observeState'])assert.equal(typeof context[key],'function');assert(context.restartServer===null||typeof context.restartServer==='function');
 const output=resolve(context.outputDirectory);assert(/[/\\]outputs[/\\]development-stages[/\\]/.test(output));
 const cases=[],sessions=new Set(),evaluator=createHomeDatabaseEvaluator();
 const rpc=async(role,operation,request)=>{
  const value=validateHomeDatabaseReply(operation,await context.transport({role,rpc:operation,args:{p_request:validateHomeDatabaseRequest(operation,request)}}));
  assert.equal(value.resourceId,identity.resourceId);assert.equal(value.principal.runId,identity.runId);assert.equal(value.principal.componentRole,role);return value;
 };
 const resourceNow=()=>rpc('home_v1_capture_worker','resource_identity',{resourceId:identity.resourceId});
 const observe=(s,pids=[])=>context.observeState({namespaceId:s.namespaceId,backendPids:pids});
 async function setup(options={}){
  const now=await resourceNow(),cutoff=floor(now.serverCheckedAt),namespaceId=randomUUID(),streamId='home-p4-isolated';
  const create={action:'CREATE_NAMESPACE',resourceId:identity.resourceId,namespaceId,effectKey:randomUUID(),initialStreamId:streamId};
  const created=await rpc('home_v1_fixture_writer','fixture_apply',create),data=fixture(cutoff,options);
  const append={action:'APPEND',namespaceId,effectKey:randomUUID(),expectedInputRevision:'0',observations:data.observations,publicationBindings:data.bindings};
  await rpc('home_v1_fixture_writer','fixture_apply',append);
  return {namespaceId,streamId,generation:created.backendGeneration,data,append,baseCount:data.observations.length};
 }
 async function prepare(s){
  const head=await rpc('home_v1_capture_worker','get_head',{namespaceId:s.namespaceId,streamId:s.streamId}),now=await resourceNow();
  const request={namespaceId:s.namespaceId,effectKey:randomUUID(),roundId:randomUUID(),streamId:s.streamId,rankingCutoff:floor(now.serverCheckedAt),expectedHead:head.result.head,supersedesRoundId:null};
  const capture=await rpc('home_v1_capture_worker','capture_round',request),evaluated=evaluateHomeDatabaseRound(evaluator,capture);
  const commit={namespaceId:s.namespaceId,effectKey:randomUUID(),roundId:request.roundId,expectedHead:request.expectedHead,backendGeneration:s.generation,producerRevision:capture.result.producerRevision,inputDigest:capture.result.inputDigest,resultCanonical:evaluated.resultCanonical};
  return {capture,evaluated,captureRequest:request,commit};
 }
 const commit=p=>rpc('home_v1_commit_worker','commit_round',p.commit);
 const read=s=>rpc('home_v1_internal_reader','read_current_home',{namespaceId:s.namespaceId,streamId:s.streamId});
 async function append(s,observations,bindings=[],expected='1'){
  return rpc('home_v1_fixture_writer','fixture_apply',{action:'APPEND',namespaceId:s.namespaceId,effectKey:randomUUID(),expectedInputRevision:expected,observations,publicationBindings:bindings});
 }
 const retract=s=>s.data.observe('CLAIM','claim-0',{...clone(s.data.claims[0]),claim:{...clone(s.data.claims[0].claim),status:'RETRACTED'}},'2');
 async function open(role){
  const session=await context.openSession(role);sessions.add(session);assert.equal(typeof session.execute,'function');
  const live=parse(await session.execute("SELECT jsonb_build_object('sessionUser',session_user,'currentUser',current_user,'backendPid',pg_backend_pid(),'isolation',current_setting('transaction_isolation'))::text;"));
  assert.equal(live.sessionUser,session.principal.sessionUser);assert.equal(live.currentUser,live.sessionUser);assert.equal(live.backendPid,session.backendPid);assert.equal(session.principal.componentRole,role);assert.equal(session.principal.resourceId,identity.resourceId);assert.equal(session.principal.runId,identity.runId);
  assert.match(live.sessionUser,new RegExp(`^h4_${identity.runId.replaceAll('-','')}_`));return session;
 }
 async function close(session){if(!session)return;try{await session.execute('ROLLBACK;');}catch{}try{await session.close();}finally{sessions.delete(session);}}
 async function raw(session,operation,request){return validateHomeDatabaseReply(operation,parse(await session.execute(sql(operation,request))));}
 async function rejected(work,allowed){try{await work();assert.fail('EXPECTED_REJECTION');}catch(error){if(error?.code==='ERR_ASSERTION')throw error;const evidence=errorEvidence(error);assert(allowed.includes(evidence.code),`unexpected sanitized code ${evidence.code}`);return evidence;}}
 async function waitFor(label,check,timeoutMs=12000){const deadline=Date.now()+timeoutMs;for(;;){const v=await check();if(v)return v;if(Date.now()>=deadline)throw new Hold(label);await delay(25);}}
 async function blocked(s,waiter,holder){return waitFor('ACTUAL_BLOCKING_NOT_OBSERVED',async()=>{const state=await observe(s,[waiter.backendPid,holder.backendPid]);return state.locks?.some(l=>l.backendPid===waiter.backendPid&&l.blockingPids?.includes(holder.backendPid))?state:null;});}
 async function expired(s,at){return waitFor('REAL_EXPIRY_NOT_REACHED',async()=>{const state=await observe(s);return Date.parse(state.observedAt)>Date.parse(at)?state:null;},20000);}
 async function checkpoint(detail={}){await mkdir(output,{recursive:true});await writeFile(join(output,'home-database-postgres-progress.json'),JSON.stringify({schema:'HOME_DB_BOUND_V1_ACCEPTANCE_PROGRESS',complete:false,cases,...detail},null,2)+'\n','utf8');}
 async function runCase(name,work){try{const detail=await work();cases.push({name,status:'PASS',evidenceKind:'PG_TWO_SESSION_REAL_CLOCK',...detail});}catch(error){const timing=code(error)==='CUTOFF_NOT_CURRENT';cases.push({name,status:error instanceof Hold||timing?'HOLD':'FAIL',evidenceKind:'PG_TWO_SESSION_REAL_CLOCK',...(error instanceof Hold?{reason:error.reason}:timing?{reason:'ACTUAL_CUTOFF_CHANGED_DURING_CASE'}:errorEvidence(error))});}await checkpoint();}
 async function waitDbAt(s,target,label){const deadline=Date.now()+20*60000;let lastProgress=0;for(;;){const state=await observe(s);if(Date.parse(state.observedAt)>=target)return state;if(Date.now()>deadline)throw new Hold('ACTUAL_DB_CLOCK_TARGET_NOT_REACHED');if(Date.now()-lastProgress>5000){lastProgress=Date.now();await checkpoint({waitingFor:label,namespaceId:s.namespaceId,targetDbTime:stamp(target),lastObservedDbTime:state.observedAt});}await delay(300);}}
 const calculating=reply=>{assert.equal(reply.result.state,'CALCULATING');assert.equal(reply.result.snapshotId,null);assert.deepEqual(reply.result.lanes,{A:[],B:[],C:[]});};
 const counts=(state,expected)=>{for(const [k,v]of Object.entries(expected))assert.equal(state.counts[k],v,k);};
 let resourceProof=null;
 try{
  const inspected=await context.inspectResource();assert.equal(inspected.status,'VERIFIED_TEST_ONLY');assert.deepEqual(validateHomeDatabaseResource(inspected.resourceIdentity??inspected.identity),identity);assert.equal(inspected.containerId,identity.containerId);assert.equal(inspected.imageId,identity.imageId);assert.equal(inspected.networkMode,'none');assert.deepEqual(inspected.publishedPorts,[]);assert.equal(inspected.readOnlyRoot,true);assert(inspected.mounts.length>0&&inspected.mounts.every(m=>m.type==='tmpfs'));assert.equal(inspected.clusterSystemIdentifier,identity.clusterSystemIdentifier);assert.equal(String(inspected.databaseOid),identity.databaseOid);assert.equal(inspected.databaseName,identity.databaseName);assert.equal(inspected.bootstrapUuid,identity.bootstrapUuid);assert.equal(inspected.tableCount,12);assert.equal(inspected.principals.length,4);assert(inspected.acl.length>0);
  for(const kind of ['UNREGISTERED_LOGIN','UNREGISTERED_TWO_MEMBERSHIPS','BOOTSTRAP_SUPERUSER']){const c=inspected.principalIsolationCases.find(x=>x.kind===kind);assert(c&&c.status==='PASS'&&c.code==='FORBIDDEN'&&c.sqlState==='42501');if(kind==='UNREGISTERED_TWO_MEMBERSHIPS')assert.equal(c.membershipBranchIndependentlyProven,false);}
  resourceProof={resourceIdentity:identity,status:inspected.status,tableCount:12,principalCount:4,aclObservationCount:inspected.acl.length,principalIsolationCases:inspected.principalIsolationCases.map(x=>({kind:x.kind,status:x.status,code:x.code,sqlState:x.sqlState,membershipBranchIndependentlyProven:x.membershipBranchIndependentlyProven??null}))};
  await runCase('SQL_POLICY_FIXED_TIME_15_MINUTE_BOUNDARIES',async()=>{
   const actual=inspected.sqlPolicyFixedTimeCases;assert(Array.isArray(actual));for(const [name,expected]of [['AT_15_MINUTES',true],['AFTER_1_MICROSECOND',false],['AFTER_1_MILLISECOND',false]]){const item=actual.find(x=>x.case===name);assert(item&&item.kind==='SQL_POLICY_FIXED_TIME');assert.equal(item.eligible,expected);assert.equal(typeof item.cutoff,'string');assert.equal(typeof item.checkedAt,'string');}
   return {evidenceKind:'SQL_POLICY_FIXED_TIME',cases:actual,actualCurrentRpcTimeProven:false};
  });
  await runCase('OWNED_MAIN_FLOW_AND_EXACT_EFFECT',async()=>{
   const s=await setup(),adapter=createHomeDatabaseAdapter({namespaceId:s.namespaceId,streamId:s.streamId,expectedResourceIdentity:identity,transport:context.transport}),coordinator=createHomeDatabaseCoordinator({adapter,evaluator});
   const head=await coordinator.getHead(),now=await resourceNow(),request={namespaceId:s.namespaceId,effectKey:randomUUID(),roundId:randomUUID(),streamId:s.streamId,rankingCutoff:floor(now.serverCheckedAt),expectedHead:head.result.head,supersedesRoundId:null};
   const handle=await coordinator.captureEvaluate(request),effect=randomUUID(),receipt=await coordinator.commitPrepared(handle,effect),before=await observe(s),reuse=await coordinator.commitPrepared(handle,effect),after=await observe(s);
   assert.equal(receipt.status,'APPLIED');assert.equal(reuse.status,'REUSED');assert.equal(receipt.result.qualificationCheckedAt,reuse.result.qualificationCheckedAt);assert.equal(receipt.commitTimeQualificationProven,false);assert.deepEqual(after.counts,before.counts);counts(after,{observations:10,issueIdentities:2,publicationBindings:2,rounds:1,entries:2,captureEffects:1,commitEffects:1});assert.equal((await coordinator.readCurrentHome()).result.state,'FRESH');
   return {namespaceId:s.namespaceId,head:after.head,counts:after.counts,qualificationCheckedAt:receipt.result.qualificationCheckedAt,ownedFactoryFlow:true};
  });
  await runCase('SAME_ROUND_TWO_COMMIT_EFFECTS_HEAD_CAS',async()=>{
   const s=await setup(),p=await prepare(s),a=await open('home_v1_commit_worker'),b=await open('home_v1_commit_worker');
   try{await a.execute('BEGIN;');await raw(a,'commit_round',p.commit);await b.execute('BEGIN;');const losing=watch(rejected(()=>raw(b,'commit_round',{...p.commit,effectKey:randomUUID()}),['HEAD_CONFLICT']));await blocked(s,b,a);await a.execute('COMMIT;');const rejection=await losing;await b.execute('ROLLBACK;');const state=await observe(s);counts(state,{rounds:1,entries:2,commitEffects:1});assert.equal(state.head.revision,'1');return {namespaceId:s.namespaceId,counts:state.counts,rejection};}finally{await close(a);await close(b);}
  });
  await runCase('ONE_CAPTURED_SLOT_PUBLIC_RPCS',async()=>{
   const s=await setup(),h=await rpc('home_v1_capture_worker','get_head',{namespaceId:s.namespaceId,streamId:s.streamId}),now=await resourceNow(),request={namespaceId:s.namespaceId,effectKey:randomUUID(),roundId:randomUUID(),streamId:s.streamId,rankingCutoff:floor(now.serverCheckedAt),expectedHead:h.result.head,supersedesRoundId:null},a=await open('home_v1_capture_worker'),b=await open('home_v1_capture_worker');
   try{await a.execute('BEGIN;');await raw(a,'capture_round',request);await b.execute('BEGIN;');const waiting=rejected(()=>raw(b,'capture_round',{...request,roundId:randomUUID(),effectKey:randomUUID()}),['SLOT_CONFLICT']);waiting.catch(()=>{});await blocked(s,b,a);await a.execute('COMMIT;');await waiting;await b.execute('ROLLBACK;');const after=await observe(s);counts(after,{rounds:1,captureEffects:1,entries:0});assert.equal(after.head.revision,'0');return {namespaceId:s.namespaceId,counts:after.counts,backendPids:[a.backendPid,b.backendPid]};}finally{await close(a);await close(b);}
  });
  await runCase('CLAIM_WRITER_BEFORE_COMMIT_FRESH_AFTER_WAIT',async()=>{
   const s=await setup(),p=await prepare(s),a=await open('home_v1_fixture_writer'),b=await open('home_v1_commit_worker');
   try{await a.execute('BEGIN;');await raw(a,'fixture_apply',{action:'APPEND',namespaceId:s.namespaceId,effectKey:randomUUID(),expectedInputRevision:'1',observations:[retract(s)],publicationBindings:[]});await b.execute('BEGIN;');const losing=watch(rejected(()=>raw(b,'commit_round',p.commit),['INPUT_STALE','QUALIFICATION_HOLD']));const barrier=await blocked(s,b,a);await a.execute('COMMIT;');const rejection=await losing;await b.execute('ROLLBACK;');const state=await observe(s);counts(state,{observations:11,entries:0,commitEffects:0});assert.equal(state.head.revision,'0');return {namespaceId:s.namespaceId,counts:state.counts,rejection,backendPids:[a.backendPid,b.backendPid],barrierObservedAt:barrier.observedAt};}finally{await close(a);await close(b);}
  });
  await runCase('READ_WAIT_OBSERVES_WITHDRAWAL',async()=>{
   const s=await setup(),p=await prepare(s);await commit(p);const a=await open('home_v1_fixture_writer'),b=await open('home_v1_internal_reader');
   try{await a.execute('BEGIN;');await raw(a,'fixture_apply',{action:'APPEND',namespaceId:s.namespaceId,effectKey:randomUUID(),expectedInputRevision:'1',observations:[retract(s)],publicationBindings:[]});const waiting=watch(raw(b,'read_current_home',{namespaceId:s.namespaceId,streamId:s.streamId}));await blocked(s,b,a);await a.execute('COMMIT;');calculating(await waiting);const state=await observe(s);counts(state,{observations:11,entries:2,commitEffects:1});return {namespaceId:s.namespaceId,counts:state.counts};}finally{await close(a);await close(b);}
  });
  await runCase('COMMIT_FIRST_THEN_RETRACTION_CURRENT_READ',async()=>{
   const s=await setup(),p=await prepare(s),a=await open('home_v1_commit_worker'),b=await open('home_v1_fixture_writer');
   try{await a.execute('BEGIN;');await raw(a,'commit_round',p.commit);
    const waiting=watch(raw(b,'fixture_apply',{
     action:'APPEND',namespaceId:s.namespaceId,effectKey:randomUUID(),expectedInputRevision:'1',
     observations:[retract(s)],publicationBindings:[],
    }));
    await blocked(s,b,a);await a.execute('COMMIT;');await waiting;calculating(await read(s));
    const state=await observe(s);counts(state,{observations:11,entries:2,commitEffects:1});
    return {namespaceId:s.namespaceId,counts:state.counts};
   }finally{await close(a);await close(b);}
  });
  await runCase('STALE_DISCARD_AND_SAME_CURRENT_SLOT_REUSE',async()=>{
   const s=await setup(),p=await prepare(s);await append(s,[{...s.data.observe('ASSESSMENT','issue-0',clone(s.data.observations.find(o=>o.kind==='ASSESSMENT'&&o.entityId==='issue-0').payload),'2')}]);
   await rejected(()=>commit(p),['INPUT_STALE']);const h=await rpc('home_v1_commit_worker','get_head',{namespaceId:s.namespaceId,streamId:s.streamId});
   const request={namespaceId:s.namespaceId,effectKey:randomUUID(),roundId:p.commit.roundId,expectedHead:h.result.head,inputDigest:p.commit.inputDigest,slotGeneration:p.capture.result.slotGeneration,reason:'INPUT_STALE'};
   const discarded=await rpc('home_v1_commit_worker','discard_stale_round',request);assert.equal(discarded.result.roundState,'SUPERSEDED');
   const now=await resourceNow();if(floor(now.serverCheckedAt)!==p.captureRequest.rankingCutoff)throw new Hold('SLOT_REUSE_REAL_CUTOFF_CHANGED');
   const nextRequest={...p.captureRequest,effectKey:randomUUID(),roundId:randomUUID(),supersedesRoundId:p.commit.roundId};const cap=await rpc('home_v1_capture_worker','capture_round',nextRequest),ev=evaluateHomeDatabaseRound(evaluator,cap);assert.equal(cap.result.slotGeneration,'2');
   await rpc('home_v1_commit_worker','commit_round',{...p.commit,effectKey:randomUUID(),roundId:nextRequest.roundId,producerRevision:'2',inputDigest:cap.result.inputDigest,resultCanonical:ev.resultCanonical});await rejected(()=>commit(p),['HEAD_CONFLICT','ROUND_NOT_PENDING']);const state=await observe(s);counts(state,{rounds:2,entries:2,commitEffects:1,discardEffects:1});return {namespaceId:s.namespaceId,counts:state.counts,slotGeneration:'2'};
  });
  await runCase('ACK_LOST_SAME_INTENT_LOOKUP_AND_REPLAY',async()=>{
   const s=await setup(),p=await prepare(s),expected=requestHash(identity,s.generation,'commit_round',p.commit);
   // Controlled loss AFTER an independent observer confirms the actual committed head.
   let dropped=false;
   try{await commit(p);const visible=await observe(s);assert.equal(visible.head.revision,'1');dropped=true;throw new Error('CONTROLLED_RESPONSE_LOSS');}catch(error){if(error.message!=='CONTROLLED_RESPONSE_LOSS')throw error;}
   assert(dropped);const before=await observe(s),found=await rpc('home_v1_commit_worker','lookup_effect',{namespaceId:s.namespaceId,operation:'commit_round',effectKey:p.commit.effectKey,requestDigest:expected,backendGeneration:s.generation});assert.equal(found.result.state,'APPLIED');const reused=await commit(p);assert.equal(reused.status,'REUSED');assert.equal(reused.result.qualificationCheckedAt,found.result.receipt.result.qualificationCheckedAt);assert.equal(reused.commitTimeQualificationProven,false);assert.deepEqual((await observe(s)).counts,before.counts);return {namespaceId:s.namespaceId,controlledLossAfterCommitObserved:true,counts:before.counts,qualificationCheckedAt:reused.result.qualificationCheckedAt};
  });
  await runCase('UNCOMMITTED_LOOKUP_UNKNOWN_THEN_CONNECTION_LOSS',async()=>{
   const s=await setup(),p=await prepare(s),a=await open('home_v1_commit_worker');let closed=false;
   try{await a.execute('BEGIN;');await raw(a,'commit_round',p.commit);const lookup={namespaceId:s.namespaceId,operation:'commit_round',effectKey:p.commit.effectKey,requestDigest:requestHash(identity,s.generation,'commit_round',p.commit),backendGeneration:s.generation};assert.equal((await rpc('home_v1_commit_worker','lookup_effect',lookup)).result.state,'UNKNOWN');
    await a.close();sessions.delete(a);closed=true;const state=await waitFor('DISCONNECT_ROLLBACK_NOT_OBSERVED',async()=>{const st=await observe(s);return st.counts.commitEffects===0&&st.head.revision==='0'?st:null;});counts(state,{rounds:1,entries:0,commitEffects:0});assert.equal((await rpc('home_v1_commit_worker','lookup_effect',lookup)).result.state,'UNKNOWN');return {namespaceId:s.namespaceId,counts:state.counts,backendPid:a.backendPid,unknownIsNotGeneralNotApplied:true};
   }finally{if(!closed)await close(a);}
  });
  await runCase('EFFECT_COLLISION_AND_BUDGET_FAILURE_LEAVE_STATE',async()=>{
   const s=await setup(),p=await prepare(s);await commit(p);const before=await observe(s);await rejected(()=>rpc('home_v1_commit_worker','commit_round',{...p.commit,resultCanonical:p.commit.resultCanonical+' '}),['EFFECT_CONFLICT']);
   await rejected(()=>context.transport({role:'home_v1_commit_worker',rpc:'commit_round',args:{p_request:{...p.commit,effectKey:randomUUID(),resultCanonical:'x'.repeat(65537)}}}),['JSON_BUDGET','RESULT_BUDGET']);assert.deepEqual((await observe(s)).counts,before.counts);return {namespaceId:s.namespaceId,counts:before.counts};
  });
  await runCase('PRINCIPAL_NEW_CONNECTIONS_AND_CROSS_ROLE_DENIAL',async()=>{
   const s=await setup(),p=await prepare(s),proof=[];const opened=[];
   try{for(const role of HOME_DATABASE_ROLES){const session=await open(role);opened.push(session);proof.push({role,principal:session.principal,backendPid:session.backendPid});}
    assert.equal(new Set(proof.map(x=>x.principal.sessionUser)).size,4);const byRole=Object.fromEntries(proof.map((x,n)=>[x.role,opened[n]])),before=await observe(s);
    await rejected(()=>byRole.home_v1_capture_worker.execute(sql('commit_round',p.commit)),['FORBIDDEN']);await rejected(()=>byRole.home_v1_commit_worker.execute(sql('fixture_apply',s.append)),['FORBIDDEN']);
    for(const operation of ['capture_round','commit_round'])await rejected(()=>byRole.home_v1_internal_reader.execute(sql(operation,operation==='capture_round'?p.captureRequest:p.commit)),['FORBIDDEN']);
    for(const statement of ['SELECT * FROM home_bound_v1.observations LIMIT 1;','UPDATE home_bound_v1.namespaces SET input_revision=input_revision;','SET ROLE home_v1_owner;','SET ROLE home_v1_commit_worker;'])await rejected(()=>byRole.home_v1_internal_reader.execute(statement),['FORBIDDEN']);
    await byRole.home_v1_internal_reader.execute('RESET ROLE;');assert.equal(parse(await byRole.home_v1_internal_reader.execute('SELECT jsonb_build_object(\'name\',session_user)::text;')).name,byRole.home_v1_internal_reader.principal.sessionUser);assert.deepEqual((await observe(s)).counts,before.counts);return {namespaceId:s.namespaceId,principals:proof,unregisteredDoubleMembershipBranchIndependentlyProven:false};
   }finally{for(const session of opened)await close(session);}
  });
  await runCase('ALL_EIGHT_RPC_ENTRY_ISOLATION_GUARDS',async()=>{
   const s=await setup(),p=await prepare(s),before=await observe(s),matrix=[];
   const requests={resource_identity:{resourceId:identity.resourceId},fixture_apply:s.append,get_head:{namespaceId:s.namespaceId,streamId:s.streamId},capture_round:p.captureRequest,commit_round:p.commit,lookup_effect:{namespaceId:s.namespaceId,operation:'capture_round',effectKey:p.captureRequest.effectKey,requestDigest:requestHash(identity,s.generation,'capture_round',p.captureRequest),backendGeneration:s.generation},discard_stale_round:{namespaceId:s.namespaceId,effectKey:randomUUID(),roundId:p.commit.roundId,expectedHead:p.commit.expectedHead,inputDigest:p.commit.inputDigest,slotGeneration:'1',reason:'INPUT_STALE'},read_current_home:{namespaceId:s.namespaceId,streamId:s.streamId}};
   const roles={resource_identity:'home_v1_capture_worker',fixture_apply:'home_v1_fixture_writer',get_head:'home_v1_capture_worker',capture_round:'home_v1_capture_worker',commit_round:'home_v1_commit_worker',lookup_effect:'home_v1_capture_worker',discard_stale_round:'home_v1_commit_worker',read_current_home:'home_v1_internal_reader'};
   for(const isolation of ['READ UNCOMMITTED','REPEATABLE READ','SERIALIZABLE'])for(const operation of HOME_DATABASE_RPCS){const session=await open(roles[operation]);try{await session.execute(`BEGIN ISOLATION LEVEL ${isolation};`);const rejection=await rejected(()=>session.execute(sql(operation,requests[operation])),['ISOLATION_NOT_SUPPORTED']);await session.execute('ROLLBACK;');matrix.push({isolation,operation,...rejection});}finally{await close(session);}}
   assert.equal(matrix.length,24);assert.deepEqual((await observe(s)).counts,before.counts);return {namespaceId:s.namespaceId,matrix,counts:before.counts};
  });
  for(const isolation of ['REPEATABLE READ','SERIALIZABLE'])for(const operation of ['commit_round','read_current_home'])await runCase(`STALE_SNAPSHOT_${isolation.replaceAll(' ','_')}_${operation}`,async()=>{
   const s=await setup(),p=await prepare(s);if(operation==='read_current_home')await commit(p);const b=await open(operation==='commit_round'?'home_v1_commit_worker':'home_v1_internal_reader');
   try{await b.execute(`BEGIN ISOLATION LEVEL ${isolation};`);const snapshot=(await b.execute('SELECT pg_current_snapshot()::text;')).trim();assert(snapshot.length>0);await append(s,[retract(s)]);const baseline=await observe(s),request=operation==='commit_round'?p.commit:{namespaceId:s.namespaceId,streamId:s.streamId};const rejection=await rejected(()=>b.execute(sql(operation,request)),['ISOLATION_NOT_SUPPORTED']);await b.execute('ROLLBACK;');const after=await observe(s);assert.deepEqual(after.counts,baseline.counts);assert.deepEqual(after.head,baseline.head);return {namespaceId:s.namespaceId,isolation,operation,snapshot,counts:after.counts,rejection};}finally{await close(b);}
  });
  await runCase('DECODED_JSON_CANONICAL_NOT_ORIGINAL_BYTES',async()=>{
   const session=await open('home_v1_internal_reader');try{
    const result=parse(await session.execute("SELECT jsonb_build_object('sameDecoded', '{\"outer\":{\"x\":0,\"x\":1},\"n\":1.0}'::jsonb = '{\"n\":1,\"outer\":{\"x\":1}}'::jsonb)::text;"));assert.equal(result.sameDecoded,true);
    const s=await setup(),p=await prepare(s),before=await observe(s),wire=JSON.stringify(p.commit).replace('"producerRevision":"1"','"producerRevision":"0","producerRevision":"1"');await rejected(()=>session.execute(`SELECT home_bound_v1.commit_round('${wire.replaceAll("'","''")}'::jsonb)::text;`),['FORBIDDEN']);assert.deepEqual((await observe(s)).counts,before.counts);return {sameDecoded:true,originalBytesCertified:false,nestedDuplicateAbsenceCertified:false};
   }finally{await close(session);}
  });
  await runCase('SOURCE_ORIGINAL_CLOCK_SELECTION_AND_REPLACEMENT',async()=>{
   const s=await setup(),p=await prepare(s);await commit(p);const at=Date.parse(s.data.cutoff),original=s.data.sources[0];
   const late=clone(original);late.source.revisionId='source-late-old-clock';late.source.collectedAt=stamp(at-1);late.source.publishedAt=stamp(at-600000);late.source.contentHash=sha('SYNTHETIC older late delivery');late.source.bodyRef='fixture:/home-db/late-old';late.bodyHash=late.source.contentHash;late.sourceDigest=sha(homeRequestCanonical(late.source));late.deliveryRef='delivery-late-old';
   const versions=Object.fromEntries(['contractVersion','sampleKind','policyVersion','catalogVersion','sourcePolicyVersion'].map(k=>[k,original.source[k]]));const known=[original.source,late.source];assert.equal(selectPipelineSources(known,versions,s.data.cutoff)[0].revision.revisionId,original.source.revisionId);
   await append(s,[s.data.observe('SOURCE',original.source.sourceDocumentId,late,'2')]);assert.equal((await read(s)).result.state,'FRESH');
   const newer=clone(original);newer.source.revisionId='source-current-new-clock';newer.source.updatedAt=stamp(at-30000);newer.source.collectedAt=stamp(at-1);newer.source.contentHash=sha('SYNTHETIC newer source');newer.source.bodyRef='fixture:/home-db/newer';newer.bodyHash=newer.source.contentHash;newer.sourceDigest=sha(homeRequestCanonical(newer.source));newer.deliveryRef='delivery-current-new';known.push(newer.source);assert.equal(selectPipelineSources(known,versions,s.data.cutoff)[0].revision.revisionId,newer.source.revisionId);
   await append(s,[s.data.observe('SOURCE',original.source.sourceDocumentId,newer,'3')],[],'2');calculating(await read(s));return {namespaceId:s.namespaceId,counts:(await observe(s)).counts,sourceSelectionReference:'pipeline-semantics.ts/selectPipelineSources',oldReceiptCurrentAuthorization:false};
  });
  for(const field of ['keyIssueEvidenceIds','analysisEvidenceIds','impactEvidenceIds','riskEvidenceIds','scheduleEvidenceIds','scenarioEvidenceIds','articleImpactEvidenceIds'])await runCase(`STORED_${field}_CURRENT_RETRACTION_AND_GRAPH_SWAP`,async()=>{
   const s=await setup({bodyField:field}),p=await prepare(s);await commit(p);
   const retracted={...clone(s.data.claims[2]),claim:{...clone(s.data.claims[2].claim),status:'RETRACTED'}};await append(s,[s.data.observe('CLAIM','claim-2',retracted,'2')]);calculating(await read(s));const before=await observe(s);
   const changed=clone(s.data.issues[0]);changed.dependencyGraph[field]=['claim-0'];await rejected(()=>append(s,[s.data.observe('ISSUE','issue-0',changed,'2')],[],'2'),['DEPENDENCY_GRAPH_CHANGED']);assert.deepEqual((await observe(s)).counts,before.counts);calculating(await read(s));return {namespaceId:s.namespaceId,field,counts:before.counts,storedReferenceRetained:true};
  });
  await runCase('PENDING_COMPLETE_BODY_ONLY_RETRACTION_UNCHANGED',async()=>{
   const s=await setup({bodyField:'analysisEvidenceIds'}),p=await prepare(s),c=clone(s.data.claims[2]);c.claim.status='RETRACTED';await append(s,[s.data.observe('CLAIM','claim-2',c,'2')]);const before=await observe(s);await rejected(()=>commit(p),['INPUT_STALE','QUALIFICATION_HOLD']);assert.deepEqual((await observe(s)).counts,before.counts);assert.equal(before.head.revision,'0');counts(before,{entries:0,commitEffects:0});return {namespaceId:s.namespaceId,counts:before.counts};
  });
  await runCase('NUMERIC_DRAFT_DISTINCT_ARTICLE_UUID_BINDING',async()=>{
   const s=await setup(),old=s.data.bindings[0],changed=clone(s.data.issues[0]),next={...clone(old),articleVersionId:randomUUID(),publicationEffectKey:randomUUID(),issueRevisionBefore:'1',issueRevisionAfter:'2',contentDigest:sha('SYNTHETIC new article same draft')};changed.articleVersionId=next.articleVersionId;changed.priority.version=next.articleVersionId;
   await append(s,[s.data.observe('ISSUE','issue-0',changed,'2')],[next]);const state=await observe(s);counts(state,{publicationBindings:3});assert.equal(next.editorDraftRevision,old.editorDraftRevision);assert.notEqual(next.articleVersionId,old.articleVersionId);const p=await prepare(s);await commit(p);assert.equal((await read(s)).result.state,'FRESH');return {namespaceId:s.namespaceId,counts:state.counts,sameNumericDraftCreatesNoImplicitUuidEquality:true};
  });
  await runCase('REAL_EXPIRY_AFTER_GATE_WAIT_NO_INPUT_BUMP',async()=>{
   const now=await resourceNow(),until=stamp(Date.parse(now.serverCheckedAt)+8000),s=await setup({expiry:until}),p=await prepare(s),a=await open('home_v1_fixture_writer'),b=await open('home_v1_commit_worker');
   try{await a.execute('BEGIN;');const reused=await raw(a,'fixture_apply',s.append);assert.equal(reused.status,'REUSED');await b.execute('BEGIN;');const waiting=rejected(()=>raw(b,'commit_round',p.commit),['QUALIFICATION_HOLD']);waiting.catch(()=>{});await blocked(s,b,a);const elapsed=await expired(s,until);await a.execute('COMMIT;');const rejection=await waiting;await b.execute('ROLLBACK;');const state=await observe(s);counts(state,{observations:10,rounds:1,entries:0,commitEffects:0});const head=await rpc('home_v1_capture_worker','get_head',{namespaceId:s.namespaceId,streamId:s.streamId});assert.equal(head.result.inputRevision,'1');return {namespaceId:s.namespaceId,counts:state.counts,expiresAt:until,expiryObservedAt:elapsed.observedAt,rejection};}finally{await close(a);await close(b);}
  });
  for(const mode of ['DEFAULT_DEFERRED','IMMEDIATE_BEFORE_RPC','IMMEDIATE_AFTER_RPC'])await runCase(`LAST_CHECK_${mode}`,async()=>{
   const now=await resourceNow(),until=stamp(Date.parse(now.serverCheckedAt)+8000),s=await setup({expiry:until}),p=await prepare(s),a=await open('home_v1_commit_worker');let candidate=null,phase='BEGIN',committed=false,rejection=null;
   try{
    await a.execute('BEGIN;');if(mode==='IMMEDIATE_BEFORE_RPC'){phase='SET_BEFORE';await a.execute('SET CONSTRAINTS ALL IMMEDIATE;');}
    try{phase='RPC';candidate=await raw(a,'commit_round',p.commit);if(mode==='IMMEDIATE_AFTER_RPC'){phase='SET_AFTER';await a.execute('SET CONSTRAINTS ALL IMMEDIATE;');}}
    catch(error){
     const proof=errorEvidence(error);await a.execute('ROLLBACK;');const state=await observe(s);counts(state,{entries:0,commitEffects:0});assert.equal(state.head.revision,'0');
     if(mode==='DEFAULT_DEFERRED')throw error;
     if(['23514','23503','23505'].includes(proof.sqlState)||proof.code==='RESULT_INVALID'){
      calculating(await read(s));const absent=await rpc('home_v1_commit_worker','lookup_effect',{namespaceId:s.namespaceId,operation:'commit_round',effectKey:p.commit.effectKey,requestDigest:requestHash(identity,s.generation,'commit_round',p.commit),backendGeneration:s.generation});assert.equal(absent.result.state,'UNKNOWN');
      return {namespaceId:s.namespaceId,outcome:'REJECTED_STRUCTURAL_EARLY',phase,rejection:proof,counts:state.counts,lateCommitReproduced:false,commitTimeQualificationProven:false,currentReadIds:0};
     }
     if(proof.code==='QUALIFICATION_HOLD')throw new Hold('EXPIRED_BEFORE_RPC_OR_IMMEDIATE_CHECK_FINISHED');throw error;
    }
    assert(candidate);assert.equal(candidate.commitTimeQualificationProven,false);assert(Date.parse(candidate.result.qualificationCheckedAt)<Date.parse(until));
    const beforeWait=await observe(s);if(Date.parse(beforeWait.observedAt)>=Date.parse(until))throw new Hold('EARLY_CHECK_BEFORE_EXPIRY_NOT_OBSERVED');
    const expiry=await expired(s,until);phase='COMMIT';
    try{await a.execute('COMMIT;');committed=true;}catch(error){rejection=errorEvidence(error);assert.equal(rejection.code,'QUALIFICATION_HOLD');await a.execute('ROLLBACK;');}
    const state=await observe(s);
    if(mode==='DEFAULT_DEFERRED')assert.equal(committed,false,'default additional defense must reject this expiry scenario');
    if(committed){
     counts(state,{entries:2,commitEffects:1});assert.equal(state.head.revision,'1');calculating(await read(s));
     const found=await rpc('home_v1_commit_worker','lookup_effect',{namespaceId:s.namespaceId,operation:'commit_round',effectKey:p.commit.effectKey,requestDigest:requestHash(identity,s.generation,'commit_round',p.commit),backendGeneration:s.generation}),reused=await commit(p);assert.equal(found.result.state,'APPLIED');assert.equal(reused.status,'REUSED');assert.equal(reused.result.qualificationCheckedAt,candidate.result.qualificationCheckedAt);assert.equal(reused.commitTimeQualificationProven,false);calculating(await read(s));
    }else {counts(state,{entries:0,commitEffects:0});assert.equal(state.head.revision,'0');calculating(await read(s));}
    return {namespaceId:s.namespaceId,mode,outcome:committed?'COMMITTED_LATE_HISTORICAL_ONLY':'COMMIT_REJECTED_EXPIRED',qualificationCheckedAt:candidate.result.qualificationCheckedAt,expiresAt:until,expiryObservedAt:expiry.observedAt,commitAckObservedAfterExpiry:committed,rejection,counts:state.counts,commitTimeQualificationProven:false,currentReadIds:0};
   }finally{await close(a);}
  });
  await runCase('ACTUAL_NEXT_SLOTS_HEAD_ADVANCED_OLD_EXCLUDED_AND_15_MINUTE_AGE',async()=>{
   // Every state is made by ordinary public RPCs. No clock override or private fixture DML.
   const old=await setup(),first=await prepare(old);await commit(first);
   const age=await setup({closeCurrentKoreanDay:true}),ageRound=await prepare(age);await commit(ageRound);const ageInitial=await read(age);assert.notEqual(ageInitial.result.state,'CALCULATING');assert.equal(ageInitial.result.marketBasis,'FOREIGN_US');
   const withdrawn=clone(old.data.issues[0]);withdrawn.publicationState='WITHDRAWN';withdrawn.priority.publicationState='WITHDRAWN';await append(old,[old.data.observe('ISSUE','issue-0',withdrawn,'2')]);calculating(await read(old));
   const firstNext=Date.parse(first.captureRequest.rankingCutoff)+300000;const nextObserved=await waitDbAt(old,firstNext,'NEXT_PUBLIC_FIVE_MINUTE_SLOT');
   const pending=await prepare(old);assert(Date.parse(pending.captureRequest.rankingCutoff)>Date.parse(first.captureRequest.rankingCutoff));
   const secondNext=Date.parse(pending.captureRequest.rankingCutoff)+300000;const newerObserved=await waitDbAt(old,secondNext,'NEXT_HEAD_ADVANCING_PUBLIC_SLOT');
   const newer=await prepare(old);assert(Date.parse(newer.captureRequest.rankingCutoff)>Date.parse(pending.captureRequest.rankingCutoff));const safe=await commit(newer);assert.equal(safe.result.globalRevision,'2');
   const current=await read(old);assert.notEqual(current.result.state,'CALCULATING');const visible=Object.values(current.result.lanes).flat().map(x=>x.issueId);assert(!visible.includes('issue-0'));assert.deepEqual(visible,['issue-1']);
   const beforeDiscard=await observe(old),discard={namespaceId:old.namespaceId,effectKey:randomUUID(),roundId:pending.commit.roundId,expectedHead:beforeDiscard.head,inputDigest:pending.commit.inputDigest,slotGeneration:pending.capture.result.slotGeneration,reason:'HEAD_ADVANCED'};
   await rpc('home_v1_commit_worker','discard_stale_round',discard);await rejected(()=>commit(pending),['HEAD_CONFLICT','ROUND_NOT_PENDING']);const afterDiscard=await observe(old);counts(afterDiscard,{rounds:3,entries:3,commitEffects:2,discardEffects:1});assert.equal(afterDiscard.head.revision,'2');
   const ageBoundary=Date.parse(ageRound.captureRequest.rankingCutoff)+900000;
   const justBefore=await waitDbAt(age,ageBoundary-1500,'ACTUAL_REFERENCE_AGE_BEFORE_FIFTEEN_MINUTES');
   const allowed=await read(age);if(Date.parse(allowed.result.checkedAt)>=ageBoundary)throw new Hold('ACTUAL_BEFORE_15_MINUTE_READ_MISSED');if(allowed.result.state==='CALCULATING'||allowed.result.marketBasis!==ageInitial.result.marketBasis||allowed.result.targetKrTradingDay!==ageInitial.result.targetKrTradingDay)throw new Hold('CURRENT_CONTEXT_CHANGED_BEFORE_AGE_BOUNDARY');
   const ageExpired=await waitDbAt(age,ageBoundary+2,'ACTUAL_REFERENCE_AGE_AFTER_FIFTEEN_MINUTES');calculating(await read(age));const ageState=await observe(age);counts(ageState,{rounds:1,entries:2,commitEffects:1});
   return {namespaceId:old.namespaceId,ageNamespaceId:age.namespaceId,nextSlotObservedAt:nextObserved.observedAt,headAdvancingSlotObservedAt:newerObserved.observedAt,counts:afterDiscard.counts,oldExplicitlyWithdrawnExcluded:true,oldCardIdsRestored:false,ageSourceCutoff:ageRound.captureRequest.rankingCutoff,ageBeforeCheckedAt:allowed.result.checkedAt,ageAfterObservedAt:ageExpired.observedAt,ageBeforeObservedAt:justBefore.observedAt,ageCurrentIdsAfterBoundary:0,ageCalendarFixtureCurrentKoreanDayClosed:true,actualExchangeCalendarProven:false,evidenceKind:'PG_TWO_SESSION_REAL_CLOCK',fixedTimeIsNotRealtime:true};
  });
  await runCase('ACTUAL_POSTGRES_SERVICE_RESTART_SAME_RESOURCE',async()=>{
   if(context.restartServer===null)throw new Hold('MAIN_POSTGRES_SERVICE_RESTART_NOT_AVAILABLE');
   const completeNamespace=await setup(),completed=await prepare(completeNamespace);const receipt=await commit(completed);const pendingNamespace=await setup(),pending=await prepare(pendingNamespace);
   const beforeResource=await resourceNow(),beforeComplete=await observe(completeNamespace),beforePending=await observe(pendingNamespace);
   assert.equal(sessions.size,0);await context.restartServer();
   const afterResource=await resourceNow();assert.deepEqual(afterResource.result.resourceIdentity,beforeResource.result.resourceIdentity);assert.notEqual(afterResource.result.postmasterStartedAt,beforeResource.result.postmasterStartedAt);assert.deepEqual((await observe(completeNamespace)).head,beforeComplete.head);assert.deepEqual((await observe(completeNamespace)).counts,beforeComplete.counts);assert.deepEqual((await observe(pendingNamespace)).counts,beforePending.counts);
   const found=await rpc('home_v1_commit_worker','lookup_effect',{namespaceId:completeNamespace.namespaceId,operation:'commit_round',effectKey:completed.commit.effectKey,requestDigest:receipt.requestDigest,backendGeneration:completeNamespace.generation});assert.equal(found.result.state,'APPLIED');assert.equal(found.result.receipt.result.qualificationCheckedAt,receipt.result.qualificationCheckedAt);
   const replay=await rpc('home_v1_capture_worker','capture_round',pending.captureRequest);assert.equal(replay.status,'REUSED');const ev=evaluateHomeDatabaseRound(createHomeDatabaseEvaluator(),replay);assert.equal(ev.resultDigest,pending.evaluated.resultDigest);await rpc('home_v1_commit_worker','commit_round',{...pending.commit,resultCanonical:ev.resultCanonical});const state=await observe(pendingNamespace);counts(state,{entries:2,commitEffects:1});
   assert.notEqual((await read(completeNamespace)).result.state,'CALCULATING');await append(completeNamespace,[retract(completeNamespace)]);calculating(await read(completeNamespace));const historical=await commit(completed);assert.equal(historical.status,'REUSED');assert.equal(historical.result.qualificationCheckedAt,receipt.result.qualificationCheckedAt);calculating(await read(completeNamespace));
   return {completedNamespaceId:completeNamespace.namespaceId,pendingNamespaceId:pendingNamespace.namespaceId,backendGenerationPreserved:true,postmasterBefore:beforeResource.result.postmasterStartedAt,postmasterAfter:afterResource.result.postmasterStartedAt,sameContainerClusterDatabaseBootstrap:true,nodeReconnectIsNotRestartEvidence:true,hostCrashDurabilityProven:false,crossworkerAtomicity:false};
  });
 }catch(error){cases.push({name:'RESOURCE_OR_HARNESS_FAILURE',status:'FAIL',evidenceKind:'PG_TWO_SESSION_REAL_CLOCK',...errorEvidence(error)});}
 finally{for(const session of [...sessions])await close(session);}
 // These require real elapsed cutoffs. No fixtureClock/GUC/caller now fast-forward is provided.
 for(const [name,minutes]of [['RPC_REALTIME_32',155],['RPC_REALTIME_288',1435],['REALCLOCK_0810_2000_CALENDAR_BOUNDARIES',null]])cases.push({name,status:'SKIP',evidenceKind:name,realElapsedMinutesRequired:minutes,operationalClaim:'HOLD',reason:'NOT_RUN_NO_CLOCK_OVERRIDE'});
 const required=cases.filter(c=>c.status!=='SKIP'),status=required.some(c=>c.status==='FAIL')?'FAIL':required.some(c=>c.status==='HOLD')?'HOLD':'PASS';
 const report={...HOME_DATABASE_FLAGS,status,scope:'ISOLATED_HOME_MINIMUM_ACCEPTANCE',resource:resourceProof,cases,passed:cases.filter(c=>c.status==='PASS').length,failed:cases.filter(c=>c.status==='FAIL').length,held:cases.filter(c=>c.status==='HOLD').length,skipped:cases.filter(c=>c.status==='SKIP').length,operationalContinuity:'HOLD',originalRequestBytesCertified:false,realPublishingEnabled:false,actualProviderCalls:0,cleanup:{sessionsClosed:sessions.size===0,resourceCleanupOwnedByMAIN:true},limits:['D0_ISOLATED_FIXTURE_ASSERTIONS_ONLY','SEPARATE_COLLECTOR_RESOURCE_NOT_CROSSWORKER_ATOMIC','UNREGISTERED_TWO_MEMBERSHIPS_DOES_NOT_INDEPENDENTLY_PROVE_MEMBERSHIP_BRANCH','NO_REALTIME_32_OR_288_EVIDENCE','NO_HOST_CRASH_OR_CONTAINER_RECREATION_CONTINUITY']};
 await mkdir(output,{recursive:true});await writeFile(join(output,'home-database-postgres.json'),JSON.stringify(report,null,2)+'\n','utf8');return report;
}

/** Independent, bounded installer/principal diagnostics for a separate MAIN-owned resource.
 * Exact context: {resourceIdentity,outputDirectory,ownerExecute,openCaptureSession}.
 * ownerExecute(sql) returns psql -X -qAt text with ON_ERROR_STOP=1; it targets only
 * this disposable database. openCaptureSession() returns the existing raw session
 * shape {backendPid,principal,execute,close}, using the registered capture LOGIN.
 * MAIN installs/seeds/owns/cleans the resource. Do not pass the normal acceptance
 * resource, pooled/SET ROLE connections, a production database, or a transport codec.
 * ownerExecute is a test-only bootstrap capability, never an application API.
 */
export async function runHomeDatabaseIdentityDiagnostics(context){
 const contextKeys=['resourceIdentity','outputDirectory','ownerExecute','openCaptureSession'];
 assert(context&&typeof context==='object'&&!homeIsProxy(context));
 assert.deepEqual(Object.keys(context).sort(),[...contextKeys].sort());
 for(const key of contextKeys){
  const descriptor=Object.getOwnPropertyDescriptor(context,key);
  assert(descriptor&&'value'in descriptor&&descriptor.enumerable);
 }
 assert.equal(typeof context.ownerExecute,'function');
 assert.equal(typeof context.openCaptureSession,'function');
 const identity=validateHomeDatabaseResource(context.resourceIdentity);
 const output=resolve(context.outputDirectory);
 assert(/[/\\]outputs[/\\]development-stages[/\\]/.test(output));
 const runHex=identity.runId.replaceAll('-','');
 const captureLogin=`h4_${runHex}_capture`,component='home_v1_capture_worker';
 const extraRole=`h4d_${runHex}_extra`,parentRole=`h4d_${runHex}_parent`;
 const quoted=name=>{assert(/^[a-z][a-z0-9_]{0,62}$/.test(name));return `"${name}"`;};
 const text=value=>`'${value.replaceAll("'","''")}'`;
 const owner=source=>context.ownerExecute(source);
 const ownerJson=async source=>parse(await owner(source));
 const cases=[],sessions=new Set(),backendPids=new Set();
 let baseline=null,cleanupVerified=false,rolesAttempted=false;
 const request={resourceId:identity.resourceId};

 // This projection records every _entry predicate relevant to these two branches.
 // It deliberately excludes server time so unchanged before/after values compare.
 const snapshotSql=`SELECT pg_catalog.jsonb_build_object(
  'resourceIdentity',c.identity,'rowResourceId',c.resource_id::text,'rowRunId',c.run_id::text,
  'databaseName',pg_catalog.current_database(),
  'databaseOid',(SELECT oid::text FROM pg_catalog.pg_database WHERE datname=pg_catalog.current_database()),
  'clusterSystemIdentifier',(SELECT system_identifier::text FROM pg_catalog.pg_control_system()),
  'login',pg_catalog.jsonb_build_object('oid',r.oid::text,'name',r.rolname,'canLogin',r.rolcanlogin,
   'inherit',r.rolinherit,'superuser',r.rolsuper,'createDb',r.rolcreatedb,'createRole',r.rolcreaterole,
   'replication',r.rolreplication,'bypassRls',r.rolbypassrls),
  'component',pg_catalog.jsonb_build_object('oid',k.oid::text,'name',k.rolname,'canLogin',k.rolcanlogin,
   'superuser',k.rolsuper,'bypassRls',k.rolbypassrls),
  'principal',(SELECT pg_catalog.jsonb_build_object('oid',p.principal_oid::text,'name',p.principal_name,
   'resourceId',p.resource_id::text,'runId',p.run_id::text,'componentRole',p.component_role)
   FROM home_bound_v1.principals p WHERE p.principal_oid=r.oid),
  'loginMemberships',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'roleOid',m.roleid::text,'memberOid',m.member::text,'grantorOid',m.grantor::text,
   'inherit',m.inherit_option,'set',m.set_option,'admin',m.admin_option) ORDER BY m.roleid)
   FROM pg_catalog.pg_auth_members m WHERE m.member=r.oid),'[]'::jsonb),
  'componentParents',COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
   'roleOid',m.roleid::text,'memberOid',m.member::text,'grantorOid',m.grantor::text,
   'inherit',m.inherit_option,'set',m.set_option,'admin',m.admin_option) ORDER BY m.roleid)
   FROM pg_catalog.pg_auth_members m WHERE m.member=k.oid),'[]'::jsonb),
  'databaseOwnershipCount',(SELECT pg_catalog.count(*) FROM pg_catalog.pg_database WHERE datdba=r.oid),
  'acl',pg_catalog.jsonb_build_object('functionOid',f.oid::text,'ownerOid',f.proowner::text,
   'functionAcl',f.proacl::text,'schemaOid',n.oid::text,'schemaAcl',n.nspacl::text,
   'schemaUsage',pg_catalog.has_schema_privilege(r.oid,n.oid,'USAGE'),
   'rpcExecute',pg_catalog.has_function_privilege(r.oid,f.oid,'EXECUTE'))
 )::text FROM home_bound_v1.resource_control c
 JOIN pg_catalog.pg_roles r ON r.rolname=${text(captureLogin)}
 JOIN pg_catalog.pg_roles k ON k.rolname=${text(component)}
 JOIN pg_catalog.pg_namespace n ON n.nspname='home_bound_v1'
 JOIN pg_catalog.pg_proc f ON f.pronamespace=n.oid AND f.proname='resource_identity'
  AND f.oid='home_bound_v1.resource_identity(jsonb)'::pg_catalog.regprocedure
 WHERE c.singleton;`;
 const snapshot=()=>ownerJson(snapshotSql);
 function assertBaseline(value){
  assert.deepEqual(value.resourceIdentity,identity);
  assert.equal(value.rowResourceId,identity.resourceId);assert.equal(value.rowRunId,identity.runId);
  assert.equal(value.databaseName,identity.databaseName);assert.equal(value.databaseOid,identity.databaseOid);
  assert.equal(value.clusterSystemIdentifier,identity.clusterSystemIdentifier);
  assert.equal(value.login.name,captureLogin);assert.equal(value.login.canLogin,true);assert.equal(value.login.inherit,true);
  for(const key of ['superuser','createDb','createRole','replication','bypassRls'])assert.equal(value.login[key],false);
  assert.equal(value.component.name,component);assert.equal(value.component.canLogin,false);
  assert.equal(value.component.superuser,false);assert.equal(value.component.bypassRls,false);
  assert.deepEqual(value.principal,{oid:value.login.oid,name:captureLogin,resourceId:identity.resourceId,runId:identity.runId,componentRole:component});
  assert.equal(value.loginMemberships.length,1);
  const membership=value.loginMemberships[0];
  assert.equal(membership.roleOid,value.component.oid);assert.equal(membership.memberOid,value.login.oid);
  assert.equal(membership.inherit,true);assert.equal(membership.set,false);assert.equal(membership.admin,false);
  assert.deepEqual(value.componentParents,[]);assert.equal(value.databaseOwnershipCount,0);
  assert.equal(value.acl.schemaUsage,true);assert.equal(value.acl.rpcExecute,true);
 }
 async function open(){
  const session=await context.openCaptureSession();sessions.add(session);
  assert.equal(typeof session.execute,'function');assert.equal(typeof session.close,'function');
  const live=parse(await session.execute(`SELECT pg_catalog.jsonb_build_object(
   'sessionUser',session_user,'currentUser',current_user,'backendPid',pg_catalog.pg_backend_pid(),
   'sessionUserOid',(SELECT oid::text FROM pg_catalog.pg_roles WHERE rolname=session_user),
   'isolation',pg_catalog.current_setting('transaction_isolation'))::text;`));
  assert.equal(live.sessionUser,captureLogin);assert.equal(live.currentUser,captureLogin);
  assert.equal(live.isolation,'read committed');assert.equal(live.sessionUserOid,baseline.login.oid);
  assert.equal(live.backendPid,session.backendPid);assert(!backendPids.has(live.backendPid));backendPids.add(live.backendPid);
  assert.deepEqual(session.principal,{sessionUser:captureLogin,sessionUserOid:baseline.login.oid,componentRole:component,resourceId:identity.resourceId,runId:identity.runId});
  return session;
 }
 async function close(session){
  if(!session)return;
  try{await session.execute('ROLLBACK;');}catch{}
  try{await session.close();}finally{sessions.delete(session);}
 }
 async function positive(){
  let session;
  try{
   session=await open();
   const reply=validateHomeDatabaseReply('resource_identity',parse(await session.execute(sql('resource_identity',request))));
   assert.deepEqual(reply.result.resourceIdentity,identity);
   assert.equal(reply.principal.sessionUserOid,baseline.login.oid);
   return {backendPid:session.backendPid,sessionUserOid:reply.principal.sessionUserOid};
  }finally{await close(session);}
 }
 async function nativeRejection(expectedCode,expectedState){
  assert(['FORBIDDEN','RESOURCE_MISMATCH'].includes(expectedCode));
  assert(['42501','P0001'].includes(expectedState));
  let session;
  try{
   session=await open();
   // Check the actual backend exception before MAIN's text transport can map an
   // arbitrary ACL 42501 to FORBIDDEN. Do not append another SQL statement here:
   // psql ON_ERROR_STOP=0 would let its success mask a failed DO assertion.
   await session.execute(`DO $home_diagnostic$
    DECLARE caught_state text;caught_message text;
    BEGIN
     BEGIN
      PERFORM home_bound_v1.resource_identity(${literal(request)});
     EXCEPTION WHEN OTHERS THEN
      GET STACKED DIAGNOSTICS caught_state=RETURNED_SQLSTATE,caught_message=MESSAGE_TEXT;
     END;
     IF caught_state IS DISTINCT FROM ${text(expectedState)} OR caught_message IS DISTINCT FROM ${text(expectedCode)} THEN
      RAISE EXCEPTION 'HOME_DIAGNOSTIC_WRONG_NATIVE_REJECTION';
     END IF;
    END $home_diagnostic$;`);
   return {backendPid:session.backendPid,sqlState:expectedState,code:expectedCode,nativeExceptionCheckedInsideBackend:true};
  }finally{await close(session);}
 }
 async function runCase(name,work){
  try{cases.push({name,status:'PASS',...await work()});}
  catch(error){cases.push({name,status:'FAIL',...errorEvidence(error)});}
 }
 async function restoreIdentity(){
  await owner(`BEGIN;UPDATE home_bound_v1.resource_control SET identity=${literal(identity)} WHERE singleton;COMMIT;`);
 }
 async function membershipCase(name,member,role,field){
  const before=await snapshot();assert.deepEqual(before,baseline);const beforePositive=await positive();
  let changed,rejection,roleProof;
  try{
   await owner(`GRANT ${quoted(role)} TO ${quoted(member)} WITH INHERIT FALSE, SET FALSE, ADMIN FALSE;`);
   changed=await snapshot();
   roleProof=await ownerJson(`SELECT pg_catalog.jsonb_build_object('oid',oid::text,'name',rolname,
    'canLogin',rolcanlogin,'superuser',rolsuper,'createDb',rolcreatedb,'createRole',rolcreaterole,
    'replication',rolreplication,'bypassRls',rolbypassrls)::text FROM pg_catalog.pg_roles WHERE rolname=${text(role)};`);
   assert.equal(roleProof.name,role);
   for(const key of ['canLogin','superuser','createDb','createRole','replication','bypassRls'])assert.equal(roleProof[key],false);
   const extra=changed[field].filter(m=>!baseline[field].some(b=>b.roleOid===m.roleOid));
   assert.equal(extra[0]?.roleOid,roleProof.oid);
   assert.equal(extra.length,1);assert.equal(extra[0].inherit,false);assert.equal(extra[0].set,false);assert.equal(extra[0].admin,false);
   assert.deepEqual({...changed,[field]:baseline[field]},baseline,'Only the targeted membership predicate may differ');
   assert.equal(changed[field].length,baseline[field].length+1);
   rejection=await nativeRejection('FORBIDDEN','42501');
  }finally{await owner(`REVOKE ${quoted(role)} FROM ${quoted(member)};`);}
  const restored=await snapshot();assert.deepEqual(restored,baseline);const afterPositive=await positive();
  return {branch:name,beforePositive,roleProof,changed,rejection,restored,afterPositive,membershipBranchIndependentlyProven:true};
 }
 function identityVariants(){
  const variants=[
   {name:'SQL_NULL',expression:'NULL::jsonb',phase:'INSTALL_NOT_NULL',sqlState:'23502'},
   ...[['JSON_NULL',null],['ROOT_ARRAY',[]],['ROOT_STRING','identity'],['ROOT_NUMBER',1],['EMPTY_OBJECT',{}]].map(([name,value])=>({name,value,phase:'INSTALL_CHECK',sqlState:'23514'}))
  ];
  const installKeys=new Set(['schema','resourceId','runId']);
  for(const key of Object.keys(identity)){
   const missing=clone(identity);delete missing[key];
   const phase=installKeys.has(key)?'INSTALL_CHECK':'RPC',sqlState=installKeys.has(key)?'23514':'P0001';
   for(const [kind,value]of [['MISSING',missing],['JSON_NULL',{...identity,[key]:null}],['WRONG_TYPE',{...identity,[key]:false}]])
    variants.push({name:`${key}_${kind}`,value,phase,sqlState});
  }
  const runtime=(name,key,value)=>variants.push({name,value:{...identity,[key]:value},phase:'RPC',sqlState:'P0001'});
  variants.push({name:'EXTRA_KEY',value:{...identity,extraField:'unexpected'},phase:'RPC',sqlState:'P0001'});
  variants.push({name:'SCHEMA_WRONG_FIXED',value:{...identity,schema:'OTHER'},phase:'INSTALL_CHECK',sqlState:'23514'});
  for(const key of ['resourceId','runId'])variants.push({name:`${key}_ROW_MISMATCH`,value:{...identity,[key]:randomUUID()},phase:'INSTALL_CHECK',sqlState:'23514'});
  for(const key of ['productId','stage','component','imageId'])runtime(`${key}_WRONG_FIXED`,key,'OTHER');
  for(const key of ['containerId','contractSha256'])runtime(`${key}_BAD_HASH`,key,'invalid');
  runtime('bootstrapUuid_BAD_UUID','bootstrapUuid','invalid');runtime('databaseName_BAD_ID','databaseName','invalid name');
  runtime('clusterSystemIdentifier_NONCANONICAL','clusterSystemIdentifier','01');
  runtime('databaseOid_OVERFLOW','databaseOid','9223372036854775808');
  runtime('databaseOid_NUMERIC_COERCION','databaseOid',Number(identity.databaseOid));
  runtime('clusterSystemIdentifier_LIVE_MISMATCH','clusterSystemIdentifier',identity.clusterSystemIdentifier==='0'?'1':'0');
  runtime('databaseOid_LIVE_MISMATCH','databaseOid',identity.databaseOid==='0'?'1':'0');
  runtime('databaseName_LIVE_MISMATCH','databaseName',`diagnostic_other_${runHex}`);
  return variants;
 }
 async function identityCase(variant){
  assert.deepEqual(await snapshot(),baseline);
  let installation,rejection=null;
  try{
   // The explicit SAVEPOINT and the PL/pgSQL exception subtransaction keep a
   // rejected UPDATE from poisoning the owner transaction. An accepted malformed
   // value is committed only in this disposable diagnostic resource, so a new
   // actual LOGIN backend can exercise the runtime identity guard.
   installation=await ownerJson(`BEGIN;
    CREATE TEMP TABLE home_identity_diagnostic(result jsonb NOT NULL) ON COMMIT DROP;
    SAVEPOINT home_identity_case;
    DO $home_install_diagnostic$
    DECLARE caught_state text;constraint_name text;column_name text;
    BEGIN
     BEGIN
      UPDATE home_bound_v1.resource_control SET identity=${variant.expression??literal(variant.value)} WHERE singleton;
     EXCEPTION WHEN check_violation OR not_null_violation THEN
      GET STACKED DIAGNOSTICS caught_state=RETURNED_SQLSTATE,constraint_name=CONSTRAINT_NAME,column_name=COLUMN_NAME;
     END;
     IF (SELECT identity FROM home_bound_v1.resource_control WHERE singleton) IS DISTINCT FROM ${literal(identity)} AND caught_state IS NOT NULL THEN
      RAISE EXCEPTION 'HOME_DIAGNOSTIC_INSTALL_REJECTION_LEFT_EFFECT';
     END IF;
     INSERT INTO pg_temp.home_identity_diagnostic VALUES(pg_catalog.jsonb_build_object(
      'phase',CASE caught_state WHEN '23514' THEN 'INSTALL_CHECK' WHEN '23502' THEN 'INSTALL_NOT_NULL' ELSE 'STORED' END,
      'sqlState',caught_state,'constraintName',NULLIF(constraint_name,''),'columnName',NULLIF(column_name,'')));
    END $home_install_diagnostic$;
    SELECT result::text FROM pg_temp.home_identity_diagnostic;
    RELEASE SAVEPOINT home_identity_case;
    COMMIT;`);
   if(variant.phase==='RPC'){
    assert.equal(installation.phase,'STORED');assert.equal(installation.sqlState,null);
    rejection=await nativeRejection('RESOURCE_MISMATCH',variant.sqlState);
   }else{
    assert.equal(installation.phase,variant.phase);assert.equal(installation.sqlState,variant.sqlState);
   }
  }finally{await restoreIdentity();}
  assert.deepEqual(await snapshot(),baseline);
  const restoredPositive=await positive();
  return {expectedPhase:variant.phase,installation,rejection,restoredPositive,identityRestored:true};
 }
 try{
  const observed=await snapshot();assertBaseline(observed);baseline=observed;
  const collision=await ownerJson(`SELECT pg_catalog.jsonb_build_object('count',pg_catalog.count(*))::text FROM pg_catalog.pg_roles WHERE rolname IN (${text(extraRole)},${text(parentRole)});`);
  assert.equal(collision.count,0,'Diagnostic role names must be unused in this fresh resource');
  rolesAttempted=true;
  await owner(`BEGIN;
   CREATE ROLE ${quoted(extraRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   CREATE ROLE ${quoted(parentRole)} NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
   COMMIT;`);
  await runCase('REGISTERED_CAPTURE_BASELINE',async()=>({baseline,positive:await positive()}));
  await runCase('REGISTERED_CAPTURE_EXTRA_DIRECT_MEMBERSHIP',()=>membershipCase('LOGIN_DIRECT_COUNT',captureLogin,extraRole,'loginMemberships'));
  await runCase('REGISTERED_CAPTURE_COMPONENT_HAS_PARENT',()=>membershipCase('COMPONENT_PARENT_EXISTS',component,parentRole,'componentParents'));
  for(const variant of identityVariants())await runCase(`IDENTITY_${variant.name}`,()=>identityCase(variant));
 }catch(error){cases.push({name:'DIAGNOSTIC_RESOURCE_OR_HARNESS_FAILURE',status:'FAIL',...errorEvidence(error)});}
 finally{
  for(const session of [...sessions]){
   try{await close(session);}catch(error){cases.push({name:'DIAGNOSTIC_SESSION_CLOSE_FAILURE',status:'FAIL',...errorEvidence(error)});}
  }
  if(baseline){
   try{
    await restoreIdentity();
    if(rolesAttempted)await owner(`DO $home_cleanup$
     BEGIN
      IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=${text(extraRole)}) THEN
       REVOKE ${quoted(extraRole)} FROM ${quoted(captureLogin)};DROP ROLE ${quoted(extraRole)};
      END IF;
      IF EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname=${text(parentRole)}) THEN
       REVOKE ${quoted(parentRole)} FROM ${quoted(component)};DROP ROLE ${quoted(parentRole)};
      END IF;
     END $home_cleanup$;`);
    const restored=await snapshot();assert.deepEqual(restored,baseline);assertBaseline(restored);
    const absent=await ownerJson(`SELECT pg_catalog.jsonb_build_object('count',pg_catalog.count(*))::text FROM pg_catalog.pg_roles WHERE rolname IN (${text(extraRole)},${text(parentRole)});`);
    assert.equal(absent.count,0);assert.equal(sessions.size,0);await positive();cleanupVerified=true;
   }catch(error){cases.push({name:'DIAGNOSTIC_RESTORATION_FAILURE',status:'FAIL',...errorEvidence(error)});}
  }
 }
 const report={...HOME_DATABASE_FLAGS,schema:'HOME_DB_BOUND_V1_IDENTITY_DIAGNOSTICS',
  status:cases.some(c=>c.status==='FAIL')||!cleanupVerified?'FAIL':'PASS',
  resource:identity,scope:'SEPARATE_MAIN_OWNED_DIAGNOSTIC_RESOURCE',cases,
  passed:cases.filter(c=>c.status==='PASS').length,failed:cases.filter(c=>c.status==='FAIL').length,
  cleanup:{sessionsClosed:sessions.size===0,identityAndMembershipsRestored:cleanupVerified,resourceCleanupOwnedByMAIN:true},
  actualProviderCalls:0,realPublishingEnabled:false,operationalContinuity:'HOLD',
  limits:['DECODED_JSONB_NOT_ORIGINAL_REQUEST_BYTES','D0_ISOLATED_FIXTURE_ASSERTIONS_ONLY',
   'NO_REALTIME_32_OR_288_EVIDENCE','NO_REALCLOCK_MARKET_BOUNDARY_EVIDENCE',
   'CONTAINER_BOOTSTRAP_AND_CONTRACT_HASH_EXPECTATIONS_REMAIN_MAIN_OWNED']};
 await mkdir(output,{recursive:true});
 await writeFile(join(output,'home-database-identity-diagnostics.json'),JSON.stringify(report,null,2)+'\n','utf8');
 return report;
}
