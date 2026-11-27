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
// First instant of a local calendar day, as a local wall time with its offset, checked by round trip: the instant must
// read back as that date in that zone. Midnight can be skipped by a DST change (the day then starts at 01:00) and a
// whole day can be skipped by a date-line change (then there is no start: null).
function localDayStart(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' });
  const local = ms => Object.fromEntries(parts.formatToParts(new Date(ms)).map(part => [part.type, part.value]));
  const dayOf = ms => { const got = local(ms); return got.year + '-' + got.month + '-' + got.day; };
  // The earliest instant whose local date is that day: scan in 15-minute steps, then step back by minutes and by
  // seconds (historical local-mean-time offsets have seconds). Covers skipped or repeated midnights and fractional
  // starts; a skipped day has no instant at all (null). Returned as a UTC instant, which is exact and unambiguous.
  const base = Date.parse(date + 'T00:00:00Z'), minute = 60_000;
  let found = null;
  for (let ms = base - 30 * 3_600_000; ms <= base + 30 * 3_600_000; ms += 15 * minute) if (dayOf(ms) === date) { found = ms; break; }
  if (found === null) return null;
  while (dayOf(found - minute) === date) found -= minute;
  while (dayOf(found - 1000) === date) found -= 1000;
  return new Date(found).toISOString();
}
// Stage 1A hosts: the database accepts only these, all official Korean filing hosts. They decide the market (KR) and
// the source role (PRIMARY), exactly as the database classifies them; any other host holds the draft.
const DOMESTIC_HOSTS = new Set(['dart.fss.or.kr', 'kind.krx.co.kr']);
const OFFICIAL_HOSTS = DOMESTIC_HOSTS;
// Limits of the intake check (migration 57); a draft beyond them is held, never trimmed.
const LIMITS = { key_issues: 12, risks: 20, company_refs: 30, impacts: 30, schedule: 20, evidence: 10, conditions: 10, checks: 10, companies: 20 };

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
  // Evidence is never silently narrowed: an unknown fact reference holds the whole draft.
  if ([...(draft.impacts ?? []), ...(draft.schedule ?? [])].some(item => (item.factIds ?? []).some(id => !factIds.has(id)))) return hold('UNKNOWN_FACT_REF');
  const known = ids => ids ?? [];
  for (const [name, list] of [['key_issues', draft.key_issues], ['risks', draft.risks], ['company_refs', draft.company_refs], ['impacts', draft.impacts], ['schedule', draft.schedule]]) {
    if ((list ?? []).length > LIMITS[name]) return hold('LIMIT_' + name.toUpperCase());
  }
  for (const item of draft.impacts ?? []) {
    if ((item.factIds ?? []).length > LIMITS.evidence || (item.conditions ?? []).length > LIMITS.conditions || (item.companyRoles ?? []).length > LIMITS.companies) return hold('LIMIT_IMPACT');
  }
  if ((draft.scenarios ?? []).some(item => (item.checks ?? []).length > LIMITS.checks)) return hold('LIMIT_SCENARIO');
  if ((draft.schedule ?? []).some(item => (item.factIds ?? []).length > LIMITS.evidence)) return hold('LIMIT_SCHEDULE');

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
  // Publication rule: without positive paths there are no scenarios; otherwise exactly one POSITIVE scenario, and one
  // NEGATIVE scenario exactly when negative paths exist. A scenario for a direction without paths is dropped (it has no
  // path to stand on); a missing or repeated scenario for a direction with paths holds the draft.
  let scenarios = [];
  if (positive.length) {
    const of = direction => (draft.scenarios ?? []).filter(item => item.direction === direction);
    if (of('POSITIVE').length !== 1 || negative.length && of('NEGATIVE').length !== 1) return hold('SCENARIO_SHAPE');
    scenarios = [...of('POSITIVE'), ...(negative.length ? of('NEGATIVE') : [])].map(item => ({ direction: item.direction, title: item.title,
      expected_result: item.expected_result, checks: item.checks, path_ids: item.direction === 'POSITIVE' ? positive : negative }));
  }

  // Primary sector: first benefit, then first damage, then the first impact of any direction; only an article without
  // impacts (a COMPANY issue) has none.
  const first = direction => impacts.find(item => item.direction === direction)?.sector_id;
  const primarySector = first('BENEFIT') ?? first('DAMAGE') ?? impacts[0]?.sector_id ?? null;

  // Schedule: exact instants with an offset. VERIFIED only when every cited fact comes from PRIMARY links only (the
  // database requires official-original evidence and checks the host itself); otherwise UNVERIFIED.
  const primaryOnly = id => { const fact = facts.find(item => item.id === id); return (fact?.sourceUrls ?? []).length > 0 && fact.sourceUrls.every(url => OFFICIAL_HOSTS.has(host(url))); };
  const schedule = [], omitted = [];
  for (const [index, item] of (draft.schedule ?? []).entries()) {
    const evidence = known(item.factIds);
    let zoneOk = true; try { new Intl.DateTimeFormat('en', { timeZone: item.timezone }); } catch { zoneOk = false; }
    if (!evidence.length || typeof item.timezone !== 'string' || !zoneOk) { omitted.push({ schedule: index, reason: !evidence.length ? 'NO_EVIDENCE' : 'BAD_TIMEZONE' }); continue; }
    const common = { status: evidence.every(primaryOnly) ? 'VERIFIED' : 'UNVERIFIED', title: item.title, timezone: item.timezone,
      evidence_as_of: new Date(snapshot.verifiedAt).toISOString(), evidence_fact_ids: evidence };
    if (OFFSET_ISO.test(item.eventAt ?? '')) { schedule.push({ kind: 'EXACT', ...common, event_at: item.eventAt }); continue; }
    const realDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value ?? '') && !Number.isNaN(Date.parse(value + 'T00:00:00Z'))
      && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;
    if (realDate(item.eventAt)) {
      // A date without a time: the whole day in that zone, end exclusive (start < end). The offset is the one in force
      // at local midnight (a DST change during the day must not move the boundary).
      const next = new Date(Date.parse(item.eventAt + 'T00:00:00Z') + 86_400_000).toISOString().slice(0, 10);
      const start = localDayStart(item.eventAt, item.timezone), end = localDayStart(next, item.timezone);
      if (!start || !end) { omitted.push({ schedule: index, reason: 'DAY_NOT_IN_ZONE' }); continue; }
      schedule.push({ kind: 'PERIOD', ...common, period_label: item.eventAt, period_start: start, period_end: end, precision: 'DAY' });
      continue;
    }
    omitted.push({ schedule: index, reason: 'UNSUPPORTED_TIME' });
  }

  const hosts = kept.map(source => host(source.url));
  if (!hosts.every(name => DOMESTIC_HOSTS.has(name))) return hold('SOURCE_MARKET_UNKNOWN');
  const payload = {
    format: 'AI_DRAFT_V1', ai_issue_id: issueId, ai_version: version, story_key: safeKey(snapshot.storyKey), angle_key: safeKey(snapshot.angleKey ?? draft.angleKey),
    catalog_ref: { registry: String(catalogRef?.registry ?? ''), sha256: String(catalogRef?.sha256 ?? '') },
    draft: {
      title: draft.title, summary: draft.summary, issue_analysis: draft.issue_analysis?.text ?? '',
      key_issues: (draft.key_issues ?? []).map(item => item.text), risks: (draft.risks ?? []).map(item => item.text),
      article_kind: draft.article_kind, primary_sector_id: primarySector,
      primary_company_ref: draft.article_kind === 'COMPANY' ? draft.primary_company_ref ?? null : null, company_refs: draft.company_refs ?? [],
      source_market: 'KR', selection_market_basis: 'KR',
      sources: kept.map(source => ({ name: String(source.name ?? host(source.url)).slice(0, 100), url: source.url, role: OFFICIAL_HOSTS.has(host(source.url)) ? 'PRIMARY' : 'REPORTED' })),
      impacts, scenarios, schedule
    },
    facts: outFacts
  };
  return { payload, effectKey: `ai:${issueId}:${version}`, omitted };
}
