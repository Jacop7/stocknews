// Publish stage 1B, migration 59 (real public read): one transaction on the local Supabase DB, rolled back.
// Uses the newest current published synthetic M1 SECTOR issue as a template and as the synthetic control. Real copies of
// its draft are published through the real editor path, then read through the ten public reads under both switch
// states, withdrawn, timed out and expired. Requires the local stack with migration 59 applied.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const psql = ['exec', '-i', 'supabase_db_judoju-news-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const probe = spawnSync(docker, psql, { input: "select to_regprocedure('private.public_read_kind()') is not null;", encoding: 'utf8', windowsHide: true });
assert.equal(probe.status, 0, probe.stderr);
assert.equal(probe.stdout.trim(), 't', 'migration 59 must be applied locally');

const tryDo = (name, sql) => `do $$ begin ${sql}; raise notice 'R|${name}|PASSED'; exception when others then raise notice 'R|${name}|%', sqlerrm; end $$;`;
// Editor calls run as the signed-in fixture editor; arguments come from table x (private tables are not readable then).
const refresh = `reset role;
update x set drev=(select revision from private.editor_drafts where issue_id=x.issue),irev=(select revision from private.issues where id=x.issue);`;
// An editor call (perform ... from x) that matches no row must not pass silently.
const asEditor = (name, sql) => `${refresh}
set local role authenticated;
${tryDo(name, sql.startsWith('perform ') ? sql + "; if not found then raise exception 'NO_TARGET_ROW'; end if" : sql)}
reset role;`;
const publish = (name, who, key) => asEditor(name, `perform public.m1_publish_draft(x.issue,x.drev,x.irev,x.pol,x.cat,'${key}') from x where x.name='${who}'`);
// A replay sends the same arguments again (no refresh), as a client retry would.
const publishResult = (name, who, key, replay = false) => `${replay ? 'reset role;' : refresh}
set local role authenticated;
do $$ declare r jsonb; begin select public.m1_publish_draft(x.issue,x.drev,x.irev,x.pol,x.cat,'${key}') into r from x where x.name='${who}'; raise notice 'R|${name}|%', r->>'status'; exception when others then raise notice 'R|${name}|%', sqlerrm; end $$;
reset role;`;
const READS = `concat_ws(',',
  'news_public='||((select count(*) from public.news_public n where n.issue_id=p.issue_id)>0),
  'news_list='||((select count(*) from public.news_list n where n.issue_id=p.issue_id)>0),
  'resolve='||(public.resolve_issue(p.issue_id)->>'state'='PUBLISHED'),
  'get_public_article='||(public.get_public_article(p.issue_id)->>'state'='PUBLISHED'),
  'm1_public_article='||(public.m1_public_article(p.issue_id)->>'state'='PUBLISHED'),
  'm1_public_articles='||exists(select 1 from jsonb_array_elements(public.m1_public_articles(null,50,p.as_of)) x where x->>'issue_id'=p.issue_id::text),
  'catalog_articles='||exists(select 1 from jsonb_array_elements(public.catalog_public_articles(p.head,'{}','TODAY',50,p.as_of)->'items') x where x->>'issue_id'=p.issue_id::text),
  'search='||exists(select 1 from jsonb_array_elements(public.catalog_public_search_news(p.head,p.word,20,p.as_of)->'items') x where x->>'issue_id'=p.issue_id::text),
  'saved='||exists(select 1 from jsonb_array_elements(public.catalog_public_saved(p.head,array[p.issue_id])->'items') x where x->>'state'='PUBLISHED'),
  'company='||exists(select 1 from jsonb_array_elements(public.catalog_public_company(p.head,p.company,20,p.as_of)->'items') x where x->>'issue_id'=p.issue_id::text))`;
// Probe rows are rebuilt from the current versions each time (title word, publication time, linked company).
const reads = (tag, names) => `reset role;
delete from probe;
insert into probe select x.name,i.id,(select head from h),i.first_published_at+interval '1 second',split_part(trim(v.public_body->>'title'),' ',1),(select id from co)
  from x join private.issues i on i.id=x.issue join private.article_versions v on v.id=i.current_version_id where x.name in (${names.map(n => `'${n}'`).join(',')});
${['anon', 'authenticated'].map(role => `set local role ${role};
select 'R|reads_${tag}_${role}_'||p.name||'|'||${READS} from probe p order by p.name;
reset role;`).join('\n')}`;

const sql = `begin;
create temp table h as select (public.catalog_public_tree(null)->>'catalog_version')::bigint head;
create temp table pol as select version from private.policies where active order by version desc limit 1;
create temp table co as select distinct m.source_company_ref id from private.catalog_memberships m,h where private.search_membership_visible(m.id,h.head) order by 1 limit 1;
create temp table t as select n.issue_id from public.news_public n join private.article_versions v on v.id=n.version_id
  where n.publication_state='PUBLISHED' and v.public_body->>'_contract'='M1' and v.public_body->>'article_kind'='SECTOR' and n.sample_kind='SYNTHETIC'
  order by n.first_published_at desc limit 20;
create function pg_temp.prep_ok(p_issue uuid) returns boolean language plpgsql as $f$
begin perform private.m1_prepare(p_issue,(select content from private.editor_drafts where issue_id=p_issue),(select version from pol),(select head from h));return true;
exception when others then return false;end$f$;
delete from t where not private.m1_current_evidence(issue_id) or not pg_temp.prep_ok(issue_id);
delete from t where issue_id<>(select issue_id from t order by issue_id limit 1);
select 'R|template|'||count(*) from t;
-- The template links the visible company, so the company page is a control too.
update private.article_versions v set public_body=v.public_body||jsonb_build_object('company_refs',jsonb_build_array((select id from co)))
  from private.issues i where i.id=(select issue_id from t) and v.id=i.current_version_id;
update private.real_mode set enabled=true,public_read_enabled=false;

-- Real copies of the template draft: claims copied as PERMITTED_REAL with remapped IDs, sources on an official host,
-- an ACTIVE AI link with its evidence record.
create temp table x(name text primary key,issue uuid,ai text,drev bigint,irev bigint,pol bigint,cat bigint);
create function pg_temp.mk(p_name text,p_company boolean) returns uuid language plpgsql as $f$
declare st uuid:=gen_random_uuid();iss uuid:=gen_random_uuid();ai text:=gen_random_uuid()::text;txt text;r record;c jsonb;
begin
  insert into private.stories(id,event_key) values(st,'test:1b:'||st);
  insert into private.issues(id,story_id,angle_key,sample_kind) values(iss,st,'TEST1B','PERMITTED_REAL');
  txt:=(select content::text from private.editor_drafts where issue_id=(select issue_id from t));
  for r in select id from private.claims where issue_id=(select issue_id from t) loop
    insert into private.claims(id,issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,valid_until,sample_kind)
      select gen_random_uuid(),iss,claim_type,korea_path_verified,fact_current,true,verified,now()+interval '20 days','PERMITTED_REAL' from private.claims where id=r.id
      returning id into st;
    insert into private.ai_claim_links(issue_id,fact_id,claim_id,ai_version) values(iss,'f-'||st,st,1);
    txt:=replace(txt,r.id::text,st::text);
  end loop;
  c:=txt::jsonb;
  c:=jsonb_set(c,'{sources}',(select jsonb_agg(jsonb_set(s.value,'{url}',to_jsonb('https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||s.n::text)) order by s.n) from jsonb_array_elements(c->'sources') with ordinality s(value,n)));
  c:=c||jsonb_build_object('company_refs',jsonb_build_array((select id from co)));
  if p_company then c:=c||jsonb_build_object('article_kind','COMPANY','impacts','[]'::jsonb,'scenarios','[]'::jsonb,'primary_sector_id',null,'primary_company_ref',(select id from co));end if;
  insert into private.editor_drafts(issue_id,content) values(iss,c);
  insert into private.ai_issue_links(ai_issue_id,issue_id,current_version,state) values(ai,iss,1,'ACTIVE');
  insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at)
    select iss,1,o.facts,o.sources,o.catalog_version,o.catalog_ref,now()+interval '20 days' from private.ai_draft_origin o order by o.received_at desc limit 1;
  insert into x(name,issue,ai,pol,cat) values(p_name,iss,ai,(select version from pol),(select head from h));
  return iss;
end$f$;
select 'R|mk|'||(pg_temp.mk('R',false) is not null)||','||(pg_temp.mk('C',true) is not null)||','||(pg_temp.mk('D',false) is not null);
insert into x(name,issue,pol,cat) select 'T',issue_id,(select version from pol),(select head from h) from t;
create temp table probe(name text,issue_id uuid,head bigint,as_of timestamptz,word text,company uuid);

-- Signed-in editor fixture (rolled back).
create temp table ed as select gen_random_uuid() u,gen_random_uuid() s;
insert into auth.users(id,email,aud,role,raw_app_meta_data) select u,'editor-'||u||'@example.invalid','authenticated','authenticated','{"app_role":"admin"}' from ed;
insert into auth.sessions(id,user_id) select s,u from ed;
insert into private.admin_memberships(user_id,active) select u,true from ed;
insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) select repeat('c',64),u,s,repeat('x',40),now()+interval '1 hour' from ed;
grant select on x,ed,probe,h,co to anon,authenticated;
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',u,'session_id',s,'aal','aal2')::text,true) from ed;

-- B1 switch: local only; identity follows it.
${tryDo('public_read_non_local', "update private.real_mode set enabled=false; update private.runtime_identity set environment='preview'; update private.real_mode set public_read_enabled=true")}
select 'R|identity_off|'||(public.m1_public_identity()->>'sampleKind')||','||(public.m1_public_identity()->>'contract');
${asEditor('draft_allowed_off', "if (select (public.m1_get_draft(x.issue)->>'real_publish_allowed')::boolean from x where x.name='D') then raise exception 'ALLOWED'; end if")}
-- B3: off refuses; reservation still refused.
${publish('publish_off', 'R', 't1b-r-0')}
update private.real_mode set public_read_enabled=true;
select 'R|identity_on|'||(public.m1_public_identity()->>'sampleKind')||','||(public.m1_public_identity()->>'contract');
${asEditor('draft_allowed_on', "if not (select (public.m1_get_draft(x.issue)->>'real_publish_allowed')::boolean from x where x.name='D') then raise exception 'NOT_ALLOWED'; end if")}
${asEditor('schedule_real', "perform public.reservation_create(x.issue,x.drev,x.irev,x.pol,x.cat,to_char(now()+interval '1 day','YYYY-MM-DD\"T\"HH24:MI:SS\"Z\"'),gen_random_uuid()) from x where x.name='R'")}
update private.ai_issue_links set state='HOLD_EDITOR' where issue_id=(select issue from x where name='R');
${publish('publish_held', 'R', 't1b-r-1')}
update private.ai_issue_links set state='ACTIVE' where issue_id=(select issue from x where name='R');
${publishResult('publish_r', 'R', 't1b-r-2')}
${publishResult('publish_r_replay', 'R', 't1b-r-2', true)}
${publishResult('publish_c', 'C', 't1b-c-1')}
select 'R|event_kind|'||string_agg(o.payload->>'sample_kind',',' order by o.effect_key) from private.outbox o where o.effect_key in ('t1b-r-2','t1b-c-1');
select 'R|company_zero_impacts|'||(select count(*) from private.impacts z join private.issues i on i.current_version_id=z.version_id where i.id=(select issue from x where name='C'));

-- B2: exactly one kind is public. With real on: real R and C visible (C only where company articles belong), T hidden.
${reads('on', ['C', 'R', 'T'])}
update private.real_mode set public_read_enabled=false;
${reads('off', ['C', 'R', 'T'])}
-- Synthetic company article placement (switch off): only on company pages and direct reads.
update private.article_versions v set public_body=jsonb_set(v.public_body,'{article_kind}','"COMPANY"') from private.issues i where i.id=(select issue from x where name='T') and v.id=i.current_version_id;
${reads('company_synthetic', ['T'])}
update private.real_mode set public_read_enabled=true;

-- B4 withdrawal of a published real article: hidden at once, evidence gone, repeatable, not republishable.
select 'R|withdraw|'||(private.ai_withdraw_draft(x.ai,2,'SOURCE_REVOKED')->>'issue_state') from x where x.name='R';
select 'R|withdraw_again|'||(private.ai_withdraw_draft(x.ai,2,'SOURCE_REVOKED')->>'issue_state') from x where x.name='R';
select 'R|withdraw_state|'||concat_ws(',',i.publication_state,(select count(*) from private.claims c where c.issue_id=i.id),(select count(*) from private.ai_claim_links c where c.issue_id=i.id),
  (select count(*) from private.ai_draft_origin o where o.issue_id=i.id),(select l.state from private.ai_issue_links l where l.issue_id=i.id),i.manual_protected,
  exists(select 1 from private.editor_drafts d where d.issue_id=i.id),private.m1_current_evidence(i.id),
  (select count(*) from private.outbox o where o.issue_id=i.id and o.event_type='ISSUE_CORRECTION_PENDING' and o.payload->>'reason'='AI_SOURCE_REVOKED' and o.payload->>'sample_kind'='PERMITTED_REAL'))
  from private.issues i where i.id=(select issue from x where name='R');
${publish('republish_withdrawn', 'R', 't1b-r-3')}
update private.ai_issue_links set state='HOLD_EDITOR' where issue_id=(select issue from x where name='R');
${publish('republish_held', 'R', 't1b-r-4')}
update private.ai_issue_links set state='WITHDRAWN' where issue_id=(select issue from x where name='R');
select set_config('request.jwt.claims','',true);
-- Correction timeout carries the issue's kind (clock moved back with triggers off, rolled back).
set local session_replication_role=replica;
update private.issues set correction_pending_since=now()-interval '25 hours' where id=(select issue from x where name='R');
set local session_replication_role=origin;
select 'R|timeout|'||(private.correction_timeout_tick()->>'status');
select 'R|timeout_state|'||i.publication_state||','||(select o.payload->>'sample_kind' from private.outbox o where o.issue_id=i.id and o.event_type='ISSUE_WITHDRAWN' and o.payload->>'reason'='CORRECTION_TIMEOUT')
  from private.issues i where i.id=(select issue from x where name='R');

-- Editor state change carries the issue's kind; expiry withdraws and deletes the evidence.
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',u,'session_id',s,'aal','aal2')::text,true) from ed;
${asEditor('set_state', "perform public.m1_set_state(x.issue,x.irev,'CORRECTION_PENDING','t1b-c-cp') from x where x.name='C'")}
select 'R|set_state_kind|'||(select o.payload->>'sample_kind' from private.outbox o where o.effect_key='t1b-c-cp');
update private.claims set valid_until=now()-interval '1 second' where issue_id=(select issue from x where name='C');
select set_config('request.jwt.claims','',true);
select 'R|expire|'||coalesce(private.ai_inbox_cleanup()->>'published_expired','null');
select 'R|expire_state|'||concat_ws(',',i.publication_state,(select count(*) from private.claims c where c.issue_id=i.id),(select count(*) from private.ai_draft_origin o where o.issue_id=i.id),
  (select l.state||'/'||l.reason from private.ai_issue_links l where l.issue_id=i.id),
  (select o.payload->>'sample_kind' from private.outbox o where o.issue_id=i.id and o.event_type='ISSUE_WITHDRAWN' and o.payload->>'reason'='FACT_RECORD_EXPIRED'))
  from private.issues i where i.id=(select issue from x where name='C');
select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',u,'session_id',s,'aal','aal2')::text,true) from ed;
${refresh}
set local role authenticated;
select 'R|editor_reasons|'||(select string_agg(coalesce(a->>'state_reason','-'),',' order by a->>'id') from jsonb_array_elements(public.m1_editor_articles()) a where a->>'id' in (select issue::text from x where name in ('C','R')));
reset role;

-- New objects carry no API privileges; article-kind conditions left only where they are not public article reads.
select 'R|acl|'||bool_or(has_function_privilege(r,f,'EXECUTE'))
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['private.public_read_kind()','private.m0_publish_real(uuid,bigint,text,text,jsonb,text,bigint,bigint,text)',
  'private.reservation_publish_core_real(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid)','private.m1_transition_internal(uuid,text,text,text)','private.ai_retract_published(uuid,text,text,text)',
  'private.ai_inbox_cleanup()','private.ai_inbox_cleanup_v1()','private.reservation_publish_core(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid)']) f;
select 'R|residual|'||string_agg(p.oid::regprocedure::text,' ' order by p.oid::regprocedure::text) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname in ('public','private') and p.prosrc ~ '(^|[^a-z_])sample_kind\\s*(=|<>)\\s*''SYNTHETIC''|''sample_kind'',''SYNTHETIC''';
rollback;`;

const run = spawnSync(docker, psql, { input: sql, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
assert.equal(run.status, 0, run.stderr);
const lines = (run.stdout + run.stderr).split(/\r?\n/).map(line => line.replace(/^(psql:[^:]*:\d+: )?NOTICE:\s*/, '')).filter(line => line.startsWith('R|')).map(line => line.split('|').slice(1));
const value = key => lines.filter(([k]) => k === key).map(([, ...v]) => v.join('|'));
if (process.env.T1B_DEBUG) console.log(lines.map(l => l.join('|')).join('\n'));
assert.deepEqual(value('template'), ['1'], 'needs one current published synthetic M1 SECTOR issue');
assert.deepEqual(value('mk'), ['true,true,true']);
assert.deepEqual(value('public_read_non_local'), ['REAL_PUBLIC_READ_LOCAL_ONLY_1B']);
assert.deepEqual(value('identity_off'), ['SYNTHETIC,M1']);
assert.deepEqual(value('identity_on'), ['REVIEW_REAL,M1R']);
assert.deepEqual(value('draft_allowed_off'), ['PASSED']);
assert.deepEqual(value('draft_allowed_on'), ['PASSED']);
assert.deepEqual(value('publish_off'), ['REAL_PUBLIC_READ_OFF']);
assert.deepEqual(value('schedule_real'), ['REAL_PUBLICATION_NOT_ENABLED_1A']);
assert.deepEqual(value('publish_held'), ['AI_DRAFT_HELD']);
assert.deepEqual(value('publish_r'), ['APPLIED']);
assert.deepEqual(value('publish_r_replay'), ['ALREADY_APPLIED']);
assert.deepEqual(value('publish_c'), ['APPLIED']);
assert.deepEqual(value('event_kind'), ['PERMITTED_REAL,PERMITTED_REAL']);
assert.deepEqual(value('company_zero_impacts'), ['0']);
const ALL = ['news_public', 'news_list', 'resolve', 'get_public_article', 'm1_public_article', 'm1_public_articles', 'catalog_articles', 'search', 'saved', 'company'];
const COMPANY_ONLY = ALL.filter(k => !['m1_public_articles', 'catalog_articles', 'search'].includes(k));
const visible = key => {
  const [row] = value(key);
  assert.ok(row, 'missing ' + key);
  const map = Object.fromEntries(row.split(',').map(x => x.split('=')));
  assert.deepEqual(Object.keys(map), ALL, key);
  return Object.keys(map).filter(k => map[k] === 'true');
};
for (const role of ['anon', 'authenticated']) {
  assert.deepEqual(visible(`reads_on_${role}_R`), ALL, role + ' real on');
  assert.deepEqual(visible(`reads_on_${role}_C`), COMPANY_ONLY, role + ' real company on');
  assert.deepEqual(visible(`reads_on_${role}_T`), [], role + ' synthetic leaked while real is public');
  assert.deepEqual(visible(`reads_off_${role}_R`), [], role + ' real leaked while synthetic is public');
  assert.deepEqual(visible(`reads_off_${role}_C`), [], role + ' real company leaked');
  assert.deepEqual(visible(`reads_off_${role}_T`), ALL, role + ' synthetic control');
  assert.deepEqual(visible(`reads_company_synthetic_${role}_T`), COMPANY_ONLY, role + ' synthetic company placement');
}
assert.deepEqual(value('withdraw'), ['CORRECTION_PENDING']);
assert.deepEqual(value('withdraw_again'), ['CORRECTION_PENDING']);
assert.deepEqual(value('withdraw_state'), ['CORRECTION_PENDING,0,0,0,WITHDRAWN,t,t,f,1']);
assert.deepEqual(value('republish_withdrawn'), ['AI_SOURCE_WITHDRAWN']);
assert.deepEqual(value('republish_held'), ['AI_DRAFT_HELD']);
assert.deepEqual(value('timeout'), ['OK']);
assert.deepEqual(value('timeout_state'), ['WITHDRAWN,PERMITTED_REAL']);
assert.deepEqual(value('set_state'), ['PASSED']);
assert.deepEqual(value('set_state_kind'), ['PERMITTED_REAL']);
assert.ok(Number(value('expire')[0]) >= 1, 'expiry ran');
assert.deepEqual(value('expire_state'), ['WITHDRAWN,0,0,WITHDRAWN/EXPIRED,PERMITTED_REAL']);
assert.equal(value('editor_reasons').length, 1);
// Migration 60: the cause (source withdrawn) survives the later correction timeout.
assert.deepEqual(value('editor_reasons')[0].split(',').sort(), ['AI_SOURCE_REVOKED', 'FACT_RECORD_EXPIRED']);
assert.deepEqual(value('acl'), ['false']);
// Remaining literal kind conditions, none of them a public article read: the synthetic validator and publisher, the
// dead first evidence body (no caller), sector catalogue rules (fixture sectors), the 1A scheduling block, and the
// installation, editor-check and source-result paths, which are synthetic by design.
assert.deepEqual(value('residual')[0].split(' ').sort(), [
  'installation_view(text,uuid,text,integer,jsonb)', 'm0_create_installation()', 'm0_source_technical_result(text,text,text,jsonb)', 'm1_check_editor()',
  'm1_public_catalog()', 'private.catalog_sector_selectable(uuid,bigint,text)', 'private.m0_publish_legacy(uuid,bigint,text,text,jsonb,text,bigint,bigint,text)',
  'private.m1_current_evidence_v1(uuid)', 'private.m1_prepare_v1(uuid,jsonb,bigint,bigint)', 'reservation_create(uuid,bigint,bigint,bigint,bigint,text,uuid)'].sort());
console.log(JSON.stringify({ status: 'PASS', phase: 'REAL_PUBLIC_READ_1B_59', rolledBack: true, checks: lines.length }));
