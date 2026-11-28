// Sector news through GNews (docs/sector-news-plan.md §2): the pinned query file, KR/US slot plans, move ordering,
// starvation, macro rotation, per-call recording with topics in one transaction, partial failure, the 900 cap.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createGnewsClient, loadSectorQueries, SECTOR_QUERIES_SHA256, MAX_PER_DAY } from '../workers/ai-processing/runtime/gnews.mjs';

const KEY = '0123456789abcdef0123456789abcdef', NOW = Date.parse('2026-11-28T03:00:00Z');
const text = readFileSync(new URL('../data/sector-queries.json', import.meta.url), 'utf8');
const queries = loadSectorQueries(text);
const article = n => ({ title: 'T' + n, url: 'https://news.example.co.kr/a/' + n, publishedAt: '2026-11-28T02:00:00Z' });
function harness(t, { mode = 'US', moves = new Map(), fail = () => false } = {}) {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  let time = NOW, n = 0; const calls = [];
  const fetchImpl = async url => { const u = new URL(String(url)); calls.push(u); n++;
    if (fail(u, n)) return { ok: false, status: 500 };
    return { ok: true, json: async () => ({ articles: [article(n), article(1000)] }) }; };
  const client = createGnewsClient({ apiKey: KEY, db: store.db, fetchImpl, now: () => time, queries, market: () => ({ mode, moves }) });
  const pass = () => client.pass({ record: (entries, topic) => store.recordNewsSignals(entries, time, topic) });
  return { store, calls, pass, advance: ms => { time += ms; } };
}

test('the query file is used only when it matches the pinned hash', () => {
  assert.equal(createHash('sha256').update(text).digest('hex'), SECTOR_QUERIES_SHA256);
  assert.ok(queries.length > 100);
  assert.equal(loadSectorQueries(text.replace('"ko"', '"ko" ')), null, 'one changed byte disables sector search');
  assert.equal(loadSectorQueries(null), null);
});

test('US round: two headlines, sector-en, the legacy theme and (odd round) an English macro; key never in a URL', async t => {
  const h = harness(t);
  const even = await h.pass(), odd = await h.pass();
  assert.deepEqual(even.slots.map(s => s.kind), ['headline', 'headline', 'sector', 'sector', 'sector', 'theme']);
  assert.deepEqual(odd.slots.map(s => s.kind), ['headline', 'headline', 'sector', 'sector', 'theme', 'macro']);
  assert.ok(h.calls.every(u => !u.href.includes(KEY)));
  assert.ok(h.calls.filter(u => u.searchParams.get('q')?.startsWith('"')).every(u => u.searchParams.get('lang') === 'en'));
  assert.equal(h.calls.length, 12);
});

test('KR round: one slot for the most starved (never tried first) query, the rest by the size of the move; macro on odd rounds', async t => {
  const ko = queries.filter(q => q.locale === 'ko' && q.topic !== 'MACRO');
  const moves = new Map([[ko[5].topic, -4.2], [ko[9].topic, 1.1], [ko[2].topic, 3.0]]);
  const h = harness(t, { mode: 'KR', moves });
  const r = await h.pass();
  assert.deepEqual(r.slots.map(s => s.kind), ['headline', 'headline', 'sector', 'sector', 'sector', 'sector']);
  const starvedFirst = [...ko].sort((a, b) => (a.queryId < b.queryId ? -1 : 1))[0];
  const byMove = [ko[5], ko[2], ko[9]].filter(q => q !== starvedFirst);
  assert.deepEqual(r.slots.slice(2, 5).map(s => s.queryId), [starvedFirst.queryId, ...byMove.map(q => q.queryId)].slice(0, 3));
  assert.ok(h.calls.slice(2).every(u => u.searchParams.get('lang') === 'ko' && u.searchParams.get('country') === 'kr'));
  const odd = await h.pass();
  assert.equal(odd.slots.at(-1).kind, 'macro'); assert.match(odd.slots.at(-1).queryId, /^MACRO-\d:ko$/);
  // When every query was tried recently, the oldest one still gets the first slot.
  const all = h.store.db.prepare("SELECT query_id,last_attempted FROM gnews_queries WHERE query_id LIKE '%:ko' AND query_id NOT LIKE 'MACRO%'").all();
  for (const q of ko) h.store.db.prepare('INSERT INTO gnews_queries(query_id,last_attempted) VALUES (?,?) ON CONFLICT(query_id) DO UPDATE SET last_attempted=excluded.last_attempted').run(q.queryId, NOW + 60_000);
  h.store.db.prepare('UPDATE gnews_queries SET last_attempted=? WHERE query_id=?').run(NOW + 30_000, ko[40].queryId);
  h.advance(2 * 60_000); const recent = await h.pass(); void all;
  assert.equal(recent.slots[2].queryId, ko[40].queryId, 'the oldest attempt takes the first sector slot');
  // Every sector is reached: after enough rounds no Korean sector query is left untried, despite the moves.
  for (let i = 0; i < 60; i++) { h.advance(15 * 60_000); await h.pass(); }
  assert.equal(ko.filter(q => !h.store.db.prepare('SELECT 1 FROM gnews_queries WHERE query_id=?').get(q.queryId)).length, 0);
});

test('macro queries rotate by oldest attempt; a query untried for six hours goes first', async t => {
  const h = harness(t);
  const macros = [];
  for (let i = 0; i < 8; i++) { const r = await h.pass(); const m = r.slots.find(s => s.kind === 'macro'); if (m) macros.push(m.queryId); h.advance(15 * 60_000); }
  assert.deepEqual(macros, ['MACRO-1:en', 'MACRO-2:en', 'MACRO-3:en', 'MACRO-4:en']);
  // Starvation: mark one sector as tried 7 hours ago and every other as tried just now.
  const en = queries.filter(q => q.locale === 'en' && q.topic !== 'MACRO');
  h.store.db.prepare('UPDATE gnews_queries SET last_attempted=?').run(NOW + 2 * 3600_000);
  for (const q of en) h.store.db.prepare('INSERT INTO gnews_queries(query_id,last_attempted) VALUES (?,?) ON CONFLICT(query_id) DO UPDATE SET last_attempted=excluded.last_attempted').run(q.queryId, NOW + 2 * 3600_000);
  h.store.db.prepare('UPDATE gnews_queries SET last_attempted=? WHERE query_id=?').run(NOW + 2 * 3600_000 - 7 * 3600_000, en[7].queryId);
  const r = await h.pass();
  assert.equal(r.slots.find(s => s.kind === 'sector').queryId, en[7].queryId);
});

test('each call is recorded at once with its topic; a failed slot is skipped and the rest go on', async t => {
  const h = harness(t, { fail: (u, n) => n === 3 });
  const r = await h.pass();
  assert.equal(r.slots[2].failed, 'GNEWS_HTTP_500');
  assert.ok(r.slots.slice(3).every(s => !s.failed));
  const topics = h.store.db.prepare('SELECT count(DISTINCT query_id) q, count(*) n FROM news_signal_topics').get();
  assert.equal(topics.q, 2, 'two successful sector searches left provenance');
  // The same URL (article 1000) found by both searches keeps both origins.
  assert.equal(h.store.db.prepare("SELECT count(*) n FROM news_signal_topics WHERE url='https://news.example.co.kr/a/1000'").get().n, 2);
  const failed = h.store.db.prepare('SELECT last_attempted,last_succeeded FROM gnews_queries WHERE query_id=?').get(r.slots[2].queryId);
  assert.ok(failed.last_attempted > 0); assert.equal(failed.last_succeeded, 0);
});

test('topics are written in the signal transaction and removed with the signal', t => {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  const topic = { queryId: 'abc:ko', topic: 'abc', locale: 'ko' };
  assert.throws(() => store.recordNewsSignals([{ sourceId: 'gnews:sector-ko', url: 'https://x.example.com/1', title: 't', lastSeen: NOW, expiresAt: NOW + 86400000 }], NOW, { ...topic, locale: 'fr' }), /SIGNAL_TOPIC_INVALID/);
  assert.equal(store.db.prepare('SELECT count(*) n FROM news_signals').get().n, 0, 'nothing written');
  store.recordNewsSignals([{ sourceId: 'gnews:sector-ko', url: 'https://x.example.com/1', title: 't', lastSeen: NOW, expiresAt: NOW + 86400000 }], NOW, topic);
  assert.equal(store.db.prepare('SELECT count(*) n FROM news_signal_topics').get().n, 1);
  store.maintain({ sources: [] }, NOW + 2 * 86400000);
  assert.equal(store.db.prepare('SELECT count(*) n FROM news_signal_topics').get().n, 0, 'cascade with the expired signal');
});

test('the 900 cap: from 895 only the remaining requests are sent, at 900 none; a new UTC day starts again', async t => {
  const h = harness(t);
  h.store.db.prepare('INSERT INTO gnews_ledger VALUES (?,?,0)').run(new Date(NOW).toISOString().slice(0, 10), MAX_PER_DAY - 5);
  const r = await h.pass();
  assert.equal(h.calls.length, 5); assert.equal(r.slots.at(-1).failed, 'GNEWS_DAILY_BUDGET');
  await assert.rejects(h.pass(), /GNEWS_DAILY_BUDGET/);
  h.advance(86400000); await h.pass(); assert.equal(h.calls.length, 11);
});
