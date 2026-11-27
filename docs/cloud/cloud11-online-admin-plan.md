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
