# P4 작업 및 검증 기록

현재 구현 중이다. 시험·수용·운영 성공을 아직 주장하지 않는다. 실제 관리자 C2는 별도 후속 계획이다. HOME capture context.signals off-all은 검증 뒤 원 엔진 ContextInput 복사본에서 제거하고, 원 엔진이 state.contextInput에 다시 도출한 값을 시험한다. 기존 엔진은 변경하지 않는다.

계획의 세 번째 판본은 Claude Opus 5.5 medium 및 독립 Codex Ultra 모두 READY이며, 원문과 ZIP은 제품 밖 검수 폴더에 보존했다. 그 후 MAIN이 두 기존 담당에게 정확한 8개/6개 소스 오더를 전달했다. 실제 자격을 확인할 수 없는 옛 원격 worker를 재활성화한 것이 아니다.

MAIN은 AI 입력 단위시험 8개와 AI(collector import 포함)·HOME 타입 검사를 관측했다. 단위시험의 DB 포트는 명시적 합성 mock이며 실제 PostgreSQL 취득 증거가 아니다. 이후 구성요소 소스 변경 및 최종 전체 후보에 대해서는 전체 시험을 다시 결속해야 한다.

새 자원 protocol probe에서는 PostgreSQL cluster/DB·새 LOGIN·동일 backend 세션·BEGIN/ROLLBACK·고정 오류·같은 실행 컨테이너 안 서버 stop/start 뒤 probe 행 유지·정리를 관측했다. 제품 collector/HOME SQL은 적용하지 않은 시험이다. 첫 probe는 Docker tmpfs 관측 필드 차이로 실패했고, 소유 CID/label 재확인 뒤 별도 복구 정리를 수행했다. 다음 probe는 재시작 인자 누락으로 실패했으나 자기 자원 정리는 통과했다. HostConfig.Tmpfs exact map과 최초/재시작 동일 PostgreSQL options를 적용한 세 번째 probe는 통과했다. 실패 원문과 복구 증거를 삭제하거나 최초부터 성공으로 바꾸지 않았다. 이 시험은 제품 DB 수용·전원 장애 영속·운영 배포의 성공이 아니다.

이 문서는 구현 후보의 범위와 중간 관측 기록이다. 최종 전체 pnpm verify·두 자원 통합·구현 DUAL·백업·정확 커밋/푸시의 판정은 제품 밖 검수 영수증에 결속한다. 아래 중간 성공만으로 최종 후보나 운영을 인증하지 않는다. 진행 중 소스는 WIP_NOT_REVIEWED_NOT_DEPLOYABLE 백업으로 별도 보관한다.

중간 설치·시험 이력: collector의 첫 SQL은 두 번의 새 격리 설치 검사에서 9표/8RPC/권한/identity 검사를 통과했다. HOME의 첫 SQL은 `_result_shape`의 IF 안 bare CASE 식 때문에 SQLSTATE42601로 거절됐고, 해당 식을 괄호로 감싼 수정 SQL에서 12표/8RPC/권한/진단 principal 3개 거절과 정리를 관측했다. HOME 단위시험은 초기에 5/13만 통과했으며 fixture가 승인 profile 대신 sourcePolicyVersion 없는 inputBatch를 segment hash 함수에 전달한 부분을 수정한 뒤 13/13 통과했다. collector 단위시험은 초기 12/13에서 `map(check)`의 index가 검증 함수의 max 인자로 전달되는 결함을 고친 뒤 13/13 통과했다. 실패 기록은 그대로 유지한다.

collector CORE 첫 두 실행은 DB01에서 INVALID_INPUT으로 중단됐고 자기 자원 정리는 통과했다. 두 번째 실행의 본문 없는 RPC boundary 기록에서 IDENTITY ACK 두 건 뒤 ISSUE_GRANT RPC 전 실패를 확인했다. 승인된 purposes enum의 underscore를 canonical record key 규칙이 거절하는 원인을 담당과 함께 확인했으며, TS·SQL 동시 정정 및 실제 grant 회귀를 진행한다. 설치 성공과 CORE 성공을 구별한다. 본문/키/원 SQL/원 trace를 boundary 로그에 넣지 않는다.

그 뒤 승인 enum의 underscore를 TS·SQL 양쪽 코덱에서 수용하되 command exact schema는 유지했다. 추가 회귀를 포함한 collector 단위 14개가 통과했고, SQL `69a4312f…`의 새 격리 시험에서 CORE 21개·FINAL epoch fence·실제 합성 PG→MAIN AI 입력 READY·fence 후 새 읽기 HOLD와 정리를 관측했다. DB22는 만료 뒤 COMMIT 가능성과 현재 읽기 차단을 재현한 것이며 물리 COMMIT 권한/라이선스/물리 purge 해결이 아니다. HOME SQL `bdb10e1d…`의 설치·ACL·진단 principal 거절 및 실제 read에서 쓰는 private age predicate의 고정 SQL 15분 포함/+1µs/+1ms 결과를 관측했다. 고정 시각 정책 검사는 실제 15분 경과·실제 32/288회 RPC와 구별한다.

구현 r1의 독립 Codex 검수는 MP4I-01 P2로 CHANGES_REQUIRED였다. SQL Known/Unknown discriminator의 JSON null이 SQL의 세 값 비교를 통과하는 결함이다. 원문 검수·수정 전 SQL·수용 helper·검수 입력 ZIP을 보존했다. MAIN은 기존 SQL `69a4312f…`와 새 helper `35a0c0b3…`를 새 자원에서 실행해 publishedAt 및 필수 provenance 3종의 null-state 네 변형 모두 PUT APPLIED, delivery/effect 각각 +1, raw READ READY/AVAILABLE을 실제 재현했다. 본문은 고정 합성 fixture이며 로그에는 본문을 넣지 않고 오류코드·boolean·행 수만 기록했다. TypeScript command/read validator를 우회하는 정확한 raw typed digest 및 전용 native RPC를 사용했으며 정상 grant/audit/positive control도 확인했다.

그 후 SQL `fc194c28…`는 state의 non-null string enum 선검사, NULL-safe scalar/type·교차조건, READY 직전 필수 known shape/value 재검사를 보강했다. 정상 선택 필드의 UNKNOWN은 유지한다. 같은 helper와 새 독립 자원의 AFTER_FIX에서는 네 변형 모두 INVALID_INPUT, delivery/effect 증가 0, 상태 불변, READ_UNAVAILABLE/본문 미반환과 정리를 관측했다. 기존 CORE 21개를 유지하고 DB23 네 변형을 필수 추가한 22개 CORE로 전체 수용을 다시 해야 한다. 독립 raw-null 진단 export는 fullCoreAcceptanceProven=false이며 전체 CORE 영수증 브랜드가 아니다. 이 국소 관측만으로 P2의 독립검수 종결·현재 후보 전체 검증·구현 DUAL·실제 운영 완료를 주장하지 않는다. 최신 전체 결과와 재검수 원문은 제품 밖 영수증에 결속한다.
