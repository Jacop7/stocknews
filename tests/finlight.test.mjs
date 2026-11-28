// Finlight discovery (2026-11-28): Korean sources, key only in the X-API-KEY header, day and month budgets in the DB,
// signal-only recording with tickers, second page only when the first is full, abort.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createFinlightClient, MAX_PER_DAY, MAX_PER_MONTH, SOURCES } from '../workers/ai-processing/runtime/finlight.mjs';

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
      store.db.prepare('INSERT INTO finlight_ledger VALUES (?,?)').run('2026-11-27', MAX_PER_MONTH);
      await assert.rejects(createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => NOW + 86400000 }).pass(), /FINLIGHT_BUDGET/, 'monthly cap');
      pages = [];
      await createFinlightClient({ apiKey: KEY, db: store.db, fetchImpl: full, now: () => Date.parse('2026-12-01T01:00:00Z') }).pass();
      assert.deepEqual(pages, [1, 2], 'a new month starts a new count');
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
