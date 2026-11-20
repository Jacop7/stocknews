# MAIN PARALLEL P2 — 목록 진행·게시 판본·사건 방향 결속

사용자의 자동 진행 및 홈/수집기 오케스트레이션 지시를 이어간다. P1은 1f05ebe7a363c02c74e4f7e8c2286fbeab8a227a/489파일로 구현 DUAL·전체검사·커밋/푸시를 마쳤다. 실제 뉴스 서비스 완료는 아니다. 다음 세 독립 source 범위를 동일 계획 및 구현 DUAL로 검수한다. 과거 원격 PLAN 3/3 상한·HOLD·Router 비활성·원문 결과를 바꾸거나 재시도하지 않는다.

## 실행 책임과 경계

먼저 이 계획을 Opus 5.5 medium(우측 IAB 기존 검수 채팅)과 gpt-6-astra ultra로 독립 검수한다. 통과 후 MAIN은 AI 방향 결정기를, 기존 native collector/home 작성자는 각각 자기 신규 세 파일만 구현한다. 작성 모델은 봉인 계획의 gpt-6.1-sol/high이며 MAIN이 모든 인수를 수행한다. 담당별 읽기는 관련 제품 source·계획·시험 자료만, 쓰기는 지정 파일만 허용한다. .env, .local-data, 인증/개인 상태, 다른 제품, Git 변경, 서비스/DB/네트워크 호출, 추가 위임은 금지한다. 각자는 자기 Node 단위 시험과 worker tsc만 실행할 수 있다. 이는 운영상 지시이며 OS sandbox/인증정보 접근 차단을 실증한 것이 아니다.

MAIN만 공통 파일·branch·전체검사·리뷰·커밋/푸시를 수행한다. 지적은 작성자에게 돌려 재작업하고 전체 source pin을 새로 고정해 전체 pnpm verify 및 같은 구현 case 수정 검수를 한다. 기본 검수 회차나 이전 이력을 초기화하지 않는다. 실제 수집/분석 provider·공식 권한·DB/영속큐/배포/푸시/기기 검증 승인이 아니다. 합성 입력의 verified/published 선언을 실제 확인으로 부르지 않는다.

## COLLECTOR — partition journal

신규 workers/collectors/src/partition-contracts.ts, partition-journal.ts, tests/collector-partition-journal.test.ts 세 파일. 기존 K1 checkpoint·R1 sink·acquisition 코드는 불변이다. 새로운 별도 SYNTHETIC_PARTITION_JOURNAL_P2 schema의 메모리 전용 journal이며 executionEnabled=false다.

partition은 sourceId/endpointId/navigationVersion/queryVersion/adapterVersion/sourcePolicyVersion/selectionPolicyVersion과 버전 envelope를 canonical SHA로 결속한다. ID를 cursor 원문으로 쓰지 않는다. 주입된 FakeClock과 R1 sink만 사용하며 실제 Clock·I/O·분산 lease는 없다. registry의 VERIFIED 선언으로 실행을 허용하지 않는다. fixture 목적별 권한·generation·knownAt·expiresAt CAS를 별도로 둔다. 모든 mutation은 정확 PipelineVersions와 현재 권한·lease·fence를 재검사한다. 잘못되거나 거절된 미래 시간은 watermark를 전진시키지 않는다. 만료 이후 소유권 재획득마다 fence가 증가하고 stale fence의 renew/release/scan/item/checkpoint 변경은 거부한다. R1을 직접 호출하는 외부 caller까지 차단한다고 주장하지 않는다.

명시 API registerPartition/setPermission/claim/renew/release/beginScan/appendPage/bindSourceIntent/settleItem/enqueueResume/readPending/prepareCheckpoint/commitCheckpoint/lookupCheckpoint/recoverCheckpoint/inspect. 세부 DTO는 담당자가 exact shape로 정하되 아래 불변조건은 바꾸지 않는다. 체크포인트는 partition별 정수 expectedVersion CAS이며 scan 시작 cursor/version에 결속한다. 페이지 ordinal·이전/다음 cursor reference·범위/구조/탭 검사·항목 identity를 불변 manifest로 저장한다. 동일 ID·상이 내용은 충돌이다. 페이지 단절/cycle/범위 누락/상한/실패는 gap이며 next=null 또는 첫 페이지 성공만으로 완료하지 않는다. 정상 빈 목록도 명시적인 구조·탭·범위 확인 및 최종 선언을 요구한다.

항목 terminal은 주입된 실제 R1 sink.lookup(intent)의 APPLIED 영수증에 결속한 SOURCE_STORED 또는 해당 selectionPolicyVersion의 명시적 합성 PASS만 허용한다. 성공 boolean은 받지 않는다. 최초 source intent를 먼저 고정하고 새 key로 불명 상태를 우회하지 않는다. H_BODY·권한 HOLD·UNKNOWN·확인되지 않은 terminal은 미완료이며 **resume job 등록만으로 checkpoint 전진 금지**다. resume는 동일 항목·intent·원래 deadline을 보존하는 메모리 기록일 뿐 영속 재시작 보장이 아니다.

checkpoint ACK는 operation/partition/backend generation/정확 envelope SHA에 결속한다. fault BEFORE_WRITE_LOST는 NOT_APPLIED일 때 동일 intent 재시도, AFTER_INTENT_LOST는 UNKNOWN/HOLD_EFFECT_UNKNOWN, AFTER_RECEIPT_LOST는 APPLIED 조회로 REUSED 복구한다. recovery는 새 쓰기를 하지 않는다. 다른 backend generation 거부. 권한 철회/lease 만료 뒤 APPLIED 이력 조회는 진단 자료일 뿐 checkpoint 쓰기/현재 처리 권한으로 재사용하지 않는다. 오류/상한에서 부분 mutation하지 않도록 사전 검사한다.

용량은 합성 partition128, 전체 item/resume300, page/effect/cursor1000 기본 상한, 축출/자르기 없음. 기존 JSON/depth/node 예산 유지. 시험: partition/tab 분리, lease 만료/재획득 stale fence, CAS 단일 승자, 다중/빈 페이지, gap/cycle/상한/탭 불일치, 실제 R1 세 fault, checkpoint 세 fault/상이 payload, H_BODY resume 차단/deadline/권한 철회, getter/예산/반환 격리, 거절 미래시간 불변. 프로세스 재시작·내구성·실제 수집은 후속이다.

## HOME — rankable batch B1

신규 packages/contracts/src/rankable-batch.ts, workers/home-ranking/src/rankable-adapter.ts, tests/rankable-batch.test.ts 세 파일. validateSyntheticRankableBatch(raw), buildSyntheticRankingInputs(raw) 순수 API로 {command,eligibility,bindingManifest}를 반환한다. schema SYNTHETIC_RANKABLE_BINDING_B1이며 실제 실행/공개/저장하지 않는다.

기존 Article/ArticleVersion과 명시적 fixture binding을 받는다. PipelineDraft.version 숫자와 ArticleVersion.id 문자열을 암묵 변환하지 않는다. story/issue/currentVersion/articleVersion.issueId/저장 초안 version/decision/evidence/assessment version을 정확 결속한다. COLLECT·초안/visibility 검사 통과를 PUBLISHED로 추론하지 않는다. 별도 **합성 게시 관측 assertion**을 받으며 실제 게시 영수증/DB snapshot이 아님을 schema/notes에 명시한다. PriorityIssue.version과 fallback issueVersion은 같은 ArticleVersion.id다. WITHDRAWN을 RETRACTED로 암묵 변환하지 않고 자격표에 원 상태를 보존하며 순위 후보에서 제외한다.

policy/catalog/source-policy/cutoff 고정. 완전성은 **명시 batch가 선언한 ISSUE/CLAIM fixture 집합**만 보증하며 세계 전체/DB 전체를 보증하지 않는다. watermark=cutoff와 exact 선언 ID 집합/관측/선택 판본의 완전 일치를 요구하고 누락/중복/상충은 batch 전체 거절한다. cutoff 이후 수신판본 제외는 기존 selectKnownRevisions 규칙을 재사용한다. 현재 정정 대기·숨김·철회·만료·근거 stale는 자격에서 차단한다. 네 영향등급 claim 참조는 동일 decision/evidence의 verified 근거와 연결하고 원출처/독립그룹을 유지하며 매크로 자격은 pipelineMacroEvidence를 재사용한다. verified 또한 fixture assertion이다.

최초게시/실질변화/검증/근거만료/예정종료와 cutoff 인지 시간의 정합성을 검사하며 재검증으로 최초일/materialChangeAt을 갱신하지 않는다. T/M/P는 이번 batch에서 공급하지 않고 모두 off. 기존 합성 context만 사용하며 실제 달력/세션/신호공급 의미를 확정하지 않는다. 기존 K1/P1/export/restore/공개 DTO/산식은 불변이다. binding manifest는 digest/판본의 보조 자료이며 P1이 이를 강제하지 않음도 표시한다. 실제 경로에는 신뢰된 producer·bound dispatch·게시 직전 현재자격 검사가 후속 필요하다.

시험: 정상 P1 propose/complete/JSON restore 연결, 초안/PASS만 존재시 거절, 각 판본 불일치, cutoff 뒤 정정·불완전 watermark, WITHDRAWN/정정대기/만료, 동일 소유그룹의 독립3 오인 차단, 안전복제/예산/결정성/격리. 기존 pending 폐기·장기 이력/실제 홈순위는 이번에 해결했다고 하지 않는다.

## MAIN — 사건 방향 제안 검증 A2

신규 workers/ai-processing/src/event-routing.ts, tests/event-routing.test.ts 두 파일. 순수 prepareEventRoutingRequest(rawContext)/acceptEventRoutingProposal(rawContext,rawProposal). 실제 모델 호출/사실추출/글작성/저장/게시를 하지 않는 검증 경계다. SYNTHETIC_EVENT_ROUTING_A2/fixtureAssertionOnly=true를 반환한다. 맥락은 PipelineVersions/asOf, canonicalStoryId/storyRevision, 완전한 기존 issue ID+version+angle+claim/path 집합, current source revisions와 PipelineDecision의 검증 fixture, KR 전달 경로와 기존이슈별 차이표다. JSON 예산·exact shape·current source 선택·판본·알려진 시각·유일 ID·bounded 집합(최대100issues/300claims)을 검사한다. generator/prompt/catalog/policy/evidence/story revision 및 전체 요청 SHA로 응답을 고정한다. canonical identity 배정·유사도 자체 판단은 수행하지 않는다.

제안은 requestDigest, proposedAction(NO_CHANGE/UPDATE/NEW_ANGLE/CORRECTION), targetIssueId 또는 null, angleCode, 참조 claim/path IDs, 각 기존 issue에 대한 비교표(comparison issueId/version, 동일방향 여부, 추가문단 충분 여부), independentTitleSubstance boolean, materialDifference boolean, correction claim references를 갖는다. 불신 모델 boolean은 검증된 fixture 분류를 대신하지 않는다. 새로운 사실/경로는 context의 명시적 verified fixture claim/path와 현재 decision 근거가 허용하는 차이로만 계산하며 가격/제목/표현 변화는 새 실질 변화로 인정하지 않는다. 새 방향 판정의 의미·semantic 비교는 입력 fixture의 assertion이며 실제 AI 검증 정확도를 주장하지 않는다.

NO_CHANGE는 기존 fact/path의 부분집합 및 correction 없음일 때만 허용하며 출처 보강은 본문 수정시각을 갱신하라고 하지 않는다. 기존 claim/path의 새 검증 근거 또는 세부사항 추가는 UPDATE 우선이다. NEW_ANGLE은 (1) 모든 기존 issue와 정확 version 비교 (2) 새 verified 사실 또는 새 근거가 결속한 KR 경로 (3) 독립 제목 실질+materialDifference (4) 기존 어느 상세의 추가문단으로도 충분하지 않음 (5) 어느 기존 방향과도 같지 않음을 모두 만족할 때만 가능하다. 미달이면서 적법 target을 지정했으면 UPDATE로 축소하며 적법 target이 없으면 HOLD다. 같은 사건의 긍정/부정을 제목만 분리하거나 가격 반응으로 NEW_ANGLE을 만들 수 없다.

CORRECTION은 기존 issue의 잘못된 claim과 이를 정정하는 현재 verified claim의 명시적 fixture 연결을 요구하고 우선 처리한다. 기존 최초 게시일·조회수·알림·materialChangeAt을 갱신하지 않는 순수 action plan만 반환한다. 실제 정정 공개 차단/연쇄영향 재검사/원자 commit은 후속이다. 입력 사건/issue version 또는 request SHA 불일치, 근거 미확인·상충·미래·권한 snapshot 부적격, 비교 누락은 HOLD(원래 deadline/wake 유지) 또는 구조 오류 INVALID_INPUT으로 fail closed한다. 제안에 외부 명령/추가 필드/프롬프트 인젝션을 허용하지 않는다. malformed proposal은 HOLD이고 context 자체 구조오류는 명시 오류다. 모든 반환 detached.

시험: 반복/표현/가격 NO_CHANGE, 세부추가 UPDATE, 5요건 NEW_ANGLE, existing 방향 누락/동일방향/추가문단충분 축소 또는 HOLD, 새 evidence 없는 path 거절, CORRECTION 연결 필수/우선, source/rights/evidence/story/issue/request 버전 mismatch, 미래·getter·추가필드·예산·반환 격리. 기존 A1/K1/visibility·출처 비교 로직은 바꾸지 않는다.

## 통합·증거·후속

기준1f05/489와 refs를 봉인한다. feat/main-parallel-p2에서 5기존수정(AGENTS/package/status/verify/foundation), 13신규(collect3+home3+AI2+전용guard1+stage문서4)만 허용한다. 기존 모든 파일은 이 5개 외 raw byte 불변. 새 test:collector-partition, test:rankable-batch, test:event-routing 세 그룹을 추가하고 기존 타입검사 glob에 새 모듈을 포함한다. rankable contracts의 Node-only 의존은 앱에 import하지 않는다. 새 guard가 P1 앞에 선택되고 과거 검사·provider·Node-only source/build 경계를 모두 보존한다. status의 새 단계는 productAiProcessingCalls=0/developmentAuthorInvocations=2/developmentModelRequestCount=UNMEASURED로 명명해 P1 actualModelCalls:0과 혼동하지 않게 한다. 이전 필드는 역사 바이트로 유지하며 뜻을 notes에 설명한다.

계획 DUAL → 세 구현 병렬 → MAIN 읽기/인수·단위+타입+기존 전체 pnpm verify·앱산출물 → 같은 전체 manifest 구현 DUAL → 수정시 작성자 재작업 및 전체 재검사 → 검증된 바이트 커밋/푸시·remote SHA 확인. 기존 검수·P3·실패 기록은 보존한다. 구체 구현 후 source-only 진행 상황과 실제 서비스 미연결을 구분해 다음 단계(신뢰된 분석/게시 producer, 영속 queue/DB commit, 실제 허용 adapter/provider, 홈 신호, 클라우드 worker)로 계속 진행한다.
