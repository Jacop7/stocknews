# 6E 예약 게시·정정 timeout·유지관리 구현

기준 main `10cdfefb1f5eed7ffbeac76f8dbfb17f018a6b34`, 계획 DUAL r2 `5baf320c018729e3d67e4bb47e75c2951f3a7f628ee9bc4fa4a75000e3a910c3`. 현재 구현 재검수 전 후보이며 전체6·P03b·운영 완료가 아니다. iPhone은 사용자 보류다.

수동 예약은 미게시 DRAFT만 허용한다. 예약 의도·actor·revision·content/evidence hash·due/expiry를 별도 private 행에 둔다. 60초 이후~90일 이내, 15분 초과 지연은 EXPIRED다. 현재 membership/app_role/ban/deletion, catalog/policy, claims·독립3·한국 경로를 실행 때 다시 확인한다. 초안 저장은 예약을 HELD로 바꾸며 카탈로그/정책 변경도 보수적으로 보류한다. 관리자 역할 회수는 세션 만료와 구별한다. 잘못된 본문을 정정 예약이라는 이유로 계속 노출하지 않는다.

기존 관리자 wrapper는 인증을 유지하고, 공통 private 게시 코어는 actor를 명시적으로 받아 예약·수동 게시에 같은 검증을 쓴다. cron에서 관리자 JWT를 위조하지 않는다. catalog→Issue→draft→schedule 잠금, request UUID와 effect key로 중복을 막는다. 취소와 실행 경합의 승자만 반영하며 이미 게시된 글의 취소는 숨김이 아니다.

SQL1~45와 기존 검사·인증·공개 read·mock worker·모바일/native SDK 입력을 보존하고46~49를 추가했다. 소유 로컬 DB에 원자 적용한 SHA는 ignored 전용 intent에 남긴다. 기존 Supabase CLI migration history는 바꾸지 않았으며 이 적용은 별도의 소유 로컬 DDL 영수증이다. SQL46~49는 적용 후 불변이고 수정은50+로 추가해야 한다. cron은 migration이 자동 활성화하지 않는다.

소유 pg_cron 세 job은 예약/정정 매분, TTL 매시간17분이다. command는 5초 statement/2초 lock 제한, soft4초/최대20개다. 한 tick이 한 트랜잭션이므로 치명적 오류는 앞선 항목과 내부 run 기록까지 모두 rollback한다. 실제 실패는 별도 cron supervisor 기록으로 확인한다. 전체 작업을 항목별 commit했다고 주장하지 않는다. 실제 timeout/rollback proof와 고정 command hash가 없으면 재개를 거부한다. 다른 job을 변경·삭제하지 않는다.

정정 진입 clock은 trigger로 기록하고 같은 pending 상태의 반복 요청으로 초기화하지 않는다. 과거 clock이 없는 기존 pending은 migration 시각부터 유예한다. 24시간 경계에서 여전히 pending이면 WITHDRAWN과 outbox를 원자 처리하며 원문을 복원하지 않는다.

보관은 raw30×24h, daily1년, settings history30일이다. 유형별1000개씩 삭제하며 FK 순서·원시 만료 질의 제외·삭제 ledger를 유지한다. 만료 receipt 암호문만 지우고 replay 방어 tombstone은 삭제하지 않는다. 개인정보 전체 삭제나 backup 소거를 완료했다고 표현하지 않는다. 기존 coverage gap의 보수적 PARTIAL을 자동 해제하지 않는다.

검증 범위: 순수 입력/KST/요청 복구5개, rollback 예약 계약12개,1001개씩의 TTL fixture7개, 실제 HTTP 권한/CSRF/멱등5개, commit된 실행→취소·취소→실행·저장→실행 세 경합에서 실제 pg_blocking_pids 차단을 관측했다. 실제 소유 cron은5.002908초에 timeout되어 두 글 모두 version/outbox0으로 rollback했고, fault 제거 후 다음 실제 tick에서 두 원래 예약이 각각 version1/outbox1과 익명 공개 상세로 연결됐다. 후속 수동 반복의 새 게시0도 확인했다. 실제 probe를 재사용하는 검사 호출은 REUSED_PRIOR_ACTUAL_CRON_OBSERVATION으로 구분한다.

관리자는 ‘예약·유지관리’에서 예약/보류/취소/게시 상태·KST·기한·실제 job 상태·backlog를 본다. 기사 작성은 저장·미리보기 후 예약할 수 있다. 브라우저 결과 불명확 시 sessionStorage에는 비밀 없는 owner tag·요청 ID·정확한 인수만 보존하고 같은 요청을 재확인한다. 다른 관리자 계정으로 자동 재전송하지 않는다. consumer 설치 capability로 이 메뉴를 사용하지 못하며 관리자 API에 CORS를 추가하지 않았다. 공개62330은 그대로 GET/HEAD 및 credentials 거부다.

브라우저 날짜 선택기는 DOM 입력 ref에서 명시적인 KST 문자열을 읽으며 실제로 표시된 날짜와 예약 명령 값을 일치시킨다. 초안 revision이 변하면 현재 기사 예약 목록도 새로 읽는다. 실제 브라우저 생성/취소/새로고침·시각 증거와 전체/fresh 검사, 구현 DUAL은 별도 외부 영수증에 연결한다.

실제 뉴스 수집/AI 작성/시세/홈 순위/푸시/광고 요청은0이다. 전체 사이트106행/112URL 요구를 Telegram으로 축소하지 않았으며112 RIGHTS_HOLD·live7/8 CLOSED, 실수집8·AI9·푸시/광고11 후속 경계를 유지한다. 로컬 cron 실행은 hosted 24시간 운영 검증이 아니다.

자체 검토 보완(SQL49): 근거 hash의 timezone을 UTC로 고정하여 한국/미국 DB 세션 설정으로 달라지지 않게 했다. cron supervisor의 첫 실행이 없는 경우에도 예약/정정3분·TTL70분이 지나면 STALE로 표시하고, 실제 launcher가 꺼진 환경에서는 재개를 거부한다. 상태7종의 pure-clock 경계와 timezone2종·권한을 rollback 시험했다. 전역 launcher를 끄거나 재설정하지 않았으므로 off 상태의 실제 운영 중단 시험을 했다고 주장하지 않는다. 기존 세 job의 ID/명령/활성 상태는 SQL49 적용 전후 동일하다.

검사 성능: 새6E validator는 읽기 전용 Git cat-file batch로 같은 baseline blob을 한 번에 읽는다. Git의 object ID·길이·구분자를 검증한 바이트를 이전과 같은 해시/동등성 검사에 사용하며, 과거 checker 파일은 수정하지 않았다. 적용 SQL48의 원래 CRLF 바이트는 해당 세 migration의 좁은 .gitattributes 예외로 보존한다. 다른 Git 속성이나 frozen native 입력은 바꾸지 않았다.

구현 재검수 r1 보완(SQL50): S6EI-CODEX-01은 예약 공통 코어에서 실제 wall clock으로 근거 유효기간을 재검사하고, 다른 후보 실행 중 먼저 게시한 근거가 만료되는 경우에도 deferred constraint trigger가 commit 경계에서 전체 tick을 되돌리도록 했다. 과거 수동 wrapper와 SQL1~49의 바이트는 그대로 두었다. S6EI-CODEX-02·Claude S6EI-02는 알려진 P0001 업무 오류만 HELD로 분류하고 40P01·40001·XX000·알 수 없는 P0001은 재전파해 앞선 게시와 run 기록까지 rollback한다. 별도 rollback 회귀9개에 transaction-start/실제시각 만료, 후속 후보 지연 중 만료, 네 종류 치명 오류, 정상 업무 보류를 포함한다. commit guard 시험은 동일 트랜잭션의 SET CONSTRAINTS IMMEDIATE로 검증하며 실제 새 cron timeout 관측이라고 표현하지 않는다.

S6EI-CODEX-03은 job schedule·username·database·enabled/active까지 등록 일치를 확인하도록 보완했다. Claude S6EI-01은 실제 관리자 pause/resume API가 서버 세션의 사용자·세션 ID를 전용 service RPC에 전달하고 실제 관리자 감사 기록을 남기도록 수정했다. UI에는 원래부터 멈춤·재개 버튼이 있으며, 클라이언트가 actor를 지정하는 입력은 허용하지 않는다. 카탈로그 편집과 예약 head 잠금의 UI 경험을 추가로 측정하는 P3 권고는 후속으로 남는다. 적용 SQL50도 SHA 영수증으로 동결하며 후속 DB 수정은51+다. 현재 소스·시험·재검수 근거는 최신 외부 영수증으로 연결하며 위 최초 구현 시험 횟수는 r1 당시 기록이다.
