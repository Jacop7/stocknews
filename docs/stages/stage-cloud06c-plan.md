# CLOUD06C — 실제 catalog 적용 기록의 제품 보관·검증·정상 Git 백업

## 전제와 범위

CLOUD06B 결과 DUAL READY(manifest2f650458…), status f898dd8d…, post-baseline062bb11d…, 189파일 ZIP63345460…가 존재하고 해시가 일치해야 이 단계를 시작한다. 실제 dev에는 560463B/7fa0a53a… 준비 SQL을 한 번 적용했고 관계58/data table57/app function130/native5를 독립 readback했다. old4는 정확히 보존됐다. 기존47 업무 데이터·선언한 Auth metadata·필수 namespace/prod152880e6…는 불변이고 dev/prod DataAPI off/Free로 관측됐다. 실행한 원래 adapter와 무조건 write-closed된 현재 recovery revision은 구분해 보존됐다.

현재 제품 main/origin/main5420374632bae72cdd8bfde72dcb3e5be0d93d09,19commit,386파일 clean을 고정한다. 이 단계는 **오프라인 제품 archive와 정상 Git 백업**이다. Supabase/DB/API/CLI 요청·Auth/권한/구독/실제 자료 import·앱/admin/worker/runtime activation은 하지 않는다. DB를 새로 읽지 않으므로 기록된 관측을 liveVerified로 승격하지 않는다. 식자재 자원은 사용하지 않는다. M2=false,112 RIGHTS_HOLD,iPhone USER_DEFERRED다.

## 보관할 제품 파일과 이력

기존386개 중 수정2개는 docs/development-status.json에 cloudCatalog 추가, scripts/verify-foundation.mjs 선두의 CLOUD06C 분기 추가뿐이다. 기존 모든 status 값/분기 원문을 보존한다. 나머지384개는 기준 Git blob과 바이트가 같아야 한다. package/lock/scripts/verify.mjs와 전체23검사 그룹, 이전 모든 validator, 원본 local50, 기존 cloud/dev·core-dev·m1-dev, 앱/admin/worker·기획 snapshot은 바꾸지 않는다.

신규6개는 docs/stages/stage-cloud06c-plan.md, stage-cloud06c-approval.json, stage-cloud06c-notes.md, supabase/cloud/catalog-dev/adoption.json, migrations/20261116000103_cloud06a_catalog_disabled.sql, scripts/verify-cloud06c-foundation.mjs다. 총392개다. SQL은 검증된 A의560463 bytes를 그대로 복사한다. cloud/catalog-dev에는 접속 config·실행기·credential·원시 DB 관측을 두지 않는다. 기존 SQL의 local import guard를 이 archive 단계에서 바꾸거나 원본50을 replay하지 않는다.

adoption/cloudCatalog에는 historical M1 version000102/native4 및 이전 source chain의 경로/SHA, 새000103/native5의5개 lexeme 배열SHA·각문자수/UTF8 SHA, 실제 B 관측시각·source/wire/payload SHA, scoped full Auth+namespace 첫DDL전/transaction/after 결속 및 범위, app58/table57/function130, 기존47 raw E scope와 새57 C scope fingerprint를 각각 기록한다. 원래47과57의 범위를 섞지 않는다. 새 empty head/snapshot/approval3행 외 실제 catalog/reference 행은0이다. before48/75/native4→after58/130/native5는 같은 원자 적용의 기록이며 제품 archive를 두 번째 DB 적용으로 세지 않는다.

B의 결과 DUAL key/manifest/status/verification/post-baseline/검증ZIP 및 실제 실행 source와 현재 closed recovery source의 SHA를 구분해 기록한다. cloudCatalog를 현재 dev 기록 selector로 삼고 cloudM1/기존 inspector를 historical로 보존한다. liveVerified=false, appConnected/workerConnected=false다. Supabase branch의 기본 'main Production' UI 라벨은 제품 runtime preview나 신규 dev 프로젝트 구분을 바꾸는 근거가 아니다.

## 한계와 권고 보존

Auth 보존은 c.AUTH의 uid/users/sessions table·column·policy·trigger/internal RI metadata와 namespace owner/effective ACL 범위다. Auth의 모든 객체나 사용자 행을 검증했다고 하지 않는다. B에서는 fresh full scoped Auth를 실제 첫DDL 전과 적용 후 transaction 안에서 대조했으며 A synthetic fixture를 hosted 전체 증명으로 쓰지 않았다. E 이전 namespace 불변은 계속 NOT_ESTABLISHED_NO_PRE_APPLY_PROJECTION이다. 최신 namespace 관측·B의 보존을 과거 증거 복구로 바꾸지 않는다.

B actual 원래 revision은21unit/31fixture PASS, current closed recovery는23unit/31fixture PASS다. actual intent~ack2.079804초는 fsync/네트워크/응답 시간을 포함하며 SQL CPU 시간이 아니다. synthetic normal<5초 gate는 hosted timing 보증이 아니다. 현재 write entry는 flag/env 없이 무조건 CLOSED이며 파일 유실도 재전송 허가가 아니다.

CL06BI-01/02 비차단 P3를 기록한다. UI 페이지를 reload하고 switch false/Free를 읽고 screenshot을 새로 호출했지만 정적 화면은 같은 PNG byte가 될 수 있어 이미지 단독 최신성 보증은 불가하다. 향후 실제 단계는 PNG SHA를 UI JSON에 묶는다. B check0001/0002는 개별 요청 ledger가 없고 fixed reader와 read-role guard가 근거다. 향후 recovery는 ref/method/bodySHA/status ledger를 추가 봉인한다. 이 archive는 DB/복구 코드를 바꾸지 않는다.

## 신규 보존 검사

신규 foundation은 기준386개 regular blob과 실제392집합,384동결/2정확한추가/6신규를 검증한다. JSON 중복키, path traversal/absolute/drive, reparse/junction/symlink/nonregular/credential 명칭은 내용 읽기 전에 차단한다. 기존 checkedSourcePath/parseCloudJson 방식과 승인·계획·adoption의 고정 필드 비교를 보존한다. 새 SQL의 raw/filtered bytes·UTF8/LF·SHA, 기존 cloud SQL chain·최신 selector·원래관측/한계/정책/APIoff/재실행금지 및 관련 digest를 검증한다.

원래 F validator를 새392파일에 실행했다고 하지 않는다. 새 validator가 전체 기준386blob의 불변을 검증해 이전 검사 결과를 계승하고, 기존 원본 branch/소스는 그대로 남긴다. 기존 env/secret-ignore/filter/ident/encoding/독립 Git root·objects·remotes·ancestry와 root50 실행 경계를 유지한다. 이전0단계 계약 branch도 보존한다. UI/실제 API를 fixture로 가장하는 검사나 통과용 기준선 약화는 금지한다.

새 feature는 feat/cloud06c-catalog-archive 하나다. 원래 존재하는 local·origin ref 집합을 실제로 고정하고 삭제/재작성하지 않는다. 원본 정확집합+허용 새 feature/대응origin과 독립 full clone의 원래 local heads→origin mirror 집합을 구분한다. 원본에 clone-only origin을 억지로 만들지 않는다. 부분삭제·혼합 문맥은 실패한다. main/origin은 기준19commit 또는 직접 일반자식20commit이고, 실제 확인된 equal-tree hosted merge만 한정 허용한다. 임의 ancestor나 merge를 자동 허용하지 않는다.

## 순서·검증·커밋·푸시

이 계획, B 최종/이전F 권위,현재386 SHA·실제refs를 봉인하고 계획 DUAL을 통과한 뒤 제품2수정6추가를 구현한다. meaningful negative는 기존 F의29개 경계·복구와8개 publish race 검사를 변경에 맞게 계승한다. 원본 working tree를 손상시키지 않고 owned checkout/fake Git만 쓴다. source/adoption/namespace·Auth 범위/비활성·한계 삭제, JSON/path/filter/변환/파일 수·mutable 범위, Gitref 삭제/혼합/부적절 lineage를 검사하고 원복을 확인한다. 실패 이유를 예상 코드에 고정해 다른 오류를 PASS로 세지 않는다.

pnpm verify 전체23그룹을 후보 원본과 별도 source-only full Git checkout에서 frozen lock install 후 수행한다. test가 건너뛰거나 SDK 버전이 바뀌면 통과가 아니다. 자체 Git objects를 쓰고 node_modules/auth/env/.git을 backup artifact에 섞지 않는다. source set/negative/전체 verify/fresh byte equality/cleanup을 결과 DUAL로 검수한다. 두READY 뒤 명시적 제품source ZIP·Git archive·영수증 backup을 만들고 검사한다.

publish는 F에서 수정·검수한 exact-object 방식을 계승한다. attached feature/HEAD/ref가 검수 candidate의 동일 object인지 확인하고, mutable branch 이름 대신 **검수된 immutable commit OID:exact feature ref**를 push한다. main은 검수 OID로만 fast-forward하고 같은 OID:main을 정상 push한다. 동시에 main이 바뀌면 중단한다. detached HEAD/advanced feature/precheck 또는 postcheck race/non-FF/wrong origin은 거부한다. 마지막 combined ls-remote의 main과feature 두 값이 모두 같은 검수 OID여야 성공이다. force/reset/delete/empty commit은 없다.

commit 후 원래 검수 byte·부모/이력/clean과 별도 committed checkout의 전체 verify를 확인한다. 최종 product를 보고용 수정으로 바꾸지 않고 결과·commit/push receipt는 outputs에 남긴다. 최종 상태는 source archive·정상 Git 백업 완료이며 앱이나 bot의 가동 완료가 아니다. 다음은 실제 reference 이관/least-privilege gateway·Auth 및 원본39–50의 비활성 적응·앱/admin/worker 연결을 단계별 검수하여 진행한다. ranking 활성화 전에는 최신 사용자 지시08:10–20:00 KR/이후 FOREIGN_US와 과거 문서09:10 차이를 별도 검수한 계약 변경으로 정리한다. 일반 확인질문 없이 이미 승인된 범위를 계속한다.
