// Publish stage 2A (S4/S5): the cloud intake connection and the per-cycle delivery runner.
// - The push setting file is the only switch (missing or unreadable = off), re-read every service cycle.
// - The intake secret is a regular JSON file, owner-only on POSIX, read only when a pass actually has work.
// - The database connection uses TLS with certificate and host-name verification against the pinned CA file.
// - `pg` is loaded only when a connection is needed, so the service runs without it while delivery is off.
import { existsSync, readFileSync, statSync, lstatSync } from 'node:fs';
import { deliver, submitDue, maintainDeliveries, getMeta, setMeta } from './delivery.mjs';

// Directory mounts (a missing file never turns into a directory): $base/push -> /run/config/push, $base/intake -> /run/secrets/ai-intake.
export const PUSH_FILE = '/run/config/push/push.json', SECRET_FILE = '/run/secrets/ai-intake/db.json', CA_FILE = '/run/secrets/ai-intake/ca.pem';
export const PROBES = [
  ['privateTable', 'select 1 from private.issues limit 0'],
  ['publicView', 'select 1 from public.news_public limit 0'],
  ['inboxFunction', "select private.ai_ingest_draft('ai:probe:1','{}'::jsonb)"],
  ['editorFunction', 'select public.m1_editor_articles()'],
];
const PRODUCT = "('public','private','judoju_control','ai_intake','supabase_migrations')";
export const PRIVILEGE_SET = `select jsonb_build_object(
  'functions',(select coalesce(jsonb_agg(n.nspname||'.'||p.proname order by n.nspname||'.'||p.proname),'[]') from pg_proc p join pg_namespace n on n.oid=p.pronamespace
     where n.nspname in ${PRODUCT} and p.proname<>'rls_auto_enable' and has_function_privilege(p.oid,'EXECUTE')),
  'relations',(select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname in ${PRODUCT} and c.relkind in ('r','p','v','m','S','f')
     and (has_table_privilege(c.oid,'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER')
       or (case when current_setting('server_version_num')::int>=170000 then has_table_privilege(c.oid,'MAINTAIN') else false end) or (c.relkind<>'S' and has_any_column_privilege(c.oid,'SELECT,INSERT,UPDATE,REFERENCES'))
       or (c.relkind='S' and has_sequence_privilege(c.oid,'USAGE,SELECT,UPDATE')))),
  'schemas',(select coalesce(jsonb_object_agg(nspname,case when has_schema_privilege(oid,'USAGE') then 'U' else '' end||case when has_schema_privilege(oid,'CREATE') then 'C' else '' end),'{}')
     from pg_namespace where nspname in ('public','private','judoju_control','ai_intake','supabase_migrations','auth','storage','vault','cron','extensions','graphql','graphql_public','realtime')
     and (has_schema_privilege(oid,'USAGE') or has_schema_privilege(oid,'CREATE')))) r`;
// Usage of public (PUBLIC's default) and of the intake schema only; no CREATE anywhere.
export const EXPECTED_PRIVILEGES = { functions: ['ai_intake.submit', 'ai_intake.withdraw'], relations: 0, schemas: { ai_intake: 'U', public: 'U' } };
export const privilegeSetExact = set => !!set && Object.keys(set).length === 3 && JSON.stringify(set.functions) === JSON.stringify(EXPECTED_PRIVILEGES.functions)
  && Number(set.relations) === 0 && !!set.schemas && typeof set.schemas === 'object'
  && JSON.stringify(Object.entries(set.schemas).sort()) === JSON.stringify(Object.entries(EXPECTED_PRIVILEGES.schemas).sort());
const HOST = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

export function loadPushConfig(file = PUSH_FILE) {
  try {
    const value = JSON.parse(readFileSync(file, 'utf8'));
    if (value && value.enabled === true && value.target === 'cloud' && Object.keys(value).sort().join(',') === 'enabled,target') return { enabled: true, target: 'cloud' };
  } catch { /* missing or unreadable: off */ }
  return { enabled: false, target: null };
}

export function loadIntakeSecret(file = SECRET_FILE, { platform = process.platform } = {}) {
  if (!existsSync(file) || !lstatSync(file).isFile()) throw new Error('INTAKE_SECRET_MISSING');
  if (platform !== 'win32' && (statSync(file).mode & 0o077) !== 0) throw new Error('INTAKE_SECRET_PERMISSIONS');
  let value;
  try { value = JSON.parse(readFileSync(file, 'utf8')); } catch { throw new Error('INTAKE_SECRET_INVALID'); }
  const ok = value && Object.keys(value).sort().join(',') === 'database,host,password,port,user'
    && typeof value.host === 'string' && HOST.test(value.host) && Number.isInteger(value.port) && value.port > 0 && value.port < 65536
    && value.database === 'postgres' && typeof value.user === 'string' && /^judoju_ai_intake\.[a-z0-9]{20}$/.test(value.user)
    && typeof value.password === 'string' && /^[A-Za-z0-9]{32,64}$/.test(value.password);
  if (!ok) throw new Error('INTAKE_SECRET_INVALID');
  return value;
}

// One connection per pass; closed when the pass ends. Results are the intake functions' JSON answers.
export async function connectIntake(secret, { ca = readFileSync(CA_FILE, 'utf8'), pg } = {}) {
  const { default: postgres } = pg ? { default: pg } : await import('pg');
  const client = new postgres.Client({ host: secret.host, port: secret.port, database: secret.database, user: secret.user, password: secret.password,
    ssl: { ca, rejectUnauthorized: true, servername: secret.host }, statement_timeout: 10_000, query_timeout: 15_000, connectionTimeoutMillis: 10_000,
    application_name: 'judoju-ai-intake' });
  await client.connect();
  const call = async (sql, params) => (await client.query(sql, params)).rows[0]?.r ?? null;
  return {
    submit: (key, payload) => call('select ai_intake.submit($1,$2::jsonb) r', [key, JSON.stringify(payload)]),
    withdraw: (key, aiIssue, version, reason) => call('select ai_intake.withdraw($1,$2,$3,$4) r', [key, aiIssue, version, reason]),
    whoami: () => call('select session_user::text r', []),
    // Permission probe for status checks: every one of these must be refused with 42501 (insufficient privilege).
    probe: async () => {
      const out = {};
      // The complete effective privilege set of the login (Codex CLOUD13 review): exactly the two intake functions,
      // no product table or sequence, no private schema usage.
      const set = (await client.query(PRIVILEGE_SET)).rows[0]?.r ?? null;
      out.privilegeSet = privilegeSetExact(set) ? 'DENIED' : 'UNEXPECTED_' + JSON.stringify(set).slice(0, 200);
      for (const [name, sql] of PROBES) {
        try { await client.query(sql); out[name] = 'ALLOWED'; } catch (error) { out[name] = error?.code === '42501' ? 'DENIED' : 'ERROR_' + String(error?.code ?? 'UNKNOWN').slice(0, 10); }
      }
      return out;
    },
    close: () => client.end(),
  };
}

// One service cycle: nothing happens unless the push setting is on and a delivery is due; then one connection.
export async function deliveryCycle({ db, now = Date.now(), loadPush = loadPushConfig, loadSecret = loadIntakeSecret, connect = connectIntake }) {
  // Retention housekeeping runs every cycle, also while delivery is off or cannot connect.
  const maintenance = maintainDeliveries(db, now);
  const push = loadPush();
  if (!push.enabled) return { state: 'OFF', maintenance };
  const dueSubmit = submitDue(db, now);
  const due = db.prepare(`SELECT count(*) n FROM deliveries WHERE target='cloud' AND state='PENDING' AND next_attempt_at<=? AND (operation='WITHDRAW' OR attempts>0 OR ?)`).get(now, dueSubmit ? 1 : 0).n;
  // Nothing to send: housekeeping and the daily marker only, no connection.
  if (due === 0) return { state: 'IDLE', ...(await deliver(db, null, now, { submitDue: dueSubmit })) };
  // Connection failures back off like deliveries (1 minute doubling to 6 hours), so a broken link is not retried every cycle.
  const retryAt = getMeta(db, 'connect_retry_at');
  if (retryAt !== null && now < retryAt) return { state: 'CONNECT_BACKOFF', retryAt };
  let client;
  try { client = await connect(loadSecret()); }
  catch (error) {
    const failures = (getMeta(db, 'connect_failures') ?? 0) + 1;
    setMeta(db, 'connect_failures', failures);
    setMeta(db, 'connect_retry_at', now + Math.min(6 * 3600_000, 60_000 * 2 ** (failures - 1)));
    return { state: 'CONNECT_FAILED', reason: /^[A-Z_]{3,40}$/.test(error?.message ?? '') ? error.message : 'CONNECT_FAILED', failures };
  }
  db.prepare("DELETE FROM delivery_meta WHERE key IN ('connect_failures','connect_retry_at')").run();
  try { return { state: 'DELIVERED', ...(await deliver(db, client, now, { submitDue: dueSubmit })) }; }
  finally { await client.close().catch(() => {}); }
}
