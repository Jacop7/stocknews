# MAIN AI A1 구현 범위

제목·머리말 모델 제안의 출처·판본·필드·인용·섹터 검증을 구현했다. 16개 의미/부정 시험과 worker 타입 검사를 기존 전체 pnpm verify에 추가한다. 실제 모델·검색·기사 정확도·권한·비동기 CAS·DB·게시·자동재시도는 구현하지 않았다. REQUEST_EVIDENCE는 본문과 공식/독립 근거를 확인해야 한다는 요청일 뿐이다. PASS/HOLD를 K1 PipelineDecision에 기록하지 않으며 후속 변환은 별도 계약과 검수가 필요하다. A1 HOLD의 asOf+24시간은 A1 전용 재검토 기한이며 K1 72시간 상한과 별개다.

계획 DUAL manifest: feff4625809a08204045c8d36ef820b3bfe10c4b1f21cbec942f11662a03893f. 원문과 백업은 제품 밖 outputs/development-stages/reviews/main-ai-a1-plan에 있다. 구현 DUAL과 커밋 연결은 동일 reviews 아래 implementation에 별도로 보존한다. 검수 후 제품 바이트를 결과 기록 때문에 바꾸지 않는다.

MA1P-01 반영: A1 분기가 g0b보다 먼저 새 guard를 선택하고 artifact 검사도 새 guard를 선택한다. 이전 guard 바이트는 유지한다. pipeline-semantics/ranking 및 providers 검사는 유지하고 새 guard도 pipeline-ranking의 Node-only 앱 산출물 부재 검사를 이어받는다. 정확 5개 기존 파일/8개 신규 파일, 기준 460개·역사 refs·전체 이전 검사 그룹을 검사한다.

MA1P-02 반영: 0≤start<end≤UTF16 length 안전 정수, quote===slice(start,end), quote 1~500 UTF16 code units, 공백뿐인 인용·빈 lead 구간·중복 구간·surrogate pair 중간 절단을 거부한다. 실제 단어를 포함하지만 오프셋이 틀린 시험과 올바른 반복 단어 위치를 함께 확인한다. 부분 문자열 일치는 의미적 사실 확인이 아니다.

MA1P-03 반영: A1은 K1 repository/effect 호출이나 PipelineDecision 생성 없이 별도 schema의 메타데이터 평가 결과만 반환한다. 새 guard는 module import/export 경계와 앱 산출물 부재를 검사한다. 원문 재전달 tie의 대표 변경 시 HOLD하는 기존 G0BI-01 정책은 유지한다.

이전 실행기 원인 미확정/HOLD/호출 상한은 바꾸지 않았다. 수집기 설계 인수는 DESIGN_REFERENCE_ONLY이고 공유 계약 8개 선행조건은 미해결이다. 홈 순위 개별 계획 검수·실제 연결, 어드민 실제 연결, AI 근거·중복 사건·상세 작성·유사성 검사, Docker 24시간 운영·스토어 출시는 남아 있다. 기존 G0CMN-01/G0CFI-03/C11C1P-01/G0CXI-02/G0BI-01/02 및 CLOUD 계열 P3도 이 기능으로 종결하지 않는다.
