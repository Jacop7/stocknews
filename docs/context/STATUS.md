# 현재 상태 (STATUS)

새 세션은 이 파일 → `DECISIONS.md` → `NEXT.md` 순서로 읽고 시작한다. 원시 대화나 긴 인수인계 문서 대신 이 세 파일을 맥락의 기준으로 삼는다. 배포·큰 변경 직후 이 파일을 갱신한다.

기준 시각: 2026-11-26 (KST)

## 수집기 완료 단계 (2026-11-28, 처리기 `9426ff2` 배포)

- 출처: Finlight(국내 뉴스 신호)·GNews(뉴스 신호)·기업 보도자료/IR(367곳 하루 1회)·DART 공시(API)·텔레그램 링크. 웹 뉴스 직접 수집 OFF.
- 텔레그램 뉴스 링크는 Finlight 7곳 또는 GNews가 30일 안에 돌려준 언론사(현재 135곳)만 신호로 남김.
- 기업 이슈 ↔ 근거 매칭 가동: 첫 실행 뉴스 신호 275건 중 기업 이슈 8건, 4개 회사, 근거 문서 13건 연결. DART 목록에서 종목코드 21개 학습.
- 출처별 24시간 상태: status.json `sources`(배포 직후 GNews 255, Finlight 20(종목코드 11), DART 39, 기업 사이트 방문 101/367(FOUND 1·NO_RECENT 60·FAILED 21·NOT_REACHED 14·ROBOTS 5), 저장 링크 298).
- 기업 피드 첫 순회는 진행 중. 점검 예약 작업 `judoju-company-feed-coverage`(2026-11-29 09:00 KST). GNews·Finlight 유지 판단 예약 `judoju-news-api-evaluation`(2026-12-02 10:00 KST).

## 저장소

- 원격: https://github.com/Jacop7/stocknews.git
- 통합 개발 브랜치: `feat/collector-ai-integration` (main은 오래된 기준)
- PC worktree: `C:\Users\jacop\프로젝트\주식\outputs\development-stages\collector-ai-integration`
- 완료 기준: `corepack pnpm verify:integration` 통과 (Node 24.15.0, pnpm 11.25.0). 옛 `pnpm verify`(C2 단계 guard)는 이 브랜치의 완료 기준이 아니다.
- 프로젝트 폴더가 `C:\Users\jacop\주식` → `C:\Users\jacop\프로젝트\주식`으로 옮겨졌다. worktree 연결은 `git worktree repair`로, 의존성 링크는 `corepack pnpm install --offline --frozen-lockfile --config.confirmModulesPurge=false`로 복구한다.

## 운영 중 (AWS Lightsail 서울, 52.79.247.25)

| 항목 | 상태 |
|---|---|
| 컨테이너 | `judoju-news-html-collector-collector-1`, 실행 중, 자동 재시작 |
| 이미지 | `judoju-news-html-collector:release-23874ac` (소스 `23874ac`, 2026-11-26 17:56 KST 배포) |
| 웹 수집 | **꺼짐**(2026-11-28 사용자 결정, `JUDOJU_WEB_NEWS=0`, 웹 요청 0). 이전에는 등록 39곳 중 약 10곳만 실제 링크 수집 |
| 텔레그램 링크 수집 | 켜짐 (`JUDOJU_TELEGRAM_LINKS=1`), 공개 채널 47개, 2026-11-26부터 신규 게시물만 |
| 방문 간격 | 같은 호스트 5~8초, 다른 호스트 사이 1~3초 |
| 상태 확인 | `scripts/ops/collector.ps1 status` |
| 배포·되돌리기 | `scripts/ops/collector.ps1 deploy` / `rollback` (아래 NEXT의 주의 참고). 2026-11-26 실제 서버에서 status·deploy·rollback을 시험했고, 검수 수정본을 이 스크립트로 배포함 |
| 접속 키 | worktree의 `.local-data/collector-cloud/ssh-lightsail/` (git 제외, 채팅·로그에 내용 출력 금지) |

## 클라우드 Supabase (개발 프로젝트 `judoju-news-dev`, 2026-11-27)

| 항목 | 상태 |
|---|---|
| 적용된 마이그레이션 | CLOUD02~CLOUD10C 8개 + CLOUD11 활성화(SQL, 기록 없음) + **CLOUD12A `20261127000107` cloud12a_company_scope**(2026-11-27): 로컬 51~55(종목 범위·종목 상세·종목 기사 섹터 블록 숨김·영향별 기업 배지·조건부 섹터 비노출)를 가드·사후 확인 포함 한 트랜잭션으로 적용. 적용 전 클라우드 함수 4개가 로컬 51 이전 정의와 같음을 해시로 확인. 새 함수 ACL은 대체 대상 함수에서 복사(클라우드엔 로컬 기본 권한 없음). `scripts/cloud12-render.mjs` → `supabase/cloud/company-scope-dev/apply.sql`, Codex READY |
| 공개 읽기(CLOUD10B→12A) | **실측 확인 완료(PASS, 2026-11-27 재발급)**: 읽기 함수 10개(종목 상세 `catalog_public_company` 추가) 성공, 거부 대상 6개 차단(편집 함수 42501·비공개 404). 인벤토리 v3 `docs/cloud/cloud10b-acl-inventory.json`(API 호출 가능 32개). 증명 `.local-data/cloud-preview/access-proof.json`(git 제외) |
| 키 | publishable 키만 `.local-data/cloud-preview/`(git 제외). 서비스·secret 키는 쓰지 않음 |
| 직접 호출 위험 | 개발 프로젝트 한정 사용자 수용(2026-11-27). 운영 전 재검토 |
| 온라인 조회 서버 | **운영 중**(2026-11-27): AWS 같은 서버에 도커 `judoju-news-read`(조회 서버 + Caddy). 주소 `https://52-79-247-25.sslip.io`(무료 sslip.io, Let's Encrypt 자동 인증서). Lightsail 방화벽 80·443 개방(CloudShell `open-instance-public-ports`, 기존 22 유지). 배포·상태 `scripts/ops/read-gateway.ps1 deploy|status` |
| 앱 연결 | 미리보기 환경에서 `EXPO_PUBLIC_APP_ENV=preview`, `EXPO_PUBLIC_READ_MODE=PREVIEW_SYNTHETIC`, `EXPO_PUBLIC_READ_API_URL=https://52-79-247-25.sslip.io`로 클라우드 조회 확인(홈·섹터). 클라우드에는 아직 게시 기사가 없음. 설치·알림 서비스(127.0.0.1:3100)는 아직 로컬 |
| 온라인 어드민(CLOUD11-online) | **운영 중, 소유자 로그인·TOTP 등록 완료**(2026-11-27). 실측(H8): 실제 세션 값으로 capability 없음·틀림 → 42501 EDITOR_ONLY(트랜잭션 롤백), 쿠키 없음·위조 쿠키·CSRF 없는 쓰기 → 401, 다른 출처·형식 로그인 → 403, 컨테이너 재시작 뒤 세션·로그인 제한 파일 유지. 배포 중 고친 것: QR은 서버가 otpauth URI로 PNG 생성(Supabase SVG가 브라우저에서 안 보임), Windows PowerShell의 브라우저식 User-Agent를 Supabase가 secret 키에 거부 → 운영 스크립트 UA 지정, 비밀번호 재설정 `admin-online.ps1 set-password`(9자 이상, 사용자 선택). 활성화 SQL 적용(편집 권한 21·세션 권한 3·관리자 1, 익명 직접 호출 42501), 회원가입 꺼짐 확인, `https://admin.52-79-247-25.sslip.io` 배포(이미지는 PC에서 빌드해 전송, 서버 1GB라 서버 빌드 불가). Codex 구현 검수 READY. 공개 인터넷 + 보강안: 주소 `https://admin.52-79-247-25.sslip.io`(예정), 소유자 1명, 비밀번호+TOTP(aal2), 세션 capability를 DB가 확인, secret 키는 broker 컨테이너에만. 계획 `docs/cloud/cloud11-online-admin-plan.md`, 활성화 SQL `supabase/cloud/admin-online-dev/activation.sql`(가드·사후 확인 포함, 재활성화 가능), 운영 `scripts/ops/admin-online.ps1 store-secret|deploy|status|revoke`(revoke는 이 PC에서 secret 키로 DB 확인 4단계 + 영수증) |
| 게시 경로 1A(로컬) | **완료**(2026-11-27): AI 초안 6건이 로컬 접수함에 들어와 실데이터 검증·미리보기 통과(공개 노출 없음, 게시·예약은 1B까지 차단). 계획 `docs/publish-stage1-plan.md` |
| 게시 경로 1B(로컬) | **구현**(2026-11-27): 마이그레이션 59~61 로컬 적용, 한 번에 한 종류만 공개(스위치), 실데이터 게시·철회·만료, 검토 모드 조회 서버(62332)와 앱 띠·배지. 계획 `docs/publish-stage1b-plan.md` |
| 게시 경로 1C(로컬) | **구현**(2026-11-27): 마이그레이션 62 로컬 적용, 편집자가 새 AI 버전을 채택해 다시 게시, 닫힌 실데이터 이슈 정리. 계획 `docs/publish-stage1c-plan.md` |
| 게시 경로 2A(클라우드) | **적용·운영 중**(2026-11-28, 사용자 승인): CLOUD13 `20261128000108` cloud13_real_intake(로컬 56~62를 클라우드용으로 렌더링, 클라우드 관측값과 같게 만든 연습 DB에서 사전 검증, Codex READY) → 접수 전용 역할 `judoju_ai_intake`(풀러 로그인, `ai_intake.submit`·`withdraw`만, 비밀번호는 SCRAM 검증값만 SQL Editor에, 원문은 서버 `$base/intake/db.json`에만) → 어드민 채택 권한(편집 함수 22개) → 실데이터 모드 ON(공개 읽기는 합성 유지, 실데이터 게시·예약 차단 실검사) → pg_cron 켜고 `judoju-ai-inbox-cleanup` 매일 04:00 KST. 처리기 푸시 ON: 첫 전달 12건 모두 RECEIVED(클라우드 실데이터 DRAFT 12, 공개 0). 인벤토리 v4·공개 읽기 증명 재발급·조회 서버 재배포. 비상 회수 `scripts/ops/ai-intake-online.ps1 revoke`, 푸시 끄기 `scripts/ops/ai-processor.ps1 push-off` |
| 남은 것 | 온라인 어드민에서 실데이터 초안 검토·채택 화면 확인(소유자 로그인 필요), CLOUD11 남은 실측, 2B(클라우드 검토용 공개 읽기), 설치·알림 서비스 온라인화, 운영 도메인(추후) |

## AI 처리기 (같은 서버, 2026-11-28 13:05 KST 갱신: 이미지 `judoju-news-ai-processor:c36dbc7` — 기업 보도자료·뉴스룸·IR 피드 발견(367곳, 사이트당 하루 1회, robots·5초 간격, 첫 방문 3billion.io FOUND 2건)과 GNews Essential 뉴스 신호(15분마다 3요청, 첫 회 75건, 하루 최대 300회) 가동. 클라우드 CLOUD14 `20261128000109`로 실데이터 출처 369곳. 이전 갱신(11:45: 이미지 `judoju-news-ai-processor:35cfbf2` = 조정 커밋 + 2A S5 전달 대기열, 실행 모드 유지, 클라우드 푸시 ON; 아래 표의 d591f92 내용은 이전 기록)

| 항목 | 상태 |
|---|---|
| 컨테이너 | `judoju-news-ai-processor-1` (compose 프로젝트 `judoju-news-ai`), 이미지 `judoju-news-ai-processor:d591f92` (2026-11-28 KST) = 실행 중이던 `4da659e` + 실데이터 조정 커밋(`f01ea19`·`8950eee`·`0d9de38`)만 cherry-pick. **2A S5 클라우드 전달 대기열(`26e8061`)은 승인 전이라 서버에 넣지 않았다**(로컬 브랜치 `deploy/ai-4da659e-plus-tuning`, 임시 worktree에서 배포). 프롬프트 `BACKLOG_PROMPTS_V13` |
| 실행 | `JUDOJU_AI_EXECUTE=1`, 원문 읽기·AI 호출 ON, **하루 호출 상한 150**(선별 gpt-6-luna, 작성 gpt-6.1-sol, 검증 gpt-6.2-sol) |
| 근거 | DART 공시는 OpenDART API로만(관심 기업 339곳). 증권사 사이트 허가는 OFF(텔레그램 링크는 신호). 뉴스는 신호로만 |
| 결과 | 검증 통과 초안 누적 저장 15건(`issues`, 버전 포함, 게시 권한 없음). 2026-11-28 조정으로 동성화인텍(v2)·심텍 신주인수권부사채·엘앤에프 제10회 전환사채·알테오젠 마일스톤·제이앤티씨 채무보증·빛과전자 전환사채 취득 추가. 모델 호출 누적 약 250건, 하루 상한 150 |
| 입력 | 수집기 볼륨을 읽기 전용 연결로 10분마다 import |
| 설정·키 | 서버 `/home/ubuntu/.local/share/judoju-ai/config/config.json`, `secrets/openai.key`·`opendart.key`(600). 로컬 원본은 worktree `.local-data/ai/`, `.local-data/dart/` |
| 운영 | `scripts/ops/ai-processor.ps1 status|deploy [-Execute]|stop` |

## 코드에는 있지만 운영에 연결되지 않은 것

- AI 초안의 게시: 검증 통과 초안은 처리기 SQLite(`issues`)에만 있고 관리자·DB·앱으로 넘기지 않는다.
- 발견 API 어댑터: TickerTick·공급처 중립 형식 파일 가져오기(네트워크 호출 없음). Finlight 전용 어댑터 없음(문서 미확인).
- 앱 상세 화면: 1차·보도 출처 구분과 투자 권유 아님 고지 표시. DB 게시 경로는 아직 출처 구분을 넘기지 않음.
- 어드민 hosted 로그인·쓰기: 미확인(2026-11-26 상태 `control:null`, `authRoleApplied:false`).
- 원문 보관·삭제 규칙(2026-11-26): AI 처리기에 배포돼 적용 중.

## 미해결 검수

- 2026-11-26 Claude(독립 리뷰 에이전트)·Codex(`codex exec`, gpt-5.6-sol, 읽기 전용) 이중 검수: 범위 `1862249..a92892c`. P0 없음. 지적 사항은 `23874ac`에서 수정(수정본 재검수는 아직). 수용한 항목: 원문 보관 기한이 지나면 진행 중 작업이 있어도 본문을 지운다(작업은 CONTEXT_CHANGED로 안전하게 보류됨).
- Codex CLI는 ChatGPT 계정에서 `gpt-5.6-sol`·`codex-auto-review`만 사용 가능(설정의 `gpt-6.1-sol`은 거절됨).
