# 7A 순수 시장자료·수익률 계산 준비

기준 b7d14c5, 계획 DUAL r2 a945ba87 및 계획 MD dd89e0e7를 따른다. 실제 M2·운영·전체6·P03b 완료가 아니다. 현재 단계6과 native 보류는 유지하고 별도7A 준비 상태만 추가했다. 실제 공급·화면·API·DB·worker·native entry와 연결하지 않았다.

새 market-metrics.ts는 고정 시계와 SYNTHETIC 입력만 받는다. REAL은 permissionVerified=true여도 거부한다. 종목 ID·venue·통화·코드 충돌과 동일 listing의 다중 ID를 거부하고, 미매핑 구성은 coverage 분모에 남긴다. 달력은 venue별 명시 날짜·coverage·휴장·정규장 시각·버전·유효기한으로 조회하며 빈 날짜를 휴일로 추정하지 않는다. 장중 LAST와 직전 완료 종가, 장외 마지막 완료/그 이전 완료 종가를 선택하고 실제 거래일을 유지한다. DST·조기 종료는 명시된 시각과 거래소 timezone을 사용한다.

최신 asOf의 가격 충돌·잘못된 수신/조정/가격은 과거 값으로 숨기지 않는다. 가격과 비교 가격은 단일 레코드에서 취한다. 잘못된 통화·세션·미래·120초 초과 LAST·기업행위 미확정·다른 조정 기준·비유한/0/음수는 결측으로 처리한다. 수익률의 부호와 원정밀도를 보존하며 0%와 자료 미확보를 구별한다. 고유 구성 N의 ceil70%와 min(3,N)을 모두 만족할 때만 유효 종목 동일 비중 평균을 제공한다. 서로 다른 거래일·가격 유형·조정 버전의 비교군은 MIXED_COMPARISON_BASIS로 차단한다. TODAY 밖 기간은 미지원이다.

기존6E validator 파일은 원본 바이트 그대로다. 새7A validator는 정확한 Git branch/ref/history/main/report 치환 외에 모든 원본 assertion을 계승했음을 원본 대비 문자열 검사한다. baseline315개 기존 파일의 네 경로 외 동결과 package/dispatcher/전체verify의 정확한 추가 변경도 검사한다. 7A 단일 정상 후속 commit과 제한된 실제 hosted merge만 허용하며, fake hosted·잘못된 부모·추가 로컬 commit은 거부한다. 새 clone의 실제 ref 부정 시험은 별도 실행 증거로 구분한다.

단위 fixture는 모두 합성이고 실제 거래일·주가 공급 시험이 아니다. 전체 verify·새 clone·인덱스·구현 DUAL·commit 이후 검사와 원격 백업 결과는 외부 영수증에 연결한다. 아직 검수 전 구현 후보다. 기존 runtime23은6E 당시 역사 증거로 보존하며 이번 순수 계산 모듈의 DB 시험으로 다시 명명하지 않는다. 112 RIGHTS_HOLD, live7/8 CLOSED, 실제 뉴스/AI/시세/푸시/광고 요청0, iPhone USER_DEFERRED를 유지한다.

구현 r1 재검수 보완: S7AI-CODEX-01은 최신 asOf 집합의 모든 receivedAt을 검사하여 정상 중복이 역전된 수신시각을 가리지 못하게 수정했다. 가격 충돌 우선순위는 유지한다. 정상+역전/미래 중복의 입력 순서를 바꾼 사례와 충돌+잘못된 수신의 우선순위 사례를 추가했다. r1의37개 시험은 보존된 역사 기록이며 최신 시험은39개다. Claude S7AI-01의 종목별/전역 조정 버전 의미와 S7AI-02의 과거 시점에 알려진 자료 집합 정의는 실제7B 공급·스냅샷 계약에서 확정할 P3 후속으로 남긴다. 현재는 계획의 보수적 동일기준 차단과 최신 무효 fallback 금지를 유지하며 실공급이나 과거 저장소 snapshot 재현을 인증하지 않는다.
