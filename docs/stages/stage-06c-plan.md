# 6C 뉴스·종목 검색과 기기 저장 실행계획 r2

2026-11-15. PLAN_REVIEW_PENDING. 계획 DUAL 전에는 제품 구현·dependency 설치·DB migration을 하지 않는다. 사용자 지시에 따라 iPhone 실물 검증은 보류하고 브라우저 프론트 검증을 계속한다. 저장소는 주도주뉴스 전용 신규 제품이며 다른 제품의 코드·DB·자격증명·worker를 가져오지 않는다.

## 선행 결과와 이번 범위

6B local 카탈로그·어드민·필터는 DUAL manifest `72656cf764774558f8ef86c49d201a01e93c1b0c4c782ce55464b997a6104f33`, main commit `73ab52121d6afac6e51a6f26bb181b5bf03f40b3`이다. 제품240파일의 검수/current/index/commit 바이트가 같고 local·독립 clone/frozen·커밋 후 pnpm verify 각13 PASS, SQL/Auth/HTTP/worker105 및 browser10 검사가 통과했다. 원격 push0, 실제 뉴스·AI·시세·광고·push0다. 상위11·섹터56·기업339·묶음81·문맥 연결364, stock identity339 UNRESOLVED와 구조 HOLD2건을 유지한다. 원본 시트 쓰기와 임의 종목코드 생성은 없다.

이번은 검색 UI·공개 검색 RPC·기기별 기사 저장이다. 서버 설치 소유권/조회 집계/알림 설정6D, 예약6E, 가격/홈 순위7, 수집봇8, AI shadow9는 별도다. 저장은 로그인·서버 동기화 없이 기기에 Issue ID와 최초 저장시각만 보관한다. consumer Auth나 설치 secret을 미리 만들지 않는다. 한국 source-company 참조 검색을 제공하되 실제 상장 identity 확인으로 표현하지 않는다.

권위는 저장소의 서비스 기획안 v1.6 검색·저장 절과 공통 운영계약9절/U09, 현재6B SQL/DTO다. 6B의 남은 P3 중 draft-only 정정 차단과 issue별 상태 이력, 반복 UNKNOWN 해소 절차는 6D/6E·운영 소유로 유지한다. 검색·저장 조회가 공개 자격을 우회하지 않도록 한다.

## 화면 흐름

검색 아이콘 → 같은 앱 색의 검색 헤더. 왼쪽 검색 표시, 입력창, 입력 지우기, 오른쪽 취소로 구성하며 기존 로고 헤더와 중복하지 않는다. 취소는 이전 화면으로 돌아가고 검색 요청을 취소한다. 뉴스/종목 두 탭은 현재 기간 선택의 둥근 보라색 선택 탭과 같은 스타일이다. 키보드 제출 및 짧은 debounce를 지원하고 이전 질의·탭의 늦은 응답으로 새 결과를 덮지 않는다. 빈 질의는 검색 안내이며 전체 목록 요청으로 바꾸지 않는다. loading/0건/오류/재시도와 끝 페이지를 구분한다.

뉴스 결과는 현재 공개 Issue 제목·요약·최초 게시시각과 대표 분류, 저장 버튼을 보여주고 기존 상세로 연결한다. 같은 Story의 다른 방향 Issue는 검색에서 각각 제공할 수 있지만 alias와 같은 Issue는 한 번만 나온다. 검색은 최초 게시일 DESC·Issue ID ASC이며 홈 혼합/등락률/조회수 순위와 분리한다. 검색에는 날짜 탭을 새로 강제하지 않고 전체 공개 기사 범위를 쓴다.

종목 결과는 같은 source_company_ref를 한 번만 보여준다. 기업명 아래 최신 E열 검색 시 설명글의 문구·순서·줄바꿈을 그대로 표시한다. D열 직접 적용 검색어는 매칭용, E는 표시용, F 산업 검색어는 보조 문맥이며 E를 D의 괄호에서 다시 만들지 않는다. 현재 기업명과 D 검색어를 검색하고 등록되지 않은 별칭/코드를 생성하지 않는다. 검증된 코드·별칭 연결은7단계까지 미확보다. 현재 활성 membership이 있는 한국 source-company만 제공한다. 관련 현재 섹터를 최대3개 표시하고, 더 있는 경우 별도 선택 목록에서 페이지로 읽어 기존 섹터체크/관련 종목으로 이동한다. 기업 자체 상세 페이지는 새로 만들지 않는다. 시세·코드·네이버증권 링크는 확인 전 null로 둔다.

홈·이슈체크 카드와 기사 상세 우측에 동일한 작은 저장/해제 버튼을 둔다. 카드 상세 이동과 저장 버튼의 클릭 영역을 분리한다. 하단 네 번째 저장 탭은 최근 저장 순이며 오른쪽 위 알림·설정은 기존 동일 크기 아이콘을 유지한다. 저장 화면의 비공개 글도 일반 안내 항목과 해제 버튼은 남기고 본문·옛 제목·요약을 캐시로 되살리지 않는다.

## 검색 데이터와 RPC

기존1~38 migration과 v1/v2 카탈로그·목록·상세 계약은 바꾸지 않고 신규39 이후로 추가한다. 신규 공개 읽기 RPC는 local fingerprint·SYNTHETIC 기사 전용과 현재 승인 reference head를 검사한다. public news는 현재 canonical Issue·게시 버전·m1_current_evidence를 매 페이지 확인하며 DRAFT/숨김/철회/정정 대기/근거 만료/비활성 분류를 제외한다. 원본 기사·source_revision·private 키워드 배열·조회 통계는 응답하지 않는다.

뉴스 검색 대상은 현재 공개 버전의 제목·요약·핵심 이슈·이슈 분석과 그 글에 실제 연결된 활성 섹터의 검색 키워드다. 전체 카탈로그 키워드를 모든 글에 일괄 붙이지 않는다. 실제 article impact/대표 섹터 연결이 없는 기업·섹터는 검색 재료가 아니다. 현재 글에 관련된 검색어가 새로 바뀌면 다음 질의에 반영되며 불변 본문 자체를 수정하지 않는다. 검색 후보도 현재 공개 가드를 반드시 통과한다.

기업 검색은 기업명과 최신 직접 검색어(D)를 사용한다. NFC·대소문자·연속 공백을 정규화하고 최대80자·6개 토큰으로 제한한다. 토큰은 AND, 각 토큰은 해당 기업의 이름 또는 D 중 하나에서 맞아야 한다. 정확 기업명 → 정확 D 검색어 → 부분 기업명 → 부분 D 검색어의 고정 bucket, 같은 bucket은 정규화 기업명(C collation)·source ref 순으로 정렬한다. B 역할·다른 기업의 검색어·상위 카테고리 전체 키워드로 모든 기업을 매칭하지 않는다. 공통 키워드가 여러 기업 D에 실제 있으면 모두 제공한다. 비활성 회사/상위/섹터/연결은 제외한다. sector 선택 목록도 활성 문맥만 제공한다.

게이트웨이에 `/v2/search/news`, `/v2/search/companies`, 기업 관련 섹터 페이지, 저장 resolver batch의 제한된 읽기 경로만 추가한다. 기존 Host/Origin·무자격 공용 읽기·loopback 기본·rate/concurrency·256KB·timeout 경계를 유지한다. 임의 RPC proxy, 쓰기 endpoint, URL 안의 credential은 없다. 질의 문자열은 server 로그에 남기지 않고 외부 검색 서비스/뉴스 사이트로 전달하지 않는다.

질의/탭/정규 섹터 집합/현재 catalog version/limit와 cursor 문맥을 결속한다. 뉴스 cursor는 고정 as_of·최초 게시시각·Issue ID, 기업은 head·bucket·정규 이름·source ref다. 동일 시각/이름·한글·페이지 크기1/2·중간 비활성·신규 게시/rename 시 누락/중복과 STALE를 시험한다. 카탈로그 변경 시 이전 결과·cursor를 지우고 최신 head에서 첫 페이지를 다시 읽는다. 응답 실패를 STALE로 추정하지 않는다. 기본/최대 page20, source row·E문구·category 수는 server 상한으로 제한해 256KB 안에서 동작한다. E는 원문 최대2000자를 보존하며 데이터 자체를 잘라 저장하지 않는다.

## 저장과 현재 공개 상태

기기 저장 schema는 버전, `{issue_id, saved_at}` 목록만 포함하고 제품·환경 namespace를 분리한다. ID는 UUID 검증, saved_at은 유효 ISO 시각, 중복은 동일 ID의 가장 이른 저장시각을 보존한다. 정렬은 saved_at DESC·ID ASC, 상한500개를 넘으면 기존 기록을 지우지 않고 새 저장 실패를 표시한다. 본문·제목·요약·기업 검색어·secret·개인정보·검색 이력은 저장하지 않는다.

영속 저장 성공 뒤에만 UI를 저장됨으로 확정한다. 읽기 실패·손상 schema·권한/용량 오류에서는 기존 기록을 자동 초기화하거나 성공한 것처럼 보이지 않는다. 재시도와 안내를 제공한다. 앱 초기 hydrate가 끝나기 전 저장/해제 쓰기를 막고, 같은 runtime의 빠른 연속 동작은 직렬화한다. Web은 origin 범위 Web Locks의 읽기→최신 목록 계산→쓰기 아래에서 처리하고 다른 탭 변경을 다시 읽는다. Web Locks가 없는 환경에서는 기존 목록 읽기만 허용하고 저장 실패를 명확히 표시한다. browser QA는 localhost/현재 Chrome에서 실제 두 탭 경합을 확인한다. native는 단일 JS runtime의 동일 직렬 저장 어댑터를 사용한다.

공개 resolver와 본문 API는 분리한다. 저장 목록의 최대20개 ID batch는 canonical_issue_id·허용된 일반 공개 상태/안내, PUBLISHED일 때만 공개 카드 필드를 반환하고 내부 사유와 비공개 본문은 반환하지 않는다. 존재하지 않는 ID/DRAFT의 내부 정보를 드러내지 않는다. 현재 근거·정책이 막힌 글은 현재 SQL 가드와 같은 CORRECTION 안내로 제한한다. alias 깊이/순환 가드를 유지한다. alias가 canonical로 합쳐지면 기기가 ID를 치환·중복 제거하고 최초 saved_at의 최솟값을 보존한다. server는 로컬 저장을 직접 바꾸지 않는다. 치환과 사용자 삭제가 경합해도 삭제한 글을 새 ID로 되살리지 않도록 같은 직렬 쓰기/최신 목록 확인 안에서 적용한다.

저장 목록/상세는 진입·앱 foreground·주기 재조회에서 현재 상태를 확인한다. 이전 응답은 query/generation token으로 무효화한다. 오류·재조회 중에는 직전 본문/카드 내용을 안전한 현재 응답처럼 계속 제공하지 않는다. 네트워크가 없을 때는 저장 ID의 일반 안내와 해제만 제공하며 과거 본문 offline reading은 이번 범위에 없다. 저장 해제는 비공개·오프라인에도 기기 저장소가 정상일 때 가능하다.

## 저장 라이브러리와 native 경계

현재 Expo58.0.25의 bundledNativeModules와 [Expo SDK58 공식 안내](https://docs.expo.dev/versions/v58.0.0/sdk/async-storage/)는 AsyncStorage2.2.0을 가리킨다(2026-11-15 확인). [공식 사용법](https://react-native-async-storage.github.io/2.0/Usage/)에 맞춰 문자열 schema를 직렬화한다. 이는 비암호화 저장이므로 공개 Issue ID·시각만 넣고 설치 secret은 다음6D의 별도 보안 저장소로 분리한다.

계획 승인 뒤 이 신규 dependency만 정확 버전으로 설치하고 lock diff·라이선스·autolinking 결과를 기록한다. Expo·React·기존 광고/알림 SDK를 함께 업그레이드하지 않는다. 기존 native0004 입력 증거는 불변 과거 기록으로 보존하고, 양 플랫폼 runtime을 native0005로 올려 새 native-release 입력 digest와 실제 build 증거를 만든다. [Expo 공식 문서](https://docs.expo.dev/develop/development-builds/use-development-builds/)대로 native API 추가는 개발 클라이언트 재빌드가 필요하며 이전 binary를 새 입력의 실행 증거로 재사용하지 않는다.

기존 신규 제품 EAS 프로젝트·자격을 사용한 비대화형 개발 빌드를 우선한다. 인증·유료 결제·약관 등 실제 사용자 조치가 필요하면 해당 native 경로만 대기로 남기고 사용자를 대신해 계약/비용을 수락하지 않는다. iPhone 설치·WDA 조작은 사용자 복귀 전 요청하지 않는다. Android 빌드/에뮬레이터는 가능한 실제 범위를 관측하며 새로운 native 입력을 실제 실행하지 못하면 그렇게 기록한다. 빌드 완료·JS/Hermes export·browser persistence·실기기 실행을 구분하고 전체 native/P03b 완료를 주장하지 않는다. 기존 native consistency 검사를 약화하여 이전 FINISHED build를 새 digest에 붙이지 않는다. 최종 단계 검증에서 새 입력의 빌드 게이트가 미충족이면6C 전체 완료·커밋 게이트를 통과한 것으로 보고하지 않는다.

## r2 검수 보완: 새 native 기록과 실패 게이트

S6CP-01 대응. 설치 전 native0004의 docs/native-release.json과 project-resource-manifest는 commit73ab521의 불변 Git 이력을 보존하며, 검수 증거 폴더에도 원본 hash와 사본을 남긴다. 새 library/runtime 적용 중에는 이 기록을 성공한0005처럼 바꾸지 않는다. 새 입력과0004 digest가 다른 상태의 전체 verify 실패는 예상된 미완료이며 성공 영수증으로 사용하지 않는다.

두 플랫폼의0005 EAS 빌드가 실제 FINISHED이고, 새 Android0005 APK의 서명·package/runtime을 확인해 전용 emulator-5580/adb5038에 설치하고 실제 앱 화면을 관측한 뒤에만 현재 native-release를 교체한다. 정확한 새 record는 schemaVersion1, state=NATIVE_BUILDS_COMPILED, 실제0005 digest/inputs, runtimeVersions.android=android-native-0005 및 ios=ios-native-0005, 두 actualBuilds의 새 buildId·binaryStatus=FINISHED·해당0005 runtime, android.deviceStatus=AGENT_OBSERVED_EMULATOR, ios.deviceStatus=PENDING_NATIVE_CONFIRMATION이다.0004의 USER_CONFIRMED_PHYSICAL 또는 Android 관측값을0005로 복사하지 않는다. iPhone 사용자 확인이 없으므로 DEVELOPMENT_VERIFIED로 승격하지 않는다.

project-resource-manifest.appIdentity.nativeBuilds도 Android는 새 관측 뒤 AGENT_OBSERVED_EMULATOR, iOS는 PENDING_NATIVE_CONFIRMATION으로 맞추고 새로운 build/runtime 근거를 현재 입력에 연결한다. docs/development-status와 구현 검증 문서도 새 binary compiled/Android observed/iPhone pending/native-P03b 미완료를 구분한다. 과거 stage02 증거와 기존0004 기록은 역사 자료로 유지한다.

어느 플랫폼 FINISHED 또는 Android0005 실제 관측이 없으면 현재 verify-native-release의 기존 검사가 실패한 상태로 남고6C 구현 DUAL 완료·로컬 커밋/main FF를 보류한다. guard에 미관측·미빌드 허용값을 추가하거나 새 runtime과 옛 build를 묶어 통과시키지 않는다. iOS 인증 장애, 계정 한도·유료 전환, emulator 장애가 실제 발생하면 원인·partial browser/SQL 증거·다음 조치를 보존한다. 사용자 부재 중 다른 독립 계획/읽기 작업은 할 수 있으나6C의 통과를 가정한 후속 제품 변경은 하지 않는다. 새 두 빌드와 Android 관측이 확보된 뒤 기존 전체 verify·fresh·DUAL·동일 바이트 게이트를 그대로 수행한다.

2026-11-15 사전 읽기 확인에서는 기존 제품 EAS 세션으로 build:list와 account:usage 조회가 성공했고, Free 사용량은 전체3/30·iOS1/15·Android2/15이며 새 빌드 요청/결제는0이다. 전용 emulator-5580도 연결 상태다. 이는 새0005 빌드·설치·기능 검증의 성공을 뜻하지 않는다.

S6CP-02 대응. debounce는 최소400ms이며 활성 탭/질의별 하나의 요청만 유지·중복 합류하고 이전 응답을 무효화한다. 빈 입력은 요청0건, 화면이 비활성이면 뉴스/저장 주기 조회를 멈추고 보이는 저장 페이지의 최대20개만 batch로 조회한다. 기존 peer12token/분60/동시3·global분240 제한을 공유하고 새 예외나 상향을 만들지 않는다. 이미 server에 도착한 취소 요청은 token을 반환하지 않는다.429는 Retry-After를 따르는 별도 잠시 대기/재시도 상태이며 0건·STALE·데이터 없음으로 바꾸지 않는다. 검색 타이핑·목록 재조회·resolver가 겹친 실제429와 복구를 시험한다.

S6CP-03 대응. 구현 문서와 상태에 name/direct_keyword 검색만6C 대상이고 verified_alias/stock_code 검색은 DEFERRED_TO_STAGE7이라고 명시한다. 검색 기능 전체/종목 identity 확인 완료로 표시하지 않는다. 검증된 별칭·코드가 없다는 이유로 추정 데이터를 채우지 않는다.

## 변경 경로와 자체 검사

별도 `feat/06c-search-bookmarks`에서 app search/saved/article/card 공통 버튼, search/bookmark state/adapter, contracts, gateway read route, 신규 SQL/RLS/grants/index, 회귀 tests·현단계 foundation·status·native record만 변경한다. 6B immutable snapshot·원본 parser/registry/hold·기존1~38 SQL와 worker는 유지한다. 새 native 입력은 정확 diff를 별도 검증하고 lock 불변이었던6B 검사의 범위를 과거로 보존한 채6C의 허용 변경과 provenance를 추가한다. 기존 보안·게시·M0/M1 시험의 기대치를 낮추지 않는다.

자체 시험은 (1) 정확명/한글/NFC/영문/복수토큰·D/E/F 분리와 E 줄바꿈, 같은기업 다른분류 중복 제거·타기업 오매칭 차단 (2) 현재 PUBLISHED/alias/비공개·근거 만료·분류 비활성·과거 snapshot·동일시각 pagination (3) 익명 private 접근 거부·임의 route/query/cursor·rate/응답 상한·빈/과대 입력 (4) 저장 재시작·hydrate 경합·빠른 toggle·쓰기 실패·손상 schema 보존·500한도·환경분리·두 Web탭 동시쓰기 (5) alias 두 저장의 최초시각 병합·삭제와 rewrite 경합·숨김/철회/정정 안내·오프라인 본문 미복원이다. 실제 local SQL/HTTP/API와 실제 browser 동작을 구분해 증거로 남긴다.

브라우저393×852에서 검색 헤더/지우기/취소·둥근 두 탭·최신 E 문구, 홈/이슈/상세 저장 공통 상태·저장 탭 재진입과 reload 지속, 비공개 안내/해제, alias 치환, 실패 화면과 늦은 응답 차단을 본다. 테스트용 합성 기사와 메타데이터 변경은 원복하고 audit/snapshot은 남긴다. source sheet/live 뉴스/price/AI/push/ad 요청은0, live7/8 CLOSED다.

계획 DUAL → 구현 → 기존 전체 pnpm verify와 추가 runtime/browser/native 입력 검증 → 독립 clone/frozen install → source/index/current 동일 바이트 → 구현 DUAL → 같은 바이트 로컬 commit/main FF → 커밋 후 전체 검사 순서를 따른다. 원격 push는 하지 않는다. native 게이트가 실제로 막히면 성공을 꾸미지 않고 정확한 미완료 항목과 독립 진행 가능 범위를 기록한다. 다음은6D 소유권·조회·알림 설정 계획이며6C 결과가6단계 전체 완료를 뜻하지 않는다.
