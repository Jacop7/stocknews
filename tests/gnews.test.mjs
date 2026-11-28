// GNews discovery (2026-11-28, Codex review fixes): key only in the X-Api-Key header, strict key format, a daily request
// ledger and query rotation that survive restarts, signal-only recording (no job, no fetch path), background loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createGnewsClient, startGnewsLoop, MAX_PER_DAY, QUERIES } from '../workers/ai-processing/runtime/gnews.mjs';

const KEY = '0123456789abcdef0123456789abcdef', NOW = Date.parse('2026-11-28T05:00:00Z');
const article = (n, extra = {}) => ({ title: 'T' + n, description: 'desc', content: 'full body ' + n, url: `https://news.example.com/a/${n}`, publishedAt: '2026-11-28T04:00:00Z', source: { name: 'S' }, ...extra });
function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'gn-'));
  const store = new BacklogStore(join(dir, 'p.sqlite'));
  return Promise.resolve(fn(store)).finally(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
}

test('one pass: US and Korean headlines plus the rotating query; key only in the header; entries without bodies', () => withStore(async store => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init }); return { ok: true, json: async () => ({ articles: [article(calls.length), article(calls.length + 10, { url: 'javascript:alert(1)' })] }) }; };
  const r = await createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl, now: () => NOW }).pass();
  assert.equal(calls.length, 3);
  assert.ok(calls.every(c => !c.url.includes(KEY) && c.init.headers['X-Api-Key'] === KEY && c.init.redirect === 'error'));
  assert.ok(calls[0].url.includes('country=us') && calls[1].url.includes('country=kr') && calls[1].url.includes('lang=ko'));
  assert.equal(new URL(calls[2].url).searchParams.get('q'), QUERIES[0]);
  assert.equal(r.entries.length, 3);
  for (const e of r.entries) assert.deepEqual(Object.keys(e).sort(), ['expiresAt', 'lastSeen', 'sourceId', 'title', 'url']);
}));

test('the daily budget and the query rotation survive restarts', () => withStore(async store => {
  let n = 0;
  const fetchImpl = async url => { n++; return { ok: true, json: async () => ({ articles: [] }) }; };
  const seen = [];
  for (let life = 0; life < 3; life++) {
    const c = createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl: async (url, init) => { if (String(url).includes('/search')) seen.push(new URL(String(url)).searchParams.get('q')); return fetchImpl(url, init); }, now: () => NOW });
    await c.pass();
  }
  assert.deepEqual(seen, QUERIES.slice(0, 3), 'a new process continues the rotation');
  const c = createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl, now: () => NOW });
  for (let i = 3; i < MAX_PER_DAY / 3; i++) await c.pass();
  await assert.rejects(createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl, now: () => NOW }).pass(), /GNEWS_DAILY_BUDGET/);
  assert.equal(n, MAX_PER_DAY, 'never more than the daily cap across process lifetimes');
  await createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl, now: () => NOW + 86400000 }).pass();
  assert.equal(n, MAX_PER_DAY + 3, 'a new UTC day starts a new count');
}));

test('signals only: recorded with title and time, no job created even for an official host; repeats refresh', () => withStore(async store => {
  const entries = [
    { sourceId: 'gnews:headlines-us-business', url: 'https://news.example.com/a/1', title: 'First', lastSeen: NOW - 3600_000, expiresAt: NOW + 7 * 86400000 },
    { sourceId: 'gnews:search', url: 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1', title: 'Official host', lastSeen: NOW, expiresAt: NOW + 7 * 86400000 },
    { sourceId: 'telegram:x', url: 'https://news.example.com/a/2', title: 'wrong source', lastSeen: NOW, expiresAt: NOW + 86400000 },
  ];
  assert.deepEqual(store.recordNewsSignals(entries, NOW), { added: 2, updated: 0, rejected: 1 });
  assert.equal(store.db.prepare('SELECT count(*) n FROM jobs').get().n, 0, 'nothing enters the reading queue');
  const row = store.db.prepare('SELECT * FROM news_signals WHERE url=?').get('https://news.example.com/a/1');
  assert.equal(row.title, 'First'); assert.equal(row.first_seen, NOW - 3600_000);
  store.recordNewsSignals([{ ...entries[0], sourceId: 'gnews:search', lastSeen: NOW }], NOW + 60_000);
  const again = store.db.prepare('SELECT * FROM news_signals WHERE url=?').get('https://news.example.com/a/1');
  assert.equal(again.last_seen, NOW + 60_000); assert.deepEqual(JSON.parse(again.sources), ['gnews:headlines-us-business', 'gnews:search']);
}));

test('errors never carry the key; the key format is strict; the loop stops on abort', () => withStore(async store => {
  const bad = createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl: async () => ({ ok: false, status: 403 }), now: () => NOW });
  await assert.rejects(bad.pass(), error => error.message === 'GNEWS_HTTP_403' && !error.message.includes(KEY));
  assert.throws(() => createGnewsClient({ apiKey: 'A'.repeat(32), db: store.db }), /GNEWS_KEY_INVALID/);
  const stop = new AbortController(), logs = [];
  const loop = startGnewsLoop({ client: { pass: async () => ({ entries: [], requestsToday: 1 }) }, record: () => ({ added: 0 }), log: x => logs.push(x), signal: stop.signal,
    sleep: () => new Promise((resolve, reject) => stop.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) });
  await new Promise(r => setTimeout(r, 10)); stop.abort(); await loop;
  assert.equal(logs[0].event, 'AI_GNEWS');
}));

// Codex re-review (2026-11-28).
test('mixed paths: after a GNews signal adds the title column, the Telegram/web signal path still records', () => withStore(async store => {
  store.recordNewsSignals([{ sourceId: 'gnews:search', url: 'https://news.example.com/g', title: 'G', lastSeen: NOW, expiresAt: NOW + 86400000 }], NOW);
  store.importLinks([{ sourceId: 'telegram:channel', url: 'https://news.example.com/t', title: 'T', lastSeen: NOW, expiresAt: NOW + 86400000 }], NOW);
  const job = store.claim(NOW);
  assert.equal(store.recordSignal(job, 'https://news.example.com/t', NOW).state, 'SIGNAL');
  assert.equal(store.db.prepare('SELECT count(*) n FROM news_signals').get().n, 2);
}));

test('restarts: the ledger and rotation persist when the database is closed and reopened; no query skipped at the cap', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'gn-')), file = join(dir, 'p.sqlite');
  const ok = async () => ({ ok: true, json: async () => ({ articles: [] }) });
  try {
    const seen = [];
    for (let life = 0; life < 3; life++) {
      const store = new BacklogStore(file);
      try { await createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl: async (url, init) => { if (String(url).includes('/search')) seen.push(new URL(String(url)).searchParams.get('q')); return ok(url, init); }, now: () => NOW }).pass(); }
      finally { store.close(); }
    }
    assert.deepEqual(seen, QUERIES.slice(0, 3));
    // At used=298 the two headline requests reach the cap; the search is refused and its query is not consumed.
    const store = new BacklogStore(file);
    try {
      store.db.prepare('UPDATE gnews_ledger SET used=298 WHERE day=?').run(new Date(NOW).toISOString().slice(0, 10));
      await assert.rejects(createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl: ok, now: () => NOW }).pass(), /GNEWS_DAILY_BUDGET/);
      const next = [];
      await createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl: async (url) => { if (String(url).includes('/search')) next.push(new URL(String(url)).searchParams.get('q')); return ok(); }, now: () => NOW + 86400000 }).pass();
      assert.deepEqual(next, [QUERIES[3]], 'the refused query is not skipped');
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('an in-flight request stops when the service stops', () => withStore(async store => {
  const stop = new AbortController();
  const hang = (url, init) => new Promise((resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }));
  const pending = createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl: hang, now: () => NOW, signal: stop.signal }).pass();
  setTimeout(() => stop.abort(), 20);
  const t = Date.now();
  await assert.rejects(pending);
  assert.ok(Date.now() - t < 2000, 'stopped promptly');
}));
