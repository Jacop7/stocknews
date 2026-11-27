# CLOUD10B 공개 읽기 활성화 계획 (2026-11-27)

대상: Supabase 개발 프로젝트 `judoju-news-dev`(`nxfpfvsdwbziowkxsxnh`, 논리 환경 preview). 운영 프로젝트는 건드리지 않는다.

## 실측 결과 (읽기 전용 조회, `cloud10b-acl-inventory.json`)

- 적용된 마이그레이션 8개(CLOUD02~CLOUD10C). DB 쓰기·권한 부여·키 읽기 없음.
- 공개 키(anon)로 실행 가능한 함수는 읽기 함수 9개뿐(모두 security definer). `authenticated`는 9개 중 어느 것도 실행할 수 없다.
- 예외 1개: `public.rls_auto_enable`(Supabase 기본 설치, `event_trigger` 반환). Data API로 호출할 수 없는 이벤트 트리거 함수라 노출 위험이 없다.
- `private`·`judoju_control` 스키마는 anon·authenticated 모두 접근 불가. 테이블·뷰·시퀀스 직접 권한은 0개.
- anon 쿼리 제한 시간 3초, authenticated 8초.
- **Data API는 이미 켜져 있다.** 공개 키를 가진 누구나 읽기 함수 9개를 게이트웨이 없이 직접 호출할 수 있다.

## 직접 호출(게이트웨이 우회) 평가

- 범위: 9개 함수 모두 읽기 전용이다. 입력 범위를 함수 안에서 검사한다(목록 최대 50, 검색어 80자·6단어, 커서 검증, 카탈로그 버전 확인). 쓰기 경로는 없다.
- 노출 데이터: 공개용 카탈로그(섹터·기업 이름·설명)와 게시된 기사뿐. 지금은 합성 기사만 있다.
- 비용·남용: anon은 3초 제한이 있다. 게이트웨이의 요청 수 제한은 직접 호출에는 적용되지 않는다. Free 플랜이라 과금 폭증은 없고, 최악은 DB 부하다.
- 판단: 개발 미리보기 단계에서는 허용한다. 운영 전환 전에 공개 키 회전, Data API 노출 스키마 최소화, 또는 게이트웨이 전용 경로를 다시 정한다.

## 활성화 단계

1. **공개 설정 파일**: 사용자가 대시보드에서 publishable 키를 확인해 로컬 입력 창(Read-Host)에 붙여 넣는다. `.local-data/cloud-preview/public-config.json`(git 제외)에 저장하고, 키는 채팅·로그에 출력하지 않는다.
2. **실측 확인**: 게이트웨이(`scripts/cloud-preview-public-read.mjs`)로 9개 함수를 각각 한 번씩 호출한다. 다음을 확인한다.
   - 식별자: preview, SYNTHETIC
   - 카탈로그 트리가 응답하는지
   - 허용 목록 밖 함수 등 거부 대상 6개가 401/403/404와 거부 코드(42501·PGRST202·PGRST205)로 막히는지
   - 쓰기 함수가 거부되는지
3. **접근 증명**: 통과하면 `.local-data/cloud-preview/access-proof.json`에 `CLOUD10B_PUBLIC_READ_VERIFIED`를 기록한다. 실측 결과 해시와 사용자 승인 해시를 함께 남긴다.
4. **온라인 게이트웨이**(다음 단계): AWS 서버에 게이트웨이를 도커로 올린다. 앱용 HTTPS 주소(도메인·인증서)가 필요해서 별도로 정한다.

## 하지 않는 것

권한 부여·DB 쓰기·운영 프로젝트 접근·크론 생성·서비스 키 사용.

## 이중 검수 반영 (Codex 1차 HOLD, 2026-11-27)

1. **증명 파일 위조 가능** → 로더(`loadApprovedPreviewConfig`)가 세 파일의 해시를 직접 다시 계산해 증명과 대조한다: 사용자 승인 원문(`user-authorization.txt`), 실측 결과(`live-result.json`), 추적되는 ACL 인벤토리. 실측 결과가 PASS이고, 9개 함수가 모두 200, 정해진 거부 대상 6개가 모두 401/403/404 + 42501·PGRST202·PGRST205여야 통과한다(400·429·5xx는 거부 증명으로 보지 않음). 테스트 `tests/cloud-preview-read.test.mjs`.
2. **실측 스크립트 없음** → `scripts/cloud10b-verify-live.mjs`. 게이트웨이를 거치지 않고 Supabase에 직접 호출한다.
   - 확인: 9개 함수 각 1회 성공, 식별자 preview/SYNTHETIC
   - 거부되어야 하는 것: `rls_auto_enable`, `private.m1_prepare`, `catalog_editor_tree`, `m1_save_draft`(쓰기), 허용 목록 밖 `catalog_public_company`, `news_public` 테이블 직접 읽기
   - 키는 `scripts/ops/cloud10b-store-key.ps1`(숨김 입력)로 저장하고 출력하지 않는다.
3. **인벤토리 부족** → v2로 보강했다.
   - 함수별 소유자·search_path·변동성·오버로드 수·정의 SHA-256
   - 시퀀스·테이블 API 권한 0개, 기본 권한(default ACL), 스키마 CREATE 권한 없음, 크론 없음
   - authenticated 거부는 권한 조회로 증명한다. 로그인 세션이 없어 실제 호출 증명은 하지 않는다.
4. **직접 RPC 우회(가용성)** → 사용자의 명시적 위험 수용이 필요하다. 개발 프로젝트·합성 데이터·Free 플랜 범위에서 수용하고, 운영 전환 전에 원격 측 제한을 다시 정한다.

## 검수 결과

- Codex 1차 HOLD(4건) → 2차 HOLD(거부 판정 느슨) → 3차 **APPROVE**(조건: 사용자의 직접 RPC 가용성 위험 수용).

## 실측 후 예외 1건: `rls_auto_enable` (2026-11-27)

- 실측: 공개 키로 `rpc/rls_auto_enable` 호출 → HTTP 400, `0A000`("cannot display a value of type event_trigger"). 나머지 거부 대상 5개는 401/404와 42501·PGRST202로 막혔다.
- 함수 본문(읽기 전용 조회, Supabase 관리 함수, plpgsql, 정의 SHA-256 `b21d8881…`): `pg_event_trigger_ddl_commands()`의 결과를 돌며, 방금 만들어진 `public` 테이블에 RLS를 켜는 일만 한다.
  - `pg_event_trigger_ddl_commands()`는 이벤트 트리거 밖에서 부르면 오류를 낸다. 그래서 직접 호출은 어떤 테이블도 바꿀 수 없다.
  - 설령 실행되더라도 하는 일은 새 테이블에 RLS를 켜는 것(보호 강화)뿐이다.
  - 쓰기·외부 호출·시퀀스 사용이 없다.
- 결정: 이 한 probe에 한해 `400 + 0A000`을 거부로 인정한다(`deniedResponse`의 이름별 예외, 테스트 포함). 공개 실행 권한을 회수하는 것은 Supabase 관리 객체 변경이므로 하지 않는다.
