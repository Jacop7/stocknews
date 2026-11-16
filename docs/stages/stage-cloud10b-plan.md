# CLOUD10B — 실제 공개 읽기 연결 전 시험·설정 격리 보강

## 현재 위치와 범위

CLOUD10A 계획·구현 DUAL ac58b45f, main/feature b26207a(tree e2a6661e),418파일, current/fresh/committed 전체25·read10·negative32·publisher8 및41파일 ZIP cc45f192가 검증됐다. 실제 Supabase는 마지막 기록이 dev71data/72relations/177app functions/native7/head2/339미확정기업341holds이며 APIoff다. 이번에는 새 원격 관측으로 재인증하지 않는다. 앱/admin/worker미연결, M2false112RIGHTS_HOLD/iPhoneUSER_DEFERRED/실뉴스AI시세푸시0이다.

실제 설정을 만들기 전에 C10AI-01·CL10AI-01 두 P3를 보강한다. 제품418 중412동결, 정확6개 수정과5개 추가로423이다. 브랜치 feat/cloud10b-preview-read-test-isolation. 실제key조회/HTTP·SQL·grant/API/Auth/cron/prod/기존runtimeenv·서버·식자재 변경0이며, 실제 공개권한·연결 단계는 이 계획으로 승인하지 않는다. 기존9RPC 계약·local62330/명시preview12762331·고정dev·nullidentity·공개keyheaders는 그대로다.

## 시험이 운영 설정을 읽지 않도록 격리

현재 read test의 loadApprovedPreviewConfig/default createPreviewGateway/실제 CLI subprocess 시험은 실제 제품 .local-data/cloud-preview에 proof/config가 없다는 전제다. 미래 활성화 후에는 이 전제가 깨져, 전체 pnpm verify가 실제키를 읽거나 외부요청/daemon을 시도할 수 있다. 이를 먼저 제거한다. module import는 계속 파일/네트워크/listen 0이다.

loadApprovedPreviewConfig에 명시적 trusted-call 옵션 privateRoot를 추가한다. 기본 CLI는 기존 제품root만 사용하고 환경변수·CLI flag로 root/승인을 바꾸지 않는다. 전달root는 absolute 실제디렉터리·symlink/reparse 거부 및 고정 상대경로의 boundary검사를 거친다. 이 옵션은 시험 작성자에게 제공하는 instruction boundary이며, 악의적 local writer를 차단하는 보안기능이 아니다. 고정 cloud-preview/access-proof와 public-config 경로, CLOUD10B_PUBLIC_READ_VERIFIED proof·9names·SHA 결속·public key 분류는 유지한다.

시험은 자기 소유 os.tmpdir의 신규 judoju 전용 임시 root에만 proof/config를 만들고 finally에서 소유경로를 검증해 정리한다. 실제 제품 .local-data·.env·인증정보를 읽거나 복사하지 않는다. 샘플 proof/config/key만 허용한다. 기존 '기본 CLI를 실행하면 missing proof' 시험을 실제 제품 CLI 실행 없이 격리된 loader/subprocess 시험으로 바꾼다. default 실제 gateway 호출도 실제 설정을 읽지 않게 제거·대체하며, gateway시험은 명시 fixture transport/port0/finally close만 사용한다. 실제 CLI no-proof 거부에 관한 C10A 역사적 증거는 그대로 보존하고, 새 증거로 실제CLI를 인증했다고 주장하지 않는다. 미래 설정이 존재해도 전체시험이 이를 읽지 않게 호출경로를 정적으로 검사한다.

## C10AI-01 — 실제 deadline과 body 취소 시험

현재 시험은 AbortSignal 존재와 즉시 TimeoutError를 다루는 것만 검증한다. 추가 시험은 fake fetch가 전달받은 signal의 abort 이벤트를 실제로 기다리게 한다. 응답헤더를 받은 뒤 지연된 ReadableStream이 같은 signal로 error되는 경우도 검증한다. 기본 upstream의 AbortSignal.timeout(7000)을 실제 사용하며 외부네트워크를 호출하지 않는다. 취소되지 않는 signal로 바꾼 변형에서는 명확히 실패하도록 aborted 플래그·reason과 별도 owned guard deadline을 검사한다. guard/timer/listener/stream은 모두 finally 정리하고 signal 자체가 event loop를 유지하지 않는 문제도 자기 참조timer로 해결한다.

gateway 동시3개의 지연 body가 timeout 이후 일반화503으로 종료되고 슬롯이 반납되어 다음 정상 요청이200이 되는지 fixture로 확인한다. raw SQL/key/TimeoutError 세부가 노출되거나 stale/mock fallback이 없어야 한다. fixture는 실제7초 구간을 쓰지만 공급자의 타임아웃·네트워크 SLA·PostgREST 실행시간을 인증하지 않는다. 기존 READ_RPCS/DTO/CORS/429/Host/Origin/credentials/limit 시험은 보존한다.

## CL10AI-01 — 비공개 경로와 경계

현재 .gitignore 전체 .local-data/와 두 실제 check-ignore 관측은 이미 기록했다. 새 독립validator의 Secret ignore 목록에 정확 .local-data/cloud-preview/access-proof.json 및 public-config.json을 추가하고 각 경로가 ignore되지 않도록 한 owned 사본 변형을 거부하는 시험을 넣는다. 실제 파일은 만들지 않는다. Git/ZIP에 키/proof를 넣지 않는 기존 규칙도 유지한다.

exported previewUpstream과 주입 transport는 proof 없이 호출 가능한 trusted library 경계이며 CLI default만 proof-before-key/network를 보장한다. 이 한계를 새notes·registry에 명시한다. bridge Host/CORS/rate는 DB 권한경계가 아니다. 미래 활성화는 직접 Supabase RPC 우회, 전체 exposed schema 관계/시퀀스/함수 effective PUBLIC/anon/authenticated ACL,9개appRPC예외와 managed public.rls_auto_enable 명시정당화, fresh정의, 직접RPC 범위/timeout/남용/비용을 검증하고 불충분하면HOLD한다.

Supabase 공식 timeout 문서는 anon 기본3초와 role 설정/REST config reload를 설명하고, PostgREST 공식문서는 impersonated role timeout의 transaction 적용을 설명한다. 이는 공급자 기본값을 현재프로젝트 관측으로 대신할 수 있다는 뜻이 아니다. 미래 실제 연결 preflight는 secret을 포함할 수 있는 전체 rolconfig를 읽지 않고 허용된 timeout 항목만 투영한다. 실제 권한변경/APIon/공개키조회·config/proof작성·bridge연결은 별도 계획/구현 DUAL과 구체적 사용자 승인 후다. cron은 genuine capability/retention 검증 전 전체부재 유지하며 의존조건이 아니다.

## 정확 제품 변경과 검증

수정6개: docs/development-status.json에 cloudPublicReadActivationPreparation selector만 추가, scripts/verify-foundation.mjs에 최신B+providers 분기만 추가, scripts/verify.mjs와 CI 최신독립 entry A→B 각1회 교체, scripts/cloud-preview-public-read.mjs의 격리root loader 변경, tests/cloud-preview-read.test.mjs의 격리·deadline·body·슬롯 보강. package/SDK/native/lockfile/앱프론트/helper/localgateway/admin/SQL1–50/cloudarchives/이전Avalidator는 동결한다. 새파일5개는 plan/approval/notes·verify-cloud10b-foundation.mjs·public-read-activation/preparation.json이다. 실제conn 완료 selector가 아니다.

기존23+최신독립1+readtest1 전체25를 유지하고 새test group을 만들지 않는다. 이전 deadline 한계를 단순 문구수정으로 통과시키지 않는다. 계획DUAL→구현→current25→독립 Git객체/frozeninstall/423bytes/fresh25→별도 owned negativecheckout(의존성 준비 후 실제pnpm 우회거부·키ignore override·기존기능삭제·timeoutsignal 변형의 실패)→publisher8→구현DUAL→sourceZIP→정상commit→committedfresh25→검수immutableOIDfeaturepush/mainFF→combinedrefs/finalbackup이다. 실패를 보존하고PASS와 합치지 않는다. force/reset/rebase/productionref삭제/빈commit은 없다. 전체서비스완료나 실제iPhone/원격API 성공을 인증하지 않는다.
