# 7B2A · 5분 기준시각·시점 자료·스냅샷 상태 전이 계획

2026.11.15 · 구현 전 계획 · 실제 서비스 활성화 결과 아님

## 1. 권위와 현재 기준

최신 사용자 요구와 `outputs/plan-unified-20261115/홈순위-운영개정안-v1.0.md`(SHA256 8ab76a1bc0758b13ad6e97f237e799a77b645d59c53944b722e6d0895caf5a93)가 홈 정책의 권위다. 제품 main `8bd708382519126f8d87a9e705c9b05e8a6d5bca`의 331개 파일, 7B1 구현 DUAL READY·50시험·local/fresh/postcommit 전체18묶음·원격 SHA 확인을 기준으로 삼는다. 기존 7A·7B1 모듈은 미연결 합성 계산이며 실제 시세·뉴스·앱 홈 연결 완료가 아니다.

7B2를 시간/재현성(7B2A), Story 대표·lane·안정화(7B2B), 실제 DB 원자 저장/읽기 연결(7B2C)로 나눈다. 이번에는 앞 부분의 **순수 SYNTHETIC 프로토콜과 상태 전이**만 구현한다. 이를 실제 cron, DB 트랜잭션, 경쟁 제어, 홈 게시로 부르지 않는다. 7B3 공개 DTO·가격 미노출·종목 원본 링크, 7B4 허용 실공급과 NXT 세션/조정, 8 수집·9 독립 작성은 계속 별도 작업이다. iPhone USER_DEFERRED, 112 RIGHTS_HOLD, live7/8 CLOSED를 유지한다. 식자재 제품 코드·설정·DB·worker·키를 사용하지 않는다.

## 2. 파일·검사 경계

새 파일은 `packages/domain/src/home-snapshot.ts`, `tests/home-snapshot.test.ts`, `scripts/verify-stage7b2a-foundation.mjs`, 이 계획/승인 JSON/7B1 완료 증거 사본/구현 메모다. 기존 331개 파일 중 변경은 package.json의 시험 명령, scripts/verify.mjs의 추가 시험 실행, scripts/verify-foundation.mjs의 새 분기, docs/development-status.json의 별도 homeSnapshotPreparation 메타 네 경로뿐이다. domain index·기존 7A/7B1·공급·contracts·SQL·앱·admin·worker·lockfile·native와 과거 validator는 바이트 동결한다. 새 모듈에 import, IO, 네트워크, 시스템 현재시계, 환경변수, 랜덤을 넣지 않는다. 모든 public 함수는 unknown 입력을 검증하며 입력을 변경하지 않는다. branch `feat/07b2a-home-snapshot`.

새 validator는 동결 7B1 validator 전문을 출발점으로 현재 branch/ref/HEAD/main/단일 자식 이력, 정확한 네 경로 델타, report 및 자기상속 비교에 필요한 치환만 명시한다. 이미 승인된 provider now:()=>time 예외와 그 전문 일치 검사는 그대로 유지한다. 과거 자기상속 검사는 동결된 해당 단계 파일을 검사하고, 마지막 상속 검사만 새 validator와 직전 단계 사이의 정확한 치환 결과를 검사한다. 중간 단계의 assertion을 없애거나 옛 HEAD/ref를 꾸며 실행하지 않는다. 기준 331파일 전문 동결, 명시 변경 네 경로 전문 델타, 새 시험 실제 실행을 추가 확인한다. 새 정상 단일 자식/검증 hosted merge만 허용하며 임의 extra commit/ref는 거부한다.

## 3. 고정 시각과 한국 거래일 context

모든 입력은 mode=LOCAL_SYNTHETIC, sampleKind=SYNTHETIC이다. REAL 또는 다른 mode는 허가 bool과 무관하게 LIVE_NOT_ENABLED다. ISO UTC는 실제 존재하는 날짜의 `YYYY-MM-DDTHH:mm:ssZ` 또는 정확한 `.sssZ`만 허용하고 내부 결과는 밀리초 포함 UTC로 정규화한다. cutoff는 UTC epoch 300000ms 배수여야 하며 초/밀리초가 남은 입력은 INVALID_INPUT이다. 날짜·ID·버전·enum·중복·정수·유한성을 검사하고 holes/상속 인덱스가 있는 배열도 거부한다. 오류는 구조적 진단으로 반환한다.

`deriveHomeContext`는 cutoff, 고정 정책/카탈로그/비교군/평가 버전, 세 신호 가용 조합, 합성 한국 거래일 달력을 받는다. 한국 날짜·분은 고정 UTC+09:00(Asia/Seoul) 계산으로 정한다. 실제 휴일 API나 요일 추정은 없다. 달력은 calendarVersion/evidenceId, knownAt/validUntil, coverageStart/End와 각 날짜의 OPEN/CLOSED 상태를 가진다. 날짜 범위가 연속 완전한지 확인하고, 중복일·누락·역전·미래 수신·cutoff 만료를 거부한다. coverage는 최대366일이며 그 안의 모든 날짜가 있어야 한다. 현재 날짜와 목표 거래일을 찾을 수 없으면 CONTEXT_UNAVAILABLE로 보류한다.

한국 거래일이면 08:10 이상~20:00 미만 KR_COMBINED, 나머지는 FOREIGN_US다. 한국 휴장일은 하루 FOREIGN_US다. segment는 거래일 FOREIGN_PRE/KR_DAY/FOREIGN_POST, 휴장일 FOREIGN_DAY다. targetKrTradingDay는 20:00 미만일 때 오늘을 포함한 첫 OPEN, 20:00 이상일 때 오늘 다음 날짜부터 첫 OPEN이다. 따라서 08:05→08:10에는 같은 D를 유지하고 19:55→20:00에는 다음 D로 이동한다. 휴장일에도 이 규칙으로 첫 실제 한국 거래일을 선택한다. 달력에 다음 거래일이 없으면 임의 영업일을 만들지 않는다.

context 비교 키는 배열의 고정 순서 JSON으로 policyVersion/catalogVersion/comparisonSetVersion/evaluationSetVersion/calendarVersion/marketBasis/targetKrTradingDay 및 T/M/P enabled 조합을 담는다. cutoff와 segment는 키에서 뺀다. segment는 한국 날짜별 진단/달력 구간 필드이며 안정화 비교의 단절 사유가 아니다. FOREIGN_POST→FOREIGN_PRE 또는 휴장 FOREIGN_DAY 전환에서 시장·목표 D·버전·신호 조합이 같으면 23:55→00:00에도 같은 context다. 스냅샷 식별에는 context와 cutoff가 모두 들어가므로 자정의 새 회차는 별도로 보존된다. 신호의 관측값이 바뀌었다는 이유만으로 context를 바꾸지 않으며, 가용 조합/정책/카탈로그/비교군/평가/달력 버전/시장/목표 D가 바뀌면 새 context다. HIGH의 별도 비가격 carry_order는 7B2B에서 비교하므로 이 키를 HIGH 순서 초기화 명령으로 사용하지 않는다.

이 함수는 홈 기준시장을 정할 뿐 개별 거래소가 실제 열렸다고 인증하지 않는다. 미국 DST·조기 종료/휴장·마지막 완료 정규장·KRX/NXT 종목별 거래/기준가·조정 선택은 기존 7A/후속7B4의 검증 영역이다. 이 단계에서 새 M을 생성하지 않는다. global comparisonSetVersion과 종목별 adjustment/corporateActionVersion을 다른 의미로 유지한다(S7AI-01). NXT를 기존 7A 정규장 자료로 대신하지 않는다.

## 4. cutoff 당시 알려진 판본 선택

`selectKnownRevisions`는 cutoff, 고정 knownDataSetVersion, complete=true·watermarkAt=cutoff인 **합성 완전성 선언**, 판본 참조 목록을 받는다. 실제 수집의 완전성을 증명하는 기능은 아니다. 참조는 kind(ISSUE/CLAIM/QUOTE/SEARCH/UV/CALENDAR), entityId, revision(양의 safe integer), knownAt, status(VALID/BLOCKED), contentId(불변 본문 참조)로 구성한다. 본문·가격·개인정보는 받지 않는다. 동일 kind/entityId/revision은 정확히 같아도 중복 입력으로 거부한다. 같은 entity의 높은 revision은 낮은 revision보다 이른 knownAt을 가질 수 없다. 입력 순열은 의미를 바꾸지 않는다.

knownAt<=cutoff 중 가장 높은 revision을 kind/entity별로 한 개 선택하고 kind/entityId 코드포인트 순서로 반환한다. 서로 다른 revision의 knownAt이 같을 수 있으며 이 경우도 높은 revision이 선택된다. 미래 수신 판본은 현재 결과에 섞지 않는다. 마지막 선택이 BLOCKED면 그 상태와 contentId를 그대로 반환하고 옛 VALID로 되돌리지 않는다. 철회·정정·숨김·시세 무효·수정 검색치의 tombstone을 포함한 모든 판본을 같은 규칙으로 다룬다. VALID를 기사 게시 자격이나 원문 진위의 인증으로 해석하지 않는다. 실제 payload의 근거 검증은 7B1/9단계 책임이다.

S7AI-02의 known-data 집합 계약은 이 선택으로 구체화하되, 실제 원자 입력 읽기·저장·원천 판본 불변성·보관기한은 7B2C/공급 연결에서 검증한다. 늦게 수신한 정정이 과거 cutoff의 결과를 소급 변경하지 않는지 재생 시험한다. cutoff와 knownDataSetVersion/선택 결과는 envelope에 고정한다.

## 5. 불변 envelope와 CAS 상태 전이의 합성 모델

`buildSnapshotEnvelope`는 성공한 context·known 판본 선택 결과를 unknown 입력으로 다시 검증해 내부 envelope를 만든다. context cutoff와 선택 cutoff는 같아야 한다. 외부 함수 결과 모양만 흉내 내어 검사를 건너뛰지 않도록 같은 내부 검증을 공유한다. 원 입력의 정책·달력·판본 참조를 함께 받아 재계산하는 방식으로 구현해 성공 bool을 신뢰하지 않는다. envelope에는 streamId, cutoff, contextKey/구성요소, knownDataSetVersion, 선택된 참조와 고정 순서 canonical 직렬화가 있다. canonical은 동일 바이트 비교용이며 암호학적 SHA·서명/실제 원문 무결성 검증이 아니다. hash라는 이름으로 인증하지 않는다. 가격·점수·UV·기사 본문·실제 순위 카드·권한 bool은 포함하지 않는다.

`planSnapshotCommit`은 하나의 합성 stream 상태 {revision, snapshots}, expectedRevision, 새 envelope의 원 입력을 받는다. snapshots는 cutoff 오름차순, cutoff 유일, 같은 stream이며 revision은 snapshots.length와 같은 음이 아닌 safe integer다. 기존 envelope들도 구성 원 입력에서 재계산한 canonical과 같아야 한다. 모든 배열을 새로 만들며 과거 스냅샷은 수정하지 않는다. 성공만 revision+1이다.

판정 순서는 전체 입력 검증 → 같은 stream/cutoff 슬롯 존재 여부 → latest 후퇴 여부 → expectedRevision 비교 → 새 append다. 같은 슬롯·같은 canonical은 REUSED(버전 증가 없음), 같은 슬롯·다른 canonical은 SLOT_CONFLICT다. cutoff는 stream 안에서 자연 중복 키이므로 같은 cutoff를 다른 정책/context로 다시 넣어 두 개 만들지 않는다. 새 envelope가 기존 latest보다 오래됐으면 STALE_CUTOFF, expectedRevision이 현재와 다르면 CAS_CONFLICT다. 어떤 거부도 기존 상태를 바꾸지 않는다. 회차 누락은 허용하지만 후퇴·기존 슬롯 수정은 허용하지 않는다. 동일 stream/cutoff의 두 작업이 같은 revision을 읽었다면 순차 재생에서 첫 한 개만 추가되고 후자는 REUSED 또는 SLOT_CONFLICT다. 다른 새 cutoff 경쟁은 첫 성공 이후 두 번째의 낡은 expectedRevision을 거부해 최신 상태로 재시도하게 한다.

구조가 유효한 모든 전이 결과는 현재 revision을 함께 반환한다. REUSED는 기존 완료본 확인이며 CAS 성공이나 revision 증가가 아니다. 이는 CAS **전이 명세/시뮬레이터**이며 실제 프로세스 경쟁이나 장애 원자성을 제공하지 않는다. DB UNIQUE(stream,cutoff), 트랜잭션 잠금/조건부 포인터 갱신, 입력 manifest 봉인·내구성·복구는 7B2C에서 구현·다중 연결 시험한다. 늦은 작업의 기사 게시 자체를 차단하는 기능이 아니며 뉴스 수집·분석·게시·정정은 홈 회차와 독립적으로 24시간 처리한다.

## 6. 남겨 두는 기능과 검수 권고

Story 대표를 고른 뒤 모집단을 만드는 운영 계약, A최대2/B최대3/C최대20, 5점·연속2회 교체, HIGH 가격 독립 carry_order, 새 중요 사실 즉시 반영, C STANDARD 발견 슬롯·다양성은 7B2B다. 7B1의 Story 제거 전 신호 모집단을 실제 운영 완료로 사용하지 않는다. S7B1I-02의 MACRO_ALL T 항목은 7B2B에서 중립0.5와 전역 검색 완전성의 관계를 별도 확정한다. 이번에는 7B1 산식·T 계약을 수정하지 않는다.

같은 context 직전 완성본 최대15분 읽기·현재 공개자격 재검사·context 변경 시 산정 중·숨김/철회 즉시 차단은 7B2B/2C의 읽기 계약이다. 이번 envelope를 앱에 응답하지 않는다. 최초 게시일 달력 필터/당시 snapshot 조회와 앱 숫자 미노출은 7B3이다. 검색56일 자료·직접 영향 배분·실측 교정, 실제 일별 달력/미국 세션·허용 가격 공급은 연결 단계에서 검증한다. 7B2A가 이 기능을 완성했다고 보고하지 않는다.

## 7. 시험·완료 기준

의미 있는 합성 시험은 거래일 08:05/08:10/19:55/20:00/23:55/00:00, 휴장일 전체 US, 요일과 다른 명시 달력, 다음 거래일 주말/연휴/월·연도 경계, 달력 범위·누락·만료·미래knownAt, 비5분/비정상 ISO, 동일5분 재생·1일288회, 신호 조합·targetD/정책 변경 context, 같은 조합 cutoff만 바뀔 때 context유지, 별도HIGH carry 미구현 경계다. 판본은 미래정정 배제·cutoff 경계 포함·BLOCKED 최신판본의 옛 VALID 복구 금지·중복/역전knownAt/구멍/상속 배열 거부·순열/불변·watermark불완전과다른cutoff 차단을 확인한다. envelope는 가짜 성공 결과/구성 변조/시각 불일치·canonical 재현, 상태 전이는 최초/재사용/동일슬롯충돌/낡은CAS/늦은회차/다른stream/변조된기존상태/불변/순차 경쟁을 확인한다. 모든 함수 REAL 거부를 시험한다.

계획 DUAL READY → 범위 구현 → 단위·타입·product-local pnpm verify 전체 → 독립 fresh clone 전체 검사 및 실제 clone의 Git/ref/fixture 부정시험 → 구현 DUAL → 검수 바이트 정상 commit → postcommit 전체 verify → 정상 push·원격 SHA 확인 순서다. 시험·검수 실패는 기록하고 동일 case 수정본으로 처리한다. 한도·검사·허용 source 경계를 낮추지 않는다. 성공 보고는 7B2A의 미연결 합성 clock/as-of/envelope/전이 모델과 검증된 실제 범위만 말한다.

계획 r2 검수 보완: S7B2AP-01에 따라 segment를 진단 필드로 한정했다. 거래일 전후·휴장 전후 23:55→00:00의 시장/D/버전/신호 조합이 같으면 context가 같다는 기대값을 시험한다. S7B2AP-02는 REUSED의 현재 revision 반환, 동일 knownAt일 때 높은 revision 선택, 현재 한국 날짜가 coverage 밖이거나 다음 OPEN이 coverageEnd 밖이면 CONTEXT_UNAVAILABLE이라는 명시 시험으로 반영한다. 계획 단계에서 실제 코드·DB·앱을 바꾸지 않는다.
