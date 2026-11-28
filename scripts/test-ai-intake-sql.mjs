// Publish stage 2A S3/S9: supabase/cloud/real-intake-dev/intake.sql on a scratch database of the local Supabase cluster,
// with a real login as the intake role. Scratch database = local migrations up to the newest (auth schema copied, pg_cron
// stubbed), the intake bundle without its cloud environment guard, then a temporary password. Afterwards the scratch
// database and the role are dropped, so the local `postgres` database and cluster roles end as they began.
//   Usage: node scripts/test-ai-intake-sql.mjs
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';

const root = new URL('../', import.meta.url);
const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
const DB = 'ai_intake_test';
const exec = (args, input, env = []) => spawnSync(docker, ['exec', '-i', ...env.flatMap(e => ['-e', e]), 'supabase_db_judoju-news-local', ...args], { input, encoding: 'utf8', windowsHide: true, maxBuffer: 64 * 1024 * 1024 });
const psql = (user, db, input, { env = [], host = false } = {}) => exec(['psql', '-X', ...(host ? ['-h', '127.0.0.1'] : []), '-U', user, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input, env);
const ok = r => { assert.equal(r.status, 0, r.stderr); return r.stdout; };
const q = v => "'" + String(v).replaceAll("'", "''") + "'";

const cronStub = `create schema cron;
create table cron.job(jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport integer default 5432, database text default 'postgres', username text default current_user, active boolean default true, jobname text);
create table cron.job_run_details(jobid bigint, runid bigserial primary key, job_pid integer, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values(job_name,schedule,command) returning jobid $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$ with d as (delete from cron.job where jobid=job_id returning 1) select exists(select 1 from d) $$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language sql as $$ update cron.job set active=coalesce(alter_job.active,cron.job.active) where jobid=job_id $$;
grant usage on schema cron to postgres; grant all on all tables in schema cron to postgres; grant all on all sequences in schema cron to postgres;`;

function cleanup() {
  psql('supabase_admin', 'postgres', `select pg_terminate_backend(pid) from pg_stat_activity where datname='${DB}';\ndrop database if exists ${DB};\ndrop role if exists judoju_ai_intake;`);
}

cleanup();
assert.equal(ok(psql('postgres', 'postgres', "select count(*) from pg_roles where rolname='judoju_ai_intake';")).trim(), '0', 'role must not exist before the test');
try {
  ok(psql('supabase_admin', 'postgres', `create database ${DB} owner postgres;`));
  const base = ok(exec(['pg_dump', '-U', 'postgres', '--schema-only', '-n', 'auth', '-n', 'supabase_migrations', 'postgres']));
  ok(psql('supabase_admin', DB, `create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;\n${base}\n${cronStub}`));
  for (const name of readdirSync(new URL('supabase/migrations/', root)).filter(n => n.endsWith('.sql')).sort()) {
    const text = readFileSync(new URL('supabase/migrations/' + name, root), 'utf8').replace(/^create extension if not exists pg_cron;$/m, '-- pg_cron stubbed');
    const r = psql('postgres', DB, text);
    assert.equal(r.status, 0, name + ': ' + r.stderr);
  }
  // The cloud environment guard is the only part left out (the scratch database identifies as local).
  const bundle = readFileSync(new URL('supabase/cloud/real-intake-dev/intake.sql', root), 'utf8');
  assert.equal(bundle.split('-- guard:begin').length, 2);
  const body = bundle.replace(/-- guard:begin[\s\S]*?-- guard:end\n/, '');
  const applied = psql('postgres', DB, body);
  // Local product functions keep PUBLIC execute (local default privileges); the cloud has none. Revoke PUBLIC on the
  // scratch database the same way the cloud bundles did, then the bundle's own post-check must pass.
  if (applied.status !== 0) {
    assert.match(applied.stderr, /INTAKE_POST_EXECUTE/, applied.stderr);
    ok(psql('postgres', DB, `do $$ declare f record; begin for f in select p.oid from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','private','judoju_control') and p.proname<>'rls_auto_enable' loop execute format('revoke execute on function %s from public', f.oid::regprocedure); end loop; end $$;`));
    ok(psql('postgres', DB, body));
  }
  console.log('PASS bundle applied with its post-check');
  // Second run refuses: the role exists.
  assert.match(psql('postgres', DB, body).stderr, /INTAKE_ROLE_EXISTS/);
  console.log('PASS second run refused');

  // The owner cannot use the intake functions (session_user is checked, not current_user).
  assert.match(psql('postgres', DB, `select ai_intake.submit('ai:x:1','{}'::jsonb);`).stderr, /AI_INTAKE_CALLER/);
  console.log('PASS owner refused (AI_INTAKE_CALLER)');

  // No login before the password step.
  const password = randomBytes(30).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 40);
  assert.ok(password.length >= 32);
  const login = input => psql('judoju_ai_intake', DB, input, { env: ['PGPASSWORD=' + password], host: true });
  assert.notEqual(login('select 1;').status, 0, 'login must fail before the password step');
  ok(psql('postgres', DB, `alter role judoju_ai_intake login password ${q(password)};`));
  console.log('PASS no login before the password step');

  // Real login as the role.
  assert.equal(ok(login('select session_user;')).trim(), 'judoju_ai_intake');
  assert.equal(ok(login("select current_setting('statement_timeout')||'|'||current_setting('idle_in_transaction_session_timeout');")).trim(), '10s|10s');
  console.log('PASS login as judoju_ai_intake with role settings');

  // Everything except the two functions is refused.
  for (const [label, sql] of [
    ['private table', 'select count(*) from private.issues;'],
    ['public view', 'select count(*) from public.news_public;'],
    ['inbox function', "select private.ai_ingest_draft('ai:x:1','{}'::jsonb);"],
    ['withdraw function', "select private.ai_withdraw_draft('x',1,'r');"],
    ['editor function', 'select public.m1_editor_articles();'],
    ['public read', 'select public.m1_public_identity();'],
    ['cleanup', 'select private.ai_intake_cleanup();'],
    ['receipts', 'select count(*) from private.ai_withdraw_receipts;'],
    ['migrations', 'select count(*) from supabase_migrations.schema_migrations;'],
  ]) {
    const r = login(sql);
    assert.notEqual(r.status, 0, label + ' must be refused');
    assert.match(r.stderr, /permission denied/, label + ': ' + r.stderr);
  }
  console.log('PASS other product objects refused (9)');

  // submit: refusals are definite raises the processor recognises.
  assert.match(login(`select ai_intake.submit('ai:x:1','[]'::jsonb);`).stderr, /AI_INTAKE_INVALID/);
  assert.match(login(`select ai_intake.submit('ai:x:1',jsonb_build_object('pad',repeat('a',262200)));`).stderr, /AI_INTAKE_TOO_LARGE/);
  const notReal = login(`select ai_intake.submit('ai:${randomUUID()}:1','{"format":"AI_DRAFT_V1"}'::jsonb);`);
  assert.notEqual(notReal.status, 0);
  assert.match(notReal.stderr, /ERROR:\s+(AI_[A-Z_]+|REAL_[A-Z_]+|INVALID_[A-Z_]+)/, notReal.stderr);
  console.log('PASS submit reaches the inbox and refuses invalid requests: ' + notReal.stderr.match(/ERROR:\s+([A-Z_]+)/)[1]);

  // withdraw: tombstone, replay, conflict, key mismatch.
  const ai = randomUUID();
  const w = (key, issue, version, reason) => login(`select ai_intake.withdraw(${q(key)},${q(issue)},${version},${q(reason)})::text;`);
  const first = JSON.parse(ok(w(`ai-withdraw:${ai}:2`, ai, 2, 'SOURCE_REVOKED')).trim());
  assert.equal(first.state, 'WITHDRAWN'); assert.equal(first.tombstone, true);
  const again = JSON.parse(ok(w(`ai-withdraw:${ai}:2`, ai, 2, 'SOURCE_REVOKED')).trim());
  assert.equal(again.state, 'WITHDRAWN'); assert.equal(again.replayed, true);
  assert.match(w(`ai-withdraw:${ai}:2`, ai, 2, 'OTHER').stderr, /EFFECT_PAYLOAD_CONFLICT/);
  assert.match(w(`ai-withdraw:${ai}:3`, ai, 2, 'SOURCE_REVOKED').stderr, /AI_INTAKE_KEY_MISMATCH/);
  const older = JSON.parse(ok(w(`ai-withdraw:${ai}:1`, ai, 1, 'SOURCE_REVOKED')).trim());
  assert.equal(older.state, 'STALE_VERSION');
  assert.equal(ok(psql('postgres', DB, `select count(*) from private.ai_withdraw_receipts where effect_key like ${q('ai-withdraw:' + ai + ':%')};`)).trim(), '2');
  console.log('PASS withdraw tombstone, replay, conflict, key mismatch, stale');

  // A tombstoned version cannot be submitted afterwards (the inbox answers WITHDRAWN or STALE, both committed).
  const daily = JSON.parse(ok(psql('postgres', DB, 'select private.ai_intake_cleanup()::text;')).trim());
  assert.equal(typeof daily.withdraw_receipts_deleted, 'number');
  ok(psql('postgres', DB, `update private.ai_withdraw_receipts set created_at=now()-interval '91 days' where effect_key=${q('ai-withdraw:' + ai + ':2')};`));
  assert.equal(JSON.parse(ok(psql('postgres', DB, 'select private.ai_intake_cleanup()::text;')).trim()).withdraw_receipts_deleted, 1);
  console.log('PASS daily cleanup removes 90-day-old receipts');

  // Connection limit 2.
  assert.equal(ok(psql('postgres', DB, "select rolconnlimit from pg_roles where rolname='judoju_ai_intake';")).trim(), '2');
  console.log('PASS connection limit 2');
} finally {
  cleanup();
  assert.equal(ok(psql('postgres', 'postgres', "select count(*) from pg_roles where rolname='judoju_ai_intake';")).trim(), '0', 'role must be gone after the test');
}
console.log('AI intake SQL: all checks passed');
