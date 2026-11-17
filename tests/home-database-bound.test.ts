import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {HOME_DATABASE_FLAGS,HOME_DATABASE_PROFILE,HOME_DATABASE_PROFILES,HOME_DATABASE_ROLES,HOME_DATABASE_RPCS,HOME_DATABASE_IMAGE,HOME_GRAPH_FIELDS,homeData,homeRequestCanonical,validateHomeDatabaseRequest,validateHomeDatabaseReply,type HomeDatabaseReply,type HomeDatabaseResourceIdentity,type HomeDatabaseTransport,type JsonRecord} from '../workers/home-ranking/src/database-contracts.ts';
import {createHomeDatabaseEvaluator,isOwnedHomeDatabaseEvaluator,evaluateHomeDatabaseRound} from '../workers/home-ranking/src/database-evaluator.ts';
import {createHomeDatabaseAdapter,createHomeDatabaseCoordinator,isOwnedHomeDatabaseAdapter} from '../workers/home-ranking/src/database-adapter.ts';
import {SyntheticCompletedRanking} from '../packages/domain/src/pipeline-ranking.ts';
import {HOME_RANKING_POLICY,draftHomeRanking} from '../packages/domain/src/home-ranking.ts';
import {PRIORITY_POLICY} from '../packages/domain/src/issue-priority.ts';
import {SNAPSHOT_POLICY,deriveHomeContext} from '../packages/domain/src/home-snapshot.ts';
import {pipelineCanonical} from '../packages/contracts/src/pipeline.ts';

const id=(n:number)=>`10000000-0000-4000-8000-${n.toString(16).padStart(12,'0')}`;
const namespace=id(1),generation=id(2),resource=id(3),run=id(4),stream='test-home-db';
const hash=(v:string)=>createHash('sha256').update(v).digest('hex');
const copy=<T>(v:T):T=>JSON.parse(JSON.stringify(v));
const start=Date.parse('2026-11-17T00:00:00.000Z');
const stamp=(ms:number)=>new Date(ms).toISOString();
const identity:HomeDatabaseResourceIdentity={schema:'HOME_DB_BOUND_V1_RESOURCE',productId:'judoju-news',stage:'MAIN_PARALLEL_P4',component:'HOME_DB_BOUND_V1',resourceId:resource,runId:run,containerId:'a'.repeat(64),imageId:HOME_DATABASE_IMAGE,clusterSystemIdentifier:'12345',databaseName:'home_p4_test',databaseOid:'123',bootstrapUuid:id(5),contractSha256:'b'.repeat(64)};
const profile=HOME_DATABASE_PROFILE;
function segment(p=profile):string {
 const engine={ranking:HOME_RANKING_POLICY,priority:PRIORITY_POLICY,context:SNAPSHOT_POLICY};
 const versions={contractVersion:'JUDOJU_PIPELINE_K1',sampleKind:'SYNTHETIC',policyVersion:'k1-policy-'+hash(pipelineCanonical([p.profileId,engine])),catalogVersion:p.catalogVersion,sourcePolicyVersion:p.sourcePolicyVersion};
 return 'segment-'+hash(pipelineCanonical([versions,p.evaluationSetVersion,p.nonpriceScaleVersion]));
}
function fixture(at=start,p:typeof HOME_DATABASE_PROFILES[number]=profile,count=1){
 const calendar={calendarVersion:'calendar-fixture',evidenceId:'calendar-evidence',knownAt:stamp(start-86400000),validUntil:stamp(start+4*86400000),coverageStart:'2026-11-16',coverageEnd:'2026-11-20',days:['16','17','18','19','20'].map(d=>({date:`2026-11-${d}`,state:'OPEN'}))};
 const context={mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:stamp(at),policyVersion:SNAPSHOT_POLICY,catalogVersion:p.catalogVersion,comparisonSetVersion:p.comparisonSetVersion,evaluationSetVersion:p.evaluationSetVersion,signals:{T:false,M:false,P:false},calendar};
 const claims=Array.from({length:count},(_,n)=>({sampleKind:'SYNTHETIC',version:'claim-v1',claimId:`claim-${n}`,originId:`origin-${n}`,kind:'FILING',knownAt:stamp(start-300000),validUntil:stamp(at+7200000),verifiedAt:stamp(at-60000),status:'VERIFIED'}));
 const issues=claims.map((c,n)=>({issueId:`issue-${n}`,storyId:`story-${n}`,version:id(100+n),assessmentVersion:'assessment-v1',sampleKind:'SYNTHETIC',inputKnownAt:stamp(start-60000),publishedAt:stamp(start-1800000),materialChangeAt:stamp(start-1800000),lastVerifiedAt:stamp(at-60000),evidenceValidUntil:stamp(at+7200000),publicationState:'PUBLISHED',contentClass:'SECTOR_EVENT',impactState:'ACTIVE',direction:'POSITIVE',scope:'SECTOR',assessment:Object.fromEntries(['transmission','breadth','magnitude','persistence'].map(k=>[k,{grade:4,claimIds:[c.claimId]}]))}));
 const bindings=issues.map((i,n)=>({articleVersionId:i.version,publicationEffectKey:id(200+n),issueId:i.issueId,editorDraftRevision:'7',issueRevisionBefore:'0',issueRevisionAfter:'1',requestDigest:hash('request'+n),contentDigest:hash('content'+n),evidenceVersion:'evidence-v1',assessmentVersion:i.assessmentVersion,firstPublishedAt:i.publishedAt,materialChangeAt:i.materialChangeAt,graph:Object.fromEntries(HOME_GRAPH_FIELDS.map(k=>[k,k==='decisionInputRevisionIds'?[`source-${n}`]:k==='macroClaimIds'?[]:[`claim-${n}`]]))}));
 return {profileManifestId:p.manifestId,profileId:p.profileId,nonpriceScaleVersion:p.nonpriceScaleVersion,catalogVersion:p.catalogVersion,evaluationSetVersion:p.evaluationSetVersion,rankingCutoff:stamp(at),context,claims,issues,sectors:issues.map(i=>({issueId:i.issueId,primarySectorId:'sector-1'})),bindings};
}
function envelope(operation:string,result:unknown,role='home_v1_capture_worker',effect?:string,request?:unknown):any {
 const suffix=({home_v1_capture_worker:'capture',home_v1_commit_worker:'commit',home_v1_fixture_writer:'fixture',home_v1_internal_reader:'read'} as Record<string,string>)[role];
 return {...HOME_DATABASE_FLAGS,resourceId:resource,namespaceId:operation==='resource_identity'?null:namespace,backendGeneration:operation==='resource_identity'?null:generation,principal:{sessionUser:`h4_${run.replaceAll('-','')}_${suffix}`,sessionUserOid:'55',componentRole:role,resourceId:resource,runId:run},serverCheckedAt:stamp(start),operation,result,...(effect?{effectKey:effect,requestDigest:hash(homeRequestCanonical({schema:'HOME_DB_BOUND_V1_REQUEST',resourceId:resource,namespaceId:namespace,backendGeneration:generation,operation,request})),status:'APPLIED'}:{})};
}
function captured(input=fixture(),previous:any=null,global=1,local=1,round=id(10)){
 const expectedHead=previous?{revision:String(global-1),roundId:previous.roundId,digest:previous.digest}:{revision:'0',roundId:null,digest:null};
 const snapshotCanonical=JSON.stringify({inputBatch:input,previousCompleted:previous});
 const request={namespaceId:namespace,effectKey:id(20),roundId:round,streamId:stream,rankingCutoff:input.rankingCutoff,expectedHead,supersedesRoundId:null};
 const approved=HOME_DATABASE_PROFILES.find(p=>p.manifestId===input.profileManifestId)!;
 return envelope('capture_round',{roundId:round,streamId:stream,rankingCutoff:input.rankingCutoff,expectedHead,producerRevision:'1',inputDigest:hash(snapshotCanonical),slotGeneration:'1',plannedGlobalRevision:String(global),plannedLocalRevision:String(local),segmentKey:segment(approved as any),snapshotCanonical},'home_v1_capture_worker',request.effectKey,request);
}
test('PURE_FIXED_TIME: exact flags are immutable and true/missing/alias responses are rejected',()=>{
 const good=captured();assert.doesNotThrow(()=>validateHomeDatabaseReply('capture_round',good));
 for(const change of [(x:any)=>x.commitTimeQualificationProven=true,(x:any)=>delete x.commitTimeQualificationProven,(x:any)=>{delete x.commitTimeQualificationProven;x.physicalCommitTimeQualificationProven=false;}]){const x=copy(good);change(x);assert.throws(()=>validateHomeDatabaseReply('capture_round',x));}
 assert.throws(()=>{(HOME_DATABASE_FLAGS as any).commitTimeQualificationProven=true;},TypeError);
 assert.throws(()=>{(HOME_DATABASE_PROFILES[0] as any).profileId='LIVE';},TypeError);
 assert.throws(()=>{(HOME_DATABASE_PROFILES as any).push({});},TypeError);
 assert.throws(()=>{(HOME_DATABASE_ROLES as any).push('owner');},TypeError);assert.throws(()=>{(HOME_DATABASE_RPCS as any).push('raw_sql');},TypeError);
});
test('descriptors and nested Proxy traps are rejected before executing user code',()=>{
 let invoked=0;const getter=Object.defineProperty({},'value',{enumerable:true,get(){invoked++;return 1;}});
 const proxy=new Proxy({value:1},{getPrototypeOf(){invoked++;throw Error('trap');},ownKeys(){invoked++;return [];}});
 for(const value of [getter,{nested:proxy},[proxy],Object.assign(Object.create({}),{value:1})])assert.throws(()=>homeData(value));
 assert.equal(invoked,0);
});
test('decoded canonical values are precomputable and different original formatting is not certified',()=>{
 assert.equal(homeRequestCanonical({b:1,a:'한글\n"\\'}),homeRequestCanonical(JSON.parse('{"a":"한글\\n\\\"\\\\","b":1.0}')));
 assert.equal(homeRequestCanonical(JSON.parse('{"outer":{"x":0,"x":1}}')),homeRequestCanonical({outer:{x:1}}));
 assert.throws(()=>homeRequestCanonical({value:.5}));assert.throws(()=>validateHomeDatabaseRequest('get_head',{namespaceId:namespace,streamId:stream,role:'owner'}));
});
test('DB context off-all is checked before the explicit engine-only omission',()=>{
 const evaluator=createHomeDatabaseEvaluator(),c=captured();const evaluated=evaluateHomeDatabaseRound(evaluator,c),result=JSON.parse(evaluated.resultCanonical);
 assert.deepEqual(result.rankingState.contextInput.signals,{T:false,M:false,P:false});
 const input=fixture();assert.equal(draftHomeRanking({mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',policyVersion:HOME_RANKING_POLICY,context:input.context,priority:{},sectors:[],previous:null}).status,'INVALID_INPUT');
 for(const signals of [{T:true,M:false,P:false},{T:false,M:false},null]){const bad=fixture();(bad.context as any).signals=signals;assert.throws(()=>evaluateHomeDatabaseRound(evaluator,captured(bad)));}
});
test('owned evaluator and complete prior state are required; returned values are detached',()=>{
 const e=createHomeDatabaseEvaluator();assert(isOwnedHomeDatabaseEvaluator(e));assert(!isOwnedHomeDatabaseEvaluator(new Proxy(e,{})));
 assert.throws(()=>evaluateHomeDatabaseRound({...e},captured()));
 const c=captured(),out=evaluateHomeDatabaseRound(e,c);out.resultCanonical='changed';assert.notEqual(evaluateHomeDatabaseRound(e,c).resultCanonical,'changed');
 const bad=copy(c);bad.result.snapshotCanonical+=' ';assert.throws(()=>evaluateHomeDatabaseRound(e,bad));
 assert.throws(()=>evaluateHomeDatabaseRound(e,captured(fixture(start+300000),null,2)));
});
test('PURE_FIXED_TIME first 32 compare original engine until its unchanged aggregate boundary',()=>{
 const oracle=new SyntheticCompletedRanking('oracle-home-db',32),e=createHomeDatabaseEvaluator();let previous:any=null,matched=0,originalBound=false;
 for(let n=0;n<32;n++){
  const input=fixture(start+n*300000),c=captured(input,previous,n+1,n+1,id(1000+n)),result=evaluateHomeDatabaseRound(e,c),decoded=JSON.parse(result.resultCanonical);
  const {signals:_off,...context}=input.context;
  const command={sampleKind:'SYNTHETIC',snapshotId:id(1000+n),expectedRevision:n,profileId:profile.profileId,nonpriceScaleVersion:profile.nonpriceScaleVersion,sourcePolicyVersion:profile.sourcePolicyVersion,recipe:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',policyVersion:HOME_RANKING_POLICY,context,priority:{mode:'LOCAL_SYNTHETIC',sampleKind:'SYNTHETIC',cutoff:input.rankingCutoff,policyVersion:PRIORITY_POLICY,catalogVersion:profile.catalogVersion,evaluationSetVersion:profile.evaluationSetVersion,claims:input.claims,issues:input.issues},sectors:input.sectors}};
  let before=JSON.stringify(oracle.export());
  try{oracle.propose(command);before=JSON.stringify(oracle.export());const original=oracle.complete(command.snapshotId,n).snapshot;assert.deepEqual(decoded.rankingState,original.result.state);assert.equal(decoded.segmentKey,original.segmentKey);matched++;}
  catch(error){if(error instanceof assert.AssertionError)throw error;assert.equal((error as any).code,'INVALID_INPUT');assert.equal(JSON.stringify(oracle.export()),before);originalBound=true;break;}
  previous={roundId:c.result.roundId,digest:result.resultDigest,globalRevision:String(n+1),localRevision:String(n+1),segmentKey:decoded.segmentKey,rankingState:decoded.rankingState};
 }
 assert(matched>0);assert(matched===32||originalBound);assert.equal(oracle.diagnostics().capacity,32);
});
test('PURE_FIXED_TIME 288 rounds use one whole previous state, with restart and A/B/A segment counters',()=>{
 let previous:any=null;const counters=new Map<string,number>();let evaluator=createHomeDatabaseEvaluator();
 for(let n=0;n<288;n++){
  const p=HOME_DATABASE_PROFILES[n>=40&&n<44?1:0],input=fixture(start+n*300000,p),key=segment(p as any),local=(counters.get(key)??0)+1;
  if(n===144){previous=copy(previous);evaluator=createHomeDatabaseEvaluator();}
  const c=captured(input,previous,n+1,local,id(2000+n)),out=evaluateHomeDatabaseRound(evaluator,c),result=JSON.parse(out.resultCanonical);
  assert.equal(result.rankingState.records[0].publishedAt,stamp(start-1800000));assert.equal(result.plannedGlobalRevision,String(n+1));
  assert(result.rankingState.seen.length<=600);assert(result.rankingState.records.length<=300);assert(Buffer.byteLength(out.resultCanonical)<65536);
  counters.set(key,local);previous={roundId:c.result.roundId,digest:out.resultDigest,globalRevision:String(n+1),localRevision:String(local),segmentKey:key,rankingState:result.rankingState};
 }
 assert.equal(counters.get(segment()),284);assert.equal(counters.size,2); // Not real RPC time or DB durability evidence.
});
test('PURE_FIXED_TIME Korean 08:10/20:00 and closed-day boundaries use original context policy',()=>{
 for(const [time,basis] of [['2026-11-16T23:05:00.000Z','FOREIGN_US'],['2026-11-16T23:10:00.000Z','KR_COMBINED'],['2026-11-17T11:00:00.000Z','FOREIGN_US']]){const c=fixture(Date.parse(time!)).context;const derived=deriveHomeContext(c);assert.equal(derived.status,'DRAFT_SYNTHETIC');if(derived.status==='DRAFT_SYNTHETIC')assert.equal(derived.value.marketBasis,basis);}
 const c=fixture().context;c.calendar.days.find(d=>d.date==='2026-11-17')!.state='CLOSED';const d=deriveHomeContext(c);assert.equal(d.status,'DRAFT_SYNTHETIC');if(d.status==='DRAFT_SYNTHETIC')assert.equal(d.value.marketBasis,'FOREIGN_US');
});

function mock(){
 let committed:any=null,expired=false,ackLost=false;const calls:any[]=[];const receipts=new Map<string,any>();
 const transport:HomeDatabaseTransport=async call=>{
  calls.push(copy(call));const r=call.args.p_request;let result:any;
  if(call.rpc==='resource_identity')return envelope(call.rpc,{resourceIdentity:identity,postmasterStartedAt:stamp(start)},call.role);
  if(call.rpc==='get_head')return envelope(call.rpc,{head:committed?.result.head??{revision:'0',roundId:null,digest:null},activeProfileManifestId:profile.manifestId,inputRevision:'1'},call.role);
  if(call.rpc==='capture_round'){const c=captured();Object.assign(c.result,{roundId:r.roundId,rankingCutoff:r.rankingCutoff});return envelope(call.rpc,c.result,call.role,r.effectKey as string,r);}
  if(call.rpc==='commit_round'){
   const key=String(r.effectKey),existing=receipts.get(key);if(existing)return {...copy(existing),status:'REUSED'};
   const value=JSON.parse(r.resultCanonical as string);result={roundId:r.roundId,roundState:'COMPLETED',head:{revision:'1',roundId:r.roundId,digest:hash(r.resultCanonical as string)},globalRevision:'1',localRevision:'1',slotGeneration:'1',inputDigest:r.inputDigest,resultDigest:hash(r.resultCanonical as string),qualificationCheckedAt:stamp(start)};
   const receipt=envelope(call.rpc,result,call.role,r.effectKey as string,r);receipts.set(key,copy(receipt));committed=copy(receipt);(committed as any).lanes=value.lanes;if(ackLost)throw Error('ACK_LOST');return receipt;
  }
  if(call.rpc==='lookup_effect'){const receipt=receipts.get(String(r.effectKey));return envelope(call.rpc,receipt?{state:'APPLIED',receipt:copy(receipt)}:{state:'UNKNOWN'},call.role);}
  if(call.rpc==='read_current_home'){const lanes={A:[],B:[],C:[]} as any;for(const l of ['A','B','C'])lanes[l]=expired?[]:(committed?.lanes[l]??[]).map((x:any)=>({issueId:x.issueId,articleVersionId:x.articleVersionId}));return envelope(call.rpc,{state:expired?'CALCULATING':'FRESH',checkedAt:stamp(start),rankingCutoff:stamp(start),snapshotId:expired?null:committed?.result.roundId,sourceCutoff:expired?null:stamp(start),marketBasis:expired?null:'KR_COMBINED',targetKrTradingDay:expired?null:'2026-11-17',lanes},call.role);}
  throw Error('UNSUPPORTED');
 };
 const adapter=createHomeDatabaseAdapter({namespaceId:namespace,streamId:stream,expectedResourceIdentity:identity,transport});return {adapter,transport,calls,expire(){expired=true;},loseAck(){ackLost=true;}};
}
const captureRequest=()=>({namespaceId:namespace,effectKey:id(20),roundId:id(10),streamId:stream,rankingCutoff:stamp(start),expectedHead:{revision:'0',roundId:null,digest:null},supersedesRoundId:null});
test('owned coordinator rejects raw commands/foreign handles; summary and replies are copies',async()=>{
 const m=mock(),e=createHomeDatabaseEvaluator();assert(isOwnedHomeDatabaseAdapter(m.adapter));assert(!isOwnedHomeDatabaseAdapter(new Proxy(m.adapter,{})));
 assert.throws(()=>createHomeDatabaseCoordinator({adapter:{...m.adapter},evaluator:e}));
 const c=createHomeDatabaseCoordinator({adapter:m.adapter,evaluator:e}),other=createHomeDatabaseCoordinator({adapter:m.adapter,evaluator:e});
 await assert.rejects(c.captureEvaluate({...captureRequest(),streamId:'wrong'}));assert.equal(m.calls.length,0);
 const handle=await c.captureEvaluate(captureRequest()),summary=c.inspectPrepared(handle);summary.expectedHead.revision='99';assert.equal(c.inspectPrepared(handle).expectedHead.revision,'0');
 assert.throws(()=>other.inspectPrepared(handle));assert.throws(()=>c.inspectPrepared({...handle}));
 const receipt=await c.commitPrepared(handle,id(30));receipt.result.globalRevision='999';assert.equal((await c.commitPrepared(handle,id(30))).result.globalRevision,'1');
 const fresh=await c.readCurrentHome();assert.equal(fresh.result.state,'FRESH');m.expire();const blocked=await c.readCurrentHome();assert.equal(blocked.result.state,'CALCULATING');assert.deepEqual(blocked.result.lanes,{A:[],B:[],C:[]});
});
test('ACK-lost commit recovers the same precomputable intent and historical receipt',async()=>{
 const m=mock(),c=createHomeDatabaseCoordinator({adapter:m.adapter,evaluator:createHomeDatabaseEvaluator()}),handle=await c.captureEvaluate(captureRequest());m.loseAck();
 await assert.rejects(c.commitPrepared(handle,id(30)),/ACK_LOST/);
 const sent=m.calls.find(x=>x.rpc==='commit_round').args.p_request,digest=hash(homeRequestCanonical({schema:'HOME_DB_BOUND_V1_REQUEST',resourceId:resource,namespaceId:namespace,backendGeneration:generation,operation:'commit_round',request:sent}));
 const found=await c.lookupEffect({namespaceId:namespace,operation:'commit_round',effectKey:id(30),requestDigest:digest,backendGeneration:generation});assert.equal(found.result.state,'APPLIED');assert.equal((found.result.receipt as JsonRecord).commitTimeQualificationProven,false);
 assert.equal((await c.commitPrepared(handle,id(30))).status,'REUSED');assert(m.calls.filter(x=>x.rpc==='commit_round').every(x=>x.args.p_request.effectKey===id(30)));
});
test('near-boundary JSON is accepted within original budgets; oversized input never dispatches',async()=>{
 assert.equal((homeData({value:'x'.repeat(65536)}) as JsonRecord).value,'x'.repeat(65536));assert.throws(()=>homeData({value:'x'.repeat(65537)}));
 const m=mock(),c=createHomeDatabaseCoordinator({adapter:m.adapter,evaluator:createHomeDatabaseEvaluator()});await assert.rejects(c.captureEvaluate({...captureRequest(),payload:'x'.repeat(262145)}));assert.equal(m.calls.length,0);
});
test('body-only references cannot be hidden by grade-only engine admission',()=>{
 const input=fixture(start,profile,2);input.issues.splice(1);input.sectors.splice(1);input.bindings.splice(1);
 input.bindings[0]!.graph.analysisEvidenceIds.push('claim-1');input.bindings[0]!.graph.decisionClaimIds.push('claim-1');input.bindings[0]!.graph.decisionInputRevisionIds.push('source-1');
 for(const status of ['RETRACTED','UNVERIFIED']){const changed=copy(input);changed.claims[1]!.status=status;assert.throws(()=>evaluateHomeDatabaseRound(createHomeDatabaseEvaluator(),captured(changed)));}
 const expired=copy(input);expired.claims[1]!.validUntil=stamp(start);assert.throws(()=>evaluateHomeDatabaseRound(createHomeDatabaseEvaluator(),captured(expired)));
});
test('trusted transport COMMIT-ACK promise controls successful coordinator resolution',async()=>{
 const m=mock();let release!:()=>void,entered!:()=>void;const ack=new Promise<void>(r=>{release=r;}),sent=new Promise<void>(r=>{entered=r;});
 const transport:HomeDatabaseTransport=async call=>{const reply=await m.transport(call);if(call.rpc==='commit_round'){entered();await ack;}return reply;};
 const c=createHomeDatabaseCoordinator({adapter:createHomeDatabaseAdapter({namespaceId:namespace,streamId:stream,expectedResourceIdentity:identity,transport}),evaluator:createHomeDatabaseEvaluator()}),handle=await c.captureEvaluate(captureRequest());
 let returned=false;const pending=c.commitPrepared(handle,id(90)).then(r=>{returned=true;return r;});await sent;await Promise.resolve();assert.equal(returned,false);release();assert.equal((await pending).status,'APPLIED');
});
