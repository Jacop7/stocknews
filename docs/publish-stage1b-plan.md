# 게시 경로 1B 계획: 실데이터 게시와 공개 읽기 (로컬, 2026-11-27, 1차)

1A(`docs/publish-stage1-plan.md`)에서 AI 초안을 받아 검토·미리보기까지 했다. 1B는 편집자가 승인한 실데이터 기사를 **로컬에서** 게시하고, 로컬 앱의 별도 검토 모드에서 읽는 단계다. 클라우드 미리보기·운영은 2단계(별도 계획)다.

## 현재 구조의 전제 (조사 결과)

- 게시는 `public.m1_publish_draft` → `private.reservation_publish_core`(1A 차단 래퍼) → `_v1` → `private.m1_prepare` → `private.m0_publish_legacy` 순서다. `m0_publish_legacy`는 `REAL_PUBLICATION_NOT_ENABLED_STAGE_4`로 실데이터를 막고, 로컬 환경만 허용한다.
- 공개 읽기에는 1A 울타리(`sample_kind='SYNTHETIC'`)가 다음 경로에 직접 걸려 있다.
  - `m1_current_evidence`, `is_news_visible`(news_public RLS), `m0_get_public_article_legacy`, `resolve_issue`
  - 카탈로그 목록·검색·저장·종목 상세는 `m1_current_evidence`를 거친다.
- 읽기 계약:
  - `m1_public_identity`는 `sampleKind:"SYNTHETIC"`, `contract:"M1"`를 고정으로 돌려준다.
  - 로컬 조회 서버(`scripts/public-read-gateway.mjs`, 모드 `LOCAL_SYNTHETIC`)와 카탈로그·검색 응답 검사(`scripts/catalog/public-route.mjs`, `search-route.mjs`)는 항목의 `sample_kind`가 `SYNTHETIC`가 아니면 502를 돌려준다.
  - 앱(`apps/mobile/src/data/read-target.ts`)은 모드 `LOCAL_SYNTHETIC`/`PREVIEW_SYNTHETIC`만 알고, 응답의 `mode`가 같아야 받는다.
- 사실(claim)은 `valid_until`(접수+30일)이 지나면 `m1_current_evidence`가 거짓이 된다. 그러면 게시된 기사도 `CORRECTION_PENDING`으로 보인다. 1A의 30일 정리는 미게시 초안만 지운다.
- AI 철회(`ai_withdraw_draft`)는 게시된 이슈에서 `AI_ISSUE_NOT_DRAFT`로 실패한다(1A에는 게시본이 없었다).

## 1B 범위 (로컬)

### B1. 두 번째 스위치와 읽기 모드 (마이그레이션 59)

- `private.real_mode`에 `public_read_enabled boolean not null default false`를 추가한다.
  - 켤 수 있는 조건은 `enabled`와 같다(로컬 환경, postgres 운영 SQL만).
  - `private.real_read_on()` = `real_mode_on() and public_read_enabled`.
- 울타리 조건을 `sample_kind='SYNTHETIC' or (sample_kind='PERMITTED_REAL' and private.real_read_on())`으로 바꾼다. 대상은 1A 울타리를 건 모든 곳이다.
  - 스위치가 꺼져 있으면 1A와 똑같이 동작한다.
- `m1_public_identity`:
  - `real_read_on()`이면 `sampleKind:"REVIEW_REAL"`, `contract:"M1R"`을 돌려준다.
  - 아니면 지금 값 그대로다(클라우드 미리보기의 M1 계약 불변).
- 공개 응답 항목에는 이미 `sample_kind`가 있다. 실데이터 항목은 출처 링크(공시 원문)와 고지를 본문에 포함한다(공개 본문 생성은 기존 `public_body`).

### B2. 실데이터 게시 (마이그레이션 59)

- `reservation_publish_core` 1A 차단을 바꾼다. `PERMITTED_REAL`은 `real_read_on()`일 때만 게시할 수 있다(`REAL_PUBLICATION_NOT_ENABLED_1A` → 스위치가 꺼져 있으면 `REAL_PUBLIC_READ_OFF`).
- `m0_publish_legacy`의 단계 4 차단은 실데이터 경로에서 `real_read_on()`이면 통과시킨다. 래퍼 방식으로, 기존 합성 경로는 불변이다.
- 게시는 `m1_prepare`(1A의 실데이터 검증기)를 그대로 거친다. 즉, 실데이터 MACRO는 공식 원문만, COMPANY는 영향 0개 허용이다.
- 예약 게시는 1B에서도 막는다(`reservation_create` 1A 차단 유지). 예약은 후속 단계로 미룬다.
- **게시된 사실의 수명**: 게시하는 순간 그 이슈의 claim `valid_until`을 비운다(null). 근거 기록(`ai_draft_origin`)과 claim 연결은 게시된 이슈에서 정리 대상에서 뺀다.
  - 보관하는 것은 사실 문장·검증 등급·출처 링크뿐이다(원문 없음).
  - 30일 규칙은 미게시 초안에만 적용한다(`publish-path.md`의 보관 규칙과 같음).

### B3. 게시된 실데이터의 철회 (마이그레이션 59)

- `ai_withdraw_draft`가 게시된 이슈를 만나면 지우지 않는다.
  - 이슈를 `CORRECTION_PENDING`으로 바꿔 공개 목록·상세에서 즉시 숨긴다(기존 상태 전이 함수 사용).
  - 감사 기록을 남기고, 링크는 `WITHDRAWN`으로 둔다.
  - 편집자는 어드민에서 사유를 보고 정정 게시나 철회를 결정한다.
- 같은 AI 이슈의 새 버전이 게시된 뒤에 들어오면, 지금처럼 편집자 보호(`HOLD_EDITOR`)로 처리한다. 게시가 `manual_protected=true`를 세우기 때문이다.

### B4. 로컬 조회 서버와 앱

- 로컬 조회 서버에 새 모드 `LOCAL_REVIEW_REAL`을 둔다(별도 포트 62332, 설정 파일로 선택).
  - 시작할 때 정체 확인: `sampleKind:"REVIEW_REAL"`, `contract:"M1R"`이 아니면 시작하지 않는다.
  - 항목 검사는 `sample_kind`가 `SYNTHETIC` 또는 `PERMITTED_REAL`이면 통과시킨다. 기존 `LOCAL_SYNTHETIC` 모드의 검사(합성만)는 그대로다.
  - 실데이터 스위치가 켜진 동안 `LOCAL_SYNTHETIC` 서버는 정체가 맞지 않아 시작하지 않는다(섞임 방지). 두 모드는 동시에 쓰지 않는다.
- 앱(`read-target.ts`)에 모드 `LOCAL_REVIEW_REAL`을 추가한다(로컬 주소 62332, 개발 환경에서만).
  - 화면 상단에 "내부 검토용 실데이터 · 투자 권유 아님" 띠를 항상 표시한다.
  - 실데이터 기사에는 "공시 기반" 배지와 출처 링크(공시 원문)를 보여준다. 고지 문구는 기존 것을 쓴다.
- 홈·섹터·종목 화면과 저장·검색은 같은 응답 형식이라 추가 화면 변경은 배지와 띠뿐이다.

### B5. 어드민

- 실데이터 초안의 게시 버튼은 `real_read_on()`일 때만 보인다. 서버가 초안 정보에 `real_publish_allowed`를 함께 준다. 예약 위젯은 계속 숨긴다.
- 게시된 실데이터가 철회되면(`CORRECTION_PENDING`) 목록에 "출처 철회 · 확인 필요" 표시를 단다.

### B6. 시험

- DB(되돌리는 트랜잭션):
  - 공개 읽기 스위치 꺼짐: 1A 울타리 시험이 그대로 통과(실데이터 게시 자체가 거부).
  - 켜짐: 실데이터 게시 성공. 공개 읽기 10개 경로 모두에서 보임(익명·로그인). 정체가 `REVIEW_REAL`/`M1R`.
  - 게시 뒤 claim `valid_until` null. 30일 정리가 게시본을 건드리지 않음. 철회 시 `CORRECTION_PENDING`이 되고 공개에서 사라짐.
  - 스위치를 다시 끄면 게시된 실데이터가 공개에서 사라짐(울타리 복귀).
  - 예약은 계속 거부.
- 조회 서버: `LOCAL_REVIEW_REAL` 정체 확인, 실데이터 항목 통과, `LOCAL_SYNTHETIC`은 실데이터 항목과 정체 불일치를 거부.
- 앱: 모드 해석, 띠·배지 표시(기존 앱 시험 방식).
- 실측: 1A에서 받은 실제 초안 1~2건을 어드민에서 게시하고, 로컬 앱 웹(검토 모드)에서 홈·종목 화면을 확인한다.

## 하지 않는 것

클라우드 반영(2단계), 예약 게시, 보도(REPORTED) 출처와 독립 출처 3개 연결(`evidence_edges`), 자동 게시, 운영 DB.

## 사용자 결정이 필요한 것

- 게시된 실데이터 사실은 기사와 함께 계속 보관한다(B2). 이것이 "사실 기록 30일" 규칙의 예외가 된다. 미게시 초안은 30일 그대로다.
