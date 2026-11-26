import assert from 'node:assert/strict';
import { test } from 'node:test';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createBacklogProcessor } from '../workers/ai-processing/runtime/pipeline.mjs';
import { createLinkResolver, metaRefreshTarget } from '../workers/ai-processing/runtime/resolver.mjs';
import { routeLink } from '../workers/ai-processing/runtime/routing.mjs';
import { validateConfig } from '../workers/ai-processing/runtime/contracts.mjs';
import { stamp, config, original, originalText } from './backlog-fixtures.mjs';

const day = 86_400_000;
const officialHost = 'ir.orion.co.kr';
function signalConfig() {
  const settings = config();
  settings.newsAsSignalOnly = true;
  settings.excludedDomains = ['hankyung.com'];
  settings.sources.push({ ...settings.sources[0], host: officialHost, id: 'orion-ir', kind: 'OFFICIAL', name: '오리온전자 IR' });
  return validateConfig(settings);
}
const response = (status, extra = {}) => ({ status, body: Buffer.from(extra.body ?? ''), contentType: extra.contentType ?? 'text/plain', ...extra });

test('links route by destination: short links resolve, official/report hosts are evidence, news is a signal, shops are dropped', () => {
  const settings = signalConfig();
  assert.equal(routeLink('https://buly.kr/abc', settings), 'REDIRECT');
  assert.equal(routeLink('https://news.google.com/rss/articles/x', settings), 'REDIRECT');
  assert.equal(routeLink('https://www.amazon.de/dp/1', settings), 'IRRELEVANT');
  assert.equal(routeLink(`https://${officialHost}/news/1`, settings), 'EVIDENCE');
  // A NEWS-kind grant does not make news readable under the signal-only policy.
  assert.equal(routeLink('https://news.publisher.co.kr/article/one', settings), 'SIGNAL');
  assert.equal(routeLink('https://www.reuters.com/markets/x', settings), 'SIGNAL');
  assert.equal(routeLink('https://www.hankyung.com/article/1', settings), 'EXCLUDED');
  assert.equal(routeLink('https://msg.ls-sec.co.kr/r/1', settings), 'EVIDENCE');
  assert.equal(routeLink('https://dart.fss.or.kr/dsaf001/main.do', settings), 'EVIDENCE');
  assert.throws(() => validateConfig({ ...config(), newsAsSignalOnly: 'yes' }), /INVALID_SWITCH/);
});

test('the resolver reads only a redirect target, honours robots and host spacing, and never contacts other hosts', async () => {
  let time = stamp; const requests = [], slots = new Map();
  const replies = { 'https://buly.kr/robots.txt': response(404), 'https://buly.kr/abc': response(302, { location: 'https://www.reuters.com/markets/x?utm_source=tg' }),
    'https://han.gl/robots.txt': response(200, { body: 'User-agent: *\nDisallow: /private' }), 'https://han.gl/private': response(302, { location: 'https://x.co.kr/' }),
    'https://vo.la/robots.txt': response(404), 'https://vo.la/m': response(200, { contentType: 'text/html', body: '<meta http-equiv="refresh" content="0; url=https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1">' }),
    'https://vo.la/n': response(429, { retryAfter: '600' }) };
  const resolve = createLinkResolver({ now: () => time, transport: async target => { requests.push(target); return replies[target] ?? response(500); } });
  const reserveHost = (host, at, delay, extend) => {
    const until = slots.get(host) ?? 0;
    if (!extend && until > at) return { allowed: false, nextAt: until };
    slots.set(host, Math.max(until, at + delay)); return { allowed: true, nextAt: at + delay };
  };
  const run = (url, hops = 0) => resolve({ url, hops, enabled: true, authorize: () => true, reserveHost });
  assert.equal((await run('https://buly.kr/abc')).state, 'DEFER');
  assert.equal((await run('https://buly.kr/abc')).state, 'DEFER'); // the 5s host slot still applies
  time += 5000;
  assert.deepEqual(await run('https://buly.kr/abc'), { state: 'RESOLVED', url: 'https://www.reuters.com/markets/x', hops: 1 });
  await run('https://han.gl/private'); time += 5000;
  assert.equal((await run('https://han.gl/private')).reason, 'ROBOTS_DENIED');
  await run('https://vo.la/m'); time += 5000;
  assert.equal((await run('https://vo.la/m')).url, 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=1');
  time += 5000;
  assert.equal((await run('https://vo.la/n')).reason, 'RATE_LIMIT');
  assert.equal((await run('https://www.reuters.com/markets/x')).reason, 'NOT_A_SHORT_LINK');
  assert.equal((await run('https://buly.kr/abc', 4)).reason, 'REDIRECT_LIMIT');
  assert.equal((await resolve({ url: 'https://buly.kr/abc', enabled: false, authorize: () => true, reserveHost })).reason, 'LINK_RESOLUTION_NOT_ENABLED');
  assert(requests.every(url => /^https:\/\/(buly\.kr|han\.gl|vo\.la)\//.test(url)), requests.join(','));
  assert.equal(metaRefreshTarget('<p>no refresh</p>', 'https://vo.la/x'), null);
});

test('with the signal-only policy, news is recorded without reading and only official destinations are fetched', async t => {
  const store = new BacklogStore(':memory:'); t.after(() => store.close());
  const settings = signalConfig(); const reads = [], resolved = new Map([
    ['https://buly.kr/news', 'https://www.reuters.com/markets/x'], ['https://han.gl/ir', `https://${officialHost}/news/1`]]);
  const processor = createBacklogProcessor({ store, loadConfig: () => settings, now: () => stamp,
    model: async () => ({ classification: 'UNCLEAR', newCatalyst: false, koreanImpact: false, articleKind: 'SECTOR', sectorIds: [],
      event: { family: 'OTHER', entityIds: [], date: null, period: null, officialId: null, refs: [] }, facts: [], impacts: [], reason: 'fixture' }),
    resolveLink: async ({ url, hops }) => ({ state: 'RESOLVED', url: resolved.get(url), hops: hops + 1 }),
    readOriginal: async request => { reads.push(request.url); return original(originalText, request.url); } });
  const add = (url, sourceId) => store.importLinks([{ url, sourceId, lastSeen: stamp, expiresAt: stamp + 7 * day }], stamp);
  add('https://buly.kr/news', 'channel-a'); add('https://han.gl/ir', 'channel-a'); add('https://www.amazon.de/dp/1', 'channel-b');
  add('https://www.reuters.com/markets/x', 'channel-b'); add('https://news.publisher.co.kr/article/one', 'channel-c');
  const states = []; for (let index = 0; index < 9; index++) { const result = await processor.step(); if (result.state === 'IDLE') break; states.push(result.state); }
  assert.deepEqual(reads, [`https://${officialHost}/news/1`]);
  const signals = store.db.prepare('SELECT url, host, sources FROM news_signals ORDER BY url').all().map(row => ({ ...row, sources: JSON.parse(row.sources) }));
  assert.deepEqual(signals, [
    { url: 'https://news.publisher.co.kr/article/one', host: 'news.publisher.co.kr', sources: ['channel-c'] },
    { url: 'https://www.reuters.com/markets/x', host: 'www.reuters.com', sources: ['channel-a', 'channel-b'] }]);
  assert.equal(store.db.prepare("SELECT count(*) n FROM jobs WHERE state='EXCLUDED'").get().n, 1);
  assert.equal(store.db.prepare('SELECT count(*) n FROM documents').get().n, 1);
  assert.deepEqual(store.status().newsSignals, { links: 2, topHosts: [{ host: 'news.publisher.co.kr', links: 1 }, { host: 'www.reuters.com', links: 1 }] });
  assert(states.includes('SIGNAL') && states.includes('TRIAGE'));
  // Signals expire with their links (7 days at most).
  store.maintain(settings, stamp + 8 * day);
  assert.equal(store.db.prepare('SELECT count(*) n FROM news_signals').get().n, 0);
});
