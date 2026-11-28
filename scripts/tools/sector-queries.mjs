// Sector and macro news queries (docs/sector-news-plan.md §2.1). Deterministic: the same catalog sheet, registry
// and parser give the same bytes (no generation time). Korean queries come from each sector's 핵심키워드 and
// 추가키워드 (the 연관 검색어 column is not used); English queries name the sheet's related US companies, which the
// sheet marks UNVERIFIED_SOURCE — they are discovery terms only, never facts or links. Generation fails unless the
// parser's holds are exactly the reviewed baseline (339 unverified stock identities + 2 known membership differences).
// Usage: node scripts/tools/sector-queries.mjs [--check]   (--check compares with data/sector-queries.json)
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { parseCatalog, cellHash } from '../catalog/parse-catalog.mjs';

const root = new URL('../../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const sha = text => createHash('sha256').update(text).digest('hex');
export const MACRO = {
  ko: [['금리', '환율', '연준'], ['관세', '수출규제', '무역분쟁'], ['중국 반도체', '중국 메모리', '중국 경기'], ['엔비디아', '젠슨 황', '빅테크']],
  en: [['Federal Reserve', 'inflation', 'interest rates'], ['tariff', 'export controls', 'trade war'], ['China economy', 'China memory chips', 'China semiconductors'], ['Nvidia', 'Jensen Huang', 'Big Tech']],
};
const BASELINE_HOLDS = { STOCK_IDENTITY_UNVERIFIED: 339, LOWER_UPPER_MEMBERSHIP_DIFFERENCE: 2 };
const BASELINE_MEMBERSHIP_HOLDS = [['B333', '현대건설'], ['B360', 'HB테크놀러지']];

const usable = term => typeof term === 'string' && term.trim().length >= 2 && term.length <= 40 && !/["()]/.test(term) && !/\bOR\b/.test(term);
export function query(terms) {
  const unique = [...new Set(terms.map(t => t.trim()).filter(usable))];
  const text = unique.map(t => '"' + t + '"').join(' OR ');
  if (!unique.length || text.length > 200) throw new Error('QUERY_INVALID');
  return text;
}

export function buildQueries(parsed) {
  const counts = {};
  for (const u of parsed.unresolved) counts[u.code] = (counts[u.code] ?? 0) + 1;
  const membership = parsed.unresolved.filter(u => u.code === 'LOWER_UPPER_MEMBERSHIP_DIFFERENCE').map(u => [u.cell, u.company]).sort();
  if (JSON.stringify(counts) !== JSON.stringify(BASELINE_HOLDS) && JSON.stringify(Object.fromEntries(Object.entries(counts).sort())) !== JSON.stringify(Object.fromEntries(Object.entries(BASELINE_HOLDS).sort())))
    throw new Error('CATALOG_HOLDS_CHANGED ' + JSON.stringify(counts));
  if (JSON.stringify(membership) !== JSON.stringify(BASELINE_MEMBERSHIP_HOLDS)) throw new Error('CATALOG_MEMBERSHIP_HOLDS_CHANGED');
  // A term shared by five or more sectors is too general for a sector query.
  const keywordsOf = c => c.keywords.filter(k => !/^F\d+$/.test(k.cell)).map(k => k.value);
  const spread = new Map();
  for (const c of parsed.categories) for (const term of new Set(keywordsOf(c))) spread.set(term, (spread.get(term) ?? 0) + 1);
  const queries = [];
  for (const c of [...parsed.categories].sort((a, b) => (a.id < b.id ? -1 : 1))) {
    let ko = keywordsOf(c).filter(t => usable(t) && (spread.get(t) ?? 0) < 5);
    if (ko.length < 2) ko = [c.name, ...ko];
    queries.push({ queryId: c.id + ':ko', topic: c.id, locale: 'ko', name: c.name, q: query(ko.slice(0, 4)) });
    const us = (c.foreignCompanies?.US?.entries ?? []).map(e => String(e.text ?? e.value ?? '').split(/\s*[\[—]/)[0].trim()).filter(usable);
    if (us.length) queries.push({ queryId: c.id + ':en', topic: c.id, locale: 'en', name: c.name, q: query(us.slice(0, 3)) });
  }
  for (const locale of ['ko', 'en']) MACRO[locale].forEach((terms, i) => queries.push({ queryId: 'MACRO-' + (i + 1) + ':' + locale, topic: 'MACRO', locale, name: 'MACRO', q: query(terms) }));
  return queries;
}

export function generate() {
  const sourceText = read('tests/fixtures/catalog/source-20261114.json'), registryText = read('tests/fixtures/catalog/registry-v1.json');
  const parserText = read('scripts/catalog/parse-catalog.mjs');
  const parsed = parseCatalog(JSON.parse(sourceText), JSON.parse(registryText), { sourceSha256: cellHash(sourceText) });
  const body = { format: 'SECTOR_QUERIES_V1', sourceSha256: sha(sourceText), registrySha256: sha(registryText), parserSha256: sha(parserText), queries: buildQueries(parsed) };
  return JSON.stringify(body, null, 1) + '\n';
}

if (process.argv[1]?.replace(/\\/g, '/').endsWith('scripts/tools/sector-queries.mjs')) {
  const text = generate();
  if (process.argv.includes('--check')) {
    if (read('data/sector-queries.json') !== text) { console.error('SECTOR_QUERIES_OUT_OF_DATE'); process.exitCode = 1; }
    else console.log(JSON.stringify({ ok: true, sha256: sha(text) }));
  } else { writeFileSync(new URL('data/sector-queries.json', root), text); console.log(JSON.stringify({ queries: JSON.parse(text).queries.length, sha256: sha(text) })); }
}
