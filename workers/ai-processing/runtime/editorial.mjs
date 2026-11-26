import assert from 'node:assert/strict';
import { digest, exact, text, list, numericTokens } from './contracts.mjs';
import { screenArticleOriginality } from '../src/originality-screen.ts';
import { DISCLAIMER, factProvenance, assertAttributed, assertHedged, assertCompanyRoles, checkCalculations, renderCalculations, stripCalculations } from './writer.mjs';

const str = { type: 'string' }, bool = { type: 'boolean' }, nullable = { type: ['string', 'null'] };
const enumeration = values => ({ type: 'string', enum: values });
const array = items => ({ type: 'array', items });
const object = properties => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const ref = object({ docId: str, quote: str });
const fact = object({ id: str, subjectId: nullable, predicate: str, value: str, unit: str, period: str,
  statement: str, verificationClass: enumeration(['ORDINARY_FACT', 'SYSTEMIC_MACRO', 'SENSITIVE_UNCONFIRMED']), refs: array(ref) });
const impact = object({ sectorId: str, companyIds: array(str), direction: enumeration(['BENEFIT', 'DAMAGE', 'RELATED']),
  conditionalDirection: enumeration(['NONE', 'POSITIVE', 'NEGATIVE']),
  category: enumeration(['DEMAND', 'SUPPLY', 'COST', 'REGULATION', 'FUNDING', 'OPERATIONS']),
  path: str, conditions: array(str), factIds: array(str) });
export const schemas = {
  triage: object({ classification: enumeration(['RELEVANT_EVENT', 'PURE_PROMOTION', 'PRICE_RECAP_ONLY', 'UNRELATED', 'UNCLEAR']),
    newCatalyst: bool, koreanImpact: bool, articleKind: enumeration(['SECTOR', 'MACRO']), sectorIds: array(str),
    event: object({ family: enumeration(['EARNINGS', 'CONTRACT', 'INVESTMENT', 'PRODUCT', 'POLICY', 'REGULATION', 'GEOPOLITICS', 'SUPPLY', 'OTHER']),
      entityIds: array(str), date: nullable, period: nullable, officialId: nullable, refs: array(ref) }),
    facts: array(fact), impacts: array(impact), reason: str }),
  draft: object({ title: str, summary: str, key_issues: array(object({ text: str, factIds: array(str) })),
    issue_analysis: object({ text: str, factIds: array(str) }),
    impacts: array(object({ sectorId: str, companyIds: array(str), direction: enumeration(['BENEFIT', 'DAMAGE', 'RELATED']),
      conditionalDirection: enumeration(['NONE', 'POSITIVE', 'NEGATIVE']), category: str, description: str,
      conditions: array(str), factIds: array(str), companyRoles: array(object({ companyId: str, role: str })) })),
    scenarios: array(object({ direction: enumeration(['POSITIVE', 'NEGATIVE']), title: str, expected_result: str, checks: array(str), factIds: array(str) })),
    risks: array(object({ text: str, factIds: array(str) })),
    schedule: array(object({ title: str, eventAt: str, timezone: str, factIds: array(str) })),
    calculations: array(object({ id: str, expression: str, result: str, unit: str, factIds: array(str) })) }),
  verify: object({ approved: bool, supportedFactIds: array(str), unsupportedFactIds: array(str),
    numericConsistency: bool, koreaPathSupported: bool, eventIdentitySupported: bool,
    sameEventAsExisting: bool, proseSupported: bool, companyRolesSupported: bool, attributionSupported: bool,
    conflicts: array(str), reason: str }),
};

export function validateShape(value, schema, depth = 0) {
  assert(depth < 24, 'MODEL_OUTPUT_DEPTH');
  const types = [schema.type].flat();
  assert(types.some(type => type === 'null' ? value === null : type === 'array' ? Array.isArray(value) :
    type === 'object' ? value && typeof value === 'object' && !Array.isArray(value) : typeof value === type), 'MODEL_OUTPUT_TYPE');
  if (value === null) return;
  if (schema.enum) assert(schema.enum.includes(value), 'MODEL_OUTPUT_ENUM');
  if (schema.type === 'object') {
    exact(value, Object.keys(schema.properties));
    for (const [key, part] of Object.entries(schema.properties)) validateShape(value[key], part, depth + 1);
  } else if (schema.type === 'array') {
    list(value, 100).forEach(item => validateShape(item, schema.items, depth + 1));
  } else if (typeof value === 'string') text(value, 12000, true);
}

function references(refs, documents) {
  assert(list(refs, 24).length > 0, 'EVIDENCE_REQUIRED');
  return refs.map(ref => {
    const doc = documents.find(item => item.id === ref.docId);
    text(ref.quote, 500);
    assert(doc && doc.text.includes(ref.quote), 'FABRICATED_EVIDENCE');
    return { docId: doc.id, quote: ref.quote };
  });
}
const ids = (value, allowed, nonempty = false) => {
  const entries = list(value);
  assert((!nonempty || entries.length) && new Set(entries).size === entries.length && entries.every(id => allowed.includes(id)), 'UNKNOWN_REFERENCE');
  return entries;
};
const quantitativeUnits = new Set(['%', '%p', 'usd', 'krw', 'eur', 'jpy', 'shares', '명', '개', '대', '건', '배',
  '년', '월', '일', '시', '분', '초', '억원', '조원', 'mw', 'gw', 'kw', 'gwh', 'mwh', '톤', 'kg', 'km', 'm', 'mm', 'nm']);
const escapeRegex = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function sourceInstantSupported(item, refs) {
  return refs.some(ref => (ref.quote.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?(?:Z|[+-]\d{2}:\d{2})/g) ?? [])
    .some(value => Date.parse(value) === Date.parse(item.eventAt)));
}
function scheduleZoneSupported(item, refs) {
  const zone = new Intl.DateTimeFormat('en', { timeZone: item.timezone }).resolvedOptions().timeZone;
  const names = { 'Asia/Seoul': '(?:KST|한국\\s*(?:표준\\s*)?(?:시간|시각)|서울\\s*시간)',
    UTC: '(?:UTC|GMT|협정세계시)', 'America/New_York': '(?:ET|미(?:국)?\\s*동부\\s*(?:시간|시각)' +
      (item.eventAt.endsWith('-05:00') ? '|EST' : item.eventAt.endsWith('-04:00') ? '|EDT' : '') + ')' };
  const [year, month, day] = item.eventAt.slice(0, 10).split('-').map(Number);
  const date = '(?:' + escapeRegex(item.eventAt.slice(0, 10)) + `|${year}년\\s*${month}월\\s*${day}일)`;
  const [hour, minute] = item.eventAt.slice(11, 16).split(':').map(Number);
  const clock = '(?:' + escapeRegex(item.eventAt.slice(11, 16)) + `|${hour}시\\s*${minute}분)`, gap = '[\\s(),\\[\\]]*';
  return refs.some(ref => {
    if (sourceInstantSupported(item, [ref])) return true;
    if (!names[zone] || /\b(?:UTC|GMT)\s*[+-]\s*\d/i.test(ref.quote)) return false;
    if ((ref.quote.match(/\d{1,2}:\d{2}|\d{1,2}시/g) ?? []).length !== 1) return false;
    const named = '(?<![A-Za-z0-9])' + names[zone] + '(?![A-Za-z0-9])';
    // Only adjacent date/clock/zone phrases prove the instant; an unrelated KST elsewhere is insufficient.
    return new RegExp('(?:' + named + gap + date + gap + clock + '|' + date + gap + clock + gap + named + '|' + date + gap + named + gap + clock + ')', 'i').test(ref.quote);
  });
}

export function validateTriage(raw, documents, catalog) {
  validateShape(raw, schemas.triage);
  const value = structuredClone(raw), sectors = catalog.sectors.map(item => item.id), entities = catalog.entities.map(item => item.id);
  ids(value.sectorIds, sectors); ids(value.event.entityIds, entities);
  if (['PURE_PROMOTION', 'PRICE_RECAP_ONLY', 'UNRELATED'].includes(value.classification) && !value.newCatalyst && !value.koreanImpact) {
    return { state: 'EXCLUDED', reason: value.classification };
  }
  if (value.classification !== 'RELEVANT_EVENT' || !value.newCatalyst || !value.koreanImpact) return { state: 'HOLD', reason: 'TRIAGE_UNCLEAR' };
  if (value.articleKind === 'SECTOR') assert(value.sectorIds.length > 0 && value.event.entityIds.length > 0, 'KOREAN_ENTITY_REQUIRED');
  references(value.event.refs, documents);
  if (value.event.date !== null) assert(/^\d{4}-\d{2}-\d{2}$/.test(value.event.date) && Number.isFinite(Date.parse(value.event.date)), 'INVALID_EVENT_DATE');
  if (value.event.period !== null) text(value.event.period, 40);
  if (value.event.officialId !== null) text(value.event.officialId, 100);
  const anchor = value.event.family === 'EARNINGS' ? value.event.period : value.event.officialId ?? value.event.date;
  if (!anchor) return { state: 'HOLD', reason: 'EVENT_IDENTITY_UNRESOLVED' };
  const localIds = new Map();
  assert(value.facts.length > 0 && value.facts.length <= 30, 'FACTS_REQUIRED');
  value.facts = value.facts.map(candidate => {
    assert(!localIds.has(candidate.id), 'DUPLICATE_FACT_ID');
    if (candidate.subjectId !== null) assert(entities.includes(candidate.subjectId), 'UNKNOWN_ENTITY');
    for (const key of ['id', 'predicate', 'value', 'unit', 'period']) text(candidate[key], 200, ['unit', 'period'].includes(key));
    text(candidate.statement, 1000);
    const refs = references(candidate.refs, documents);
    assert(numericTokens(candidate.statement).every(token => numericTokens(refs.map(ref => ref.quote).join(' ')).includes(token)), 'FACT_NUMBER_MISMATCH');
    if (numericTokens(candidate.value).length) {
      const escape = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const unit = candidate.unit.toLowerCase();
      const aliases = { usd: ['usd', '달러', '$', 'us$'], krw: ['krw', '원'], eur: ['eur', '유로', '€'], shares: ['shares', '주'],
        '%p': ['%p', '%포인트', '퍼센트포인트', 'percentage points'] };
      const units = aliases[unit] ?? [unit];
      const normalize = value => value.normalize('NFKC').toLowerCase().replace(/−/g, '-').replace(/(?<=\d),(?=\d{3}(?:\D|$))/g, '');
      const numeric = /^[+-]?\d+(?:[,.]\d+)*$/.test(candidate.value);
      if (!numeric) {
        // Product identifiers such as HBM4 are categorical, not malformed quantities.
        const identifier = new RegExp('(?<![A-Za-z0-9_.-])' + escape(candidate.value) + '(?![A-Za-z0-9_]|[.-][A-Za-z0-9_])');
        assert(!unit && /^[A-Za-z][A-Za-z0-9_.-]*$/.test(candidate.value) && !/^(?:USD|KRW|EUR|JPY|HKD|AUD|CAD|NZD|SGD|TWD)\d/i.test(candidate.value) && refs.some(ref => identifier.test(ref.quote)), 'FACT_VALUE_MISMATCH');
      } else {
        assert(unit, 'FACT_UNIT_REQUIRED');
        assert(quantitativeUnits.has(unit), 'FACT_UNIT_UNSUPPORTED');
        const number = (/^[+-]/.test(candidate.value) ? '' : '\\+?') + escape(normalize(candidate.value));
        const unitPattern = item => escape(normalize(item)).replace(/ /g, '\\s+');
        const suffix = units.map(unitPattern).join('|');
        const notPoints = unit === '%' ? '(?!\\s*(?:p\\b|포인트|point|pts))' : unit === 'shares' ? '(?!\\s*(?:안|내|후|뒤|전|동안|이내|간|연속|째|만에))' : '';
        const after = new RegExp('(?:^|[^0-9.+±-])' + number + '\\s*(?:' + suffix + ')' + notPoints + '(?![A-Za-z0-9]|\\.[0-9])');
        const prefix = units.filter(value => !/[가-힣]/.test(value)).map(unitPattern).join('|');
        const before = ['usd', 'eur', 'krw'].includes(unit) ? new RegExp('(?:^|[^\\p{L}\\p{N}.$+±-])(?:' + prefix + ')\\s*' + number + '(?![0-9]|\\.[0-9])', 'u') : null;
        assert(refs.some(ref => {
          if (unit === 'usd' && /(?:HK|AU|NZ|CA|SG|NT|C|A)\s*\$|\b(?:HKD|AUD|CAD|NZD|SGD|TWD)\b/i.test(ref.quote)) return false;
          return after.test(normalize(ref.quote)) || before?.test(normalize(ref.quote));
        }), 'FACT_UNIT_MISMATCH');
        if (unit === 'shares') assert(refs.some(ref => /주식|지분|매입|매수|취득|발행|\bshares?\b/i.test(ref.quote)), 'FACT_SHARE_CONTEXT_REQUIRED');
      }
    }
    const factId = 'f-' + digest([candidate.subjectId, candidate.predicate, candidate.value, candidate.unit, candidate.period]).slice(0, 40);
    localIds.set(candidate.id, factId);
    const verificationClass = candidate.verificationClass === 'SENSITIVE_UNCONFIRMED' ? candidate.verificationClass :
      value.articleKind === 'MACRO' || ['POLICY', 'REGULATION', 'GEOPOLITICS'].includes(value.event.family) ? 'SYSTEMIC_MACRO' : candidate.verificationClass;
    return { ...candidate, verificationClass, id: factId, refs };
  });
  assert(new Set(value.facts.map(item => item.id)).size === value.facts.length, 'DUPLICATE_FACT');
  for (const item of value.impacts) {
    assert(value.sectorIds.includes(item.sectorId), 'UNRELATED_SECTOR');
    ids(item.companyIds, entities);
    item.factIds = item.factIds.map(id => { assert(localIds.has(id), 'UNKNOWN_FACT'); return localIds.get(id); });
    assert(item.factIds.length && (item.direction === 'RELATED' || item.conditionalDirection === 'NONE'), 'INVALID_IMPACT');
    text(item.path, 1000);
    if (item.direction === 'RELATED') assert(item.conditions.length > 0 && ['POSITIVE', 'NEGATIVE'].includes(item.conditionalDirection), 'RELATED_CONDITION_REQUIRED');
  }
  const partition = value.articleKind === 'MACRO' ? 'MACRO_ALL' : canonicalPartition(value.event.entityIds, value.event.family);
  return { state: 'RELEVANT', value, partition, storyKey: digest([partition, value.event.family, [...value.event.entityIds].sort(), anchor]), anchor };
}
const canonicalPartition = (entities, family) => JSON.stringify([[...entities].sort(), family]);

export function mergeFacts(triages) {
  const merged = new Map();
  for (const triage of triages) for (const fact of triage.facts) {
    const prior = merged.get(fact.id);
    if (!prior) merged.set(fact.id, structuredClone(fact));
    else {
      if (fact.verificationClass === 'SENSITIVE_UNCONFIRMED' || prior.verificationClass === 'SENSITIVE_UNCONFIRMED') prior.verificationClass = 'SENSITIVE_UNCONFIRMED';
      else if (fact.verificationClass === 'SYSTEMIC_MACRO' || prior.verificationClass === 'SYSTEMIC_MACRO') prior.verificationClass = 'SYSTEMIC_MACRO';
      for (const ref of fact.refs) if (!prior.refs.some(item => item.docId === ref.docId && item.quote === ref.quote)) prior.refs.push(ref);
    }
  }
  return [...merged.values()];
}

export function evidenceSufficient(fact, documents) {
  const docs = [...new Set(fact.refs.map(ref => ref.docId))].map(id => documents.find(doc => doc.id === id)).filter(Boolean);
  const sources = docs.flatMap(doc => doc.sources.map(source => ({ ...source, docId: doc.id })));
  if (sources.some(source => source.provenanceVerified && source.kind === 'OFFICIAL')) return true;
  if (fact.verificationClass === 'SENSITIVE_UNCONFIRMED') return false;
  if (fact.verificationClass === 'ORDINARY_FACT') return sources.some(source => source.provenanceVerified && ['NEWS', 'REPORT'].includes(source.kind));
  const known = sources.filter(source => source.provenanceVerified && source.articleOriginVerified === true && ['originGroupId', 'newsroomId', 'ownerGroupId'].every(key => source[key]));
  for (let a = 0; a < known.length; a++) for (let b = a + 1; b < known.length; b++) for (let c = b + 1; c < known.length; c++) {
    if (['docId', 'originGroupId', 'newsroomId', 'ownerGroupId'].every(key => new Set([known[a][key], known[b][key], known[c][key]]).size === 3)) return true;
  }
  return false;
}

export function validateDraft(raw, { facts, documents, triage, catalog, now }) {
  validateShape(raw, schemas.draft);
  const draft = structuredClone(raw), factIds = facts.map(fact => fact.id), entityIds = catalog.entities.map(item => item.id);
  assert(draft.key_issues.length <= 8 && draft.impacts.length <= 24 && draft.scenarios.length <= 2 && draft.risks.length <= 12 && draft.schedule.length <= 8, 'DRAFT_SECTION_LIMIT');
  const calculations = checkCalculations(draft.calculations, facts);
  const check = item => {
    ids(item.factIds, factIds, true);
    assert(item.factIds.every(id => evidenceSufficient(facts.find(fact => fact.id === id), documents)), 'INSUFFICIENT_EVIDENCE');
  };
  text(draft.title, 160); text(draft.summary, 420);
  assert(draft.key_issues.length > 0, 'KEY_ISSUE_REQUIRED');
  draft.key_issues.forEach(check); check(draft.issue_analysis);
  const impacts = draft.impacts.map(item => {
    check(item); ids(item.companyIds, entityIds); assertCompanyRoles([item], catalog);
    const original = triage.impacts.find(prior => prior.sectorId === item.sectorId && prior.direction === item.direction &&
      prior.conditionalDirection === item.conditionalDirection && prior.category === item.category);
    assert(original && item.companyIds.every(id => original.companyIds.includes(id)), 'IMPACT_BROADENING');
    assert(item.direction !== 'RELATED' || item.conditions.length && ['POSITIVE', 'NEGATIVE'].includes(item.conditionalDirection), 'RELATED_CONDITION_REQUIRED');
    return { ...item, pathId: 'p-' + digest([item.sectorId, item.direction, item.conditionalDirection, item.category]).slice(0, 32) };
  });
  assert(new Set(impacts.map(item => item.pathId)).size === impacts.length, 'DUPLICATE_IMPACT');
  assert(impacts.length === triage.impacts.length, 'IMPACT_OMISSION');
  assert(impacts.length > 0, 'KOREAN_IMPACT_REQUIRED');
  const positive = impacts.some(item => item.direction === 'BENEFIT' || item.direction === 'RELATED' && item.conditionalDirection === 'POSITIVE');
  const negative = impacts.some(item => item.direction === 'DAMAGE' || item.direction === 'RELATED' && item.conditionalDirection === 'NEGATIVE');
  draft.scenarios.forEach(check); draft.risks.forEach(check);
  assert(!draft.scenarios.length || positive, 'NEGATIVE_ONLY_SCENARIO');
  if (positive) assert(draft.scenarios.some(item => item.direction === 'POSITIVE'), 'POSITIVE_SCENARIO_REQUIRED');
  if (positive && negative) assert(draft.scenarios.some(item => item.direction === 'NEGATIVE'), 'MIXED_SCENARIO_REQUIRED');
  if (!negative) assert(!draft.scenarios.some(item => item.direction === 'NEGATIVE'), 'UNSUPPORTED_NEGATIVE_SCENARIO');
  if (!positive && negative) assert(draft.risks.length > 0, 'DAMAGE_RISKS_REQUIRED');
  draft.schedule = draft.schedule.filter(item => {
    check(item); new Intl.DateTimeFormat('en', { timeZone: item.timezone });
    assert(/T.*(?:Z|[+-]\d\d:\d\d)$/.test(item.eventAt) && Number.isFinite(Date.parse(item.eventAt)), 'INVALID_SCHEDULE');
    const evidence = item.factIds.flatMap(id => facts.find(fact => fact.id === id).refs.map(ref => ref.quote)).join(' ');
    assert(scheduleZoneSupported(item, item.factIds.flatMap(id => facts.find(fact => fact.id === id).refs)), 'SCHEDULE_SOURCE_ZONE_UNVERIFIED');
    const [year, month, date] = item.eventAt.slice(0, 10).split('-').map(Number);
    const time = item.eventAt.slice(11, 16), [hour, minute] = time.split(':').map(Number);
    const localParts = Object.fromEntries(new Intl.DateTimeFormat('en', { timeZone: item.timezone, year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(item.eventAt)).map(part => [part.type, part.value]));
    assert(`${localParts.year}-${localParts.month}-${localParts.day}T${localParts.hour}:${localParts.minute}` === item.eventAt.slice(0, 16), 'SCHEDULE_ZONE_MISMATCH');
    const dateSupported = evidence.includes(item.eventAt.slice(0, 10)) || evidence.includes(`${year}년 ${month}월 ${date}일`);
    const timeSupported = evidence.includes(time) || evidence.includes(`${hour}시 ${minute}분`);
    assert(sourceInstantSupported(item, item.factIds.flatMap(id => facts.find(fact => fact.id === id).refs)) ||
      dateSupported && timeSupported, 'UNSUPPORTED_SCHEDULE_TIME');
    return Date.parse(item.eventAt) > now;
  });
  const allText = [draft.title, draft.summary, ...draft.key_issues.map(item => item.text), draft.issue_analysis.text,
    ...impacts.flatMap(item => [item.description, ...item.conditions, ...item.companyRoles.map(role => role.role)]),
    ...draft.scenarios.flatMap(item => [item.title, item.expected_result, ...item.checks]),
    ...draft.risks.map(item => item.text), ...draft.schedule.map(item => item.title)];
  const allowedNumbers = numericTokens(facts.map(fact => fact.statement).join(' '));
  // Calculated values only enter through {{calc:ID}}, which the system renders with its formula.
  assert(allText.every(part => numericTokens(stripCalculations(part)).every(number => allowedNumbers.includes(number))), 'DRAFT_NUMBER_MISMATCH');
  assertHedged(allText);
  const provenance = facts.map(fact => ({ id: fact.id, ...factProvenance(fact, documents) }));
  assertAttributed([...draft.key_issues, draft.issue_analysis], { facts: provenance });
  const originality = screenArticleOriginality({ policy: { version: 'BACKLOG_WORDING_V1', headlineCharacters: 18, passageCharacters: 36 },
    sourceParts: documents.flatMap(doc => [{ id: doc.id + '-title', text: doc.title }, { id: doc.id + '-body', text: doc.text }]),
    draft: { headline: stripCalculations(draft.title), parts: allText.slice(1).map((value, index) => ({ id: 'part-' + index, text: stripCalculations(value) })) } });
  assert(originality.state === 'NO_LITERAL_MATCH', 'SHARED_SOURCE_WORDING');
  const visible = ['KEY_ISSUES', 'ISSUE_ANALYSIS'];
  if (draft.scenarios.length) visible.push('SCENARIOS');
  for (const [kind, section] of [['BENEFIT', 'BENEFIT_SECTORS'], ['DAMAGE', 'DAMAGE_SECTORS'], ['RELATED', 'RELATED_SECTORS']]) if (impacts.some(item => item.direction === kind)) visible.push(section);
  if (draft.risks.length) visible.push('RISKS'); if (draft.schedule.length) visible.push('SCHEDULE'); visible.push('SOURCES', 'DISCLAIMER');
  const hasBenefit = impacts.some(item => item.direction === 'BENEFIT'), hasDamage = impacts.some(item => item.direction === 'DAMAGE');
  const render = value => renderCalculations(value, calculations);
  const rendered = { ...draft, title: render(draft.title), summary: render(draft.summary),
    key_issues: draft.key_issues.map(item => ({ ...item, text: render(item.text) })),
    issue_analysis: { ...draft.issue_analysis, text: render(draft.issue_analysis.text) },
    scenarios: draft.scenarios.map(item => ({ ...item, title: render(item.title), expected_result: render(item.expected_result), checks: item.checks.map(render) })),
    risks: draft.risks.map(item => ({ ...item, text: render(item.text) })), schedule: draft.schedule.map(item => ({ ...item, title: render(item.title) })) };
  return { ...rendered, calculations, disclaimer: DISCLAIMER, fact_provenance: provenance,
    impacts: impacts.map(item => ({ ...item, description: render(item.description), conditions: item.conditions.map(render) })), visible_sections: visible,
    impact_profile: !hasBenefit && !hasDamage ? 'RELATED_CONDITIONAL' : positive ? negative ? 'POSITIVE_NEGATIVE' : 'POSITIVE_ONLY' : 'DAMAGE_ONLY',
    analysis_perspective: 'KR_EQUITY', article_kind: triage.articleKind, publication_state: 'DRAFT', publicationAuthorized: false,
    angleKey: digest(impacts.map(item => [item.sectorId, item.direction, item.conditionalDirection, item.category]).sort()),
    // PRIMARY: company/regulator/exchange originals. REPORTED: newsroom or research coverage. Both keep their own link.
    source_refs: documents.flatMap(doc => doc.sources.map(source => ({ docId: doc.id, url: source.url, name: source.name ?? source.id,
      role: source.kind === 'OFFICIAL' ? 'PRIMARY' : 'REPORTED', publishedAt: source.publishedAt }))) };
}

export function validateVerification(raw, facts, hasExistingStory) {
  validateShape(raw, schemas.verify);
  const known = facts.map(item => item.id);
  ids(raw.supportedFactIds, known); ids(raw.unsupportedFactIds, known);
  assert(raw.approved && raw.numericConsistency && raw.koreaPathSupported && raw.eventIdentitySupported && raw.proseSupported &&
    raw.companyRolesSupported && raw.attributionSupported &&
    (!hasExistingStory || raw.sameEventAsExisting) && !raw.conflicts.length && !raw.unsupportedFactIds.length &&
    known.every(id => raw.supportedFactIds.includes(id)), 'INDEPENDENT_VERIFICATION_FAILED');
  return raw;
}
