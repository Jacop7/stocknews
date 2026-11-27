# 게시 경로 1단계 계획: AI 초안함과 실데이터 모드 (로컬, 2026-11-27)

`docs/publish-path.md`의 1단계를 구현 단위로 나눈 계획이다. 사용자 결정(2026-11-27): 로컬에서 시작해 클라우드 미리보기까지, 사람 승인 후 게시, 푸시 접수(1단계는 풀), 섹터 영향 없는 종목 기사 허용.

## 현재 구조의 전제 (조사 결과)

- 모든 게시·읽기 경로가 합성 데이터만 받는다. DB 마이그레이션 27개에 `SYNTHETIC` 조건이 약 80곳 있다.
  - `private.m1_prepare`: 이슈·사실·섹터가 `SYNTHETIC`이어야 하고, 출처 URL은 `https://*.invalid`만 된다.
  - `private.catalog_sector_selectable(sector, catalog, mode)`: mode가 `SYNTHETIC`이고 환경이 `local`일 때만 참이다. 참조 카탈로그(`LOCAL_REFERENCE`) 섹터는 `sample_kind`가 비어 있다(참조 메타데이터).
  - 공개 읽기(`m1_public_article`, 카탈로그 목록·검색·종목 상세)는 `sample_kind='SYNTHETIC'`만 돌려준다. `m1_public_identity`는 `sampleKind:"SYNTHETIC"` 고정이다.
  - M0 게시 함수에는 실데이터 게시 금지(`REAL_PUBLICATION_NOT_ENABLED_STAGE_4`)가 명시돼 있다.
- 조회 서버와 앱은 `sample_kind`가 `REAL`이면 502로 거부한다. 모드 이름도 `LOCAL_SYNTHETIC`·`PREVIEW_SYNTHETIC`다.
- `private.sample_kind` 열거형에는 이미 `PERMITTED_REAL`이 있다.
- AI 처리기(서버, SQLite)의 `issues` 행이 `DRAFT_READY` 초안이다. 열은 `payload`(초안 JSON), `fact_ids`, `version`이다.

따라서 실데이터를 공개 읽기까지 여는 것은 읽기 계약(M1)을 바꾸는 일이다. 1단계를 둘로 나눈다.

## 1A: 접수와 편집 검토 (공개 노출 없음) — 이번 범위

### A1. 실데이터 모드 스위치 (마이그레이션 56)

- `private.real_mode`: 한 행 테이블. 열은 `enabled boolean default false`, `allowed_source_hosts text[]`, `changed_at`, `note`.
  - API 역할(anon·authenticated·service_role)에는 권한을 주지 않는다. 바꾸는 방법은 postgres로 실행하는 운영 SQL뿐이다.
  - 1A에서는 `runtime_identity.environment='local'`일 때만 `enabled=true`가 될 수 있다(제약 트리거).
- `private.real_mode_on()`: `enabled`이면서 환경이 local일 때만 참. 실데이터 판단은 모두 이 함수 한 곳을 거친다.
- 허용 출처 호스트의 초기값은 서버 설정에서 ENABLED인 공식 출처다(`dart.fss.or.kr`, `kind.krx.co.kr` 등). 목록은 마이그레이션에 고정하고, 바꾸려면 마이그레이션이 필요하다.

### A2. 게시 검증 확장 (마이그레이션 56)

`private.m1_prepare`(현재 54번 정의)를 감싼다. 기존 합성 경로는 그대로 둔다.

- 이슈가 `PERMITTED_REAL`이면 다음이 모두 참이어야 한다.
  - `real_mode_on()`이 참이다.
  - 근거로 쓰는 사실(claims)이 모두 같은 이슈, 같은 `PERMITTED_REAL`이다.
  - 출처 URL은 `https://`이고 호스트가 `allowed_source_hosts`에 정확히 있다(하위 도메인 자동 허용 없음).
  - 섹터는 `catalog_sector_selectable(..., 'PERMITTED_REAL')`이 참이다. `LOCAL_REFERENCE` 카탈로그(참조 메타데이터, `sample_kind` 없음)만 허용하고, 합성 픽스처 섹터는 거부한다.
- 합성 이슈에는 실데이터 사실이나 실제 URL을 섞을 수 없다(반대 방향도 거부).
- `m1_publish_draft`는 1A에서 `PERMITTED_REAL` 이슈를 거부한다(`REAL_PUBLICATION_NOT_ENABLED_1A`). 미리보기(`m1_preview_draft`)는 허용한다.

### A3. AI 초안 접수 (마이그레이션 57)

- `private.ai_draft_receipts`: 열은 `effect_key`(PK, `ai:` + AI 이슈 ID + 초안 버전 해시), `payload_sha256`, `issue_id`, `state`(`RECEIVED`/`WITHDRAWN`), `received_at`.
- `private.ai_ingest_draft(effect_key, payload)`: security definer, postgres 소유.
  - 같은 키와 같은 해시면 같은 결과를 돌려준다. 같은 키에 다른 해시면 `AI_DRAFT_CONFLICT`.
  - 페이로드는 `AI_DRAFT_V1` 형식을 정확히 검증한다. 키 집합, 길이, URL 규칙(A2와 같음), 사실 수 상한(30)을 본다. 원문 본문 필드가 있으면 거부한다.
  - story는 `event_key='ai:'||AI 스토리 키`로 하나 만들거나 찾는다. issue는 `angle_key`, `sample_kind='PERMITTED_REAL'`, `manual_protected=false`로 만든다.
    - 같은 AI 이슈의 새 버전이면 미게시일 때만 초안을 바꾼다.
    - 편집자가 이미 고친 초안(`editor_drafts.updated_by` 있음)이면 덮지 않고 `HOLD_EDITOR`를 돌려준다.
  - 사실은 `private.claims`로 들어간다(사실 1개 = claim 1개, `sample_kind='PERMITTED_REAL'`).
    - `verified`: 독립 검증 통과 여부.
    - `korea_path_verified`: 한국 상장사·섹터 경로 검증 통과 여부.
    - `fact_current`: 접수 시점에 신선도 기준(사실 기록 30일) 안인지.
    - `official_original`: 출처 역할이 PRIMARY(공시)인지.
    - `valid_until`: 사실 기록 만료일.
  - 편집 초안(`editor_drafts.content`)은 `publish-path.md` 매핑표대로 만든다. `evidence_ids`는 위 claim ID다. 출처·사실·검증 결과는 `content.ai_origin`(편집 화면 표시용, 공개 본문에는 안 나감)에 넣는다.
  - `private.audits`에 접수 기록을 남긴다.
- 호출 경로(1A): 운영 스크립트가 로컬 DB에 postgres로 호출한다(풀 방식). API 역할에는 실행 권한을 주지 않는다. 2단계에서 전용 로그인 역할과 `public.ai_submit_draft_v1` 래퍼를 만든다.
- 철회: `private.ai_withdraw_draft(effect_key, reason)`. 미게시면 초안을 지우고 `WITHDRAWN`으로 둔다. 1A에는 게시본이 없다.

### A4. 매핑 모듈과 풀 스크립트

- `workers/ai-processing/runtime/publish-map.mjs`: AI 초안(+사실·검증 결과) → `AI_DRAFT_V1` 페이로드. 순수 함수로 만들고 시험한다.
  - COMPANY는 영향 0개를 허용한다. 대표 섹터는 영향이 있으면 첫 수혜→피해 섹터, 없으면 null이다.
  - 조건부(RELATED) 섹터는 저장만 하고 화면에 내보내지 않는다(55번 규칙).
  - 카탈로그 ID 대응: 서버 카탈로그 섹터·기업 ID는 로컬 참조 카탈로그와 같은 원천(`scripts/backlog-server-config.mjs`)이다. 대응이 없으면 그 초안은 보류한다(`CATALOG_REF_MISSING`).
- `scripts/ops/ai-drafts-pull.ps1`: SSH로 서버 AI 저장소에서 `DRAFT_READY` 초안을 읽기 전용으로 가져온다. 매핑 뒤 로컬 DB의 `ai_ingest_draft`를 부르고, 결과 영수증을 `.local-data/ai-inbox/`(git 제외)에 남긴다.

### A5. 어드민 표시

- 초안 목록에 `AI 초안 · 실데이터` 배지를 붙인다.
- 편집 화면에 근거 사실, 검증 결과, 출처(1차·보도)를 함께 보여준다(`ai_origin`).
- 실데이터 이슈의 게시 버튼은 1A에서 비활성화하고 "1B에서 열림"을 표시한다. 미리보기는 된다.

### A6. 시험

- DB(로컬, 되돌리는 트랜잭션): 스위치 꺼짐이면 실데이터 거부, 환경 local 아니면 켜지지 않음, URL 허용 호스트 외 거부, 합성/실데이터 섞임 거부, 접수 멱등·충돌·편집자 보호, 게시 거부, 미리보기 허용, API 역할 실행 권한 없음.
- 매핑: 서버 초안 형식 픽스처(합성 문구)로 SECTOR·COMPANY(영향 0)·조건부 섹터·카탈로그 누락을 확인한다.
- 실측: 서버 초안 9건을 로컬에 넣고, 어드민 목록·편집·미리보기에서 확인한다.

## 1B: 실데이터 공개 읽기 (다음, 별도 계획·검수)

- 읽기 계약 확장(M1 → 기사 단위 `sample_kind`), 새 모드 `LOCAL_REVIEW_REAL`(앱 상단 "내부 검토용 실데이터" 표시), 조회 서버의 `REAL` 거부 규칙 변경, `m1_publish_draft` 실데이터 경로, 공개 목록 포함 조건. 1A 실측 뒤 따로 설계한다.

## 하지 않는 것

- 원문 본문 저장(사실 문장·짧은 인용·링크만), 자동 게시, 운영 DB 변경, 새 키 발급(1A는 키 없음).
