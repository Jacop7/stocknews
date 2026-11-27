// Publish stage 1A, migration 57 (AI drafts inbox): one transaction on the local Supabase DB, rolled back.
// Requires migration 56 applied and 57 applied or not (applied inside the transaction when missing), plus one current
// published synthetic M1 issue whose draft serves as the shape template for AI_DRAFT_V1 payloads.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const psql = ['exec', '-i', 'supabase_db_judoju-news-local', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-At', '-v', 'ON_ERROR_STOP=1'];
const run = input => { const r = spawnSync(docker, psql, { input, encoding: 'utf8', windowsHide: true }); assert.equal(r.status, 0, r.stderr); return r; };
const q = value => "'" + String(value).replaceAll("'", "''") + "'";

const probe = run(`select to_regprocedure('private.real_mode_on()') is not null;select to_regprocedure('private.ai_ingest_draft(text,jsonb)') is not null;
select e.content::text from public.news_public n join private.article_versions v on v.id=n.version_id join private.editor_drafts e on e.issue_id=n.issue_id
  where n.publication_state='PUBLISHED' and v.public_body->>'_contract'='M1' and private.m1_current_evidence(n.issue_id) order by n.first_published_at desc limit 1;`).stdout.trim().split(/\r?\n/);
assert.equal(probe[0], 't', 'migration 56 must be applied first');
const applied = probe[1] === 't';
const template = JSON.parse(probe[2]);
const body = readFileSync(new URL('../supabase/migrations/20261127000057_ai_draft_inbox.sql', import.meta.url), 'utf8').replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '');

// AI_DRAFT_V1 from the template: claim IDs become AI fact IDs, sources move to an allowed official host.
const claimIds = [...new Set([...template.impacts.flatMap(x => x.evidence_ids), ...(template.schedule ?? []).flatMap(x => x.evidence_ids ?? [])])];
const factOf = id => 'f-' + claimIds.indexOf(id);
const sources = template.sources.map((s, n) => ({ name: s.name, url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=2026112700' + n, role: 'PRIMARY' }));
const now = new Date(Date.now() - 3600_000).toISOString();
const facts = claimIds.map(id => ({ id: factOf(id), statement: '공시 사실 ' + factOf(id), verification_class: 'OFFICIAL', independently_verified: true,
  korea_path_verified: true, official: true, macro: false, sensitive: false, recorded_at: now, source_urls: [sources[0].url] }));
const draft = {
  title: template.title, summary: template.summary, issue_analysis: template.issue_analysis, key_issues: template.key_issues, risks: template.risks ?? [],
  article_kind: template.article_kind, primary_sector_id: template.primary_sector_id, source_market: 'KR', selection_market_basis: 'KR', sources,
  impacts: template.impacts.map(({ evidence_ids, ...x }) => ({ ...x, evidence_fact_ids: evidence_ids.map(factOf) })),
  scenarios: template.scenarios ?? [], schedule: (template.schedule ?? []).map(({ evidence_ids, ...x }) => ({ ...x, evidence_fact_ids: (evidence_ids ?? []).map(factOf) }))
};
const payload = (ai, version, change = {}) => ({ format: 'AI_DRAFT_V1', ai_issue_id: ai, ai_version: version, story_key: 'story-' + ai.slice(0, 8), angle_key: 'angle-1',
  draft: { ...draft, ...change.draft }, facts: change.facts ?? facts, ...change.top });
const call = (ai, version, p) => `private.ai_ingest_draft(${q(`ai:${ai}:${version}`)},${q(JSON.stringify(p))}::jsonb)`;
const ok = (name, expr) => `select 'R|${name}|'||(${expr})::text;`;
const err = (name, sql) => `do $$ begin perform ${sql}; raise notice 'R|${name}|PASSED'; exception when others then raise notice 'R|${name}|%', sqlerrm; end $$;`;

const A = randomUUID(), B = randomUUID(), C = randomUUID(), D = randomUUID();
const unknownSector = '00000000-0000-4000-8000-000000000001';
const sql = `begin;
${applied ? '' : body}
create temp table h as select (public.catalog_public_tree(null)->>'catalog_version')::bigint head,(select version from private.policies where active order by version desc limit 1) pol;
${err('off', call(A, 1, payload(A, 1)))}
update private.real_mode set enabled=true;
-- Intake.
${ok('recv1', `${call(A, 1, payload(A, 1))}->>'state'`)}
create temp table a1 as select issue_id from private.ai_issue_links where ai_issue_id=${q(A)};
${ok('kind', "(select sample_kind from private.issues where id=(select issue_id from a1))")}
${ok('claims', "(select count(*) from private.claims where issue_id=(select issue_id from a1) and sample_kind='PERMITTED_REAL')")}
${ok('evidence_mapped', "(select bool_and(e.value#>>'{}' in (select claim_id::text from private.ai_claim_links where issue_id=(select issue_id from a1))) from private.editor_drafts d,jsonb_array_elements(d.content->'impacts') x,jsonb_array_elements(x->'evidence_ids') e where d.issue_id=(select issue_id from a1))")}
${ok('prepare_real', "(private.m1_prepare((select issue_id from a1),(select content from private.editor_drafts where issue_id=(select issue_id from a1)),(select pol from h),(select head from h))->>'article_kind')")}
-- Replay and conflict.
${ok('replay', `(${call(A, 1, payload(A, 1))})=(select result from private.ai_draft_receipts where effect_key=${q(`ai:${A}:1`)})`)}
${err('conflict', call(A, 1, payload(A, 1, { draft: { title: 'changed' } })))}
${err('key_mismatch', `private.ai_ingest_draft(${q(`ai:${A}:9`)},${q(JSON.stringify(payload(A, 1)))}::jsonb)`)}
-- New version replaces draft and claims.
create temp table c1 as select claim_id from private.ai_claim_links where issue_id=(select issue_id from a1);
${ok('recv2', `${call(A, 2, payload(A, 2, { draft: { title: 'v2 title' } }))}->>'state'`)}
${ok('v2_title', "(select content->>'title' from private.editor_drafts where issue_id=(select issue_id from a1))")}
${ok('v2_old_claims_gone', "not exists(select 1 from private.claims where id in (select claim_id from c1))")}
${ok('v2_claims', "(select count(*) from private.claims where issue_id=(select issue_id from a1))")}
-- Stale version (another AI issue: v3 then v2).
${ok('b3', `${call(B, 3, payload(B, 3))}->>'state'`)}
${ok('b2_stale', `${call(B, 2, payload(B, 2))}->>'state'`)}
-- Editor protection: once an editor saved, the AI never overwrites; new evidence waits beside the draft.
insert into auth.users(id,email,aud,role) values('11111111-2222-4333-8444-555555555555','editor-ai-test@example.invalid','authenticated','authenticated');
update private.editor_drafts set updated_by='11111111-2222-4333-8444-555555555555',content=jsonb_set(content,'{title}','"editor title"') where issue_id=(select issue_id from a1);
${ok('hold', `${call(A, 3, payload(A, 3, { draft: { title: 'v3 title' } }))}->>'state'`)}
${ok('hold_title', "(select content->>'title' from private.editor_drafts where issue_id=(select issue_id from a1))")}
${ok('hold_origins', "(select count(*) from private.ai_draft_origin where issue_id=(select issue_id from a1))")}
-- Catalog drift.
${ok('drift', `${call(C, 1, payload(C, 1, { draft: { impacts: draft.impacts.map(x => ({ ...x, sector_id: unknownSector })) } }))}->>'state'`)}
-- Withdrawal before any draft leaves a tombstone; a newer version reactivates.
${ok('tomb', `private.ai_withdraw_draft(${q(D)},1,'SOURCE_REVOKED')->>'state'`)}
${ok('tomb_v1', `${call(D, 1, payload(D, 1))}->>'state'`)}
${ok('tomb_v2', `${call(D, 2, payload(D, 2))}->>'state'`)}
-- Withdrawal of a newer server version removes the older local draft; an older withdrawal is stale.
create temp table b1 as select issue_id from private.ai_issue_links where ai_issue_id=${q(B)};
${ok('wd_old', `private.ai_withdraw_draft(${q(B)},2,'SOURCE_REVOKED')->>'state'`)}
${ok('wd_new', `private.ai_withdraw_draft(${q(B)},4,'SOURCE_REVOKED')->>'state'`)}
${ok('wd_cleared', "not exists(select 1 from private.editor_drafts where issue_id=(select issue_id from b1)) and not exists(select 1 from private.claims where issue_id=(select issue_id from b1)) and not exists(select 1 from private.ai_draft_origin where issue_id=(select issue_id from b1))")}
-- Invalid payloads are refused before anything is stored.
${err('bad_top', call(randomUUID(), 1, payload(A, 1, { top: { extra: 1 } })).replace(/ai:[^:]+:1/, 'ai:x:1'))}
${err('bad_fact_url', call(A, 7, payload(A, 7, { facts: facts.map(f => ({ ...f, source_urls: ['https://evil.example/x'] })) })))}
${err('bad_field', call(A, 7, payload(A, 7, { draft: { scheduled_publish_at: '2026-12-01T00:00:00Z' } })))}
${err('bad_fact_ref', call(A, 7, payload(A, 7, { draft: { impacts: draft.impacts.map(x => ({ ...x, evidence_fact_ids: ['f-missing'] })) } })))}
${err('bad_source', call(A, 7, payload(A, 7, { draft: { sources: [{ name: 'x', url: 'https://fixture.invalid/a', role: 'PRIMARY' }] } })))}
-- 30-day retention.
update private.ai_draft_origin set expires_at=now()-interval '1 second' where issue_id=(select issue_id from private.ai_issue_links where ai_issue_id=${q(D)});
${ok('cleanup', "private.ai_inbox_cleanup()->>'expired'")}
${ok('cleanup_state', `(select state||':'||reason from private.ai_issue_links where ai_issue_id=${q(D)})`)}
-- No API role can reach the inbox.
${ok('acl', "(select bool_or(has_function_privilege(r,f,'EXECUTE')) from unnest(array['anon','authenticated','service_role']) r,unnest(array['private.ai_ingest_draft(text,jsonb)','private.ai_withdraw_draft(text,integer,text)','private.ai_inbox_cleanup()','private.retention_tick()']) f)||','||(select bool_or(has_table_privilege(r,t,'SELECT')) from unnest(array['anon','authenticated','service_role']) r,unnest(array['private.ai_issue_links','private.ai_draft_receipts','private.ai_draft_origin','private.ai_claim_links']) t)")}
rollback;`;

const out = run(sql);
const lines = (out.stdout + out.stderr).split(/\r?\n/).map(l => l.replace(/^(psql:[^:]*:\d+: )?NOTICE:\s*/, '')).filter(l => l.startsWith('R|')).map(l => l.split('|').slice(1));
const value = key => lines.filter(([k]) => k === key).map(([, ...v]) => v.join('|'));
const factCount = String(facts.length);
assert.deepEqual(value('off'), ['REAL_MODE_OFF']);
assert.deepEqual(value('recv1'), ['RECEIVED']);
assert.deepEqual(value('kind'), ['PERMITTED_REAL']);
assert.deepEqual(value('claims'), [factCount]);
assert.deepEqual(value('evidence_mapped'), ['true']);
assert.deepEqual(value('prepare_real'), [template.article_kind]);
assert.deepEqual(value('replay'), ['true']);
assert.deepEqual(value('conflict'), ['AI_DRAFT_CONFLICT']);
assert.deepEqual(value('key_mismatch'), ['AI_EFFECT_KEY_MISMATCH']);
assert.deepEqual(value('recv2'), ['RECEIVED']);
assert.deepEqual(value('v2_title'), ['v2 title']);
assert.deepEqual(value('v2_old_claims_gone'), ['true']);
assert.deepEqual(value('v2_claims'), [factCount]);
assert.deepEqual(value('b3'), ['RECEIVED']);
assert.deepEqual(value('b2_stale'), ['STALE_VERSION']);
assert.deepEqual(value('hold'), ['HOLD_EDITOR']);
assert.deepEqual(value('hold_title'), ['editor title']);
assert.deepEqual(value('hold_origins'), ['2']);
assert.deepEqual(value('drift'), ['CATALOG_DRIFT']);
assert.deepEqual(value('tomb'), ['WITHDRAWN']);
assert.deepEqual(value('tomb_v1'), ['WITHDRAWN']);
assert.deepEqual(value('tomb_v2'), ['RECEIVED']);
assert.deepEqual(value('wd_old'), ['STALE_VERSION']);
assert.deepEqual(value('wd_new'), ['WITHDRAWN']);
assert.deepEqual(value('wd_cleared'), ['true']);
assert.deepEqual(value('bad_top'), ['AI_DRAFT_KEYS']);
assert.deepEqual(value('bad_fact_url'), ['AI_FACT_SOURCE_NOT_ALLOWED']);
assert.deepEqual(value('bad_field'), ['AI_DRAFT_FIELDS']);
assert.deepEqual(value('bad_fact_ref'), ['UNKNOWN_FACT_REF']);
assert.deepEqual(value('bad_source'), ['AI_SOURCES_INVALID']);
assert.ok(Number(value('cleanup')[0]) >= 1);
assert.deepEqual(value('cleanup_state'), ['WITHDRAWN:EXPIRED']);
assert.deepEqual(value('acl'), ['false,false']);
console.log(JSON.stringify({ status: 'PASS', phase: 'AI_INBOX_1A_57', migrationApplied: applied, rolledBack: true, checks: lines.length }));
