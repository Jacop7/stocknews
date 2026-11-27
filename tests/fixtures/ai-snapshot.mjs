// Shared AI export snapshot fixture (from tests/publish-map.test.mjs), for delivery tests.
export const ID = '11111111-2222-4333-8444-555555555555', S1 = 'aaaaaaaa-0000-4000-8000-000000000001', S2 = 'aaaaaaaa-0000-4000-8000-000000000002';
const C1 = 'cccccccc-0000-4000-8000-000000000001';
const dart = n => 'https://dart.fss.or.kr/dsaf001/main.do?rcpNo=' + n;
export const base = (over = {}) => ({
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
