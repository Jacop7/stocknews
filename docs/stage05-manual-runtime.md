# 5단계 local M1 — 관리자 수동 게시와 공개 조회

계획 DUAL READY: `0e69bef02ad49c63bc4ca4da1aabbb3975ebc32088ec1c0a0851892f21734794`.
4단계 선행 커밋 c844fe1의 M0 완료는 `docs/stages/stage-04-completion.json`에 보존한다.
현재 구현 검수와 실제 양쪽 native 대조는 완료 전이다. 이 문서는 운영 배포 성공 증거가 아니다.

신규 제품 local Supabase만 사용한다. 실제 뉴스·Telegram·검색·AI·시세·푸시·광고·원격 push는 실행하지 않는다.
3단계112 endpoint는 계속 RIGHTS_HOLD이며7/8 LIVE는 CLOSED다. 예약 게시 U05는6단계 대기다.

## 명시적 로컬 실행

기존 자기 소유 DB/worker가 확인된 상태에서 Node24.15.0으로 실행한다. 일반 `pnpm verify`는 Auth/DB/listener를 만들지 않는다.

1. `node scripts/migrate-local.mjs`: 소유권·loopback·기존 적용 hash를 확인하고 새 migration만 적용한다. 적용 파일을 수정하지 않는다.
2. `node scripts/m1-auth-fixtures.mjs`: 새 제품 합성 관리자/일반 Auth 사용자만 생성·확인한다. 실제 이메일/SMS는 발송하지 않는다.
3. `node scripts/setup-m1-admin.mjs`: 합성 관리자 membership과 비공개 암호화 키를 설정한다. 다른 계정의 권한을 올리지 않는다.
4. `node scripts/setup-m1-public.mjs`: anon key만 담은 별도 공개 읽기 설정을 생성한다. 관리자 키를 복사하지 않는다.
5. 관리자 Next:127.0.0.1:3100, `node scripts/public-read-gateway.mjs`:127.0.0.1:62330.
6. `node scripts/m1-outbox-dispatcher.mjs`: 수동 게시/숨김 outbox만 공통 모의 큐에 원자적으로 연결한다. `--once`는 한 배치 후 종료한다.

개발 Auth 자격 증명·서버 키·암호화 키·worker key는 `.local-data/runtime`의 ignore된 파일에만 있다. 출력·문서·Git·클라이언트 번들로 옮기지 않는다.
Auth/관리자 생성은 새로운 local 합성 fixture에 한정한다. preview/production의 fixture RPC 분리는 S4I-04의 별도 선행 게이트다.

## 권한과 데이터 계약

실제 Auth GET user·현재 관리자 app_metadata·활성 membership·auth.sessions의 user/session/유효 시간·발급 관리자 세션을 함께 검증한다.
cookie는 불투명 capability/HttpOnly/SameSite=Strict다. local HTTP의 Secure=false 예외는 HTTPS 운영으로 이관하지 않는다.
JWT/refresh는 AES-256-GCM 암호문으로 private DB에 두고 암호화 키는 새 로컬 서버에만 둔다. 로그아웃은 private 세션 폐기를 먼저 수행한다.
Auth 삭제와 세션 로그아웃은 CASCADE로 자기 private 기록을 제거할 수 있다. Auth schema의 기존 권한을 넓히지 않았다.
기존 M0 관리자 RPC도 공통 SQL 권한을 검사한다. 구형 m0_publish는 서비스의 명시적 M0 합성 시험용이며, authenticated 편집기는 M1 RPC를 사용해야 한다.

초안 revision과 공개 issue revision은 별도 CAS다. 동시 저장/게시의 lock 순서는 issue→draft로 통일한다.
본문은 검증된 구조화 근거 경로에서 profile·visible_sections·표시용 영향과 필터용 섹터 집합을 도출한다.
R07의 긍정 없는 연관/조건부 부정은 시나리오를 만들지 않는다. 같은 섹터·같은 경로 중복은 차단하고 서로 다른 경로는 보존한다.
R08은 EXACT/PERIOD와 취소/미검증/대체를 구분한다. 예정기간 경계를 실제 행사일로 출력하지 않고 시간대 없는 시각을 거절한다.
정책2가 M1 계약을 표시한다. 이전 M0 함수와 migration1~10 및 역사 검사는 보존한다.

게시와 숨김은 같은 트랜잭션의 outbox를 만든다. dispatcher는 SKIP LOCKED로 공통 큐의 같은 effect_key에 연결한다.
외부 효과는 기존 local Docker 모의 sink의 영수증/ACK다. 운영 검색·푸시가 아니다.
숨김/철회는 worker 완료를 기다리지 않는다. M1과 기존 공개 상세/목록 경로 모두 현재 상태와 근거를 확인하고 유효하지 않은 기존 본문을 차단한다.
공개 gateway는 관리자 credential 없이 고정 read RPC만 호출한다. Host/Origin/경로/매개변수/응답 크기/빈도/동시성 제한을 둔다.

## 앱과 실제 관측 경계

홈/이슈체크/섹터 목록·상세는 공개 DB DTO를 읽는다. 오류·빈 결과·숨김을 구분하고 실제 뉴스/가격의 대체 샘플을 제공하지 않는다.
focus/foreground·활성 화면10초 재검사에서 실패·숨김 시 본문을 제거한다. 정상 재검사 중에는 검증된 내용을 유지해 스크롤 축소를 막는다.
Android는 자기 전용 AVD judoju-news-api35, ADB5038/emulator5580에서 localhost62330/Metro8085 reverse를 사용한다.
iPhone의 localhost는 PC가 아니다. 동일 승인 Wi-Fi 주소192.168.200.132의 현재 인터페이스 확인 후 `--lan` 공개 합성 read만 최대2시간 열 수 있다.
Supabase·관리자는 계속 loopback이다. wildcard·방화벽 완화·TLS 검증 해제는 없다. native0004 HTTP 기능/실제 iPhone 새 흐름은 별도 관측이 필요하다.

기존 iPhone 홈 실행 확인은 새 게시 흐름의 P03b 증거가 아니다. 양쪽 실제 새 흐름의 필수 경우 대조가 없으면5단계 전체와 P03b는 PENDING이다.

## 검증 명령

`pnpm verify`는 portable source·기존 계약·gateway 경계·타입·Next build·Android/iOS JS/Hermes export다. native 실행 인증으로 세지 않는다.
`pnpm test:m0-runtime`은 기존 실제 DB/REST/Docker26개 시험군이다. 구형 게시 fixture는 local service로 실행하고, 실제 관리자 허용·철회는 M1 시험이 맡는다.
`pnpm test:m1-runtime`은 실제 Auth 세션, R07/R08 미리보기/게시/공개 일치, HTTP cookie/CSRF/Origin, 실제 outbox→worker 영수증을 검사한다.
HTTP 시험은 독립 loopback 임시 포트를 사용해 개발 listener를 중단하거나 임의 채택하지 않는다.

부족한 UI/native 관측, 실제 공급, S4I-04 비로컬 분리, final proxy의 전체 fresh bootstrap 미재실행은 별도로 남긴다.

## 구현 검수 보완 경계

게시가 기존 claim_type을 승격·완화하지 않는다. 미리보기·게시·공개 재조회는 같은 현재 근거 조건을 적용한다.
일정의 공식 원문 근거가 없어지거나 다른 이슈로 이동하면 그 일정만 제외한다. 본문 핵심 근거가 무효이면 본문 전체를 차단한다.
공식 날짜 범위(DATE_RANGE)에는 날짜 미정 문구를 붙이지 않고, 분기 등 기간만 알려진 경우에는 날짜 미정을 표시한다.
편집 중 영향 경로 변경은 더 이상 해당하지 않는 시나리오와 경로 참조를 제거하며 새 시나리오 문장을 생성하지 않는다.
게시/숨김의 알 수 없는 전송 결과는 식별자만 sessionStorage에 남겨 동일 키로 확인한다. 확정 SQL 거절과 최신 DB 확인이 함께 있을 때 잠금을 해제한다.
최신 초안을 자동으로 덮어쓰지 않으며 명시적인 불러오기 전에는 현재 입력을 보존한다. 세션 저장소에는 토큰·암호·기사 본문을 넣지 않는다.

S4I-04 비로컬 이전 차단 목록에는 m1_create_draft의 자동 verified 합성 claim, UI의 기본 합성 evidence_id, 합성 Auth 관리자, 합성 섹터 카탈로그를 포함한다.
이들은 실제 검증 또는 원문 확보가 아니다. 6~8단계의 실제 근거 발급 경로와 분리하고 preview/production fixture RPC 분리 검수 전에는 연결하지 않는다.
타임스탬프 단독 페이지 커서는 동일 first_published_at 경계 누락 가능성이 있어 6단계에서 (first_published_at,issue_id) 복합 커서와 경계 시험으로 교체한다.
현재 앱은 첫 페이지 최대50건만 사용하며 이후 페이지 완전성을 주장하지 않는다.

숨김 성공 뒤에도 현재 입력은 원래 draft_revision과 함께 보존한다. 다른 편집자가 저장해 revision이 달라졌다면 최신 issue 상태만 반영하고 저장을 잠근 뒤 명시적 최신 초안 불러오기를 요구한다. 최신 revision을 오래된 입력에 붙여 동시 편집 CAS를 우회하지 않는다.
