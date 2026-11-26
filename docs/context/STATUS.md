# 현재 상태 (STATUS)

새 세션은 이 파일 → `DECISIONS.md` → `NEXT.md` 순서로 읽고 시작한다. 원시 대화나 긴 인수인계 문서 대신 이 세 파일을 맥락의 기준으로 삼는다. 배포·큰 변경 직후 이 파일을 갱신한다.

기준 시각: 2026-11-26 (KST)

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
| 웹 수집 | 켜짐 (`JUDOJU_PUBLIC_WATCH=1`), 활성 37곳 |
| 텔레그램 링크 수집 | 켜짐 (`JUDOJU_TELEGRAM_LINKS=1`), 공개 채널 47개, 2026-11-26부터 신규 게시물만 |
| 방문 간격 | 같은 호스트 5~8초, 다른 호스트 사이 1~3초 |
| 상태 확인 | `scripts/ops/collector.ps1 status` |
| 배포·되돌리기 | `scripts/ops/collector.ps1 deploy` / `rollback` (아래 NEXT의 주의 참고). 2026-11-26 실제 서버에서 status·deploy·rollback을 시험했고, 검수 수정본을 이 스크립트로 배포함 |
| 접속 키 | worktree의 `.local-data/collector-cloud/ssh-lightsail/` (git 제외, 채팅·로그에 내용 출력 금지) |

## AI 처리기 (같은 서버, 2026-11-26 23:50 KST)

| 항목 | 상태 |
|---|---|
| 컨테이너 | `judoju-news-ai-processor-1` (compose 프로젝트 `judoju-news-ai`), 이미지 `judoju-news-ai-processor:725ac4b` (2026-11-27 KST), 프롬프트 `BACKLOG_PROMPTS_V10`(글 범위 COMPANY, 종목 기사는 섹터 블록 없음, 핵심 이슈는 사실만, 연관 섹터는 수혜·피해가 없을 때만) |
| 실행 | `JUDOJU_AI_EXECUTE=1`, 원문 읽기·AI 호출 ON, **하루 호출 상한 150**(선별 gpt-6-luna, 작성 gpt-6.1-sol, 검증 gpt-6.2-sol) |
| 근거 | DART 공시는 OpenDART API로만(관심 기업 339곳). 증권사 사이트 허가는 OFF(텔레그램 링크는 신호). 뉴스는 신호로만 |
| 결과 | **검증 통과 초안 3건**(`DRAFT_READY`, 게시 권한 없음): 심텍 전환사채·신주인수권부사채, 하나금융지주 사채 한도 정정. 모델 호출 누적 100건 |
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
