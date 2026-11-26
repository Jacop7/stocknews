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
| 이미지 | `judoju-news-html-collector:newonly-db1093c` (소스 `db1093c`) |
| 웹 수집 | 켜짐 (`JUDOJU_PUBLIC_WATCH=1`), 활성 37곳 |
| 텔레그램 링크 수집 | 켜짐 (`JUDOJU_TELEGRAM_LINKS=1`), 공개 채널 47개, 2026-11-26부터 신규 게시물만 |
| 방문 간격 | 같은 호스트 5~8초, 다른 호스트 사이 1~3초 |
| 상태 확인 | `scripts/ops/collector.ps1 status` |
| 배포·되돌리기 | `scripts/ops/collector.ps1 deploy` / `rollback` (아래 NEXT의 주의 참고). 2026-11-26 실제 서버에서 status·deploy(`release-4cf5ffd`, 기능 동일)·rollback을 시험했고 현재는 rollback 결과인 `newonly-db1093c`로 운영 중 |
| 접속 키 | worktree의 `.local-data/collector-cloud/ssh-lightsail/` (git 제외, 채팅·로그에 내용 출력 금지) |

## 코드에는 있지만 운영에 연결되지 않은 것

- AI 원문 처리(`workers/ai-processing/runtime`): 원문 확인 → 선별 → 사실 추출 → 작성기(사실만 입력) → 독립 검증. 실제 AI 키·모델·예산이 없어 합성 응답으로만 검증. 서버에 배포되지 않음.
- 발견 API 어댑터: TickerTick·공급처 중립 형식 파일 가져오기(네트워크 호출 없음). Finlight 전용 어댑터 없음(문서 미확인).
- 앱 상세 화면: 1차·보도 출처 구분과 투자 권유 아님 고지 표시. DB 게시 경로는 아직 출처 구분을 넘기지 않음.
- 어드민 hosted 로그인·쓰기: 미확인(2026-11-26 상태 `control:null`, `authRoleApplied:false`).
- 원문 보관·삭제 규칙(2026-11-26): 코드 반영, AI 처리기 미배포라 실제 적용 전.

## 미해결 검수

- Claude·Codex 이중 검수: 이 브랜치의 2026-11-26 커밋들(`4724a33`~`4cf5ffd`)은 검수 전이다. 검수를 통과했다고 표시하지 않는다.
