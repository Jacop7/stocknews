# MAIN PARALLEL P3 — MAIN의 AI·어드민 병행과 두 담당 연결 경계

사용자가 MAIN이 AI 처리를 직접 맡고 어드민도 병행하며 기존 홈/수집기 담당을 계속 지휘하도록 확인했다. AI 작성자를 따로 만들지 않는다. 기준은 P2 전체검사42개 결과·신규68시험·r2 DUAL READY 후 커밋/푸시한 a3441e6d13aabb2dded2e443a27559e6e994e35a, 502파일이다. P2 r1의 세 P2 지적과 회귀 재현/수정 이력, 새 P3 두 건 및 역사 한계는 보존한다. 이 계획은 실제 서비스 완성이나 권한 확대 승인이 아니다.

## 책임과 검수

계획 Opus5.5 medium 우측 IAB + Astra Ultra DUAL → MAIN(admin·AI)와 기존 native collector/home 작성자 병렬 source 구현 → MAIN 전체 인수·full pnpm verify → 같은 전체 manifest 구현 DUAL → 필수 지적은 원래 작성자가 수정·전체 재검사·같은 case 수정 검수 → 커밋/푸시 순서다. MAIN/두 작성자는 gpt-6.1-sol high, 검수자는 작성하지 않는다. 기본 회차·기존 원격 PLAN3/3/HOLD/Router 상태를 초기화하거나 재호출하지 않는다.

담당자는 아래 자기4파일 외 쓰지 않는다. 관련 제품 source/data/공개 계획/자기시험만 읽고 .env/.local-data/인증/다른제품/Git/shared config/서비스·DB·네트워크/추가위임은 금지한다. 자기 단위·worker tsc만 실행한다. 이 운영 지시는 OS sandbox나 자격증명 접근 차단 실증이 아니다. MAIN만 공통파일·전체검사·검수·Git을 담당한다. 실제 네트워크/키/계정/권한/게시·외부서버·기기 활성화는 이번에 하지 않는다.

## MAIN A — 관리자 요청·로그인 수명

기존 DUAL 승인된 stage-cloud11c1-plan.md의 **첫 순서인 로그인·요청·보상 처리만** 현재 제품에 편입한다. 원 계획/원문 보고서는 보존하고 오래된 base24783/460 및 전체 C-1 완료로 가장하지 않는다. 이번에는 runtime-preview.mjs와 editor/[...action]/route.ts 수정, 새 apps/admin/lib/preview-deadline.mjs와 tests/admin-preview-lifecycle.test.mjs를 작성한다. 기존 tests/preview-admin.test.mjs는 logout URL의 pathname·scope=local 확인과 close 실패 뒤 독립 logout이 시도된다는 보완 기대만 갱신하고 나머지 assertion을 보존한다. runtime-local, 프로필·Origin·쿠키 옵션·SQL·실제 설정은 바이트 보존한다. 별도 host127.0.0.2, writer, Windows Job supervisor, 실제 활성화 C-2는 후속이다. 따라서 기존 preview는 실제 config를 만들거나 실행하지 않고 닫힌 상태를 유지한다.

기존 고정 route allowlist·config fixture/ACTUAL 경계·getUser 권위·JWT/owner/app_metadata/expiry 검증·CSRF를 유지한다. 각 요청의 fetch+body 전체8초, 최대256KiB, 로그인 주45초+보상 close/logout 각3초·총52초 한도를 둔다. 실제 timer와 AbortSignal을 함께 써 fetch/iterator/cancel이 abort를 무시해도 기다리지 않는다. 지연 reject는 소비하고 cancel도 bounded best-effort다. timer/monotonic clock은 시험 가능한 주입 포트를 제공하되 production 기본 한도를 caller env로 완화하지 않는다. 실제 외부 요청은 기본 config 차단으로0이다.

설정 확인→**m1_public_identity fingerprint1**→password grant1→getUser1→claims→capability/CSRF→open1→editor1의 순서. fingerprint는 productId=judoju-news/environment=preview/sampleKind=SYNTHETIC/bootstrapId=null/contract=M1을 확인하며 요청8초·256KiB와 로그인 주45초 한도에 포함한다. fingerprint 실패/불명에는 grant·user·open·editor·보상 요청이 모두0이고 cookie도 발행하지 않는다. session()의 기존 설정→fingerprint→capability read→getUser/claims→editor 순서와 각 확인도 보존한다. 토큰 수신 뒤 실패면 그 token의 Auth /logout?scope=local 최대1회. open 직전 정확 capability hash/openAttempted 고정; open 응답불명/timeout/거부/editor실패 모두 같은 hash close 최대1회. close 실패가 logout을 막지 않는다. token 미수신 불명 grant는 전체 사용자/global/others revoke 없이 미추적 잔여 가능으로 기록한다. 최종 반환 뒤 늦게 온 token/응답으로 추가 네트워크 요청을 시작하지 않고 불확실·잔여 가능만 기록하며 그 token을 보존·로그·재사용하지 않는다. 원래 오류를 보상 오류로 덮지 않고 secret·token·이메일·비밀번호·payload·secret 파생hash는 로그에 남기지 않는다. 알려진 SQL 거부의 notApplied 계약은 유지하며 write 자동재시도0. 실패는 성공 cookie를 발행하지 않는다.

정상 logout은 SQL close 후 Auth local logout 각1회, 둘 중 실패/불명이면 고정 오류로 반환하고 성공으로 숨기지 않는다. editor route는 session·CSRF·본문 검사를 통과해 실제 logout을 시작한 경우 성공/실패 모두 같은 기존 cookie옵션으로 cookie를 제거한다. 미인증·CSRF 거절만으로 유효 cookie를 지우거나 외부 logout을 시작하지 않는다. 기존 catch의 error/status/not_applied 계약은 유지한다. 실제 라우트 함수를 test module mock의 fixture runtime/NextResponse와 연결해 실패 cookie 제거를 검증하거나, 실제 loopback fixture HTTP 검증으로 같은 결과를 확인한다. mock 결과를 실제 hosted/기기 검증으로 부르지 않는다. local logout과 JWT 즉시 무효화는 다르다. open timeout 뒤 close먼저/지연open나중 commit 경합은 취소/보상 성공으로 인증하지 않고 C11C1P-01의 잔여 세션 가능을 고정 진단·시험으로 남긴다. 후속 만료 행 정리/supervisor/실제권한 계획이 해결할 범위다.

시험: fingerprint 실패/불명 때 grant·보상0 및 전체 한도 편입, session 기존 순서 보존, token 미수신/불량, 각단계 실패/불명, close/logout 독립 실패, abort무시 fetch/body/cancel, 무응답과 지연 token(추가요청/보존/로그0), 크기상한, 정확 call순서/횟수/같은 hash, 원래오류 보존/비밀 로그0/전역 revoke0, SQL rejection과 logout 실패. 기존 preview 시험 결과가 바뀌는 경우 기능 기대를 약화하지 않고 해당 보완의 의미를 추가 시험한다.

## COLLECTOR — 실제 관측을 위한 offline 읽기 경계

신규 workers/collectors/src/collection-read-contracts.ts, collection-read-boundary.ts, adapters/pilot-listing.ts, tests/collector-read-boundary.test.ts 네 파일. 기존 SYNTHETIC K1/R1/acquisition/P2를 REAL로 느슨하게 바꾸지 않는다. 별도 schema COLLECTION_READ_P3, mode=OFFLINE_REPLAY, fixtureAssertionOnly=true, executionEnabled=false다. 현재112개 endpoint/profile이 RIGHTS_HOLD/UNVERIFIED/live_request_limit0인 사실을 바꾸지 않는다. 실제 source 권한·selector를 승인한 적이 없음을 유지한다.

CollectionGrant는 issuer/evidenceRef/source/endpoint/profile/adapter/sourcePolicy·generation, 목적(DISCOVERY/ORIGINAL_ACCESS/STORAGE/ANALYSIS), host/path/method, knownAt/expiry/retention, request/byte/deadline/redirect budget을 정확 결속한다. raw JSON VERIFIED나 caller boolean으로 현재권한을 인정하지 않는다. constructor의 신뢰된 **offline fixture authority reader**로 현재 generation·목적·범위를 요청 전/redirect 전/응답 수락/분석 읽기 직전 재조회한다. 이 reader는 실제 authority나 서명 검증이 아니다. 기본 transport/fetch/실제 reader는 없다.

prepareRead/validateRedirect/acceptResponse/acceptNotModified/readForAnalysis API를 제공한다. 내부 발행 ticket/observation과 backend generation, request/URL/표현/권한판본/원시 bytes SHA를 묶고 위조 ref·상이 replay를 거부한다. stream transport가 이미 낸 관측을 안전 검사할 뿐 실제 socket을 열지 않는다. mutable byte 입력은 복제하고 bytes/text/hash는 private map에 둔다. public metadata만 inspection에 제공한다. stage response cap은 최대256KiB raw, UTF8 text<=65536, 기존 JSON/depth/node 예산을 완화하지 않고 큰 입력은 HOLD/명시 오류, 자동 자르기0. 헤더·압축전후 크기·request/receive 시각·status/content-type·현재grant·할당budget·checksum 정합성을 확인한다. 허용 규격/한도는 그 fixture grant보다 넓힐 수 없다.

HTTPS 명시 host/path/method만, userinfo/IP literal/private·mixed DNS/IPv6/미승인port/actual peer 불일치 차단. 모든 DNS 주소와 접속peer를 같은 ticket 관측에 결속한다. 단순 URL검사/fake peer가 현실 DNS pinning이나 실제 socket 안전성을 증명하지 않음을 표시한다. redirect는 수동hop 제한과 매hop 재검사, 자격증명 승계 금지. timeout은 저장 성공/예산 환불 근거가 아니다. 304는 같은 URL·표현·현재 권한 세대와 완전한 미만료 캐시의 정확 ref가 있어야 재사용한다. 없으면 빈 목록/완료로 만들지 않는다. import/build I/O0이다.

pilot parser는 **명시 구조화 JSON listing fixture**와 Telegram link entity 이벤트만 처리한다. 실제 S069 HTML selector나 임의 HTML 정규식 parser를 승인하지 않는다. HTML/미확정구조는 PARSE_HOLD, 새 dependency/lock 변경0. 각 후보는 source/endpoint/nativeId/URL/발표·수정시각/timeQuality/parserVersion/bytes digest를 보존하고 duplicate/cycle/partial/missing-field/tab-gap/정상0건을 구분한다. Telegram channel/message/edit/delete identity와 링크만 최소 처리, 메시지 전체 저장·모델 전달·검색 fallback은 이번에0. 링크 목적 권한과 외부 원문 권한은 별개다. edit/delete는 재검사 신호이며 원문 철회나 독립 근거로 승격하지 않는다.

readForAnalysis(observationId, expectedBodyHash, checkedAt)는 소유 observation과 현재 ANALYSIS·STORAGE 권한/세대·retention을 확인한 경우 metadata와 복제한 bounded text를 반환한다. 임의 caller 본문이나 success boolean으로 substitute하지 못한다. 이 API가 MAIN AI 입력의 유일한 취득 경계다. 실제 저장은 하지 않는다. BodyStore와 durable source/receipt/checkpoint의 결합·UNKNOWN 해소·H_BODY 완료는 후속 PostgreSQL 계약에 남긴다.

시험: 실제 현재registry 선언은 호출0, 목적/host/path/만료/세대/위조token 차단, redirect와 DNS/peer, byte/text/header/압축/deadline/budget 한도, 200 parse실패와304 cache불일치/철회, 구조화 목록 정상/빈/부분/중복, Telegram edit/delete 최소화, getter/예산/사후입력·출력변경. fake fixture 결과를 실제 site호환성/라이선스/보안 증명으로 부르지 않는다.

## MAIN B — AI 원문 입력·권한·판본 결속

신규 workers/ai-processing/src/analysis-input.ts, tests/analysis-input.test.ts 두 파일. collector 경계의 공개 계약이 먼저 고정되면 MAIN이 직접 구현하고, 그 전에는 관리자 수명 작업을 진행한다. AI 작성자를 별도 위임하지 않는다. MAIN은 필요하면 담당자에게 공개 API 확정을 먼저 요청하며 자기 임의 mock shape로 양쪽을 갈라 만들지 않는다.

prepareAnalysisInput(boundary, input)는 실제 owned Offline read-boundary 인스턴스의 readForAnalysis만 사용한다. 임의 raw body/success flag/기존SYNTHETIC PipelineEvidence를 실제 관측인 것처럼 받지 않는다. input은 observationId/bodyHash/expectedGrantGeneration/sourcePolicy/analysisPolicy/catalog/prompt/generator version/한국 sector ID 목록/현재 checkedAt를 정확 결속한다. 현재권한·retention·해시/원출처·UTF8·출처시각·호출판본 불일치/미확인 source time은 모델로 넘기지 않고 HOLD/명시 구조오류로 구분한다.

의존 방향은 AI→collector collection-read-boundary/read-contracts만 허용하며 collector→AI의 순환은 금지한다. 두 모듈 모두 Node-only이고 contracts/index barrel·소비자앱으로 export/import하지 않는다. owned 확인은 constructor가 발급한 private brand/WeakSet과 원래 prototype readForAnalysis 호출로 구현해 임의 duck-typed object, instanceof만 통과하는 위조·subclass override·Proxy를 거부한다. collector가 brand checker/reader의 정확 공개 API를 먼저 고정하고 MAIN이 그 API만 소비한다. 실제 authority 인증을 제공하는 brand는 아니며 같은 offline backend 생존 기간의 소유성만 뜻한다. 기존 check:ai-intake의 src/**/*.ts glob이 analysis-input과 그 import를 base tsconfig로 검사하고, collectors 전체 tsc 및 새 home 정식 검사도 함께 수행한다. 전용 guard는 AI/collector 새 schema·경로를 소비자앱 소스와 번들에서 모두 차단한다.

결과 schema ANALYSIS_INPUT_P3, mode OFFLINE_REPLAY, fixtureAssertionOnly=true, disposition READY_FOR_ANALYSIS_INPUT/HOLD, executionEnabled=false다. ready는 사실검증·COLLECT·게시·LLM 호출 승인이 아니다. 허용 bounded text와 source identity/provenance/timequality·body hash·policy/catalog/prompt/modelversion의 canonical request digest를 만든다. 본문 명령은 데이터로만 분리하고 어떤 코드/도구를 실행하지 않는다. 분석 요청에 raw grant/budget 내부정보·tokens·Telegram 전체 메시지를 넣지 않는다. supplied source cutoff를 현재 게시시각이나 최초일로 가장하지 않는다. 입력/출력 detached, source 수정0, 실제 AI API/쓰기/자동게시0이다.

시험: 정상 owned artifact 결속, 위조/다른backend/bodyhash·권한세대/철회/만료·catalog/prompt변화의 digest, no-time/상충·너무큰text·본문속명령 무실행·민감필드 최소화·복제·getter. 기존 A1/A2는 불변이다. 이 단계는 실제 provider API key/model/비용 한도·교차검증/작성/유사성·게시의 연결을 완료했다고 하지 않는다.

## HOME — bound 실행·현재 읽기

신규 workers/home-ranking/src/bound-ports.ts, bound-dispatch.ts, bound-read.ts, tests/home-bound-dispatch.test.ts 네 파일. 기존 B1/P1/K1/domain은 불변이다. producer/current-qualification/Clock/generation은 명시 offline fixture 포트이고 실제 DB 스냅샷 인증이 아니다.

prepareBound({roundId,rankingCutoff,expectedHead})는 caller batch/command/manifest를 받지 않고 생성자 producer에서 B1을 받아 직접 재검증·조립한다. command와 digest/binding은 private pending에 저장한다. completeBound는 그 저장 command만 쓰며 current 관측으로 ArticleVersion/evidence/assessment/게시/영향/예정종료·필요한 Issue 전체를 재검사하고 head CAS를 맞춘다. 필요한 집합은 새 후보와 저장 카드의 합집합, 누락은 적격으로 간주하지 않는다. producer 세대/readRevision이 바뀌면 stale 결과를 commit하지 않는다. readHomeBound도 매번 현재 관측을 검사하고 하나라도 차단되면 전체 CALCULATING이다. 내부 읽기 DTO만 제공하고 앱 public route/DB를 추가하지 않는다.

rankingCutoff는5분 회차, checkedAt은 신뢰된 현재 Clock의 비정렬 시각으로 분리한다. checkedAt으로 최신 철회·새 예정종료·실제15분한도를 먼저 검사하고 기존 fallback은 추가 조건으로 사용한다. caller now override 금지. prepare/complete의 async 포트 대기 뒤 expectedHead/generation을 다시 확인한다. 실제 DB에서는 자격확인+완료 CAS가 같은 transaction이어야 한다는 후속 의무를 보존한다.

engine에 sidecar를 사후 부착하지 않는다. 새 engine에 기존 state복원→변경→engine/bindings/응답/JSON예산 전체 사전검사→owned state 한번교체로 단일 프로세스 합성 원자성을 지킨다. exportBound/restoreBound는 engine와binding/receipt의 exact 대응·완료 prefix를 검사하며 raw P1 export를 단독 채택하지 않는다. export를 실제 외부진실 인증으로 부르지 않는다. 모든 결과 modeOFFLINE_REPLAY/fixtureAssertionOnly/executionEnabledfalse, 고정 cap은 기존engine32및기존JSON예산을 넘지 않고 축출0이다.

stale pending 폐기/slot재사용·완료32상한·영속저장/G0BI-02는 이번에 해결하지 않는다. snapshot 실패는 같은context/profile/scale+15분 조건만 참고, 현재자격이 바뀐 카드를 다시 띄우지 않는다. 시험: rawcommand/위조manifest 우회, prepare후 판본/철회/권한fixture/종료 변경, 누락된옛카드, head경쟁/generation변경,5분사이철회/15분경계,예산실패무변경,restore불일치·detached·actualIO0.

## 제품 편입과 완료 범위

기준502파일/45refs를 봉인하고 계획 DUAL 뒤 feat/main-parallel-p3에서 구현한다. 기존 수정9개: AGENTS.md/package.json/docs/development-status.json/scripts/verify.mjs/scripts/verify-foundation.mjs/apps/admin/lib/runtime-preview.mjs/apps/admin/app/api/editor/[...action]/route.ts/tests/preview-admin.test.mjs/workers/home-ranking/tsconfig.json. 신규17개: collector4+home4+MAIN AI2+MAIN admin2+전용guard1+stage문서4(baseline/preparation/plan/notes). 그 외 source·lock·data/providers·SQL·앱소비자/공개DTO·과거guard는 raw byte 보존한다.

home tsconfig include를 src/**/*.ts로 확장해 base를 상속한다. test:rankable-batch의 Node시험은 유지하고 inline tsc만 새 정식 check:home-ranking 그룹으로 옮긴다. 기존 check:home-worker-adapter 그룹은 보존하며 같은 확장 config를 검사한다. 기존 검사를 없애지 않고 모든 home source의 inherited typecheck를 추가한다(MPP2-05 대응). 새 test:collector-read-boundary/test:home-bound/test:analysis-input/test:admin-preview-lifecycle 네 시험과 check:home-ranking을 전체검사에 편입한다. 기존 모든검사 및 앱/산출물 Node-only 경계를 보존하고 새 worker 표지도 검사한다. admin server helper는 관리자 server build에만 허용하며 소비자앱 번들에는 들어가지 않는다.

status는 productAI/provider/수집 네트워크/DB 활성화0과 개발 두 helper 주문·추가 재작업/검수 요청수 미측정을 구분한다. 검수 준비 후 source를 동결하고 전체 pnpm verify·현재로그 SHA·source pins·필요 admin timer 실패행렬을 증거로 제출한다. 양측 READY 전 완료/연결/배포를 보고하지 않는다. 실제 provider/권한/DB·admin host/writer/supervisor·홈RPC/시장자료·클라우드24시간·푸시/광고/기기/스토어는 후속이다.
