// Publish stage 1A mapper: AI export snapshot -> AI_DRAFT_V1 (synthetic wording only).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toIntakePayload } from '../workers/ai-processing/runtime/publish-map.mjs';

const ID = '11111111-2222-4333-8444-555555555555', S1 = 'aaaaaaaa-0000-4000-8000-000000000001', S2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const dart = n => 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + n;
const base = (over = {}) => ({
  format: 'AI_DRAFT_EXPORT_V1', issueId: ID, version: 2, storyKey: 'story:abc', angleKey: 'f'.repeat(64), verifiedAt: Date.UTC(2026, 10, 27, 1),
  catalogRef: { registry: 'registry-v1:0123456789abcdef', sha256: 'e'.repeat(64) },
  facts: [
    { id: 'f-1', statement: '공급 계약 체결', verificationClass: 'ORDINARY_FACT', independentlyVerified: true, koreaPathVerified: true, recordedAt: Date.UTC(2026, 10, 27), sources: [{ url: dart(1), role: 'PRIMARY' }], sourceUrls: [dart(1)] },
    { id: 'f-2', statement: '보도된 수요 전망', verificationClass: 'ORDINARY_FACT', independentlyVerified: true, koreaPathVerified: true, recordedAt: Date.UTC(2026, 10, 27), sources: [{ url: 'https://kind.krx.co.kr/disclosure/1', role: 'REPORTED' }], sourceUrls: ['https://kind.krx.co.kr/disclosure/1'] }
  ],
  draft: {
    title: '제목', summary: '요약', issue_analysis: { text: '분석', factIds: ['f-1'] }, key_issues: [{ text: '핵심', factIds: ['f-1'] }], risks: [{ text: '위험', factIds: ['f-2'] }],
    article_kind: 'SECTOR', primary_company_ref: null, company_refs: [C1],
    impacts: [
      { sectorId: S2, direction: 'RELATED', conditionalDirection: 'NONE', category: 'DEMAND', description: '조건부', conditions: ['조건'], factIds: ['f-2'], companyRoles: [] },
      { sectorId: S1, direction: 'BENEFIT', conditionalDirection: 'NONE', category: 'SUPPLY', description: '수혜', conditions: [], factIds: ['f-1'], companyRoles: [{ companyId: C1, role: '공급사' }] }
    ],
    scenarios: [{ direction: 'POSITIVE', title: '긍정', expected_result: '결과', checks: ['확인한다.'], factIds: ['f-1'] }, { direction: 'NEGATIVE', title: '부정', expected_result: '결과', checks: ['확인한다.'], factIds: ['f-2'] }],
    schedule: [{ title: '납품 개시', eventAt: '2026-12-01T09:00:00+09:00', timezone: 'Asia/Seoul', factIds: ['f-1'] }, { title: '보도 일정', eventAt: '2026-12-02T09:00:00+09:00', timezone: 'Asia/Seoul', factIds: ['f-2'] }],
    source_refs: [{ docId: 'd2', url: 'https://kind.krx.co.kr/disclosure/1', name: '보도', role: 'REPORTED', publishedAt: '2026-11-26' }, { docId: 'd1', url: dart(1), name: 'DART', role: 'PRIMARY', publishedAt: '2026-11-25' }],
    angleKey: 'f'.repeat(64), ...over.draft
  },
  ...over.top
});

test('sector draft maps to the intake contract: keys, sources (PRIMARY first), paths, scenarios, schedule status', () => {
  const { payload, effectKey } = toIntakePayload(base());
  assert.equal(effectKey, `ai:${ID}:2`);
  assert.deepEqual(Object.keys(payload).sort(), ['ai_issue_id', 'ai_version', 'angle_key', 'catalog_ref', 'draft', 'facts', 'format', 'story_key']);
  assert.deepEqual(payload.draft.sources.map(s => s.role), ['PRIMARY', 'REPORTED']);
  assert.equal(payload.draft.primary_sector_id, S1, 'first benefit sector even when a related impact comes first');
  assert.deepEqual(payload.draft.impacts.map(i => i.path_id), ['DEMAND-1', 'SUPPLY-2']);
  assert.deepEqual(payload.draft.impacts[1].companies, [{ company_ref: C1, role: '공급사' }]);
  // Only a positive path exists, so only the positive scenario survives, bound to it.
  assert.deepEqual(payload.draft.scenarios.map(s => [s.direction, s.path_ids]), [['POSITIVE', ['SUPPLY-2']]]);
  assert.deepEqual(payload.draft.schedule.map(s => [s.kind, s.status]), [['EXACT', 'VERIFIED'], ['EXACT', 'UNVERIFIED']]);
  assert.equal(payload.draft.source_market, 'KR');
  assert.deepEqual(payload.facts[0], { id: 'f-1', statement: '공급 계약 체결', verification_class: 'ORDINARY_FACT', independently_verified: true, korea_path_verified: true,
    recorded_at: '2026-11-27T00:00:00.000Z', source_urls: [dart(1)] });
  assert.ok(!JSON.stringify(payload).includes('quote'));
});

test('company draft without impacts keeps its scope, no primary sector and no scenarios', () => {
  const { payload } = toIntakePayload(base({ draft: { article_kind: 'COMPANY', primary_company_ref: C1, impacts: [], scenarios: base().draft.scenarios } }));
  assert.equal(payload.draft.article_kind, 'COMPANY'); assert.equal(payload.draft.primary_company_ref, C1);
  assert.equal(payload.draft.primary_sector_id, null); assert.deepEqual(payload.draft.scenarios, []); assert.deepEqual(payload.draft.impacts, []);
});

test('holds: too many sources cut a cited link, impacts without facts, bad identity or catalog ref', () => {
  const many = Array.from({ length: 13 }, (_, n) => ({ docId: 'p' + n, url: dart(100 + n), name: 'D', role: 'PRIMARY', publishedAt: '2026-11-2' + (n % 9) }));
  const cut = base({ draft: { source_refs: [...many, ...base().draft.source_refs] } });
  assert.deepEqual(toIntakePayload(cut), { hold: 'SOURCE_OVERFLOW' });
  assert.deepEqual(toIntakePayload(base({ draft: { impacts: [{ ...base().draft.impacts[1], factIds: ['f-1', 'f-x'] }] } })), { hold: 'UNKNOWN_FACT_REF' });
  assert.deepEqual(toIntakePayload(base({ draft: { impacts: [{ ...base().draft.impacts[1], factIds: [] }] } })), { hold: 'IMPACT_WITHOUT_FACTS' });
  assert.deepEqual(toIntakePayload(base({ draft: { impacts: [{ ...base().draft.impacts[1], conditions: Array(11).fill('c') }] } })), { hold: 'LIMIT_IMPACT' });
  assert.deepEqual(toIntakePayload(base({ draft: { key_issues: Array(13).fill({ text: 'k', factIds: [] }) } })), { hold: 'LIMIT_KEY_ISSUES' });
  assert.deepEqual(toIntakePayload(base({ top: { issueId: 'nope' } })), { hold: 'EXPORT_IDENTITY' });
  assert.deepEqual(toIntakePayload(base({ top: { catalogRef: { registry: 'r' } } })), { hold: 'EXPORT_CATALOG_REF' });
  assert.equal(toIntakePayload(base({ top: { storyKey: '공시 이벤트 키' } })).payload.story_key.startsWith('h:'), true);
});

test('scenarios follow the one-per-direction rule; a missing or repeated one holds the draft', () => {
  const positive = base().draft.scenarios[0];
  assert.deepEqual(toIntakePayload(base({ draft: { scenarios: [positive, { ...positive, title: '또 긍정' }] } })), { hold: 'SCENARIO_SHAPE' });
  assert.deepEqual(toIntakePayload(base({ draft: { scenarios: [] } })), { hold: 'SCENARIO_SHAPE' });
  const withDamage = base({ draft: { impacts: [...base().draft.impacts, { sectorId: S2, direction: 'DAMAGE', conditionalDirection: 'NONE', category: 'COST', description: '피해', conditions: [], factIds: ['f-2'], companyRoles: [] }] } });
  assert.deepEqual(toIntakePayload(withDamage).payload.draft.scenarios.map(x => x.direction), ['POSITIVE', 'NEGATIVE']);
});

test('a COMPANY article with only conditional impacts still gets a primary sector (its first impact)', () => {
  const { payload } = toIntakePayload(base({ draft: { article_kind: 'COMPANY', primary_company_ref: C1, impacts: [base().draft.impacts[0]], scenarios: [] } }));
  assert.equal(payload.draft.primary_sector_id, S2); assert.deepEqual(payload.draft.scenarios, []);
});

test('a date-only schedule becomes a whole-day PERIOD in its zone; other forms are omitted with a reason', () => {
  const { payload, omitted } = toIntakePayload(base({ draft: { schedule: [
    { title: '주주총회', eventAt: '2026-12-15', timezone: 'Asia/Seoul', factIds: ['f-1'] },
    { title: '모호', eventAt: '12월 중', timezone: 'Asia/Seoul', factIds: ['f-1'] },
    { title: '잘못된 시간대', eventAt: '2026-12-15', timezone: 'Mars/Base', factIds: ['f-1'] }] } }));
  assert.deepEqual(payload.draft.schedule, [{ kind: 'PERIOD', status: 'VERIFIED', title: '주주총회', timezone: 'Asia/Seoul', evidence_as_of: '2026-11-27T01:00:00.000Z',
    evidence_fact_ids: ['f-1'], period_label: '2026-12-15', period_start: '2026-12-15T00:00:00+09:00', period_end: '2026-12-16T00:00:00+09:00', precision: 'DAY' }]);
  assert.deepEqual(omitted, [{ schedule: 1, reason: 'UNSUPPORTED_TIME' }, { schedule: 2, reason: 'BAD_TIMEZONE' }]);
});

test('day periods use the offset at local midnight on DST days; impossible dates are omitted', () => {
  const { payload, omitted } = toIntakePayload(base({ draft: { schedule: [
    { title: 'DST', eventAt: '2026-03-08', timezone: 'America/New_York', factIds: ['f-1'] },
    { title: '없는 날', eventAt: '2026-02-30', timezone: 'Asia/Seoul', factIds: ['f-1'] }] } }));
  assert.deepEqual(payload.draft.schedule.map(x => [x.period_start, x.period_end]), [['2026-03-08T00:00:00-05:00', '2026-03-09T00:00:00-04:00']]);
  assert.deepEqual(omitted, [{ schedule: 1, reason: 'UNSUPPORTED_TIME' }]);
});

test('day starts round-trip in the zone (skipped midnight, skipped day); unknown source markets hold', () => {
  const { payload, omitted } = toIntakePayload(base({ draft: { schedule: [
    { title: '산티아고', eventAt: '2027-09-05', timezone: 'America/Santiago', factIds: ['f-1'] },
    { title: '아피아', eventAt: '2011-12-30', timezone: 'Pacific/Apia', factIds: ['f-1'] }] } }));
  assert.equal(payload.draft.schedule.length, 1);
  assert.equal(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santiago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(payload.draft.schedule[0].period_start)), '2027-09-05');
  assert.deepEqual(omitted, [{ schedule: 1, reason: 'DAY_NOT_IN_ZONE' }]);
  const foreign = base({ draft: { source_refs: [...base().draft.source_refs, { docId: 'x', url: 'https://www.sedaily.com/a', name: 'x', role: 'REPORTED', publishedAt: '2026-11-20' }] } });
  assert.deepEqual(toIntakePayload(foreign), { hold: 'SOURCE_MARKET_UNKNOWN' });
});
