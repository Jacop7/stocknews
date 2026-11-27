# CLOUD11-online 어드민 온라인 연결 계획 (2026-11-27)

대상: Supabase 개발 프로젝트 `judoju-news-dev`(`nxfpfvsdwbziowkxsxnh`, preview). 운영 프로젝트는 범위 밖이다.

## 왜 재설계인가

- 기존 CLOUD11A/C2는 어드민을 사용자 PC(Windows)에서 실행하는 설계다.
  - DB 권한을 한 번 켤 때 최대 24시간짜리 창(`admin_preview_control`, host lease)으로 연다.
  - Windows 실행기·감시 장치를 쓴다.
  - 2026-11-20 검수에서 Codex CHANGES_REQUIRED로 멈췄다.
- 사용자 결정(2026-11-27): 모든 실행은 온라인에서만 한다. 그래서 C2의 PC 실행 장치와 24시간 창은 쓰지 않는다. C2의 DB 활성화 템플릿도 적용하지 않고, 기록으로만 보관한다.

## 설계

### 권한 모델 (기존 M1 그대로)

`private.m1_assert_editor` → `private.is_admin()`은 이미 클라우드에 있다(CLOUD05D 묶음). 편집 함수는 아래 세 가지를 모두 만족할 때만 통과한다.

1. 호출자가 `authenticated` JWT이고, `sub`·`session_id`가 유효하다.
2. `auth.users`에서 그 사용자가 삭제·차단되지 않았고 `raw_app_meta_data.app_role='admin'`이며, `private.admin_memberships`에서 활성이다(`active_admin_user`).
3. 서버가 연 `private.admin_sessions` 행이 같은 Auth 세션에 묶여 있고, 만료·철회되지 않았다.

세션 행은 서버만 연다. 세션 함수 3개(`m1_open/read/close_admin_session`)는 `service_role`만 실행할 수 있다. 사용자는 Auth 비밀번호 로그인 뒤 서버를 통해서만 편집 함수 21개를 부를 수 있다.

### 활성화 SQL (`supabase/cloud/admin-online-dev/activation.sql`, 1회)

사전 확인(하나라도 다르면 중단):
- 환경 식별자: dev / preview / SYNTHETIC
- 마이그레이션 8개, 21+3 함수의 정의 SHA가 CLOUD11A 기록과 같음
- 지금은 해당 역할의 EXECUTE가 없음
- 소유자 계정이 존재함(삭제·SSO 아님)

적용(한 트랜잭션):
1. 소유자 계정(`previewOwnerIdentity()`의 고정 ID) `raw_app_meta_data`에 `app_role=admin`, `product_id=judoju-news` 설정
2. `admin_memberships`에 소유자 1명만 활성으로 추가
3. 편집 함수 21개 EXECUTE를 `authenticated`에, 세션 함수 3개 EXECUTE를 `service_role`에 부여(목록 고정, 그 밖은 0)

사후 확인: 위 권한 외 API 역할 권한 변화 0, 공개 읽기 9개 불변.

### 어드민 실행 (AWS)

- 조회 서버와 같은 서버에서 도커로 실행한다. Next 어드민은 컨테이너 안 `127.0.0.1:62333`에만 바인딩한다.
- Caddy가 `https://admin.52-79-247-25.sslip.io`(무료 주소, 자동 인증서)로 받아 넘긴다. 같은 Caddy에 사이트 블록 하나를 추가한다.
- 설정 파일 `admin-online.json`(git 제외, 서버 private 디렉터리, 600). 소유자 ID·Supabase URL 외에 아래 값을 담는다.
  - publishable 키
  - **secret 키**: 세션 함수 3개 전용, 서버 메모리에서만 쓴다
  - 세션 암호화 키(새로 생성)
- Windows 전용 경계(`preview-file-boundary`)는 쓰지 않는다. Linux용 설정 로더가 경로·권한(600, 심볼릭 링크 거부)을 검사한다.
- 요청 제한: 로그인 분당 5회(기존). Caddy가 넘기는 `X-Forwarded-For`로 사용자별로 센다.
- 쿠키: `Secure; HttpOnly; SameSite=Strict`. 기존 쿠키 이름과 분리한다.

### 하지 않는 것

- 운영 프로젝트 접근
- 실데이터(REAL) 게시. 게시 검증의 SYNTHETIC 제한은 그대로다.
- 새 계정 생성·비밀번호 설정(사용자가 직접)
- 크론·알림
- 앱 사용자 로그인 추가

## 사용자 준비 / 결정

1. **어드민 계정**: CLOUD11A에서 고른 이메일 계정(고정 ID `e85049b7…`)을 그대로 쓴다. 비밀번호는 사용자가 Supabase에서 직접 정한다. 바꿀 경우 새 계정 ID를 알려준다.
2. **secret 키**: 대시보드 API Keys에서 secret 키(`sb_secret_…`)를 하나 만들어(이름 예: `judoju-admin-online`) 숨김 입력 스크립트로 저장한다. 채팅에 붙이지 않는다. AWS 서버 private 파일에 둔다. 회수가 필요하면 대시보드에서 그 키만 삭제한다.
3. **위험 수용**:
   - 어드민이 인터넷에 열린다. 비밀번호 로그인과 관리자 권한 3중 검사로 보호한다.
   - 무료 주소라 도메인 소유권이 없다.

## 검증

- 활성화 전후 ACL 인벤토리를 비교한다(CLOUD10B와 같은 조회).
- 실제 로그인 → 편집 목록 조회 → 합성 초안 저장·미리보기 → 로그아웃 순서로 확인한다.
- 다른 계정·로그아웃 후 접근·세션 만료 시 거부되는지 확인한다.
- Codex 검수: 계획, 구현, 실측 결과 각각.

## 사전 실측 (2026-11-27, 읽기 전용 조회)

- 소유자 계정 `e85049b7…`: 존재. 삭제 안 됨, SSO 아님, 이메일 확인됨, 비밀번호 있음, `app_role` 없음. Auth 사용자는 이 1명뿐이다.
- `admin_memberships` 0행, `admin_sessions` 0행.
- 편집 함수 21개(`editorFunctions`)와 세션 함수 3개: anon·authenticated·service_role 모두 EXECUTE 없음.
- `private.active_admin_user` 정의 SHA `86ee931a…`: CLOUD11A 기록과 같다. `private.is_admin` 정의 SHA `ec45d50f…`.

## Codex 1차 검수: HOLD (2026-11-27)

1. 설정 로더가 Windows 전용(30분 수명, launch/proof)이고, 쓰기 검사가 `127.0.0.2:62333` Origin으로 고정돼 있다. → Linux 로더, 공개 HTTPS Origin, 신뢰 프록시 헤더 검증과 그 시험이 필요하다.
2. `sb_secret`은 세션 함수 전용이 아니라 `service_role` 권한이다. 인터넷에 노출된 웹 컨테이너에 두면 안 된다. → 별도 비공개 broker, 최소 권한, 회전 절차가 필요하다.
3. `is_admin()`은 세션 행만 확인하고 capability를 편집 RPC에 결속하지 않는다. 탈취된 access token으로 21개 RPC를 직접 호출할 수 있다.
4. 비밀번호와 분당 5회 제한으로는 부족하다. → AAL2 MFA(런타임·DB), XFF 재생성, 지속 제한, 또는 접근 프록시가 필요하다.
5. 장애·철수 절차(일괄 철회·로그아웃·키 폐기·사후 ACL)가 없다.
6. 폐기된 C2 자료를 근거로 삼을 수 없다. → 현재 해시, 원자 적용, 실제 침해 시험이 필요하다.

사용자 결정 대기: 공개 인터넷 노출(전부 보강) / 비공개 사설망(Tailscale 등) 접근.

## 사용자 결정: 공개 인터넷 + 전부 보강 (2026-11-27)

Tailscale 안은 쓰지 않는다. 앞부분 "어드민 실행 (AWS)"에 적은 두 가지(웹 컨테이너에 secret 키 두기, 2중 검사만으로 공개하기)는 **폐기**하고 아래 설계로 바꾼다. 어드민 주소는 `https://admin.52-79-247-25.sslip.io`(공개, Caddy, 자동 인증서)다.

### H1. capability 결속 (Codex 3)

- 편집 RPC 21개는 HTTP 헤더 `x-judoju-capability`에 원본 capability를 함께 받아야 한다. 이 값은 로그인 때 서버가 만든 32바이트 난수다.
- 새 `private.is_admin()`(VOLATILE)은 PostgREST가 넘기는 `request.headers`에서 이 값을 읽어 SHA-256을 계산한다. 그 해시가 같은 `user_id`·`auth_session_id`로 열린 `admin_sessions` 행(미철회·미만료)과 일치해야 통과한다.
- 결과: JWT만 탈취해서는 직접 RPC를 부를 수 없다. capability는 브라우저의 HttpOnly 쿠키와 서버 메모리에만 있고, Supabase에는 해시만 저장된다.
- 함수 21개의 시그니처는 바꾸지 않는다. 판정은 `m1_assert_editor` → `is_admin` 한 곳에서 한다.

### H2. 2단계 인증 필수 (Codex 4)

- `is_admin()`은 JWT의 `aal='aal2'`를 요구한다. TOTP 인증을 마친 세션만 편집할 수 있다.
- 어드민 로그인 순서:
  1. 비밀번호 로그인(aal1)
  2. TOTP 코드 확인(`/auth/v1/factors/{id}/challenge`·`verify`) → aal2 토큰
  3. 세션 열기
- **첫 등록**: aal1 상태에서 TOTP 등록 화면(QR)만 쓸 수 있다. 등록 뒤에는 다시 로그인한다. aal1 토큰은 DB가 편집을 거부하므로 등록 화면에서는 편집할 수 없다.
- **중간 상태(2차 검수 3)**: 비밀번호 로그인 뒤 aal1 토큰은 서버 메모리에만 둔다.
  - 암호화된 **대기 레코드**로 두고, 5분 뒤 만료되며, 대기 쿠키(`__Host-`, HttpOnly)로 찾는다. 브라우저에는 토큰을 보내지 않는다.
  - 라우트 4개만 둔다: `mfa/factors`(목록), `mfa/enroll`(미등록일 때만), `mfa/challenge`, `mfa/verify`.
  - verify가 성공하면 aal2 토큰으로 교체하고 대기 레코드를 지운 뒤 broker로 세션을 연다.
  - 실패 5회, 만료, 서버 재시작이면 대기 레코드를 버리고 Auth 로그아웃한다.
- **갱신 없음**: 어드민은 refresh token을 쓰지 않는다. 세션은 access token 만료(최대 1시간)와 함께 끝나고, 다시 로그인(비밀번호+TOTP)해야 한다.
- **이전 세션 정리**: TOTP 확인 직후, 세션을 열기 전에 소유자의 다른 Auth 세션을 모두 끝낸다(`logout scope=others`). 확인되지 않으면 새 로그인도 끝내고 세션을 열지 않는다. 만료된 로그인 대기(aal1)는 1분 타이머로 로그아웃하며, 실패하면 지우지 않고 재시도한다. 재시작으로 사라진 대기는 aal1이라 편집 권한이 없고, 다음 로그인 때 함께 끝난다.

### H3. secret 키 분리 (Codex 2)

- secret 키는 **세션 broker** 컨테이너에만 둔다.
- broker는 공유 볼륨의 Unix 소켓 하나로만 요청을 받는다. 네트워크 포트는 없다.
- 요청마다 HMAC-SHA256 서명(어드민과 broker만 아는 32바이트 IPC 키, 타임스탬프 ±30초, nonce 재사용 거부)을 검증한다.
- 허용 작업은 세션 함수 3개뿐이다. 입력 형식을 고정하고, 세션 만료는 최대 8시간이다.
- **broker의 AAL2 결속(2차 검수 1)**: 세션 열기 요청에는 사용자의 access token이 함께 와야 한다. broker는 그 토큰으로 Supabase `/auth/v1/user`를 호출해 검증하고, 다음을 확인한 뒤 RPC 인자를 **토큰의 값으로만** 채운다.
  - JWT의 `aal='aal2'`, `sub`=소유자 ID, `session_id`
  - 어드민이 보낸 사용자·세션 값은 쓰지 않는다.
  - aal1 토큰이면 세션을 열지 않는다.
- 웹 어드민 컨테이너에는 secret 키가 없다. 어드민이 침해돼도 broker로 세션을 열려면 그 사용자의 유효한 aal2 Auth 세션이 필요하다(`m1_open_admin_session`이 `active_admin_user`를 검사).

### H4. 공개 HTTPS 경계 (Codex 1)

- 어드민은 `127.0.0.1:62333`에만 바인딩한다. Caddy만 접속한다.
- Host는 `admin.52-79-247-25.sslip.io` 고정, 쓰기 요청 Origin은 `https://admin.52-79-247-25.sslip.io` 고정이다.
- Caddy가 `X-Forwarded-For`를 클라이언트 주소로 덮어쓰고, 어드민은 loopback에서 온 요청의 그 값만 쓴다.
- 쿠키는 `Secure; HttpOnly; SameSite=Strict; __Host-` 접두사를 쓴다. CSP·`frame-ancestors 'none'`·HSTS를 붙인다.
- Linux 설정 로더: 파일 소유자·600, 심볼릭 링크·하드링크 거부, 고정 필드만 허용, 만료 없음. 키 회전은 파일을 교체하고 재시작한다.

### H5. 무차별 대입 방어 (Codex 4)

- 소유자 이메일 외 로그인은 Auth 요청 전에 거부한다.
- 클라이언트 IP당 분당 5회, 계정 전체 시간당 20회로 제한한다. 제한 상태는 볼륨 파일에 남아 재시작해도 유지된다.
- Supabase Auth의 **공개 가입 끔**(Auth 설정 변경, 사용자 승인). TOTP 필수라 비밀번호만으로는 편집할 수 없다.

### H6. 비상 철회 (Codex 5, 2·3차 검수 반영)

- **권한**: 활성화 SQL이 `public.admin_online_revoke()`를 함께 설치한다(security definer, 소유자 postgres, `service_role`만 실행).
  - 한 트랜잭션에서 21+3 EXECUTE 회수, membership 비활성, `admin_sessions` 전부 철회를 한다. 함수 소유자는 자기 함수의 EXECUTE를 회수할 수 있다.
  - DDL 권한이 없는 secret 키로도 이 함수만 부를 수 있다.
- **실행 순서**(`scripts/ops/admin-online.ps1 revoke`, 이 순서만 유효). 1·2·4번은 이 PC에 저장된 secret 키로 Supabase에 직접 요청하므로 서버·broker가 죽어 있어도 동작한다. 확인되지 않은 단계가 있으면 오류로 멈추고(exit 1) 할 일을 안내한다.
   1. **DB 차단**: `admin_online_revoke()`를 호출하고, DB가 돌려준 상태(`admin_online_status`: 편집 권한·세션 권한·활성 membership·열린 세션이 모두 0)로 차단을 확인한다. 확인되지 않으면 **멈추고** SQL Editor에서 `select public.admin_online_revoke();`를 실행하라고 안내한다.
   2. **Auth 전체 로그아웃**: `admin_online_signout()`으로 관리자들의 `auth.sessions`를 지운다(refresh token도 함께 삭제). 1번과 별도 단계이며, 확인되지 않으면 멈추고 SQL Editor 실행을 안내한다.
   3. **정리**: 어드민·broker 컨테이너 중지, 서버의 설정·IPC 키 파일과 Caddy 어드민 사이트 삭제, Caddy 재적용을 각각 서버에서 확인한다(어드민 주소가 더 이상 응답하지 않아야 함).
   4. **사후 확인**: `admin_online_status()`를 다시 불러 권한·세션·관리자 Auth 세션이 모두 0인지 본다. 단계별 영수증(`.local-data/admin-online/revoke-receipt-*.json`)을 남기고, 실패한 단계도 기록한다. 네 단계가 모두 확인된 뒤에만 secret 키 폐기를 안내한다.
- 이미 발급된 access JWT는 만료(최대 1시간)까지 남지만, 1번에서 membership·세션·EXECUTE가 없어지므로 편집은 즉시 막힌다.
- secret 키 폐기는 사용자가 대시보드에서 한다(안내 출력).

### H7. 활성화 근거와 원자 적용 (Codex 6)

- 활성화 SQL은 한 트랜잭션 안에서 다음을 다시 검사한 뒤 바꾼다. 하나라도 다르면 아무것도 바꾸지 않고 중단한다.
  - 현재 정의 해시: 21+3 함수와 `active_admin_user`·`is_admin`·`m1_assert_editor`·`assert_server`·`caller_role`
  - `admin_sessions`·`admin_memberships`의 제약·RLS·ACL
  - 환경 식별자, 마이그레이션 목록
- 바꾸는 것:
  - `is_admin` 교체(H1·H2)
  - 소유자 `app_role`
  - membership 1행
  - EXECUTE 부여(21개 → authenticated, 3개 → service_role)
- 적용 후 같은 트랜잭션 안에서 결과 ACL이 정확히 이 목록인지 확인한다.
- SQL Editor로 적용할 때는 줄바꿈이 LF여야 한다(CRLF로 붙으면 함수 정의 해시가 달라 `CLOUD11_POST_DEFINITION`으로 중단·롤백). 붙인 뒤 편집기 내용의 SHA-256을 로컬 파일과 대조한다.
- 2026-11-27 드라이런(ROLLBACK 버전, sha256 5be336a1…): 가드·코어·권한·사후 확인 모두 통과, 롤백 확인(`admin_online_status` 없음, PGRST202).

### H8. 시험

- **로컬 DB**: 새 `is_admin` 단위 시험. 아래 경우를 모두 확인한다.
  - capability 없음·틀림·다른 세션 → 거부
  - aal1 → 거부
  - 철회·만료 → 거부
  - 정상 → 통과
- **broker**: 서명 없음·시간 초과·nonce 재사용·허용 외 작업 거부.
- **실측(적용 후)**: 아래를 확인한다.
  - 로그인 → TOTP → 편집 목록 → 합성 초안 저장·미리보기 → 로그아웃
  - 같은 JWT로 Supabase에 직접 RPC 호출 → 42501
  - aal1 토큰 → 42501
  - 로그아웃 뒤 쿠키 재사용 → 거부
  - 재시작 뒤에도 로그인 제한 유지
- Codex 검수: 계획, 구현, 실측 결과 각각.

### 사용자 준비

1. **TOTP 앱**(Google Authenticator 등): 첫 로그인 때 QR을 등록한다.
2. **Supabase secret 키**(`sb_secret_…`, 이름 `judoju_admin_broker`): 발급해 숨김 입력 스크립트로 저장한다.
3. **어드민 계정 비밀번호** 확인. 잊었으면 Supabase에서 재설정한다.
4. **승인**: Supabase Auth 공개 가입 끄기, 어드민 주소 공개.
