# MAIN SOURCE R1 — 원문 저장 영수증과 응답 유실 복구

MAIN이 직접 구현한다. 기존 수집기 원본 HOLD와 3/3 상한·이력은 바꾸지 않는다. 수집기 인수의 8개 공유 계약 중 exact source receipt를 먼저 구현하는 새 범위이며 나머지 계약이나 전체 수집기 착수를 승인한 것으로 해석하지 않는다. 계획 Claude·Astra DUAL → 구현 → 전체 pnpm verify → 구현 DUAL → 커밋·푸시 순서다.

## 기능

workers/collectors/src/source-receipts.ts에 Node-only SYNTHETIC_SOURCE_RECEIPT_R1 모듈을 만든다. 실제 네트워크·AI·DB·인증·목록 수집·cursor 전진·기사 게시를 연결하지 않는다. 기존 K1 DTO·strict facade·메모리 저장소는 그대로 사용한다. 원문에 bodyRef를 추가하거나 판본을 덮어쓰지 않는다. 기존 resolveEffect(null)를 확정 미적용으로 해석하는 어댑터를 만들지 않는다.

SyntheticSourceReceiptSink는 독립 SyntheticK1Repository와 최대 1~1000개의 비축출 영수증 map을 소유한다. versions와 storeGeneration(ID)은 생성 시 고정한다. 원문만 저장하는 타입이며 decision/draft/checkpoint는 아직 범위 밖이다. 기존 base도 source effect를 기록한다는 정정을 유지한다. 부족했던 것은 쓰기 자체가 아니라 작업 종류·envelope digest·불명 상태의 조회 계약이다.

makeIntent(rawWrite)는 K1 exact write를 안전 복제·검증하고 source/value와 envelope versions 일치, payloadHash가 실제 canonical value SHA-256과 같은지 확인한다. intent는 정확 schema, sampleKind, operation=APPEND_SOURCE_EXACT, storeGeneration, commandDigest, command 필드다. commandDigest는 schema·operation·storeGeneration·command 전체의 canonical SHA-256이다. key는 원래 command.effectKey를 유지한다. storeGeneration/버전/원문/키/해시를 바꾼 intent는 거부한다. getter·순환·추가 필드·과대 입력·LIVE는 거부한다.

write(intent, fault=NORMAL)는 intent를 재검증하고 같은 key의 다른 canonical envelope는 EFFECT_CONFLICT다. 이미 APPLIED이면 같은 정확 영수증을 REUSED로 반환한다. UNKNOWN이면 쓰지 않고 EFFECT_UNKNOWN이다. 신규 저장 전에 capacity와 안전 복제를 확인한 뒤 UNKNOWN intent를 먼저 기록하고 strict append를 호출한다. 성공한 receipt를 검증·복제해 APPLIED로 고정한다. 호출 후 예외나 모의 중단은 UNKNOWN을 유지한다. 알려진 거절과 불명 결과를 섣불리 합치지 않는다. 무한 retry나 축출은 없다.

lookup(intent)는 같은 lifetime의 이 sink가 소유하는 독립 map을 조회한다. APPLIED는 operation·effectKey·commandDigest·storeGeneration·정확한 source receipt와 결속된다. 해당 key가 없으면 이 storeGeneration 안에서만 NOT_APPLIED이며, UNKNOWN이면 UNKNOWN이다. 다른 key/명령과 충돌이면 EFFECT_CONFLICT다. legacy resolveEffect를 호출하지 않는다. 결과는 안전 복제한다.

recovery(intent, lookupAvailable=true)는 APPLIED→RECOVERED(동일 영수증 REUSED), NOT_APPLIED→RETRY_SAME_INTENT(정확히 같은 intent), UNKNOWN 또는 조회 불가→HOLD_EFFECT_UNKNOWN을 반환한다. 조회 불가는 map을 읽지 않는 별도 고정 상태다. recovery는 저장을 호출하거나 새 effect를 만들지 않는다. 실제 retry 예산·journal·queue·CAS·내구성은 후속 계약이다.

명시적 fault fixture는 BEFORE_WRITE_LOST(쓰기나 intent 기록 전 전송 실패), AFTER_INTENT_LOST(UNKNOWN만 기록하고 중단), AFTER_RECEIPT_LOST(실제 저장과 APPLIED 기록 후 응답만 유실), NORMAL이다. 모의 오류는 고정 SourceAckLost이며 비밀/본문/임의 오류를 메시지로 내보내지 않는다. 실제 strict append 예외는 UNKNOWN으로 두고 원래 PipelineError를 다시 전달한다. 이후 쓰기는 동일 key에서도 막히며 재조정 기능은 이번에 제공하지 않는다.

## 재시작과 한계

시험에서 client 함수를 다시 호출하거나 새 consumer가 같은 sink를 참조하는 경우를 재시작으로 다룬다. backend process 재시작, map 소실, durable journal 또는 multiwriter atomicity를 증명하지 않는다. storeGeneration을 재사용한 새 map을 과거 미적용의 증거로 사용할 수 없다. 실제 연결 전 영속화 및 storeGeneration 권위·fencing·정정/권한 재검사·partition cursor·acquisition sidecar 계약이 필요하다. SYNTHETIC fixture는 같은 사용자의 임의 조작에 대한 보안 경계가 아니다.

## 변경과 시험

기준 0384a6526db693d7103b02b2a2cefcf40280166b/468개 파일을 봉인하고 feat/main-source-receipts-r1 브랜치에서 5개 기존 파일(AGENTS.md, package.json, docs/development-status.json, scripts/verify.mjs, scripts/verify-foundation.mjs)과 신규 8개(위 worker, workers/collectors/tsconfig.json, tests/source-receipts.test.ts, scripts/verify-source-r1-foundation.mjs, docs/stages/stage-source-r1-{baseline.json,preparation.json,plan.md,notes.md})만 변경한다. 의존성·lock·기존 K1/AI/앱/어드민 코드 및 역사 guard는 바이트 보존한다.

새 R1 guard가 A1보다 우선 실행되고 기존 A1 및 pipeline-ranking 앱 산출물 경계도 이어받는다. 기존 전체 검사 그룹·provider/native 검사에 test:source-receipts와 check:source-receipts를 추가한다. 기준 전체 source/refs/한 자식 commit/후보 pin·추가 import·산출물 경계를 고정한다. 검수/시험 원문과 결과는 제품 밖 outputs/development-stages/reviews/main-source-r1-*에 저장한다.

시험: 정상 쓰기/정확 재호출, 의미 같은 두 exact delivery 보존, 같은 effect 다른 원문·operation·generation·versions·digest·payloadHash 거부, BEFORE_WRITE와 AFTER_RECEIPT 유실 복구, AFTER_INTENT 불명에서 쓰기와 재시도 금지, 조회 불가 HOLD, 현재 sink의 NOT_APPLIED와 기존 null 구분, capacity 소진 시 기존 receipt 불변, strict append 실패 UNKNOWN, 복구가 새 effect/쓰기 호출을 만들지 않음, consumer 재호출 시 동일 sink 결과 유지, malformed/getter 입력과 결과 변조 격리를 검사한다. 전체 pnpm verify는 어드민 빌드와 Android/iOS JS/Hermes export 포함이며 실기기/실제 클라우드 수집 완료를 의미하지 않는다.
