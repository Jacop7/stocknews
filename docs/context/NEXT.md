# 다음 할 일 (NEXT)

세션이 끝날 때 갱신한다. 위에서부터 순서대로 진행하고, 사용자 입력이 필요한 항목은 따로 모은다.

## 사용자 입력이 필요한 것

1. **OpenDART API 키 저장** — 키는 채팅에 붙이지 말고 worktree의 `.local-data/dart/opendart.key`(git 제외)에 직접 저장한다.
2. **AI 모델 결정됨(Sol 중심안)**, **API 키 저장됨**(2026-11-26, worktree `.local-data/ai/openai.key`, git 제외). 모델 목록 조회로 키 유효와 `gpt-6-luna`·`gpt-6.1-sol`·`gpt-6.2-sol` 사용 가능을 확인. 키 내용은 출력·커밋하지 않는다. 플랫폼 월 사용 한도(권장 $200)는 사용자가 설정. 채팅에 한 번 노출된 이전 키는 사용자가 2026-11-26 삭제함(저장된 키와 다름을 해시로 확인).
4. 프로젝트 루트 `AGENTS.md`가 2026-11-26 세션 중 사라졌다. 의도한 삭제인지 확인.

## 사용자 결정이 필요한 것 (최우선)

- **OpenAI API 크레딧 충전 필요**(2026-11-26): 첫 실호출이 `429 insufficient_quota`. ChatGPT 구독은 API에 쓸 수 없다(약관·결제 체계 별개). platform.openai.com → Billing에서 선불 충전(권장 시작 $20~50). 429는 15분 뒤 자동 재시도(`7663426`)라 충전하면 바로 분석이 시작된다.
- 현재 서버: DART 공시는 OpenDART API로 수집·원문 확인 동작(첫 목록 38건, 원문 8건). 선별 3건 완료, 검증 규칙으로 보류 3건(FACT_NUMBER_MISMATCH 2, KOREAN_ENTITY_REQUIRED 1). 증권사 사이트 허가는 모두 OFF(텔레그램 링크는 신호).

- ~~원문 허가~~ 2026-11-26 사용자 승인("진행해줘 함께"): DART·증권사 리포트 12개 호스트 ENABLED, AI 호출 ON(하루 150). 첫 8분 결과 **원문 성공 0건, 모델 호출 0건**: DART·NH는 robots 거절, 교보는 PDF(추출기 없음), 제이조AI·한화·미래에셋은 뷰어/목록 페이지라 본문 미인식.
- **OpenDART API 키 저장됨**(2026-11-26, `.local-data/dart/opendart.key`, git 제외). 기업개황 API로 정상 응답(status 000) 확인. DART 웹은 robots 금지라 공식 API로만 접근한다.

## 자동으로 진행할 것 (순서대로)

-1. **(진행 중) 실데이터 프롬프트·검증 조정** — 2026-11-26 `ac99802`·`473cbf2`·`5a236cf` 배포 후 **검증 통과 초안 3건**(심텍 2, 하나금융지주 1). 해결: 작성기가 본문에 붙인 `[factIds: …]`(DRAFT_NUMBER_MISMATCH의 원인), 날짜 표기(2026년 11월 26일·2026.11.24), 회계식 음수 `(1,849,423,316)`, 띄어 쓴 단위(백만 원), BENEFIT+POSITIVE 중복 방향, 시각 없는 일정, 괄호·백분율 계산, 계산 ID 밑줄, 조건문 "매도해야 … 이어진다" 오탐. 정확도 규칙(사실 외 숫자·변환·합친 값·출처 미명시·단정 표현)은 그대로 실패한다(`tests/backlog-live-formats.test.mjs`). 남은 보류는 대부분 정상 판정: 독립 검증 거절(같은 날 엘앤에프 제11회·제12회 전환사채가 한 사건으로 묶인 초안, 신한지주 제목의 근거 없는 주가 인과, 심텍 중복), 원문과 다른 인용(FABRICATED_EVIDENCE), 원문 문장 복사, 카탈로그 밖 기업. 다음: (a) 엘앤에프 두 건은 기존 선별 결과(`triages`)가 회차 없이 저장돼 있어 재선별하려면 해당 문서의 선별 행 삭제가 필요(V5부터 새 공시는 회차를 officialId로 구분), (b) DART 공시는 접수번호를 officialId로 자동 지정하는 방안 검토, (c) 초안 본문의 `[사실]`·`[분석]` 꼬리표를 앱 표시에서 어떻게 다룰지 결정. 진단 방법: 서버 DB의 runs.response를 컨테이너 안에서 `validateDraft`/`validateTriage`로 다시 검증(stdin으로 스크립트 전달, 컨테이너 rootfs는 읽기 전용).

0. PDF 텍스트 추출기(`extractPdf` 포트에 연결, 오픈소스 라이브러리) → 증권사 리포트 PDF 처리. 리포트 뷰어 페이지에서 PDF 링크 찾기. OpenDART 키가 오면 공시 API 어댑터.

1. ~~원문 접근 허가 후보~~ 완료(2026-11-26): `docs/context/SOURCE-CANDIDATES.md`(요약), `.local-data/backlog/source-candidates.json`(전체, DISABLED). 생성: `node scripts/backlog-source-candidates.mjs --hosts … --companies … --out … --summary …`. **사용자 검토 필요**: 링크가 많은 뉴스·리포트 상위 사이트부터 약관·robots 확인 후 ENABLED 여부 결정.
1-1. ~~단축 주소 해석·라우팅~~ 완료(2026-11-26, 결정 B): `routing.mjs`·`resolver.mjs`, 뉴스는 `news_signals`. 다음: 같은 사건 매칭(뉴스 신호 ↔ 공식·리포트 원문), 홈 순위 관심도 입력 연결.
2. (진행 중) AI 처리기: `runtime/service.mjs`(10분마다 수집 DB 읽기 전용 import, 실행은 설정 flag + `JUDOJU_AI_EXECUTE=1` 이중 스위치)와 `scripts/backlog-server-config.mjs`(카탈로그 + 공식·리포트 후보 393개 DISABLED, 모두 OFF) 완료. 남은 것: 서버 컨테이너 배포(파생 이미지, 수집 볼륨 마운트, 설정·키 파일 읽기 전용 마운트) 후 import 확인. 기존 메모:  서버 배포 형태(별도 컨테이너, 수집기와 분리, 수집 DB는 읽기 전용 스냅샷), 설정 파일 위치, 키 파일 전달(내용 출력 없이), 실행 flag OFF 상태로 배포 스크립트까지 준비. 허가 후보 검토 후 하루 상한 150으로 켠다.
3. DB 게시 경로에 출처 구분(`role`)과 고지 연결 — 앱 화면은 준비됨. AI 초안의 `article_kind`(COMPANY 포함)·`primary_company_ref`·`company_refs`도 같이 넘긴다(DB 게시 검증 `private.m1_prepare`가 이미 받음).
3-1. **종목 상세 후속**(2026-11-27 1차 완료): (a) ~~로컬 DB 적용~~ 완료(2026-11-27, 소유 checkout `judoju-news`의 `.local-data/runtime/company-scope-intent.json`에 적용 기록, Supabase CLI 이력은 그대로). 앱 웹(로컬 게이트웨이 + Expo web 8084)에서 종목 상세·섹터 관련 종목 링크 확인, 캡처 `outputs/company-page-20261127/`. 재확인 `node scripts/test-company-page-sql.mjs`(트랜잭션 후 되돌림). 남은 것: 클라우드 preview의 `READ_RPCS`에 `catalog_public_company` 추가와 preview DB 적용, (b) 종목코드: `data/dart-corp-codes.tsv`와 OpenDART 기업코드 파일의 stock_code로 검증 후 채우기, (c) 종목 상세에 DART 공시 목록(원문 링크) 탭, (d) 글 상세의 관련 기업 이름 → 종목 상세 링크(공개 본문 impacts에 기업 역할 포함 필요), (e) 홈 순위 입력에서 COMPANY 제외 확인, (f) 어드민 편집기에서 COMPANY 범위·연관 기업 입력. (g) 마이그레이션 52(종목 기사 섹션·연관 기업)는 로컬 DB 적용 완료(`company-sections-intent.json`), 클라우드 preview는 51과 함께 적용 필요.
4. 수집기 운영 확인: 47개 채널 한 바퀴 결과, 웹 후보 수 변화, 오류. `scripts/ops/collector.ps1 status`.

## 주의

- 배포 스크립트는 현재 실행 중인 이미지를 기준으로 바뀐 수집기 파일만 덮어쓴 파생 이미지를 만든다. 서버 등록부(routes·permission-profiles)는 이미지 안의 운영본을 유지한다. 등록부를 바꿀 때는 별도 확인을 거친다.
- 되돌리기는 직전 compose override로 돌아간다. 텔레그램 저장 형식은 이전 버전과 호환된다(새 표는 무시됨).
