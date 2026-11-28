// GNews discovery (2026-11-28): signal entries only (URL, title, time), daily request budget, key never in errors.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGnewsClient, MAX_PER_DAY, QUERIES } from '../workers/ai-processing/runtime/gnews.mjs';

const KEY = 'a'.repeat(32), NOW = Date.parse('2026-11-28T05:00:00Z');
const article = (n, extra = {}) => ({ title: 'T' + n, description: 'desc', content: 'full body ' + n, url: `https://news.example.com/a/${n}`, publishedAt: '2026-11-28T04:00:00Z', source: { name: 'S' }, ...extra });

test('one pass: three requests (US, Korea, rotating query), entries carry no description or content', async () => {
  const urls = [];
  const fetchImpl = async url => { urls.push(String(url)); return { ok: true, json: async () => ({ articles: [article(urls.length), article(urls.length + 10, { url: 'javascript:alert(1)' })] }) }; };
  const c = createGnewsClient({ apiKey: KEY, fetchImpl, now: () => NOW });
  const r = await c.pass();
  assert.equal(urls.length, 3);
  assert.ok(urls[0].includes('top-headlines') && urls[0].includes('country=us') && urls[1].includes('country=kr') && urls[1].includes('lang=ko'));
  assert.ok(urls[2].includes('search') && urls[2].includes(encodeURIComponent(QUERIES[0]).replace(/%20/g, '+').slice(0, 10)) || urls[2].includes('q='));
  assert.equal(r.entries.length, 3, 'non-http links dropped');
  for (const e of r.entries) {
    assert.deepEqual(Object.keys(e).sort(), ['expiresAt', 'lastSeen', 'sourceId', 'title', 'url']);
    assert.ok(e.sourceId.startsWith('gnews:'));
    assert.equal(e.expiresAt, NOW + 7 * 86400000);
  }
});

test('daily budget and errors that never contain the key', async () => {
  let n = 0;
  const ok = async () => { n++; return { ok: true, json: async () => ({ articles: [] }) }; };
  const c = createGnewsClient({ apiKey: KEY, fetchImpl: ok, now: () => NOW });
  for (let i = 0; i < MAX_PER_DAY / 3; i++) await c.pass();
  await assert.rejects(c.pass(), /GNEWS_DAILY_BUDGET/);
  assert.equal(n, MAX_PER_DAY);
  const bad = createGnewsClient({ apiKey: KEY, fetchImpl: async () => ({ ok: false, status: 403 }), now: () => NOW });
  await assert.rejects(bad.pass(), error => error.message === 'GNEWS_HTTP_403' && !error.message.includes(KEY));
  assert.throws(() => createGnewsClient({ apiKey: 'short' }), /GNEWS_KEY_INVALID/);
});
