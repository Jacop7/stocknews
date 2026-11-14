# 4단계 로컬 DB·모의 worker

이번 자원은 주도주뉴스 전용 신규 local Supabase, 전용 network/volume, 별도 Docker worker 2개와 모의 효과 수신 서버다. 실제 기사·텔레그램·AI·시세·푸시·광고는 실행하지 않는다. preview/production 자원도 없다. 3단계 공급대기와 7/8 LIVE 차단을 유지한다.

제품 전용 Corepack 환경에서 Node 24.15.0으로 실행한다. `node scripts/setup-local.mjs preflight`와 `node scripts/setup-local.mjs network`는 프로젝트·config 지문·Docker engine·포트·새 network 소유권을 확인한다. `node scripts/start-local.mjs`는 **이전 DB 시작 이력이 없는 새 제품**에서만 1회 실행한다. 기존/불확실 START_INTENT를 자동 재실행하거나 같은 이름의 외부 자원을 채택하지 않는다. 초기 CLI에는 localhost 전용 임시 Docker transport를 제공해 container create 이전에 각 published HostIp를 127.0.0.1로 고정한다. Docker exec duplex도 로컬 engine에 전달하며 payload/키는 출력하지 않는다. 이는 Docker 권한을 축소하는 보안 샌드박스가 아니다.

이미 실행 중인 이번 스택에는 start를 다시 실행하지 않는다. `node scripts/initialize-local.mjs`는 새 network·실제 published binding·컨테이너 health·적용 migration digest와 제품 DB 응답을 검사한다. CLI local 기본 JWT/anon/service 값은 공개 개발용 상수일 수 있다. 운영 비밀로 취급하거나 인터넷에 노출하지 않는다. 별도 mock 인증키와 installation capability는 무작위 생성한다. 모든 실제 값은 ignore된 `.local-data/runtime`에만 보관하며 앱·브라우저·문서·로그·커밋에 전달하지 않는다.

`node scripts/migrate-local.mjs`는 이 제품의 검증된 local DB 지문에서만 새 migration을 적용한다. 기존 적용 파일의 바이트 변경을 거절하며 history 기록을 같은 트랜잭션으로 추가한다. reset/원격 push/다른 DB 연결을 하지 않는다. migration 1~4가 처음 적용된 후 ACK intent guard와 실제 lock-timeout 시험을 5~6으로 추가했다.

`node scripts/start-worker.mjs`는 같은 제품 label의 신규 이미지·network·모의 영수증 volume만 사용한다. 처음부터 존재하는 동명 자원은 채택하지 않는다. worker는 builtin Node만 사용하고 외부 효과 대상은 내부 mock으로 고정한다. DB service key는 서버 전용이며 강한 권한을 갖는다. RPC 범위가 service key 자체의 권한을 줄인다고 주장하지 않는다.

시험은 `corepack pnpm test:m0-contracts`, `corepack pnpm test:m0-runtime`, `corepack pnpm verify`다. runtime 시험은 새 로컬 지문을 먼저 확인하고 합성 fixture만 만든다. 큐 제어 시험 중 자기 worker 두 개만 잠시 pause하고 finally에서 재개한다. 강제 종료 시험은 효과 수락이 관측된 자기 consumer만 종료한 뒤 다시 시작한다. Cron fixture는 자기 run UUID 스케줄만 중지한다. 원문·설치 비밀은 결과에 기록하지 않는다.

공개 read는 RLS/security-invoker 목록과 서버 get_public_article/resolve_issue로 구분한다. private 표·본문 projection 직접 읽기·관리자 조회수는 익명 접근을 거절한다. installation은 서버 전용 capability로 소유권·회전·만료·폐기를 검증한다. 실제 앱 발급/저장/인터넷 rate limit과 관리자 UI 연결은 다음 단계다. 현재 server-only 시험 RPC를 운영에 그대로 노출하지 않는다.

P01은 동시 인수·멱등 키·lease/heartbeat·stale ACK·효과 불확실성·확인 보류·DLQ/이력 유지·강제 종료/모의 서버 재시작과 timeout 롤백을 실제 PostgreSQL/REST/Docker로 검사한다. P02a는 실제 pg_cron→queue→worker→별도 durable mock receipt→ACK다. P03a는 서버 노출·한국 주식 관점·일정 유무·공개 상태를 검사한다. P04a는 주입한 합성 calendar/clock으로 09:10·20:00·다음 한국장·주말/휴일·US DST/조기 종료·UNKNOWN을 검사하며 공식 캘린더 공급 검증과 다르다. 앱/어드민 표시 일치 P03b, 실제 공급 P04b는 이번 통과 대상이 아니다.

## 구현 검수 r1 보완

초기 기동의 임시 Docker transport에는256비트 난수 capability 경로를 붙여 다른 로컬 호출자·웹페이지의 무권한 engine 접근을 차단한다. 그 값은 child CLI 환경에만 전달하고 출력/검수 자료에 넣지 않는다. capability 없는 요청403, 실제 never-started Docker probe의 binding rewrite와 설치 CLI status의 capability 경유 성공을 검증했다. 전체 fresh bootstrap 미재실행 한계는 유지한다.

수정본 검수의 S4I-C04는 새 migration 9에서 보완했다. PostgreSQL의 내장 PUBLIC EXECUTE는 전역 기본 권한이므로 schema-local REVOKE만으로 회수되지 않는다. 실제 DDL 생성 역할 postgres의 전역 함수 기본 PUBLIC/anon/authenticated EXECUTE를 회수했다. 기존 auth/storage 함수 권한을 일괄 변경하지 않는다. 개별 REVOKE 없는 새 public 함수에 대해 anon·authenticated의 has_function_privilege=false와 실제 RPC 거절을 확인한다. service_role만 명시 GRANT한 뒤 해당 RPC가 존재하고 실행되는 것도 대조해 캐시 미등록을 권한 거절로 오인하지 않는다. 수정 전 기본 실행 허용은 ROLLBACK 조건에서 재현해 별도 보존했다.

마지막 공개 경계 감사에서 alias chain이16회를 넘으면 중간 Issue의 예전 본문을 반환할 수 있는 경우도 닫았다. 새 migration10은 아직 alias가 남으면 ALIAS_CHAIN_LIMIT로 차단한다. 실제 REST 시험은17 hop의 중간 공개 글·최종 HIDDEN 조합에서 본문을 제공하지 않고, 정확히16 hop에서는 최종 HIDDEN을 확인하며, cycle도 차단한다.

독립 Codex S4I-C01/C03과 Claude S4I-01을 새 migration 7에서 보완했다. 게시/공개 상태 CAS는 NULL 예상 revision도 거절하고, 불확실 효과 조정은 NULL outcome을 거절한다. 관심 섹터 검사는 명시적 테이블·unnest 별칭으로 활성·존재를 확인하며 중복·NULL UUID도 거절한다. 거절 시 기존 revision/outbox/설정/시도 이력이 유지되는 실제 REST 회귀를 추가했다. NULL 입력 전이를 함께 감사해 migration 8에서 fail의 불확실성 여부와 source 권한 version의 NULL도 거절한다. 적용된 migration 1~7을 수정하지 않았다.

Codex S4I-C02/Claude S4I-02는 확인 예약 시각·SKIP LOCKED·30초 확인 slot으로 보완했다. UNKNOWN은 보류를 유지하며 POST/새 키를 만들지 않고, 뒤의 수락된 영수증 작업은 별도로 확인·완료한다. 먼저 UNKNOWN인 A와 이후 응답 유실 B를 같은 실제 worker 실행에서 검증한다. Claude S4I-03에 따라 initialize/시험/worker 시작에서 기록된 자기 archive의 중지·restart=no·network를 확인하고, 잘못된 상태의 거절을 합성 unit으로 시험한다. 위험한 archive를 시험 삼아 기동하지 않는다.

S4I-04의 시간 변환 함수는 STABLE로 정정했다. 시험 RPC/합성 local seed의 비로컬 환경 분리는 **preview DB 최초 생성·적용 전 별도 migration/계약 검수의 필수 선행**으로 남긴다. service-only 로컬 시험 함수를 운영 앱 API로 재사용하지 않는다. 실제 클라우드 프로젝트와 키를 만들지 않았으므로 이 항목을 운영 완료로 세지 않는다.

## 최초 기동 실패와 복구 이력

CLI 3.1.0은 `[inbucket]`을 거절해 공식 v3 안내에 따라 `[local_smtp]`로 바꿨다. 첫 실제 기동에서는 Docker network 기본 HostIp 설정이 실제 published binding에 적용되지 않아 wildcard가 발견됐다. 제품 DB 지문/fixture 입력 전 새로 만든 이 제품 9개 컨테이너만 중지했다. 이 실패를 숨기지 않는다.

이번 스택은 published 서비스 4개만 동일한 신규 이미지·network·자기 volume으로 재생성했다. CLI가 writable layer에 넣은 자기 Kong TLS/config 파일도 tar archive UID를 보존해 이관했다. 기존 4개는 중지·restart=no archive로 남겼다. 이후 실제 published binding 모두 127.0.0.1과 정상 health를 확인하고 제품 DB 지문/시험 데이터를 넣었다. `bind-local-loopback.mjs`는 이 기록이 있는 초기 복구 전용이며 일반 재시작 명령이 아니다.

후속 첫 기동 코드는 생성 전 rewrite로 변경했다. 실제 Docker API에서 새 never-started probe의 HostConfig rewrite/제거, 설치된 CLI status의 proxy 경유를 검증했다. **이 변경 후 전체 fresh CLI bootstrap을 기존 정상 스택 위에 재실행하지는 않았다.** 독립 소스 checkout 검증과 새 DB를 다시 만드는 시험은 다른 증거이며 구분한다. 구현 DUAL 검수와 동일 바이트 커밋 이전에는 4단계 완료·5단계 게이트 통과를 주장하지 않는다.
