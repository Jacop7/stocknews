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
  assert.equal(r.state, 'ROBOTS_DENIED');
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
