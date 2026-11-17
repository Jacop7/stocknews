# MAIN ADMIN C1B — 관리자 실제 연결 전 host·설정·프로세스 준비

P3는 da836420133e2f4b5405f77e6af39b966131cc1d에 519파일로 커밋·푸시했고 전체47개 결과/신규86시험/170산출물과 두 검수 r2 READY를 확인했다. P3 구현과 원문·수정 전 재현 자료는 그대로 보존한다. 이 계획은 C11C1 원 계획의 남은 host·fixture writer·Windows supervisor 준비를 새 기준에 편입한다. 실제 관리자 계정·권한·DB 쓰기·기사 게시 연결은 후속 C-2다. 식자재 앱의 코드·DB·서버·계정·실행기는 사용하지 않는다.

## 순서와 책임

계획 Opus5.5 medium 우측 IAB + Astra Ultra DUAL → MAIN 직접 구현 → 전체 pnpm verify와 실제 Windows 고장 시험/loopback 브라우저 확인 → 전체 동일 manifest 구현 DUAL → 원문·백업·커밋/푸시. 검수 지적은 같은 case·같은 binding의 수정 판본으로 처리하고 기존 회차/HOLD/Router를 초기화하지 않는다. AI 작성은 계속 MAIN 책임이다. 기존 수집기·홈 담당은 다음 durable DB 계약을 읽기 전용으로 조사하며 이 단계 제품 작성자는 아니다. 이 운영상 제한을 OS sandbox나 인증정보 격리라고 부르지 않는다.

현재 목표는 로컬 preview가 공개 H와 cookie host를 공유하지 않게 하고, 비밀 없는 fixture writer·소유 프로세스 종료를 실제 검증해 C-2 적용물을 구체화하는 것이다. ACTUAL 키를 읽어 설정하거나 실제 로그인에 성공했다고 보고하지 않는다.

## 정확한 제품 범위

기준519파일/47refs, feature feat/main-admin-c1b. 기존 수정10개: AGENTS.md, package.json, docs/development-status.json, scripts/verify.mjs, scripts/verify-foundation.mjs, apps/admin/lib/admin-profile.mjs, preview-admin-config.mjs, runtime-preview.mjs, tests/preview-admin.test.mjs, tests/admin-preview-lifecycle.test.mjs.

신규14개: apps/admin/lib/preview-config-writer.mjs, preview-file-boundary.mjs; scripts/admin-preview-supervisor.ps1, admin-preview-native.cs, admin-preview-entry.mjs, admin-preview-policy.mjs; tests/admin-preview-config-writer.test.mjs, admin-preview-supervisor.test.mjs, admin-preview-host.test.mjs; scripts/verify-admin-c1b-foundation.mjs; docs/stages/stage-admin-c1b-baseline.json, preparation.json, plan.md, notes.md. 그 외 worker/계약/domain/SQL/앱소비자/설치·구독·권한/lock/provider/과거guard는 바이트 보존한다. 추가 파일이 꼭 필요하면 구현 전 계획 판본을 고친다.

## 전용 host와 실제 접근 차단

preview origin은 http://127.0.0.2:62333 고정. 프로필·config 검증·Host/Origin·listen·시험을 일관 이관한다. local 127.0.0.1:3100, H 62331/62332, Metro8084–8086과 기존 서비스는 건드리지 않는다. 기존 preview 127.0.0.1:62333·localhost·외부 bind·env endpoint override는 거부한다. cookie 이름·HttpOnly·SameSite Strict·path·secure:false와 P3 logout 실패 제거 조건은 그대로다. port가 cookie를 분리한다고 주장하지 않는다.

C1B에서 loadPreviewAdminConfig의 ACTUAL 진입은 source 수준 고정 NOT_ACTIVATED(기존 안전 오류 계약 유지)로 닫고 private 파일 I/O 전에 거부한다. env나 fixture:true로 열리는 우회 옵션은 없다. fixture loader는 별도 브랜드·실제 제품 root 거부·기본 fetch 거부를 보존한다. C-2에서 검수한 실제 파일/권한 적용물과 결정 근거를 만들기 전에는 ACTUAL 해제 코드를 작성하지 않는다. import/build는 private I/O·network0이다.

runtime-preview의 변경은 전용 host만이며 fingerprint-before-password/session/getUser/JWT/owner/allowlist/CSRF/시간·크기·보상/원 오류·notApplied·재시도0은 P3 그대로다. legacy 시험은 host 기대와 강화된 ACTUAL 차단 검증 외 기존 assertion을 보존하고 정확 diff로 검수한다. ACTUAL 차단은 원격 세션·DB 행을 삭제했다는 뜻이 아니다.

## 프레임워크 환경 파일과 고정 실행 방식 — MAC1BP-01/C1BP-01

child env 정리와 ACTUAL loader 차단은 Next/Expo의 디스크 dotenv 자동 읽기를 막는 증거가 아니다. 고정된 @next/env16.4.6 source의 loadEnvConfig는 mode별 네 파일을 직접 stat/read한다(next-environment-source.json). 기존 P3 전체검사 로그도 ignored 환경 파일의 부재나 미소비를 입증하는 자료로 확대하지 않는다. 이번 사전 metadata 점검은 product root·apps/admin·apps/mobile의 exact8종 이름24개에 present/unknown0, 내용읽기0을 관측했지만 미래 실행의 보장이 아니므로 매 실행마다 다시 검사한다.

admin-preview-policy.mjs에 import시 I/O 없는 명시적 환경 경계 함수를 둔다. 공식 full verify 시작과 각각 build/export/start 직전에 product root·명시한 앱 root의 소유 실경로/구성요소를 확인하고 .env, .env.local, .env.production, .env.production.local, .env.development, .env.development.local, .env.test, .env.test.local 존재를 내용 열기 전에 lstat/native metadata로 검사한다. 기존 공개 .env.example은 프레임워크 자동 로드 대상이 아니며 읽어서 판단하지 않는다. 어느 대상이든 파일/디렉토리/심볼릭 링크/reparse로 존재하면 HOLD, EACCES·부모 경로 변화·native 불명 등 정상 ENOENT가 아닌 결과도 HOLD다. 실제 파일의 내용 조회·수정·이름 변경·삭제로 통과시키지 않는다. 고정 Next project dir 및 NODE_ENV=production을 결속하고 임의 cwd/mode override를 거부한다. Node 내부 skip-env 플래그에 의존해 파일 읽기를 차단했다고 하지 않는다.

verify.mjs는 첫 framework/tool 실행 전에 이 경계를 호출하고, child 환경은 필수 OS/PATH·제품 pnpm/Corepack·CI/GitHub의 비밀 없는 검증 값과 telemetry off만 명시적으로 구성한다. 임의 inherited provider/auth/cloud/NODE_OPTIONS/NODE_PATH/NEXT_PUBLIC/EXPO_PUBLIC 값은 전달하지 않는다. root package의 기존 build:admin/export:android/export:ios는 새 policy의 고정 실행 wrapper로 이관해 동일한 원래 pnpm target과 args를 실행하되 metadata 경계와 controlled env를 먼저 적용한다. 모든 기존 검사와 두 export는 그대로 실행하며 새 guard가 세 wrapper 이관 및 기존 target 보존을 검증한다. apps/admin/package.json의 직접 next 명령은 source를 보존하고 C1B가 직접 호출하는 공식 root wrapper/고정 launcher 밖의 수동 명령까지 보호한다고 주장하지 않는다. supervisor와 child entry도 즉시 같은 경계를 재검사한다. 같은 사용자 악성 동시 파일 생성까지 완전한 OS sandbox라고 부르지 않으며, 검사·실행 경합이나 경로 변경이 관측되면 중단·잔여 보고한다.

smoke는 C1B source를 공식 guarded build:admin으로 production build한 뒤 fixed Node→고정 Next CLI의 next start <고정 apps/admin dir> --hostname127.0.0.2 --port62333으로만 실행한다. next dev/임의 script/기존1:3100 alias/환경 endpoint override는 사용하지 않는다. build/시작/종료 전후 모든 tracked source와 선언 stage pins를 대조하고 next-env.d.ts/tsconfig.json 등 보존 대상이 바뀌면 HOLD, 원본을 자동 덮어 되돌려 숨기지 않는다. .next 같은 허용 빌드 산출물은 별도 hash로 결속한다. Origin 거부는 보호 API를 기준으로 확인하고 공개 HTML을 인증 API와 혼동하지 않는다.

admin-preview-host/supervisor 시험에 임시 합성 dotenv 각 이름·접근 오류·broken link/reparse·디렉토리·부모 변화/불명 사례를 넣어 Next/Expo import·spawn 이전 frameworkStarted=false로 중단됨을 확인한다. sentinel은 합성이고 실제 .env 내용은 열지 않는다. root wrapper/full verify와 supervisor 두 경로를 모두 검사한다. 파일 없는 정상 case는 기존 전체검사·실제 Windows blocked Next smoke로 검증한다. 경계 함수의 존재만 보고 실제 bootstrap 차단을 인증하지 않는다.

정상 정리는 소유 Job handle을 유지한 상태에서 명시 TerminateJobObject→bounded query active0/소유 process handle 종료→Close 순서로 관측한다. 비정상 parent 강제 종료 시험은 observer가 Job handle을 복제·상속해서 kill-on-last-close를 방해하지 않는다. 종료 뒤 닫힌 Job handle로 query 성공했다고 주장하지 않고, 종료 전 고정한 소유 process/descendant handle·생성시각·포트 관측과 문서상 last-close 규칙을 구분해 보고한다. syscall 내부의 관측 불가능 구간은 미검증으로 명시한다.

## 보존 SQL·계약의 origin 정적 검색 — C1BP-02

origin-source-inspection.json은 admin-preview-dev SQL/preparation, contracts source, resource manifest, SQL render helper의 파일 hash와 정확 match를 보존한다. 이 집합에 admin preview62333/origin은 없었다. resource manifest의 .1:62321과 일반 publishedBindings=.1은 기존 로컬 DB 자원이어서 그대로 둔다. 이 결과는 원격 schema inventory가 아니다. 실행 origin은 허용된 세 lib와 새 launcher/policy·시험에서만 바뀌며 과거 SQL/계약/guard 바이트를 불필요하게 고치지 않는다.

## Fixture 전용 설정 writer와 파일 경계

writer는 import/build 시 I/O0, 명시 호출 때만 비밀 없는 mock secret source를 사용한다. 실제 키·토큰·사용자 비밀번호를 argv/env/로그로 받거나 읽지 않는다. fixture publishable/secret은 정해진 FIXTURE 문자열만, encryption key도 합성 fixture 값만 쓴다. ACTUAL 모드 요청은 mock source 호출 전에 거부한다. root는 제품 실제 root와 그 내부/부모가 될 수 없는 새 temp fixture 디렉토리만 허용하고 파일이 하나라도 있거나 lock이 있으면 HOLD, 덮어쓰기/삭제/자동복구0이다.

proof는 기존 loader가 요구하는 정확 dev nxfpfvsdwbziowkxsxnh/org/owner, 새 origin, SQL·implementation·decision SHA, 승인 시각·최대24시간TTL, exact21 editor+3 server RPC, SYNTHETIC/preview/bootstrap-null 의미 및 M2/REAL/worker false를 검사한다. proof raw bytes를 exclusive 생성·flush/fsync → 그 raw SHA를 config에 결속 → config exclusive 생성·flush/fsync 순서다. 어느 시점에 실패해도 이미 만든 파일은 보존하고 partial 상태를 명확히 반환해 후속 진단 없이 재시도하지 않는다. fixture 파일을 실제 root로 복사해도 ACTUAL로 승격되지 않는다.

파일 경계는 정규 파일/nlink=1·크기 상한·root 하위 실경로·경로 구성요소 symlink/junction/reparse 거부와 실제 열린 handle의 identity/fstat를 전후 대조한다. Windows의 일반 reparse 표시는 Node isSymbolicLink만으로 전부 확인했다고 하지 않는다. native helper는 GetFileInformationByHandle 계열과 path attributes로 fixture 대상의 reparse·file identity·link count를 검증하며 실제 native file I/O/flush는 자기 handle에 결속한다. Node wrapper가 caller가 준 allSafe boolean을 권한 증거로 받지 않는다. 필요한 native 검사가 불가능/불명하면 HOLD하며 portable 가짜 성공으로 바꾸지 않는다. 이 경계도 같은 사용자 악성 동시 변경에 대한 완전한 credential sandbox는 아니다. 실제 secret 파일의 읽기·보존·회전·폐기 경계는 C-2에서 별도 검수하며 이번 fixture 검증으로 완료라 하지 않는다.

## 소유 Windows Job과 고정 진입점

제품 source인 C# native helper와 PowerShell thin wrapper를 사용하고 Codex/AppServer/식자재 실행기 바이너리를 제품 의존성으로 쓰지 않는다. wrapper의 Operation은 고정 enum, Node/Next/entry/working directory·argv·host/port는 제품 고정 값이며 임의 exe/command/env override를 허용하지 않는다. 새 launcher는 Windows 10+ Job-list 기능을 사용하고 API·권한 지원이 불명하면 HOLD한다. UI 창은 숨김 기본이다.

Job은 먼저 만들고 kill-on-last-handle-close를 설정한다. PROC_THREAD_ATTRIBUTE_JOB_LIST/STARTUPINFOEX/EXTENDED_STARTUPINFO_PRESENT로 child를 생성 시 소유 Job에 결속하며 CREATE_SUSPENDED를 함께 사용해 자신의 Job membership·PID 생성 시각·고정 실행파일/인자/필요 handle을 검사한 뒤 Resume한다. spawn 후 별도 Assign 사이에 임의 작업을 허용하는 fallback은 없다. Job handle은 child에 상속하지 않고 breakaway/silent-breakaway를 허용하지 않는다. 상속할 stdio/IPC handle은 필요한 고정 목록뿐이며 실제 인증 env는 전달하지 않는다. NODE_OPTIONS/NODE_PATH와 비관련 클라우드·계정·인증 환경은 child에 전달하지 않고 필수 OS 값/telemetry off/preview 프로필만 구성한다.

handshake5초·시작30초·정리5초·명시 run TTL을 monotonic clock으로 제한한다. parent·native 오류·취소·만료·출력/원장 실패는 최외곽 finally에서 자기 Job handle을 정리한다. lock은 exclusive이고 다른 실행의 lock을 시간 경과만으로 지우지 않는다. port 점유 시 HOLD하며 점유 process kill0이다. PID 문자열만으로 재사용된 process를 종료하지 않는다. Job query/소유 child 생성 시각/포트 owner를 확인하고 정리 후 active member·listener0을 관측한다. 불확실 잔여가 있으면 그대로 보고하고 자동 재시작하지 않는다.

고정 entry의 fixture child는 자신과 descendant의 생명주기를 시험한다. C1B 앱 smoke는 ACTUAL loader가 닫힌 Next preview만 127.0.0.2:62333에서 일시 실행해 로그인 화면·잘못된 Host/Origin 거부를 확인하고 종료한다. 실제 자격증명을 입력하거나 로그인 POST를 보내지 않는다. C# Add-Type/컴파일은 자기 검수 source만, import/build가 아니라 명시 시험/launcher 호출 때만 실행한다. 외부 다운로드·설치·OS 설정 변경0이다.

생성 시 Job 결속을 쓰더라도 모든 Windows 빌드의 syscall 내부 rollback이나 모든 부모 종료 지점을 문서만으로 수학적으로 보증했다고 하지 않는다. 현재 host에서 CreateProcess 호출 직전/도중 관측 가능한 중단·반환 직후/Resume 직전/handshake/descendant 동작 중 parent 강제 종료를 실제 시험하고, 지원하지 않는 고장 주입 구간은 명시 미검증으로 남긴다. 이월 CL10HP-01을 종결하려면 계획한 핵심 실패행렬에서 소유 자원 종료가 확인돼야 한다. 미검증을 합성 boolean으로 통과시키지 않는다.

## 시험·편입·수용 기준

새 세 그룹 test:admin-preview-config-writer / test:admin-preview-supervisor / test:admin-preview-host를 full pnpm verify에 추가하고 기존47개 결과의 모든 검사·Node worker/app/artifact 경계를 보존한다. loader/fixture 브랜드·copied ACTUAL·getters/크기/만료/extra RPC·reparse/hardlink/partial fsync·원래 파일 무변경·native 불명 거절을 검증한다. P3 로그인13개와 legacy assertion을 유지한다. 실제 Windows Job의 spawn/query/Resume/IPC/reader/report/lock 실패·parent 강제 종료·TTL·port collision·descendant 종료를 검사하고 다른 process/다른 port 무변경을 확인한다.

Linux CI의 native 미지원은 SKIPPED_PLATFORM/NOT_VERIFIED_WINDOWS로 명시하며 실제 Windows 성공으로 세지 않는다. MAIN이 현재 Windows에서 실제 failure injection을 실행하고 전체 source pins와 log SHA로 제출해야 이 단계 구현 수용이 가능하다. 우측 IAB의 별도 loopback 탭으로 ACTUAL 차단 preview 화면만 확인하고 fixture 서버와 자기 Job을 종료한다. 실제 hosted 로그인·CRUD·ACL/RLS·키 매핑·Auth 세션/암호문 잔여 정리·cloud worker·폰·스토어 완료는 계속 후속이다.

전용 guard는 새 source10mutable/14new와 이전519 blobs·47refs·toolchain/locks를 고정하고 현재 feature의 한 child만 허용한다. helper를 소비자 앱/client bundle로 가져오지 못하게 하고 서버 helper만 server build에 허용한다. 고정 완료 범위와 actual key/network/DB 변경0을 status에 구분한다. full verify/Windows 로그/loopback 증거와 같은 전체 manifest DUAL 두 READY 뒤에만 백업·커밋·푸시한다.

## 이월 기록과 후속 DB 조사

P3R-01은 r1 회귀시험 snapshot이 최종 시험 bytes보다 앞선 판본인 점이다. 원 replay snapshot bytes·SHA와 최종 P3 시험의 정확 diff/사유를 새 계획 증거에 결속하고, 원 JSON/log/원문을 변경하지 않는다. 최종 시험을 그대로 r1에서 실행했다고 표현하지 않는다. 실제 기능 수정은 P3 source와 양측 r2 원문/전체검사에 근거한다. 이 문서 연결이 검수되기 전 새 advisory를 임의 종결하지 않는다.

기존 MPP2-04/H_BODY·MACQP-01/03·MPP1-04·G0BI-01/02·운영상 격리·C11C1P-01 late-open/unknown-grant 잔여·CL11AP-01/02/03·CL10HR/HP/GR는 남은 범위를 보존한다. home/collector 읽기 전용 조사에서 기존 SQL의 source identity/receipt/checkpoint 및 home assessment/UV/CAS 갭이 확인돼도 실제 DB inventory나 허가 증거로 부르지 않는다. 별도 versioned PostgreSQL 계약과 로컬 격리 시험 계획을 MAIN이 AI·admin과 함께 이후 통합하며, C1B에서 worker/SQL을 수정하지 않는다.

## 확인한 공식 근거

- [Windows process attribute 공식 API](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-updateprocthreadattribute): Job-list와 handle-list 지원·인자 수명. 다중 Job 원자성이나 생성 도중 취소의 모든 결과를 추정하지 않는다.
- [Microsoft의 생성 시 Job 배치 설명](https://devblogs.microsoft.com/oldnewthing/20230209-00/?p=107812): suspended 생성 후 별도 Assign 사이의 orphan 구간과 생성 속성 대안.
- [Job Objects 공식 문서](https://learn.microsoft.com/en-us/windows/win32/procthread/job-objects): 기본 child 상속·breakaway 조건과 한계. WMI 생성 등 별도 우회 경로를 일반 상속과 혼동하지 않는다.
- [파일 handle 정보 공식 API](https://learn.microsoft.com/en-us/windows/win32/api/fileapi/nf-fileapi-getfileinformationbyhandle): handle identity·반환 실패/부분 정보 가능성을 검사하고 일반 경로 검사만으로 완료라 하지 않는다.
