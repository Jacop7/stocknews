# CLOUD04A 구현 범위

검수된 CLOUD03 업무 기초 SQL과 관측 기록을 저장소에 보관하고 오프라인 비교만 제공한다. `pnpm cloud:inspect --environment preview --project-ref nxfpfvsdwbziowkxsxnh --artifact foundation1`은 파일을 확인하고 JSON을 출력한다. SQL 실행, 연결, 키, 환경변수, DB/CLI 이력 수정 기능은 없다. 출력은 NOT_EXECUTED_OFFLINE_ONLY / REPLAY_FORBIDDEN이다. dev foundation은 이미 적용됐으므로 다시 실행하면 안 된다.

논리 preview는 실제 이름 **judoju-news-dev**에 대응한다. 계획 앞부분의 짧은 `dev` 표기는 physicalEnvironment 의미다. 실제 이름은 CLOUD01 resources.json 관측의 이름이며 그 원본 SHA를 contract에 기록했다. 운영 실제 이름은 judoju-news-prod다. registry의 OBSERVED_NOT_CONNECTED는 2026-11-15의 과거 관측이며 현재 health·권한·연결 승인이 아니다. API 관측 시각과 업무 구조 DUAL 근거 manifest를 구별한다. 공식 Supabase CLI migration 이력은 채택되지 않았다.

기존 JSON 소비자 검색: verify-toolchain은 currentStage, providers는 supplyTrack/기존 stage, native-release는 자기 record, local-runtime은 plannedLocalConfig·기존 M1, seed-reference-local은 catalogConnection을 사용한다. 이 값은 동결했다. 이전 validator의 PENDING/null 단언은 과거 단계 전용이다. 새 validator는 원래 345개 중 변경 허용5개를 역변환하고 나머지340개를 바이트 동결하며 과거 validator·분기를 그대로 보관한다. 해당 과거 validator를 현 단계에 실행했다고 주장하지 않는다.

config.toml에 seed/sql_paths/schema_paths 지정은 없다. CLI 기본값의 활성 여부를 임의로 단정하지 않는다. 기존 start-local/migrate-local/maintenance의 SQL 경로는 supabase/migrations이며 새 보관 경로 supabase/cloud는 포함하지 않는다. 기존 local DB reset/push 기능을 새 클라우드에 연결하지 않는다.

CI 변수는 암호학적 인증 수단이 아니다(CL04AP-06). 기존 allowedHostedPullRef의 repository/event/ref/SHA 매칭은 보조 조건이며, 허용 merge의 실제 경계는 정확한 parent 구조·단일child·같은 tree OID다. 배포는 single reviewed child의 main fast-forward만 사용한다. 검수 후 commit·fullverify·원격SHA 일치는 외부 영수증으로 남긴다.

파일 읽기는 고정 allowlist 전체를 먼저 lstat/regularfile/realpath 검증한다. 파일·상위 경로 symlink/junction과 root 밖 실제 경로를 거부한다. 같은 권한의 악의적인 동시 파일 교체까지 격리하는 sandbox는 아니다. 비밀 파일·다른 제품 경로를 입력으로 받지 않는다.

구현 재검수 보완: C04AI-CX-01의 동적 main 기준선을 복원했다. feature에서는 main=base94ac, main에서는 main=HEAD도 허용하며, main이 없는 hosted PR만 기존 ref 매칭과 origin/main=base94ac를 요구한다. 임의의 오래된 main을 실제 복제본에 넣는 부정 시험을 추가한다. 기존 ignore 경계와 workers/common/package.json 부재 검사도 복원했다. CL04AI-01에 따라 JSON은 중복 키를 허용하지 않는 정규 직렬화 바이트 검사를 추가했다. CL04AI-02의 검사 수 차이는 verify-toolchain의 node_modules/.local-tools/.pnpm-store 링크 순회가 설치·캐시 상태에 따라 다르기 때문이다. 실제 소스는 같은358파일이고 각 실행의 정확한 checks 수는 외부 보고서에 기록하며 동일하다고 주장하지 않는다.

구현 r3: C04AI-CX-02에 따라 provenance의 원본 스냅샷18개에서 유효 Git text/filter/ident/encoding 속성과 비변환·경로별 hash-object 결과를 확인한다. .git/info/attributes는 .gitattributes보다 우선할 수 있어 source 동결만으로 대체하지 않는다. 실행 가능한 임의 clean filter를 호출하기 전에 해당 속성을 거부한다. 별도 복제본에서 planning/** text eol=lf를 설정했을 때 소스는 같지만 staging hash가 달라지고 guard가 차단하는지 확인한다. CL04AI-03도 보완하여 존재하는 origin/main은 base 또는 HEAD여야 한다. 이전 active validator의 동적 경계(독립 Git/refs/main/스냅샷 변환/링크/ignore/임시 worker package)를 항목별로 대조했고, 나머지 상태·의존성·설정 단언은 frozen345·정확 역변환 및 unchanged provider/native 검사가 보존한다.

다음 별도 단계: official migration history 채택, preview용 RPC/Auth·최소 권한, 관리자/앱 연결, 새 클라우드 worker. 실제 접속 단계마다 Free health·Data API before/after를 각각 관측한다. SQL Editor RLS 경고에서 원문 실행과 자동 SQL 재작성을 구별한다. 이번 작업은 원격 SQL0, 앱/worker 연결false, 뉴스·AI·시세·push·광고0, 112 RIGHTS_HOLD, M2false, iPhone USER_DEFERRED다.
