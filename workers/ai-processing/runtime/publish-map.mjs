// Publish stage 1A (docs/publish-stage1-plan.md, A4): AI export snapshot (AI_DRAFT_EXPORT_V1, store.exportSnapshot)
// -> AI_DRAFT_V1 intake payload (migration 57, private.ai_ingest_draft). Pure: no I/O, no clock.
// The database decides trust (claim type from the verification class, officialness from the source host); this module
// only reshapes and holds back drafts it cannot represent faithfully.
import { createHash } from 'node:crypto';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY = /^[A-Za-z0-9_.:-]{1,200}$/;
const OFFSET_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const hold = reason => ({ hold: reason });
const host = url => { try { return new URL(url).hostname; } catch { return ''; } };

// Keeps a key the DB accepts; anything else becomes a stable hash of itself.
const safeKey = value => (typeof value === 'string' && KEY.test(value) ? value : 'h:' + sha(String(value)).slice(0, 40));

export function toIntakePayload(snapshot) {
  if (snapshot?.format !== 'AI_DRAFT_EXPORT_V1') return hold('EXPORT_FORMAT');
  const { issueId, version, draft, facts, catalogRef } = snapshot;
  if (!UUID.test(issueId ?? '') || !Number.isInteger(version) || version < 1) return hold('EXPORT_IDENTITY');
  if (!draft || !Array.isArray(facts) || !facts.length || facts.length > 30) return hold('EXPORT_FACTS');
  if (typeof catalogRef?.registry !== 'string' || !/^[0-9a-f]{64}$/.test(catalogRef?.sha256 ?? '')) return hold('EXPORT_CATALOG_REF');

  // Sources: unique links, PRIMARY first then newest; at most 12. A fact citing only dropped links cannot travel.
  const byUrl = new Map();
  for (const source of draft.source_refs ?? []) if (typeof source.url === 'string' && !byUrl.has(source.url)) byUrl.set(source.url, source);
  const ordered = [...byUrl.values()].sort((a, b) => (a.role === 'PRIMARY' ? 0 : 1) - (b.role === 'PRIMARY' ? 0 : 1)
    || String(b.publishedAt ?? '').localeCompare(String(a.publishedAt ?? '')) || a.url.localeCompare(b.url));
  const kept = ordered.slice(0, 12), keptUrls = new Set(kept.map(source => source.url));
  if (!kept.length) return hold('NO_SOURCES');
  const outFacts = [];
  for (const fact of facts) {
    const urls = (fact.sourceUrls ?? []).filter(url => keptUrls.has(url));
    if (urls.length !== (fact.sourceUrls ?? []).length || !urls.length) return hold('SOURCE_OVERFLOW');
    outFacts.push({ id: fact.id, statement: fact.statement, verification_class: fact.verificationClass,
      independently_verified: fact.independentlyVerified === true, korea_path_verified: fact.koreaPathVerified === true,
      recorded_at: new Date(fact.recordedAt).toISOString(), source_urls: urls });
  }
  const factIds = new Set(outFacts.map(fact => fact.id));
  const known = ids => (ids ?? []).filter(id => factIds.has(id));

  // Impacts keep every direction (RELATED is stored, never shown). Path IDs are stable per draft: category + order.
  const impacts = (draft.impacts ?? []).map((item, index) => ({
    sector_id: item.sectorId, path_id: `${String(item.category ?? 'PATH').replace(/[^A-Za-z0-9_-]/g, '')}-${index + 1}`,
    direction: item.direction, conditional_direction: item.conditionalDirection ?? 'NONE', description: item.description,
    conditions: item.conditions ?? [], evidence_fact_ids: known(item.factIds),
    companies: (item.companyRoles ?? []).map(role => ({ company_ref: role.companyId, role: role.role }))
  }));
  if (impacts.some(item => !item.evidence_fact_ids.length)) return hold('IMPACT_WITHOUT_FACTS');
  const positive = impacts.filter(item => item.direction === 'BENEFIT' || item.conditional_direction === 'POSITIVE').map(item => item.path_id);
  const negative = impacts.filter(item => item.direction === 'DAMAGE' || item.conditional_direction === 'NEGATIVE').map(item => item.path_id);
  // Publication rule: scenarios exist only with positive paths; one per direction that has paths.
  const scenarios = positive.length ? (draft.scenarios ?? []).filter(item => (item.direction === 'POSITIVE' ? positive : negative).length)
    .map(item => ({ direction: item.direction, title: item.title, expected_result: item.expected_result, checks: item.checks,
      path_ids: item.direction === 'POSITIVE' ? positive : negative })) : [];

  // Primary sector: first benefit, then first damage, then (SECTOR only) the first impact; COMPANY without impacts has none.
  const first = direction => impacts.find(item => item.direction === direction)?.sector_id;
  const primarySector = first('BENEFIT') ?? first('DAMAGE') ?? (draft.article_kind === 'COMPANY' ? null : impacts[0]?.sector_id ?? null);

  // Schedule: exact instants with an offset. VERIFIED only when every cited fact comes from PRIMARY links only (the
  // database requires official-original evidence and checks the host itself); otherwise UNVERIFIED.
  const primaryOnly = id => { const fact = facts.find(item => item.id === id); return (fact?.sources ?? []).length > 0 && fact.sources.every(source => source.role === 'PRIMARY'); };
  const schedule = [];
  for (const item of draft.schedule ?? []) {
    if (!OFFSET_ISO.test(item.eventAt ?? '') || typeof item.timezone !== 'string') continue;
    const evidence = known(item.factIds);
    if (!evidence.length) continue;
    schedule.push({ kind: 'EXACT', status: evidence.every(primaryOnly) ? 'VERIFIED' : 'UNVERIFIED', title: item.title, timezone: item.timezone,
      event_at: item.eventAt, evidence_as_of: new Date(snapshot.verifiedAt).toISOString(), evidence_fact_ids: evidence });
  }

  const hosts = kept.map(source => host(source.url));
  const payload = {
    format: 'AI_DRAFT_V1', ai_issue_id: issueId, ai_version: version, story_key: safeKey(snapshot.storyKey), angle_key: safeKey(snapshot.angleKey ?? draft.angleKey),
    catalog_ref: { registry: String(catalogRef?.registry ?? ''), sha256: String(catalogRef?.sha256 ?? '') },
    draft: {
      title: draft.title, summary: draft.summary, issue_analysis: draft.issue_analysis?.text ?? '',
      key_issues: (draft.key_issues ?? []).map(item => item.text), risks: (draft.risks ?? []).map(item => item.text),
      article_kind: draft.article_kind, primary_sector_id: primarySector,
      primary_company_ref: draft.article_kind === 'COMPANY' ? draft.primary_company_ref ?? null : null, company_refs: draft.company_refs ?? [],
      source_market: hosts.every(name => name.endsWith('.kr')) ? 'KR' : 'GLOBAL', selection_market_basis: 'KR',
      sources: kept.map(source => ({ name: String(source.name ?? host(source.url)).slice(0, 100), url: source.url, role: source.role === 'PRIMARY' ? 'PRIMARY' : 'REPORTED' })),
      impacts, scenarios, schedule
    },
    facts: outFacts
  };
  return { payload, effectKey: `ai:${issueId}:${version}` };
}
