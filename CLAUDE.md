# 주도주뉴스 (judoju-news) — Claude 작업 지침

Read `docs/claude/STATE.md` first: current branch, what is real vs synthetic, open decisions, next step.

## 지침 우선순위
1. 사용자의 최신 직접 지시 (자율 진행, 필요한 검수만, 반복 승인 질문 금지).
2. 이 CLAUDE.md와 `docs/claude/STATE.md`.
3. `AGENTS.md`의 이 문서와 충돌하지 않는 조항. AGENTS.md의 단계별(PARALLEL4/MAIN_*/C2) 규칙은 과거 단계 기록이다.
   현재 작업이 그 단계의 파일·guard를 직접 건드릴 때만 적용하고, 역사 guard·pin·검수 기록은 지우거나 약화하지 않는다.
4. 기획: `docs/reference/planning/` (공통-운영계약 v1.0, 서비스 v1.6, 어드민 v1.1, 제작계획 v1.3, 뉴스운영 v1.1, 홈순위 개정안 v1.0).
   최신 사용자 결정이 기획보다 우선 (예: 앱에 현재가·등락률·섹터 평균·조회수·내부 점수 표시 안 함).

## 절대 하지 않는 것 (사용자의 명시적 현재 승인 없이)
- 링크 수집 재시작 (2026-11-21 사용자 중지). AWS/SSH, 원격 worker, Docker 수집 컨테이너 조작.
- hosted Supabase 쓰기·migration·link, 관리자 C2 활성화, 키/Auth 변경.
- EAS build/submit/update, 결제·구독·약관 수락, 유료 AI 호출.
- main 브랜치 push, force push. 비밀키·.env·`.local-data`·원문 DB를 읽거나 커밋.
`.claude/hooks/guard.mjs`가 이 중 다수를 Bash 단계에서 막는다. 승인받은 경우에만 해당 명령 하나에 `JUDOJU_USER_APPROVED=1 `를 붙이고 응답에 밝힌다.

## Environment
- Node 24.15.0 + pnpm 11.25.0 (engineStrict). Cloud env `stocknews` setup script installs Node to `/opt/node24`;
  the SessionStart hook puts it first on PATH. If `node -v` is not v24.15.0: `export PATH=/opt/node24/bin:$PATH`.
- `pnpm install --frozen-lockfile`. Docker daemon is usually absent in cloud sessions (3 P4 SQL tests fail for that reason only).
- Changing `apps/mobile/package.json` or `pnpm-lock.yaml` requires a new native runtime version and EAS builds
  (`scripts/verify-native-release.mjs`). Avoid dependency changes unless a native build is planned.

## Run & verify
- App without Docker/keys: `pnpm dev:read` (127.0.0.1:62330, SYNTHETIC data) then `cd apps/mobile && npx expo start --web`.
- Fast checks: `pnpm -s run check:types`; relevant `node --test tests/<file>`; all unit tests:
  `node --experimental-vm-modules --experimental-strip-types --test tests/*.test.mjs tests/*.test.ts`.
- `pnpm verify` is the full product gate (includes builds/exports; needs Docker for some steps). Never weaken a check to pass.

## 작업 방식
- 개발 브랜치는 `feat/collector-ai-integration`에서 분기. `main`(99a83e6)은 오래된 기준.
- 구현은 직접, 변경과 관련된 시험만 실행. 중요한 변경은 `reviewer` 서브에이전트 검수 후 Codex 교차 검수 권장
  (같은 모델 서브에이전트 검수는 완전 독립 검수가 아님을 결과에 밝힌다).
- 합성/개발 데이터는 반드시 SYNTHETIC로 표시. 구현된 것과 실제 연결된 것을 구별해 보고한다.
- 작업 단위가 끝나면 `docs/claude/STATE.md`를 갱신하고 커밋한다.
