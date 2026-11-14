# 7A 시장자료·수익률 계산 준비 계획

## 1. 시작점과 완료 범위

기준은 main `b7d14c50066398b3c971d4dbd5bebcb3f9c7b999`다. 6E는 구현 DUAL r2, 315개 소스 바이트 일치, local/fresh/postcommit full 각16묶음, runtime23묶음, GitHub 원격 SHA 확인을 마쳤다. 전체6·P03b·iPhone 확인은 여전히 사용자 보류다. 식자재 앱의 코드·DB·설정·키·worker를 사용하지 않는다.

제작 실행계획의 7단계는 실제 가격·섹터 성과·홈 순위 M2다. 이번 7A는 그에 앞선 **격리된 계산 모듈과 합성 자료 시험**만 구현한다. 실제 공급·조정주가·달력 검증이 M2 연결의 선행조건이라는 공통계약을 유지한다. 7A 통과를 7단계 완료나 실시세 연결로 표시하지 않는다. 제품의 currentStage=6 및 미완료 native 상태를 유지하면서 별도 marketMetricsPreparation=7A 기록으로 구분한다. 7B에서 공급 확인·실제 종목코드/별칭·벤치마크 설정, 기간 성과·공개 read·화면·랭킹을 연결한다. 7B 상세 계획과 구현도 각각 DUAL을 거친다.

권위는 공통-운영계약 v1.0 §5~7, 제작 실행계획 v1.3 §10, 상세로직 v1.1 §11 및 기존 contracts의 VerifiedQuote·CalendarSupply다. 권위 문서·기존 SQL1~50·기존 검수 원문을 바꾸지 않는다. 전체 사이트106행/112URL, Telegram 링크 우선·메시지 검색 차선, 대표 원출처 우선, 중복 UPDATE/NEW_ANGLE, 독자적 작성·유사성 보류 요구는 후속8~9에 그대로 보존한다.

## 2. 이번 산출물과 변경 경계

추가 파일은 `packages/domain/src/market-metrics.ts`, `tests/market-metrics.test.ts`, `scripts/verify-stage7a-foundation.mjs`, 7A 계획·승인·구현 메모, 6E 완료 영수증의 제품 사본이다. 기존 변경은 package.json의 새 시험 명령, scripts/verify.mjs의 새 검사·시험 등록, scripts/verify-foundation.mjs의 제한된7A dispatcher 분기, docs/development-status.json의 별도7A 준비 상태 네 경로만 허용한다. 전용 기능 브랜치는 feat/07a-market-metrics다. 기존 domain index.ts·contracts index.ts·6E validator·auth/public gateway·DB/cron·admin/모바일 화면·worker·native SDK·lockfile는 바꾸지 않는다. 새 모듈은 아직 package 공개 entry나 앱 실행 경로에 연결하지 않는다. 시험은 모듈을 직접 import한다. 이 경계가 부족하면 구현 전 계획 수정·재검수한다.

기존 6E validator 파일 자체는 바이트 동결한다. dispatcher는 marketMetricsPreparation.stage=7A인 경우만 기존6E 분기보다 앞에서 새7A validator를 실행하고 provider guard를 그대로 실행한다. 새 validator는 §9의 제한된 Git 이력·분기·현재 main 검사와 최종 보고 식별을 제외하고 6E의 모든 격리·권한·출처·스키마·계약·상태·native·음성 검사 assertion을 그대로 계승한다. 기존 full verify의 나머지 검사는 모두 그대로 실행한다. b7d14c5의 전체315개 기존 파일은 위 네 경로를 제외하고 바이트 동결한다. 허용 네 파일도 검사를 삭제하거나 빈 분기로 우회하지 않았음을 검사한다. 새 구현에 fetch·HTTP·DB·환경 키·파일 IO·현재 시스템 시계 사용을 금지한다. 입력 객체를 변경하지 않는 순수 함수이며 DB migration은0개, 새 네이티브 빌드0개다.

## 3. 입력 신뢰와 종목 식별

함수에는 명시적인 고정 as_of, LOCAL_SYNTHETIC 모드, instrument master, 구성 버전, 합성 가격·달력 배열만 전달한다. 글로벌 Date.now나 시스템 timezone으로 결과를 바꾸지 않는다. 실행 가능한 모드는 이번에는 LOCAL_SYNTHETIC뿐이다. PERMITTED_REAL 입력은 permissionVerified=true여도 LIVE_SUPPLY_NOT_ENABLED로 거부한다. 임의 입력의 검증 bool을 실제 공급 허가 증거로 승격하지 않는다. 모든 입력의 sampleKind는 SYNTHETIC으로 일치해야 한다.

master는 instrumentId·명시된 venue(KRX/NYSE/NASDAQ)·currency(KRW/USD)·거래소 종목코드·매핑 버전으로 식별한다. 이름 문자열이나 추가 검색어로 거래소/종목코드를 추정하지 않는다. KRX는 KRW, NYSE/NASDAQ은 USD만 허용하며 중복 ID에 다른 거래소/통화/코드가 섞이면 입력 전체 오류다. 잘못된 가격을 다른 동명 기업에 붙이지 않는다. 실제 기업 코드나 미국 비교군을 이번에 채워 넣지 않는다.

섹터 구성은 한국 구성군 또는 명시적으로 버전 고정한 미국 비교군을 입력으로 받는다. 미국 R열 전체를 자동 비교군으로 삼지 않고 중국·다른 시장으로 대체하지 않는다. 구성 버전·master 버전이 비어 있거나 충돌하면 계산하지 않는다. 같은 종목의 여러 하위 묶음 중복은 instrumentId로 한 번 센다. 매핑 미확정 구성은 companyId 기준으로 중복 제거하여 분모에 남기고 결측으로 센다. 잘못된 시세를 제외한다는 이유로 구성 분모를 줄이지 않는다. 한국 섹터랭킹·관련종목과 홈 해외 M은 별도 구성군이다.

## 4. 거래일·정규장 가격 쌍 선택

이번 기간은 TODAY만 지원한다. 1주·1개월·3개월·직접 기간은 PERIOD_UNSUPPORTED로 명시하며, 임의 영업일 차감이나 일별 수익률 합산으로 대신하지 않는다. 실제 장기 조정 자료·기간 기준은 7B에서 검증한다.

달력은 venue별 명시적 날짜·휴장·정규장 시작/끝·coverage·version·validUntil·증거 ID가 있는 CalendarSupply 합성 fixture다. coverage 내 빈 날짜·중복 날짜·휴장과 세션 동시 존재·역전/잘못된 시각·유효기한 초과는 CALENDAR_UNAVAILABLE이다. 주말이라는 이유로 휴장을 추정하지 않는다. 탐색은 최대14달력일이며 필요한 이전 정규장/그 이전 정규장이 coverage에 없으면 UNKNOWN으로 중단한다. NYSE 자료로 NASDAQ 종목 세션을 대신하지 않는다. 미래 세션은 휴일 확인에는 쓸 수 있으나 가격 입력으로 선택하지 않는다. UTC/명시 offset timestamp만 허용하고 날짜 경계는 거래소 timezone으로 해석한다. 한국+9 고정, 미국은 America/New_York와 해당 세션의 실제 UTC 시각으로 DST·조기 종료를 처리한다.

정규장 중(open 포함·close 미포함)은 그 세션의 LAST / 직전 완료 정규장 CLOSE다. 정규장 밖은 최근 완료 정규장 CLOSE / 그 이전 완료 정규장 CLOSE다. 한국 장후에도 정규장 종가를 고정하며 KRX 대체거래·미국 프리/애프터마켓은 배제한다. 개장 전·주말·휴장일에는 실제 최근 완료 거래일을 그대로 반환하고 오늘의 새 등락률처럼 이름을 바꾸지 않는다. price_session_id는 venue+tradingDayId+REGULAR로 고정한다.

가격 쌍은 기존 VerifiedQuote 형태에 referenceSessionId·referenceAsOf·referenceAdjustment·adjustmentVersion·corporateActionStatus/Version을 보충한 새 모듈 전용 타입으로 명시한다. 기존 계약 필드의 뜻은 바꾸지 않는다. 현재/비교 가격의 instrument·venue·통화·선택 세션·조정 방식과 버전이 일치해야 한다. corporateActionStatus는 NONE_OR_REFLECTED만 허용하고 UNKNOWN은 ADJUSTMENT_UNAVAILABLE이다. 조정 여부를 확인할 수 없는 분할 전후 RAW 가격을 그대로 비교하지 않는다. 이 상태는 합성 입력의 시험 계약이며 실제 기업행위 검증 인증이 아니다.

LAST의 asOf는 선택 정규장 안이며 as_of 이하, receivedAt은 asOf 이상·as_of 이하여야 한다. LAST stale 한도는 입력의 버전 고정 정책으로 최대120초, 기본120초다. CLOSE와 referenceAsOf는 선택한 해당 정규장 종료시각을 가리켜야 하며 미래 종가를 허용하지 않는다. CLOSE가 주말에 며칠 전이라는 이유로 버리지 않고, 실제 달력의 마지막 완료 세션과 정확히 같은지 확인한다. 공급 수신 시각을 새로운 가격 발생시각으로 덮지 않는다. 여러 레코드가 동일 종목·세션·시각인데 값이 다르면 충돌로 계산 제외한다. 동일 asOf에서 값·비교 가격·조정 metadata가 다르면 receivedAt과 무관하게 CONFLICT로 제외한다. receivedAt tie-break는 값이 같은 중복에만 적용하고 완전히 동일한 중복은 한 번만 처리한다. 가격과 비교 가격은 같은 단일 레코드에 함께 있어야 하며 서로 다른 레코드를 짜깁기하지 않는다. 선택 세션의 최신 asOf 집합에서 충돌·잘못된 수신/조정/가격이 발견되면 예전 레코드로 내려가 숨기지 않고 해당 종목을 결측으로 반환한다. 다른 세션의 레코드는 선택 세션 필터에서 제외하고, 선택 세션에 필요한 레코드가 없으면 결측이다. 이 우선순위를 회귀 fixture에 고정한다.

## 5. 계산·coverage·상태 반환

유효한 가격은 유한한 양수다. null·0·음수·NaN·Infinity·미래값·틀린 세션·틀린 통화·비교 가격 누락은 결측이다. 유효 가격 쌍의 종목 성과는 `(price/referencePrice-1)*100`으로 부호를 유지한다. 실제0%와 자료 미확보를 구별하며 결측을0으로 채우지 않는다. 종목 수익률은 내부 원정밀도를 보존하고 화면 자리수로 먼저 반올림하지 않는다.

구성 중복 제거 후 N이0이면 NO_MEMBERS다. 유효 수 K가 ceil(.7N) 이상이면서 min(3,N) 이상일 때만 유효 종목 수익률의 동일 비중 평균을 제공한다. 예: N=10은 K≥7, N=5는 K≥4, N=4는 K≥3, N=3은 K=3, N=2는 K=2, N=1은 K=1이다. 미달이면 returnPct=null 및 INSUFFICIENT_COVERAGE다. N<3이면 대표기업 기준이라는 메타데이터를 함께 준다. 누락된 종목과 사유를 유지한다. 결측 종목을 먼저 빼서70%를 만드는 행위를 금지한다.

반환은 sampleKind, as_of, 실제 거래일·시장 상태·가격시각·구성/master/달력/조정 버전, N/K/coverage, 종목별 result/reason과 원정밀도 수익률이다. 실제 공급을 사용할 수 없다는 상태와 합성 계산 성공을 분리한다. 이번에는 공개 API·앱 화면에 내부 메타데이터나 PV/UV를 노출하지 않는다. 외부 가격순위에 넣을 후보도 만들지 않는다. 이 모듈은 기사 자체의 수혜/피해/연관 판단을 수행하지 않는다.

## 6. 홈 시장·달력·랭킹과의 후속 연결

기존 rankingMarketContext·marketWindow는 이번에 바꾸지 않는다. 한국09:10 이상~20:00 미만 KR, 그 밖 FOREIGN_US·한국 비거래일 해외 유지, 실제 target_D·직전 한국 종가 이후 후보 창, 10분 C snapshot·rank_epoch CAS·같은 context 대체 규칙은 7B 대상이다. 7A의 가격 쌍 선택은 거래소 정규장 기준이며 홈 선정 시장 전환과 같은 개념으로 쓰지 않는다. 한국 관련종목에 밤이라고 미국 수익률을 붙이지 않는다.

A/B/C의 Story1카드, 혼합100×(.6M+.3P+.1F)·P 부족시6:1, 순수 등락률·조회수 모드, A/B 실질 변화 기한, 달력 최초 게시일별·FOREIGN_PRE/KR_DAY/FOREIGN_POST/FOREIGN_DAY 분리는 7B에서 별도로 구현·시험한다. UV 집계는 6D 현재 watermark/보관 한계를 유지하며 7A에서 가짜 UV나 정규화 점수를 만들지 않는다. 실제 뉴스 수집·분석·게시·정정의24시간 파이프라인은 독립8~10이고, C 순위 갱신을 기다리게 연결하지 않는다.

## 7. 시험과 검수 조건

의미 있는 fixture 시험은 최소 다음24개를 포함한다: KR 장중·종가 경계·개장 전·장후·휴장·긴 연휴, 미국 장중·주말·DST 전후·조기 종료·NYSE/NASDAQ 불일치, 명시 휴장/coverage hole/expired calendar, LAST120초 경계·미래/수신시각 역전, 틀린 세션·통화·조정/기업행위 미확정, 0/null/NaN·음수, 정상0/음수/양수 수익률, 동일 종목 중복·동시각 충돌, 미매핑 구성 분모 유지, N=0/1/2/3/4/5/10 coverage 경계, 여러 하위 묶음 같은 종목 중복 제거, 입력 비변경·고정 시계 재현, REAL/혼합 sample 거부, TODAY 밖 기간 미지원. fixture는 명시 SYNTHETIC이며 실제 거래일·주가 관측이라고 주장하지 않는다.

기존 pnpm verify의 모든 검사와 Android/iOS JS/Hermes export를 유지하고 새 source boundary·market metrics 시험을 추가한다. 새 clone의 독립 Git 객체·frozen install에서 같은 전체 검사를 수행하고 원본/새 clone/인덱스/commit 소스 해시를 대조한다. DB·HTTP·모바일·worker 경로는 이번에 바꾸지 않아 기존 runtime23 관측을 역사 증거로 보존하고, 이 순수 모듈 변경의 DB 실행 인증으로 다시 명명하지 않는다. 변경 범위가 넓어지면 관련 runtime 시험을 추가한다.

계획 Claude+Codex DUAL→허용 범위 구현→자체 시험→구현 DUAL→normal commit→postcommit verify→비밀 없는 정상 push와 remote SHA 확인 순이다. 강제 push·다른 제품 접근·검수 기준 완화는 하지 않는다. P0~P2 미해결이면 착수/완료하지 않고 같은 case 수정본으로 재검수한다. 기존 6E P3 반복 실패 후보 격리와 catalog 잠금 UX는 이 계산 모듈에서 몰래 고치지 않는다.

## 8. 완료와 남은 작업

7A 완료는 순수 합성 계산 계약이 위 시험을 통과하고 DUAL 및 백업된 상태다. 실제 공급 허가·계정/키·예산·KRX/NYSE/NASDAQ 달력·조정 자료·미국 비교군의 검증은 여전히 미완료이며 7B 활성화 전 구체적 공급안으로 확인한다. 실제 뉴스/AI/시세/푸시/광고 요청0,112 RIGHTS_HOLD,live7/8 CLOSED, iPhone USER_DEFERRED·전체6/P03b 미완료를 유지한다. 별도 공용 서비스나 DB를 생성·변경하지 않는다.


## 9. 계획 재검수 r1 반영 — 검사 계승과 Git 이력

S7AP-CODEX-01(P1)·S7AP-01(P2)은 기존6E 검사에 고정된 branch/ref·커밋 수·main 기준 때문에 7A 정상 커밋 뒤 전체 검사가 실패하는 문제다. 이를 빈 분기·실패 무시·가짜 GitHub 환경으로 넘기지 않는다. 기존6E validator는 그대로 보존하고 새7A validator에 전체 검사를 계승한다. 구현 시 b7d14c5의 원본6E validator 바이트를 읽어, 명시된 치환과7A 추가 검사 외에는 동일함을 자체 검증한다. source guard 검사 약화를 정당한 이력 확장으로 위장하지 않는다.

허용되는 치환은 현재 브랜치(main/feat/07a-market-metrics 또는 정확한 hosted detached SHA), 정확한7A local/remote ref 추가, 이력 수·부모 관계, 현재 main 기준(b7d14c5 또는 현재 main HEAD), 최종 보고 stage=7A 식별뿐이다. 기존 초기 root commit·제품 경로·remote URL·공유 object/환경 우회 금지·모든 과거 schema/native/permission/guard hash·status/currentStage6/native 보류 검사와 음성 assertion은 그대로 유지한다. 새로운7A 속성 검사와 b7d14c5 전체315개 기존파일의 네 경로 외 byte freeze를 추가한다. 원본6E 검사에서 main=10cdfef를 허용한 것은 당시 기준이며 새7A의 현재 main 검사는 b7d14c5 또는 정상7A commit을 기준으로 한다. hosted detached PR에서 local main이 없으면 검증된 refs/remotes/origin/main이 정확히 b7d14c5인지 검사하며, 과거 main ref를 만들어 우회하지 않는다. 역사6D/6E ancestry 검사는 별도로 그대로 남긴다.

로컬 7A 사전 검사는 HEAD=b7d14c5·11개 이력, 구현 후 commit 검사는 HEAD의 단일 부모가 정확히b7d14c5·총12개 이력인 경우만 통과한다. hosted PR merge 예외는 기존 native-release-policy의 정확한 repository/PR ref/SHA 확인을 함께 사용하고, 총13개 이력·두 부모 중 하나가b7d14c5·다른 하나가 단일 부모b7d14c5인12개 이력의7A commit일 때만 허용한다. 임의12/13개 commit을 허용하지 않는다. 새 clone은 자기 객체와 실제 b7d14c5 main ref를 만들며 main을 과거10cdfef로 가장하지 않는다. 다른 ref·unrelated history·추가 commit·가짜 hosted 조건을 거부하는 source boundary 시험을 추가한다. normal main fast-forward·postcommit full verify·원격 SHA 비교도 같은 이력 계약을 사용한다. 7A 이후 정상 다음 단계의 이력 확장은 그 단계의 계획·검수에서 다시 정의한다.

S7AP-02(P3)는 §4에서 충돌이 receivedAt tie-break보다 먼저이며 최신 잘못된 가격을 과거 값으로 숨기지 않는 규칙, 가격 쌍은 단일 레코드라는 규칙으로 명확히 했다. 계획 r1 원문·패킷·두 역할의 실제 보고서는 별도로 보존하고, 이 수정은 아직 제품 코드에 반영하지 않았다.
