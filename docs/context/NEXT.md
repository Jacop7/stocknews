# 다음 할 일 (NEXT)

세션이 끝날 때 갱신한다. 위에서부터 순서대로 진행하고, 사용자 입력이 필요한 항목은 따로 모은다.

## 사용자 입력이 필요한 것

1. **OpenDART API 키 저장** — 키는 채팅에 붙이지 말고 worktree의 `.local-data/dart/opendart.key`(git 제외)에 직접 저장한다.
2. **AI 모델 결정됨(Sol 중심안)**, **API 키 저장됨**(2026-11-26, worktree `.local-data/ai/openai.key`, git 제외). 모델 목록 조회로 키 유효와 `gpt-6-luna`·`gpt-6.1-sol`·`gpt-6.2-sol` 사용 가능을 확인. 키 내용은 출력·커밋하지 않는다. 플랫폼 월 사용 한도(권장 $200)는 사용자가 설정. 채팅에 한 번 노출된 이전 키는 사용자가 2026-11-26 삭제함(저장된 키와 다름을 해시로 확인).
4. 프로젝트 루트 `AGENTS.md`가 2026-11-26 세션 중 사라졌다. 의도한 삭제인지 확인.

## 자동으로 진행할 것 (순서대로)

1. ~~원문 접근 허가 후보~~ 완료(2026-11-26): `docs/context/SOURCE-CANDIDATES.md`(요약), `.local-data/backlog/source-candidates.json`(전체, DISABLED). 생성: `node scripts/backlog-source-candidates.mjs --hosts … --companies … --out … --summary …`. **사용자 검토 필요**: 링크가 많은 뉴스·리포트 상위 사이트부터 약관·robots 확인 후 ENABLED 여부 결정.
1-1. ~~단축 주소 해석·라우팅~~ 완료(2026-11-26, 결정 B): `routing.mjs`·`resolver.mjs`, 뉴스는 `news_signals`. 다음: 같은 사건 매칭(뉴스 신호 ↔ 공식·리포트 원문), 홈 순위 관심도 입력 연결.
2. AI 처리기 실행 환경 준비: 서버 배포 형태(별도 컨테이너, 수집기와 분리, 수집 DB는 읽기 전용 스냅샷), 설정 파일 위치, 키 파일 전달(내용 출력 없이), 실행 flag OFF 상태로 배포 스크립트까지 준비. 허가 후보 검토 후 하루 상한 150으로 켠다.
3. DB 게시 경로에 출처 구분(`role`)과 고지 연결 — 앱 화면은 준비됨.
4. 수집기 운영 확인: 47개 채널 한 바퀴 결과, 웹 후보 수 변화, 오류. `scripts/ops/collector.ps1 status`.

## 주의

- 배포 스크립트는 현재 실행 중인 이미지를 기준으로 바뀐 수집기 파일만 덮어쓴 파생 이미지를 만든다. 서버 등록부(routes·permission-profiles)는 이미지 안의 운영본을 유지한다. 등록부를 바꿀 때는 별도 확인을 거친다.
- 되돌리기는 직전 compose override로 돌아간다. 텔레그램 저장 형식은 이전 버전과 호환된다(새 표는 무시됨).
