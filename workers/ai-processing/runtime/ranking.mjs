// Home ranking v2, stage R1 (docs/home-ranking-v2-plan.md): issue-level impact grades, primary-evidence count E,
// freshness F and a stateless diagnostic preview. Pure functions except where a database is passed. Nothing here
// reaches the cloud request (publish-map builds AI_DRAFT_V1 from known fields only) or the public home.
import assert from 'node:assert/strict';
import { outletDomain } from './store.mjs';
import { namesInTitle } from './evidence-match.mjs';
import { korean } from './news-report.mjs';

export const RANKING_POLICY = 'HOME_V2_R1';
export const DIMENSIONS = ['transmission', 'scope', 'magnitude', 'durability'];
const WEIGHTS = { transmission: 8, scope: 4, magnitude: 5, durability: 3 };
const PRIMARY = new Set(['OFFICIAL']);

// Structural ceiling of the scope grade (plan §3.1): only lowers, never raises.
export function scopeCeiling({ articleKind, impacts, macroPrimary, scopeSupported }) {
  const shown = impacts.filter(item => item.direction === 'BENEFIT' || item.direction === 'DAMAGE');
  if (articleKind === 'MACRO') return macroPrimary && scopeSupported ? 5 : 3;
  if (!shown.length) return 0;
  const companies = new Set(shown.flatMap(item => item.companyIds));
  if (companies.size <= 1) return 1;
  const bySector = new Map();
  for (const item of shown) bySector.set(item.sectorId, new Set([...(bySector.get(item.sectorId) ?? []), ...item.companyIds]));
  const sectors = [...bySector.values()].filter(set => set.size > 0);
  // Two sectors are independent when they share no company.
  const independent = sectors.some((a, i) => sectors.some((b, j) => j > i && [...a].every(id => !b.has(id))));
  if (sectors.length >= 2 && independent) return 4;
  if (sectors.some(set => set.size >= 2)) return 3;
  return 2;
}

// Grades from the writer, support from the independent verifier → assessment (plan §3.1).
// facts: canonical facts of the issue; documents: [{ id, sources: [{ kind, institution? }] }];
// factDocs: fact id → document ids it cites.
export function assessImpact({ grades, support, facts, factDocs, documents, articleKind, impacts, govDocIds = new Set() }) {
  const known = new Set(facts.map(fact => fact.id)), caps = [], out = {};
  const primaryDoc = id => documents.some(doc => doc.id === id && doc.sources.some(source => PRIMARY.has(source.kind)));
  for (const key of DIMENSIONS) {
    const item = grades?.[key];
    assert(item && Number.isInteger(item.grade) && item.grade >= 0 && item.grade <= 5, 'IMPACT_GRADE_INVALID');
    assert(Array.isArray(item.factIds) && new Set(item.factIds).size === item.factIds.length && item.factIds.every(id => known.has(id)), 'IMPACT_GRADE_FACT_UNKNOWN');
    assert(item.grade === 0 || item.factIds.length > 0, 'IMPACT_GRADE_EVIDENCE_REQUIRED');
    assert(support?.[key] === 'SUPPORTED' || support?.[key] === 'UNSUPPORTED', 'IMPACT_SUPPORT_INVALID');
    let grade = item.grade;
    const lower = (to, reason) => { if (to < grade) { grade = to; caps.push({ dimension: key, reason }); } };
    if (support[key] === 'UNSUPPORTED') lower(2, 'VERIFIER_UNSUPPORTED');
    if ((key === 'magnitude' || key === 'durability') && !item.factIds.some(id => (factDocs.get(id) ?? []).some(primaryDoc))) lower(2, 'NO_PRIMARY_SOURCE');
    if (key === 'scope') {
      const macroPrimary = item.factIds.some(id => (factDocs.get(id) ?? []).some(doc => govDocIds.has(doc)));
      lower(scopeCeiling({ articleKind, impacts, macroPrimary, scopeSupported: support.scope === 'SUPPORTED' }), 'SCOPE_STRUCTURE');
    }
    out[key] = { grade, factIds: [...item.factIds].sort() };
  }
  const rawI = DIMENSIONS.reduce((sum, key) => sum + WEIGHTS[key] * out[key].grade, 0);
  const effectiveI = out.transmission.grade < 3 ? Math.min(rawI, 44) : rawI;
  return { grades: out, caps, gradeSupport: { ...support }, rawI, effectiveI, band: band(effectiveI) };
}

// Government, regulator and exchange hosts counted as institutions (plan §3.3). Empty while every government source
// is disabled; adding one is a reviewed change.
export const GOV_HOSTS = new Set();
const hostOf = url => { try { return new URL(url).hostname.toLowerCase(); } catch { return null; } };
// Institution of one source link (not of the body-hash document): company:<catalog id>, gov:<host>, or null.
export function institutionOf(source, document, config) {
  const host = hostOf(source?.url); if (!host) return null;
  const entities = config.catalog?.entities ?? [];
  if (host === 'dart.fss.or.kr') {
    const title = String(document?.title ?? '');
    // Longest catalog name the title starts with, accepted only when exactly one catalog company has that name.
    const prefix = entities.filter(e => title.startsWith(e.name + ' ')).reduce((best, e) => e.name.length > best.length ? e.name : best, '');
    const owners = prefix ? entities.filter(e => e.name === prefix) : [];
    return owners.length === 1 ? 'company:' + owners[0].id : null;
  }
  if (GOV_HOSTS.has(host)) return 'gov:' + host;
  const grant = (config.sources ?? []).find(s => s.host === host && s.kind === 'OFFICIAL' && s.status === 'ENABLED' && !s.revokedAt);
  const match = grant && typeof grant.name === 'string' ? entities.filter(e => e.name === grant.name) : [];
  return match.length === 1 ? 'company:' + match[0].id : null;
}

export const band = effectiveI => effectiveI >= 75 ? 'HIGH' : effectiveI >= 45 ? 'MEDIUM' : 'STANDARD';
export const freshness = (changedAt, now) => Math.pow(0.5, Math.max(0, now - changedAt) / 3600_000 / 6);
// Distinct evidence institutions (company, government): 0 → 0, 1 → 0.5, 2+ → 1.
export const evidenceScore = institutions => { const k = new Set(institutions.filter(Boolean)).size; return k === 0 ? 0 : k === 1 ? 0.5 : 1; };

const unit = (value, name) => { assert(Number.isFinite(value) && value >= 0 && value <= 1, 'RANK_INPUT_INVALID:' + name); return value; };
export function score({ band: b, effectiveI, E, F }) {
  const I = unit(effectiveI / 100, 'I'); unit(E, 'E'); unit(F, 'F');
  const s = b === 'HIGH' ? 100 * (0.80 * I + 0.10 * E + 0.10 * F) : 100 * (0.70 * I + 0.15 * E + 0.15 * F);
  assert(s >= 0 && s <= 100 + 1e-9, 'RANK_SCORE_INVALID');
  return Math.round(s * 100) / 100;
}

const ORDER = { HIGH: 0, MEDIUM: 1, STANDARD: 2 };
// candidates: [{ id, storyKey, articleKind, assessment|null, institutions, changedAt, title }]
export function rankPreview(candidates, now) {
  const rows = [], invalid = [];
  for (const c of candidates) {
    if (c.articleKind !== 'SECTOR' && c.articleKind !== 'MACRO') continue;
    const F = freshness(c.changedAt, now), E = evidenceScore(c.institutions);
    if (!c.assessment) { rows.push({ ...c, band: 'STANDARD', missingI: true, S: null, E, F }); continue; }
    try { rows.push({ ...c, band: c.assessment.band, missingI: false, S: score({ band: c.assessment.band, effectiveI: c.assessment.effectiveI, E, F }), E, F }); }
    catch (error) { invalid.push({ id: c.id, reason: String(error.message).slice(0, 60) }); }
  }
  rows.sort((a, b) => ORDER[a.band] - ORDER[b.band] || Number(a.missingI) - Number(b.missingI) || (b.S ?? 0) - (a.S ?? 0)
    || b.changedAt - a.changedAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const seen = new Set(), ranked = [], sameStory = [];
  for (const row of rows) (seen.has(row.storyKey) ? sameStory : (seen.add(row.storyKey), ranked)).push(row);
  return { policy: RANKING_POLICY, diagnostic: true, ranked, sameStory, invalid };
}

// ---- Candidates, signal links and the diagnostic preview (plan §3.2, §4.5) ----

const day = 86400000;
const parse = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };
// Candidates: issue rows whose current version has a READY export and a DRAFT_READY job (same rule as store.exports).
export function previewCandidates(db, now) {
  return db.prepare(`SELECT i.id,i.story_key,i.version,i.payload,i.ranking,i.created_at FROM issues i
      JOIN draft_exports e ON e.issue_id=i.id AND e.version=i.version AND e.state='READY' AND e.expires_at>?
      WHERE i.expires_at>? AND EXISTS(SELECT 1 FROM jobs j WHERE j.state='DRAFT_READY' AND json_extract(j.payload,'$.issueId')=i.id
        AND json_extract(j.payload,'$.version')=i.version) ORDER BY i.id`).all(now, now).map(row => {
    const draft = parse(row.payload, {}), ranking = parse(row.ranking ?? 'null', null);
    const published = (draft.source_refs ?? []).map(source => Date.parse(source.publishedAt)).filter(Number.isFinite);
    return { id: row.id, version: row.version, storyKey: row.story_key, articleKind: draft.article_kind, title: String(draft.title ?? '').slice(0, 120),
      companies: [...new Set(draft.company_refs ?? [])], assessment: ranking?.assessment ?? null,
      institutions: (ranking?.evidence ?? []).map(item => item.institution), changedAt: ranking?.materialChangeAt ?? row.created_at,
      legacyTime: !Number.isFinite(ranking?.materialChangeAt), firstEvidenceAt: published.length ? Math.min(...published) : row.created_at };
  });
}

// Company → stories among SECTOR candidates; a company in two or more stories is ambiguous.
function companyStories(candidates) {
  const map = new Map();
  for (const c of candidates) if (c.articleKind === 'SECTOR') for (const company of c.companies) map.set(company, new Set([...(map.get(company) ?? []), c.storyKey]));
  return map;
}
export function linkState(candidate, candidates, linkedCount) {
  if (candidate.articleKind !== 'SECTOR' || !candidate.companies.length) return 'UNLINKABLE';
  const stories = companyStories(candidates);
  if (candidate.companies.every(company => (stories.get(company)?.size ?? 0) !== 1)) return 'UNLINKABLE';
  return linkedCount > 0 ? 'LINKED' : 'ZERO';
}

// Service only: rebuild links for the current candidate versions in one transaction. Finlight/GNews signals only.
export function linkSignals(db, config, now) {
  const entities = config.catalog?.entities ?? [], byName = new Map();
  for (const e of entities) byName.set(e.name, [...(byName.get(e.name) ?? []), e.id]);
  const names = [...byName.keys()].sort((x, y) => y.length - x.length || (x < y ? -1 : 1));
  const insert = db.prepare('INSERT OR IGNORE INTO signal_issue_links VALUES (?,?,?,?,?,?)');
  let links = 0, ambiguous = 0, count = 0;
  // Candidates, stock codes and signals are read inside the same write transaction as the rebuild, so the links
  // always match one consistent snapshot of the current candidates.
  db.exec('BEGIN IMMEDIATE');
  try {
    const candidates = previewCandidates(db, now), stories = companyStories(candidates); count = candidates.length;
    let stocks = new Map(); try { stocks = new Map(db.prepare('SELECT stock_code,name FROM dart_stocks').all().map(r => [r.stock_code, r.name])); } catch {}
    const signals = db.prepare(`SELECT url,title,tickers,first_seen FROM news_signals WHERE first_seen>? AND (sources LIKE '%"gnews:%' OR sources LIKE '%"finlight:%')`).all(now - 10 * day);
    // Every pass rebuilds the whole relation from the current rules: links of old versions, departed candidates,
    // newly ambiguous companies and aged-out signals all disappear.
    db.exec('DELETE FROM signal_issue_links');
    for (const s of signals) {
      const named = new Set(namesInTitle(s.title, names));
      for (const t of parse(s.tickers ?? '[]', [])) { const code = /^[A-Z]{2,8}:(\d{6})$/.exec(String(t))?.[1]; if (code && stocks.has(code)) named.add(stocks.get(code)); }
      for (const name of named) {
        const ids = byName.get(name) ?? []; if (ids.length !== 1) continue;
        const company = ids[0], set = stories.get(company);
        if (!set) continue;
        if (set.size !== 1) { ambiguous++; continue; }
        const [story] = set;
        for (const c of candidates) if (c.storyKey === story && c.articleKind === 'SECTOR' && c.companies.includes(company)
          && s.first_seen >= c.firstEvidenceAt - day && s.first_seen <= c.firstEvidenceAt + 2 * day)
          links += Number(insert.run(c.id, c.version, s.url, company, 'COMPANY_UNIQUE', now).changes);
      }
    }
    db.exec('COMMIT');
  } catch (error) { if (db.isTransaction) db.exec('ROLLBACK'); throw error; }
  return { candidates: count, links, ambiguous };
}

// Curated publisher aliases (several hosts of one publisher → one outlet). Empty until a reviewed entry is added.
export const PUBLISHER_ALIASES = new Map();
// Read only: news spread of one issue version (diagnostic; not part of S in R1).
export function attentionDiagnostics(db, issueId, version, now, aliases = PUBLISHER_ALIASES) {
  const rows = db.prepare(`SELECT n.url,n.host,n.first_seen FROM signal_issue_links l JOIN news_signals n ON n.url=l.signal_url
    WHERE l.issue_id=? AND l.issue_version=? AND n.first_seen>?`).all(issueId, version, now - day);
  const outlet = host => { const d = outletDomain(host); return d ? aliases.get(d) ?? d : null; };
  const outlets = window => new Set(rows.filter(r => r.first_seen > now - window).map(r => outlet(r.host)).filter(Boolean));
  const all = outlets(day), recent = outlets(3 * 3600_000).size, earlier = all.size - recent;
  return { linked: rows.length, outlets24: all.size,
    velocity: recent >= 3 ? Math.min(recent / Math.max(1, earlier * 3 / 21), 2) / 2 : null,
    foreign: [...all].some(domain => !korean(domain) && !korean('www.' + domain)) };
}

// Read only: the diagnostic home preview (no URLs, no bodies).
export function homePreview(db, now) {
  const candidates = previewCandidates(db, now);
  const count = (id, version) => { try { return db.prepare('SELECT count(*) n FROM signal_issue_links WHERE issue_id=? AND issue_version=?').get(id, version).n; } catch { return 0; } };
  const view = rankPreview(candidates, now);
  const row = r => ({ id: r.id, title: r.title, band: r.band, S: r.S, missingI: r.missingI, effectiveI: r.assessment?.effectiveI ?? null,
    grades: r.assessment ? Object.fromEntries(Object.entries(r.assessment.grades).map(([k, v]) => [k, v.grade])) : null,
    E: r.E, F: Math.round(r.F * 1000) / 1000, legacyTime: r.legacyTime,
    news: { state: linkState(r, candidates, count(r.id, r.version)), ...(() => { try { return attentionDiagnostics(db, r.id, r.version, now); } catch { return {}; } })() } });
  return { policy: view.policy, diagnostic: true, note: '진단용, 공개 순위 아님', at: new Date(now).toISOString(),
    ranked: view.ranked.map(row), sameStory: view.sameStory.map(r => ({ id: r.id, title: r.title })), invalid: view.invalid };
}
