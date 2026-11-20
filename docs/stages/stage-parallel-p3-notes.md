# MAIN PARALLEL P3 통합과 한계

502파일 a3441e6 기준, 계획 r2 DUAL manifest 4e087f3d69d9b1743c3efd2a1a82f1f98d693ce5624630f381e0c7d61f977c1b 뒤에 MAIN이 admin·AI를 직접 구현하고 기존 두 담당은 collector/home 각각 네 파일만 작성한다. 운영상 범위 지시는 OS sandbox/인증정보 격리 증거가 아니다. 기존 source·data·provider·lock·SQL·소비자앱/공개 DTO는 선언된 9개 수정 외 바이트 보존한다.

Admin: 기본 비활성화·allowlist·fingerprint-before-grant·getUser/JWT/owner·CSRF·SQL notApplied를 보존한다. fetch/body 요청8초/256KiB/4096chunks, 주로그인45초, close/Auth local logout 각각3초, 총52초다. 생산 환경 한도 override는 없으며 fixture clock은 fixture transport에만 결합한다. AbortSignal과 실제 timer가 대기를 끝내고 abort/cancel 무시와 늦은 resolve/reject는 관측한다. 이미 원격에 보낸 요청 취소나 늦은 open/grant 잔여 제거를 증명하지 않는다. known token 실패는 독립 local logout, openAttempted는 동일 hash close를 최대1회 시도한다. 실패 원문 고정 오류·SQL 거부를 보상 오류로 덮지 않는다. actual route를 transpile해 VM fixture runtime/NextResponse로 실행, authorized logout 시작 후 실패에도 cookie 제거를 확인한다. 실제 hosted HTTP·native 기기 증거가 아니다. VM 모듈은 시험 전용이다.

Collector: COLLECTION_READ_P3는 현재 offline authority와 소유 ticket/observation으로 DNS/peer/redirect/response/bytes/hash/권한세대·retention을 검사한다. 실제 transport·socket pinning·허가 인증·HTML selector·영속 BodyStore/checkpoint는 제공하지 않는다. registry112개 endpoint의 차단 상태를 바꾸지 않는다. structured JSON listing과 Telegram entity 링크만 처리하며 전체 Telegram 본문 전달/검색 fallback은 연결하지 않는다. 모호한304나 parse 실패를 빈 목록으로 바꾸지 않는다.

MAIN AI: ANALYSIS_INPUT_P3는 private brand를 확인하고 import시 고정된 원 prototype readForAnalysis를 호출한다. caller body/override·Proxy·subclass·위조instance를 취득 포트로 쓰지 않는다. 현재 ANALYSIS/STORAGE·retention/세대/hash/sourcePolicy/발표시각/원출처·독립그룹을 확인하고 모호하면 HOLD다. 한국 상장주식 관점과 catalog/analysisPolicy/prompt/generator/sectors/checkedAt를 canonical digest에 결속한다. bounded text는 untrusted data이고 코드·도구·모델 호출은0이다. source fixture provenance나 brand가 실제 사실/권한/독립3곳을 증명하지 않으며 READY는 COLLECT/작성/게시 승인도 아니다. AI→collector 단방향이며 소비자앱에는 포함하지 않는다.

Home: constructor의 producer/current/clock/generation은 명시적 offline fixture다. private pending과 staged engine/bindings/응답 예산을 검사한 뒤 owned state를 한 번 교체한다. 새 후보+이전 저장 카드의 현재 전체 관측과 P2의 모든 본문claim을 검사한다. 누락 옛카드는 거부하지만 명시 WITHDRAWN/HIDDEN으로 제외된 옛카드는 적격 새snapshot 완료를 막지 않는다. 현재 읽는 snapshot에 차단 카드가 있으면 전체 CALCULATING이다. checkedAt과 5분 cutoff 분리, async 뒤 fence/head CAS 및 복원을 검사한다. 실제 DB의 동일 transaction이나 durable truth·32상한/폐기를 구현하지 않는다.

정식 check:home-ranking은 home src/**/*.ts를 base 상속으로 검사한다. 기존 check:home-worker-adapter와 test:rankable-batch Node시험은 보존하며 기존 inline tsc만 정식 그룹으로 이관한다(MPP2-05 구현 대응, 최종 DUAL 확인 전 종결하지 않음). 새 네 시험과 한 타입검사, worker 앱/번들 차단·admin helper 소비자/client 차단을 전체 verify에 추가한다. 모든 이전 검사·marker는 보존한다.

보존 한계: MPP2-04 H_BODY partition 진행성, MACQP-01 clock watermark와 MACQP-03 동일세대body충돌, MPP1-04 begin ACK/capacity, G0BI-01 source대표교체, G0BI-02 stale/32상한, MPP1-01 운영제한, G0CMN-01 지정private범위만, G0CFI-03 Test-Path, C11C1P-01 늦은open잔여, G0CXI-02 splitCANCEL, CL11AI-01 실제admin host/writer/supervisor 및 CL11AP-01/02/03, CL10HR/HP/GR-01 실제권한/만료/프로세스/인벤토리는 이 단계로 종결하지 않는다. 기존 원격3/3/HOLD/Router와 계정/서비스 상태를 재설정하지 않는다. 전체 통합 검수·백업 뒤 커밋/푸시하며 실제 연결·클라우드24시간·기기·스토어는 후속이다.


# P3 구현 r2 수정·회귀 근거

r1 전체 manifest 4347e956fa60b4d0f11d14aad6f6faa628637adec543b0836d45bf1ea11f5fd6, 원 source·전체검사·각 담당인계와 양측 원문은 r1 ZIP(34e1fc08942ee33621585348f116f4d28779af469ca20ed987b0eddd2a7b9762)·r1-preservation.json에 보존했다. 원문 verdict나 finding을 편집하지 않는다. 두 역할 종료 전 다른 검수자의 결과를 전달하거나 source를 바꾸지 않았다.

Claude MPP3I-01과 Astra MPP3-02: 원 취득 purpose를 소유 ticket에서 public metadata에 결속한다. MAIN AI는 ORIGINAL_ACCESS만, Telegram/listing reserved parser는 목적과 무관 차단한다. 수집기는 Telegram 최소 구조를 저장 전에 직접 검사하며 full-message/미확정 extra 필드를 거절한다. link-only grant와 원문 접근은 별개이며 caller parse-success는 쓰지 않는다. 실제 모델 호출이나 메시지 수집을 했다는 뜻이 아니다.

Astra MPP3-01: redirect를 보낸 현재 hop의 DNS/peer/수신시각/headers/raw bytes·hash·예산 관측을 원 ticket에 묶고 공통 응답 검사를 통과한 뒤 다음 DNS/hop을 발급한다. 이전 관측 없는 DTO는 거절한다. 실패 시 소유 state를 바꾸지 않는다. 이 검사는 offline 관측 assertion이며 실제 DNS/socket pinning 증거는 아니다.

Astra MPP3-03: 저장 binding의 본문·등급·macro·영향/시나리오·위험·일정의 고정 의존성을 현재 claim과 다시 대조한다. 같은 Article/evidence/assessment 판본명 아래 참조를 교체·삭제하여 철회된 근거를 숨길 수 없도록 한다. read는 전체 CALCULATING, complete는 상태 무변경 거부를 요구한다. 명시 제외한 옛 카드와 누락 옛 카드의 구분은 보존한다.

동적 재현은 제품 소스를 되돌리지 않고 r1 ZIP 바이트를 제품 밖 별도 replay 경로로 복원하고 새 회귀시험만 덮어 실행했다. AI는 기존9 PASS+새2 expected FAIL, home의 새 문제2개는0 PASS/2 expected FAIL, collector의 새 문제4개는0 PASS/4 expected FAIL이다. 각 argv·시험/source archive·log SHA는 ai/home/collector-r1-regression.json과 원 log에 보존했다. 이것을 수정본 성공 시험으로 보고하지 않는다. 이후 수정 source pin으로 전체 pnpm verify와 같은 case r2 DUAL을 다시 통과해야 한다.

기존 원격 회차/HOLD/Router, 실제 키·권한·네트워크·DB·AI·게시 미활성 상태는 유지한다. 새 P3/기존 이월은 독립 근거 없이 종결하지 않는다. 관리자 코드/검사는 이번 r2 보완과 무관하여 r1 바이트를 보존한다.
