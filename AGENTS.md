- Do not pause to ask for confirmation during multi-step tasks.
- Proceed autonomously until implementation, debugging, and verification are fully complete.
- 현재 작업에 실행 가능한 다음 단계가 있으면 같은 실행에서 바로 수행한다. 진행 상황, 계획, 안내만 남기고 응답을 종료하지 않는다.
- 한 단계가 차단되면 독립적으로 진행 가능한 작업을 먼저 이어간다. 요청한 범위를 완료했거나 더 진행하려면 사용자 입력 또는 외부 상태 변경이 꼭 필요할 때 결과를 전달한다.

# 주도주뉴스 제품 작업 지침

- 여러 작업을 이어갈 때는 [개발 작업 재개](docs/development-continuation.md)의 실행 기록을 확인한다. 대기 중인 작업의 원인을 남기고 독립 작업을 계속 진행한다. 검증 완료가 기록된 커밋은 유효한 증거를 재사용한다.
- 이 저장소는 완전 신규 제품이다. 식자재 관리앱 코드/설정/데이터/DB/인증/키/worker/Docker/배포를 읽어 가져오거나 연결하지 않는다.
- 기획 권위는 docs/reference/planning/공통-운영계약-v1.0.md, 제작 순서는 제작 실행계획 v1.3이다. 사용자 최신 지시가 우선이다.
- 읽기와 상태 확인은 바로 진행한다. 새 설계가 실제 운영 데이터, 공개·관리자 권한, 외부 발송 또는 되돌리기 어려운 변경의 범위를 정할 때 착수 전 검수를 한다. 작성 결과는 관련 시험 후 Claude 브라우저와 Codex Ultra에 변경분을 검수자별 한 번 제출한다. 같은 후보의 유효한 검사·검수 결과를 재사용하고, 차단 결함을 수정했을 때 관련 변경만 다시 검수한다.
- 기본 개발 root는 현재 저장소다. 다른 제품 경로 mutation 금지. 고유 Supabase 프로젝트/로컬 포트·Docker 자원·Expo 앱/EAS·키·배포를 새로 만든다.
- PENDING/null 자원은 연결 승인이나 실제 생성 증거가 아니다. 미확인 endpoint에는 migration/seed/쓰기/발송을 하지 않는다.
- 비밀키·실제 .env·인증서·원시 대화는 커밋/로그에 넣지 않는다. 미등록 외부 통신·계정 권한 확대·비용/약관 수락은 필요한 사용자 확인을 거친다.
- 앱·서버·DB·배포 동작에 영향을 주거나 적용 중인 완료 조건이 요구할 때 `pnpm verify`를 실행한다. 문서나 독립 개발 도구 변경은 관련 검사와 등록된 필수 검사를 적용한다. 0단계 계약 분기는 `verify-foundation.mjs`에 보존하고 해당 단계의 추가 검사를 함께 실행한다. 검사 약화로 통과시키지 않는다.
- 검수 원문·검사 출력·커밋 연결은 ../outputs/development-stages/reviews/에 둔다. 검수된 제품 바이트를 결과 기록 때문에 바꾸지 않는다.

- 홈 시간·순위 정책은 사용자 최신 지시 → docs/reference/planning/홈순위-운영개정안-v1.0-20261115.md → 기존 기획의 비충돌 조항 순이다. 뉴스 처리 24시간과 홈 5분 스냅샷은 별개다.
- PARALLEL4_G0A는 공통 합성 데이터 계약·메모리 저장 모형 준비만 한다. 네 개발 작업의 실제 격리·모델/검수 위임·라우팅 활성화가 검증되기 전에는 포크·공유 작업 디렉토리·실제 수집/게시/DB 연결을 시작하지 않는다.

- PARALLEL4_G0B는 MAIN의 K1 의미·완료 이력 합성 검증 준비다. 실제 child/라우팅/검수 위임·관리자/DB/수집/게시를 활성화하지 않는다. 기존 G0A·과거 guard는 바이트 보존하고 G0B 전용 guard로 현재 소스를 확인한다.

- MAIN_AI_A1은 MAIN 직접 작성한 순수 합성 메타데이터 제안 검증이다. 실제 AI 호출·사실 검증·수집·게시·DB·이전 원격 worker 재시도를 활성화하지 않는다. A1 결과는 K1 판정이 아니며 후속 변환 계약이 필요하다. 기존 검사와 역사 guard는 보존하고 A1 전용 guard를 우선 선택한다.

- MAIN_SOURCE_R1은 동일 backend lifetime 안의 원문 저장 영수증·응답 유실 복구 합성 계약이다. 실제 수집·DB·영속 재시작·다중 writer·나머지 공유 계약을 활성화하지 않는다. 불명 작업은 새 key로 재시도하지 않는다. R1 guard는 기존 전체 검사와 세 Node-only 모듈의 앱 경계를 이어받는다.

- MAIN_PARALLEL_P1은 사용자 개별 오더에 따른 MAIN acquisition·native collector inventory·native home 명령 어댑터의 source-only 병렬 구현이다. 담당자별 정확 세 파일만 작성하고 MAIN만 공통 파일·전체 검사·검수·Git을 수행한다. 이 운영 지시는 OS sandbox/인증정보 접근의 기술적 격리 증명이 아니며 .env/private/다른 제품 접근을 허용하지 않는다. 기존 원격 PLAN3/3·HOLD·Router와 실제 수집/AI/DB/게시를 활성화하지 않는다.

- MAIN_PARALLEL_P2는 기존 native collector/home 담당의 정확 신규 세 파일과 MAIN event-routing 두 파일을 병렬 구현한다. partition checkpoint는 source K1과 별개인 합성 journal이고, 게시/근거 binding과 semantic delta는 fixture assertion이다. 실제 수집·AI 검증·게시·DB·Router/원격3회 재시도를 활성화하지 않는다. 기존 P1 경계와 운영상 읽기 제한·MAIN 통합 책임을 그대로 유지한다.

- MAIN_PARALLEL_P3는 MAIN이 AI 입력·관리자 수명 처리를 직접 작성하고 기존 collector/home 작성자가 지정 네 파일만 작성한다. 실제 연결 없는 OFFLINE_REPLAY 경계이며 권한·현재 관측은 fixture assertion이다. MAIN만 전체 통합·검수·Git을 수행하고 실제 수집/AI/DB/권한/게시/원격 실행기를 활성화하지 않는다. 기존 계획·검수·회차와 미해결 P3는 보존한다.

- MAIN_ADMIN_C1B는 MAIN 직접 관리자 host·fixture 설정 writer·소유 Windows Job 준비다. 실제 loader는 private I/O 전 비활성화하고 official framework 실행은 metadata 환경 경계와 controlled env를 먼저 적용한다. ACTUAL/Auth/DB/권한/게시/worker를 활성화하지 않으며 전체 native 시험·DUAL·백업 후 커밋한다. 기존 P3·원격 HOLD와 운영상 격리 한계를 유지한다.

- MAIN_PARALLEL_P4는 검수된 별도 collector 8개·HOME 6개 신규 소스와 MAIN 직접 AI bridge·통합 8개 신규/기존 5개 공통 파일만 작성한다. 두 담당은 지정 소스와 시험 작성만 수행하고 MAIN이 전체 시험·새 독립 합성 PostgreSQL 자원·통합 검수·Git을 맡는다. 각 DB의 현재 읽기와 역사 receipt를 구별하며 물리 COMMIT 시각 권한·산식 인증·교차 worker 원자성을 보증하지 않는다. 실제 사이트/텔레그램/외부 AI/게시/Auth/hosted DB/운영 worker와 관리자 C2는 활성화하지 않는다. 기존 source·검사·미해결 P3·원격 HOLD 및 회차를 유지한다. 읽기 제한 지시는 OS sandbox 증명이 아니다.


## MAIN_PARALLEL_NEXT first slice

The 24-file plan manifest 12d49813d102cb4d3e11a32aeff427e8a14b514fd1f74e84f552bc8e6f276052 passed independent Claude and Codex plan review. Preserve the historical P4 guard and its pins. The NEXT guard selects the new 555-file historical base, 10 mutable files and 7 additions. Actual provider, Auth, publication and cloud worker activation remain disabled. Run new diagnostic resources separately from normal collector CORE/FINAL and HOME acceptance. MAIN owns AI, admin and integration; collector and HOME author patches only their two assigned files. No credential or OS isolation is implied by author instructions.

## MAIN_ADMIN_C2 connection code

The reviewed C2 r2 plan with r3 contract amendment permits exactly 15 mutable files and six additions over bab66bc (547 historical files frozen). The rpc-contract.json change is restricted to templateSha256 only. This commit prepares a one-use, 30-minute dev admin host, fixed owner binding, current DB authorization fences and private Windows file handling. Import/build/test do not activate it. Actual selected-key reads, Auth metadata elevation and activation SQL require the separate exact human confirmation described by the reviewed plan and line 8 above. Preserve all historical guards, test commands, P3 findings, remote holds and isolated fixture boundaries. This source is not proof of an actual hosted login, production readiness, OS account isolation or a scoped PAT. MAIN owns integration, dual review and Git.


## MAIN_ADMIN_C2 remediation design r3 (implementation WIP)

The same-case subordinate design f71f7bc0eeea42f3a693647445c08226c6e7a294ce5b87d570bbdc57e7235414 received explicit Claude and Codex plan READY; overall implementation remains CHANGES_REQUIRED. The narrow approved amendment adds scripts/admin-preview-sql.mjs and tests/preview-admin-sql.test.mjs to the prior15 mutable files:17 existing,6 additions,545 frozen,total568. Preserve the historical single-definition SQL assertion against the authenticated bab66bc blob and add exact current3 replacements+1 private helper checks. Keep all other historical tests/guards/commands frozen. READ COMMITTED authority, shared/exclusive transaction advisory fence, current post-lock capability and strict pre-key setup reserve are mandatory. Source pins must be refreshed only after the entire remediation is finished; do not represent direct partial test passes as full verify or implementation acceptance. The three default manifests are consumed; final implementation review requires the exact installed single-additional-revision procedure for the concrete final candidate, without case/criteria/reset. No actual hosted/key/Auth/SQL/host activation occurs from this amendment. MAIN owns all remediation and integration.
