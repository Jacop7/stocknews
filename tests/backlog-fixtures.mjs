import { digest } from '../workers/ai-processing/runtime/contracts.mjs';
export const stamp = Date.parse('2026-11-21T03:00:00Z');
export const originalTitle = '가상 오리온전자 설비투자 계획 공지';
export const quote = '오리온전자는 2026년 3분기 장비투자 예산을 20% 늘렸다고 밝혔다.';
export const originalText = quote + ' 이번 발표는 회사가 공개한 내부 계획을 바탕으로 작성된 가상 시험 자료다. 장비의 발주 시점과 공급업체 선정은 집행 과정에서 달라질 수 있으며 실제 수주 여부는 별도의 확인이 필요하다. 본 시험의 기업과 연결은 실제 투자 정보가 아니다.';
export const url = 'https://news.publisher.co.kr/article/one';
export function config() {
  return { version: 'BACKLOG_DRAFT_V1', mode: 'BACKLOG_ONLY', readOriginals: true, callModels: true, maxDailyCalls: 100,
    models: { triage: 'fixture-triage', draft: 'fixture-writer', verify: 'fixture-verifier' },
    catalog: { version: 'fixture-v1', sectors: [{ id: 'semiconductor', name: '반도체' }], entities: [{ id: 'orion', name: '오리온전자' }] },
    sources: [{ host: 'news.publisher.co.kr', id: 'fixture-publisher', name: '가상경제신문', version: 'v1', status: 'ENABLED',
      kind: 'NEWS', basis: 'EXPLICIT_INTERNAL_REVIEW', publicationAuthorized: false, evidence: ['Synthetic in-process fixture only'],
      expiresAt: null, revokedAt: null, retentionDays: 7, provenanceVerified: true, originGroupId: 'origin-1', newsroomId: 'newsroom-1', ownerGroupId: 'owner-1' }],
    excludedDomains: [], excludedUrls: [] };
}
export function triage(docId, extra = false, damage = false) {
  const facts = [{ id: 'local-f1', subjectId: 'orion', predicate: 'CAPEX_CHANGE', value: '20', unit: '%', period: '2026-Q3',
    statement: '장비투자 예산이 20% 확대됐다.', verificationClass: 'ORDINARY_FACT', refs: [{ docId, quote }] }];
  if (extra) facts.push({ id: 'local-f2', subjectId: 'orion', predicate: 'PROJECT_SCOPE', value: 'additional-site', unit: '', period: '2026-Q3',
    statement: '추가 사업장을 검토한다.', verificationClass: 'ORDINARY_FACT', refs: [{ docId, quote: '추가 사업장 검토가 공지됐다.' }] });
  return { classification: 'RELEVANT_EVENT', newCatalyst: true, koreanImpact: true, articleKind: 'SECTOR', primaryCompanyId: null, sectorIds: ['semiconductor'],
    event: { family: 'INVESTMENT', entityIds: ['orion'], date: '2026-11-21', period: '2026-Q3', officialId: null, refs: [{ docId, quote }] },
    facts, impacts: [{ sectorId: 'semiconductor', companyIds: ['orion'], direction: damage ? 'DAMAGE' : 'BENEFIT', conditionalDirection: 'NONE',
      category: damage ? 'COST' : 'DEMAND', path: '설비투자 집행과 국내 장비 발주 경로', conditions: ['계획 집행 여부 확인'], factIds: facts.map(fact => fact.id) }],
    reason: '가상 시험의 신규 설비 계획' };
}
export function draft(input, damage = false) {
  const factIds = input.facts.map(fact => fact.id);
  return { title: '국내 장비 공급망의 변화 경로 점검', summary: '투자 집행이 국내 공급 여건에 어떤 영향을 줄지 살펴봅니다.',
    key_issues: [{ text: '가상경제신문에 따르면 회사 계획에서 확인되는 변화를 점검합니다.', factIds }],
    issue_analysis: { text: '가상경제신문 보도를 기준으로 계획이 실행되는 과정에서 한국 장비 업체에 전달되는 경로를 확인할 필요가 있습니다.', factIds },
    impacts: (input.impacts ?? input.triage.impacts).map(impact => ({ sectorId: impact.sectorId, companyIds: impact.companyIds, direction: impact.direction,
      conditionalDirection: impact.conditionalDirection, category: impact.category, description: '국내 산업에 전달되는 영향을 검토합니다.',
      conditions: ['실제 발주 진행 여부'], factIds, companyRoles: impact.companyIds.map(companyId => ({ companyId, role: '장비 발주 주체' })) })),
    scenarios: damage ? [] : [{ direction: 'POSITIVE', title: '계획이 집행되는 경우', expected_result: '장비 발주 여건이 개선될 가능성이 있습니다.', checks: ['집행 진행 여부'], factIds }],
    risks: [{ text: '실제 계약과 예산의 차이를 점검해야 합니다.', factIds }], schedule: [], calculations: [] };
}
export function verification(input) {
  return { approved: true, supportedFactIds: input.facts.map(fact => fact.id), unsupportedFactIds: [], numericConsistency: true,
    koreaPathSupported: true, eventIdentitySupported: true, sameEventAsExisting: true, proseSupported: true,
    companyRolesSupported: true, attributionSupported: true, conflicts: [], reason: 'Synthetic validator fixture' };
}
export const original = (body = originalText, sourceUrl = url) => ({ state: 'ORIGINAL', url: sourceUrl, title: originalTitle,
  text: body, publishedAt: new Date(stamp).toISOString(), bodyHash: digest(body.normalize('NFKC').replace(/\s+/g, ' ')) });
