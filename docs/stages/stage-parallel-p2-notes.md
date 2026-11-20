# MAIN PARALLEL P2 통합 범위

계획 DUAL manifest 1db88485984ccca127487711116b5ef648295db9a5f77f586266ec1aad2d1ef5 뒤에 MAIN과 기존 두 native 작성자가 별도 파일을 구현한다. operational ownfile/read restrictions는 OS sandbox/credential isolation이 아니다. private/auth/다른제품/실제서비스 접근과 helper Git/shared mutation을 금지하며 모든 읽기 사후검출을 주장하지 않는다. MAIN만 전체검사·통합 DUAL·커밋/푸시한다. 기록·원문·시험 로그는 제품 밖 outputs/development-stages/main-parallel-p2 및 reviews/main-parallel-p2-*에 둔다.

Collector partition schema는 별도 메모리 journal이며 기존 source K1 checkpoint/R1/acquisition을 덮지 않는다. 실제 R1.lookup APPLIED만 SOURCE_STORED로 인정하고 H_BODY resume 등록으로 checkpoint를 전진하지 않는다. 현재권한/fence/CAS/불변manifest/ACKunknown을 검증한다. 영속 재시작·분산lease·실제수집/권한 승인 증거가 아니다. bootstrap partition등록/permission수정은 아직 lease가 없는 초기상태와 철회를 위해 별도 검증하며 worker mutation에는 현재lease/fence를 요구한다.

Home B1은 게시·ARTICLE 숫자draft/문자열버전·decision/evidence·현재자격을 fixture 자료로 결속한다. 실제 게시 영수증이나 전체 DB 진실이 아니다. 선언 ISSUE/CLAIM 집합 누락은 전체거절, WITHDRAWN은 원상태보존/후보제외, T/M/P 모두off. selectKnownRevisions는 실제 packages/domain/src/home-snapshot.ts에 있고 source는 selectPipelineSources를 재사용한다(MPP2-01 정확근거). contracts 파일은 domain/crypto를 import하지 않고 barrel export도 하지 않는다. 조립과 SHA는 worker에만 두고 새 marker를 source/artifacts에서 검사한다(MPP2-02). macro는 해당 claim 집합으로 decision evidence를 한정해 무관 그룹으로 독립3이 채워지지 않게 한다(MPP2P-02). 기존 home tsconfig는 completed-adapter만 포함하므로 새 test:rankable-batch가 tsconfig.base 동일명시flags로 새 adapter tsc 후 Node 단위시험을 실행한다. 5mutable/13new·3새 그룹은 그대로다.

MAIN A2는 전체 요청digest·story/issue판본·current source/rights/evidence fixture와 모델제안을 비교한다. semantic 사실/경로/비교표는 context assertion이며 모델 boolean으로 진실을 인증하지 않는다. 제안이 새 사실·정정참조를 빠뜨리면 HOLD다(MPP2P-01). current context 정정이 있으면 비CORRECTION은 HOLD, 여러issue 정정도 downstream 재분석을 위해 HOLD. NEW_ANGLE 축소는 같은 방향이며 추가문단 충분인 정확 target+angleCode에만 허용한다(MPP2-03). 실제 model/사실추출/기사작성/게시/원자commit/정정공개차단은 후속이다. 독립제목/중요차이/새사실or근거경로/기존문단불충분/전방향비교 5요건만 새angle plan. 부정 단독·가격·표현 변경으로 카드분할하지 않는다.

P1 actualModelCalls:0은 제품 뉴스 AI 호출을 뜻하는 역사필드이며 개발 작성자 호출 0의 증거가 아니다. P2는 productAiProcessingCalls=0, developmentAuthorInvocations=2(두 helper 구현 오더), developmentModelRequestCount=UNMEASURED로 분리한다. 내부 모델 재요청/검수 수는 측정하지 않았고 MAIN작성은 이 2에 포함하지 않는다(MPP1-03). 모든 provider실제요청/키조회0, remote worker 연결false, M2false. 이전 acquisition의 거절시각 watermark/MACQP-01, 같은세대본문충돌/MACQP-03, begin ticket ACK/capacity/MPP1-04, 대표교체/G0BI-01, stale draft/G0BI-02 및 CLOUD/실행기 P3는 이번 구현으로 종결하지 않는다.

## 구현 r2 보완과 이월

r1 Astra의 MPP2I-01/02/03은 원문과 r1 전체판본 ZIP·로그를 보존한 뒤 작성자에게 재작업했다. MPP2I-01: home 현재 근거 집합에 grade/macro 외 visibility keyIssue/analysis/impacts/risks/present schedule 및 Article impacts의 evidenceIds를 합친다. scenario는 impact 경로를 통해 검사한다. 현재 RETRACTED/BLOCKED/만료 및 누락/미래only/미검증이면 candidate와 이전완료 fallback 모두 차단한다. 일정은 현재표시에서 제외된 항목도 present reference면 보수적으로 포함한다. 무관 decision evidence는 identity/source 검사를 유지하되 실제 참조 없는 claim의 단순 철회로 기사를 막지는 않는다. 기존15+신규5=20시험을 인계받았다.

MPP2I-02: context의 추가 path 존재와 NEW_ANGLE에 필요한 fresh evidence 자격을 별도 계산한다. old evidence만 쓰더라도 새 path가 있으면 NO_CHANGE는 HOLD이고 적법한 같은방향/추가문단충분 target이면 UPDATE다. 새 근거가 없는 새 path는 독립 NEW_ANGLE 자격이 아니다. MPP2I-03: evidence에 쓰이지 않은 input source까지 모든 collectedAt≤decision.knownAt를 요구한다. MAIN A2 기존17+신규2=19시험. 이 숫자는 단위 작성자 인계이며 전체검사·구현 DUAL을 대신하지 않는다.

수정 전 원본은 별도 replay 디렉토리에서 새 회귀시험으로 확인했다(제품 소스 변경 없이 R1 ZIP의 SHA 검증 바이트 사용). A2는 17pass/2expected-fail, Home의 모든시험은16pass/4expected-fail, 문제4개만 고른 replay는0pass/4expected-fail이다. Home 최초 harness의 예상15/5가 실제16/4와 달라 harness 검증이 중단됐고 원래 로그를 보존한 뒤 targeted replay로 확인했다. 제품 시험의 성공으로 이를 바꾸어 기록하지 않는다. 전체검사는 수정 source pin으로 다시 수행한다.

MPP2-04 이월: requiresBody/H_BODY가 한 번 생긴 partition은 지금 계약에 완료·포기·축출 경로가 없으므로 해당 partition 전체 checkpoint가 후속 본문 재개 완료 증거 계약 전까지 영구 정지할 수 있다. 보수적인 안전 경계이며 실제 운영 가능한 본문 큐를 구현한 것이 아니다. MPP2-05 이월: home adapter의 명시 flags 타입 검사는 현재 tsconfig.base와 같지만 자동 상속은 아니다. 다음 정식 typecheck 그룹 계획에서 drift 차단을 맡기며 현재 base와 역사 guard는 바이트 보존한다.
