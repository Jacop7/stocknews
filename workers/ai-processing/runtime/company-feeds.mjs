// Company press releases, newsrooms and IR pages (owner decision 2026-11-28: every company website is enabled).
// Discovery only: once a day per enabled company host, the site's own feeds are read — the sitemaps it lists in
// robots.txt (or /sitemap.xml) and the RSS/Atom feeds its home page announces — and links published in the last
// 7 days are queued as ordinary jobs. Each article is then read by the original reader (robots.txt, same-host pacing,
// grants), exactly like any other link. Nothing here reads article bodies.
// Politeness: robots.txt is honoured for every request (same agent as the reader), at least 5 seconds (or the site's
// crawl delay) between requests to the same host, at most 6 requests per host per day, one host per call.
import robotsParser from 'robots-parser';
import { parse } from 'parse5';
import { urlKey, sourceGrant, day } from './contracts.mjs';

export const AGENT = 'JudojuNews-OriginalReview/1.0';
const WINDOW = 7 * day, MAX_REQUESTS = 6, MAX_LINKS = 20, MAX_FEEDS = 3;
// Pages that look like news, press, IR or notices (paths are compared decoded and lower-cased).
const NEWSY = /(^|[\/_.-])(news|newsroom|press|pressrelease|release|media|pr|ir|investor|investors|notice|notices|announcement|board|story|stories|보도|보도자료|뉴스|공지|공시)([\/_.-]|$)/i;
const ASSET = /\.(jpe?g|png|gif|svg|webp|css|js|zip|mp4|mp3|ico|woff2?)$/i;

const text = value => value.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
const tag = (block, name) => { const m = new RegExp(`<(?:[a-z]+:)?${name}\\b[^>]*>([\\s\\S]*?)</(?:[a-z]+:)?${name}>`, 'i').exec(block); return m ? text(m[1]) : null; };
const when = value => { const t = value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : null; };

// Sitemap (urlset or sitemapindex), RSS or Atom. Returns { kind, items: [{ url, at, title }] }.
export function parseFeed(xml) {
  if (/<sitemapindex\b/i.test(xml)) return { kind: 'INDEX', items: [...xml.matchAll(/<sitemap\b[^>]*>([\s\S]*?)<\/sitemap>/gi)].map(m => ({ url: tag(m[1], 'loc'), at: when(tag(m[1], 'lastmod')), title: '' })).filter(x => x.url) };
  if (/<urlset\b/i.test(xml)) return { kind: 'URLSET', items: [...xml.matchAll(/<url\b[^>]*>([\s\S]*?)<\/url>/gi)].map(m => ({ url: tag(m[1], 'loc'), at: when(tag(m[1], 'lastmod')), title: '' })).filter(x => x.url) };
  if (/<rss\b|<rdf:RDF\b/i.test(xml)) return { kind: 'RSS', items: [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map(m => ({ url: tag(m[1], 'link'), at: when(tag(m[1], 'pubDate') ?? tag(m[1], 'date')), title: tag(m[1], 'title') ?? '' })).filter(x => x.url) };
  if (/<feed\b/i.test(xml)) return { kind: 'ATOM', items: [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map(m => ({ url: (/<link\b[^>]*href="([^"]+)"/i.exec(m[1]) ?? [])[1] ?? null, at: when(tag(m[1], 'published') ?? tag(m[1], 'updated')), title: tag(m[1], 'title') ?? '' })).filter(x => x.url) };
  return { kind: 'UNKNOWN', items: [] };
}

// RSS/Atom feeds announced by a home page (<link rel="alternate" type="application/rss+xml" href=...>).
export function announcedFeeds(html, base) {
  const out = [], nodes = [parse(html)];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.tagName === 'link') {
      const a = Object.fromEntries((node.attrs ?? []).map(x => [x.name, x.value]));
      if (/alternate/i.test(a.rel ?? '') && /application\/(rss|atom)\+xml/i.test(a.type ?? '') && a.href) { try { out.push(new URL(a.href, base).href); } catch { /* ignore */ } }
    }
    if (node.tagName !== 'script') for (const child of node.childNodes ?? []) nodes.push(child);
  }
  return [...new Set(out)];
}

export function createCompanyFeedDiscovery({ transport, store, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  // Hosts due for discovery: enabled OFFICIAL grants that are not DART (DART is read through its API).
  function dueHost(config, at) {
    store.db.exec(`CREATE TABLE IF NOT EXISTS company_feeds(host TEXT PRIMARY KEY,next_at INTEGER NOT NULL,state TEXT NOT NULL,found INTEGER NOT NULL,updated_at INTEGER NOT NULL) STRICT`);
    const hosts = config.sources.filter(s => s.kind === 'OFFICIAL' && s.status === 'ENABLED' && !s.revokedAt && !/(^|\.)dart\.fss\.or\.kr$/.test(s.host) && sourceGrant(config, `https://${s.host}/`, at)).map(s => s.host);
    const next = new Map(store.db.prepare('SELECT host,next_at FROM company_feeds').all().map(r => [r.host, r.next_at]));
    return hosts.filter(h => (next.get(h) ?? 0) <= at).sort((a, b) => (next.get(a) ?? 0) - (next.get(b) ?? 0) || a.localeCompare(b))[0] ?? null;
  }
  function record(host, at, state, found, retryIn = day) {
    store.db.prepare(`INSERT INTO company_feeds VALUES (?,?,?,?,?) ON CONFLICT(host) DO UPDATE SET next_at=excluded.next_at,state=excluded.state,found=excluded.found,updated_at=excluded.updated_at`)
      .run(host, at + retryIn, state, found, at);
  }

  // One host per call. Returns { host, state, links } where links are importLinks entries.
  return async function discoverOne({ loadConfig }) {
    const config = loadConfig(), at = now();
    if (!config.readOriginals) return { state: 'OFF' };
    const host = dueHost(config, at);
    if (!host) return { state: 'IDLE' };
    let requests = 0, rules = null, gap = 5000;
    const granted = url => { try { return Boolean(sourceGrant(loadConfig(), url, now())); } catch { return false; } };
    async function get(url, maxBytes, redirects = 0) {
      if (requests >= MAX_REQUESTS) return null;
      if (!granted(url)) return null;
      if (rules && rules.isAllowed(url, AGENT) === false) return null;
      const h = new URL(url).hostname;
      const slot = store.reserveHost(h, now(), gap);
      if (!slot.allowed) { await sleep(Math.min(30_000, Math.max(0, slot.nextAt - now()))); if (!store.reserveHost(h, now(), gap).allowed) return null; }
      requests++;
      const r = await transport(url, { timeoutMs: 8000, maxBytes, signal: AbortSignal.timeout(8000), authorize: () => granted(url) && loadConfig().readOriginals });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.location && redirects < 2) return get(new URL(r.location, url).href, maxBytes, redirects + 1);
      return r.status === 200 ? { url, body: r.body, contentType: r.contentType ?? '' } : { url, status: r.status };
    }
    try {
      // robots.txt first (shared with the original reader's cache).
      const origin = `https://${host}`;
      const stored = store.loadRobots(origin, at);
      if (stored && stored.until > at) { rules = robotsParser(origin + '/robots.txt', stored.body); gap = Math.max(5000, stored.delay ?? 0); }
      else {
        const r = await get(origin + '/robots.txt', 65536);
        if (!r) { record(host, at, 'NOT_REACHED', 0, 6 * 3600_000); return { host, state: 'NOT_REACHED', links: [] }; }
        if (r.status && ![404, 410].includes(r.status)) { record(host, at, 'ROBOTS_UNAVAILABLE', 0); return { host, state: 'ROBOTS_UNAVAILABLE', links: [] }; }
        const body = r.body && /^text\/plain/i.test(r.contentType) ? r.body.toString('utf8') : '';
        rules = robotsParser(origin + '/robots.txt', body);
        const delay = (rules.getCrawlDelay(AGENT) ?? 0) * 1000;
        gap = Math.max(5000, delay);
        store.saveRobots(origin, { body, delay, until: at + day });
      }
      if (rules.isAllowed(origin + '/', AGENT) === false && rules.getSitemaps().length === 0) { record(host, at, 'ROBOTS_DENIED', 0); return { host, state: 'ROBOTS_DENIED', links: [] }; }
      // Feeds: sitemaps from robots.txt (else /sitemap.xml), then feeds the home page announces.
      const feeds = rules.getSitemaps().filter(u => /^https:/i.test(u) && !/\.gz$/i.test(u)).slice(0, MAX_FEEDS);
      if (!feeds.length) feeds.push(origin + '/sitemap.xml');
      const home = await get(origin + '/', 1024 * 1024);
      if (home?.body && /text\/html/i.test(home.contentType)) for (const f of announcedFeeds(home.body.toString('utf8'), home.url)) if (feeds.length < MAX_FEEDS + 2) feeds.push(f);
      const found = new Map(), since = at - WINDOW;
      const take = (item, requireNewsy) => {
        let u; try { u = urlKey(new URL(item.url, origin).href); } catch { return; }
        const path = decodeURIComponent(new URL(u).pathname).toLowerCase();
        if (ASSET.test(path) || !granted(u) || rules.isAllowed(u, AGENT) === false) return;
        if (item.at !== null && item.at < since) return;
        if (requireNewsy && (item.at === null || !NEWSY.test(path))) return;
        if (found.size < MAX_LINKS && !found.has(u)) found.set(u, item.title ?? '');
      };
      for (let i = 0; i < feeds.length && requests < MAX_REQUESTS; i++) {
        const r = await get(feeds[i], 4 * 1024 * 1024);
        if (!r?.body) continue;
        const feed = parseFeed(r.body.toString('utf8'));
        if (feed.kind === 'INDEX') {
          // Newest child sitemaps first, preferring news-like ones.
          const kids = feed.items.filter(k => !/\.gz$/i.test(k.url)).sort((a, b) => Number(NEWSY.test(b.url)) - Number(NEWSY.test(a.url)) || (b.at ?? 0) - (a.at ?? 0));
          for (const k of kids.slice(0, 2)) if (feeds.length < MAX_FEEDS + 4 && (k.at === null || k.at >= since)) feeds.push(k.url);
        } else for (const item of feed.items) take(item, feed.kind === 'URLSET');
      }
      const links = [...found].map(([url, title]) => ({ sourceId: 'company:' + host, url, title: title.slice(0, 300), lastSeen: at, expiresAt: at + WINDOW }));
      record(host, at, links.length ? 'FOUND' : 'NO_RECENT', links.length);
      return { host, state: links.length ? 'FOUND' : 'NO_RECENT', requests, links };
    } catch {
      record(host, at, 'FAILED', 0, 6 * 3600_000);
      return { host, state: 'FAILED', requests, links: [] };
    }
  };
}
