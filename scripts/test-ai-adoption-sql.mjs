// Publish stage 1C, migration 62: an editor adopts the newest held AI version of a real issue, through the real AI
// intake, then republishes. One transaction on the local Supabase DB, rolled back (60-62 applied inside it when not
// applied yet), plus a two-connection check that an adoption in flight holds the AI-issue lock.
//   E: published v1, v2 held and adopted (hidden until republished, original retention and catalog kept), republished.
//   F: published, withdrawn, v2 adopted (removal cause cleared), republished.
//   G: refusals. H: adopted but never republished, window closed, cleared by the retention job.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
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
const applied62 = run("select to_regprocedure('public.m1_adopt_ai_version(uuid,integer,bigint,text)') is not null;").stdout.trim() === 't';
const body62 = applied62 ? '' : readFileSync(new URL('../supabase/migrations/20261127000062_ai_version_adoption.sql', import.meta.url), 'utf8')
  .replace(/^begin;\s*$/m, '').replace(/commit;\s*$/, '');
// Adoption as the signed-in editor. offset shifts the expected draft revision (revision-conflict case).
const adopt = (name, who, version, key, { offset = 0, refresh = true } = {}) => `${claims}
${refresh ? 'update x set drev=(select revision from private.editor_drafts where issue_id=x.issue),irev=(select revision from private.issues where id=x.issue);' : ''}
set local role authenticated;
do $$ declare r jsonb; begin select public.m1_adopt_ai_version(x.issue,${version},x.drev+(${offset}),'${key}') into strict r from x where x.name='${who}';
  raise notice 'R|${name}|%', r->>'state'; exception when others then raise notice 'R|${name}|%', sqlerrm; end $$;
reset role;
select set_config('request.jwt.claims','',true);`;
const publishStatus = (name, who, key, { refresh = true } = {}) => `${claims}
${refresh ? 'update x set drev=(select revision from private.editor_drafts where issue_id=x.issue),irev=(select revision from private.issues where id=x.issue);' : ''}
set local role authenticated;
do $$ declare r jsonb; begin select public.m1_publish_draft(x.issue,x.drev,x.irev,x.pol,x.cat,'${key}') into strict r from x where x.name='${who}';
  raise notice 'R|${name}|%', r->>'status'; exception when others then raise notice 'R|${name}|%', sqlerrm; end $$;
reset role;
select set_config('request.jwt.claims','',true);`;
const adoptable = (name, who) => `${claims}
set local role authenticated;
select 'R|${name}|'||coalesce((public.m1_get_draft(x.issue)->'ai_origin'->>'adoptable'),'null') from x where x.name='${who}';
reset role;
select set_config('request.jwt.claims','',true);`;
const visible = (name, who) => `set local role anon;
select 'R|${name}|'||public.is_news_visible(x.issue)||','||(public.m1_public_article(x.issue)->>'state') from x where x.name='${who}';
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
  'company='||(p.company is not null and exists(select 1 from jsonb_array_elements(public.catalog_public_company(p.head,p.company,20,p.as_of)->'items') x where x->>'issue_id'=p.issue_id::text)))`;
const reads = (tag, who) => `delete from probe;
insert into probe select i.id,(public.catalog_public_tree(null)->>'catalog_version')::bigint,i.first_published_at+interval '1 second',split_part(trim(v.public_body->>'title'),' ',1),
  (select c.value::uuid from jsonb_array_elements_text(case when jsonb_typeof(v.public_body->'company_refs')='array' then v.public_body->'company_refs' else '[]' end) c limit 1)
  from private.issues i join private.article_versions v on v.id=i.current_version_id where i.id=(select issue from x where name='${who}');
${['anon', 'authenticated'].map(role => `set local role ${role};
select 'R|reads_${tag}_${role}|'||${READS} from probe p;
reset role;`).join('\n')}`;
const ageWindow = who => `set local session_replication_role=replica;
update private.issues set correction_pending_since=now()-interval '25 hours' where id=(select issue from x where name='${who}');
set local session_replication_role=origin;`;
// Evidence consistency: every evidence ID of the draft (and of the current public version) is a current claim of the
// issue, and every claim comes from the given AI version.
const consistent = (name, who, version) => `select 'R|${name}|'||concat_ws(',',
  not exists(select 1 from private.editor_drafts d cross join lateral jsonb_array_elements(d.content->'impacts') it cross join lateral jsonb_array_elements_text(it->'evidence_ids') e
    where d.issue_id=i.id and not exists(select 1 from private.claims c where c.issue_id=i.id and c.id::text=e.value)),
  not exists(select 1 from private.impacts z cross join lateral unnest(z.evidence_ids) e(id) where z.version_id=i.current_version_id
    and not exists(select 1 from private.claims c where c.issue_id=i.id and c.id=e.id)),
  not exists(select 1 from private.ai_claim_links c where c.issue_id=i.id and c.ai_version<>${version}),
  (select count(*) from private.claims c where c.issue_id=i.id))
  from private.issues i where i.id=(select issue from x where name='${who}');`;
const [E, F, G, H, K, J] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];

const sql = `begin;
${body60}
${body61}
${body62}
update private.real_mode set enabled=true,public_read_enabled=true;
create temp table x(name text primary key,issue uuid,drev bigint,irev bigint,pol bigint,cat bigint);
create temp table snap(name text primary key,drev bigint,irev bigint,received_at timestamptz,expires_at timestamptz,catalog_version bigint);
create temp table ed as select gen_random_uuid() u,gen_random_uuid() s;
insert into auth.users(id,email,aud,role,raw_app_meta_data) select u,'editor-'||u||'@example.invalid','authenticated','authenticated','{"app_role":"admin"}' from ed;
insert into auth.sessions(id,user_id) select s,u from ed;
insert into private.admin_memberships(user_id,active) select u,true from ed;
insert into private.admin_sessions(capability_hash,user_id,auth_session_id,ciphertext,expires_at) select repeat('c',64),u,s,repeat('x',40),now()+interval '1 hour' from ed;
create temp table probe(issue_id uuid,head bigint,as_of timestamptz,word text,company uuid);
grant select on x,ed,probe to authenticated,anon;

-- E: published v1, v2 held, v2 adopted, then republished.
${ingest('e1', E, 1)}
${publishStatus('e_publish', 'E', 'ta-e-1')}
insert into snap(name,drev,irev) select 'E_pub',drev,irev from x where name='E';
${reads('e_pub', 'E')}
${ingest('e2', E, 2)}
-- The held version's receipt time, retention and catalog version, recorded before adoption (catalog head moved since).
insert into snap select 'E_origin',null,null,o.received_at,o.expires_at,o.catalog_version from private.ai_draft_origin o where o.issue_id=(select issue from x where name='E') and o.ai_version=2;
update private.ai_draft_origin set catalog_version=catalog_version-1 where issue_id=(select issue from x where name='E') and ai_version=2;
update snap set catalog_version=catalog_version-1 where name='E_origin';
${adoptable('e_adoptable', 'E')}
${adopt('e_adopt', 'E', 2, 'ta-e-adopt')}
${state('e_after', 'E')}
${consistent('e_consistent', 'E', 2)}
${visible('e_hidden', 'E')}
${reads('e_adopted', 'E')}
${reason('e_reason', 'E')}
select 'R|e_origin_kept|'||((o.received_at,o.expires_at,o.catalog_version)=(s.received_at,s.expires_at,s.catalog_version))::text
  from private.ai_draft_origin o,snap s where s.name='E_origin' and o.issue_id=(select issue from x where name='E') and o.ai_version=2;
${adopt('e_replay', 'E', 2, 'ta-e-adopt', { refresh: false })}
${adopt('e_key_conflict', 'E', 3, 'ta-e-adopt', { refresh: false })}
-- An editor save based on the draft as it was before adoption is refused (the adoption advanced the revision).
create temp table sc as select content from private.editor_drafts where issue_id=(select issue from x where name='E');
grant select on sc,snap to authenticated;
${asEditor('e_save_stale', "perform public.m1_save_draft(x.issue,s.drev,(select content from sc)) from x,snap s where x.name='E' and s.name='E_pub'")}
-- A replay of the pre-adoption publish request returns the old answer and does not count as publishing the adoption.
update x set drev=s.drev,irev=s.irev from snap s where s.name='E_pub' and x.name='E';
${publishStatus('e_old_replay', 'E', 'ta-e-1', { refresh: false })}
select 'R|e_published_before|'||coalesce((select published_at is not null from private.ai_adoptions where effect_key='ta-e-adopt')::text,'null');
${publishStatus('e_republish', 'E', 'ta-e-2')}
select 'R|e_published_after|'||(a.published_at is not null and a.published_version_id=i.current_version_id)::text
  from private.ai_adoptions a join private.issues i on i.id=a.issue_id where a.effect_key='ta-e-adopt';
${consistent('e_consistent_published', 'E', 2)}
${visible('e_visible', 'E')}
${reads('e_repub', 'E')}

-- F: published, withdrawn, v2 held, adopted (cause cleared), republished.
${ingest('f1', F, 1)}
${publishStatus('f_publish', 'F', 'ta-f-1')}
select 'R|f_withdraw|'||(private.ai_withdraw_draft(${q(F)},1,'SOURCE_REVOKED')->>'issue_state');
${ingest('f2', F, 2)}
${adopt('f_adopt', 'F', 2, 'ta-f-adopt')}
select 'R|f_cause|'||coalesce((select removal_cause from private.issues where id=(select issue from x where name='F')),'null');
${publishStatus('f_republish', 'F', 'ta-f-2')}
${visible('f_visible', 'F')}

-- G: refusals.
${ingest('g1', G, 1)}
${publishStatus('g_publish', 'G', 'ta-g-1')}
${ingest('g2', G, 2)}
${ingest('g3', G, 3)}
${adopt('g_old_version', 'G', 2, 'ta-g-a')}
update private.ai_draft_origin set draft=null where issue_id=(select issue from x where name='G') and ai_version=3;
${adoptable('g_adoptable_no_draft', 'G')}
${adopt('g_no_draft', 'G', 3, 'ta-g-b')}
update private.ai_draft_origin o set draft=(select d.draft from private.ai_draft_origin d where d.issue_id=o.issue_id and d.ai_version=2) where issue_id=(select issue from x where name='G') and ai_version=3;
update private.ai_draft_origin set expires_at=now()-interval '1 second' where issue_id=(select issue from x where name='G') and ai_version=3;
${adopt('g_expired', 'G', 3, 'ta-g-c')}
update private.ai_draft_origin set expires_at=now()+interval '20 days',facts=(select jsonb_agg(jsonb_set(f,'{recorded_at}',to_jsonb(now()-interval '31 days'))) from jsonb_array_elements(facts) f)
  where issue_id=(select issue from x where name='G') and ai_version=3;
${adopt('g_fact_stale', 'G', 3, 'ta-g-d')}
update private.ai_draft_origin o set facts=(select d.facts from private.ai_draft_origin d where d.issue_id=o.issue_id and d.ai_version=2) where issue_id=(select issue from x where name='G') and ai_version=3;
${adopt('g_revision', 'G', 3, 'ta-g-e', { offset: -1 })}
update private.ai_draft_origin set draft=jsonb_set(draft,'{impacts,0,sector_id}','"00000000-0000-4000-8000-000000000001"') where issue_id=(select issue from x where name='G') and ai_version=3;
${adopt('g_drift', 'G', 3, 'ta-g-f')}
update private.ai_draft_origin o set draft=(select d.draft from private.ai_draft_origin d where d.issue_id=o.issue_id and d.ai_version=2) where issue_id=(select issue from x where name='G') and ai_version=3;
update private.real_mode set enabled=false;
${adopt('g_real_off', 'G', 3, 'ta-g-g')}
update private.real_mode set enabled=true;
insert into x(name,issue) select 'T',n.issue_id from public.news_public n join private.editor_drafts d on d.issue_id=n.issue_id where n.sample_kind='SYNTHETIC' limit 1;
${adopt('g_synthetic', 'T', 1, 'ta-g-h')}
${asEditor('g_to_pending', "perform public.m1_set_state(x.issue,x.irev,'CORRECTION_PENDING','ta-g-cp') from x where x.name='G'")}
${ageWindow('G')}
${adoptable('g_adoptable_window', 'G')}
${adopt('g_window', 'G', 3, 'ta-g-i')}
${asEditor('g_hide', "perform public.m1_set_state(x.issue,x.irev,'HIDDEN','ta-g-hide') from x where x.name='G'")}
${adopt('g_hidden', 'G', 3, 'ta-g-j')}
set local role anon;
do $$ begin perform public.m1_adopt_ai_version(gen_random_uuid(),1,0,'ta-anon'); raise notice 'R|g_anon|PASSED'; exception when others then raise notice 'R|g_anon|%', sqlerrm; end $$;
reset role;
select 'R|g_audit_none|'||(select count(*) from private.ai_adoptions where effect_key like 'ta-g-%');

-- H: adopted but never republished; the correction window closes, the retention job clears the issue.
${ingest('h1', H, 1)}
${publishStatus('h_publish', 'H', 'ta-h-1')}
${ingest('h2', H, 2)}
${adopt('h_adopt', 'H', 2, 'ta-h-adopt')}
${ageWindow('H')}
select 'R|h_timeout|'||(private.correction_timeout_tick()->>'status');
select 'R|h_cleanup|'||coalesce(private.ai_inbox_cleanup()->>'closed_cleared','null');
${state('h_state', 'H')}
select 'R|h_draft|'||exists(select 1 from private.editor_drafts where issue_id=(select issue from x where name='H'));
-- A version arriving after the issue closed waits beside it and is not removed by the closed-issue cleanup.
${ingest('h3', H, 3)}
select 'R|h_cleanup_again|'||coalesce(private.ai_inbox_cleanup()->>'closed_cleared','null');
${state('h_after_v3', 'H')}

-- J: v2 adopted, v3 adopted, one publication: only the latest adoption is marked published.
${ingest('j1', J, 1)}
${publishStatus('j_publish', 'J', 'ta-j-1')}
${ingest('j2', J, 2)}
${adopt('j_adopt2', 'J', 2, 'ta-j-a2')}
${ingest('j3', J, 3)}
${adopt('j_adopt3', 'J', 3, 'ta-j-a3')}
${publishStatus('j_republish', 'J', 'ta-j-2')}
select 'R|j_marks|'||string_agg(a.ai_version||':'||(a.published_at is not null),',' order by a.ai_version) from private.ai_adoptions a where a.issue_id=(select issue from x where name='J');
-- E (republished after adoption) expires later: the analysis draft stays (it was published), the evidence goes.
update private.claims set valid_until=now()-interval '1 second' where issue_id=(select issue from x where name='E');
select 'R|e_cleanup|'||coalesce(private.ai_inbox_cleanup()->>'published_expired','null');
${state('e_expired', 'E')}
select 'R|e_draft|'||exists(select 1 from private.editor_drafts where issue_id=(select issue from x where name='E'));

-- Privileges.
select 'R|acl|'||bool_or(has_function_privilege(r,f,'EXECUTE'))||','||bool_or(has_table_privilege(r,'private.ai_adoptions','SELECT'))
  from unnest(array['anon','authenticated','service_role']) r, unnest(array['private.ai_apply_version(uuid,text,integer,jsonb,bigint,timestamptz,timestamptz)',
  'private.ai_adoptable(uuid)','private.ai_close_real_issue(uuid,text)','private.ai_inbox_cleanup()','private.ai_inbox_cleanup_v2()']) f;
select 'R|acl_adopt|'||has_function_privilege('anon','public.m1_adopt_ai_version(uuid,integer,bigint,text)','EXECUTE')||','||has_function_privilege('authenticated','public.m1_adopt_ai_version(uuid,integer,bigint,text)','EXECUTE');
rollback;`;

const out = run(sql);
const lines = (out.stdout + out.stderr).split(/\r?\n/).map(line => line.replace(/^(psql:[^:]*:\d+: )?NOTICE:\s*/, '')).filter(line => line.startsWith('R|')).map(line => line.split('|').slice(1));
if (process.env.T1C_DEBUG) console.log(lines.map(l => l.join('|')).join('\n'));
const value = key => lines.filter(([k]) => k === key).map(([, ...v]) => v.join('|'));
const n = String(facts.length);
const expect = {
  e1: 'RECEIVED', e_publish: 'APPLIED', e2: 'HOLD_EDITOR', e_adoptable: 'true', e_adopt: 'ADOPTED',
  // Until republished the old public version still cites v1 evidence (gone), which is why it stays hidden.
  e_after: `CORRECTION_PENDING,${n},2,2,ACTIVE/2,f`, e_consistent: `t,f,t,${n}`, e_hidden: 'false,CORRECTION_PENDING', e_reason: 'AI_VERSION_ADOPTED',
  e_origin_kept: 'true', e_replay: 'ADOPTED', e_key_conflict: 'EFFECT_PAYLOAD_CONFLICT', e_old_replay: 'ALREADY_APPLIED', e_published_before: 'false',
  e_republish: 'APPLIED', e_published_after: 'true', e_consistent_published: `t,t,t,${n}`, e_visible: 'true,PUBLISHED',
  f1: 'RECEIVED', f_publish: 'APPLIED', f_withdraw: 'CORRECTION_PENDING', f2: 'HOLD_EDITOR', f_adopt: 'ADOPTED', f_cause: 'null', f_republish: 'APPLIED', f_visible: 'true,PUBLISHED',
  g1: 'RECEIVED', g_publish: 'APPLIED', g2: 'HOLD_EDITOR', g3: 'HOLD_EDITOR', g_old_version: 'AI_VERSION_NOT_ADOPTABLE', g_adoptable_no_draft: 'false', g_no_draft: 'AI_VERSION_EXPIRED',
  g_expired: 'AI_VERSION_EXPIRED', g_fact_stale: 'AI_VERSION_EXPIRED', g_revision: 'REVISION_CONFLICT', g_drift: 'CATALOG_DRIFT', g_real_off: 'REAL_MODE_OFF',
  g_synthetic: 'REAL_ISSUE_REQUIRED', g_to_pending: 'PASSED', g_adoptable_window: 'false', g_window: 'AI_CORRECTION_WINDOW_CLOSED', g_hide: 'PASSED', g_hidden: 'AI_ISSUE_CLOSED',
  g_audit_none: '0', h1: 'RECEIVED', h_publish: 'APPLIED', h2: 'HOLD_EDITOR', h_adopt: 'ADOPTED', h_timeout: 'OK', h_state: 'WITHDRAWN,0,-,WITHDRAWN/2,f', h_draft: 'false', h3: 'HOLD_EDITOR', h_after_v3: 'WITHDRAWN,0,3,HOLD_EDITOR/3,f',
  j1: 'RECEIVED', j_publish: 'APPLIED', j2: 'HOLD_EDITOR', j_adopt2: 'ADOPTED', j3: 'HOLD_EDITOR', j_adopt3: 'ADOPTED', j_republish: 'APPLIED', j_marks: '2:false,3:true',
  e_cleanup: '1', e_expired: 'WITHDRAWN,0,-,WITHDRAWN/2,f', e_draft: 'true', acl: 'false,false', acl_adopt: 'false,true',
};
for (const [k, v] of Object.entries(expect)) assert.deepEqual(value(k), [v], k);
assert.deepEqual(value('e_save_stale'), ['REVISION_CONFLICT']);
// Ten public reads: hidden everywhere between adoption and republication; back exactly where they were before.
const map = key => { const [row] = value(key); assert.ok(row, key); return Object.fromEntries(row.split(',').map(x => x.split('='))); };
for (const role of ['anon', 'authenticated']) {
  const before = map('reads_e_pub_' + role), adopted = map('reads_e_adopted_' + role), after = map('reads_e_repub_' + role);
  assert.equal(Object.keys(before).length, 10);
  assert.ok(Object.values(before).filter(v => v === 'true').length >= 9, role + ' control: ' + JSON.stringify(before));
  assert.deepEqual(Object.entries(adopted).filter(([, v]) => v === 'true'), [], role + ' visible between adoption and republication');
  assert.deepEqual(after, before, role + ' republished visibility');
}
assert.match(value('g_anon')[0] ?? '', /permission denied|EDITOR_ONLY/);
assert.ok(Number(value('h_cleanup')[0]) >= 1, 'closed issue cleared');

// Two connections: an adoption in flight holds the AI-issue lock, so intake and withdrawal of the same AI issue wait.
const first = spawn(docker, psql, { windowsHide: true });
let firstOut = '';first.stdout.on('data', b => { firstOut += b; });first.stderr.on('data', b => { firstOut += b; });
const closed = new Promise(resolve => first.on('close', resolve));
const lockKey = q('ai-issue:' + K), releaseKey = q('ai-test-release:' + K);
const held = key => `exists(select 1 from pg_locks where locktype='advisory' and granted and pid<>pg_backend_pid() and objid::bigint=(hashtext(${key})::bigint & 4294967295))`;
const waitFor = (cond, label) => `t0:=clock_timestamp();while not (${cond}) loop if clock_timestamp()-t0>interval '120 seconds' then raise exception 'R_TIMEOUT_${label}';end if;perform pg_sleep(0.05);end loop;`;
const firstSql = sql.split('\n-- E: published v1')[0] + `
${ingest('k1', K, 1)}
${publishStatus('k_publish', 'K', 'ta-k-1')}
${ingest('k2', K, 2)}
${adopt('k_adopt', 'K', 2, 'ta-k-adopt')}
do $$ declare t0 timestamptz; begin ${waitFor(held(releaseKey), 'RELEASE')} end $$;
rollback;`;
await new Promise(resolve => first.stdin.end(firstSql, resolve));
const second = run(`do $$ declare t0 timestamptz;
begin
  ${waitFor(held(lockKey), 'LOCK')}
  set local lock_timeout='1s';
  begin perform private.ai_ingest_draft(${q(`ai:${K}:3`)},${q(JSON.stringify(payload(K, 3)))}::jsonb); raise notice 'R|race_intake|PASSED';
  exception when lock_not_available then raise notice 'R|race_intake|BLOCKED'; when others then raise notice 'R|race_intake|%',sqlerrm; end;
  begin perform private.ai_withdraw_draft(${q(K)},2,'SOURCE_REVOKED'); raise notice 'R|race_withdraw|PASSED';
  exception when lock_not_available then raise notice 'R|race_withdraw|BLOCKED'; when others then raise notice 'R|race_withdraw|%',sqlerrm; end;
  set local lock_timeout=0;
  perform pg_advisory_xact_lock(hashtext(${releaseKey}));
  ${waitFor('not ' + held(lockKey), 'FIRST_DONE')}
end $$;`);
await closed;
assert.match(firstOut, /R\|k_adopt\|ADOPTED/);
assert.match(second.stdout + second.stderr, /R\|race_intake\|BLOCKED/);
assert.match(second.stdout + second.stderr, /R\|race_withdraw\|BLOCKED/);
console.log(JSON.stringify({ status: 'PASS', phase: 'AI_ADOPTION_1C_62', migrationApplied: applied62, rolledBack: true, checks: lines.length + 3 }));
