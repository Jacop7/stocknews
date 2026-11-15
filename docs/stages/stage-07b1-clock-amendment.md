# 7B1 검증 범위 보완 — 기존 합성 타임아웃 시험의 고정 시계

2026.11.15. 구현 전 추가 범위 검수. 기능 확대·실공급 활성화 아님.

승인된7B1 계획 r2 c15d05a3/ce9d3183은 기존4파일만 변경하도록 했다. 그 범위의 구현 후보가 작성되어 단위44개·타입·격리2780검사는 통과했지만 전체verify의 기존 tests/providers.test.mjs 마지막 시험이 local/fresh 모두 실패했다. 실패 원문은 outputs/development-stages/reviews/stage07b1-implementation/local-r1-verify.txt와 fresh-r1-verify.txt다. 기대 REQUEST_TIMEOUT 대신 RIGHTS_EXPIRED가 반환됐다. 이 보완은 그 실패를 숨기지 않는다.

기존 마지막 시험은 가짜 news.example endpoint·합성권한profile·끝나지 않는 주입 DNS promise를 사용해10ms timeout과 requests0을 검증한다. 다른 시험들은 now:()=>time을 주입하지만 이 마지막 probe 호출은 now를 생략해 실제 Date.now를 쓴다. 고정 profile의 expires_at(2026-11-15T00:00:00Z)에 도달하면서 DNS timeout 이전 권한검사가 정확히 차단했다. 모듈의 만료 판단은 정상이고 시험의 시계 의존이 문제다.

기존 마지막 호출의 정확한 추가 변경만 허용한다.

이전: `probe({endpoint,profile,execute:true,lookupHost:async()=>new Promise(()=>{}),limits:{timeoutMs:10,maxBytes:100,maxHops:1}})`

이후: `probe({endpoint,profile,now:()=>time,execute:true,lookupHost:async()=>new Promise(()=>{}),limits:{timeoutMs:10,maxBytes:100,maxHops:1}})`

기존 timeout expectation·requests0 assertion·별도 RIGHTS_EXPIRED 시험·DNS/SSRF·권한·예산·실제probe코드와profile은 그대로 둔다. 만료일을 연장하거나 현재시계를 글로벌로 바꾸지 않는다. 새 검증기의322기준 동결에서 해당 시험파일을 다섯 번째 예외로 삼되, 기준 커밋 aac3d3c의 해당 파일을 정확한 위 문자열 한 번 치환한 결과와 전문이 같을 때만 허용한다. 다섯 번째 경로를 임의 변경 가능 파일로 풀어두지 않는다.

기존7A validator 자체는 동결한다. 새7B1 validator가 상속한 과거6D/6E/7A 동결검사에서는 tests/providers.test.mjs만 동일 예외로 취급하고, 별도 더 강한 기준aac3d3c 전문 치환 검사로 실제 현재 파일을 검증한다. 이를 치환 목록에 명시해 원본 assertion 상속 비교에도 포함한다. 나머지 파일·assertion·허용변경경로는7B1 승인 계획 그대로다. 보완계획/승인 JSON을 새 파일로 추가하고 planSHA·현재DUALmanifest를 연결한다. 기존 승인계획 본문/승인JSON/역사검사 원본은 바꾸지 않는다.

인수 기준: 기존provider 전체시험과 고정시계 timeout test 통과, 명시 RIGHTS_EXPIRED 시험 유지, 변경파일 기준 전문 일치, 기존모든검사·새44시험·전체verify local/fresh/postcommit 통과, 새Gitguard 부정시험·구현DUAL·검수바이트commit·normalpush/remoteSHA확인. 실제 네트워크/DNS요청은0이고 주입promise만 사용한다. 별도 봇수집/API/권한 승인이나 P03b/iPhone/7B/M2 완료로 표시하지 않는다. 이 추가 범위도 DUAL READY 전에는 tests/providers.test.mjs를 수정하지 않는다.
