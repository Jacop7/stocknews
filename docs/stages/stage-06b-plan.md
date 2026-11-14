# 6B 섹터 설정·카탈로그 연결 실행계획 r2

작성일 2026-11-14. 상태 PLAN_REVIEW_PENDING. 6A 구현 DUAL manifest 0c6be3ab, commit 7718693c7c6add5e9019b1c365f67a72c174f3ea, 동일198바이트 local/fresh/postcommit 전체검사 PASS를 기준으로 한 후속 별도 계획이다. 이 문서의 검수 전에는6B 구현·DB 적용을 하지 않는다. 계획은6B만 승인하며 native/P03b·6단계 전체·봇 실수집 성공을 뜻하지 않는다.

## 구현 단위와 초기 적용 허용 범위

이번 6B는 local 카탈로그·섹터 관리·공개 필터 연결이다. 기획 승인 전 source/DB 변경은 하지 않는다. 6A `importable:false` 출력에 apply를 붙이지 않는다. 별도6B 등록 경로가 검수된 source SHA와 registry SHA, 초기 변환 결과 SHA를 확인한 뒤 신규 제품 local fingerprint에서만 seed를 적용한다. raw 원본/변환/보류는 private 이관 기록으로 남긴다. 구조 불일치 두 연결은 pending 레코드로 보존하고 공개 membership을 만들지 않는다. stock identity339건은 각각 UNRESOLVED로 private source_company_ref를 보존한다. 기존 companies.market의 OTHER에 억지로 매핑하지 않으며 확인된 실상장 identity 테이블과 source record를 분리한다. 기업 목록은 시트 기준 한국 기업 이름·문맥별 역할을 보여 주되 종목 확인 중으로 구분하고 코드·가격·등락률·네이버 URL을 null로 유지한다. 검증된 정식 코드 등록은 별도7단계 공급 검증 뒤 가능하다.

최초 이관의56섹터와81하위묶음 ID는 6A immutable registry를 그대로 사용한다. source339기업 ID는 source_company_ref이며 stock identity를 뜻하지 않는다. 신규 관리자 추가는 새 UUID를 서버가 부여하고 비활성 ID를 재발급하거나 이름으로 합치지 않는다. same company가 서로 다른 묶음에 있으면 로보티즈처럼 두 membership과 역할을 보존한다. 기존 실제 운영 회사표/sector_companies를 무리하게 source 레코드로 덮어쓰지 않는다.

6A Claude 권고 S6I-05를 적용 경계에 포함한다. parser 출력에 ID가 있다는 사실만으로 승인하지 않는다. 상위 묶음·membership 각각의 state/evidence와 전체 unresolved/differences를 검사하며 미승인 제목/셀 해시 변경/같은 셀 안 중복 제목은 모두 보류한다. 초기 등록은 검수된 정확한 동결 hash에만 한정하고, 이후 source 재등록은 변경 후보를 검토하는 별도 경로이며 현재 CLI 결과를 자동 적용하지 않는다.

## 사용자 최신 작업 순서

2026-11-14 사용자가 iPhone을 나중에 검수하고, 그 외 모든 작업을 계속하며 프론트는 브라우저에서 호출해 검수하도록 지시했다. 따라서 기존 6A 로드맵의 ‘6B 착수 전 양쪽 기기 전체 확인’은 이번 후속 계획에서 명시적으로 변경 제안한다. 실제 iPhone/P03b와 네이티브 완료를 통과로 바꾸지 않는다. 웹·DB·서버·worker는 실제 local 검증을 진행하고, native0004의 미확인 실행은 뒤로 남긴다. 운영/스토어 출시는 기기 게이트가 닫힌 채 유지한다. 새 SDK가 필요 없는 6B만 이 계획 범위다.

## 범위

6A 레지스트리·동결 원본·보류 목록을 입력으로 사용해 카탈로그 버전, 상위11·하위56·기업 하위 묶음, 한국 기업 원본339개, 문맥별 설명, 카테고리별 수집 키워드와 별도 기업 검색어를 DB와 관리자에 연결한다. 관리자는 섹터명·설명·순서·이동·비활성, 하위 묶음 이름·순서, 기업 추가·해제·순서·묶음별 역할·검색 설명을 편집한다. 공개 앱은 상위/하위 필터와 섹터 상세 설명·한국 관련 기업을 읽는다. 실제 가격·기사/AI 수집·예약·조회 통계·새 WebView SDK는 범위 밖이다.

## 6A 데이터 확인과 적용 경계

원본의 셀·서식·좌표·검색 설명을 보존한다. 현대건설–원자력 SMR(B333), HB테크놀러지–유리기판(B360)은 하단 연결만 있고 상단 역할이 없어 명시 보류한다. 삭제하거나 역할을 창작하지 않는다. 상장 검증되지 않은339개는 source_company_ref로 보존하고 운영 주식 식별자와 구분한다. 검증된 거래소·6자리 코드가 없는 기업은 가격/링크 null·코드 미확인 상태이며 운영 관련주 수익률 계산 대상이 아니다. 회사명만 보고 임의 종목코드를 넣지 않는다. 원본 시트 역쓰기와 양방향 자동 동기화는 없다.

## 버전과 과거 게시글 호환성

현재 private.m1_current_evidence는 article_version.catalog_version과 active 카탈로그 및 sector.catalog_version을 같게 요구한다. 이 결속을 append-only migration으로 바꾼다. 승인된 과거 카탈로그 snapshot, 과거 article_version, 당시에 판정한 영향과 근거는 불변이다. 현재 전역 섹터/기업 identity의 삭제·철회 여부와 당시 snapshot의 유효성을 별도로 검사한다. 최신 이름·설명·순서만 바꾸어도 모든 기존 글을 차단하거나 최초 게시/본문 수정일을 변경하지 않는다. 새 초안 저장·미리보기·게시·예약은 최신 catalog head에 CAS한다. stale catalog는409이며 기존 입력을 보존하고 최신본의 명시적 로드/재미리보기를 요구한다.

현재 합성 기사에서 쓰인 옛 샘플 섹터가 새56개 필터에 없다는 사실과, 사용자가 섹터를 명시적으로 비활성화한 사실을 구분한다. 과거 참조는 승인 snapshot에 남길 수 있으나 현재 필터가 이를 재활성화하지 못한다. 명시 삭제·정책 철회·근거 불가이면 과거 snapshot도 우회 경로가 아니며 계속 안전 차단한다. 첫 이관의 레거시 ID 호환 처리와 공개 범위는 아래 ID·데이터 등급 계약과 실제 DB 시험으로 고정하며 임의 의미 매핑은 하지 않는다.

## 카탈로그 데이터 등급과 v1 호환 계약 — S6BP-01·S6B-C01

실제 시트의 참조 메타데이터는 합성 기사와 다르다. 섹터에 `metadata_kind`를 추가해 기존 합성 fixture는 `SYNTHETIC_FIXTURE`, 이번 시트 메타데이터는 `USER_REFERENCE_UNVERIFIED`로 구분한다. 신규 참조 섹터의 기존 `sample_kind`는 null로 두며 이 열의 NOT NULL만 새 migration에서 해제한다. CHECK로 합성 fixture는 sample_kind=SYNTHETIC, 참조 메타데이터는 sample_kind IS NULL 조합만 허용한다. 기존 행의 등급은 생성 근거를 검사해 backfill하며 미확인 PERMITTED_REAL 행이 있으면 임의 재분류하지 않고 migration을 보류한다. 상위·하위/기업/source-company/연결 snapshot도 metadata_kind를 보존한다. 참조 데이터를 PERMITTED_REAL 기사로 취급하거나 합성 회사명으로 표시하지 않는다. stock identity는 계속 UNRESOLVED이고 신규 한국 기업 표시는 시트 참조 기업임을 구분한다.

새 `private.catalog_sector_selectable(sector_id,catalog_version,article_mode)` predicate는 초기화된 신규 제품 local runtime, article_mode=SYNTHETIC, 현재 승인 head, 해당 snapshot의 활성 leaf membership, 활성 전역 identity, USER_REFERENCE_UNVERIFIED 메타데이터/sample_kind null, LOCAL_REFERENCE 용도를 모두 확인한다. 레거시 SYNTHETIC_FIXTURE는 별도 승인된 fixture snapshot 안에서만 M1 대상으로 허용하며 초기 시트 head의 새 선택지에서는 제외한다. 새 M1 초안 선택·prepare/publish의 섹터 검사는 이 predicate로 바꾼다. 기존 migration13에서 현재는 prepare_v1이 된 원본 함수의 primary/impact 검사만 새 migration에서 정확한 호출 체인을 확인해 교체한다. 원본1~20 파일은 고치지 않는다. metadata current projection의 catalog_version은 최신 head에 맞추고 과거 판단은 불변 snapshot에서 읽는다. 최종 private.m0_publish_legacy의 기존 active/catalog_version=head 결속·현재 정책·SYNTHETIC issue 검사는 그대로 남겨 M1 사전 검사 후 원자 게시를 이중 검증한다. 별도 service-fixture-only M0 경로는 기존 권한과 synthetic 제한을 보존하고 공개 앱·새 어드민에서 호출하지 않는다.

이 변경은 섹터 측 데이터 등급 검사만 분리한다. issue·article·claim·outbox의 sample_kind=SYNTHETIC, synthetic source URL 검증, REAL_PUBLICATION 금지, 현재 정책·같은 issue 소유 근거·current/verified·민감 주장 차단·공식 또는 독립3근거·path/scenario 검증은 유지한다. LOCAL_SYNTHETIC gateway envelope는 기사 실행 모드이며 카탈로그 원문이 가공된 허구라는 뜻이 아니다. v2 catalog DTO에는 제한된 metadata_kind와 stock 검증 상태를 구분하고 private raw·R/S·내부 근거는 반환하지 않는다.

기존 공개 route는 `/sectors`, `/articles`, `/articles/:id`다. `/catalog`는 기존에 존재하지 않으며 이번에도 호환 alias를 추가하지 않는다. v1 `/sectors`의 envelope `{productId:'judoju-news',mode:'LOCAL_SYNTHETIC',data:[...]}`와 각 항목 id/name/description을 유지한다. `m1_public_catalog`와 v1 `m1_editor_catalog`의 fixture 집합은 이름 검색 대신 정확한 레거시 ID 51000000-0000-4000-8000-000000000001/0002/0003의 활성 행으로 고정한다. 신규 동명 섹터는 결과에 추가하지 않는다. v1 편집 목록은 legacy fixture API로 남기고 새 어드민은 별도 최신 head 편집 RPC를 호출한다. v1로 새 head의 legacy 분류를 재게시할 수 있다고 보장하지 않으며, 확정된 stale/미선택 상태를 새 어드민에서 명시적으로 해결한다. 과거 글 읽기와 v1 HTTP 출력은 그대로 유지한다.

동명 legacy3개와 registry의 신규3개는 ID·snapshot·metadata_kind가 다르다. v2 필터에는 신규56개만 노출하고 legacy3개는 과거 기사 참조 화면에서 이전 분류로 표시한다. 이름으로 합치거나 두 집합을 선택지에 섞지 않는다. 실제 HTTP 시험에서 seed 전후 v1 `/sectors`의 세 ID·순서·필드·envelope가 동일하고 v2에는 신규56개·11상위가 따로 있음을 확인한다. reference sector로 합성 M1 게시가 성공하지만 PERMITTED_REAL issue/article 게시, 비활성/상위 그룹/과거 head로 새 게시가 실패하는 양방향 시험을 둔다.

## 데이터 모델

기존20개 migration은 불변으로 두고 새 migration으로 확장한다. 카탈로그 head/version과 immutable snapshot, 전역 identity lifecycle, parent/sector/subgroup의 ordered version membership을 분리한다. 기존 sector_companies의 PK(sector_id,company_id)는 같은 기업의 다른 하위 묶음 두 역할을 담지 못한다. 기존 합성/공식 identity 테이블을 덮어쓰지 않고 신규 source-company membership 테이블에 별도 ID와 (sector_id,subgroup_id,source_company_ref) 유일성·null 묶음 유일성을 둔다. 향후 검증된 stock identity와의 연결은 별도 필드로 남긴다. 삭제 전 관련 영향 항목을 확인하고 소실 없이 이관한다. B열 역할은 membership별, 하단E는 source-company 검색 설명, 내부 상세 역할과 R/S 해외 비교군은 독립 필드다. 표준 keyword 종류·직접기업검색·산업발견어는 섞지 않는다.

## 쓰기·삭제·경합

기존 실제 Auth/admin metadata/current SQL membership/issued session/CSRF/Origin 경계를 재사용한다. 새 관리 RPC는 작업 idempotency key와 payload hash, expected catalog_version을 검증한다. 같은 키 다른 payload는 거절하며 timeout은 성공/실패를 추정하지 않고 결과 조회로 해소한다. 실제 적용은 한 트랜잭션에서 head CAS→변경→snapshot→감사→outbox를 기록한다. 두 관리자 경합·중복 요청·재기동을 검증한다. 공개 anon은 제한된 읽기만 허용하며 원시 시트·내부 메모·미검증 해외 관계·비공개 통계를 반환하지 않는다.

삭제는 recoverable 비활성화로 한다. 적용 전 해당 섹터의 활성 하위 묶음·기업 membership·대표 섹터 사용 글·예약·관심/필터 영향을 보여준다. 명시적 이동/비활성 대상과 영향을 받는 현재 게시글의 CORRECTION_PENDING 전환을 원자 적용한다. 불변 게시 본문·snapshot의 섹터 ID를 제자리에서 바꾸지 않는다. 대체 섹터는 새 초안에서 근거·영향을 다시 확인하고 최신 head로 미리보기·게시한 새 버전에만 반영한다. 최초 게시일은 유지한다. 적법한 대체가 없으면 관련 글의 기존 본문 제공을 계속 차단하고 임의 수혜를 생성하지 않는다. 비활성 ID는 옛 폼·작업·필터로 복원되지 않는다. 감사 이력과 기존 공개 버전은 삭제하지 않는다.

## 공개 목록·필터·페이지 경계

공개 카탈로그 DTO는 상위 탭 순서, 섹터명/C설명, 하위 묶음과 문맥별 한국 기업 역할을 제공한다. 기업명 아래 하단E 검색 설명은 다음6C 검색과 같은 canonical 필드다. 현재 노출하지 않는 가격은 null 유지한다. 필터 팝업의 탭·선택칩·하위 전체·닫기/결과보기를 브라우저로 확인하고 적용 전 임시 선택은 취소 시 복원한다. 오늘·어제·이번주·지난주·이번달·지난달은 한국 달력/최초 앱 게시일 기준이며 오늘·어제는 단일 날짜로 표시한다.

v2 목록은 (first_published_at, issue_id) 복합 cursor와 filter context를 함께 고정해 같은 시각의 페이지 경계 누락/중복을 막는다. v1의 timestamp 단독 cursor와 route는 기존 의미로 유지하고 v2만 버전을 분리한다. 구버전 앱·이전 기사 resolver·동일 사건 alias는 안전하게 호환하며 공개 정정/숨김 본문은 계속 차단한다.

### 구체적 HTTP·DB 계약

새 공개 route는 `/v2/catalog`, `/v2/sectors/:id`, `/v2/articles`로 분리하고 기존 `/sectors`, `/articles`, `/articles/:id`의 v1 필드·timestamp cursor 의미는 유지한다. v2 상세 기사는 기존 안전한 resolver를 재사용한다. v2 목록 cursor는 base64url의 version·catalog snapshot version·첫 페이지 as_of·last first_published_at·last issue_id·canonical filter hash를 포함한다. 내용은 비밀이 아니므로 보안 토큰으로 취급하지 않고, 모든 필드를 서버에서 검증해 SQL 인자로 전달한다. 필터/기간/카탈로그가 다르면409로 첫 페이지 다시 읽기를 요청하고 SQL 문자열에 삽입하지 않는다. 새 gateway는 이 충돌에 한해 명시적 에러 코드를409로 매핑하고 DB 내부 상세는 노출하지 않는다. 단순 upstream 실패를 확정 충돌로 바꾸지 않는다. 다음 페이지는 as_of 이전 최초 게시글만 포함하며 정정·철회·숨김은 매번 현재 안전 상태로 제외한다. 정렬은 `(first_published_at DESC, issue_id ASC)`이고 경계식은 `first_published_at < last_time OR (first_published_at = last_time AND issue_id > last_id)`다. 같은 혼합 방향의 인덱스와 필터 인덱스를 추가하고 같은 시각 여러 건·페이지 크기1/2·마지막 페이지·중간 철회와 새 게시 시험을 둔다. v1을 새 cursor로 조용히 바꾸지 않는다.

기사 작성의 새 어드민 섹터 선택 목록은 현재 head의 활성 leaf 섹터만 노출한다. 상위11개는 그룹이며 기사 영향 대상이 아니고, 레거시3개 샘플은 새 초안 선택지로 재노출하지 않는다. 기존 레거시 초안은 현재 원문과 과거 분류를 읽을 수 있으나 재게시에는 명시적 새 섹터 선택과 최신 catalog 미리보기를 요구한다. 과거 게시글은 현재 정책·근거 가드가 통과하는 한 기존 snapshot으로 읽힌다. 기존 M0/M1 fixture가 catalog1과 legacy3개를 고정한 점을 고려해 현재 활성 head/명시적 synthetic fixture namespace로 매개변수화한다. fixture 변경은 정책·권한·stale catalog 거절의 기대를 약화하지 않는다. 과거 버전 읽기는 별도 보존 시험을 두며 활성 head를1로 되돌리지 않는다. migration은 한 번만 ledger로 적용하고 테스트가 사용자 작업 중인 draft나 실제 source 레코드를 지우지 않는다.

어드민은 기존 서버 session 경계 안 `/api/catalog/...`에서 요청하며 서버가 명시적 RPC allowlist에 연결한다. GET summary/sector/source-company/operation, POST mutate/impact-preview를 구분한다. 정상 catalog 응답은 전체 raw 시트가 아닌 paginated metadata/선택 섹터 상세다. 요청128KB·응답256KB 상한을 유지하고 한번에 변경할 항목 수를 제한한다. initial seed는 브라우저를 거치지 않는 검수된 local-only command로 적용한다. 관리자 런타임의 service key/anon key/access token/암호화 key를 앱·응답·브라우저 로그로 전달하지 않는다.

관리 mutation은 `{expected_version, operation_key, kind, entity_id, payload}`이며 별도 검증 함수가 kind별 필드를 허용한다. operation_key는 클라이언트에서 생성해 불확실 요청 동안 보존한다. SQL은 실제 admin/current session membership 검사 후 catalog head row를 잠그고, 같은 key 기록이 있으면 payload SHA와 actor에 일치할 때만 이전 결과를 반환한다. 새 key는 expected_version을 비교한 뒤 변경·immutable snapshot·정확 감사 diff·outbox를 한 트랜잭션에 저장한다. 충돌은409/STALE_CATALOG, 키 payload 다름은409/EFFECT_PAYLOAD_CONFLICT다. operation 조회가 없으면 UNKNOWN이며 새 key로 재전송하지 않는다. 이전과 동일 key/payload를 조회·재시도하는 UI를 제공한다. 저장 버튼 연타·네트워크 timeout·두 관리자 경쟁 시험으로 중복 revision/outbox가 생기지 않음을 확인한다.

### 확정 거절과 불확실 저장의 복구 — S6B-C02

기존 editor-state의 confirmedSqlRejection/not_applied 판별 경계를 카탈로그 API에도 유지한다. SQL에서 현재 요청이 원자 롤백됐음이 확인된 allowlist 오류만 `{not_applied:true,error:'STALE_CATALOG'}`처럼 반환한다. HTTP409라는 사실만으로는 확정하지 않는다. UI는 APPLIED, DEFINITELY_REJECTED, UNCERTAIN을 나눈다. 확정 거절은 기존 intent의 key/hash/거절 근거를 보존한 뒤 사용자가 최신 head를 명시적으로 불러오는 데 성공하면 그 intent를 종료한다. 미저장 입력과 최신 diff를 보여 주고 재편집한 새 expected_version·새 key의 새 intent를 허용한다. 확정되지 않은 요청의 payload를 같은 키로 바꾸지 않는다.

timeout·응답 손실·프록시 오류·UNKNOWN·단순 operation 행 부재는 UNCERTAIN이며 동일 key/payload만 조회·재시도한다. APPLIED 조회면 저장 완료로 복원하고 최신 head를 다시 읽는다. actor/payload가 다른 키는 충돌로 잠그고 입력을 보존한다. 같은 동작의 불확실 요청이 해결되기 전에 새 키로 재실행하지 않는다. 인수 시험은 두 관리자 N버전 경쟁에서 한쪽 저장·다른쪽 확정 거절→최신 불러오기→새 intent로 재편집 성공, 저장 응답 유실→UNKNOWN/동일키 재시도→한 revision/outbox만 존재를 각각 검증한다. UI 두 탭뿐 아니라 서로 다른 실제 Auth session도 검사한다.

### 불변 snapshot과 과거 근거 가드

원본 승인 catalog_versions는 현재 head와 별도로 승인/철회 정보를 가진다. version별 sector membership 및 표시 사본은 불변이다. 실제 전역 섹터 identity는 한 번만 부여되고 활성 여부는 별도 lifecycle로 관리한다. 기존 v1 카탈로그도 migration 시 정확한 snapshot을 남기며 세 샘플 섹터를 새56개에 이름 유사도로 합치지 않는다. 필터 공개 집합은 최신56개+관리자가 명시적으로 추가한 것만이며 레거시 참조는 필터 밖으로 남는다.

`private.m1_current_evidence`의 과거 카탈로그=현재 active 제약만 새 승인 snapshot 검증으로 교체한다. 기존 정책 current, M1 계약, 기사·issue·claim SYNTHETIC-only, fact_current, korea_path_verified, sensitive/expiry, primary sector 활성, impact evidence의 같은 issue 소유권, official 또는 독립3근거 등의 조건은 전부 유지한다. 섹터 metadata_kind는 위 별도 predicate로 구분한다. 단순 wrapper로 이전 함수의 current catalog 제약을 우회하지 않고 기존1~20 migration에서 합성된 조건을 명시적인 새 predicate로 테스트한다. 새 기사 prepare/publish는 계속 최신 head를 강제한다. 삭제·정책 철회는 snapshot을 통해 우회할 수 없으며 관련글을 fail-closed한다.

## 브라우저에서 먼저 발견한 프론트 회귀

6A 재검수 중 Expo 웹8084에서 기존 R08-07 상세는 열렸지만 원문 콘솔에 `Unexpected text node: . A text node cannot be a child of a <View>.` 경고가 반복됐다. 처음의 ArticleBody 세미콜론 추정은 검수에서 바로잡았다. 실제 세미콜론은 JSX fragment 밖의 return 종결자이므로 그것을 지우는 작업으로 고정하지 않는다. `article/[id].tsx`의 `result.error && ...`처럼 빈 문자열을 반환할 수 있는 JSX 조건을 우선 조사하고, 초기/로딩/오류/성공·재조회 상태에서 실제 경고와 컴포넌트 근거를 확인한 뒤 boolean 조건 등 필요한 작은 수정을 한다. 이 상태별 회귀와 실제 콘솔 경고 해소를 확인한다. 기존 app 바이트를 보존한6A에서는 변경하지 않았다. Chrome 자동 번역이 켜져 한국어 원문을 바꾸는 관측도 있어 자동번역이 없는 실제 원문 화면으로 검증해야 한다. 브라우저 성공을 Android/iPhone native 성공으로 기록하지 않는다. 원본 R07/R08 가시성 행렬을 유지하면서 콘솔과 렌더링 양쪽을 확인한다.

## 시험과 검수

실제 local Supabase의20개 migration 회귀·권한·Auth·manual publication 시험을 보존한다.56/339 보존과341개 보류의 의미를 구분하며 구조상 불일치2건과 주식 식별자339개를 자동 해소하지 않는다. 카탈로그 이름 변경 후 기존 글 유지·대표 섹터 삭제 대체/불가·stale CAS·같은 기업 다른 묶음 역할·엔터 분리·검색E줄바꿈·동일시각 복합 cursor·구버전 read·R07/R08 재검증을 추가한다. 실제 관리자 브라우저 CRUD와 공개 Expo 웹 필터·섹터 상세를 직접 관측한다. Android는 가능한 범위 관측하고 iPhone은 사용자 보류로 유지한다. 새 SDK/lock/native 입력은0이다.

전체 pnpm verify, 실제 local DB/HTTP 회귀, 별도 독립 checkout/frozen install, 원바이트/index/current source 일치, 계획 DUAL→구현 DUAL→같은 바이트 로컬 commit/main FF만 진행한다. 원격 push·실수집·실AI·실시세·푸시·광고·유료/클라우드 자원 변경은 별도 기존 게이트를 따른다. 다음 단계는6C 검색·저장,6D 소유권·조회/알림설정,6E 예약,7 시세/홈랭킹,8 수집 bot,9 AI shadow다.
