// Company press releases, newsrooms and IR pages (owner decision 2026-11-28: every company website is enabled).
// Discovery only: once a day per enabled company host, the site's own feeds are read — the sitemaps it lists in
// robots.txt (or /sitemap.xml) and the RSS/Atom feeds its home page announces — and links published in the last
// 7 days are queued as ordinary jobs. Each article is then read by the original reader (robots.txt, same-host pacing,
// grants), exactly like any other link. Nothing here reads article bodies.
// Politeness (Codex review 2026-11-28): every request stays on the discovered host itself (no cross-host feeds,
// redirects or links, so that host's robots.txt and crawl delay always apply); robots.txt is honoured per request with
// the reader's agent; at least 5 seconds (or the crawl delay) between requests; at most 6 requests per host per day,
// with the day reserved before any request (failures and restarts wait for the next day).
// Parsing is linear and bounded: at most 1 MiB of each feed is scanned with indexOf (no backtracking regex over the
// document), at most 500 entries, entries larger than 64 KiB are skipped, no DTD or entity expansion.
import robotsParser from 'robots-parser';
import { parse } from 'parse5';
import { urlKey, sourceGrant, day } from './contracts.mjs';

export const AGENT = 'JudojuNews-OriginalReview/1.0';
const WINDOW = 7 * day, SKEW = 3600_000, MAX_REQUESTS = 6, MAX_LINKS = 20, MAX_FEEDS = 3;
const SCAN_BYTES = 1024 * 1024, MAX_ENTRIES = 500, MAX_ENTRY = 64 * 1024;
// Pages that look like news, press, IR or notices (paths are compared decoded and lower-cased).
const NEWSY = /(^|[\/_.-])(news|newsroom|press|pressrelease|release|media|pr|ir|investor|investors|notice|notices|announcement|board|story|stories|보도|보도자료|뉴스|공지|공시)([\/_.-]|$)/i;
const ASSET = /\.(jpe?g|png|gif|svg|webp|css|js|zip|mp4|mp3|ico|woff2?)$/i;

const unescape = value => value.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").trim();
function inner(raw) {
  const s = raw.trim();
  if (s.startsWith('<![CDATA[')) { const end = s.indexOf(']]>'); return end < 0 ? '' : s.slice(9, end).trim(); }
  return unescape(s);
}
// The text of the first <name ...>...</name> (optionally namespaced, e.g. dc:date) inside a bounded entry.
function child(entry, names) {
  const lower = entry.toLowerCase();
  for (const name of names) {
    let from = 0;
    while (from < lower.length) {
      const open = lower.indexOf('<' + name, from);
      if (open < 0) break;
      const after = lower[open + name.length + 1];
      if (after !== '>' && after !== ' ' && after !== '/' && after !== '\t' && after !== '\n' && after !== '\r') { from = open + 1; continue; }
      const gt = lower.indexOf('>', open);
      if (gt < 0) break;
      if (lower[gt - 1] === '/') return { attrs: entry.slice(open, gt + 1), text: '' };
      const close = lower.indexOf('</' + name + '>', gt);
      if (close < 0) break;
      return { attrs: entry.slice(open, gt + 1), text: inner(entry.slice(gt + 1, close)) };
    }
  }
  return null;
}
const when = value => { const t = value ? Date.parse(value) : NaN; return Number.isFinite(t) ? t : null; };
// Entries of one element name, scanned left to right once; an unterminated entry ends the scan.
function entries(doc, lower, name) {
  const out = [];
  let pos = 0;
  while (out.length < MAX_ENTRIES) {
    const open = lower.indexOf('<' + name, pos);
    if (open < 0) break;
    const c = lower[open + name.length + 1];
    if (c !== '>' && c !== ' ' && c !== '\t' && c !== '\n' && c !== '\r') { pos = open + 1; continue; }
    const close = lower.indexOf('</' + name + '>', open);
    if (close < 0) break;
    if (close - open <= MAX_ENTRY) out.push(doc.slice(open, close));
    pos = close + name.length + 3;
  }
  return out;
}

// Sitemap (urlset or sitemapindex), RSS or Atom. Returns { kind, items: [{ url, at, title }] }.
export function parseFeed(xml) {
  const doc = xml.slice(0, SCAN_BYTES), lower = doc.toLowerCase();
  if (lower.includes('<!doctype') || lower.includes('<!entity')) return { kind: 'UNKNOWN', items: [] };
  const map = (list, f) => list.map(f).filter(x => x.url);
  if (lower.includes('<sitemapindex')) return { kind: 'INDEX', items: map(entries(doc, lower, 'sitemap'), e => ({ url: child(e, ['loc'])?.text ?? null, at: when(child(e, ['lastmod'])?.text), title: '' })) };
  if (lower.includes('<urlset')) return { kind: 'URLSET', items: map(entries(doc, lower, 'url'), e => ({ url: child(e, ['loc'])?.text ?? null, at: when(child(e, ['lastmod'])?.text), title: '' })) };
  if (lower.includes('<rss') || lower.includes('<rdf:rdf')) return { kind: 'RSS', items: map(entries(doc, lower, 'item'), e => ({ url: child(e, ['link'])?.text ?? null, at: when(child(e, ['pubdate', 'dc:date'])?.text), title: child(e, ['title'])?.text ?? '' })) };
  if (lower.includes('<feed')) return { kind: 'ATOM', items: map(entries(doc, lower, 'entry'), e => {
    const link = child(e, ['link']), href = link ? /href\s*=\s*"([^"]{1,2000})"/i.exec(link.attrs)?.[1] ?? null : null;
    return { url: href ? unescape(href) : null, at: when(child(e, ['published', 'updated'])?.text), title: child(e, ['title'])?.text ?? '' };
  }) };
  return { kind: 'UNKNOWN', items: [] };
}

// RSS/Atom feeds announced by a home page (<link rel="alternate" type="application/rss+xml" href=...>).
export function announcedFeeds(html, base) {
  const out = [], nodes = [parse(html.slice(0, SCAN_BYTES))];
  while (nodes.length && out.length < 10) {
    const node = nodes.pop();
    if (node.tagName === 'link') {
      const a = Object.fromEntries((node.attrs ?? []).map(x => [x.name, x.value]));
      if (/alternate/i.test(a.rel ?? '') && /application\/(rss|atom)\+xml/i.test(a.type ?? '') && a.href) { try { out.push(new URL(a.href, base).href); } catch { /* ignore */ } }
    }
    if (node.tagName !== 'script') for (const childNode of node.childNodes ?? []) nodes.push(childNode);
  }
  return [...new Set(out)];
}

export function createCompanyFeedDiscovery({ transport, store, now = Date.now, sleep = ms => new Promise(r => setTimeout(r, ms)), signal }) {
  store.db.exec(`CREATE TABLE IF NOT EXISTS company_feeds(host TEXT PRIMARY KEY,next_at INTEGER NOT NULL,state TEXT NOT NULL,found INTEGER NOT NULL,updated_at INTEGER NOT NULL) STRICT`);
  // Hosts due for discovery: enabled OFFICIAL grants that are not DART (DART is read through its API).
  function dueHost(config, at) {
    const hosts = config.sources.filter(s => s.kind === 'OFFICIAL' && s.status === 'ENABLED' && !s.revokedAt && !/(^|\.)dart\.fss\.or\.kr$/.test(s.host) && sourceGrant(config, `https://${s.host}/`, at)).map(s => s.host);
    const next = new Map(store.db.prepare('SELECT host,next_at FROM company_feeds').all().map(r => [r.host, r.next_at]));
    return hosts.filter(h => (next.get(h) ?? 0) <= at).sort((a, b) => (next.get(a) ?? 0) - (next.get(b) ?? 0) || a.localeCompare(b))[0] ?? null;
  }
  // The day is reserved before the first request; the outcome only updates the state (never an earlier retry).
  function record(host, at, state, found) {
    store.db.prepare(`INSERT INTO company_feeds VALUES (?,?,?,?,?) ON CONFLICT(host) DO UPDATE SET next_at=max(company_feeds.next_at,excluded.next_at),state=excluded.state,found=excluded.found,updated_at=excluded.updated_at`)
      .run(host, at + day, state, found, now());
  }

  // One host per call. Returns { host, state, requests, links } where links are importLinks entries.
  return async function discoverOne({ loadConfig }) {
    const config = loadConfig(), at = now();
    if (!config.readOriginals) return { state: 'OFF' };
    const host = dueHost(config, at);
    if (!host) return { state: 'IDLE' };
    record(host, at, 'RUNNING', 0);
    const origin = `https://${host}`;
    let requests = 0, rules = null, gap = 5000;
    const sameHost = url => { try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === host && !u.port; } catch { return false; } };
    const granted = url => { try { return Boolean(sourceGrant(loadConfig(), url, now())); } catch { return false; } };
    const allowed = url => sameHost(url) && granted(url) && (!rules || rules.isAllowed(url, AGENT) !== false);
    async function get(url, maxBytes, redirects = 0) {
      if (requests >= MAX_REQUESTS || signal?.aborted || !allowed(url)) return null;
      let slot = store.reserveHost(host, now(), gap);
      if (!slot.allowed) {
        await sleep(Math.max(0, slot.nextAt - now()));
        if (signal?.aborted) return null;
        slot = store.reserveHost(host, now(), gap);
        if (!slot.allowed) return null;
      }
      requests++;
      const r = await transport(url, { timeoutMs: 8000, maxBytes, signal: AbortSignal.timeout(8000), authorize: () => allowed(url) && loadConfig().readOriginals });
      if ([301, 302, 303, 307, 308].includes(r.status) && r.location && redirects < 2) {
        let next; try { next = new URL(r.location, url).href; } catch { return null; }
        return get(next, maxBytes, redirects + 1);
      }
      return r.status === 200 ? { url, body: r.body, contentType: r.contentType ?? '' } : { url, status: r.status };
    }
    try {
      // robots.txt first (shared with the original reader's cache).
      const stored = store.loadRobots(origin, at);
      if (stored && stored.until > at) { rules = robotsParser(origin + '/robots.txt', stored.body); gap = Math.max(5000, stored.delay ?? 0); }
      else {
        const r = await get(origin + '/robots.txt', 65536);
        if (!r) { record(host, at, 'NOT_REACHED', 0); return { host, state: 'NOT_REACHED', requests, links: [] }; }
        if (r.status && ![404, 410].includes(r.status)) { record(host, at, 'ROBOTS_UNAVAILABLE', 0); return { host, state: 'ROBOTS_UNAVAILABLE', requests, links: [] }; }
        // A 200 robots.txt that is not plain text cannot be read: treated as unavailable (as the original reader does).
        if (!r.status && !/^text\/plain(?:;|$)/i.test(r.contentType)) { record(host, at, 'ROBOTS_UNREADABLE', 0); return { host, state: 'ROBOTS_UNREADABLE', requests, links: [] }; }
        const body = r.body ? r.body.toString('utf8') : '';
        rules = robotsParser(origin + '/robots.txt', body);
        const delay = (rules.getCrawlDelay(AGENT) ?? 0) * 1000;
        gap = Math.max(5000, delay);
        // The site's crawl delay applies from this request on (the reservation made for robots.txt used 5 s).
        store.reserveHost(host, now(), gap, true);
        store.saveRobots(origin, { body, delay, until: at + day });
      }
      // Feeds on this host only: sitemaps from robots.txt (else /sitemap.xml), then feeds the home page announces.
      const feeds = rules.getSitemaps().filter(u => sameHost(u) && !/\.gz$/i.test(u)).slice(0, MAX_FEEDS);
      if (!feeds.length) feeds.push(origin + '/sitemap.xml');
      const home = await get(origin + '/', 1024 * 1024);
      if (home?.body && /text\/html/i.test(home.contentType)) for (const f of announcedFeeds(home.body.toString('utf8'), home.url)) if (sameHost(f) && feeds.length < MAX_FEEDS + 2) feeds.push(f);
      const found = new Map(), since = at - WINDOW, until = at + SKEW;
      const take = (item, requireNewsy) => {
        let u, path;
        try { u = urlKey(new URL(item.url, origin).href); path = decodeURIComponent(new URL(u).pathname).toLowerCase(); } catch { return; }
        if (ASSET.test(path) || !allowed(u)) return;
        // Every entry needs a real date inside the window (no undated, stale or future items).
        if (item.at === null || item.at < since || item.at > until) return;
        if (requireNewsy && !NEWSY.test(path)) return;
        if (found.size < MAX_LINKS && !found.has(u)) found.set(u, item.title ?? '');
      };
      for (let i = 0; i < feeds.length && requests < MAX_REQUESTS && found.size < MAX_LINKS; i++) {
        const r = await get(feeds[i], 4 * 1024 * 1024);
        if (!r?.body) continue;
        const feed = parseFeed(r.body.toString('utf8'));
        if (feed.kind === 'INDEX') {
          // Newest child sitemaps first, preferring news-like ones (one level only: children are never indexes).
          const kids = feed.items.filter(k => sameHost(k.url) && !/\.gz$/i.test(k.url) && k.at !== null && k.at >= since && k.at <= until)
            .sort((a, b) => Number(NEWSY.test(b.url)) - Number(NEWSY.test(a.url)) || b.at - a.at);
          for (const k of kids.slice(0, 2)) if (feeds.length < MAX_FEEDS + 4) feeds.push(k.url);
        } else if (feed.kind !== 'UNKNOWN') for (const item of feed.items) take(item, feed.kind === 'URLSET');
      }
      const links = [...found].map(([url, title]) => ({ sourceId: 'company:' + host, url, title: String(title).slice(0, 300), lastSeen: at, expiresAt: at + WINDOW }));
      record(host, at, links.length ? 'FOUND' : 'NO_RECENT', links.length);
      return { host, state: links.length ? 'FOUND' : 'NO_RECENT', requests, links };
    } catch {
      record(host, at, 'FAILED', 0);
      return { host, state: 'FAILED', requests, links: [] };
    }
  };
}

// Background loop (separate from the processing loop, which keeps its own pace and heartbeat): one host per minute.
export function startCompanyFeedLoop({ discoverOne, loadConfig, importLinks, log, signal, every = 60_000, sleep }) {
  return (async () => {
    while (!signal.aborted) {
      try {
        const found = await discoverOne({ loadConfig });
        if (found.host) log({ event: 'AI_COMPANY_FEED', host: found.host, state: found.state, requests: found.requests ?? 0, links: found.links.length, ...(found.links.length ? importLinks(found.links) : {}) });
      } catch { log({ event: 'AI_COMPANY_FEED_FAILED' }); }
      await sleep(every).catch(() => {});
    }
  })();
}
