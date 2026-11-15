# 7B2B · 대표 Issue·A/B/C·순위 안정화 계획

2026.11.15 · 구현 전 계획 · 미연결 합성 정렬 엔진

## 1. 권위·기준·범위

사용자 최신 요구 → 홈순위-운영개정안-v1.0(SHA256 8ab76a1bc0758b13ad6e97f237e799a77b645d59c53944b722e6d0895caf5a93) → 변경되지 않은 공통-운영계약-v1.0 순이다. 옛 09:10/10분·가격 중심 산식·A/B 일괄 시간 종료는 사용하지 않는다. 기준 main `37929a37fbc77cef91a87e267bfbb9321ad84d8a` 338파일, 7B2A DUAL r2·46시험·전체19묶음·원격백업 증거를 복원했다.

이번에 합성 대표 선택, 대표 기준 신호 모집단, A≤2/B≤3/C≤20, 같은 비교context의 5점·연속2회 안정화, 시장/M 전환 시 HIGH 비가격 순서 보존, C 다양성·발견 슬롯을 하나의 순수 함수로 연결한다. 실제 DB 원자 저장/입력 manifest·공개자격 읽기/15분 fallback은7B2C, 앱 공개 DTO·가격 미노출·원본링크는7B3, 실제 공급·검색 교정·NXT/조정은7B4다. 실제 뉴스 수집·독립 작성은8·9단계다. 앱/API/DB/worker/cron에 이번 함수를 연결하지 않는다.112 RIGHTS_HOLD/live7·8 CLOSED/iPhone USER_DEFERRED/전체7B·M2 미완료를 유지하며 다른 제품은 사용하지 않는다.

## 2. 파일·검사 경계

새 모듈 `packages/domain/src/home-ranking.ts`, 시험 `tests/home-ranking.test.ts`, 새 foundation validator와 계획/승인/7B2A 완료 증거 사본/구현 메모를 추가한다. 기존338파일에서 package.json의 시험 명령, scripts/verify.mjs의 새 시험 추가, scripts/verify-foundation.mjs의 새 분기, docs/development-status.json의 별도 homeRankingPreparation 메타 네 경로만 바꾼다. branch `feat/07b2b-home-ranking`.

기존 issue-priority.ts와 home-snapshot.ts, domain index, contracts, SQL, 앱/admin/worker/native/SDK/lockfile/출처 등록부/과거 validator는 동결한다. 새 모듈은 정확히 두 순수 모듈의 상대 `.ts` import만 허용한다. IO·네트워크·환경변수·현재시계·랜덤·LLM 호출은 없다. 기존 7B1의 초안 산식과 Story 제거 전 모집단 계약을 수정하지 않고 별도 composition으로 운영 모양의 합성 초안을 만든다. 이 초안도 게시 권한/원문 검증/운영 순위가 아니다.

새 validator는 동결 7B2A 전문에서 현재 Git/ref/HEAD/main/단일자식 이력, 정확한 네 경로 델타, report/자기상속에 필요한 명시 치환만 허용한다. 모든 과거 assertion과 provider 시계 고정 전문 일치를 유지한다. 과거 자기상속은 해당 동결 파일을 비교하고 새 상속만 현재 전문과 직전 단계의 치환 결과를 비교한다.338 baseline 전문 동결, 허용 네 경로의 정확한 추가 델타와 새 파일 명세를 확인한다. 옛 HEAD/ref 조작·빈 검사·실패 무시는 금지한다.

## 3. 입력과 경계

`draftHomeRanking(unknown)`의 입력은 mode=LOCAL_SYNTHETIC, sampleKind=SYNTHETIC, 고정 rankingPolicyVersion, context(7B2A HomeContextInput에서 signals만 뺀 형식), priority(7B1 PriorityInput), sectors(각 issueId와 primarySectorId), previous(직전 합성 상태 또는 null)다. context와 priority의 cutoff/catalog/evaluation 버전은 같아야 한다. cutoff는5분 경계이며 7B2A가 한국 달력·목표 D·시장을 결정한다. 신호 enabled 조합은 대표 기준 계산 결과에서 파생해 context에 넣는다. 호출자가 enabled bool로 자료를 활성화하지 않는다.

입력 전체는 JSON 데이터 형태로 복사 검증한다. 표준/null prototype 객체의 정확한 own enumerable data 속성만 읽고, 배열은 표준 prototype·own 연속 data index·추가 string/symbol 속성 없음이어야 한다. getter·사용자 iterator·비유한 수·undefined·함수·symbol·순환·상속 입력을 거부하고 반환과 입력을 분리한다. 최대 깊이20, 전체 노드200000, 배열10000, 문자열262144자, Issue300/claim5000, 이전 대표300/seen600을 상한으로 한다. 잘못된 구조는 INVALID_INPUT, REAL/다른 mode는 LIVE_NOT_ENABLED다. 입력/이전 상태를 변경하지 않는다. Proxy 등 임의 실행 객체를 보안 sandbox로 인증하는 기능은 아니다.

sectors는 입력 Issue 전체에 정확히 한 행씩 있다. SECTOR scope는 primarySectorId 문자열, MACRO_ALL은 null이며 임의 카탈로그 소속으로 영향 방향을 만들지 않는다. ID는 upstream에서 정규화된 합성 ID라는 선언이다. 실제 resolver·최신 카탈로그·영향 경로 인증은 여기서 수행하지 않는다. 이전 상태는 실제 DB의 신뢰된 완료본이라는 증거가 아니라 순차 재생용 합성 입력이다.

## 4. 자격과 대표 선행 선택

먼저 7B1 함수로 전체 priority 구조·ID 중복·signal enum/숫자/시간 구조를 검증한다. 그 반환의 Story 제거 후 정렬은 운영 대표로 사용하지 않는다. 이후 각 Issue를 원래 ID/Story와 전체 claim으로 신호 없이 단독 평가해 현재 자격과 I 구간을 얻는다. 이 방식은 ID를 꾸미거나 기존 모듈의 비공개 validator를 복제하지 않는다.300 후보 상한 안에서 수행한다. 정정 중/숨김/철회/해소/기한 초과/미래/근거 부족은 즉시 제외된다.

대표 자격 class는 HIGH+검증 SYSTEMIC_MACRO+MACRO_ALL이면 A, 나머지 HIGH는 B, 그 외 C다. 이는 실제 A/B 좌석 수와 다른 경쟁 자격이다. Story별 가장 높은 자격 class를 선택한다. 이전 대표가 현재도 그 최상위 class에 있으면 유지한다. 없거나 자격을 잃었으면 최상위 class 후보 중 material_change_at 내림차순 → published_at 내림차순 → Issue ID 코드포인트 오름차순으로 한 개 선택한다. 기존 C가 유효하더라도 새 A/B 자격의 실제 변화가 생기면 즉시 새 대표를 선택한다. 같은 class의 조회수/가격 변화만으로 대표를 교체하지 않는다. 다른 방향은 이슈체크/상세의 몫이며 홈에서는 Story당1개다.

## 5. 대표 기준 점수와 MACRO_ALL T

선택한 대표 전체(표시25개로 자르기 전)만 priority.issues와 각 signal values에 남겨 7B1을 다시 호출한다. 비대표의 신호 결측·중복 UV는 운영 초안의 T/M/P 완전성·표본 수에 영향을 주지 않는다. P의5개/합계50도 대표 기준이다. 점수·I 구간·F·가용 비중·M 절댓값은 기존 검수 산식을 그대로 사용하고 진단 결과를 보존한다.

S7B1I-02는 다음처럼 확정한다. T set이 제공된 경우 MACRO_ALL 대표의 개별 T 행은 계산에 쓰지 않고, set의 동일 version/knownAt/validUntil을 가진 중립0.5 행을 내부 파생한다. 전역16묶음/mode/시각 완전성은 기존 함수가 검사한다. 전역 T가 없거나 불완전하면 중립 행만으로 T를 켜지 않는다. SECTOR 대표의 T 결측은 여전히 전체 T off다. 제공된 잘못된 숫자/시간 구조는 최초 전체 검증에서 거부하며, 구조상 정상인 매크로의 개별 값/만료·버전은 쓰지 않는다. 파생 사실을 DERIVED_MACRO_NEUTRAL 진단으로 남기며 실측값으로 기록하지 않는다. 실제 검색 수집·기사 직접 영향 가중평균은 여전히 공급 단계다.

HIGH 점수에는 M이 들어가지 않는다. 대표 선택도 가격/조회 점수 전에 완료한다. M만 바뀌어 다른 Story의 대표·HIGH 파급력이 바뀌지 않는다. 모든 원자료/점수/UV/신호 이유는 내부 결과이고 공개 응답이 아니다.

## 6. 이전 상태와 두 회차 안정화

이전 상태는 sampleKind/policy, cutoff와 contextInput(파생 enabled 포함), 대표 카드 메타, A/B/C 경쟁 pool 순서, 최근 seen 기록을 담는다. 알려진 정확한 key/enum/유한 점수0~100·I/T/P0~1/null·시각·ID 유일성·pool 집합·C 구간 순서·seen 만료를 검증한다. 이전 cutoff는 현재보다 엄격히 이전이어야 한다. 같은 cutoff 재호출로 두 회차를 채우지 못하며 실제 작업 멱등성은7B2C가 담당한다. 같은 현재입력+같은 이전상태를 다시 평가하면 같은 결과다. 이전 입력의 진위/서명을 인증하지 않으며 실제 저장 봉인은7B2C다.

각 pool은 표시 자르기 전 경쟁 순서다. 이전 pool의 생존 항목을 같은 I 구간 안에서 유지한다. 새 Story의 대표를 포함한 모든 신규 항목, 같은 Story의 대표 교체, HIGH/상위 구간 진입, 자격 pool 이동, 이전보다 증가한 material_change_at은 현재 점수 위치에 즉시 삽입한다. 신규 일반 항목을 구간 끝에서 대기시키지 않는다. 지연 대상은 같은 대표·구간·pool·실질변화시각을 유지한 기존 항목의 보조 점수 진동뿐이다. 최초 또는 비교context가 다르면 현재 점수→material_change_at→ID 기본순을 쓰되 HIGH는 아래 별도 비교 연속성을 우선한다. 기본 tie에서 같은 비교context의 이전 순서를 우선한다. 비공개/만료 제거도 즉시다.

그 후 인접 두 항목의 I 구간이 같을 때만 위로 교체할 수 있다. 현재 아래 항목의 점수 우위≥5이고, 정확히5분 전의 같은 비교context/같은pool/같은I구간의 두 항목에서도 우위≥5이면 교체한다. 이를 필요한 만큼 반복하되 매 교체가 현재 점수의 역전을 줄이므로 종료한다. 반복 중 새로 인접한 쌍도 고정된 직전 프레임의 두 점수를 조회하며 현재 회차의 부분 결과로 카운터를 늘리지 않는다. 4점·동점·첫5점은 유지하며 두 번째 연속5점에서 교체한다.10분 공백과 비교 척도가 달라진 경우는 두 회차 비교를 다시 시작한다. 해당 두 항목 중 새 중대 사실 등 즉시 대상은 이 지연을 적용하지 않는다.

## 7. HIGH carry와 영역 할당

HIGH 비교 signature는 ranking policy/catalog/evaluation, T/P enabled, 현재 HIGH 대표 ID·Story·자격class·I 구간·material_change_at이라는 구조만 코드포인트 순으로 직렬화한다. 연속값 I/T/P, 시장·targetD·달력·comparisonSetVersion·M enabled/값과 cutoff는 뺀다. F는 현재 점수에서 실제 경과로 계산하며 material_change_at만 signature에 고정한다. 출처 재송고/재검증만으로 이를 갱신하지 않는다.

전체 비교context가 달라도 HIGH signature가 같으면 HIGH의 직전 경쟁 순서와 두 회차 점수 비교를 승계한다. HIGH는 M을 사용하지 않으므로 시장 전환 때도 같은 비가격 척도에서 직전 점수와 현재 점수를 비교할 수 있다. 현재 T/P/I의 작은 변화는 carry를 끊지 않고 같은5점·연속2회 규칙으로 처리한다. 구시장 가격점수나 오래된 프레임을 현재 점수로 복사하지 않는다. signature가 다르고 전체context도 다르면 새context 기본순, 전체context가 같으면 현재 점수·즉시 삽입·생존자 안정화를 사용한다. 새 HIGH/대표·자격·실질변화는 즉시 반영된다. T/P enabled나 정책/catalog/evaluation이 바뀌면 비교 척도가 달라져 HIGH도 새 비교를 시작한다. 따라서 M만 바뀌거나 전환시각에 UV/T가 소폭 움직여도 HIGH가 즉시 뒤집히지 않으며, 전환 전후 연속5점 이상의 유효 비가격 변화는 두 번째 회차에 반영한다. AI 고정 우선권은 없다.

A 경쟁 pool=모든 A 자격 대표(HIGH 시장 전체). 안정화 후 앞2개를 A에 둔다. B pool=그 A에 들지 않은 모든 HIGH. 안정화 후 앞3개를 B에 둔다. C pool=남은 모든 대표, HIGH→MEDIUM→STANDARD 구간을 유지해 안정화 후 아래 제약을 적용하여 최대20개를 선택한다. A/B를 일반 글로 억지로 채우지 않는다. 이 순차 경쟁 방식은 A 넘침 후보를 B/C로 보존하며, 좌석 경계에서 경미한 점수 변화만으로 안정화를 우회하지 못하게 한다. A/B/C pool의 멤버십은 단계상 일부 겹칠 수 있지만 실제 출력 A→B→C와 표시 제외 진단 전체는 Story당 한 카드다. pool 이동 때문에 새 경쟁자가 된 HIGH는 즉시 삽입한다.

## 8. C 다양성·발견

C 1~10번에는 primarySectorId별 최대2개를 우선한다. 매 슬롯에서 남은 가장 높은 I 구간을 먼저 정하고 그 구간 안에서만 quota 미달 섹터를 고른다. 해당 구간에 대안이 없으면 quota를 완화하고 이유를 남긴다. HIGH를 낮은 구간으로 대체하거나 높은 구간보다 STANDARD를 앞세우지 않는다. MACRO_ALL null은 특정 섹터 quota로 세지 않는다. 같은 구간 내 다양성은 점수 안정화 뒤의 명시 노출 정책이며 별도 이유를 기록한다.

5/10/15/20번의 다음 일반 슬롯이 STANDARD일 때만 발견 후보를 고른다. 후보는 이미 검증된 STANDARD 대표 중 published_at≤cutoff<published_at+60분이고 이전 seen에 없으며 현재 A/B/C에서 아직 고르지 않은 것들이다. 정확히60분이면 후보에서도 seen에서도 제외한다. published_at 내림차순→ID로 선택하고, 상위10 quota 안의 후보가 없으면 일반 선택으로 돌아간다. HIGH/MEDIUM이 그 자리에 있으면 발견 슬롯을 사용하지 않는다. 후보가 없으면 일반 순서를 쓰며 가짜 UV나 F를 만들지 않는다.60분은 이번 검수 대상 초기 정책 값이다.

seen에는 실제 A/B/C에 노출한 Issue와 published_at+60분 만료를 저장하고 cutoff에서 만료된 것은 지운다. 이미 고른 사건을 다른 슬롯에 다시 넣지 않으며 같은 글의 반복 발견 부스트를 막는다. 보관은 합성 입력600개 상한이며 이를 넘는 비정상 상태는 자르지 않고 INVALID_INPUT으로 거부한다. 정상5분/25개 출력에서 최근60분 seen은 이 상한 이하다. 실제 앱 노출 telemetry/DB 저장을 했다는 뜻은 아니다.

## 9. 결과·남은 경계

결과는 DRAFT_SYNTHETIC/오류, 현재 context, A/B/C 내부 카드, 대표·자격/선택/제외·quota/발견/carry 진단, 대표 기준 signals와 다음 합성 state다. 카드에는 내부 score/I/T/P/F/claim 참조가 있을 수 있으며 공개 DTO에는 연결하지 않는다. 7B2A envelope/CAS 모델의 실제 DB 연결·동시 트랜잭션·15분 읽기/current 공개상태 재검사·입력 출처 manifest(S7B2AI-01)는7B2C다. 달력 최초게시일/당시순위·앱 숫자 미노출/원본링크는7B3, S7AI-01 실제 조정 의미·실공급은7B4다. 앱11필터/검색16묶음/기업·섹터 ID는 변경하지 않는다.

## 10. 시험·인수·검수

의미 있는 시험은 같은Story A/B/C 자격 우선/기존대표 유지/새HIGH·숨김 교체/조회 변동만 대표 불변, 대표 전 모집단의UV 중복/결측이 영향을 주지 않음, 대표4/5·UV49/50, MACRO T개별행 없이 전역정상/전역불완전/SECTOR결측, A2/B3/C20 넘침·공백·Story 유일성,4점/첫5점/두번째5점·중간공백·context전환·동일cutoff, 새사실/만료/철회 즉시, HIGH M값/모드만 변경·한국/미국 전환 carry·비가격 변화 fresh평가, tier우선 quota/대안없음 완화·STANDARD발견/중복seen/60분 경계, 순열/동점/무변경/출력격리, REAL/비정상 JSON/iterator/getter/숨김 key/잘못된 이전 state 차단이다. 모든 기사·섹터 사례는 SYNTHETIC으로 실제 사실/시세로 저장하지 않는다.

계획 DUAL → 구현 → 단위·타입·product-local pnpm verify 전체 → fresh clone 전체 및 clone Git/고정파일 부정시험 → 구현 DUAL → 검수 바이트 정상 commit → postcommit 전체 → 정상 push·원격 SHA 순이다. 실패/지적은 원문을 보존하고 같은 case 수정본으로 처리한다. 검사·모델·회차 제한을 줄이지 않으며 전체7B/M2/운영/봇 완료를 주장하지 않는다.

계획 r2 보완: S7B2BP-01은 HIGH 구조 signature와 전환 전후 동일 비가격 점수 비교로, S7B2BP-02는 새 Story도 첫 회차 현재 점수 위치에 즉시 진입하도록 통일했다. 시장 전환시 T/P가4점만큼 흔들려도 순서 유지, 전환 직전·직후5점 우위 연속이면 두 번째에 교체, 새로운 MEDIUM/STANDARD Story의 첫회차 위치를 명시 시험한다. S7B2BP-03의 쌍별 고정 직전 프레임 조회와60분 반열림 경계도 반영했다.
