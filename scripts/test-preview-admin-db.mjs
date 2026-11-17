// Fresh, network-isolated PostgreSQL only. Does not read any actual runtime credentials.
import assert from 'node:assert/strict';
import {spawnSync,spawn} from 'node:child_process';
import {controlledEnvironment} from '../apps/admin/lib/preview-file-boundary.mjs';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {renderAdminPreviewSql} from './admin-preview-sql.mjs';
import {launchStatement,actualOwner} from '../apps/admin/lib/preview-actual-lifecycle.mjs';
import {fenceStatement,sessionStatement} from './admin-preview-actual-setup.mjs';
import {parseCatalog,cellHash} from './catalog/parse-catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=randomUUID(),name='judoju-cloud11a-sql-'+run;
assert.ok(process.argv.length===2||process.argv.length===3&&process.argv[2]==='--prepare-image','Only the fixed image preparation option is accepted');
const preparingImage=process.argv[2]==='--prepare-image';
const out=path.join(root,preparingImage?'.local-data/cloud11a-sql-image-prep':'.local-data/cloud11a-sql-tests',run);mkdirSync(out,{recursive:true});
const image='sha256:7c31363a3f7434ff14945f1b8a4880e6eca8b362e197e88b87c476c77aa3cf8c';
const imageReference='public.ecr.aws/supabase/postgres@'+image;
// One immutable OCI image; containerd reports its index ID, classic graphdriver its config ID.
const legacyConfigImage='sha256:6239631994fc42313226a957c946bdc4770ea4526f3e163b440a51c9d6af5d1e';
const acceptedImageIds=[image,legacyConfigImage];
const exe=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker',context=process.platform==='win32'?'desktop-linux':'default';
const env=controlledEnvironment();for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
const read=f=>readFileSync(path.join(root,f),'utf8'),q=x=>"'"+String(x).replaceAll("'","''")+"'";
function docker(args,input,timeout=60000){const r=spawnSync(exe,['--context',context,...args],{cwd:root,env,input,encoding:'utf8',windowsHide:true,timeout,maxBuffer:12*1024*1024});if(r.error)throw r.error;return r;}
function must(r,label){if(r.status!==0)throw Error(label+': '+(r.stderr.split(/\r?\n/).find(x=>x.startsWith('ERROR:'))??'COMMAND_FAILED').slice(0,240));return r.stdout.trim();}
const endpoint=must(docker(['context','inspect',context,'--format','{{(index .Endpoints "docker").Host}}']),'DOCKER_CONTEXT');
assert.equal(endpoint,process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock');
let imageObservation=docker(['image','inspect',imageReference,'--format','{{json .}}']);
let downloaded=false;
if(imageObservation.status!==0&&preparingImage){
 writeFileSync(path.join(out,'intent.json'),JSON.stringify({productId:'judoju-news',run,imageReference,phase:'DEPENDENCY_DOWNLOAD_ONLY',maximumMs:300000}));
 must(docker(['pull','--platform','linux/amd64',imageReference],undefined,300000),'PINNED_OFFICIAL_IMAGE_DOWNLOAD');downloaded=true;
 imageObservation=docker(['image','inspect',imageReference,'--format','{{json .}}']);
}
const pinnedImage=JSON.parse(must(imageObservation,'PINNED_OFFICIAL_IMAGE_PREP_REQUIRED'));
assert.ok(acceptedImageIds.includes(pinnedImage.Id),'Exact pinned OCI index/config identity');assert.equal(pinnedImage.Os,'linux');assert.equal(pinnedImage.Architecture,'amd64');assert.ok(pinnedImage.RepoDigests.includes(imageReference));
if(preparingImage){
 const receipt={status:'PASS',stage:'PINNED_SQL_IMAGE_DEPENDENCY_PREPARATION',run,imageReference,imageId:pinnedImage.Id,downloaded,sqlExecuted:false,containersCreated:0,actualRemoteRequests:0,actualKeysRead:0,limitations:'Official registry dependency preparation only; not an SQL test or hosted DB validation.'};
 writeFileSync(path.join(out,'result.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));process.exit(0);
}
writeFileSync(path.join(out,'intent.json'),JSON.stringify({productId:'judoju-news',run,name,image,network:'none',ports:[],phase:'CREATE_INTENT'}));
let cid,cleanupConfirmed=false;const checks=[];
function inspect(){const c=JSON.parse(must(docker(['inspect',cid,'--format','{{json .}}']),'OWNED_INSPECT'));assert.equal(c.Id,cid);assert.equal(c.Config.Image,imageReference);assert.ok(acceptedImageIds.includes(c.Image));assert.equal(c.Name,'/'+name);assert.equal(c.Config.Labels['com.judoju.product'],'judoju-news');assert.equal(c.Config.Labels['com.judoju.cloud11a.run'],run);assert.equal(c.HostConfig.NetworkMode,'none');assert.equal(c.HostConfig.ReadonlyRootfs,true);assert.deepEqual(c.HostConfig.PortBindings,{});assert.ok(c.Mounts.every(m=>m.Type==='tmpfs'));return c;}
function sql(source){inspect();return must(docker(['exec','-i',cid,'psql','-X','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],source),'ISOLATED_SQL');}
const ownUser=actualOwner.id,authSession=randomUUID(),claim={role:'authenticated',sub:ownUser,session_id:authSession};
function as(role,source,claims=claim){return sql('begin;set local role '+role+';select set_config(\'request.jwt.claims\','+q(JSON.stringify({...claims,role}))+',true);'+source+';commit;').split('\n').slice(1).join('\n');}
function pass(name,extra={}){checks.push({name,status:'PASS',...extra});console.log(JSON.stringify(checks.at(-1)));}
const contract=JSON.parse(read('supabase/cloud/admin-preview-dev/rpc-contract.json'));
const historical=JSON.parse(read('supabase/cloud/admin-preview-dev/historical-functions.json')).functions;
assert.equal(historical.length,177);assert.ok(historical.every(f=>typeof f.fixtureDefinitionSql==='string'&&f.fixtureDefinitionSql.startsWith('create or replace function '+f.name+'(')),'Prepared fixture definitions required before container creation');
try{
 cid=must(docker(['run','--pull','never','-d','--name',name,'--label','com.judoju.product=judoju-news','--label','com.judoju.cloud11a.run='+run,'--network','none','--read-only','--tmpfs','/tmp:rw,nosuid,size=268435456','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=16777216','--tmpfs','/var/run/postgresql:rw,nosuid,size=16777216','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','80','--memory','512m','--cpus','1','--user','postgres','--platform','linux/amd64','--entrypoint','/bin/bash',imageReference,'-c',"set -eu; initdb -D /tmp/judoju-pg -A trust --no-locale --encoding=UTF8 > /tmp/init.log; exec postgres -D /tmp/judoju-pg -k /tmp -c listen_addresses='' -c shared_preload_libraries='' -c max_connections=20"]),'CREATE_ONCE');
 assert.match(cid,/^[0-9a-f]{64}$/);writeFileSync(path.join(out,'created.json'),JSON.stringify({run,cid}));inspect();
 let ready=false;for(let n=0;n<20;n++){const r=docker(['exec',cid,'pg_isready','-h','/tmp','-U','postgres']);if(r.status===0){ready=true;break;}await pause(250);}assert.equal(ready,true,'Isolated PostgreSQL readiness');
 sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role supabase_admin nologin;create role authenticator nologin;
 create schema extensions;create schema auth;create schema supabase_migrations;
 create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}',deleted_at timestamptz,banned_until timestamptz,email_confirmed_at timestamptz default clock_timestamp(),is_anonymous boolean not null default false,is_sso_user boolean not null default false);
 create table auth.identities(id uuid primary key default gen_random_uuid(),user_id uuid not null references auth.users(id),provider text not null);
 create table auth.sessions(id uuid primary key,user_id uuid not null references auth.users(id) on delete cascade,not_after timestamptz);
 create function auth.uid() returns uuid language sql stable as $$select (nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'sub')::uuid$$;
 create table supabase_migrations.schema_migrations(version text primary key,name text,statements text[]);`);
 const migrations=readdirSync(path.join(root,'supabase/migrations')).filter(x=>/^\d{14}_.+\.sql$/.test(x)).sort();assert.equal(migrations.length,50);
 for(const f of migrations){
  let body=read('supabase/migrations/'+f);
  // Fixture projection only: the hosted archive deliberately omits pg_cron.
  // The actual local migration and its existing tests remain byte-frozen.
  if(f==='20261114000003_m0_queue.sql'){assert.equal(body.split('create extension if not exists pg_cron;').length,2);body=body.replace('create extension if not exists pg_cron;','-- Fixture projection: no pg_cron installed or scheduled.');}
  sql(body);
 }
 pass('Fresh isolated50 schema projections; one pg_cron CREATE omitted explicitly; Auth stub, not hosted Auth');
 const source=read('tests/fixtures/catalog/source-20261114.json'),registry=read('tests/fixtures/catalog/registry-v1.json');
 const preview=JSON.stringify(parseCatalog(JSON.parse(source),JSON.parse(registry),{sourceSha256:cellHash(source)}),null,2)+'\n';
 sql(`update private.runtime_identity set bootstrap_id='${randomUUID()}'::uuid;select private.catalog_seed_reference(${q(source)},${q(registry)},${q(preview)});`);
 assert.equal(sql('select count(*) from private.catalog_source_companies'),'339');pass('Own fixture reference seed339 and catalog2; no existing DB/config reused');
 sql(`update private.runtime_identity set environment='preview',bootstrap_id=null;
 create schema judoju_control;
 create table judoju_control.environment_identity(singleton boolean,product_id text,environment text,organization_ref text,project_ref text);
 insert into judoju_control.environment_identity values(true,'judoju-news','dev','qfzgicohgpuogehdyzfx','nxfpfvsdwbziowkxsxnh');
 create table judoju_control.schema_artifacts(version text,project_ref text,runtime_environment text,source_sha256 text,state text);
 insert into judoju_control.schema_artifacts values('20261114000001','nxfpfvsdwbziowkxsxnh','preview','5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa','STAGED_DISABLED');`);
 // Reproduce the exact archived bodies over the matching local signatures; then verify every pg_get_functiondef SHA.
 sql(`set check_function_bodies=false;do $install$ declare f jsonb;begin for f in select * from jsonb_array_elements(${q(JSON.stringify(historical))}::jsonb) loop
 execute f->>'fixtureDefinitionSql';
 end loop;end $install$;`);
 const diffs=JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('name',f->>'name','actualDefinition',pg_get_functiondef(to_regprocedure((f->>'name')||'('||(f->>'signature')||')')),'expectedSha256',f->>'definitionSha256')),'[]') from jsonb_array_elements(${q(JSON.stringify(historical))}::jsonb) f where encode(extensions.digest(convert_to(pg_get_functiondef(to_regprocedure((f->>'name')||'('||(f->>'signature')||')')),'UTF8'),'sha256'),'hex')<>f->>'definitionSha256'`));
 writeFileSync(path.join(out,'function-diffs.json'),JSON.stringify(diffs,null,2));assert.equal(diffs.length,0,'Exact historical function SHA mismatch: '+diffs.map(x=>x.name).join(','));
 pass('All177 PostgreSQL function definitions exactly match historical cloud SHA, not a claimed hosted/Auth equivalence');
 sql(`revoke execute on all functions in schema public,private from public,anon,authenticated,service_role;
 revoke all on all tables in schema private from public,anon,authenticated,service_role;
 revoke all on all sequences in schema private from public,anon,authenticated,service_role;
 revoke all on schema private from public,anon,authenticated,service_role;
 grant usage on schema public to anon,authenticated,service_role;
 insert into supabase_migrations.schema_migrations(version,name,statements) values ${['20261114000000','20261114000001','20261115000101','20261115000102','20261116000103','20261116000104','20261116000105','20261116000106'].map(v=>'('+q(v)+",'ISOLATED_HISTORY_STUB',array['FIXTURE'])").join(',')};
 insert into auth.users(id,email,raw_app_meta_data) values('${ownUser}','owner@judoju-c2.invalid','{"app_role":"admin","product_id":"judoju-news","provider":"email","providers":["email"]}');
 insert into auth.identities(user_id,provider) values('${ownUser}','email');
 insert into auth.sessions(id,user_id,not_after) values('${authSession}','${ownUser}',now()+interval '2 hours');`);
 sql(contract.publicReadRpc.map(x=>'grant execute on function public.'+x.name+'('+x.signature+') to anon;').join('\n'));
 const template=read('supabase/cloud/admin-preview-dev/activation-template.sql');
 const controlDdl=template.slice(template.indexOf('create table private.admin_preview_control('),template.indexOf('alter table private.admin_preview_control'));
 const definitions=[...template.matchAll(/create(?: or replace)? function (private\.admin_preview_authority|private\.active_admin_user|private\.is_admin|public\.m1_read_admin_session)\([\s\S]*?\$function\$;/g)].map(m=>m[0]);assert.equal(definitions.length,4);
 const identities=['private.admin_preview_authority(uuid,uuid,text,boolean)','private.active_admin_user(uuid,uuid)','private.is_admin()','public.m1_read_admin_session(text)'];
 const definitionHashes=JSON.parse(sql('begin;'+controlDdl+';'+definitions.join('\n')+"select jsonb_object_agg(v,encode(extensions.digest(convert_to(pg_get_functiondef(v::regprocedure),'UTF8'),'sha256'),'hex')) from unnest(array["+identities.map(q).join(',')+"]) n(v);rollback;"));
 writeFileSync(path.join(out,'function-definition-shas.json'),JSON.stringify(definitionHashes,null,2));
 for(const [signature,hash]of Object.entries(definitionHashes))assert.ok(template.includes("'"+hash+"'"),'Pin exact current definition '+signature+': '+hash);
 const proofExpiry=new Date(Date.now()+3600000).toISOString();
 const rendered=renderAdminPreviewSql(read('supabase/cloud/admin-preview-dev/activation-template.sql'),{ownerUserId:ownUser,ownerEmailSha256:createHash('sha256').update('owner@judoju-c2.invalid').digest('hex'),effectKey:run,decisionSha256:'a'.repeat(64),implementationManifestSha256:'b'.repeat(64),expiresAt:proofExpiry});
 const productionBinding={decision:{ownerUserId:ownUser,projectRef:'nxfpfvsdwbziowkxsxnh',effectKey:run,launchEffect:run,implementationManifestSha256:'b'.repeat(64),templateSha256:rendered.templateSha256,expiresAt:proofExpiry},decisionSha256:'a'.repeat(64)};
 function preparedStatement(spec){const types=spec.parameters.length===6?'uuid,text,text,text,uuid,timestamptz':spec.parameters.length===3?'uuid,text,jsonb':'uuid,text,text,text,uuid';return 'prepare c2_bound('+types+') as '+spec.query+';execute c2_bound('+spec.parameters.map(q).join(',')+');deallocate c2_bound;';}
 const fixtureProcedureCountBefore=Number(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')"));assert.equal(fixtureProcedureCountBefore,183);
 sql(rendered.sql);
 const fixtureExtraRoutines=JSON.parse(sql(`select coalesce(jsonb_agg(jsonb_build_object('signature',n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')','definition',pg_get_functiondef(p.oid),'definitionSha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'))),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.oid not in(select to_regprocedure((v->>'name')||'('||(v->>'signature')||')') from jsonb_array_elements(${q(JSON.stringify(historical))}::jsonb) x(v)) and p.oid is distinct from to_regprocedure('private.admin_preview_authority(uuid,uuid,text,boolean)') and p.oid is distinct from to_regprocedure('public.rls_auto_enable()')`));
 writeFileSync(path.join(out,'fixture-extra-routines.json'),JSON.stringify(fixtureExtraRoutines,null,2));
 const pinnedLocalOnly=[{"signature":"public.m0_bootstrap(p_bootstrap uuid)","definitionSha256":"455b95c57f29aa85c591751b46735aefb460381010642cac2137dc15db0361c3"},{"signature":"public.m0_hold_for_timeout(p_seconds numeric)","definitionSha256":"eb59f88b2fa23ece4873c97608549e71660e149249f79248e0ff6db7f2340c1b"},{"signature":"public.m0_lock_probe()","definitionSha256":"66efa7c2642014c7ed6e5b39901e6838bb0ab5836597cc5996d6d4027c5389ea"},{"signature":"public.m0_pre_request()","definitionSha256":"9241256f8b524d6e95aaa053943a6b57616613e4f1b9a56be732d6d069f76d4f"},{"signature":"public.m0_schedule_fixture(p_run uuid, p_effect_key text)","definitionSha256":"289dfcd8a707d4d661602255b8885a52cd2db7b97707e00627887e5098df4f33"},{"signature":"public.m0_stop_fixture_schedule(p_run uuid)","definitionSha256":"02a34a3efcefcc550f0855b1a06068b6e4bbf4c674ca6d1ba3de7880d05fe0a4"}];
 assert.deepEqual(fixtureExtraRoutines.map(({signature,definitionSha256})=>({signature,definitionSha256})).sort((a,b)=>a.signature.localeCompare(b.signature)),pinnedLocalOnly);
 assert.equal(sql("select to_regprocedure('public.rls_auto_enable()') is null"),'t','Hosted auto-RLS trigger is not created by the local fixture');
 for(const entry of fixtureExtraRoutines){const identity=entry.signature.replace(/p_[a-z_]+ /g,'');for(const role of ['anon','authenticated','service_role'])assert.equal(sql("select has_function_privilege("+q(role)+','+q(identity)+",'EXECUTE')"),'f');}
 pass('Local fixture183 before/184 after: six exact pinned M0-only routines, no API grants; hosted178/179 is a separate inventory',{localOnly:6,hostedRlsTriggerEmulated:false});

 assert.equal(sql('select count(*) from private.admin_preview_control where launched_at is null and host_lease_expires_at is null'),'1');
 for(const binding of [
  {...productionBinding,decisionSha256:'f'.repeat(64)},
  {...productionBinding,decision:{...productionBinding.decision,implementationManifestSha256:'c'.repeat(64)}},
  {...productionBinding,decision:{...productionBinding.decision,templateSha256:'d'.repeat(64)}},
  {...productionBinding,decision:{...productionBinding.decision,expiresAt:new Date(Date.parse(proofExpiry)+1000).toISOString()}},
 ])assert.equal(sql(preparedStatement(launchStatement(binding))),'','Mismatched binding cannot consume launch');
 assert.equal(sql('select count(*) from private.admin_preview_control where launched_at is null'),'1');
 pass('Production launch rejects mismatched decision/implementation/template/expiry bindings without consuming slot');
 const winner=liveClient('launch-first','begin;'+preparedStatement(launchStatement(productionBinding)));let loser,launchAck;
 try{
  await winner.ready;loser=liveClient('launch-concurrent','begin;'+preparedStatement(launchStatement(productionBinding)));
  let blocked=false;for(let n=0;n<25;n++){blocked=sql("select exists(select 1 from pg_stat_activity where application_name="+q(loser.app)+" and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0)")==='t';if(blocked)break;await pause(25);}assert.equal(blocked,true,'Concurrent production launch waits on original consume');
  winner.child.stdin.end('commit;\n');const first=await winner.done;assert.equal(first.code,0);await loser.ready;loser.child.stdin.end('commit;\n');const second=await loser.done;assert.equal(second.code,0);
  const receipts=first.output.split(/\r?\n/).filter(x=>x.startsWith('{'));assert.equal(receipts.length,1);launchAck=JSON.parse(receipts[0]);assert.equal(second.output.split(/\r?\n/).filter(x=>x.startsWith('{')).length,0);
  pass('Two concurrent exact production launch calls yield exactly one ACK and one empty result',{blockedBeforeRelease:true});
 }finally{
  winner.child.stdin.end('rollback;\n');if(loser)loser.child.stdin.end('rollback;\n');const ended=await Promise.allSettled([winner.done,loser?.done??Promise.resolve()]);if(ended.some(x=>x.status==='rejected'))throw Error('C2_LAUNCH_TEARDOWN_UNCONFIRMED');
 }

 assert.equal(launchAck.launchEffect,run);assert.equal(launchAck.ownerUserId,ownUser);assert.equal(Date.parse(launchAck.expiresAt)-Date.parse(launchAck.serverTime),1800000);
 assert.equal(sql(preparedStatement(launchStatement(productionBinding))),'');
 pass('Exact production parameterized launch ACK and one-use replay denial; one server timestamp');
 pass('Prepared guarded activation SQL executes only in owned network-none fixture; native history8 to9');
 assert.equal(as('service_role',`select public.m1_read_admin_session('${'a'.repeat(64)}')`),'');
 as('service_role',`select public.m1_open_admin_session('${ownUser}','${authSession}','${'b'.repeat(64)}','FIXTURE_ENCRYPTED_NOT_REAL_TOKEN',now()+interval '30 minutes')`);
 assert.equal(JSON.parse(as('authenticated','select public.m1_check_editor()')).admin,true);pass('Server3 role mapping and owner capability guards (direct SET ROLE only, not hosted gateway mapping)');
 const nullArgs=x=>x.signature?x.signature.split(',').map(t=>'null::'+t).join(','):'';
 for(const role of ['anon','service_role']){
  const calls=contract.rpc.filter(x=>x.role==='authenticated').map(x=>`begin perform public.${x.name}(${nullArgs(x)});raise exception 'UNEXPECTED_EDIT_GRANT';exception when insufficient_privilege then null;end;`).join('\n');
  as(role,'do $deny$ begin '+calls+'end $deny$');pass('All21 editor RPCs reject role '+role);
 }
 const variants=['general','metadata_only','inactive','deleted','banned','expired_auth','expired_app','wrong_owner'];
 for(const variant of variants){
  const u=randomUUID(),s=randomUUID();sql(`insert into auth.users(id,email,raw_app_meta_data,deleted_at,banned_until) values('${u}','${variant}@example.invalid','{"app_role":"${variant==='general'?'reader':'admin'}","product_id":"judoju-news"}',${variant==='deleted'?'now()':'null'},${variant==='banned'?"now()+interval '1 hour'":'null'});insert into auth.sessions values('${s}','${u}',${variant==='expired_auth'?"now()-interval '1 hour'":"now()+interval '1 hour'"});${variant==='metadata_only'?'':`insert into private.admin_memberships(user_id,active) values('${u}',${variant==='inactive'?'false':'true'});`}insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) values('${createHash('sha256').update(u).digest('hex')}','${u}','${s}','FIXTURE_ENCRYPTED_NOT_REAL_TOKEN',${variant==='expired_app'?"now()-interval '1 second'":"now()+interval '1 hour'"});`);
  const calls=contract.rpc.filter(x=>x.role==='authenticated').map(x=>`begin perform public.${x.name}(${nullArgs(x)});raise exception 'UNEXPECTED_EDITOR_SUCCESS';exception when insufficient_privilege then if sqlerrm<>'EDITOR_ONLY' then raise;end if;end;`).join('\n');
  as('authenticated','do $deny$ begin '+calls+'end $deny$',{sub:u,session_id:s});pass('All21 editor RPCs deny '+variant);
 }
 // Losing any current owner authorization invalidates every editor RPC even with an old confirmed claim.
 for(const [label,change] of [['membership',`update private.admin_memberships set active=false where user_id='${ownUser}'`],['control',`update private.admin_preview_control set enabled=false`],['role',`update auth.users set raw_app_meta_data='{"app_role":"reader","product_id":"judoju-news"}' where id='${ownUser}'`],['product',`update auth.users set raw_app_meta_data='{"app_role":"admin","product_id":"different"}' where id='${ownUser}'`],['deleted',`update auth.users set deleted_at=now() where id='${ownUser}'`],['banned',`update auth.users set banned_until=now()+interval '1 hour' where id='${ownUser}'`],['auth-expired',`update auth.sessions set not_after=now()-interval '1 second' where id='${authSession}'`],['capability-expired',`update private.admin_sessions set expires_at=now()-interval '1 second' where user_id='${ownUser}'`],
 ['unconfirmed',`update auth.users set email_confirmed_at=null where id='${ownUser}'`],
 ['anonymous',`update auth.users set is_anonymous=true where id='${ownUser}'`],
 ['sso',`update auth.users set is_sso_user=true where id='${ownUser}'`],
 ['email',`update auth.users set email='other@example.invalid' where id='${ownUser}'`],
 ['provider',`update auth.users set raw_app_meta_data=raw_app_meta_data||'{"provider":"google","providers":["google"]}'::jsonb where id='${ownUser}'`],
 ['identity-missing',`delete from auth.identities where user_id='${ownUser}'`],
 ['identity-duplicate',`insert into auth.identities(user_id,provider) values('${ownUser}','email')`],
 ['identity-provider',`update auth.identities set provider='google' where user_id='${ownUser}'`]]){
  const calls=contract.rpc.filter(x=>x.role==='authenticated').map(x=>`begin perform public.${x.name}(${nullArgs(x)});raise exception 'UNEXPECTED_OWNER_SUCCESS';exception when insufficient_privilege then if sqlerrm<>'EDITOR_ONLY' then raise;end if;end;`).join('\n');
  sql('begin;'+change+";set local role authenticated;select set_config('request.jwt.claims',"+q(JSON.stringify(claim)) +",true);do $deny$ begin "+calls+'end $deny$;rollback;');pass('All21 current-owner guards independently deny '+label);
 }
 const draft=JSON.parse(as('authenticated',`select public.m1_create_draft('${randomUUID()}')`)),issue=draft.issue_id;
 const d=JSON.parse(as('authenticated',`select public.m1_get_draft('${issue}')`));
 const sector=sql("select id from private.sectors where private.catalog_sector_selectable(id,(select version from private.catalog_head),'SYNTHETIC') order by display_order,id limit 1");
 const content={...d.content,title:'SYNTHETIC CLOUD11A 게시 검증',summary:'격리 DB 검증용 합성 기사',primary_sector_id:sector,key_issues:['합성 핵심 이슈'],issue_analysis:'실제 뉴스가 아닌 격리 PostgreSQL의 저장 및 게시 경로 검증입니다.',impacts:[{sector_id:sector,path_id:'fixture-benefit',direction:'BENEFIT',conditional_direction:'NONE',description:'합성 영향',conditions:[],evidence_ids:[d.claim_id]}],scenarios:[{direction:'POSITIVE',title:'합성 긍정',expected_result:'합성 예상',checks:['합성 확인'],path_ids:['fixture-benefit']}],risks:['합성 리스크'],schedule:[]};
 as('authenticated',`select public.catalog_save_draft('${issue}',${d.draft_revision},${q(JSON.stringify(content))}::jsonb,${d.catalog_version})`);
 const saved=JSON.parse(as('authenticated',`select public.m1_get_draft('${issue}')`));assert.equal(saved.content.title,content.title);
 as('authenticated',`select public.m1_preview_draft('${issue}',${saved.draft_revision},${saved.policy_version},${saved.catalog_version})`);
 const effect=randomUUID(),publish=`select public.m1_publish_draft('${issue}',${saved.draft_revision},${saved.issue_revision},${saved.policy_version},${saved.catalog_version},'${effect}')`;
 const published=JSON.parse(as('authenticated',publish)),repeated=JSON.parse(as('authenticated',publish));assert.equal(published.status,'APPLIED');assert.equal(repeated.status,'ALREADY_APPLIED');assert.equal(repeated.version_id,published.version_id);assert.equal(repeated.revision,published.revision);
 assert.equal(sql(`select count(*) from private.article_versions where issue_id='${issue}'`),'1');
 assert.equal(sql(`select publication_state from private.issues where id='${issue}'`),'PUBLISHED');
 const revision=sql(`select revision from private.issues where id='${issue}'`);as('authenticated',`select public.m1_set_state('${issue}',${revision},'HIDDEN','${randomUUID()}')`);
 assert.equal(sql(`select publication_state from private.issues where id='${issue}'`),'HIDDEN');pass('Actual SQL create/save/preview/publish/idempotent recheck/hide (synthetic fixture only)');
 const catalogBefore=sql("select encode(extensions.digest(convert_to(private.catalog_document()::text,'UTF8'),'sha256'),'hex')");
 sql(`begin;set local role authenticated;select set_config('request.jwt.claims',${q(JSON.stringify(claim))},true);
 do $catalog$ declare h bigint:=2;r jsonb;parent uuid;leaf uuid;g uuid;c uuid;m uuid;k text;payload jsonb;previous bigint;begin
 r:=public.catalog_editor_sectors();if r->>'catalog_version'<>'2' then raise exception 'FIXTURE_HEAD';end if;
 perform public.catalog_editor_index(0,100);perform public.catalog_editor_tree();
 r:=public.catalog_apply(h,gen_random_uuid()::text,'SECTOR_CREATE',null,jsonb_build_object('name','SYNTHETIC CLOUD11A parent','catalog_kind','PARENT'));if r->>'status'<>'APPLIED' then raise exception 'PARENT_CREATE %',r;end if;parent:=(r->>'entity_id')::uuid;h:=(r->>'catalog_version')::bigint;
 r:=public.catalog_apply(h,gen_random_uuid()::text,'SECTOR_CREATE',null,jsonb_build_object('name','SYNTHETIC CLOUD11A leaf','catalog_kind','LEAF','parent_id',parent));if r->>'status'<>'APPLIED' then raise exception 'LEAF_CREATE %',r;end if;leaf:=(r->>'entity_id')::uuid;h:=(r->>'catalog_version')::bigint;
 r:=public.catalog_apply(h,gen_random_uuid()::text,'SECTOR_UPDATE',leaf,jsonb_build_object('description',E'섹터 설명\\n둘째 줄'));if r->>'status'<>'APPLIED' then raise exception 'SECTOR_UPDATE %',r;end if;h:=(r->>'catalog_version')::bigint;
 r:=public.catalog_apply(h,gen_random_uuid()::text,'GROUP_CREATE',null,jsonb_build_object('sector_id',leaf,'name','SYNTHETIC 하위 묶음'));if r->>'status'<>'APPLIED' then raise exception 'GROUP_CREATE %',r;end if;g:=(r->>'entity_id')::uuid;h:=(r->>'catalog_version')::bigint;
 r:=public.catalog_apply(h,gen_random_uuid()::text,'COMPANY_CREATE',null,jsonb_build_object('name','SYNTHETIC CLOUD11A 기업','search_description',E'기업 설명\\n둘째 줄','direct_terms',jsonb_build_array('HBM'),'industry_terms',jsonb_build_array('반도체')));if r->>'status'<>'APPLIED' then raise exception 'COMPANY_CREATE %',r;end if;c:=(r->>'entity_id')::uuid;h:=(r->>'catalog_version')::bigint;
 r:=public.catalog_apply(h,gen_random_uuid()::text,'MEMBERSHIP_CREATE',null,jsonb_build_object('sector_id',leaf,'subgroup_id',g,'source_company_ref',c,'role','합성 부품'));if r->>'status'<>'APPLIED' then raise exception 'MEMBERSHIP_CREATE %',r;end if;m:=(r->>'entity_id')::uuid;h:=(r->>'catalog_version')::bigint;
 k:=gen_random_uuid()::text;previous:=h;payload:=jsonb_build_object('keyword_kind','CORE','terms',jsonb_build_array('HBM','CXL'));
 r:=public.catalog_apply(previous,k,'SECTOR_KEYWORDS',leaf,payload);if r->>'status'<>'APPLIED' then raise exception 'KEYWORDS %',r;end if;h:=(r->>'catalog_version')::bigint;
 if public.catalog_apply(previous,k,'SECTOR_KEYWORDS',leaf,payload)<>r then raise exception 'CATALOG_DUPLICATE';end if;
 if public.catalog_operation_status(previous,k,'SECTOR_KEYWORDS',leaf,payload)->>'status'<>'APPLIED' then raise exception 'CATALOG_OPERATION_LOOKUP';end if;
 perform public.catalog_editor_sector(leaf,h,0,25);perform public.catalog_editor_companies(0,50,'SYNTHETIC CLOUD11A');perform public.catalog_editor_company(c,h);perform public.catalog_editor_group(g,h);perform public.catalog_editor_membership(m,h);
 r:=public.catalog_apply(h,gen_random_uuid()::text,'REORDER',null,jsonb_build_object('scope','SECTORS','parent_id',parent,'ids',jsonb_build_array(leaf)));if r->>'status' not in ('APPLIED','REJECTED') then raise exception 'REORDER_RESULT';end if;if r->>'status'='APPLIED' then h:=(r->>'catalog_version')::bigint;elsif r->>'error'<>'CATALOG_NO_CHANGE' then raise exception 'REORDER %',r;end if;
 r:=public.catalog_editor_impact(parent,h);
 r:=public.catalog_apply(h,gen_random_uuid()::text,'SECTOR_DEACTIVATE',parent,jsonb_build_object('impact_sha256',r->>'impact_sha256'));if r->>'status'<>'APPLIED' then raise exception 'SECTOR_DEACTIVATE %',r;end if;
 end $catalog$;rollback;`);
 assert.equal(sql("select encode(extensions.digest(convert_to(private.catalog_document()::text,'UTF8'),'sha256'),'hex')"),catalogBefore);pass('All catalog read routes plus sector/group/company/membership/keyword writes and idempotent lookup; owned transaction rolled back');

 function liveClient(label,source){
  const app='c2-'+run+'-'+createHash('sha256').update(label).digest('hex').slice(0,16);assert.ok(Buffer.byteLength(app)<=63);
  const child=spawn(exe,['--context',context,'exec','-e','PGAPPNAME='+app,'-i',cid,'psql','-X','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],{cwd:root,env,windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',errors='',settled=false,resolveDone,rejectReady;
  const rawDone=new Promise(resolve=>{resolveDone=resolve;});let completionTimer;
  const done=Promise.race([rawDone,new Promise((_,reject)=>{completionTimer=setTimeout(()=>reject(Error('C2_CLIENT_COMPLETION_TIMEOUT')),15000);})]).finally(()=>clearTimeout(completionTimer));done.catch(()=>{});
  const marker='C2_LOCK_HELD_'+label;
  const ready=new Promise((resolve,reject)=>{
   rejectReady=reject;const timer=setTimeout(()=>reject(Error('C2_CLIENT_MARKER_TIMEOUT')),10000);
   child.stdout.on('data',x=>{output+=x.toString();if(output.length>1048576){clearTimeout(timer);reject(Error('C2_CLIENT_OUTPUT_LIMIT'));child.stdin.end('rollback;\n');}if(output.includes(marker)){clearTimeout(timer);resolve();}});
   child.on('close',()=>{clearTimeout(timer);if(!output.includes(marker))reject(Error('C2_CLIENT_BEFORE_MARKER'));});
  });
  ready.catch(()=>{});child.stderr.on('data',x=>{errors+=x.toString().slice(0,4096);});child.on('error',()=>{rejectReady(Error('C2_CLIENT_ERROR'));if(!settled){settled=true;resolveDone({code:-1,output,errors});}});
  child.on('close',code=>{if(!settled){settled=true;resolveDone({code,output,errors});}});
  child.stdin.on('error',()=>{});child.stdin.write(source+';select '+q(marker)+';\n');return {app,child,ready,done};
 }
 async function capabilityWait(label,role,change,expectedCipher=null){
  const cap='b'.repeat(64),cipher='FIXTURE_ENCRYPTED_NOT_REAL_TOKEN';
  const restore=()=>sql(`delete from private.admin_sessions where capability_hash='${cap}';insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) values('${cap}','${ownUser}','${authSession}','${cipher}',clock_timestamp()+interval '30 minutes');`);
  restore();
  const lock=liveClient('cap-lock-'+label,'begin;select pg_advisory_xact_lock(1246704725,1127380914)');let waiter;
  try{
   await lock.ready;
   if(change==='PASSAGE')sql(`update private.admin_sessions set expires_at=clock_timestamp()+interval '5 seconds' where capability_hash='${cap}'`);
   const check=role==='authenticated'?"do $cap$ begin perform public.m1_check_editor();raise exception 'UNEXPECTED_CAP_GRANT';exception when insufficient_privilege then if sqlerrm<>'EDITOR_ONLY' then raise;end if;end $cap$"
    :`do $cap$ declare r jsonb;begin r:=public.m1_read_admin_session('${cap}');if ${expectedCipher===null?'r is not null':"r is null or r->>'ciphertext' is distinct from "+q(expectedCipher)} then raise exception 'STALE_CAP_READ';end if;end $cap$`;
   waiter=liveClient('cap-wait-'+label,'begin isolation level read committed read only;set local role '+role+";select set_config('request.jwt.claims',"+q(JSON.stringify({...claim,role}))+',true);'+check);
   let blocked=false;
   for(let n=0;n<25;n++){blocked=sql("select exists(select 1 from pg_stat_activity where application_name="+q(waiter.app)+" and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0)")==='t';if(blocked)break;await pause(25);}
   assert.equal(blocked,true,'Current capability check must wait '+label);
   if(change==='PASSAGE'){
    assert.equal(sql(`select a.xact_start<s.expires_at from pg_stat_activity a cross join private.admin_sessions s where a.application_name=${q(waiter.app)} and s.capability_hash='${cap}'`),'t','Waiting transaction started before capability expiry');
    let expired=false;for(let n=0;n<60;n++){expired=sql(`select clock_timestamp()>=expires_at from private.admin_sessions where capability_hash='${cap}'`)==='t';if(expired)break;await pause(100);}assert.equal(expired,true,'Actual server time passed expiry');
   }else if(change==='REVOKE')sql(`update private.admin_sessions set revoked_at=clock_timestamp() where capability_hash='${cap}'`);
   else if(change==='DELETE')sql(`delete from private.admin_sessions where capability_hash='${cap}'`);
   else if(change==='REPLACE')sql(`delete from private.admin_sessions where capability_hash='${cap}';insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) values('${cap}','${ownUser}','${authSession}',${q(expectedCipher)},clock_timestamp()+interval '30 minutes')`);
   else throw Error('UNKNOWN_CAP_FIXTURE');
   lock.child.stdin.end('commit;\n');assert.equal((await lock.done).code,0);await waiter.ready;waiter.child.stdin.end('rollback;\n');assert.equal((await waiter.done).code,0);
   pass('Current app capability after advisory wait '+label,{role,change,blockedBeforeRelease:true,currentCiphertext:expectedCipher!==null,physicalCommitTimeQualificationProven:false});
  }finally{
   lock.child.stdin.end('rollback;\n');if(waiter)waiter.child.stdin.end('rollback;\n');
   const ended=await Promise.allSettled([lock.done,waiter?.done??Promise.resolve()]);if(ended.some(x=>x.status==='rejected'))throw Error('C2_CAP_TEARDOWN_UNCONFIRMED');restore();
  }
 }
 async function fenceCase(label,role,statement,late){
  sql("update private.admin_preview_control set enabled=true where singleton;update private.admin_memberships set active=true where user_id='"+ownUser+"'");
  const a=liveClient(label+'-grant','begin;set local role '+role+";select set_config('request.jwt.claims',"+q(JSON.stringify({...claim,role}))+',true);'+statement);
  let b;
  try{
   await a.ready;
   b=liveClient(label+'-fence',preparedStatement(fenceStatement(productionBinding)));
   // The marker can only be printed after the UPDATE returns. Observe the actual native lock wait first.
   let blocked=false;for(let n=0;n<20;n++){
    blocked=sql("select exists(select 1 from pg_stat_activity where application_name="+q(b.app)+" and wait_event_type='Lock' and cardinality(pg_blocking_pids(pid))>0)")==='t';
    if(blocked)break;await pause(25);
   }
   assert.equal(blocked,true,'Fence must block on '+label);
   a.child.stdin.end('rollback;\n');assert.equal((await a.done).code,0);
   await b.ready;b.child.stdin.end('\\q\n');assert.equal((await b.done).code,0);
   if(late==='NULL')assert.equal(as(role,statement),'');else assert.throws(()=>as(role,statement),new RegExp(late));
   pass('C2 native two-session fence '+label,{role,blockedBeforeRelease:true,afterFence:late,physicalCommitTimeQualificationProven:false});
  }finally{
   if(!a.child.killed)a.child.stdin.end('rollback;\n');if(b&&!b.child.killed)b.child.stdin.end('\\q\n');
   const teardown=await Promise.allSettled([a.done,b?.done??Promise.resolve()]);if(teardown.some(r=>r.status==='rejected'))throw Error('C2_TEARDOWN_UNCONFIRMED');
   sql("update private.admin_preview_control set enabled=true where singleton;update private.admin_memberships set active=true where user_id='"+ownUser+"'");
  }
 }
 const race=JSON.parse(as('authenticated',`select public.m1_create_draft('${randomUUID()}')`)),raceIssue=race.issue_id;
 let rd=JSON.parse(as('authenticated',`select public.m1_get_draft('${raceIssue}')`));
 const rc={...content,impacts:content.impacts.map(x=>({...x,evidence_ids:[rd.claim_id]}))};
 as('authenticated',`select public.catalog_save_draft('${raceIssue}',${rd.draft_revision},${q(JSON.stringify(rc))}::jsonb,${rd.catalog_version})`);
 rd=JSON.parse(as('authenticated',`select public.m1_get_draft('${raceIssue}')`));
 as('authenticated',`select public.m1_preview_draft('${raceIssue}',${rd.draft_revision},${rd.policy_version},${rd.catalog_version})`);
 const h=sql('select version from private.catalog_head'),group=sql("select id from private.subgroups where metadata_kind='USER_REFERENCE_UNVERIFIED' limit 1"),membership=sql('select id from private.catalog_memberships limit 1'),company=sql('select id from private.catalog_source_companies limit 1');
 const actionKey=randomUUID(),actionPayload=q(JSON.stringify({name:'SYNTHETIC C2 fence company'}));
 const statements={
  m1_check_editor:'select public.m1_check_editor()',m1_editor_articles:'select public.m1_editor_articles()',m1_get_draft:`select public.m1_get_draft('${raceIssue}')`,
  m1_operation_status:`select public.m1_operation_status('${raceIssue}','${randomUUID()}')`,m1_create_draft:`select public.m1_create_draft('${randomUUID()}')`,
  m1_save_draft:`select public.m1_save_draft('${raceIssue}',${rd.draft_revision},${q(JSON.stringify(rd.content))}::jsonb)`,
  catalog_save_draft:`select public.catalog_save_draft('${raceIssue}',${rd.draft_revision},${q(JSON.stringify(rd.content))}::jsonb,${rd.catalog_version})`,
  m1_preview_draft:`select public.m1_preview_draft('${raceIssue}',${rd.draft_revision},${rd.policy_version},${rd.catalog_version})`,
  m1_publish_draft:`select public.m1_publish_draft('${raceIssue}',${rd.draft_revision},${rd.issue_revision},${rd.policy_version},${rd.catalog_version},'${randomUUID()}')`,
  m1_set_state:`select public.m1_set_state('${issue}',${sql(`select revision from private.issues where id='${issue}'`)}::bigint,'WITHDRAWN','${randomUUID()}')`,
  catalog_editor_sectors:'select public.catalog_editor_sectors()',catalog_editor_index:'select public.catalog_editor_index(0,25)',catalog_editor_tree:`select public.catalog_editor_tree(${h})`,
  catalog_editor_sector:`select public.catalog_editor_sector('${sector}',${h},0,25)`,catalog_editor_companies:"select public.catalog_editor_companies(0,25,'')",
  catalog_editor_company:`select public.catalog_editor_company('${company}',${h})`,catalog_editor_group:`select public.catalog_editor_group('${group}',${h})`,
  catalog_editor_membership:`select public.catalog_editor_membership('${membership}',${h})`,catalog_editor_impact:`select public.catalog_editor_impact('${sector}',${h})`,
  catalog_apply:`select public.catalog_apply(${h},'${actionKey}','COMPANY_CREATE',null,${actionPayload}::jsonb)`,
  catalog_operation_status:`select public.catalog_operation_status(${h},'${actionKey}','COMPANY_CREATE',null,${actionPayload}::jsonb)`
 };
 assert.deepEqual(Object.keys(statements).sort(),contract.rpc.filter(x=>x.role==='authenticated').map(x=>x.name).sort());
 const callMatrix=JSON.parse(sql(`select jsonb_agg(jsonb_build_object('name','public.'||(v->>'name'),'signature',v->>'signature','definitionSha256',encode(extensions.digest(convert_to(pg_get_functiondef(p.oid),'UTF8'),'sha256'),'hex'),'volatility',p.provolatile::text,'securityDefiner',p.prosecdef,'config',p.proconfig,'fixtureRole',v->>'role','rowSecuritySetting',current_setting('row_security'),'repeatContext','one native transaction holds the common shared advisory fence until explicit rollback; following transaction denied after exclusive fence')) from jsonb_array_elements(${q(JSON.stringify(contract.rpc))}::jsonb) n(v) join pg_proc p on p.oid=to_regprocedure('public.'||(v->>'name')||'('||(v->>'signature')||')')`));
 const readOnly=callMatrix.filter(x=>x.fixtureRole==='authenticated'&&x.volatility==='s');assert.equal(readOnly.length,9);
 for(const route of readOnly){
  const name=route.name.slice(7),statement=statements[name];assert.ok(statement);
  sql('begin isolation level read committed read only;set local role authenticated;select set_config(\'request.jwt.claims\','+q(JSON.stringify(claim))+',true);'+statement+';rollback;');
  pass('READ ONLY supported current authority '+name,{volatility:route.volatility,isolation:'read committed'});
 }
 for(const isolation of ['repeatable read','serializable']){
  for(const route of readOnly){const statement=statements[route.name.slice(7)].replace(/^select /,'perform ');
   sql('begin isolation level '+isolation+' read only;set local role authenticated;select set_config(\'request.jwt.claims\','+q(JSON.stringify(claim))+",true);do $isolation$ begin "+statement+";raise exception 'UNEXPECTED_ISOLATION_GRANT';exception when insufficient_privilege then if sqlerrm<>'EDITOR_ONLY' then raise;end if;end $isolation$;rollback;");
  }
  assert.equal(sql('begin isolation level '+isolation+" read only;set local role service_role;select public.m1_read_admin_session('"+'b'.repeat(64)+"');rollback;"),'');
  pass('Unsupported transaction snapshot mode denies all9 stable routes and exact hash read',{isolation});
 }
 writeFileSync(path.join(out,'c2-call-matrix.json'),JSON.stringify(callMatrix,null,2));assert.equal(callMatrix.length,24);
 for(const role of ['authenticated','service_role']){
  await capabilityWait(role+'-revoke',role,'REVOKE');await capabilityWait(role+'-clock-expiry',role,'PASSAGE');
 }
 await capabilityWait('hash-read-deleted-candidate','service_role','DELETE');
 await capabilityWait('hash-read-replaced-ciphertext','service_role','REPLACE','FIXTURE_REPLACED_CURRENT_CIPHERTEXT');
 assert.equal(sql("select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private')"),'184');
 pass('Fixture184 procedures: archived177+one helper+six pinned local-only M0; all174 unchanged baseline definitions pinned; hosted179 remains separately required');
 for(const [label,stmt]of Object.entries(statements))await fenceCase(label,'authenticated',stmt,'EDITOR_ONLY');
 await fenceCase('m1_open_admin_session','service_role',`select public.m1_open_admin_session('${ownUser}','${authSession}','${'e'.repeat(64)}','FIXTURE_C2_ENCRYPTED',now()+interval '20 minutes')`,'ADMIN_SESSION_FORBIDDEN');
 await fenceCase('m1_read_admin_session','service_role',`select public.m1_read_admin_session('${'b'.repeat(64)}')`,'NULL');
 // Exact production cleanup inventory: the missing app row must not hide its known Auth session.
 sql(preparedStatement(fenceStatement(productionBinding)));
 const knownPairs=[{authSessionId:authSession,capabilityHash:'b'.repeat(64)}];
 const sessionView=()=>JSON.parse(sql(preparedStatement(sessionStatement(productionBinding,knownPairs,false))));
 let view=sessionView();assert.equal(view.fenced,true);assert.equal(view.sessions.length,1);assert.equal(view.sessions[0].auth_present,true);assert.equal(view.sessions[0].app_present,true);
 assert.equal(JSON.parse(sql(preparedStatement(sessionStatement(productionBinding,knownPairs,true)))).deleted,0,'A present Auth session protects its ciphertext row');
 sql(`delete from private.admin_sessions where capability_hash='${'b'.repeat(64)}'`);view=sessionView();assert.equal(view.sessions[0].auth_present,true);assert.equal(view.sessions[0].app_present,false);
 pass('Exact production session inventory sees known Auth session when its app row is absent');
 const noHash=JSON.parse(sql(preparedStatement(sessionStatement(productionBinding,[{authSessionId:authSession,capabilityHash:null}],false))));assert.equal(noHash.sessions[0].auth_present,true);assert.equal(noHash.sessions[0].app_present,false);
 pass('Known session without a capability hash remains independently visible');
 sql(`insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) values('${'b'.repeat(64)}','${ownUser}','${authSession}','FIXTURE_ENCRYPTED_NOT_REAL_TOKEN',clock_timestamp()+interval '30 minutes')`);
 const mismatch=[{authSessionId:randomUUID(),capabilityHash:'b'.repeat(64)}];
 assert.equal(JSON.parse(sql(preparedStatement(sessionStatement(productionBinding,mismatch,false)))).sessions[0].app_conflict,true);
 assert.equal(JSON.parse(sql(preparedStatement(sessionStatement(productionBinding,mismatch,true)))).deleted,0);
 const unbound={...productionBinding,decisionSha256:'e'.repeat(64)};const deniedInventory=JSON.parse(sql(preparedStatement(sessionStatement(unbound,knownPairs,false))));assert.equal(deniedInventory.fenced,false);assert.deepEqual(deniedInventory.sessions,[]);
 pass('Production cleanup rejects mismatched session identity or decision fence');
 // Only the owned Auth stub is changed here; no provider or hosted Auth mutation.
 sql(`delete from auth.sessions where id='${authSession}' and user_id='${ownUser}'`);view=sessionView();assert.equal(view.sessions[0].auth_present,false);assert.equal(view.sessions[0].app_present,false,'The frozen production FK cascades the app row when the Auth session disappears');
 assert.equal(JSON.parse(sql(preparedStatement(sessionStatement(productionBinding,knownPairs,true)))).deleted,0);view=sessionView();assert.equal(view.sessions[0].auth_present,false);assert.equal(view.sessions[0].app_present,false);
 pass('Exact production cleanup independently observes both absences after the frozen Auth-session cascade; repeated app cleanup is a no-op');
 sql(`insert into auth.sessions(id,user_id,not_after) values('${authSession}','${ownUser}',clock_timestamp()+interval '2 hours');insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) values('${'b'.repeat(64)}','${ownUser}','${authSession}','FIXTURE_ENCRYPTED_NOT_REAL_TOKEN',clock_timestamp()+interval '30 minutes')`);
 // Close is revocation-only and may execute after the fence. A missing read grants no session authority.
 sql('update private.admin_preview_control set enabled=false where singleton');
 assert.equal(as('service_role',`select public.m1_read_admin_session('${'f'.repeat(64)}')`),'');
 as('service_role',`select public.m1_close_admin_session('${'b'.repeat(64)}')`);
 pass('C2 read-null and close are non-grant paths; 21 editor and two grant-bearing server paths fenced');
 sql('update private.admin_preview_control set enabled=true where singleton');
 assert.equal(sql('select count(*) from private.catalog_source_companies'),'339');assert.equal(sql("select count(*) from pg_extension where extname in ('pg_cron','pg_graphql')"),'0');
 pass('Reference companies339 preserved; no cron, network, actual keys or hosted DB calls');
 const stalled=liveClient('real-stalled-client','begin');await stalled.ready;stalled.child.stdin.end('select pg_sleep(3600);rollback;\n');
 await assert.rejects(stalled.done,/C2_CLIENT_COMPLETION_TIMEOUT/);
 pass('Real stalled owned SQL client has bounded completion; outer owned container stop/remove remains mandatory',{completionDeadlineMs:15000});

}finally{
 if(cid){const c=inspect();if(c.State.Running)must(docker(['stop','--time','5',cid]),'OWNED_STOP');inspect();must(docker(['rm',cid]),'OWNED_REMOVE');cleanupConfirmed=true;}
 writeFileSync(path.join(out,'result.json'),JSON.stringify({productId:'judoju-news',run,checks,cleanupConfirmed,actualRemoteRequests:0,actualKeysRead:0,auth:'STUB_NOT_HOSTED_AUTH',network:'none',ports:[]},null,2));
}
assert.equal(cleanupConfirmed,true);
console.log(JSON.stringify({status:'PASS',stage:'CLOUD11A_ISOLATED_SQL',checks:checks.length,cleanupConfirmed,actualRemoteRequests:0,actualKeysRead:0,result:path.relative(root,path.join(out,'result.json')).replaceAll('\\','/'),limitations:'Fresh network-none PostgreSQL/Auth stub. Direct SQL roles do not certify hosted Auth or secret gateway mapping.'}));
