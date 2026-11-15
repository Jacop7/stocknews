# CLOUD04E — 클라우드 이력과 전용 SQL의 제품 저장소 반영

## 목표와 전제

main=origin/main=a4bbbedfa4137372ac85e9830b42cadadf698f9d(16 commits), 제품358파일을 기준으로 한다. CLOUD04D에서 dev nxfpfvsdwbziowkxsxnh의 공식 schema_migrations에 20261114000000/000001을 tracking-only SQL 1회로 등록했다. 원본 SQL을 재실행한 것이 아니다. 기존 dev/prod의 지정 업무·제어 메타데이터와 데이터 fingerprint는 불변, 두 Data API off, Free였다. 계획·구현 DUAL READY, 로컬64시험 및 nativeCLI local3회 PASS, 최종56파일 백업 SHA205664d859f1477ecc33b87fa7a55b98c833f686200e84b23314a087beb7abee다. 실제 채택시각은 2026-11-15T11:35:55.193610+00:00 사후관측에 있고 migration version의 20261114는 순서 ID다.

이번 단계는 이 사실과 이미 검수된 전용 SQL 두 파일을 Git에서 재현·검사할 수 있게 한다. 새 원격 DB/API/CLI 작업, link/push/up/reset/repair, 키·권한·billing·인증·네트워크 설정 변경은 없다. 식자재 제품·계정·DB는 읽거나 쓰지 않는다. 실제 뉴스·AI·시세·발송0, 112 RIGHTS_HOLD, M2false, 앱/worker/RPC미연결, iPhone USER_DEFERRED 유지다. 기존 CLOUD04A 관측·기록은 당시의 역사자료로 보존하고 새 status 필드가 최신 기록의 단일 진입점이 된다. 과거 기록을 현재 상태로 잘못 해석하지 않도록 notes와 inspector 결과에 우선순위를 명시한다.

## 제품 변경 범위

새 파일12개:

- supabase/cloud/dev/config.toml
- supabase/cloud/dev/migrations/20261114000000_cloud02_dev_control.sql
- supabase/cloud/dev/migrations/20261114000001_cloud03_dev_domain_foundation.sql
- supabase/cloud/dev/adoption.json
- scripts/cloud-history-policy.mjs
- scripts/cloud-history-files.mjs
- scripts/cloud-history-inspect.mjs
- scripts/verify-cloud04e-foundation.mjs
- tests/cloud-history.test.mjs
- docs/stages/stage-cloud04e-plan.md
- docs/stages/stage-cloud04e-approval.json
- docs/stages/stage-cloud04e-notes.md

변경4개: package.json에 cloud:history:inspect와 test:cloud-history 두 script 추가; scripts/verify.mjs에 새 테스트를 기존 전체 그룹에 추가; scripts/verify-foundation.mjs의 맨 앞에 CLOUD04E 분기를 추가하되 이전 분기는 그대로 보존; docs/development-status.json에 cloudHistory 최신 필드만 추가한다. 나머지354 baseline 파일은 byte freeze다. 기존50 local migration, native inputs, worker/app/admin, 자료 스냅샷, 원본 검수 절차와 모든 이전 validator는 바꾸지 않는다. 새 dependencies/lock 변경은 없다.

전용 config와 SQL은 CLOUD04B에서 사용하고 CLOUD04D가 결속한 원본 bytes를 그대로 복사한다. config SHA c681c7798f48ddd3febf7a2115e73ace57f01947a671cc8aee733cc540107ffa, control2956bytes SHAa58a6453802cb785087ccd7cc3bcfd536b7c7f8b765fe6822f0e66e9a0eadb1e, domain24148bytes SHA330f333ff252111d97ac68a8b55695350d545eaa524930589cecbb02396d5df9다. root000001은19011bytes SHA5b3c2d38…로 다르다. 두 stream을 같은 것으로 맞추지 않는다. dev/migrations에는 정확히2개만 허용하고 root local50는 별도 이력이므로 원격에 사용하지 않는다. config API/auth/studio/storage/edge/analytics/seed 모두 off, schema_paths=[]; 실제 .temp/link/auth/profile/credentials/env는 포함하거나 생성하지 않는다. config의 local ports는 보관된 source 설정이며 이 단계에서 서버를 열지 않는다.

adoption.json은 canonical JSON으로 고정된 비밀 없는 관측 영수증이다. dev/preview/org/ref와 prod 별도ref, observedAt, status RECORDED_ADOPTED_DISABLED, versions/names/source paths/bytes/SHA, native16/87문장 및 배열SHA abc9505f…/4971cb4a…, remote1회 방법 Management API tracking-only, before/after fingerprint, source/artifact ledger 구분, Data APIoff·Free·app/workerfalse, 원본 status/remote-proof/백업의 경로와 SHA, 두 READY key·manifest를 기록한다. 원격 응답·브라우저 쿠키·token·실제 auth home·원문 데이터는 복사하지 않는다. 이 JSON/해시의 검증은 제출된 기록의 정합성 검사이며 공급자 서명·현재 원격상태 증명이 아니다. prod officialHistoryAdoptedfalse, migration2–50미이관을 별도 표시한다. source SQL은 이력 재현자료일 뿐 재실행 승인으로 간주하지 않는다.

## 읽기 전용 검사 설계

cloud:history:inspect는 정확히 --environment preview --project-ref nxfpfvsdwbziowkxsxnh만 받는다. 미지/중복/누락 옵션, prod, apply/repair/SQL/URL/파일 경로 인수는 읽기 전에 거부한다. 고정 경로에서 config·SQL2·adoption·root000001·기존 cloud03 guarded SQL과 provenance 등 결속된 자료만 읽는다. 모든 경로 구성요소의 reparse/symlink/realpath/regular-file 검사를 전체 입력에 대해 먼저 수행한 뒤 body를 읽는다. 고정 migrations directory의 정확한 파일 집합도 검사한다. 중복 JSON key/비정규 JSON과 잘못된 ref·hash·role·version/상태·unknown fields를 거부한다. SQL LF bytes/해시, config bytes/해시, root와cloud 차이, cloud03와새domain동등, native배열 메타정보와 기존 raw-source hash를 검증한다. 파일은 정보로만 읽고 실행하지 않는다. 네트워크·DB·credential·subprocess·.env 접근이나 apply 진입점은 없다. 실패 출력은 일반 BLOCKED이며 오류에 사용자 env·파일 내용을 넣지 않는다.

성공 출력은 RECORDED_ADOPTED_DISABLED_OFFLINE_VERIFIED, recordedOfficialHistoryAdoptedtrue, liveVerifiedfalse, networkRequests0/sqlExecutions0, connectedfalse, replayFORBIDDEN이며 최신 관측시각과 한계를 명시한다. 기존 cloud:inspect는 당시 OFFLINE_SOURCE_ONLY 계약용으로 그대로 유지한다. 개발 status.cloudHistory는 새 registry 경로와 stage/plan hashes를 가리키고 이전 cloudDeployment를 삭제·수정하지 않는다.

새 foundation validator는 실제 Git root/own .git·common-dir·alternates/submodule/include/hooks/env routing·origin 경계, 독립 ancestry를 보존한다. branch main 또는 feat/cloud04e-history-source와 공식 hosted detached PR 형식만 허용한다. 기준16commit+자식1개, 또는 equal-tree hosted merge1개만 허용하며 기존 ref목록에 새 feature head/remote 하나만 추가한다. local/remote main은 base 또는 검증된 head, hosted missing local main은 기존 공식 PR 규칙만 허용한다. 검사기는 저장소 base358파일 원본 blobs와 비교하여354파일 byte freeze·정확한4파일 추가적 diff·정확한12추가파일 집합을 강제한다. Git스냅샷18개 effective text/filter/ident/encoding과 hash-object nofilter동등 검사, 비밀경로 ignore 및 소유경계도 보존한다. 새 SQL/config는 LF이며 fresh checkout 후에도 같은 hash를 검사한다. 기존 모든 test groups와 native/provider 검사는 계속 실행한다. 역사 validator를 수정하거나 호출만 생략해 검사를 약화하지 않고 동일 경계를 새 단계의 정확한 baseline과 변경계약으로 검증한다.

## 시험·검수·Git

먼저 이 계획을 Claude Opus5.5 medium와 Codex gpt-6-astra ultra DUAL 검수한다. READY 후 feature branch에서 구현한다. offline unit tests는 정상기록과 ref/version/배열hash/source/config/body/추가필드/duplicatekey/옵션 오류를 대조하고, migrations 여분·중첩경로/링크/디렉토리 대체·body읽기전 전체경계 거부·계약상 연결flag 상승을 검증한다. ancestry/main/hosted merge의 허용·거부도 직접 시험한다. 새 CLI는 subprocess test에서 성공/오류 출력 검증하되 네트워크/실제 DB/credential을 사용하지 않는다. 강한 테스트는 실제 정책·독립변조 입력을 검증하며 문자열을 되풀이해 통과시키는 모의 검사는 피한다.

제품 필수 전체 pnpm verify(기존 전체 domain/provider/M0/M1/catalog/search/installation/reservation/market/priority/snapshot/ranking/cloud-deployment, types, admin build, Android/iOS JS exports 포함)에 새 test:cloud-history를 추가해 실행한다. 새 offline tests와 음성변조/clean stage 및 git snapshot byte 비교, diff확인, 두 공통문서 검사도 실행한다. 더러운 작업tree·기존 runtime서버는 자의로 지우거나 재시작하지 않는다. 새 연결이나 비용·비밀 입력이 필요하면 별도 단계로 남긴다.

최종 제품바이트·계획승인·결과/검사출력 manifest를 DUAL 검수하고 현재 파일 일치 확인 후 명시 파일만 stage/commit한다. reviewed childcommit의 tree·rawsource·schema SHA를 재확인하고 fresh clone/checkout에서 deps는 제품 전용 pinned cache로 설치·검사해 byte integrity와 full verify를 확인한다(공식 registry만, 신규 계정 없음). 커밋후 형상 이슈는 검수된 source 변경 없이 먼저 원인 확인하고 필요시 재검수한다. 원격 main이 여전히 base인지 확인한 뒤 feature push, main fast-forward 및 push; concurrent변경이면 강제push/merge없이중단한다. 제품 변경백업은 explicit allowlist로 Git archive 및 검수증거 ZIP을 저장하며 실제 .local-data/credentials/env/keyring/privateprofile는 제외한다. commit linkage와 최종 gate는 outputs에 써 제품검수bytes를 바꾸지 않는다.

완료 범위는 Git-managed source/history registry와 offline 검증이다. 실제 CLOUD04D history를 다시 쓰지 않는다. 앱·봇 운영, cloud migration2–50 및 live공급은 다음 별도 계획이며 완료로 주장하지 않는다.
