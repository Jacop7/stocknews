# 주도주뉴스 2단계 — Expo·어드민 골격과 공통 계약

2026.11.14 · 구현 전 계획 · 단계 계획/구현 각각 Claude·Codex 검수

## 선행 증거와 범위

신규 제품 root는 C:/Users/jacop/주식/judoju-news, origin은 사용자가 지정한 https://github.com/Jacop7/stocknews.git 이다. 1단계 DUAL 검수 manifest 9c4717c8ed06ba610229fc3f78e03e853f17a79ed453dcc1a11e04c7f42ba605와 실제 main 커밋 fa928e987a792cb99536b7e0fc4461e7575ba8d6, 29파일 커밋/새 checkout 바이트 일치, 검사 157+63 PASS 영수증을 선행 기준으로 둔다. 현재 push는 없다. 식자재 제품의 소스·설정·계정 연결·DB·Docker·키를 가져오지 않는다.

2단계는 실제 앱·어드민의 첫 화면과 공통 TypeScript 계약, 자동 검사를 만든다. 실제 뉴스 수집/AI 게시·DB migration·worker 처리·운영 배포·실광고·실푸시는 아직 하지 않는다. 공급처 시험은 3단계, 새 DB/공통 큐/worker 기반은 4단계, 서비스 CRUD와 상세는 5~6단계다. 화면 샘플은 명시한 fixture이며 실시간 기사/시세로 오인시키지 않는다.

## 서버·환경 관계 — 사용자 최신 질의 반영

| 구성 | 로컬 local | 클라우드 검증 preview | 운영 production |
| --- | --- | --- | --- |
| Expo Android/iOS | 로컬 코드·전용 development build | 전용 preview build/채널 | 별도 production build/채널 |
| 어드민 웹 | 이 PC localhost | 새 검증 웹 호스팅 | 새 운영 웹 호스팅 |
| Supabase | 신규 제품 로컬 설정은 2단계, DB 실제 기동은 4단계 | 별도 새 검증 프로젝트 | 별도 새 운영 프로젝트 |
| 봇 실행부 | 로컬 Docker는 개발·시험 전용 | 클라우드 전용 worker | 클라우드 전용 worker |
| 작업/데이터 | 환경별 큐·기사·설정·키 분리 | 시험 수집·게시·푸시만 | 운영 데이터·운영 설치만 |

운영 봇을 사용자 PC 상시 가동에 의존시키지 않는다. Docker는 포장/실행 방식이며 PC/클라우드 중 어디에 배포하는지가 다르다. Supabase는 DB/API/Auth/Storage와 작업 상태를 맡고, 봇은 외부 AI API를 호출하므로 자체 AI 모델 서버를 만들지 않는다. 어드민 인증은 필요하지만 소비자 앱의 로그인은 없다.

Supabase Edge Functions에서도 짧은 수집·AI 호출은 가능하다. 24시간 서비스라는 이유만으로 상주 프로세스가 필요한 것은 아니다. 3단계 공급 시험에서 API/RSS의 짧은 작업과 장시간·상시 연결/PDF·브라우저 작업의 실행 특성을 측정한다. 4단계에서 기존 단일 jobs/outbox·멱등 effect/lease 계약을 유지하면서 짧은 예약/웹훅 처리와 외부 worker의 경계를 확정한다. 동일 작업을 두 실행부가 중복 처리하지 않으며 공개/정정/권한·근거 게이트를 우회하지 않는다. 본 단계는 실행부를 새로 배포하거나 모든 수집을 Edge Functions로 옮기는 승인이 아니다.

Git 기능 브랜치, Expo 빌드 채널, Supabase 프로젝트, Docker 배포 환경은 서로 다른 식별자다. manifest에서 따로 기록한다. 로컬 도구 사용 가능을 dev/prod 클라우드 생성 성공으로 표시하지 않는다. 클라우드 서버 종류·리전·유료 계약·EAS/스토어 계정 연결은 구체적인 대상/비용을 준비한 뒤 필요한 사용자 조작을 받는다.

환경 식별자는 local/preview/production으로 고정한다. 사용자가 말한 개발 서버 dev는 클라우드 검증 preview를 가리키며, Expo development 프로필은 로컬/개발용 바이너리 종류다. profile과 environment는 별도 필드로 대응표를 두어 같은 이름으로 오인하지 않는다(S2P-02).

## 산출물과 구현 순서

| 순서 | 산출물 | 구체 동작 |
| --- | --- | --- |
| 1 | feat/02-app-admin-shell | 승인된 main의 후손. 기존 최초 이력 유지, 신규 원격 이력 가져오지 않음 |
| 2 | 이식 가능한 기반 검사 | 실행 root와 과거 bootstrapRoot를 구분. 신규 checkout에서도 내부 사본/provenance와 최초 이력을 검증. 기존 0/1단계의 분리·민감 ignore·스냅샷 불변 계약을 삭제하지 않음 |
| 3 | apps/mobile | 새 Expo SDK58 앱. 하단 홈/이슈체크/섹터랭킹/저장 4개, 저장 상단 알림/설정 경로, 검색·필터·기사/섹터 상세 경로의 골격. 첫 화면은 앱명과 fixture 상태를 명시. 상세 서비스 완성은 후속 단계 |
| 4 | apps/admin | 신규 Next.js App Router 웹. 대시보드/기사/섹터/키워드/홈 순위/수집 상태 경로와 로그인 화면 골격. 미연결 인증/쓰기 기능을 실제 로그인·저장 성공으로 위장하지 않음 |
| 5 | packages/contracts | 기사/버전·섹터/하위섹터·한국기업·시세·출처·작업 형식. selection_market_basis=KR 또는 FOREIGN_US, analysis_perspective=KR_EQUITY, impact/visible_sections/as_of/cutoff/snapshot_context_id 계약을 공통 문서와 맞춤. 운영 DB schema 구현은 4단계 |
| 6 | packages/domain | 주입 가능한 Clock/MarketCalendar 인터페이스. UTC 저장·한국 표시, 09:10/20:00 시장 기준 경계의 순수 함수. 휴일/서머타임/거래일은 제공되는 달력으로 판단하며 공식 자료원은 3단계에서 확정. 달력 미확보를 거래일로 추정하지 않음 |
| 7 | 앱 식별·환경 예제 | 신규 앱 slug/Android package/iOS bundleIdentifier와 development/preview/production 프로필. EAS projectId는 실제 확인 전 PENDING, 이전 제품 값·임의 UUID 금지. .env.example에는 공개 설정 이름과 서버 전용 비밀 경계만 기록 |
| 7a | 신규 supabase/config.toml·분리 증거 | 고유 project_id와 활성 API/DB/Studio/Inbucket/analytics·pooler 등 전체 포트를 전용 범위로 작성. 현재 listen 포트와 Docker 이름/노출 포트 충돌만 읽기 검사하고 manifest의 plannedLocalConfig와 대조. 기동/link/migration은 안 함 |
| 7b | docs/compatibility-policy.md·native release 계약 | 플랫폼별 명시 native release ID/runtimeVersion, 앱 version·Android versionCode/iOS buildNumber·channel·API 최소지원 버전의 다른 책임을 정의. native 입력 digest 및 CI 변경 검사를 최초 빌드부터 적용 |
| 8 | 호환 시험 | 광고/알림 라이브러리는 Expo/RN 호환 버전을 확인하고 개발 빌드에서 컴파일만 검증. 실제 광고 요청·푸시 등록/발송은 하지 않음. 시험 ID와 운영 ID를 분리하고 SDK 초기화의 부작용을 점검 |
| 9 | 자동 검사/CI | root verify에서 기반/도구/타입·공통 domain 시험·앱 번들·어드민 production build를 실행. GitHub Actions는 새 저장소만, 최소 contents:read 권한·비밀 없이 fixture 검사. native 빌드는 별도 결과로 두며 웹 번들을 Android/iOS 빌드로 대체하지 않음 |
| 10 | 실행·검수 증거 | 개발 웹/앱 브라우저 첫 화면과 실제 가능한 Android/iOS 경로 확인. 실행한 것·실행 못 한 것·계정/기기 대기를 나눠 제품 밖 검수/커밋 영수증에 기록 |

### 신규 로컬 Supabase 설정 경계 — S2P-01(a) / S2P-C01

supabase/config.toml은 새로 작성하며 project_id=judoju-news-local을 기본 후보로 둔다. 포트는 구현 시점의 실제 점유 상태를 읽어 겹치지 않는 전용 묶음으로 고정한다. 충돌 시 기존 컨테이너를 중지하거나 설정을 읽어 가져오지 않고 신규 설정의 포트만 바꾼다. 기존 서비스의 환경변수·mount·인증·DB 본문은 조회하지 않는다.

project-resource-manifest에 plannedLocalConfig(project_id·설정 파일 경로/해시·활성 서비스별 포트·planned 자원 이름)와 configValidation(status/observedAt·포트/이름 충돌 결과)를 추가하고 설정 파일과 일치 검사한다. resource actual/status는 계속 null/PENDING이다. 컨테이너/volume 실제 생성·포트 바인딩·제품 식별 endpoint 응답은 4단계 PENDING으로 별도 기록한다. 2단계의 충돌 없음은 검사 시점의 설정 준비 증거이고 미래 기동 성공 보장이 아니다. supabase init/start/link나 Docker 생성은 이 범위에 넣지 않는다.

### 최초 빌드 호환 정책 — S2P-01(b) / S2P-C02

앱 설정에서 Android와 iOS runtimeVersion을 각각 명시적인 native release ID로 관리한다(예: android-native-0001 / ios-native-0001). 채널은 development/preview/production 배포 경로이고, 사람이 보는 앱 version·스토어 빌드 번호·runtimeVersion·API 최소 지원 앱 버전은 별도 필드다. API 최소 지원 버전은 2단계에서 초안/형식을 정의하고 실제 서버의 차단·업데이트 응답/화면은 4단계에서 구현한다. OTA 배포는 아직 하지 않는다.

native SDK·config plugin·native 설정/소스의 변경은 새 해당 플랫폼 runtimeVersion과 새 바이너리를 요구한다. 최초 빌드부터 native 입력 digest를 고정한다. 입력은 mobile package/lock·Expo app config·EAS profile·plugin 설정·native patches/소스이며, lock 전체를 포함하는 보수적 digest라 순수 JS 의존성 변경도 새 runtime을 요구할 수 있음을 명시한다. CI는 recompute digest와 기록값을 대조하고 이전 main 기준 native 입력이 바뀌었는데 해당 runtime이 같으면 실패한다. 최초 기준 파일 생성은 bootstrap으로 기록한다. native 변경 없이 JS만 바뀐 경우에도 동일 runtime 및 서버 계약 호환 확인 전 해당 channel에 업데이트하지 않는다. 생성 native 산출물의 기기/서명 비밀은 digest 공개 자료에 넣지 않는다.

## 버전과 설치

Node24.15.0·pnpm11.25.0·TypeScript6.0.3은 1단계에서 검증한 조합을 유지한다. 2026.11.14 공식 npm registry 조회값: create-expo-app5.0.0, Expo58.0.25, expo-template-default58.0.34, Next16.4.6, React/ReactDOM19.3.1, eas-cli27.9.0. Expo 앱은 공식 SDK58 템플릿이 요구하는 RN·React·Expo 모듈 조합을 우선하고 어드민의 React 버전과 무조건 맞추지 않는다. 설치 시 registry integrity와 package/lock을 다시 검증해 실제 선택 버전을 기록한다. 광고·푸시 버전은 Expo 설치/doctor 호환 결과로 고정하며 latest만으로 호환을 주장하지 않는다.

전역 도구/기존 제품 lock은 변경하지 않는다. Corepack cache/store는 새 제품 전용이다. ignoreScripts=true를 기본으로 유지하고 native/Next 빌드에 필요한 스크립트만 패키지/버전·필요성·출처를 확인해 명시 허용한다. 설치/생성 도구의 git init·기존 template 화면은 정리하되 최초 Git 이력과 계획 원본은 보존한다. 기본 telemetry는 가능한 공식 opt-out으로 비활성화한다.

S1I-03은 최초 push 전에 처리한다. 관측·provenance에 필요한 원본 식별은 유지하되 공개 자료의 로컬 사용자 경로를 <HOME>/논리 source locator로 정규화하고 검증기는 실행 root를 사용한다. 사본 본문과 기존 bytes/sha256은 변경하지 않는다. 1단계 manifest 원문과 관측 원문은 로컬 외부 검수 증거로 보존한다. 과거 커밋은 다시 쓰지 않는다. GitHub의 실제 공개 범위를 확인하고 기존 커밋을 포함한 공개 영향/비밀 검사를 먼저 한다. 사용자 개인 경로 노출 우려가 남으면 push를 보류하고 로컬 구현은 계속한다.

pnpm workspace의 JSON(YAML1.2 부분집합) 형식을 유지하는 동안 해당 형식을 문서화하고 오류를 명확히 반환한다. 도구가 YAML로 재작성하는 경우 검토된 파서/설정 검사를 함께 변경한다. 없는 선택 cache는 오류로 취급하지 않으며 실제 의존성은 필수다. Supabase CLI override 거부와 실제 바이너리 내부 경계 검사는 계속 실행 전 적용한다.

## Git·CI·원본 계약

- 최초 커밋 f7dce3a와 1단계 fa928e9의 조상 관계를 유지하고 기존 10개 스냅샷의 bytes/sha256을 보존한다. 승인된 이 계획은 11번째 사본으로 docs/stages에 추가한다.
- 2단계 허용 브랜치는 main/feat/02-app-admin-shell. 준비 중 main은 fa928e9이고 feature는 그 후손이다. 재검수 통과 전 임의 구현 커밋 금지. 통과 후 같은 제품 바이트로 1커밋→main ff-only→병합 feature 정리한다. 실제 허용 refs/커밋 기준은 단계별로 분기한다.
- origin은 정확히 Jacop7/stocknews이고 예상하지 않은 remote/tag/ref는 실패한다. 최초 push 및 CI 실행을 하기 전 보호/공개 범위·현재 원격 이력·권한·민감 파일을 확인한다. 기존 원격 내용이 생기면 덮어쓰거나 force push하지 않는다.
- 원격 CI에서는 필요한 이력/스냅샷을 확보하고 실행 root가 clone 위치일 때도 검증한다. 검증된 local checkout 시험을 먼저 수행한다. CI 정의만 존재하는 상태와 실제 GitHub 실행 PASS를 나눈다.
- 환경 설정 누락은 명시적인 연결 대기 화면/오류로 표시하며 실제 endpoint를 추측해 접속하지 않는다. admin 쓰기·기사 공개 API는 아직 미연결이다. dev/prod 선택을 단순 Git branch명에 의존시키지 않는다.

## 검사와 완료 게이트

1. 새 checkout에서 frozen install과 전체 verify가 동작하고 이전 10개 사본의 bytes가 그대로다. root를 다른 경로로 옮겨도 기존 제품이나 원본 다운로드 폴더를 읽지 않는다.
2. contracts 타입검사와 domain의 09:09:59/09:10:00/19:59:59/20:00:00 한국시각, 주말·서머타임·휴장/달력미확보 사례를 고정 시계로 시험한다. 뉴스 수집/게시의 24시간 처리와 홈 10분 스냅샷의 다른 책임을 계약에서 구분한다.
3. 앱과 admin 타입검사·Expo Android/iOS용 번들 생성·Next production build·첫 화면 로컬 열람을 각각 기록한다. 번들/Expo Go/웹 화면만 확인하고 native 빌드 통과라고 쓰지 않는다.
   신규 config.toml의 project_id/활성 포트/예정 자원명과 manifest가 일치하고 현재 포트·이름 충돌 확인 증거가 있어야 한다. 미기동 컨테이너·volume·제품 응답은 PENDING으로 남긴다. 호환 정책과 플랫폼별 runtime/channel/version/build number/API 버전 구분 및 native 입력 digest CI 검사도 산출물에 있어야 한다. runtime을 그대로 둔 native 입력 변경 음성 사례는 실패해야 한다.
4. Android 개발 빌드와 iOS 개발 빌드/실제 첫 화면의 검증 경로를 마련한다. iOS EAS·서명·iPhone 또는 승인된 원격 기기가 필요하면 준비된 앱 설정과 실제 오류/대기 이유를 제시하고 사용자 조작을 요청한다. Android SDK/emulator와 iOS 구동은 각자 증거가 있어야 한다.
5. 광고·푸시 호환 시험도 양쪽 native 결과를 분리한다. 실제 앱 설치·기기·계정 검증이 없으면 미확인으로 남긴다. 2단계 전체 완료는 양쪽 첫 화면/필수 호환 게이트를 통과해야 하며, 미확인 native 결과를 후속 단계나 ‘추후 확인’ 문구만으로 완료 처리하지 않는다.
6. 계정/기기 대기가 있어도 검증 가능한 로컬 앱/admin/계약 작업은 진행한다. 2단계 구현 부분 검수와 2단계 전체 완료를 구분하며, 대기 중 3단계의 읽기 전용 공급 조사처럼 독립 작업만 계속할 수 있다.
7. 검수는 계획과 구현 각각 Claude 브라우저/독립 Codex Ultra로 수행한다. 변경 없는 최종 제품 바이트를 커밋하고 제품 밖 outputs/development-stages/reviews/stage02-implementation에 실제 검사/화면/제약/커밋을 연결한다. 비용·로그인·계정 약관이 필요한 최종 조작은 구체적인 결과가 준비된 뒤 받는다.

## 공식 참고

- [Expo SDK58](https://expo.dev/changelog/sdk-58), [Expo monorepo](https://docs.expo.dev/guides/monorepos/), [생성 도구](https://docs.expo.dev/more/create-expo/)
- [Next 설치](https://nextjs.org/docs/app/getting-started/installation)
- [Supabase Edge Functions 제한](https://supabase.com/docs/guides/functions/limits), [백그라운드 작업](https://supabase.com/docs/guides/functions/background-tasks)

위 서버 배치는 서비스 운영 책임의 설계이며 현재 클라우드 자원이 생성됐다는 뜻이 아니다. Edge Functions/worker의 최종 경계는 공급 시험 결과와 공통 운영 계약을 근거로 4단계 계획에서 검수한다.
