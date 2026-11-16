# CLOUD09C — 예약·유지보수 개발 DB 적용 기록의 제품 보관

CLOUD09B 실제 적용 결과는 두 독립 검수 READY(f24c4877)와 1,064개 파일의 검증 ZIP(54cfdbfd), 독립 재조회, 전후 대시보드 및 writer 폐쇄로 검증됐다. 이 계획은 실제 개발 DB 변경을 재실행하는 단계가 아니다. Git 기준 6dccc5fe/22 commits/404 files와 origin/main 일치를 고정하고, 기존 399파일을 동결하며 다섯 파일만 정확히 변경하고 여섯 파일을 추가해 410파일로 만든다. 원격 DB/API/CLI/Auth/권한/cron/app/worker 변경은 0이다.

추가: 단계 계획·승인·구현 노트 세 문서, reservation-maintenance-dev/adoption.json, archive/20261116000105_cloud09a_reservation_maintenance_disabled.sql, verify-cloud09c-foundation.mjs. archive는 정확한 UNBOUND A 1,230,288B SHA289f2447의 감사 자료다. native history의 raw5는 공백·주석·CRLF·세미콜론 및 BEGIN/COMMIT를 그대로 보존한 실제 native7 기록이며 B outer를 포함하지 않는다. prepared 주석을 수정하거나 원래 로컬50 migration·이전 archive를 재작성하지 않는다. 실행 workdir/config/CLI인증/profile/PGP packet은 Git에 추가하지 않는다.

최신 docs/development-status.json#cloudReservationMaintenance selector는 actual71 data/72relations/177app functions/native7/head2/339unresolved/341holds/fingerprint031743b9를 기록한다. 이전 cloudSearchInstallation의66, cloudReference의57 및47E 자료는 역사적 기준으로 보존한다. liveVerified=false이고 앱/어드민/worker는 미연결이다. 옛66 data와152함수 및 managed helper는 보존됐고, 원래 QA body를 private legacy alias로 보존한 noCron 분기 적응 하나만 존재한다. 새5표는 비어 있으며 46–50의 비활성 구조가 추가됐어도 cron/gateway 실제 실행·활성화는 별도 단계다.

B 원실행11파일과 폐쇄후11파일 SHA, 정확히 두 LF guard만 추가된 차이, unit26/fixture15/실제Lockrace1/폐쇄entry2, 전체43요청(GET8/ROPOST34/dev write1/prod write0) 및 ledger128파일을 보관한다. 원문 intent에 명시적 검증 preflightManifestSha256(15ae17c7)이 flush/fsync 전 결속된 점을 기록한다. 과거 C08B intent에 이 필드가 없었던 사실은 그대로 유지한다. actual intent→ack 5.343898초는 네트워크 포함이며 서버 실행시간 미계측, local 정상1.25초와 다르다. 실패2회 및 조립/index확장 이력은 보존하고 PASS로 합산하지 않는다. 최신 result-r2/verification-r2만 권위 자료이며 원래 보고서도 삭제하지 않는다.

CL09BP-01 운영 불변식: pg_cron extension/schema/relation이 모두 부재인 사실만 검증됐다. pg_cron 설치 자체가 QA purge 분기의 의미를 바꾸므로 genuine capability·retention의 별도 계획/시험/검수 전에는 설치 금지다. 후속 실제 preflight도 이 전체 부재를 재확인해야 한다. cron-present full retention/1000batch/live scheduling은 미검증/보류이며 가짜 cron·권한을 만들어 통과시키지 않는다. 이 조건을 제품 adoption, selector, validator 및 노트에 함께 기록하고 검증한다.

전후 UI/독립check0001/postbaseline이 B 검수 전에 post-ui-anchor로 결속됐음을 기록한다. Free/Data API off/settingWrites0 관측이며 동일PNG 가능성·시점 한계가 있다. scoped Auth uid/users/sessions metadata와 요구 namespace 이외의 전체 managed Auth·사용자행·C binary·지속적 live 상태를 인증하지 않는다. historical namespace equality NOT_ESTABLISHED_NO_PRE_APPLY_PROJECTION을 보존한다. prod app/native0, M2false/112RIGHTS_HOLD/iPhoneUSER_DEFERRED, 실제뉴스AI가격푸시0, 신원 미검증 회사 code/market/price/stockURL null을 유지한다.

다섯 수정: status에 새 selector만 추가, dispatcher에 최신 분기만 추가, verify.mjs의 toolchain 직후 기존 C8 독립 validator 항목 하나를 C9로 정확 교체, CI 기존 C8 독립 step 하나를 C9로 정확 교체한다. 원래23그룹+최신독립1=24다. 기존 validator 파일은 동결하고 이전404검사를 현재410에 직접 실행해 통과했다고 주장하지 않는다. 새 validator는 실제 실행목록·Git source/root/ref/layout·정확 다섯 diff·399동결6추가·archive/adoption/selector/cron운영불변식을 검사한다.

계획 DUAL 후 구현한다. 검사는 현재 전체24 → 독립 Git 객체 checkout/frozen dependencies install/410동일 SHA/전체24 → 별도 owned negative checkout에서 archive·selector·cron불변식·독립entry/CI·dispatcher우회·refs 변형 거부, publisher8 순서다. 검증용 fresh 자체를 변형하지 않는다. 실제 pnpm pipeline negative는 별도 negative checkout의 의존성 준비 후에만 수행하며 설치실패를 정상 거부로 세지 않는다. 각 실패는 보존한다. 결과 DUAL 후 source ZIP 검증 → 정상 feature commit → committed 독립 clone 전체24 → 검수된 immutable OID feature push → main FF 및 같은 OID push → combined remote refs 확인 → 최종검증 backup/status다. force/reset/rebase/production refs 삭제/empty commit은 없다. branch는 feat/cloud09c-reservation-maintenance-archive다. hosted Actions 성공을 로컬 실행으로 대신 주장하지 않는다.

이 단계는 기록 보관이며 전체 서비스 완료가 아니다. 실제 gateway/Auth, 앱·어드민·worker 연결, 실제 수집/AI/이용권한, cron genuine proof, 운영배포 및 08:10 KRX/NXT–20:00/해외장과 기존09:10 계약 정합은 별도 후속 단계다. 식자재 앱의 코드/DB/설정/서버는 사용하지 않는다.


r2 원문 줄바꿈 보존 보완: A SQL에는 CRLF 73개가 포함되어 있고 현재 .gitattributes의 기본 text=auto eol=lf는 새 archive를 자동 정규화할 수 있다. 따라서 다섯 번째 mutable file을 .gitattributes로 명시한다. 기존 bytes 뒤에 줄바꿈과 주석 및 정확한 새 archive 경로 한 줄만 추가한다: `supabase/cloud/reservation-maintenance-dev/archive/20261116000105_cloud09a_reservation_maintenance_disabled.sql -text -filter -ident`. 다른 경로의 규칙은 그대로 유지한다. 최종 파일 수410/추가6은 같고 동결399/변경5다.

새 validator는 .gitattributes baseline bytes에 승인된 suffix만 더한 정확 diff를 검사한다. archive는 effective text/filter/ident가 unset이고 working-tree-encoding이 unset 또는 unspecified여야 한다. archive의 73 CRLF 및 전체 SHA289f2447과 raw native source가 보존되어야 하며, 기존 cloudSources의 LF 조건을 이 새 원문에 무조건 적용하면 안 된다. 새 archive만 정확 혼합 줄바꿈 SHA로 검사하고 기존 source의 LF 검사는 유지한다. git hash-object --no-filters와 실제 path 필터 해시가 같아야 하며 stage index·fresh clone·git archive에서도 전체 bytes/SHA가 같아야 한다. .gitattributes suffix 삭제/다른 경로 확장·effective text/eol/filter override·archive LF 정규화도 의미 있는 거부 시험에 포함한다. 원 A/DB/native 기록은 수정하지 않는다.
