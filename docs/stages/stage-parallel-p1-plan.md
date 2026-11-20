# MAIN PARALLEL P1 — 세 작업의 파일 소유권과 통합 검수

사용자가 홈 순위와 수집기를 별도 담당에게 오더하라고 명시했다. 기존 원격 PLAN 역할을 재호출하지 않고, 이미 완료된 계획의 미확정 의존성을 피해 작은 구현 범위를 분리한다. 원래 collector HOLD·ranking OUTPUT_READY·3/3 상한·원장은 그대로 둔다. 이 계획은 새 native 내부 subagent 구현과 MAIN의 공통 계약 통합을 다룬다. 기존 원격 실행기나 Router endpoint를 활성화하지 않는다. 별도 채팅 생성·계정·인증·네트워크·실제 수집·DB·배포 권한은 주지 않는다.

## 진행과 책임

1. 이 병렬 통합 계획을 Claude Opus5.5 medium 및 Astra Ultra DUAL 검수한다.
2. MAIN은 공통 acquisition을, collector 담당은 순수 inventory/차단 recipe를, home 담당은 합성 명령 어댑터를 동시에 구현한다. 작성자는 MAIN과 두 gpt-6.1-sol/high 내부 subagent이며 검수자는 작성하지 않는다. 최소 문서와 정확 경로를 fork none으로 전달하고 이전 원격 author를 다시 보내지 않는다.
3. 두 담당은 자기 세 파일 외 쓰기·Git/커밋/공유설정 변경을 하지 않는다. 다른 담당 파일을 변경해야 하면 중지하고 MAIN에 요청한다. MAIN만 package/status/guard/AGENTS를 편입하고 모든 결과를 읽어 인수한다. 담당자는 자신의 단위 시험만 실행 가능하며 전체 pnpm verify·공식 검수·커밋·푸시는 MAIN 단독이다.
4. MAIN 통합 후 모든 source pin을 고정하고 전체 pnpm verify를 실행한다. 세 구현 전체를 같은 manifest로 Claude·Astra 구현 DUAL 검수한다. 지적은 원래 담당자에게 정확 범위로 재작업을 지시하고 MAIN이 다시 시험·동일 검수 case의 수정 판본으로 제출한다. reviewer가 코드를 고치게 하지 않는다. 기본 검수 횟수나 기존 이력은 초기화하지 않는다.

이번 분리는 운영상 파일 소유권 지시이며 OS sandbox나 인증정보 접근의 기술적 격리 증명이 아니다. 기존 G0C container/MXC 보안을 재현했다고 주장하지 않는다. 두 담당에게 .env·.local-data·private state·CLI 인증·계정·다른 제품의 조회 권한은 주지 않는다. 사용자의 새 병렬 업무 지시를 좁은 source-only 구현에 적용하며 역사 AGENTS G0A/G0B 활성화 조건을 실제 서비스/원격 실행기 허가로 우회하지 않는다. 제품 AGENTS에 이 좁은 현재 작업 경계를 추가한다. 이 제한을 기술적 자격증명 차단과 혼동하지 않는다.

## MAIN: 불변 본문 취득 / 현재 권한

정확 경로 workers/collectors/src/acquisition-store.ts, tests/acquisition-store.test.ts. 이미 DUAL READY인 outputs/development-stages/main-acquisition-a1/계획.md와 그 두 원문 보고서를 기준으로 구현한다. 원문 delivery는 수정하지 않고 별도 BODY sidecar와 private body map, 발행 ticket·own UUID·source digest·권한 generation/expiry·단조 시간 검증을 둔다. 실제 본문 수집/AI/DB/purge/영속 ACK 복구는 하지 않는다.

그 계획 검수 P3도 인수한다. 원문 read마다 assertPipelineVersions를 적용해 다른 policy/catalog의 R1 sink 원문은 거절한다. 동일 ticket/text/acquiredAt 재호출은 현재 권한·watermark를 다시 검사하면서 최초 acquisitionId와 acceptedAt을 유지한다. acquisitionId는 {ticket, body accept payload}의 digest이며 재검사 asOf는 효과 동일성에서 제외한다. 정상 parser 차이여도 같은 세대의 상이 bodyHash는 영구 HOLD이고 conflict 해소는 후속 계약이다. 거절/먼 미래 asOf가 watermark를 전진시켜 진행성을 막을 수 있는 현재 합성 Clock 한계는 notes와 시험으로 명시하고 실제 Clock로 주장하지 않는다. 원문 대표판본/current/stale 최종 자격은 별도 K1/AI 책임이다.

## COLLECTOR: 전수 inventory와 명시적 차단 recipe

정확 경로 workers/collectors/src/inventory.ts, workers/collectors/src/adapters/site-recipes.ts, tests/collector-inventory.test.ts. 입력은 기존 approved-registry/routes/permission-profiles/baseline 또는 명시 DTO의 순수 자료이며 파일/네트워크 I/O를 모듈 내부에서 하지 않는다. 기존 data/providers JSON과 policy.mjs를 읽기만 한다.

컴파일러는 source row→route→endpoint→permission profile 연결의 누락·중복·잘못된 참조·허용되지 않은 타입/ID/버전을 거부한다. 최대 300 source, 1000 endpoint 등 입력 크기와 getter/순환을 안전 검사한다. schema 버전과 source-policy 버전을 결속하고 원본 row/이름/분류/market/source/endpoint/profile IDs/content_filter/navigation/tab 정보를 보존한다. 원본 URL은 선언 자료로만 보관하고 호출하지 않는다.

현재 권위의 106 rows·112 endpoint·112 profile를 모두 포함하고 누락은 성공으로 처리하지 않는다. recipe resolver는 모든 endpoint에 BLOCKED와 구체적인 사유(권한 미검증/목적 미허용/adapter_version 미확정/검증된 selector·탭 recipe 부재 등)를 반환한다. VERIFIED라고 표시된 fixture도 별도 adapter 승인 계약이 없으면 실행 가능으로 승격하지 않는다. 모든 결과는 executionEnabled=false이고 실제 요청 계획·인증·fetch 함수는 없다. 누락과 미승인 recipe를 서로 구분한다. 순수 inventory/차단 자료 변환만 승인하며 실제 파서·수집기 전체·나머지 7개 계약 승인으로 해석하지 않는다.

시험은 실제 등록부의 106/112 전수 투영 및 모든 endpoint BLOCKED, 순서/row/다중 URL/탭 구분 보존, 누락·중복·profile 오연결·버전 혼합·getter/과대입력 거부, 사유 누락과 승인된 척하는 recipe 금지, 반환값 격리를 검증한다. acquisition/receipt/checkpoint/권한 writer를 호출하지 않는다.

## HOME: 합성 worker 명령 어댑터

정확 경로 workers/home-ranking/src/completed-adapter.ts, workers/home-ranking/tsconfig.json, tests/home-worker-adapter.test.ts. 기존 SyntheticCompletedRanking과 K1RankingCommand를 그대로 이용한다. 새 산식·T/M/P 자료·스케줄러·공개 DTO·K2 batch/달력/DB를 만들지 않는다. 전체 기존 ranking plan을 인수 승인하는 것이 아니라 그보다 좁은 명령 어댑터만 구현한다.

worker는 own SyntheticCompletedRanking 인스턴스를 만들고 dispatch(envelope)를 제공한다. 정확 envelope는 schema='SYNTHETIC_HOME_WORKER_P1', sampleKind='SYNTHETIC', operation, payload다. operation은 PROPOSE(기존 K1 command), COMPLETE({snapshotId,expectedRevision}), READ_LATEST(null), EXPORT_STATE(null), RESTORE_STATE(기존 engine export), FALLBACK(기존 engine 자격 입력)만 허용한다. 정확 shape와 안전 복제 후 기존 engine에 위임하고 반환은 schema/sampleKind/persistence='MEMORY_FIXTURE_ONLY'/operation/result로 감싼 안전 복제다. 잘못된 명령은 PipelineError, 기존 engine 실패도 그대로 보존한다. 엔진 자체나 mutable 내부 참조를 외부에 노출하지 않는다.

draft 완료 전 latest 변경 금지, complete와 재호출/충돌·expectedRevision 계약, export/restore genesis 재생·기존 완료 prefix 유지·fallback의 현재 자격 확인은 기존 engine에 위임한다. 현재 G0BI-02 stale draft 용량 한계를 고쳤다고 주장하지 않는다. 시험은 명령 경계의 두 단계 흐름, 거절 시 이력 불변, exact replay/잘못된 slot·revision, JSON 복구 및 불일치 거절, fallback 자격 누락 차단, getter/추가 필드/LIVE/잘못된 operation 거부, 결과 격리와 IO0을 검증한다.

## 제품 통합

기준69de171103f25f074d9f5f8cc9d9728820442fb4/476개와 refs를 봉인하고 feat/main-parallel-p1 브랜치에서 위 세 범위를 합친다. 5개 수정(AGENTS.md/package.json/status/verify/foundation), 신규13개(세 담당의8개 파일 + scripts/verify-parallel-p1-foundation.mjs + docs/stages/stage-parallel-p1-{baseline.json,preparation.json,plan.md,notes.md})만 허용한다. acquisition A1 단독 7파일 계획은 이 통합 계획으로 제품 편입 범위만 확대하며 원문·검수는 보존한다.

package에 test:acquisition, test:collector-inventory, test:home-worker-adapter, check:home-worker-adapter 네 그룹을 추가한다. collectors 새 두 모듈은 기존 check:source-receipts tsconfig glob으로 검사한다. 새 guard가 R1보다 먼저 선택되고 이전 모든 검사 그룹·provider/native·Node-only ranking/AI/R1 경계를 보존하며 새 acquisition/inventory/homeworker 표지까지 앱 소스/빌드 산출물에서 검사한다. 기존 data/K1/domain/R1/AI/guard/lock/앱 소스는 불변이다. 후보 pin·경로 집합·refs·기준/단일 자식/동일-tree hosted merge 규칙을 보존한다. 세 결과를 모두 인수하기 전 통합 성공·동시 개발 완료·실제 서비스 연결을 보고하지 않는다.
