// Explicit operator entrypoint. Importing performs no private I/O, HTTP or activation.
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {nativeActualBoundary,assertOwnedInvocation} from '../apps/admin/lib/preview-file-boundary.mjs';
import {previewApi,previewProject,editorFunctions,serverFunctions} from '../apps/admin/lib/preview-admin-config.mjs';
import {actualOwner,actualCanonical,actualHash,actualTime,copyActualData,validateActualOwner,makeActualDecision,checkActualApproval,
  launchStatement,validateLaunchAck,createActualSetupBudget,actualSetupAllowance,validateLoginJournal} from '../apps/admin/lib/preview-actual-lifecycle.mjs';
import {renderAdminPreviewSql} from './admin-preview-sql.mjs';
import {assertEnvironmentBoundary} from './admin-preview-policy.mjs';
import {unseal} from '../apps/admin/lib/runtime-local.mjs';

const management='https://api.supabase.com/v1/projects/'+previewProject;
const sourceRoot=fileURLToPath(new URL('../',import.meta.url));
const hold=code=>{throw Error('ADMIN_C2_HOLD:'+code);};
const identifier=x=>typeof x==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(x);
const parse=b=>JSON.parse(b.toString('utf8'));
function nativeRead(leaf){return Buffer.from(nativeActualBoundary('ReadActualFile',{leaf}).bytes,'base64');}
function nativeWrite(leaf,bytes,budget=null){const options=budget?{timeoutMs:actualSetupAllowance(budget,Math.floor(performance.now()),'NATIVE').timeoutMs}:{};return nativeActualBoundary('WriteActualFile',{leaf,bytes:Buffer.from(bytes).toString('base64')},options);}
const writeJson=(name,data,budget=null)=>nativeWrite(name,actualCanonical(data),budget);
function templateText(){const p=path.join(sourceRoot,'supabase/cloud/admin-preview-dev/activation-template.sql');if(lstatSync(p).isSymbolicLink()||realpathSync(p)!==p)hold('TEMPLATE_PATH');return readFileSync(p,'utf8');}
function argumentsFromDecision(d){return {effectKey:d.effectKey,expiresAt:d.expiresAt,implementationManifestSha256:d.implementationManifestSha256,publishableKeyId:d.publishableKeyId,secretKeyId:d.secretKeyId,prestateSha256:d.prestateSha256,observedAt:d.observedAt};}
export function bindStoredActualDecision(template,raw,sql){
  const b=makeActualDecision(template,argumentsFromDecision(raw),renderAdminPreviewSql);
  if(actualCanonical(b.decision)!==actualCanonical(raw)||b.sql!==sql)hold('STORED_DECISION');return b;
}
export function actualRequestSpec(op,{binding,keyId,body}={}){
  let url,method='POST',credential='PAT';
  if(op==='KEY_METADATA'){url=management+'/api-keys?reveal=false';method='GET';}
  else if(op==='KEY_VALUE'){
    if(!binding||!identifier(keyId)||![binding.decision.publishableKeyId,binding.decision.secretKeyId].includes(keyId))hold('KEY_ID');
    url=management+'/api-keys/'+keyId+'?reveal=true';method='GET';
  }else if(op==='INSPECT'){
    if(![inspectSql,activatedInspectSql()].includes(body?.query)||!Array.isArray(body.parameters)||body.parameters.length!==2||body.parameters[1]!==actualOwner.emailSha256)hold('INSPECT_BODY');
    url=management+'/database/query/read-only';
  }
  else if(op==='APPLY_SQL'){
    if(!binding||body?.query!==binding.sql||actualHash(body.query)!==binding.sqlSha256||Object.keys(body).join('|')!=='query')hold('SQL_BYTES');
    url=management+'/database/query';
  }else if(op==='LAUNCH'){
    if(!binding||actualCanonical(body)!==actualCanonical(launchStatement(binding)))hold('LAUNCH_BODY');url=management+'/database/query';
  }else if(op==='FENCE'){
    if(!binding||actualCanonical(body)!==actualCanonical(fenceStatement(binding)))hold('FENCE_BODY');url=management+'/database/query';
  }else if(op==='SESSIONS_READ'||op==='SESSIONS_DELETE'){
    if(!binding||actualCanonical(body)!==actualCanonical(sessionStatement(binding,valuesSessions(body),op==='SESSIONS_DELETE')))hold('SESSION_BODY');
    url=management+'/database/query'+(op==='SESSIONS_READ'?'/read-only':'');
  }else if(op==='CONTROL_STATUS'){
    if(!binding||!['PRESENCE','DETAIL'].some(kind=>actualCanonical(body)===actualCanonical(controlStatusStatement(binding,kind))))hold('STATUS_BODY');
    url=management+'/database/query/read-only';
  }else if(op==='AUTH_LOGOUT'){
    url=previewApi+'/auth/v1/logout?scope=local';credential='PUBLISHABLE';if(body!==undefined)hold('LOGOUT_BODY');
  }else if(op==='AUTH_GET'||op==='AUTH_ROLE'){
    url=previewApi+'/auth/v1/admin/users/'+actualOwner.id;method=op==='AUTH_GET'?'GET':'PUT';credential='SECRET';
    if(op==='AUTH_ROLE'&&actualCanonical(body)!=='{"app_metadata":{"app_role":"admin","product_id":"judoju-news"}}')hold('AUTH_FIELDS');
  }else if(op==='IDENTITY'){url=previewApi+'/rest/v1/rpc/m1_public_identity';credential='PUBLISHABLE';if(actualCanonical(body)!=='{}')hold('IDENTITY_BODY');}
  else if(op==='SERVER_PROBE'){
    if(!body||Object.keys(body).join('|')!=='p_hash'||!/^[0-9a-f]{64}$/.test(body.p_hash))hold('PROBE_BODY');
    url=previewApi+'/rest/v1/rpc/m1_read_admin_session';credential='SECRET';
  }else hold('REQUEST_NOT_ALLOWED');
  if(method==='GET'&&body!==undefined)hold('GET_BODY');
  return Object.freeze({url,method,credential,body});
}
async function request(op,values,credentials){
  const spec=actualRequestSpec(op,values),headers={'Content-Type':'application/json'};
  const key=credentials[spec.credential];if(typeof key!=='string'||!key)hold('CREDENTIAL_UNAVAILABLE');
  if(spec.credential==='PAT')headers.Authorization='Bearer '+key;else headers.apikey=key;
  if(op==='AUTH_LOGOUT'){
    if(typeof values.userToken!=='string'||values.userToken.length>16384||values.userToken.split('.').length!==3)hold('LOGOUT_TOKEN');
    headers.Authorization='Bearer '+values.userToken;
  }
  const cleanup=['FENCE','SESSIONS_READ','SESSIONS_DELETE','AUTH_LOGOUT','CONTROL_STATUS'].includes(op);
  const timeoutMs=credentials.setupBudget&&!cleanup?actualSetupAllowance(credentials.setupBudget,Math.floor(performance.now())).timeoutMs:25000;
  let response;
  try{
    response=await fetch(spec.url,{method:spec.method,headers,body:spec.body===undefined?undefined:JSON.stringify(spec.body),redirect:'error',cache:'no-store',signal:AbortSignal.timeout(timeoutMs)});
    if(!response.ok)hold('HTTP_'+response.status);
    if(op==='AUTH_LOGOUT'&&response.status===204){if(response.body!==null)hold('LOGOUT_RESPONSE_INVALID');return null;}
    if(response.headers.get('content-length')!==null&&(!/^\d+$/.test(response.headers.get('content-length'))||Number(response.headers.get('content-length'))>262144))hold('RESPONSE_SIZE');
    const reader=response.body?.getReader();if(!reader)hold('RESPONSE_BODY');let total=0,count=0;const chunks=[];
    try{while(true){const {value,done}=await reader.read();if(done)break;if(!(value instanceof Uint8Array)||++count>4096||(total+=value.length)>262144)hold('RESPONSE_SIZE');chunks.push(Buffer.from(value));}}
    finally{try{void Promise.resolve(reader.cancel()).catch(()=>{});}catch{}reader.releaseLock();}
    return JSON.parse(Buffer.concat(chunks,total).toString('utf8'));
  }catch(error){if(error instanceof Error&&/^ADMIN_C2_HOLD:HTTP_[1-5][0-9]{2}$/.test(error.message))throw error;hold('REQUEST_UNCONFIRMED');} // Never include response bodies, URLs with data, tokens or provider error objects.
}
export function selectActualKeyMetadata(raw){
  const data=copyActualData(raw);
  if(!Array.isArray(data)||data.length>32)hold('KEY_METADATA_UNSUPPORTED');
  const fields=['api_key','id','type','prefix','name','description','hash','secret_jwt_template','inserted_at','updated_at'];
  const credential=/(?:sb_(?:secret|publishable)_[A-Za-z0-9_-]+|sbp_[A-Za-z0-9_-]+|[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{16,})/;
  function scan(value,field=''){
    if(typeof value==='string'){
      if(field==='prefix'&&['sb_publishable_','sb_secret_'].includes(value))return;
      if(credential.test(value))hold('UNEXPECTED_KEY_DISCLOSURE');
    }else if(value&&typeof value==='object')for(const [k,v]of Object.entries(value))scan(v,k);
  }
  scan(data);
  const text=(v,min,max)=>typeof v==='string'&&v.isWellFormed()&&!/\p{Cc}/u.test(v)&&Array.from(v).length>=min&&Array.from(v).length<=max;
  const rows=[],ids=new Set();
  for(const x of data){
    if(!x||Array.isArray(x)||Object.keys(x).some(k=>!fields.includes(k))||!['publishable','secret','legacy'].includes(x.type)||!text(x.name,1,120))hold('KEY_METADATA_UNSUPPORTED');
    const modern=x.type!=='legacy';
    if(modern?!identifier(x.id):x.id!=null&&!['anon','service_role'].includes(x.id))hold('KEY_METADATA_UNSUPPORTED');
    if(x.id!=null){if(ids.has(x.id))hold('KEY_METADATA_DUPLICATE');ids.add(x.id);}
    for(const k of ['api_key','secret_jwt_template'])if(Object.hasOwn(x,k)&&x[k]!==null)hold('KEY_METADATA_UNSUPPORTED');
    if(x.prefix!=null&&x.prefix!==(modern?'sb_'+x.type+'_':null))hold('KEY_METADATA_UNSUPPORTED');
    if(x.description!=null&&!text(x.description,0,240)||x.hash!=null&&(typeof x.hash!=='string'||!/^[0-9a-f]{64}$/.test(x.hash)))hold('KEY_METADATA_UNSUPPORTED');
    for(const k of ['inserted_at','updated_at'])if(x[k]!=null)actualTime(x[k]);
    if(modern)rows.push({id:x.id,type:x.type});
  }
  const p=rows.filter(x=>x.type==='publishable'),s=rows.filter(x=>x.type==='secret');
  if(p.length!==1||s.length!==1||p[0].id===s[0].id)hold('KEY_SELECTION_AMBIGUOUS');
  return Object.freeze({publishableKeyId:p[0].id,secretKeyId:s[0].id});
}
function selectedKey(raw,id,type){
  if(!raw||raw.id!==id||raw.type!==type||typeof raw.api_key!=='string'||raw.api_key.length>4096
    ||!(type==='publishable'?/^sb_publishable_[A-Za-z0-9_-]+$/:/^sb_secret_[A-Za-z0-9_-]+$/).test(raw.api_key))hold('KEY_VALUE');return raw.api_key;
}
export function validateAuthOwner(raw,{roleApplied=false,serverTime,ownerObservation}={}){
  // Supabase Auth hides IsSSOUser from JSON (json:"-"); current read-only DB identity is authoritative.
  validateActualOwner(ownerObservation);
  const u=copyActualData(raw),serverNow=actualTime(serverTime);
  if(!u||u.id!==actualOwner.id||actualHash(String(u.email??'').trim().toLowerCase())!==actualOwner.emailSha256
    ||typeof u.created_at!=='string'||u.created_at.replace(/\+00:00$/,'Z')!==actualOwner.createdAt.replace(/\+00:00$/,'Z')
    ||!u.email_confirmed_at||!Number.isFinite(Date.parse(u.email_confirmed_at))||Date.parse(u.email_confirmed_at)<Date.parse(u.created_at)||u.is_anonymous!==false||u.is_sso_user!==undefined&&u.is_sso_user!==false
    ||u.deleted_at!=null||u.banned_until!=null&&(!Number.isFinite(Date.parse(u.banned_until))||Date.parse(u.banned_until)>serverNow)
    ||!Array.isArray(u.identities)||u.identities.length!==1||u.identities[0].provider!=='email')hold('AUTH_OWNER');
  const meta=roleApplied?{provider:'email',providers:['email'],app_role:'admin',product_id:'judoju-news'}:{provider:'email',providers:['email']};
  if(actualCanonical(u.app_metadata)!==actualCanonical(meta))hold('AUTH_METADATA');return true;
}

// The complete fixed read-only statement is installed below, not accepted from arguments or a remote page.
const inspectSql="\nwith expected as (\n  select v, pg_catalog.to_regprocedure(v->>'name' || '(' || (v->>'signature') || ')') as oid\n  from pg_catalog.jsonb_array_elements($1::jsonb) j(v)\n), function_drift as (\n  select e.v->>'name' || '(' || (e.v->>'signature') || ')' as name\n  from expected e left join pg_catalog.pg_proc p on p.oid=e.oid\n  where p.oid is null or p.proowner is distinct from 'postgres'::pg_catalog.regrole::oid\n   or p.prosecdef is distinct from (e.v->>'securityDefiner')::boolean\n   or p.provolatile::text is distinct from e.v->>'volatility'\n   or pg_catalog.to_jsonb(p.proconfig) is distinct from e.v->'config'\n   or pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex') is distinct from e.v->>'sha256'\n   or exists(select 1 from pg_catalog.jsonb_array_elements(e.v->'apiRoles') roles(a)\n      where pg_catalog.has_function_privilege(a->>0,p.oid,'EXECUTE') is distinct from (a->>1)::boolean)\n), api_roles as (\n  select rolname, oid from pg_catalog.pg_roles where rolname in ('anon','authenticated','service_role')\n), project_relations as (\n  select c.oid, c.relname, c.relrowsecurity, n.nspname\n  from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid=c.relnamespace\n  where n.nspname in ('public','private','judoju_control') and c.relkind in ('r','p','v','m','f')\n)\nselect pg_catalog.to_char(pg_catalog.clock_timestamp() at time zone 'UTC','YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as server_observed_at, current_user as db_role,\n       pg_catalog.current_setting('transaction_read_only') = 'on' as read_only,\n       (select count(*) from private.runtime_identity\n         where singleton and product_id = 'judoju-news' and environment = 'preview'\n           and bootstrap_id is null) as preview_identity_count,\n       pg_catalog.to_regclass('private.admin_preview_control') is not null as admin_control_present,\n       exists(select 1 from supabase_migrations.schema_migrations where version='20261116000107') as activation_record_present,\n       (select count(*) from judoju_control.environment_identity where singleton and product_id='judoju-news' and environment='dev'\n          and project_ref='nxfpfvsdwbziowkxsxnh' and organization_ref='qfzgicohgpuogehdyzfx') as project_identity_count,\n       (select pg_catalog.jsonb_agg(version order by version) from supabase_migrations.schema_migrations) as history_versions,\n       (select count(*) from auth.users where pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(email)),'UTF8'),'sha256'),'hex')=$2) as selected_admin_matches,\n       (select count(*) from auth.users where pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(email)),'UTF8'),'sha256'),'hex')=$2 and email_confirmed_at is not null\n          and deleted_at is null and (banned_until is null or banned_until<=pg_catalog.now())) as selected_admin_confirmed_active,\n       (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(\n         'id',u.id,'created_at',u.created_at,'confirmed_at',u.email_confirmed_at,\n         'anonymous',u.is_anonymous,'sso',u.is_sso_user,\n         'deleted',u.deleted_at is not null,'banned',coalesce(u.banned_until>pg_catalog.clock_timestamp(),false),\n         'email_sha256',pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(u.email)),'UTF8'),'sha256'),'hex'),\n         'metadata_email_only',u.raw_app_meta_data = '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb,\n         'identity_count',(select count(*) from auth.identities i where i.user_id=u.id),\n         'email_identity_count',(select count(*) from auth.identities i where i.user_id=u.id and i.provider='email')\n       ) order by u.id),'[]'::jsonb) from auth.users u where pg_catalog.encode(extensions.digest(pg_catalog.convert_to(pg_catalog.lower(pg_catalog.btrim(u.email)),'UTF8'),'sha256'),'hex')=$2) as selected_owner_candidates,\n       (select count(*) from expected) as function_baseline_count,\n       (select coalesce(pg_catalog.jsonb_agg(name order by name),'[]'::jsonb) from function_drift) as function_baseline_drift,\n       (select count(*) from private.catalog_source_companies) as catalog_company_count,\n       (select count(*) from private.admin_memberships where active) as active_admin_membership_count,\n       (select count(*) from private.admin_sessions) as admin_session_count,\n       (select count(*) from pg_catalog.pg_event_trigger where evtenabled <> 'D'\n          and evtfoid = pg_catalog.to_regprocedure('public.rls_auto_enable()')) as rls_auto_enable_trigger_count,\n       (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',a.rolname,'schema',n.nspname)\n                 order by a.rolname,n.nspname),'[]'::jsonb)\n          from api_roles a cross join pg_catalog.pg_namespace n\n         where n.nspname in ('public','private','judoju_control') and pg_catalog.has_schema_privilege(a.oid,n.oid,'USAGE')) as api_schema_usage,\n       (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('role',a.rolname,'schema',r.nspname,\n         'relation',r.relname,'rls',r.relrowsecurity,'read',pg_catalog.has_table_privilege(a.oid,r.oid,'SELECT'),\n         'write',pg_catalog.has_table_privilege(a.oid,r.oid,'INSERT,UPDATE,DELETE,TRUNCATE'))\n         order by a.rolname,r.nspname,r.relname),'[]'::jsonb)\n         from api_roles a cross join project_relations r\n         where pg_catalog.has_table_privilege(a.oid,r.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')) as api_relation_access,\n       (select count(*) from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace\n           where n.nspname in ('public','private')) as procedure_count,\n       (select pg_catalog.jsonb_agg(p.proname::text order by p.proname::text)\n          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace\n         where n.nspname='public' and pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE')) as anon_execute_names,\n       (select pg_catalog.jsonb_agg(p.proname::text order by p.proname::text)\n          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace\n         where n.nspname='public' and pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE')) as authenticated_execute_names,\n       (select pg_catalog.jsonb_agg(p.proname::text order by p.proname::text)\n          from pg_catalog.pg_proc p join pg_catalog.pg_namespace n on n.oid=p.pronamespace\n         where n.nspname='public' and pg_catalog.has_function_privilege('service_role',p.oid,'EXECUTE')) as service_role_execute_names;\n";
function expectedFunctions(template){const m=template.match(/for f in select \* from jsonb_array_elements\('(\[.*?\])'::jsonb\) loop/);if(!m)hold('BASELINE');const x=JSON.parse(m[1]);if(x.length!==177)hold('BASELINE');return x;}
function activatedInspectSql(){return inspectSql.replace("u.raw_app_meta_data = '{\"provider\":\"email\",\"providers\":[\"email\"]}'::jsonb", "u.raw_app_meta_data = '{\"provider\":\"email\",\"providers\":[\"email\"],\"app_role\":\"admin\",\"product_id\":\"judoju-news\"}'::jsonb");}
async function inspect(credentials,template,{activated=false}={}){
  const functions=expectedFunctions(template);
  if(activated){
    for(const f of functions){
      if(f.name==='private.active_admin_user'){f.sha256='2ddc2d7c2163e6ddeaf349e10c919f5cffa6a469b0c17c8076fe56ab2114767a';f.volatility='v';}
      if(f.name==='private.is_admin')f.sha256='5520e17b8f844679726928cc892d93035a074d25504f394ade2bf12a068f8939';
      if(f.name==='public.m1_read_admin_session')f.sha256='6fa80cb2d0f9ba26b278464bf63e4764cfde42e5585f1fef18d7096e5c601c18';
      for(const a of f.apiRoles){if(editorFunctions.some(x=>'public.'+x===f.name)&&a[0]==='authenticated')a[1]=true;if(serverFunctions.some(x=>'public.'+x===f.name)&&a[0]==='service_role')a[1]=true;}
    }
    functions.push({name:'private.admin_preview_authority',signature:'uuid,uuid,text,boolean',sha256:'034d5d73dafd844b182a78316fca30ec16f02a6315c88badd3f6a87c75e42f4f',securityDefiner:false,volatility:'v',config:['search_path=""'],apiRoles:[['anon',false],['authenticated',false],['service_role',false]]});
  }
  const rows=await request('INSPECT',{body:{query:activated?activatedInspectSql():inspectSql,parameters:[JSON.stringify(functions),actualOwner.emailSha256]}},credentials);
  if(!Array.isArray(rows)||rows.length!==1)hold('INSPECT_RESPONSE');
  const {server_observed_at:observedAt,...row}=rows[0];
  if(row.db_role!=='supabase_read_only_user'||row.read_only!==true||row.preview_identity_count!==1||row.project_identity_count!==1
    ||row.admin_control_present!==activated||row.activation_record_present!==activated||row.selected_admin_matches!==1||row.selected_admin_confirmed_active!==1
    ||row.function_baseline_count!==(activated?178:177)||row.function_baseline_drift?.length!==0||row.catalog_company_count!==339
    ||row.active_admin_membership_count!==(activated?1:0)||row.admin_session_count!==0||row.selected_owner_candidates?.length!==1
    ||row.api_relation_access?.length!==0||row.procedure_count!==(activated?179:178)||row.rls_auto_enable_trigger_count!==1
    ||actualCanonical(row.api_schema_usage)!==actualCanonical(['anon','authenticated','service_role'].map(role=>({role,schema:'public'})))
    ||actualCanonical(row.history_versions)!==actualCanonical(['20261114000000','20261114000001','20261115000101','20261115000102','20261116000103','20261116000104','20261116000105','20261116000106',...(activated?['20261116000107']:[])])
    ||actualCanonical(row.authenticated_execute_names)!==actualCanonical(['rls_auto_enable',...(activated?editorFunctions:[])].sort())
    ||actualCanonical(row.service_role_execute_names)!==actualCanonical(['rls_auto_enable',...(activated?serverFunctions:[])].sort())
    ||actualCanonical(row.anon_execute_names)!==actualCanonical(['catalog_public_articles','catalog_public_company_sectors','catalog_public_saved','catalog_public_search_companies','catalog_public_search_news','catalog_public_sector_page','catalog_public_tree','m1_public_article','m1_public_identity','rls_auto_enable']))hold('PRESTATE');
  actualTime(observedAt);
  validateActualOwner(row.selected_owner_candidates[0]);
  return {observedAt,prestateSha256:actualHash(actualCanonical(row)),ownerObservation:copyActualData(row.selected_owner_candidates[0])};
}
export function fenceStatement(binding){
  const d=binding.decision;
  return {query:`with fence_lock as materialized (select pg_catalog.pg_advisory_xact_lock(1246704725,1127380914)), fenced as (
    update private.admin_preview_control set enabled=false from fence_lock
    where pg_catalog.current_setting('transaction_isolation')='read committed' and singleton and owner_user_id=$1::uuid and decision_sha256=$2 and implementation_manifest_sha256=$3
      and template_sha256=$4 and effect_key=$5::uuid returning owner_user_id,decision_sha256,enabled
    ), stopped as (update private.admin_memberships m set active=false,updated_at=clock_timestamp()
      from fenced f where m.user_id=f.owner_user_id returning m.user_id)
    select jsonb_build_object('ownerUserId',owner_user_id,'decisionSha256',decision_sha256,'enabled',enabled,
      'membershipsStopped',(select count(*) from stopped)) as receipt from fenced`,
    parameters:[actualOwner.id,binding.decisionSha256,d.implementationManifestSha256,d.templateSha256,d.effectKey]};
}
function valuesSessions(body){
  let rows;try{rows=copyActualData(JSON.parse(body?.parameters?.[2]));}catch{hold('SESSION_BINDINGS');}
  if(!Array.isArray(rows)||rows.length>128)hold('SESSION_BINDINGS');
  const hashes=new Set(),pairs=new Set();
  for(const r of rows){
    if(!r||Object.keys(r).sort().join('|')!=='authSessionId|capabilityHash'||typeof r.authSessionId!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(r.authSessionId)
      ||r.capabilityHash!==null&&(typeof r.capabilityHash!=='string'||!/^[0-9a-f]{64}$/.test(r.capabilityHash)))hold('SESSION_BINDINGS');
    const key=actualCanonical(r);if(pairs.has(key)||r.capabilityHash!==null&&hashes.has(r.capabilityHash))hold('SESSION_BINDINGS');pairs.add(key);if(r.capabilityHash!==null)hashes.add(r.capabilityHash);
  }return rows;
}
export function sessionStatement(binding,sessions,remove){
  // Fixed parameterized owner/session inventory; an absent app row is NOT an absent Auth session.
  const parameters=[actualOwner.id,binding.decisionSha256,JSON.stringify(sessions)];valuesSessions({parameters});
  const guard=`exists(select 1 from private.admin_preview_control c where c.singleton and not c.enabled and c.owner_user_id=$1::uuid and c.decision_sha256=$2)`;
  const known=`known as (select (x->>'authSessionId')::uuid as auth_session_id,x->>'capabilityHash' as capability_hash from jsonb_array_elements($3::jsonb) j(x))`;
  return {parameters,query:remove?`with ${known}, removed as (delete from private.admin_sessions s using known k where s.user_id=$1::uuid and s.auth_session_id=k.auth_session_id and s.capability_hash=k.capability_hash
      and ${guard} and not exists(select 1 from auth.sessions a where a.id=k.auth_session_id and a.user_id=$1::uuid) returning s.capability_hash)
    select jsonb_build_object('deleted',(select count(*) from removed),'fenced',${guard}) as receipt`
    :`with ${known} select jsonb_build_object('fenced',${guard},'sessions',coalesce((select jsonb_agg(jsonb_build_object(
      'capability_hash',k.capability_hash,'user_id',$1::uuid,'auth_session_id',k.auth_session_id,'ciphertext',s.ciphertext,
      'app_present',s.capability_hash is not null,'app_conflict',s.capability_hash is not null and (s.user_id is distinct from $1::uuid or s.auth_session_id is distinct from k.auth_session_id),
      'auth_present',exists(select 1 from auth.sessions a where a.id=k.auth_session_id and a.user_id=$1::uuid)))
      from known k left join private.admin_sessions s on k.capability_hash is not null and s.capability_hash=k.capability_hash where ${guard}),'[]'::jsonb)) as receipt`};
}
function controlStatusStatement(binding,kind){
  if(kind==='PRESENCE')return {query:`select current_user as db_role,current_setting('transaction_read_only')='on' as read_only,
    to_regclass('private.admin_preview_control') is not null as present,
    (select count(*) from auth.users where id=$1::uuid and raw_app_meta_data->>'app_role'='admin' and raw_app_meta_data->>'product_id'='judoju-news') as auth_role_applied`,parameters:[actualOwner.id]};
  if(kind!=='DETAIL')hold('STATUS_KIND');
  return {query:`select owner_user_id,enabled,effect_key,decision_sha256,implementation_manifest_sha256,template_sha256,
    expires_at,launch_effect,launched_at,host_lease_expires_at,clock_timestamp() as observed_at
    from private.admin_preview_control where singleton and owner_user_id=$1::uuid and decision_sha256=$2
      and implementation_manifest_sha256=$3 and template_sha256=$4 and effect_key=$5::uuid`,
    parameters:[actualOwner.id,binding.decisionSha256,binding.decision.implementationManifestSha256,binding.decision.templateSha256,binding.decision.effectKey]};
}
async function status(){
  const d=parse(nativeRead('decision.json')),b=bindStoredActualDecision(templateText(),d,nativeRead('rendered.sql').toString('utf8')),c=credentials();
  try{
    const rows=await request('CONTROL_STATUS',{binding:b,body:controlStatusStatement(b,'PRESENCE')},c);
    if(!Array.isArray(rows)||rows.length!==1||rows[0].db_role!=='supabase_read_only_user'||rows[0].read_only!==true||typeof rows[0].present!=='boolean')hold('STATUS_RESPONSE');
    let control=null;
    if(rows[0].present){const found=await request('CONTROL_STATUS',{binding:b,body:controlStatusStatement(b,'DETAIL')},c);if(!Array.isArray(found)||found.length!==1)hold('STATUS_CONTROL_CONFLICT');control=found[0];}
    return {status:'READ_ONLY_OPERATION_STATUS',effectKey:d.effectKey,control,authRoleApplied:rows[0].auth_role_applied===1,files:nativeActualBoundary('ActualStatus',{}).files,automaticRetry:false};
  }finally{c.PAT=null;}
}
function mark(phase,binding,observedOutcome='INTENT',details=null){
  return writeJson('effect-'+phase+'.json',{schemaVersion:1,ownerUserId:actualOwner.id,decisionSha256:binding.decisionSha256,sqlSha256:binding.sqlSha256,effectKey:binding.decision.effectKey,observedOutcome,...(details===null?{}:{details})});
}
function oneReceipt(rows){if(!Array.isArray(rows)||rows.length!==1||!rows[0]?.receipt||typeof rows[0].receipt!=='object')hold('EFFECT_ACK');return rows[0].receipt;}
async function fence(binding,c,onAcknowledged=()=>{}){
  mark('fence-intent',binding);
  const a=oneReceipt(await request('FENCE',{binding,body:fenceStatement(binding)},c));
  if(a.ownerUserId!==actualOwner.id||a.decisionSha256!==binding.decisionSha256||a.enabled!==false||a.membershipsStopped!==1)hold('FENCE_ACK');
  onAcknowledged();mark('fence-ack',binding,'ACKNOWLEDGED');return true;
}
function readLoginEntries(){
  const r=nativeActualBoundary('ReadActualJournal',{});if(!Array.isArray(r.frames)||r.frames.length>512)hold('JOURNAL');
  return validateLoginJournal(r.frames.map(f=>{const bytes=Buffer.from(f.bytes,'base64');if(actualHash(bytes)!==f.sha256)hold('JOURNAL_HASH');return parse(bytes);}));
}
async function clearKnownSessions(binding,c,encryptionKey){
  const entries=readLoginEntries(),sessions=[];let unknown=false;
  for(const generation of new Set(entries.map(x=>x.generation))){
    const chain=entries.filter(x=>x.generation===generation),known=chain.find(x=>x.authSessionId!==null),cap=chain.find(x=>x.capabilityHash!==null);
    if(!known){unknown=true;continue;}
    const pair={authSessionId:known.authSessionId,capabilityHash:cap?.capabilityHash??null};
    if(!sessions.some(x=>actualCanonical(x)===actualCanonical(pair)))sessions.push(pair);
  }
  const observe=async()=>{
    const receipt=oneReceipt(await request('SESSIONS_READ',{binding,body:sessionStatement(binding,sessions,false)},c));
    if(receipt.fenced!==true||!Array.isArray(receipt.sessions)||receipt.sessions.length!==sessions.length)hold('SESSION_INVENTORY');
    const seen=new Set();
    for(const r of receipt.sessions){
      const key=actualCanonical({authSessionId:r.auth_session_id,capabilityHash:r.capability_hash});
      if(r.user_id!==actualOwner.id||!sessions.some(x=>actualCanonical(x)===key)||seen.has(key)||typeof r.auth_present!=='boolean'||typeof r.app_present!=='boolean'||r.app_conflict!==false
        ||r.app_present&&typeof r.ciphertext!=='string'||!r.app_present&&r.ciphertext!==null)hold('SESSION_OWNER');seen.add(key);
    }return receipt.sessions;
  };
  let rows=await observe();const dispositions=[];
  for(const r of rows){
    let logout='NOT_ATTEMPTED';
    if(r.auth_present){
      if(!r.app_present||!r.ciphertext){unknown=true;logout='MISSING_CIPHERTEXT';}
      else try{
        const payload=unseal(r.ciphertext,encryptionKey);
        if(payload.userId!==actualOwner.id||payload.sessionId!==r.auth_session_id)hold('SESSION_OWNER');
        await request('AUTH_LOGOUT',{userToken:payload.accessToken},c);logout='ACKNOWLEDGED';
      }catch{unknown=true;logout='UNCONFIRMED';}
    }
    dispositions.push({authSessionId:r.auth_session_id,capabilityHash:r.capability_hash,logout});
  }
  rows=await observe();if(rows.some(r=>r.auth_present))unknown=true;
  // Only exact known app rows whose exact Auth session is now absent are eligible for deletion.
  const deleted=oneReceipt(await request('SESSIONS_DELETE',{binding,body:sessionStatement(binding,sessions,true)},c));
  if(deleted.fenced!==true||!Number.isSafeInteger(deleted.deleted)||deleted.deleted<0||deleted.deleted>sessions.length)hold('SESSION_DELETE');
  rows=await observe();if(rows.some(r=>r.auth_present||r.app_present))unknown=true;
  for(const outcome of dispositions){const current=rows.find(r=>r.auth_session_id===outcome.authSessionId&&r.capability_hash===outcome.capabilityHash);outcome.authDisposition=current?.auth_present?'PRESENT':'ABSENT';outcome.appDisposition=current?.app_present?'PRESENT':'ABSENT';}
  return {knownSessions:sessions.length,knownHashes:sessions.filter(x=>x.capabilityHash!==null).length,authResidualUnconfirmed:unknown,sessionDispositions:dispositions};
}
function credentials(){
  const r=nativeActualBoundary('ReadOperatorToken',{});const token=Buffer.from(r.bytes,'base64').toString('utf8').trim();
  if(!token||token.length>8192||!/^[\x21-\x7e]+$/.test(token))hold('OPERATOR_TOKEN');return {PAT:token};
}
async function prepare(manifest){
  if(!/^[0-9a-f]{64}$/.test(manifest??''))hold('IMPLEMENTATION_MANIFEST');
  const c=credentials(),template=templateText();
  const state=await inspect(c,template),keys=selectActualKeyMetadata(await request('KEY_METADATA',{},c));
  const b=makeActualDecision(template,{observedAt:state.observedAt,prestateSha256:state.prestateSha256,...keys,effectKey:randomUUID(),implementationManifestSha256:manifest,expiresAt:new Date(Date.parse(state.observedAt)+7200000).toISOString()},renderAdminPreviewSql);
  nativeActualBoundary('CreateActual',{});writeJson('decision.json',b.decision);nativeWrite('rendered.sql',b.sql);
  return {status:'AWAITING_EXACT_USER_APPROVAL',decisionSha256:b.decisionSha256,sqlSha256:b.sqlSha256,implementationManifestSha256:manifest,
    ownerUserId:actualOwner.id,projectRef:previewProject,expiresAt:b.decision.expiresAt,...keys,actualKeyValuesRead:0,authWrites:0,sqlWrites:0};
}
const secretLeaves=['admin-server.json','activation-proof.json','activation-expected.json'];
function secretCreationAck(raw,leaf,bytes,rootId){
  const r=copyActualData(raw);
  if(!r||Object.keys(r).sort().join('|')!=='fileIdentity|flushed|leaf|rootId|sha256|status'||r.status!=='PASS'||r.leaf!==leaf||r.sha256!==actualHash(bytes)||r.flushed!==true
    ||typeof r.fileIdentity!=='string'||!/^[-0-9:]{5,256}$/.test(r.fileIdentity)||typeof r.rootId!=='string'||!/^[-0-9:]{5,256}$/.test(r.rootId)||rootId!==null&&r.rootId!==rootId)hold('CREATION_ACK');return r;
}
function secretCleanupAck(raw,binding,rootId){
  const r=copyActualData(raw),keys=['schemaVersion','ownerUserId','rootId','decisionSha256','status','reason','allVerified','anyDeletionAttempted','allDeleted','auditRetained','files'];
  if(!r||Object.keys(r).sort().join('|')!==keys.sort().join('|')||r.schemaVersion!==1||r.ownerUserId!==actualOwner.id||r.decisionSha256!==binding.decisionSha256||r.rootId!==rootId
    ||!['PASS','HOLD'].includes(r.status)||typeof r.reason!=='string'||!/^[A-Z_]{3,80}$/.test(r.reason)||!['allVerified','anyDeletionAttempted','allDeleted','auditRetained'].every(k=>typeof r[k]==='boolean')||!Array.isArray(r.files)||r.files.length!==3)hold('SECRET_CLEANUP_ACK');
  for(let i=0;i<3;i++){const f=r.files[i];if(!f||Object.keys(f).sort().join('|')!=='disposition|leaf'||f.leaf!==secretLeaves[i]||!['DELETED','NOT_ATTEMPTED','UNKNOWN'].includes(f.disposition))hold('SECRET_CLEANUP_ACK');}
  if(!r.anyDeletionAttempted&&r.files.some(f=>f.disposition!=='NOT_ATTEMPTED')||r.allDeleted!==r.files.every(f=>f.disposition==='DELETED')
    ||r.anyDeletionAttempted&&!r.allVerified||r.status==='PASS'&&(!r.allDeleted||!r.allVerified||!r.auditRetained))hold('SECRET_CLEANUP_ACK');return r;
}
function operatorFailureCode(error){const match=/^(?:ADMIN_C2_HOLD|ADMIN_ACTUAL_HOLD|ADMIN_PREVIEW_HOLD):([A-Z0-9_]{3,80})$/.exec(error instanceof Error?error.message:'');return match?.[1]??'UNCONFIRMED';}
async function apply(){
  const template=templateText(),d=parse(nativeRead('decision.json')),b=bindStoredActualDecision(template,d,nativeRead('rendered.sql').toString('utf8'));
  const approval=checkActualApproval(parse(nativeRead('approval.json')),b);
  const files=nativeActualBoundary('ActualStatus',{}).files;
  if(!Array.isArray(files)||actualCanonical(files)!==actualCanonical(['actual-owner.json','approval.json','decision.json','rendered.sql'].sort()))hold('PREVIOUS_EFFECT_OR_UNKNOWN');
  const c=credentials();let phase='BEFORE_AUTH',sqlMayExist=false,encryptionKey=null,privateRootId=null;
  const components={keys:{publishable:'NOT_ATTEMPTED',secret:'NOT_ATTEMPTED'},auth:'NOT_ATTEMPTED',authVerification:'NOT_ATTEMPTED',sql:'NOT_ATTEMPTED',files:Object.fromEntries(secretLeaves.map(leaf=>[leaf,{creation:'NOT_ATTEMPTED',cleanup:'NOT_ATTEMPTED'}])),launch:'NOT_ATTEMPTED',host:'NOT_ATTEMPTED',localStop:'NOT_ATTEMPTED',fence:'NOT_ATTEMPTED',sessions:'NOT_ATTEMPTED',cleanup:'NOT_ATTEMPTED'};
  try{
    const setupStart=Math.floor(performance.now());
    const operator=nativeActualBoundary('OperatorIdentity',{}),operatorReceived=Math.floor(performance.now());
    if(!Number.isSafeInteger(operator.pid)||operator.pid<=0||typeof operator.created!=='string'||!/^\d+$/.test(operator.created)||operator.image!=='C:\\Program Files\\nodejs\\node.exe'||typeof operator.qpc!=='string'||!/^\d+$/.test(operator.qpc)||typeof operator.frequency!=='string'||!/^\d+$/.test(operator.frequency)||BigInt(operator.frequency)<=0n)hold('OPERATOR_IDENTITY');
    const setupStartQpc=BigInt(operator.qpc)-(BigInt(operatorReceived-setupStart)*BigInt(operator.frequency)+999n)/1000n;
    if(setupStartQpc<0n)hold('OPERATOR_MONOTONIC');
    const state=await inspect(c,template);if(state.prestateSha256!==d.prestateSha256||Date.parse(state.observedAt)>=Date.parse(d.expiresAt))hold('PRESTATE_CHANGED');
    c.setupBudget=createActualSetupBudget(b,approval,state.observedAt,setupStart,Math.floor(performance.now()));
    components.keys.publishable='UNCONFIRMED';c.PUBLISHABLE=selectedKey(await request('KEY_VALUE',{binding:b,keyId:d.publishableKeyId},c),d.publishableKeyId,'publishable');components.keys.publishable='ACKNOWLEDGED';
    components.keys.secret='UNCONFIRMED';c.SECRET=selectedKey(await request('KEY_VALUE',{binding:b,keyId:d.secretKeyId},c),d.secretKeyId,'secret');components.keys.secret='ACKNOWLEDGED';
    validateAuthOwner(await request('AUTH_GET',{},c),{serverTime:state.observedAt,ownerObservation:state.ownerObservation});
    mark('auth-intent',b);phase='AUTH_UNCONFIRMED';components.auth='UNCONFIRMED';
    await request('AUTH_ROLE',{body:{app_metadata:{app_role:'admin',product_id:'judoju-news'}}},c);components.auth='ACKNOWLEDGED';components.authVerification='UNCONFIRMED';
    validateAuthOwner(await request('AUTH_GET',{},c),{roleApplied:true,serverTime:state.observedAt,ownerObservation:state.ownerObservation});components.authVerification='VERIFIED';mark('auth-ack',b,'ACKNOWLEDGED');
    mark('sql-intent',b);phase='SQL_UNCONFIRMED';sqlMayExist=true;components.sql='UNCONFIRMED';
    await request('APPLY_SQL',{binding:b,body:{query:b.sql}},c);components.sql='ACKNOWLEDGED';phase='SQL_ACKNOWLEDGED';mark('sql-ack',b,'ACKNOWLEDGED');
    const after=await inspect(c,template,{activated:true});
    const id=await request('IDENTITY',{body:{}},c);
    if(id?.productId!=='judoju-news'||id.environment!=='preview'||id.sampleKind!=='SYNTHETIC'||id.bootstrapId!==null||id.contract!=='M1')hold('PUBLIC_IDENTITY');
    const first=await request('SERVER_PROBE',{body:{p_hash:randomBytes(32).toString('hex')}},c);if(first!==null)hold('SERVER_ROLE_MAPPING');
    encryptionKey=randomBytes(32).toString('hex');
    const expected={ownerUserId:actualOwner.id,fixture:false,activationDecisionSha256:b.decisionSha256,implementationManifestSha256:d.implementationManifestSha256,sqlSha256:b.sqlSha256};
    const proof={schemaVersion:1,stage:'CLOUD11A',state:'ADMIN_CONNECTION_ACTIVATED',productId:'judoju-news',projectRef:previewProject,organizationRef:'qfzgicohgpuogehdyzfx',
      ownerUserId:actualOwner.id,fixture:false,approvedAt:approval.confirmedAt,expiresAt:d.expiresAt,activationDecisionSha256:b.decisionSha256,implementationManifestSha256:d.implementationManifestSha256,sqlSha256:b.sqlSha256,
      M2:false,realPublicationEnabled:false,workerEnabled:false,editorFunctions,serverFunctions};
    const proofBytes=Buffer.from(actualCanonical(proof));
    const config={schemaVersion:1,productId:'judoju-news',environment:'preview',sampleKind:'SYNTHETIC',projectRef:previewProject,apiUrl:previewApi,origin:'http://127.0.0.2:62333',
      ownerUserId:actualOwner.id,publishableKey:c.PUBLISHABLE,secretKey:c.SECRET,encryptionKey,proofSha256:actualHash(proofBytes),fixture:false};
    const configBytes=Buffer.from(actualCanonical(config));
    const createdIdentities=new Set();
    for(const [leaf,bytes]of [['activation-expected.json',Buffer.from(actualCanonical(expected))],['activation-proof.json',proofBytes],['admin-server.json',configBytes]]){
      phase='PRIVATE_FILES';components.files[leaf].creation='UNCONFIRMED';
      const ack=secretCreationAck(nativeWrite(leaf,bytes,c.setupBudget),leaf,bytes,privateRootId);privateRootId??=ack.rootId;
      if(createdIdentities.has(ack.fileIdentity))hold('CREATION_IDENTITY_CONFLICT');createdIdentities.add(ack.fileIdentity);components.files[leaf].creation='ACKNOWLEDGED';
    }
    mark('launch-intent',b);phase='LAUNCH_UNCONFIRMED';components.launch='UNCONFIRMED';
    const start=nativeActualBoundary('Clock',{}),a=oneReceipt(await request('LAUNCH',{binding:b,body:launchStatement(b)},c)),end=nativeActualBoundary('Clock',{});
    if(start.frequency!==end.frequency||start.frequency!==operator.frequency)hold('CLOCK_FREQUENCY');
    const ms=x=>{const value=Number(BigInt(x.qpc)*1000n/BigInt(x.frequency));if(!Number.isSafeInteger(value))hold('CLOCK_RANGE');return value;};
    validateLaunchAck(a,b,ms(start),ms(end));components.launch='ACKNOWLEDGED';
    writeJson('launch-consumed.json',{...a,requestQpc:start.qpc,frequency:start.frequency,proofSha256:actualHash(proofBytes),configSha256:actualHash(configBytes),operatorPid:operator.pid,operatorCreated:operator.created,operatorImage:operator.image,setupStartQpc:String(setupStartQpc),setupDeadlineQpc:String(setupStartQpc+BigInt(operator.frequency)*300n)});
    mark('launch-ack',b,'ACKNOWLEDGED');phase='HOST_UNCONFIRMED';components.host='UNCONFIRMED';components.localStop='UNCONFIRMED';
    actualSetupAllowance(c.setupBudget,Math.floor(performance.now()),'NATIVE');
    const host=nativeActualBoundary('Supervise',{mode:'Actual'});
    if(host.cleanupObserved!==true||host.mode!=='Actual')hold('HOST_EXIT_UNCONFIRMED');components.host='ACKNOWLEDGED';components.localStop='ACKNOWLEDGED';mark('host-exit',b,'ACKNOWLEDGED');
    components.fence='UNCONFIRMED';await fence(b,c,()=>{components.fence='ACKNOWLEDGED';});phase='FENCED';components.sessions='UNCONFIRMED';
    const residual=await clearKnownSessions(b,c,encryptionKey);components.sessions=residual.authResidualUnconfirmed?'RESIDUAL_HOLD':'ACKNOWLEDGED';
    if(residual.authResidualUnconfirmed){mark('cleanup',b,'AUTH_RESIDUAL_HOLD');return {status:'HOLD',phase:'FENCED_SESSION_RESIDUAL',...residual,secretFilesDisposition:'NOT_ATTEMPTED',components,automaticRetry:false,automaticAuthInverse:false};}
    components.cleanup='UNCONFIRMED';for(const leaf of secretLeaves)components.files[leaf].cleanup='UNKNOWN';
    const secretCleanup=secretCleanupAck(nativeActualBoundary('DeleteActualSecrets',{}),b,privateRootId);
    for(const file of secretCleanup.files)components.files[file.leaf].cleanup=file.disposition;components.cleanup=secretCleanup.status==='PASS'?'ACKNOWLEDGED':'HOLD';
    if(secretCleanup.status!=='PASS'){mark('cleanup',b,'SECRET_CLEANUP_HOLD');return {status:'HOLD',phase:'FENCED_SECRET_CLEANUP',...residual,secretCleanup,components,automaticRetry:false,automaticAuthInverse:false};}
    mark('cleanup',b,'ACKNOWLEDGED');
    return {status:residual.authResidualUnconfirmed?'HOLD':'DEV_HOST_CLOSED',phase:'FENCED_KNOWN_ROWS_CLEANED',...residual,authMetadataRetained:true,
      launchTombstoneRetained:true,adminConnectionResultReviewRequired:true,actualProductionPublishing:false,components};
  }catch(error){
    if(sqlMayExist&&components.fence==='NOT_ATTEMPTED'){
      components.fence='UNCONFIRMED';try{await fence(b,c,()=>{components.fence='ACKNOWLEDGED';});}catch{}
    }
    const code=operatorFailureCode(error);let holdAudit='UNCONFIRMED';
    try{mark('hold',b,phase,{code,components});holdAudit='ACKNOWLEDGED';}catch{}
    return {status:'HOLD',phase,code,components,holdAudit,fenceConfirmed:components.fence==='ACKNOWLEDGED',automaticRetry:false,automaticAuthInverse:false,authResidualUnconfirmed:components.auth!=='NOT_ATTEMPTED'};
  }finally{c.PAT=null;c.SECRET=null;c.PUBLISHABLE=null;encryptionKey=null;}
}
export async function runActualOperator(argv){
  assertOwnedInvocation();assertEnvironmentBoundary();if(process.versions.node!=='24.15.0')hold('NODE');
  for(const key of ['NODE_OPTIONS','NODE_EXTRA_CA_CERTS','NODE_TLS_REJECT_UNAUTHORIZED','NODE_USE_ENV_PROXY','HTTP_PROXY','HTTPS_PROXY','ALL_PROXY'])if(process.env[key])hold('NETWORK_ENVIRONMENT');
  if(argv.length===2&&argv[0]==='prepare')return prepare(argv[1]);
  if(argv.length===1&&argv[0]==='apply')return apply();
  if(argv.length===1&&argv[0]==='status')return status();
  hold('FIXED_COMMAND');
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const result=await runActualOperator(process.argv.slice(2));console.log(JSON.stringify(result));if(result.status==='HOLD')process.exitCode=1;}
  catch{console.log(JSON.stringify({status:'HOLD',code:'ACTUAL_OPERATOR_NOT_COMPLETE',automaticRetry:false}));process.exitCode=1;}
}
