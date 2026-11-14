# 6B 섹터 설정·카탈로그 연결 구현

2026-11-14. 승인 계획 r2의 local 참조 데이터·관리자·공개 필터 범위다. 구현 검수와 정확한 바이트 커밋 전이며 6단계 전체 또는 native/P03b 완료를 뜻하지 않는다. 원격 push와 실수집·실AI·실시세·푸시·광고는 실행하지 않았다.

## 데이터와 게시 안전 경계

6A의 정확한 source/registry/preview SHA로 신규 제품 local DB에 한 번 등록했다. 초기 snapshot2의 상위11·섹터56·기업339·하위묶음81·문맥별 연결364를 보존한다. 기업339개는 stock identity가 아닌 원본 source-company이며 UNRESOLVED다. 구조상 하단에만 있는 연결2건도 별도 HOLD다. 원본 시트 쓰기는 없고 원문·셀·서식·외국 기업 자료는 private archive에 남긴다. 회사명만으로 종목코드·시세·네이버 주소를 만들지 않는다.

기존 합성 fixture는 SYNTHETIC_FIXTURE, 신규 시트 메타데이터는 USER_REFERENCE_UNVERIFIED/sample_kind null이다. 기사·근거·worker는 여전히 SYNTHETIC 실행만 허용한다. 새 작성은 승인된 최신 카탈로그 leaf만 선택한다. 과거 게시글은 승인된 불변 snapshot과 현재 전역 identity·정책·근거를 확인한다. 이름·설명·순서 변경만으로 과거 본문이나 최초 게시/본문 변경일을 바꾸지 않는다. 삭제는 회복 가능한 비활성화이며 관련 현재 게시글은 CORRECTION_PENDING, 관심 설정에서 해당 ID 제거, 본문 제공 차단을 원자 적용한다. 복원은 선택 metadata만 되살리고 글·하위 연결을 자동 복원하지 않는다.

## 관리자

섹터명·C열 설명·상위 이동·순서·삭제 영향 확인·비활성/복원, 하위묶음 이름·이동·순서, 한국 기업 추가·비활성/복원, 묶음별 기업 역할·연결 해제·복원·순서, 기업 E열 검색 설명·직접/산업 검색어와 섹터 산업/핵심/추가 키워드를 분리한다. 다른 카테고리와 키워드 종류의 중복은 보존한다. 원본의 같은 기업이 다른 묶음에 있으면 별도 연결 ID와 역할을 유지한다.

새 /api/catalog 경로는 기존 HttpOnly opaque session, 실제 Auth session/current SQL membership, Origin/CSRF 경계 안에서 제한된 RPC만 호출한다. 요청128KB/응답256KB, paginated metadata와 선택 상세만 다룬다. 민감한 pending payload가 URL/브라우저 이력에 남지 않도록 operation 조회도 CSRF를 검사하는 읽기 POST로 제공한다.

각 쓰기는 actor와 expected_version·kind·entity·payload SHA 및 operation_key에 결속한다. head lock/CAS, 변경, snapshot, 정확한 before/after 감사, CATALOG_CHANGED outbox, operation 결과를 한 트랜잭션에 기록한다. SQL의 확정 거절은 변경 subtransaction을 롤백한 뒤 REJECTED journal을 남긴다. 따라서 뒤늦은 같은 요청도 적용될 수 없다. HTTP409 자체, 응답 손실, UNKNOWN 또는 operation 부재는 확정 실패로 취급하지 않는다. UI는 같은 키/내용을 유지하고 조회·재시도하며, 실제 matching REJECTED와 명시적 최신 기준 로드 뒤에만 입력을 보존한 새 intent를 허용한다.

카탈로그와 기사 잠금 순서를 head→issue로 통일했다. 기존 migration19의 초안 형식 검사와 migration20의 근거/주장 분류 가드는 유지한다. 회귀 검사에서 확인한 초안 shape 누락은 후속 migration36에서 복원했다. 적용된1~35 파일은 다시 쓰지 않았다. 초기 import의 별칭 충돌과 description 변수 충돌도 후속24/29로 보완했으며 원본 등록은 한 번만 적용됐다.

## 공개 앱과 API

v1 /sectors의 legacy3 ID·envelope·필드와 /articles timestamp cursor, 상세 resolver를 유지한다. v2 /catalog·/sectors/:id·/articles에서 신규 참조 집합을 분리한다. legacy와 신규 동명 섹터를 이름으로 합치지 않는다. 새 목록은 최초 게시일 DESC/issue UUID ASC 복합 cursor, 고정 as_of·카탈로그·정규 필터 hash·기간·page size로 경계를 검증한다. alias는 목록에서 제외하고 옛 상세 URL은 canonical resolver로 읽는다. 현재 정정·철회·숨김·근거 철회는 페이지마다 계속 차단한다.

Expo 공통 화면에 상위 탭/순서별 하위 섹터를 한 팝업으로 제공한다. 임시 선택, 닫기 취소, 전체 선택과 하위 체크, 동일 크기의 선택칩, 결과 보기를 둔다. 오늘·어제·이번주·지난주·이번달·지난달은 한국 달력 기준이며 하루는 단일 날짜로 표시한다. 섹터 상세는 C열 설명과 한국 기업 묶음별 B열 역할을 표시한다. 코드·가격·등락률·외부 종목 링크는 null/확인 중으로 유지한다. 검색의 E열 표시는 다음6C다.

빈 문자열 JSX 조건은 boolean으로 바꿨고 웹 문서는 한국어/번역 제외를 명시했다. ArticleBody return 종결자를 원인으로 단정하거나 지우지 않았다. 새 SDK·lockfile·native0004 입력과 worker 이미지/설정은 바꾸지 않았다.

## 검증과 다음 경계

자체 검사: 동결 원본/보류·private 경계, actual SQL/Auth의 두 세션 CAS와 중복/응답 손실 재시도, 원자 삭제와 관심 설정, 과거 기사 날짜/가시성, 동일시각 복합 cursor/alias/중간 철회/새 게시, 전체56섹터 HTTP 응답 크기/stock null, v1 호환, 관리자 Origin/CSRF, 필터/한국 달력/복구 상태 단위 검사를 둔다. 기존 M0 queue·ownership·publication 및 M1 Auth/R07/R08/HTTP/worker 회귀를 별도로 실행한다.

브라우저에서는 모바일 팝업/선택 취소·전체 체크·적용, 한국어 원문, 로보티즈의 다른 묶음 역할, 실제 관리자 stale 거절→입력 보존→최신 기준 로드→새 저장→원문 복원을 확인한다. 테스트용 설명은 원문으로 복원하고 감사/snapshot 이력은 보존한다. 브라우저 검증은 iPhone 또는 Android 전체 네이티브 실행 인증이 아니다.

전체 pnpm verify, 별도 독립 clone/frozen install, source/index/current 바이트 일치와 DUAL 구현 검수를 통과한 바이트만 로컬 커밋/main FF한다. 이후6C 검색·저장,6D 소유권/조회·알림설정,6E 예약을 각각 계획·검수 후 진행한다. 가격 공급7, 수집봇8, AI shadow9는 별도 권한·출처 게이트를 유지한다. iPhone은 사용자 지시에 따라 보류하며 운영/스토어 출시는 닫힌 상태다.


## 구현 검수 r2 보완

r1 Codex의 S6BI-C01~C04를 보완했다. 기업 편집과 기업 연결의 선택 ID·상세·기준 버전을 분리하고, 선택 상세를 읽은 뒤에만 편집 대상을 바꾼다. 어떤 폼도 다른 폼 저장으로 새 head를 묵시적으로 채택하지 않는다. 충돌 요청은 재시작 후에도 대상명·payload를 보여준다. 확정 REJECTED 뒤 실제 회사/묶음/연결/키워드/순서의 최신 값을 ID로 읽고, 이전 입력을 별도 session 보관소에 먼저 남긴 뒤 옛 요청을 끝낸다. 보관 입력과 현재 값을 비교하여 필요한 필드만 명시적으로 가져올 수 있다. 보관 입력은 연결된 대체 요청의 APPLIED 또는 사용자 삭제 전까지 유지한다. 순서 복구는 새 현재 항목을 보존하며, 비활성화 영향 hash는 복사하지 않는다.

예전/비활성 분류 ID는 실제 과거 이름과 함께 disabled 선택지로 보인다. 현재 분류로 직접 바꾸기 전에는 미리보기·게시를 막는다. 별도 catalog_save_draft는 현재 head CAS를 요구하고 기존 m1_save_draft 호환 계약과 형식 검사를 유지한다. 최신 섹터 목록 버튼은 입력과 초안 revision을 유지하고 preview를 무효화한다. 적용된 SQL은 다시 쓰지 않고 migration38로 대상 조회와 strict save를 추가했다.

실제 local Auth 시험에서 최신 기업 검색어 조회, 이전 catalog 저장 거절 시 초안 불변, 명시적 새 head 저장 성공, 예전 분류명 조회, 이동된 묶음과 기업 연결의 stable ID 복구, 비인증 차단을 확인한다. 시험에서 변경한 표시 값·검색어는 감사 API로 복원한다. 검색어 복원도 ADMIN 변경 이력이므로 mutable metadata의 origin은 갱신될 수 있으나 원본 archive/불변 snapshot은 보존한다.

Claude r1의 P3 권고는 필수 차단 사항과 구분한다. draft-only 참조까지 정정 대기로 두는 보수적 차단은 현재 유지한다. issue별 전환 이력 확대는 6D/6E 설계에서 다룬다. 비정상 membership 오류의 UNKNOWN은 확정 실패로 추정하지 않고 같은 요청만 조회하도록 유지한다. 상태 문서에는 6B 부분 범위와 미완료 6C~6E를 명시한다. 6단계 전체, native, 실수집 완료를 뜻하지 않는다.
