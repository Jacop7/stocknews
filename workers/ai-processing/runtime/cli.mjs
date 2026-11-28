import assert from 'node:assert/strict';
import { existsSync, readFileSync, mkdirSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { BacklogStore } from './store.mjs';
import { validateConfig } from './contracts.mjs';
import { createOriginalReader } from './original.mjs';
import { createOpenAiModel } from './model.mjs';
import { createBacklogProcessor } from './pipeline.mjs';
import { readDiscoveryLeads } from './discovery.mjs';
import { createLinkResolver } from './resolver.mjs';

// Reads a discovery API response that was already saved to disk. No network request is made.
export function readDiscoveryFile(filename, format, now = Date.now()) {
  assert(existsSync(filename), 'DISCOVERY_FILE_NOT_FOUND');
  assert(statSync(filename).size <= 5 * 1024 * 1024, 'DISCOVERY_INPUT_LIMIT');
  return readDiscoveryLeads(JSON.parse(readFileSync(filename, 'utf8')), format, now);
}

export function readSavedLinks(filename, kind, now = Date.now()) {
  assert(existsSync(filename), 'SAVED_LINK_DATABASE_NOT_FOUND');
  const db = new DatabaseSync(filename, { readOnly: true });
  try {
    assert.equal(db.prepare('PRAGMA quick_check').get().quick_check, 'ok');
    if (kind === 'telegram') {
      const rows = db.prepare('SELECT endpoint_id sourceId,url,last_seen lastSeen,expires_at expiresAt FROM telegram_page_links WHERE expires_at>? ORDER BY endpoint_id,url LIMIT 20001').all(now);
      assert(rows.length <= 20000, 'SAVED_INPUT_LIMIT'); return rows;
    }
    assert(kind === 'web', 'INVALID_IMPORT_KIND');
    const rows = db.prepare('SELECT endpoint_id sourceId,url,title,first_seen lastSeen,expires_at expiresAt FROM candidates WHERE expires_at>? ORDER BY endpoint_id,url LIMIT 20001').all(now);
    assert(rows.length <= 20000, 'SAVED_INPUT_LIMIT'); return rows;
  } finally { db.close(); }
}

async function main(argv) {
  const command = argv[0];
  if (!command || command === '--help') {
    console.log('Commands: export-drafts --db DB; push-drafts --db DB [--check]; export-requeue --db DB --job ID; import --db OUTPUT [--telegram SAVED_DB] [--web SAVED_DB] [--discovery SAVED_JSON --format tickertick|leads]; status --db DB; work --db DB --config FILE [--once] [--execute-originals] [--execute-models]');
    return;
  }
  const flags = new Set(['--once', '--execute-originals', '--execute-models', '--check']), options = {};
  for (let i = 1; i < argv.length; i++) {
    const key = argv[i]; assert(['--db', '--telegram', '--web', '--discovery', '--format', '--config', '--job', ...flags].includes(key), 'UNKNOWN_ARGUMENT');
    assert(!Object.hasOwn(options, key), 'DUPLICATE_ARGUMENT');
    options[key] = flags.has(key) ? true : argv[++i];
    assert(options[key] !== undefined, 'ARGUMENT_VALUE_REQUIRED');
  }
  assert(['import', 'status', 'work', 'export-drafts', 'export-requeue', 'push-drafts', 'news-report'].includes(command) && typeof options['--db'] === 'string', 'COMMAND_REQUIRED');
  const filename = resolve(options['--db']);
  if (['status', 'export-drafts', 'export-requeue', 'push-drafts', 'news-report'].includes(command)) assert(existsSync(filename), 'PROCESSING_DATABASE_NOT_FOUND');
  // News-source evaluation (2026-11-28): counts only, read only.
  if (command === 'news-report') {
    const { newsReport, sourceStatus } = await import('./news-report.mjs');
    const { DatabaseSync } = await import('node:sqlite');
    // Opened read-only (no schema changes, no back-fill, no writer lock).
    const db = new DatabaseSync(filename, { readOnly: true });
    try { console.log(JSON.stringify({ ...newsReport(db), sources: sourceStatus(db) })); } finally { db.close(); }
    return;
  }
  // Publish stage 2A: one manual cloud delivery pass (same gate as the service: the push setting file), or --check,
  // which only connects with the intake secret and reports the session role and the queue status (nothing is sent).
  if (command === 'push-drafts') {
    const { deliveryCycle, loadIntakeSecret, connectIntake, loadPushConfig } = await import('./intake-client.mjs');
    const { deliveryStatus } = await import('./delivery.mjs');
    const store = new BacklogStore(filename);
    try {
      if (options['--check']) {
        // Exit 0 only for a working intake login whose every probe is refused; a failed login prints its SQLSTATE
        // (28P01 wrong password, 28000 login not allowed) so the emergency revoke can tell revocation from an outage.
        let client;
        try { client = await connectIntake(loadIntakeSecret()); }
        catch (error) {
          const code = /^[0-9A-Z]{5}$/.test(error?.code ?? '') ? error.code : /^[A-Z_]{3,40}$/.test(error?.message ?? '') ? error.message : 'CONNECT_FAILED';
          console.log(JSON.stringify({ connect: 'FAILED', code }));
          process.exitCode = 3;
          return;
        }
        try {
          const sessionUser = await client.whoami(), probe = await client.probe();
          const safe = sessionUser === 'judoju_ai_intake' && Object.values(probe).every(v => v === 'DENIED');
          // A working connection ends any earlier connection backoff, so pending withdrawals go on the next cycle.
          if (safe) store.db.prepare("DELETE FROM delivery_meta WHERE key IN ('connect_failures','connect_retry_at')").run();
          console.log(JSON.stringify({ connect: 'OK', safe, push: loadPushConfig(), sessionUser, probe, queue: deliveryStatus(store.db, Date.now()) }));
          if (!safe) process.exitCode = 4;
        } finally { await client.close(); }
      } else console.log(JSON.stringify(await deliveryCycle({ db: store.db })));
    } finally { store.close(); }
    return;
  }
  // Publish stage 1A: ready export snapshots and revoked issue versions, as JSON on stdout (read only).
  if (command === 'export-drafts') {
    const store = new BacklogStore(filename);
    try { console.log(JSON.stringify(store.exports(Date.now()))); } finally { store.close(); }
    return;
  }
  // Publish stage 1A: re-queue one DRAFT_READY job so it is processed again and leaves an export snapshot.
  if (command === 'export-requeue') {
    assert(typeof options['--job'] === 'string' && /^[A-Za-z0-9_-]{1,80}$/.test(options['--job']), 'JOB_ID_REQUIRED');
    const store = new BacklogStore(filename);
    try { console.log(JSON.stringify(store.requeueForExport(options['--job'], Date.now()))); } finally { store.close(); }
    return;
  }
  if (command === 'import') assert(options['--telegram'] || options['--web'] || options['--discovery'], 'SAVED_INPUT_REQUIRED');
  assert(Boolean(options['--discovery']) === Boolean(options['--format']), 'DISCOVERY_FORMAT_REQUIRED');
  if (command === 'import') for (const type of ['telegram', 'web', 'discovery']) if (options['--' + type]) {
    const input = resolve(options['--' + type]);
    assert(input.toLowerCase() !== filename.toLowerCase(), 'INPUT_OUTPUT_COLLISION');
    if (existsSync(input) && existsSync(filename)) {
      const source = statSync(input), target = statSync(filename);
      assert(source.dev !== target.dev || source.ino !== target.ino, 'INPUT_OUTPUT_COLLISION');
    }
  }
  mkdirSync(dirname(filename), { recursive: true });
  const store = new BacklogStore(filename);
  try {
    if (command === 'status') { console.log(JSON.stringify(store.status())); return; }
    if (command === 'import') {
      const now = Date.now(); const entries = [];
      for (const type of ['telegram', 'web']) if (options['--' + type]) entries.push(...readSavedLinks(options['--' + type], type, now));
      let discovery = null;
      if (options['--discovery']) {
        const leads = readDiscoveryFile(resolve(options['--discovery']), options['--format'], now);
        entries.push(...leads.entries);
        discovery = { provider: leads.provider, leads: leads.entries.length, rejected: leads.rejected, reasons: leads.reasons };
      }
      console.log(JSON.stringify({ operation: 'READ_ONLY_BACKLOG_IMPORT', ...store.importLinks(entries, now), discovery,
        discoveryRequests: 0,
        originalRequests: 0, modelRequests: 0, collectionRestarted: false })); return;
    }
    assert(options['--config'], 'CONFIG_FILE_REQUIRED');
    const loadConfig = () => {
      const value = validateConfig(JSON.parse(readFileSync(resolve(options['--config']), 'utf8')));
      return { ...value, readOriginals: value.readOriginals && options['--execute-originals'] === true,
        callModels: value.callModels && options['--execute-models'] === true };
    };
    const initial = loadConfig();
    const model = initial.callModels ? createOpenAiModel({ apiKey: process.env.JUDOJU_ANALYSIS_OPENAI_API_KEY }) : async () => { throw new Error('MODEL_EXECUTION_DISABLED'); };
    const robots = { loadRobots: (origin, now) => store.loadRobots(origin, now), saveRobots: (origin, value) => store.saveRobots(origin, value) };
    const processor = createBacklogProcessor({ store, loadConfig, model, readOriginal: createOriginalReader(robots), resolveLink: createLinkResolver(robots) });
    const stop = new AbortController(); process.once('SIGTERM', () => stop.abort()); process.once('SIGINT', () => stop.abort());
    do {
      const result = await processor.step(); console.log(JSON.stringify({ event: 'BACKLOG_PROCESSING_STEP', ...result }));
      if (options['--once'] || result.state === 'PAUSED' || stop.signal.aborted) break;
      await sleep(1000, undefined, { signal: stop.signal }).catch(error => { if (!stop.signal.aborted) throw error; });
    } while (!stop.signal.aborted);
  } finally { store.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).catch(() => { console.error('BACKLOG_PROCESSING_FAILED; inspect configuration and local status. Credentials and originals are not logged.'); process.exitCode = 1; });
}
