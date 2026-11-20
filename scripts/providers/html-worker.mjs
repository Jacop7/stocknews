import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { collectHtmlList, htmlListPurposes, htmlListVersion } from './html-list.mjs';
import { identityForUrl, normalizeArticleUrl, permissionDecision } from './policy.mjs';

const minute = 60_000;
const day = 24 * 60 * minute;
const recoveryGap = 15 * minute;
const maxFastRechecks = 3;
const purposes = [...htmlListPurposes, 'STORAGE'];

export function openCollectorStore(path) {
  const db = new DatabaseSync(path, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS schedules (
      endpoint_id TEXT PRIMARY KEY, binding TEXT NOT NULL, next_at INTEGER NOT NULL,
      status TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS hosts (
      host TEXT PRIMARY KEY, next_at INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS host_rate_episodes (
      host TEXT PRIMARY KEY, rechecks INTEGER NOT NULL, daily_since INTEGER
    ) STRICT;
    CREATE TABLE IF NOT EXISTS rate_limited_routes (
      host TEXT NOT NULL, endpoint_id TEXT NOT NULL, first_healthy_at INTEGER,
      PRIMARY KEY (host, endpoint_id)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS candidates (
      endpoint_id TEXT NOT NULL, url TEXT NOT NULL, title TEXT NOT NULL, published_at TEXT,
      binding TEXT NOT NULL, first_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL,
      PRIMARY KEY (endpoint_id, url)
    ) STRICT;
  `);
  return db;
}

function registeredSource(endpoint, profile, time) {
  const now = new Date(time).toISOString();
  if (permissionDecision(profile, endpoint, purposes, now) ||
      endpoint.adapter_version !== htmlListVersion ||
      !purposes.every(purpose => endpoint.enabled_scopes?.includes(purpose)) ||
      !Number.isInteger(profile.retention_days) || profile.retention_days < 1 ||
      !Number.isFinite(endpoint.max_rps) || endpoint.max_rps <= 0) return null;
  let url;
  try { url = normalizeArticleUrl(endpoint.url); }
  catch { return null; }
  const host = new URL(url).hostname;
  const hostDelay = Math.max(1000, Math.ceil(1000 / endpoint.max_rps));
  if (!profile.allowed_hosts?.includes(host) || !profile.methods?.includes('GET') ||
      !Number.isInteger(profile.max_requests) || profile.max_requests < 1 ||
      !Number.isFinite(profile.max_bytes) || profile.max_bytes <= 0 ||
      !Number.isFinite(profile.timeout_ms) || profile.timeout_ms <= 0 ||
      !Number.isSafeInteger(time + hostDelay)) return null;
  const binding = JSON.stringify([profile.id, profile.version, endpoint.config_version, identityForUrl(url)]);
  return { endpoint, profile, host, binding, hostDelay };
}

function transaction(db, write) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = write();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function reserve(db, source, time, hostDelay) {
  return transaction(db, () => {
    const { endpoint, host, binding } = source;
    const prior = db.prepare('SELECT binding,next_at,status FROM schedules WHERE endpoint_id=?').get(endpoint.endpoint_id);
    if (prior?.binding === binding && (prior.status === 'ACCESS_HOLD' || prior.next_at > time)) return null;
    const hostSlot = db.prepare('SELECT next_at FROM hosts WHERE host=?').get(host);
    if (hostSlot && hostSlot.next_at > time) return null;
    const pause = db.prepare('SELECT daily_since FROM host_rate_episodes WHERE host=?').get(host);
    if (pause?.daily_since != null && time >= pause.daily_since + 14 * day) return null;
    const rateLimit = db.prepare(`UPDATE host_rate_episodes
      SET rechecks=rechecks+1, daily_since=CASE WHEN rechecks+1>=? THEN coalesce(daily_since,?) ELSE daily_since END
      WHERE host=? RETURNING rechecks`).get(maxFastRechecks, time, host);
    const recoveryDelay = !rateLimit ? 0 : rateLimit.rechecks >= maxFastRechecks ? day : recoveryGap;
    const reservation = time + 5 * minute;
    db.prepare(`INSERT INTO hosts VALUES (?,?) ON CONFLICT(host) DO UPDATE SET next_at=excluded.next_at`)
      .run(host, time + Math.max(hostDelay, recoveryDelay));
    db.prepare(`INSERT INTO schedules VALUES (?,?,?,'RESERVED')
      ON CONFLICT(endpoint_id) DO UPDATE SET binding=excluded.binding,next_at=excluded.next_at,status=excluded.status`)
      .run(endpoint.endpoint_id, binding, reservation);
    return reservation;
  });
}

function retryAfterTime(value, time) {
  if (typeof value !== 'string') return time;
  if (/^\d+$/.test(value)) return Math.min(Number.MAX_SAFE_INTEGER, time + Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : time;
}

function nextHostCheck(db, host, endpointId, result, success, time) {
  const retryAt = retryAfterTime(result.retryAfter, time);
  if (result.httpStatus === 429) {
    db.prepare(`INSERT INTO host_rate_episodes VALUES (?,0,NULL) ON CONFLICT(host) DO NOTHING`).run(host);
    db.prepare(`INSERT INTO rate_limited_routes VALUES (?,?,NULL)
      ON CONFLICT(host,endpoint_id) DO UPDATE SET first_healthy_at=NULL`).run(host, endpointId);
  }
  const rateLimit = db.prepare('SELECT rechecks FROM host_rate_episodes WHERE host=?').get(host);
  if (!rateLimit) return result.httpStatus === 503 ? Math.max(time + recoveryGap, retryAt) : 0;
  const route = db.prepare('SELECT first_healthy_at FROM rate_limited_routes WHERE host=? AND endpoint_id=?').get(host, endpointId);
  if (route) {
    if (success && route.first_healthy_at !== null && time - route.first_healthy_at >= 5 * minute) {
      db.prepare('DELETE FROM rate_limited_routes WHERE host=? AND endpoint_id=?').run(host, endpointId);
      if (!db.prepare('SELECT 1 FROM rate_limited_routes WHERE host=? LIMIT 1').get(host)) {
        db.prepare('DELETE FROM host_rate_episodes WHERE host=?').run(host);
        return 0;
      }
    } else {
      db.prepare('UPDATE rate_limited_routes SET first_healthy_at=? WHERE host=? AND endpoint_id=?')
        .run(success ? route.first_healthy_at ?? time : null, host, endpointId);
    }
  }
  return Math.max(time + (rateLimit.rechecks >= maxFastRechecks ? day : recoveryGap), retryAt);
}

function record(db, source, result, time, reservation) {
  const { endpoint, profile, binding, host } = source;
  const current = registeredSource(endpoint, profile, time);
  const accessHold = [401,402,403,404,410,451].includes(result.httpStatus) || result.reason === 'REDIRECT_LIMIT';
  const success = result.status === 'CANDIDATES' || result.status === 'PARTIAL';
  return transaction(db, () => {
    const next = time + (success ? 5 * minute : recoveryGap);
    const settled = db.prepare(`UPDATE schedules SET next_at=max(next_at,?),status=?
      WHERE endpoint_id=? AND binding=? AND next_at=? AND status='RESERVED'`)
      .run(next, accessHold ? 'ACCESS_HOLD' : result.status, endpoint.endpoint_id, binding, reservation);
    if (settled.changes !== 1) return 0;
    const hostWait = nextHostCheck(db, host, endpoint.endpoint_id, result, success, time);
    if (hostWait) db.prepare('UPDATE hosts SET next_at=max(next_at,?) WHERE host=?').run(hostWait, host);
    if (!current || current.binding !== binding) {
      db.prepare('DELETE FROM candidates WHERE endpoint_id=? AND binding=?').run(endpoint.endpoint_id, binding);
      return 0;
    }
    if (!success) return 0;
    const expires = Math.min(time + profile.retention_days * day, Date.parse(profile.expires_at));
    const insert = db.prepare(`INSERT INTO candidates VALUES (?,?,?,?,?,?,?)
      ON CONFLICT(endpoint_id,url) DO UPDATE SET title=excluded.title,
      published_at=coalesce(excluded.published_at,candidates.published_at),
      expires_at=min(excluded.expires_at,candidates.expires_at)`);
    for (const item of result.candidates) {
      insert.run(endpoint.endpoint_id, item.url, item.title, item.publishedAt, binding, time, expires);
    }
    return result.candidates.length;
  });
}

function prune(db, sources, time) {
  const bindings = new Map(sources.map(source => [source.endpoint.endpoint_id, source.binding]));
  const hosts = new Map(sources.map(source => [source.endpoint.endpoint_id, source.host]));
  transaction(db, () => {
    db.prepare('DELETE FROM candidates WHERE expires_at<=?').run(time);
    const remove = db.prepare('DELETE FROM candidates WHERE endpoint_id=? AND binding=?');
    for (const row of db.prepare('SELECT DISTINCT endpoint_id,binding FROM candidates').all()) {
      if (bindings.get(row.endpoint_id) !== row.binding) remove.run(row.endpoint_id, row.binding);
    }
    const removeRateRoute = db.prepare('DELETE FROM rate_limited_routes WHERE host=? AND endpoint_id=?');
    const accessHeld = db.prepare("SELECT 1 FROM schedules WHERE endpoint_id=? AND binding=? AND status='ACCESS_HOLD'");
    for (const row of db.prepare('SELECT host,endpoint_id FROM rate_limited_routes').all()) {
      if (hosts.get(row.endpoint_id) !== row.host || accessHeld.get(row.endpoint_id, bindings.get(row.endpoint_id))) {
        removeRateRoute.run(row.host, row.endpoint_id);
      }
    }
    // Keep the host's outstanding Retry-After deadline even if its last affected route is removed.
    db.exec(`DELETE FROM host_rate_episodes WHERE NOT EXISTS (
      SELECT 1 FROM rate_limited_routes WHERE rate_limited_routes.host=host_rate_episodes.host
    )`);
  });
}

export async function runCollectorCycle(db, { endpoints, profiles, now = Date.now, collect = collectHtmlList }) {
  const time = now();
  const byId = new Map(profiles.map(profile => [profile.id, profile]));
  const sources = endpoints.map(endpoint => registeredSource(endpoint, byId.get(endpoint.permission_profile_id), time)).filter(Boolean);
  prune(db, sources, time);
  const stats = { registered: endpoints.length, eligible: sources.length, requests: 0, observed: 0 };
  const delays = new Map();
  for (const source of sources) delays.set(source.host, Math.max(source.hostDelay, delays.get(source.host) ?? 0));
  const bySchedule = new Map(db.prepare('SELECT endpoint_id,binding,next_at FROM schedules').all().map(row => [row.endpoint_id, row]));
  const recoveryRoutes = new Set(db.prepare('SELECT endpoint_id FROM rate_limited_routes').all().map(row => row.endpoint_id));
  const dueAt = ({ endpoint, binding }) => {
    const prior = bySchedule.get(endpoint.endpoint_id);
    return prior?.binding === binding ? prior.next_at : 0;
  };
  sources.sort((a, b) => Number(recoveryRoutes.has(b.endpoint.endpoint_id)) -
    Number(recoveryRoutes.has(a.endpoint.endpoint_id)) || dueAt(a) - dueAt(b));
  let attempts = 0;
  for (const source of sources) {
    const start = now();
    if (registeredSource(source.endpoint, source.profile, start)?.binding !== source.binding) continue;
    const reservation = reserve(db, source, start, delays.get(source.host));
    if (reservation === null) continue;
    const result = await collect({ endpoint: source.endpoint, profile: source.profile, execute: true,
      now: () => new Date(now()).toISOString() });
    stats.requests += result.requests;
    stats.observed += record(db, source, result, now(), reservation);
    if (++attempts >= 8) break;
  }
  return stats;
}

function loadRegistry() {
  const read = name => JSON.parse(readFileSync(new URL('../../data/providers/' + name, import.meta.url), 'utf8'));
  return { endpoints: read('routes.json').endpoints, profiles: read('permission-profiles.json').profiles };
}

async function main() {
  const directory = process.env.JUDOJU_COLLECTOR_DIRECTORY ?? '.local-data/html-collector';
  mkdirSync(directory, { recursive: true });
  const db = openCollectorStore(join(directory, 'collection.sqlite'));
  const stopping = new AbortController();
  process.once('SIGTERM', () => stopping.abort());
  process.once('SIGINT', () => stopping.abort());
  try {
    do {
      const stats = await runCollectorCycle(db, loadRegistry());
      writeFileSync(join(directory, 'heartbeat'), String(Date.now()));
      console.log(JSON.stringify({ event: 'HTML_COLLECTION_CYCLE', ...stats }));
      if (process.argv[2] === '--once' || stopping.signal.aborted) break;
      await sleep(minute, undefined, { signal: stopping.signal }).catch(error => {
        if (!stopping.signal.aborted) throw error;
      });
    } while (!stopping.signal.aborted);
  } finally {
    db.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main().catch(() => {
    console.error('HTML_COLLECTOR_FAILED');
    process.exitCode = 1;
  });
}
