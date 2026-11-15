# CLOUD05C — 적용된 개발 core의 Git 기록과 오프라인 검증

## 목적·전제

실제 CLOUD05B 적용은 끝났고 결과 DUAL READY다. 함수32·native statements46의 version20261115000101 한 행이 추가되어 공식 이력은3행이다. dev fingerprint77b731ebeb11479fb16dcd153c2e98d4ee5da3fbd4b7296cb15b0911f48dc5eb, prod152880e674e3d00c089fcd6a09b9132627963c4d0a59dfe8bcf2dbbe8b9ffc79다. 운영 변경·앱/worker 연결·API 활성화·EXECUTE 허용은 없다. 로컬24항목+unit10, actual dev mutation1과 사후 전체 data/권한/projection 확인,159개 파일 백업 SHA34f52eb77c7425fe2d158b6511e1225501e7b8923b6a385e52425944e1ba6321을 기록했다.

이 단계는 이미 적용한 SQL과 관측 기록을 제품 Git에 보존하는 오프라인 작업이다. source/CLI/DB/API/계정/권한을 새로 실행·변경하지 않는다. 실제 source는88750B/SHAcd45fb900076c4ea30e5de715619363effcddb4a1eafb95d6492515d5b2456f1 그대로다. P3 CL05BI-01은 정적인 설정 화면이 이전 캡처와 같은 PNG로 렌더링된다는 증거 한계이며, 새로 reload한 AX 시각·실제 API 조회가 따로 있다. PNG 자체로 최신성/독립성을 보증하지 않는다.

기준은 main=origin/main40f590f82cb7df425db1c90d644b90f0a4821687,17commit,370개 제품 파일이다. 이전 validators/계약/지역·식자재 자원은 바꾸지 않는다. Supabase 구독 Free,dev/prod Data APIoff,M2false,실제 뉴스/AI/시세/발송0,112 RIGHTS_HOLD,iPhone USER_DEFERRED를 유지한다.

## 정확한 제품 변경 범위

기존 수정은4파일만 허용한다: docs/development-status.json에 cloudCore 필드 추가, package.json에 cloud:core:inspect 및 test:cloud-core 명령 추가, scripts/verify.mjs의 기존 전체 그룹에 test:cloud-core 추가, scripts/verify-foundation.mjs의 현재 dispatcher에 CLOUD05C 새 분기 추가. 각 변경을 기준 blob의 정확한 단일 추가·치환으로 비교하고 나머지 원문/JSON은 같아야 한다.

새 파일10개는 docs/stages/stage-cloud05c-plan.md, stage-cloud05c-approval.json, stage-cloud05c-notes.md; supabase/cloud/core-dev/adoption.json, migrations/20261115000101_cloud05a_core_disabled.sql; scripts/cloud-core-policy.mjs, cloud-core-files.mjs, cloud-core-inspect.mjs, verify-cloud05c-foundation.mjs; tests/cloud-core.test.mjs다. 기존366파일은 바이트 동일해야 한다. 새 core archive는 기존 supabase/cloud/dev의 두 source와 다른 폴더에 보관해, 이전C04E의 정확한 두 source/archive·검수 기록·검사는 그대로 둔다. root local50과 실행기·환경설정·lockfile·앱/admin/worker코드는 전혀 바꾸지 않는다.

신규 adoption record는 이전 cloud/dev/adoption.json을 SHA로 참조하는 historical base와 신규 core source/version/native46/array SHA, 적용 후 fingerprint,32함수·권한0, 관측시각, 실제B 결과 DUAL key/manifest·status/proof/백업 SHA·post-baseline 파일4개의SHA를 포함한다. observedAt은 실제 사후관측시각이며 version 날짜와 다르다. 원시 snapshot·DB내용·token/profile/.env/쿠키·관리API 어댑터·연결 가능한 인증자료는 제품에 복사하지 않는다.

상태는 RECORDED_DEV_DISABLED_CORE_APPLIED이며 liveVerified=false다. cloudHistory 및 기존C04A 값은 당시 관측으로 유지한다. docs/development-status.json#cloudCore가 현재 dev core 이력의 최신 권위임을 우선순위와 supersedes selectors로 명시하고, 그 selector에 해당하지 않는 이전 기록은 덮지 않는다. core:inspect는 현재 source3행을 보여주고 history:inspect는 과거 tracking-only2행을 보여주는 명령임을 설명한다. 이전 값이 현재 권위로 오인되지 않게 두 출력의 observation time·historical/current context를 문서에 명확히 기록한다. 실제 접속 확인으로 표현하지 않는다.

## 오프라인 경계와 검사

cloud-core-policy는 순수 입력/해시 검사만 한다. 고정 preview+dev ref 두 옵션만 허용하고 다른ref/production/미지·중복옵션·환경 자동추론은 거부한다. adoption은 고정 expected record와 정확히 일치해야 한다. 원래2개와 신규1개 source bytes/SHA, 고정config·기준local source와 분리, provenance/기준adoption SHA와 근거 요약을 대조한다. 신규 source의 native statement 수46·characters/array SHA는 검수된B 증거에서 온 값으로 고정한다. 외부 API·토큰·CLI·SQL실행·네트워크·환경변수·자동배포·다운로드·live 권한은 없다. 소스 아카이브가 root migration/local runner/config로 흘러가지 않는지 검사한다.

입력 reader는 명시 allowlist만 읽고, JSON도 읽기 전에 path traversal/absolute/drive path·reparse/symlink/junction·nonregular·credential 이름을 거부한다. cloud-policy/parser의 기존 중복JSON key 방지와 경로/해시 검증을 그대로 재사용한다. Git cloud source의 clean-filter/ident/encoding을 허용하지 않고 raw/filtered object hash 일치와 LF를 확인한다. 정책 순수성·네트워크0·SQL0을 시험하고 descriptor/provenance/source/config/target/옵션/재파싱 등 변조가 거부되는지 의미 있는 시험을 한다.

새 foundation validator는 기준370파일을 Git blob에서 읽고 실제380파일 집합,366동결+4정확한추가+10새파일만 허용한다. 기존 원본 validators를 고치거나 검사 우회를 만들지 않는다. .gitignore/기준18개문서 snapshot의 raw/filter 무변환·기존secretignore·root50·현재allowedrefs/clean history도 보존한다. 기존 전체 verify 그룹은 유지하고 신규 group을 추가한다. 현재cloudCore 분기에서 기준상태에 맞는 새 validator와 기존 provider 검사 둘 다 실행한다. Git 허용 이력은 기준17commit 또는 직계자식18commit(일반1부모) 및 검증된 hosted PR merge의 한정 경우뿐이다. 현재 refs를 기준선으로 고정하고 새feat/cloud05c-core-archive·동명의origin ref만 추가 허용한다. 기존ref를 삭제·재작성하지 않는다.

## 계획·구현·배포 순서

현재 계획과 B의 최종status/proof/post-baseline/SQL·기존370source 근거를 SHA로 묶어 계획 DUAL을 먼저 받는다. 그 뒤 feature branch에서 구현한다. pnpm verify 전체, 신규 의미 시험, 부정 경로/JSON/해시/Git 경계 시험을 통과시키고, 소스만 복사한 별도 임시 Git 저장소에서 동일 product bytes·자체 Git objects·frozen lockfile install로 전체 verify를 다시 수행한다. 이 작업의 임시/백업만 사용하고 인증자료/node_modules/.git을 산출물에 넣지 않는다. 본 저장소와 fresh checkout의 baseline·설정·검증 scripts를 약화해 결과를 맞추지 않는다.

검사 결과와 실제 전체 파일집합/해시를 결과 DUAL로 검수한다. 두READY일 때만 secret 점검·복구ZIP을 보존하고 일반 commit한다. postcommit clean 및 artifact raw object bytes·부모/수·기준해시를 확인한다. feature를 origin에 일반push, main fast-forward 후 일반push하고 ls-remote 양쪽 동일SHA를 확인한다. forcepush·기존 branch 삭제·DB 재적용·권한변경·앱배포는 없다. 결과문서를 쓰기 위해 이미 검수된 제품 바이트를 바꾸지 않는다. 새 commit은 실제10추가+4수정이므로 빈 commit을 만들지 않는다.

다음 단계는 봉인된 CLOUD05B 사후 기준과 이 Git source를 바탕으로 M1/admin 및 catalog/search/settings/schedule migration11–50을 장애 복구 단위로 나눠 cloud용 disabled source로 준비하는 계획이다. 원본local50 전체를 원격에 보내거나 client/public API를 먼저 여는 단계가 아니다. 사용자의 자동 진행 승인에 따라 일반 확인 질문 없이 계속하며 비용/계약/새 인증정보가 실제 필요한 경우에만 해당 경계를 별도로 처리한다.
