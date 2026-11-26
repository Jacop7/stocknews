// SYNTHETIC development content. These are invented examples for UI work only:
// they are not real news, not real analysis and must never be published.
// Sector names must match tests/fixtures/catalog/registry-v1.json.

export const SYNTHETIC_COMPANIES = [
  { name: 'SK하이닉스', description: 'HBM 등 고대역폭 메모리 양산', sectors: ['메모리 양산'] },
  { name: '삼성전자', description: '메모리·파운드리 종합 반도체', sectors: ['메모리 양산', '파운드리'] },
  { name: '한미반도체', description: 'HBM 적층용 TC 본더 장비', sectors: ['반도체 후공정/패키징'], group: '장비' },
  { name: '삼성전기', description: 'MLCC·FC-BGA 기판', sectors: ['MLCC', '반도체 기판'] },
  { name: '로보티즈', description: '로봇 관절용 액추에이터', sectors: ['휴머노이드 액추에이터·핸드'] },
  { name: '레인보우로보틱스', description: '협동로봇·휴머노이드 플랫폼', sectors: ['휴머노이드 양산'] },
  { name: '에스비비테크', description: '로봇 감속기', sectors: ['휴머노이드 액추에이터·핸드'] },
  { name: '엠씨넥스', description: '카메라 모듈', sectors: ['휴머노이드 비젼/카메라'] },
  { name: '현대로템', description: '전차·철도차량', sectors: ['방산'] },
  { name: '한화에어로스페이스', description: '자주포·항공엔진', sectors: ['방산', '우주 · 위성'] },
  { name: '한국항공우주', description: '군용기·위성 체계', sectors: ['방산', '우주 · 위성'] },
  { name: '두산에너빌리티', description: '원전 주기기·SMR 제작', sectors: ['원자력 SMR', '전력'] },
  { name: 'LG에너지솔루션', description: '전기차·ESS 배터리 셀', sectors: ['전기차 배터리', 'ESS 배터리'] },
  { name: 'HD현대중공업', description: '상선·군함 건조', sectors: ['조선'] },
  { name: '한화오션', description: 'LNG선·잠수함 건조', sectors: ['조선', '방산'] },
];

// lane: A = market-wide HIGH, B = other HIGH core issues, C = remaining (home ranking contract v1.0).
export const SYNTHETIC_ARTICLES = [
  {
    key: 'macro-rate', lane: 'A', hoursAgo: 1, sector: null,
    title: '[합성] 미국 기준금리 동결, 연내 인하 시점 불확실',
    summary: '개발용 합성 예시. 금리 동결로 원·달러 환율과 성장주 밸류에이션 부담이 함께 거론되는 상황을 가정한 글입니다.',
    keyIssues: ['기준금리 동결(합성 예시)', '연내 인하 횟수 전망 축소(합성 예시)'],
    analysis: '합성 예시 분석입니다. 금리 인하 기대가 늦춰지면 성장주 비중이 큰 업종의 할인율 부담이 커질 수 있고, 수출 기업은 환율 효과를 함께 따져야 합니다.',
    impacts: [
      { sector: '은행', direction: 'BENEFIT', description: '순이자마진 방어 기대(합성 예시)', conditions: ['대출 성장률 유지 시'], companies: [] },
      { sector: '반도체 팹리스', direction: 'DAMAGE', description: '성장주 할인율 상승 부담(합성 예시)', companies: [] },
    ],
    scenarios: [
      { direction: 'POSITIVE', title: '인하 기대 재부각', expected_result: '성장주 반등(합성)', checks: ['물가 지표', '고용 지표'] },
      { direction: 'NEGATIVE', title: '동결 장기화', expected_result: '고밸류 업종 부담(합성)', checks: ['장기금리', '환율'] },
    ],
    schedule: [{ kind: 'PERIOD', title: '다음 통화정책 회의(합성)', timezone: 'America/New_York', period_label: '다음 달 중순', date_note: '정확한 일정 미확인' }],
    sources: ['합성 예시 출처 A'],
  },
  {
    key: 'hbm', lane: 'A', hoursAgo: 2, sector: '메모리 양산',
    title: '[합성] 차세대 AI 가속기 출하 확대, HBM 공급 주목',
    summary: '개발용 합성 예시. AI 가속기 출하 확대가 고대역폭 메모리 수요로 이어질지 확인하는 상황을 가정했습니다.',
    keyIssues: ['AI 가속기 출하 확대(합성 예시)', 'HBM 탑재량 증가(합성 예시)'],
    analysis: '합성 예시 분석입니다. 가속기 1개당 메모리 탑재량이 늘면 메모리 양산 업체의 공급 계약과 후공정 장비 발주가 함께 확인 대상이 됩니다.',
    impacts: [
      { sector: '메모리 양산', direction: 'BENEFIT', description: 'HBM 수요 확대 가능성(합성 예시)', conditions: ['고객사 품질 승인'], companies: ['SK하이닉스', '삼성전자'] },
      { sector: '반도체 후공정/패키징', direction: 'BENEFIT', description: '적층 장비 발주 기대(합성 예시)', companies: ['한미반도체'] },
    ],
    scenarios: [
      { direction: 'POSITIVE', title: '공급 계약 확대', expected_result: '메모리 실적 상향(합성)', checks: ['공급 계약 공시', '출하량'] },
    ],
    sources: ['합성 예시 출처 B', '합성 예시 출처 C'],
  },
  {
    key: 'k2', lane: 'B', hoursAgo: 4, sector: '방산',
    title: '[합성] 유럽 국가와 전차 2차 이행계약 협상 진전',
    summary: '개발용 합성 예시. 전차 추가 계약 협상이 현지 생산 조건과 함께 논의되는 상황을 가정했습니다.',
    keyIssues: ['2차 이행계약 협상(합성 예시)', '현지 생산 비중 논의(합성 예시)'],
    analysis: '합성 예시 분석입니다. 계약 규모와 현지 생산 비중에 따라 국내 생산분과 부품 공급망의 수혜 정도가 달라집니다.',
    impacts: [
      { sector: '방산', direction: 'BENEFIT', description: '수출 계약 확대 기대(합성 예시)', conditions: ['최종 계약 체결'], companies: ['현대로템'] },
    ],
    scenarios: [{ direction: 'POSITIVE', title: '계약 체결', expected_result: '수주잔고 증가(합성)', checks: ['계약 공시', '현지 생산 비중'] }],
    sources: ['합성 예시 출처 D'],
  },
  {
    key: 'humanoid', lane: 'B', hoursAgo: 6, sector: '휴머노이드 양산',
    title: '[합성] 해외 휴머노이드 2세대 양산 로드맵 공개',
    summary: '개발용 합성 예시. 휴머노이드 양산 계획이 구동부품 수요로 이어질지 확인하는 상황을 가정했습니다.',
    keyIssues: ['2세대 양산 목표(합성 예시)', '대당 액추에이터 탑재 계획(합성 예시)'],
    analysis: '합성 예시 분석입니다. 양산 목표가 현실화되면 액추에이터·감속기 수요가 늘 수 있으나, 부품 공급사 선정 여부가 핵심 변수입니다.',
    impacts: [
      { sector: '휴머노이드 액추에이터·핸드', direction: 'BENEFIT', description: '구동부품 수요 확대 가능성(합성 예시)', conditions: ['공급사 선정'], companies: ['로보티즈', '에스비비테크'] },
      { sector: '휴머노이드 비젼/카메라', direction: 'DAMAGE', description: '자체 개발 비중 확대 시 외부 조달 축소(합성 예시)', companies: ['엠씨넥스'] },
    ],
    scenarios: [
      { direction: 'POSITIVE', title: '국내 부품 채택', expected_result: '부품 수주 증가(합성)', checks: ['공급 계약', '양산 일정'] },
      { direction: 'NEGATIVE', title: '양산 지연', expected_result: '기대 수요 이연(합성)', checks: ['생산 실적'] },
    ],
    sources: ['합성 예시 출처 E'],
  },
  {
    key: 'smr', lane: 'C', hoursAgo: 20, sector: '원자력 SMR',
    title: '[합성] 해외 원전 본계약 체결, 주기기 발주 기대',
    summary: '개발용 합성 예시. 원전 본계약 이후 주기기 제작 발주 일정이 확인 대상이 되는 상황을 가정했습니다.',
    keyIssues: ['원전 2기 본계약(합성 예시)'],
    analysis: '합성 예시 분석입니다. 본계약 이후 주기기 발주 시점과 금액이 확정되어야 실적 반영 시점을 판단할 수 있습니다.',
    impacts: [{ sector: '원자력 SMR', direction: 'BENEFIT', description: '주기기 발주 기대(합성 예시)', companies: ['두산에너빌리티'] }],
    scenarios: [{ direction: 'POSITIVE', title: '주기기 발주', expected_result: '수주 인식(합성)', checks: ['발주 공시'] }],
    sources: ['합성 예시 출처 F'],
  },
  {
    key: 'battery', lane: 'C', hoursAgo: 30, sector: '전기차 배터리',
    title: '[합성] 북미 전기차 보조금 축소 검토, 배터리 수요 변수',
    summary: '개발용 합성 예시. 보조금 축소 검토가 배터리 수요 전망에 부담이 되는 상황을 가정했습니다.',
    keyIssues: ['보조금 축소 검토(합성 예시)'],
    analysis: '합성 예시 분석입니다. 보조금이 줄면 전기차 판매 둔화로 배터리 셀 수요 전망이 낮아질 수 있으며, ESS 전환 속도가 완충 요인입니다.',
    impacts: [
      { sector: '전기차 배터리', direction: 'DAMAGE', description: '판매 둔화 시 셀 수요 감소(합성 예시)', companies: ['LG에너지솔루션'] },
      { sector: 'ESS 배터리', direction: 'RELATED', description: '라인 전환 시 완충 가능(합성 예시)', conditions: ['ESS 수주 확대 시'], conditional: 'POSITIVE', companies: [] },
    ],
    risks: ['보조금 최종안 발표 전까지 불확실성 지속(합성)', '재고 조정 장기화 가능성(합성)'],
    sources: ['합성 예시 출처 G'],
  },
  {
    key: 'lng', lane: 'C', hoursAgo: 60, sector: '조선',
    title: '[합성] LNG 운반선 발주 문의 증가',
    summary: '개발용 합성 예시. LNG 운반선 발주 문의가 늘며 선가 흐름을 확인하는 상황을 가정했습니다.',
    keyIssues: ['LNG선 발주 문의 증가(합성 예시)'],
    analysis: '합성 예시 분석입니다. 실제 계약 전환율과 선가가 확인되어야 수주 효과를 판단할 수 있습니다.',
    impacts: [{ sector: '조선', direction: 'BENEFIT', description: '수주 증가 기대(합성 예시)', companies: ['HD현대중공업', '한화오션'] }],
    scenarios: [{ direction: 'POSITIVE', title: '본계약 전환', expected_result: '수주잔고 증가(합성)', checks: ['수주 공시', '선가 지수'] }],
    sources: ['합성 예시 출처 H'],
  },
  {
    key: 'satellite', lane: 'C', hoursAgo: 24 * 9, sector: '우주 · 위성',
    title: '[합성] 정찰위성 추가 발사 계획 발표',
    summary: '개발용 합성 예시. 위성 발사 계획이 국내 위성 체계 업체 일감으로 이어질지 확인하는 상황을 가정했습니다.',
    keyIssues: ['추가 발사 계획(합성 예시)'],
    analysis: '합성 예시 분석입니다. 체계 사업자와 부품 공급사 선정 범위에 따라 수혜 범위가 달라집니다.',
    impacts: [{ sector: '우주 · 위성', direction: 'BENEFIT', description: '위성 체계 사업 기대(합성 예시)', companies: ['한국항공우주', '한화에어로스페이스'] }],
    scenarios: [{ direction: 'POSITIVE', title: '사업자 선정', expected_result: '수주 인식(합성)', checks: ['사업자 선정 발표'] }],
    sources: ['합성 예시 출처 I'],
  },
  {
    key: 'mlcc', lane: 'C', hoursAgo: 24 * 35, sector: 'MLCC',
    title: '[합성] AI 서버용 고용량 MLCC 단가 인상 논의',
    summary: '개발용 합성 예시. AI 서버 수요가 고용량 MLCC 단가에 영향을 주는 상황을 가정했습니다.',
    keyIssues: ['고용량 MLCC 단가 논의(합성 예시)'],
    analysis: '합성 예시 분석입니다. 단가 인상이 실제 적용되는지와 범용 제품 수요 회복 여부를 함께 봐야 합니다.',
    impacts: [{ sector: 'MLCC', direction: 'BENEFIT', description: '고부가 제품 비중 확대(합성 예시)', companies: ['삼성전기'] }],
    scenarios: [{ direction: 'POSITIVE', title: '단가 인상 적용', expected_result: '수익성 개선(합성)', checks: ['분기 실적'] }],
    sources: ['합성 예시 출처 J'],
  },
];
