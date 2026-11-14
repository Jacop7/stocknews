# 3단계 — 공급 등록·권한·시세·캘린더 계약

구현 기준: Claude Opus5.5/medium + 독립 Codex gpt-6-astra/ultra 계획 검수 READY, manifest `e011d8e20ed6c3ff834adc47ddccf54bda409a34b6180b24df3794c496d4dfe7`. 새 브랜치 `spike/03-data-providers`, 기준 커밋 `0c81416de798a4923ebdcf4dee2ead0f1955f416`.

## 구현한 범위

- 원본 106행·112URL 전체를 제품 registry로 보존했다. Git 밖 원본 전체 SHA/bytes와 제품 행 canonical SHA를 분리했다. 제품 registry는 원본 Google Sheets locator를 논리 ID로 대체하며 원본과 바이트가 같다고 주장하지 않는다. 기존 승인 기획 사본11개는 그대로 두고 승인 계획을12번째로 추가했다.
- source/endpoint 관계, 원본 type/market, 리포트 봇·통합 목록·다올 기업 전용, schedule_class·origin_resolution_rule을 등록했다. publisher/owner/origin·탭 경로·adapter·실예산 미확정은 null/미확인이다. 목록 주소가 있다는 이유로 원출처 독립성을 만들지 않았다.
- 모든112 endpoint는 RIGHTS_HOLD와 목적별 UNKNOWN이다. 허용된 시험을 위한 주입 가능한 일회 probe는 기본 dry-run이며, 제품 CLI는 dry-run만 제공한다. 실제 요청은 이번에0건이다. HTTPS·목적/버전/기한·허용 host·공유 요청/동시성 예산·고정 DNS·사설/특수 IP·리디렉션·응답 크기·시간 상한을 검사한다. HTTP200도 HTTP_OK_UNPARSED이며 parser/공급 승인으로 처리하지 않는다. 일반 worker/수집기·브라우저 adapter는 아직 없다.
- 텔레그램은 별도 허용된 connector가 제공한 링크 entities를 먼저 원문 후보로 처리한다. 링크 없음/원문 확인 실패 시 최대4개 짧은 카탈로그 검색어로 검색 후보를 만든다. 메시지 전체를 받거나 LLM에 전달하지 않는다. 검색·원문 경로도 별도 권한이 필요하며 자동 게시 상태를 반환하지 않는다. 원문 검색 실제 공급자는 아직 비활성이다.
- 신규·품질 강등 SHADOW 승격과 일시 장애의 기존 ACTIVE 복귀, 주기 경계·재시도·14일 상한, 탭 실패/PARTIAL·체크포인트 보존을 순수 정책과 합성 시험으로 구분했다. 실제 상태 저장·scheduler·원자 잠금은4/8단계, 어드민 설정은5단계, AI 이슈 비교/게시 정책 실행은6/8단계다.
- quote/session/currency/adjustment/시간·coverage 계약과 calendar coverage/만료/휴장/조기 종료·시간대 검사를 제공한다. 실제 가격 공급이나 공식 거래일 파일을 확보한 결과는 없다. 실제 자료가 없으면 UNKNOWN/UNAVAILABLE이며 합성 자료가 실제 공급을 통과하지 않는다.
- Naver/Brave 발견 전용 PLATFORM_RESOLVE·쿼리 큐 등록, 시세/캘린더/공식 자료 후보를 별도 보류 목록으로 뒀다. URL은 문서 locator이며 실행 endpoint/권한 근거가 아니다. 공급 계약·자격증명·단가·유료 한도는 미확정, 자동 구매/약관 동의는 하지 않았다.

## 측정·검사·대기

`tests/providers.test.mjs`는 A34~38/A43/A48/A52~54/U06 및 링크/SSRF/예산/미측정 구분 회귀를 실행한다. 모든 실경로 상태는 EXTERNAL_PENDING이고 합성 PASS를 실공급 성공으로 바꾸지 않는다. `baseline.json`은 NOT_MEASURED, 실요청0·성공률/지연/비용 null이다. 목록 HTTP만 확인한 결과를 본문 확보 성공률로 세지 않는다. 초기 라벨8개는 SYNTHETIC/게시불가이며 최근100기사 평가·고정 출시 평가세트가 아니다.

`pnpm verify`는 기존0~2단계 역사·11사본 보존·native digest/runtime 검사, 추가 registry/권한 경계와 provider 테스트, 기존 도메인 시험·타입 검사·admin production 빌드·Android/iOS Hermes export를 함께 실행한다. 실행 증거와 검수 원문·커밋 기록은 제품 Git 밖 단계별 reviews 폴더에 둔다. 단위 시험은 실제 제공자 성능 검증을 대신하지 않는다.

상태는 IMPLEMENTED_SUPPLY_PENDING이며 구현 검수는 별도 기록을 따른다. 4~6단계의 M1 수동/명시적 fixture 작업만 독립 진행 가능하고,3의 실공급 완료·7/8의 실데이터 공급 통과·12단계 LIVE 운영을 주장하지 않는다. Supabase DB·worker·cloud는 아직 생성하지 않았다.

2단계의 오래된 ‘native 미확인’ 서술만 최신 실제 증거로 갱신했다. Android는 전용 에뮬레이터 직접 관측, iOS는 사용자의 설치 앱 실행 확인과 작성자의 iOS 번들 로딩 관측이다. 새 native build/runtime 또는 OTA 검증을 수행한 변경은 아니다.

운영 예산 초기안은 기본 탐색40%·상승/급변25%·HOLD/정정20%·늦은 기사15%, 합계100%다. 실제 계약/시간당 한도가 없는 경로는 실행하지 않는다. 현재 공유 예산은 일회 probe 호출군의 메모리 객체다. 운영 DB/다중 worker에 대한 분산 예산·최소 큐 처리량·일별 비용 상한은4/8단계에서 구현하고 시험해야 한다.

최초 push 전 실제 저장소 공개 범위·전 Git 이력·기존 승인 문서의 시트 링크·개인 경로·비밀을 확인한다. 이번 제품 registry에서 locator를 제거한 것만으로 과거 기획 사본/이력이 공개 안전하다고 선언하지 않는다.

## 구현 교차검수 r1 반영

독립 Codex의 S3I-C01~04에 따라 실제 HTTP에는 MACHINE_ACCESS와 작업 용도를 항상 함께 검사한다. purposes 인수로 기계 접근 검사를 생략할 수 없고 DISCOVERY/ORIGINAL_ACCESS 없는 호출도 차단한다. 매크로 독립3은 원출처·편집국·소유 그룹 ID와 각 검증값이 모두 있는 서로 독립인 세 근거가 필요하다. 같은 원문·편집국·소유 그룹 중 어느 하나라도 겹치는 세 건이나 그룹 미확정은 세 근거가 아니다. 발표기관 ID가 없어도 이 조건과 한국 전달 경로를 통과하면 기존 이슈 비교 대상이다.

DISABLED는 복구 함수에서 항상 STOP이다. 허용된 새 구성은 별도 등록/권한 확인과 TECH_TEST를 통해야 하며 남아 있는 과거 건강검사로 켜지지 않는다. 신규 SHADOW 승격에는 SHADOW 상태와 techVerified를 명시하고, 일시 복귀에도 버전 불변 확인이 명시돼야 한다. 건강검사는 장애/Retry-After 이전 결과를 재사용하지 않는다.

LOW_FREQUENCY의 최초 허용 시각은 마지막 재탐색+24시간과 Retry-After 중 늦은 값으로 고정한다. Retry-After가15일 뒤여도 그 전에14일 기한이 소진되지 않는다. 날짜가 바뀌어도 fastRetryCount(5xx 빠른3회)와 reprobeCount(느린3회)는 장애 에피소드 누적이며 별도로 유지한다. 운영 저장·동시성은 후속 단계에서 이 값을 보존해야 한다. 권한 만료는 RIGHTS_HOLD/자동 재탐색 금지, 공급 경로의 영구 폐쇄나 회복창 만료는 DISABLED로 구분한다.

Claude 권고에 따라 ProviderPermission의 methods·보관·계약·자격증명 필드와 가격 UNAVAILABLE 타입을 맞췄다. IP 판정은 현재 보수적으로2001/2002 및 일부192 대역 전체를 거부한다. 공개 CDN을 과차단할 수 있으며 실공급 허용 전 IANA 특수 대역 근거와 정확한 대역 회귀를 갖춰 범위를 조정해야 한다. 이 과차단을 우회해 실행하거나 실제 공급 성공이라고 주장하지 않는다.

첫 새 clone은 설치 후 Next 프로세스가0xC0000409로 종료됐고, 같은 바이트 단독 재검사는 통과했다. 최초에는 작성자 전체 검사와 clone 검사 일부가 병행됐으나 자원 경합이 원인이라고 확정하지 않는다. nested clone의 상위 workspace 무시 경고도 보존했다. 수정본은 단독 순차 전체 검사로 다시 확인하며 이전 실패 영수증은 지우지 않는다.
