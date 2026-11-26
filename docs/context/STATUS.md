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

## 코드에는 있지만 운영에 연결되지 않은 것

- AI 원문 처리(`workers/ai-processing/runtime`): 원문 확인 → 선별 → 사실 추출 → 작성기(사실만 입력) → 독립 검증. 실제 AI 키·모델·예산이 없어 합성 응답으로만 검증. 서버에 배포되지 않음.
- 발견 API 어댑터: TickerTick·공급처 중립 형식 파일 가져오기(네트워크 호출 없음). Finlight 전용 어댑터 없음(문서 미확인).
- 앱 상세 화면: 1차·보도 출처 구분과 투자 권유 아님 고지 표시. DB 게시 경로는 아직 출처 구분을 넘기지 않음.
- 어드민 hosted 로그인·쓰기: 미확인(2026-11-26 상태 `control:null`, `authRoleApplied:false`).
- 원문 보관·삭제 규칙(2026-11-26): 코드 반영, AI 처리기 미배포라 실제 적용 전.

## 미해결 검수

- 2026-11-26 Claude(독립 리뷰 에이전트)·Codex(`codex exec`, gpt-5.6-sol, 읽기 전용) 이중 검수: 범위 `1862249..a92892c`. P0 없음. 지적 사항은 `23874ac`에서 수정(수정본 재검수는 아직). 수용한 항목: 원문 보관 기한이 지나면 진행 중 작업이 있어도 본문을 지운다(작업은 CONTEXT_CHANGED로 안전하게 보류됨).
- Codex CLI는 ChatGPT 계정에서 `gpt-5.6-sol`·`codex-auto-review`만 사용 가능(설정의 `gpt-6.1-sol`은 거절됨).
