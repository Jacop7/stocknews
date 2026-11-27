# 게시 경로 2단계 계획: 클라우드 미리보기 접수 (2026-11-28, 6차)

1A~1C(`docs/publish-stage1-plan.md`, `docs/publish-stage1b-plan.md`, `docs/publish-stage1c-plan.md`)는 모두 로컬이었다. AI 처리기(AWS)가 만든 초안을 사람이 PC에서 `scripts/ops/ai-drafts-pull.ps1`로 로컬 DB에 넣었다. 2단계는 **AI 처리기가 클라우드 미리보기 DB(Supabase dev 프로젝트)에 직접 넣고**, 편집자가 온라인 어드민(`admin.52-79-247-25.sslip.io`, 로그인·TOTP)에서 검토하는 단계다. 결정(DECISIONS 2026-11-27 게시 경로 (3)): AWS에서 접수 RPC로 푸시, 전용 DB 역할 생성은 사용자 승인. 1차 계획 검수(HOLD, 8건)는 [Q1]~[Q8], 2차(HOLD, 3건)는 [R1]~[R3], 3차(HOLD, 3건)는 [T1]~[T3], 4차(HOLD, 3건)는 [U1]~[U3], 5차(HOLD, 2건)는 [V1]~[V2]로 표시해 반영했다.

## 범위

- **2A(이 계획)**: 클라우드에 실데이터 **접수·편집자 검토·채택**까지. 클라우드 공개 읽기는 계속 합성만, 클라우드 실데이터 게시는 막힌 상태 유지. 실데이터는 로그인한 편집자만 본다.
- **2B(별도 계획·승인)**: 클라우드 검토용 공개 읽기(호스팅 조회 서버는 인증 없는 공개 주소라 접근 제한이 먼저 필요).

## 사용자 승인이 필요한 것

1. **클라우드 dev DB에 실데이터 초안 저장**: DART 공시 기반 사실 문장·짧은 인용·출처 링크와 AI 분석 초안, 30일 보관(원문 본문 없음). 공개 읽기에는 안 나오고 온라인 어드민에서만 보임.
2. **접수 전용 DB 역할 1개**: `judoju_ai_intake`(로그인 가능, 접수 함수 2개만 실행).
3. **Supabase Cron(pg_cron) 사용 켜기** [Q6]: 클라우드에 정기 작업이 없다(ACL 인벤토리 `cronPresent:false`). 30일 정리를 하루 한 번 돌리려면 확장이 필요하다. 대시보드에서 사용자가 켠다(무료 플랜 기능).
4. **온라인 어드민 편집 권한 1개 추가**: 채택 함수(`m1_adopt_ai_version`)를 로그인 편집자에게 연다(S7, 비상 회수 대상에 포함). [R3]
5. **비밀번호 설정은 사용자가**(S4).

## 2A 설계

### S1. 클라우드 번들 CLOUD13 (CLOUD12A 방식, 클라우드 전용 렌더링) [Q1, Q8]

- 로컬 56~62를 그대로 붙이지 않는다. 렌더러(`scripts/cloud13-render.mjs`)가 **클라우드 현재 정의**(CLOUD12A 적용 후, 함수별 SHA를 `supabase/cloud/real-intake-dev/prestate.json`에 고정)를 기준으로 만든다.
  - 정체 함수 `m1_public_identity`는 클라우드 정의(`preview/SYNTHETIC/M1`)를 **바꾸지 않는다**. 59의 로컬용 정체 교체는 클라우드 번들에서 뺀다.
  - 섹터 선택 함수 `catalog_sector_selectable`은 클라우드 현재 정의에 `PERMITTED_REAL` 분기(실데이터 모드가 켜졌을 때 참조 카탈로그만)를 더한다. 56의 로컬 전용 조건(`environment='local'`, bootstrap)은 가져오지 않는다.
  - 공개 읽기 함수는 59처럼 `public_read_kind()`로 바꾸되, 클라우드에서 `public_read_kind()`는 항상 `SYNTHETIC`이다(아래 스위치).
  - 나머지(실데이터 검증 사슬, AI 접수함, 게시 분기, 철회·만료, 채택)는 56~62 본문을 클라우드 대상 함수 SHA 확인과 함께 적용.
- 실데이터 모드 스위치 조건: `enabled`는 로컬 또는 **preview**에서 켤 수 있다(`REAL_MODE_LOCAL_OR_PREVIEW`). `public_read_enabled`는 **로컬만**(2B 전까지).
- 번들 순서: 사전 확인(CLOUD12A 마이그레이션 기록, 함수 SHA, ACL 인벤토리 해시) → 본문 → 새·바뀐 함수 ACL 명시(아래) → 마이그레이션 기록 → 사후 확인. 적용 후 함수 SHA를 `poststate.json`에 기록.

### S2. 실데이터 모드 켜기 (별도 트랜잭션, 승인 후) [Q2]

- `update private.real_mode set enabled=true, public_read_enabled=false, allowed_source_hosts=array['dart.fss.or.kr','kind.krx.co.kr'], official_source_hosts=…` — 같은 트랜잭션의 사후 확인:
  - `real_mode_on()=true`, `public_read_kind()='SYNTHETIC'`, 정체가 정확히 `preview/SYNTHETIC/M1`.
  - 실데이터 게시·예약이 거부됨(가짜 이슈로 되돌리는 블록 안에서 확인).
  - 익명 공개 읽기 10개가 합성만 돌려줌.

### S3. 접수 역할·함수 [Q3]

- 스키마 `ai_intake`(소유 postgres, usage는 `judoju_ai_intake`만). 함수 둘, **소유자 postgres, `SECURITY DEFINER SET search_path=''`**:
  - `ai_intake.submit(p_effect_key text, p_payload jsonb)` → `private.ai_ingest_draft`.
  - `ai_intake.withdraw(p_effect_key text, p_ai_issue text, p_version integer, p_reason text)` → 철회. 철회에도 효과 키·영수증을 둔다(`private.ai_withdraw_receipts`: 키, 요청 해시, 결과) [Q5].
  - 호출자 확인은 **`session_user='judoju_ai_intake'`**(정의자 함수 안의 `current_user`는 postgres라서). 요청 크기 256KB 제한.
  - 생성과 같은 트랜잭션에서 `PUBLIC`·`anon`·`authenticated`·`service_role` EXECUTE 회수, `judoju_ai_intake`에만 부여.
- 역할: `NOLOGIN`으로 생성(S4에서 LOGIN), `NOINHERIT`, 소속 역할 없음, `connection limit 2`, `statement_timeout 10s`, `idle_in_transaction_session_timeout 10s`.
- "함수 2개만"의 정확한 뜻: 제품 객체(`public`·`private`·`ai_intake`의 표·함수) 중 실행 가능한 것은 두 함수뿐. Supabase 기본 PUBLIC 함수(예: `rls_auto_enable`)는 데이터 접근이 없음을 인벤토리로 확인한다.
- 사후 확인: 함수 소유자·보안 속성·ACL, 역할 속성(로그인 상태, 연결 제한, 설정, 소속), 제품 표 접근 0.

### S4. 비밀번호·서버 비밀 [Q7]

- `scripts/ops/ai-intake-online.ps1 set-password`: SQL 안전 문자(영숫자) 40자 → `alter role judoju_ai_intake login password '…'`를 클립보드로 → 사용자가 SQL Editor에서 실행 → 엔터 → 서버 호스트 `/home/ubuntu/.local/share/judoju-ai/secrets/ai-intake-db.json`(처리기 기존 기준 경로 `$base` 아래, 디렉터리 700·파일 600, 소유자 ubuntu) [V2]으로 scp → 클립보드는 `finally`에서 비움. 비밀번호는 채팅·로그·인자·환경변수·Docker 메타데이터에 넣지 않는다.
- 접속 정보: 풀러 호스트·포트는 Supabase Connect 화면 값을 사용자에게 확인받아 설정 파일에 넣는다(비밀 아님). 사용자명 `judoju_ai_intake.<project-ref>`.
- TLS: `sslmode=verify-full`, Supabase 루트 CA 파일 고정. 프로젝트의 SSL 강제 설정을 확인(필요하면 사용자에게 켜기 요청).
- 처리기 컨테이너는 비밀 파일을 읽기 전용 `/run/secrets/ai-intake-db.json`으로 마운트하고, 파일 형식·권한을 검사하는 로더만 읽는다.
- `status`: 서버에서 역할로 실제 풀러 접속 → `session_user` 확인, 두 함수만 실행 가능, `private`·`public` 표 조회 거부.
- `revoke`(비상): SQL(함수 EXECUTE 회수, `NOLOGIN`, `PASSWORD NULL`, 역할 세션 강제 종료 `pg_terminate_backend`)을 클립보드로(사용자 실행) → 서버 비밀 파일 삭제·푸시 끔 → 이후 접속 실패 확인.

### S5. AI 처리기 푸시 [Q5]

- 처리기 DB에 **배달 표** `deliveries(target, operation SUBMIT|WITHDRAW, ai_issue_id, ai_version, effect_key, request TEXT NULL, request_sha256, state PENDING|DONE|FAILED|SUPERSEDED, result, attempts, next_attempt_at, expires_at, updated_at)` — 기존 저장소처럼 SQLite `STRICT` 표, 요청은 정규화한 JSON 문자열(`TEXT`, 지우면 `NULL`). [R1, U1]
  - **보낼 요청을 만들 때 그대로 저장**한다(변환 결과와 해시). 재전송은 항상 저장된 요청을 같은 키로 보낸다. 이후 스냅샷 철회·만료·변환 코드 변경과 무관하다.
  - 유일성: `(target, effect_key)`. SUBMIT 키 `ai:<id>:<ver>`, WITHDRAW 키 `ai-withdraw:<id>:<ver>`.
  - 대체: 같은 AI 이슈의 더 새 버전 SUBMIT이 생기면, 아직 보내지 않은(시도 0회) 옛 SUBMIT은 SUPERSEDED. 한 번이라도 보낸 것은 결과가 확정될 때까지 재전송(서버가 오래된 버전은 STALE로 답함).
  - 재시도 [U2]: 미확정(네트워크·시간 초과·서버 일시 오류)은 `next_attempt_at`으로 지수 백오프(1분, 2분, 4분 … 최대 6시간). SUBMIT은 시도 10회 넘으면 FAILED(운영 점검). **WITHDRAW는 횟수로 포기하지 않는다**: 서버가 철회 결과(묘비 포함)를 확정해 줄 때까지 백오프로 계속 보내고, 6시간 이상 미확정이면 `status`가 경고를 낸다.
  - 종료: 서버의 확정 거부(형식·검증 오류, 충돌)는 FAILED로 끝내고 재시도하지 않는다.
  - 철회 [T1]: 처리기에서 스냅샷이 철회되면 같은 트랜잭션에서 그 AI 이슈의 끝나지 않은 SUBMIT(한 번 보낸 것 포함)을 모두 SUPERSEDED로 바꾸고 저장된 요청 내용을 지운다(해시·키만 남김). 대신 WITHDRAW를 만들고 다음 배달에서 가장 먼저 보낸다. 앞서 보낸 SUBMIT이 서버에서 커밋됐는지 불확실해도, 서버의 철회 처리(묘비 포함)가 그 버전과 이전 버전을 막는다.
  - 보관 [T2]: SUBMIT 행에 `expires_at`(요청을 만든 시각 + 30일, 원래 스냅샷 기한을 넘지 않음)을 둔다. DONE·FAILED·SUPERSEDED가 되면 바로 요청 내용을 지우고 키·해시·결과 요약만 남긴다. 기한이 지난 SUBMIT PENDING은 내용을 지우고 FAILED(EXPIRED). **WITHDRAW 요청은 내용이 식별자뿐(AI 이슈 ID·버전·이유)이라 기한으로 지우지 않고**, 서버 확정 전까지 남긴다. [U2] 내용 없는 행은 90일 뒤 삭제. 정리는 배달 실행마다 한다.
  - 업그레이드: 기존 서버 DB의 READY 스냅샷은 한 트랜잭션에서 SUBMIT PENDING으로, REVOKED는 WITHDRAW PENDING으로 채운다(스냅샷이 남아 있는 것만, 이미 삭제된 것은 대상 아님).
  - 내보내기 스냅샷이 생기면 SUBMIT, 철회되면 WITHDRAW 행을 만든다(같은 버전에 둘 다 있을 수 있음).
  - 응답이 확정(커밋된 결과)일 때만 DONE. 네트워크 오류·시간 초과는 PENDING으로 두고 다음 주기에 같은 키로 재전송(영수증으로 멱등).
- 명령 `push-drafts --db … --target cloud`(수동 실행·점검용). 켜짐 여부는 아래 설정 파일 **하나만** 기준이다(환경변수 스위치는 두지 않는다). [V1]
- 실행 주체 [T3]: 처리기 서비스 루프(`service.mjs`)가 매 주기 끝에 배달 단계를 부른다(스위치가 켜졌을 때만). SUBMIT은 하루 한 번(마지막 성공 시각 기준), WITHDRAW는 매 주기(즉시성). 한 주기 최대 20건, 주기 시간 제한 안에서. 재시작 후에는 DB의 PENDING을 그대로 이어서 보낸다(상태는 DB에만 있음). 시험: 루프 한 주기에 배달 호출, 철회 즉시 처리, 재시작 후 재개, 백오프.
- 켜고 끄기 [U3]: `scripts/ops/ai-processor.ps1`에 `push-on`·`push-off`를 추가한다. 서버의 처리기 설정 파일(호스트 `$base/push.json`, `{enabled, target}`, 600)을 바꾼다. 컨테이너에는 `$base/push.json` → `/run/config/push.json`, `$base/secrets/ai-intake-db.json` → `/run/secrets/ai-intake-db.json`을 읽기 전용으로 마운트한다(compose 생성기에 추가, `deploy`가 디렉터리·권한을 만든다). 서비스 루프는 매 주기 설정 파일을 다시 읽으므로 끄기는 다음 주기에 바로 적용되고, `push-off`는 확실히 하려고 컨테이너도 다시 띄운 뒤 `status`로 꺼짐을 확인한다. 설정 파일이 없거나 읽을 수 없으면 꺼짐으로 본다. [V1, V2] `push-on`은 비밀 파일과 접속 점검(`push-drafts --check`)이 통과해야 켠다. `status`는 배달 표의 상태별 개수, 가장 오래된 미확정 WITHDRAW 나이, 마지막 성공 시각을 보여준다. 비상 `revoke`(S4)는 `push-off`를 포함한다.
- `pg` 포함 [R2]: 지금 배포는 실행 중인 수집기 이미지를 바탕으로 런타임 소스만 넣는다. 그래서 `pg`(고정 버전)를 PC에서 설치한 `node_modules`째 런타임 묶음에 포함하거나(순수 JS라 빌드 불필요), 이미지 빌드 단계에 설치 단계를 추가한다. 배포 후 컨테이너 안에서 `pg`를 불러와 풀러에 `select 1` 없이 연결 설정만 검사하는 점검(`push-drafts --check`)과, 비밀 설정 후 실제 접속 점검을 둔다.

### S6. 클라우드 정리 작업 [Q6]

- 사용자가 Cron을 켠 뒤, 번들이 하루 한 번 작업 하나를 등록: 이름 `judoju-ai-inbox-cleanup`, 매일 04:00 KST, 실행 `select private.ai_inbox_cleanup()`(postgres). 작업 이름·명령을 사후 확인에서 고정하고, `cron.job_run_details`로 성공을 확인하는 `status` 점검을 둔다.
- 이 작업은 접수 역할의 권한과 무관하다(두 함수 원칙 유지).

### S7. 온라인 어드민 [Q4]

- 온라인 편집 계약을 22개 함수로 늘린다(`m1_adopt_ai_version` 추가): 런타임 허용 목록(`preview-admin-config.mjs`), `admin_online_status`·`admin_online_revoke`, ACL 해시·시험 갱신 후 어드민 재배포.
- 순서 [R3]: CLOUD13은 채택 함수를 **아무 역할에도 열지 않은 채** 만든다(62의 `authenticated` 부여를 클라우드 번들에서 빼고 회수 확인). 그다음 승인된 별도 트랜잭션 하나가 갱신된 `admin_online_status`·`admin_online_revoke`를 설치하고, 22개 함수 권한을 부여하고, 정확한 ACL을 확인한다. 그 뒤 어드민을 재배포한다. 그래서 비상 회수가 채택 권한을 놓치는 구간이 없다.
- 채택은 기존 AAL2 세션·capability를 그대로 요구하고, 비상 회수가 채택 권한도 회수함을 확인.

### S8. 인벤토리·증명·재시작 [Q8]

- `docs/cloud/cloud10b-acl-inventory.json`을 CLOUD13 후 상태로 갱신(역할, 스키마, 함수, 기본 권한, Cron 작업).
- 호스팅 조회 서버의 활성화 증명을 다시 발급하고 재배포(인벤토리 해시에 묶여 있음).
- 사후 상태 고정: 익명 공개 읽기 10개, 인증 편집자 RPC 22개, 서비스 역할 RPC(기존 목록), 접수 RPC 2개, API·접수 역할의 제품 표 접근 0.
- 처리기·어드민·조회 서버 재시작 후 정상 동작 확인.

### S9. 시험

- 로컬: CLOUD13 렌더러 출력에 대한 단위 시험(정체 불변, 선택 함수 분기, ACL 문장), 로컬 DB 복제 시나리오에서 접수 함수의 `session_user` 검사(로컬에 시험 역할을 만들어 실제 로그인으로 확인 후 되돌림).
- 처리기: 배달 표 단위 시험(SUBMIT·WITHDRAW 분리, 재시도, 업그레이드), 가짜 DB 클라이언트.
- 클라우드 실측(승인 후): 사전 확인 → 적용 → 사후 확인 → 실데이터 모드 켜기 → 비밀번호 설정 → 서버에서 풀러 실제 로그인·권한 점검 → 준비 초안 1~2건 푸시 → 온라인 어드민에서 검토·채택 화면 확인 → 호스팅 조회 서버에 실데이터가 안 보임 확인 → Cron 1회 실행 결과 확인.

## 하지 않는 것

클라우드 실데이터 공개 읽기·게시(2B 이후), 운영 DB, 자동 게시, 새 출처 허용, 모델·비용 변경(하루 호출 한도 150 유지).
