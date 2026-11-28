// Scratch databases in the local Supabase cluster for bundle rehearsals and role tests: a fresh database with the
// Supabase auth schema copied from the local `postgres` database, pg_cron stubbed (the extension can only live in
// `postgres`), and the local migrations applied up to a given version. The local `postgres` database is never changed.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const root = new URL('../../', import.meta.url);
export const docker = process.platform === 'win32' ? 'C:/Program Files/Docker/Docker/resources/bin/docker.exe' : 'docker';
export const exec = (args, input, env = []) => spawnSync(docker, ['exec', '-i', ...env.flatMap(e => ['-e', e]), 'supabase_db_judoju-news-local', ...args],
  { input, encoding: 'utf8', windowsHide: true, maxBuffer: 256 * 1024 * 1024 });
export const psql = (user, db, input, { env = [], host = false } = {}) =>
  exec(['psql', '-X', ...(host ? ['-h', '127.0.0.1'] : []), '-U', user, '-d', db, '-At', '-v', 'ON_ERROR_STOP=1'], input, env);
export const ok = r => { assert.equal(r.status, 0, r.stderr); return r.stdout; };

export const CRON_STUB = `create schema cron;
create table cron.job(jobid bigserial primary key, schedule text, command text, nodename text default 'localhost', nodeport integer default 5432, database text default 'postgres', username text default current_user, active boolean default true, jobname text);
create table cron.job_run_details(jobid bigint, runid bigserial primary key, job_pid integer, database text, username text, command text, status text, return_message text, start_time timestamptz, end_time timestamptz);
create function cron.schedule(job_name text, schedule text, command text) returns bigint language sql as $$ insert into cron.job(jobname,schedule,command) values(job_name,schedule,command) returning jobid $$;
create function cron.unschedule(job_id bigint) returns boolean language sql as $$ with d as (delete from cron.job where jobid=job_id returning 1) select exists(select 1 from d) $$;
create function cron.alter_job(job_id bigint, schedule text default null, command text default null, database text default null, username text default null, active boolean default null) returns void language sql as $$ update cron.job set active=coalesce(alter_job.active,cron.job.active) where jobid=job_id $$;
grant usage on schema cron to postgres; grant all on all tables in schema cron to postgres; grant all on all sequences in schema cron to postgres;`;

export function dropScratch(name) {
  assert.match(name, /^[a-z0-9_]+_(test|rehearsal)$/);
  ok(psql('supabase_admin', 'postgres', `select pg_terminate_backend(pid) from pg_stat_activity where datname='${name}';\ndrop database if exists ${name};`));
}

// Fresh scratch database with local migrations whose version is <= upTo (inclusive).
export function createScratch(name, upTo) {
  dropScratch(name);
  ok(psql('supabase_admin', 'postgres', `create database ${name} owner postgres;`));
  const base = ok(exec(['pg_dump', '-U', 'postgres', '--schema-only', '-n', 'auth', '-n', 'supabase_migrations', 'postgres']));
  ok(psql('supabase_admin', name, `create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions; create extension if not exists "uuid-ossp" with schema extensions;\n${base}\n${CRON_STUB}`));
  for (const file of readdirSync(new URL('supabase/migrations/', root)).filter(n => n.endsWith('.sql')).sort()) {
    if (file.slice(0, 14) > upTo) break;
    const text = readFileSync(new URL('supabase/migrations/' + file, root), 'utf8').replace(/^create extension if not exists pg_cron;$/m, '-- pg_cron stubbed');
    const r = psql('postgres', name, text);
    assert.equal(r.status, 0, file + ': ' + r.stderr);
  }
}
