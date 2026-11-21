import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isIP } from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { setTimeout as sleep } from 'node:timers/promises';
import { parse } from 'parse5';
import { normalizeArticleUrl, permissionDecision, permissionExpiry } from './policy.mjs';
import { createPublicWatch, retryAfterTime } from './public-watch.mjs';

const purposes = ['MACHINE_ACCESS', 'DISCOVERY', 'LINK_EXTRACTION', 'STORAGE'];
const heldRows = new Set([16, 19, 32, 36, 43, 48]);
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
  let valid = false;
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
    }
    if (!['script', 'style', 'noscript', 'template'].includes(node.tagName)) {
      for (const child of node.childNodes ?? []) nodes.push(child);
    }
  }
  return { valid, links: valid ? [...links].slice(0, 100) : [] };
}

export function telegramPageCandidates({ routes, endpoints, profiles }, timestamp) {
  const selected = new Set(routes.filter(route => route.effective_kind === 'TELEGRAM' &&
    !heldRows.has(route.original_row)).flatMap(route => route.endpoint_ids));
  const now = new Date(timestamp).toISOString();
  const active = new Map();
  for (const endpoint of endpoints) {
    if (!selected.has(endpoint.endpoint_id) || !channelPattern.test(endpoint.url)) continue;
    const profile = profiles.find(item => item.id === endpoint.permission_profile_id);
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
  `);
  return db;
}

function prune(db, active, timestamp) {
  db.prepare('DELETE FROM telegram_page_links WHERE expires_at <= ?').run(timestamp);
  const remove = db.prepare('DELETE FROM telegram_page_links WHERE endpoint_id = ? AND binding = ?');
  for (const row of db.prepare('SELECT DISTINCT endpoint_id, binding FROM telegram_page_links').all()) {
    if (active.get(row.endpoint_id)?.binding !== row.binding) remove.run(row.endpoint_id, row.binding);
  }
}

export const createTelegramPageWatch = options => createPublicWatch({ ...options, inspectPage: telegramPageLinks });

export async function runTelegramPageCycle(db, { load, watch, now = Date.now }) {
  const started = now();
  const active = telegramPageCandidates(load(), started);
  prune(db, active, started);
  if (!active.size) return { status: 'RIGHTS_HOLD', links: 0 };
  const hostDelay = Math.max(...[...active.values()].map(grant => grant.hostDelay));
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

  const check = await watch(grant.endpoint, { hostDelay, timeoutMs: grant.timeoutMs, maxBytes: grant.maxBytes });
  const finished = now();
  const backoff = Math.max(check.delayMs ?? 0,
    check.httpStatus === 429 ? 15 * minute : [401, 403, 451].includes(check.httpStatus) ? 60 * minute : 0);
  setHost.run(Math.max(retryAfterTime(check.retryAfter, finished), finished + Math.max(hostDelay, backoff)));
  db.prepare('INSERT INTO telegram_page_schedule VALUES (?,?) ON CONFLICT(endpoint_id) DO UPDATE SET next_at=excluded.next_at')
    .run(id, finished + (check.status === 'ROBOTS_READY' ? hostDelay : 10 * minute));

  const current = telegramPageCandidates(load(), finished);
  prune(db, current, finished);
  if (current.get(id)?.binding !== grant.binding) return { status: 'RIGHTS_HOLD', links: 0 };
  if (check.status !== 'WATCH_INSPECTED') return { status: check.status, links: 0 };
  if (!check.observation.valid) return { status: 'PAGE_UNVERIFIED', links: 0 };
  const insert = db.prepare(`INSERT INTO telegram_page_links VALUES (?,?,?,?,?) ON CONFLICT(endpoint_id,url)
    DO UPDATE SET binding=excluded.binding,last_seen=excluded.last_seen,expires_at=excluded.expires_at`);
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const url of check.observation.links) insert.run(id, grant.binding, url, finished, Math.min(grant.expires, finished + grant.retention));
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { status: 'LINKS_OBSERVED', links: check.observation.links.length };
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
      const status = await runTelegramPageCycle(db, { load, watch });
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
