// Publish stage 1A, migration 56 (real-data review): one transaction on the local Supabase DB, rolled back.
// Applies 56 inside the transaction when it is not applied yet. Uses the newest current published synthetic M1 issue
// as a template: a real copy of its draft must pass the real chain only with real mode on, real URLs and real claims.
// Requires the local stack (supabase_db_judoju-news-local) with at least one current published M1 issue.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const psql = ['exec', '-i', 'supabase_db_judoju-news-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const probe = spawnSync(docker, psql, { input: "select to_regprocedure('private.real_mode_on()') is not null;", encoding: 'utf8', windowsHide: true });
assert.equal(probe.status, 0, probe.stderr);
const applied = probe.stdout.trim() === 't';
const body = readFileSync(new URL('../supabase/migrations/20261127000056_real_mode_review.sql', import.meta.url), 'utf8')
  .replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '');

const expectError = (name, sql) => `do $$ begin ${sql}; raise notice 'R|${name}|PASSED'; exception when others then raise notice 'R|${name}|%', sqlerrm; end $$;`;
const sql = `begin;
${applied ? '' : body}
create temp table h as select (public.catalog_public_tree(null)->>'catalog_version')::bigint head;
create temp table pol as select version from private.policies where active order by version desc limit 1;
create temp table t as select n.issue_id from public.news_public n join private.article_versions v on v.id=n.version_id
  where n.publication_state='PUBLISHED' and v.public_body->>'_contract'='M1' and private.m1_current_evidence(n.issue_id) order by n.first_published_at desc limit 1;
create temp table co as select distinct m.source_company_ref id from private.catalog_memberships m,h where private.search_membership_visible(m.id,h.head) order by 1 limit 1;
select 'R|template|'||count(*) from t;
-- A real copy of the template issue: new story and issue, claims copied as PERMITTED_REAL, evidence IDs remapped,
-- sources moved to an allowed official host.
create temp table src as select e.content from private.editor_drafts e where e.issue_id=(select issue_id from t);
create temp table st as select gen_random_uuid() id; insert into private.stories(id,event_key) select id,'test:real:'||id from st;
create temp table ri as select gen_random_uuid() id;
insert into private.issues(id,story_id,angle_key,sample_kind) select ri.id,st.id,'TEST','PERMITTED_REAL' from ri,st;
create temp table cmap as select c.id old_id,gen_random_uuid() new_id,c.* from private.claims c where c.issue_id=(select issue_id from t);
insert into private.claims(id,issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,valid_until,sample_kind)
  select new_id,(select id from ri),claim_type,korea_path_verified,fact_current,official_original,verified,valid_until,'PERMITTED_REAL' from cmap;
create temp table rc(content jsonb);
do $$ declare txt text:=(select content::text from src);r record;
begin for r in select old_id,new_id from cmap loop txt:=replace(txt,r.old_id::text,r.new_id::text);end loop;insert into rc values(txt::jsonb);end $$;
update rc set content=jsonb_set(content,'{sources}',(select jsonb_agg(jsonb_set(x.value,'{url}',to_jsonb('https://dart.fss.or.kr/dsaf001/main.do?rcpNo='||x.n::text)) order by x.n) from jsonb_array_elements(content->'sources') with ordinality x(value,n)));
insert into private.editor_drafts(issue_id,content) select id,(select content from rc) from ri;
create temp table args as select (select id from ri) issue,(select content from rc) content,(select version from pol) pol,(select head from h) cat;

-- Switch off: real issues are refused; the synthetic template still passes unchanged.
${expectError('real_off', 'perform private.m1_prepare(a.issue,a.content,a.pol,a.cat) from args a')}
select 'R|synthetic_template|'||(private.m1_prepare((select issue_id from t),(select content from src),(select version from pol),(select head from h))->>'article_kind');
-- 1A: real mode can only be switched on in a local environment.
${expectError('enable_non_local', "update private.runtime_identity set environment='preview'; update private.real_mode set enabled=true")}
update private.real_mode set enabled=true;
select 'R|real_on|'||(private.m1_prepare(a.issue,a.content,a.pol,a.cat)->>'article_kind') from args a;
-- Source URL rule.
select 'R|url|'||string_agg(u||'~~'||private.real_source_url_ok(u),'^^' order by u) from unnest(array[
  'https://dart.fss.or.kr/a','https://kind.krx.co.kr/x?y=1','http://dart.fss.or.kr/a','https://DART.fss.or.kr/a','https://dart.fss.or.kr./a',
  'https://user@dart.fss.or.kr/a','https://dart.fss.or.kr:443/a','https://x.dart.fss.or.kr/a','https://dart.fss.or.kr%2e/a','https://dart.fss.or.kr/a b',
  'https://evil.example/dart.fss.or.kr','https://fixture.invalid/a','https://dart.fss.or.kr\\a']) u;
${expectError('real_invalid_url', "perform private.m1_prepare(a.issue,jsonb_set(a.content,'{sources,0,url}','\"https://fixture.invalid/x\"'),a.pol,a.cat) from args a")}
${expectError('synthetic_real_url', "perform private.m1_prepare((select issue_id from t),jsonb_set((select content from src),'{sources,0,url}','\"https://dart.fss.or.kr/a\"'),(select version from pol),(select head from h))")}
-- COMPANY: zero impacts and no primary sector pass in the real chain; with impacts a primary sector is required.
select 'R|company_zero|'||(private.m1_prepare(a.issue,a.content||jsonb_build_object('article_kind','COMPANY','impacts','[]'::jsonb,'scenarios','[]'::jsonb,'primary_sector_id',null,
  'company_refs',jsonb_build_array((select id from co)),'primary_company_ref',(select id from co)),a.pol,a.cat)->>'article_kind') from args a;
select 'R|company_zero_preview|'||(private.public_body(b,private.visible_sections(b->>'_profile',b,now(),now()),now()) is not null) from (select private.m1_prepare(a.issue,a.content||jsonb_build_object('article_kind','COMPANY','impacts','[]'::jsonb,'scenarios','[]'::jsonb,'primary_sector_id',null,
  'company_refs',jsonb_build_array((select id from co)),'primary_company_ref',(select id from co)),a.pol,a.cat) b from args a) q;
${expectError('company_impacts_no_primary', "perform private.m1_prepare(a.issue,a.content||jsonb_build_object('article_kind','COMPANY','primary_sector_id',null,'company_refs',jsonb_build_array((select id from co)),'primary_company_ref',(select id from co)),a.pol,a.cat) from args a")}
-- MACRO real articles need official facts only.
update private.claims set official_original=false where id=(select new_id from cmap order by old_id limit 1);
${expectError('macro_non_official', "perform private.m1_prepare(a.issue,a.content||jsonb_build_object('article_kind','MACRO','primary_sector_id',null),a.pol,a.cat) from args a")}
update private.claims set official_original=(select official_original from cmap order by old_id limit 1) where id=(select new_id from cmap order by old_id limit 1);
-- Mixed sample kinds are refused in both directions.
insert into private.claims(issue_id,claim_type,korea_path_verified,fact_current,official_original,verified,sample_kind) select id,'ORDINARY_FACT',true,true,true,true,'SYNTHETIC' from ri;
${expectError('mixed_real', 'perform private.m1_prepare(a.issue,a.content,a.pol,a.cat) from args a')}
delete from private.claims where issue_id=(select id from ri) and sample_kind='SYNTHETIC';
-- 1A publish block (immediate and scheduled publication share the core).
${expectError('publish_real', "perform private.reservation_publish_core(a.issue,0,0,a.pol,a.cat,'test-effect',gen_random_uuid(),null) from args a")}
-- Public fence: every public read sees the published template first (control), then nothing once it is real,
-- for anon and authenticated alike.
create temp table probe_input as select t.issue_id,(select head from h) head,
  split_part(trim(v.public_body->>'title'),' ',1) word,coalesce(v.public_body->'company_refs','[]'::jsonb) companies
  from t join private.issues i on i.id=t.issue_id join private.article_versions v on v.id=i.current_version_id;
grant select on t,h,probe_input to anon,authenticated;
${['control','real'].map(phase => (phase === 'real' ? `update private.claims set sample_kind='PERMITTED_REAL' where issue_id=(select issue_id from t);
update private.issues set sample_kind='PERMITTED_REAL' where id=(select issue_id from t);
select 'R|fence_evidence|'||private.m1_current_evidence((select issue_id from t))||','||public.is_news_visible((select issue_id from t));
select 'R|fence_legacy|'||(private.m0_get_public_article_legacy((select issue_id from t))->>'state');
` : '') + ['anon','authenticated'].map(role => `set local role ${role};
select 'R|reads_${phase}_${role}|'||concat_ws(',',
  'news_public='||((select count(*) from public.news_public n,probe_input p where n.issue_id=p.issue_id)>0),
  'news_list='||((select count(*) from public.news_list n,probe_input p where n.issue_id=p.issue_id)>0),
  'resolve='||((select public.resolve_issue(issue_id)->>'state' from probe_input)='PUBLISHED'),
  'get_public_article='||((select public.get_public_article(issue_id)->>'state' from probe_input)='PUBLISHED'),
  'm1_public_article='||((select public.m1_public_article(issue_id)->>'state' from probe_input)='PUBLISHED'),
  'm1_public_articles='||(select exists(select 1 from jsonb_array_elements(coalesce(public.m1_public_articles(null,50,null)->'items',public.m1_public_articles(null,50,null))) x where x->>'issue_id'=p.issue_id::text) from probe_input p),
  'catalog_articles='||(select exists(select 1 from jsonb_array_elements(public.catalog_public_articles(p.head,'{}','THIS_MONTH',50)->'items') x where x->>'issue_id'=p.issue_id::text) from probe_input p),
  'search='||(select exists(select 1 from jsonb_array_elements(public.catalog_public_search_news(p.head,p.word,20)->'items') x where x->>'issue_id'=p.issue_id::text) from probe_input p),
  'saved='||(select exists(select 1 from jsonb_array_elements(public.catalog_public_saved(p.head,array[p.issue_id])->'items') x where x->>'state'='PUBLISHED') from probe_input p),
  'company='||(select coalesce(bool_or(exists(select 1 from jsonb_array_elements(public.catalog_public_company(p.head,c::uuid,20)->'items') x where x->>'issue_id'=p.issue_id::text)),false) from probe_input p,jsonb_array_elements_text(p.companies) c));
reset role;`).join('\n')).join('\n')}
-- New objects carry no API privileges.
select 'R|acl|'||bool_or(has_function_privilege(r,f,'EXECUTE'))||','||bool_or(has_table_privilege(r,'private.real_mode','SELECT'))
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['private.real_mode_on()','private.real_source_url_ok(text)','private.m1_prepare_real(uuid,jsonb,bigint,bigint)','private.m1_prepare(uuid,jsonb,bigint,bigint)','private.m1_prepare_v8(uuid,jsonb,bigint,bigint)','private.reservation_publish_core_v1(uuid,bigint,bigint,bigint,bigint,text,uuid,uuid)','private.m1_current_evidence_v3(uuid)','private.m0_get_public_article_legacy_v1(uuid)']) f;
rollback;`;

const run = spawnSync(docker, psql, { input: sql, encoding: 'utf8', windowsHide: true });
assert.equal(run.status, 0, run.stderr);
const lines = (run.stdout + run.stderr).split(/\r?\n/).map(line => line.replace(/^(psql:[^:]*:\d+: )?NOTICE:\s*/, '')).filter(line => line.startsWith('R|')).map(line => line.split('|').slice(1));
const value = key => lines.filter(([k]) => k === key).map(([, ...v]) => v.join('|'));
assert.deepEqual(value('template'), ['1'], 'needs one current published synthetic M1 issue');
assert.deepEqual(value('real_off'), ['REAL_MODE_OFF']);
assert.deepEqual(value('enable_non_local'), ['REAL_MODE_LOCAL_ONLY_1A']);
assert.equal(value('synthetic_template').length, 1);
assert.equal(value('real_on')[0], value('synthetic_template')[0]);
const url = Object.fromEntries(value('url')[0].split('^^').map(x => x.split('~~')).map(([u, ok]) => [u, ok === 'true']));
assert.deepEqual(Object.entries(url).filter(([, ok]) => ok).map(([u]) => u).sort(), ['https://dart.fss.or.kr/a', 'https://kind.krx.co.kr/x?y=1']);
assert.deepEqual(value('real_invalid_url'), ['REAL_SOURCE_NOT_ALLOWED']);
assert.deepEqual(value('synthetic_real_url'), ['SYNTHETIC_SOURCE_REQUIRED']);
assert.deepEqual(value('company_zero'), ['COMPANY']);
assert.deepEqual(value('company_zero_preview'), ['true']);
assert.deepEqual(value('company_impacts_no_primary'), ['PRIMARY_SECTOR_REQUIRED']);
assert.ok(['REAL_MACRO_REQUIRES_OFFICIAL', 'CLAIM_NOT_VERIFIED'].includes(value('macro_non_official')[0]), value('macro_non_official')[0]);
assert.deepEqual(value('mixed_real'), ['MIXED_SAMPLE_KIND']);
assert.deepEqual(value('publish_real'), ['REAL_PUBLICATION_NOT_ENABLED_1A']);
assert.deepEqual(value('fence_evidence'), ['false,false']);
assert.deepEqual(value('fence_legacy'), ['NOT_FOUND']);
const reads = key => Object.fromEntries(value(key)[0].split(',').map(x => x.split('=')).map(([k, v]) => [k, v === 'true']));
for (const role of ['anon', 'authenticated']) {
  const control = reads('reads_control_' + role), real = reads('reads_real_' + role);
  // Control: the template is really visible through the main routes, so the fence result is not vacuous.
  for (const k of ['news_public', 'news_list', 'resolve', 'get_public_article', 'm1_public_article', 'saved']) assert.equal(control[k], true, role + ' control ' + k);
  assert.deepEqual(Object.entries(real).filter(([, v]) => v).map(([k]) => k), [], role + ' real issue leaked');
}
assert.deepEqual(value('acl'), ['false,false']);
console.log(JSON.stringify({ status: 'PASS', phase: 'REAL_MODE_1A_56', migrationApplied: applied, rolledBack: true, checks: lines.length }));
