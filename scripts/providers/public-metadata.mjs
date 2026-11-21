import { createHash } from 'node:crypto';
import { createPublicWatch } from './public-watch.mjs';
import { maxWatchHtmlBytes, parseHtmlList, parseOriginalTitle } from './html-list.mjs';
import { identityForUrl, normalizeArticleUrl } from './policy.mjs';

const mode = 'PUBLIC_LINK_TITLE_V1';

// This is an operator instruction for metadata only, independent of publisher-license evidence.
export function operatorMetadataSource(endpoint, profile, routeIds) {
  const config = endpoint.metadata_collection;
  if (!routeIds.has(endpoint.endpoint_id) || endpoint.status !== 'RIGHTS_HOLD' ||
      config?.mode !== mode || config.list_url !== endpoint.url || config.endpoint_id !== endpoint.endpoint_id ||
      config.authorization !== 'USER_REQUEST_37_PUBLIC_LISTS_20261121' ||
      endpoint.confirm_article_title !== true || config.retention_days !== 7 || typeof config.enabled_at !== 'string' ||
      !Number.isFinite(Date.parse(config.enabled_at)) ||
      ['DENIED', 'REVOKED'].includes(profile?.status) || profile?.revoked_at ||
      ['MACHINE_ACCESS', 'DISCOVERY', 'LINK_EXTRACTION', 'ORIGINAL_ACCESS', 'STORAGE']
        .some(key => profile?.purposes?.[key] === 'DENY')) return null;
  let url;
  try { url = normalizeArticleUrl(endpoint.url); } catch { return null; }
  if (/(^|\.)(t\.me|telegram\.me)$/i.test(new URL(url).hostname)) return null;
  const urlIdentity = identityForUrl(url);
  const configHash = createHash('sha256').update(JSON.stringify(config)).digest('hex');
  return {
    endpoint, profile: { ...profile, retention_days: 7, validity: 'UNTIL_REVOKED', expires_at: null },
    host: new URL(url).hostname, hostDelay: 5000, operator: true, watch: false, urlIdentity,
    binding: JSON.stringify(['operator-metadata', endpoint.config_version, configHash, urlIdentity]),
  };
}

export function createPublicMetadata(options = {}) {
  const watch = createPublicWatch({
    ...options,
    inspectPage: (html, url) => ({
      ...parseHtmlList(html, url, maxWatchHtmlBytes, { includeOfficialReports: true }),
      title: parseOriginalTitle(html, url),
    }),
  });
  const limits = { maxBytes: maxWatchHtmlBytes, timeoutMs: 4500, hostDelay: 5000 };
  return {
    requiresRobots: watch.requiresRobots,
    async collect(endpoint, authorize) {
      const result = await watch(endpoint, { ...limits, authorize });
      if (result.status !== 'WATCH_INSPECTED') return { ...result, candidates: [] };
      const { observation, ...details } = result;
      return { ...details, status: observation.candidates.length
        ? observation.truncated ? 'PARTIAL' : 'CANDIDATES' : 'PARSE_HOLD',
      candidates: observation.candidates, reason: observation.truncated ? 'CANDIDATE_LIMIT' :
        observation.candidates.length ? null : 'NO_ARTICLE_CANDIDATES' };
    },
    async openDetail({ endpoint, url, listingHash, stillAuthorized }) {
      if (!stillAuthorized()) return { requests: 0, title: null };
      let target;
      try { target = normalizeArticleUrl(url); } catch { return { requests: 0, title: null, unavailable: true }; }
      if (new URL(target).origin !== new URL(endpoint.url).origin || target === normalizeArticleUrl(endpoint.url)) {
        return { requests: 0, title: null, unavailable: true };
      }
      const result = await watch({ ...endpoint, url: target }, { ...limits, authorize: stillAuthorized,
        inspectPage: (html, address) => ({title:parseOriginalTitle(html, address, listingHash)}) });
      if (!stillAuthorized()) return { requests: result.requests, title: null };
      const { observation, ...details } = result;
      const unavailable = ['ROBOTS_DENIED', 'WATCH_NOT_HTML'].includes(result.status) ||
        ['REDIRECT_LIMIT', 'RESPONSE_TOO_LARGE'].includes(result.reason) ||
        result.status === 'WATCH_INSPECTED' && !observation.title;
      return { ...details, unavailable, title: result.status === 'WATCH_INSPECTED' ? observation.title : null };
    },
  };
}
