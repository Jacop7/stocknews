# CLOUD11A 관리자 개발 DB 연결 준비

상태는 **소스·격리 시험 준비, 실제 관리자 미연결**이다. 2026-11-16의 계획 r2 DUAL 뒤 전용 기능 브랜치에서 작성했다. 소비자 앱에는 회원가입·로그인이 없다. 기존 local runtime은 runtime-local.mjs에 Git99 원본 바이트 그대로 보존하고 runtime.mjs는 명시적 local/preview 선택만 한다. preview 실패를 local로 넘기지 않는다.

개발 관리자 후보 주소는 http://127.0.0.1:62333 이다. 실제 키·계정을 설정하거나 관리자 DB 연결을 시작하지 않았다. 빈 자격증명의 로그인 화면만 이 주소의 임시 프로덕션 빌드로 확인했고, 시험 프로세스를 종료한 뒤 해당 포트 연결이 닫힌 것도 확인했다. 예약·유지관리·설치정보·조회 통계·홈 순위·수집 상태는 preview에서 서버 및 UI 모두 비활성이다. 기사 화면에서 ReservationManager도 마운트하지 않는다. 기존 local 메뉴는 유지한다.

## 구현한 경계

- 고정 dev project/조직, preview/null/SYNTHETIC 신원. publishable apikey+검증된 사용자 JWT와 secret apikey 전용 세션 RPC3개를 분리했다. 허용 편집 RPC21개 외의 경로·legacy/다른 프로젝트·복사한 설정·fixture 기본 네트워크를 거부한다.
- 실제 private 경로는 .local-data/cloud-admin/activation-proof.json 및 admin-server.json뿐이다. import/build는 파일을 읽지 않는다. 설정 파일과 proof는 일반 파일·고정 경로·reparse 차단·크기·정확한 필드·결속 hash·24시간 이내 만료를 검사한다. 키값·키ID·접두사·길이·키에서 유도한 hash를 출력하거나 검수/백업에 넣지 않는다. proof 자체의 hash는 비밀키 hash가 아니다.
- capability는 별도 이름의 HttpOnly/SameSite=Strict 쿠키다. access/refresh token은 private.admin_sessions의 AES-GCM 암호문으로만 저장한다. JWT/8시간/활성화 만료 중 짧은 시각에 끝나며 자동 refresh하지 않는다. Auth getUser 확인 뒤 owner UUID·서버 app_metadata·JWT session/issuer/audience/expiry를 대조하고 DB membership·Auth/app session을 재검사한다. 로그아웃은 SQL capability 폐기가 먼저다.
- 정확한 Host를 GET/POST 모두 검사한다. 쓰기는 Origin·형식과 CSRF를 body 파싱 전에 검사한다(최초 로그인은 Origin과 요청률 검사). 로그인 요청률은 프로세스당 60초에5회이고 외부 IP 헤더를 신뢰하지 않는다. body는 스트림을 읽으며128KiB·3초로 제한하고 upstream은 응답256KiB·8초·redirect 금지다.
- 새 활성화 SQL은 자동 migration stream 밖에 둔다. 기존 cloud의 dev 초기화/catalog/publication guard를 보존하고, private.active_admin_user에 선택 사용자·활성 제어·제품 metadata·만료를 추가한다. 기존 public RPC24개의 정확한 EXECUTE만 연다. public 앱 읽기9개를 포함해 기존177 함수의 API 역할 권한을 전후 검사한다. 새 private 제어 표는 RLS·명시적 revoke이며 기본 비활성으로 만들고 같은 transaction 마지막에 활성화한다. 새 native 이력은20261116000107 한 행이다.
- renderer는 UUID·SHA·ISO 시각만 받아 순수하게 SQL을 만든다. 실제 SQL 전송 기능·키 조회 기능·Auth admin 변경 기능은 포함하지 않는다. SQL/source 임의 실행이나 credential 권위를 주는 CLI가 아니다. 실제 적용 전에는 최신 전체 schema/관계/sequence/함수/role/managed event trigger inventory와 Auth 설정을 다시 고정하고 실행기를 별도 검수해야 한다.

## 시험 범위와 한계

새 unit17개는 실제 key를 읽지 않는 import·fixture 설정·경로·proof·Auth/세션·RPC·CSRF·요청 상한을 확인한다. 기존25개 제품 검사 묶음은 유지하고 preview unit 묶음 하나를 더한다. 실제 SQL 검사는 별도 `corepack pnpm run test:preview-admin-db`이며 Docker가 필요한 런타임 검사다. CI의 기본 verify는 Docker·실제 DB·native 기기를 인증하지 않는다.

SQL 시험은 주도주뉴스 전용 UUID 컨테이너, 고정 공식 Supabase PostgreSQL 이미지, network=none·공개 포트0·read-only root·tmpfs만 사용한다. 기존 DB·volume·실제 Auth fixture·키를 읽거나 재사용하지 않는다. 임시 DB의50개 root schema 투영에서 pg_cron CREATE 한 문장만 명시적으로 제외한다. 원본 local migration은 바꾸지 않는다. Auth users/sessions와 control/history는 명시적인 fixture 표다. cloud archive에서 재현한177개 함수의 pg_get_functiondef SHA 전부를 역사적 H metadata와 맞춘 뒤에만 시험한다. SQL header 추출기는 일반 SQL parser가 아니며 실제 DB SHA 검증이 필수다.

26개 격리 검사에는 일반 사용자·metadata-only·다른 owner와 현재 owner의 역할/제품/membership/삭제/ban/Auth 만료/app 만료/비활성 제어가 각각 편집21개를 거부하는 시험이 있다. 섹터·묶음·기업·membership·키워드와 실제 합성 기사 생성·저장·미리보기·게시·동일 effect 재확인·숨김도 검사한다. catalog 변경은 소유 fixture transaction을 rollback하고 원본339기업과 catalog document가 유지되는지 확인한다. 컨테이너 정리는 ID·이름·소유 labels·network·mount를 대조한 자기 자원에만 수행한다.

이것은 hosted Auth, API gateway의 새 secret 역할 매핑, 실제 DDL event trigger, 실제 이메일 소유권·게시·DB 연결의 증명이 아니다. 원래 local DB의 cron 경로나 전체 local runtime 시험을 이 fixture 결과로 대체하지 않는다. H의 공개 미리보기62331/62332는 별도 동결 실행이며 이번 코드 변경으로 자동 교체하지 않는다. 새 supervisor/Job Object 및 실제 종료 관측은 C 실행기 검수에 남아 있다.

## C에서 고정할 실행 계약

아래는 후속 실행 준비 규약이며 **이번 소스 준비에서 원격 요청·권한·키 소비를 허용하지 않는다**. 실제 사용자 비밀번호 설정·새 구체적 결정·최신 전상태 및 실행기 구현DUAL 후에만 적용한다. 이전 공개조회8aad 결정은 재사용하지 않는다.

1. 선택된 이메일의 신규 dev 계정은 사용자가 공식 dev 대시보드에서 새 비밀번호와 auto confirm을 직접 처리한다. 가입 OFF/이메일 확인 ON을 그대로 둔다. 같은 이메일 계정이 이미 있으면 자동 승격하지 않는다. 비밀번호·OTP를 코드·명령행·로그·채팅으로 받지 않는다.
2. 키 취득 후보 예산은 Management GET api-keys?reveal=false 1회와 **선택된 기존 secret 하나**의 GET api-keys/{id}?reveal=true 1회다. metadata의 publishable 값과 선택된 secret 값만 프로세스 안에서 사용하고 나머지/legacy를 버린다. 타입별 후보가 없거나 복수·ID/template/형식 불일치이면 중지한다. 생성·회전·목록 전체 reveal·fallback은 금지다. 이 새 secret 조회의 구체적 권한은 C에서 받아야 한다. [목록](https://supabase.com/docs/reference/api/v1-get-project-api-keys) · [개별 키](https://supabase.com/docs/reference/api/v1-get-project-api-key).
3. Auth metadata 준비 계약은 고정 dev의 `GET /auth/v1/admin/users/{selectedOwnerUuid}` 1회 → `PUT` 같은 경로1회 → `GET` 같은 경로1회다. 사용자UUID·선택 이메일·확인 완료·삭제/ban 없음·기존 metadata를 내부 대조한 후, 기존 app_metadata를 유지하면서 app_role=admin/product_id=judoju-news 두 값만 합친다. user_metadata, password, email, Auth role, ban, MFA는 바꾸지 않는다. 전송 불확실이면 PUT을 다시 보내지 않는다. [공식 SDK 설명](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)과 [실제 PUT 경로 구현](https://github.com/supabase/supabase-js/blob/master/packages/core/auth-js/src/GoTrueAdminApi.ts)을 확인했다.
4. SQL은 고정된 template/렌더링 인수와 단일 effect UUID, 현재 전상태로 한 번만 적용한다. native8→9·제어 표1개·선택 membership·함수1개 정의·EXECUTE24 외 변경은 허용하지 않는다. 전체 사후 inventory는 자동 노출 ON 환경의 신규 객체와 managed helper를 포함해 검수한다. 첫 서버 RPC는 무작위 hash의 m1_read_admin_session 한 번(null 예상)으로 secret apikey 역할을 확인한다. 오류·불확실·예상 밖 결과면 세션 생성/편집을 시작하지 않는다.
5. actual 설정 writer는 C의 별도 구현 검수 대상이다. proof-first·exclusive·fsync·reparse 방지 및 부분 파일 HOLD, 설정·proof의 최대24시간 보존 사용 범위와 만료 후 소비 중지, 자기 프로세스만 정지하는 supervisor를 검증해야 한다. actual 파일은 아직 없다. 동일 권한의 악의적 로컬 writer를 막는 OS sandbox라고 주장하지 않는다.
6. 실패 시 새 관리자 프로세스 정지·선택 membership 비활성·해당 RPC revoke와 필요 시 app_role=reader로 우선 차단한다. 디스크 설정의 보존/삭제와 secret 노출 의심 시 사용자의 공식 대시보드 키 회전 절차는 새 결정에 명시한다. Data API 전체 OFF·다른 키/프로세스·prod 변경은 이 기본 차단에 포함하지 않는다. Auth HTTP와 SQL은 원자적 transaction이 아니며 완전 원복이라고 부르지 않는다.

## r2 보완

작성자 추가 점검 A11AI-01은 GitHub checkout의 실제 PR ref가 refs/remotes/pull/{n}/merge임을 확인했다. 새 guard는 원본 GITHUB_REF를 그대로 허용하는 대신 이미 시험된 allowedHostedPullRef helper로 정확한 HEAD와 ref를 결속한다.

A11AI-02는 취소 콜백이 영원히 완료되지 않는 유효한 mock stream에서 기존 body 처리가3초를 넘겨 대기하는 것을 재현했다(4.5초에도 pending). 취소는 한 번 시작하고 rejection을 관측하되 완료를 기다리지 않고 reader를 해제하도록 수정했다. 별도 회귀 시험이3초 REQUEST_TIMEOUT을 확인한다. 원본 r1 source와 두 READY 원문은 보존하며, 두 추가 수정은 같은 구현 case에서 재검수한다.

Claude CL11AI-01은 후속 C의 필수 확인으로 남긴다. password grant 이후 getUser/claims/session open/check 단계가 실패하면, 현재 구현은 capability를 브라우저에 전달하지 않지만 Auth session·refresh token과 열렸을 수 있는 암호문 행이 남을 수 있다. app capability 만료는8시간/JWT/activation 최솟값이고 Auth refresh 세션의 수명과 동일하지 않다. C에서는 이 실패 유형을 암호문·Auth 세션 보존 정책과 요청 예산에 포함하고, 동일 capability hash의 close 및 해당 Auth 세션만 종료하는 보상 처리의 구현·시험 또는 명확한 잔여 상태 처리 절차를 검수하기 전 실제 로그인 연결을 허용하지 않는다. 보상 처리는 원자적 원복이라고 부르지 않는다.

또한 전용 쿠키 이름은 충돌을 줄일 뿐 동일 호스트의 다른 포트와 쿠키를 격리하지 않는다. 현재127.0.0.1 주소는 자격증명 없는 B 시험용이다. 다른 제품과 인증정보가 섞이지 않도록 C에서는 관리자 전용 loopback 호스트(예:127.0.0.2)와 해당 origin/cookie/서버 바인딩을 함께 확정·구현·시험한 뒤 실제 계정을 연결해야 한다. 이 호스트 변경은 아직 B에 적용되지 않았으며, C의 별도 계획·구현 검수 전제다.

기존 H 수명 관리·AST 범위·자동 노출 및 CL11AP-01~03·CL11AI-01의 실제 운영 확인은 해당 소유 역할 판단 전까지 open이다. 통계·홈 순위 관리, source/worker, 실제 뉴스·AI·시세·push·광고, Android/iOS 기기·스토어 출시는 이 소스 준비의 완료 범위가 아니다.
