# MAIN SOURCE R1 구현 범위

정확한 source write 영수증과 ACK 유실 복구를 구현했다. SYNTHETIC fixture만 허용하며 실제 수집·네트워크·AI·DB·cursor·기사 게시를 연결하지 않는다. 기존 K1 DTO/strict facade/base/AI A1/앱/역사 guard는 바이트 보존한다. source effect 쓰기는 원래 존재하며, 이번 추가는 작업 종류·generation·실제 SHA·정확 영수증·불명 상태의 결속이다. legacy resolveEffect(null)를 미적용으로 해석하지 않는다.

계획 DUAL fef3284de4f192ad07ac54fd4d527464488207bdf58f1d6cb2eca954cb5c23dd. 계획과 구현 검수·백업·커밋 연결은 제품 밖 outputs/development-stages/reviews/main-source-r1-*에 보존한다. 16개 회귀/부정 시험 및 타입 검사를 기존 전체 pnpm verify에 추가한다. R1 guard는 A1보다 우선 실행되고 기존 A1/ranking/새 receipt worker의 앱 산출물 부재까지 검사한다.

SR1P-01 반영: input/버전/hash/capacity 검사는 UNKNOWN 기록 전에 거절한다. strict append에 들어간 뒤의 모든 예외는 실제 쓰기 전 상한 오류여도 보수적으로 UNKNOWN이다. 이 불명 상태는 영구 보류이며 해소 API는 이번에 제공하지 않는다. K1 300개·전체 JSON 예산이 sink 1000개보다 먼저 소진될 수 있다는 시험을 포함한다. 입력상 알려진 거절과 strict 호출 후 불명을 구별할 뿐 strict 오류를 확정 미적용으로 주장하지 않는다.

SR1P-02 반영: sink는 private 저장소를 외부에 내보내지 않는다. generation은 외부에서 지정하지 않고 생성 시 Node crypto.randomUUID로 만들며 private getter만 노출한다. 새 sink는 이전 intent를 generation 불일치로 거부하므로 새 빈 map의 NOT_APPLIED를 과거 결과에 사용할 수 없다. consumer 재호출은 같은 sink에서만 검증한다. 이 식별자는 인증이나 backend 영속성 증명이 아니다.

고정 fault는 쓰기 전 유실/UNKNOWN intent 후 유실/저장·영수증 후 ACK 유실이다. recovery는 저장·키 생성 없이 RECOVERED/RETRY_SAME_INTENT/HOLD_EFFECT_UNKNOWN을 반환한다. 조회 불가에서도 HOLD한다. map은 비축출/최대1000이며 실제 retry예산·내구성·backend process 재시작·multiwriter·권한철회·복구/CAS는 미구현이다. 다른 공유 7조건과 원래 수집기 HOLD/3회 상한 및 기존 P3를 이 단계로 종결하지 않는다.
