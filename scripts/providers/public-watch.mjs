import { createHash } from 'node:crypto';
import robotsParser from 'robots-parser';
import { parseHtmlList } from './html-list.mjs';
import { normalizeArticleUrl } from './policy.mjs';
import { pinnedHttps } from './probe.mjs';

const userAgent = 'JudojuNewsMonitor/1.0';
const cacheTime = 24 * 60 * 60 * 1000;
// A poll sleeps for one minute and can spend up to 36 seconds on its other requests.
const latestWatchInterval = cacheTime - 2 * 60 * 1000;
const timeoutMs = 4500;
const robotsLimit = 512 * 1024;
const htmlLimit = 512 * 1024;
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

function httpFailure(response, reason) {
  return { reason, httpStatus: response.status, retryAfter: response.retryAfter ?? null };
}

export function createPublicWatch({ transport = pinnedHttps, now = Date.now } = {}) {
  const robotsCache = new Map();
  function cachedRules(url) {
    const cached = robotsCache.get(new URL(url).origin);
    return cached && cached.expires > now() ? cached : undefined;
  }
  async function watch(endpoint, limits = {}) {
    let requests = 0;
    let delayMs = 0;
    const result = (status, details = {}) => ({ status, requests, delayMs, ...details });
    async function fetchBounded(url, maxBytes) {
      requests++;
      const timeout = Math.min(timeoutMs, limits.timeoutMs ?? timeoutMs);
      return await transport(url, { maxBytes, timeoutMs: timeout, signal: AbortSignal.timeout(timeout), userAgent });
    }
    try {
      const url = normalizeArticleUrl(endpoint.url);
      const origin = new URL(url).origin;
      const cached = cachedRules(url);
      if (!cached) {
        robotsCache.delete(origin);
        const robotsUrl = origin + '/robots.txt';
        const maxBytes = Math.min(robotsLimit, limits.maxBytes ?? robotsLimit);
        const response = await fetchBounded(robotsUrl, maxBytes);
        let rules;
        if ([401, 403, 451].includes(response.status)) {
          robotsCache.set(origin, { expires: now() + cacheTime, denied: true });
          return result('ROBOTS_DENIED');
        }
        if ([404, 410].includes(response.status)) {
          rules = robotsParser(robotsUrl, '');
        } else {
          if (response.status !== 200) return result('FAILED', httpFailure(response, 'ROBOTS_UNAVAILABLE'));
          if (!Buffer.isBuffer(response.body) || response.body.length > maxBytes ||
              !/^text\/plain(?:\s*;|$)/i.test(response.contentType ?? '')) return result('ROBOTS_UNREADABLE');
          rules = robotsParser(robotsUrl, text(response.body));
        }
        const seconds = rules.getCrawlDelay(userAgent);
        delayMs = Number.isSafeInteger(Math.ceil(seconds * 1000)) && seconds > 0 ? Math.ceil(seconds * 1000) : 0;
        robotsCache.set(origin, { expires: now() + cacheTime, rules, delayMs });
        return result(Math.max(delayMs, limits.hostDelay ?? 0) >= latestWatchInterval ?
          'ROBOTS_INTERVAL_CONFLICT' : 'ROBOTS_READY');
      }

      if (cached.denied || cached.rules.isAllowed(url, userAgent) !== true) return result('ROBOTS_DENIED');
      delayMs = cached.delayMs;
      if (Math.max(delayMs, limits.hostDelay ?? 0) >= latestWatchInterval) return result('ROBOTS_INTERVAL_CONFLICT');
      const maxBytes = Math.min(htmlLimit, limits.maxBytes ?? htmlLimit);
      const response = await fetchBounded(url, maxBytes);
      if (response.status !== 200) {
        const reason = [301, 302, 303, 307, 308].includes(response.status) ? 'REDIRECT_LIMIT' : 'WATCH_HTTP_FAILED';
        return result('FAILED', httpFailure(response, reason));
      }
      if (!Buffer.isBuffer(response.body) || response.body.length > maxBytes ||
          !/^text\/html(?:\s*;|$)/i.test(response.contentType ?? '')) return result('WATCH_NOT_HTML');
      const { candidates } = parseHtmlList(text(response.body), url);
      if (!candidates.length) return result('WATCH_PAGE_OK');
      const index = candidates.map(({ url, title }) => JSON.stringify([url, title])).sort();
      const digest = createHash('sha256').update(JSON.stringify(index)).digest('hex');
      return result('WATCH_LIST_OK', { digest });
    } catch {
      return result('WATCH_FAILED');
    }
  };
  watch.requiresRobots = endpoint => !cachedRules(endpoint.url);
  return watch;
}
