import { lookup } from 'node:dns/promises';
import { parse } from 'parse5';
import robotsParser from 'robots-parser';
import { pinnedHttps, publicAddress } from '../../../scripts/providers/probe.mjs';
import { retryAfterTime } from '../../../scripts/providers/public-watch.mjs';
import { urlKey, digest, sourceGrant } from './contracts.mjs';

const agent = 'JudojuNews-OriginalReview/1.0';
const attr = (node, name) => node.attrs?.find(item => item.name === name)?.value ?? '';
const classes = node => attr(node, 'class').split(/\s+/);
const unwanted = new Set(['script', 'style', 'noscript', 'template', 'nav', 'footer', 'header', 'aside', 'form']);
function words(node) {
  if (unwanted.has(node.tagName)) return '';
  if (node.nodeName === '#text') return node.value;
  return (node.childNodes ?? []).map(words).join(['p', 'div', 'section', 'article', 'br'].includes(node.tagName) ? '\n' : '');
}
const clean = value => typeof value === 'string' ? value.replace(/[ \t\r]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim() : '';

export function parseOriginal(html, fetchedUrl) {
  const nodes = [parse(html)], meta = new Map(), bodies = [], headings = [], jsonArticles = [];
  let restricted = false;
  while (nodes.length) {
    const node = nodes.pop();
    if (classes(node).some(item => /^(?:paywall|subscription-wall|subscriber-only|login-required)$/i.test(item)) ||
        /^(?:paywall|subscription-wall|login-required)$/i.test(attr(node, 'id'))) restricted = true;
    if (node.tagName === 'meta') meta.set(attr(node, 'property') || attr(node, 'name'), attr(node, 'content'));
    if (node.tagName === 'h1') headings.push(clean(words(node)));
    if (node.tagName === 'article' || attr(node, 'itemprop') === 'articleBody' ||
        /^(?:articleBody|article-view-content-div|newsct_article)$/.test(attr(node, 'id')) ||
        classes(node).some(item => /^(?:article-body|article_body|article-content|news_body)$/.test(item))) bodies.push(clean(words(node)));
    if (node.tagName === 'script' && attr(node, 'type') === 'application/ld+json') {
      try {
        const raw = JSON.parse((node.childNodes ?? []).map(item => item.value ?? '').join(''));
        const pending = Array.isArray(raw) ? [...raw] : [raw];
        while (pending.length) {
          const item = pending.pop();
          if (item && typeof item === 'object') {
            if ([item['@type']].flat().some(type => ['NewsArticle', 'Article', 'Report'].includes(type))) jsonArticles.push(item);
            if (Array.isArray(item['@graph'])) pending.push(...item['@graph']);
          }
        }
      } catch { /* JSON-LD is data; malformed scripts do not execute. */ }
    }
    if (node.tagName !== 'script') for (const child of node.childNodes ?? []) nodes.push(child);
  }
  const linked = jsonArticles.find(item => typeof item.articleBody === 'string');
  if (restricted || jsonArticles.some(item => item.isAccessibleForFree === false || item.isAccessibleForFree === 'false')) return { state: 'HOLD', reason: 'RESTRICTED_ORIGINAL' };
  if (linked) bodies.push(clean(linked.articleBody));
  const title = clean(meta.get('og:title') || headings[0] || linked?.headline || '');
  const body = bodies.filter(value => value.length >= 100).sort((a, b) => b.length - a.length)[0];
  if (!title || !body) return { state: 'HOLD', reason: 'ARTICLE_BODY_NOT_IDENTIFIED' };
  if (body.length > 40000 || Buffer.byteLength(body, 'utf8') > 60000) return { state: 'HOLD', reason: 'BODY_PARTIAL_LIMIT' };
  const rawDate = meta.get('article:published_time') || meta.get('datePublished') || linked?.datePublished;
  const publishedAt = typeof rawDate === 'string' && /T.*(?:Z|[+-]\d\d:\d\d)$/.test(rawDate) && Number.isFinite(Date.parse(rawDate))
    ? new Date(rawDate).toISOString() : null;
  return { state: 'ORIGINAL', url: urlKey(fetchedUrl), title: title.slice(0, 500), text: body,
    publishedAt, bodyHash: digest(body.normalize('NFKC').replace(/\s+/g, ' ')) };
}

export function createOriginalTransport({ lookupHost = lookup, request = pinnedHttps } = {}) {
  return async (url, { authorize, ...limits }) => {
    urlKey(url);
    limits.signal.throwIfAborted();
    let abort;
    const cancelled = new Promise((_, reject) => {
      abort = () => reject(new Error('TIMEOUT'));
      limits.signal.addEventListener('abort', abort, { once: true });
    });
    try {
      const answers = await Promise.race([lookupHost(new URL(url).hostname, { all: true }), cancelled]);
      limits.signal.throwIfAborted();
      if (!answers.length || answers.some(item => !publicAddress(item.address))) throw new Error('NON_PUBLIC_DNS');
      if (!authorize()) throw new Error('AUTHORITY_CHANGED');
      return await request(url, { ...limits, resolvedAddresses: answers, userAgent: agent });
    } finally { limits.signal.removeEventListener('abort', abort); }
  };
}

export function createOriginalReader({ transport = createOriginalTransport(), now = Date.now, extractPdf,
  loadRobots = () => null, saveRobots = () => {} } = {}) {
  const robots = new Map();
  return async ({ url, redirects = 0, loadConfig, expectedConfig, authorize, reserveHost }) => {
    try {
      url = urlKey(url);
      const config = loadConfig(), grant = sourceGrant(config, url, now());
      if (digest(config) !== expectedConfig || !grant || !config.readOriginals || !authorize()) return { state: 'HOLD', reason: 'ORIGINAL_ACCESS_NOT_ENABLED' };
      const origin = new URL(url).origin;
      let cached = robots.get(origin);
      if (!cached || cached.until <= now()) {
        const stored = loadRobots(origin, now());
        if (stored && stored.until > now()) cached = { ...stored, rules: robotsParser(origin + '/robots.txt', stored.body) };
      }
      const preflight = !cached || cached.until <= now();
      if (!preflight && cached.rules.isAllowed(url, agent) === false) return { state: 'HOLD', reason: 'ROBOTS_DENIED' };
      const target = preflight ? origin + '/robots.txt' : url;
      const slot = reserveHost(new URL(target).hostname, now(), Math.max(5000, cached?.delay ?? 0));
      if (!slot.allowed) return { state: 'DEFER', nextAt: slot.nextAt, url, redirects };
      const response = await transport(target, { timeoutMs: 8000, maxBytes: preflight ? 65536 : 2 * 1024 * 1024,
        signal: AbortSignal.timeout(8000), authorize: () => authorize() && digest(loadConfig()) === expectedConfig && Boolean(sourceGrant(loadConfig(), url, now())) });
      if (!authorize() || digest(loadConfig()) !== expectedConfig) return { state: 'HOLD', reason: 'AUTHORITY_CHANGED' };
      if (response.status === 429 || [401, 403, 451].includes(response.status)) {
        const nextAt = Math.max(retryAfterTime(response.retryAfter, now()), now() + (response.status === 429 ? 900000 : 3600000));
        reserveHost(new URL(target).hostname, now(), nextAt - now(), true);
        return { state: 'HOLD', reason: response.status === 429 ? 'RATE_LIMIT' : 'ACCESS_DENIED', nextAt };
      }
      if (preflight) {
        if (![200, 404, 410].includes(response.status)) return { state: 'HOLD', reason: 'ROBOTS_UNAVAILABLE' };
        if (response.status === 200 && !/^text\/plain(?:;|$)/i.test(response.contentType ?? '')) return { state: 'HOLD', reason: 'ROBOTS_UNREADABLE' };
        const body = response.status === 200 ? response.body.toString('utf8') : '';
        const rules = robotsParser(target, body);
        const denied = rules.isAllowed(url, agent) === false;
        const delay = (rules.getCrawlDelay(agent) ?? 0) * 1000;
        const record = { body, delay, until: now() + 86400000 };
        robots.set(origin, { ...record, rules }); saveRobots(origin, record);
        reserveHost(new URL(target).hostname, now(), Math.max(5000, delay), true);
        return denied ? { state: 'HOLD', reason: 'ROBOTS_DENIED' } : { state: 'DEFER', nextAt: now() + Math.max(5000, delay), url, redirects };
      }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        if (redirects >= 4 || !response.location) return { state: 'HOLD', reason: 'REDIRECT_LIMIT' };
        const nextUrl = urlKey(new URL(response.location, url).href);
        if (!sourceGrant(loadConfig(), nextUrl, now())) return { state: 'HOLD', reason: 'REDIRECT_SOURCE_UNREGISTERED' };
        return { state: 'DEFER', nextAt: now() + 5000, url: nextUrl, redirects: redirects + 1 };
      }
      if (response.status !== 200) return { state: 'HOLD', reason: 'ORIGINAL_HTTP_' + response.status };
      if (/application\/pdf/i.test(response.contentType ?? '')) {
        if (!extractPdf) return { state: 'HOLD', reason: 'PDF_EXTRACTOR_REQUIRED' };
        const result = await extractPdf(response.body);
        if (!result || typeof result.text !== 'string' || result.text.length < 100 || result.text.length > 40000 || Buffer.byteLength(result.text, 'utf8') > 60000) return { state: 'HOLD', reason: 'PDF_TEXT_INVALID' };
        return { state: 'ORIGINAL', url, title: String(result.title ?? '').slice(0, 500), text: result.text,
          publishedAt: result.publishedAt ?? null, bodyHash: digest(result.text.normalize('NFKC').replace(/\s+/g, ' ')) };
      }
      if (!/^text\/html(?:;|$)/i.test(response.contentType ?? '')) return { state: 'HOLD', reason: 'UNSUPPORTED_ORIGINAL_TYPE' };
      const charset = /charset\s*=\s*["']?([^;\s"']+)/i.exec(response.contentType)?.[1] ?? 'utf-8';
      const html = new TextDecoder(charset, { fatal: true }).decode(response.body);
      return parseOriginal(html, url);
    } catch (error) {
      return { state: 'HOLD', reason: ['NON_PUBLIC_DNS', 'AUTHORITY_CHANGED', 'UNSAFE_URL'].includes(error.message) ? error.message : 'ORIGINAL_READ_FAILED' };
    }
  };
}
