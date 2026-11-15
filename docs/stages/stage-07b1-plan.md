# 7B1 파급력 평가·후보·기본 정렬 구현 계획

2026.11.15 · 구현 전 계획 · 실제 뉴스·검색·시세 연결 결과 아님

## 1. 기준선과 다음 단계

제품은 `C:/Users/jacop/주식/judoju-news`, 원격은 `https://github.com/Jacop7/stocknews`다. 기준 main은 `aac3d3c1bd64b4d842bf51924cf895e4a5810d7b`이며 322개 추적 파일, 7A의 39개 계산 시험 및 구현 DUAL·원격 백업 증거를 확인했다. 이전 구현 문서의 REVIEW_PENDING 표시는 당시 후보 상태이며 현재 완료 증거는 `outputs/development-stages/reviews/stage07a-implementation/status.json`이다. 완료된 제품 바이트를 상태 정리 목적으로 바꾸지 않는다.

최신 권위는 `outputs/plan-unified-20261115/홈순위-운영개정안-v1.0.md`(SHA256 `8ab76a1bc0758b13ad6e97f237e799a77b645d59c53944b722e6d0895caf5a93`)와 그 DUAL r3 완료 증거다. 기존 09:10·10분·가격 중심 산식보다 최신 08:10·5분·파급력 중심 계약이 우선한다. 이번 7B1은 7B의 첫 분할 단계이며 실제 공급이 없어도 가능한 **독립 순수 합성 계산**이다. 후속 7B2는 24시간 5분 context/시장·달력·snapshot/CAS·Story 대표 선택·A/B/C 배치·안정화, 7B3는 공개 DTO·가격 미노출·검증 코드의 네이버 원본 링크, 7B4는 권한 확인 공급 검증이다. 8단계 전체 사이트/리포트/텔레그램 링크 수집과 9단계 독립 기사 작성은 그 뒤 독립 계획·검수한다.

최신 네이버 관심종목 등록은 사용자 UI 작업이다. 그것을 서버의 시세 수집 권한·실공급 승인·검증 master의 자동 승격으로 사용하지 않는다. 식자재 앱 코드/DB/키/worker/배포 사용 금지, iPhone 실기기 USER_DEFERRED, 실제 출처 112 RIGHTS_HOLD와 live7/8 CLOSED를 유지한다.

## 2. 이번 범위와 파일 경계

추가 모듈 `packages/domain/src/issue-priority.ts`는 고정 cutoff와 명시 SYNTHETIC 입력만 받는다. 외부 네트워크, DB, 파일 IO, 시스템 현재시계, 랜덤, 환경변수, 앱/API/worker 공개 entry 연결은 없다. REAL은 사용자가 허가 bool을 넣어도 거부한다. 합성 평가 입력은 이미 검증된 사실이라는 외부 증거가 아니다. 기사 진위/한국 영향 경로를 실제 자동 검증하는 엔진은 9단계다.

새 파일은 이 계획의 제품 사본·승인 JSON·7A 완료 영수증 사본·구현 메모, 위 모듈, `tests/issue-priority.test.ts`, `scripts/verify-stage7b1-foundation.mjs`다. 기준 322개 파일 중 변경은 `package.json`의 새 시험 명령, `scripts/verify.mjs`의 새 시험 추가, `scripts/verify-foundation.mjs`의 새 validator 분기, `docs/development-status.json`의 별도 issuePriorityPreparation 메타 4경로만 허용한다. 현재 stage6·native 미완료와 기존 모든 상태를 그대로 유지한다. 기존 7A 모듈·validator·domain index·contracts·DB/SQL·앱·admin·SDK·lockfile·출처 등록부는 동결한다. branch는 `feat/07b1-issue-priority`다.

새 validator는 기존 7A의 모든 격리·공급·스키마·native·기능 assertion을 보존한다. 단, 현재 Git branch/ref/HEAD/이력·main 기준, 새로 추가한 정확한 4경로의 허용 델타, 최종 report 식별, 자기상속 검사에 필요한 현재 파일명 비교만 명시적으로 변경한다. 원본 validator 자체는 동결한다. 원본 대비 교체 목록의 유일성·전문 일치를 검사하고 나머지 assertion 삭제를 거부한다. 새 baseline322개 동결, 허용4경로의 정확한 추가 변경, 새로운 시험의 실제 실행을 검사한다. 기존 7A가 6E를 비교하는 상속 검사는 과거7A 원본을 비교해 보존하고 현재7B1 파일의 다른 내용을 7A 내용이라고 판정하지 않는다. 새 Git guard는 검증된 7A base·그 단일 자식 정상 commit·정확히 그 자식의 hosted merge만 허용한다. 추가 commit/가짜 hosted ref/잘못된 parent는 거부한다. 검사 범위/강도를 줄이는 방식으로 통과시키지 않는다.

## 3. 입력과 결과 계약

최상위 입력은 `mode=LOCAL_SYNTHETIC`, `sampleKind=SYNTHETIC`, 고정 ISO UTC cutoff, policyVersion, catalogVersion, evaluationSetVersion, claim 목록, Issue 후보 목록이다. cutoff는 5분 경계 여부를 여기서 강제하지 않는다. 스케줄·시간대·시장 context 결정은 7B2 책임이며 이 함수는 **기본 정렬 초안**만 만든다. 실제 홈 snapshot·live queue·publish 결과로 사용하지 않는다.

각 후보는 고정 issueId/storyId/version, inputKnownAt, publishedAt, materialChangeAt, publicationState, contentClass, impactState, lastVerifiedAt/evidenceValidUntil, 선택 scheduledEndAt, assessmentVersion, 네 항목 등급과 근거 claim IDs를 가진다. scheduledEndAt도 동일 ISO 시각 형식을 검사하며 cutoff 이하이면 즉시 SCHEDULED_END로 제외한다. 등급은 정수0~5다. 모든 ID·시각·버전은 형식과 유일성을 검사한다. 동일 issueId의 복수 버전은 이번에 선택하지 않고 INVALID_INPUT으로 거부한다. 최신 판본·point-in-time 판본 선택은 7B2의 원자 입력셋 책임이다. 후보의 inputKnownAt이 cutoff보다 미래면 FUTURE_KNOWN_INPUT으로 제외하며 과거 판본을 추정하지 않는다. 게시/실질변화/마지막 검증 시각도 cutoff 이후일 수 없고, materialChangeAt은 publishedAt 이상, lastVerifiedAt은 publishedAt 이상이어야 한다.

claim은 claimId/version, originId, kind(OFFICIAL_ANNOUNCEMENT/FILING/ENACTED_POLICY/INDUSTRY_DATA/OTHER), knownAt, verifiedAt, validUntil, status(VERIFIED/UNVERIFIED/RETRACTED), sampleKind를 가진다. claimId 중복·미등록 참조·비정상 시각은 검출한다. knownAt/verifiedAt <= cutoff < validUntil, status=VERIFIED인 합성 claim만 현재 근거로 쓴다. 실제 claim 원문 검증이나 저작권 판정 완료를 뜻하지 않는다. 한 claim의 부재·철회·만료가 같은 참조의 이전 정상 자료로 숨겨지지 않는다.

입력셋 구조·mode·비유한 숫자·중복 ID·정수 범위·알 수 없는 enum/정책·잘못된 ISO 시각은 전체 INVALID_INPUT/LIVE_NOT_ENABLED로 거부한다. 구조는 맞지만 비공개·무관·근거 부족·만료인 개별 Issue는 reason과 함께 제외한다. 입력 배열/객체를 변경하지 않고 입력 순열과 관계없이 같은 결과를 만든다. 결과는 내부 진단용이며 policy/cutoff/버전, 평가결과와 제외사유, enabled/off 사유, 기본 정렬 issue ID를 반환한다. 공개 DTO나 실제 홈 카드 응답이 아니다.

## 4. 평가·적격성

파급력은 한국 전달 경로×8 + 영향 범위×4 + 경제 규모×5 + 지속성×3, 최대100이다. 전달 경로3 미만은 effective_I=min(raw_I,44)다. 75 이상 HIGH,45 이상 MEDIUM,나머지 STANDARD다. 방향 POSITIVE/NEGATIVE/MIXED/UNCERTAIN은 점수에 부호를 붙이지 않는다. 악재도 중요하면 HIGH다.

양수 등급 항목은 해당 항목의 유효 claim 참조가 하나 이상 있어야 한다. 규모/지속성3 이상은 OFFICIAL_ANNOUNCEMENT/FILING/ENACTED_POLICY/INDUSTRY_DATA 중 현재 유효한 근거를 요구한다. 미충족 시 임의로 등급2를 만들어내지 않고 EVIDENCE_GRADE_UNSUPPORTED로 해당 후보를 제외해 재평가 대상으로 남긴다. 전달 경로·범위 근거도 현재 유효해야 한다. grade0은 빈 참조 허용이다. 모든 근거 ID/평가 버전을 결과에 남긴다. 출처 수·텔레그램 수·가격·UV로 I를 생성하지 않는다.

publicationState=PUBLISHED, contentClass=SECTOR_EVENT 또는 SYSTEMIC_MACRO, impactState=ACTIVE이고 시각·근거가 유효한 후보만 포함한다. AD_PROMOTION/IRRELEVANT/UNVERIFIED, CORRECTION_PENDING/HIDDEN/RETRACTED, CHECK_PENDING/RESOLVED/INVALIDATED는 즉시 제외한다. 마감 이후까지 HIGH를 임의 유지하지 않는다. cutoff >= evidenceValidUntil 또는 cutoff-lastVerifiedAt >=24시간이면 EVIDENCE_EXPIRED다. evidenceValidUntil은 lastVerifiedAt 이후 최대24시간이어야 한다. 예정 종료 시각이 별도로 있으면 min(evidenceValidUntil,scheduledEndAt)를 적용한다. 24시간 경계에 자동 연장하지 않는다.

SYSTEMIC_MACRO는 현재 공식 핵심 claim1 또는 독립 원출처3과 한국 전달 경로를 **검증한 upstream 판정의 합성 참조**를 필요로 한다. 매체 숫자 bool이나 클립 전달 횟수는 받지 않는다. 이번 모듈에서는 macroGate={decision:PASS, gateVersion, claimIds, independentOriginIds}를 받아 유효 claim 존재, 공식 핵심 kind 조건 또는 서로 다른 originId>=3 및 claim과 origin 연결을 확인한다. originId는 근거 claim에 부여하며 별도 후보 문자열만으로 독립성을 주장하지 못한다. 이 검사는 원문 계보의 실제 독립성을 인증하지 않는다. 실제 게이트 판정·공식 핵심성 검증은 후속 분석의 역할이다.

## 5. 보조 입력·정렬

이번 모듈은 합성 정규화 T와 합성 대표 비교군 M, 합성24시간 UV를 시험 입력으로 지원한다. 실자료 수집/정규화·실측 가중치 판정은 하지 않는다. 각 signal은 SYNTHETIC, knownAt<=cutoff, 유효기간, version을 가진다. T는 동일 searchSnapshotVersion/mode와16개 묶음 완료를 명시한 합성 signal set, 후보별0~1 값이다. 모든 적격 후보가 유효하고 같은 버전을 써야 T on이다. MACRO_ALL의 T는0.5이며 검색셋 전체 유효성 검사 뒤에만 적용한다. 불완전한 검색셋의 부분 자료로 T를 켜지 않는다. 검색16묶음/앱11필터는 변경하지 않는다.

M은 HIGH를 제외한 적격 후보 전부가 동일 comparisonPolicyVersion·단위 percent·knownAt/validUntil을 만족한 합성 대표수익률을 가질 때만 on이다. M=min(abs(returnPercent)/10,1). HIGH의 M 결측은 다른 후보의 M을 끄지 않으며 HIGH 점수에는 M이 절대 들어가지 않는다. 이 단계에서 KRX/NXT/미국 세션과 조정정책을 검증했다고 주장하지 않는다.7A의 P3 조정 버전/point-in-time 공급 스냅샷은7B2/4에 남긴다.

P는 적격 후보5개 이상·UV합계50 이상·모든 후보의24시간 UV가 음이 아닌 safe integer이고 동일 집계 버전/같은cutoff/watermark 완전성인 경우 log1p(UV)/max(log1p(UV))다. 정상0과 missing을 구별하고 후보 하나라도 미확보면 전체 off다. 기존6D 집계/수집 코드는 사용하거나 수정하지 않는다. 제어된 합성 입력에서만 계산한다.

F=0.5^((cutoff-materialChangeAt)/6시간)다. 미래 시각을0시간으로 강제 보정하지 않고 제외한다. 근거 재검증/출처 재송고 시각으로 F를 초기화하지 않는다. MEDIUM/STANDARD는 I/T/M/P/F 비중50/20/15/10/5, HIGH는 I/T/P/F50/20/10/5로 가용 항목만 합계1로 재정규화한다. I,F는 항상 사용하고 결측T/M/P는0으로 채우지 않는다. 모든 후보가 같은 enabled 조합을 쓰되 HIGH는 언제나 M 제외다. off 사유는 NOT_PROVIDED/INCOMPLETE/EXPIRED/VERSION_MISMATCH/INSUFFICIENT_SAMPLE 등을 구분한다.

기본 정렬은 I구간 → 점수 내림차순 → materialChangeAt 내림차순 → issueId 코드포인트 오름차순이다. localeCompare·입력순서 의존은 금지한다. 이전context순위·5점/2회 안정화·HIGH carry_order·Story 대표 고정·A/B/C·발견 슬롯·섹터 다양성은 이번에 구현하지 않는다. 동일Story가 복수 후보이면 기본 순위에서 첫 후보1개만 반환하고 나머지는 STORY_DUPLICATE로 진단한다. 대표 Issue의 운영 고정/갱신은7B2에서 구현한다. **기본 점수 초안**을 실제 홈 정렬/대표선택 완료로 표시하지 않고 모듈 entry를 연결하지 않는 것이 이번 범위의 승인 조건이다.

## 6. 검증과 인수 기준

점수 척도는 I_norm=effective_I/100이며 raw_I를 합산에 사용하지 않는다. 다른 T/M/P/F도0~1이다. enabled 항목의 정수 비중 w를 사용해 score=100×sum(w×x)/sum(w), 범위0~100으로 고정한다. 예를 들어 MEDIUM I_norm=.60,T=.50,M=.20,P=.40,F=1이면 score=52다. 같은 입력에서 M off이면 score=100×49/85≈57.6470588235다. HIGH I_norm=.80,T=.80,P=.40,F=1이면 score=100×65/85≈76.4705882353이며 M이0→1이어도 같다. 이 수치들은 시험에서 허용 오차1e-10으로 확인한다. 표시용 반올림으로 내부 정렬을 바꾸지 않는다.

S7B1P-01 후속: 고등급 근거 미달이면 전체 후보가 재평가 전까지 제외되는 보수적 입력 경계임을 구현 메모/진단에 명시한다. 실제 평가 단계가 근거에 맞게 등급2 이하로 재평가하는 일은9단계이며 여기서 자동 하향 추정하지 않는다. 후보별 합성 T는 이미 파생된 시험 값이다.16개 묶음의 직접 영향 섹터 고정배분 가중평균과 실제 질의/공급 정규화는7B2/4의 별도 계약이며 이번에 구현했다고 주장하지 않는다.

의미 있는 합성 시험은 다음을 포함한다. grade0/5 및 I44/45/74/75 경계, 전달경로 상한, 고등급 근거 누락/만료/철회/미래수신, 공식 macro1·독립3과 전재중복/원출처 부족, 광고/무관/비공개/정정/철회/해소/만료 즉시 제외,24시간/종료시각 경계, 미래게시·미래수신·미래변화, 정상 UV0·표본5/50 경계·집계 결측, T한후보/묶음/버전 결측 전체off, M한후보 결측 전체off/HIGH제외, 음수수익률 절댓값, 모든 off 조합과 가중치합1, F6시간반감·재검증F불변, HIGH-AI vs 낮은조선급락, 두HIGH의 조선M0→1 변화 불변, 새로운중대조선 근거는 정상재평가, Story1개·동점고정ID·입력순열·입력불변, NaN/Infinity/범위/중복/REAL 거부다. 기사 제목 사례는 명시 SYNTHETIC이며 실제 뉴스 근거로 저장하지 않는다.

계획 DUAL READY 이후 구현 → 단위 시험/타입/전체 product-local pnpm verify → fresh clone 전체 verify와 Git guard 부정시험 → 구현 DUAL → 정확한 검수 바이트 normal commit → postcommit verify → normal push/remote SHA 확인 순서다. 검사 실패·P0~P2 지적은 수정본으로 동일 case 재검수한다. 계획과 구현은 별도 실제 작업이며 한도 회피를 위해 case를 나누지 않는다. 전체7B/M2/실공급/봇/실운영 완료를 주장하지 않는다. 완료 범위는 7B1의 미연결 순수 합성 평가·기본 점수 모듈뿐이다.

## 7. 다음 구현 순서

7B1 검수·백업 후7B2의 최신24h/5분/KR08:10~20:00·US 및 휴장 context, 입력셋 as-of/known-at·정정판본·원자 snapshot·동일Story대표·A/B/C·안정화 계획을 검수한다.7B3에서 실제 앱/API의 현재가·등락률·섹터평균·UV 제거와 원본 링크를 UI/브라우저/Android로 확인한다.7B4에서 허용 공급과 실제 종목코드·KRX/NXT/US 비교군·달력·조정정책을 검증한다. 미확정 공급은 off인 채로 진행 가능한 모듈·수집/분석 준비를 계속하며, 사이트/리포트/텔레그램 전체 등록부와 독립 작성 요구를 잃지 않는다.
