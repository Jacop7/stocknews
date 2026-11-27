# 게시 경로 1C 계획: 새 AI 버전 채택과 재게시 (로컬, 2026-11-27, 4차)

1B(`docs/publish-stage1b-plan.md`)에서 실데이터 기사를 로컬에 게시하고, 출처 철회·30일 만료 시 공개에서 내리고 근거를 지웠다. 게시나 편집으로 편집자가 초안을 소유하면, 같은 AI 이슈의 새 버전은 `HOLD_EDITOR`로 근거 기록(`ai_draft_origin`)에만 남는다. 1C는 편집자가 그 새 버전을 **채택**해 초안과 근거를 교체하고, 필요하면 다시 게시하는 경로다. 로컬 전용이다. 1차 계획 검수(HOLD, 7건)는 [M1]~[M7], 2차(HOLD, 3건)는 [N1]~[N3], 3차(HOLD, 2건)는 [O1]~[O2], 구현 검수(HOLD, 3건)는 [P1]~[P3]으로 표시해 반영했다.

## 현재 구조의 전제

- 근거 기록(`ai_draft_origin`)에는 버전별 사실·출처·카탈로그 버전·`catalog_ref`·`received_at`·`expires_at`(접수+30일)만 있다. **AI 초안 본문은 보관하지 않는다.** 그래서 보류된 버전은 지금은 채택할 내용이 없다.
- 접수(`ai_ingest_draft`) 잠금 순서: AI 이슈 advisory lock → 영수증 → `catalog_head` 공유 잠금 → 링크 `FOR UPDATE` → 이슈 → 초안. 편집 저장: `catalog_head` → 이슈 → 초안. [M4]
- 게시본 철회 후: 이슈 `CORRECTION_PENDING`(24시간 뒤 `WITHDRAWN`, 기준 `correction_pending_since`는 상태가 바뀔 때만 새로 잡힘), claim·근거 기록 삭제, `removal_cause` 고정, 편집 초안·`manual_protected` 유지, 링크 `WITHDRAWN`. 새 버전이 오면 링크 `HOLD_EDITOR`.
- 게시기는 `HIDDEN`·`WITHDRAWN` 재게시를 거부한다. `CORRECTION_PENDING`은 정정 게시가 가능하다. 실데이터 게시는 링크 `ACTIVE`일 때만 된다.

## 원칙

1. **채택은 편집자만, 한 버전 통째로.** 사실·출처·초안이 같은 AI 버전에서 온다.
2. **신뢰 판정과 변환은 접수와 같은 함수 하나로.** 공통 함수는 소유자 전용이고 두 상위 함수(접수, 채택)만 부른다. [M6]
3. **채택은 게시가 아니다.** 채택 뒤 편집자가 미리보기·게시를 따로 한다.
4. **보관 기한은 늘지 않는다.** 채택은 근거 기록의 원래 `received_at`·`expires_at`을 그대로 쓰고, 정정 기한(24시간)도 새로 주지 않는다. [M1, M2]
5. **`WITHDRAWN`·`HIDDEN`은 되살리지 않는다.**

## 1C 범위

### C1. 보류 버전의 초안 보관 (마이그레이션 62)

- `ai_draft_origin`에 `draft jsonb`를 추가한다(접수 검증을 통과한 AI 초안 그대로). 기존 행은 `null`(채택 불가).
- 접수는 `RECEIVED`와 `HOLD_EDITOR` 모두 근거 기록에 초안을 저장한다. 보관과 정리는 근거 기록과 같다(30일).

### C2. 공통 적용 함수 (마이그레이션 62, 생성기로 접수 함수 교체) [M6]

- `private.ai_apply_version(p_issue, p_ai_issue, p_version, p_payload, p_catalog, p_received_at, p_expires_at)`: 지금 접수 함수 안의 "claim 전부 교체 → 사실→claim 매핑 → 편집 초안 생성·갱신 → 근거 기록 교체 → 링크 ACTIVE"를 옮긴다. 근거 기록의 시각과 카탈로그 버전은 인자로 받는다(접수는 `now()`·`now()+30일`·현재 카탈로그, 채택은 그 근거 기록의 원래 `received_at`·`expires_at`·`catalog_version`). [M2, N2]
- 방어: 이슈가 `PERMITTED_REAL`이 아니면 실패, 호출자는 이미 잠금을 잡고 있다고 가정(주석과 상위 함수 시험으로 보장). 실행 권한은 소유자만(`public`·`anon`·`authenticated`·`service_role`에서 회수).
- `ai_ingest_draft`는 이 부분을 공통 함수 호출로 바꾼다. 생성기로 실제 정의에서 정확히 치환하고, 검증·영수증 우선·반환값·감사 기록·잠금 순서는 그대로다. 기존 1A(59건)·1B 시험이 그대로 통과해야 한다.

### C3. 채택 함수 (마이그레이션 62)

- `public.m1_adopt_ai_version(p_issue uuid, p_ai_version integer, p_expected_revision bigint, p_effect_key text)`.
- 멱등 [M5]: `private.ai_adoptions(effect_key pk, request_sha256, issue_id, ai_version, result, created_at, published_at)`. 요청 해시는 (이슈, 버전, 기대 리비전) 기준 SHA-256.
  - 순서: 편집자 인증 → 효과 키 형식 확인 → 효과 키 advisory lock → 저장된 영수증이 있으면 해시가 같을 때 그 결과, 다르면 `EFFECT_PAYLOAD_CONFLICT`(상태 검사보다 먼저).
- 잠금 순서 [M4]: AI 이슈 advisory lock → `catalog_head` 공유 → 링크 `FOR UPDATE` → 이슈 → 초안 → 해당 근거 기록.
- 확인(하나라도 어긋나면 거부, 이유 코드로):
  - 실데이터 모드 켜짐, 실데이터 이슈(`REAL_MODE_OFF`, `REAL_ISSUE_REQUIRED`).
  - 링크 `HOLD_EDITOR`이고 `current_version = p_ai_version`(`AI_VERSION_NOT_ADOPTABLE`).
  - 그 버전의 근거 기록이 있고 `draft`가 있으며 `expires_at > now()`, 그리고 모든 사실의 `recorded_at + 30일 > now()`(`AI_VERSION_EXPIRED`). [M2]
  - 초안 리비전 일치(`REVISION_CONFLICT`).
  - 이슈 상태 `DRAFT`·`PUBLISHED`·`CORRECTION_PENDING`(`HIDDEN`·`WITHDRAWN`은 `AI_ISSUE_CLOSED`). `CORRECTION_PENDING`이면 정정 기한이 남아 있어야 한다(`correction_pending_since > now() - 24시간`, 아니면 `AI_CORRECTION_WINDOW_CLOSED`). [M1]
  - 카탈로그 드리프트 없음(`CATALOG_DRIFT`).
- 적용:
  - `PUBLISHED`이면 먼저 `m1_transition_internal(..., 'CORRECTION_PENDING', 'AI_VERSION_ADOPTED', 'ai-adopt:'||issue||':'||version)`으로 공개에서 내린다(옛 공개본과 새 claim이 짝지어 보이는 일을 막는다). 이때 정정 기한 24시간이 새로 시작된다(상태 변경).
  - `ai_apply_version`(원래 시각)으로 claim·초안·근거를 교체하고 링크를 `ACTIVE`로.
  - `removal_cause`는 이 함수에서만 지운다(`AI_SOURCE_REVOKED`일 때만. `FACT_RECORD_EXPIRED`는 `WITHDRAWN`이라 여기에 오지 않는다). [M6]
  - `manual_protected` 유지.
  - 영수증 저장, 감사 기록.
- 게시 후 기록 [N3]: 실데이터 게시기가 **새 버전을 만든 경우(`APPLIED`)에만** 그 이슈의 **가장 최근 채택**(채택 직후 초안 리비전이 가장 큰 것) 영수증이 아직 게시 전이면 그것에만 [O2] `published_at`과 `published_version_id`를 적는다. 효과 키 재사용으로 `ALREADY_APPLIED`가 돌아오는 경우(채택 전 게시 요청의 재전송 포함)는 적지 않는다. 채택 이후 새로 만들어진 게시 버전은 초안 리비전이 채택 시점 이후이므로 반드시 채택 내용을 담는다.
- 영수증에는 채택 직후 초안 리비전(`adopted_draft_revision`)도 남긴다.

### C4. 게시 안 된 채택 초안과 닫힌 이슈의 정리 [M3, N1]

- 닫힌 실데이터 이슈 정리(정리 작업에 추가): 이슈가 `WITHDRAWN`·`HIDDEN`(정정 기한 초과, 편집자 숨김, 만료)인데 claim이 남았거나 링크가 `ACTIVE`이거나 게시 안 된 최근 채택의 편집 초안이 남았으면, claim·claim 연결과 **그 claim의 버전 이하** 근거 기록을 지우고, `ACTIVE` 링크는 `WITHDRAWN`(이유 `ISSUE_CLOSED`, 만료는 `EXPIRED`)으로 둔다. 그보다 나중에 들어온 보류 버전과 `HOLD_EDITOR` 링크는 그대로 두어 30일 규칙으로 정리된다. [O1] 가장 최근 채택이 게시되지 않았으면 편집 초안도 지운다. 그래서 정정 기한이 지나 `WITHDRAWN`이 된 이슈에 `ACTIVE` 링크나 채택 근거가 남지 않는다.
- 닫힌 이슈에 이후 새 AI 버전이 오면 `HOLD_EDITOR`로 근거 기록에만 남고(채택은 `AI_ISSUE_CLOSED`로 거부), 30일 뒤 기존 정리로 지워진다. 접수는 `DRAFT`가 아닌 이슈를 절대 덮어쓰지 않으므로, 편집 초안이 지워진 닫힌 이슈에도 오류 대신 `HOLD_EDITOR`로 받는다(접수 조건을 생성기로 변경).

- 정리 작업(1B 게시본 만료 단계)에 추가: 채택 뒤 다시 게시되지 않은 이슈(마지막 채택 영수증 `published_at is null`)가 근거 만료로 `WITHDRAWN` 처리될 때, 편집 초안 내용(`editor_drafts`)도 지운다. 게시된 적 있는 버전 본문(`article_versions`)은 감사용으로 남는다.
- 편집 초안이 없어진 이슈는 어드민 목록에서 빠진다(내려간 기사로 남지 않음). 이를 문서에 적는다.

### C5. 어드민

- 근거 패널의 "새로 들어온 근거"에 **이 버전 채택** 버튼. 서버가 준 `adoptable`(리비전·드리프트를 뺀 C3 조건)이 참일 때만 보인다. 확인 문구: "초안 내용이 AI 버전 N으로 바뀝니다. 직접 고친 내용은 사라집니다. 게시 중이면 공개에서 내려가고, 다시 게시해야 합니다."
- 서버 라우트 `adopt` → `m1_adopt_ai_version`(효과 키는 화면에서 만든 UUID). 채택 뒤 초안을 다시 읽는다.

### C6. 시험 [M7]

DB(되돌리는 트랜잭션, 실제 접수 함수):
- 리팩터링: 62를 로컬에 적용한 뒤 기존 1A·1B DB 시험 전부 통과(적용된 새 접수 함수로 실행). [P1]
- 게시 → v2 보류 → v2 채택: 이슈 `CORRECTION_PENDING`(이유 `AI_VERSION_ADOPTED`), 그사이 10개 공개 읽기 전부에서 안 보임, claim이 v2 사실(v1 claim 없음), 초안이 v2(사실 ID→claim UUID), 링크 `ACTIVE`, 근거 기록 v2만이고 `received_at`·`expires_at`은 원래 값. 미리보기·재게시 성공 뒤 공개본의 모든 근거 ID가 v2 claim이고, 영수증 `published_at` 기록.
- 철회 → v2 보류 → v2 채택 → 재게시(`removal_cause` 지워짐).
- 거부: 오래된 버전, 초안 없는 기록, 근거 기록 만료, 사실 30일 경과, 리비전 불일치, `WITHDRAWN`·`HIDDEN`, 정정 기한 경과, 드리프트, 합성 이슈, 실데이터 모드 꺼짐, 편집자 아님.
- 멱등: 같은 키 같은 요청은 같은 결과, 같은 키 다른 요청(다른 이슈·버전·리비전)은 `EFFECT_PAYLOAD_CONFLICT`.
- 순서 경합 [P2]: 시험은 모두 되돌리는 트랜잭션이라, 한 연결의 미확정 데이터는 다른 연결에 보이지 않는다. 그래서 경합은 두 갈래로 확인한다.
  - AI 이슈 advisory lock을 먼저 잡는 작업(접수, 철회): 두 연결로, 채택이 진행 중일 때 같은 AI 이슈의 접수·철회가 잠금에서 기다리는 것을 확인한다(1A 방식).
  - 이슈 행 잠금으로 직렬화되는 작업(편집 저장, 게시, 정정 기한 작업, 정리): 모두 이슈 행을 `FOR UPDATE`로 잡거나(정리는 `SKIP LOCKED`로 건너뜀) 잠근 뒤 상태를 다시 읽으므로, 실제 동시 실행은 어느 한쪽이 먼저 끝난 순차 실행과 같다. 그래서 두 순서를 한 트랜잭션에서 순차로 확인한다: 게시 후 채택·채택 후 게시(E), 채택 후 채택 전 리비전으로 저장 → `REVISION_CONFLICT`(E), 리비전 불일치 채택(G), 정정 기한 경과 후 채택 거부(G)·채택 후 기한 경과와 정리(H), 닫힘 후 새 버전과 재정리(H), 채택 후 새 버전 접수와 재채택(J).
- 공개 읽기 [P2]: 채택 전 게시본이 보이던 10개 공개 읽기(익명·로그인) 전부에서, 채택 후 재게시 전에는 하나도 안 보이고 재게시 후에는 채택 전과 같은 곳에 다시 보인다.
- 생성 재현성 [P3]: 생성기는 `scripts/tools/dumps-62/MANIFEST.json`의 해시로 입력과 결과를 확인하고, 맞지 않으면 쓰지 않는다.
- 정리: 채택 후 게시 안 한 이슈가 만료되면 `WITHDRAWN`, 근거·편집 초안 삭제. 게시한 이슈는 편집 초안 유지. 채택 후 게시 없이 정정 기한이 지나면(`WITHDRAWN`) 정리 작업이 근거·편집 초안을 지우고 링크를 `WITHDRAWN`으로 둔다. 편집자가 숨긴(`HIDDEN`) 실데이터 이슈도 근거가 지워진다. [N1]
- 카탈로그: 근거 기록 이후 카탈로그 헤드가 바뀌었지만 드리프트가 없을 때 채택하면, 근거 기록의 `catalog_version`은 원래 값 그대로다. [N2]
- 게시 기록: 채택 전 게시 요청을 같은 효과 키로 재전송하면 `ALREADY_APPLIED`이고 `published_at`은 비어 있다. 채택 후 새 게시만 `published_at`·`published_version_id`를 남긴다. [N3]
- 닫힘 뒤 새 버전: 닫힌 이슈에 v3가 오면 `HOLD_EDITOR`, 정리를 다시 돌려도 v3 근거 기록은 남는다. [O1]
- 여러 채택: v2 채택 → v3 채택 → 게시 하나 → v3 영수증만 `published_at`. [O2]
- 권한: 공통 함수·`ai_adoptions`는 API 역할이 실행·조회할 수 없다.
- 어드민: 버튼 표시 조건(소스 검사).

## 하지 않는 것

`WITHDRAWN`·`HIDDEN` 기사 되살리기, 정정 기한 연장, 여러 버전 병합, 자동 채택, 클라우드 반영(2단계), 보도(REPORTED) 출처·독립 출처 3개 연결.
