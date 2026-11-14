# 6E 예약 게시와 주기 유지관리 — 구현 전 계획 r2

작성일 2026-11-15. 상태 PLAN_REVIEW_PENDING. 계획 검수 전 제품 변경·SQL 적용·cron 등록은 하지 않는다. 6D 완료 기준은 `10cdfefb1f5eed7ffbeac76f8dbfb17f018a6b34`, 외부 `reviews/stage06d-implementation/status.json`의 DUAL·검사·원격 백업 영수증이다. 제품 소스 292개와 SQL1~45, native0006 입력5개는 현재 바이트 그대로다. 제품 문서에 남은 6D IMPLEMENTING은 과거 검수 후보의 상태이며 다음 구현 때 완료 증거를 연결해 갱신한다.

## 1. 목표와 단계 경계

이번에는 관리자가 작성한 합성 초안의 예약 게시, 정정 대기 24시간 철회, 비공개 QA 통계 TTL의 자동 실행을 구현한다. 기존 서비스·앱·DB와 완전히 별개인 주도주뉴스 소유 로컬 Supabase만 사용한다. 공개 화면은 기존 게시·상태 조회 계약을 재사용한다. 기사 수집/AI 자동 작성/실제 주가/홈 점수/OS 푸시/광고는 구현 성공으로 세지 않는다. 실제 뉴스·AI·시세·push·ad 요청 0, 112개 수집 URL RIGHTS_HOLD, live7·8 CLOSED를 유지한다.

후속 순서는 가격·홈 순위7 → 전체 사이트 수집8 → AI 분석·독자적 상세 작성9 → 통합10 → 출시/실제 광고·푸시11이다. 전체 사이트106행/112URL, Telegram 링크 우선·메시지 기반 검색 차선, 원문 우선순위/동일 사건 대표 출처, 유사성 검사와 재작성/HOLD 요구는 커밋된 `docs/stages/news-collection-authoring-requirements.md`에 보존했다. 예약 작업이 해당 수집 기능을 이미 만들었다고 표현하지 않는다.

## 2. 현재 구현 조사와 변경 방법

M0 `private.schedules`와 MOCK_EFFECT 큐는 합성 worker 시험용이다. 새 예약을 이 큐로 보내거나 기존 worker의 고정 payload 검사를 완화하지 않는다. `private.issues.scheduled_publish_at`은 이미 있으나 M1 저장 DTO에서는 금지되고 즉시 게시에서는 RESERVATION_NOT_ENABLED로 거부한다. 새 예약 의도는 기사 본문과 분리한 전용 테이블에 둔다.

관리자 M1 경로는 실제 active membership·auth session·admin capability와 CSRF를 검증한다. `private.m1_assert_editor()`는 cron에서 통과하지 않는다. cron이 관리자 JWT를 위조하거나 request.jwt.claims를 관리자로 바꾸는 구현은 금지한다. SQL46+에서 M1 게시 본문의 비권한 공통 코어를 private 함수로 추출하되 기존 공개 수동 게시 wrapper는 기존 m1_assert_editor와 catalog→issue 잠금, 멱등성·근거·매크로 3원출처 조건을 그대로 유지한다. 예약 전용 서버 executor는 assert_server·assert_initialized·정확한 예약 행/초안 revision/위임 intent를 검증한 후에만 공통 코어를 호출한다. 공통 코어는 PUBLIC/anon/authenticated/service_role에 직접 EXECUTE를 주지 않는다. public 함수별 grant를 명시하고 search_path는 빈 값, schema-qualified 이름을 사용한다.

과거 SQL1~45·기존 검수 checker·native release guard는 수정하지 않는다. 새 migration의 재정의와 6E validator, 허용된 공식 verify dispatcher의 추가 분기로 현재 동작을 검사한다. 전체 M1·카탈로그·설치 회귀검사를 유지한다. SDK나 native input 변경은 필요 없다.

## 3. 예약 상태와 데이터 계약

최초 DRAFT이며 한 번도 공개하지 않은 canonical Issue만 예약한다. 게시된 기사의 정정·숨김·철회를 예약으로 지연시키지 않는다. 관리자 미리보기에서 같은 현재 초안 revision과 근거 검사를 통과한 뒤 별도 예약 명령을 내린다.

`private.manual_publication_schedules`에는 id, issue_id, status, revision, due_at, expires_at, created_at, actor_id, actor_auth_session_id, draft_revision, issue_revision, content_hash, policy_version, catalog_version, evidence_digest, request_id, request_hash, effect_key, completed_at, outcome_code를 둔다. 민감 세션 capability/JWT·외부 URL·기사 원문은 넣지 않는다. 동일 Issue의 PENDING은 partial unique 하나뿐이다. 상태는 PENDING → PUBLISHED / CANCELLED / HELD / EXPIRED의 단방향이며 terminal 행을 다시 PENDING으로 돌리지 않는다. 다시 예약하려면 새 명시적 요청을 내린다. scheduled_publish_at은 PENDING과 같은 값, terminal에서는 null로 원자 정리한다.

초기 로컬 운영 한도 제안: due_at은 DB 현재시각보다 최소60초 이후, 최대90일 이내. 지연 허용은15분이며 `expires_at=due_at+15분`. 이 수치는 시장 사실이 아니라 제한된 실행을 위한 변경 가능한 초기 정책이며 승인 계획과 테스트에 같은 값으로 고정한다. due≤DB시각<expires에서만 게시한다. 만료는 EXPIRED, 누락 backlog를 과거시각으로 소급 게시하지 않는다. 실제 게시시각은 commit 시각, due_at은 관리자 기록으로 분리한다.

예약의 request UUID는 actor+operation에 결속하고 동일 키/동일 payload 재시도는 원래 결과, 다른 payload는409다. 응답 유실 시 같은 키 조회/재시도만 한다. 새 키를 자동 생성해 이중 예약하지 않는다. status·취소는 schedule ID와 expected revision으로 처리한다. 권한 상실 시 새 관리자 mutation은 거부한다. 이미 승인한 예약도 실행 시 원래 actor의 active membership·현재 raw_app_meta_data.app_role='admin'·사용자 ban/deletion을 전부 재검사한다. 승인 세션의 8시간 만료 자체로 90일 예약을 무효화하지 않되, 세션 수명과 분리한 이 자격 판정에서 app_role을 생략하지 않는다. 회원권 비활성·역할 회수·ban/deletion은 HELD(ACTOR_INACTIVE)로 전환하고 다른 관리자가 새 의도를 승인해야 한다. membership만 active인 채 app_role만 강등한 시험에서도 version/outbox 추가0이어야 한다.

## 4. 실행 시 검증·트랜잭션·경합

예약 생성과 실행은 catalog_head → Issue → editor_draft → schedule 순서로 잠근다. 실행 후보 ID는 잠금 없이 제한 조회하고 각 후보의 위 순서를 지킨다. worker가 schedule 선잠금 후 Issue를 잡는 역순은 금지한다. head는 공유, Issue 이후 행은 update; 제한 시간 안에 잡지 못한 행은 다음 tick으로 넘기고 상태를 게시 성공으로 바꾸지 않는다.

PENDING이고 현재 canonical이며 DRAFT/미게시인지, Issue·draft revision/content hash·policy·catalog·근거 digest가 예약 때와 같은지 확인한다. 하나라도 바뀌면 HELD(STALE_DRAFT / STALE_CATALOG / STALE_POLICY / STALE_EVIDENCE / ACTOR_INACTIVE / ISSUE_NOT_DRAFT 등)로 전환한다. 최신 내용을 몰래 예약 내용으로 대체하지 않는다. claims.valid_until, fact_current, korea_path_verified, 민감 미확정, 경로별 evidence와 현재 활성 섹터도 **현재 DB시각**으로 다시 검증한다. 매크로는 공식 원출처 또는 진짜 독립3원출처 조건을 재사용한다. 수동·예약이라는 이유로 통과시키지 않는다.

게시 코어 호출·새 article_version·정확한 impacts·public projection·outbox·schedule terminal·scheduled_publish_at 정리·audit를 한 트랜잭션으로 commit한다. effect_key는 schedule ID에 결속하고 content·expected revisions·정책·카탈로그를 request hash로 고정한다. 성공 응답 유실 후 재실행에도 version/outbox는 하나다. 예상 가능한 검증 실패는 SAVEPOINT/하위 블록 rollback 후 같은 잠금 안에서 HELD와 사유만 남긴다. 일시적 lock/statement timeout/DB 중단은 PENDING 유지·관측 가능한 실패 기록, 재시도는 expires 전까지만 한다. 외부 통신은 이 트랜잭션에 없다.

즉시 게시와 초안 저장은 기존 동작을 유지하되 PENDING 예약이 있으면 명확한 예약 취소/수정 안내를 한다. **PENDING 중 초안 저장은 허용하고**, 같은 Issue 잠금 안에서 기존 예약을 HELD(STALE_DRAFT)로 바꾸고 scheduled_publish_at을 지운다. 저장 실패이면 예약 상태도 함께 rollback한다. 즉시 게시는 예약이 남아 있으면 거부한다. 카탈로그 비활성화는 기존 6B 영향·공개 차단 동작을 유지하고 예약은 다음 tick에서 stale로 HELD, 비활성 섹터를 다른 ID로 치환하지 않는다. 취소와 실행이 경합하면 Issue 선잠금으로 승자 하나만 정한다. 이미 게시됐으면 취소는 ALREADY_PUBLISHED이며 글을 숨기지 않는다. 동시 executor 두 개도 동일 Issue 잠금·상태 재확인으로 한 번만 게시한다.

## 5. 주기 실행과 관측

소유 로컬 Supabase의 pg_cron을 사용한다. 이는 장기 네트워크/LLM 봇을 DB에 넣는 결정이 아니다. 고정 pure-DB 유지작업만 실행한다. Docker mock worker2개+sink1개와 기존 outbox dispatcher는 유지한다. 고정 job 이름은 주도주뉴스6E 접두사와 runtime bootstrap fingerprint를 결속하고, 등록 함수는 정확한 제품·local/SYNTHETIC·DB 지문을 확인한다. 기존 다른 job 수정/삭제/전체 unschedule은 금지한다.

예약 tick 매1분, 정정 timeout 매1분, TTL purge 매1시간의 **세 개 소유 job**만 둔다. 생성 migration이 cron을 몰래 켜지 않는다. 적용·검증 후 idempotent service-only enable을 별도 실행해 증거에 job ID/주기/command hash를 기록한다. 모든 실행이 같은 전용 advisory lock을 사용하는 종류별 단일 실행이고, tick마다 최대20개·총5초/lock2초 상한이다. 이전 작업 미종료/DB 재시작 시 중복 효과가 없으며 실패 후 다음 tick과 상태로 복구한다. cron 설치/권한이 없으면 ACTIVE로 표시하지 않는다. session role/JWT는 위조하지 않고 실제 cron DB role의 assert_server를 확인한다.

예약/정정/보관 실행에는 started/finished, status, candidates, applied/held/expired/deleted 수, 마지막 오류의 고정 코드, next_due/oldest_pending를 서버 운영 테이블에 기록한다. 단, 아래9절의 단일 tick 트랜잭션 전체 실패에는 이 테이블의 기록도 rollback하므로 별도 pg_cron 소유 job_run_details를 실패·미종료 관측의 권위로 사용한다. 기사 본문·capability·키·원시 설치 ID는 로그/브라우저에 내보내지 않는다. 마감 후 계속 수집이라는 제품 요구와 별개이며 실제 수집기는8단계다. cron 중단 시 관리자에서 STOPPED/STALE/FAILED를 정상0과 구별한다. 소유 job pause/resume만 허용하고 수동 run도 같은 제한·감사를 통과한다. 운영 인터넷 배포·24시간 SLA 완료로 표현하지 않는다.

## 6. 정정 대기 24시간과 보관 정리

새 correction_pending_since 컬럼과 상태전이 trigger를 추가한다. PUBLISHED 등에서 CORRECTION_PENDING으로 처음 바뀔 때 서버시각 기록, 같은 상태 반복 요청은 시계를 초기화하지 않는다. 빠져나가면 null, 재진입은 새 시각이다. 기존 pending에는 관련 audit의 신뢰할 수 있는 진입시각이 있으면 사용하고 없으면 migration 시각을 시작으로 보수적 24시간 유예, 이를 새로 확인된 과거 시각이라 주장하지 않는다.

pending_since+24시간≤DB시각이고 여전히 pending이면 Issue update 잠금과 revision 재검사 후 WITHDRAWN으로 전환한다. 기존 public body 차단을 유지하고 버전 원문을 다시 노출하지 않는다. 한 transition effect key/outbox/audit만 생성한다. 사람이 정정 게시/숨김 처리와 경합하면 동일 Issue 잠금 승자에 따라 재확인하며 이미 해결된 글은 철회하지 않는다. material_change_at은 정정 진입시각 대용으로 쓰지 않는다.

6D 설치 raw30×24시간·daily1년·settings history30일·만료 receipt 암호문 정리 계약을 유지한다. 기존 purge는 무제한 DELETE이므로 새46+ bounded purge로 유형별 최대1000행/실행·고정 cutoff를 적용하고 backlog 수/oldest를 보고한다. hourly 한 번에 backlog가 남으면 다음 tick으로 이어진다. TTL 초과 raw는 물리 삭제 전에도 모든 질의에서 제외된다. daily 집계는 장기 distinct 설치집합을 보존하지 않으며 만료 raw로 다시 만들지 않는다. FK 때문에 view/outcomes→tickets 순서, unique receipt tombstone은 무턱대고 삭제하지 않는다. bootstrap seal의 영구 중복 방어/유효 capability 보존을 해치지 않는다. 물리 삭제 수와 ledger는 같은 트랜잭션, 재실행 삭제0은 정상이다. 개인정보 전체 삭제·backup 소거 성공으로 표현하지 않는다.

6D P3 coverage gap은 하나의 gap_since를 영구 true처럼 쓰는 한계가 있다. 이번 유지관리 cron은 **coverage gap 생성/해제·watermark 전진을 하지 않는다**. 조회 없는 시간/cron 지연은 accepted-server-event 손실의 증거가 아니다. 실제 손실 reconciler와 gap interval/epoch 닫기 설계는 별도 후속 게이트이며 현재 보수적 PARTIAL을 자동 COMPLETE로 바꾸지 않는다. 장기 seal tombstone 제한과 permanent-error 재시도 분류도 운영 활성 전 후속으로 남긴다.

## 7. 어드민 화면과 API

기존 3100 loopback Next 관리자 안에 ‘예약·유지관리’ 메뉴를 추가한다. 기사 편집 화면은 저장/미리보기 이후 ‘예약 게시’와 한국시각 날짜·시간을 제공한다. KST라고 명시하고 Date의 환경별 locale 파싱을 피한다. 서버는 offset 있는 ISO timestamp만 수락하고 UTC로 저장, KST로 렌더한다. 주요 일정(기사 후 확인할 사건)과 예약 게시일은 서로 다른 필드다.

목록은 제목·현재 상태·예약 시각(KST)·기한·현재 draft revision·보류 사유·최종 실행·취소를 표시한다. HELD/EXPIRED를 자동 재예약하지 않으며 사용자가 최신 미리보기 후 새 예약을 선택한다. 예약 없는 초안과 실제 게시된 글을 구분한다. 운영 요약은 소유 job 실제 등록/실행, pending/held, 정정 timeout, TTL backlog/삭제 수를 보여준다. LOCAL_QA/실제 알림 발송0을 표시하고 푸시 전송 버튼은 없다.

private API는 기존 관리자 session·CSRF·Origin/Host·고정 RPC allowlist·상한·no-store·마스킹을 재사용한다. consumer cookie/capability로 관리자 명령 불가, 관리자 경로에 CORS를 추가하지 않는다. anon·일반 authenticated·consumer·만료/철회 관리자·잘못된 Origin/CSRF를 모두 거부한다. public62330 GET/HEAD·credentials 거부 그대로이며 cron 관리/예약 mutation을 공개 gateway에 추가하지 않는다. service-only executor/enable/purge를 authenticated에 grant하지 않는다.

## 8. 작업 순서·검증·완료 조건

1. 이 계획과 현재292소스/SQL45/6D 완료·native digest를 고정한 scoped source bundle로 기존 Claude Opus5.5 medium와 Codex gpt-6-astra ultra가 독립 검수한다. 같은 case 수정 한도를 유지한다. 계획 DUAL READY 전 구현하지 않는다.
2. `feat/06e-reservation-maintenance`를 main10cdfef에서 생성한다. 승인 계획을 제품 docs/stages에 복사하고 단계 문서를 갱신한다. SQL46+ 순서로 schema/공통 게시코어·예약/정정clock·boundedpurge/cron·권한을 구현한다. 기존45개 파일 불변 검사로 차이를 확인한다. preview→rollback compile→소유 DB 한 번 적용 영수증. 다른 DB reset/repair 금지.
3. 고정 RPC/어드민 편집·목록·운영 화면을 연결하고 typed 계약/새 validator를 추가한다. 동일 요청 복구와 오류 메시지/KST를 브라우저에서 확인한다. 앱 본문/저장/상태 반영은 기존 공개 read 경로로 확인, SDK input digest `f6de4b3bce492b89c5fe47ab80ee4394cea471ee4a68cd476c5e9b7ce80d3fa4` 불변. iPhone USER_DEFERRED/P03b 미완료 유지.
4. 시험은 real own local synthetic만: due 전 비공개→실제 cron 후 공개·outbox1·version1; worker중복/응답유실/프로세스재시작; 취소vs실행 두 순서; 초안수정vs실행; catalog변경·근거만료·macro3미달·관리자해제→HOLD; 만료→EXPIRED; 정정 진입 동일요청이 시계초기화 안 함/24h경계·정정해결 경합; TTL exact cutoff/유형별1000초과 backlog·FK·반복0·ledger·query 제외; anon등 권한/CSRF/consumer 혼용; job enable멱등·pause/resume·다른job무변경·missingcron; old native/schema/worker 계약 회귀. 긴 대기 대신 독립 pure-clock 경계 함수와 rollback fixture 시각을 쓰며 공개 클라이언트가 now를 지정하지 못한다. 단 실제 cron firing 하나는 실제시계로 관측한다.
5. full verify·필수 local DB/runtime 회귀·독립 Git objects fresh clone/frozen install/같은 source bytes로 재현한다. 원래 공식 checker를 축소/완화하지 않는다. 구현 후보 별도 DUAL 후 수정·재검사. 정상 commit→main FF→postcommit full verify→비밀/개인데이터 스캔→일반 GitHub push→원격 exact SHA를 확인해 외부 영수증에 기록한다. 실패·권한·review한도는 정직하게 pending/blocked로 남긴다.

완료는 이6E 로컬 경계만이다. 계획 승인을 구현 완료로, synthetic QA를 실제 기사 운영으로, 브라우저를 iPhone 실기기 성공으로, cron 등록을 외부 hosted24h운영으로 바꾸지 않는다. 다음7단계는6E DUAL·백업 후 별도 계획에서 시작한다.

## 9. r1 독립 검수 반영과 실행 경계 확정

Codex S6EP-CODEX-01(P2)을3절의 현재 app_role 검사와 전용 강등 시험으로 보완했다. Claude S6EP-01·02(P3)도 구현 선택을 아래처럼 고정한다. 이전 원문은 검수 서비스 inputs의 r1 사본과 완료 영수증으로 보존한다. 이 절은 앞의 모호한 해석보다 우선한다.

**공통 게시 코어:** 기존 private.m1_publish_draft_v1을 그대로 cron에서 호출하지 않는다. SQL46+의 새 private 코어는 actor_id와 승인된 schedule ID(수동은null)를 명시 인자로 받고 auth.uid()에 의존해 감사자를 잃지 않는다. 현재 v1 본문의 prepare→M0 검증/원자 게시→정확한 impacts→outbox hash 흐름을 옮긴다. 수동 public wrapper는 현재 m1_assert_editor를 통과한 auth.uid()만 전달한다. 예약 wrapper는 현재 actor 자격·정확한 예약과 잠금·revision/hash를 검증한 뒤 actor_id를 전달하고, 그 예약과 scheduled_publish_at이 일치할 때만 예약을 소비한다. 임의 schedule ID로 기존 RESERVATION_NOT_ENABLED를 무시하거나 null로 바꿔 우회하지 않는다. 기존 M0 코어의 assert_editor는 실제 server role에 대한 허용을 재사용하고 관리자 claim은 만들지 않는다. 수동·예약의 동일 입력 결과/invalid evidence 거부 회귀로 두 wrapper의 동등한 게이트를 고정한다.

**tick 트랜잭션:** 이번은 PROCEDURE/항목별 COMMIT을 사용하지 않는다. 종류별 고정 SQL command에서 `SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='2s'; SELECT private.<fixed_tick>();` 형태의 단일 트랜잭션을 실행한다. 함수 내부 항목별 성공은 **tick 전체 commit 때 함께 확정**된다. 일반 검증 오류는 항목별 EXCEPTION 하위 블록으로 rollback하고 HELD 사유만 남겨 다른 후보를 처리한다. lock_not_available은 후보 건너뛰기, statement_timeout·치명적 오류·DB 중단은 **그 tick에서 앞서 처리한 항목과 run 기록도 전부 rollback**, 다음 tick에서 같은 PENDING/effect_key로 재판정한다. 부분 성공을 먼저 commit했다고 표시하지 않는다. soft budget4초 시점에 새 항목을 시작하지 않고 최대20개를 제한하며, 함수 내부 SET만으로 이미 실행 중인 statement에 하드 제한이 적용된다고 가정하지 않는다. 실제 설치된 cron command의5초 취소·job 실패 기록과 전체 rollback을 강제 지연 fixture로 시험한다. pg_cron 전용 연결인지 background worker 모드인지 확인해 위 고정 command와 제한이 실제 적용되지 않으면 enable을 보류한다. 전역 role timeout은 바꾸지 않는다.

pg_cron의 `cron.log_run=on`과 소유 job_run_details의 실제 started/end/status가 별도 supervisor 관측이다. 이 설정을 바꾸지 않고 확인만 한다. 미지원/off이면 enable 보류다. 관리자 요약은 정확한 세 job ID의 run만 읽고 raw return_message/전체 command를 노출하지 않으며 고정 오류 코드로 마스킹한다. 반환 없이 중단되거나 cron 자체가 꺼진 경우 완료 run을 만들어내지 않고 STALE/FAILED/UNAVAILABLE를 표시한다. 수동 run도 내부 SQL commit 성공 뒤에만 성공으로 반환하며 실패 로그의 영속을 허위 주장하지 않는다. 별도 run 테이블의 성공 통계와 cron supervisor 기록을 구분한다. 소유 run_details 중30일 초과 종료 기록만 TTL job의 bounded1000 청소 대상으로 추가하고 다른 job 이력은 손대지 않는다.

**잠금·내용 고정:** 정정 timeout executor도 catalog_head 공유→Issue update 순서를 사용한다. evidence_digest는 m1_prepare/claim 검증이 읽는 모든 claims와 evidence_edges의 값(검증 플래그·기한·출처/소유그룹 ID·경로 포함)을 ID 정렬한 canonical JSONB에서 해시한다. 현재 시간 유효성 검사는 hash 비교와 별도로 수행한다. 카탈로그/정책의 전역 version이 바뀌면 관련 없는 이름·순서 변경이어도 HELD하는 보수적 결정을 유지한다. 예약 UI의 확정 직전과 운영 목록에 ‘카탈로그·정책 게시 또는 초안 변경 시 기존 예약 보류, 최신 미리보기 후 다시 예약 필요’를 안내한다. 자동 최신판 재승인은 이번에 넣지 않는다.

참고한 기술 원문: [PostgreSQL statement_timeout](https://www.postgresql.org/docs/18/runtime-config-client.html), [simple query의 여러 문장 트랜잭션](https://www.postgresql.org/docs/17/protocol-flow.html), [pg_cron job_run_details·동일 job 실행](https://github.com/citusdata/pg_cron). 이 문서는 기술 동작의 근거이며 현재 제품의 실제 cron 시험 성공을 대신하지 않는다.
