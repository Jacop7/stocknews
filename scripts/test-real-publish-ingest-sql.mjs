// Publish stage 1B, migrations 59+60: withdrawal of published real articles through the real AI intake, one transaction
// on the local Supabase DB, rolled back (60 is applied inside it when not applied yet). Also the inventory of every
// SYNTHETIC literal reachable from the API-callable functions.
//   A: v1 published, v2 waits (HOLD_EDITOR), v1 withdrawn -> retracted, v2 evidence gone, republish refused; the
//      cause survives the correction timeout.
//   B: v1 published and withdrawn, then v2 arrives -> HOLD_EDITOR beside the retracted article, publish refused.
//   C: already off the public view (editor CORRECTION_PENDING) when withdrawn -> evidence gone, cause shown.
//   D: unpublished draft replaced by v2 -> withdrawing v1 is stale.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const psql = ['exec', '-i', 'supabase_db_judoju-news-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const run = input => { const r = spawnSync(docker, psql, { input, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 }); assert.equal(r.status, 0, r.stderr); return r; };
const q = value => "'" + String(value).replaceAll("'", "''") + "'";

assert.equal(run("select to_regprocedure('private.public_read_kind()') is not null;").stdout.trim(), 't', 'migration 59 must be applied locally');
const applied61 = run("select exists(select 1 from pg_attribute where attrelid='private.issues'::regclass and attname='removal_cause' and not attisdropped);").stdout.trim() === 't';
const applied60 = run("select prosrc like '%linked:=found%' from pg_proc where oid='private.ai_withdraw_draft(text,integer,text)'::regprocedure;").stdout.trim() === 't';
const body60 = applied60 ? '' : readFileSync(new URL('../supabase/migrations/20261127000060_real_withdraw_evidence_version.sql', import.meta.url), 'utf8')
  .replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '');
const body61 = applied61 ? '' : readFileSync(new URL('../supabase/migrations/20261127000061_real_removal_cause.sql', import.meta.url), 'utf8')
  .replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '');

// Template: the newest current published synthetic SECTOR issue whose draft passes the synthetic chain.
const template = JSON.parse(run(`begin;
update private.real_mode set public_read_enabled=false;
create function pg_temp.ok(p uuid) returns boolean language plpgsql as $f$ begin perform private.m1_prepare(p,(select content from private.editor_drafts where issue_id=p),
  (select version from private.policies where active order by version desc limit 1),(public.catalog_public_tree(null)->>'catalog_version')::bigint);return true;exception when others then return false;end$f$;
create temp table t as select n.issue_id,n.first_published_at from public.news_public n join private.article_versions v on v.id=n.version_id
  where n.publication_state='PUBLISHED' and n.sample_kind='SYNTHETIC' and v.public_body->>'_contract'='M1' and v.public_body->>'article_kind'='SECTOR'
  order by n.first_published_at desc limit 20;
delete from t where not private.m1_current_evidence(issue_id) or not pg_temp.ok(issue_id);
select e.content::text from t join private.editor_drafts e on e.issue_id=t.issue_id order by t.first_published_at desc limit 1;
rollback;`).stdout.split(/\r?\n/).find(line => line.startsWith('{')));

// AI_DRAFT_V1 built exactly as the inbox test does: claim IDs become fact IDs, sources on an official host.
const claimIds = [...new Set([...template.impacts.flatMap(x => x.evidence_ids), ...(template.schedule ?? []).flatMap(x => x.evidence_ids ?? [])])];
const factOf = id => 'f-' + claimIds.indexOf(id);
const sources = template.sources.map((s, n) => ({ name: s.name, url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=2026112700' + n, role: 'PRIMARY' }));
const recorded = new Date(Date.now() - 3600_000).toISOString();
const facts = claimIds.map(id => ({ id: factOf(id), statement: '공시 사실 ' + factOf(id), verification_class: 'ORDINARY_FACT', independently_verified: true,
  korea_path_verified: true, recorded_at: recorded, source_urls: [sources[0].url] }));
const draft = {
  title: template.title, summary: template.summary, issue_analysis: template.issue_analysis, key_issues: template.key_issues, risks: template.risks ?? [],
  article_kind: template.article_kind, primary_sector_id: template.primary_sector_id, source_market: 'KR', selection_market_basis: 'KR', sources,
  impacts: template.impacts.map(({ evidence_ids, ...x }) => ({ ...x, evidence_fact_ids: evidence_ids.map(factOf) })),
  scenarios: template.scenarios ?? [], schedule: (template.schedule ?? []).map(({ evidence_ids, ...x }) => ({ ...x, evidence_fact_ids: (evidence_ids ?? []).map(factOf) })),
};
const payload = (ai, version, title) => ({ format: 'AI_DRAFT_V1', ai_issue_id: ai, ai_version: version, story_key: 'story-' + ai.slice(0, 8), angle_key: 'angle-1',
  catalog_ref: { registry: 'registry-v1:test', sha256: 'a'.repeat(64) }, draft: { ...draft, title: title ?? draft.title }, facts });
const ingest = (name, ai, version) => `select 'R|${name}|'||(private.ai_ingest_draft(${q(`ai:${ai}:${version}`)},${q(JSON.stringify(payload(ai, version, version > 1 ? draft.title + ' v' + version : undefined)))}::jsonb)->>'state');
insert into x(name,issue,pol,cat) select ${q(name.slice(0, 1).toUpperCase())},issue_id,(select version from private.policies where active order by version desc limit 1),(public.catalog_public_tree(null)->>'catalog_version')::bigint from private.ai_issue_links where ai_issue_id=${q(ai)} on conflict(name) do nothing;`;
// An editor call that matches no row must not pass silently.
const tryDo = (name, sql) => `do $$ begin ${sql}; if not found then raise exception 'NO_TARGET_ROW'; end if; raise notice 'R|${name}|PASSED'; exception when others then raise notice 'R|${name}|%', sqlerrm; end $$;`;
const claims = `select set_config('request.jwt.claims',json_build_object('role','authenticated','sub',u,'session_id',s,'aal','aal2')::text,true) from ed;`;
const asEditor = (name, sql) => `${claims}
update x set drev=(select revision from private.editor_drafts where issue_id=x.issue),irev=(select revision from private.issues where id=x.issue);
set local role authenticated;
${tryDo(name, sql)}
reset role;
select set_config('request.jwt.claims','',true);`;
const publish = (name, who, key) => asEditor(name, `perform public.m1_publish_draft(x.issue,x.drev,x.irev,x.pol,x.cat,'${key}') from x where x.name='${who}'`);
const state = (name, who) => `select 'R|${name}|'||concat_ws(',',i.publication_state,(select count(*) from private.claims c where c.issue_id=i.id),
  (select string_agg(distinct c.ai_version::text,'+') from private.ai_claim_links c where c.issue_id=i.id),
  (select coalesce(string_agg(o.ai_version::text,'+' order by o.ai_version),'-') from private.ai_draft_origin o where o.issue_id=i.id),
  (select l.state||'/'||l.current_version from private.ai_issue_links l where l.issue_id=i.id),private.m1_current_evidence(i.id))
  from private.issues i where i.id=(select issue from x where name='${who}');`;
const reason = (name, who) => `${claims}
set local role authenticated;
select 'R|${name}|'||coalesce((select a->>'state_reason' from jsonb_array_elements(public.m1_editor_articles()) a where a->>'id'=(select issue::text from x where name='${who}')),'null');
reset role;
select set_config('request.jwt.claims','',true);`;
const [A, B, C, D] = [randomUUID(), randomUUID(), randomUUID(), randomUUID()];

const sql = `begin;
${body60}
${body61}
update private.real_mode set enabled=true,public_read_enabled=true;
create temp table x(name text primary key,issue uuid,drev bigint,irev bigint,pol bigint,cat bigint);
create temp table ed as select gen_random_uuid() u,gen_random_uuid() s;
insert into auth.users(id,email,aud,role,raw_app_meta_data) select u,'editor-'||u||'@example.invalid','authenticated','authenticated','{"app_role":"admin"}' from ed;
insert into auth.sessions(id,user_id) select s,u from ed;
insert into private.admin_memberships(user_id,active) select u,true from ed;
insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) select repeat('c',64),u,s,repeat('x',40),now()+interval '1 hour' from ed;
grant select on x,ed to authenticated;

-- A: published v1, v2 waits beside it, then v1 is withdrawn.
${ingest('a1', A, 1)}
${publish('a_publish', 'A', 'ti-a-1')}
${ingest('a2', A, 2)}
${state('a_held', 'A')}
select 'R|a_withdraw|'||(private.ai_withdraw_draft(${q(A)},1,'SOURCE_REVOKED')->>'state');
${state('a_retracted', 'A')}
${publish('a_republish', 'A', 'ti-a-2')}
${reason('a_reason', 'A')}
set local session_replication_role=replica;
update private.issues set correction_pending_since=now()-interval '25 hours' where id=(select issue from x where name='A');
set local session_replication_role=origin;
select 'R|a_timeout|'||(private.correction_timeout_tick()->>'status');
${state('a_after_timeout', 'A')}
${reason('a_reason_after_timeout', 'A')}

-- B: published v1 withdrawn first, then v2 arrives.
${ingest('b1', B, 1)}
${publish('b_publish', 'B', 'ti-b-1')}
select 'R|b_withdraw|'||(private.ai_withdraw_draft(${q(B)},1,'SOURCE_REVOKED')->>'issue_state');
${ingest('b2', B, 2)}
${state('b_after_v2', 'B')}
${publish('b_republish', 'B', 'ti-b-2')}
-- The cause survives the newer version waiting beside it and the later correction timeout (migration 61).
set local session_replication_role=replica;
update private.issues set correction_pending_since=now()-interval '25 hours' where id=(select issue from x where name='B');
set local session_replication_role=origin;
select 'R|b_timeout|'||(private.correction_timeout_tick()->>'status');
${state('b_after_timeout', 'B')}
${reason('b_reason_after_timeout', 'B')}

-- C: already off the public view when withdrawn.
${ingest('c1', C, 1)}
${publish('c_publish', 'C', 'ti-c-1')}
${asEditor('c_pending', "perform public.m1_set_state(x.issue,x.irev,'CORRECTION_PENDING','ti-c-cp') from x where x.name='C'")}
select 'R|c_withdraw|'||(private.ai_withdraw_draft(${q(C)},1,'SOURCE_REVOKED')->>'issue_state');
${state('c_state', 'C')}
${reason('c_reason', 'C')}

-- D: an unpublished draft whose claims came from v2; withdrawing v1 is stale and changes nothing.
${ingest('d1', D, 1)}
${ingest('d2', D, 2)}
select 'R|d_withdraw_v1|'||(private.ai_withdraw_draft(${q(D)},1,'SOURCE_REVOKED')->>'state');
${state('d_state', 'D')}
rollback;`;

const out = run(sql);
const lines = (out.stdout + out.stderr).split(/\r?\n/).map(line => line.replace(/^(psql:[^:]*:\d+: )?NOTICE:\s*/, '')).filter(line => line.startsWith('R|')).map(line => line.split('|').slice(1));
if (process.env.T1B_DEBUG) console.log(lines.map(l => l.join('|')).join('\n'));
const value = key => lines.filter(([k]) => k === key).map(([, ...v]) => v.join('|'));
const n = String(facts.length);
assert.deepEqual(value('a1'), ['RECEIVED']);
assert.deepEqual(value('a_publish'), ['PASSED']);
assert.deepEqual(value('a2'), ['HOLD_EDITOR']);
assert.deepEqual(value('a_held'), [`PUBLISHED,${n},1,1+2,HOLD_EDITOR/2,t`]);
assert.deepEqual(value('a_withdraw'), ['WITHDRAWN']);
assert.deepEqual(value('a_retracted'), ['CORRECTION_PENDING,0,-,WITHDRAWN/2,f']);
assert.deepEqual(value('a_republish'), ['AI_SOURCE_WITHDRAWN']);
assert.deepEqual(value('a_reason'), ['AI_SOURCE_REVOKED']);
assert.deepEqual(value('a_timeout'), ['OK']);
assert.deepEqual(value('a_after_timeout'), ['WITHDRAWN,0,-,WITHDRAWN/2,f']);
assert.deepEqual(value('a_reason_after_timeout'), ['AI_SOURCE_REVOKED']);
assert.deepEqual(value('b1'), ['RECEIVED']);
assert.deepEqual(value('b_publish'), ['PASSED']);
assert.deepEqual(value('b_withdraw'), ['CORRECTION_PENDING']);
assert.deepEqual(value('b2'), ['HOLD_EDITOR']);
assert.deepEqual(value('b_after_v2'), ['CORRECTION_PENDING,0,2,HOLD_EDITOR/2,f']);
assert.deepEqual(value('b_republish'), ['AI_DRAFT_HELD']);
assert.deepEqual(value('b_timeout'), ['OK']);
assert.deepEqual(value('b_after_timeout'), ['WITHDRAWN,0,2,HOLD_EDITOR/2,f']);
assert.deepEqual(value('b_reason_after_timeout'), ['AI_SOURCE_REVOKED']);
assert.deepEqual(value('c_publish'), ['PASSED']);
assert.deepEqual(value('c_pending'), ['PASSED']);
assert.deepEqual(value('c_withdraw'), ['CORRECTION_PENDING']);
assert.deepEqual(value('c_state'), ['CORRECTION_PENDING,0,-,WITHDRAWN/1,f']);
assert.deepEqual(value('c_reason'), ['AI_SOURCE_REVOKED']);
assert.deepEqual(value('d1'), ['RECEIVED']);
assert.deepEqual(value('d2'), ['RECEIVED']);
assert.deepEqual(value('d_withdraw_v1'), ['STALE_VERSION']);
assert.deepEqual(value('d_state'), [`DRAFT,${n},2,2,ACTIVE/2,f`]);

// Inventory: every function reachable from an API-callable function (or fired as a trigger) that contains a SYNTHETIC
// literal is classified here by signature and purpose; a new or unlisted one fails.
const rows = run(`select p.oid::regprocedure::text||'|'||n.nspname||'.'||p.proname||'|'||(n.nspname='public' and (has_function_privilege('anon',p.oid,'execute') or has_function_privilege('authenticated',p.oid,'execute')))::text
  ||'|'||(p.prorettype='trigger'::regtype)::text||'|'||encode(convert_to(p.prosrc,'UTF8'),'base64') from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private') and p.prokind='f';`)
  .stdout.replace(/\r/g, '').split('\n').reduce((acc, line) => {
    // base64 output may wrap; join continuation lines onto the previous row.
    if (/^[^|]+\|[^|]+\|(true|false)\|(true|false)\|/.test(line)) acc.push(line); else if (line && acc.length) acc[acc.length - 1] += line;
    return acc;
  }, []).map(line => { const [sig, name, callable, trigger, src] = line.split('|'); return { sig, name, callable: callable === 'true', trigger: trigger === 'true', src: Buffer.from(src, 'base64').toString('utf8') }; });
const byName = new Map();
for (const r of rows) byName.set(r.name, [...(byName.get(r.name) ?? []), r]);
const seen = new Set(), queue = rows.filter(r => r.callable || r.trigger);
while (queue.length) {
  const r = queue.pop();
  if (seen.has(r.sig)) continue;
  seen.add(r.sig);
  for (const [, ref] of r.src.matchAll(/\b((?:public|private)\.[a-z0-9_]+)\s*\(/g)) for (const next of byName.get(ref) ?? []) queue.push(next);
}
const synthetic = rows.filter(r => seen.has(r.sig) && r.src.includes('SYNTHETIC')).map(r => r.sig).sort();
const CLASSIFIED = {
  // Public article reads: SYNTHETIC only as sector-catalogue rules (fixture sectors and the legacy-sector flag).
  'catalog_public_articles(bigint,uuid[],text,integer,timestamp with time zone,timestamp with time zone,uuid)': 'sector selectability and legacy flag',
  'catalog_public_company(bigint,uuid,integer,timestamp with time zone,timestamp with time zone,uuid)': 'legacy-sector flag',
  'catalog_public_saved(bigint,uuid[])': 'legacy-sector flag',
  'catalog_public_search_news(bigint,text,integer,timestamp with time zone,timestamp with time zone,uuid)': 'sector keyword selectability and legacy flag',
  'catalog_public_sector_page(uuid,bigint,integer,integer)': 'sector selectability',
  'm1_public_catalog()': 'fixture sector list (sectors, not articles)',
  'm1_public_identity()': 'identity value while synthetic articles are public',
  'private.public_read_kind()': 'the public-kind switch itself',
  'private.catalog_sector_selectable(uuid,bigint,text)': 'sector selectability by article mode',
  'private.catalog_version_sector_allowed(bigint,uuid)': 'fixture sectors of a catalog version',
  'private.catalog_tree(bigint)': 'fixture sector tree',
  'private.catalog_active_leaf(uuid)': 'fixture sector leaf',
  'private.search_membership_visible(uuid,bigint)': 'sector selectability of a company membership',
  // Editor, publishing and operations paths (synthetic by design or the real/synthetic dispatch itself).
  'private.m1_prepare_v1(uuid,jsonb,bigint,bigint)': 'synthetic validator chain',
  'private.m0_publish_legacy(uuid,bigint,text,text,jsonb,text,bigint,bigint,text)': 'synthetic publisher',
  'reservation_create(uuid,bigint,bigint,bigint,bigint,text,uuid)': '1A scheduling block for real drafts',
  'reservation_list(uuid)': 'reservation listing',
  'm1_create_draft(uuid)': 'synthetic draft creation',
  'm1_check_editor()': 'editor check fixture kind',
  'catalog_editor_sectors()': 'editor sector list',
  'maintenance_admin_status()': 'maintenance status',
};
const unclassified = synthetic.filter(sig => !Object.hasOwn(CLASSIFIED, sig));
assert.deepEqual(unclassified, [], 'unclassified SYNTHETIC literal in a reachable function');
assert.deepEqual(Object.keys(CLASSIFIED).filter(sig => !synthetic.includes(sig)), [], 'stale classification (no longer reachable or no longer SYNTHETIC)');
// Article-kind conditions are gone from every reachable public article read.
const articleReads = ['catalog_public_articles', 'catalog_public_company', 'catalog_public_saved', 'catalog_public_search_news', 'is_news_visible', 'resolve_issue',
  'm1_public_articles', 'm1_public_article', 'get_public_article'];
for (const r of rows.filter(r => articleReads.includes(r.name.replace(/^public\./, '')))) assert.doesNotMatch(r.src, /sample_kind\s*(=|<>)\s*'SYNTHETIC'/, r.sig);
console.log(JSON.stringify({ status: 'PASS', phase: 'REAL_WITHDRAW_INGEST_1B_60_61', migrationApplied: applied60 && applied61, rolledBack: true, checks: lines.length, reachable: seen.size, syntheticReachable: synthetic.length }));
