// Checks migrations 51 (company scope and page), 52 (company articles hide sector blocks) and 53 (related companies
// block removed) inside one transaction on the local Supabase DB and rolls it back. A migration not applied yet is
// applied inside that transaction; an applied one is checked as it is.
// Requires the local stack (supabase_db_judoju-news-local) with at least two current published M1 issues.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
const docker=process.platform==='win32'?'C:/Program Files/Docker/Docker/resources/bin/docker.exe':'docker';
const psql=['exec','-i','supabase_db_judoju-news-local','psql','-X','-U','postgres','-d','postgres','-At','-v','ON_ERROR_STOP=1'];
const probe=spawnSync(docker,psql,{input:"select to_regprocedure('public.catalog_public_company(bigint,uuid,integer,timestamptz,timestamptz,uuid)') is not null;select to_regprocedure('private.visible_sections_v2(text,jsonb,timestamptz,timestamptz)') is not null;select to_regprocedure('private.visible_sections_v2(text,jsonb,timestamptz,timestamptz)') is not null and to_regprocedure('private.m1_prepare_v6(uuid,jsonb,bigint,bigint)') is null;",encoding:'utf8',windowsHide:true});
assert.equal(probe.status,0,probe.stderr);const applied=probe.stdout.trim().split(/\r?\n/).map(x=>x==='t');
const body=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8').replace(/^notify .*$/m,'').replace(/^begin;\s*$/m,'').replace(/commit;\s*$/,'');
const migration='begin;'+(applied[0]?'':body('20261127000051_company_scope_and_page.sql'))+(applied[1]?'':body('20261127000052_company_hides_sector_sections.sql'))+(applied[2]?'':body('20261127000053_drop_related_companies.sql'));
const checks=`
create temp table h as select (public.catalog_public_tree(null)->>'catalog_version')::bigint head;
create temp table t as select n.issue_id,n.version_id,n.first_published_at,row_number() over(order by n.first_published_at desc) r from public.news_public n
 join private.issues i on i.id=n.issue_id and i.current_version_id=n.version_id join private.article_versions v on v.id=n.version_id
 where n.publication_state='PUBLISHED' and v.public_body->>'_contract'='M1' and private.m1_current_evidence(n.issue_id) order by n.first_published_at desc limit 2;
create temp table co2 as select distinct m.source_company_ref id from private.catalog_memberships m,h where private.search_membership_visible(m.id,h.head) order by 1 limit 2;
create temp table co as select id from co2 order by id limit 1;
create temp table other as select id from co2 order by id desc limit 1;
create temp table d as select e.issue_id,e.content,(select version from private.policies where active order by version desc limit 1) pol,(select head from h) cat
 from private.editor_drafts e where e.issue_id=(select issue_id from t where r=1);
select 'R|published|'||count(*) from t;
select 'R|sector_prepare|'||((private.m1_prepare(d.issue_id,d.content||jsonb_build_object('company_refs',jsonb_build_array((select id from co))),d.pol,d.cat))->>'article_kind') from d;
select 'R|company_prepare|'||((private.m1_prepare(d.issue_id,d.content||jsonb_build_object('article_kind','COMPANY','company_refs',jsonb_build_array((select id from co)),'primary_company_ref',(select id from co)),d.pol,d.cat))->>'article_kind') from d;
do $$ declare r record; msg text; begin for r in select * from d loop
 foreach msg in array array['{"article_kind":"COMPANY"}','{"article_kind":"COMPANY","company_refs":["00000000-0000-4000-8000-000000000000"],"primary_company_ref":"00000000-0000-4000-8000-000000000000"}','{"company_refs":"x"}','{"company_refs":["PLACEHOLDER","PLACEHOLDER"]}','{"primary_company_ref":"PLACEHOLDER"}'] loop
  begin perform private.m1_prepare(r.issue_id,r.content||replace(msg,'PLACEHOLDER',(select id::text from co))::jsonb,r.pol,r.cat); raise notice 'R|unexpected_pass|%',msg;
  exception when others then raise notice 'R|rejected|%',sqlerrm; end; end loop; end loop; end$$;
update private.article_versions set public_body=public_body||jsonb_build_object('company_refs',jsonb_build_array((select id from co))) where id=(select version_id from t where r=1);
update private.article_versions set public_body=public_body||jsonb_build_object('article_kind','COMPANY','company_refs',jsonb_build_array((select id from co)),'primary_company_ref',(select id from co)) where id=(select version_id from t where r=2);
select 'R|roles|'||string_agg(x->>'company_role'||':'||(x->>'article_kind'),',' order by x->>'first_published_at' desc) from jsonb_array_elements(public.catalog_public_company((select head from h),(select id from co),20)->'items') x;
select 'R|unverified_stock|'||(public.catalog_public_company((select head from h),(select id from co),20)->'company'->>'stock_code' is null);
select 'R|paged|'||(public.catalog_public_company((select head from h),(select id from co),1)->'next' is not null);
-- Each issue is looked up on its own publication day (as_of pinned just after it), so the check does not age.
select 'R|feed_sector|'||exists(select 1 from t,jsonb_array_elements(public.catalog_public_articles((select head from h),'{}','TODAY',50,t.first_published_at+interval '1 second')->'items') x where t.r=1 and x->>'issue_id'=t.issue_id::text);
select 'R|feed_company|'||exists(select 1 from t,jsonb_array_elements(public.catalog_public_articles((select head from h),'{}','TODAY',50,t.first_published_at+interval '1 second')->'items') x where t.r=2 and x->>'issue_id'=t.issue_id::text);
-- Migrations 52-53: company articles hide sector blocks and show no related-companies block; input for one is ignored.
create temp table rel as select private.m1_prepare(d.issue_id,d.content||jsonb_build_object('article_kind','COMPANY','company_refs',(select jsonb_agg(id order by id) from co2),'primary_company_ref',(select id from co),
 'related_companies',jsonb_build_array(jsonb_build_object('company_ref',(select id from other),'role','공급계약 상대방'))),d.pol,d.cat) b from d;
select 'R|company_sections|'||array_to_string(private.visible_sections(b->>'_profile',b,now(),now()),',') from rel;
select 'R|sector_sections|'||array_to_string(private.visible_sections(b->>'_profile',b||'{"article_kind":"SECTOR"}',now(),now()),',') from rel;
select 'R|related_stored|'||(b ? 'related_companies') from rel;
select 'R|related_public|'||(private.public_body(b,private.visible_sections(b->>'_profile',b,now(),now()),now()) ? 'related_companies') from rel;
select 'R|missing|'||((public.catalog_public_company((select head from h),'00000000-0000-4000-8000-000000000000',20))->>'state');
rollback;`;
const run=spawnSync(docker,psql,{input:migration+checks,encoding:'utf8',windowsHide:true});
assert.equal(run.status,0,run.stderr);
const lines=(run.stdout+run.stderr).split(/\r?\n/).map(line=>line.replace(/^NOTICE:\s*/,'')).filter(line=>line.startsWith('R|')).map(line=>line.split('|').slice(1));
const value=key=>lines.filter(([k])=>k===key).map(([,v,w])=>w??v);
assert.deepEqual(value('published'),['2'],'needs two current published issues');
assert.deepEqual(value('sector_prepare'),['SECTOR']);assert.deepEqual(value('company_prepare'),['COMPANY']);
assert.deepEqual(value('unexpected_pass'),[]);
assert.deepEqual(value('rejected'),['PRIMARY_COMPANY_REQUIRED','COMPANY_REF_INACTIVE','COMPANY_REFS_INVALID','COMPANY_REFS_INVALID','PRIMARY_COMPANY_ONLY_FOR_COMPANY_SCOPE']);
assert.deepEqual(value('roles'),['MENTIONED:SECTOR,PRIMARY:COMPANY']);
assert.deepEqual(value('unverified_stock'),['true']);assert.deepEqual(value('paged'),['true']);
assert.deepEqual(value('feed_sector'),['true']);assert.deepEqual(value('feed_company'),['false']);
assert.deepEqual(value('missing'),['NOT_FOUND']);
assert(!/_SECTORS|RELATED_COMPANIES/.test(value('company_sections')[0]));assert.match(value('sector_sections')[0],/_SECTORS/);
assert.deepEqual(value('related_stored'),['false']);assert.deepEqual(value('related_public'),['false']);
console.log(JSON.stringify({status:'PASS',phase:'COMPANY_SCOPE_AND_PAGE',migrationsAlreadyApplied:{'51':applied[0],'52':applied[1],'53':applied[2]},rolledBack:true,checks:lines.length}));
