// Short-link resolution (2026-11-26). Follows one redirect hop of a known short-link/redirect host to learn
// the destination URL. It reads no article: a 3xx Location header, or a meta-refresh in a small HTML page.
// Same safety rules as the original reader: public pinned DNS, HTTPS only, robots.txt, at least 5s per host,
// Retry-After/429/denial waits. Only hosts in REDIRECT_HOSTS are ever contacted here.
import robotsParser from 'robots-parser';
import { parse } from 'parse5';
import { retryAfterTime } from '../../../scripts/providers/public-watch.mjs';
import { urlKey } from './contracts.mjs';
import { createOriginalTransport } from './original.mjs';
import { isRedirectHost } from './routing.mjs';

const agent = 'JudojuNews-LinkResolver/1.0';
export const MAX_HOPS = 4;

// <meta http-equiv="refresh" content="0; url=https://...">, used by some short-link services instead of a 3xx.
export function metaRefreshTarget(html, base) {
  const nodes = [parse(html)];
  while (nodes.length) {
    const node = nodes.pop();
    if (node.tagName === 'meta') {
      const attrs = Object.fromEntries((node.attrs ?? []).map(item => [item.name.toLowerCase(), item.value]));
      if ((attrs['http-equiv'] ?? '').toLowerCase() === 'refresh') {
        const match = /url\s*=\s*['"]?([^'";\s]+)/i.exec(attrs.content ?? '');
        if (match) return new URL(match[1], base).href;
      }
    }
    for (const child of node.childNodes ?? []) nodes.push(child);
  }
  return null;
}

export function createLinkResolver({ transport = createOriginalTransport(), now = Date.now, loadRobots = () => null, saveRobots = () => {} } = {}) {
  const robots = new Map();
  return async ({ url, hops = 0, enabled, authorize, reserveHost }) => {
    try {
      url = urlKey(url);
      if (!enabled || !authorize()) return { state: 'HOLD', reason: 'LINK_RESOLUTION_NOT_ENABLED' };
      if (!isRedirectHost(new URL(url).hostname)) return { state: 'HOLD', reason: 'NOT_A_SHORT_LINK' };
      if (hops >= MAX_HOPS) return { state: 'HOLD', reason: 'REDIRECT_LIMIT' };
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
      if (!slot.allowed) return { state: 'DEFER', nextAt: slot.nextAt, url, hops };
      const response = await transport(target, { timeoutMs: 8000, maxBytes: 65536, signal: AbortSignal.timeout(8000), authorize });
      if (!authorize()) return { state: 'HOLD', reason: 'AUTHORITY_CHANGED' };
      if (response.status === 429 || [401, 403, 451].includes(response.status)) {
        const nextAt = Math.max(retryAfterTime(response.retryAfter, now()), now() + (response.status === 429 ? 900000 : 3600000));
        reserveHost(new URL(target).hostname, now(), nextAt - now(), true);
        return { state: 'HOLD', reason: response.status === 429 ? 'RATE_LIMIT' : 'ACCESS_DENIED', nextAt };
      }
      if (preflight) {
        if (![200, 404, 410].includes(response.status)) return { state: 'HOLD', reason: 'ROBOTS_UNAVAILABLE' };
        const body = response.status === 200 && /^text\/plain(?:;|$)/i.test(response.contentType ?? '') ? response.body.toString('utf8') : '';
        const rules = robotsParser(target, body);
        const delay = (rules.getCrawlDelay(agent) ?? 0) * 1000, record = { body, delay, until: now() + 86400000 };
        robots.set(origin, { ...record, rules }); saveRobots(origin, record);
        reserveHost(new URL(target).hostname, now(), Math.max(5000, delay), true);
        return rules.isAllowed(url, agent) === false ? { state: 'HOLD', reason: 'ROBOTS_DENIED' } : { state: 'DEFER', nextAt: now() + Math.max(5000, delay), url, hops };
      }
      let next = null;
      if ([301, 302, 303, 307, 308].includes(response.status)) next = response.location ? new URL(response.location, url).href : null;
      else if (response.status === 200 && /^text\/html(?:;|$)/i.test(response.contentType ?? '')) next = metaRefreshTarget(response.body.toString('utf8'), url);
      if (!next) return { state: 'HOLD', reason: response.status === 200 ? 'SHORT_LINK_UNRESOLVED' : 'SHORT_LINK_HTTP_' + response.status };
      return { state: 'RESOLVED', url: urlKey(next), hops: hops + 1 };
    } catch (error) {
      return { state: 'HOLD', reason: ['NON_PUBLIC_DNS', 'AUTHORITY_CHANGED', 'UNSAFE_URL'].includes(error.message) ? error.message : 'LINK_RESOLUTION_FAILED' };
    }
  };
}
