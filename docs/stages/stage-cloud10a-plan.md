# CLOUD10A — 개발 Supabase 공개 읽기 연결 준비

## 목표와 선행 상태

CLOUD09C DUAL7dd12b5 및 commit244125f/tree82da839·main/feature 정상push·56파일 ZIP e64916e9가 완료됐다. 실제 dev는 비활성71data/72relations/177app functions/native7·cataloghead2/339미확정기업341holds다. 앱 public-read.ts와 공개 gateway, 관리자 runtime은 현재 local 전용이다. 이 단계는 **앱의 공개 읽기 경로를 preview 연결에 준비하는 코드와 오프라인 시험**만 만든다. 실제 API 공개·권한 변경·키 읽기·원격 요청은 0이다. 관리자 쓰기와 봇은 이 공개 읽기 경로에 섞지 않는다. cron 설치/활성화는 의존 조건이 아니며, genuine capability/retention 별도 검증 전 부재 유지 불변식을 계속 지킨다.

기준410개 중 403개를 동결하고 pins의 정확7파일만 수정하며 신규8개로418개가 된다. 브랜치는 feat/cloud10a-preview-read-preparation이다. 이전SQL1–50, 모든 cloud archive, 로컬 gateway·관리자 인증/runtime, SDK·native source·lockfile·도메인 계산/게시 정책은 동결한다. currentStage6 및 M2false/112RIGHTS_HOLD/iPhoneUSER_DEFERRED, 실제뉴스AI시세푸시0과 미연결 상태를 유지하고 새 cloudPreviewReadPreparation만 추가한다. 실제연결 완료라고 표시하지 않는다.

## 공개 읽기 계약과 후속 승인 경계

read-rpc-contract.json은 C09B 역사적 snapshot71에서 기존 public 읽기 함수 9개의 정확 signature·정의SHA·postgres owner-only ACL을 고정했다. 아직 현재 원격 상태를 다시 인증한 것이 아니다. 후보는 m1_public_identity, m1_public_article, catalog_public_tree/sector_page/articles/search_news/search_companies/saved/company_sectors다. 과거 legacy m1_public_catalog/articles와 catalog_public_sector 별칭은 새 preview route에서 허용하지 않는다. 이9개 외 RPC, 테이블/시퀀스의 SELECT·쓰기, private/judoju_control schema 노출, 관리자/worker/service_role 권한은 제안하지 않는다. 앱 이용자 로그인은 추가하지 않는다.

현 identity 함수는 environment=preview, bootstrapId=null, sampleKind=SYNTHETIC, contract=M1을 반환하도록 고정돼 있다. local의 bootstrapId non-null 검사를 제거해 공통으로 느슨하게 만들지 않고, 별도 preview 검사가 정확 null·별도모드·물리dev URL을 강제한다. 다른 프로젝트·prod·local identity·형식누락은 거부한다. 코드/회사명으로 stock_code/가격/링크를 추정하지 않고339 identity hold·검색설명/순서와 null 시세 조건을 유지한다.

실제9개 RPC의 anon EXECUTE·Data API on·public schema만 노출·public key 설정·실제 읽기 검증은 **별도 CLOUD10B 계획/구현 DUAL 및 구체적 사용자 승인 이후**다. 이 준비 계획은 이를 승인하지 않는다. Data API는 현재처럼 off, 기존 app177 ACL은 owner-only다. 키를 새로 만들거나 PAT/service-role/secret key를 읽지 않는다. future B 활성화가 없으면 새 CLI는 configuration-before-network 단계에서 중단해야 한다.

## 서버 연결 모듈

새 scripts/cloud-preview-public-read.mjs는 기존 local gateway를 바꾸거나 import 시 실행하지 않는다. 기존 readRoute/catalog/search parser·DTO 검사기는 그대로 재사용하되 정확9RPC allowlist를 추가한다. GET/HEAD만 공개하고 query/body를 임의 RPC로 전달하지 않는다. Host·Origin·credentials 차단·요청크기·서버/사용자 동시 요청 제한·timeout·응답262144B 한도를 기존 수준으로 지킨다. token/cookie 전달은 금지하고 upstream 오류의 세부 SQL·키·headers를 응답/로그에 내보내지 않는다. 다른 URL/프로젝트/redirect/자동 mock fallback을 거부한다.

실제 upstream은 고정 https://nxfpfvsdwbziowkxsxnh.supabase.co 의 /rest/v1/rpc/<allowlisted-name>만 사용한다. public publishable key는 apikey header에만 넣고 Authorization Bearer로 넣지 않는다. legacy anon JWT 지원 시 디코딩은 anon 분류·잘못된 service_role 키의 거부에만 사용하며 JWT 검증으로 주장하지 않는다. legacy Bearer 전송은 해당형식일 때만, 실제인증은 공급자 TLS/API가 한다. sb_secret/service_role/PAT/알수없는 키는 거부한다. 실제키 값은 A에서 읽거나 저장/해시/ZIP/git에 넣지 않는다. 테스트는 명시 SYNTHETIC key와 주입된 가짜 fetch만 사용한다.

실제 CLI 설정은 별도 .local-data의 CLOUD10B 검증 완료 승인/프로젝트/설정 결속이 없으면 네트워크 전에 거부한다. ENV bool/임의 CLI flag만으로 이를 활성화하지 않는다. A는 설정 파일이나 port62331 daemon을 만들지 않는다. 오프라인 HTTP 시험은 자신의127.0.0.1 임시 port0만 열고 finally에서 닫는다. 실제 실행 허용 후에도 preview 개발 bridge의 기본은127.0.0.1:62331이며 LAN·0.0.0.0·iPhone 연결·기존8084/8085/8086 서버 재시작은 이 단계에 없다. 테스트 주입 경계는 OS sandbox나 악의적 코드 작성자 방어라고 주장하지 않는다.

## 앱 변경

새 순수 read-target.ts는 전달된 public 환경 문자열만 해석하며 HTTP·파일·키·전역 환경 IO를 하지 않는다. 기존 public-read.ts만 이를 호출해 요청 대상과 예상 응답 모드를 정한다. LOCAL_SYNTHETIC 기본과 기존127.0.0.1 또는 승인된192.168.200.132:62330은 그대로 유지한다. PREVIEW_SYNTHETIC은 명시 mode와 development/preview 앱 환경, 정확127.0.0.1:62331일 때만 허용한다. prod/알수없는 환경·다른host/port·userinfo/query/hash·TLS로 가장한 잘못된 URL·임의 fallback은 거부한다. 브라우저 원격호스팅/기기 LAN 연결은 후속 단계다.

fetch 응답은 target의 정확 productId/mode/data wrapper를 검증한다. 기존 abort·세대별 갱신·오류시 본문 제거·429 cooldown·백그라운드 처리·저장/검색/조회 동작은 바꾸지 않는다. .env.example은 비활성 예시만 추가하고 실제 runtime env를 쓰지 않는다. 앱에는 public key조차 추가하지 않으며 server secret/관리자 token/Telegram/AI key가 포함되지 않는다. 화면은 계속 개발용 샘플 표시를 유지한다. native package/빌드 identity를 바꾸지 않아 이번 증거는 JS/Hermes export와 브라우저/HTTP fixture이며 실제iPhone검증은 아니다.

## 시험·검수·Git

계획 DUAL 후 코드 구현한다. 의미 있는 시험은 local 기본/명시 preview/틀린 env·URL·모드, 9RPC allowlist와 legacy/write/encoded/중복param 거부, bootstrapId=null preview identity 및 local/prod 혼입 거부, publishable/legacy anon header 분리와 secret/PAT 거부, 잘못된/과대/timeout/redirect/429 응답·닫힘 복구·SYNTHETIC DTO 유지, import/설정 누락시 네트워크0, 독립 loopback server의 GET/HEAD/Host/Origin/credential/rate·동시성 거부와 cleanup을 포함한다. 주입 fetch가 실제네트워크를 호출하지 않았음을 기록한다. Auth/SQL/API read 성공을 fake transport로 인증하지 않는다.

기존 verify의 최신C9 독립 entry를 C10A로 정확1곳 교체하고 CI step도 교체한다. 원래23그룹은 유지하며 최신 독립1와 새 cloud-read test1로 전체25를 실행한다. package.json에는 새 test 명령만 추가하고 기존 명령을 제거하지 않는다. dispatcher는 새분기와 providers만 추가한다. 새 validator는 원래403파일·7exactdiff·8new·authority/safety/테스트 등록/새 client server code 경계/이전archive·native상태·현재Git history/ref를 검사한다. C9 validator 자체는 동결하며 old410 검사를 new418에 실행했다고 주장하지 않는다.

전체25 current→별도 Git객체/frozen install/418 byte일치 전체25→별도 owned negative checkout(guard/entry/CI/dispatcher/config/allowlist 변형 거부, 실제 pnpm 음성시험은 의존성 준비 후)·publisher8→구현 DUAL→검증 sourceZIP→정상 feature commit→committed 독립clone 전체25→동일 검수OID featurepush/mainFF/mainOIDpush→combinedremote·최종검증backup/status를 지킨다. 실패는 보존하며 성공으로 합산하지 않는다. force/reset/rebase/production ref삭제/빈commit은 없다. 원격DB/권한/API설정/키/Auth/worker/실수집/실AI/운영배포/식자재자원 변경0이다.

## 공식 근거

- [Supabase Data API 보안](https://supabase.com/docs/guides/api/securing-your-api): off이면 권한과 무관하게 REST가 응답하지 않고, 함수의 EXECUTE와 SECURITY DEFINER를 별도로 검토해야 한다.
- [API keys](https://supabase.com/docs/guides/getting-started/api-keys), [새 키 이관](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys): publishable key와 JWT를 구분하며 apikey header를 사용한다.
- [Cron 설치](https://supabase.com/docs/guides/cron/install): 별도 확장/작업 변경이므로 이번 공개읽기 준비와 분리한다.
