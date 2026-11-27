# 게시 경로 1B 계획: 실데이터 게시와 공개 읽기 (로컬, 2026-11-27, 3차)

1A(`docs/publish-stage1-plan.md`)에서 AI 초안을 받아 검토·미리보기까지 했다. 1B는 편집자가 승인한 실데이터 기사를 **로컬에서** 게시하고, 로컬 앱의 별도 검토 모드에서 읽는 단계다. 클라우드 미리보기·운영은 2단계(별도 계획)다. 1차 검수(HOLD, 7건)는 [K1]~[K7], 2차 검수(HOLD, 2건)는 [L1]~[L2]로 표시해 반영했다.

## 현재 구조의 전제 (조사 결과, 2차 보강)

- **게시 사슬**: `public.m1_publish_draft` → `private.reservation_publish_core`(1A 차단 래퍼) → `_v1` → `private.m1_prepare` → `private.m0_publish_legacy`.
  - `m0_publish_legacy` 본체가 `sample_kind<>'SYNTHETIC'`를 직접 거부한다(7번 마이그레이션). 게시 이벤트(outbox)의 `sample_kind`도 `SYNTHETIC`으로 고정한다.
  - `m1_set_state`도 편집자 인증을 요구하고, 이벤트를 `SYNTHETIC`으로 고정한다(13번). [K1, K6]
- **공개 읽기의 합성 조건은 여러 곳에 있다.** [K2]
  - `m1_current_evidence`(1A 래퍼) 안의 `_v3` 본체(22번)에도 `sample_kind='SYNTHETIC'`이 있고, 영향 1개 이상을 요구한다. 그래서 영향 0개 COMPANY는 본체를 고치지 않으면 영원히 보이지 않는다.
  - 검색(39번)과 저장(40번 두 곳)에 별도의 합성 조건이 있다.
  - `is_news_visible`, `m0_get_public_article_legacy`, `resolve_issue`에는 1A 울타리가 있다.
- **응답 검사기는 로컬과 클라우드가 함께 쓴다.** `scripts/catalog/public-route.mjs`, `search-route.mjs`를 로컬 조회 서버와 클라우드 미리보기 조회 서버(`cloud-preview-public-read.mjs`)가 공유한다. [K3]
- 앱과 공유 계약(`packages/contracts/src/index.ts`)은 기사 카드와 상세의 `sample_kind`를 `'SYNTHETIC'`으로만 정의한다. [K7]
- 보관 결정(DECISIONS): 사실·짧은 인용·출처 기록 30일, 미게시 초안 30일, 출처 철회 시 즉시 회수. [K5]

## 원칙

1. **한 번에 한 종류만 공개한다.** [K4] 로컬 DB의 공개 읽기는 스위치에 따라 합성만 또는 실데이터만 돌려준다. 섞이지 않는다.
2. **기존 합성 경로와 클라우드 계약은 바뀌지 않는다.** [K3] 실데이터 공개는 로컬 환경에서만 켜진다. 클라우드 미리보기의 M1·`PREVIEW_SYNTHETIC` 계약과 검사는 그대로 두고, 회귀 시험으로 확인한다.
3. **사실의 현재성은 30일 그대로다.** [K5] 게시된 실데이터도 사실 기록이 30일을 넘으면 공개에서 숨는다(기존 현재성 검사). 재검증은 후속 범위다.

## 1B 범위 (로컬)

### B1. 공개 종류 스위치 (마이그레이션 59)

- `private.real_mode`에 `public_read_enabled boolean not null default false`를 추가한다.
  - 켤 수 있는 조건은 `enabled`와 같다(로컬 환경, postgres 운영 SQL만).
- `private.public_read_kind()`는 `real_mode_on() and public_read_enabled`이면 `'PERMITTED_REAL'`, 아니면 `'SYNTHETIC'`이다. 모든 공개 읽기의 종류 조건은 `sample_kind = private.public_read_kind()` 하나로 통일한다. [K4]
- `m1_public_identity`: 실데이터 공개 중이면 `sampleKind:"REVIEW_REAL"`, `contract:"M1R"`, 아니면 지금 값 그대로다.

### B2. 공개 읽기 경로 교체 (마이그레이션 59, 1A와 같은 생성 방식) [K2]

- 합성 조건이 들어 있는 공개 읽기 함수를 모두 생성기로 바꾼다. 1A의 `gen-migration-56.mjs`처럼 실제 정의를 읽어, 정확히 지정한 문자열만 치환하고 개수를 확인한다.
  - 대상: `m1_current_evidence` 사슬 본체, 검색(39), 저장(40의 두 곳), `is_news_visible`, `m0_get_public_article_legacy`, `resolve_issue`. 그 밖에 생성기가 찾은 곳도 모두 포함한다.
  - 생성기는 anon·authenticated가 실행할 수 있는 함수와 그 함수가 부르는 private 함수 전체에서 `'SYNTHETIC'` 문자열을 찾는다. 바꾸지 않은 곳이 남으면 실패한다.
- **실데이터 COMPANY(영향 0개)의 현재성**: 실데이터 이슈에는 영향 1개 이상 조건을 COMPANY에 한해 면제한다. 근거 검사(`m1_core_evidence`·claim 현재성)는 그대로 둔다.
- **종목 기사 배치** [L2]: 종목(COMPANY) 기사는 종목 상세에만 나온다(결정 2026-11-27). 홈·섹터 목록(`catalog_public_articles`, 51번에서 이미 제외)뿐 아니라 뉴스 검색(`catalog_public_search_news`)과 옛 공개 목록(`m1_public_articles`, 로컬 조회 서버가 노출)에서도 제외한다. 합성·실데이터 모두에 적용한다(합성 종목 기사의 기존 노출도 결정과 맞춘다). 저장(`catalog_public_saved`)과 상세는 ID로 직접 여는 경로라 그대로 둔다.
- 시험은 1A의 "10개 공개 읽기 대조" 방식을 확장한다. 두 스위치 상태에서 합성 기사와 실데이터 기사가 각각 정확히 한쪽에서만 보이는지 확인한다.

### B3. 실데이터 게시기 (마이그레이션 59) [K1]

- `private.m0_publish_real`: `m0_publish_legacy`의 실제 정의에서 생성한다.
  - 바꾸는 것은 셋뿐이다: 종류 조건을 `PERMITTED_REAL`과 `public_read_kind()='PERMITTED_REAL'`로, 이벤트 `sample_kind`를 이슈 값으로, 로컬 환경 조건은 유지.
  - 나머지(버전·영향·버전 행·outbox)는 같은 원자적 트랜잭션 구조를 유지한다.
- `reservation_publish_core`(1A 래퍼)는 이슈 종류로 분기한다.
  - 합성이면 기존 사슬을 그대로 탄다.
  - 실데이터이면, 실데이터 공개가 켜져 있을 때만 같은 `_v1` 흐름을 실데이터 게시기로 타게 한다. `_v1`도 생성기로 `_real` 사본을 만들고, `m0_publish_legacy` 호출만 `m0_publish_real`로 바꾼다.
  - 꺼져 있으면 `REAL_PUBLIC_READ_OFF`.
- 예약 게시는 1B에서도 막는다(1A 차단 유지).
- `m1_set_state`(편집자 상태 변경)는 이벤트의 `sample_kind`를 이슈 값으로 쓰도록 생성기로 바꾼다. [K6]

### B4. 게시된 실데이터의 철회와 만료 (마이그레이션 59) [K5, K6]

- `private.m1_transition_internal(issue, state, reason, effect_key)`: postgres 전용 상태 전이다.
  - `m1_set_state`와 같은 규칙을 따르되 편집자 인증 없이 동작한다.
  - 이벤트 `sample_kind`는 이슈 값이다. 같은 `effect_key`로 다시 부르면 같은 결과를 돌려준다.
- `ai_withdraw_draft`가 게시된 이슈(`PUBLISHED`)를 만나면 한 트랜잭션에서 다음을 한다. [L1]
  - `m1_transition_internal(..., 'CORRECTION_PENDING', 'AI_SOURCE_REVOKED', 'ai-withdraw:'||ai||':'||version)`으로 공개에서 즉시 숨긴다.
  - 철회된 근거(claim·claim 연결·근거 기록)를 즉시 지운다("출처 철회 시 즉시 회수" 결정). 근거가 없으므로 그 초안은 다시 게시해도 근거 검사에서 거부된다.
  - 링크는 `WITHDRAWN`으로 두고 감사 기록을 남긴다.
  - 추가 방어: 실데이터 게시기는 AI 링크가 `ACTIVE`가 아닌 이슈(`WITHDRAWN`, `HOLD_EDITOR`)를 `AI_SOURCE_WITHDRAWN`/`AI_DRAFT_HELD`로 거부한다. [L1]
  - **1B에서는 철회된 게시본을 다시 게시하지 않는다.** 게시는 `manual_protected`를 세우므로, 같은 AI 이슈의 수정 버전이 들어오면 지금처럼 편집자 보호(`HOLD_EDITOR`)로 근거 기록(`ai_draft_origin`)에만 남는다. 편집자는 어드민에서 그 새 근거를 볼 수 있지만, 그것을 받아들여 근거를 복원하고 다시 게시하는 경로(수정본 채택)는 후속 단계(1C)다. 시험: 철회 뒤 수정 버전 접수 → `HOLD_EDITOR`, 게시 시도 → 거부.
  - 이미 `WITHDRAWN`이고 같거나 오래된 버전이면 저장된 결과를 그대로 돌려준다(멱등).
- **30일 만료**: 게시된 실데이터의 claim `valid_until`은 그대로 둔다(현재성 30일). 만료되면 기존 현재성 검사로 공개에서 숨는다.
  - 1A 정리 작업은 게시된 이슈에 대해 다음을 한다: 근거 만료 후 이슈를 `m1_transition_internal(..., 'WITHDRAWN', 'FACT_RECORD_EXPIRED', ...)`로 내리고, claim·근거 기록·claim 연결을 지운다. 버전 본문(분석 글)은 감사용으로 남지만 공개되지 않는다.
  - 이로써 "사실·출처 기록 30일" 결정을 게시본에도 그대로 적용한다.

### B5. 응답 검사기와 조회 서버 [K3, K4]

- `catalogResponse`, `searchResponse`가 기대 종류(`SYNTHETIC` 또는 `PERMITTED_REAL`)를 **필수 인자**로 받는다. 기본값은 없다.
  - 로컬 `LOCAL_SYNTHETIC`과 클라우드 `PREVIEW_SYNTHETIC`은 `SYNTHETIC`을 넘긴다. 새 `LOCAL_REVIEW_REAL`은 `PERMITTED_REAL`을 넘긴다.
  - 항목의 종류가 기대와 다르면 502다. 섞이지 않는다.
- 로컬 조회 서버에 모드 `LOCAL_REVIEW_REAL`을 추가한다(포트 62332, 설정으로 선택).
  - 시작할 때 정체가 `REVIEW_REAL`/`M1R`이 아니면 시작하지 않는다.
  - 반대로 `LOCAL_SYNTHETIC`은 정체가 `REVIEW_REAL`이면 시작하지 않는다.
- 회귀 시험:
  - 클라우드 미리보기 조회 서버 시험(`tests/cloud-preview-read.test.mjs`)이 실데이터 항목을 502로 거부하는지 확인한다.
  - 어드민 미리보기·온라인 런타임의 정체 확인(M1/SYNTHETIC)이 그대로인지 확인한다.

### B6. 공유 계약·앱 [K7]

- `packages/contracts`:
  - 기사 카드·상세·검색·저장·종목 응답의 `sample_kind`를 `'SYNTHETIC'|'PERMITTED_REAL'`로 넓힌다.
  - 읽기 모드 타입에 `LOCAL_REVIEW_REAL`을 추가한다.
- 앱:
  - `read-target.ts`에 `LOCAL_REVIEW_REAL`을 추가한다(로컬 62332, 명시적 로컬 빌드 `EXPO_PUBLIC_APP_ENV=local`만. 앱 설정이 허용하는 환경은 local·preview·production뿐이다).
  - 모드를 화면까지 전달해 상단에 "내부 검토용 실데이터 · 투자 권유 아님" 띠를 항상 표시한다.
  - 실데이터 기사에는 "공시 기반" 배지와 출처 링크를 보여준다. 응답의 모드가 요청 모드와 다르면 지금처럼 거부한다.

### B7. 어드민

- 서버가 초안 정보에 `real_publish_allowed`(= 실데이터 이슈이고 `public_read_kind()='PERMITTED_REAL'`)를 준다. 실데이터 초안의 게시 버튼은 이 값이 참일 때만 보인다. 예약 위젯은 계속 숨긴다.
- 철회·만료로 내려간 실데이터 기사는 목록에 사유(`AI_SOURCE_REVOKED`, `FACT_RECORD_EXPIRED`)를 표시한다.

### B8. 시험

- DB(되돌리는 트랜잭션):
  - 스위치 조합: 합성 공개일 때 합성만, 실데이터 공개일 때 실데이터만 보인다. 대상은 10개 공개 읽기, 익명·로그인 모두. 대조군을 포함한다.
  - 실데이터 게시: 스위치가 꺼져 있으면 거부, 켜져 있으면 성공. 이벤트 `sample_kind`가 `PERMITTED_REAL`. COMPANY 영향 0개 기사도 공개에 보인다.
  - 철회: 게시본은 `CORRECTION_PENDING`으로 숨고 근거가 지워지며, 다시 철회해도 결과가 같다. 철회 뒤 다시 게시하면 거부된다(`AI_SOURCE_WITHDRAWN`). 수정 버전이 들어와도 `HOLD_EDITOR`이고 게시는 거부된다(`AI_DRAFT_HELD`).
  - 배치: 게시된 종목 기사(합성·실데이터)가 홈·섹터 목록, 뉴스 검색, 옛 공개 목록에 나오지 않고 종목 상세·저장·상세에는 나온다.
  - 만료: 근거 만료 뒤 공개에서 숨고, 정리 작업이 `WITHDRAWN`과 근거 삭제를 수행한다.
  - 예약은 계속 거부. 생성기 잔여 `'SYNTHETIC'` 검사.
- 조회 서버: 모드별 기대 종류(로컬 두 모드, 클라우드) 시험과 정체 불일치 거부.
- 앱: 모드 해석과 띠·배지.
- 실측: 1A에서 받은 실제 초안 1~2건을 어드민에서 게시하고, 로컬 앱 웹(검토 모드)에서 홈·종목 화면을 확인한다.

## 하지 않는 것

클라우드 반영(2단계), 철회된 게시본의 수정본 채택·재게시(1C), 예약 게시, 보도(REPORTED) 출처와 독립 출처 3개 연결, 사실 재검증(30일 연장), 자동 게시, 운영 DB.
