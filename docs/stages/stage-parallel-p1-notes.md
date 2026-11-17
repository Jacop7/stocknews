# MAIN PARALLEL P1 통합 범위

사용자 개별오더에 따라 MAIN은 acquisition-store.ts/test, native collector 담당은 inventory.ts/site-recipes.ts/test, native home 담당은 completed-adapter.ts/tsconfig/test를 분리 구현했다. 운영상 소유권 지시이며 OS sandbox나 인증정보 차단 실증이 아니다. 전달한 읽기 대상은 계획·원문 보고서·각 담당 관련 공개 제품 source/data였고 .env/.local-data/private state/auth/다른제품/서비스/Git 접근을 금지했다. 이 지시의 준수 보고는 사후의 모든 파일 읽기 검출 증명이 아니다(MPP1-01 한계 유지). 단위 실행은 정확 product Node의 해당 --test와 각 worker tsc로 제한했다. MAIN은 결과를 직접 읽고 통합한다.

계획 DUAL manifest029599567ab9852e6f337f1a8e172d9d5dc3828ebc920ad4ef754c672da1a87b. 원문/증거/백업/커밋 연결은 제품 밖 outputs/development-stages/reviews/main-parallel-p1-*에 보존한다. acquisition 기존 계획 DUAL도 보존한다. 5기존수정·13신규와 기준476 바이트·refs, 모든 이전 검사에 새4그룹, 세 담당 원문·source pin을 통합 검수한다. 기존 data/K1/domain/R1/AI/역사guard/앱/lock은 불변이다.

MAIN acquisition: 발행 ticket/ownUUID/source digest/모든 PipelineVersions/현재 권한 generation·만료·단조시각을 재검사한다. BODY text는 별도 private map, bodyHash는 canonical JSON 문자열의 SHA256이며 raw 파일 byte digest가 아니다. sidecar는 원문을 덮지 않는다. 동일 수락 payload 재평가 asOf는 effect identity에서 제외해 최초 acquisitionId/acceptedAt을 보존한다(ACQUISITION-A1-PLAN-P3-001/002, MACQP-02 반영). 권한·세대 변경/만료는 replay와 readBody에서도 차단한다. 같은 세대 상이본문은 parser차이여도 영구 HOLD(MACQP-03); 해소·purge/현실Clock/권한공급·영속 ACK·대표판본 선택은 후속. 거절된 미래asOf도 watermark를 전진해 진행성을 막을 수 있는 합성 Clock 한계를 명시하고 시험한다(MACQP-01 의도적 한계). 20시험.

COLLECTOR: 실제106행/112endpoint/112profile 전수, 다중URL6행의 positional 연결과 HTTP선언58/59행·row69 category 공백을 그대로 보존한다. 공유endpoint/복수source_ids/복수profile·중복·오연결은 INVALID_INPUT이고 몰래제외하지 않는다(MPP1-02 반영). 입력3문서를 별도 pipelineData 예산으로 안전복제한다. provenance 해시는 선언 메타데이터이며 원문파일의 진실/권리를 인증하지 않는다. 언제나 BLOCKED/executionEnabled=false이고 VERIFIED fixture도 adapter 승인으로 승격하지 않는다. 8시험.

HOME: private 기존 engine만 소유하는 exact6명령 dispatcher다. RESTORE_STATE 성공 result:null을 고정하고 비어있지않은 복원/직렬화/재호출을 시험한다(MAIN-PARALLEL-P1-PLAN-P3-001). 고정4필드 shell은 getter 없는 descriptor 검사, payload만 기존 예산으로 복제하고 engine이 detached 반환한 결과를 literal metadata로 감싸 mutation후 wrapper복제 실패를 만들지 않는다(P3-002). 응답은 engine 예산+고정 wrapper overhead로 정의한다. 깊이경계·9998nodes·262120자 engine export/거절후 이력불변·9시험. 새 산식/K2/공개DTO/실제순위 공급 없음. G0BI-02 stale draft 한계 유지.

공통 한계: 실제 수집·AI 호출·DB·큐/스케줄·권한 승인·알림·게시·OS격리/기술적자격증명제한·durable/multiwriter·기존원격worker재시도는 수행/승인하지 않았다. 기존 원격 collector HOLD/ranking OUTPUT_READY/3회 상한/원장 및 기존 G0CMN/G0CFI/C11C1P/G0CXI/G0BI/CLOUD P3는 종결하지 않는다. 새검사37개(20+8+9)와 기존 전체 pnpm verify·구현 DUAL 범위만 보고한다.
