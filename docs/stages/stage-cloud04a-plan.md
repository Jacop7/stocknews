# CLOUD04A — 신규 클라우드 상태의 저장소 정합성과 오프라인 이관 검사

## 목적과 현재 증거
사용자가 새로 만든 주도주뉴스 전용 Supabase만 사용한다. 개발 nxfpfvsdwbziowkxsxnh, 운영 zkzevpinuixeuyjlffwi, 조직 qfzgicohgpuogehdyzfx, 서울 ap-northeast-2, Free다. CLOUD03 DUAL 결과 051fca72c1e29c195aa8819eeb71625d3005d0927d6ae5cab63b47511cc46071에 의해 개발은 첫 foundation만 STAGED_DISABLED, 운영은 빈 상태, 양쪽 Data API 꺼짐으로 관측되었다. 리소스 manifest는 아직 PENDING/null이라 저장소와 실제 상태가 어긋난다.

이번 단계는 관측 기록을 저장소에 반영하고, 이미 적용된 SQL을 원본으로 재현하며, 다음 단계에서 대상 혼동을 막는 오프라인 검사만 만든다. DB 접속, API 활성화, 키 발급, CLI 이관 이력 채택, 다음 migration 적용, 앱/어드민/worker 연결은 하지 않는다. 기존 식자재 자원과 무관하다.

## 변경 범위
기준은 main 94ac7e0c63d51cb646c9406992c26aafccaca0ef의 345파일이다. 짧은 브랜치 feat/cloud04a-deployment-source. 기존 5파일만 허용한다:
1. docs/project-resource-manifest.json: supabase_preview와 supabase_production의 status/actual만 변경한다. preview는 논리 환경이고 실제 프로젝트 이름은 dev다. actual에 observedAt, org/ref/name/region/plan, Data API false, connected false, staged 상태, 근거 manifest를 기록한다. 나머지 모든 자원은 동등하게 보존한다. 기록은 연결 승인이나 현재 건강 보증이 아니다.
2. docs/development-status.json: cloudDeployment만 추가. 기존 currentStage6 및 모든 이전 필드·상태는 변경하지 않는다. cloudDeployment는 CLOUD04A / OFFLINE_SOURCE_ONLY / appConnected false / workerConnected false / officialHistoryAdopted false / liveSupplyEnabled false / iPhone USER_DEFERRED다.
3. package.json: cloud:inspect, test:cloud-deployment 스크립트 두 개만 추가. 종속성/lock/native 수정 없음.
4. scripts/verify.mjs: 기존 전체 검사에 cloud test 1그룹 추가만 한다.
5. scripts/verify-foundation.mjs: 최상단 분기에 CLOUD04A 전용 validator+기존 공급경계 validator를 실행하도록 추가한다. 과거 모든 분기 본문은 그대로 유지한다.

새 파일 정확 목록:
- docs/stages/stage-cloud04a-plan.md / stage-cloud04a-approval.json / stage-cloud04a-notes.md
- docs/cloud/deployment-contract.json
- supabase/cloud/cloud03/guard.sql / seal.sql / dev-domain-foundation.sql / provenance.json
- scripts/cloud-deployment-policy.mjs / cloud-source-files.mjs / cloud-inspect.mjs / verify-cloud04a-foundation.mjs
- tests/cloud-deployment.test.mjs

guard/seal/full SQL은 검수된 outputs CLOUD03 바이트를 복제하고 provenance는 이 검수와 원본 SHA를 연결한다. 원본 migration1은 19011bytes SHA5b3c2d38206dc3c43c51db287d14584b3aa72b1f54d5b2e368e252a5fcf90caa; 전체 approved SQL은 24148bytes SHA330f333ff252111d97ac68a8b55695350d545eaa524930589cecbb02396d5df9. 과거50migrations는 전부 동결한다. 텍스트 바이트는 LF 정규화 여부를 명시하고 hash가 실제 git checkout과 일치하는지 검증한다. 기존 .gitattributes는 수정하지 않으므로 새 파일은 LF로 저장하고 SQL 복사본의 SHA가 원본과 다르면 진행을 멈춰 검토한다.

## 오프라인 도구 계약
cloud-deployment-policy는 순수 검증 함수이고 cloud-inspect CLI는 로컬 파일 읽기와 stdout JSON 출력만 한다. 네트워크/DB/하위 프로세스/환경변수/비밀키 접근 또는 SQL 실행 기능을 포함하지 않는다. CLI 인자는 --environment preview --project-ref nxfpfvsdwbziowkxsxnh --artifact foundation1만 허용한다. 누락·중복·알 수 없는 인자, production/다른 ref/다른 artifact는 거부한다. 출력은 NOT_EXECUTED_OFFLINE_ONLY이며 SQL을 실행하거나 migration repair 명령을 제시하지 않는다.

검사는 versioned contract와 실제 manifest의 두 대상 매핑, prod EMPTY와 dev STAGED_DISABLED, Data API false/connected false, 논리preview↔물리dev, 공식 CLI history 미채택을 검증한다. 원본과 guard/seal/deployment 파일 SHA·byte수 및 정확한 단일 BEGIN/COMMIT 삽입 위치를 확인한다. 제거하면 원본과 바이트 동등함을 확인한다. 계약/manifest 대상이 동시에 변조돼도 고정 허용값과 대조하여 거부한다. 검증 통과는 현재 원격 상태 또는 SQL 재실행 승인이 아니다. foundation은 이미 적용됐으므로 출력에 REPLAY_FORBIDDEN을 표시한다.

## 기존 검사를 약화하지 않는 방식
이전7B2B validator는 특정 과거 파일집합/분기/단일child만 허용하므로 새 단계에는 그대로 적용 불가하다. 이 validator 및 이전 validator 전부는 원본 바이트로 보존한다. 새 CLOUD04A validator는 base94ac의 전체345 blob 목록과 바이트를 git에서 읽고 위5개 외340개가 동결됐는지 검사한다. 5개 변경은 JSON 역변환 동등성/정확한 문자열 삽입으로 검사한다. 새13파일 외 모든 추가/삭제를 거부한다. 계획/승인 SHA, 실제 SQL SHA를 검증한다. 독립 .git/no alternates/no GIT_* routing/no includes/hooks, 단일 authorized remote, 알려진 과거 refs+새branch만 허용한다. 기준15commit 또는 기준의 단일child16commit, CI에서 검증된 base+child merge17commit만 허용하고 임의추가 commit/분기는 거부한다. 과거 검사를 실행했다고 주장하지 않고, 새 baseline freeze가 이전 검증된 바이트를 보존함을 명시한다. unchanged provider/native validators, 기존 모든 타입·단위·관리자 build·Android/iOS JS export를 여전히 실행한다.

## 시험/검수/백업
계획은 Claude Opus5.5 medium + Codex gpt-6-astra ultra의 독립 DUAL READY 후 구현한다. tests는 정상 오프라인 산출물, 잘못된/누락/중복 CLI 인자, prod·ref 혼동, 동시 contract/manifest 변조, source/guard/seal/deployment 바이트 변조, original 재구성, legacy 원본 동결을 검사한다. 부작용이 없는 별도 fixtures로 시험한다. full pnpm verify와 깨끗한 독립 clone의 full verify를 실시한다. negative source/target/ref/ancestry 검사를 따로 수행하며 결과와 전체 파일hash를 외부 evidence에 보존한다. 구현 DUAL READY 뒤 reviewed파일만 단일commit, commit후fullverify 및 정상 main fast-forward/push, 원격SHA 일치 확인한다. 검수 원문·잠금·키·개인환경·원시대화는 커밋하지 않는다.

## 다음 단계와 한계
공식 migration history 채택 및 preview용 최소 RPC/인증 이식은 별도 설계·검수한다. local전용 assert_initialized/m0_bootstrap/pre_request가 있어 migrations2–50 일괄 적용은 금지한다. 새 프로젝트 Free pause/health와 Data API는 실제 접속하는 그 단계에서 별도시각 before/after JSON으로 확인한다. SQL Editor가 RLS 미인식 경고를 내면 원본 SQL의 explicit ENABLE/FORCE RLS 실행과 자동SQL재작성 선택을 구별하고 편집기 전후바이트를 확인한다. 이번 단계는 브라우저 DB mutation0이며 실제 뉴스·AI·시세·발송0,112 RIGHTS_HOLD, M2false, iPhone deferred다.

## r2 검수 보완 — 이전 범위 중 새 파일 수는 13개로 정정
C04AP-01: 새 validator는 기존 7B2B와 같이 모든 git 소스의 각 경로 구성요소를 lstat하여 symlink/junction을 거부하고, realpath가 제품 root 안에 있는 regular file인지 확인한 후 읽는다. cloud-source-files.mjs는 CLI의 고정 allowlist 파일을 읽는 동일 경계를 제공한다. 임의 경로 인자나 환경변수 경로를 받지 않는다. 파일 링크, 상위 디렉터리 junction/symlink, root 밖 realpath를 읽기 전에 거부하는 fixture 시험을 추가한다. 실제 Windows junction fixture와 모의 lstat/realpath fixture로 Windows의 파일 symlink 생성권한에 의존하지 않고 세 가지 차단을 확인한다. own temporary fixture만 만들고 제거한다.

CL04AP-01: CI merge를 수용하는 경우 정확히 base와 base의 단일 child 두 parent이고, merge tree OID가 child tree OID와 동일하며 hosted ref/SHA/repository가 인증된 경우만 허용한다. local merge는 거부한다. 실제 배포는 단일 child의 main fast-forward다.

CL04AP-02: 두 resource status는 OBSERVED_NOT_CONNECTED. actual 공통 키는 productId=judoju-news, createdNewForProduct=true, organizationRef=qfzgicohgpuogehdyzfx, region=ap-northeast-2, plan=Free, observedAt=2026-11-15T08:29:06.201Z, dataApiEnabled=false, connected=false, observationOnly=true, officialHistoryAdopted=false, evidenceManifest=051fca72c1e29c195aa8819eeb71625d3005d0927d6ae5cab63b47511cc46071. preview actual은 projectRef=nxfpfvsdwbziowkxsxnh, projectName=judoju-news-dev, physicalEnvironment=dev, logicalEnvironment=preview, databaseState=STAGED_DISABLED; production actual은 projectRef=zkzevpinuixeuyjlffwi, projectName=judoju-news-prod, physicalEnvironment=prod, logicalEnvironment=production, databaseState=EMPTY. 관측시각은 Data API UI 관측 시각이며 구조 DUAL 확정 근거는 evidenceManifest다. 새로운 현재 health/접속승인이 아님을 문서와 출력에서 명시한다. contract와 코드의 고정값이 이를 검증한다.

CL04AP-03: 구현 전 소비자 검색을 실시했다. active verify-toolchain은 currentStage만, verify-stage3-providers는 기존 supplyTrack 등만, verify-native-release는 native-release record만 읽는다. local-runtime은 plannedLocalConfig와 기존 m1만, seed-reference-local은 기존 catalogConnection만 사용한다. 해당 필드는 동결된다. legacy validator에서 PENDING/null을 단언하는 부분은 해당 과거 분기에서만 쓰고 새 CLOUD04A는 명시적 reverse-delta 검사로 대체한다. 시험과 나머지 코드 소비자 목록을 구현 메모에 기록하고 full verify로 회귀 확인한다.

CL04AP-04: supabase/config.toml에는 seed/sql_paths/schema_paths 항목이 명시되어 있지 않으며 cloud 경로를 지정하지 않는다. CLI 기본값의 seed 실행 여부를 임의로 false라 단정하지 않는다. 기존 start-local/migrate-local/maintenance 및 harness는 supabase/migrations 디렉터리의 파일만 읽는다. cloud SQL은 별도 supabase/cloud 디렉터리라 migration/seed 검색 대상이 아니다. 구현 시험에서 config와 harness 정적경로를 확인하고, 자동 SQL 실행기/클라우드 import는 만들지 않는다. 별도 공식 이력 채택 전 CLI db push/reset/cloud SQL 실행 지침은 제공하지 않는다.
