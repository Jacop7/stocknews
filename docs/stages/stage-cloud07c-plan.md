# CLOUD07C — 참조자료 등록 기록의 제품 보관과 정상 Git 백업

## 전제와 작업 범위

CLOUD07B 결과의 두 READY와 현재 manifest, 실제 등록 원본·후속 폐쇄본의 구분, post-baseline 및 검증 ZIP의 해시가 확인되어야 구현한다. 제품 main/origin/main 4cadf4c2a0d8ba062a632bab12f4ce65cb36fbb4, 20개 commit, 392 regular source 파일과 원래 local/origin ref 집합을 고정한다. 이 단계는 오프라인 기록과 제품 검사·Git 백업이다. DB/API/Supabase CLI/뉴스 수집/worker/AI/앱 연결·권한·구독은 변경하지 않는다.

실제 신규 dev는 참조 catalog head2, 상위11/섹터56/하위묶음81/기업339/소속364/보류341이다. 관계58/data57/app함수130/native5는 그대로다. USER_REFERENCE_UNVERIFIED/LOCAL_REFERENCE, code·market·price·stockURL null을 유지한다. 미확정339와 구조적 불일치2를 해소했다고 하지 않는다. 실제 관측 이후 현재 상태를 추가 인증한 것이 아니므로 liveVerified=false다. M2=false/112 RIGHTS_HOLD/iPhone USER_DEFERRED, 실제 뉴스·AI·시세·발송0 및 앱/admin/worker 미연결을 보존한다.

## 제품 파일과 기록

392개 중 수정 허용은 docs/development-status.json, scripts/verify-foundation.mjs, scripts/verify.mjs, .github/workflows/verify.yml 네 파일이다. 기존388개는 baseline Git blob과 바이트가 같아야 한다. package/lock 및 이전 모든 validator·원본 local50·이전 cloud archive·앱/admin/worker는 바꾸지 않는다.

신규6개는 docs/stages/stage-cloud07c-plan.md, stage-cloud07c-approval.json, stage-cloud07c-notes.md, supabase/cloud/reference-dev/adoption.json, supabase/cloud/reference-dev/archive/cloud07a_reference_prepared.sql, scripts/verify-cloud07c-foundation.mjs다. 총398 source 파일이다. SQL은 A의 4,252,891 bytes를 그대로 복사한 감사용 비실행 archive다. native migration이나 새 native history로 등록하지 않는다. config·실행기·credential·token·원격 원시 관측·PGP packet은 제품에 넣지 않고, 검증된 로컬 백업 경로/SHA만 기록한다. SQL의 기존 local-only 영구 importer 및 정확3개 temp bootstrap 치환은 수정하지 않는다.

adoption과 새 cloudReference selector는 A→B r1 readonly413→검수된r2 codec→실제write1→전체 독립readback→폐쇄→check1/check2의 이력을 구분한다. A SQL source SHA, 고정 raw3 SHA·길이·source sheet 정보, 승인 plan/result 양 역할key·manifest/status·검사/ZIP SHA, 실행9파일 SHA와 현재폐쇄9파일 SHA, current post-baseline/anchor 및 request ledger를 명시한다. r1 9요청/write0, r2 10+12 및 사후9+9=총49요청/write1, 원래 preflight 실패로 full-before 미저장 한계도 보존한다. PGP phrase는 공개 포맷 매개변수이지 credential이나 기밀성 보호가 아니다. 원문과 packet 재생성·동결입력 재현성 차이 및 writer JSON767190B/probe3차원·decoder reader/postgres 권한검사를 기록한다. intent→ack3.881541초는 네트워크 포함이지 SQL CPU시간이 아니다.

이전 cloudCatalog·M1·core selector 값은 역사적 단계로 그대로 보존하고 cloudReference가 최신 기록이다. 실제14 data 허용표만 변경, 그 밖43 data와 모든 영구metadata/선언된Auth/필수namespace/decoder/native/prod불변임을 기록한다. 옛47E는 이관 후 불변값으로 사용하지 않는다. 새로운57C before be5d3bd8…→after b5e0addd…와 해당 actual post-baseline을 구분한다. E이전 Auth namespace는 NOT_ESTABLISHED_NO_PRE_APPLY_PROJECTION이며 Auth 전체 객체/사용자 행 또는 관리C함수binary 인증으로 확대하지 않는다.

원 실행본과 폐쇄본 사이 raw bytes 차이는 정확두 unconditional LIVE_STAGE_WRITE_PATH_CLOSED 줄이다. 첫 폐쇄 저장의 CRLF 정규화는 결과 검수 전 보존·정정됐으며, 정정 후23unit/2폐쇄 호출·실제readonly check2 PASS다. 원 실행23unit/39fixture와 현재폐쇄검사를 구분하고 추가write로 세지 않는다. 원본 activation/after/post-baseline은 덮어쓰지 않는다.

## 현재 검사와 이전 권고

새 validator는 392baseline/388동결/4정확한수정/6신규/398집합과 approved plan·adoption·비실행SQL·기록 SHA를 검증한다. JSON 중복키, absolute/drive/traversal, symlink/junction/reparse/nonregular/credential 명칭을 읽기 전에 차단한다. 파일filter/ident/working-tree-encoding·secretignore, 독립Gitroot/objects/remote/정확한 ancestry/ref 집합을 유지한다. original local 전체refs와 source-only full clone의 origin mirror를 구분한다. 원 ref 삭제/재작성·혼합문맥은 실패한다.

CL06CI-01을 반영해 scripts/verify.mjs는 기존 toolchain 다음에 최신 validator를 독립 자식 프로세스로 실행하고, 그 뒤 기존 dispatcher와 native 검사 및 모든 기존23그룹을 그대로 수행한다. 전체24그룹이다. CI도 별도 최신 validator 단계를 pnpm verify 앞에 둔다. dispatcher의 새 branch는 최신 validator와 기존 provider검사를 호출하고 기존분기원문은 그대로 보존한다. 0단계 계약 분기도 유지한다. 기존validator를 새398파일에 그대로 돌렸다고 하지 않는다. 최신validator가 baseline전수불변을 증명한다.

CL06CI-02에 따라 계승 negative의 설명은 실제변경대상/기대실패이유로 갱신한다. 기존31개 경계·복구 negative와8개 publisher race를 변경에 맞게 계승하며 독립검사 진입점·CI건너뛰기·dispatcher조기종료에 대한 실제 실패검사를 추가한다. 현재 validator의 독립 호출로 dispatcher process.exit(0)를 잡고, verify pipeline/CI 제거도 고정이유로 실패해야 한다. 테스트를 구현과 동일문장 확인만으로 대체하지 않는다. 원본이 아닌 owned isolated checkout/fake Git에서 수행하고 결과·cleanup·원복을 확인한다. 원래31개와 추가검사 총수는 실제 실행 결과로 확정하며 누락을 숨기지 않는다.

## 실행 순서와 Git

계획 DUAL 후 4수정6추가를 구현한다. 현재전체24그룹과 별도 source-only full Git checkout에서 frozen install 후 전체24그룹·바이트일치, negative/publisher 검사를 수행한다. 정확한후보 source를 결과 DUAL로 검수하고 두READY 후 source ZIP을 생성·재검증한다. 원본 .git/인증/환경/node_modules는 source archive에 섞지 않는다.

feat/cloud07c-reference-archive 단일짧은브랜치에서 정상 commit한다. 실제검수byte/parent/clean과 별도 committed checkout 전체24그룹을 다시 확인한다. mutable브랜치 이름이 아닌 검수immutable OID:정확feature ref를 push하고 main을 그OID로만 fast-forward, 같은OID:main 정상push 후 combined ls-remote의 두ref가 같은OID인지 확인한다. 원래6C에서 검수한 detached/advancedfeature/pre-postrace/nonFF/wrongorigin 거부를 계승한다. force/reset/ref삭제/emptycommit은 없다. 동시에main이바뀌면 자동덮어쓰기하지 않는다. 최종source는 보고용으로 추가변경하지않고 receipt는outputs에 둔다.

다음은 남은39–50 비활성 cloud 적응과 least-privilege gateway/Auth, 앱/admin/worker 연결이다. 실제수집 활성화 전에112 RIGHTS_HOLD와 공급권한, AI키/worker호스트를 해결하고 ranking 활성화 전에 최신08:10–20:00 KR/이후FOREIGN_US와 과거09:10계약을 별도검수해맞춘다. 사용자에게 반복확인질문없이 이미승인된범위의 준비·개발·검수·백업을계속한다.
