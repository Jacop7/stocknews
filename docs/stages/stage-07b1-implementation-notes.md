# 7B1 파급력·후보·기본 정렬 구현 후보

기준 main aac3d3c, 승인 계획 DUAL r2 c15d05a3/MD ce9d3183을 따른다. 신규 미연결 순수 SYNTHETIC 함수 draftIssuePriority만 추가한다. 실제 게시/홈/시세/검색/AI/UV 공급,9단계 근거 진위 검증 엔진이 아니다. 종목 관심등록 작업을 서버 수집 허가로 사용하지 않았다.112 RIGHTS_HOLD/live7·8 CLOSED/iPhone USER_DEFERRED/currentStage6·P03b 미완료를 유지한다.

등급별 현재 합성 근거, 한국 전달 경로 상한, 음수 악재의 중요도, 공개/정정/영향상태/24시간 및 예정 종료, macro 공식 핵심1 또는 claim-origin 연결3을 검사한다. 고등급 근거가 부족한 입력은 전체 후보를 재평가 전까지 제외한다. 자동 하향이나 새로운 사실의 추정은 하지 않는다.1개 issueId의 복수 판본을 받아 임의 최신 선택하지 않는다. known-at cutoff 이후 입력은 현재 후보에서 제외한다. 이 단계는 저장소 point-in-time 재구성 또는 실제 자료 계보를 인증하지 않는다.

effective_I/100와 T/M/P/F의 공통0~1 척도, 가용 가중치 재정규화, HIGH M제외, normal0과missing, P5개/UV50·log1p, F6시간 반감, Story1개·순열 재현·고정ID 동점 순을 구현한다. 검색T는 이미 파생된 합성값이며16묶음 질의/공급 계산과 직접영향 배분은 후속이다. S7B1P-02에 따라 신호 모집단은 **Story 중복 제거 전 적격 후보 전체**로 고정했다. 따라서 중복 후보도 P 표본/합계에 포함되고, 그 후보의 신호 결측은 해당 공통 신호를 끈다. 중복 포함5개→최종4개에서 P가 켜지는 경우와 M결측 전파를 경계시험에 명시했다. 이는 실제 운영 대표선택이 아니며7B2의 Story대표·안정화·A/B/C 연결 전 계약을 별도 검수한다.

기존7A validator와 모든 기존 기능·DB·API·앱·worker·native·lockfile는 바이트 동결한다. 새validator는 기존 전문과 정확한12개 치환 목록의 유일성·전문 일치를 비교한다. 현재 Git history/main/ref와4경로 정확한 새 델타 및 아래 승인된 시험 한 건의 좁은 예외만 바꾸고 다른 assertion은 보존한다. 이전7A 자기상속 검사는 동결7A 원본을 읽어6E와 비교하고, 새7B1 전체상속 검사는 현재 새validator와7A 원본을 별도로 비교한다. 이전검사 우회·빈분기·실패무시 방식이 아니다. baseline322개 중 허용4파일 및 정확히 제한한시험1개 외 전체를 다시 동결한다. 단일 정상후속 commit·검증hostedmerge와 가짜ref/extra commit 부정시험은 별도 실행 증거다.

전체verify 최초local/fresh는 기존providers 합성 DNS-timeout 시험이 현재시각에 의존해 RIGHTS_EXPIRED로 실패했다. 원문 실패 로그를 보존했다. 별도 시계 보완안 DUAL 9a5d5ddf/MD5103acd4 승인 후 tests/providers.test.mjs의 마지막 probe에 now:()=>time 한 번만 추가했다. 실제 만료검사·프로필·timeout/requests0 및 다른assertion은 그대로다. 기준aac3d3c 원문에서 그 문자열이 정확히1회임과 현재파일 전체가 정확한치환결과임을검사한다. 다른probe호출들은 base의 고정now 또는 별도명시고정now를 사용한다. 이파일의추가변경·다른시계·중복치환은새검사에서거부한다. 기존7A guard자체는동결상태다.

단위·타입·전체verify 및 fresh clone·구현DUAL·commit 이후 검증/원격백업은 외부 실행 영수증에서 확인한다. 여기의 구현 후보를 실제7B/M2/봇/운영 완료로 표시하지 않는다. 새 DB migration과native 빌드는0개다.7B2 시장·5분snapshot/CAS·대표선택·안정화,7B3 공개 DTO·가격 미노출·원본링크,7B4 허용실공급과7A P3 조정/known-data 집합 과제는 남는다.

구현 r2: S7B1I-C01 및 S7B1I-01(1)은 새 적격후보 배열을 issueId 코드포인트로 정렬한 뒤 신호 검사해 혼합결측의 reason까지 입력순열과 무관하게 수정했다. T/M/P 각각 missing+expired 및 missing+version 조합의 순열을 시험한다. S7B1I-C02는 macroGate에서만 쓰는 claim IDs도 assessment 근거와 합쳐 정렬·반환하도록 보완했다. 독립3과 별도공식core가 assessment밖 근거를 잃지 않는지 시험하고, gate가 선언한 core/origin 참조가 실제gate claim에 없으면 차단한다. 최신 단위시험48개이며44개는r1 역사기록이다. S7B1I-01(2)의 MACRO_ALL T 값 항목은 이번 승인계획의 보수적 완전성 계약에 따라 필수이며, 실제7B2 입력 계약에서 재검토한다. 이전7A P3 두 건은 그대로 후속 과제다.

구현 r3: S7B1I-C03의 sparse array 우회를 차단했다. ID 배열의 모든 위치를 Array.from으로 순회하고 own 인덱스·문자열 ID를 확인해 holes와 상속 인덱스를 거부한다. 근거0개/[5,5,2,2]/Array(1)로 HIGH76을 만들던 입력, 부분구멍·상속인덱스, 매크로 근거/원출처 및 검색16묶음의 sparse 배열을 INVALID_INPUT으로 거부하는 회귀시험을 추가했다. 최신 단위시험은50개이며48개는r2 증거다. 기존 허용범위·공급·상태·산식·검사스크립트는 바꾸지 않았다.
