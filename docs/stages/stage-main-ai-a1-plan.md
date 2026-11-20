# MAIN AI A1 — 제목·머리말 선별 제안 검증

사용자가 MAIN 직접 진행을 선택했다. 이전 원격 AI 작성자의 NATIVE_FAILED 원인은 미확정이며 원래 HOLD·호출 3/3·전송 이력은 그대로 보존한다. 이 단계는 그 실행기를 재시도하지 않는 새로운 제품 기능 개발이다. 계획 DUAL → MAIN 구현 → 전체 pnpm verify → 구현 DUAL → 한 기능 커밋·푸시 순서다.

## 결과와 범위

아직 비어 있는 workers/ai-processing에 순수 SYNTHETIC_K1_METADATA_INTAKE_A1 모듈을 만든다. 제목·머리말로부터 모델이 제안한 선별 결과의 구조·출처 판본·검색 대상 섹터·인용 구간을 검증한다. 실제 모델 호출이나 사실 판단의 정확도를 구현·인증하는 단계가 아니다. 실제 공급처/검색/텔레그램/본문 수집/AI API/DB 저장/기사 게시/순위 변경은 연결하지 않는다. 비밀정보를 읽지 않는다. K1 계약과 기존 앱·어드민 코드는 수정하지 않는다.

prepareMetadataRequest(context)는 입력을 안전 복제·검증하고, 선택한 현재 원문 판본의 제목·머리말만 담은 요청과 SHA-256 requestDigest를 반환하거나 HOLD를 반환한다. acceptMetadataProposal(context, proposal)는 같은 준비 검사를 다시 수행하고 proposal을 검증하여 PASS / HOLD / REQUEST_EVIDENCE만 반환한다. COLLECT·근거 검증 완료·게시 가능 상태는 절대로 반환하지 않는다. PASS는 이 메타데이터 평가 시점의 제외 제안이며 영구 차단·DB 중복 처리·권한 판정의 대체가 아니다.

## 입력과 결속

context의 정확한 필드: versions(K1, SYNTHETIC), revisions(최대 300개 K1 원문 판본), revisionId, asOf(엄격 UTC), sectorIds(중복 없는 1~100개 ID), eligibility({revisionId,permissionVersion,sourcePolicyVersion,analysisAllowed,expiresAt}), promptVersion, generatorVersion. 입력은 pipelineData/k1Record/k1Exact 등 기존 안전 검사를 사용하고 getter·순환·초과 크기·추가 필드는 거부한다. 잘못된 context는 PipelineError, 잘못된 외부 proposal은 안전한 HOLD다. SYNTHETIC 외 입력은 거부한다.

selectPipelineSources로 asOf까지 알려진 현재 판본을 고른다. 선택 판본 변경·시각 미확정·동시각 충돌·미도착·게시/수정 시각이 asOf보다 미래이면 HOLD. eligibility는 해당 revisionId, permissionVersion, sourcePolicyVersion과 일치하고 analysisAllowed=true, expiresAt>asOf일 때만 통과한다. 이 eligibility는 시험 입력이지 실제 이용권 검증 서비스가 아니다. 빈 머리말은 허용하며 제목은 기존 K1 조건을 따른다.

요청에는 고정 schema·versions·asOf·sourceDocumentId/revisionId/contentHash/title/lead·sectorIds·eligibility·promptVersion/generatorVersion만 넣고 canonical JSON의 실제 SHA-256으로 결속한다. 부수 필드 bodyRef는 요청에 포함하지 않는다. catalog 순서는 입력 순서 유지, 중복 금지. 동일 입력은 동일 요청. 현재 범위는 순수 동기 평가이므로 비동기 호출 사이의 권한 변경이나 저장 경쟁을 해결했다고 주장하지 않는다. 후속 실제 오케스트레이터는 저장/모델 호출 시 최신 원문·정책을 다시 읽어 CAS 및 권한 검증을 구현해야 한다.

## 제안 계약과 라우팅

proposal 정확 필드: requestDigest, classification(RELEVANT_EVENT / PURE_PROMOTION / PRICE_RECAP_ONLY / UNRELATED / UNCLEAR), newCatalyst(YES / NO / UNKNOWN), koreanImpact(MARKET_WIDE / SECTOR / NONE / UNCLEAR), sectorIds, confidence(CLEAR / UNCLEAR), reasonSpans. 자유로운 기사 본문·근거 확인 완료 표시는 받지 않는다. reasonSpans는 1~8개, 각각 정확 필드 field(title/lead), start/end(UTF-16 정수 구간), quote(비어 있지 않은 실제 부분 문자열 1~500자)다. 서로 완전히 같은 구간은 거부한다. 요청 digest 불일치, 허위 인용, 모르는 섹터, 중복 섹터, 추가 필드, 모순은 HOLD. 인용 일치는 모델 판단의 의미적 정확도나 독립 취재·공식 근거를 인증하지 않는다.

* CLEAR이고 PURE_PROMOTION/PRICE_RECAP_ONLY/UNRELATED 중 하나이며 newCatalyst=NO, koreanImpact=NONE, sectorIds=[]가 모두 맞아야 PASS. 홍보 형식이라도 신규 정책·계약 등 촉매가 섞였다고 제안되면 PASS하지 않는다.
* CLEAR·RELEVANT_EVENT·newCatalyst=YES이며 MARKET_WIDE(섹터가 있든 없든) 또는 SECTOR(허용 섹터 1개 이상)이면 REQUEST_EVIDENCE. 해외 기업 이슈도 한국시장/섹터 영향 제안이 있어야 한다. 이어지는 단계가 본문·공식 자료·독립 원출처·한국 영향 경로를 검증한다.
* 그 외는 HOLD. 부정적 이슈도 관련성 조건이 같으며, 상승/하락만으로 제외하지 않는다. 단순 키워드 포함은 근거 확인 완료가 아니다.

HOLD는 고정 reason과 asOf+24시간 deadlineAt, 명시 wakeOn(SOURCE_REVISION/POLICY_OR_PERMISSION/METADATA_REVIEW)을 반환한다. 재시도 스케줄러·영구 저장·EXPIRED_HOLD 처리는 후속 단계다. 결과에는 schema, sampleKind, evaluatedAt, revisionId, requestDigest|null, disposition, reason, deadlineAt|null, wakeOn[]만 있으며 원문 전체나 임의 오류를 출력하지 않는다.

## 제품 변경과 보호

기준 HEAD 24783e82694c2a26e10284d9f844b744029bb850의 460개 파일·기존 refs를 baseline.json에 봉인한다. 새 feat/main-ai-intake-a1 브랜치, 기준 또는 정확 한 자식 커밋만 허용한다. 새로운 파일 8개와 기존 5개만 변경한다. package에 test:ai-intake, check:ai-intake를 추가하고 pnpm verify에 두 그룹을 추가한다. 기존 전체 그룹·툴체인·릴리스 검사·아티팩트 경계는 유지한다. 기존 G0B 가드는 바이트 그대로 보존하고 새 단계 가드가 현재 기준의 전체 불변 파일과 새 범위·핀·역사 refs·검사 경로를 검증한다. 앱 산출물에 Node-only worker 및 기존 pipeline-ranking이 들어가지 않는지 전체 빌드 후 검사한다. 새 tsconfig만으로 검사해 의존성·lockfile을 바꾸지 않는다.

수정 가능 파일: AGENTS.md, package.json, docs/development-status.json, scripts/verify.mjs, scripts/verify-foundation.mjs. 신규 파일: workers/ai-processing/src/metadata-intake.ts, workers/ai-processing/tsconfig.json, tests/ai-metadata-intake.test.ts, scripts/verify-main-ai-a1-foundation.mjs, docs/stages/stage-main-ai-a1-baseline.json, stage-main-ai-a1-preparation.json, stage-main-ai-a1-plan.md, stage-main-ai-a1-notes.md(마지막 세 파일도 docs/stages 아래). 정확 sourcePins는 preparation 자신을 제외한다. 계획·시험·DUAL 원문은 제품 밖 reviews에 보존한다. 기존 .codex runtime/oldworker 상태는 변경하지 않는다.

## 검증

정상 홍보·시세 나열·무관 PASS, 혼합 촉매 HOLD, 한국 수혜/피해·시장 전체/개별 섹터 REQUEST_EVIDENCE, 인용 환각·구간 오류·잘못된 digest/버전·알 수 없는/중복 섹터·불명확 제안 HOLD를 검사한다. 권한 거절/만료/판본 불일치, 오래된/미래/시각미확정/충돌 원문, getter·추가 필드·초과 크기, 입력 불변·같은 입력 결정성, metadata에 bodyRef 비노출을 검증한다. Node 24.15.0/pnpm11.25.0의 제품 로컬 툴체인으로 전체 pnpm verify(타입·기존 회귀·어드민 빌드·Android/iOS JS/Hermes export 포함)를 실행한다. native 실기기/클라우드/실제 AI 선별 정확도는 완료 범위가 아니다. 전체 완료라는 표현을 쓰지 않는다.
