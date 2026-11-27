// One-time generator for supabase/migrations/20261127000059_real_public_read.sql (publish stage 1B, B1-B4, B7 DB parts).
// The public read paths and the real publisher are derived from the live local definitions with exact, asserted text
// substitutions, so every rule except the kind conditions stays identical. Usage:
//   node scripts/tools/gen-migration-59.mjs <dir with the dumped *.sql definitions>
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const dir = process.argv[2];
if (!dir) throw new Error('dump directory required');
// Inputs are the recorded pre-59 dumps (scripts/tools/dumps-59/MANIFEST.json): a changed dump is refused, so the
// migration stays reproducible from exactly what was reviewed.
const manifest = JSON.parse(readFileSync(path.join(dir, 'MANIFEST.json'), 'utf8'));
const read = name => {
  const raw = readFileSync(path.join(dir, name + '.sql'));
  if (createHash('sha256').update(raw).digest('hex') !== manifest.files[name + '.sql']) throw new Error('dump does not match MANIFEST: ' + name);
  return raw.toString('utf8').replace(/\r/g, '').trim();
};
function sub(text, from, to, count = 1) {
  const n = text.split(from).length - 1;
  if (n !== count) throw new Error(`expected ${count} occurrence(s) of ${JSON.stringify(from.slice(0, 80))}, found ${n}`);
  return text.split(from).join(to);
}
const end = text => text.replace(/\$function\$$/, '$function$;');
const KIND = 'private.public_read_kind()';

// B2. Current evidence: the public kind, and real COMPANY articles may have zero impacts (evidence rules unchanged).
let ev3 = read('evidence_v3');
ev3 = sub(ev3, "i.sample_kind='SYNTHETIC'", `i.sample_kind=${KIND}`);
ev3 = sub(ev3, " and exists(select 1 from private.impacts z where z.version_id=v.id)\n",
  ` and (exists(select 1 from private.impacts z where z.version_id=v.id) or i.sample_kind='PERMITTED_REAL' and v.public_body->>'article_kind'='COMPANY')\n`);
let ev = sub(read('evidence'), "sample_kind='SYNTHETIC'", `sample_kind=${KIND}`);
let visible = sub(read('visible'), "i.sample_kind='SYNTHETIC'", `i.sample_kind=${KIND}`);
let legacy = sub(read('legacy'), "sample_kind='SYNTHETIC'", `sample_kind=${KIND}`);
let resolve = sub(read('resolve'), "i.sample_kind<>'SYNTHETIC'", `i.sample_kind<>${KIND}`);
// Search: the public kind, and company articles appear only on company pages.
let search = sub(read('search'), "n.sample_kind='SYNTHETIC' and i.sample_kind='SYNTHETIC'", `n.sample_kind=${KIND} and i.sample_kind=${KIND}`);
search = sub(search, " and v.public_body->>'_contract'='M1'\n", " and v.public_body->>'_contract'='M1' and v.public_body->>'article_kind' is distinct from 'COMPANY'\n");
let saved = sub(read('saved'), "i.sample_kind='SYNTHETIC'", `i.sample_kind=${KIND}`);
saved = sub(saved, "n.sample_kind='SYNTHETIC'", `n.sample_kind=${KIND}`);
let articles = sub(read('articles'), "where n.publication_state='PUBLISHED' and private.m1_current_evidence(n.issue_id)\n",
  "where n.publication_state='PUBLISHED' and private.m1_current_evidence(n.issue_id) and v.public_body->>'article_kind' is distinct from 'COMPANY'\n");
// Article-kind conditions must be gone from every rewritten read (sector catalogue checks are not article kinds).
for (const [name, text] of Object.entries({ ev3, ev, visible, legacy, resolve, search, saved, articles })) {
  if (/sample_kind\s*(=|<>)\s*'SYNTHETIC'/.test(text)) throw new Error('article-kind condition left in ' + name);
}

// B3. Real publisher: the legacy publisher with the kind rule inverted, the event kind from the issue, local only.
let pub = sub(read('publish_legacy'), 'FUNCTION private.m0_publish_legacy(', 'FUNCTION private.m0_publish_real(');
pub = sub(pub, "if i.sample_kind<>'SYNTHETIC' then raise exception 'REAL_PUBLICATION_NOT_ENABLED_STAGE_4';end if;",
  `if i.sample_kind<>'PERMITTED_REAL' or ${KIND}<>'PERMITTED_REAL' then raise exception 'REAL_PUBLIC_READ_OFF';end if;`);
pub = sub(pub, "raise exception 'SYNTHETIC_PUBLICATION_FORBIDDEN'", "raise exception 'REAL_PUBLICATION_LOCAL_ONLY'");
pub = sub(pub, "coalesce(p_body->>'source_market','SYNTHETIC')", "p_body->>'source_market'");
// Legacy sector-id impacts are replaced by the core right after the call; real bodies are M1 and keep the path ids.
pub = sub(pub, "'BENEFIT','SYNTHETIC',", "'BENEFIT','LEGACY',");
pub = sub(pub, "'DAMAGE','SYNTHETIC',", "'DAMAGE','LEGACY',");
pub = sub(pub, "'RELATED','SYNTHETIC',", "'RELATED','LEGACY',");
pub = sub(pub, "'sample_kind','SYNTHETIC','request_hash'", "'sample_kind',i.sample_kind,'request_hash'");
if (/SYNTHETIC/.test(pub)) throw new Error('synthetic text left in real publisher');
let coreReal = sub(read('core_v1'), 'FUNCTION private.reservation_publish_core_v1(', 'FUNCTION private.reservation_publish_core_real(');
coreReal = sub(coreReal, 'private.m0_publish_legacy(', 'private.m0_publish_real(');

// Editor state change and correction timeout: events carry the issue's own kind.
let setState = sub(read('set_state'), "'sample_kind','SYNTHETIC','editor_request_hash'", "'sample_kind',(select sample_kind from private.issues where id=p_issue),'editor_request_hash'");
let timeout = sub(read('timeout'), "'sample_kind','SYNTHETIC','reason'", "'sample_kind',i.sample_kind,'reason'");

// B7. Draft detail: whether this real draft may be published now.
let draft = sub(read('get_draft'), "'company_labels',companies);",
  `'company_labels',companies,'real_publish_allowed',k='PERMITTED_REAL' and ${KIND}='PERMITTED_REAL'\n   and exists(select 1 from private.ai_issue_links l where l.issue_id=p_issue and l.state='ACTIVE'));`);

const generated = [ev3, ev, visible, legacy, resolve, search, saved, articles].map(end).join('\n\n');
const publisher = [pub, coreReal, setState, timeout].map(end).join('\n\n');
const head = readFileSync(new URL('./migration-59-head.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const tail = readFileSync(new URL('./migration-59-tail.sql', import.meta.url), 'utf8').replace(/\r/g, '');
const sql = `${head}\n-- B2. Public read paths (generated from the live definitions by scripts/tools/gen-migration-59.mjs).\n${generated}\n\n` +
  `-- B3. Real publisher and kind-carrying events (generated).\n${publisher}\n\n-- B7. Draft detail (generated).\n${end(draft)}\n\n${tail}`;
// Migration 59 is applied and immutable: check before writing, so a changed generator never touches the file.
if (createHash('sha256').update(sql).digest('hex') !== manifest.migrationSha256) throw new Error('generated migration differs from the recorded one');
writeFileSync(new URL('../../supabase/migrations/20261127000059_real_public_read.sql', import.meta.url), sql);
console.log(JSON.stringify({ written: 'supabase/migrations/20261127000059_real_public_read.sql', bytes: Buffer.byteLength(sql) }));
