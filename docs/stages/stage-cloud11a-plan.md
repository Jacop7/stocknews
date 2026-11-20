# CLOUD11A 관리자와 개발 DB 연결 계획

2026-11-16 · r2 계획 검수 대상. 제품 구현·신규 원격 요청·관리자 계정 생성·권한 부여는 아직0이다.

## 기준과 이번 결과의 범위

출발점은 stocknews 단일 저장소 main99a83e6,423파일, 주도주뉴스 전용 dev nxfpfvsdwbziowkxsxnh/조직 qfzgicohgpuogehdyzfx다. prod zkzevpinuixeuyjlffwi와 다른 제품은 범위 밖이다. CLOUD10H 실제 결과는 manifest736baa0e…에 두 역할READY이며, 개발 웹 공개조회와11상위/56하위·기업 검색·설명·섹터 상세가 연결됐다. private config와62331/62332 미리보기는 존재하지만 관리자·worker는 미연결이다. H의 상태는 전체 서비스 완료가 아니다.

관리자는 사용자 앱과 분리한다. 소비자 앱에 회원가입이나 로그인은 추가하지 않는다. 사용자는 이번에 관리자 로그인용 이메일을 선택했다. 검수 자료에는 실제 이메일·사용자ID·비밀번호를 넣지 않고 선택 근거 참조만 남긴다. 이메일 선택은 새 SQL/source 해시 승인이나 privileged key 조회 승인으로 확대하지 않는다. 비밀번호는 사용자가 신뢰하는 계정 생성 화면에서 직접 설정하며 채팅·코드·CLI 인수·로그·fixture에 넣지 않는다.

이번 계획은 관리자 연결 전체 순서를 정한다. 계획READY 후에만 구현 준비를 시작하고, 새 구현·SQL·자체 시험은 다시 두 역할 검수한다. 실제 credential·Auth 계정·메타데이터·membership·EXECUTE 변경은 구체적인 적용물과 실패 대책이 검수된 뒤의 별도 실행 단계다. 이전8aad… 결정의 공개 읽기3동작을 관리자 권한 확대에 재사용하지 않는다. 단순 계획 검수·이메일 선택만으로 적용하지 않는다.

## 확인된 차이

1. apps/admin/lib/runtime.mjs는 local DB62321와 관리자3100, non-null bootstrap을 고정한다. 그대로 URL만 바꾸면 거부된다.
2. 서버 요청은 기존 local service JWT를 Bearer로 보내도록 작성돼 있다. preview는 새 publishable/secret 키의 헤더 규약을 분리해야 한다.
3. root local migrations의 초기화·catalog 선택·게시 정의와 실제 cloud archive를 구분한다. cloud05a assert_initialized와 cloud06a catalog_sector_selectable은 이미 정확한 dev/preview/null 신원을 검사하며 H 실제 metadata의 정의 SHA와 일치한다. r1은 root local 정의를 현재 cloud 제약처럼 적어 혼동을 만들었다. 현재 cloud guard를 재작성하거나 local로 위장하지 않는다. B에서 현행 cloud 정의와 전체 호출 경로를 기준으로 필요한 변경만 확정한다.
4. cloud에 적용된 M1·catalog 함수는 보관·검증된 상태지만 관리자용 실행 권한은 닫혀 있다. scope-audit.json의 현재 스냅샷에서21 authenticated 함수와3 service_role 세션 함수 모두 해당 역할EXECUTE가 없다. 이 스냅샷은 과거09:05 관측이며 실제 활성화 전 새 읽기 검사가 필요하다.
5. 일부 예약·통계 경로는Host3100를 직접 검사한다. preview에서 포트만 바꾸고 보호를 생략하지 않는다. 아직 연결하지 않은 기능을 작동하는 메뉴처럼 표시하지 않는다.
6. 기존 제품 검증기는 CLOUD10B의 branch·파일·Git 이력을 동결한다. 새 기능 브랜치를 추가하면 기존 판정 대상이 달라진다. 새 단계의 기준선 이관과 검증을 먼저 준비하며 기존 검증기를 편집해 억지로 통과시키지 않는다.

## 진행 순서와 완료 기준

| 순서 | 작업 | 실제 적용 여부와 완료 기준 |
|---|---|---|
| A | 이 계획·기존 코드·권한 목록 검수 | 정적 자료만 검수. 원격 요청·키 조회·DB/Auth 변경0 |
| B | 전용 preview 관리자 transport/config/session/UI와 guarded SQL 준비·격리 시험 | 계정·실키 없이 mock/제품 전용 격리 DB에서 시험. 전체 제품 검사와 새 경계 검사 후 구현DUAL |
| C | 실제 계정 준비·dev 권한·비공개 설정·관리자 미리보기 연결 | 구체적인 현재 SQL/권한/credential 범위에 대한 실행 결정 및 사용자 비밀번호 설정 이후. 새 사전 읽기·한 번의 적용·사후 검사·실제결과DUAL |
| D | 섹터·기업·키워드·기사 실제 CRUD와 앱 연동 | SYNTHETIC 검증 글·소유 테스트 항목만 사용. 저장·새로고침·수정·미리보기·게시·숨김·중복요청·경합·권한 거부를 확인. 원본 항목 파괴 없음 |
| E | 관리자 통계·홈 순위 관리 연결 | 공개 숫자 노출 없음. 앱 조회수 수집과 관리자 집계·순위 변경은 별도 범위·권한/시험으로 연결. 현재 placeholder를 완료로 보고하지 않음 |

수집 상태/실제 사이트·텔레그램, AI 작성, live 시장자료·순위, 예약·유지관리, 알림·광고와 cloud worker는 뒤 단계다. 관리자 메뉴·출처의 현재 준비 상태를 명확히 표시한다. 이 계획 하나로 후속 쓰기 권한 전체나 REAL 게시를 허용하지 않는다. M2=false/rights112/iPhone USER_DEFERRED를 유지한다.

## B: 제품 기준선과 Git

계획DUAL 뒤 feat/cloud11a-preview-admin-bridge 짧은 브랜치에서 작업한다. main/origin/main99a83e6와 이전 기능 refs는 보존한다. .git 공유·다른 제품 코드·DB·인증·키·Docker를 가져오지 않는다. 변경 전423파일과 Git blob/작업 트리 바이트를 source-pins로 고정한다.

새 verify-cloud11a-foundation을 만들고 verify.mjs와 verify-foundation의 단계 선택만 이관한다. 이전 CLOUD10B 검증기는 바이트 그대로 보관한다. 새 검증은 독립 repository/remote/ancestry/기준 commit99·기존 refs/비밀 제외와 과거 source blob 보존, 새 단계의 정확한 변경 허용 목록·새 파일 목록·branch/commit 이력 조건을 확인한다. 이전 검증기가 새 변경 트리에 통과했다고 주장하지 않는다. 새 단계의 검사 계약과 허용 delta는 구현 검수에 전부 제출한다.

기존 제품의25개 검사 묶음과 assertion은 유지하며, preview-admin 검사와 격리 DB/runtime 검사를 추가한다. old import/build가 실제 key를 읽지 않는 조건과 old local 실행 결과도 보존한다. 실패를 허용·삭제하거나 old source hash를 현재 값으로 덮어씌우는 방식은 금지한다. corepack은 기존 제품 전용 COREPACK_HOME을 쓴다. 실제 내용이 바뀐 제품 코드는 검수·백업 후 commit/push하고 결과 문서 때문에 검수된 제품 바이트를 다시 바꾸지 않는다.

H의 완료 영수증은 과거99 기준 증거로 보존한다. 새 단계에서 의도적으로 바뀐 제품 파일을 H의 옛423 현재-파일 해시와 계속 비교해 새 기능을 막지 않는다. 대신99의 Git blob/동결 archive와 새 검수 delta를 결속한다. H의 중지 경로는 이미 최소 소유권 검사를 사용하므로 제품 drift가 정지를 막지 않는다. 현재 H 미리보기와8084~8086·3100·기존 local DB는 임의 종료하지 않는다.

## B: 관리자 transport와 세션

새 관리자는127.0.0.1:62333에만 바인딩한다. 포트 점유면HOLD이며 다른 프로세스를 종료하지 않는다. 소비자 미리보기62331/62332와 쿠키 이름도 분리한다. 초기 대상은 dev의 preview/SYNTHETIC/bootstrap null이고, prod·임의 URL·환경변수의 endpoint override는 거부한다.

설정은 .local-data/cloud-admin/의 전용 ignored 파일만 사용한다. 서버 publishable·secret·세션 암호화 키가 포함된 파일은 서버만 읽는다. 키의 실제 값·키ID·길이·prefix·파생 hash를 도구 출력·Git·검수·ZIP·브라우저·NEXT_PUBLIC·환경변수·명령인자로 내보내지 않는다. proof-first/exclusive/fsync·고정 경로·reparse 방지·부분 저장HOLD 원칙을 유지한다. 암호화 키는 새 주도주뉴스 관리자 전용으로 생성한다. 비밀번호와 refresh/access token은 설정 파일에 저장하지 않는다. 과거 private config나 이전 앱의 값을 가져오지 않는다. 세션 capability의 해시는 기존 인증 계약에 필요한 별도 값이며 키값 해시와 혼동하지 않는다.

키의 실제 소비 방식은 고정한다. 서버 세션 RPC3개만 secret apikey로 요청하고 secret을 Bearer에 넣지 않는다. 인증된 편집 RPC21개는 publishable apikey와 검증된 사용자 access JWT Bearer로 호출한다. local 프로필은 기존 local 주소/키 경로와 검사 그대로 유지하며 preview 실패 시 local·legacy JWT·service_role JWT로 fallback하지 않는다. 새 preview transport의 이름·method·route·payload·응답 상한·timeout·redirect 금지·결과 불확실 처리와 유효 RPC 목록을 코드로 고정한다. 임의 RPC proxy는 만들지 않는다.

로그인은 Auth token 응답만 신뢰하지 않고 /auth/v1/user의 실제 검증 결과, app_metadata.app_role=admin, user/session 일치 및 DB의 active membership·비활성/삭제/ban 상태를 확인한다. JWT decode는 이미 검증된 응답의 세션ID 대조에만 쓴다. 암호화된 토큰을 private.admin_sessions에 저장하고 브라우저에는 무작위 capability HttpOnly/SameSite=Strict 쿠키와 CSRF만 준다. preview용 쿠키 이름을 local과 분리한다. loopback HTTP에서만 Secure=false이며 운영 HTTPS 쿠키 설정은 후속 과제다. JWT·refresh token은 localStorage·sessionStorage·프론트 응답에 내보내지 않는다. 현재 세션 만료를 넘겨 자동 갱신하지 않으며 재로그인한다. 로그아웃은 SQL capability 무효화가 먼저다.

모든 관리자 GET/POST는 현재 프로필의 정확한 Host를 검사하고 쓰기는 Origin·Content-Type·CSRF를 읽기/변경 전에 검사한다. 로그인도 크기·시간·요청률 상한과 열거를 피하는 오류를 둔다. 신뢰하지 않는 X-Forwarded-For로 제한을 우회하지 않는다. build/import는 실제 설정·키를 읽지 않는다. 프론트는 비밀 없는 profile 표지만 받아 '개발 DB·합성 검증'을 보여 주며 소비자 로그인은 만들지 않는다.

첫 연결의 활성 RPC는 scope-audit.json의21 editor +3 server session뿐이다. 서버의m0_runtime_identity 대신 기존 읽기 m1_public_identity로 preview/SYNTHETIC/M1 신원을 먼저 확인한다. 예약·maintenance·설치정보 쓰기·통계·홈 순위 쓰기·수집/worker 경로는 preview에서 서버와 UI 양쪽 모두 아직 비활성이다. 특히 기사 화면의 ReservationManager가 자동 호출되지 않게 한다. 로컬의 기존 기능은 유지한다.

## B: dev SQL 준비

root local migrations와 과거 cloud archive는 수정하지 않는다. 신규 SQL은 supabase/cloud/admin-preview-dev/의 별도 준비물로 두며 root migration/자동 배포 stream에 넣지 않는다. 기존8 native history와 source SHA를 바꾸지 않는다.

먼저 실제 cloud 함수 의존 관계를 정확히 추린다. public 편집21/세션3에서 도달하는 초기화·catalog 선택·게시 함수는 root local 원본 대신 최신 적용 archive와 H metadata 정의 SHA를 기준으로 조사한다. 이미 dev 전용인 assert_initialized·catalog_sector_selectable은 보존하고, root local 표현을 이유로 preview 분기를 중복 추가하지 않는다. scope-audit.cloudDefinitionClarification은 현행 네 함수의 archive/H metadata SHA 대조를 담는다. 실제로 변경이 필요한 정의만 원본 SHA/시그니처와 이유를 명세한다. 실제 dev 최신 정의·owner·search_path·security definer·ACL이 그 원본과 다르면HOLD한다. 정규식 검색만으로 전이 의존을 전부 증명했다고 쓰지 않는다. 격리 preview DB에서 실제 호출 경로를 검증한다. 이 조사에서 미확정 dependency가 남으면 활성 SQL을 완성했다고 보고하지 않는다.

새 private admin-preview 활성 제어는 기본 비활성·RLS·명시적 revoke로 생성하고 정확한 product/org/dev ref·preview/null 신원·이번 migration 이력/승인 범위·선택 관리자와 결속한다. 선택 관리자와 활성 제어를 강제하기 위해 꼭 필요한 별도 관리자 guard만 추가·결속한다. 이미 dev 신원과 SYNTHETIC을 검증하는 기존 초기화/선택/게시 guard는 보존한다. root local migration과 local 조건은 그대로 둔다. 공유 helper 변경으로 기존 공개 읽기9개를 막거나 다른 RPC를 열지 않는지도 시험한다. global runtime identity를local로 바꾸거나 fake bootstrap을 만들지 않는다. preview 분기는 SYNTHETIC·한국주식 분석·현재 catalog approval·기존 정책 검증을 통과해야 한다. REAL/외부 효과/worker/cron는 열지 않는다. helper의 호출 범위 변화와 도달 가능한 다른 함수도 검수·시험한다.

특권을 줄이는 단위는 정확한 함수 시그니처다. authenticated에21개, service_role에 세션3개만 EXECUTE한다. anon 읽기9개와 기존 managed event_trigger helper 예외는 그대로이며 anon 쓰기·테이블 GRANT·private schema 노출·기타 함수권한은0이다. 인증 사용자라도 app_role만 위조하거나 inactive membership/유효 capability가 없으면 쓰기 거부다. 앱·관리자 인증과 관계없이 전역 service key가 RLS를 우회한다는 성질을 숨기지 않으며, 앱 데이터의 기존 권한 revoke와 고정 서버 RPC로 범위를 좁힌다.

실제 적용 준비물에는 transaction/lock·timeout·정확한 전상태 해시·expected delta·단일 효과키·새 native 이력1행·사후 inventory·사용자1인 membership·실패 시 중지/차단안을 포함한다. 세부 함수 정의와 SQL 해시는B 구현 검수의 고정 결과여야 한다. '향후 알아서 추가' GRANT는 허용하지 않는다. 신규 private table·함수 생성 뒤에는 automaticallyExposeNewTables ON 상태를 고려해 schema/관계/함수 ACL 전체를 재검사한다. 설정 OFF 변경은 이번 기본 범위에 끼워 넣지 않는다.

## B 자체 검증

실제 키·개인 이메일 없이 mock/temp와 새 주도주뉴스 전용 격리 DB만 쓴다. 기존 local Auth fixture를 실제dev로 보내지 않는다. 새 격리 자원의 이름·경로·포트·DB 신원을 확인하고 자기 생성 자원만 정리한다. 다른 앱의 DB·Docker·인증을 읽거나 재사용하지 않는다.

검사 행렬: local 기존동작/preview 신원·키 헤더 분리/legacy·prod·타 endpoint·임의 RPC 거부/초기화와 함수권한 전상태 drift/HOLD/미인증·일반사용자·role만있는 사용자·inactive membership·삭제·ban·expired session 거부/CSRF·Host·Origin·body·rate 제한/쿠키와응답에token없음/원격 에러·timeout 불확실에서 동일효과키로 상태 확인/로그아웃·revocation/키 부분파일·reparse 거부/단일 활성화·SQL201 응답/사후 ACL 예상 목록/예약·worker·REAL 계속닫힘을 포함한다. 기사와 catalog는 실제 격리SQL로 생성→저장→수정→미리보기→게시→숨김 및중복·충돌·버전경합을 검사한다. 테스트 통과와 실제 hosted 실행은 구분한다.

## C 실제 연결의 전제와 순서

1. B 구현DUAL·최신 전상태 읽기·복구 준비·정확 SQL/권한 목록이 완성된 뒤 관리자 권한/secret 소비/선택 사용자 mapping/서버 실행의 구체적 실행 결정을 받는다. 원공개조회 승인이나 이메일 답변을 대신 쓰지 않는다. 새 결정의 시간·대상·회수/효과 한도를 보존한다.
2. 사용자가 Supabase의 해당 dev 사용자 생성 화면에서 선택 이메일과 새 비밀번호를 직접 설정·제출한다. 제가 대신 새 비밀번호를 정하거나 입력하지 않는다. 회원가입을 전역으로 켜지 않는다. 이미 같은 이메일 계정이 있으면 자동 승격·덮어쓰기 없이 현황과 소유권을 확인한다.
3. 새 권위 아래 전용 관리자 키 조회는 필요한 기존 publishable1/secret1만 선별하고 미선택·legacy 참조는 버린다. 허용된 고정 API 횟수와 키 반환 방식은B의 별도 준비/시험/검수 대상이다. 기존secret이 없거나 복수·형식 불일치면HOLD하고 임의 생성/회전·fallback하지 않는다. 설정은 exclusive로 저장하고 값은 출력하지 않는다.
4. 선택 계정의 product/관리자 metadata와 active membership, exact24 EXECUTE·preview guard·새 이력을 한정 적용한다. Auth 관리 호출과 SQL은 단일 transaction이 아니므로 단계별 intent와 결과를 기록하고 불확실 전송을 재시도하지 않는다. 실패 시 사용자별 membership/role 비활성·해당 관리자 RPC revoke·새 관리자 프로세스 정지로 우선 차단한다. 전역 Data API를 꺼서 기존 공개조회까지 중단시키는 동작은 별도의 구체적 결정/긴급 노출 차단 범위에만 둔다. '정확 원복'이라고 부르지 않는다.
5. 사후 ACL과 상태를 확인한 뒤 관리자62333을 소유 프로세스로 시작한다. secret은 server-only로 보관하며 브라우저 로그인 비밀번호는 사용자가 직접 입력한다. 앱의H 미리보기와 구분해 실제 login→DB read→개별 쓰기→앱 결과의 순서를 확인한다. 관리자 연결 실패로 무단권한 확대나 권위 갱신을 하지 않는다.

비밀번호 입력이나 실권한 확정이 기다려져도 B의 준비·시험·검수는 계속할 수 있다. 사용자에게는 검수된 정확한 화면/적용물을 보여 주고 마지막 단계만 요청한다.

## D 실제 쓰기와 수명·미완료 항목

새 SYNTHETIC 검증 글과 명확한 접두사의 소유 테스트 항목만 만든다. 원본339기업/364membership/11상위/56하위의 항목을 검증 목적으로 삭제하지 않는다. 소유 test 항목을 비활성 처리해 초기 표시 내용을 복구하며 audit/operation journal과 catalog version 증가가 남을 수 있음을 기록한다. 비활성·숨김은 정확 DB rollback과 다르다. 불확실 변경은 기존 같은 effect/operation key와 동일 payload로 상태 확인한다. 임의 새키·중복 게시를 만들지 않는다.

실제 게시도SYNTHETIC임을 앱/어드민에서 표시하고 검증 뒤 숨김한다. 읽기 화면이 비어 있음과 운영 게시가 완성됨은 다른 판정이다. 공개 페이지와출처 유사성/권리 검증은 실제뉴스 단계의 전제다. 가격·등락률·시장순위·일정 데이터 미연결 상태를 유지한다.

새 supervisor는 자기 프로세스/포트만 소유하고 UUID·PID·생성 시각·중지 증거를 남긴다. 가능하면 Windows kill-on-close Job Object를 시험해 고아 프로세스를 방지한다. 그렇지 못하면 한계를명시하고 최소 stop과수동 소유권 복구를 유지한다. 만료/정지 후 실제 종료는 별도 읽기 관측한다. H의 CL10HR-01·HP01·GR01과 기타 역할별 P3는 새 연결 성공만으로 닫지 않는다. 공개 Data API와 비공개 설정의 보존·회수는 구체적 권위에 따른다.

완료 보고는 메뉴별로 한다. A/B 준비와 C login/read, D CRUD/게시, E 통계/순위, 실제worker운영을 섞지 않는다. Android/iOS 실제 기기·스토어 출시는 별도다.


## r2 검수 보완과 구현 의무

r1의 두 READY 원문은 그대로 보존한다. 작성자 추가 조사 A11A-01은 local 원본과 실제 cloud 정의의 혼동을 정정하며, 검수자가 잘못된 local 설명을 반복한 원문도 고치지 않는다. 실제 archive 마지막 expected_functions의 전체177개 정의 SHA가 H snapshot과 맞는지 B에서 대조하고, 전이 호출 조사와 격리 실행을 별도로 수행한다. 현행 네 guard 대조만으로 전체 의존 검증 완료를 주장하지 않는다. 기존 검수 criteria의 local 제약 언급은 root 원본에 대한 비교 대상으로 읽으며 현행 cloud를 뜻하지 않는다.

- CL11AP-01: B의 구체적 설정 규약과 C 실행 결정에는 secret 파일의 보존 기간·만료 시 사용 중지·실패 시 격리 보존 또는 삭제 결정을 고정한다. 자동 키 생성·회전은 금지한다. 노출 의심 시 새 관리자 프로세스와 RPC를 먼저 차단하고 사용자가 dev 공식 대시보드에서 해당 키를 직접 회전하도록 인계한다. 기존 공개 읽기 키와 프로세스는 임의 변경하지 않는다. B mock은 헤더 구성과 예상 role 검사를 증명할 뿐 Supabase hosted gateway의 매핑을 증명하지 않는다. C에서는 권한 적용 뒤 첫 서버 요청을 무작위 capability hash의 m1_read_admin_session(null 예상) 한 번으로 고정해 secret apikey의 service_role 매핑을 확인하고, 불일치·오류·불확실이면 세션 생성·편집을 시작하지 않는다. 이 읽기 역시 새 결정의 요청 예산에 포함한다.
- CL11AP-02: B 격리 DB에서 편집21개 각각을 일반 사용자·metadata만 admin·inactive membership·삭제/ban·만료 Auth/app session으로 실제 호출해 권한 거부를 확인한다. 사후 ACL은 편집21개에 anon/service_role EXECUTE0, 세션3개에 anon/authenticated EXECUTE0을 확인한다. 기존 assert_editor의 service_role 우회 성질 때문에 이 ACL이 필수다. 게시·catalog 함수의 SYNTHETIC 경계와 소유 검증 항목을 실제 시험한다. D 실제 검증은 전용 접두사/기록한 UUID의 테스트 항목만 바꾸며 원본 항목은 읽기·무변경 비교만 한다. 관리자 제품 기능의 실제 편집 권한을 테스트 항목에만 영구 제한한다고 주장하지 않는다.
- CL11AP-03: C 공식 dev 생성 화면에서 사용자가 새 비밀번호와 auto confirm 여부를 직접 처리한다. 현재 email confirmation ON을 끄지 않으며 사용자 확인 완료 전 password 로그인을 반복하지 않는다. app_metadata.app_role 변경은 서버 전용 Auth admin endpoint의 정확한 method·필드·횟수·전후 확인을 B 준비물로 고정하며 user_metadata는 권위로 쓰지 않는다. 이미 같은 이메일의 계정이 있으면 자동 승격하지 않는다. access/refresh token은 private.admin_sessions ciphertext에만 암호화 저장되고 유효기간은 JWT와8시간 중 짧은 쪽이다. 자동 refresh는 하지 않는다. 로그아웃은 capability revoked_at부터 설정하며 행/ciphertext가 즉시 삭제되는 것은 아니다. 만료·폐기된 암호문 보관·삭제는 별도 한정 유지관리 절차가 준비되기 전 임의 삭제하지 않는다. MFA 설정·운영 HTTPS·공용 인터넷 관리자 공개는 이번 범위 밖이다.

이 보완은 아직 구현·실행되지 않은 의무이며 P3를 작성자가 종결하지 않는다. 새 SQL/credential/원격 요청 권위를 추가하지 않는다.

## 공식 참고

- [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys): publishable+사용자JWT와 서버 secret 역할을 구분하며 새 키는 apikey 헤더로 보낸다. secret은 RLS를 우회하므로 서버에만 둔다.
- [새 API 키 전환](https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys): 기존 JWT 규약을 새 secret의 Bearer 규약으로 재사용하지 않는다.
- [Auth createUser](https://supabase.com/docs/reference/javascript/auth-admin-createuser): 관리자 사용자 생성은 서버 전용 기능이다. 이번 실제 사용자 비밀번호 설정은 사용자가 직접 한다.
- [Auth getUser](https://supabase.com/docs/reference/javascript/auth-getuser): 사용자 신원은 Auth 서버의 실제 응답으로 확인한다. JWT decode만으로 권한을 인정하지 않는다.

공식 문서 확인일2026-11-16. 참고 문서는 앱 계정 생성이나 권한 부여 승인이 아니다.
