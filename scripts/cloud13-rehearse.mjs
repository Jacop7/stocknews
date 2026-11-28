// CLOUD13 rehearsal (publish stage 2A S1/S9): a scratch database that equals the observed cloud state, then the bundle.
//   1. local migrations up to 55 (the state CLOUD12A brought the cloud to), on a scratch database;
//   2. made equal to the cloud: the observed cloud definitions of every function that differs (cloud-defs.json), the
//      observed ACLs of functions, relations and schemas, identity rows and the migration list;
//   3. its inventory must equal the observed cloud inventory (cloud-observed.json) exactly;
//   4. --capture: apply the bundle without the inventory post-check and write the resulting inventory into
//      prestate.json `after`; default: apply the final rendered apply.sql (its own post-check must pass), then the
//      intake bundle (intake.sql) and the admin grant (adopt-grant.sql), and the real-mode switch check (real-mode-on.sql).
//   Usage: node scripts/cloud13-rehearse.mjs [--capture]
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createScratch, dropScratch, psql, ok } from './lib/scratch-db.mjs';
import { render, loadState, INVENTORY } from './cloud13-render.mjs';
import { QUERY } from './tools/cloud13-inventory-query.mjs';

const root = new URL('../', import.meta.url);
const dir = 'supabase/cloud/real-intake-dev/';
const read = name => JSON.parse(readFileSync(new URL(dir + name, root), 'utf8'));
const q = v => "'" + String(v).replaceAll("'", "''") + "'";
const DB = 'cloud13_rehearsal';
const capture = process.argv.includes('--capture');
const observed = read('cloud-observed.json'), defs = read('cloud-defs.json');
const KEYS = ['functions', 'columns', 'relations', 'constraints', 'triggers', 'policies'];

export function diff(a, b) {
  const out = {};
  for (const k of KEYS) {
    const changed = [...new Set([...Object.keys(a[k] ?? {}), ...Object.keys(b[k] ?? {})])].filter(x => JSON.stringify(a[k]?.[x]) !== JSON.stringify(b[k]?.[x]));
    if (changed.length) out[k] = changed;
  }
  return out;
}
const inventory = () => JSON.parse(ok(psql('postgres', DB, QUERY)).trim());
// The same digests the bundle computes: MD5 of each inventory section's jsonb text.
const digests = () => JSON.parse(ok(psql('postgres', DB, `select (select jsonb_object_agg(k, md5((v->k)::text)) from (select ${INVENTORY} v) x, unnest(array[${KEYS.map(q).join(',')}]) k)::text;`)).trim());

function mimic() {
  // Cloud-only schemas, tables and their rows come first (definitions may refer to them), then functions.
  ok(psql('supabase_admin', DB, defs.preamble ?? ''));
  for (const sig of defs.drop ?? []) ok(psql('supabase_admin', DB, `drop function ${sig};`));
  for (const [sig, def] of Object.entries(defs.functions ?? {})) {
    const r = psql('postgres', DB, def + ';');
    assert.equal(r.status, 0, sig + ': ' + r.stderr);
  }
  // ACLs exactly as observed (superuser catalog update on the scratch database only).
  const acl = [];
  for (const [sig, [, a]] of Object.entries(observed.functions)) acl.push(`update pg_proc set proacl=${a === 'DEFAULT' ? 'null' : q(a) + '::aclitem[]'} where oid=(select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')'=${q(sig)});`);
  for (const [rel, v] of Object.entries(observed.relations)) { const a = v.split('|').slice(2).join('|'); acl.push(`update pg_class set relacl=${a === 'DEFAULT' ? 'null' : q(a) + '::aclitem[]'} where oid=${q(rel)}::regclass;`); }
  for (const s of observed.schemas) { const [name, a] = [s.slice(0, s.indexOf('|')), s.slice(s.indexOf('|') + 1)]; if (name !== 'cron') acl.push(`update pg_namespace set nspacl=${a === '' ? 'null' : q(a) + '::aclitem[]'} where nspname=${q(name)};`); }
  acl.push('delete from supabase_migrations.schema_migrations;');
  for (const v of observed.migrations) acl.push(`insert into supabase_migrations.schema_migrations(version,name,statements) values (${q(v)},'cloud',array[]::text[]);`);
  ok(psql('supabase_admin', DB, acl.join('\n')));
}

function build() {
  createScratch(DB, '20261127000055');
  mimic();
  const got = inventory();
  const d = diff(got, observed);
  if (Object.keys(d).length) { console.log(JSON.stringify(d, null, 1).slice(0, 4000)); throw new Error('REHEARSAL_NOT_EQUAL_TO_CLOUD'); }
  assert.deepEqual(got.runtime_identity, observed.runtime_identity, 'runtime identity');
  assert.deepEqual(got.control_identity, observed.control_identity, 'control identity');
  console.log('PASS rehearsal equals the observed cloud inventory');
}

try {
  build();
  if (capture) {
    const beforeDigest = digests();
    const state = { ...loadState(), beforeDigest, afterDigest: {}, realModeAfter: null };
    ok(psql('postgres', DB, render(state)));
    const got = inventory();
    const next = loadState();
    next.after = Object.fromEntries(KEYS.map(k => [k, got[k]]));
    next.beforeDigest = beforeDigest;
    next.afterDigest = digests();
    next.realModeAfter = JSON.parse(ok(psql('postgres', DB, "select (to_jsonb(r)-'changed_at')::text from private.real_mode r;")).trim());
    writeFileSync(new URL(dir + 'prestate.json', root), JSON.stringify(next, null, 1) + '\n');
    console.log('CAPTURED after-inventory: ' + KEYS.map(k => k + '=' + Object.keys(got[k]).length).join(' '));
  } else {
    const sql = readFileSync(new URL(dir + 'apply.sql', root), 'utf8');
    assert.equal(sql, render(), 'apply.sql must be the current render');
    ok(psql('postgres', DB, sql));
    console.log('PASS apply.sql with its post-check');
    assert.match(psql('postgres', DB, sql).stderr, /CLOUD13_MIGRATIONS/);
    console.log('PASS a second run is refused');
    // The real-mode switch probes the publish dispatcher with one existing issue; the cloud has synthetic issues, the
    // scratch database none, so one bare synthetic draft issue is added here.
    ok(psql('postgres', DB, `with s as (insert into private.stories(event_key) values ('cloud13-rehearsal-probe') returning id)
      insert into private.issues(story_id,angle_key,sample_kind) select id,'probe','SYNTHETIC' from s;`));
    for (const name of ['real-mode-on.sql', 'intake.sql']) {
      if (!existsSync(new URL(dir + name, root))) { console.log('SKIP ' + name); continue; }
      ok(psql('postgres', DB, readFileSync(new URL(dir + name, root), 'utf8')));
      console.log('PASS ' + name);
    }
    const adopt = new URL('supabase/cloud/admin-online-dev/adopt-grant.sql', root);
    if (existsSync(adopt)) { ok(psql('postgres', DB, readFileSync(adopt, 'utf8'))); console.log('PASS adopt-grant.sql'); }
  }
} finally {
  if (!process.argv.includes('--keep')) { dropScratch(DB); psql('supabase_admin', 'postgres', 'drop role if exists judoju_ai_intake;'); }
}
