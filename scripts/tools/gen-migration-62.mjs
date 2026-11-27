// One-time generator for supabase/migrations/20261127000062_ai_version_adoption.sql (publish stage 1C, C1-C2).
// The common apply function is the intake block of the live private.ai_ingest_draft, moved verbatim (local aliases keep
// the text identical) with asserted changes only: evidence-record times come from arguments and the AI draft is kept.
// Inputs are the recorded pre-62 dumps (scripts/tools/dumps-62/MANIFEST.json). Usage:
//   node scripts/tools/gen-migration-62.mjs scripts/tools/dumps-62
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dir = process.argv[2];
if (!dir) throw new Error('dump directory required');
const sha = x => createHash('sha256').update(x).digest('hex');
const manifestFile = path.join(dir, 'MANIFEST.json');
if (!existsSync(manifestFile)) throw new Error('MANIFEST.json required');
const manifest = JSON.parse(readFileSync(manifestFile, 'utf8'));
const read = name => {
  const raw = readFileSync(path.join(dir, name + '.sql'));
  if (sha(raw) !== manifest.files[name + '.sql']) throw new Error('dump does not match MANIFEST: ' + name);
  return raw.toString('utf8').replace(/\r/g, '').trim();
};
function sub(text, from, to, count = 1) {
  const n = text.split(from).length - 1;
  if (n !== count) throw new Error(`expected ${count} occurrence(s) of ${JSON.stringify(from.slice(0, 80))}, found ${n}`);
  return text.split(from).join(to);
}

const ingest = read('ingest');
const START = "      -- Claims are replaced as a whole: the evidence rule checks every claim of the issue.\n";
const END = "      result:=jsonb_build_object('state','RECEIVED'";
const a = ingest.indexOf(START), b = ingest.indexOf(END);
if (a < 0 || b < 0 || b < a || ingest.indexOf(START, a + 1) >= 0 || ingest.indexOf(END, b + 1) >= 0) throw new Error('intake block markers');
const block = ingest.slice(a, b);

// The helper body: the block with its evidence-record insert taking the given times and keeping the AI draft.
let body = sub(block, "      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at)\n        values(iss,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days');\n",
  "      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,received_at,expires_at,draft)\n        values(iss,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',p_received_at,p_expires_at,d);\n");
const helper = `-- C2. Common apply (owner only; called by private.ai_ingest_draft and public.m1_adopt_ai_version, which hold the AI-issue
-- advisory lock, the link row, the issue row and the draft row). The intake block moved verbatim (generated).
create function private.ai_apply_version(p_issue uuid,p_ai text,p_version integer,p_payload jsonb,p_catalog bigint,p_received_at timestamptz,p_expires_at timestamptz)
returns void language plpgsql set search_path='' as $$
declare iss uuid:=p_issue;ai text:=p_ai;ver integer:=p_version;head bigint:=p_catalog;d jsonb:=p_payload->'draft';
  x jsonb;map jsonb:='{}';cid uuid;v_content jsonb;items jsonb;
begin
  if not exists(select 1 from private.issues where id=iss and sample_kind='PERMITTED_REAL') then raise exception 'REAL_ISSUE_REQUIRED';end if;
  if p_received_at is null or p_expires_at is null or p_expires_at<=p_received_at then raise exception 'AI_ORIGIN_TIMES_INVALID';end if;
${body.replace(/\n$/, '')}
end$$;
revoke all on function private.ai_apply_version(uuid,text,integer,jsonb,bigint,timestamptz,timestamptz) from public, anon, authenticated, service_role;`;

// Intake: the block becomes one call with intake times; held versions keep their AI draft too.
let intake = ingest.slice(0, a) + "      perform private.ai_apply_version(iss,ai,ver,p_payload,head,now(),now()+interval '30 days');\n" + ingest.slice(b);
intake = sub(intake, "      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at)\n        values(lnk.issue_id,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days');\n",
  "      insert into private.ai_draft_origin(issue_id,ai_version,facts,sources,catalog_version,catalog_ref,expires_at,draft)\n        values(lnk.issue_id,ver,p_payload->'facts',d->'sources',head,p_payload->'catalog_ref',now()+interval '30 days',d);\n");
// A non-draft issue (published, being corrected, closed) is never overwritten by intake: a new version waits beside it,
// also when a closed issue's unpublished adopted draft was cleared (no editor draft left).
intake = sub(intake, "    elsif lnk.issue_id is not null and ed.issue_id is not null and (i.manual_protected or ed.updated_by is not null) then\n",
  "    elsif lnk.issue_id is not null and (ed.issue_id is not null and (i.manual_protected or ed.updated_by is not null) or i.publication_state<>'DRAFT') then\n");
intake = intake.replace(/\$function\$$/, '$function$;');

// C5. The draft detail says whether the newest held version can be adopted now.
let draft = sub(read('get_draft'), "   'link_state',(select l.state from private.ai_issue_links l where l.issue_id=p_issue),\n",
  "   'link_state',(select l.state from private.ai_issue_links l where l.issue_id=p_issue),\n   'adoptable',private.ai_adoptable(p_issue),\n");
draft = draft.replace(/\$function\$$/, '$function$;');

const head = readFileSync(new URL('./migration-62-head.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const tail = readFileSync(new URL('./migration-62-tail.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const sql = `${head}\n${helper}\n\n-- Intake calls the common apply (generated from the live definition).\n${intake}\n\n${tail}\n-- Draft detail with the adoptable flag (generated).\n${draft}\ncommit;\n`;
const target = new URL('../../supabase/migrations/20261127000062_ai_version_adoption.sql', import.meta.url);
if (sha(sql) !== manifest.migrationSha256) throw new Error('generated migration differs from the recorded one');
writeFileSync(target, sql);
console.log(JSON.stringify({ written: 'supabase/migrations/20261127000062_ai_version_adoption.sql', bytes: Buffer.byteLength(sql), sha256: sha(sql) }));
