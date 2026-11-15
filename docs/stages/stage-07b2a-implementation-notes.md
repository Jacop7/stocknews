# 7B2A 구현 후보 · 실제 DB/홈 연결 아님

기준8bd7083의331파일에서 승인 계획 d4daae56/MD7e00b5be를 따른다. home-snapshot.ts는 고정5분 cutoff, 명시 한국 달력, 목표 한국 거래일 D, 진단 segment와 비교context, knownAt 시점 최신 판본, canonical envelope, 순차 CAS 전이 모델만 구현한다. 앱/API/worker/domain index/기존7A·7B1/DB/native와 공급 연결은 그대로다.

segment는 비교context에서 제외해 동일시장/목표D/버전/가용조합의 자정 이동을 새 비교로 만들지 않는다. 달력 자체가 현재일을 포함하지 않거나 미래수신·만료·다음OPEN미포함이면 보류한다. 주말 이름·한국 휴일·미국 실제개장을 추정하지 않는다. 매일288 cutoff는 논리적 시각 검증이며 실제288작업 스케줄을 돌린 결과가 아니다.

원자 자료 읽기는 구현하지 않았다. complete/watermark는 합성 선언이고, 참조본문의 contentId·revision 불변성은 실제공급 증거가 아니다. 늦은 정정이 과거cutoff에 섞이지 않고 마지막BLOCKED가 이전VALID를 복구하지 않는 선택 규칙을 시험한다. canonical은 동일내용 비교 메타이며 암호학적 해시/서명으로 부르지 않는다. envelope는 원입력에서 재계산하고 현재state의 구조/구성/canonical을 검사한다. 실제 동시 트랜잭션과내구성은7B2C다.

7B2B의 대표·A/B/C·5점2회 안정화·HIGH carry와7B2C의15분 fallback·현재 공개자격 재검사·원자DB는 남는다. 기존7B1 신호모집단/산식은 그대로이며 운영대표선택 완료로 재사용하지 않는다.112 RIGHTS_HOLD/live7/8 CLOSED, 실뉴스/AI/시세/푸시/광고요청0, iPhone USER_DEFERRED, 전체7B/M2미완료다. 검수·시험·Git·원격결과는 외부 영수증에서 확인한다.

구현 r2: S7B2AI-C01은 배열에 사용자 iterator/추가 속성/별도 prototype을 허용하지 않고, 검증된 own data 인덱스를 내부 배열로 복사해 소비하도록 수정했다. 저장이력을 비우는 iterator와 정상 판본으로 바꿔치기하는 iterator·getter가 실행되지 않음을 시험한다. S7B2AI-C02는 정확한 전체 own key 집합과 enumerable data descriptor를 요구하고 T/M/P 각각 boolean인지 검사하도록 수정했다. 숨겨진 필수 필드를 다른 키로 메우는 입력, symbol/비열거 추가속성, 반환 signal 객체의 입력 공유를 차단한다. 신규 회귀4건 포함46시험이다. r1의42시험/검수 원문은 역사 증거로 보존한다. S7B2AI-01 결과동일/원천상이 recipe의 canonical·실입력 manifest 구분은7B2C에 남긴다.
