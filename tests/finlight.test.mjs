// Finlight discovery (2026-11-28): Korean sources, key only in the X-API-KEY header, day and month budgets in the DB,
// signal-only recording with tickers, second page only when the first is full, abort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createFinlightClient, MAX_PER_DAY, MAX_PER_31_DAYS, SOURCES } from '../workers/ai-processing/runtime/finlight.mjs';

const KEY = 'sk_' + 'a'.repeat(40), NOW = Date.parse('2026-11-28T05:00:00Z');
const art = (n, companies = []) => ({ link: `https://www.yna.co.kr/view/${n}`, title: '기사 ' + n, summary: 's', content: 'full', publishDate: '2026-11-28T04:30:00Z', source: 'www.yna.co.kr', companies });
function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'fl-'));
  const store = new BacklogStore(join(dir, 'p.sqlite'));
  return Promise.resolve(fn(store)).finally(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
}

test('a pass: Korean sources, header-only key, tickers kept, bodies dropped, signals without jobs', () => withStore(async store => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url: String(url), init, body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ articles: [art(1, [{ ticker: '078930', exchange: 'XKRX', name: 'GS' }, { ticker: 'bad ticker!', exchange: 'XKRX' }]), art(2), { ...art(3), link: 'javascript:x' }] }) }; };
  const r = await createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl, now: () => NOW }).pass();
  assert.equal(calls.length, 1, 'no second page when the first is not full');
  assert.ok(!calls[0].url.includes(KEY) && calls[0].init.headers['X-API-KEY'] === KEY && calls[0].init.redirect === 'error');
  assert.deepEqual(calls[0].body.sources, SOURCES); assert.equal(calls[0].body.language, 'ko'); assert.equal(calls[0].body.includeEntities, true);
  assert.equal(r.entries.length, 2);
  assert.deepEqual(r.entries[0].tickers, ['XKRX:078930']);
  assert.ok(r.entries.every(e => !('summary' in e) && !('content' in e)));
  assert.deepEqual(store.recordNewsSignals(r.entries, NOW), { added: 2, updated: 0, rejected: 0 });
  assert.equal(store.db.prepare('SELECT count(*) n FROM jobs').get().n, 0);
  assert.equal(store.db.prepare('SELECT tickers FROM news_signals WHERE url=?').get('https://www.yna.co.kr/view/1').tickers, '["XKRX:078930"]');
}));

test('a full first page fetches a second page; day and month budgets hold across restarts', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fl-')), file = join(dir, 'p.sqlite');
  try {
    let pages = [];
    const full = async (url, init) => { const b = JSON.parse(init.body); pages.push(b.page); return { ok: true, json: async () => ({ articles: b.page === 1 ? Array.from({ length: 100 }, (_, i) => art(i)) : [art(500)] }) }; };
    let store = new BacklogStore(file);
    try { const r = await createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => NOW }).pass(); assert.deepEqual(pages, [1, 2]); assert.equal(r.entries.length, 101); }
    finally { store.close(); }
    store = new BacklogStore(file);
    try {
      store.db.prepare('UPDATE finlight_ledger SET used=? WHERE day=?').run(MAX_PER_DAY, '2026-11-28');
      await assert.rejects(createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => NOW }).pass(), /FINLIGHT_BUDGET/);
      store.db.prepare('INSERT INTO finlight_ledger VALUES (?,?)').run('2026-11-27', MAX_PER_31_DAYS);
      await assert.rejects(createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => NOW + 86400000 }).pass(), /FINLIGHT_BUDGET/, 'rolling 31-day cap, also across a calendar month boundary');
      await assert.rejects(createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => Date.parse('2026-12-01T01:00:00Z') }).pass(), /FINLIGHT_BUDGET/, 'no reset on the 1st');
      pages = [];
      await createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => Date.parse('2026-12-28T01:00:00Z') }).pass();
      assert.deepEqual(pages, [1, 2], 'usage older than 30 days leaves the window');
    } finally { store.close(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('errors carry no key; key format checked; an in-flight request stops with the service', () => withStore(async store => {
  await assert.rejects(createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: async () => ({ ok: false, status: 429 }), now: () => NOW }).pass(), e => e.message === 'FINLIGHT_HTTP_429');
  assert.throws(() => createFinlightClient({ apiKey: 'short', db: store.db }), /FINLIGHT_KEY_INVALID/);
  const stop = new AbortController();
  const pending = createFinlightClient({ apiKey: KEY, db: store.db, now: () => NOW, signal: stop.signal,
    fetchImpl: (url, init) => new Promise((_, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true })) }).pass();
  setTimeout(() => stop.abort(), 20);
  await assert.rejects(pending);
}));

test('a second page that fails keeps the first page (partial)', () => withStore(async store => {
  store.db.exec('CREATE TABLE IF NOT EXISTS finlight_ledger(day TEXT PRIMARY KEY,used INTEGER NOT NULL) STRICT');
  store.db.prepare('INSERT INTO finlight_ledger VALUES (?,?)').run('2026-11-28', MAX_PER_DAY - 1);
  const full = async (url, init) => ({ ok: true, json: async () => ({ articles: Array.from({ length: 100 }, (_, i) => art(i)) }) });
  const r = await createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => NOW }).pass();
  assert.equal(r.entries.length, 100); assert.equal(r.partial, 'FINLIGHT_BUDGET');
  const flaky = async (url, init) => { const b = JSON.parse(init.body); return b.page === 1 ? { ok: true, json: async () => ({ articles: Array.from({ length: 100 }, (_, i) => art(i)) }) } : { ok: false, status: 503 }; };
  const r2 = await createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: flaky, now: () => NOW + 86400000 }).pass();
  assert.equal(r2.entries.length, 100); assert.equal(r2.partial, 'FINLIGHT_HTTP_503');
}));

test('Telegram news links: covered only for Finlight sources or outlets GNews returned in the last 30 days', () => withStore(store => {
  assert.equal(store.newsOutletCovered('https://yna.co.kr/view/1', SOURCES, NOW), true, 'www-less Finlight source');
  assert.equal(store.newsOutletCovered('https://www.hankyung.com/x', SOURCES, NOW), true);
  assert.equal(store.newsOutletCovered('https://news.other.co.kr/x', SOURCES, NOW), false);
  assert.equal(store.newsOutletCovered('https://m.yna.co.kr/view/1', SOURCES, NOW), true, 'mobile host of a Finlight outlet');
  assert.equal(store.newsOutletCovered('https://news.chosun.com/x', SOURCES, NOW), false, 'a sibling subdomain of a Finlight outlet is not assumed');
  store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://www.reuters.com/a', title: 't', lastSeen: NOW, expiresAt: NOW + 7 * 86400000 }], NOW);
  assert.equal(store.newsOutletCovered('https://m.reuters.com/b', SOURCES, NOW), true, 'mobile host of the same outlet');
  assert.equal(store.newsOutletCovered('https://markets.reuters.com/b', SOURCES, NOW), false, 'other subdomains are not assumed');
  store.recordNewsSignals([{ sourceId: 'gnews:kr', url: 'https://paper-a.blogspot.com/a', title: 't', lastSeen: NOW, expiresAt: NOW + 7 * 86400000 }], NOW);
  assert.equal(store.newsOutletCovered('https://paper-b.blogspot.com/a', SOURCES, NOW), false, 'shared hosting tenants stay apart');
  // A Finlight-only signal is not GNews coverage.
  store.recordNewsSignals([{ sourceId: 'finlight:kr', url: 'https://www.fl-only.com/a', title: 't', lastSeen: NOW, expiresAt: NOW + 7 * 86400000 }], NOW);
  assert.equal(store.newsOutletCovered('https://www.fl-only.com/b', SOURCES, NOW), false);
  // The 7-day signal is gone after day 8, but GNews coverage lasts 30 days.
  store.maintain({ sources: [] }, NOW + 10 * 86400000);
  assert.equal(store.db.prepare("SELECT count(*) n FROM news_signals WHERE host='www.reuters.com'").get().n, 0);
  assert.equal(store.newsOutletCovered('https://www.reuters.com/b', SOURCES, NOW + 10 * 86400000), true, 'day 10');
  store.maintain({ sources: [] }, NOW + 31 * 86400000);
  assert.equal(store.newsOutletCovered('https://www.reuters.com/b', SOURCES, NOW + 31 * 86400000), false, 'stale GNews coverage expires');
  assert.equal(store.db.prepare('SELECT count(*) n FROM news_outlets').get().n, 0, 'maintenance deletes stale outlets');
  assert.equal(store.newsOutletCovered('not a url', SOURCES, NOW), false);
  assert.match(store.db.prepare('EXPLAIN QUERY PLAN SELECT 1 FROM news_outlets WHERE domain=? AND gnews_seen>?').all('a.com', 0).map(r => r.detail).join(' '), /USING (PRIMARY KEY|INDEX)/);
}));

test('news-report opens the database read-only', async () => {
  const { spawnSync } = await import('node:child_process');
  const dir = mkdtempSync(join(tmpdir(), 'nr-')), file = join(dir, 'p.sqlite');
  try {
    const store = new BacklogStore(file); store.close();
    const before = (await import('node:fs')).statSync(file).mtimeMs;
    const r = spawnSync(process.execPath, ['--experimental-strip-types', 'workers/ai-processing/runtime/cli.mjs', 'news-report', '--db', file], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1)).families);
    assert.equal((await import('node:fs')).statSync(file).mtimeMs, before, 'file unchanged');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
