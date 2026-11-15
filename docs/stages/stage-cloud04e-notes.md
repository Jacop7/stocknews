# CLOUD04E — 전용 클라우드 소스와 이력 기록

최신 진입점은 docs/development-status.json의 cloudHistory이며 supabase/cloud/dev/adoption.json을 가리킨다. registry의 supersedes 배열은 CLOUD04A resource manifest·deployment-contract·cloudDeployment 안의 과거 officialHistoryAdopted=false 필드보다 최신 이력 기록이 우선함을 뜻한다. 다른 자원·상태를 일괄 덮는 의미가 아니다. 역사자료와 당시 cloud:inspect 결과는 그대로 보존한다. 다음 자원 registry 정비 단계에서는 원본 자원 manifest의 시간별 관측 구조도 검수 후 통합한다(CL04EP-01).

`pnpm cloud:history:inspect --environment preview --project-ref nxfpfvsdwbziowkxsxnh`는 Git 안의 고정 파일을 확인한다. 결과 RECORDED_ADOPTED_DISABLED_OFFLINE_VERIFIED는 저장된 채택 기록의 정합성만 뜻한다. liveVerified=false이며 현재 원격 health·권한·연결을 조회하지 않는다. source SQL 재실행, 원격 link/push/repair, DB/API 활성화 기능은 없다. registry의 reference SHA는 로컬 보관 원본과 검수 증거의 추적값이며 공급자 서명이나 증거 파일의 영구 공개 URL이 아니다.

supabase/cloud/dev는 보관용이며 CLI workdir가 아니다. CLI가 필요해지는 별도 승인 단계에서는 <workdir>/supabase 아래로 검수된 bytes만 복사해 source SHA를 다시 결속해야 한다(CL04EP-02). root supabase/migrations의 기존50개는 로컬 테스트 stream이다. cloud000001은24148 bytes이고 root000001은19011 bytes라서 서로 교체할 수 없다. cloud2개는 이미 적용된 SQL의 자료이며 dev에 다시 실행하지 않는다. prod는 이력 미채택·업무 relation0 상태의 관측이다.

354 baseline파일은 바이트 동결했고, 4파일은 승인된 추가만 적용했다. 기존 validator와 기존 full test groups·native/provider 검사는 보존한다. 새 foundation 분기가 Git/source/refs/attributes/ignore 경계를 a4bbbed 기준으로 검증한다. 다른 단계의 역사 validator를 현재 파일집합에 실행했다고 주장하지 않는다. 파일 링크·junction·외부realpath는 body 읽기 전에 검사하며 같은 권한의 악의적 동시교체까지 격리하는 OS sandbox는 아니다.

이번 단계의 원격 DB·API 요청은0이며 기존 앱·worker·RPC 미연결, Data APIoff 관측,112 RIGHTS_HOLD,M2false,iPhone USER_DEFERRED를 유지한다. 실제 뉴스·AI·시세·발송 운영은 다음 별도 계획이다. 최종 구현 검수와 실제 commit·fresh checkout·push 결과는 제품 검수 bytes를 바꾸지 않도록 outputs의 외부 영수증에 기록한다.
