# 주도주뉴스 제품 작업 지침

- 이 저장소는 완전 신규 제품이다. 식자재 관리앱 코드/설정/데이터/DB/인증/키/worker/Docker/배포를 읽어 가져오거나 연결하지 않는다.
- 기획 권위는 docs/reference/planning/공통-운영계약-v1.0.md, 제작 순서는 제작 실행계획 v1.3이다. 사용자 최신 지시가 우선이다.
- 단계 계획을 Claude 브라우저와 독립 Codex Ultra 검수한 뒤 해당 범위 구현, 자체 시험 후 구현 재검수한다. 결과는 실제 범위와 한계를 명시한다.
- 기본 개발 root는 현재 저장소다. 다른 제품 경로 mutation 금지. 고유 Supabase 프로젝트/로컬 포트·Docker 자원·Expo 앱/EAS·키·배포를 새로 만든다.
- PENDING/null 자원은 연결 승인이나 실제 생성 증거가 아니다. 미확인 endpoint에는 migration/seed/쓰기/발송을 하지 않는다.
- 비밀키·실제 .env·인증서·원시 대화는 커밋/로그에 넣지 않는다. 미등록 외부 통신·계정 권한 확대·비용/약관 수락은 필요한 사용자 확인을 거친다.
- 현재 필수 검사: pnpm verify. 0단계 계약 분기는 verify-foundation.mjs에 보존하며 현재 단계의 추가 검사를 함께 실행한다. 이후 단계에서 실제 코드에 맞는 시험을 추가한다. 검사 약화로 통과시키지 않는다.
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
