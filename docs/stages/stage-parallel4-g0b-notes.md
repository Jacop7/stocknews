# PARALLEL4 G0B — K1 의미와 완료 이력

계획 r2 DUAL READY manifest c51acaca9a89bcfa74623607998b1c9643fa50f3a34347af733ff89ff1930d3d 뒤 MAIN 단독 구현이다. 이 파일의 SOURCE_PREPARED 상태는 구현 검수 통과나 실제 서비스 연결 결과가 아니다. 실제 시험·검수·commit/push 영수증은 outputs/development-stages/reviews에 별도 보존한다.

exact-delivery 메서드는 legacy semantic dedup과 분리한다. strict facade는 실제 저장 ID·원본 collectedAt을 보유하고,updatedAt→publishedAt 최신 선택·동일시각 충돌·PENDING_TIME·known cutoff를 COLLECT/초안 저장까지 검사한다. 입력 visibleSections는 권위가 아니며 evidence-version/claim/path에서 계산한 상세 영역과 같아야 한다. 피해-only는 시나리오를 숨기고 리스크·피해를 노출하고,연관 조건부는 수혜로 바꾸지 않는다. 실제 근거 검증/유사성/본문 AI는 구현하지 않았다.

Node 전용 합성 순위 ledger는 기존 domain 함수를 재사용한다. Node24 builtin node:crypto는 process.getBuiltinModule로 읽고 해당 최소 타입만 module 안에 선언한다. 외부 타입/패키지 의존성을 새로 추가하지 않으며 실제 Node API 사용은 실행 시험으로 확인한다. 두 앱 barrel에 노출하지 않는다. SHA는 동일성이지 신뢰 서명이 아니다.

global 홈 이력은 시장 전환을 가로지르며,정책·catalog·evaluation·scale tuple별 K1 segment는 자기 local revision을 가진다. **빈 상태=0,첫 완료 레코드=1,expectedRevision=직전 revision**으로 global/local 모두 통일한다(Claude G0BP-05). 정상 profile/catalog/evaluation/scale 변경은 새 segment 완료이며,기존 segment 복귀도 global 순서는 유지한다. 과거 record 변조는 전체 genesis replay에서 거부한다. 최대32,축출 없음,용량/JSON 상한 초과 fail-closed,staging 검증 뒤 상태를 교체한다. 실제DB transaction/durability는 아니다.

highComparisonVersion은 policy profile+scale에 결속한다. profile 변경은 context의 비교 식별자도 바꾸어 MEDIUM/STANDARD 비교를 초기화한다(Codex G0BP-05). HIGH 비교가 초기화돼도 전체 이전 상태의 Story 대표·firstPublishedAt·seen은 보존한다. 시장/M만 바뀌면 HIGH의 M=null·현재 비가격 재계산·연속5점2회 규칙을 유지한다. carry projection의 pool은 실제 표시 lane이며 A초과→B,B초과→C를 중복 없이 기록한다. 전체 후보 pools는 별도 원형 state로 검증한다.

fallback은 동일 context/profile/scale의15분 이내 완료본만 읽는다. 현재 fixture qualification에서 PUBLISHED·ACTIVE·같은 issueVersion·유효하고 current인 evidence를 재확인하며,불완전·미래/과거 cutoff 자격표나 숨김/철회·정정·만료는 제공하지 않는다. 실제 공급/권한/공개 게이트를 대신하지 않는다.

G0B guard가 G0A guard를 실행 분기에서 대체한다. d48 원문451개와 refs35개를 고정하며,선언한 수정8개/신규9개만 허용한다. 기존 검증기·workflow·lock/dependencies와 미변경 domain은 원문을 보존한다. full verify 기존28그룹+신규2그룹과 post-build artifact boundary 검사를 수행한다. 이 단계 source allowlist는 보안 sandbox가 아니다.

기존 CLOUD P3 CL11AI-01/CL11AP-01~03/CL10HR-01/CL10HP-01/CL10GR-01,실제 G0C 실행기/checkout·작성자역할·검수 위임·routing·첫admission·관리자C·실제DB·운영수집/AI/순위·모바일기기/스토어는 남는다. 일반 full-access fork를 실행하지 않으며 격리 canary의9회 상한도 늘리지 않는다.

## 구현 r2 보완

Codex G0BI-01: strict append는 base/effect를 변경하기 전에 실제 delivery 집합의300개 상한과 aggregate JSON byte/node 상한을 staging 검증한다. 초과 시 RATE_LIMITED로 거부하고 기존 선택·effect·판본 수를 유지한다. 같은 저장 ID의 동일 delivery는 상한에 있어도 새 delivery 수를 쓰지 않는다.

Codex G0BI-02: 원본 comparisonSetVersion을 기존 HomeContext의 비어있지 않은160자 이하·앞뒤공백 없는 문자열 조건으로 확인한 뒤에만 profile namespace를 적용한다. null/빈 문자열/객체/숫자/길이초과/앞뒤공백은 저장과 fallback에서 거부한다. 해시는 입력 유효성 검사를 대신하지 않는다.

Codex G0BI-03: fallback의 현재 qualification 검사와 별도로,저장된 같은 기사 version의 scheduledEndAt이 현재 cutoff 이하이면 반환하지 않는다. 정확한 종료 시각·이후와 정상 종료 전·현재 재계산 제외를 비교한다.

Claude G0BI-03: 비교 namespace에 profile뿐 아니라 nonpriceScaleVersion도 포함한다. 척도 변경이 MEDIUM/STANDARD 비교까지 초기화하면서 대표·firstPublishedAt·seen은 보존하는 회귀를 추가했다. Claude G0BI-01(의미 같은 더 작은 tie ID 도착 시 fail-closed 진행성),G0BI-02(stale draft 명시 폐기/slot 재사용 없음)는 합성 무축출 범위의P3로 남기며 G0C 실제 수집·영속 운영 전에 재설계한다. 이 보완 자체가 검수 지적 종결 판정은 아니며 원문 재검수를 따른다.
