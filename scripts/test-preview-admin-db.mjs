// Fresh, network-isolated PostgreSQL only. Does not read any actual runtime credentials.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {randomUUID,createHash} from 'node:crypto';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {renderAdminPreviewSql} from './admin-preview-sql.mjs';
import {parseCatalog,cellHash} from './catalog/parse-catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),run=randomUUID(),name='judoju-cloud11a-sql-'+run;
const out=path.join(root,'.local-data/cloud11a-sql-tests',run);mkdirSync(out,{recursive:true});
const image='sha256:7c31363a3f7434ff14945f1b8a4880e6eca8b362e197e88b87c476c77aa3cf8c';
const exe=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker',context=process.platform==='win32'?'desktop-linux':'default';
const env={...process.env};for(const k of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[k];
const read=f=>readFileSync(path.join(root,f),'utf8'),q=x=>"'"+String(x).replaceAll("'","''")+"'";
function docker(args,input){const r=spawnSync(exe,['--context',context,...args],{cwd:root,env,input,encoding:'utf8',windowsHide:true,timeout:60000,maxBuffer:12*1024*1024});if(r.error)throw r.error;return r;}
function must(r,label){if(r.status!==0)throw Error(label+': '+(r.stderr.split(/\r?\n/).find(x=>x.startsWith('ERROR:'))??'COMMAND_FAILED').slice(0,240));return r.stdout.trim();}
const endpoint=must(docker(['context','inspect',context,'--format','{{(index .Endpoints "docker").Host}}']),'DOCKER_CONTEXT');
assert.equal(endpoint,process.platform==='win32'?'npipe:////./pipe/dockerDesktopLinuxEngine':'unix:///var/run/docker.sock');
assert.equal(must(docker(['image','inspect','public.ecr.aws/supabase/postgres:17.11.0.018','--format','{{.Id}}']),'PINNED_OFFICIAL_IMAGE'),image);
writeFileSync(path.join(out,'intent.json'),JSON.stringify({productId:'judoju-news',run,name,image,network:'none',ports:[],phase:'CREATE_INTENT'}));
let cid,cleanupConfirmed=false;const checks=[];
function inspect(){const c=JSON.parse(must(docker(['inspect',cid,'--format','{{json .}}']),'OWNED_INSPECT'));assert.equal(c.Id,cid);assert.equal(c.Name,'/'+name);assert.equal(c.Config.Labels['com.judoju.product'],'judoju-news');assert.equal(c.Config.Labels['com.judoju.cloud11a.run'],run);assert.equal(c.HostConfig.NetworkMode,'none');assert.equal(c.HostConfig.ReadonlyRootfs,true);assert.deepEqual(c.HostConfig.PortBindings,{});assert.ok(c.Mounts.every(m=>m.Type==='tmpfs'));return c;}
function sql(source){inspect();return must(docker(['exec','-i',cid,'psql','-X','-h','/tmp','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-Atq'],source),'ISOLATED_SQL');}
const ownUser=randomUUID(),authSession=randomUUID(),claim={role:'authenticated',sub:ownUser,session_id:authSession};
function as(role,source,claims=claim){return sql('begin;set local role '+role+';select set_config(\'request.jwt.claims\','+q(JSON.stringify({...claims,role}))+',true);'+source+';commit;').split('\n').slice(1).join('\n');}
function pass(name,extra={}){checks.push({name,status:'PASS',...extra});console.log(JSON.stringify(checks.at(-1)));}
const contract=JSON.parse(read('supabase/cloud/admin-preview-dev/rpc-contract.json'));
const historical=JSON.parse(read('supabase/cloud/admin-preview-dev/historical-functions.json')).functions;
assert.equal(historical.length,177);assert.ok(historical.every(f=>typeof f.fixtureDefinitionSql==='string'&&f.fixtureDefinitionSql.startsWith('create or replace function '+f.name+'(')),'Prepared fixture definitions required before container creation');
try{
 cid=must(docker(['run','--pull','never','-d','--name',name,'--label','com.judoju.product=judoju-news','--label','com.judoju.cloud11a.run='+run,'--network','none','--read-only','--tmpfs','/tmp:rw,nosuid,size=268435456','--tmpfs','/var/lib/postgresql/data:rw,nosuid,size=16777216','--tmpfs','/var/run/postgresql:rw,nosuid,size=16777216','--cap-drop','ALL','--security-opt','no-new-privileges','--pids-limit','80','--memory','512m','--cpus','1','--user','postgres','--entrypoint','/bin/bash',image,'-c',"set -eu; initdb -D /tmp/judoju-pg -A trust --no-locale --encoding=UTF8 > /tmp/init.log; exec postgres -D /tmp/judoju-pg -k /tmp -c listen_addresses='' -c shared_preload_libraries='' -c max_connections=20"]),'CREATE_ONCE');
 assert.match(cid,/^[0-9a-f]{64}$/);writeFileSync(path.join(out,'created.json'),JSON.stringify({run,cid}));inspect();
 let ready=false;for(let n=0;n<20;n++){const r=docker(['exec',cid,'pg_isready','-h','/tmp','-U','postgres']);if(r.status===0){ready=true;break;}await pause(250);}assert.equal(ready,true,'Isolated PostgreSQL readiness');
 sql(`create role anon nologin;create role authenticated nologin;create role service_role nologin bypassrls;create role supabase_admin nologin;create role authenticator nologin;
 create schema extensions;create schema auth;create schema supabase_migrations;
 create table auth.users(id uuid primary key,email text,raw_app_meta_data jsonb not null default '{}',deleted_at timestamptz,banned_until timestamptz);
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
 insert into auth.users(id,email,raw_app_meta_data) values('${ownUser}','owner@example.invalid','{"app_role":"admin","product_id":"judoju-news"}');
 insert into auth.sessions(id,user_id,not_after) values('${authSession}','${ownUser}',now()+interval '2 hours');`);
 sql(contract.publicReadRpc.map(x=>'grant execute on function public.'+x.name+'('+x.signature+') to anon;').join('\n'));
 const rendered=renderAdminPreviewSql(read('supabase/cloud/admin-preview-dev/activation-template.sql'),{ownerUserId:ownUser,effectKey:run,decisionSha256:'a'.repeat(64),implementationManifestSha256:'b'.repeat(64),expiresAt:new Date(Date.now()+3600000).toISOString()});
 sql(rendered.sql);pass('Prepared guarded activation SQL executes only in owned network-none fixture; native history8 to9');
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
  const u=randomUUID(),s=randomUUID();sql(`insert into auth.users values('${u}','${variant}@example.invalid','{"app_role":"${variant==='general'?'reader':'admin'}","product_id":"judoju-news"}',${variant==='deleted'?'now()':'null'},${variant==='banned'?"now()+interval '1 hour'":'null'});insert into auth.sessions values('${s}','${u}',${variant==='expired_auth'?"now()-interval '1 hour'":"now()+interval '1 hour'"});${variant==='metadata_only'?'':`insert into private.admin_memberships(user_id,active) values('${u}',${variant==='inactive'?'false':'true'});`}insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) values('${createHash('sha256').update(u).digest('hex')}','${u}','${s}','FIXTURE_ENCRYPTED_NOT_REAL_TOKEN',${variant==='expired_app'?"now()-interval '1 second'":"now()+interval '1 hour'"});`);
  const calls=contract.rpc.filter(x=>x.role==='authenticated').map(x=>`begin perform public.${x.name}(${nullArgs(x)});raise exception 'UNEXPECTED_EDITOR_SUCCESS';exception when insufficient_privilege then if sqlerrm<>'EDITOR_ONLY' then raise;end if;end;`).join('\n');
  as('authenticated','do $deny$ begin '+calls+'end $deny$',{sub:u,session_id:s});pass('All21 editor RPCs deny '+variant);
 }
 // Losing any current owner authorization invalidates every editor RPC even with an old confirmed claim.
 for(const [label,change] of [['membership',`update private.admin_memberships set active=false where user_id='${ownUser}'`],['control',`update private.admin_preview_control set enabled=false`],['role',`update auth.users set raw_app_meta_data='{"app_role":"reader","product_id":"judoju-news"}' where id='${ownUser}'`],['product',`update auth.users set raw_app_meta_data='{"app_role":"admin","product_id":"different"}' where id='${ownUser}'`],['deleted',`update auth.users set deleted_at=now() where id='${ownUser}'`],['banned',`update auth.users set banned_until=now()+interval '1 hour' where id='${ownUser}'`],['auth-expired',`update auth.sessions set not_after=now()-interval '1 second' where id='${authSession}'`],['capability-expired',`update private.admin_sessions set expires_at=now()-interval '1 second' where user_id='${ownUser}'`]]){
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
 assert.equal(sql('select count(*) from private.catalog_source_companies'),'339');assert.equal(sql("select count(*) from pg_extension where extname in ('pg_cron','pg_graphql')"),'0');
 pass('Reference companies339 preserved; no cron, network, actual keys or hosted DB calls');
}finally{
 if(cid){const c=inspect();if(c.State.Running)must(docker(['stop','--time','5',cid]),'OWNED_STOP');inspect();must(docker(['rm',cid]),'OWNED_REMOVE');cleanupConfirmed=true;}
 writeFileSync(path.join(out,'result.json'),JSON.stringify({productId:'judoju-news',run,checks,cleanupConfirmed,actualRemoteRequests:0,actualKeysRead:0,auth:'STUB_NOT_HOSTED_AUTH',network:'none',ports:[]},null,2));
}
assert.equal(cleanupConfirmed,true);
console.log(JSON.stringify({status:'PASS',stage:'CLOUD11A_ISOLATED_SQL',checks:checks.length,cleanupConfirmed,actualRemoteRequests:0,actualKeysRead:0,result:path.relative(root,path.join(out,'result.json')).replaceAll('\\','/'),limitations:'Fresh network-none PostgreSQL/Auth stub. Direct SQL roles do not certify hosted Auth or secret gateway mapping.'}));
