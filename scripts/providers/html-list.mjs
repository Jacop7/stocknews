import { parse } from 'parse5';
import { createHash } from 'node:crypto';
import { normalizeArticleUrl, permissionDecision } from './policy.mjs';
import { pinnedHttps, probe } from './probe.mjs';

export const htmlListVersion = 'html-list-v1';
export const htmlListPurposes = Object.freeze(['MACHINE_ACCESS', 'DISCOVERY', 'LINK_EXTRACTION']);
export const htmlDetailPurposes = Object.freeze(['MACHINE_ACCESS', 'ORIGINAL_ACCESS', 'STORAGE']);
const maxHtmlBytes = 512 * 1024;
export const maxWatchHtmlBytes = 2 * 1024 * 1024;
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
const nodeTitle = node => [...elements(node, child => ['script', 'style', 'noscript'].includes(child.tagName))]
  .map(child => child.nodeName === '#text' ? child.value : '').join('');

function selectorMatches(node, selector) {
  if (!node) return false;
  if (selector.startsWith('#')) return attribute(node, 'id') === selector.slice(1);
  const [tag, className] = selector.split('.');
  return (!tag || node.tagName === tag) &&
    (!className || (attribute(node, 'class') ?? '').split(/\s+/).includes(className));
}

const numberedArticle = url => /^\/article\/\d{5,20}$/.test(url.pathname);
const numberedNewsView = url => /^\/news\/view\/\d{5,20}$/.test(url.pathname);
const capitalDataWireList = 'https://capitaldatawire.com/stories';
const capitalDataWireStory = url => /^\/stories\/[a-z0-9]+(?:-[a-z0-9]+)*$/.test(url.pathname) && !url.search;
const ndsoftArticle = url => url.pathname === '/news/articleView.html' &&
  url.searchParams.getAll('idxno').length === 1 && /^\d{1,20}$/.test(url.searchParams.get('idxno'));
const headlineRules = [
  {
    sources: ['https://focustaiwan.tw/business'], inside: 'h2', list: '#jsList',
    detail: url => /^\/business\/\d{12}$/.test(url.pathname) && !url.search,
  },
  {
    sources: ['https://www.cnbc.com/markets/', 'https://www.cnbc.com/earnings/'],
    anchor: 'a.Card-title', list: 'div.Card-titleContainer',
    detail: url => /^\/\d{4}\/\d{2}\/\d{2}\/[a-z0-9-]+\.html$/.test(url.pathname) && !url.search,
  },
  {
    sources: ['https://www.hankyung.com/koreamarket/1113', 'https://www.hankyung.com/koreamarket/1114'],
    heading: 'h2.news-tit', list: 'ul.news-list', detail: numberedArticle,
  },
  {
    sources: ['https://www.etoday.co.kr/market/hot-stock'], heading: '.cluster_text_headline21',
    list: '.sub_n_list_cont', detail: numberedNewsView, tracking: 'trc',
  },
  {
    sources: ['https://www.sedaily.com/market/domesticStock'], heading: 'h2.headline',
    list: '#list_area', detail: numberedArticle,
  },
  {
    sources: ['https://www.newspim.com/news/lists/?category_cd=105060'], heading: 'strong.subject',
    list: 'article.thumb_h', detail: numberedNewsView,
  },
  {
    sources: ['https://www.ksdaily.co.kr/news/articleList.html?sc_section_code=S1N1&view_type=sm',
      'https://www.infostockdaily.co.kr/news/articleList.html?sc_section_code=S1N17&view_type=sm'],
    heading: 'div.list-titles', list: 'section.article-list-content', detail: ndsoftArticle,
  },
  {
    sources: ['https://www.hansbiz.co.kr/news/articleList.html?sc_section_code=S1N54&view_type=sm'],
    heading: 'h4.titles', list: '#section-list', detail: ndsoftArticle,
  },
  {
    sources: ['g120100', 'g121000', 'g121100', 'g121200'].map(code => 'https://www.g-enews.com/list.php?ct=' + code),
    anchor: 'a.e1', list: 'div.l2d',
    detail: url => /^\/article\/[\w-]+\/\d{4}\/\d{2}\/\w+_\d+$/.test(url.pathname),
  },
  {
    sources: ['https://www.mediapen.com/news/lists/?menu=m1&cate_cd2=40019'], heading: 'div.news-lists-title',
    list: 'div.news-lists', detail: numberedNewsView,
  },
  {
    sources: ['https://mbnmoney.mbn.co.kr/stock/news?news_service_id=10011'], inside: 'dt', list: 'dl.list_type_new_01',
    detail: url => url.pathname === '/news/view' && url.searchParams.getAll('news_no').length === 1 &&
      /^MM\d{8,20}$/.test(url.searchParams.get('news_no')),
  },
];

function publisherHeadline(node, source, base, rule) {
  const href = attribute(node, 'href');
  if (!href || (rule.heading && !selectorMatches(node.parentNode, rule.heading)) ||
      (rule.anchor && !selectorMatches(node, rule.anchor))) return null;
  let container = node.parentNode;
  while (container && !selectorMatches(container, rule.list)) container = container.parentNode;
  if (!container) return null;

  let url;
  try { url = new URL(normalizeArticleUrl(new URL(href, base).href)); }
  catch { return null; }
  if (url.origin !== source.origin || !rule.detail(url)) return null;
  if (rule.tracking) url.searchParams.delete(rule.tracking);
  const title = rule.inside ? [...elements(node)].find(child => selectorMatches(child, rule.inside)) : node;
  return title ? { url: url.href, title: nodeTitle(title) } : null;
}

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
    const title = nodeTitle(heading);
    if (titleText(title)) return { url: attribute(link, 'href'), title, publishedAt: time && attribute(time, 'datetime') };
  }
  return null;
}

function kyoboReportListing(source) {
  const screen = source.searchParams.get('scr_id');
  const menu = source.searchParams.get('menuCode');
  return source.origin === 'https://www.iprovest.com' &&
    source.pathname === '/weblogic/RSReportServlet' &&
    ((screen === '34' && menu === '3' && source.searchParams.get('mode') === 'list') ||
      (screen === '40' && menu === '9' && !source.searchParams.has('mode')));
}

function kyoboReport(node, source, base) {
  const href = attribute(node, 'href');
  if (!href) return null;
  let url;
  try { url = new URL(href, base); }
  catch { return null; }
  if (url.origin !== source.origin || url.pathname !== source.pathname) return null;
  const fields = url.searchParams;
  for (const [key, value] of [
    ['scr_id', source.searchParams.get('scr_id')], ['menuCode', source.searchParams.get('menuCode')], ['mode', 'detail'],
  ]) {
    if (fields.getAll(key).length !== 1 || fields.get(key) !== value) return null;
  }
  if (fields.getAll('sno').length !== 1 || !/^\d{1,18}$/.test(fields.get('sno') ?? '')) return null;
  const title = nodeTitle(node);
  return { url: url.href, title };
}

const miraeReportList = source => source.origin === 'https://securities.miraeasset.com' &&
  source.pathname === '/bbs/board/message/list.do' && ['1800', '1525'].includes(source.searchParams.get('categoryId'));

function miraeReport(node, source) {
  if (!miraeReportList(source) || !selectorMatches(node.parentNode, 'div.subject') ||
      !selectorMatches(node.parentNode.parentNode, 'td.left') || !/^bbsTitle\d+$/.test(attribute(node, 'id') ?? '')) return null;
  // Decode only the published numeric view-link convention, never execute inline script.
  const args = /^javascript:view\('(\d{1,18})','(\d{1,18})'\)$/.exec(attribute(node, 'href') ?? '');
  if (!args) return null;
  const detail = new URL('/bbs/board/message/view.do', source);
  detail.searchParams.set('categoryId', source.searchParams.get('categoryId'));
  detail.searchParams.set('messageId', args[1]);
  detail.searchParams.set('messageNumber', args[2]);
  return {url:detail.href,title:nodeTitle(node)};
}

function heungkukReport(node, source) {
  if (source.href !== 'https://www.heungkuksec.co.kr/research/company/list.do' ||
      !selectorMatches(node.parentNode,'td.left') || attribute(node,'href') !== '#') return null;
  const key = /^nav\.go\('view',\s*'key=(\d{1,18})'\);$/.exec(attribute(node,'onclick') ?? '');
  return key ? {url:new URL('view.do?key='+key[1],source).href,title:nodeTitle(node)} : null;
}

function hanwhaReport(node, source) {
  const category=source.searchParams.get('depth3_id');
  if(source.origin!=='https://www.hanwhawm.com' || source.pathname!=='/main/research/main/list.cmd' ||
      source.searchParams.getAll('depth3_id').length!==1 || !['anls1','anls2'].includes(category) ||
      !selectorMatches(node.parentNode,'div.tit') || !selectorMatches(node.parentNode,'div.'+category))return null;
  // Public numeric navigation convention observed by clicking a report, not script evaluation.
  const args=/^javascript:view\('(\d{1,18})',\s*'(anls[12])',\s*'(기업분석|산업분석)'\);$/.exec(attribute(node,'href')??'');
  if(!args || args[2]!==category || args[3]!==({anls1:'기업분석',anls2:'산업분석'})[category])return null;
  const target=new URL('/main/research/main/view.cmd',source);
  for(const[key,value]of [['depth3_id',category],['mode',''],['seq',args[1]],['p',''],['templet','default']])target.searchParams.set(key,value);
  return {url:target.href,title:nodeTitle(node)};
}

function yahooHeadline(node, source) {
  if (source.href !== 'https://finance.yahoo.com/topic/latest-news/') return null;
  let tags;
  try { tags=JSON.parse(attribute(node,'data-yga') ?? 'null'); } catch { return null; }
  if (tags?.yModuleName !== 'topic-stream' || tags.yContentType !== 'story') return null;
  const heading=[...elements(node)].find(n=>n.tagName==='h3');
  if (!heading) return null;
  let target;
  try { target=new URL(attribute(node,'href'),source); } catch { return null; }
  if (target.origin !== source.origin ||
      !/^\/(?:[a-z0-9-]+\/)*(?:articles|news)\/[a-z0-9-]+-\d{9,18}\.html$/.test(target.pathname)) return null;
  return {url:target.href,title:nodeTitle(heading)};
}

/** Returns same-origin discovery candidates from supplied HTML. Does not follow article links. */
export function parseHtmlList(html, listUrl, maxBytes = maxHtmlBytes, { includeOfficialReports = false } = {}) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > maxWatchHtmlBytes ||
      typeof html !== 'string' || Buffer.byteLength(html) > maxBytes) throw new Error('HTML_LIST_SIZE');
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
    if (source.href === capitalDataWireList && !capitalDataWireStory(url)) return;
    if (source.href === 'https://www.datacenterdynamics.com/en/news/' &&
        !/^\/en\/news\/[a-z0-9-]+\/$/.test(url.pathname)) return;

    const publishedAt = getPublishedAt(candidate.publishedAt);
    const existing = candidates.get(url.href);
    if (!existing) candidates.set(url.href, { url: url.href, title, publishedAt });
    else if (!existing.publishedAt && publishedAt) existing.publishedAt = publishedAt;
  }

  const markup = [];
  const kyobo = includeOfficialReports && kyoboReportListing(source);
  const headlineRule = headlineRules.find(rule => rule.sources.includes(source.href));
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
    } else if (node.tagName === 'a') {
      const yahoo = yahooHeadline(node,source);
      if (yahoo) add(yahoo);
      if (includeOfficialReports) {
        const candidate = miraeReport(node, source);
        if (candidate) add(candidate);
        const heungkuk = heungkukReport(node, source);
        if (heungkuk) add(heungkuk);
        const hanwha = hanwhaReport(node, source);
        if (hanwha) add(hanwha);
      }
      if (kyobo) {
        const candidate = kyoboReport(node, source, base);
        if (candidate) add(candidate);
      }
      if (headlineRule) {
        const candidate = publisherHeadline(node, source, base, headlineRule);
        if (candidate) add(candidate);
      }
    }
  }
  for (const node of markup) {
    const candidate = articleMarkup(node);
    if (candidate) add(candidate);
  }
  return { candidates: [...candidates.values()].slice(0, maxCandidates), truncated: candidates.size > maxCandidates };
}

/** Read the visible original heading without retaining the page body. */
export function parseOriginalTitle(html, url, listingHash) {
  const document = parse(html, { scriptingEnabled: true });
  const nodes = [...elements(document, node => ['script', 'style', 'template', 'noscript'].includes(node.tagName))];
  const canonical = nodes.find(node => node.tagName === 'link' && attribute(node, 'rel') === 'canonical');
  let canonicalMismatch=false;
  let canonicalHttps=false;
  let canonicalPublisher=false;
  if (canonical) {
    try {
      const declared = new URL(attribute(canonical, 'href'), url);
      const target = new URL(url);
      // Some publishers still declare HTTP canonicals on their HTTPS article pages.
      // This compares metadata only; no HTTP request or cross-host identity is allowed.
      if (declared.protocol === 'http:' && target.protocol === 'https:' &&
          declared.hostname === target.hostname && !declared.port && !declared.username && !declared.password) {
        declared.protocol = 'https:';
      }
      canonicalMismatch=normalizeArticleUrl(declared.href) !== normalizeArticleUrl(url);
      canonicalHttps=declared.protocol==='https:' && !declared.username && !declared.password && !declared.port;
      canonicalPublisher=!/(^|\.)yahoo\.com$/i.test(declared.hostname);
    } catch { return null; }
  }
  const inArticle = node => {
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      if (parent.tagName === 'article' || parent.tagName === 'main') return true;
    }
    return false;
  };
  const headings = nodes.filter(node => node.tagName === 'h1' && inArticle(node))
    .map(node => titleText(nodeTitle(node))).filter(Boolean);
  const meta = nodes.find(node => node.tagName === 'meta' && attribute(node, 'property') === 'og:title');
  const metaTitle = meta ? titleText(attribute(meta, 'content')) : '';
  const articleType = nodes.some(node => node.tagName === 'meta' &&
    attribute(node, 'property') === 'og:type' && attribute(node, 'content') === 'article');
  const visibleMatch = nodes.some(node => {
    if (!/^h[1-3]$/.test(node.tagName) || titleText(nodeTitle(node)) !== metaTitle) return false;
    for (let parent = node.parentNode; parent; parent = parent.parentNode) {
      if (['article', 'main'].includes(parent.tagName)) return true;
      if (['header', 'nav', 'footer'].includes(parent.tagName)) return false;
    }
    return true;
  });
  const title = metaTitle && (articleType || visibleMatch) ? metaTitle : headings.length === 1 ? headings[0] : '';
  const matchesListing = candidate => candidate && candidate.length <= 500 &&
    listingHash === createHash('sha256').update(candidate.normalize('NFC')).digest('hex');
  const source = new URL(url);
  if (canonicalMismatch) {
    const self=nodes.find(node=>node.tagName==='meta' && attribute(node,'property')==='og:url');
    let samePage=false;
    try { samePage=normalizeArticleUrl(attribute(self,'content'))===normalizeArticleUrl(url); } catch { /* Invalid identity stays held. */ }
    // Yahoo syndications declare the upstream publisher as canonical. Confirm the
    // publicly displayed Yahoo copy only; never follow or store the external page.
    if (!(source.origin==='https://finance.yahoo.com' && canonicalHttps && canonicalPublisher && samePage && articleType &&
      visibleMatch && matchesListing(metaTitle) &&
      /^\/(?:[a-z0-9-]+\/)*(?:articles|news)\/[a-z0-9-]+-\d{9,18}\.html$/.test(source.pathname))) return null;
  }
  const numeric = key => source.searchParams.getAll(key).length === 1 && /^\d{1,18}$/.test(source.searchParams.get(key));
  if(source.origin==='https://www.hanwhawm.com' && source.pathname==='/main/research/main/view.cmd') {
    if(!numeric('seq') || source.searchParams.getAll('depth3_id').length!==1 ||
        !['anls1','anls2'].includes(source.searchParams.get('depth3_id')))return null;
    const titles=nodes.filter(node=>node.tagName==='div' && selectorMatches(node.parentNode,'div.researchTit'))
      .map(node=>titleText(nodeTitle(node)));
    return titles.length===1 && matchesListing(titles[0]) ? titles[0] : null;
  }
  const matchedHeading = headings.find(matchesListing);
  if (matchedHeading) return matchedHeading;
  if (source.origin==='https://focustaiwan.tw' && /^\/business\/\d{12}$/.test(source.pathname) &&
      canonical && !canonicalMismatch && articleType) {
    const titles=nodes.filter(node=>node.tagName==='h1').map(node=>titleText(nodeTitle(node))).filter(matchesListing);
    if(titles.length===1)return titles[0];
  }
  if (source.origin === 'https://www.iprovest.com' && source.pathname === '/weblogic/RSReportServlet' &&
      source.searchParams.get('mode') === 'detail' && numeric('sno') &&
      ((source.searchParams.get('scr_id') === '34' && source.searchParams.get('menuCode') === '3') ||
       (source.searchParams.get('scr_id') === '40' && source.searchParams.get('menuCode') === '9'))) {
    const titles = nodes.filter(node => node.tagName === 'th' && titleText(nodeTitle(node)) === '제목')
      .map(node => {const siblings=node.parentNode?.childNodes?.filter(n=>n.tagName);return siblings?.[siblings.indexOf(node)+1];})
      .filter(node => node?.tagName === 'td').map(node=>titleText(nodeTitle(node))).filter(matchesListing);
    if (titles.length === 1) return titles[0];
  }
  if (source.origin === 'https://securities.miraeasset.com' && source.pathname === '/bbs/board/message/view.do' &&
      numeric('messageId') && numeric('messageNumber') && ['1800','1525'].includes(source.searchParams.get('categoryId'))) {
    const titles = nodes.filter(node=>node.tagName==='h4' && selectorMatches(node.parentNode,'th.bbs_detailTitle'))
      .map(node=>titleText(nodeTitle(node))).filter(matchesListing);
    if (titles.length === 1) return titles[0];
  }
  if (source.origin === 'https://www.heungkuksec.co.kr' && source.pathname === '/research/company/view.do' && numeric('key')) {
    const titles = nodes.filter(node=>selectorMatches(node,'td.left') && selectorMatches(node,'td.col_b669ad') &&
      selectorMatches(node.parentNode?.parentNode?.parentNode,'table.data_list_x'))
      .map(node=>titleText(nodeTitle(node))).filter(matchesListing);
    if (titles.length === 1) return titles[0];
  }
  return title && title.length <= 500 && (matchesListing(title) || articleType && visibleMatch) ? title : null;
}

/** Runs one exact listing fetch through existing HTTPS, permission and request budget checks. */
export async function collectHtmlList({ endpoint, profile, execute = false, now = () => new Date().toISOString(),
  transport = pinnedHttps, ...probeOptions }) {
  const output = (status, reason, requests = 0, candidates = [], response = {}) =>
    ({ endpointId: endpoint.endpoint_id, status, reason, requests, candidates, ...response });
  const checkPermission = () => permissionDecision(profile, endpoint, htmlListPurposes, now()) ??
    (endpoint.adapter_version !== htmlListVersion || !htmlListPurposes.every(purpose => endpoint.enabled_scopes?.includes(purpose)) ?
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
    ...probeOptions, endpoint, profile, purposes: htmlListPurposes, execute, now,
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
  if (result.status !== 'HTTP_OK_UNPARSED') {
    return output(result.status, result.reason, result.requests, [], {
      httpStatus: result.httpStatus ?? null,
      retryAfter: result.retryAfter ?? null,
    });
  }
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

export async function openArticleTitle({ endpoint, profile, url, now = () => new Date().toISOString(),
  transport = pinnedHttps, lookupHost, stillAuthorized = () => true }) {
  const checkPermission = () => endpoint.confirm_article_title === true && endpoint.url === capitalDataWireList &&
    htmlDetailPurposes.every(purpose => endpoint.enabled_scopes?.includes(purpose)) &&
    !permissionDecision(profile, endpoint, htmlDetailPurposes, now()) && stillAuthorized();
  if (!checkPermission()) return { requests: 0, title: null };
  let detail;
  try { detail = new URL(normalizeArticleUrl(url)); }
  catch { return { requests: 0, title: null }; }
  if (detail.origin !== new URL(endpoint.url).origin || !capitalDataWireStory(detail)) {
    return { requests: 0, title: null };
  }

  let responseBody;
  const result = await probe({
    endpoint: { ...endpoint, url: detail.href }, profile, purposes: htmlDetailPurposes, now, execute: true,
    lookupHost, limits: { timeoutMs: 5000, maxBytes: maxHtmlBytes, maxHops: 0 },
    transport: async (target, options) => {
      if (target !== detail.href || !checkPermission() || !profile.allowed_hosts?.includes(detail.hostname) ||
          !profile.methods?.includes('GET') || !(profile.max_requests >= 1) ||
          !(profile.max_bytes >= options.maxBytes) || !(profile.timeout_ms >= options.timeoutMs)) {
        throw new Error('DETAIL_SCOPE_CHANGED');
      }
      const response = await transport(target, options);
      if (response.status === 200 &&
          /^text\/html(?:\s*;\s*charset\s*=\s*"?utf-8"?)?$/i.test(response.contentType ?? '')) {
        responseBody = response.body;
      }
      return response;
    },
  });
  if (!checkPermission()) return { requests: result.requests, title: null };
  const fallback = { requests: result.requests, title: null, httpStatus: result.httpStatus, retryAfter: result.retryAfter };
  const unavailable = { ...fallback, unavailable: true };
  if (['REDIRECT_LIMIT', 'RESPONSE_TOO_LARGE'].includes(result.reason)) return unavailable;
  if (result.status !== 'HTTP_OK_UNPARSED') return fallback;
  if (!responseBody) return unavailable;
  let html;
  try { html = new TextDecoder('utf-8', { fatal: true }).decode(responseBody); }
  catch { return unavailable; }
  const document = parse(html, { scriptingEnabled: true });
  const all = [...elements(document, node => ['template', 'noscript'].includes(node.tagName))]
    .filter(node => node.namespaceURI === htmlNamespace);
  const canonical = all.filter(node => node.tagName === 'link' && attribute(node, 'rel') === 'canonical');
  const type = all.find(node => node.tagName === 'meta' && attribute(node, 'property') === 'og:type');
  if (canonical.length !== 1 || attribute(canonical[0], 'href') !== detail.href || !type || attribute(type, 'content') !== 'article') {
    return unavailable;
  }
  const headings = all.filter(node => node.tagName === 'h1' && selectorMatches(node.parentNode, 'header.article-header'));
  const title = headings.length === 1 ? titleText(nodeTitle(headings[0])) : '';
  return title && title.length <= 500 ? { ...fallback, title } : unavailable;
}
