# CLOUD05F — 실제 개발 M1 적용 기록의 제품 보관·커밋·푸시

## 전제·범위

CLOUD05E 결과 DUAL READY와 검증 ZIP/status가 존재하고 현재 해시가 일치한 뒤만 이 계획을 검수한다. 기준 제품은 main/origin/main b4fd38ec7e19c8744ee60617deb572bc97f8751d,18commit,380파일 clean이다. 실제 dev는 disabled M1 관계48·함수75·공식 이력4이며, version20261115000102_cloud05d_m1_disabled SQL443028B/SHA857eef2a188613ea678d06b925d1532b356185c180ac0d7e6349a6691b524bb0가 한 번 적용됐다. 원문 lexer5개가 native4번째 행과 정확히 같고 이전3행은 그대로다. 원본 실행기/intent/wire와 보완된 읽기 전용 복구기는 구분해 보관돼 있다. 실제 dev 쓰기1,prod쓰기0이며 재전송은 금지다.

이 단계는 오프라인 제품 보관과 정상 Git 작업이다. DB/API/CLI/원격 schema/계정/설정/권한/구독/앱/admin/worker를 실행·변경하지 않는다. 식자재 자원은 사용하지 않는다. 현재 DB fingerprint는 기존44table-data scope cd8716afb73e194300164e426e2a9ccd3129cdfc482d8af7989034e2d2089c2a와 새47scope e422fbc20730eea4b5ed89a22de28522f0414fefd6b1cfc068498f397e87dbe6이며 scope가 달라 섞지 않는다. prod152880e6…/업무relation0은 불변으로 관측됐다. 기록은 provider 서명이나 현재 live 인증이 아니다.

## 확인 한계 보존

원래 E의 managed Auth projection은 auth namespace owner/ACL을 포함하지 않아 역사적 전후불변은 NOT_ESTABLISHED_NO_PRE_APPLY_PROJECTION이다. 현재 별도 조회(owner supabase_admin/ACL10)만 존재하고, 현재값을 과거 before 증거로 쓰지 않는다. 원래 fullAuth 비교는 좁은 portable guard로 DDL 전 검사 후 전체 hosted 비교는 commit 뒤였다는 시간차 한계도 유지한다. 실제 차이는 관측되지 않았고 원래 write entry point는 영구 닫혔다. API 비활성 설정 화면은 정적 PNG가 같을 수 있어 PNG만으로 최신성을 보증하지 않는다.

E의 P3 CLOUD05E-IMPL-P3-002를 후속 원격 mutation/복구에서 빠뜨리지 않는다: 현재 auth-schema-current.json의 존재와 해시를 필수로 검증한 후에만 별도 계획된 원격 동작을 할 수 있고, 미래 mutation 단계는 fullAuth+namespace before/transaction/after를 자기 계약에 고정해야 한다. F 자체는 원격 호출0이므로 이를 실행하지 않는다. 역사적 증거 결손을 권한 수정이나 원본 migration 재실행으로 메우지 않는다.

## 제품 파일 경계

기존380개 중 수정은2개뿐이다: docs/development-status.json에 cloudM1 최신 기록 필드 추가, scripts/verify-foundation.mjs의 선두에 CLOUD05F 신규 분기 추가(기존 모든 분기 원문 보존). 그 외378개는 기준 Git blob과 바이트 동일하다. package.json·pnpm-lock·scripts/verify.mjs·이전 validators/계약·앱·worker·원본local50·기존 cloud/dev와 cloud/core-dev는 수정하지 않는다.

신규6개는 docs/stages/stage-cloud05f-plan.md, stage-cloud05f-approval.json, stage-cloud05f-notes.md, supabase/cloud/m1-dev/adoption.json, migrations/20261115000102_cloud05d_m1_disabled.sql, scripts/verify-cloud05f-foundation.mjs다. 총386개다. source archive는 고정 bytes 그대로, 별도 m1-dev에만 두며 config/실행기/접속정보를 두지 않는다. 원시 DB snapshot·사용자행·관리API 어댑터·token/profile·.env·cookie·인증서는 제품에 복사하지 않는다.

adoption에는 historicalCore 경로/SHA·기존3source·그 뒤 새source/native5 배열SHA·개별문자수/UTF8SHA·실제관측시각·dev44와47범위 fingerprint·prod불변·관계48함수75이력4·정책v2·권한비활성·재실행금지·E 결과 DUAL key/manifest/status/proof/post-baseline/검증ZIP SHA·현재Authnamespace 관측SHA와 역사적 한계를 넣는다. 모든 값은 검수된 원본 증거에서 계산·대조한다. 새 cloudM1이 현재 dev 기록의 권위이며 이전 cloudCore/이력 명령은 과거 core3행 관측이다. supersedes selector와 observedAt으로 구분하고 이전json은 덮지 않는다. liveVerified=false, app/workerConnected=false를 유지한다.

## 보존 검사

신규 foundation validator는 Git 기준380regular blobs를 읽고 actual386집합·378동결·2정확한 추가·6신규만 허용한다. JSON 중복키·path traversal·absolute/drive/reparse/junction/symlink/nonregular/credential 이름은 본문을 읽기 전에 막는다. 기존 checkedSourcePath/parseCloudJson과 고정상수 검사를 재사용하며 임의 JSON record·DB SQL 실행은 하지 않는다. adoption source와 이전core chain·정확한source bytes/SHA·고정 approval/plan·정책/비활성/권한/한계·추가된 status 필드를 대조한다.

이전 core3행 inspector/테스트는 당시 관측으로 그대로 통과시킨다. 원본 validators를 새386파일에 실행했다고 주장하지 않고, 새 validator가 이전370→380까지의 검수 결과를 기준 Git blob380전체 동결로 계승한다. 기존18기획snapshot raw/filtered 동일, effective filter/ident/encoding 차단, secret-ignore·root50 실행경계·독립 Git root/objects/remotes/이력·refs 검사를 C05C 방식으로 보존한다. 새M1source도 Git 변환 금지/LF/rawfiltered 일치를 검사한다. 기존 전체 pnpm verify23그룹은 유지하며 foundation 안의 새검사가 추가된다.

Git기준 실제ref를 읽기 전용으로 고정한다. 기존 local head·실제있던 origin ref를 모두 보존하고 clone-only origin mirror를 원본에 만들지 않는다. 원본의 정확한ref집합+새feat/cloud05f-m1-archive와 대응origin만 허용한다. 별도 full clone은 historical local heads가 전부 없고 대응origin mirror가 전부 있는 별도 정확집합만 허용한다. 일부삭제·혼합문맥은 차단한다. main·origin/main은 base18commit 또는 직계자식19commit(일반1부모), 한정된 검증 hosted pull의 equal-tree merge만 허용한다. 기존ref 삭제/재작성·forcepush는 없다.

## 순서·검증·백업

이 계획과 E 최종상태/증거·현재380파일SHA·실제refs를 봉인해 계획 DUAL부터 받는다. 그 뒤 새 기능브랜치에서2수정6추가를 구현한다. 신규validator 정상실행, source/adoption/namespace한계 삭제·JSON/path/filter·mutable범위·Gitref 삭제/혼합/부적절 이력의 의미있는 부정검사와 복구를 검증한다. 원본저장소를 변조해 시험하지 않고 별도 owned checkout에서 시험한다.

pnpm verify 전체를 원본 후보와 독립된 source-only full Git checkout에서 수행한다. 자체Git objects·고정 lockfile install을 쓰고 인증자료/node_modules/.git을 산출물에 복사하지 않는다. 시험을 맞추기 위해 validator·기준선·CI문맥을 약화하지 않는다. 검사와 파일집합·해시 결과를 DUAL 검수한다. 두READY 후 복구ZIP을 검증하고 일반 commit, postcommit clean/rawobjects/부모수/전체verify를 확인한다. feature push→main fast-forward→main push, ls-remote로 둘동일SHA를 확인한다. 제품 검수bytes를 결과보고 때문에 바꾸지 않으며 결과·commit/push 영수증은 outputs에 남긴다.

완료 뒤만 기록·커밋·푸시됨으로 보고한다. M2=false,112 RIGHTS_HOLD,iPhone USER_DEFERRED,실제뉴스/AI/시세/발송 미연결을 유지한다. 다음은 catalog/search/settings/reservation(원본21–50)을 dev용disabled source로 준비하는 계획이며, cron없는환경·local bootstrap조건을 별도검토해 원본50을 맹목적실행하지 않는다. 이어서 least-privilege gateway/Auth/app/admin와 클라우드Dockerworker/수집·분석·정렬·발송을 진행한다. 일반 확인질문 없이 사용자가 이미 승인한 범위에서 계속한다.
