# 주도주뉴스 5단계 계획 — 관리자 수동 게시와 앱 조회

2026.11.14 · 구현 전 계획 r2 · 신규 제품 local M1 · 운영 자동 게시 아님

## 선행 조건과 이번 완료 범위

제품 main `c844fe14e62e427d280b58ac023b2c9f1935ed75`의 4단계 local M0는 구현 DUAL READY `e37fa04024051c6ca003e4ff213112f0396448229a69c07704665dcc2a55f9fb`,155개 검수/index/commit/새 committed clone 바이트 일치, 커밋 후 전체 verify PASS다. 실제 PostgreSQL/REST/Docker 26개 시험군과 계약18, domain/native24, provider20을 통과했다. 초기 wildcard 기동·복구와 개선 transport의 full fresh bootstrap 미재실행 한계도 보존한다.

3단계는 실제 공급 대기다.112 endpoint RIGHTS_HOLD, 실제 기사·Telegram·검색·시세·AI·푸시·광고 요청0,7/8 LIVE CLOSED를 유지한다.5단계는 승인 제작계획 §9의 M1 수동/명시적 합성 fixtures 트랙이다. 식자재 앱 코드·설정·DB·인증·키·Docker·배포는 접근·공유하지 않는다. 신규 local Supabase만 사용하며 preview/production 생성·원격 push는 없다.

첫 흐름은 **관리자 로그인 → 작성·대표 섹터 선택·서버 미리보기 → 게시 → 공개 DB 조회 → Android·iOS 홈/이슈체크/섹터체크/상세 → 수정·숨김 반영**이다. 실제 기사의 권리·근거를 확보한 것처럼 만들지 않고 SYNTHETIC 고정 fixture로 검증한다.5단계는 전체 자동 서비스 완성이 아니다.

양쪽 실제 native 화면을 확인하지 못하면 P03b 전체와5단계 완료를 주장하지 않는다. 사용자 부재 중에는 구현·API·어드민·Android 검증을 진행하고, iPhone의 새 흐름 관측이 필요한 시점에 구체적 결과를 준비한 뒤 확인을 요청한다. 기존 iPhone의2단계 홈 실행 확인을 새 게시 흐름 검증으로 재사용하지 않는다.

## 화면과 데이터 흐름

| 이용자 | 경로 | 데이터 경계 |
| --- | --- | --- |
| 관리자 | /login → /articles → 작성/편집 → 미리보기 → 게시/수정/숨김 | Next 서버가 새 local Supabase Auth 사용자와 app_metadata 관리자 권한을 확인. 브라우저에 service key나 DB password를 전달하지 않음 |
| 소비자 앱 | 홈/이슈체크 → 섹터 필터/섹터체크 → 상세 | 로그인 없음. 공개 projection과 서버 visible_sections만 사용. 비공개 draft·조회수·설치 비밀·관리 API 접근 없음 |
| 모의 worker | 수동 게시/숨김 outbox → 등록 큐 → 모의 공개 갱신 효과 → 영수증/ACK | P02b의 실제 수동 경로를 연결. 운영 검색/푸시 대신 local 효과이며 시험 종류를 구분 |

앱의 새 흐름은 기존 보라/흰 배경·간격·하단4탭을 유지한다. 자세한 편집·필터 팝업·종목/웹뷰·저장·알림·조회 통계의 확장은6단계다.5단계에서는 게시 글을 찾는 최소 활성 섹터 선택·필터와 목록·상세를 실제 DB에 연결한다. 미연결 가격이나 홈 시장 순위를 사실처럼 표시하지 않고 '개발 DB · 합성 기사 · 순위/시세 미연결'을 명시한다.

## 신규 코드와 기존 입력 보존

`feat/05-manual-publishing`을 위 main에서 만든다. 계획 MD/HTML의 DUAL 검수 전에는 브랜치 구현·DB migration·Auth 계정 생성·새 listener를 시작하지 않는다. 승인 후 계획 MD를14번째 불변 사본으로 추가한다. 기존13개 기획 사본, 적용 migration1~10, native0004의5개 입력과 SDK/lock은 유지한다.

추가 코드는 Next 서버의 Supabase Auth/REST 호출·cookie/CSRF·편집 API, 공통 public DTO/검증·노출 렌더링, Expo 목록/상세 데이터 훅, 공개 읽기 전용 로컬 gateway와 합성 end-to-end 시험이다. Supabase JS SDK·새 native dependency·workspace package는 추가하지 않고 fetch/Node builtin/기존 Next·Expo로 구성한다. 불가피한 SDK/native 입력 변경은 기존 runtime 지문·새 native build 게이트를 따로 적용하며 조용히 lock을 바꾸지 않는다.

서버 비밀·DB 연결은 실제 runtime 진입에서만 읽고 module import나 Next build 중에 Auth 생성·DB 호출·listener 기동을 하지 않는다. 비밀 없는 독립 checkout의 전체 source/build 검사를 유지한다. 미설정 runtime은503/안내로 실패하며 샘플을 live 대체로 제공하지 않는다. 계정 fixture·DB 변경·gateway/worker 실행은 일반 verify와 분리한 명시적 local 명령이다.

제품 상태는 currentStage=5,0~2/4는 완료,3은 IMPLEMENTED_SUPPLY_PENDING,5는 현재 구현/검수/기기대기 상태,6~12는 NOT_STARTED다. completedStages에는0~2와4의 c844fe1 증거만 두며3을 넣지 않는다.4의 DUAL·M0 완료 사본을5의 선행 근거로 추가하고, 커밋된4의 '검수 전 CLOSED' metadata와 제품 밖 최종 완료 영수증을 구분한다.5용 검사 분기는14사본·기존13 불변·c844fe1 조상·main/feat/05-manual-publishing 또는 검증된 hosted ref·local history5~6(실제 PR merge만7)·고유 자원/비밀 ignore를 검사한다.0~4 분기는 보존한다. local-runtime의4 전용 preflight와 provider 검사의3 공급대기 조건은5에서 명시적으로 확장하되 실제 소유권·loopback·권한·공급 차단 검사를 제거하지 않는다.

## 인증과 서버 경계

관리자만 신규 local Supabase Auth에 로그인한다. 소비자 앱에는 로그인을 추가하지 않는다. 이번 검증에는 명확히 구분한 local fixture 관리자 계정과 일반 계정을 새로 만들며 실제 메일·SMS 발송을 하지 않는다. fixture 비밀번호·JWT·refresh token·service key는 ignore된 로컬 비밀에만 두고 응답 로그·문서·Git·모바일 번들에 넣지 않는다. 실제 운영 관리자 계정/복구 정책을 생성한 것으로 세지 않는다.

Next 서버는 Auth의 실제 사용자 확인과 현재 app_metadata 관리자 역할을 검사한다. user_metadata와 클라이언트 role 값, JWT payload를 단순 decode한 결과를 권한 근거로 쓰지 않는다. DB 편집 RPC에도 authenticated 관리자 JWT를 전달해 SQL 권한 검사를 통과시킨다. 초기 fixture 생성 등 별도 서버 작업 외에 모든 요청을 service_role로 대행하지 않는다.

SQL에서도 현재 Auth 사용자 상태·활성 관리자 membership·서버가 발급한 유효한 관리자 세션을 확인해, 오래된 JWT의 관리자 metadata만으로 권한 철회를 우회하지 못하게 한다. membership 변경은 소비자/일반 계정에 공개하지 않고 local bootstrap/관리 경로와 감사에 한정한다. 기존 M0의 순수 서명 관리자 fixture를 실제 local Auth·membership fixture로 연결해 회귀 의도를 유지한다. 사용자의 실제 계정이나 다른 제품 권한을 가져오지 않는다.

SQL 결속은 검증된 JWT의 sub=auth.uid()와 NULL이 아닌 session_id UUID, 현재 auth.users의 삭제·정지 여부와 관리자 app_metadata, auth.sessions의 같은 id·user_id·not_after, private 발급 관리자 세션의 같은 user/session ID·폐기 여부·DB UTC 기준 만료, 활성 membership을 모두 확인한다. 단순 JWT claim이나 Next cookie 유무만으로 통과시키지 않는다. 새 migration은 공통 private.is_admin/assert_editor를 강화해 기존 M0의 publish·set_state·reconcile·requeue·admin_view_count 등 관리자 RPC에도 동일하게 적용한다. 새 UI/RPC만 보호하고 구형 RPC를 남기지 않는다. 실제 Auth 로그인에서 발급된 이전 JWT로도 로그아웃·membership 해제·역할 회수 뒤 기존/신규 직접 RPC가 거절되는지 검사한다.

세션 cookie는 HttpOnly·SameSite·기간/로그아웃 정책을 둔다. Secure는 HTTPS 운영에서 필수이며 localhost HTTP 개발의 예외를 운영 설정으로 이관하지 않는다. 서버는 쓰기와 로그인 요청의 정확한 Origin·허용 content type·CSRF를 검사한다. CORS 허용이나 UI 숨김으로 관리자 권한을 대신하지 않는다. 비인증/일반 사용자/위조 metadata/외부 Origin/만료·취소 세션 음성 회귀를 둔다.

브라우저에는 불투명 세션 capability만 주고 Auth JWT/refresh token은 서버 전용 암호화 세션 저장소에 둔다. private DB에는 capability hash·Auth session ID·유효/폐기 상태·암호문을 두고, 암호화 키는 신규 local Next 서버의 ignore된 비밀로만 관리한다. 공개 gateway·앱에는 이 키나 Auth token을 주지 않는다. Auth 로그아웃 뒤 access JWT가 자체 만료까지 유효할 수 있으므로, 우리 세션 폐기를 SQL 권한에도 반영하고 이전 JWT의 직접 편집 호출 거절을 검사한다. cookie 수정은 Next Route Handler/Server Function에서 수행한다.

## 게시·편집·버전 계약

새 migration은 기존 표와 M0 RPC를 재사용·확장한다. 초안 저장/불러오기·편집 목록·서버 미리보기·게시·숨김·대표/관련 섹터 검증에 필요한 관리자 RPC와 공개 카탈로그/목록 계약만 추가한다. 매크로는 대표 섹터 없이 관련 섹터를 둘 수 있고, 섹터 기사에는 활성 대표 섹터를 요구한다. 섹터 선택으로 그 기업 전부의 수혜를 자동 확정하지 않는다.

각 변경은 expected revision, 정책·카탈로그 version, effect_key/payload binding으로 CAS·멱등을 유지한다. NULL revision과 버전·불확실성 입력을 거절한다. 초안/기사 판본은 구분하고, 첫 게시 시각은 보존하며 실질 수정 일시는 별도로 둔다. 수동 편집 보호를 저장하고 이후 자동 작성이 이를 덮는 API를 만들지 않는다. 정정/숨김/철회는 기존 공개 본문·검색/목록 노출을 즉시 차단하고 저장/alias는 본문 없는 상태 안내로 해석한다.

5단계 편집기는 즉시 수동 게시만 제공한다. 예약 UI·실행기는6단계 소유이며 U05는 PENDING으로 남긴다.5단계 입력에서 scheduled_publish_at 등 예약 값은 명시적으로 거절하고 무시하거나 예약 성공으로 응답하지 않는다.6단계에서는 DRAFT와 예약 시각을 저장하고 도래 시 최신 근거·권한·정책·카탈로그·섹터 상태를 재검사해 게시 또는 HOLD로 결정한다. 기존 M0의 SCHEDULE_NOT_DUE 가드는 예약 실행기 완성이 아니다.

게시·숨김과 같은 트랜잭션의 outbox를 전용 dispatcher가 공통 큐에 같은 의미 키로 연결한다. outbox 인수/예약·중복 처리와 재시작을 검사하고, M0의 수동 enqueue만으로 P02b를 통과시키지 않는다. 공개 read는 no-store와 현재 공개 상태 검사로 기존 본문을 차단하므로 숨김을 worker 완료까지 기다리지 않는다. 앱은 focus/foreground와 활성 상세의 짧은 재확인 경로에서 서버 상태를 갱신하며, 확인 실패·숨김 상태에서 캐시 본문을 계속 정상 글처럼 제공하지 않는다.

수동 작성·AI 작성이 공유할 입력 틀은 source_market·selection_market_basis·analysis_perspective=KR_EQUITY·impact_profile·visibility_policy_version과 근거별 영향/조건을 포함한다. 이번 운영 모드는 SYNTHETIC으로 서버 고정하며 payload에서 PERMITTED_REAL을 보내도 허용하지 않는다. fixture의 근거 표시를 실제 뉴스의 독립 매체 검증으로 세지 않는다.

서버 미리보기는 게시와 같은 노출 판정·공개 DTO 정제 경로를 사용한다. 원문 시장이 해외여도 영향 분석은 한국 주식 관점이다. 클라이언트가 visible_sections를 임의로 결정하지 않는다. 적용된 M0 함수의 축약된 profile/일정 판정을 그대로 충분하다고 간주하지 않고, 새 migration으로 공통 운영계약 R07/R08에 맞춰 확장한다.

R07: 검증된 구조화 영향 근거의 path ID·방향·조건으로 positive_path와 negative_path 및 impact_profile을 서버에서 도출한다. 작성된 시나리오 문장의 존재나 클라이언트 profile 값으로 근거를 역생성하지 않는다. 직접 수혜 또는 조건부 긍정 경로만 positive_path, 직접 피해 또는 조건부 부정 경로만 negative_path다. 둘 다 있으면 POSITIVE_NEGATIVE, 긍정만 있으면 POSITIVE_ONLY, 긍정 없이 직접 피해가 있으면 DAMAGE_ONLY로 시나리오를 숨기고 피해·검증된 리스크를 표시한다. 서로 다른 섹터의 직접 수혜·피해라도 양쪽 경로가 있으면 두 시나리오다. 직접 수혜·피해가 없는 연관만은 RELATED_CONDITIONAL로 유지하며 긍정 경로에 따라 긍정만/양쪽/시나리오 없음으로 나눈다. 조건부 부정 경로만 있고 직접 피해도 없으면 시나리오를 숨기고 검증된 연관·리스크만 표시한다. 부정만의 시나리오나 근거 없는 긍정을 만들지 않는다.

필터용 related_sector_ids는 영향 섹터의 상위 집합이며 화면의 '연관 섹터' 목록과 동일하지 않다. 표시 목록은 각 영향 경로의 direction·근거·조건에서 별도로 도출한다. 같은 섹터·같은 경로를 수혜·피해·연관에 중복 표시하지 않으며, 실제로 다른 경로인 경우만 구분한다. 한국 주식과의 검증된 연결이 없으면 게시를 차단한다. 조건부 연관이라는 이유만으로 확정 수혜/피해를 추론하지 않는다.

R08: 주요 일정은 기사 이후 확인할 대상과 최신 공식 근거, 검증 상태, 근거 시점, 시간대가 있는 경우만 표시한다. EXACT는 확정 event_at, PERIOD는 공식적으로 확인된 기간·기간 표기·정밀도와 필터용 기간 경계를 저장한다. 기간 경계는 실제 행사일로 출력하지 않는다. 일자 미정인 공식 기간은 해당 기간과 '정확한 날짜 미정'을 표시하고 날짜·시각을 지어내지 않는다. 상태는 VERIFIED/CANCELLED/UNVERIFIED/SUPERSEDED를 구분한다. 취소·대체·미검증 또는 지난 일정/종료된 기간은 숨긴다. 미래 event_at이 남아 있어도 CANCELLED이면 숨긴다. 시간대·근거 없는 입력을 임의 기본값으로 공개하지 않는다. 서버가 최신 근거·상태로 공개 DTO를 정제하고, 동일한 결과를 미리보기·게시·공개 read·앱에 적용한다. 기간 중 아직 확인할 미래 부분이 있으면 그 공식 기간을 표시할 수 있다. 일정 경과에 따른 표시 제거는 첫 게시 시각을 바꾸지 않고, 실질 내용 정정은 판본·감사로 남긴다.

필수 회귀는 직접 긍정만/직접 긍정·부정/피해 전용 외에 (1) 방향 없는 연관만, (2) 긍정 근거 없음, (3) 직접 피해 없이 조건부 부정만, (4) 조건부 긍정만, (5) 조건부 긍정·부정 양쪽이다. 주요 일정은 없음/미래 확정 시각/지난 일정/공식 기간만 확정/미래 시각이 남은 취소/대체·미검증을 포함한다. 각 입력을 관리자 미리보기 → 게시 → 익명 공개 read → Android·iOS 상세에서 대조하며, 시나리오 없는 연관 글도 정상 게시될 수 있음을 확인한다. 실제 양쪽 native 관측 전에는 해당 P03b를 완료 처리하지 않는다.

초기에는 3개 안팎의 승인 분류 이름을 쓰는 명시적 합성 카탈로그/기사 fixture를 만든다. 전체 한국 카테고리·하위 묶음·종목·시트 C/D/E 설명 이관은6단계 최신 시트 검수 범위이며 이번 소수 fixture로 완료 처리하지 않는다. Telegram의 링크 우선 → 원문 불명확 시 최소 검색 단서로 뉴스 탐색 → 원문 확보 전 보류 정책은3단계대로 유지하며 실제 connector를 켜지 않는다.

## 공개 API와 iPhone 개발 연결

Supabase API와 관리자 Next는 localhost 전용을 유지한다. 휴대전화의 localhost가 PC를 가리킨다고 가정하지 않는다. 별도의 **public-read local gateway**는 익명 공개 DTO의 고정 GET 목록/섹터/상세 경로만 제공한다. upstream은 새 제품127.0.0.1:62321과 고정 read RPC이며 외부 URL·임의 RPC·쓰기·관리 cookie/Bearer 전달은 거절한다. private 표·조회수·service key·Auth 관리 경로는 없다. 공개 anon 값만 사용하는 별도 설정으로 private 서버 credential을 분리한다.

기본 listener는127.0.0.1:62330이다. Android는 자기 emulator의 ADB reverse 또는 확인된 개발 경로를 사용한다. 이미 사용자가 승인한 동일 Wi-Fi Expo 연결에 맞춰 iPhone에 필요하면, 현재 실제 PC 인터페이스와 기존 승인 LAN 주소가 일치하는 경우에만 해당 주소의 읽기 전용 합성 listener를 추가한다.0.0.0.0 wildcard·방화벽 완화·TLS 검증 해제·관리자 LAN 노출을 하지 않는다. 주소 변화·OS 차단·권한이 미확정이면 해당 기기 연결을 PENDING으로 남긴다. 공개 개발 listener가 실데이터를 제공할 수 없도록 local/SYNTHETIC 지문과 응답 종류를 강제한다.

gateway 초기 제한은 GET/HEAD의 고정 경로만, 목록 기본20·최대50개, 섹터 최대100개, URL2048자·cursor256자, upstream 응답 최대256KiB로 둔다. 크기 초과는 스트리밍 중에도 중단하고 부분 본문을 정상 응답하지 않는다. 실제 socket peer 기준 IP당 분당60회·burst12, 전체 분당240회·동시8개/IP당3개를 적용하고 초과 시429와 Retry-After로 응답한다. 전달된 X-Forwarded-For를 신뢰하지 않는다. Host는 loopback 주소 또는 실제 허용 LAN IP와 port62330의 정확한 값만 허용한다. Origin 없는 native 요청 또는 명시한 개발 웹 origin만 허용하며 wildcard/null origin·credential CORS·수신 cookie/Bearer 전달은 금지한다. 필요 시 OPTIONS는 고정 로컬 CORS 응답만 하고 upstream으로 전달하지 않는다. LAN은 명시 실행 플래그와 현재 인터페이스/서브넷 확인 후에만 활성화하고 최대2시간 뒤 자동 종료하며, 종료 신호도 listener를 닫는다. 이 제한은 일반 proxy나 외부 수집 서버로 확장할 근거가 아니다.

앱에는 공개 read base URL만 넣는다. secret·JWT·service key는 EXPO_PUBLIC 환경이나 app config에 넣지 않는다. native0004가 HTTP 개발 API를 허용하는지는 실제 기기에서 확인한다. ATS/cleartext 문제를 몰래 완화하지 않고 필요한 native 변경이 있으면 별도 지문/build/기기 확인 게이트로 분리한다. 운영 HTTPS API와 클라우드 hosting은 이번 생성 범위가 아니다.

## P02b/P03b와 시험 증거

| 항목 | 이번 증거 | 미완료를 성공으로 세지 않는 조건 |
| --- | --- | --- |
| Auth/관리자 권한 | 실제 local Auth 로그인·만료/취소·일반 계정·CSRF 및 SQL 권한 거절 | 단순 서명 fixture JWT만으로 관리자 로그인 완료라고 하지 않음 |
| 게시/수정/숨김 | 실제 editor API→DB 판본/CAS/outbox→공개 read; 멱등/경합/비활성 섹터·수동 보호·alias 회귀 | UI만 만들고 DB/API 미연결, NULL/오래된 revision으로 덮어쓰기 금지 |
| P02b 5단계 부분 | 수동 게시/숨김의 실제 outbox와 local worker 효과·영수증, 두 번 처리/재시작 회귀 | M0 수동 enqueue 성공만 재사용하거나 운영 검색/푸시 성공이라고 하지 않음 |
| P03b 5단계 부분 | 같은 입력·server visible_sections를 관리자 미리보기와 Android/iOS 상세에서 대조 | 웹/JS export나 기존 iPhone 홈 확인을 새 native 흐름 관측으로 대체하지 않음 |
| 공개 경계 | anonymous 목록/상세만, draft·숨김·private stats/credentials 없음, gateway route/role/URL 공격 거절 | read gateway를 일반 Supabase/HTTP proxy로 쓰지 않음 |
| UI 흐름 | 로딩·빈 결과·오류/재시도·긴 제목·상태 변경 후 재조회; 실제 목록의 중복 Issue 없음 | 오류 때 이전 샘플/본문을 정상 live 데이터처럼 대체하지 않음 |

S4I-05에 따라 새 공개 RPC와 extension의 필요한 GRANT는 명시하고 실제 앱/관리자 역할의 허용·거절 회귀를 둔다. 전역 함수 default deny를 우회하거나 공개 권한을 광범위하게 복원하지 않는다. S4I-04의 local fixture RPC·seed 비로컬 분리는 첫 preview/production DB 생성·적용 전 필수로 유지한다.

r1 검수 보완 추적: S5P-C01은 R07의 긍정 경로 없는 연관·조건부 부정 및 동일 경로 중복 방지, S5P-C02는 R08의 기간·취소 상태와 동일 DTO 회귀에 반영했다. S5P-01은 예약6단계 이관/U05 PENDING·5단계 예약 입력 거절, S5P-02는 실제 Auth session 결속과 구형 M0 RPC 공통 권한 강화, S5P-03은 공개 gateway의 크기·빈도·동시성·Host/Origin·수명 제한으로 구체화했다. 이 절은 구현 성공 증거가 아니며 r2 재검수 대상이다.

기존26개 DB/worker 시험과18개 계약,24개 domain/native,20개 provider를 적절한 현재 단계 진입점으로 유지하고 새 의미 회귀를 추가한다.0~4의 역사 분기는 보존하고5 전용 source/Git·권위사본14·자원·상태 검사를 둔다.0~2/4는 완료 증거,3은 공급대기,5는 현재 상태,6~12는 대기로 구분한다. 기본조건을 맞추려고3을 COMPLETE로 바꾸지 않는다.

## 실행·종결 순서

1. 이 계획 MD/HTML, 승인 계약의5단계·4단계 증거·새 모델 계획을 Claude 브라우저와 독립 Codex Ultra로 검수한다.
2. 승인 뒤 새 feature branch·14번째 사본·local migration/Auth fixture·서버/앱을 구현한다. 자원 지문·기존 credentials 범위·새 listener 상태를 확인한다.
3. 실제 DB/API/Auth/worker·화면·양쪽 native 관측과 전체 verify·독립 source checkout을 검사한다. 자격 증명은 증거에 넣지 않는다.
4. 누락된 기기/공급/운영 항목은 PENDING으로 남긴 상태를 포함해 구현 DUAL 검수한다. 현재 필수 범위가 통과한 동일 바이트만 commit/main ff-only 한다. 원격 push는 하지 않는다.
5. P03b의 실제 기기 증거가 없으면5단계 전체 완료를 선언하지 않는다. 필수 선행과 독립 가능한 작업을 분리해 계속 진행하되6단계 전체 M1 통과를 앞당겨 주장하지 않는다.

계약·비용·새 권한·로그인 조치가 필요한 항목은 구체적 결과를 준비하고 해당 경로만 대기한다. 사용자 부재를 승인으로 간주하지 않는다. 실제 공급·자동 수집/분석/게시·시장 순위·통계·저장·푸시/광고·출시는 각각6~12단계의 해당 게이트를 따른다.

이 수동 흐름은 자동 서비스 전에 계약·노출·정정을 확인하는 M1이다. 운영 출시 후 모든 기사에 사람 승인을 요구하는 설계로 바꾸는 것이 아니다.

## 공식 자료 확인과 실제 시험 구분

[Supabase Auth API](https://github.com/supabase/auth/blob/master/README.md)의 password/refresh token·GET user·logout 계약과 [getUser](https://supabase.com/docs/reference/javascript/auth-getuser)의 Auth 서버 조회 설명을 확인했다. 여기서 logout 후 access JWT의 자체 만료와 서버 세션 폐기를 구분했다. 설치된 local GoTrue 버전의 실제 로그인/role/세션 동작은 구현 후 직접 검사하며, 문서 확인을 그 성공 증거로 세지 않는다.

[Next cookies](https://nextjs.org/docs/app/api-reference/functions/cookies)의 async cookie 조회와 Server Function/Route Handler 변경 경계를 확인했다. [Expo 환경변수](https://docs.expo.dev/guides/environment-variables/)는 EXPO_PUBLIC 값이 클라이언트 코드에 포함됨을 설명한다. 이 계획에서는 공개 read base URL만 앱에 넣고 자격 증명은 서버에 둔다. 공식 기능 안내가 새 native의 HTTP 연결이나 본 프로젝트 인증 성공을 증명하지는 않는다.
