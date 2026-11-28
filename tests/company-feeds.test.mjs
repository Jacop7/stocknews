// Company press/newsroom/IR feed discovery (2026-11-28): sitemaps and announced RSS feeds, recent news-like links only,
// robots.txt and grants honoured, one host per call, each host once a day, no network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { BacklogStore } from '../workers/ai-processing/runtime/store.mjs';
import { createCompanyFeedDiscovery, parseFeed, announcedFeeds } from '../workers/ai-processing/runtime/company-feeds.mjs';

const day = 86400000, NOW = Date.parse('2026-11-28T03:00:00Z');
const iso = ms => new Date(ms).toISOString();
const grant = host => ({ host, id: 'g-' + host, version: 'v', name: host, status: 'ENABLED', kind: 'OFFICIAL', basis: 'EXPLICIT_INTERNAL_REVIEW',
  publicationAuthorized: false, evidence: ['test'], expiresAt: null, revokedAt: null, retentionDays: 7, provenanceVerified: true, originGroupId: null, newsroomId: null, ownerGroupId: null });
const config = (over = {}) => ({ readOriginals: true, excludedDomains: [], excludedUrls: [], sources: [grant('corp.example.com'), grant('dart.fss.or.kr')], ...over });

function site(pages) {
  const calls = [];
  const transport = async url => {
    calls.push(url);
    const page = pages[url];
    if (!page) return { status: 404, body: Buffer.alloc(0), contentType: 'text/html' };
    return { status: page.status ?? 200, location: page.location ?? null, contentType: page.type, body: Buffer.from(page.body ?? '') };
  };
  return { transport, calls };
}
function withStore(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'cf-'));
  const store = new BacklogStore(join(dir, 'p.sqlite'));
  return Promise.resolve(fn(store)).finally(() => { store.close(); rmSync(dir, { recursive: true, force: true }); });
}
// The clock moves only when the discovery waits for the same-host gap (as real time would).
const discovery = (store, transport, at = NOW) => { let t = at; return createCompanyFeedDiscovery({ transport, store, now: () => t, sleep: async ms => { t += ms; } }); };

test('parsers: sitemap index, urlset, RSS, Atom and announced feeds', () => {
  assert.equal(parseFeed('<sitemapindex><sitemap><loc>https://a/x.xml</loc><lastmod>2026-11-27</lastmod></sitemap></sitemapindex>').items[0].url, 'https://a/x.xml');
  const rss = parseFeed('<rss><channel><item><title><![CDATA[보도 & 자료]]></title><link>https://a/n/1</link><pubDate>Thu, 27 Nov 2026 01:00:00 GMT</pubDate></item></channel></rss>');
  assert.deepEqual(rss.items[0], { url: 'https://a/n/1', at: Date.parse('2026-11-27T01:00:00Z'), title: '보도 & 자료' });
  assert.equal(parseFeed('<feed><entry><link href="https://a/e"/><updated>2026-11-27T00:00:00Z</updated><title>t</title></entry></feed>').items[0].url, 'https://a/e');
  assert.deepEqual(announcedFeeds('<html><head><link rel="alternate" type="application/rss+xml" href="/feed"></head></html>', 'https://a/'), ['https://a/feed']);
});

test('robots sitemap: only recent news-like links on granted hosts; robots-disallowed paths skipped; pacing reserved', () => withStore(async store => {
  const o = 'https://corp.example.com';
  const { transport, calls } = site({
    [o + '/robots.txt']: { type: 'text/plain', body: `User-agent: *\nDisallow: /private/\nSitemap: ${o}/sitemap.xml\n` },
    [o + '/']: { type: 'text/html', body: '<html><head><link rel="alternate" type="application/rss+xml" href="/rss"></head></html>' },
    [o + '/sitemap.xml']: { type: 'application/xml', body: `<urlset>
      <url><loc>${o}/news/2026/11/27/new-plant</loc><lastmod>${iso(NOW - day)}</lastmod></url>
      <url><loc>${o}/news/2026/10/01/old</loc><lastmod>${iso(NOW - 30 * day)}</lastmod></url>
      <url><loc>${o}/products/widget</loc><lastmod>${iso(NOW - day)}</lastmod></url>
      <url><loc>${o}/private/news/secret</loc><lastmod>${iso(NOW - day)}</lastmod></url>
      <url><loc>https://other.example.org/news/x</loc><lastmod>${iso(NOW - day)}</lastmod></url>
      <url><loc>${o}/ir/notice/q3-results</loc><lastmod>${iso(NOW - 2 * day)}</lastmod></url></urlset>` },
    [o + '/rss']: { type: 'application/rss+xml', body: `<rss><channel><item><title>New contract</title><link>${o}/board/view?id=9</link><pubDate>${new Date(NOW - day).toUTCString()}</pubDate></item>
      <item><title>Old</title><link>${o}/board/view?id=1</link><pubDate>${new Date(NOW - 20 * day).toUTCString()}</pubDate></item></channel></rss>` },
  });
  const found = await discovery(store, transport)({ loadConfig: () => config() });
  assert.equal(found.host, 'corp.example.com');
  assert.equal(found.state, 'FOUND');
  assert.deepEqual(found.links.map(l => l.url).sort(), [o + '/board/view?id=9', o + '/ir/notice/q3-results', o + '/news/2026/11/27/new-plant'].sort());
  assert.ok(found.links.every(l => l.sourceId === 'company:corp.example.com' && l.expiresAt === NOW + 7 * day));
  assert.ok(found.requests <= 6 && calls.length === found.requests);
  assert.ok(!calls.some(u => u.includes('/private/')), 'robots-disallowed URL never requested');
  assert.ok(store.db.prepare('SELECT next_at FROM host_slots WHERE host=?').get('corp.example.com').next_at >= NOW + 5000 * found.requests, 'same-host pacing: 5 s between requests');
  // Imported as ordinary jobs for the original reader.
  assert.equal(store.importLinks(found.links, NOW).added, 3);
}));

test('once a day per host; DART is never crawled; off when originals are off', () => withStore(async store => {
  const o = 'https://corp.example.com';
  const { transport, calls } = site({ [o + '/robots.txt']: { type: 'text/plain', body: '' } });
  const run = discovery(store, transport);
  assert.equal((await run({ loadConfig: () => config({ readOriginals: false }) })).state, 'OFF');
  assert.equal(calls.length, 0);
  const first = await run({ loadConfig: () => config() });
  assert.equal(first.host, 'corp.example.com');
  assert.equal(first.state, 'NO_RECENT');
  const second = await run({ loadConfig: () => config() });
  assert.equal(second.state, 'IDLE', 'the same host is not visited again within a day; DART is not a feed host');
  assert.ok(!calls.some(u => u.includes('dart')));
  const nextDay = await discovery(store, transport, NOW + day + 1)({ loadConfig: () => config() });
  assert.equal(nextDay.host, 'corp.example.com');
}));

test('robots.txt that disallows everything and lists no sitemap stops the host for the day', () => withStore(async store => {
  const o = 'https://corp.example.com';
  const { transport, calls } = site({ [o + '/robots.txt']: { type: 'text/plain', body: 'User-agent: *\nDisallow: /\n' } });
  const r = await discovery(store, transport)({ loadConfig: () => config() });
  assert.equal(r.state, 'NO_RECENT', 'nothing beyond robots.txt is requested');
  assert.deepEqual(calls, [o + '/robots.txt']);
}));

test('redirects only to granted hosts; ungranted hosts are never requested', () => withStore(async store => {
  const o = 'https://corp.example.com';
  const { transport, calls } = site({
    [o + '/robots.txt']: { type: 'text/plain', body: '' },
    [o + '/']: { status: 301, location: 'https://elsewhere.example.net/' },
    [o + '/sitemap.xml']: { status: 302, location: 'https://cdn.example.net/sitemap.xml' },
  });
  const r = await discovery(store, transport)({ loadConfig: () => config() });
  assert.equal(r.state, 'NO_RECENT');
  assert.ok(!calls.some(u => u.includes('example.net')));
}));

// Codex review fixes (2026-11-28).
test('cross-host: feeds, redirects and links on another enabled host are never requested or queued', () => withStore(async store => {
  const o = 'https://corp.example.com', other = 'https://other.example.com';
  const cfg = () => config({ sources: [grant('corp.example.com'), grant('other.example.com')] });
  const { transport, calls } = site({
    [o + '/robots.txt']: { type: 'text/plain', body: `Sitemap: ${other}/sitemap.xml\n` },
    [o + '/']: { status: 301, location: other + '/' },
    [o + '/sitemap.xml']: { type: 'application/xml', body: `<urlset><url><loc>${other}/news/x</loc><lastmod>${iso(NOW - day)}</lastmod></url><url><loc>${o}/news/y</loc><lastmod>${iso(NOW - day)}</lastmod></url></urlset>` },
    [other + '/robots.txt']: { type: 'text/plain', body: 'User-agent: *\nDisallow: /\n' },
  });
  const r = await discovery(store, transport)({ loadConfig: cfg });
  assert.equal(r.host, 'corp.example.com');
  assert.deepEqual(r.links.map(l => l.url), [o + '/news/y']);
  assert.ok(!calls.some(u => u.startsWith(other)), 'no request to the other host');
}));

test('RSS/Atom entries need a date inside the window: undated, stale and future items are dropped', () => withStore(async store => {
  const o = 'https://corp.example.com';
  const item = (id, date) => `<item><title>t${id}</title><link>${o}/n/${id}</link>${date ? `<pubDate>${new Date(date).toUTCString()}</pubDate>` : ''}</item>`;
  const { transport } = site({
    [o + '/robots.txt']: { type: 'text/plain', body: '' },
    [o + '/']: { type: 'text/html', body: '<link rel="alternate" type="application/rss+xml" href="/rss">' },
    [o + '/rss']: { type: 'application/rss+xml', body: `<rss><channel>${item(1, NOW - day)}${item(2, null)}${item(3, NOW - 9 * day)}${item(4, NOW + 3 * day)}</channel></rss>` },
  });
  const r = await discovery(store, transport)({ loadConfig: () => config() });
  assert.deepEqual(r.links.map(l => l.url), [o + '/n/1']);
}));

test('a malformed percent-encoded URL is skipped without failing the host', () => withStore(async store => {
  const o = 'https://corp.example.com';
  const { transport } = site({
    [o + '/robots.txt']: { type: 'text/plain', body: '' },
    [o + '/sitemap.xml']: { type: 'application/xml', body: `<urlset><url><loc>${o}/news/%ZZ</loc><lastmod>${iso(NOW - day)}</lastmod></url><url><loc>${o}/news/ok</loc><lastmod>${iso(NOW - day)}</lastmod></url></urlset>` },
  });
  const r = await discovery(store, transport)({ loadConfig: () => config() });
  assert.equal(r.state, 'FOUND');
  assert.deepEqual(r.links.map(l => l.url), [o + '/news/ok']);
}));

test('the day is reserved before any request: a failed or interrupted host waits for the next day', () => withStore(async store => {
  const o = 'https://corp.example.com';
  const transport = async () => { throw new Error('network down'); };
  const run = discovery(store, transport);
  assert.equal((await run({ loadConfig: () => config() })).state, 'FAILED');
  assert.equal((await discovery(store, transport, NOW + 7 * 3600_000)({ loadConfig: () => config() })).state, 'IDLE', 'not retried after 6 hours');
  assert.equal(store.db.prepare('SELECT next_at FROM company_feeds WHERE host=?').get('corp.example.com').next_at, NOW + day);
  assert.equal(o, 'https://corp.example.com');
}));

test('parsing is linear and bounded: 4 MiB of unterminated entries or DTDs is cheap', () => {
  const evil = '<rss>' + '<item><title>x'.repeat(300000);
  const t = Date.now(); const r = parseFeed(evil);
  assert.ok(Date.now() - t < 500, 'took ' + (Date.now() - t) + ' ms');
  assert.equal(r.items.length, 0);
  assert.equal(parseFeed('<!DOCTYPE x [<!ENTITY a "b">]><rss><item><link>https://a/n</link></item></rss>').kind, 'UNKNOWN');
  const many = '<urlset>' + `<url><loc>https://a/news/1</loc><lastmod>2026-11-27</lastmod></url>`.repeat(5000) + '</urlset>';
  assert.equal(parseFeed(many).items.length, 500);
});

test('the background loop runs beside processing and stops on abort', async () => {
  const { startCompanyFeedLoop } = await import('../workers/ai-processing/runtime/company-feeds.mjs');
  const stop = new AbortController(); let calls = 0; const logs = [];
  const loop = startCompanyFeedLoop({ discoverOne: async () => { calls++; return { host: 'h', state: 'NO_RECENT', requests: 1, links: [] }; },
    loadConfig: () => ({}), importLinks: () => ({}), log: x => logs.push(x), signal: stop.signal,
    sleep: ms => new Promise((resolve, reject) => { const t = setTimeout(resolve, 5); stop.signal.addEventListener('abort', () => { clearTimeout(t); reject(new Error('aborted')); }, { once: true }); }) });
  await new Promise(r => setTimeout(r, 30));
  stop.abort(); await loop;
  assert.ok(calls >= 2 && logs.every(l => l.event === 'AI_COMPANY_FEED'));
});
