import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {renderAdminPreviewSql,previewSqlOwnerEmailSha256} from '../scripts/admin-preview-sql.mjs';
import {actualOwner,actualHash,actualCanonical,validateActualOwner,makeActualDecision,checkActualApproval,
  launchStatement,validateLaunchAck,checkLiveLease,makeLoginJournalEntry,appendLoginJournal,validateLoginJournal,createActualSetupBudget,actualSetupAllowance} from '../apps/admin/lib/preview-actual-lifecycle.mjs';
import {actualRequestSpec,selectActualKeyMetadata,validateAuthOwner,bindStoredActualDecision} from '../scripts/admin-preview-actual-setup.mjs';
import {createPreviewFixtureRoot,verifyPrivatePreviewFixture,nativeBoundary,actualSupervisorReceipt,controlledEnvironment} from '../apps/admin/lib/preview-file-boundary.mjs';
import vm from 'node:vm';
import {seal,unseal,AdminError,hash} from '../apps/admin/lib/runtime-local.mjs';
import {confirmedSqlRejection} from '../apps/admin/lib/editor-state.mjs';
import path from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {allowedHostedPullRef} from '../scripts/native-release-policy.mjs';
import {createServer} from 'node:net';
import {spawnSync} from 'node:child_process';

const syntheticEmail='owner@judoju-c2.invalid';
const syntheticOwner={...actualOwner,emailSha256:actualHash(syntheticEmail)};
const template=readFileSync(new URL('../supabase/cloud/admin-preview-dev/activation-template.sql',import.meta.url),'utf8');
const fixture=()=>makeActualDecision(template,{effectKey:'11111111-1111-4111-8111-111111111111',
  expiresAt:'2026-11-18T03:00:00.000Z',implementationManifestSha256:'b'.repeat(64),prestateSha256:'c'.repeat(64),
  publishableKeyId:'publishable-fixture-id',secretKeyId:'secret-fixture-id',observedAt:'2026-11-18T01:00:00.000Z'},renderAdminPreviewSql);
const owner=()=>({id:actualOwner.id,created_at:actualOwner.createdAt,confirmed_at:'2026-11-17T19:44:19.140779+00:00',
  anonymous:false,sso:false,deleted:false,banned:false,email_sha256:actualOwner.emailSha256,metadata_email_only:true,identity_count:1,email_identity_count:1});
const ack=b=>({launchEffect:b.decision.launchEffect,ownerUserId:actualOwner.id,decisionSha256:b.decisionSha256,serverTime:'2026-11-18T01:01:00.000Z',expiresAt:'2026-11-18T01:31:00.000Z'});
test('Only the uniquely reobserved confirmed email identity can become the selected owner',()=>{
  assert.equal(validateActualOwner(owner()).id,actualOwner.id);
  for(const [key,value] of [['id','22222222-2222-4222-8222-222222222222'],['created_at','2020-01-01T00:00:00Z'],['confirmed_at',null],['anonymous',true],['sso',true],['deleted',true],['banned',true],['email_sha256','d'.repeat(64)],['identity_count',2],['email_identity_count',0],['metadata_email_only',false]])assert.throws(()=>validateActualOwner({...owner(),[key]:value}),/HOLD/);
});
test('Decision binds exact final SQL without hashing a decision into itself',()=>{
  const b=fixture();assert.equal(actualHash(b.sql),b.sqlSha256);assert.equal(actualHash(actualCanonical(b.decision)),b.decisionSha256);
  assert.ok(b.sql.includes(b.decisionSha256));assert.ok(!b.sql.includes(b.sqlSha256));
  const p=renderAdminPreviewSql(template,{ownerUserId:actualOwner.id,effectKey:b.decision.effectKey,expiresAt:b.decision.expiresAt,implementationManifestSha256:b.decision.implementationManifestSha256,decisionSha256:'0'.repeat(64)});
  assert.equal(actualHash(p.sql),b.decision.sqlPreimageSha256);
  const changed=makeActualDecision(template,{effectKey:b.decision.effectKey,expiresAt:b.decision.expiresAt,implementationManifestSha256:'b'.repeat(64),prestateSha256:'c'.repeat(64),publishableKeyId:'different-id',secretKeyId:'secret-fixture-id',observedAt:b.decision.observedAt},renderAdminPreviewSql);
  assert.notEqual(b.decisionSha256,changed.decisionSha256);
});
test('User approval is separate and cannot approve a different owner, implementation or SQL',()=>{
  const b=fixture(),a={schemaVersion:1,ownerUserId:actualOwner.id,decisionSha256:b.decisionSha256,sqlSha256:b.sqlSha256,implementationManifestSha256:b.decision.implementationManifestSha256,confirmationReference:'fixture:user-action:123',confirmedAt:'2026-11-18T01:00:01.000Z'};
  assert.equal(checkActualApproval(a,b).sqlSha256,b.sqlSha256);
  for(const key of ['ownerUserId','decisionSha256','sqlSha256','implementationManifestSha256','confirmationReference'])assert.throws(()=>checkActualApproval({...a,[key]:'wrong'},b),/HOLD/);
  assert.throws(()=>checkActualApproval({...a,confirmedAt:b.decision.expiresAt},b),/HOLD/);
});
test('First launch uses fixed parameterized server CAS, never a caller-supplied SQL URL or fresh launch ID',()=>{
  const b=fixture(),q=launchStatement(b);
  assert.equal(q.parameters[0],actualOwner.id);assert.equal(q.parameters[4],b.decision.effectKey);
  for(const text of ['launched_at is null','host_lease_expires_at is null','clock_timestamp()','c.expires_at=$6','auth.identities','private.admin_memberships'])assert.ok(q.query.includes(text));
  assert.ok(!q.query.includes(b.decisionSha256));
});
test('Network time is conservatively subtracted and no local wall clock can extend the live lease',()=>{
  const b=fixture(),l=validateLaunchAck(ack(b),b,1000,4500);
  assert.equal(l.remainingMs,1800000-3500);assert.equal(checkLiveLease(l,4500),Date.parse(l.serverTime)+3500);
  assert.equal(checkLiveLease(l,5500),Date.parse(l.serverTime)+4500);
  assert.throws(()=>checkLiveLease(l,4499),/MONOTONIC/);
  assert.throws(()=>checkLiveLease(l,4500+l.remainingMs),/LEASE_EXPIRED/);
  assert.throws(()=>validateLaunchAck(ack(b),b,1000,1801000),/LAUNCH_EXPIRED/);
  for(const [k,v]of[['remainingMs',1800000],['authoritativeNow',0],['expiresAt',b.decision.expiresAt],['receivedTicks',-1]])assert.throws(()=>checkLiveLease({...l,[k]:v},5000),/HOLD/);
});
test('Expired, replaced or ambiguous launch ACKs never become an activation',()=>{
  const b=fixture(),a=ack(b);
  for(const [k,v]of[['launchEffect','22222222-2222-4222-8222-222222222222'],['ownerUserId','22222222-2222-4222-8222-222222222222'],['decisionSha256','d'.repeat(64)],['serverTime','2026-11-18T04:00:00.000Z'],['expiresAt','2026-11-18T01:31:00.001Z']])assert.throws(()=>validateLaunchAck({...a,[k]:v},b,0,1),/HOLD/);
  assert.throws(()=>validateLaunchAck({...a,unapproved:true},b,0,1),/SHAPE/);
});
test('Login intent precedes Auth/open, preserves same-generation body identity and carries no credentials',()=>{
  const e={generation:1,phase:'BEFORE_AUTH',ownerUserId:actualOwner.id,authSessionId:null,capabilityHash:null};
  let j=appendLoginJournal([],e);assert.deepEqual(appendLoginJournal(j,e),j);
  assert.throws(()=>appendLoginJournal(j,{...e,authSessionId:'11111111-1111-4111-8111-111111111111'}),/HOLD/);
  const open={...e,phase:'BEFORE_OPEN',authSessionId:'11111111-1111-4111-8111-111111111111',capabilityHash:'a'.repeat(64)};
  j=appendLoginJournal(j,open);assert.throws(()=>appendLoginJournal(j,{...open,capabilityHash:'b'.repeat(64)}),/EFFECT_CONFLICT/);
  j=appendLoginJournal(j,{...open,phase:'RESIDUAL'});assert.equal(j.at(-1).phase,'RESIDUAL');
  assert.throws(()=>makeLoginJournalEntry({...open,credential:'SYNTHETIC_MUST_NOT_LOG'}),/SHAPE/);
  assert.throws(()=>appendLoginJournal(j,{...e,generation:3}),/SEQUENCE/);
  assert.equal(appendLoginJournal(j,{...e,generation:2}).at(-1).generation,2);
});
test('Untrusted accessors/proxies and noncanonical time do not execute or enter the proof',()=>{
  let calls=0;const x=owner();Object.defineProperty(x,'banned',{enumerable:true,get(){calls++;return false;}});
  assert.throws(()=>validateActualOwner(x),/DATA/);assert.equal(calls,0);
  assert.throws(()=>validateActualOwner(new Proxy(owner(),{})),/DATA/);
  assert.throws(()=>makeActualDecision(template,{...fixture().decision,observedAt:'2026-11-18T01:00:00Z'},renderAdminPreviewSql),/HOLD/);
});
test('Management/Auth request paths cannot change project, reveal all keys or assign another user/field',()=>{
  const binding=fixture();
  assert.ok(actualRequestSpec('KEY_METADATA').url.endsWith('/nxfpfvsdwbziowkxsxnh/api-keys?reveal=false'));
  assert.ok(actualRequestSpec('KEY_VALUE',{binding,keyId:binding.decision.secretKeyId}).url.endsWith('/secret-fixture-id?reveal=true'));
  for(const keyId of ['other-id','../other-project','secret-fixture-id?reveal=true'])assert.throws(()=>actualRequestSpec('KEY_VALUE',{binding,keyId}),/HOLD/);
  for(const op of ['DELETE_USER','ROTATE_KEY','FIND_OTHER_PROJECTS','GET_URL','SIGN_UP','INVITE'])assert.throws(()=>actualRequestSpec(op),/HOLD/);
  const role=actualRequestSpec('AUTH_ROLE',{body:{app_metadata:{app_role:'admin',product_id:'judoju-news'}}});
  assert.equal(role.method,'PUT');assert.equal(role.credential,'SECRET');assert.ok(role.url.endsWith('/'+actualOwner.id));
  assert.throws(()=>actualRequestSpec('AUTH_ROLE',{body:{app_metadata:{app_role:'admin',product_id:'judoju-news',extra:true}}}),/HOLD/);
  assert.throws(()=>actualRequestSpec('AUTH_ROLE',{body:{user_metadata:{app_role:'admin',product_id:'judoju-news'}}}),/HOLD/);
  assert.throws(()=>actualRequestSpec('APPLY_SQL',{binding,body:{query:binding.sql+' '}}),/HOLD/);
  assert.throws(()=>actualRequestSpec('INSPECT',{body:{query:'select * from unrelated',parameters:[]}}),/HOLD/);
  assert.equal(bindStoredActualDecision(template,binding.decision,binding.sql).sqlSha256,binding.sqlSha256);
});
test('Key selection is metadata-only and ambiguous/revealed-secret results stop before private storage',()=>{
  assert.deepEqual(selectActualKeyMetadata([{name:'fixture public',id:'p',type:'publishable'},{name:'fixture secret',id:'s',type:'secret'}]),{publishableKeyId:'p',secretKeyId:'s'});
  for(const input of [[],[{id:'p',type:'publishable'},{id:'s',type:'secret'},{id:'s2',type:'secret'}],[{id:'p',type:'publishable'},{id:'s',type:'secret',api_key:'sb_secret_SYNTHETIC_NOT_A_REAL_KEY'}]])assert.throws(()=>selectActualKeyMetadata(input),/HOLD/);
});
test('Auth confirmation uses synthetic module-injected owner and observed server time',async()=>{
  const f=await operatorSimulation(null,{inspectOnly:true});
  const validateAuthOwner=f.validateOwner;
  const u={id:actualOwner.id,email:syntheticEmail,created_at:actualOwner.createdAt.replace('+00:00','Z'),email_confirmed_at:'2026-11-17T19:44:19.140779Z',is_anonymous:false,identities:[{provider:'email'}],app_metadata:{provider:'email',providers:['email']}};
  const options={serverTime:'2026-11-18T01:00:00.000Z',ownerObservation:{...owner(),email_sha256:syntheticOwner.emailSha256}};
  assert.equal(validateAuthOwner(u,options),true);
  assert.throws(()=>validateAuthOwner({...u,banned_until:'2026-11-18T01:01:00.000Z'},options),/HOLD/);
  assert.throws(()=>validateAuthOwner({...u,created_at:'2026-11-17T19:44:19.125037Z'},options),/HOLD/);
  assert.equal(Object.hasOwn(u,'is_sso_user'),false);
  assert.equal(validateAuthOwner({...u,is_sso_user:false},options),true);
  assert.throws(()=>validateAuthOwner(u,{serverTime:options.serverTime}),/HOLD/);
  assert.throws(()=>validateAuthOwner(u,{...options,ownerObservation:{...options.ownerObservation,sso:true}}),/HOLD/);
  assert.throws(()=>f.validateOwner(u,options,true),/HOLD/);
  assert.throws(()=>validateAuthOwner({...u,is_sso_user:true},options),/HOLD/);
  assert.throws(()=>validateAuthOwner({...u,app_metadata:{...u.app_metadata,app_role:'admin'}},options),/HOLD/);
  assert.equal(validateAuthOwner({...u,app_metadata:{...u.app_metadata,app_role:'admin',product_id:'judoju-news'}},{...options,roleApplied:true}),true);
});
test('Native Windows private-file engine proves protected ACL, exclusive writes, held parents and negative reads in a separate fixture',{skip:process.platform!=='win32'},()=>{
  const r=verifyPrivatePreviewFixture(createPreviewFixtureRoot());
  assert.equal(r.mode,'FIXTURE');assert.equal(r.actualBrandRegistered,false);assert.equal(r.actualKeysRead,0);assert.equal(r.actualHostStarted,false);
  assert.deepEqual(r.cases,['PROTECTED_OWNER_DACL_HANDLE_UTF8_FLUSH','NO_OVERWRITE','PARENT_RENAME_DENIED_WHILE_HELD','OTHER_PRINCIPAL_REJECTED_RESTORED_POSITIVE','MULTIPLE_HARDLINKS_REJECTED','INVALID_UTF8_REJECTED_AFTER_WRITE_NO_SUCCESS','FLUSH_FAILURE_PRESERVED_NOT_SUCCESS','ATOMIC_DIRECTORY_HANDLE_MARKER_HELD_THROUGH_USE','ROOT_REPLACEMENT_DENIED_AT_VALIDATION_USE_BOUNDARY','NATIVE_JOURNAL_SEQUENCE_POSITIVE','NATIVE_JOURNAL_CROSS_PHASE_BINDING_REJECTED','NATIVE_PERSISTED_JOURNAL_BINDING_REJECTED_BEFORE_RETURN','NATIVE_TWO_LOGINS_OLDER_FIRST_PERSISTED_CLOSE_AND_HIGH_WATER','NATIVE_TWO_LOGINS_NEWER_FIRST_PERSISTED_CLOSE_AND_HIGH_WATER','NATIVE_VALIDATION_TO_DELIVERY_WRITES_REPLACEMENTS_DENIED_SAME_SNAPSHOT','NATIVE_CHANGED_CONFIG_DIGEST_REJECTED_RESTORED_POSITIVE','CREATION_BOUND_CLEANUP_POSITIVE','CREATION_BOUND_CLEANUP_REPLACEMENT','CREATION_BOUND_CLEANUP_PARTIAL','CREATION_BOUND_CLEANUP_MISSING_RECEIPT','ORIGINAL_OPERATOR_LIVE_PARENT_IMAGE_CREATION_BOUND','OPERATOR_WRONG_CREATION_OR_IMMEDIATE_PARENT_REJECTED','NATIVE_SETUP_DEADLINE_POSITIVE_AND_EXPIRED_REJECTED','BOUNDED_INVENTORY_BATCH_1_TO_384_FIXED_LEAF_NAMES',
    'LATE_HOLD_FULL_SESSION_INVENTORY_STATUS','FULL_SESSION_CLEANUP_STATUS_CAPACITY','OVERSIZE_STATUS_INVENTORY_REJECTED']);
});

// Operator simulation: all provider/native responses below are asserted fixtures, never ACTUAL branding or I/O.
async function operatorSimulation(failure=null,{inspectOnly=false,sessionScenario=null,sessionCount=12,cli=false,hostReceipt=null}={}){
  const root=fileURLToPath(new URL('../',import.meta.url)),files=new Map(),calls=[];
  const canaries={PAT:'SYNTHETIC_OPERATOR_CANARY',SECRET:'sb_secret_SYNTHETIC_CANARY',PUBLISHABLE:'sb_publishable_SYNTHETIC_CANARY'};
  const state={auth:false,sql:false,enabled:false,membership:false,consumed:false,host:false,clock:100000,inspections:0,inventoryCalls:0,inventoryResponseBytes:[],cleanupAuth:!['AUTH_ABSENT'].includes(sessionScenario),cleanupApp:!['MISSING_APP','AUTH_ABSENT'].includes(sessionScenario)};
  let ticks=0,freshInspectionTicks=0;
  const fixturePerformance={now(){if(failure==='BUDGET_BEFORE_KEY'&&state.inspections>=2&&++freshInspectionTicks===2)ticks=300000;return ticks;}};
  const knownSession='33333333-3333-4333-8333-333333333333',knownHash='9'.repeat(64);
  const knownToken=[Buffer.from(JSON.stringify({alg:'SYNTHETIC'})).toString('base64url'),Buffer.from(JSON.stringify({sub:actualOwner.id,session_id:knownSession})).toString('base64url'),Buffer.from('SYNTHETIC_SIGNATURE_NOT_REAL').toString('base64url')].join('.');
  const many=sessionScenario==='LARGE_SESSIONS';
  const manySessions=many?Array.from({length:sessionCount},(_,i)=>{
    const authSessionId=(i+1).toString(16).padStart(8,'0')+'-3333-4333-8333-333333333333';
    const accessToken=[Buffer.from('{"alg":"SYNTHETIC"}').toString('base64url'),Buffer.from(JSON.stringify({sub:actualOwner.id,session_id:authSessionId,padding:'x'.repeat(9000)})).toString('base64url'),'SYNTHETIC_SIGNATURE'].join('.');
    return {authSessionId,capabilityHash:actualHash('fixture-session-'+i),accessToken,auth:true,app:true};
  }):[];
  const clone=x=>JSON.parse(JSON.stringify(x));
  const native=(op,p,options={})=>{
    calls.push({kind:'NATIVE',op,...(options.timeoutMs===undefined?{}:{timeoutMs:options.timeoutMs})});
    if(op==='OperatorIdentity'){const qpc=state.clock;state.clock+=1000;return {status:'PASS',pid:1234,created:'133700000000000000',image:'C:\\Program Files\\nodejs\\node.exe',qpc:String(qpc),frequency:'1000'};}
    if(op==='ReadOperatorToken')return {status:'PASS',bytes:Buffer.from(canaries.PAT).toString('base64')};
    if(op==='CreateActual'){assert.equal(files.size,0);files.set('actual-owner.json','FIXTURE_OWNER');return {status:'PASS'};}
    if(op==='ReadActualFile'){assert.ok(files.has(p.leaf));return {status:'PASS',bytes:Buffer.from(files.get(p.leaf)).toString('base64')};}
    if(op==='WriteActualFile'){
      assert.ok(!files.has(p.leaf),'exclusive fixture write');files.set(p.leaf,Buffer.from(p.bytes,'base64').toString());
      if(failure==='BUDGET_AFTER_AUTH_INTENT'&&p.leaf==='effect-auth-intent.json'||failure==='BUDGET_AFTER_SQL_INTENT'&&p.leaf==='effect-sql-intent.json')ticks=300000;
      if(failure==='SESSION_ACK_AUDIT_UNKNOWN'&&p.leaf==='session-cleanup-1-ack.json')throw Error(canaries.SECRET);
      if(failure==='CONFIG_UNKNOWN'&&p.leaf==='admin-server.json'||failure==='SQL_ACK_JOURNAL_UNKNOWN'&&p.leaf==='effect-sql-ack.json'||failure==='AUTH_ACK_JOURNAL_UNKNOWN'&&p.leaf==='effect-auth-ack.json')throw Error(canaries.SECRET);
      return {status:'PASS',leaf:p.leaf,sha256:actualHash(Buffer.from(p.bytes,'base64')),flushed:true,fileIdentity:'1:2:'+files.size+':4:5:6:7',rootId:'1:2:3:4:5'};
    }
    if(op==='ActualStatus')return {status:'PASS',files:[...files.keys()].sort()};
    if(op==='Clock'){const qpc=state.clock;state.clock+=1000;return {status:'PASS',qpc:String(qpc),frequency:'1000'};}
    if(op==='Supervise'){
      assert.deepEqual(p,{mode:'Actual'});assert.equal(state.consumed,true);assert.ok(files.has('approval.json'));assert.ok(files.has('launch-consumed.json'));
      if(hostReceipt){state.host=hostReceipt.created;return clone(hostReceipt);}
      state.host=failure!=='HOST_PORT_COLLISION';
      return {status:['HOST_FAILED_STOPPED','HOST_PORT_COLLISION','HOST_FAILED_PORT_BUSY'].includes(failure)?'HOLD':'PASS',mode:'Actual',created:state.host,
        cleanupObserved:failure!=='HOST_FAILED_PORT_BUSY',jobCleanupObserved:true,childExitedObserved:state.host?true:null,portClosedObserved:!['HOST_PORT_COLLISION','HOST_FAILED_PORT_BUSY'].includes(failure),
        reason:failure==='HOST_PORT_COLLISION'?'PORT_COLLISION':failure==='HOST_FAILED_PORT_BUSY'?'PORT_STILL_LISTENING':failure==='HOST_FAILED_STOPPED'?'CHILD_EXITED':'TTL_COMPLETE',fixtureAssertionOnly:true};
    }
    if(op==='ReadActualJournal'){
      if(!sessionScenario)return {status:'PASS',frames:[]};
      const first={generation:1,phase:'BEFORE_AUTH',ownerUserId:actualOwner.id,authSessionId:null,capabilityHash:null};
      if(many){const entries=manySessions.flatMap((r,i)=>[{...first,generation:i+1},{...first,generation:i+1,phase:'BEFORE_OPEN',authSessionId:r.authSessionId,capabilityHash:r.capabilityHash},{...first,generation:i+1,phase:'COMPLETE',authSessionId:r.authSessionId,capabilityHash:r.capabilityHash}]);return {status:'PASS',frames:entries.map(e=>{const bytes=Buffer.from(actualCanonical(e));return {bytes:bytes.toString('base64'),sha256:actualHash(bytes)};})};}
      const entries=[first];if(sessionScenario!=='UNKNOWN_BEFORE_AUTH')entries.push({...first,phase:'BEFORE_OPEN',authSessionId:knownSession,capabilityHash:knownHash});
      if(!['UNKNOWN_BEFORE_AUTH','MISSING_APP','AUTH_ABSENT'].includes(sessionScenario))entries.push({...entries.at(-1),phase:'COMPLETE'});
      return {status:'PASS',frames:entries.map(e=>{const bytes=Buffer.from(actualCanonical(e));return {bytes:bytes.toString('base64'),sha256:actualHash(bytes)};})};
    }
    if(op==='DeleteActualSecrets'){
      assert.equal(state.host,true);assert.equal(state.enabled,false);assert.ok(files.has('effect-fence-ack.json'));
      const leaves=['admin-server.json','activation-proof.json','activation-expected.json'];
      if(failure==='CLEANUP_PARTIAL'||failure==='CLEANUP_RESPONSE_UNKNOWN')files.delete(leaves[0]);
      else if(failure!=='CLEANUP_NO_RECEIPT')for(const x of leaves)files.delete(x);
      if(failure==='CLEANUP_RESPONSE_UNKNOWN')throw Error(canaries.SECRET);
      const partial=failure==='CLEANUP_PARTIAL',missing=failure==='CLEANUP_NO_RECEIPT';
      return {schemaVersion:1,ownerUserId:actualOwner.id,rootId:'1:2:3:4:5',decisionSha256:actualHash(actualCanonical(JSON.parse(files.get('decision.json')))),status:partial||missing?'HOLD':'PASS',reason:partial?'FIXTURE_CLEANUP_INTERRUPTED':missing?'CLEANUP_CREATION_RECEIPT':'ACKNOWLEDGED',allVerified:!missing,anyDeletionAttempted:!missing,allDeleted:!partial&&!missing,auditRetained:true,files:leaves.map((leaf,i)=>({leaf,disposition:missing?'NOT_ATTEMPTED':partial&&i>0?'NOT_ATTEMPTED':'DELETED'}))};
    }
    throw Error('UNEXPECTED_FIXTURE_NATIVE');
  };
  const baseRow=activated=>({db_role:'supabase_read_only_user',read_only:true,preview_identity_count:1,project_identity_count:1,
    admin_control_present:activated,activation_record_present:activated,procedure_count:activated?179:178,
    history_versions:['20261114000000','20261114000001','20261115000101','20261115000102','20261116000103','20261116000104','20261116000105','20261116000106',...(activated?['20261116000107']:[])],
    selected_admin_matches:1,selected_admin_confirmed_active:1,selected_owner_candidates:[{...owner(),email_sha256:syntheticOwner.emailSha256}],function_baseline_count:activated?178:177,function_baseline_drift:[],catalog_company_count:339,
    active_admin_membership_count:activated?1:0,admin_session_count:0,rls_auto_enable_trigger_count:1,api_relation_access:[],
    api_schema_usage:['anon','authenticated','service_role'].map(role=>({role,schema:'public'})),
    anon_execute_names:['catalog_public_articles','catalog_public_company_sectors','catalog_public_saved','catalog_public_search_companies','catalog_public_search_news','catalog_public_sector_page','catalog_public_tree','m1_public_article','m1_public_identity','rls_auto_enable'],
    authenticated_execute_names:['rls_auto_enable',...(activated?editorFunctions:[])].sort(),service_role_execute_names:['rls_auto_enable',...(activated?serverFunctions:[])].sort(),server_observed_at:state.inspections++===0?'2026-11-18T01:00:00.000Z':failure==='FUTURE_APPROVAL'?'2026-11-18T01:00:00.000Z':failure==='SHORT_HEADROOM'?'2026-11-18T02:40:00.000Z':failure==='EQUAL_HEADROOM'?'2026-11-18T02:24:55.000Z':'2026-11-18T01:00:02.000Z'});
  const user=()=>({id:actualOwner.id,email:syntheticEmail,created_at:actualOwner.createdAt,email_confirmed_at:'2026-11-17T19:44:19.140779Z',is_anonymous:false,
    identities:[{provider:'email'}],app_metadata:{provider:'email',providers:['email'],...(state.auth?{app_role:'admin',product_id:'judoju-news'}:{})}});
  const fetcher=async(url,init)=>{
    const body=init.body===undefined?undefined:JSON.parse(init.body);calls.push({kind:'HTTP',url,method:init.method,body});
    const u=new URL(url);assert.ok(['api.supabase.com','nxfpfvsdwbziowkxsxnh.supabase.co'].includes(u.hostname));
    if(u.hostname==='api.supabase.com'){assert.equal(init.headers.Authorization,'Bearer '+canaries.PAT);assert.ok(u.pathname.startsWith('/v1/projects/nxfpfvsdwbziowkxsxnh/'));}
    const answer=data=>new Response(JSON.stringify(data),{status:200});
    if(u.pathname.endsWith('/api-keys')&&u.search==='?reveal=false')return answer([{name:'fixture public',id:'p',type:'publishable'},{name:'fixture secret',id:'s',type:'secret'}]);
    if(u.pathname.endsWith('/api-keys/p'))return answer({id:'p',type:'publishable','api_key':canaries.PUBLISHABLE});
    if(u.pathname.endsWith('/api-keys/s'))return answer({id:'s',type:'secret','api_key':canaries.SECRET});
    if(u.pathname.endsWith('/admin/users/'+actualOwner.id)){
      assert.equal(init.headers.apikey,canaries.SECRET);assert.equal(init.headers.Authorization,undefined);
      if(init.method==='GET')return answer(user());
      assert.equal(init.method,'PUT');assert.deepEqual(body,{app_metadata:{app_role:'admin',product_id:'judoju-news'}});state.auth=true;
      if(failure==='AUTH_UNKNOWN')throw Error(canaries.PAT+canaries.SECRET);return answer(user());
    }
    if(u.pathname.endsWith('/rpc/m1_public_identity'))return answer({productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',bootstrapId:null,contract:'M1'});
    if(u.pathname.endsWith('/rpc/m1_read_admin_session')){assert.equal(init.headers.apikey,canaries.SECRET);return answer(null);}
    if(u.pathname.endsWith('/auth/v1/logout')){
      assert.equal(init.headers.apikey,canaries.PUBLISHABLE);assert.equal(state.enabled,false);
      if(many){const r=manySessions.find(r=>init.headers.Authorization==='Bearer '+r.accessToken);assert.ok(r);assert.equal(r.auth,true);r.auth=false;return new Response(null,{status:204});}
      assert.equal(init.headers.Authorization,'Bearer '+knownToken);
      if(sessionScenario==='LOGOUT_TIMEOUT')throw Error(canaries.SECRET);
      if(sessionScenario==='LOGOUT_REJECT')return new Response(JSON.stringify({message:canaries.PAT}),{status:403});
      state.cleanupAuth=false;return new Response(null,{status:204});
    }
    const query=body?.query??'';
    if(query.includes('function_baseline_drift')){
      assert.equal(JSON.parse(body.parameters[0]).length,state.sql?178:177);assert.equal(body.parameters[1],syntheticOwner.emailSha256);return answer([baseRow(state.sql)]);
    }
    if(query.includes('create table private.admin_preview_control(')){
      assert.equal(state.auth,true);state.sql=true;state.enabled=true;state.membership=true;
      if(failure==='SQL_UNKNOWN')throw Error(canaries.SECRET);return answer([]);
    }
    if(query.startsWith('with t as materialized')){
      assert.equal(state.sql,true);assert.equal(state.consumed,false);state.consumed=true;
      if(failure==='LAUNCH_UNKNOWN')throw Error(canaries.PAT);
      const d=JSON.parse(files.get('decision.json'));
      return answer([{receipt:{launchEffect:d.launchEffect,ownerUserId:actualOwner.id,decisionSha256:actualHash(actualCanonical(d)),serverTime:'2026-11-18T01:01:00.000Z',expiresAt:'2026-11-18T01:31:00.000Z'}}]);
    }
    if(query.startsWith('with fence_lock')){
      assert.equal(state.sql,true);state.enabled=false;state.membership=false;if(failure==='FENCE_UNKNOWN')throw Error(canaries.PAT);
      return answer([{receipt:{ownerUserId:actualOwner.id,decisionSha256:body.parameters[1],enabled:false,membershipsStopped:1}}]);
    }
    if(query.startsWith('with known')&&query.includes('delete from private.admin_sessions')){
      assert.equal(state.enabled,false);let deleted=0;if(sessionScenario&&state.cleanupApp&&!state.cleanupAuth){state.cleanupApp=false;deleted=1;}
      if(many){deleted=0;for(const pair of JSON.parse(body.parameters[2])){const r=manySessions.find(r=>r.authSessionId===pair.authSessionId&&r.capabilityHash===pair.capabilityHash);assert.ok(r);if(!r.auth&&r.app){r.app=false;deleted++;}}}
      if(sessionScenario==='SESSION_REAPPEARS')state.cleanupAuth=true;
      return answer([{receipt:{deleted,fenced:true}}]);
    }
    if(query.startsWith('with known')){
      assert.equal(state.enabled,false);state.inventoryCalls++;
      if(failure==='SESSIONS_READ_UNKNOWN'||failure==='SESSIONS_READ_AFTER_LOGOUT_UNKNOWN'&&state.inventoryCalls===2)throw Error(canaries.SECRET);const pairs=JSON.parse(body.parameters[2]);
      const sessions=pairs.map(pair=>({user_id:actualOwner.id,auth_session_id:pair.authSessionId,capability_hash:pair.capabilityHash,auth_present:state.cleanupAuth,app_present:state.cleanupApp,app_conflict:false,
        ciphertext:state.cleanupApp?seal({userId:actualOwner.id,sessionId:knownSession,accessToken:knownToken,refreshToken:'SYNTHETIC_REFRESH_NOT_REAL'},JSON.parse(files.get('admin-server.json')).encryptionKey):null}));
      if(many)for(let i=0;i<pairs.length;i++){
        const r=manySessions.find(r=>r.authSessionId===pairs[i].authSessionId&&r.capabilityHash===pairs[i].capabilityHash);assert.ok(r);
        sessions[i]={...sessions[i],auth_present:r.auth,app_present:r.app,ciphertext:r.app?seal({userId:actualOwner.id,sessionId:r.authSessionId,accessToken:r.accessToken,refreshToken:'R'.repeat(8000)},JSON.parse(files.get('admin-server.json')).encryptionKey):null};
        assert.ok(!r.app||sessions[i].ciphertext.length<=32768);
      }
      if(failure==='INVENTORY_BATCH_WRONG_PAIR'&&state.inventoryCalls===2)sessions[0].auth_session_id=knownSession;
      const receipt={fenced:!(failure==='INVENTORY_BATCH_UNFENCED'&&state.inventoryCalls===2),sessions};
      state.inventoryResponseBytes.push(Buffer.byteLength(JSON.stringify([{receipt}])));
      return answer([{receipt}]);
    }
    throw Error('UNEXPECTED_FIXTURE_HTTP');
  };
  const context=vm.createContext({Buffer,Uint8Array,URL,Response,AbortSignal,fetch:fetcher,console:{log(){throw Error('NO_FIXTURE_LOGGING');}},process:{argv:[],versions:{node:'24.15.0'},env:{}},performance:fixturePerformance});
  context.nativeBridge=(op,p,options)=>JSON.stringify(native(op,JSON.parse(JSON.stringify(p)),options));
  const nativeFn=vm.runInContext('(op,p,options)=>JSON.parse(nativeBridge(op,p,options))',context);
  const admin=await import('../apps/admin/lib/preview-admin-config.mjs');const {editorFunctions,serverFunctions}=admin;
  const modules=new Map();
  async function synthetic(id,exports){const names=Object.keys(exports),m=new vm.SyntheticModule(names,function(){for(const k of names)this.setExport(k,exports[k]);},{context,identifier:id});await m.link(()=>{});return m;}
  async function load(id){
    if(modules.has(id))return modules.get(id);
    const task=(async()=>{
      if(id==='boundary')return synthetic(id,{nativeActualBoundary:nativeFn,assertOwnedInvocation:()=>{}});
      if(id==='config')return synthetic(id,{previewOwnerIdentity:vm.runInContext('()=>Object.freeze('+JSON.stringify(syntheticOwner)+')',context),previewProject:admin.previewProject,previewApi:admin.previewApi,editorFunctions:vm.runInContext(JSON.stringify(admin.editorFunctions),context),serverFunctions:vm.runInContext(JSON.stringify(admin.serverFunctions),context),uuid:admin.uuid});
      if(id==='policy')return synthetic(id,{assertEnvironmentBoundary:()=>{}});
      if(id==='local')return synthetic(id,{unseal});
      if(id==='node:fs')return synthetic(id,{readFileSync:p=>{assert.equal(path.resolve(p),path.join(root,'supabase/cloud/admin-preview-dev/activation-template.sql'));return template;},realpathSync:p=>p,lstatSync:()=>({isSymbolicLink:()=>false})});
      if(id.startsWith('node:'))return synthetic(id,await import(id));
      const m=new vm.SourceTextModule(readFileSync(id,'utf8'),{context,identifier:id,initializeImportMeta(meta){meta.url=pathToFileURL(id).href;}});
      await m.link(resolveImport);return m;
    })();modules.set(id,task);return task;
  }
  function resolveImport(specifier,ref){
    if(specifier.endsWith('/preview-file-boundary.mjs'))return load('boundary');
    if(specifier.endsWith('/preview-admin-config.mjs'))return load('config');
    if(specifier.endsWith('/admin-preview-policy.mjs'))return load('policy');
    if(specifier.endsWith('/runtime-local.mjs'))return load('local');
    return load(specifier.startsWith('node:')?specifier:path.resolve(path.dirname(ref.identifier),specifier));
  }
  const main=await load(path.join(root,'scripts/admin-preview-actual-setup.mjs'));await main.evaluate();
  if(inspectOnly)return {validateOwner:(raw,opts,undefinedSso=false)=>{const args=vm.runInContext('JSON.parse('+JSON.stringify(JSON.stringify([raw,opts]))+')',context);if(undefinedSso)Object.defineProperty(args[0],'is_sso_user',{value:undefined,enumerable:true});return main.namespace.validateAuthOwner(...args);}};
  const prepared=await main.namespace.runActualOperator(vm.runInContext('["prepare","'+ 'b'.repeat(64)+'"]',context));
  assert.equal(prepared.status,'AWAITING_EXACT_USER_APPROVAL');
  assert.equal(calls.filter(x=>x.kind==='HTTP'&&x.url.endsWith('reveal=true')).length,0);
  assert.equal(state.auth,false);assert.equal(state.sql,false);
  const d=JSON.parse(files.get('decision.json'));
  files.set('approval.json',actualCanonical({schemaVersion:1,decisionSha256:actualHash(actualCanonical(d)),sqlSha256:actualHash(files.get('rendered.sql')),implementationManifestSha256:'b'.repeat(64),ownerUserId:actualOwner.id,confirmationReference:'fixture:user-action:accepted',confirmedAt:'2026-11-18T01:00:01.000Z'}));
  let result,cliCode=null;
  if(cli){
    const output=[];context.console={log:value=>{assert.equal(typeof value,'string');output.push(value);}};
    context.process.argv=['C:/Program Files/nodejs/node.exe',path.join(root,'scripts/admin-preview-actual-setup.mjs'),'apply'];
    const entry=new vm.SourceTextModule(readFileSync(path.join(root,'scripts/admin-preview-actual-setup.mjs'),'utf8'),{context,identifier:path.join(root,'scripts/admin-preview-actual-setup.mjs'),initializeImportMeta(meta){meta.url=pathToFileURL(path.join(root,'scripts/admin-preview-actual-setup.mjs')).href;}});
    await entry.link(resolveImport);await entry.evaluate();assert.equal(output.length,1);result=JSON.parse(output[0]);cliCode=context.process.exitCode??0;
  }else result=await main.namespace.runActualOperator(vm.runInContext('["apply"]',context));
  for(const canary of Object.values(canaries))assert.ok(!JSON.stringify(result).includes(canary));
  for(const [leaf,value]of files)if(leaf!=='admin-server.json')for(const canary of Object.values(canaries))assert.ok(!value.includes(canary));
  return {state,files,calls,result,cliCode,again:()=>main.namespace.runActualOperator(vm.runInContext('["apply"]',context))};
}
test('Operator simulation preserves approval-first key reads and ends with fenced cleanup, not operational certification',async()=>{
  const f=await operatorSimulation();assert.equal(f.result.status,'DEV_HOST_CLOSED');assert.equal(f.state.enabled,false);assert.equal(f.state.membership,false);
  assert.equal(f.files.has('admin-server.json'),false);assert.equal(f.files.has('launch-consumed.json'),true);
  assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.method==='PUT').length,1);
  await assert.rejects(f.again(),/PREVIOUS_EFFECT_OR_UNKNOWN/);
});
test('Unknown Auth, SQL, private write or launch outcomes never retry, invert Auth or start another host',async()=>{
  for(const failure of ['AUTH_UNKNOWN','SQL_UNKNOWN','CONFIG_UNKNOWN','LAUNCH_UNKNOWN']){
    const f=await operatorSimulation(failure);assert.equal(f.result.status,'HOLD');assert.equal(f.state.host,false);assert.equal(f.result.automaticAuthInverse,false);
    assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.method==='PUT').length,1);
    if(failure!=='AUTH_UNKNOWN')assert.equal(f.state.enabled,false);
    const count=f.calls.filter(x=>x.kind==='HTTP').length;await assert.rejects(f.again(),/PREVIOUS_EFFECT_OR_UNKNOWN/);
    assert.equal(f.calls.filter(x=>x.kind==='HTTP').length,count);
  }
});


test('Production owner digest default remains fixed independently of synthetic module fixtures',()=>{
 assert.equal(actualOwner.emailSha256,'7bd88947e82eccad28360716d82f516c01b90733dd82ba1fe3bce5ba50c36f8d');
 assert.equal(previewSqlOwnerEmailSha256,actualOwner.emailSha256);assert.notEqual(syntheticOwner.emailSha256,actualOwner.emailSha256);
 const b=fixture();assert.ok(b.sql.includes(actualOwner.emailSha256));
 const synthetic=renderAdminPreviewSql(template,{ownerUserId:actualOwner.id,effectKey:b.decision.effectKey,decisionSha256:'0'.repeat(64),implementationManifestSha256:'b'.repeat(64),expiresAt:b.decision.expiresAt,ownerEmailSha256:syntheticOwner.emailSha256});
 assert.ok(synthetic.sql.includes(syntheticOwner.emailSha256));assert.ok(!synthetic.sql.includes(actualOwner.emailSha256));
});
test('Cross-phase and persisted journal substitutions, gaps and duplicate frames are rejected',()=>{
 const e={generation:1,phase:'BEFORE_AUTH',ownerUserId:actualOwner.id,authSessionId:null,capabilityHash:null};
 const open={...e,phase:'BEFORE_OPEN',authSessionId:'11111111-1111-4111-8111-111111111111',capabilityHash:'a'.repeat(64)};
 const j=appendLoginJournal(appendLoginJournal([],e),open);
 for(const phase of ['COMPLETE','RESIDUAL'])for(const key of ['authSessionId','capabilityHash']){
  const bad={...open,phase,[key]:key==='authSessionId'?'22222222-2222-4222-8222-222222222222':'b'.repeat(64)};
  assert.throws(()=>appendLoginJournal(j,bad),/BINDING_CONFLICT/);assert.throws(()=>validateLoginJournal([...j,bad]),/BINDING_CONFLICT/);
 }
 assert.throws(()=>validateLoginJournal([e,e]),/DUPLICATE_FRAME/);assert.throws(()=>validateLoginJournal([open]),/SEQUENCE/);
});
test('Metadata whitelist validates the whole list before returning any selection',()=>{
 const pair=[{id:'p',name:'fixture public',type:'publishable'},{id:'s',name:'fixture secret',type:'secret'}];
 const full=pair.map(x=>({...x,api_key:null,prefix:'sb_'+x.type+'_',description:null,hash:'a'.repeat(64),secret_jwt_template:null,inserted_at:'2026-11-18T00:00:00.000Z',updated_at:null}));
 assert.equal(selectActualKeyMetadata(full).secretKeyId,'s');
 assert.equal(selectActualKeyMetadata([...pair,{type:'legacy',name:'anon',id:null,api_key:null}]).publishableKeyId,'p');
 for(const mutation of [{api_key:'***'},{api_key:'sb_secret_SYNTHETIC_NOT_A_REAL_KEY'},{description:'sb_secret_SYNTHETIC_NOT_A_REAL_KEY'},{extra:'sb_secret_SYNTHETIC_NOT_A_REAL_KEY'},{secret_jwt_template:{}},{hash:'bad'},{type:null},{id:null},{name:''},{name:'bad\nname'},{prefix:'sb_secret_bad'},{inserted_at:'2026-02-30T00:00:00.000Z'}])assert.throws(()=>selectActualKeyMetadata([pair[0],{...pair[1],...mutation}]),/HOLD/);
 assert.throws(()=>selectActualKeyMetadata([...pair,{type:'legacy',name:'service_role',api_key:'eyJleGFtcGxl.eyJleGFtcGxl.c3ludGhldGljU2lnbmF0dXJl'}]),/HOLD/);
 let calls=0;const getter={...pair[1]};Object.defineProperty(getter,'api_key',{enumerable:true,get(){calls++;return null;}});assert.throws(()=>selectActualKeyMetadata([pair[0],getter]),/HOLD/);assert.equal(calls,0);
});

test('Fresh approval and strict SQL floor plus full setup reserve precede credential effects',()=>{
 const base=fixture(),approval={schemaVersion:1,decisionSha256:base.decisionSha256,sqlSha256:base.sqlSha256,implementationManifestSha256:base.decision.implementationManifestSha256,ownerUserId:actualOwner.id,confirmationReference:'fixture:user-action:timing',confirmedAt:'2026-11-18T01:00:01.000Z'};
 assert.throws(()=>createActualSetupBudget(base,approval,'2026-11-18T01:00:00.000Z',1000,1100),/APPROVAL_FUTURE/);
 for(const left of [600000,1200000,1800000,2105000]){
  const b={...base,decision:{...base.decision,expiresAt:new Date(Date.parse('2026-11-18T01:00:02.000Z')+left+100).toISOString()}};
  assert.throws(()=>createActualSetupBudget(b,approval,'2026-11-18T01:00:02.000Z',1000,1100),/HEADROOM/);
 }
 const b=createActualSetupBudget(base,approval,'2026-11-18T01:00:02.000Z',1000,1100);
 assert.equal(actualSetupAllowance(b,1100).timeoutMs,25000);assert.equal(actualSetupAllowance(b,1100,'NATIVE').timeoutMs,20000);
 assert.equal(actualSetupAllowance(b,295999).timeoutMs,1);
 assert.throws(()=>actualSetupAllowance(b,296000),/EXHAUSTED/);assert.throws(()=>actualSetupAllowance(b,1099),/MONOTONIC/);
});

test('Operator prevents all key reveal, Auth elevation and SQL effects for future or insufficient fresh approval windows',async()=>{
 for(const failure of ['FUTURE_APPROVAL','SHORT_HEADROOM','EQUAL_HEADROOM']){
  const f=await operatorSimulation(failure);assert.equal(f.result.status,'HOLD');assert.equal(f.state.auth,false);assert.equal(f.state.sql,false);assert.equal(f.state.host,false);
  assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.url.endsWith('reveal=true')).length,0);
  assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.method==='PUT').length,0);
  assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.url.includes('/auth/v1/')).length,0);
 }
});

test('Known Auth sessions are reconciled independently of app rows and empty204 logout is acknowledged',async()=>{
 for(const scenario of ['MISSING_APP','KNOWN_LOGOUT_204','AUTH_ABSENT','UNKNOWN_BEFORE_AUTH','LOGOUT_TIMEOUT','LOGOUT_REJECT','SESSION_REAPPEARS']){
  const f=await operatorSimulation(null,{sessionScenario:scenario});
  const logout=f.calls.filter(x=>x.kind==='HTTP'&&x.url.includes('/auth/v1/logout?'));
  if(['KNOWN_LOGOUT_204','AUTH_ABSENT'].includes(scenario)){
   assert.equal(f.result.status,'DEV_HOST_CLOSED',scenario);assert.equal(f.files.has('admin-server.json'),false);
   assert.equal(logout.length,scenario==='AUTH_ABSENT'?0:1);
   if(scenario==='KNOWN_LOGOUT_204')assert.equal(f.result.sessionDispositions[0].logout,'ACKNOWLEDGED');
  }else{
   assert.equal(f.result.status,'HOLD',scenario);assert.equal(f.result.authResidualUnconfirmed,true);assert.equal(f.files.has('admin-server.json'),true,'residual keeps decryption material');
   assert.equal(f.calls.filter(x=>x.kind==='NATIVE'&&x.op==='DeleteActualSecrets').length,0);
   assert.equal(logout.length,['MISSING_APP','UNKNOWN_BEFORE_AUTH'].includes(scenario)?0:1);
  }
 }
});

test('Independent component outcomes retain SQL ACK and per-file uncertainty instead of claiming preservation',async()=>{
 for(const failure of ['AUTH_ACK_JOURNAL_UNKNOWN','SQL_ACK_JOURNAL_UNKNOWN','CONFIG_UNKNOWN','FENCE_UNKNOWN','SESSIONS_READ_UNKNOWN','CLEANUP_PARTIAL','CLEANUP_RESPONSE_UNKNOWN','CLEANUP_NO_RECEIPT']){
  const f=await operatorSimulation(failure);assert.equal(f.result.status,'HOLD',failure);const c=f.result.components;
  assert.equal(c.auth,'ACKNOWLEDGED');assert.equal(c.authVerification,'VERIFIED');assert.equal(Object.hasOwn(f.result,'privateFilesPreserved'),false);
  assert.equal(c.sql,failure==='AUTH_ACK_JOURNAL_UNKNOWN'?'NOT_ATTEMPTED':'ACKNOWLEDGED');
  if(failure==='CONFIG_UNKNOWN'){assert.equal(c.files['activation-expected.json'].creation,'ACKNOWLEDGED');assert.equal(c.files['admin-server.json'].creation,'UNCONFIRMED');assert.equal(c.fence,'ACKNOWLEDGED');}
  if(failure==='FENCE_UNKNOWN'){assert.equal(c.fence,'UNCONFIRMED');assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.body?.query?.startsWith('with fence_lock')).length,1);}
  if(failure==='CLEANUP_PARTIAL'){assert.equal(c.files['admin-server.json'].cleanup,'DELETED');assert.equal(c.files['activation-proof.json'].cleanup,'NOT_ATTEMPTED');assert.equal(f.files.has('admin-server.json'),false);assert.equal(f.files.has('activation-proof.json'),true);}
  if(failure==='CLEANUP_RESPONSE_UNKNOWN'){assert.equal(c.cleanup,'UNCONFIRMED');assert.ok(Object.values(c.files).every(x=>x.cleanup==='UNKNOWN'));assert.equal(c.fence,'ACKNOWLEDGED');}
  if(failure==='CLEANUP_NO_RECEIPT')assert.ok(Object.values(c.files).every(x=>x.cleanup==='NOT_ATTEMPTED'));
 }
});
test('The exact CLI entry returns a failing exit status when apply returns HOLD',async()=>{
 for(const failure of ['FUTURE_APPROVAL','CONFIG_UNKNOWN','CLEANUP_PARTIAL']){
  const f=await operatorSimulation(failure,{cli:true});assert.equal(f.result.status,'HOLD');assert.equal(f.cliCode,1);
 }
});

test('Advancing setup clock before key, Auth or SQL dispatch preserves NOT_ATTEMPTED and makes no undispatched SQL compensation',async()=>{
 for(const failure of ['BUDGET_BEFORE_KEY','BUDGET_AFTER_AUTH_INTENT','BUDGET_AFTER_SQL_INTENT']){
  const f=await operatorSimulation(failure);assert.equal(f.result.status,'HOLD',failure);
  assert.equal(f.state.sql,false);assert.equal(f.state.host,false);assert.equal(f.result.components.sql,'NOT_ATTEMPTED');assert.equal(f.result.components.fence,'NOT_ATTEMPTED');
  assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.body?.query?.startsWith('with fence_lock')).length,0);
  if(failure==='BUDGET_BEFORE_KEY'){assert.equal(f.result.components.keys.publishable,'NOT_ATTEMPTED');assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.url.endsWith('reveal=true')).length,0);}
  if(failure==='BUDGET_AFTER_AUTH_INTENT'){assert.equal(f.result.components.auth,'NOT_ATTEMPTED');assert.equal(f.state.auth,false);}
  if(failure==='BUDGET_AFTER_SQL_INTENT'){assert.equal(f.result.components.auth,'ACKNOWLEDGED');assert.equal(f.state.auth,true);}
 }
 const positive=await operatorSimulation();
 const writes=positive.calls.filter(x=>x.kind==='NATIVE'&&x.op==='WriteActualFile'&&x.timeoutMs!==undefined);
 assert.ok(writes.length>=9);assert.ok(writes.every(x=>Number.isSafeInteger(x.timeoutMs)&&x.timeoutMs>0&&x.timeoutMs<=20000));
 const clocks=positive.calls.filter(x=>x.kind==='NATIVE'&&x.op==='Clock');assert.equal(clocks.length,2);assert.ok(clocks.every(x=>x.timeoutMs>0&&x.timeoutMs<=20000));
});

test('Supervisor HOLD preserves sanitized confirmed local stop independently of host success',async()=>{
 const receipt=actualSupervisorReceipt({status:'HOLD',mode:'Actual',cleanupObserved:true,jobCleanupObserved:true,created:true,childExitedObserved:true,portClosedObserved:true,reason:'CHILD_EXITED',untrusted:'SYNTHETIC_MUST_NOT_RETURN'});
 assert.equal(receipt.cleanupObserved,true);assert.equal(receipt.status,'HOLD');assert.equal(Object.hasOwn(receipt,'untrusted'),false);
 assert.throws(()=>actualSupervisorReceipt({...receipt,cleanupObserved:'true'}),/HOLD/);
 const f=await operatorSimulation('HOST_FAILED_STOPPED');assert.equal(f.result.status,'HOLD');assert.equal(f.result.components.localStop,'ACKNOWLEDGED');assert.equal(f.result.components.host,'FAILED');assert.equal(f.result.components.fence,'ACKNOWLEDGED');
 assert.equal(JSON.parse(f.files.get('effect-host-exit.json')).details.localStop,'ACKNOWLEDGED');
 const busy=await operatorSimulation('HOST_FAILED_PORT_BUSY');assert.equal(busy.result.status,'HOLD');assert.equal(busy.result.components.localStop,'ACKNOWLEDGED');
 assert.equal(busy.result.components.hostObservation.portClosedObserved,false);assert.equal(busy.result.components.hostObservation.reason,'PORT_STILL_LISTENING');
});

test('Production C2 complete ref loop accepts only the exact event-bound hosted merge ref while retaining linear feature validation',()=>{
 const guard=readFileSync(new URL('../scripts/verify-admin-c2-foundation.mjs',import.meta.url),'utf8');
 const start=guard.indexOf('const refs=new Map('),end=guard.indexOf('if(!hosted)for',start);assert.ok(start>=0&&end>start);
 const code=guard.slice(start,end),base='a'.repeat(40),head='d'.repeat(40),other='c'.repeat(40),feature='feat/admin-c2-actual';
 const run=({pullOid=head,hostedMerge=true,featureOid=other}={})=>{
  let linearChecks=0;
  const context=vm.createContext({Map,Set,Object,process:{env:{GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'Jacop7/stocknews',GITHUB_EVENT_NAME:'pull_request',GITHUB_REF:'refs/pull/1/merge',GITHUB_SHA:head}},
   b:{refs:{'refs/heads/main':base}},feature,base,ciCheckpoint:'b'.repeat(40),head,other,hostedMerge,allowedHostedPullRef,
   check:(value,label)=>assert.ok(value,label),featureOrdinal:oid=>{linearChecks++;assert.notEqual(oid,head,'Merge commit must never be accepted as a linear feature commit');return oid===other?3:null;},
   git:args=>args[0]==='for-each-ref'?{text:`refs/heads/main ${base}\nrefs/remotes/origin/${feature} ${featureOid}\nrefs/remotes/pull/1/merge ${pullOid}`}:(assert.deepEqual(Array.from(args),['merge-base','--is-ancestor',other,hostedMerge?other:head]),{code:0})});
  new vm.Script(code).runInContext(context);return linearChecks;
 };
 assert.equal(run(),1);assert.throws(()=>run({pullOid:'e'.repeat(40)}),/Declared ref/);
 assert.throws(()=>run({hostedMerge:false}),/Exact event-bound hosted merge ref/);
 assert.throws(()=>run({featureOid:head}),/linear feature commit/);
});

test('Large legal session inventories are byte-bounded, exact-pair checked and fenced on every batch before logout',async()=>{
 const f=await operatorSimulation(null,{sessionScenario:'LARGE_SESSIONS'});
 assert.equal(f.result.status,'DEV_HOST_CLOSED');assert.equal(f.result.sessionDispositions.length,12);
 assert.ok(f.result.sessionDispositions.every(r=>r.logout==='ACKNOWLEDGED'&&r.authDisposition==='ABSENT'&&r.appDisposition==='ABSENT'));
 const reads=f.calls.filter(x=>x.kind==='HTTP'&&x.body?.query?.startsWith('with known')&&!x.body.query.includes('delete from private.admin_sessions'));
 assert.equal(reads.length,36);assert.ok(reads.every(x=>JSON.parse(x.body.parameters[2]).length===1));
 assert.ok(f.state.inventoryResponseBytes.slice(0,12).reduce((a,b)=>a+b,0)>262144,'Combined legal rows exceed the transport cap');
 assert.ok(f.state.inventoryResponseBytes.every(n=>n<=262144));assert.equal(f.result.inventoryObservations,36);
 assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.url.endsWith('/logout?scope=local')).length,12);
 const maximum=await operatorSimulation(null,{sessionScenario:'LARGE_SESSIONS',sessionCount:128});
 assert.equal(maximum.result.status,'DEV_HOST_CLOSED');assert.equal(maximum.result.sessionDispositions.length,128);assert.equal(maximum.result.inventoryObservations,384);
 assert.equal(maximum.files.has('session-inventory-384-ack.json'),true);assert.ok(maximum.state.inventoryResponseBytes.every(n=>n<=262144));
 for(const failure of ['INVENTORY_BATCH_WRONG_PAIR','INVENTORY_BATCH_UNFENCED']){
  const bad=await operatorSimulation(failure,{sessionScenario:'LARGE_SESSIONS'});assert.equal(bad.result.status,'HOLD');assert.equal(bad.state.inventoryCalls,2);
  assert.equal(bad.calls.filter(x=>x.kind==='HTTP'&&x.url.endsWith('/logout?scope=local')).length,0);
  assert.equal(bad.result.sessionCleanup.inventory,'UNCONFIRMED');assert.equal(bad.result.sessionCleanup.inventoryObservations,1);
  assert.equal(JSON.parse(bad.files.get('session-inventory-1-ack.json')).sessionCleanup.inventoryObservations,1);
  assert.equal(bad.files.has('admin-server.json'),true);
 }
});

test('Real Windows pre-create port collision is not an owned-child stop and its sanitized observations survive the operator journal',{skip:process.platform!=='win32'},async()=>{
 const server=createServer();await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(62333,'127.0.0.2',resolve);});
 try{
  const root=fileURLToPath(new URL('../',import.meta.url));
  const r=spawnSync('C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-File',path.join(root,'scripts/admin-preview-supervisor.ps1'),'-Operation','Supervise'],
   {cwd:root,input:JSON.stringify({mode:'Fixture'}),encoding:'utf8',windowsHide:true,timeout:20000,maxBuffer:2*1024*1024,env:controlledEnvironment()});
  assert.ifError(r.error);assert.equal(r.status,0,r.stderr);const observed=JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1));
  assert.equal(observed.status,'HOLD');assert.equal(observed.reason,'PORT_COLLISION');assert.equal(observed.created,false);
  assert.equal(observed.childExitedObserved,null);assert.equal(observed.portClosedObserved,false);assert.equal(server.listening,true,'Never stop the unrelated listener');
  // The real fixture receipt is projected through the production sanitizer into
  // a synthetic operator VM; no ACTUAL private root, branding or host is used.
  const receipt=actualSupervisorReceipt({...observed,mode:'Actual'}),f=await operatorSimulation(null,{hostReceipt:receipt});
  assert.equal(f.result.status,'HOLD');assert.equal(f.result.components.localStop,'NOT_CREATED');assert.equal(f.result.components.host,'FAILED');
  const disk=JSON.parse(f.files.get('effect-host-exit.json')).details;
  assert.equal(disk.localStop,'NOT_CREATED');assert.equal(disk.hostObservation.reason,'PORT_COLLISION');assert.equal(disk.hostObservation.portClosedObserved,false);
  assert.equal(JSON.parse(f.files.get('effect-hold.json')).details.components.hostObservation.created,false);
 }finally{await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});

test('Logout ACK survives later inventory or persistence failure and is recorded before another cleanup request',async()=>{
 for(const failure of ['SESSIONS_READ_AFTER_LOGOUT_UNKNOWN','SESSION_ACK_AUDIT_UNKNOWN']){
  const f=await operatorSimulation(failure,{sessionScenario:'SAFE'});assert.equal(f.result.status,'HOLD');
  assert.equal(f.result.sessionCleanup.sessionDispositions[0].logout,'ACKNOWLEDGED');
  assert.equal(JSON.parse(f.files.get('effect-hold.json')).details.sessionCleanup.sessionDispositions[0].logout,'ACKNOWLEDGED');
  assert.equal(f.calls.filter(x=>x.kind==='HTTP'&&x.url.endsWith('/logout?scope=local')).length,1);
  if(failure==='SESSIONS_READ_AFTER_LOGOUT_UNKNOWN'){
   assert.equal(f.result.sessionCleanup.inventory,'UNCONFIRMED');
   assert.equal(JSON.parse(f.files.get('session-cleanup-1-ack.json')).outcome.logout,'ACKNOWLEDGED');
  }else assert.equal(f.state.inventoryCalls,1,'No following inventory after audit acknowledgement is unknown');
 }
 const residual=await operatorSimulation(null,{sessionScenario:'MISSING_APP'});
 assert.equal(JSON.parse(residual.files.get('effect-cleanup.json')).details.sessionCleanup.sessionDispositions[0].logout,'MISSING_CIPHERTEXT');
});

test('Owned Node death after a durable synthetic launch ACK rejects replay before host-runtime creation',{skip:process.platform!=='win32'},()=>{
 const r=nativeBoundary('DeathTest',{phase:'AfterLaunchAck'});
 assert.equal(r.afterLaunchAckReplayRejected,true);assert.equal(r.allObservedExited,true);assert.equal(r.actualBrandRegistered,false);assert.equal(r.actualConfigRead,false);
 assert.equal(r.processHandles,1);assert.ok(r.identities.every(x=>x.matched));
 assert.equal(r.operatorFixtureParentConstraint,'ACTUAL_REQUIRES_IMMEDIATE_PARENT; DEATH_PROBE_CHECKS_SAME_LIVENESS_WITHOUT_PARENT');
});

async function runtimeBranchFixture({fullLogins=false}={}){
 const root=fileURLToPath(new URL('../',import.meta.url)),calls=[],journal=[];
 const stored=new Map();let grants=0;
 const fixedNow=Date.parse('2026-11-18T01:00:00.000Z');
 const user={id:actualOwner.id,app_metadata:{app_role:'admin',product_id:'judoju-news'}};
 const transport=async(url,init)=>{calls.push({url,method:init.method});
  if(url.endsWith('/m1_public_identity'))return new Response(JSON.stringify({productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',bootstrapId:null,contract:'M1'}));
  if(url.includes('/token?grant_type=password')){
   if(!fullLogins)throw new Error('SYNTHETIC_STOP_BEFORE_GRANT');
   const sid=(++grants===1?'1':'2').repeat(8)+'-1111-4111-8111-111111111111';
   const claims={sub:actualOwner.id,session_id:sid,iss:'https://nxfpfvsdwbziowkxsxnh.supabase.co/auth/v1',role:'authenticated',aud:'authenticated',exp:Math.floor(fixedNow/1000)+7200};
   const access=[Buffer.from('{"alg":"SYNTHETIC"}').toString('base64url'),Buffer.from(JSON.stringify(claims)).toString('base64url'),'SYNTHETIC_SIGNATURE'].join('.');
   return new Response(JSON.stringify({access_token:access,refresh_token:'SYNTHETIC_REFRESH'}));
  }
  if(url.endsWith('/auth/v1/user'))return new Response(JSON.stringify(user));
  if(url.endsWith('/m1_check_editor'))return new Response(JSON.stringify({allowed:true}));
  if(url.endsWith('/m1_open_admin_session')){const b=JSON.parse(init.body);stored.set(b.p_hash,{user_id:b.p_user,auth_session_id:b.p_auth_session,ciphertext:b.p_ciphertext,expires_at:b.p_expires});return new Response(JSON.stringify({opened:true}));}
  if(url.endsWith('/m1_read_admin_session'))return new Response(JSON.stringify(stored.get(JSON.parse(init.body).p_hash)??null));
  if(url.endsWith('/m1_close_admin_session')){stored.delete(JSON.parse(init.body).p_hash);return new Response(JSON.stringify({closed:true}));}
  if(url.endsWith('/logout?scope=local'))return new Response(null,{status:204});throw Error('UNEXPECTED_RUNTIME_FIXTURE_REQUEST');
 };
 const context=vm.createContext({Buffer,URL,Uint8Array,Response,AbortController,fetch:transport,performance,setTimeout,clearTimeout});
 context.journalBridge=async(op,p)=>{
  const frames=journal.map(e=>{const bytes=Buffer.from(actualCanonical(e));return {bytes:bytes.toString('base64'),sha256:actualHash(bytes)};});
  if(op==='ReadActualJournal')return JSON.stringify({status:'PASS',frames});
  assert.equal(op,'AppendActualJournal');assert.equal(p.generation,journal.length+1);assert.equal(p.previousSha256,frames.at(-1)?.sha256??'0'.repeat(64));
  const entry=JSON.parse(Buffer.from(p.bytes,'base64'));const next=appendLoginJournal(journal,entry);assert.equal(next.length,journal.length+1);journal.push(entry);return JSON.stringify({status:'PASS'});
 };
 const config=vm.runInContext('('+JSON.stringify({apiUrl:'https://nxfpfvsdwbziowkxsxnh.supabase.co',projectRef:'nxfpfvsdwbziowkxsxnh',ownerUserId:actualOwner.id,expiresAt:'2026-11-18T02:00:00.000Z',publishableKey:'FIXTURE_PUBLISHABLE',secretKey:'FIXTURE_SECRET',encryptionKey:'d'.repeat(64)})+')',context);
 const modules=new Map();
 async function synthetic(id,values){const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context,identifier:id});await m.link(()=>{});return m;}
 async function load(id){if(modules.has(id))return modules.get(id);const work=(async()=>{
  if(id==='config')return synthetic(id,{previewApi:config.apiUrl,previewProject:config.projectRef,editorFunctions:['m1_check_editor'],serverFunctions:['m1_open_admin_session','m1_read_admin_session','m1_close_admin_session'],uuid:/^[0-9a-f-]{36}$/,loadPreviewAdminConfig:()=>config,previewConfigKind:()=> 'ACTUAL',actualConfigNow:()=>fixedNow,previewOwnerIdentity:()=>syntheticOwner});
  if(id==='local')return synthetic(id,{AdminError,hash,seal,unseal});
  if(id==='writer')return fullLogins?load(path.join(root,'apps/admin/lib/preview-config-writer.mjs')):synthetic(id,{appendActualRuntimeJournal:async entry=>{journal.push(JSON.parse(JSON.stringify(entry)));return 1;},actualJournalGeneration:async()=>1});
  if(id==='boundary')return synthetic(id,{assertFixtureRoot(){throw Error('NO_FIXTURE_IO');},writeOwnedPreviewFixture(){throw Error('NO_FIXTURE_IO');},boundaryHold(){throw Error('SYNTHETIC_BOUNDARY_HOLD');},nativeActualJournal:vm.runInContext('(async(op,p)=>JSON.parse(await journalBridge(op,p)))',context)});
  if(id==='editor')return synthetic(id,{confirmedSqlRejection});
  if(id.startsWith('node:'))return synthetic(id,await import(id));
  const m=new vm.SourceTextModule(readFileSync(id,'utf8'),{context,identifier:id});await m.link((specifier,ref)=>{
   if(specifier.endsWith('/preview-admin-config.mjs'))return load('config');if(specifier.endsWith('/runtime-local.mjs'))return load('local');if(specifier.endsWith('/preview-config-writer.mjs'))return load('writer');if(specifier.endsWith('/preview-file-boundary.mjs'))return load('boundary');if(specifier.endsWith('/editor-state.mjs'))return load('editor');return load(specifier.startsWith('node:')?specifier:path.resolve(path.dirname(ref.identifier),specifier));
  });return m;
 })();modules.set(id,work);return work;}
 const module=await load(path.join(root,'apps/admin/lib/runtime-preview.mjs'));await module.evaluate();
 // ACTUAL branch is asserted only by a synthetic config module; no real WeakSet branding/config/native I/O.
 return {runtime:module.namespace.createPreviewRuntime(),calls,journal,actualBrandRegistered:false};
}
test('Runtime owner mismatch makes zero provider or journal calls; normalized synthetic owner reaches Auth branch',async()=>{
 const f=await runtimeBranchFixture();await assert.rejects(f.runtime.login('other@judoju-c2.invalid','SYNTHETIC_PASSWORD'),/LOGIN_INVALID/);assert.equal(f.calls.length,0);assert.equal(f.journal.length,0);
 await assert.rejects(f.runtime.login(' OWNER@JUDOJU-C2.INVALID ','SYNTHETIC_PASSWORD'),/PREVIEW_BACKEND_UNAVAILABLE/);
 assert.equal(f.calls.filter(x=>x.url.includes('/token?grant_type=password')).length,1);assert.equal(f.actualBrandRegistered,false);
});
test('Runtime recognizes documented empty204 local logout with strict JSON for the close RPC',async()=>{
 const f=await runtimeBranchFixture();await f.runtime.logout('a'.repeat(43),{accessToken:'SYNTHETIC_ACCESS_TOKEN'});
 assert.equal(f.runtime.diagnostics().authLogout,'ACKNOWLEDGED');assert.equal(f.runtime.diagnostics().close,'ACKNOWLEDGED');assert.equal(f.calls.filter(x=>x.url.endsWith('/logout?scope=local')).length,1);assert.equal(f.actualBrandRegistered,false);
});

test('Two completed runtime logins can close in either order through the real writer, preserving highest generation and exact once-only closes',async()=>{
 for(const order of [[0,1],[1,0]]){
  const f=await runtimeBranchFixture({fullLogins:true});
  const logins=[await f.runtime.login(syntheticEmail,'SYNTHETIC_PASSWORD'),await f.runtime.login(syntheticEmail,'SYNTHETIC_PASSWORD')];
  assert.deepEqual(f.journal.map(x=>x.phase),['BEFORE_AUTH','BEFORE_OPEN','COMPLETE','BEFORE_AUTH','BEFORE_OPEN','COMPLETE']);
  for(const n of order){const session=await f.runtime.session(logins[n].capability);await f.runtime.logout(logins[n].capability,session);assert.equal(f.runtime.diagnostics().authLogout,'ACKNOWLEDGED');}
  assert.deepEqual(f.journal.slice(-2).map(x=>x.generation),order.map(n=>n+1));
  assert.deepEqual(validateLoginJournal(f.journal),f.journal);
  const unknown=[{generation:1,phase:'BEFORE_AUTH',ownerUserId:actualOwner.id,authSessionId:null,capabilityHash:null},{generation:1,phase:'RESIDUAL',ownerUserId:actualOwner.id,authSessionId:null,capabilityHash:null}];
  assert.throws(()=>appendLoginJournal(unknown,{...unknown[1],phase:'CLOSED',authSessionId:'11111111-1111-4111-8111-111111111111',capabilityHash:'a'.repeat(64)}),/BINDING_CONFLICT/);
  const before={generation:3,phase:'BEFORE_AUTH',ownerUserId:actualOwner.id,authSessionId:null,capabilityHash:null};
  assert.equal(appendLoginJournal(f.journal,before).at(-1).generation,3);
  assert.equal(appendLoginJournal(f.journal,f.journal.at(-1)).length,f.journal.length);
  const closed=f.journal.find(x=>x.phase==='CLOSED');assert.throws(()=>appendLoginJournal(f.journal,{...closed,capabilityHash:'f'.repeat(64)}),/CONFLICT/);
  assert.equal(f.actualBrandRegistered,false);
 }
});

test('ACTUAL loader rejects returned config bytes that differ from the launch digest before registering its isolated VM brand',async()=>{
 const root=fileURLToPath(new URL('../',import.meta.url)),b=fixture();
 const {editorFunctions,serverFunctions}=await import('../apps/admin/lib/preview-admin-config.mjs');
 const {validatePreviewActivationProof}=await import('../apps/admin/lib/preview-activation-proof.mjs');
 const expected={ownerUserId:actualOwner.id,fixture:false,activationDecisionSha256:b.decisionSha256,implementationManifestSha256:b.decision.implementationManifestSha256,sqlSha256:b.sqlSha256};
 const approval={schemaVersion:1,ownerUserId:actualOwner.id,decisionSha256:b.decisionSha256,sqlSha256:b.sqlSha256,implementationManifestSha256:b.decision.implementationManifestSha256,confirmationReference:'fixture:action:accepted',confirmedAt:'2026-11-18T01:00:01.000Z'};
 const proof={schemaVersion:1,stage:'CLOUD11A',state:'ADMIN_CONNECTION_ACTIVATED',productId:'judoju-news',projectRef:'nxfpfvsdwbziowkxsxnh',organizationRef:'qfzgicohgpuogehdyzfx',ownerUserId:actualOwner.id,fixture:false,approvedAt:approval.confirmedAt,expiresAt:b.decision.expiresAt,activationDecisionSha256:b.decisionSha256,implementationManifestSha256:b.decision.implementationManifestSha256,sqlSha256:b.sqlSha256,M2:false,realPublicationEnabled:false,workerEnabled:false,editorFunctions,serverFunctions};
 const proofBytes=Buffer.from(actualCanonical(proof));
 const config={schemaVersion:1,productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',projectRef:'nxfpfvsdwbziowkxsxnh',apiUrl:'https://nxfpfvsdwbziowkxsxnh.supabase.co',origin:'http://127.0.0.2:62333',ownerUserId:actualOwner.id,publishableKey:'sb_publishable_SYNTHETIC_NOT_REAL',secretKey:'sb_secret_SYNTHETIC_NOT_REAL',encryptionKey:'d'.repeat(64),proofSha256:actualHash(proofBytes),fixture:false};
 const configBytes=Buffer.from(actualCanonical(config)),launch={...ack(b),configSha256:actualHash(configBytes),proofSha256:actualHash(proofBytes)};
 for(const replacement of [null,'ENCRYPTION','SECRET']){
  const delivered=replacement===null?configBytes:Buffer.from(actualCanonical({...config,...(replacement==='ENCRYPTION'?{encryptionKey:'e'.repeat(64)}:{secretKey:'sb_secret_SYNTHETIC_REPLACEMENT'})}));
  const rawFiles={'activation-expected.json':actualCanonical(expected),'activation-proof.json':proofBytes,'admin-server.json':delivered,'decision.json':actualCanonical(b.decision),'approval.json':actualCanonical(approval),'rendered.sql':b.sql,'launch-consumed.json':actualCanonical(launch)};
  const receipt={status:'PASS',files:Object.fromEntries(Object.entries(rawFiles).map(([k,v])=>[k,Buffer.from(v).toString('base64')])),authoritativeNow:Date.parse(launch.serverTime),remainingMs:1800000,launchEffect:b.decision.launchEffect};
  const context=vm.createContext({Buffer,performance});const clone=x=>JSON.parse(JSON.stringify(x));
  const stubs={
   'boundary':{nativeBoundary(){throw Error('NO_NATIVE');},nativeActualBoundary(op){assert.equal(op,'ReadActual');return clone(receipt);}},
   'lifecycle':{actualOwner,actualCanonical:x=>actualCanonical(clone(x)),actualHash,checkActualApproval:(a,v)=>checkActualApproval(clone(a),clone(v))},
   'proof':{validatePreviewActivationProof:(p,e,t)=>validatePreviewActivationProof(clone(p),clone(e),t)},
   'local':{AdminError},
   'node:fs':{readFileSync(){throw Error('NO_PRIVATE_IO');},lstatSync(){throw Error('NO_PRIVATE_IO');},realpathSync(){throw Error('NO_PRIVATE_IO');}}
  };
  const m=new vm.SourceTextModule(readFileSync(path.join(root,'apps/admin/lib/preview-admin-config.mjs'),'utf8'),{context});
  await m.link(async specifier=>{
   const id=specifier.endsWith('/preview-file-boundary.mjs')?'boundary':specifier.endsWith('/preview-actual-lifecycle.mjs')?'lifecycle':specifier.endsWith('/preview-activation-proof.mjs')?'proof':specifier.endsWith('/runtime-local.mjs')?'local':specifier;
   const values=stubs[id]??await import(id);return new vm.SyntheticModule(Object.keys(values),function(){for(const [k,v]of Object.entries(values))this.setExport(k,v);},{context});
  });await m.evaluate();
  if(replacement===null){const c=m.namespace.loadPreviewAdminConfig();assert.equal(c.encryptionKey,config.encryptionKey);assert.equal(m.namespace.previewConfigKind(c),'ACTUAL');}
  else assert.throws(()=>m.namespace.loadPreviewAdminConfig(),/CONFIG_REJECTED/);
 }
 // A native receipt is simulated here. This VM brand has no actual loader/job,
 // key, provider, DB, or network authority; Windows snapshot mechanism is separate.
});
