# 게시 경로 1단계 계획: AI 초안함과 실데이터 모드 (로컬, 2026-11-27, 3차)

`docs/publish-path.md`의 1단계를 구현 단위로 나눈 계획이다. 사용자 결정(2026-11-27): 로컬에서 시작해 클라우드 미리보기까지, 사람 승인 후 게시, 푸시 접수(1단계는 풀), 섹터 영향 없는 종목 기사 허용. 1차 검수(HOLD, 12건)는 [F#], 2차 검수(HOLD, 7건)는 [G#]로 표시해 반영했다.

## 현재 구조의 전제 (조사 결과)

- 모든 게시·읽기 경로가 합성 데이터만 받는다. DB 마이그레이션 27개에 `SYNTHETIC` 조건이 약 80곳 있다.
  - 최종 검증기는 `m1_prepare`(54) → `m1_prepare_v7`(51) → `m1_prepare_v5` … `m1_prepare_v1` 순으로 이어진다. `v1`(22번)이 이슈·사실·섹터의 `SYNTHETIC`과 `.invalid` URL을 요구하므로, 바깥에서 감싸는 방식으로는 실데이터를 통과시킬 수 없다. [F1]
  - COMPANY는 51번에서 SECTOR로 바꿔 같은 규칙(대표 섹터, 영향 1~30개)을 통과시킨다. 그래서 영향 0개 COMPANY는 지금 미리보기도 안 된다. [F2]
  - `m1_core_evidence`(20번)는 이슈에 속한 **모든** claim을 검사한다. 거시(MACRO) 기사나 `SYSTEMIC_MACRO` 사실은 공식 원문이거나 독립 출처 3개(`evidence_edges`)가 필요하다. [F5]
  - 공개 읽기는 M1 경로가 `m1_current_evidence`를 통해 우연히 합성만 내보낸다. 일반 공개 함수(18번 `m1_public_visible` 계열)에는 `sample_kind` 조건이 직접 없다. [F6]
  - 어드민 API(`m1_get_draft`, `m1_editor_articles`)는 `sample_kind`를 돌려주지 않고, 미리보기는 `"SYNTHETIC"`을 고정으로 넣는다. 어드민 타입은 SECTOR/MACRO만 받는다. [F7]
  - 예약 게시 UI는 미리보기 뒤에 보이고, DB는 비합성 예약을 거부한다(47번). [F8]
- AI 처리기(서버, SQLite): `DRAFT_READY`는 `jobs.state`다. `issues` 행에는 상태 열이 없다. 출처 철회 때 이슈 payload가 HOLD 객체로 바뀌고 사실 목록이 지워진다. 작성기 입력의 사실(문장·검증 등급)은 이슈 행에 남지 않는다. [F3, F5]
- AI 초안에는 `source_market`·`selection_market_basis`가 없다. 일정 형식은 `{title,eventAt,timezone,factIds}`이다. 출처는 최대 32개까지 쌓인다(M1은 12개). [F9]

1단계를 둘로 나눈다. **1A는 접수와 편집 검토만 하고, 공개 노출은 없다.** 1B(공개 읽기)는 1A 실측 뒤 별도 계획과 검수를 거친다.

## 1A 범위

### A1. 실데이터 모드 스위치와 공개 차단 (마이그레이션 56) [F6, F12]

- `private.real_mode`: 한 행(`id=1` 체크) 테이블. 열은 `enabled boolean not null default false`, `allowed_source_hosts text[] not null`, `changed_at`, `note`.
  - RLS를 켜고 정책은 두지 않는다. `public`·`anon`·`authenticated`·`service_role`에서 모든 권한을 회수한다.
  - `enabled=true`는 `runtime_identity.environment='local'`일 때만 가능하다(트리거). 바꾸는 방법은 postgres 운영 SQL뿐이다.
- `private.real_mode_on()`: `enabled`이면서 환경이 local일 때만 참. 실데이터 판단은 모두 이 함수를 거친다.
- `private.real_source_url_ok(url)`: URL을 직접 파싱해 판단한다(정규식 한 줄로 하지 않는다).
  - 스킴은 `https`만, 사용자 정보와 포트는 없어야 한다.
  - 호스트는 소문자, 끝의 점 없음, 퍼센트 인코딩 없음, 허용 목록과 정확히 같아야 한다(하위 도메인 자동 허용 없음).
  - 경로에 공백과 제어 문자가 없어야 하고, 길이는 2,000자 이하.
  - 허용 목록은 마이그레이션에 고정한다: 서버 설정에서 ENABLED인 공식 출처(`dart.fss.or.kr`, `kind.krx.co.kr`).
- **공개 차단 울타리**: 1A에서는 공개 읽기 경계에 `sample_kind='SYNTHETIC'`을 직접 건다.
  - 대상은 `m1_public_visible` 계열, `news_public`·`news_list`·`get_public_article` 정책, 카탈로그 목록·검색·저장·종목 상세 함수다.
  - 기존 결과는 바뀌지 않는다(지금 합성만 있음). 실데이터가 실수로 게시돼도 나가지 않는다.
- 모든 새 함수는 `security definer`, `set search_path=''`, 소유자 postgres로 만든다. `public`·`anon`·`authenticated`·`service_role` 실행 권한은 회수한다(API용 래퍼만 예외).

### A2. 실데이터 전용 검증기 (마이그레이션 56) [F1, F2, F5, F9]

- `private.m1_prepare` 맨 앞에서 분기한다. 이슈가 `PERMITTED_REAL`이면 `private.m1_prepare_real`을 부르고, 아니면 기존 사슬을 그대로 탄다(합성 경로 동작 불변).
- `m1_prepare_real`은 기존 규칙을 같은 순서로 다시 구현한 별도 함수다. 문자열 길이, 핵심 이슈, 시나리오, 일정, 영향 경로, 근거 연결, 기업 범위(51·54)가 해당한다. 차이는 다음뿐이다.
  - `real_mode_on()`이 아니면 `REAL_MODE_OFF`.
  - 이슈·사실이 모두 `PERMITTED_REAL`이어야 한다. 합성 사실이 섞이면 거부한다(반대로 합성 이슈에 실데이터 사실이 섞여도 거부).
  - 출처 URL은 `real_source_url_ok`. `.invalid`는 거부한다.
  - 섹터는 `catalog_sector_selectable(..., 'PERMITTED_REAL')`. 이 모드는 `LOCAL_REFERENCE` 카탈로그(참조 메타데이터, `sample_kind` null)만 허용한다. 함수는 `SYNTHETIC` 결과를 바꾸지 않는 방향으로 확장한다.
  - **COMPANY**: `primary_company_ref` 필수. 영향 0개와 대표 섹터 null을 허용한다. 영향이 있으면 기존 규칙으로 검사한다.
  - **근거**: 참조한 claim은 `m1_claim_allowed`를 그대로 쓴다. 이슈의 모든 claim 검사(`m1_core_evidence`)도 그대로 둔다. 대신 접수가 대체된 claim을 정리한다(A3).
  - **MACRO 실데이터**는 모든 사실이 공식 원문일 때만 허용한다. 아니면 `REAL_MACRO_REQUIRES_OFFICIAL`. 독립 출처 3개 연결(`evidence_edges`)은 1B로 미룬다.
  - 일정 `kind`·`status`·근거 시각 등 필수 형식은 기존 19번 규칙 그대로다(변환은 매핑 모듈 책임).
- `m1_publish_draft`·예약 생성은 `PERMITTED_REAL`이면 `REAL_PUBLICATION_NOT_ENABLED_1A`로 거부한다. `m1_preview_draft`는 허용하고, 미리보기 결과의 `sample_kind`는 이슈 값을 쓴다.

### A3. AI 초안 접수 (마이그레이션 57) [F4, F5, F10, F11]

테이블(모두 RLS on, 정책 없음, API 역할 권한 없음):

- `private.ai_issue_links`: AI 이슈 하나당 한 행(묘비 포함). 열은 `ai_issue_id`(PK), `issue_id`(unique, **null 허용**: 철회가 초안보다 먼저 오면 null), `current_version`, `state`(`ACTIVE`/`WITHDRAWN`/`HOLD_EDITOR`). [G2]
- `private.ai_draft_receipts`: 열은 `effect_key`(PK, `ai:`+AI 이슈 ID+`:`+버전), `ai_issue_id`, `ai_version`, `payload_sha256`(따로 저장해 비교), `result jsonb`(처음 결과를 그대로 저장), `received_at`. [G6]
- `private.ai_draft_origin`: 편집자가 바꿀 수 없는 근거 기록. 열은 `issue_id`, `ai_version`, `facts`(문장·검증 등급·검증 결과·출처 역할), `sources`, `catalog_version`(접수 시점 DB 카탈로그 헤드), `received_at`, `expires_at`(접수+30일). 편집 화면은 여기서 읽는다(`editor_drafts.content`에는 넣지 않는다). 철회·정리 때 함께 지운다(A3-정리). [G5]
- `private.ai_claim_links`: 열은 `issue_id`, `fact_id`(AI 쪽 안정 ID), `claim_id`, `ai_version`.

`private.ai_ingest_draft(effect_key, payload)`의 처리 순서:

0. `pg_advisory_xact_lock(hashtext('ai-issue:'||ai_issue_id))`로 같은 AI 이슈의 접수·철회를 직렬화한다(링크 행이 아직 없을 때도 유효). [G6]
1. 같은 `effect_key`(이슈+버전)가 있으면 `payload_sha256`을 비교한다. 같으면 저장된 `result`를 그대로 돌려주고, 다르면 `AI_DRAFT_CONFLICT`. [G6]
2. `AI_DRAFT_V1` 형식을 정확히 검증한다. 대상은 키 집합, 길이, URL(`real_source_url_ok`), 사실 30개·출처 12개 상한, 원문 본문 필드 금지, `catalog_ref`다.
3. **카탈로그 확인(ID 단위)**: 서버와 DB의 카탈로그 버전 표기는 서로 다르다(서버 `registry-v1:…`, DB bigint 헤드와 스냅샷 SHA-256). 그래서 버전을 맞추지 않고, 초안이 참조하는 섹터·기업 ID를 하나씩 확인한다. [G1]
   - 같은 트랜잭션에서 `catalog_head`를 `for share`로 잠근다(카탈로그 편집과 직렬화).
   - 현재 헤드가 승인된 `LOCAL_REFERENCE` 스냅샷이어야 한다.
   - 모든 섹터 ID가 활성 LEAF여야 한다. 모든 기업 ID는 활성이고, 영향 섹터의 소속이 현재 헤드에서 보여야 한다(`search_membership_visible`).
   - 아니면 `CATALOG_DRIFT`(어떤 ID인지 포함)를 저장하고 반환한다. 접수 시점 헤드 버전은 `ai_draft_origin.catalog_version`에 남긴다.
4. **세대 순서(CAS)**: `ai_issue_links`와 해당 `issues`·`editor_drafts` 행을 `for update`로 잠근다.
   - 버전이 `current_version` 이하면 `STALE_VERSION`.
   - 링크가 `WITHDRAWN`이고 버전이 묘비 버전 이하면 `WITHDRAWN`. 묘비보다 새 버전(출처 철회 뒤 새 출처로 다시 작성된 초안)은 다시 `ACTIVE`로 받는다. [G2]
5. **편집자 보호**: `issues.manual_protected`가 참이거나 `editor_drafts.updated_by`가 있으면 덮지 않는다. 링크를 `HOLD_EDITOR`로 두고 그 결과를 저장한다. 새 근거는 `ai_draft_origin`에 남겨 편집자가 볼 수 있게 한다.
6. 처음이면 story(`event_key='ai:'||AI 스토리 키`)와 issue(`sample_kind='PERMITTED_REAL'`)를 만든다.
7. **사실 교체**: 이 이슈의 이전 claim을 지우고(1A는 게시본이 없으므로 참조하는 버전이 없다) 새 사실로 다시 만든다. 사실 하나가 claim 하나가 되고, `ai_claim_links`로 AI 사실 ID와 묶는다.
   - `verified`: 독립 검증 통과 여부.
   - `korea_path_verified`: 한국 상장사·섹터 경로 검증 통과 여부.
   - `fact_current`: 접수 시점에 사실 기록 30일 안인지.
   - `official_original`: 출처 역할이 PRIMARY(공시)인지.
   - `valid_until`: 사실 기록 만료일.
   - `claim_type`: AI 검증 등급이 거시면 `SYSTEMIC_MACRO`, 미확인이면 `SENSITIVE_UNCONFIRMED`(게시 불가), 나머지는 `ORDINARY_FACT`.
8. 편집 초안을 매핑 결과로 바꾸고(`updated_by` null 유지), 링크의 `current_version`·`current_effect_key`를 갱신한다. 결과를 영수증에 저장하고 `private.audits`에 남긴다.

`private.ai_withdraw_draft(ai_issue_id, ai_version, reason)`: 같은 advisory 잠금 아래에서 처리한다. [G2, G5]
- 링크가 없으면 `issue_id` null인 묘비(`WITHDRAWN`, `current_version`=철회 버전)를 만든다. 나중에 같거나 오래된 버전이 오면 접수하지 않는다.
- 링크가 있고 철회 버전이 현재 버전 이상이면, 그 이슈의 로컬 초안·claim·`ai_claim_links`·`ai_draft_origin`을 모두 지운다. 그다음 `WITHDRAWN`, `current_version`=철회 버전으로 둔다. 서버에서 v2가 철회됐는데 로컬에 v1만 있는 경우도 v1이 지워진다.
- 철회 버전이 현재 버전보다 작으면 `STALE_VERSION`(새 버전이 이미 들어옴).

정리(1A): `private.ai_inbox_cleanup()`이 미게시 AI 초안 중 `ai_draft_origin.expires_at`이 지난 것의 초안·claim·근거를 지운다. 링크는 `WITHDRAWN`(사유 EXPIRED)으로 남는다. 기존 로컬 유지보수 예약(48번)에 하루 1회로 붙인다. [G5]

호출(1A)은 운영 스크립트가 로컬 DB에 postgres로 한다(풀). API 래퍼와 전용 로그인 역할은 2단계다.

### A4. 서버 내보내기, 매핑, 풀 스크립트 [F3, F9, F11]

- **AI 저장소 내보내기 스냅샷**: `commitDraft`가 `DRAFT_READY`를 기록하는 같은 트랜잭션에서 `draft_exports`(새 테이블)에 기록한다.
  - 내용은 이슈 ID·버전, 초안, 작성기에 들어간 검증 사실 전체(ID, 문장, 단위·기간, 검증 등급, 독립 검증 결과, 출처 문서 ID·역할·URL), 카탈로그 버전·해시다.
  - 출처 철회가 일어나면 같은 트랜잭션에서 해당 행을 `REVOKED`로 바꾸고 사실·초안 내용을 지운다(ID·버전·상태만 남김). 내보낸 뒤 30일이 지난 행은 정리 작업이 지운다. [G5]
  - 내보내기는 `jobs.state='DRAFT_READY'`이고 `issues.version`이 스냅샷 버전과 같으며, 스냅샷이 `REVOKED`가 아닌 것만 읽는다. 원문 본문은 넣지 않는다.
- **기존 초안 백필** [G3]: 이미 `DRAFT_READY`인 초안(9건)에는 스냅샷이 없다. `cli.mjs export-backfill` 명령이 저장된 실행 기록(`runs.response`)으로 스냅샷을 다시 만든다.
  - 추출 실행의 사실을 이슈의 `fact_ids`로 고르고, 검증 실행 결과를 함께 가져온다. 원문 문서는 쓰지 않는다.
  - 사실이나 검증 결과가 하나라도 없거나 만료됐으면 만들지 않는다. 그 스토리는 재처리 대상으로 표시한다(`BACKFILL_REPROCESS`).
  - 백필은 dry-run 출력(건수·누락 사유)을 먼저 보고 나서 기록한다. store 시험에 백필 시험을 추가한다.
- `workers/ai-processing/runtime/publish-map.mjs`(순수 함수, 시험 포함): 스냅샷을 `AI_DRAFT_V1`로 바꾼다.
  - `source_market`: 출처가 모두 국내 공시·국내 보도면 `KR`, 해외 출처가 있으면 `GLOBAL`. `selection_market_basis='KR'`.
  - 일정 [G4]: `{title,eventAt,timezone,factIds}`를 `kind='EXACT'`, `status='VERIFIED'`, `title`, `timezone`(IANA 이름 확인), `event_at`, `evidence_as_of`(사실 기록 시각, 접수 시점 이전), `evidence_ids`(사실 ID → claim ID)로 바꾼다.
    - DB는 VERIFIED 일정의 근거가 모두 공식 원문(`official_original`) claim이길 요구한다(13번). 근거 중 공식 원문이 아닌 것이 있으면 `status='UNVERIFIED'`로 낮춘다.
    - 시각이 없는 날짜만 있으면 `kind='PERIOD'`(`period_label`, `period_start`=`period_end`=그 날짜, `precision='DAY'`)로 바꾼다.
    - 그 밖의 형식은 그 일정만 빼고 이유를 남긴다. 매핑 시험은 DB 형식 검사(19번)와 같은 규칙을 쓴다.
  - 출처가 12개를 넘으면 1차(PRIMARY)를 먼저 두고 최신순으로 자른다. 잘린 출처가 인용된 사실이 있으면 그 초안은 보류한다(`SOURCE_OVERFLOW`).
  - COMPANY 영향 0개 허용. 대표 섹터는 첫 수혜→피해 섹터, 없으면 null. 조건부(RELATED) 섹터는 저장만 한다.
  - 카탈로그 ID는 서버와 로컬이 같은 원천이다. 그래도 스냅샷의 카탈로그 버전·해시를 함께 보내 DB가 확인하게 한다(A3-3).
- `scripts/ops/ai-drafts-pull.ps1`: SSH로 서버 컨테이너 안에서 내보내기 스냅샷을 읽기 전용으로 읽는다. 매핑 뒤 로컬 DB `ai_ingest_draft`를 부르고, 결과 영수증을 `.local-data/ai-inbox/`(git 제외)에 남긴다. 철회된 스냅샷은 `ai_withdraw_draft`로 보낸다.

### A5. 어드민 [F7, F8]

- `m1_get_draft`·`m1_editor_articles`·미리보기 DTO에 서버가 정한 `sample_kind`와 `ai_origin` 요약(사실·검증·출처, `ai_draft_origin`에서 읽음)을 추가한다. 어드민 타입에 COMPANY와 `PERMITTED_REAL`을 추가한다.
- 목록에 `AI 초안 · 실데이터` 배지, 편집 화면에 근거 패널을 둔다.
- 실데이터 이슈는 게시 버튼과 예약 위젯을 숨기고 "1B에서 열림"을 표시한다. DB도 같은 이유로 거부한다(A2).
- **COMPANY 검토** [G7]: 편집기에서 글 범위로 COMPANY를 고를 수 있다(기존 NEXT 3-1(f)).
  - 대표 기업과 관련 기업 목록을 카탈로그 이름과 함께 보여준다.
  - 기업은 기존 `catalog_editor_companies` 검색으로 추가·삭제하고, 대표 기업을 지정한다.
  - 저장 전에 대표 기업이 `company_refs`에 들어 있는지 화면에서 확인한다(DB도 확인한다, 51번).
  - 영향 섹터에 붙은 기업 배지(`impacts[].companies`)도 보여준다.

### A6. 시험

- DB(로컬, 되돌리는 트랜잭션):
  - 스위치: 꺼짐이면 실데이터 거부. 환경이 local이 아니면 켜지지 않음.
  - URL 파서: 사용자 정보, 포트, 끝 점, 대소문자, 인코딩, 하위 도메인, `.invalid`.
  - 경로 분리: 합성/실데이터 섞임 거부. COMPANY 영향 0개 미리보기 통과. MACRO 실데이터는 공식 원문만. 게시·예약 거부. 미리보기 허용.
  - 접수: 멱등(같은 결과 재반환), 같은 버전·다른 내용 충돌, 버전 역행, 편집자 보호, 카탈로그 ID 불일치(비활성 섹터·소속 이탈), 동시 첫 접수.
  - 철회: 초안 전 철회 묘비, 새 버전 철회가 옛 로컬 초안 제거, 옛 버전 철회 거부, 묘비 뒤 새 버전 재활성, 근거 기록 삭제, 30일 정리.
  - 일정: EXACT·PERIOD 변환본이 형식 검사와 미리보기를 통과. 비공식 근거는 UNVERIFIED.
  - 공개 차단: 실데이터 이슈를 게시 상태로 직접 넣은 뒤(되돌림) anon·authenticated로 모든 공개 읽기 함수·뷰를 불러 노출이 없음을 확인한다.
  - 권한: 새 함수·테이블에 API 역할 권한이 없음.
- 매핑: 합성 문구 픽스처로 SECTOR, COMPANY(영향 0), 조건부 섹터, 일정 변환, 출처 초과, 카탈로그 누락을 시험한다.
- AI 저장소: 스냅샷 생성·철회 연동 시험(기존 store 시험에 추가).
- 실측: 서버 초안 9건을 로컬에 넣고 어드민 목록·편집·미리보기에서 확인한다.

## 1B (다음, 별도 계획·검수)

읽기 계약 확장(기사 단위 `sample_kind`), `LOCAL_REVIEW_REAL` 모드와 앱 표시, 조회 서버 규칙, 공개 차단 울타리 해제 조건, `m1_publish_draft` 실데이터 경로, `evidence_edges` 연결(보도 출처 독립성).

## 하지 않는 것

원문 본문 저장(사실 문장·짧은 인용·링크만), 자동 게시, 운영 DB 변경, 새 키 발급(1A는 키 없음).
