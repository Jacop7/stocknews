# CLOUD05C — 적용된 개발 core 기록

현재 기록의 권위는 docs/development-status.json#cloudCore와 supabase/cloud/core-dev/adoption.json이다. supersedes의 구체 selector 4개는 현재 core의 source 목록·snapshot·연결 대기 범위만 갱신한다. 과거 cloudHistory와 cloud/dev/adoption.json은 당시의 이력2행·tracking-only 관측으로 보존한다. before3e1ea724…가 historical after와 같고 새 after77b731eb…로 이어짐을 정책이 검사한다. prod152880e6…는 전후 같다(CL05CP-01).

`pnpm cloud:core:inspect --environment preview --project-ref nxfpfvsdwbziowkxsxnh`는 이력3행·함수32개의 저장된 최신 기록만 확인한다. liveVerified=false, SQL0·network0이며 실제 접속·권한 활성화나 재실행을 하지 않는다. 기존 `cloud:history:inspect`는 observedAt이 더 이른 CLOUD04D 이력2행의 역사자료다. 원시 DB snapshot·관리API 어댑터·인증자료는 제품에 포함하지 않는다. 증거 SHA는 호스트 보관 산출물 추적값이고 공급자 서명이 아니다.

새 core SQL88750bytes는 이미 적용된 bytes이며 복구용 archive다. supabase/cloud/core-dev에는 실행config가 없고 CLI workdir가 아니다. 기존 cloud/dev의 두 source·config·adoption 및 root local50은 바이트 동결이다. remote link/push/repair·원본source 재실행 기능은 없다. 기존366파일과4파일의 정확한 추가·10새파일 경계,18문서snapshot·source Git 변환 금지·secret ignore·이력/refs·전체verify 그룹을 새 validator가 검사한다. 이전 validator를 현재380집합에 실행한 것처럼 표현하지 않는다.

계획 DUAL 뒤 구현하며 구현 DUAL 뒤 일반 commit·feature push·main fast-forward push한다. 검수 bytes를 결과 기록으로 바꾸지 않고 외부 outputs 영수증에 commit/push/backup을 남긴다. 이 단계 DB/API 요청0, Free/DataAPIoff의 직전 관측·PUBLIC/API EXECUTE0·앱/worker 미연결·M2false·112 RIGHTS_HOLD·iPhone USER_DEFERRED가 유지된다. 정적 화면이 같은 PNG로 다시 캡처될 수 있으므로 PNG 단독 최신성을 주장하지 않는다(CL05BI-01). 다음 단계는 봉인한 CLOUD05B 사후 기준에서 M1/catalog 등 나머지 cloud source를 준비한다.

구현 r2(C05CI-CODEX-01): 존재하는 ref의 OID만 비교하던 검사를 보완했다. 일반 로컬은 기존 모든 historical head와 origin ref를 필수로 보존한다. 별도 full clone은 옛 local head가 전부 없고 각 exact origin mirror가 전부 있어야 한다. 일부 head만 삭제된 혼합 상태는 어느 문맥에도 속하지 않아 차단된다. reduced CI 문맥은 검증된 pull ref 또는 정확한 repo/main push SHA·branch·local/remote main 일치 형태만 허용하며, CI 변수 자체를 암호학적 인증이라고 부르지 않는다. 부정 검사에서 로컬 보존 문맥을 만들고 기존 head 하나를 삭제해 실패하는지 확인한 뒤 복구한다. 원래 ref·제품 검수 r1 source/evidence는 외부 outputs에 보존했다.

구현 r3(CL05CI-01): 실제 원본 기준선은 local head12개+main+origin/main+origin/cloud04e의15개다. frozenRefs24개는 원본 head12개와 full-clone의 대응 origin mirror12개를 합친 집합이며, 원본에 없던 origin11개를 존재한 것처럼 만들지 않는다. originalLocalRefs15개를 고정하고 로컬 문맥은 모두의 존재/OID와 정확한 허용 집합을 요구한다(main은 단계별로 허용된 base/head 이력 검사가 별도 적용됨). full clone은 옛 local head가 전부 없고 대응 origin mirror가 모두 존재하는 별도 정확 집합만 허용한다. 혼합 집합은 차단한다. 로컬 문맥에서 실제 원래 있던 origin/cloud04e 삭제도 거부·복구 시험을 추가했고, clone-only mirror가 로컬 집합에 섞인 경우도 거부한다. 기존 refs를 삭제하거나 가짜 tracking ref를 제품 저장소에 추가하지 않았다.
