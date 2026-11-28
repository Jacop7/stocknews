// Migration 64 (macro filter, docs/sector-news-plan.md §1) on the local Supabase stack.
// Part A runs inside one transaction and rolls back: with two current published issues, one turned into a MACRO
// article and one SECTOR article, and a sector only the SECTOR article impacts, every filter combination is checked, the
// seven-argument form equals the eight-argument form with p_macro=false, and COMPANY stays out.
// Part B calls both signatures through the local PostgREST (anon) to prove there is no overload ambiguity.
// Requires the local stack (supabase_db_judoju-news-local) with migration 64 applied.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { root, runtimeDir } from './local-runtime.mjs';

const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const psql = ['exec', '-i', 'supabase_db_judoju-news-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const checks = `begin;
create temp table h as select (public.catalog_public_tree(null)->>'catalog_version')::bigint head;
create temp table pool as select n.issue_id,n.version_id,n.first_published_at from public.news_public n
 join private.issues i on i.id=n.issue_id and i.current_version_id=n.version_id join private.article_versions v on v.id=n.version_id
 where n.publication_state='PUBLISHED' and v.public_body->>'_contract'='M1' and private.m1_current_evidence(n.issue_id)
  and exists(select 1 from private.impacts z where z.version_id=v.id);
-- Row 1: the newest issue; row 2: the newest other issue that impacts a selectable sector row 1 does not impact.
create temp table t as with one as (select * from pool order by first_published_at desc,issue_id limit 1)
 select issue_id,version_id,first_published_at,1 r from one
 union all (select p.issue_id,p.version_id,p.first_published_at,2 from pool p,h where p.issue_id<>(select issue_id from one)
  and exists(select 1 from private.impacts z where z.version_id=p.version_id and private.catalog_sector_selectable(z.sector_id,h.head,'SYNTHETIC')
   and not exists(select 1 from private.impacts y where y.version_id=(select version_id from one) and y.sector_id=z.sector_id))
  order by p.first_published_at desc,p.issue_id limit 1);
update private.article_versions set public_body=public_body||'{"article_kind":"MACRO"}' where id=(select version_id from t where r=1);
update private.article_versions set public_body=public_body||'{"article_kind":"SECTOR"}' where id=(select version_id from t where r=2);
create temp table x as select z.sector_id from private.impacts z,h where z.version_id=(select version_id from t where r=2)
 and private.catalog_sector_selectable(z.sector_id,h.head,'SYNTHETIC')
 and not exists(select 1 from private.impacts y where y.version_id=(select version_id from t where r=1) and y.sector_id=z.sector_id) limit 1;
create function pg_temp.has(p_row int, p_sectors uuid[], p_macro boolean) returns boolean language plpgsql as $$
declare page jsonb; target t%rowtype;
begin
 select * into target from t where t.r=p_row;
 if p_macro is null then page:=public.catalog_public_articles((select head from h),p_sectors,'TODAY',50,target.first_published_at+interval '1 second');
 else page:=public.catalog_public_articles((select head from h),p_sectors,'TODAY',50,target.first_published_at+interval '1 second',null,null,p_macro); end if;
 return exists(select 1 from jsonb_array_elements(page->'items') i where i->>'issue_id'=target.issue_id::text);
end $$;
select 'R|rows|'||count(*) from t;
select 'R|sector|'||count(*) from x;
select 'R|none7|'||pg_temp.has(1,'{}',null)||','||pg_temp.has(2,'{}',null);
select 'R|macro_only|'||pg_temp.has(1,'{}',true)||','||pg_temp.has(2,'{}',true);
select 'R|sector_only|'||pg_temp.has(1,array[(select sector_id from x)],false)||','||pg_temp.has(2,array[(select sector_id from x)],false);
select 'R|macro_sector|'||pg_temp.has(1,array[(select sector_id from x)],true)||','||pg_temp.has(2,array[(select sector_id from x)],true);
select 'R|same7_8|'||(public.catalog_public_articles((select head from h),'{}','TODAY',50,(select first_published_at from t where r=1)+interval '1 second')
  =public.catalog_public_articles((select head from h),'{}','TODAY',50,(select first_published_at from t where r=1)+interval '1 second',null,null,false))
 ||','||(public.catalog_public_articles((select head from h),array[(select sector_id from x)],'TODAY',50,(select first_published_at from t where r=2)+interval '1 second')
  =public.catalog_public_articles((select head from h),array[(select sector_id from x)],'TODAY',50,(select first_published_at from t where r=2)+interval '1 second',null,null,false));
update private.article_versions set public_body=public_body||'{"article_kind":"COMPANY"}' where id=(select version_id from t where r=1);
select 'R|company_macro|'||pg_temp.has(1,'{}',true);
do $$ begin perform public.catalog_public_articles((select head from h),'{}','TODAY',20,null,null,null,null); raise notice 'R|null_macro|accepted';
exception when others then raise notice 'R|null_macro|%',sqlerrm; end$$;
select 'R|signatures|'||string_agg(oid::regprocedure::text,';' order by pronargs) from pg_proc where proname='catalog_public_articles';
select 'R|grants|'||bool_and(has_function_privilege('anon',oid,'execute'))||','||bool_or(has_function_privilege('public',oid,'execute')) from pg_proc where proname='catalog_public_articles';
rollback;`;
const run = spawnSync(docker, psql, { input: checks, encoding: 'utf8', windowsHide: true });
assert.equal(run.status, 0, run.stderr);
const out = Object.fromEntries((run.stdout + run.stderr).split(/\r?\n/).map(line => /R\|([a-z0-9_]+)\|(.*)$/.exec(line)).filter(Boolean).map(m => [m[1], m[2]]));
assert.equal(out.rows, '2', 'two published issues with impacts are needed');
assert.equal(out.sector, '1', 'the SECTOR issue needs a selectable impact sector');
assert.equal(out.none7, 'true,true', 'no filter: both');
assert.equal(out.macro_only, 'true,false', 'macro only: the MACRO article, not the SECTOR one');
assert.equal(out.sector_only, 'false,true', 'sector only: as before');
assert.equal(out.macro_sector, 'true,true', 'macro + sector: union');
assert.equal(out.same7_8, 'true,true', 'seven arguments = eight arguments with p_macro=false');
assert.equal(out.company_macro, 'false', 'COMPANY stays out of the macro filter');
assert.match(out.null_macro, /INVALID_CURSOR_CONTEXT/);
assert.equal(out.signatures.split(';').length, 2);
assert.equal(out.grants, 'true,false', 'anon may execute both, public may not');

// Part B: both signatures through PostgREST, no ambiguity.
// The local stack belongs to the owning checkout (judoju-news); a worktree reads its local test credentials from there.
const credentialsFile = [process.env.JUDOJU_LOCAL_RUNTIME, runtimeDir, path.resolve(root, '../../../judoju-news/.local-data/runtime')]
  .filter(Boolean).map(dir => path.join(dir, 'credentials.json')).find(existsSync);
assert.ok(credentialsFile, 'LOCAL_CREDENTIALS_NOT_FOUND');
const credentials = JSON.parse(readFileSync(credentialsFile, 'utf8'));
const head = spawnSync(docker, psql, { input: "select (public.catalog_public_tree(null)->>'catalog_version');", encoding: 'utf8', windowsHide: true }).stdout.trim();
const call = async body => {
  const r = await fetch(credentials.apiUrl + '/rest/v1/rpc/catalog_public_articles', { method: 'POST', redirect: 'error',
    headers: { apikey: credentials.anonKey, Authorization: 'Bearer ' + credentials.anonKey, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(15000) });
  return { status: r.status, body: await r.json() };
};
const base = { p_expected: Number(head), p_sectors: [], p_period: 'THIS_MONTH', p_limit: 5, p_as_of: null, p_last_time: null, p_last_id: null };
const seven = await call(base), eight = await call({ ...base, p_macro: true }), eightFalse = await call({ ...base, p_macro: false });
assert.equal(seven.status, 200, JSON.stringify(seven.body)); assert.ok(Array.isArray(seven.body.items));
assert.equal(eight.status, 200, JSON.stringify(eight.body)); assert.ok(eight.body.items.every(i => i.article_kind === 'MACRO' || i.article_kind === 'SECTOR'));
assert.equal(eightFalse.status, 200);
assert.deepEqual(eightFalse.body.items.map(i => i.issue_id), seven.body.items.map(i => i.issue_id), 'same result through PostgREST');
console.log(JSON.stringify({ ok: true, macroFilter: out, postgrest: { seven: seven.status, eight: eight.status, macroItems: eight.body.items.length } }));
