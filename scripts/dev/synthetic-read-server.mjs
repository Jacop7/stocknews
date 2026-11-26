// Development-only public read API with built-in SYNTHETIC data.
//
// The real local read path needs a local Supabase (Docker) behind
// scripts/public-read-gateway.mjs. This server lets the mobile app run
// without Docker or credentials: it uses the same route parsers and response
// validators as the gateway, and answers from the catalog fixture plus a
// small set of clearly synthetic articles. It never contacts a network host,
// never reads .local-data and binds to 127.0.0.1 only.
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readRoute } from '../public-read-gateway.mjs';
import { catalogResponse, CatalogReadError } from '../catalog/public-route.mjs';
import { searchResponse } from '../catalog/search-route.mjs';
import { SYNTHETIC_ARTICLES, SYNTHETIC_COMPANIES } from './synthetic-articles.mjs';

const CATALOG_VERSION = '1';
const DAY = 86400000;
const KST = 9 * 3600000;
const registry = JSON.parse(readFileSync(new URL('../../tests/fixtures/catalog/registry-v1.json', import.meta.url), 'utf8'));

export function syntheticUuid(seed) {
  const h = createHash('sha256').update('judoju-dev-synthetic:' + seed).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---- Catalog --------------------------------------------------------------
// Sheet-derived names can carry stray whitespace (e.g. '철강 '); match on trimmed names.
const categoryByName = new Map(registry.categories.map(c => [c.name.trim(), { ...c, name: c.name.trim() }]));
const categoryById = new Map([...categoryByName.values()].map(c => [c.id, c]));
const parents = registry.parents.map((p, index) => ({
  id: p.id,
  name: p.name,
  order: index + 1,
  sectors: p.categories.map((name, order) => {
    const c = categoryByName.get(name.trim());
    return { id: c.id, name: c.name, parent_id: p.id, order: order + 1 };
  }),
}));
const catalog = { catalog_version: CATALOG_VERSION, metadata_kind: 'USER_REFERENCE_UNVERIFIED', parents };
const sectorId = name => {
  const c = categoryByName.get(name);
  if (!c) throw new Error('Unknown synthetic sector ' + name);
  return c.id;
};

// ---- Companies (Korean companies only) -------------------------------------
const companies = SYNTHETIC_COMPANIES.map(c => ({
  ref: syntheticUuid('company:' + c.name),
  name: c.name,
  description: c.description,
  sectorIds: c.sectors.map(sectorId),
  group: c.group ?? null,
}));

function referenceCompany(company, sector) {
  return {
    membership_id: syntheticUuid('membership:' + company.name + ':' + sector),
    source_company_ref: company.ref,
    name: company.name,
    description: company.description,
    stock_identity_state: 'UNRESOLVED',
    stock_code: null, price: null, change_percent: null, stock_url: null,
  };
}

// ---- Articles --------------------------------------------------------------
// Times are relative to server start so every period filter has content.
function buildArticles(now) {
  return SYNTHETIC_ARTICLES.map((a, index) => {
    const id = syntheticUuid('issue:' + a.key);
    const published = new Date(now - a.hoursAgo * 3600000);
    const primary = a.sector ? sectorId(a.sector) : null;
    const impacts = a.impacts.map((x, n) => ({
      sector_id: sectorId(x.sector),
      sector_name: x.sector,
      path_id: syntheticUuid('path:' + a.key + ':' + n),
      direction: x.direction,
      conditional_direction: x.conditional ?? 'NONE',
      description: x.description,
      conditions: x.conditions ?? [],
      companies: x.companies ?? [],
    }));
    const visible = ['KEY_ISSUES', 'ISSUE_ANALYSIS'];
    const hasPositive = impacts.some(x => x.direction === 'BENEFIT');
    if (hasPositive && a.scenarios?.length) visible.push('SCENARIOS');
    if (impacts.some(x => x.direction === 'BENEFIT')) visible.push('BENEFIT_SECTORS');
    if (impacts.some(x => x.direction === 'DAMAGE')) visible.push('DAMAGE_SECTORS');
    if (impacts.some(x => x.direction === 'RELATED')) visible.push('RELATED_SECTORS');
    if (!hasPositive && a.risks?.length) visible.push('RISKS');
    if (a.schedule?.length) visible.push('SCHEDULE');
    visible.push('SOURCES');
    return {
      order: index,
      issue_id: id,
      version_id: syntheticUuid('version:' + a.key),
      title: a.title,
      summary: a.summary,
      first_published_at: published.toISOString(),
      material_change_at: published.toISOString(),
      sample_kind: 'SYNTHETIC',
      article_kind: a.sector ? 'SECTOR' : 'MACRO',
      sector_name: a.sector ?? null,
      sector_id: primary,
      legacy_sector: false,
      lane: a.lane,
      sectorIds: new Set([primary, ...impacts.map(x => x.sector_id)].filter(Boolean)),
      body: {
        key_issues: a.keyIssues,
        issue_analysis: a.analysis,
        sources: a.sources.map(name => ({ name, url: 'https://example.invalid/synthetic' })),
        visible_sections: visible,
        source_market: a.sourceMarket ?? 'KR',
        selection_market_basis: 'KR',
        analysis_perspective: 'KR_EQUITY',
        impact_profile: hasPositive ? (impacts.some(x => x.direction === 'DAMAGE') ? 'POSITIVE_NEGATIVE' : 'POSITIVE_ONLY') : (impacts.some(x => x.direction === 'DAMAGE') ? 'DAMAGE_ONLY' : 'RELATED_CONDITIONAL'),
        article_kind: a.sector ? 'SECTOR' : 'MACRO',
        impacts,
        ...(a.scenarios ? { scenarios: a.scenarios.map(s => ({ ...s, path_ids: [] })) } : {}),
        ...(a.risks ? { risks: a.risks } : {}),
        ...(a.schedule ? { schedule: a.schedule } : {}),
      },
    };
  });
}

const card = a => ({
  issue_id: a.issue_id, version_id: a.version_id, title: a.title, summary: a.summary,
  first_published_at: a.first_published_at, material_change_at: a.material_change_at,
  sample_kind: 'SYNTHETIC', article_kind: a.article_kind, sector_name: a.sector_name,
  sector_id: a.sector_id, legacy_sector: false,
  impacts: a.body.impacts.map(({ sector_id, sector_name, direction, companies }) => ({ sector_id, sector_name, direction, companies })),
});

function periodBounds(period, now) {
  const local = new Date(now + KST);
  local.setUTCHours(0, 0, 0, 0);
  let start = local.getTime(), end = start + DAY;
  if (period === 'YESTERDAY') { start -= DAY; end -= DAY; }
  if (period === 'THIS_WEEK' || period === 'LAST_WEEK') {
    start -= ((local.getUTCDay() + 6) % 7 + (period === 'LAST_WEEK' ? 7 : 0)) * DAY;
    end = start + 7 * DAY;
  }
  if (period === 'THIS_MONTH' || period === 'LAST_MONTH') {
    const back = period === 'LAST_MONTH' ? 1 : 0;
    start = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - back, 1);
    end = Date.UTC(local.getUTCFullYear(), local.getUTCMonth() - back + 1, 1);
  }
  return { start: start - KST, end: Math.min(end - KST, now + 1) };
}

const newestFirst = (a, b) => b.first_published_at.localeCompare(a.first_published_at) || b.issue_id.localeCompare(a.issue_id);
const matches = (a, q) => [a.title, a.summary, a.sector_name ?? '', ...a.body.impacts.flatMap(x => [x.sector_name, ...x.companies])].join(' ').toLowerCase().includes(q);

// Pagination is not needed for this small fixture; every page is the last.
export function createSyntheticTransport(now = Date.now()) {
  const articles = buildArticles(now);
  const byId = new Map(articles.map(a => [a.issue_id, a]));
  const asOf = new Date(now).toISOString();
  const handlers = {
    catalog_public_tree: () => catalog,
    catalog_public_articles: ({ p_sectors, p_period, p_limit }) => {
      const { start, end } = periodBounds(p_period, now);
      const items = articles
        .filter(a => Date.parse(a.first_published_at) >= start && Date.parse(a.first_published_at) < end)
        .filter(a => !p_sectors.length || p_sectors.some(id => a.sectorIds.has(id)))
        .sort(newestFirst).slice(0, p_limit).map(card);
      return { catalog_version: CATALOG_VERSION, as_of: asOf, period: p_period, range_start: new Date(start).toISOString(), range_end: new Date(end).toISOString(), items, next: null };
    },
    catalog_public_sector_page: ({ p_sector }) => {
      const c = categoryById.get(p_sector);
      if (!c) return { state: 'NOT_FOUND', catalog_version: CATALOG_VERSION };
      const members = companies.filter(x => x.sectorIds.includes(c.id));
      const groupNames = [...new Set(members.map(x => x.group).filter(Boolean))];
      return {
        state: 'AVAILABLE', catalog_version: CATALOG_VERSION, id: c.id, name: c.name,
        description: `${c.name} 관련 국내 기업과 이슈를 모아 봅니다. (개발용 합성 설명)`,
        parent_id: c.parentId, metadata_kind: 'USER_REFERENCE_UNVERIFIED',
        groups: groupNames.map((name, order) => ({ id: syntheticUuid('group:' + c.id + name), name, order: order + 1, members: members.filter(x => x.group === name).map(x => referenceCompany(x, c.id)) })),
        ungrouped_members: members.filter(x => !x.group).map(x => referenceCompany(x, c.id)),
        offset: 0, total_memberships: members.length, next_offset: null,
      };
    },
    catalog_public_search_news: ({ p_query, p_limit }) => ({
      catalog_version: CATALOG_VERSION, as_of: asOf, next: null,
      items: articles.filter(a => matches(a, p_query)).sort(newestFirst).slice(0, p_limit).map(card),
    }),
    catalog_public_search_companies: ({ p_query, p_limit }) => ({
      catalog_version: CATALOG_VERSION, next: null,
      items: companies.filter(c => c.name.toLowerCase().includes(p_query) || c.description.toLowerCase().includes(p_query)).slice(0, p_limit).map(c => ({
        source_company_ref: c.ref, name: c.name, search_description: c.description,
        metadata_kind: 'USER_REFERENCE_UNVERIFIED', stock_identity_state: 'UNRESOLVED',
        stock_code: null, price: null, change_percent: null, stock_url: null,
        related_sectors: c.sectorIds.slice(0, 3).map((id, n) => ({ id, name: categoryById.get(id).name, display_order: n + 1 })),
        has_more_sectors: c.sectorIds.length > 3,
      })),
    }),
    catalog_public_company_sectors: ({ p_company }) => {
      const c = companies.find(x => x.ref === p_company);
      return { catalog_version: CATALOG_VERSION, state: c ? 'AVAILABLE' : 'NOT_FOUND', items: (c?.sectorIds ?? []).map((id, n) => ({ id, name: categoryById.get(id).name, display_order: n + 1 })), next_offset: null };
    },
    catalog_public_saved: ({ p_issues }) => ({
      catalog_version: CATALOG_VERSION,
      items: p_issues.map(id => {
        const a = byId.get(id);
        return a ? { requested_issue_id: id, state: 'PUBLISHED', canonical_issue_id: id, card: card(a) }
          : { requested_issue_id: id, state: 'NOT_FOUND', message: '삭제되었거나 더 이상 제공하지 않는 글입니다.' };
      }),
    }),
    m1_public_article: ({ p_issue }) => {
      const a = byId.get(p_issue);
      if (!a) return { state: 'NOT_FOUND', message: '삭제되었거나 더 이상 제공하지 않는 글입니다.' };
      return { state: 'PUBLISHED', issue_id: a.issue_id, version_id: a.version_id, title: a.title, summary: a.summary, body: a.body, first_published_at: a.first_published_at, material_change_at: a.material_change_at, sample_kind: 'SYNTHETIC' };
    },
  };
  const home = () => {
    const cutoff = new Date(Math.floor(now / 300000) * 300000).toISOString();
    const lanes = { A: [], B: [], C: [] };
    for (const a of [...articles].sort((x, y) => x.order - y.order)) lanes[a.lane].push(card(a));
    return { state: 'FRESH', ranking_cutoff: cutoff, source_cutoff: cutoff, lanes };
  };
  return { handlers, home, articles };
}

export async function startSyntheticReadServer({ port = 62330, now = Date.now() } = {}) {
  const { handlers, home } = createSyntheticTransport(now);
  const server = createServer((req, res) => {
    const headers = { 'Cache-Control': 'no-store', 'Content-Type': 'application/json; charset=utf-8' };
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) { headers['Access-Control-Allow-Origin'] = origin; headers.Vary = 'Origin'; }
    const send = (status, body) => { res.writeHead(status, headers); res.end(req.method === 'HEAD' ? undefined : JSON.stringify(body)); };
    try {
      if (req.method === 'OPTIONS') { res.writeHead(204, { ...headers, 'Access-Control-Allow-Methods': 'GET, HEAD', 'Access-Control-Allow-Headers': 'Accept, Cache-Control' }); res.end(); return; }
      if (!['GET', 'HEAD'].includes(req.method)) { send(405, { error: 'METHOD_REJECTED' }); return; }
      let value;
      if (req.url === '/v2/home') value = home();
      else {
        const route = readRoute(req.url ?? '');
        const handler = handlers[route.name];
        if (!handler) { send(404, { error: 'ROUTE_NOT_AVAILABLE_IN_SYNTHETIC_DEV' }); return; }
        const raw = handler(route.args);
        value = route.search ? searchResponse(route, raw) : catalogResponse(route, raw);
      }
      send(200, { productId: 'judoju-news', mode: 'LOCAL_SYNTHETIC', data: value });
    } catch (e) {
      const status = e instanceof CatalogReadError || typeof e?.status === 'number' ? e.status : 500;
      send(status, { error: e?.message ?? 'SYNTHETIC_READ_FAILED' });
    }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen({ host: '127.0.0.1', port }, resolve); });
  return { server, port: server.address().port, close: () => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }) };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const s = await startSyntheticReadServer();
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => s.close());
  console.log(JSON.stringify({ component: 'DEV_SYNTHETIC_READ', host: '127.0.0.1', port: s.port, mode: 'LOCAL_SYNTHETIC', network: 'none' }));
}
