import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { parseCatalog, cellHash } from '../scripts/catalog/parse-catalog.mjs';

// SQL test for supabase/migrations/20261126000051_public_card_impacts.sql.
// Runs against a throwaway local DB: `node scripts/dev/local-postgres.mjs reset`
// then JUDOJU_TEST_PG_URL=postgresql://postgres@127.0.0.1:55432/judoju.
const url = process.env.JUDOJU_TEST_PG_URL;
const options = url ? {} : { skip: 'set JUDOJU_TEST_PG_URL (see scripts/dev/local-postgres.mjs)' };
const sql = query => execFileSync('psql', [url, '-X', '-q', '-At', '-v', 'ON_ERROR_STOP=1'], { input: query, encoding: 'utf8' }).trim();

const fixture = `
insert into private.sectors(id,name,catalog_version,sample_kind,display_order) values
 ('00000000-0000-4000-a000-0000000000a1','메모리 양산',1,'SYNTHETIC',2),
 ('00000000-0000-4000-a000-0000000000a2','반도체 후공정/패키징',1,'SYNTHETIC',1),
 ('00000000-0000-4000-a000-0000000000a3','전기차 배터리',1,'SYNTHETIC',0),
 ('00000000-0000-4000-a000-0000000000a4','비활성 섹터',1,'SYNTHETIC',0);
update private.sectors set active=false where id='00000000-0000-4000-a000-0000000000a4';
insert into private.stories(id,event_key) values('00000000-0000-4000-a000-0000000000b1','synthetic-card-impacts');
insert into private.issues(id,story_id,angle_key,sample_kind) values('00000000-0000-4000-a000-0000000000c1','00000000-0000-4000-a000-0000000000b1','A','SYNTHETIC');
insert into private.article_versions(id,issue_id,title,summary,public_body,source_market,selection_market_basis,analysis_perspective,impact_profile,visibility_policy_version,catalog_version,evidence_as_of,visible_sections)
 values('00000000-0000-4000-a000-0000000000d1','00000000-0000-4000-a000-0000000000c1','t','s','{}','KR','KR','KR_EQUITY','POSITIVE_NEGATIVE',1,1,now(),'{KEY_ISSUES}');
insert into private.impacts(version_id,sector_id,direction,path_id) values
 ('00000000-0000-4000-a000-0000000000d1','00000000-0000-4000-a000-0000000000a3','DAMAGE','p3'),
 ('00000000-0000-4000-a000-0000000000d1','00000000-0000-4000-a000-0000000000a1','BENEFIT','p1'),
 ('00000000-0000-4000-a000-0000000000d1','00000000-0000-4000-a000-0000000000a1','BENEFIT','p1b'),
 ('00000000-0000-4000-a000-0000000000d1','00000000-0000-4000-a000-0000000000a2','BENEFIT','p2'),
 ('00000000-0000-4000-a000-0000000000d1','00000000-0000-4000-a000-0000000000a4','RELATED','p4');`;

test('card impacts: active sectors only, one entry per sector+direction, BENEFIT→DAMAGE→RELATED, no company claims', options, () => {
  const value = JSON.parse(sql(`begin;${fixture}select private.public_card_impacts('00000000-0000-4000-a000-0000000000d1');rollback;`).split('\n').filter(Boolean).at(-1));
  assert.deepEqual(value.map(x => [x.direction, x.sector_name]), [
    ['BENEFIT', '반도체 후공정/패키징'], ['BENEFIT', '메모리 양산'], ['DAMAGE', '전기차 배터리'],
  ]);
  assert(value.every(x => Array.isArray(x.companies) && x.companies.length === 0));
  assert.equal(sql(`select private.public_card_impacts('00000000-0000-4000-a000-0000000000ff');`), '[]');
});

test('helper is private; the three public card producers expose it additively', options, () => {
  assert.equal(sql(`select has_function_privilege('anon','private.public_card_impacts(uuid)','execute');`), 'f');
  for (const name of ['catalog_public_articles', 'catalog_public_search_news', 'catalog_public_saved']) {
    const definition = sql(`select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${name}';`);
    assert.match(definition, /private\.public_card_impacts\(v\.id\)/, name);
    assert.match(definition, /legacy_sector/, name);
    assert.equal(sql(`select has_function_privilege('anon',(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='${name}'),'execute');`), 't', name);
  }
});

// End-to-end through the three public RPCs on the seeded reference catalog. The evidence gate
// (private.m1_current_evidence) is replaced inside the rolled-back transaction only: it has its own
// tests, and this test is about the card projection, not publication eligibility.
test('articles, search and saved cards return the impact summary and keep their other fields', options, () => {
  const read = name => readFileSync(new URL('../tests/fixtures/catalog/' + name, import.meta.url), 'utf8');
  const source = read('source-20261114.json'), registry = read('registry-v1.json');
  const reg = JSON.parse(registry), leaf = name => reg.categories.find(c => c.name.trim() === name).id;
  const preview = JSON.stringify(parseCatalog(JSON.parse(source), reg, { sourceSha256: cellHash(source) }), null, 2) + '\n';
  const q = v => "'" + String(v).replaceAll("'", "''") + "'";
  const [mem, pkg, bat] = ['메모리 양산', '반도체 후공정/패키징', '전기차 배터리'].map(leaf);
  const issue = '00000000-0000-4000-a000-0000000000c1', version = '00000000-0000-4000-a000-0000000000d1';
  const out = sql(`begin;
update private.runtime_identity set bootstrap_id='${randomUUID()}'::uuid;
select private.catalog_seed_reference(${q(source)},${q(registry)},${q(preview)}) is not null;
create or replace function private.m1_current_evidence(p_issue uuid) returns boolean language sql stable set search_path='' as $$select true$$;
insert into private.stories(id,event_key) values('00000000-0000-4000-a000-0000000000b1','synthetic-card-impacts');
insert into private.issues(id,story_id,angle_key,sample_kind,primary_sector_id) values('${issue}','00000000-0000-4000-a000-0000000000b1','A','SYNTHETIC','${mem}');
insert into private.article_versions(id,issue_id,title,summary,public_body,source_market,selection_market_basis,analysis_perspective,impact_profile,visibility_policy_version,catalog_version,evidence_as_of,visible_sections)
 values('${version}','${issue}','[합성] 카드 영향 시험','SYNTHETIC 요약','{"_contract":"M1","article_kind":"SECTOR"}','KR','KR','KR_EQUITY','POSITIVE_NEGATIVE',1,(select version from private.catalog_head),now(),'{KEY_ISSUES}');
update private.issues set current_version_id='${version}',publication_state='PUBLISHED',first_published_at=now()-interval '1 minute' where id='${issue}';
insert into private.impacts(version_id,sector_id,direction,path_id) values('${version}','${bat}','DAMAGE','p3'),('${version}','${mem}','BENEFIT','p1'),('${version}','${mem}','BENEFIT','p1b'),('${version}','${pkg}','BENEFIT','p2');
insert into public.news_public(issue_id,version_id,publication_state,title,summary,first_published_at,material_change_at,sample_kind)
 values('${issue}','${version}','PUBLISHED','[합성] 카드 영향 시험','SYNTHETIC 요약',now()-interval '1 minute',now()-interval '1 minute','SYNTHETIC')
 on conflict(issue_id) do update set version_id=excluded.version_id,publication_state='PUBLISHED',title=excluded.title,summary=excluded.summary,first_published_at=excluded.first_published_at,material_change_at=excluded.material_change_at;
select jsonb_build_object('articles',public.catalog_public_articles((select version from private.catalog_head),'{}','TODAY',5)->'items',
 'search',public.catalog_public_search_news((select version from private.catalog_head),'카드',5)->'items',
 'saved',public.catalog_public_saved((select version from private.catalog_head),array['${issue}'::uuid])->'items');
rollback;`).split('\n').filter(Boolean).at(-1);
  const result = JSON.parse(out);
  const cards = [result.articles[0], result.search[0], result.saved[0].card];
  const expected = [['BENEFIT', mem], ['BENEFIT', pkg], ['DAMAGE', bat]];
  for (const card of cards) {
    assert.equal(card.issue_id, issue);
    assert.equal(card.sector_id, mem);
    assert.equal(card.legacy_sector, false);
    assert.equal(card.article_kind, 'SECTOR');
    assert.deepEqual(new Set(card.impacts.map(x => x.direction + ':' + x.sector_id)), new Set(expected.map(x => x.join(':'))));
    assert.equal(card.impacts.length, 3); // two BENEFIT paths for 메모리 양산 collapse into one entry
    assert.deepEqual(card.impacts.map(x => x.direction), ['BENEFIT', 'BENEFIT', 'DAMAGE']);
    assert(card.impacts.every(x => x.companies.length === 0));
  }
  assert.equal(result.saved[0].state, 'PUBLISHED');
});
