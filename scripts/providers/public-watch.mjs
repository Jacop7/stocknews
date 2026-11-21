import { createHash } from 'node:crypto';
import robotsParser from 'robots-parser';
import { maxWatchHtmlBytes, parseHtmlList } from './html-list.mjs';
import { normalizeArticleUrl } from './policy.mjs';
import { pinnedHttps } from './probe.mjs';

const userAgent = 'JudojuNewsMonitor/1.0';
const cacheTime = 24 * 60 * 60 * 1000;
// A poll sleeps for one minute and can spend up to 36 seconds on its other requests.
const latestWatchInterval = cacheTime - 2 * 60 * 1000;
const timeoutMs = 4500;
const robotsLimit = 512 * 1024;
const htmlLimit = 512 * 1024;
const largeListings = new Set([
  'https://www.cnbc.com/markets/',
  'https://www.cnbc.com/earnings/',
  'https://www.hanwhawm.com/main/research/main/list.cmd?depth3_id=anls1',
  'https://www.hanwhawm.com/main/research/main/list.cmd?depth3_id=anls2&viewclass=',
]);
const text = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);

export function retryAfterTime(value, time) {
  if (typeof value !== 'string') return time;
  if (/^\d+$/.test(value)) return Math.min(Number.MAX_SAFE_INTEGER, time + Number(value) * 1000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? date : time;
}

function robotsText(bytes) {
  // Comments are outside the robots rules. Preserve the bytes of every directive.
  const directives = bytes.toString('latin1').replace(/#[^\r\n]*/g, '');
  return text(Buffer.from(directives, 'latin1'));
}

function htmlText(bytes, contentType) {
  const charset = contentType.match(/;\s*charset\s*=\s*(?:"([^"]+)"|([^;\s]+))/i);
  const label = (charset?.[1] ?? charset?.[2] ?? '').trim().toLowerCase();
  if (['euc-kr', 'cp949', 'windows-949'].includes(label)) {
    return new TextDecoder('euc-kr', { fatal: true }).decode(bytes);
  }
  return text(bytes);
}

function redirectOrigin(location, from) {
  if (typeof location !== 'string' || !location) return null;
  try {
    return new URL(normalizeArticleUrl(new URL(location, from).href)).origin;
  } catch {
    return null;
  }
}

function failureCode(error) {
  if (error.message === 'RESPONSE_TOO_LARGE' || error.message === 'HTML_LIST_SIZE') return 'RESPONSE_TOO_LARGE';
  if (error.code === 'ECONNRESET') return 'CONNECTION_RESET';
  if (error.name === 'TimeoutError' || error.code === 'ABORT_ERR' || error.message === 'REQUEST_TIMEOUT' ||
      error.code === 'ETIMEDOUT') return 'TIMEOUT';
  if (error.code === 'ENOTFOUND' || error.code === 'EAI_AGAIN') return 'DNS_FAILED';
  if (error.message === 'NON_PUBLIC_DNS') return 'NON_PUBLIC_DNS';
  if (error.code === 'ERR_ENCODING_INVALID_ENCODED_DATA') return 'INVALID_UTF8';
  if (/^(ERR_TLS_|ERR_SSL_|CERT_|UNABLE_TO_VERIFY_|UNABLE_TO_GET_ISSUER_CERT|DEPTH_ZERO_|SELF_SIGNED_CERT_IN_CHAIN)/.test(error.code ?? '')) {
    return 'TLS_FAILED';
  }
  return 'REQUEST_FAILED';
}

export function createPublicWatch({ transport = pinnedHttps, now = Date.now, inspectPage } = {}) {
  const robotsCache = new Map();
  function cachedRules(url) {
    const cached = robotsCache.get(new URL(url).origin);
    return cached && cached.expires > now() ? cached : undefined;
  }
  async function watch(endpoint, limits = {}) {
    let requests = 0;
    let delayMs = 0;
    let stage = 'ROBOTS';
    let response;
    const result = (status, details = {}) => ({ status, requests, delayMs, stage, ...details });
    const responseDetails = () => ({ httpStatus: response.status, retryAfter: response.retryAfter ?? null });
    async function fetchBounded(url, maxBytes) {
      if (limits.authorize?.() === false) throw new Error('AUTHORIZATION_CHANGED');
      requests++;
      const timeout = Math.min(timeoutMs, limits.timeoutMs ?? timeoutMs);
      const data = await transport(url, { maxBytes, timeoutMs: timeout, signal: AbortSignal.timeout(timeout), userAgent });
      if (limits.authorize?.() === false) throw new Error('AUTHORIZATION_CHANGED');
      return data;
    }
    try {
      const url = normalizeArticleUrl(endpoint.url);
      const origin = new URL(url).origin;
      const cached = cachedRules(url);
      if (!cached) {
        robotsCache.delete(origin);
        const robotsUrl = origin + '/robots.txt';
        const maxBytes = Math.min(robotsLimit, limits.maxBytes ?? robotsLimit);
        response = await fetchBounded(robotsUrl, maxBytes);
        let rules;
        if ([401, 403, 451].includes(response.status)) {
          robotsCache.set(origin, { expires: now() + cacheTime, denied: true, httpStatus: response.status });
          return result('ROBOTS_DENIED', { reason: 'ROBOTS_ACCESS_DENIED', ...responseDetails() });
        }
        if ([404, 410].includes(response.status)) {
          rules = robotsParser(robotsUrl, '');
        } else {
          if (response.status !== 200) return result('FAILED', { reason: 'ROBOTS_HTTP_FAILED', ...responseDetails(),
            redirectOrigin: redirectOrigin(response.location, robotsUrl) });
          if (!Buffer.isBuffer(response.body) || response.body.length > maxBytes) {
            return result('ROBOTS_UNREADABLE', { reason: 'RESPONSE_TOO_LARGE', ...responseDetails() });
          }
          if (!/^text\/plain(?:\s*;|$)/i.test(response.contentType ?? '')) {
            return result('ROBOTS_UNREADABLE', { reason: 'ROBOTS_CONTENT_TYPE', ...responseDetails() });
          }
          rules = robotsParser(robotsUrl, robotsText(response.body));
        }
        const seconds = rules.getCrawlDelay(userAgent);
        delayMs = Number.isSafeInteger(Math.ceil(seconds * 1000)) && seconds > 0 ? Math.ceil(seconds * 1000) : 0;
        robotsCache.set(origin, { expires: now() + cacheTime, rules, delayMs });
        return result(Math.max(delayMs, limits.hostDelay ?? 0) >= latestWatchInterval ?
          'ROBOTS_INTERVAL_CONFLICT' : 'ROBOTS_READY', responseDetails());
      }

      if (cached.denied) return result('ROBOTS_DENIED', { reason: 'ROBOTS_ACCESS_DENIED', httpStatus: cached.httpStatus });
      if (cached.rules.isAllowed(url, userAgent) !== true) return result('ROBOTS_DENIED', { reason: 'ROBOTS_RULE_DISALLOWED' });
      delayMs = cached.delayMs;
      if (Math.max(delayMs, limits.hostDelay ?? 0) >= latestWatchInterval) return result('ROBOTS_INTERVAL_CONFLICT');
      stage = 'PAGE';
      const pageLimit = largeListings.has(url) ? maxWatchHtmlBytes : htmlLimit;
      const maxBytes = Math.min(pageLimit, limits.maxBytes ?? pageLimit);
      response = await fetchBounded(url, maxBytes);
      if (response.status !== 200) {
        const reason = [301, 302, 303, 307, 308].includes(response.status) ? 'REDIRECT_LIMIT' : 'WATCH_HTTP_FAILED';
        return result('FAILED', { reason, ...responseDetails(), redirectOrigin: redirectOrigin(response.location, url) });
      }
      if (!Buffer.isBuffer(response.body) || response.body.length > maxBytes) {
        return result('WATCH_FAILED', { reason: 'RESPONSE_TOO_LARGE', ...responseDetails() });
      }
      if (!/^text\/html(?:\s*;|$)/i.test(response.contentType ?? '')) {
        return result('WATCH_NOT_HTML', { reason: 'PAGE_CONTENT_TYPE', ...responseDetails() });
      }
      const html = htmlText(response.body, response.contentType);
      const inspector = limits.inspectPage ?? inspectPage;
      if (inspector) {
        return result('WATCH_INSPECTED', { observation: inspector(html, url), ...responseDetails() });
      }
      const { candidates } = parseHtmlList(html, url, maxBytes, {
        includeOfficialReports: true,
      });
      if (!candidates.length) return result('WATCH_PAGE_OK', { reason: 'NO_ARTICLE_CANDIDATES', ...responseDetails() });
      const index = candidates.map(({ url, title }) => JSON.stringify([url, title])).sort();
      const digest = createHash('sha256').update(JSON.stringify(index)).digest('hex');
      return result('WATCH_LIST_OK', { digest, ...responseDetails() });
    } catch (error) {
      return result('WATCH_FAILED', { reason: failureCode(error), httpStatus: response?.status ?? null });
    }
  };
  watch.requiresRobots = endpoint => !cachedRules(endpoint.url);
  return watch;
}
