import { parse } from 'parse5';
import { normalizeArticleUrl, permissionDecision } from './policy.mjs';
import { pinnedHttps, probe } from './probe.mjs';

export const htmlListVersion = 'html-list-v1';
const purposes = ['MACHINE_ACCESS', 'DISCOVERY', 'LINK_EXTRACTION'];
const maxHtmlBytes = 512 * 1024;
const maxCandidates = 100;
const articleTypes = ['Article', 'NewsArticle', 'ReportageNewsArticle'];
const htmlNamespace = 'http://www.w3.org/1999/xhtml';

function* elements(root, prune = () => false) {
  const pending = [root];
  while (pending.length) {
    const node = pending.pop();
    yield node;
    if (!node.childNodes || prune(node)) continue;
    for (let i = node.childNodes.length - 1; i >= 0; i--) pending.push(node.childNodes[i]);
  }
}

const attribute = (node, name) => node.attrs?.find(entry => entry.name === name)?.value;
const titleText = text => typeof text === 'string' ? text.replace(/\s+/gu, ' ').trim() : '';
const hasType = (node, types) => [node?.['@type']].flat().some(type => types.includes(type));

function getPublishedAt(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
  const day = new Date(value.slice(0, 10) + 'T00:00:00Z');
  if (!Number.isFinite(day.getTime()) || day.toISOString().slice(0, 10) !== value.slice(0, 10)) return null;
  const date = Date.parse(value);
  return Number.isFinite(date) ? new Date(date).toISOString() : null;
}

function* structuredArticles(raw) {
  const pending = [raw];
  while (pending.length) {
    const node = pending.pop();
    if (Array.isArray(node)) {
      for (let i = node.length - 1; i >= 0; i--) pending.push(node[i]);
    } else if (node && typeof node === 'object') {
      if (hasType(node, articleTypes)) yield node;
      if (node['@graph']) pending.push(node['@graph']);
      if (hasType(node, ['ItemList']) && Array.isArray(node.itemListElement)) pending.push(node.itemListElement);
      if (hasType(node, ['ListItem']) && node.item) pending.push(node.item);
    }
  }
}

function articleMarkup(node) {
  const nestedArticle = current => current !== node && current.tagName === 'article';
  const children = [...elements(node, nestedArticle)];
  const time = children.find(child => child.tagName === 'time' && attribute(child, 'datetime'));
  const isLink = child => child.tagName === 'a' && attribute(child, 'href');
  for (const heading of children.filter(child => /^h[1-4]$/.test(child.tagName))) {
    let link = [...elements(heading, nestedArticle)].find(isLink);
    let ancestor = heading.parentNode;
    while (!link && ancestor && ancestor !== node) {
      if (isLink(ancestor)) link = ancestor;
      ancestor = ancestor.parentNode;
    }
    if (!link) continue;
    const title = [...elements(heading, child => ['script','style','noscript'].includes(child.tagName))]
      .map(child => child.nodeName === '#text' ? child.value : '').join('');
    if (titleText(title)) return { url: attribute(link, 'href'), title, publishedAt: time && attribute(time, 'datetime') };
  }
  return null;
}

/** Returns same-origin discovery candidates from supplied HTML. Does not follow article links. */
export function parseHtmlList(html, listUrl) {
  if (typeof html !== 'string' || Buffer.byteLength(html) > maxHtmlBytes) throw new Error('HTML_LIST_SIZE');
  const source = new URL(normalizeArticleUrl(listUrl));
  const document = parse(html, { scriptingEnabled: true });
  const candidates = new Map();
  const htmlNodes = [...elements(document, current => current.tagName === 'noscript')]
    .filter(node => node.namespaceURI === htmlNamespace);
  const firstBase = htmlNodes.find(node => node.tagName === 'base' && attribute(node, 'href') !== undefined);
  let base = listUrl;
  if (firstBase) {
    try {
      const declaredBase = new URL(attribute(firstBase, 'href'), listUrl);
      if (!['data:', 'javascript:'].includes(declaredBase.protocol)) base = declaredBase.href;
    } catch { /* Invalid base declarations leave the document URL effective. */ }
  }

  function add(candidate) {
    const title = titleText(candidate.title);
    if (!title || title.length > 500 || typeof candidate.url !== 'string') return;
    let url;
    try { url = new URL(normalizeArticleUrl(new URL(candidate.url, base).href)); }
    catch { return; }
    if (url.origin !== source.origin || url.href === source.href) return;

    const publishedAt = getPublishedAt(candidate.publishedAt);
    const existing = candidates.get(url.href);
    if (!existing) candidates.set(url.href, { url: url.href, title, publishedAt });
    else if (!existing.publishedAt && publishedAt) existing.publishedAt = publishedAt;
  }

  const markup = [];
  for (const node of htmlNodes) {
    if (node.tagName === 'script' && attribute(node, 'type')?.trim().toLowerCase() === 'application/ld+json') {
      let parsed;
      try { parsed = JSON.parse(node.childNodes?.[0]?.value ?? ''); }
      catch { continue; }
      for (const item of structuredArticles(parsed)) {
        add({url: item.url ?? item.mainEntityOfPage?.['@id'], title: item.headline ?? item.name,
          publishedAt: item.datePublished});
      }
    } else if (node.tagName === 'article') {
      markup.push(node);
    }
  }
  for (const node of markup) {
    const candidate = articleMarkup(node);
    if (candidate) add(candidate);
  }
  return { candidates: [...candidates.values()].slice(0, maxCandidates), truncated: candidates.size > maxCandidates };
}

/** Runs one exact listing fetch through existing HTTPS, permission and request budget checks. */
export async function collectHtmlList({ endpoint, profile, execute = false, now = () => new Date().toISOString(),
  transport = pinnedHttps, ...probeOptions }) {
  const output = (status, reason, requests = 0, candidates = []) =>
    ({ endpointId: endpoint.endpoint_id, status, reason, requests, candidates });
  const checkPermission = () => permissionDecision(profile, endpoint, purposes, now()) ??
    (endpoint.adapter_version !== htmlListVersion || !purposes.every(purpose => endpoint.enabled_scopes?.includes(purpose)) ?
      'HTML_ADAPTER_OR_SCOPE_UNVERIFIED' : null);
  const checkFetch = (url, limits) => {
    const current = checkPermission();
    if (current) return current;
    try {
      if (normalizeArticleUrl(endpoint.url) !== url) return 'ENDPOINT_URL_CHANGED';
    } catch { return 'UNSAFE_URL'; }
    if (!profile.allowed_hosts?.includes(new URL(url).hostname)) return 'HOST_NOT_ALLOWED';
    if (!profile.methods?.includes('GET') || !Number.isInteger(profile.max_requests) || profile.max_requests < 1 ||
        !Number.isFinite(profile.max_bytes) || profile.max_bytes < limits.maxBytes ||
        !Number.isFinite(profile.timeout_ms) || profile.timeout_ms < limits.timeoutMs) {
      return 'BUDGET_UNVERIFIED';
    }
    return null;
  };
  const denied = checkPermission();
  if (denied) return output('BLOCKED', denied);
  let observed;
  let dispatchBlocked;
  const result = await probe({
    ...probeOptions, endpoint, profile, purposes, execute, now,
    limits: { timeoutMs: 5000, maxBytes: maxHtmlBytes, maxHops: 0 },
    transport: async (url, limits) => {
      dispatchBlocked = checkFetch(url, limits);
      if (dispatchBlocked) throw new Error(dispatchBlocked);
      const response = await transport(url, limits);
      observed = { url, limits, response };
      return response;
    },
  });
  if (dispatchBlocked) return output('BLOCKED', dispatchBlocked);
  if (result.status !== 'HTTP_OK_UNPARSED') return output(result.status, result.reason, result.requests);
  const { url, limits, response } = observed;
  const current = checkFetch(url, limits);
  if (current) return output('BLOCKED', current, result.requests);
  if (response.status !== 200 || !/^text\/html(?:\s*;\s*charset\s*=\s*"?utf-8"?\s*)?$/i.test(response.contentType ?? '')) {
    return output('PARSE_HOLD', 'HTML_RESPONSE_REQUIRED', result.requests);
  }
  let parsed;
  try { parsed = parseHtmlList(new TextDecoder('utf-8', { fatal: true }).decode(response.body), url); }
  catch { return output('PARSE_HOLD', 'INVALID_HTML_RESPONSE', result.requests); }
  if (!parsed.candidates.length) return output('PARSE_HOLD', 'NO_ARTICLE_CANDIDATES', result.requests);
  return output(parsed.truncated ? 'PARTIAL' : 'CANDIDATES', parsed.truncated ? 'CANDIDATE_LIMIT' : null,
    result.requests, parsed.candidates);
}
