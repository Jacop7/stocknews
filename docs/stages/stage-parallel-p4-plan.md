# MAIN_PARALLEL_P4 — 구현 중

계획 양측 READY manifest `ac4c335429a4f28622db3715fd9a3bacc44bc9d9e7e7d2c5f650c63a9ecd3542` 이후 exact scope를 작성한다. 계획 READY와 구현 검수는 별개다. 기존 원문 검수/회차/P3는 ../outputs에 보존한다.

- collector 8개와 HOME 6개 신규 파일은 기존 담당자가 작성한다. MAIN만 AI bridge/공통 8개 신규와 기존 5개를 변경하고 시험·통합·Git을 수행한다. 제한 지시는 OS sandbox 증명이 아니다.
- 별도 새 collector/HOME PostgreSQL 자원으로만 실제 SQL을 시험한다. 기존 DB/키/식자재 자원은 사용하지 않는다. cached official image pin, network none/ports0/read-only root/tmpfs/제한된 새 LOGIN/소유 자원 확인을 유지한다.
- receipt는 기록된 마지막 검사/확정 저장의 역사다. 물리 COMMIT 자격은 false다. HOME commitTimeQualificationProven:false, collector physicalCommitTimeRightsProven:false를 exact 검사한다. 요약 physicalCommitTimeQualificationProven는 wire alias가 아니다.
- RC 입구 guard, VOLATILE 잠금 뒤 새 조회, 현재 grant/보존기한/claim 재검사, effect ACK 복구, rollback/동시성/같은 PGDATA 서비스 restart 및 SET CONSTRAINTS 전후 실제 만료 경로를 검증한다.
- AI는 소유 collector reader에서 현재 원문을 재조회한다. 본문은 신뢰하지 않는 입력이고 외부 AI 전송권한을 추정하지 않는다. 실제 provider/수집/게시/Auth/hostedDB/운영 worker/C2는 비활성이다.
- 원래 순수 순위 엔진/전체 previous RankingState와 24시간 뉴스 처리·5분 홈 정책을 유지한다. 순수 32/288 시험과 실제 155분/23시간55분 실행을 구별하고 미실행은 NOT_RUN/HOLD다.
- 전체 pnpm verify와 신규 PG 수용 후 구현 DUAL→백업→정확 scope commit/push→remote SHA/clean 확인 순서다. 다른 DB 간 원자성, 실제 기사 사실·권리·외부 provider·운영 수집·실제 관리자 연결 완료는 주장하지 않는다.
