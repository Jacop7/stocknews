import assert from 'node:assert/strict';
import { test } from 'node:test';
import { parseOriginal, createOriginalReader, createOriginalTransport } from '../workers/ai-processing/runtime/original.mjs';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { digest } from '../workers/ai-processing/runtime/contracts.mjs';
import { stamp, config, originalText, url } from './backlog-fixtures.mjs';

const html = `<html><head><meta property="og:title" content="원문 시험"><meta property="article:published_time" content="2026-11-21T12:00:00+09:00"></head><body><nav>IGNORE NAV</nav><article>${originalText}<aside>IGNORE AD</aside></article></body></html>`;
const response = (status, body = '', contentType = 'text/plain', extra = {}) => ({ status, body: Buffer.from(body), contentType, ...extra });
function readerHarness(t, replies) {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  let time = stamp; const settings = config(), calls = [];
  const read = createOriginalReader({ now: () => time, transport: async (target, limits) => {
    calls.push(target); assert(limits.authorize()); return replies.shift();
  } });
  const invoke = (target = url) => read({ url: target, loadConfig: () => settings, expectedConfig: digest(settings),
    authorize: () => true, reserveHost: (...args) => store.reserveHost(...args) });
  return { invoke, calls, settings, advance: value => { time += value; } };
}

test('extracts identified article body and date, excludes navigation/ad blocks, refuses generic or truncated pages', () => {
  const result = parseOriginal(html, url); assert.equal(result.state, 'ORIGINAL');
  assert.equal(result.publishedAt, '2026-11-21T03:00:00.000Z'); assert(!result.text.includes('IGNORE'));
  assert.equal(parseOriginal('<h1>목록</h1><div>' + originalText + '</div>', url).state, 'HOLD');
  assert.equal(parseOriginal('<h1>제목</h1><article>' + '가'.repeat(40001) + '</article>', url).reason, 'BODY_PARTIAL_LIMIT');
  assert.equal(parseOriginal('<script type="application/ld+json">' + JSON.stringify({ '@type': 'Article', headline: {}, articleBody: originalText }) + '</script>', url).state, 'HOLD');
  assert.equal(parseOriginal('<h1>유료</h1><script type="application/ld+json">' + JSON.stringify({ '@type': 'NewsArticle', isAccessibleForFree: false, articleBody: originalText }) + '</script>', url).reason, 'RESTRICTED_ORIGINAL');
  assert.equal(parseOriginal('<h1>한글 긴 글</h1><article>' + '가'.repeat(22000) + '</article>', url).reason, 'BODY_PARTIAL_LIMIT');
});

test('separate once-style readers share persisted robots rules and reach the article on the next step', async t => {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  let time = stamp; const calls = [], c = config();
  const read = () => createOriginalReader({ now: () => time,
    loadRobots: (origin, now) => store.loadRobots(origin, now), saveRobots: (origin, value) => store.saveRobots(origin, value),
    transport: async target => { calls.push(target); return target.endsWith('/robots.txt') ? response(404) : response(200, html, 'text/html'); } });
  const args = { url, loadConfig: () => c, expectedConfig: digest(c), authorize: () => true, reserveHost: (...a) => store.reserveHost(...a) };
  assert.equal((await read()(args)).state, 'DEFER'); time += 6000;
  assert.equal((await read()(args)).state, 'ORIGINAL'); assert.equal(calls.length, 2); assert.equal(calls[1], url);
});

test('robots delay persists across jobs and blocked paths never receive an article request', async t => {
  const h = readerHarness(t, [response(200, 'User-agent: *\nDisallow: /blocked\nCrawl-delay: 20'), response(200, html, 'text/html')]);
  assert.equal((await h.invoke()).state, 'DEFER'); h.advance(5000);
  assert.equal((await h.invoke()).state, 'DEFER'); assert.equal(h.calls.length, 1);
  h.advance(15000); assert.equal((await h.invoke()).state, 'ORIGINAL');
  assert.equal((await h.invoke('https://news.publisher.co.kr/blocked')).reason, 'ROBOTS_DENIED'); assert.equal(h.calls.length, 2);
});

test('rate limits and login denial are held and redirects require a separately registered destination', async t => {
  const h = readerHarness(t, [response(404), response(302, '', 'text/html', { location: 'https://unregistered.publisher.co.kr/article' })]);
  await h.invoke(); h.advance(5000); assert.equal((await h.invoke()).reason, 'REDIRECT_SOURCE_UNREGISTERED');
  const blocked = readerHarness(t, [response(429, '', 'text/plain', { retryAfter: '60' })]);
  assert.equal((await blocked.invoke()).reason, 'RATE_LIMIT'); blocked.advance(60000);
  assert.equal((await blocked.invoke()).state, 'DEFER'); assert.equal(blocked.calls.length, 1);
  const denied = readerHarness(t, [response(403)]); assert.equal((await denied.invoke()).reason, 'ACCESS_DENIED');
});

test('PDF extraction is an explicit port, unsupported documents are not falsely marked complete', async t => {
  const h = readerHarness(t, [response(404), response(200, '%PDF fixture', 'application/pdf')]);
  await h.invoke(); h.advance(5000); assert.equal((await h.invoke()).reason, 'PDF_EXTRACTOR_REQUIRED');
  h.settings.sources[0].status = 'DISABLED'; assert.equal((await h.invoke()).reason, 'ORIGINAL_ACCESS_NOT_ENABLED');
});

test('DNS pinning rejects private answers and rechecks authorization after asynchronous resolution', async () => {
  let requests = 0;
  const request = async () => { requests++; return response(200); };
  const limits = { signal: AbortSignal.timeout(1000), authorize: () => true };
  const privateTransport = createOriginalTransport({ lookupHost: async () => [{ address: '127.0.0.1', family: 4 }], request });
  await assert.rejects(privateTransport(url, limits), /NON_PUBLIC_DNS/);
  let allowed = true;
  const revoked = createOriginalTransport({ lookupHost: async () => { allowed = false; return [{ address: '8.8.8.8', family: 4 }]; }, request });
  await assert.rejects(revoked(url, { ...limits, authorize: () => allowed }), /AUTHORITY_CHANGED/); assert.equal(requests, 0);
});
