// One-time generator for supabase/migrations/20261127000056_real_mode_review.sql (publish stage 1A, A1+A2+A5 DB parts).
// The real-data validator chain is derived from the live local definitions of the M1 chain with exact, asserted text
// substitutions, so every rule except the synthetic-only conditions stays identical. Usage:
//   node scripts/tools/gen-migration-56.mjs <dir with m1_prepare*.sql, selectable.sql dumps>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const dir = process.argv[2];
if (!dir) throw new Error('dump directory required');
const read = name => readFileSync(path.join(dir, name + '.sql'), 'utf8').replace(/\r/g, '').trim();
function sub(text, from, to, count = 1) {
  const n = text.split(from).length - 1;
  if (n !== count) throw new Error(`expected ${count} occurrence(s) of ${JSON.stringify(from.slice(0, 80))}, found ${n}`);
  return text.split(from).join(to);
}
const rename = (text, from, to) => sub(text, `FUNCTION private.${from}(`, `FUNCTION private.${to}(`);

// v1: base rules. Only the synthetic-only conditions change.
let v1 = rename(read('m1_prepare_v1'), 'm1_prepare_v1', 'm1_prepare_real_v1');
v1 = sub(v1, "b ? 'sample_kind' and b->>'sample_kind'<>'SYNTHETIC' then raise exception 'RESERVATION_OR_REAL_MODE_NOT_ENABLED'",
  "b ? 'sample_kind' and b->>'sample_kind'<>'PERMITTED_REAL' then raise exception 'RESERVATION_OR_REAL_MODE_NOT_ENABLED'");
v1 = sub(v1, "if not exists(select 1 from private.issues where id=p_issue and sample_kind='SYNTHETIC') then raise exception 'SYNTHETIC_ISSUE_REQUIRED';end if;",
  "if not private.real_mode_on() then raise exception 'REAL_MODE_OFF';end if;\n  if not exists(select 1 from private.issues where id=p_issue and sample_kind='PERMITTED_REAL') then raise exception 'REAL_ISSUE_REQUIRED';end if;");
v1 = sub(v1, "if coalesce(b->>'article_kind','') not in ('SECTOR','MACRO') or coalesce(b->>'source_market','') not in ('KR','US','GLOBAL','SYNTHETIC')",
  "if coalesce(b->>'article_kind','') not in ('SECTOR','MACRO','COMPANY') or coalesce(b->>'source_market','') not in ('KR','US','GLOBAL')");
v1 = sub(v1, "private.catalog_sector_selectable(sector,p_catalog,'SYNTHETIC')", "private.catalog_sector_selectable(sector,p_catalog,'PERMITTED_REAL')", 2);
v1 = sub(v1, "coalesce(x->>'url','')!~'^https://[a-z0-9.-]+\\.invalid(/[^[:space:]]*)?$' or length(x->>'url')>2048 then raise exception 'SYNTHETIC_SOURCE_REQUIRED'",
  "not private.real_source_url_ok(x->>'url') then raise exception 'REAL_SOURCE_NOT_ALLOWED'");
// COMPANY: zero impacts allowed; with impacts a primary sector is still required (checked below).
v1 = sub(v1, "jsonb_array_length(b->'impacts') not between 1 and 30 then raise exception 'KR_IMPACT_PATH_REQUIRED'",
  "jsonb_array_length(b->'impacts') not between (case when b->>'article_kind'='COMPANY' then 0 else 1 end) and 30 then raise exception 'KR_IMPACT_PATH_REQUIRED'");
v1 = sub(v1, "if b->>'article_kind'='SECTOR' and sector is null then raise exception 'PRIMARY_SECTOR_REQUIRED';end if;",
  "if (b->>'article_kind'='SECTOR' or b->>'article_kind'='COMPANY' and jsonb_typeof(b->'impacts')='array' and jsonb_array_length(b->'impacts')>0) and sector is null then raise exception 'PRIMARY_SECTOR_REQUIRED';end if;");
v1 = sub(v1, "and fact_current and sample_kind='SYNTHETIC' and claim_type<>'SENSITIVE_UNCONFIRMED'", "and fact_current and sample_kind='PERMITTED_REAL' and claim_type<>'SENSITIVE_UNCONFIRMED'");
if (/SYNTHETIC|\.invalid/.test(v1)) throw new Error('synthetic condition left in real v1');

const v2 = sub(rename(read('m1_prepare_v2'), 'm1_prepare_v2', 'm1_prepare_real_v2'), 'private.m1_prepare_v1(', 'private.m1_prepare_real_v1(');
const v3 = sub(rename(read('m1_prepare_v3'), 'm1_prepare_v3', 'm1_prepare_real_v3'), 'private.m1_prepare_v2(', 'private.m1_prepare_real_v2(');
let v4 = sub(rename(read('m1_prepare_v4'), 'm1_prepare_v4', 'm1_prepare_real_v4'), 'private.m1_prepare_v3(', 'private.m1_prepare_real_v3(');
// A COMPANY issue with a primary sector must carry a path in that sector, exactly as SECTOR does.
v4 = sub(v4, "if b->>'article_kind'='SECTOR' and not exists", "if (b->>'article_kind'='SECTOR' or b->>'article_kind'='COMPANY' and b->>'primary_sector_id' is not null) and not exists");
const v5 = sub(rename(read('m1_prepare_v5'), 'm1_prepare_v5', 'm1_prepare_real_v5'), 'private.m1_prepare_v4(', 'private.m1_prepare_real_v4(');
let v7 = sub(rename(read('m1_prepare_v7'), 'm1_prepare_v7', 'm1_prepare_real_v7'), 'private.m1_prepare_v5(', 'private.m1_prepare_real_v5(', 2);
// Real COMPANY issues keep their scope through the whole chain (zero impacts allowed in v1).
v7 = sub(v7, `b:=private.m1_prepare_real_v5(p_issue,jsonb_set(p_input,'{article_kind}','"SECTOR"'),p_policy,p_catalog)||jsonb_build_object('article_kind','COMPANY');`,
  "b:=private.m1_prepare_real_v5(p_issue,p_input,p_policy,p_catalog);");
v7 = sub(v7, '  -- A company issue passes every SECTOR rule (primary sector, impact paths, evidence), then keeps its scope.\n', '');
let top = sub(rename(read('m1_prepare'), 'm1_prepare', 'm1_prepare_real'), 'private.m1_prepare_v7(', 'private.m1_prepare_real_v7(');
top = sub(top, " b:=private.m1_prepare_real_v7(p_issue,p_input,p_policy,p_catalog);",
  " b:=private.m1_prepare_real_v7(p_issue,p_input,p_policy,p_catalog);\n -- Real MACRO articles: every fact must be an official original (independent-source edges come in 1B).\n if b->>'article_kind'='MACRO' and exists(select 1 from private.claims c where c.issue_id=p_issue and not c.official_original) then raise exception 'REAL_MACRO_REQUIRES_OFFICIAL';end if;");
const chain = [v1, v2, v3, v4, v5, v7, top].map(f => f.replace(/\$function\$$/, '$function$;')).join('\n\n');

let selectable = read('selectable');
selectable = sub(selectable, " select p_article_mode='SYNTHETIC'\n", " select (p_article_mode='SYNTHETIC' or p_article_mode='PERMITTED_REAL' and private.real_mode_on())\n");
selectable = sub(selectable, " or (c.usage_scope='LEGACY_FIXTURE' and m.metadata_kind='SYNTHETIC_FIXTURE'", " or (p_article_mode='SYNTHETIC' and c.usage_scope='LEGACY_FIXTURE' and m.metadata_kind='SYNTHETIC_FIXTURE'");
selectable = selectable.replace(/\$function\$$/, '$function$;');

const fence = readFileSync(new URL('./migration-56-fence.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const head = readFileSync(new URL('./migration-56-head.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const sql = `${head}\n-- Real-data validator chain (generated from the live M1 chain by scripts/tools/gen-migration-56.mjs).\n${chain}\n\n-- Reference-catalog sectors are selectable for real issues while real mode is on; fixture sectors stay synthetic-only.\n${selectable}\n\n${fence}`;
writeFileSync(new URL('../../supabase/migrations/20261127000056_real_mode_review.sql', import.meta.url), sql);
console.log(JSON.stringify({ written: 'supabase/migrations/20261127000056_real_mode_review.sql', bytes: Buffer.byteLength(sql) }));
