import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { AsyncLocalStorage } from 'node:async_hooks';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse } from 'parse5';
import { normalizeArticleUrl, permissionDecision, permissionExpiry } from './policy.mjs';
import { createPublicWatch, retryAfterTime } from './public-watch.mjs';
import { pinnedHttps, publicAddress } from './probe.mjs';
import { hostGap, noJitter } from './pacing.mjs';

const purposes = ['MACHINE_ACCESS', 'DISCOVERY', 'LINK_EXTRACTION', 'STORAGE'];
const heldRows = new Set([16, 19, 32, 36, 43, 48]);
const publisherRows = new Set([70, 71, 77, 81, 82, 83, 91, 92, 93, 94, 95, 96, 97, 98, 103, 106]);
const homeRows = new Set([87, 88, 89, 90]);
export const telegramAuthorization = 'USER_REQUEST_47_PUBLIC_TELEGRAM_LINKS_20261121';
const minute = 60_000;
const channelPattern = /^https:\/\/t\.me\/s\/([a-z0-9_]+)$/i;
const number = value => Number.isSafeInteger(value) && value > 0;
const attribute = (element, name) => element.attrs?.find(entry => entry.name === name)?.value ?? '';
const hasClass = (element, name) => attribute(element, 'class').split(/\s+/).includes(name);

function externalUrl(raw) {
  if (!/^https:\/\//i.test(raw) || raw.length > 2048 || /[\u0000-\u0020\u007f]/u.test(raw)) return null;
  try {
    const url = new URL(normalizeArticleUrl(raw));
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || isIP(host) || host.startsWith('[') ||
        /(?:^|\.)(?:t\.me|telegram\.me|telegram\.dog|telegram\.org|telegra\.ph|localhost|local|internal|test|invalid|example)$/.test(host)) return null;
    return url.href;
  } catch { return null; }
}

export function telegramPageLinks(html, url) {
  const handle = channelPattern.exec(url)?.[1].toLowerCase();
  if (!handle) return { valid: false, links: [] };
  const nodes = [parse(html, { scriptingEnabled: true })];
  let valid = false, latestPost = null;
  const links = new Set();
  while (nodes.length) {
    const node = nodes.pop();
    if (node.tagName === 'a' && node.namespaceURI === 'http://www.w3.org/1999/xhtml') {
      const link = externalUrl(attribute(node, 'href'));
      if (link) {
        let parent = node.parentNode;
        let inText = false;
        while (parent && !hasClass(parent, 'tgme_widget_message')) {
          inText ||= hasClass(parent, 'tgme_widget_message_text') || hasClass(parent, 'tgme_widget_message_caption');
          parent = parent.parentNode;
        }
        if (inText && attribute(parent ?? {}, 'data-post').toLowerCase().split('/')[0] === handle) links.add(link);
      }
    } else if (hasClass(node, 'tgme_widget_message') &&
               attribute(node, 'data-post').toLowerCase().split('/')[0] === handle) {
      valid = true;
      const post = Number(attribute(node, 'data-post').split('/')[1]);
      if (Number.isSafeInteger(post) && post > 0 && (latestPost === null || post > latestPost)) latestPost = post;
    }
    if (!['script', 'style', 'noscript', 'template'].includes(node.tagName)) {
      for (const child of node.childNodes ?? []) nodes.push(child);
    }
  }
  return { valid, links: valid ? [...links].slice(0, 100) : [], ...(valid && links.size > 100 ? { truncated: true } : {}),
    ...(valid && latestPost !== null ? { latestPost } : {}) };
}

export function telegramLinkExclusions({ routes, endpoints }) {
  const domains = new Set(), exact = new Set();
  for (const route of routes) {
    if (!publisherRows.has(route.original_row) && !homeRows.has(route.original_row)) continue;
    for (const id of route.endpoint_ids) {
      const endpoint = endpoints.find(item => item.endpoint_id === id);
      if (endpoint?.status !== 'DISABLED') continue;
      const url = normalizeArticleUrl(endpoint.url);
      if (homeRows.has(route.original_row)) exact.add(url);
      else domains.add(new URL(url).hostname.toLowerCase().replace(/^www\./, '').replace(/\.$/, ''));
    }
  }
  return { domains: [...domains].sort(), exact: [...exact].sort() };
}

export function excludedTelegramLink(url, exclusions) {
  const normalized = externalUrl(url);
  if (!normalized) return true;
  const host = new URL(normalized).hostname.toLowerCase().replace(/\.$/, '');
  return exclusions.exact.includes(normalized) || exclusions.domains.some(domain => host === domain || host.endsWith('.' + domain));
}

export function telegramPageCandidates(config, timestamp) {
  const { routes, endpoints, profiles } = config;
  const selected = new Set(routes.filter(route => route.effective_kind === 'TELEGRAM' &&
    !heldRows.has(route.original_row)).flatMap(route => route.endpoint_ids));
  const now = new Date(timestamp).toISOString();
  const active = new Map();
  for (const endpoint of endpoints) {
    if (!selected.has(endpoint.endpoint_id) || !channelPattern.test(endpoint.url)) continue;
    const profile = profiles.find(item => item.id === endpoint.permission_profile_id);
    const operator = endpoint.telegram_link_collection;
    if (operator) {
      if (!['RIGHTS_HOLD', 'TECH_TEST', 'SHADOW', 'ACTIVE'].includes(endpoint.status) ||
          !profile || profile.endpoint_id !== endpoint.endpoint_id || profile.version !== endpoint.permission_profile_version ||
          ['DENIED', 'REVOKED'].includes(profile.status) || profile.revoked_at ||
          purposes.some(purpose => profile.purposes?.[purpose] === 'DENY') ||
          operator.mode !== 'PUBLIC_EXTERNAL_LINKS_V1' || operator.authorization !== telegramAuthorization ||
          operator.endpoint_id !== endpoint.endpoint_id || operator.list_url !== endpoint.url || operator.retention_days !== 7 ||
          !Number.isFinite(Date.parse(operator.enabled_at)) || Date.parse(operator.enabled_at) > timestamp) continue;
      active.set(endpoint.endpoint_id, { endpoint, expires: Infinity, retention: 7 * 1440 * minute,
        hostDelay: 5000, maxBytes: 512 * 1024, timeoutMs: 4500,
        binding: JSON.stringify([endpoint, profile, routes.filter(route => route.effective_kind === 'TELEGRAM' &&
          route.endpoint_ids.includes(endpoint.endpoint_id))]) });
      continue;
    }
    if (permissionDecision(profile, endpoint, purposes, now) ||
        !purposes.every(purpose => endpoint.enabled_scopes?.includes(purpose))) continue;
    if (!profile.allowed_hosts?.includes('t.me') || !profile.methods?.includes('GET') ||
        !number(profile.max_requests) || !number(profile.timeout_ms) || !number(profile.max_bytes) ||
        !number(profile.retention_days) || !Number.isFinite(endpoint.max_rps) || endpoint.max_rps <= 0) continue;
    const retention = profile.retention_days * 1440 * minute;
    const hostDelay = Math.max(minute, Math.ceil(1000 / endpoint.max_rps));
    if (!Number.isSafeInteger(timestamp + retention) || !Number.isSafeInteger(timestamp + hostDelay)) continue;
    const expires = permissionExpiry(profile);
    active.set(endpoint.endpoint_id, {
      endpoint, expires, retention, hostDelay, maxBytes: profile.max_bytes,
      timeoutMs: Math.min(profile.timeout_ms, expires - timestamp),
      binding: JSON.stringify([endpoint.url, endpoint.config_version, profile.id, profile.version,
        expires, retention, profile.max_bytes, profile.timeout_ms, hostDelay]),
    });
  }
  return active;
}

export function openTelegramPageStore(filename) {
  const db = new DatabaseSync(filename, { timeout: 5000 });
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS telegram_page_links (
      endpoint_id TEXT NOT NULL, binding TEXT NOT NULL, url TEXT NOT NULL,
      last_seen INTEGER NOT NULL, expires_at INTEGER NOT NULL, PRIMARY KEY (endpoint_id, url)
    ) STRICT;
    CREATE TABLE IF NOT EXISTS telegram_page_schedule (endpoint_id TEXT PRIMARY KEY, next_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS telegram_page_host (id INTEGER PRIMARY KEY CHECK (id=1), next_at INTEGER NOT NULL) STRICT;
    CREATE TABLE IF NOT EXISTS telegram_page_activity (
      endpoint_id TEXT PRIMARY KEY, binding TEXT NOT NULL, latest_post INTEGER NOT NULL, quiet_visits INTEGER NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS telegram_page_diagnostics (
      endpoint_id TEXT PRIMARY KEY, binding TEXT NOT NULL, observed_at INTEGER NOT NULL,
      status TEXT NOT NULL, http_status INTEGER, reason TEXT, observed_links INTEGER NOT NULL
    ) STRICT;
  `);
  return db;
}

export function expireTelegramLinks(db, timestamp) {
  db.prepare('DELETE FROM telegram_page_links WHERE expires_at <= ?').run(timestamp);
}

function prune(db, active, timestamp, exclusions) {
  expireTelegramLinks(db, timestamp);
  const remove = db.prepare('DELETE FROM telegram_page_links WHERE endpoint_id = ? AND binding = ?');
  for (const row of db.prepare('SELECT DISTINCT endpoint_id, binding FROM telegram_page_links').all()) {
    if (active.get(row.endpoint_id)?.binding !== row.binding) remove.run(row.endpoint_id, row.binding);
  }
  for (const row of db.prepare('SELECT endpoint_id, binding FROM telegram_page_diagnostics').all()) {
    if (active.get(row.endpoint_id)?.binding !== row.binding) {
      db.prepare('DELETE FROM telegram_page_diagnostics WHERE endpoint_id=?').run(row.endpoint_id);
      db.prepare('DELETE FROM telegram_page_schedule WHERE endpoint_id=?').run(row.endpoint_id);
    }
  }
  for (const row of db.prepare('SELECT endpoint_id, binding FROM telegram_page_activity').all()) {
    if (active.get(row.endpoint_id)?.binding !== row.binding) db.prepare('DELETE FROM telegram_page_activity WHERE endpoint_id=?').run(row.endpoint_id);
  }
  for (const row of db.prepare('SELECT endpoint_id FROM telegram_page_schedule').all()) {
    if (!active.has(row.endpoint_id)) db.prepare('DELETE FROM telegram_page_schedule WHERE endpoint_id=?').run(row.endpoint_id);
  }
  if (exclusions) for (const row of db.prepare('SELECT endpoint_id,url FROM telegram_page_links').all()) {
    if (excludedTelegramLink(row.url, exclusions)) db.prepare('DELETE FROM telegram_page_links WHERE endpoint_id=? AND url=?').run(row.endpoint_id, row.url);
  }
}

// The shared SSRF validator remains untouched. This transport is restricted to t.me
// and validates every A answer before passing those exact addresses to pinned HTTPS.
export function createTelegramTransport({ lookupHost = lookup, request = pinnedHttps } = {}) {
  return async (url, limits) => {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 't.me' || parsed.port || parsed.username || parsed.password) throw new Error('UNSAFE_URL');
    const signal = limits.signal ?? AbortSignal.timeout(limits.timeoutMs);
    signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new Error('REQUEST_TIMEOUT'));
      signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const answers = await Promise.race([lookupHost('t.me', { all: true, family: 4 }), cancelled]);
      signal.throwIfAborted();
      if (!Array.isArray(answers) || !answers.length || answers.some(item => item.family !== 4 || !publicAddress(item.address))) throw new Error('NON_PUBLIC_DNS');
      if (limits.authorize?.() === false) throw new Error('AUTHORIZATION_CHANGED');
      return await request(url, { ...limits, signal, resolvedAddresses: answers });
    } finally { signal.removeEventListener('abort', abort); }
  };
}

export function createTelegramPageWatch(options = {}) {
  const authority = new AsyncLocalStorage();
  const transport = options.transport ?? createTelegramTransport();
  const watch = createPublicWatch({ ...options, inspectPage: telegramPageLinks,
    transport: (url, limits) => transport(url, { ...limits, authorize: authority.getStore() }) });
  const run = (endpoint, limits = {}) => authority.run(limits.authorize, () => watch(endpoint, limits));
  run.requiresRobots = watch.requiresRobots;
  return run;
}

export async function runTelegramPageCycle(db, { load, watch, now = Date.now, random = noJitter }) {
  const started = now();
  expireTelegramLinks(db, started);
  let config, active;
  try { config = load(); active = telegramPageCandidates(config, started); }
  catch { return { status: 'CONFIG_HOLD', links: 0 }; }
  prune(db, active, started, telegramLinkExclusions(config));
  if (!active.size) return { status: 'RIGHTS_HOLD', links: 0 };
  // t.me is one host for every channel: its minimum gap plus a random 0-3s per visit.
  const hostDelay = hostGap(Math.max(...[...active.values()].map(grant => grant.hostDelay)), random);
  const getHost = db.prepare('SELECT next_at FROM telegram_page_host WHERE id=1');
  const setHost = db.prepare('INSERT INTO telegram_page_host VALUES (1,?) ON CONFLICT(id) DO UPDATE SET next_at=max(next_at,excluded.next_at)');
  const byId = new Map(db.prepare('SELECT endpoint_id, next_at FROM telegram_page_schedule').all().map(x => [x.endpoint_id, x.next_at]));
  const sorted = [...active].sort(([a], [b]) => (byId.get(a) ?? 0) - (byId.get(b) ?? 0));
  const [id, grant] = sorted[0];
  db.exec('BEGIN IMMEDIATE');
  try {
    if ((getHost.get()?.next_at ?? 0) > started || (byId.get(id) ?? 0) > started) {
      db.exec('ROLLBACK');
      return { status: 'WAIT', links: 0 };
    }
    setHost.run(started + hostDelay);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }

  const authorize = () => {
    try { return telegramPageCandidates(load(), now()).get(id)?.binding === grant.binding; }
    catch { return false; }
  };
  let check;
  try {
    if (!authorize()) return { status: 'RIGHTS_HOLD', links: 0 };
    check = await watch(grant.endpoint, { hostDelay, timeoutMs: grant.timeoutMs, maxBytes: grant.maxBytes, authorize });
  } catch { check = { status: 'FAILED', reason: 'WATCH_FAILED' }; }
  const finished = now();
  const backoff = Math.max(check.delayMs ?? 0,
    check.httpStatus === 429 ? 15 * minute : [401, 403, 451].includes(check.httpStatus) ? 60 * minute : 0);
  setHost.run(Math.max(retryAfterTime(check.retryAfter, finished), finished + Math.max(hostDelay, backoff)));
  db.prepare('INSERT INTO telegram_page_schedule VALUES (?,?) ON CONFLICT(endpoint_id) DO UPDATE SET next_at=excluded.next_at')
    .run(id, finished + (check.status === 'ROBOTS_READY' ? hostDelay : 10 * minute));

  let currentConfig, current;
  try { currentConfig = load(); current = telegramPageCandidates(currentConfig, finished); }
  catch { return { status: 'CONFIG_HOLD', links: 0 }; }
  const exclusions = telegramLinkExclusions(currentConfig);
  prune(db, current, finished, exclusions);
  if (current.get(id)?.binding !== grant.binding) return { status: 'RIGHTS_HOLD', links: 0 };
  const record = (status, links = 0) => {
    db.prepare(`INSERT INTO telegram_page_diagnostics VALUES (?,?,?,?,?,?,?) ON CONFLICT(endpoint_id)
      DO UPDATE SET binding=excluded.binding,observed_at=excluded.observed_at,status=excluded.status,
      http_status=excluded.http_status,reason=excluded.reason,observed_links=excluded.observed_links`)
      .run(id, grant.binding, finished, status, check.httpStatus ?? null, check.reason ?? null, links);
    return { status, links };
  };
  if (check.status !== 'WATCH_INSPECTED') return record(check.status);
  if (check.observation?.valid !== true || !Array.isArray(check.observation.links)) return record('PAGE_UNVERIFIED');
  // Only a newer post than the last one seen counts as new. Quiet channels are revisited after 10, 20, then 30 minutes.
  const latestPost = check.observation.latestPost;
  const prior = db.prepare('SELECT latest_post, quiet_visits FROM telegram_page_activity WHERE endpoint_id=? AND binding=?').get(id, grant.binding);
  if (Number.isSafeInteger(latestPost) && prior && latestPost <= prior.latest_post) {
    const quiet = Math.min(prior.quiet_visits + 1, 2);
    db.prepare('UPDATE telegram_page_activity SET quiet_visits=? WHERE endpoint_id=?').run(quiet, id);
    db.prepare('UPDATE telegram_page_schedule SET next_at=? WHERE endpoint_id=?').run(finished + 10 * minute * (quiet + 1), id);
    return record('NO_NEW_POSTS');
  }
  const urls = [...new Set(check.observation.links.filter(item => typeof item === 'string').map(externalUrl)
    .filter(url => url && !excludedTelegramLink(url, exclusions)))].slice(0, 100);
  const insert = db.prepare(`INSERT INTO telegram_page_links VALUES (?,?,?,?,?) ON CONFLICT(endpoint_id,url)
    DO UPDATE SET binding=excluded.binding,last_seen=excluded.last_seen,expires_at=excluded.expires_at`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const url of urls) insert.run(id, grant.binding, url, finished, Math.min(grant.expires, finished + grant.retention));
    if (Number.isSafeInteger(latestPost)) db.prepare(`INSERT INTO telegram_page_activity VALUES (?,?,?,0) ON CONFLICT(endpoint_id)
      DO UPDATE SET binding=excluded.binding,latest_post=excluded.latest_post,quiet_visits=0`).run(id, grant.binding, latestPost);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return record(check.observation.truncated || check.observation.links.length > 100 ? 'PARTIAL' : 'LINKS_OBSERVED', urls.length);
}

const escape = value => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
export function renderTelegramLinks(db, timestamp) {
  const rows = db.prepare(`SELECT url, max(last_seen) AS seen FROM telegram_page_links
    WHERE expires_at > ? GROUP BY url ORDER BY seen DESC,url LIMIT 300`).all(timestamp);
  const list = rows.map(({ url }) => `<li><a href="${escape(url)}" target="_blank" rel="noopener noreferrer">${escape(url)}</a></li>`);
  return `<!doctype html><html lang="ko"><meta charset="utf-8">
<meta name="referrer" content="no-referrer"><title>텔레그램 원문 링크</title>
<h1>텔레그램 원문 링크</h1>${list.length ? '<ul>' + list.join('') + '</ul>' : '<p>수집된 원문 링크가 없습니다.</p>'}</html>`;
}

async function main() {
  const directory = process.env.JUDOJU_TELEGRAM_DATA ?? '/telegram-data';
  const db = openTelegramPageStore(join(directory, 'links.sqlite'));
  const read = name => JSON.parse(readFileSync(new URL('../../data/providers/' + name, import.meta.url), 'utf8'));
  const load = () => ({ ...read('routes.json'), profiles: read('permission-profiles.json').profiles });
  const watch = createTelegramPageWatch();
  const stop = new AbortController();
  process.once('SIGTERM', () => stop.abort());
  process.once('SIGINT', () => stop.abort());
  try {
    do {
      const status = await runTelegramPageCycle(db, { load, watch, random: Math.random });
      writeFileSync(join(directory, 'links.html.pending'), renderTelegramLinks(db, Date.now()), { mode: 0o600 });
      renameSync(join(directory, 'links.html.pending'), join(directory, 'links.html'));
      console.log(JSON.stringify({ event: 'TELEGRAM_PAGE_LINK_CYCLE', ...status }));
      if (process.argv[2] === '--once') break;
      await sleep(minute, undefined, { signal: stop.signal }).catch(error => {
        if (!stop.signal.aborted) throw error;
      });
    } while (!stop.signal.aborted);
  } finally { db.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(() => {
    console.error('TELEGRAM_PAGE_LINK_WORKER_FAILED');
    process.exitCode = 1;
  });
}
