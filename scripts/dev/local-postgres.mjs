// Docker-free local PostgreSQL for SQL tests (development only).
//
//   node scripts/dev/local-postgres.mjs reset   # init/start, recreate DB, apply stubs + all migrations
//   node scripts/dev/local-postgres.mjs stop
//
// Prints the connection URL. Tests read it from JUDOJU_TEST_PG_URL.
// Needs PostgreSQL 16 server binaries and pg_cron (Ubuntu: postgresql-16 postgresql-16-cron).
// Binds 127.0.0.1 only, trust auth, throwaway data dir. Never points at a hosted project.
// WARNING: `reset` force-drops the database "judoju" on 127.0.0.1:JUDOJU_PG_PORT (default 55432).
import { execFileSync, spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, mkdirSync, readdirSync, chownSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const bin = process.env.JUDOJU_PG_BIN ?? '/usr/lib/postgresql/16/bin';
const dir = process.env.JUDOJU_PG_DIR ?? '/var/tmp/judoju-pg';
const port = Number(process.env.JUDOJU_PG_PORT ?? 55432);
const database = 'judoju';
export const localPgUrl = `postgresql://postgres@127.0.0.1:${port}/${database}`;

const asPostgres = (cmd, args) => {
  // initdb/pg_ctl refuse to run as root; drop to the postgres OS user when needed.
  if (process.getuid?.() === 0) return spawnSync('su', ['postgres', '-c', [cmd, ...args].map(x => `'${x.replaceAll("'", "'\\''")}'`).join(' ')], { encoding: 'utf8' });
  return spawnSync(cmd, args, { encoding: 'utf8' });
};
const psql = (args, input) => execFileSync('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-X', '-q', '-v', 'ON_ERROR_STOP=1', ...args], { encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'] });
const running = () => spawnSync(path.join(bin, 'pg_isready'), ['-h', '127.0.0.1', '-p', String(port)]).status === 0;

function start() {
  if (running()) return;
  if (!existsSync(path.join(dir, 'data', 'PG_VERSION'))) {
    mkdirSync(dir, { recursive: true });
    if (process.getuid?.() === 0) { const uid = Number(execFileSync('id', ['-u', 'postgres'], { encoding: 'utf8' })); chownSync(dir, uid, uid); }
    const init = asPostgres(path.join(bin, 'initdb'), ['-D', path.join(dir, 'data'), '-A', 'trust', '-U', 'postgres']);
    if (init.status !== 0) throw new Error('initdb failed: ' + init.stderr);
    appendFileSync(path.join(dir, 'data', 'postgresql.conf'), [
      "shared_preload_libraries = 'pg_cron'", `cron.database_name = '${database}'`,
      'cron.use_background_workers = off', 'cron.log_run = on', 'cron.launch_active_jobs = off', '',
    ].join('\n'));
  }
  const started = asPostgres(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-w', '-o', `-p ${port} -k ${dir} -c listen_addresses=127.0.0.1`, '-l', path.join(dir, 'log'), 'start']);
  if (started.status !== 0) throw new Error('pg_ctl start failed: ' + started.stderr + started.stdout);
}

function reset() {
  start();
  psql(['-d', 'postgres', '-c', `drop database if exists ${database} with (force)`, '-c', `create database ${database}`]);
  psql(['-d', database, '-f', path.join(root, 'scripts/dev/supabase-stubs.sql')]);
  const migrations = readdirSync(path.join(root, 'supabase/migrations')).filter(f => f.endsWith('.sql')).sort();
  for (const file of migrations) {
    try { psql(['-d', database, '-f', path.join(root, 'supabase/migrations', file)]); }
    catch (e) { throw new Error(`migration ${file} failed: ${String(e.stderr ?? e.message).split('\n').filter(l => !l.includes('NOTICE')).slice(-3).join(' ')}`); }
  }
  return migrations.length;
}

if (process.argv[1] && import.meta.url === new URL('file://' + path.resolve(process.argv[1])).href) {
  const command = process.argv[2];
  if (command === 'reset') { const n = reset(); console.log(JSON.stringify({ status: 'READY', url: localPgUrl, migrations: n })); }
  else if (command === 'start') { start(); console.log(JSON.stringify({ status: 'RUNNING', url: localPgUrl })); }
  else if (command === 'stop') { asPostgres(path.join(bin, 'pg_ctl'), ['-D', path.join(dir, 'data'), '-m', 'fast', 'stop']); console.log(JSON.stringify({ status: 'STOPPED' })); }
  else { console.error('usage: local-postgres.mjs reset|start|stop'); process.exit(2); }
}
