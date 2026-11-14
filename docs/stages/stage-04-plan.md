# 주도주뉴스 4단계 계획 — 독립 로컬 DB·공통 작업 큐 M0

2026.11.14 · 구현 전 계획 r2 · 새 제품 전용 · 운영 공급·출시 승인 아님

## 선행 증거와 병행 범위

현재 제품 main은 `3c4a03447e4e0d275eb33941c25c875947766987`이다. 3단계 등록·정책 구현은 DUAL READY `0eaad28310de23d0df1d725f1da804e185040c904b20f3489af451630ce00e22`, 124파일의 검수/index/commit/새 clone 바이트 일치와 커밋 후 전체 검사를 통과했다. 도메인·native24 + provider20 회귀, 타입·어드민 production·양 플랫폼 Hermes 검사 증거가 있다. 초기 clone Next 실패도 지우지 않았다.

**3단계의 실공급 트랙은 완료되지 않았다.** 원본106행/112URL의 목적별 권한은 UNKNOWN, 실요청0, 시세·공식 캘린더 공급과 비용 기준선은 미확보다. 공급 상태 IMPLEMENTED_SUPPLY_PENDING과7/8 LIVE 공급 차단을 유지한다. 승인 제작계획이 허용한4~6 M1 수동/명시적 fixture 트랙만 독립 진행한다. 모델 계획에서도3을 active 공급대기로 남기고4를 병행 active로 봉인했다.

권위는 공통 운영계약 v1.0, 제작 실행계획 v1.3 §8의4단계/P01/P02a/P03a/P04a, 상세로직 v1.1이다. 제품 코드·키·DB·Docker·volume·배포는 식자재 앱에서 가져오지 않는다. 설치된 공용 개발 도구만 사용한다. 기존12개 승인 문서 사본과 native0004/SDK/lock 바이트는 유지한다.

### 제품 상태와 역사 검사의 병행 표현

S4P-01에 따라 `docs/development-status.json`은 currentStage=4와 이번 구현 상태(IMPLEMENTING/IMPLEMENTED_RUNTIME_PENDING/검수 전 IMPLEMENTED_REVIEW_PENDING)를 갖되, stages[3].state와 supplyTrack.state는 **IMPLEMENTED_SUPPLY_PENDING**을 유지한다. completedStages에는 기존0·1·2만 두고,3의 커밋3c4a034와 DUAL 검수 증거는 별도 implementationStages에 기록한다.3을 COMPLETE로 적어 앞선 단계 전부 성공 규칙을 맞추지 않는다.4의 M0가 실제 통과했는지도 제품 밖 완료 영수증으로 구분하고,3의 실공급 상태를 소급 변경하지 않는다.

검사 진입점은 새4단계 분기를 두고 기존0/1/2/3 분기는 그대로 보존한다. 새 분기는 기존 제품 격리·권위 원본·비밀 ignore·native 지문·Git 증거를 재적용하면서, 이번 local DB/worker 자원 상태를 별도로 검사한다. verify-stage3-providers의 registry/차단 검사는 재사용하되4단계에서는 root state가 아니라 stages[3]/supplyTrack의 공급대기를 검증하도록 분리한다. 기존3단계의 root state 규칙은3분기에서 유지한다. 루트 currentStage만 바꾸거나 assertion을 제거해 통과시키지 않는다.

4단계 검사에는 승인 사본13개와 기존12개의 바이트/manifest 불변, `feat/04-db-queue`/main 또는 정확히 검증된 hosted detached ref,3c4a034의 조상 관계,초기 독립 root commit,로컬 commit 수4~5(실제 hosted PR merge만6 허용),허용된 Git ref 집합을 명시한다.0~2는 COMPLETE,3은 공급대기,4는 현재 상태,5~12는 NOT_STARTED여야 한다. 별도 음성 시험에서3을 COMPLETE로 변경·3커밋을 completedStages에 삽입·실공급 없이7/8 gate OPEN·5이후 성공 주장·13사본 누락·다른 조상/브랜치/자원 재사용을 모두 거절한다. 실제 공급 통과에 따른3의 이후 완료 전이는 별도 근거와 후속 단계 검수 전에는 허용하지 않는다.

## 이번에 만들 것과 대기할 것

이번 목표는 **새 로컬 Supabase DB에서 권한·버전·게시 트랜잭션·공통 작업 큐를 실제 실행하고, 별도 Docker worker가 모의 효과를 처리하는 M0**다. 수집·AI·시세 순위·푸시·광고를 앞당겨 켜지 않는다. 앱/어드민의 실제 CRUD 연결은5~6단계이며, 이번에는 그 연결 계약과 서버 노출 판정 함수를 준비한다.

preview/production Supabase 프로젝트·클라우드 worker·호스팅·도메인·운영 비밀은 이번에 만들지 않는다. 유료 계약·약관 동의·새 권한 승인이 필요하면 해당 항목을 대기시키고 독립 구현/검사는 계속한다. 로컬 DB/worker 실제 실행에 실패한 상태를 M0 완료로 바꾸거나5단계의 필수 공통 작업 게이트를 통과시키지 않는다.

## 로컬 자원과 실행 경계

새 브랜치는 계획 DUAL 승인 후 main `3c4a034`에서 `feat/04-db-queue`로 만든다. 승인 계획은13번째 불변 사본으로 복사한다. 현재 config의 project_id는 `judoju-news-local`, 포트62320~62329 내 명시된 서비스 조합이다. 이미지·container·network·volume마다 제품 소유 식별과 실제 연결 관계를 기록한다. 이름만 비슷하다고 기존 자원을 채택하지 않는다.

| 자원 | 경계와 증거 |
| --- | --- |
| Supabase local | 제품의 기존 신규 config만 사용. CLI3.1.0의 `--workdir`에 제품 절대 경로를 항상 지정하고 local 명령만 허용 |
| Docker network | 새 `judoju-news-local-net`에 제품 label과 `com.docker.network.bridge.host_binding_ipv4=127.0.0.1`를 설정. 그 network ID를 start에 명시하고 실제 PortBindings를 검사 |
| DB/API/Studio/메일 | 설정 포트 충돌을 먼저 확인. localhost만 노출하며0.0.0.0/공유 LAN 바인딩이면 성공 처리하지 않음. 기존 앱 연결이나 전체 Docker 자원 정리 금지 |
| DB 식별 | 새 DB에 product/environment/bootstrap UUID 지문을 저장. project_id·container label·network·volume·포트·DB 지문이 모두 맞아야 mutation 허용 |
| worker | 새 `workers/common` 코드·Dockerfile과 제품 전용 Compose 프로젝트/서비스/image. 새 network에만 연결하고 외부 공개 포트 없음 |
| 로컬 인증 값 | 새 스택에서 제공·설정한 개발 전용 값만 ignored `.local-data`/`.env`에 보관. CLI의 기본 JWT/anon/service 값은 공개 고정값일 수 있으므로 ‘새 고유 비밀’이라고 표시하지 않음. service role·DB 비밀번호·JWT secret·설치 secret은 stdout/검수/소스에 출력하지 않음 |

실제 초기 기동 전에 Docker 엔진 가용성을 확인하고, 필요한 경우 이미 설치된 공식 Docker Desktop만 시작한다. 설치/라이선스·사용자 로그인이 필요하면 대신 동의하지 않는다. `--ignore-health-check`로 정상 기동을 가장하지 않는다. `--network-id`는 방금 생성·검증한 전용 network만 받는다. 기존 다른 제품 container의 내부·로그·DB·volume은 읽지 않는다.

최초 migration은 새 제품 DB에만 적용한다. 재실행은 migration history를 비교하며, 자동 db reset/down migration/volume 삭제를 일반 복구로 쓰지 않는다. 시험은 transaction rollback 또는 자체 식별된 합성 fixture 정리로 격리한다. reset이 꼭 필요하면 새 제품 local 지문·대상 데이터 범위를 확인하고 별도 처리한다. 이미지 digest·CLI·DB 실제 버전과 schema hash를 기록하며 태그 이름만으로 검증됐다고 하지 않는다.

기본 개발 키의 비밀성을 로컬 보호 경계로 삼지 않는다. loopback 노출·전용 network·합성 데이터와 새 DB 지문이 경계이며, 로컬 기본 키를 preview/production이나 앱에 복사하지 않는다. 이 설정은 기존 제품의 키를 읽어 가져오는 방식이 아니다. 별도 생성하는 설치 secret과 mock 수신 인증 값은 crypto의 난수로 제품 전용 값을 만든다. 테스트용 관리자/일반 역할 JWT는 이 새 로컬 스택의 확인된 서명 설정으로만 생성하고, 원문 키 대신 출처·알고리즘·test-only 여부·주입 경로의 논리 ID를 기록한다. 고유 signing 설정이 확인되면 그 사실을 따로 기록하고, 확인 전에는 고유성을 주장하지 않는다. 운영 전용 키는 신규 운영 프로젝트 단계에서 별도로 발급한다.

## 의존성과 native 입력 보존

공통 worker는 Node 내장 fetch/crypto/timer 기반 `.mjs`와 PostgREST RPC를 사용한다. 이번에는 새 npm package/workspace importer·외부 DB 드라이버·앱 SDK를 추가하지 않는다. `workers/common`은 package.json 없는 새 실행 코드 디렉터리다. root scripts만 추가하며 pnpm-lock과5개 native 지문 입력을 변경하지 않는다. DB 시험은 제품 DB container의 psql/허용 시험 도구를 사용한다.

Docker의 Node24.15.0 공식 base image는 구현 시 실제 digest를 확인해 고정한다. digest 미확정이면 Docker worker 실행 완료를 주장하지 않는다. worker 코드는 COPY 허용 목록과 최소 build context로만 들어가며 `.env`·서명키·로컬 데이터·기획 사본·다른 제품 파일을 이미지에 넣지 않는다.

외부 이미지 pull은 새 제품 로컬 구현에 필요한 공식 Docker Hub의 Node 및 Supabase CLI가 사용하는 공식 Supabase registry 경로만 허용한다. 실제 repository·pull digest·bytes/실패를 기록하고 임의 mirror/출처 불명 이미지를 대체하지 않는다. 다운로드 실패·한도·라이선스·로그인에 막히면 그 자원을 IMPLEMENTED_RUNTIME_PENDING으로 남기며 Docker 실제 실행 게이트를 완료하지 않는다.

service role은 새 서버 worker에만 주입한다. Expo의 EXPO_PUBLIC·어드민 브라우저 번들·로그에 넣지 않는다. worker는 새 local API의 허용 RPC만 호출한다. service role 자체는 강한 서버 권한이므로 RPC 제한이 그 키의 DB 권한 전체를 줄이는 보안 장치라고 주장하지 않는다. 운영의 별도 최소 권한 역할·secret 교체·클라우드 네트워크 검증은 이후 배포 게이트다.

## DB 스키마와 버전 계약

처음부터 확장 가능한 ID·FK·unique·정책 버전을 두고 실제 조회/게시/작업 기능에 필요한 필드를 구현한다. 미래 동작을 빈 JSON 하나로 완료 처리하지 않는다. 아직 실행하지 않는 영역은 스키마 계약과 향후 owner를 표시한다.

| 영역 | 테이블·중요 제약과 이번 시험 |
| --- | --- |
| 제품/정책/카탈로그 | product_environment, policies/catalog_versions, sectors/subgroups/companies/sector_companies, keyword definitions/changes·audits. 활성/순서·소속·버전·비활성 참조 검사 |
| 출처 | sources/endpoints/adapters, permission_profiles, checkpoints, source_documents/revisions. source와 endpoint 연결·URL/외부ID/판본 고유키, 원문·권한·보관기한. 112 UNKNOWN을 켜지 않음 |
| 사건·기사 | stories/issues/issue_aliases, claims/evidence_edges, article_versions/impacts, decisions/holds. Story와 Issue·ArticleVersion 분리,5개 공개 상태·예약·최초/실질 수정시각·현재 버전/CAS |
| 순위 | ranking_snapshots/entries와 context/key·가격 세션·정책/카탈로그/벤치마크 버전. 이번은 스키마·음성 검사이고 순위 계산·시세 연결은7단계 |
| 설치·조회·알림 | installations/settings, private view_events/aggregates, outbox/notification_deliveries. 설치 소유 검증·통계 비공개·설치별3알림종류·멱등 delivery키 |
| 실행·보관 | jobs/job_attempts/leases, schedules, effect_receipts, purge/tombstones/deletion_ledger. effect_key unique, lease token/만료·재시도/DLQ·삭제 후 자동 복구 금지 계약 |

초기 DB 자료는 **SYNTHETIC/개발용** 카탈로그·기사·작업뿐이다. 실제56카테고리/339기업의 최신 전체 이관을 이번 fixture로 대체하지 않는다. 시트 import/diff·관리 UI·실제 기업 검색 설명의 이관은5~6단계다. DB에서 sample_kind와 환경 지문을 확인해 production에서 합성 자료 게시를 거절하는 조건을 둔다. 공급 registry는 원본 행 해시와 논리 locator를 보존하고, 원본 시트/기존 데이터 전체를 가져왔다고 하지 않는다.

expand migration→서버/worker→앱→나중 contract 순서를 따른다. 로컬에서는 빈 DB migration 재생과 기존 fixture 데이터 유지 상태의 추가 migration을 모두 시험한다. 운영 파괴적 down migration은 없다. API 최소 지원 버전/호환 필드와 unknown job_schema_version 거절을 구현하고, 실제 구버전 앱 회귀·store 강제 업데이트는 이후 M1/출시 게이트에 남긴다.

## 권한·공개 조회·설치 소유권

공개 노출 테이블은 모두 RLS를 켜고 명시적인 GRANT만 준다. anon 및 일반 authenticated는 내부 원문/비밀/조회 통계/초안·과거 본문·작업·감사를 읽거나 쓰지 못한다. public 목록·본문은 현재 PUBLISHED 포인터와 노출 정책을 확인한 projection/RPC로 제한한다. CORRECTION_PENDING/WITHDRAWN/HIDDEN은 본문을 반환하지 않고 알려진 ID resolver의 안전한 상태 안내만 제공한다. resolver·목록·본문 반환 형식에 조회수가 들어가지 않게 계약/응답 시험을 둔다.

migration 소유 역할의 public/private schema default privileges와 기존 PUBLIC/anon/authenticated의 테이블·시퀀스·함수 권한을 명시적으로 회수한 뒤 필요한 GRANT만 복원한다. 신규 테이블/함수의 기본 권한이 자동 공개로 이어지지 않게 한다. 시험 전용 신규 테이블에 RLS 정책을 만들지 않은 경우에도 anon SELECT·write가 거절되는지 별도 음성 시험을 한다. 기존 Supabase 내부 auth/storage schema의 권한을 임의 일괄 변경하지 않는다.

권한 상승은 사용자 변경 가능한 user_metadata가 아니라 서버가 관리하는 app_metadata의 관리자 역할로 판단한다. 관리자 토큰 없음·일반 사용자·관리자·서버 역할별 허용/거절을 DB와 REST에서 모두 시험한다. 관리자 실제 로그인 화면과 초기 운영 관리자 발급은5단계다. 이번 실제 사용자 계정을 만들지 않고 테스트용 JWT claim/fixture로 역할 검사를 재현한다. RLS를 우회할 수 있는 서버 키는 브라우저에 보내지 않는다.

SECURITY DEFINER 함수는 search_path 고정·schema qualification·호출 역할/환경·매개변수·상태를 검사하고 기본 PUBLIC execute를 회수한다. private schema는 Data API에 노출하지 않는다. projection view를 쓰면 security_invoker 또는 동등한 명시 권한 경계를 시험하고, definer view가 RLS를 우회해 초안을 읽는지 음성 검사를 한다.

consumer 로그인 UI는 없다. 설치별256bit 비밀을 서버 측 발급 계약으로 정의하고 DB에는 hash·회전 버전·만료/폐기만 둔다. 설치 A가 B의 알림/관심 섹터/이벤트를 읽거나 바꾸지 못해야 한다. installation_id만 아는 요청, 임의 Header/claim, 만료·회전 전 secret은 권한이 아니다. 서비스 전용 RPC에서 검증된 capability로만 처리하고, 공개 클라이언트의 직접 테이블 쓰기는 닫는다. 이번은 로컬 RPC·모의 HTTP 경계 시험이며 실제 앱 SecureStore·발급 endpoint의 인터넷 rate limit·키회전 운영은6/10단계에서 완성한다.

## 게시 트랜잭션·공통 큐

게시 RPC는 현재 카탈로그/정책 버전·대표 섹터/impact/visibility·공개 상태·예약·검증 조건을 검사하고, article_version·공개 pointer·impact·outbox를 한 트랜잭션으로 쓴다. 경쟁 요청은 expected version/CAS 및 effect_key unique로 한 번만 반영한다. 실패 시 일부 포인터나 outbox가 남지 않아야 한다. 예약시각에도 최신 조건을 재검사하는 계약을 둔다. 실제 원문 분석·새 방향 분류기는6/8/9단계다.

Cron은 schedule key로 **큐 등록만** 하고 worker가 lease를 받아 처리한다. 중복 Cron/복수 consumer라도 job/effect 고유키는 같다. DB 안의 상태 반영과 외부 효과는 구분하며 외부 호출을 DB 잠금 안에서 하지 않는다. lease owner token·기한·heartbeat·최대 시도·backoff/DLQ·승인된 재처리 절차를 구현한다. lease가 만료된 이전 consumer가 완료/CAS를 성공시키지 못해야 한다.

외부 효과 성공 후 ACK 전 종료도 effect_key/receipt로 재조정한다. 수락 여부가 불명확하면 WAIT_CONFIRMATION과 근거를 보존하고 새로운 키로 재발송하지 않는다. 실패 재시도·불확실 수락·DLQ·관리자 재처리를 별도로 구분한다. 이번 외부 효과는 같은 프로젝트의 모의 수신기만 사용하며 실제 뉴스 API·LLM·메일·푸시·광고를 호출하지 않는다.

모의 수신기는 worker와 **별도 container/process**로 같은 전용 network에 둔다. 공개 포트 없이 제품 전용 mock 인증 값을 검사하며, 자체 새 volume의 receipt를 effect_key별 원자적·내구성 있게 저장한다. worker 메모리나 ACK 트랜잭션과 공유하지 않는다. receipt 기록 후 응답 유실/worker 종료를 주입하고, worker 재시작·lease 재인수 뒤 같은 키의 receipt를 조회해 재조정한다. receipt가 없다는 단순 응답만으로 ‘미전송 확정’을 추정하지 않는다. 모의 수신기의 확정된 상태와 원래 키를 유지하며 부분 성공/수락 불확실의 프로세스 경계를 시험한다.

공통계약의 초기 lock_timeout 2초·transaction/statement 상한5초를 게시·lease·ACK 등 짧은 DB 구간에 적용한다. 실제 DB 세션/역할 및 RPC 경로에서 효력이 있는 설정을 확인하고, 경합/지연 주입 시 상한 내 실패·rollback·기존 pointer/lease 보존을 시험한다. 함수 안에 설정 문자열만 있어 타이머가 실제 동작하지 않는 경우는 통과가 아니다. 외부 효과와 heartbeat 주기는 이 DB 트랜잭션 상한과 분리한다.

worker는 local 모드의 허용된 MOCK 작업만 처리한다. 잘못된 environment/job_schema_version·알 수 없는 kind·합성 자료의 운영 반영 요청은 격리/거절한다. 장시간 작업 heartbeat, graceful shutdown, 재인수·poison job·회복을 실제 두 consumer와 프로세스 종료로 시험한다. 자동 뉴스 게시의24시간 연속 처리와10분 홈 회차는 별개이며 이번 mock queue가 그 작업의 발행/분석 완료를 뜻하지 않는다.

3단계 비차단 S3I-06은 이번 상태 실행 계약에서 보완한다. TECH_TEST 기술검증 완료→SHADOW 진입을 명시하고, 신규/품질 재승격과 일시 ACTIVE 복귀를 구분한다. permission/adapter/quality 버전·에피소드별 fastRetryCount/reprobeCount·고정 lowFrequencySince를 DB에 보존한다. 현재 UNKNOWN endpoint를 승격하는 시험은 합성 fixture에만 적용한다. S3I-03의 정확한 IP 특수 대역 개선은 실제 공급 활성화 전 별도 필수 항목이며 이번 미수집 worker가 이를 우회하지 않는다.

## 검사·수용 조건

| 게이트 | 실제 증거 | 완료로 세지 않는 것 |
| --- | --- | --- |
| 로컬 자원 | 새 DB/API/worker의 지문·network·volume·localhost 포트·health, secret 출력 없는 연결 검사 | config 파일만 존재, 다른 제품 DB의 응답, health 무시 |
| migration/권한 | 빈 DB/추가 migration 재생, FK·unique·CAS·GRANT/RLS·보안 함수·REST의 긍정/음성 시험 | SQL 텍스트 검색만으로 실행 성공 판정 |
| P01 전체 | 같은 게시2번, 종료/재인수, lease 만료·stale ACK,2consumer,부분 효과 성공, heartbeat·max retry/DLQ·승인 재처리 | 단일 메모리 배열 시험만, 외부 수락 불명확을 성공/새 키 전송 |
| P02a | 실제 local Cron→등록 큐→Docker worker→모의 효과/receipt/ACK 및 중복 스케줄 키 시험 | 수동 enqueue만으로 Cron 통과, 실제 유료/푸시 발송 |
| P03a | 서버 visible_sections·한국 관점 필드·긍정만/양방향/피해전용/조건부 관련/일정 없음 노출 계약 회귀 | 앱·어드민 표시 일치 P03b까지 완료라고 주장 |
| P04a | clock/calendar 주입·09:10/20:00·KR휴일/US DST·조기 종료·UNKNOWN, 세션/다음 한국장 귀속 계약 | 실공급/시세·공식 커버리지 P04b 완료라고 주장 |
| 보안/비공개 | anon/일반/관리자/서버·설치A/B,초안/통계/원문/secret 유출 차단,correction/resolver 계약 | service role로만 조회해 RLS 검증했다고 주장 |
| 역사/제품 | 기존0~3검사·12문서·native SDK/lock 동일,13번째 승인 계획,새 브랜치/이력 경계,전체 verify·독립 checkout·실제 DUAL | 로컬 DB를 운영 클라우드/hosted CI 완료로 표시 |

Cron 실제 시험은 새 제품 fixture schedule 하나만 잠시 등록하고 실행을 확인한 뒤 그 시험 schedule만 비활성화한다. 기다리는 동안30초 이내 간격으로 상태를 수집하고 무기한 대기하지 않는다. pg_cron/필요 확장이 없다면 원인을 기록하고 P02a를 미통과로 둔다. mock job가 생성됐다는 사실만으로 worker 처리·ACK까지 성공으로 세지 않는다.

출처 수집 관련 A34~38/A43/A48/A52~54/U06은3단계 합성 정책 증거를 보존하고, 이번 실제 DB/worker 역할과 연결되는 사례만 추가 실행한다. 나머지 A/U의 현재 DB/RLS·공개/정정/버전 계약은 migration 시험에 연결하고, 실제 프론트/매체/알림·조회 집계·보관 삭제의 owner5~12를 따로 기록한다. 기능 틀만 있고 실제 실행이 없는 사례는 명시적으로 PENDING이다.

## 실행·기록·중단 조건

1. 이 MD/HTML, 승인 계약의4단계·기존3증거·new model seal·현재 config를 Claude 브라우저와 독립 Codex Ultra로 검수한다. 승인 전 branch/DB/worker 실행은 없다.
2. 새 브랜치·13번째 계획 사본·migration/권한·공통 RPC/queue·Node worker·Dockerfile/Compose·시험 도구를 구현한다. 새 제품 자원만 생성한다.
3. 로컬 DB/모의 효과의 실제 실행,역할별 음성 시험,P01/P02a/P03a/P04a,전체 verify·독립 checkout을 검사한다. secret/원문 없이 명령·상태·해시·case/분모와 실패 원문을 남긴다.
4. 실제 범위와 미완료 항목을 포함해 구현 DUAL 검수를 받는다. 통과한 동일 제품 바이트만 커밋/main ff-only,제품 밖에 증거를 보존한다. 원격 push·운영 생성/배포는 하지 않는다.
5. M0 전체 게이트 통과 후5단계 M1을 시작한다. Docker·DB·Cron·worker 시험이 빠졌으면 IMPLEMENTED_RUNTIME_PENDING 등 정확한 상태로 남기고5단계 필수 선행 완료를 주장하지 않는다.3단계 실공급 대기는 계속 별도이며7/8 LIVE는 닫혀 있다.

로그인·새 약관·비용·권한 조치가 필요하면 그 작업만 대기시킨다. 사용자 부재를 동의로 해석하지 않는다. 대상 지문 불일치·기존 제품 자원 발견·실행할 이미지/역할/endpoint 미확정은 요청 전 차단한다. 보류를 성공으로 바꾸거나 검사를 약화하지 않는다.

## 공식 자료와 실제 확인 범위

- [Supabase local development](https://supabase.com/docs/guides/local-development): Docker/CLI 로컬 개발과 localhost 전용 network bind 안내를 확인했다. 설치 CLI3.1.0 `start --help`에서 local-only,정확한 --workdir/--network-id와 health 옵션도 확인했다. 실제 기동은 아직 없다.
- [Supabase RLS](https://supabase.com/docs/guides/database/postgres/row-level-security): 노출 테이블/권한·view·서버 키 경계를 참고한다. 이 계획의 새 schema/RPC와 역할별 실행 결과를 확인한 문서는 아니다.
- [Supabase Cron](https://supabase.com/docs/guides/cron): Postgres 기반 스케줄 지원을 확인했다. 현재 로컬 확장/스케줄/worker 성공 증거는 없다.

공식 기능 안내는 새 DB·키·계약·운영 승인과 다르다. 이번은 구현 전 계획이며 실제 수집·분석·게시·정정의 운영 가동은 후속 단계다.
